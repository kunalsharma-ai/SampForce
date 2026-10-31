import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  ALLOW_RESTRICTED,
  type AuthedRequest,
  IS_PUBLIC,
  REQUIRED_PERMISSIONS,
} from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { ACCESS_COOKIE } from './cookies';
import { TokenService } from './token.service';

/**
 * Global guard: authenticates the access token, re-checks the membership in the token's
 * tenant on every request (so removed members lose access immediately), then enforces any
 * @RequirePermissions metadata.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets);

    const header = req.get('authorization');
    const raw: string | undefined =
      (req.cookies as Record<string, string> | undefined)?.[ACCESS_COOKIE] ??
      (header?.startsWith('Bearer ') ? header.slice(7) : undefined);

    const verified = raw ? await this.tokens.verifyAccess(raw) : null;
    // A single sign-on session never acts outside the workspace that signed it in.
    const claims = verified && (!verified.stid || verified.stid === verified.tid) ? verified : null;
    if (claims) {
      const [session, membership] = await Promise.all([
        // Signed-out sessions stop working at once. A session replaced by refresh rotation is not a sign-out;
        // access tokens minted from it simply expire on schedule.
        this.prisma.session.findUnique({
          where: { id: claims.sid },
          select: { revokedAt: true, replacedById: true, expiresAt: true },
        }),
        this.prisma.run({ tenantId: claims.tid, userId: claims.sub }, (tx) =>
          tx.membership.findFirst({
            where: {
              tenantId: claims.tid,
              userId: claims.sub,
              status: 'ACTIVE',
              tenant: { status: 'ACTIVE', deletedAt: null },
              user: { status: 'ACTIVE' },
            },
            include: {
              role: true,
              tenant: {
                select: { requireMfa: true, ssoEnforced: true },
              },
            },
          }),
        ),
      ]);
      const sessionLive =
        !!session &&
        session.expiresAt > new Date() &&
        (!session.revokedAt || !!session.replacedById);
      if (membership && sessionLive) {
        const { tenant } = membership;
        const restriction =
          tenant.ssoEnforced && claims.amr !== 'sso' && membership.role.key !== 'owner'
            ? 'sso_required'
            : tenant.requireMfa && claims.amr === 'password'
              ? 'mfa_enrolment'
              : undefined;
        req.auth = {
          userId: claims.sub,
          tenantId: claims.tid,
          sessionId: claims.sid,
          membershipId: membership.id,
          roleKey: membership.role.key,
          permissions: membership.role.permissions,
          authMethod: claims.amr,
          ...(claims.stid ? { ssoTenantId: claims.stid } : {}),
          ...(restriction ? { restriction } : {}),
        };
      }
    }

    if (isPublic) return true;
    if (!req.auth) {
      throw new UnauthorizedException({ code: 'UNAUTHENTICATED', message: 'Sign in to continue.' });
    }
    if (
      req.auth.restriction &&
      !this.reflector.getAllAndOverride<boolean>(ALLOW_RESTRICTED, targets)
    ) {
      throw new ForbiddenException(
        req.auth.restriction === 'sso_required'
          ? {
              code: 'SSO_REQUIRED',
              message:
                'This workspace requires single sign-on. Sign in through your identity provider.',
            }
          : {
              code: 'MFA_REQUIRED',
              message: 'This workspace requires two-step verification. Turn it on to continue.',
            },
      );
    }

    const required =
      this.reflector.getAllAndOverride<string[]>(REQUIRED_PERMISSIONS, targets) ?? [];
    const missing = required.filter((p) => !req.auth!.permissions.includes(p));
    if (missing.length > 0) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Your role does not allow this action.',
        details: missing.map((p) => ({ path: 'permission', message: p })),
      });
    }
    return true;
  }
}
