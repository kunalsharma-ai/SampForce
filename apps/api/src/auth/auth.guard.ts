import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { API_KEY_PREFIX, EXTENSION_SCOPES, EXTENSION_TOKEN_PREFIX } from '@dealflow/types';
import { createHash } from 'node:crypto';
import {
  ALLOW_RESTRICTED,
  API_KEY_ACCESS,
  type AuthContext,
  EXTENSION_ACCESS,
  type AuthedRequest,
  IS_PUBLIC,
  REQUIRED_PERMISSIONS,
} from '../common/auth-context';
import { featureNotIncluded, hasFeature, ssoEnforcedNow } from '../billing/entitlements';
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
    const extensionToken = header?.startsWith(`Bearer ${EXTENSION_TOKEN_PREFIX}`) ? header.slice(7) : undefined;
    const apiKey = header?.startsWith(`Bearer ${API_KEY_PREFIX}`) ? header.slice(7) : undefined;
    // An extension token or API key is used on its own, never alongside the cookie: the origin check lets it
    // through, so it must not carry the person's web session with it.
    const raw: string | undefined = extensionToken || apiKey ? undefined :
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
        const ssoRequired = tenant.ssoEnforced && claims.amr !== 'sso' && membership.role.key !== 'owner' && (await ssoEnforcedNow(this.prisma, claims.tid, true));
        const restriction =
          ssoRequired
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

    if (extensionToken) req.auth = await this.extensionAuth(extensionToken);
    if (apiKey) {
      req.auth = await this.apiKeyAuth(apiKey);
      if (!req.auth && !isPublic) throw new UnauthorizedException({ code: 'INVALID_API_KEY', message: 'This API key is not valid, has expired or was revoked.' });
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

    if (req.auth.via === 'extension' && !this.reflector.getAllAndOverride<boolean>(EXTENSION_ACCESS, targets)) {
      throw new ForbiddenException({ code: 'EXTENSION_NOT_ALLOWED', message: 'The browser extension cannot do this. Use SampForce in your browser.' });
    }

    if (req.auth.via === 'api_key' && !this.reflector.getAllAndOverride<boolean>(API_KEY_ACCESS, targets)) {
      throw new ForbiddenException({ code: 'API_KEY_NOT_ALLOWED', message: 'API keys cannot do this. Sign in to SampForce in your browser.' });
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

  /**
   * A workspace API key: acts as the person who created it, limited to the key's scopes and that person's current
   * role, in the key's workspace only. Revoked, expired, or a creator who left: no access.
   */
  private async apiKeyAuth(key: string): Promise<AuthContext | undefined> {
    if (!/^dfk_[A-Za-z0-9_-]{30,80}$/.test(key)) return undefined;
    const hash = createHash('sha256').update(key).digest('hex');
    const row = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.api_key_hash', ${hash}, true)`;
      return tx.apiKey.findUnique({ where: { keyHash: hash } });
    });
    if (!row || row.revokedAt || (row.expiresAt && row.expiresAt <= new Date())) return undefined;
    const membership = await this.prisma.run({ tenantId: row.tenantId, userId: row.createdById }, (tx) =>
      tx.membership.findFirst({
        where: { tenantId: row.tenantId, userId: row.createdById, status: 'ACTIVE', tenant: { status: 'ACTIVE', deletedAt: null }, user: { status: 'ACTIVE' } },
        include: { role: true },
      }),
    );
    if (!membership) return undefined;
    // API keys work only while the plan includes API access (ADR 0057); the key itself is kept.
    if (!(await this.prisma.run({ tenantId: row.tenantId }, (tx) => hasFeature(tx, row.tenantId, 'api_access')))) throw featureNotIncluded('api_access');
    if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 60_000) {
      await this.prisma.run({ tenantId: row.tenantId }, (tx) => tx.apiKey.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } }));
    }
    const scopes = new Set(row.scopes);
    return {
      userId: row.createdById,
      tenantId: row.tenantId,
      sessionId: row.id,
      membershipId: membership.id,
      roleKey: membership.role.key,
      permissions: membership.role.permissions.filter((p) => scopes.has(p)),
      authMethod: 'password',
      via: 'api_key',
    };
  }

  /** A browser extension connection: a session of its own, limited to the extension scopes. */
  private async extensionAuth(token: string): Promise<AuthContext | undefined> {
    const hash = createHash('sha256').update(token).digest('hex');
    const session = await this.prisma.session.findUnique({ where: { extensionTokenHash: hash } });
    if (!session || session.revokedAt || session.expiresAt <= new Date()) return undefined;
    if (session.ssoTenantId && session.ssoTenantId !== session.activeTenantId) return undefined;
    const membership = await this.prisma.run({ tenantId: session.activeTenantId, userId: session.userId }, (tx) =>
      tx.membership.findFirst({
        where: { tenantId: session.activeTenantId, userId: session.userId, status: 'ACTIVE', tenant: { status: 'ACTIVE', deletedAt: null }, user: { status: 'ACTIVE' } },
        include: { role: true, tenant: { select: { requireMfa: true, ssoEnforced: true } } },
      }),
    );
    if (!membership) return undefined;
    const method = (['password', 'mfa', 'sso'].includes(session.authMethod) ? session.authMethod : 'password') as AuthContext['authMethod'];
    const { tenant } = membership;
    const ssoRequired = tenant.ssoEnforced && method !== 'sso' && membership.role.key !== 'owner' && (await ssoEnforcedNow(this.prisma, session.activeTenantId, true));
    const restriction =
      ssoRequired ? 'sso_required' : tenant.requireMfa && method === 'password' ? 'mfa_enrolment' : undefined;
    // Record use at most once a minute.
    if (!session.lastUsedAt || Date.now() - session.lastUsedAt.getTime() > 60_000) {
      await this.prisma.session.update({ where: { id: session.id }, data: { lastUsedAt: new Date() } });
    }
    const scopes = new Set<string>(EXTENSION_SCOPES);
    return {
      userId: session.userId,
      tenantId: session.activeTenantId,
      sessionId: session.id,
      membershipId: membership.id,
      roleKey: membership.role.key,
      permissions: membership.role.permissions.filter((p) => scopes.has(p)),
      authMethod: method,
      via: 'extension',
      ...(session.ssoTenantId ? { ssoTenantId: session.ssoTenantId } : {}),
      ...(restriction ? { restriction } : {}),
    };
  }
}
