import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ALSO_REQUIRED_FEATURES, type AuthedRequest, type FeatureSelector, REQUIRED_FEATURE } from '../common/auth-context';
import type { FeatureKey } from '@dealflow/types';
import { PrismaService } from '../common/prisma.service';
import { entitlementsFor, featureNotIncluded } from './entitlements';

/**
 * Global guard, after AuthGuard: a route marked @RequireFeature works only while the signed-in workspace's plan
 * (with the operator's overrides for it) includes that feature (ADR 0057). Public routes resolve their workspace
 * themselves and call assertFeature; this guard only sees routes with a signed-in caller.
 */
@Injectable()
export class FeatureGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true;
    const targets = [ctx.getHandler(), ctx.getClass()];
    const selector = this.reflector.getAllAndOverride<FeatureSelector | undefined>(REQUIRED_FEATURE, targets);
    const also = this.reflector.getAllAndMerge<FeatureKey[]>(ALSO_REQUIRED_FEATURES, targets) ?? [];
    if (!selector && !also.length) return true;
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const feature = typeof selector === 'function' ? selector(req) : selector;
    const needed = [...(feature ? [feature] : []), ...also];
    if (!needed.length || !req.auth) return true;
    const { tenantId } = req.auth;
    const ent = await this.prisma.run({ tenantId }, (tx) => entitlementsFor(tx, tenantId));
    const missing = needed.find((f) => !ent.features.includes(f));
    if (missing) throw featureNotIncluded(missing);
    return true;
  }
}
