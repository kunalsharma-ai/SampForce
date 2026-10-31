import { createHash, randomBytes } from 'node:crypto';
import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type TenantTx } from '@dealflow/database';
import type { ScimTokenView, SecuritySettings, SsoConnectionInput, SsoConnectionView } from '@dealflow/types';
import { AuditService } from '../audit/audit.service';
import { entitlementsFor, planLimit } from '../billing/entitlements';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { SECRET_BOX, type SecretBox } from '../common/crypto';
import { API_ENV, type ApiEnv } from '../common/env';
import { PrismaService } from '../common/prisma.service';
import { discover, OidcError } from './oidc';

export const SCIM_TOKEN_PREFIX = 'dfscim_';

export function hashScimToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

const NOT_ENTITLED = 'Single sign-on and SCIM provisioning are included in the Enterprise plans.';

/** Workspace security settings: the two-step verification policy, the SSO connection and SCIM tokens. */
@Injectable()
export class SecurityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(SECRET_BOX) private readonly box: SecretBox,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  get redirectUri(): string {
    return `${this.env.PUBLIC_WEB_URL.replace(/\/$/, '')}/api/v1/auth/sso/callback`;
  }

  async settings(auth: AuthContext): Promise<SecuritySettings> {
    return this.prisma.run(auth, async (tx) => {
      const [tenant, conn, tokens, ent, caller] = await Promise.all([
        tx.tenant.findUniqueOrThrow({ where: { id: auth.tenantId }, select: { requireMfa: true } }),
        tx.ssoConnection.findUnique({ where: { tenantId: auth.tenantId } }),
        tx.scimToken.findMany({ where: { tenantId: auth.tenantId, revokedAt: null }, orderBy: { createdAt: 'desc' } }),
        entitlementsFor(tx, auth.tenantId),
        this.prisma.user.findUniqueOrThrow({ where: { id: auth.userId }, select: { mfaEnabledAt: true } }),
      ]);
      const ssoUsers = await tx.ssoIdentity.findMany({ where: { tenantId: auth.tenantId }, select: { userId: true } });
      const membersWithoutMfa = await tx.membership.count({
        where: { tenantId: auth.tenantId, status: 'ACTIVE', user: { mfaEnabledAt: null }, userId: { notIn: ssoUsers.map((s) => s.userId) } },
      });
      return {
        requireMfa: tenant.requireMfa,
        membersWithoutMfa,
        callerHasMfa: !!caller.mfaEnabledAt || auth.authMethod === 'sso',
        ssoEntitled: ent.entitlements.sso,
        sso: conn ? this.view(conn) : null,
        redirectUri: this.redirectUri,
        scimBaseUrl: `${this.env.PUBLIC_WEB_URL.replace(/\/$/, '')}/api/v1/scim/v2`,
        scimTokens: tokens.map((t): ScimTokenView => ({ id: t.id, name: t.name, prefix: t.prefix, createdAt: t.createdAt.toISOString(), lastUsedAt: t.lastUsedAt?.toISOString() ?? null })),
      };
    });
  }

  /** Requiring a second factor is refused until the admin has one, so they cannot lock themselves out of the setting. */
  async setMfaPolicy(auth: AuthContext, requireMfa: boolean, meta: RequestMeta): Promise<void> {
    if (requireMfa && auth.authMethod !== 'sso') {
      const me = await this.prisma.user.findUniqueOrThrow({ where: { id: auth.userId }, select: { mfaEnabledAt: true } });
      if (!me.mfaEnabledAt) throw new BadRequestException({ code: 'MFA_NOT_ENABLED', message: 'Turn on two-step verification for your own account first.' });
    }
    await this.prisma.run(auth, async (tx) => {
      await tx.tenant.update({ where: { id: auth.tenantId }, data: { requireMfa } });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'security.mfa_policy_changed', entityType: 'tenant', entityId: auth.tenantId, metadata: { requireMfa }, meta });
    });
  }

  async saveSso(auth: AuthContext, input: SsoConnectionInput, meta: RequestMeta): Promise<SsoConnectionView> {
    return this.prisma.run(auth, async (tx) => {
      if (!(await entitlementsFor(tx, auth.tenantId)).entitlements.sso) throw planLimit(NOT_ENTITLED);
      const existing = await tx.ssoConnection.findUnique({ where: { tenantId: auth.tenantId } });
      const secret = input.clientSecret?.trim();
      if (!existing && !secret) throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Enter the client secret.', details: [{ path: 'clientSecret', message: 'Enter the client secret' }] });
      if (input.defaultRoleId) await this.assertAssignableRole(tx, input.defaultRoleId);
      // Kept exactly as entered: ID tokens must carry this exact issuer string (some providers end it with '/').
      const issuer = input.issuer;
      if (input.enabled) {
        try {
          await discover(issuer, this.env.ALLOW_PRIVATE_NETWORK_TARGETS, true);
        } catch (e) {
          throw new BadRequestException({ code: 'SSO_DISCOVERY_FAILED', message: e instanceof OidcError ? e.message : 'The identity provider could not be checked.' });
        }
      }
      const changedProvider = !!existing && (existing.issuer !== issuer || existing.clientId !== input.clientId);
      const verified = existing?.lastVerifiedAt && !changedProvider ? existing.lastVerifiedAt : null;
      if (input.enforced && !verified) {
        throw new BadRequestException({ code: 'SSO_NOT_VERIFIED', message: 'Sign in once with single sign-on before requiring it, so you know it works.' });
      }
      const data = {
        loginSlug: input.loginSlug,
        issuer,
        clientId: input.clientId,
        allowedDomains: [...new Set(input.allowedDomains)],
        jitProvisioning: input.jitProvisioning,
        defaultRoleId: input.defaultRoleId,
        enabled: input.enabled,
        enforced: input.enforced,
        lastVerifiedAt: verified,
        ...(secret ? { clientSecretEnc: this.box.seal(secret) } : {}),
      };
      let conn;
      try {
        conn = existing
          ? await tx.ssoConnection.update({ where: { tenantId: auth.tenantId }, data })
          : await tx.ssoConnection.create({ data: { ...data, tenantId: auth.tenantId, clientSecretEnc: this.box.seal(secret!) } });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          throw new ConflictException({ code: 'LOGIN_SLUG_TAKEN', message: 'That sign-in name is already used. Choose another.', details: [{ path: 'loginSlug', message: 'Already used' }] });
        }
        throw e;
      }
      await tx.tenant.update({ where: { id: auth.tenantId }, data: { ssoEnforced: conn.enabled && conn.enforced } });
      await this.audit.record(tx, {
        tenantId: auth.tenantId, actorUserId: auth.userId, action: existing ? 'security.sso_updated' : 'security.sso_created', entityType: 'sso_connection', entityId: conn.id,
        metadata: { issuer, enabled: conn.enabled, enforced: conn.enforced, jitProvisioning: conn.jitProvisioning, secretChanged: !!secret }, meta,
      });
      return this.view(conn);
    });
  }

  async deleteSso(auth: AuthContext, meta: RequestMeta): Promise<void> {
    await this.prisma.run(auth, async (tx) => {
      const conn = await tx.ssoConnection.findUnique({ where: { tenantId: auth.tenantId } });
      if (!conn) return;
      await tx.ssoConnection.delete({ where: { id: conn.id } });
      await tx.tenant.update({ where: { id: auth.tenantId }, data: { ssoEnforced: false } });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'security.sso_deleted', entityType: 'sso_connection', entityId: conn.id, meta });
    });
  }

  async createScimToken(auth: AuthContext, name: string, meta: RequestMeta): Promise<ScimTokenView & { token: string }> {
    return this.prisma.run(auth, async (tx) => {
      if (!(await entitlementsFor(tx, auth.tenantId)).entitlements.sso) throw planLimit(NOT_ENTITLED);
      if ((await tx.scimToken.count({ where: { tenantId: auth.tenantId, revokedAt: null } })) >= 5) {
        throw new BadRequestException({ code: 'TOO_MANY_TOKENS', message: 'A workspace can have five SCIM tokens. Revoke one first.' });
      }
      const token = `${SCIM_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
      const row = await tx.scimToken.create({ data: { tenantId: auth.tenantId, name, tokenHash: hashScimToken(token), prefix: token.slice(0, 12), createdById: auth.userId } });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'security.scim_token_created', entityType: 'scim_token', entityId: row.id, metadata: { name }, meta });
      return { id: row.id, name: row.name, prefix: row.prefix, createdAt: row.createdAt.toISOString(), lastUsedAt: null, token };
    });
  }

  async revokeScimToken(auth: AuthContext, id: string, meta: RequestMeta): Promise<void> {
    await this.prisma.run(auth, async (tx) => {
      const { count } = await tx.scimToken.updateMany({ where: { id, tenantId: auth.tenantId, revokedAt: null }, data: { revokedAt: new Date() } });
      if (count === 0) throw new NotFoundException({ code: 'NOT_FOUND', message: 'That token was not found or is already revoked.' });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'security.scim_token_revoked', entityType: 'scim_token', entityId: id, meta });
    });
  }

  /** People provisioned automatically never become owners. */
  private async assertAssignableRole(tx: TenantTx, roleId: string): Promise<void> {
    const role = await tx.role.findUnique({ where: { id: roleId } });
    if (!role || role.key === 'owner') {
      throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Choose a role other than Owner.', details: [{ path: 'defaultRoleId', message: 'Choose a role other than Owner' }] });
    }
  }

  private view(c: { loginSlug: string; issuer: string; clientId: string; clientSecretEnc: string; allowedDomains: string[]; jitProvisioning: boolean; defaultRoleId: string | null; enabled: boolean; enforced: boolean; lastVerifiedAt: Date | null }): SsoConnectionView {
    return {
      loginSlug: c.loginSlug, issuer: c.issuer, clientId: c.clientId, hasClientSecret: !!c.clientSecretEnc, allowedDomains: c.allowedDomains,
      jitProvisioning: c.jitProvisioning, defaultRoleId: c.defaultRoleId, enabled: c.enabled, enforced: c.enforced, lastVerifiedAt: c.lastVerifiedAt?.toISOString() ?? null,
    };
  }
}
