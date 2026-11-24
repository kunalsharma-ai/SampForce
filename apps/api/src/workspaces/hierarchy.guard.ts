import { type CanActivate, type ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { actionAllowed, FEATURE_BY_KEY, type FeatureKey, WORKSPACE_ACTION_LABEL, type WorkspaceAction } from '@dealflow/types';
import {
  ALSO_REQUIRED_FEATURES,
  type AuthedRequest,
  type FeatureSelector,
  OWN_HIERARCHY_RULES,
  REQUIRED_ACTION,
  REQUIRED_FEATURE,
  REQUIRED_PERMISSIONS,
} from '../common/auth-context';
import { CONFIRMS_PASSWORD, type ConfirmPasswordRule } from '../common/password-confirmation/password-confirmation.decorator';
import { PrismaService } from '../common/prisma.service';
import { resolveWorkspaceAccess } from './access';
import { actionFor, PERMISSION_FEATURE, RESOURCE_FEATURE, routeFeatures } from './route-access';

/**
 * Global guard, after AuthGuard and FeatureGuard (ADR 0071): a route works only while the caller's workspace has
 * every feature the route belongs to and the action it performs. The workspace's access is recomputed from the
 * subscription down on every request, so a direct URL, an API call or a stale screen meets the same refusal as the
 * interface. Routes without a feature (signing in, the profile, billing) are not affected.
 */
@Injectable()
export class HierarchyGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true;
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    if (!req.auth) return true;
    const targets = [ctx.getHandler(), ctx.getClass()];
    const selector = this.reflector.getAllAndOverride<FeatureSelector | undefined>(REQUIRED_FEATURE, targets);
    const explicit = (typeof selector === 'function' ? selector(req) : selector) ?? null;
    const permissions = this.reflector.getAllAndOverride<string[]>(REQUIRED_PERMISSIONS, targets) ?? [];
    const also = this.reflector.getAllAndMerge<FeatureKey[]>(ALSO_REQUIRED_FEATURES, targets) ?? [];
    const features = [...new Set([...routeFeatures(explicit, permissions), ...also])];
    if (!features.length) return true;

    const { tenantId, workspaceNodeId } = req.auth;
    const access = await this.prisma.run({ tenantId }, (tx) => resolveWorkspaceAccess(tx, tenantId, workspaceNodeId));
    const missing = features.filter((f) => !access.features.includes(f));
    if (missing.length) {
      throw new ForbiddenException({
        code: 'FEATURE_NOT_GRANTED',
        message: `${FEATURE_BY_KEY[missing[0]!].label} is not available in your workspace. Ask the administrator of the workspace above yours.`,
        details: missing.map((f) => ({ path: 'feature', message: f })),
      });
    }
    if (this.reflector.getAllAndOverride<boolean>(OWN_HIERARCHY_RULES, targets)) return true;

    const declared = this.reflector.getAllAndOverride<WorkspaceAction | undefined>(REQUIRED_ACTION, targets);
    const checks: { feature: (typeof features)[number]; action: WorkspaceAction }[] = [];
    for (const p of permissions) {
      const f = PERMISSION_FEATURE[p] ?? RESOURCE_FEATURE[p.split(':')[0]!];
      if (f) checks.push({ feature: f, action: declared ?? actionFor(p, req.method) });
    }
    for (const f of explicit ? [explicit, ...also] : also) checks.push({ feature: f, action: declared ?? actionFor(permissions[0] ?? null, req.method) });
    // Anything that asks for the password destroys data, so it also needs the workspace's Delete action (W2), whatever
    // the route's HTTP method or permission says (a bulk delete is a POST, a configuration delete asks for manage).
    const confirm = this.reflector.getAllAndOverride<ConfirmPasswordRule | undefined>(CONFIRMS_PASSWORD, targets);
    if (confirm && confirm.deletes !== false && (!confirm.when || confirm.when(req))) for (const f of features) checks.push({ feature: f, action: 'delete' });
    const refused = checks.find((c) => !actionAllowed(access.actions, c.feature, c.action));
    if (refused) {
      throw new ForbiddenException({
        code: 'ACTION_NOT_GRANTED',
        message: `Your workspace may not ${WORKSPACE_ACTION_LABEL[refused.action].toLowerCase()} in ${FEATURE_BY_KEY[refused.feature].label}.`,
        details: [{ path: 'action', message: `${refused.feature}:${refused.action}` }],
      });
    }
    return true;
  }
}
