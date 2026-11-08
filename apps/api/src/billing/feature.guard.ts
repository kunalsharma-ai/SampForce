import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { type AuthedRequest, type FeatureSelector, REQUIRED_FEATURE } from '../common/auth-context';
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
    const selector = this.reflector.getAllAndOverride<FeatureSelector | undefined>(REQUIRED_FEATURE, [ctx.getHandler(), ctx.getClass()]);
    if (!selector) return true;
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const feature = typeof selector === 'function' ? selector(req) : selector;
    if (!feature || !req.auth) return true;
    const { tenantId } = req.auth;
    const ent = await this.prisma.run({ tenantId }, (tx) => entitlementsFor(tx, tenantId));
    if (!ent.features.includes(feature)) throw featureNotIncluded(feature);
    return true;
  }
}
