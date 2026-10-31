import { Inject, Injectable, Logger } from '@nestjs/common';
import type { SsoErrorCode } from '@dealflow/types';
import { AuditService } from '../audit/audit.service';
import { type IssuedTokens, AuthService } from '../auth/auth.service';
import { PasswordService } from '../auth/password.service';
import { entitlementsFor } from '../billing/entitlements';
import type { RequestMeta } from '../common/auth-context';
import { SECRET_BOX, type SecretBox, signToken, verifyToken } from '../common/crypto';
import { API_ENV, type ApiEnv } from '../common/env';
import { PrismaService } from '../common/prisma.service';
import { authorizationRequest, discover, exchangeCode, OidcError } from './oidc';
import { SecurityService } from './security.service';

export class SsoFailure extends Error {
  constructor(
    readonly code: SsoErrorCode,
    detail?: string,
  ) {
    super(detail ?? code);
  }
}

/** Contents of the signed, short-lived `df_sso` cookie that ties the callback to the browser that started it. */
interface SsoState {
  t: string; // tenant
  c: string; // connection
  s: string; // state
  n: string; // nonce
  v: string; // PKCE verifier
  exp: number;
}

export const SSO_STATE_TTL_MS = 10 * 60_000;

@Injectable()
export class SsoService {
  private readonly logger = new Logger(SsoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
    private readonly security: SecurityService,
    @Inject(SECRET_BOX) private readonly box: SecretBox,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  private get stateSecret(): string {
    return `${this.env.JWT_ACCESS_SECRET}:sso-state`;
  }

  /** Looks up an enabled connection by its public sign-in name, without a tenant context (narrow RLS policy). */
  private async connectionBySlug(loginSlug: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.sso_login_slug', ${loginSlug}, true)`;
      return tx.ssoConnection.findFirst({ where: { loginSlug, enabled: true } });
    });
  }

  /** Starts a sign-in: returns the identity provider URL to redirect to, and the signed state for the cookie. */
  async start(loginSlug: string, loginHint?: string): Promise<{ url: string; cookie: string }> {
    const conn = await this.connectionBySlug(loginSlug.trim().toLowerCase());
    if (!conn) throw new SsoFailure('unknown_workspace');
    const entitled = await this.prisma.run({ tenantId: conn.tenantId }, (tx) => entitlementsFor(tx, conn.tenantId));
    if (!entitled.entitlements.sso) throw new SsoFailure('not_entitled');
    let meta;
    try {
      meta = await discover(conn.issuer, this.env.ALLOW_PRIVATE_NETWORK_TARGETS);
    } catch (e) {
      throw new SsoFailure('provider_error', (e as Error).message);
    }
    const req = authorizationRequest(meta, conn.clientId, this.security.redirectUri, loginHint);
    const state: SsoState = { t: conn.tenantId, c: conn.id, s: req.state, n: req.nonce, v: req.codeVerifier, exp: Date.now() + SSO_STATE_TTL_MS };
    return { url: req.url, cookie: signToken(this.stateSecret, state) };
  }

  /**
   * Finishes a sign-in. The session it opens is bound to this workspace (it cannot switch to the person's
   * other workspaces), because the workspace's own administrators control what its identity provider asserts.
   */
  async callback(query: { code?: string; state?: string; error?: string }, cookie: string | undefined, meta: RequestMeta): Promise<IssuedTokens> {
    const st = cookie ? verifyToken<SsoState>(this.stateSecret, cookie) : null;
    if (!st || st.exp < Date.now()) throw new SsoFailure('expired');
    if (!query.state || query.state !== st.s) throw new SsoFailure('invalid_response', 'state mismatch');
    if (query.error || !query.code) throw new SsoFailure('provider_error', query.error ?? 'no code');

    const conn = await this.prisma.run({ tenantId: st.t }, (tx) => tx.ssoConnection.findUnique({ where: { id: st.c } }));
    if (!conn || !conn.enabled) throw new SsoFailure('unknown_workspace');

    let identity;
    try {
      const providerMeta = await discover(conn.issuer, this.env.ALLOW_PRIVATE_NETWORK_TARGETS);
      identity = await exchangeCode(providerMeta, { clientId: conn.clientId, clientSecret: this.box.open(conn.clientSecretEnc) }, {
        code: query.code, redirectUri: this.security.redirectUri, codeVerifier: st.v, nonce: st.n,
      });
    } catch (e) {
      if (e instanceof OidcError) throw new SsoFailure(e.reason === 'invalid_response' ? 'invalid_response' : 'provider_error', e.message);
      throw e;
    }
    const domain = identity.email.split('@')[1]!;
    if (conn.allowedDomains.length > 0 && !conn.allowedDomains.includes(domain)) throw new SsoFailure('domain_not_allowed', domain);

    const tenantId = conn.tenantId;
    const linked = await this.prisma.run({ tenantId }, (tx) => tx.ssoIdentity.findUnique({ where: { connectionId_subject: { connectionId: conn.id, subject: identity.subject } } }));
    let userId = linked?.userId;
    if (!userId) {
      const existing = await this.prisma.user.findUnique({ where: { email: identity.email } });
      userId = existing?.id;
    }

    const result = await this.prisma.run({ tenantId, userId }, async (tx) => {
      const ent = await entitlementsFor(tx, tenantId);
      if (!ent.entitlements.sso) throw new SsoFailure('not_entitled');
      let membership = userId ? await tx.membership.findUnique({ where: { tenantId_userId: { tenantId, userId } } }) : null;
      if (membership && membership.status !== 'ACTIVE') throw new SsoFailure('suspended');
      let joinedVia: 'invitation' | 'jit' | null = null;
      if (!membership) {
        const invitation = await tx.invitation.findFirst({ where: { tenantId, email: identity.email, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } } });
        const roleId = invitation?.roleId ?? (conn.jitProvisioning ? conn.defaultRoleId : null);
        if (!roleId) throw new SsoFailure('not_invited', identity.email);
        if (ent.seatLimit !== null && (await tx.membership.count({ where: { tenantId, status: 'ACTIVE' } })) >= ent.seatLimit) throw new SsoFailure('no_seats');
        if (!userId) {
          const user = await tx.user.create({ data: { email: identity.email, name: identity.name ?? identity.email.split('@')[0]!, passwordHash: PasswordService.UNUSABLE, emailVerifiedAt: new Date() } });
          userId = user.id;
          await tx.$executeRaw`SELECT set_config('app.user_id', ${userId}, true)`;
        }
        membership = await tx.membership.create({ data: { tenantId, userId, roleId } });
        if (invitation) await tx.invitation.update({ where: { id: invitation.id }, data: { acceptedAt: new Date() } });
        joinedVia = invitation ? 'invitation' : 'jit';
      }
      await tx.ssoIdentity.upsert({
        where: { connectionId_subject: { connectionId: conn.id, subject: identity.subject } },
        create: { tenantId, connectionId: conn.id, userId: userId!, subject: identity.subject },
        update: { lastLoginAt: new Date() },
      });
      await tx.ssoConnection.update({ where: { id: conn.id }, data: { lastVerifiedAt: new Date() } });
      if (joinedVia) {
        await this.audit.record(tx, { tenantId, actorUserId: userId!, action: 'member.joined', entityType: 'membership', entityId: membership.id, metadata: { email: identity.email, via: `sso_${joinedVia}` }, meta });
      }
      await this.audit.record(tx, { tenantId, actorUserId: userId!, action: 'auth.login', entityType: 'user', entityId: userId!, metadata: { method: 'sso', issuer: conn.issuer }, meta });
      return { userId: userId! };
    });

    await this.prisma.user.update({ where: { id: result.userId }, data: { lastLoginAt: new Date() } });
    this.logger.log({ tenantId, requestId: meta.requestId }, 'Single sign-on completed');
    return this.auth.startSession(result.userId, tenantId, meta, { authMethod: 'sso', ssoTenantId: tenantId });
  }
}
