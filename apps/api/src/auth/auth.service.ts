import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma, provisionTenant, slugify } from '@dealflow/database';
import {
  type AcceptInvitationInput,
  type InvitationPreview,
  type LoginInput,
  type MeResponse,
  type MembershipSummary,
  passwordSchema,
  type RegisterInput,
  type SessionSummary,
} from '@dealflow/types';
import { entitlementsFor } from '../billing/entitlements';
import { AuditService } from '../audit/audit.service';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { API_ENV, type ApiEnv } from '../common/env';
import { PrismaService } from '../common/prisma.service';
import { MAIL_NOT_CONFIGURED, MailerService } from '../mail/mailer.service';
import { authEvents } from '../observability/metrics';
import { MfaService } from './mfa.service';
import { PasswordService } from './password.service';
import { type AuthMethod, TokenService } from './token.service';

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  tenantId: string;
  userId: string;
}

/** Password sign-in found a second factor: no session yet, only a challenge for POST /auth/mfa/verify. */
export interface MfaChallenge {
  mfaRequired: true;
  challenge: string;
}

/** How a session signed in decides which workspaces it may enter. */
export interface SessionScope {
  authMethod: AuthMethod;
  ssoTenantId?: string | null;
}

const SSO_REQUIRED = {
  code: 'SSO_REQUIRED',
  message: 'Your workspace requires single sign-on. Use “Sign in with SSO” and your workspace’s sign-in name.',
};

const INVITATION_INVALID = {
  code: 'INVITATION_INVALID',
  message: 'This invitation link is invalid, has expired or was already used. Ask for a new invitation.',
};

const RESET_INVALID = {
  code: 'RESET_LINK_INVALID',
  message: 'This reset link is invalid, has expired or was already used. Ask for a new one.',
};

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

const INVALID_CREDENTIALS = {
  code: 'INVALID_CREDENTIALS',
  message: 'The email or password is incorrect.',
};

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
    private readonly mfa: MfaService,
    private readonly mailer: MailerService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  // ───── Password reset ─────

  /**
   * Emails a one-time reset link. The answer is the same whether or not the address has an account, and at most
   * three links go to one account an hour. Accounts without a password (single sign-on) get no link.
   */
  async requestPasswordReset(email: string, meta: RequestMeta): Promise<void> {
    if (!this.mailer.configured) throw new ServiceUnavailableException(MAIL_NOT_CONFIGURED);
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || user.status !== 'ACTIVE' || !PasswordService.usable(user.passwordHash)) {
      // Same work as a real request, so timing does not reveal who has an account.
      await this.passwords.verify(null, email);
      this.logger.log({ requestId: meta.requestId }, 'Password reset asked for an address with no usable account');
      return;
    }
    const recent = await this.prisma.passwordResetToken.count({ where: { userId: user.id, createdAt: { gte: new Date(Date.now() - 3_600_000) } } });
    if (recent >= 3) {
      this.logger.warn({ userId: user.id, requestId: meta.requestId }, 'Password reset limit reached');
      return;
    }
    const token = randomBytes(32).toString('base64url');
    const minutes = this.env.PASSWORD_RESET_TTL_MINUTES;
    await this.prisma.$transaction([
      // Only the newest link works.
      this.prisma.passwordResetToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } }),
      this.prisma.passwordResetToken.create({ data: { userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + minutes * 60_000) } }),
    ]);
    const link = `${this.env.PUBLIC_WEB_URL.replace(/\/+$/, '')}/reset-password#token=${token}`;
    await this.mailer.send({
      to: user.email,
      subject: 'Reset your DealFlow password',
      text: [
        `Hi ${user.name},`,
        '',
        'Someone asked to reset the password for your DealFlow account. To choose a new password, open this link:',
        '',
        link,
        '',
        `The link works once and expires in ${minutes} minutes. If you did not ask for this, ignore this email: your password has not changed.`,
        '',
        'DealFlow',
      ].join('\n'),
    });
    await this.auditForUser(user.id, 'auth.password_reset_requested', meta);
    authEvents.inc({ event: 'password_reset_requested' });
  }

  /**
   * Sets a new password from a reset link, then signs the person out everywhere and clears any sign-in lock.
   * Two-step verification stays on. The person signs in again with the new password.
   */
  async resetPassword(token: string, password: string, meta: RequestMeta): Promise<void> {
    const row = await this.prisma.passwordResetToken.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
    if (!row || row.usedAt || row.expiresAt < new Date() || row.user.status !== 'ACTIVE') {
      authEvents.inc({ event: 'password_reset_invalid' });
      throw new BadRequestException(RESET_INVALID);
    }
    const passwordHash = await this.passwords.hash(password);
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.passwordResetToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
      if (claimed.count !== 1) throw new BadRequestException(RESET_INVALID);
      await tx.passwordResetToken.updateMany({ where: { userId: row.userId, usedAt: null }, data: { usedAt: new Date() } });
      await tx.user.update({ where: { id: row.userId }, data: { passwordHash, failedLoginCount: 0, lockedUntil: null } });
      await tx.session.updateMany({ where: { userId: row.userId, revokedAt: null }, data: { revokedAt: new Date() } });
    });
    await this.auditForUser(row.userId, 'auth.password_reset', meta);
    authEvents.inc({ event: 'password_reset' });
    // Tell the account owner, in case it was not them. A failure here does not undo the reset.
    await this.mailer
      .send({
        to: row.user.email,
        subject: 'Your DealFlow password was changed',
        text: `Hi ${row.user.name},\n\nThe password for your DealFlow account was just changed with a reset link, and every device was signed out.\n\nIf this was not you, contact your workspace administrator straight away.\n\nDealFlow`,
      })
      .catch(() => undefined);
  }

  /** Records an account-level event in the audit log of every workspace the person belongs to. */
  private async auditForUser(userId: string, action: string, meta: RequestMeta): Promise<void> {
    for (const m of await this.listMemberships(userId)) {
      await this.prisma.run({ tenantId: m.tenantId }, (tx) => this.audit.record(tx, { tenantId: m.tenantId, actorUserId: userId, action, entityType: 'user', entityId: userId, meta }));
    }
  }

  async register(input: RegisterInput, meta: RequestMeta): Promise<IssuedTokens> {
    const passwordHash = await this.passwords.hash(input.password);
    const tenantId = randomUUID();
    // Slugs carry a random suffix: tenants are invisible to each other under RLS, so we
    // cannot (and must not) probe whether another workspace already uses a name.
    const slug = `${slugify(input.organizationName)}-${randomBytes(3).toString('hex')}`;

    try {
      const userId = await this.prisma.run({ tenantId }, async (tx) => {
        const user = await tx.user.create({
          data: { email: input.email, name: input.name, passwordHash, lastLoginAt: new Date() },
        });
        await tx.$executeRaw`SELECT set_config('app.user_id', ${user.id}, true)`;
        await provisionTenant(tx, {
          tenantId,
          name: input.organizationName,
          slug,
          ownerUserId: user.id,
        });
        await this.audit.record(tx, {
          tenantId,
          actorUserId: user.id,
          action: 'tenant.created',
          entityType: 'tenant',
          entityId: tenantId,
          metadata: { name: input.organizationName, plan: 'free' },
          meta,
        });
        return user.id;
      });
      return this.startSession(userId, tenantId, meta, { authMethod: 'password' });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException({
          code: 'EMAIL_IN_USE',
          message: 'An account with this email already exists. Sign in instead.',
        });
      }
      throw err;
    }
  }

  /**
   * Password sign-in. Ten failures in a row (password or second factor) pause sign-in for 15 minutes; while
   * paused the answer is the same generic error, so it does not reveal whether the email has an account.
   */
  async login(input: LoginInput, meta: RequestMeta): Promise<IssuedTokens | MfaChallenge> {
    const user = await this.checkPassword(input, meta);
    if (user.mfaEnabledAt) {
      // The failure counter is only reset once the second factor also checks out.
      return { mfaRequired: true, challenge: await this.tokens.signMfaChallenge(user.id) };
    }
    await this.mfa.clearFailures(user.id);
    return this.completeSignIn(user.id, { authMethod: 'password' }, meta);
  }

  /** Second step of a password sign-in: an authenticator code or a recovery code. */
  async verifyMfa(challenge: string, code: string, meta: RequestMeta): Promise<IssuedTokens> {
    const userId = await this.checkSecondFactor(challenge, code, meta);
    return this.completeSignIn(userId, { authMethod: 'mfa' }, meta);
  }

  /**
   * The browser extension signs in with the same password, lockout and second-factor rules, but gets an extension
   * connection instead of a web session (see ExtensionService). SSO-enforced workspaces still need a connection code.
   */
  async extensionSignIn(input: LoginInput, meta: RequestMeta): Promise<{ userId: string; tenantId: string; scope: SessionScope } | MfaChallenge> {
    const user = await this.checkPassword(input, meta);
    if (user.mfaEnabledAt) return { mfaRequired: true, challenge: await this.tokens.signMfaChallenge(user.id) };
    await this.mfa.clearFailures(user.id);
    return this.firstWorkspace(user.id, { authMethod: 'password' }, meta, 'extension');
  }

  async extensionVerifyMfa(challenge: string, code: string, meta: RequestMeta): Promise<{ userId: string; tenantId: string; scope: SessionScope }> {
    const userId = await this.checkSecondFactor(challenge, code, meta);
    return this.firstWorkspace(userId, { authMethod: 'mfa' }, meta, 'extension');
  }

  private async checkPassword(input: LoginInput, meta: RequestMeta) {
    const user = await this.prisma.user.findUnique({ where: { email: input.email } });
    const locked = !!user && this.mfa.isLocked(user);
    const valid = await this.passwords.verify(locked ? null : (user?.passwordHash ?? null), input.password);
    if (!user || !valid || user.status !== 'ACTIVE') {
      if (user && !locked) await this.mfa.recordFailure(user.id, meta.requestId);
      authEvents.inc({ event: 'login_failure' });
      this.logger.warn({ requestId: meta.requestId, ip: meta.ipAddress, locked }, 'Failed sign-in attempt');
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }
    return user;
  }

  private async checkSecondFactor(challenge: string, code: string, meta: RequestMeta): Promise<string> {
    const userId = await this.tokens.verifyMfaChallenge(challenge);
    if (!userId) throw new UnauthorizedException({ code: 'MFA_CHALLENGE_EXPIRED', message: 'The sign-in took too long. Enter your password again.' });
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (this.mfa.isLocked(user) || user.status !== 'ACTIVE' || !(await this.mfa.verifySecondFactor(userId, code))) {
      if (!this.mfa.isLocked(user)) await this.mfa.recordFailure(userId, meta.requestId);
      authEvents.inc({ event: 'mfa_failure' });
      this.logger.warn({ requestId: meta.requestId, ip: meta.ipAddress }, 'Failed second-factor attempt');
      throw new UnauthorizedException({ code: 'INVALID_MFA_CODE', message: 'That code is not valid. Try again, or use a recovery code.' });
    }
    await this.mfa.clearFailures(userId);
    return userId;
  }

  private async completeSignIn(userId: string, scope: SessionScope, meta: RequestMeta): Promise<IssuedTokens> {
    const { tenantId } = await this.firstWorkspace(userId, scope, meta, 'web');
    return this.startSession(userId, tenantId, meta, scope);
  }

  /** The first workspace this sign-in may enter (SSO-enforced workspaces are skipped for non-SSO sign-ins), audited. */
  private async firstWorkspace(userId: string, scope: SessionScope, meta: RequestMeta, client: 'web' | 'extension'): Promise<{ userId: string; tenantId: string; scope: SessionScope }> {
    const memberships = await this.listMemberships(userId, scope);
    const first = memberships[0];
    if (!first) {
      const all = await this.listMemberships(userId);
      if (all.length > 0) throw new ForbiddenException(SSO_REQUIRED);
      throw new ForbiddenException({
        code: 'NO_WORKSPACE',
        message: 'Your account is not a member of any active workspace.',
      });
    }

    authEvents.inc({ event: 'login_success' });
    await this.prisma.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
    await this.prisma.run({ tenantId: first.tenantId, userId }, (tx) =>
      this.audit.record(tx, {
        tenantId: first.tenantId,
        actorUserId: userId,
        action: 'auth.login',
        entityType: 'user',
        entityId: userId,
        metadata: client === 'web' ? { method: scope.authMethod } : { method: scope.authMethod, client },
        meta,
      }),
    );
    return { userId, tenantId: first.tenantId, scope };
  }

  /** Rotates the refresh token. Reuse of an already-rotated token revokes every session of the user. */
  async refresh(refreshToken: string | undefined, meta: RequestMeta): Promise<IssuedTokens> {
    if (!refreshToken) throw new UnauthorizedException({ code: 'NO_SESSION', message: 'Sign in to continue.' });
    const session = await this.prisma.session.findUnique({
      where: { refreshTokenHash: TokenService.hashRefresh(refreshToken) },
      include: { user: true },
    });
    if (!session) throw new UnauthorizedException({ code: 'NO_SESSION', message: 'Sign in to continue.' });

    if (session.revokedAt && !session.replacedById) {
      // Signed out (or ended by a security change): not a sign of theft, just no longer valid.
      throw new UnauthorizedException({ code: 'SESSION_REVOKED', message: 'Your session has ended. Sign in again.' });
    }
    if (session.revokedAt) {
      // A rotated token came back: someone holds a copy. End every session of the user.
      await this.prisma.session.updateMany({
        where: { userId: session.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      this.logger.warn({ userId: session.userId, requestId: meta.requestId }, 'Refresh token reuse detected');
      throw new UnauthorizedException({ code: 'SESSION_REVOKED', message: 'Your session has ended. Sign in again.' });
    }
    if (session.expiresAt < new Date() || session.user.status !== 'ACTIVE') {
      throw new UnauthorizedException({ code: 'SESSION_EXPIRED', message: 'Your session has expired. Sign in again.' });
    }

    const scope = { authMethod: session.authMethod as AuthMethod, ssoTenantId: session.ssoTenantId };
    const memberships = await this.listMemberships(session.userId, scope);
    const tenantId = memberships.some((m) => m.tenantId === session.activeTenantId)
      ? session.activeTenantId
      : memberships[0]?.tenantId;
    if (!tenantId) {
      throw new ForbiddenException({ code: 'NO_WORKSPACE', message: 'Your account is not a member of any active workspace.' });
    }

    const next = this.tokens.newRefreshToken();
    const created = await this.prisma.$transaction(async (tx) => {
      const s = await tx.session.create({
        data: {
          userId: session.userId,
          activeTenantId: tenantId,
          refreshTokenHash: next.hash,
          userAgent: meta.userAgent,
          ipAddress: meta.ipAddress,
          expiresAt: session.expiresAt,
          authMethod: session.authMethod,
          ssoTenantId: session.ssoTenantId,
        },
      });
      // Conditional update guards against two concurrent refreshes both succeeding.
      const { count } = await tx.session.updateMany({
        where: { id: session.id, revokedAt: null },
        data: { revokedAt: new Date(), replacedById: s.id },
      });
      if (count !== 1) throw new UnauthorizedException({ code: 'SESSION_REVOKED', message: 'Sign in again.' });
      return s;
    });

    return {
      accessToken: await this.tokens.signAccess({ sub: session.userId, tid: tenantId, sid: created.id, ...this.claimsFor(scope) }),
      refreshToken: next.token,
      tenantId,
      userId: session.userId,
    };
  }

  async logout(refreshToken: string | undefined, auth: AuthContext | undefined, meta: RequestMeta): Promise<void> {
    if (refreshToken) {
      await this.prisma.session.updateMany({
        where: { refreshTokenHash: TokenService.hashRefresh(refreshToken), revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    if (auth) {
      await this.prisma.session.updateMany({ where: { id: auth.sessionId, revokedAt: null }, data: { revokedAt: new Date() } });
      await this.prisma.run(auth, (tx) =>
        this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'auth.logout', meta }),
      );
    }
  }

  async switchTenant(auth: AuthContext, tenantId: string, meta: RequestMeta): Promise<string> {
    const memberships = await this.listMemberships(auth.userId, auth);
    if (!memberships.some((m) => m.tenantId === tenantId)) {
      throw new ForbiddenException({ code: 'NOT_A_MEMBER', message: 'You are not a member of that workspace.' });
    }
    await this.prisma.session.update({ where: { id: auth.sessionId }, data: { activeTenantId: tenantId } });
    await this.prisma.run({ tenantId, userId: auth.userId }, (tx) =>
      this.audit.record(tx, {
        tenantId,
        actorUserId: auth.userId,
        action: 'auth.workspace_switched',
        metadata: { fromTenantId: auth.tenantId },
        meta,
      }),
    );
    return this.tokens.signAccess({ sub: auth.userId, tid: tenantId, sid: auth.sessionId, ...this.claimsFor(auth) });
  }

  async me(auth: AuthContext): Promise<MeResponse> {
    const [user, tenant, memberships] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: auth.userId } }),
      this.prisma.run(auth, (tx) =>
        tx.tenant.findUniqueOrThrow({ where: { id: auth.tenantId }, include: { subscription: true } }),
      ),
      this.listMemberships(auth.userId, auth),
    ]);
    return {
      user: { id: user.id, name: user.name, email: user.email },
      tenant: {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        plan: tenant.subscription?.planCode ?? 'free',
        isDemo: tenant.isDemo,
        brandColor: tenant.brandColor,
      },
      role: auth.roleKey,
      permissions: auth.permissions,
      memberships,
      authMethod: auth.authMethod,
      mfaEnabled: !!user.mfaEnabledAt,
      ...(auth.restriction ? { restriction: auth.restriction } : {}),
    };
  }

  /** Resolves a pending invitation's tenant without a tenant context (SECURITY DEFINER lookup by token hash). */
  private async invitationTenant(token: string): Promise<string> {
    const rows = await this.prisma.$queryRaw<{ t: string | null }[]>`SELECT app_invitation_tenant(${TokenService.hashRefresh(token)})::text AS t`;
    const tenantId = rows[0]?.t;
    if (!tenantId) throw new NotFoundException(INVITATION_INVALID);
    return tenantId;
  }

  async previewInvitation(token: string): Promise<InvitationPreview> {
    const tenantId = await this.invitationTenant(token);
    const inv = await this.prisma.run({ tenantId }, (tx) =>
      tx.invitation.findUniqueOrThrow({ where: { tokenHash: TokenService.hashRefresh(token) }, include: { role: true, tenant: true } }),
    );
    const user = await this.prisma.user.findUnique({ where: { email: inv.email }, select: { id: true } });
    return { tenantName: inv.tenant.name, email: inv.email, roleName: inv.role.name, hasAccount: !!user };
  }

  /**
   * Accepts an invitation. An invitee who already has an account must confirm their password, so a
   * leaked link alone cannot open a session for an existing user. New invitees choose a name and password.
   */
  async acceptInvitation(input: AcceptInvitationInput, meta: RequestMeta): Promise<IssuedTokens> {
    const tenantId = await this.invitationTenant(input.token);
    const tokenHash = TokenService.hashRefresh(input.token);
    const inv = await this.prisma.run({ tenantId }, (tx) => tx.invitation.findUniqueOrThrow({ where: { tokenHash } }));

    let user = await this.prisma.user.findUnique({ where: { email: inv.email } });
    if (user) {
      const valid = await this.passwords.verify(user.passwordHash, input.password ?? '');
      if (!valid || user.status !== 'ACTIVE') throw new UnauthorizedException(INVALID_CREDENTIALS);
    } else {
      const password = passwordSchema.safeParse(input.password ?? '');
      if (!input.name || !password.success) {
        throw new BadRequestException({
          code: 'VALIDATION_FAILED',
          message: 'Enter your name and a password to create your account.',
          details: [
            ...(!input.name ? [{ path: 'name', message: 'Enter your name' }] : []),
            ...(!password.success ? password.error.issues.map((i) => ({ path: 'password', message: i.message })) : []),
          ],
        });
      }
      user = await this.prisma.user.create({
        data: { email: inv.email, name: input.name, passwordHash: await this.passwords.hash(password.data) },
      });
    }
    const userId = user.id;

    await this.prisma.run({ tenantId, userId }, async (tx) => {
      // Conditional update: two concurrent accepts of the same link cannot both succeed.
      const { count } = await tx.invitation.updateMany({
        where: { id: inv.id, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
        data: { acceptedAt: new Date() },
      });
      if (count !== 1) throw new NotFoundException(INVITATION_INVALID);
      // The invitation itself held a seat until now; re-check in case the plan was downgraded meanwhile.
      const limit = (await entitlementsFor(tx, tenantId)).seatLimit;
      if (limit !== null && (await tx.membership.count({ where: { tenantId, status: 'ACTIVE' } })) >= limit) {
        throw new ForbiddenException({ code: 'PLAN_LIMIT', message: 'This workspace has no free seats. Ask an admin to upgrade the plan.' });
      }
      await tx.membership.upsert({
        where: { tenantId_userId: { tenantId, userId } },
        create: { tenantId, userId, roleId: inv.roleId },
        update: { roleId: inv.roleId, status: 'ACTIVE' },
      });
      await this.audit.record(tx, {
        tenantId, actorUserId: userId, action: 'member.joined', entityType: 'invitation', entityId: inv.id,
        metadata: { email: inv.email, invitedById: inv.invitedById }, meta,
      });
    });
    await this.prisma.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
    // People with a second factor confirm it at their next sign-in; this session only proved the password.
    return this.startSession(userId, tenantId, meta, { authMethod: 'password' });
  }

  /**
   * Active memberships of a user across tenants, visible through the membership_read policy. With a scope,
   * only the workspaces that session may enter: a single sign-on session only its own workspace, other
   * sessions every workspace except those requiring single sign-on (owners keep password access).
   */
  async listMemberships(userId: string, scope?: SessionScope): Promise<MembershipSummary[]> {
    const rows = await this.prisma.run({ userId }, (tx) =>
      tx.membership.findMany({
        where: { userId, status: 'ACTIVE', tenant: { status: 'ACTIVE', deletedAt: null } },
        include: { tenant: true, role: true },
        orderBy: { createdAt: 'asc' },
      }),
    );
    const blocked = new Set<string>();
    if (scope && !scope.ssoTenantId) {
      for (const m of rows) if (m.tenant.ssoEnforced && m.role.key !== 'owner') blocked.add(m.tenantId);
    }
    const allowed = rows.filter((m) => (scope?.ssoTenantId ? m.tenantId === scope.ssoTenantId : !blocked.has(m.tenantId)));
    return allowed.map((m) => ({
      tenantId: m.tenantId,
      tenantName: m.tenant.name,
      tenantSlug: m.tenant.slug,
      role: m.role.key,
    }));
  }

  async startSession(userId: string, tenantId: string, meta: RequestMeta, scope: SessionScope): Promise<IssuedTokens> {
    const refresh = this.tokens.newRefreshToken();
    const session = await this.prisma.session.create({
      data: {
        userId,
        activeTenantId: tenantId,
        refreshTokenHash: refresh.hash,
        userAgent: meta.userAgent,
        ipAddress: meta.ipAddress,
        expiresAt: new Date(Date.now() + this.tokens.refreshTtlMs),
        authMethod: scope.authMethod,
        ssoTenantId: scope.ssoTenantId ?? null,
      },
    });
    return {
      accessToken: await this.tokens.signAccess({ sub: userId, tid: tenantId, sid: session.id, ...this.claimsFor(scope) }),
      refreshToken: refresh.token,
      tenantId,
      userId,
    };
  }

  private claimsFor(scope: SessionScope): { amr: AuthMethod; stid?: string } {
    return { amr: scope.authMethod, ...(scope.ssoTenantId ? { stid: scope.ssoTenantId } : {}) };
  }

  async recordSecurityEvent(auth: AuthContext, action: string, meta: RequestMeta): Promise<void> {
    await this.prisma.run(auth, (tx) => this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action, entityType: 'user', entityId: auth.userId, meta }));
  }

  // ───── Sessions ─────

  /** The caller's signed-in devices: live refresh sessions (each rotation replaces the row, so createdAt is "last active"). */
  async listSessions(auth: AuthContext): Promise<SessionSummary[]> {
    const rows = await this.prisma.session.findMany({
      where: { userId: auth.userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return rows.map((r) => ({
      id: r.id,
      current: r.id === auth.sessionId,
      method: r.authMethod as SessionSummary['method'],
      userAgent: r.userAgent,
      ipAddress: r.ipAddress,
      lastActiveAt: (r.lastUsedAt ?? r.createdAt).toISOString(),
      expiresAt: r.expiresAt.toISOString(),
    }));
  }

  /** Signs out one device, or every device except this one. Access tokens already issued lapse within their short lifetime. */
  async revokeSessions(auth: AuthContext, which: { id: string } | 'others', meta: RequestMeta): Promise<number> {
    const where = which === 'others' ? { userId: auth.userId, revokedAt: null, id: { not: auth.sessionId } } : { userId: auth.userId, revokedAt: null, id: which.id };
    const { count } = await this.prisma.session.updateMany({ where, data: { revokedAt: new Date() } });
    if (which !== 'others' && count === 0) throw new NotFoundException({ code: 'NOT_FOUND', message: 'That session has already ended.' });
    await this.prisma.run(auth, (tx) =>
      this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'auth.sessions_revoked', metadata: { count, scope: which === 'others' ? 'others' : 'one' }, meta }),
    );
    return count;
  }

  /**
   * After turning two-step verification on: every other session ends, and this one is replaced by a
   * session that counts as verified with the second factor.
   */
  async upgradeAfterMfa(auth: AuthContext, meta: RequestMeta): Promise<IssuedTokens> {
    await this.prisma.session.updateMany({ where: { userId: auth.userId, revokedAt: null }, data: { revokedAt: new Date() } });
    return this.startSession(auth.userId, auth.tenantId, meta, { authMethod: auth.authMethod === 'sso' ? 'sso' : 'mfa', ssoTenantId: auth.ssoTenantId });
  }
}
