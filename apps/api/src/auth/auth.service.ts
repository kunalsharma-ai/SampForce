import { randomBytes, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
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
} from '@dealflow/types';
import { AuditService } from '../audit/audit.service';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  tenantId: string;
  userId: string;
}

const INVITATION_INVALID = {
  code: 'INVITATION_INVALID',
  message: 'This invitation link is invalid, has expired or was already used. Ask for a new invitation.',
};

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
  ) {}

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
      return this.startSession(userId, tenantId, meta);
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

  async login(input: LoginInput, meta: RequestMeta): Promise<IssuedTokens> {
    const user = await this.prisma.user.findUnique({ where: { email: input.email } });
    const valid = await this.passwords.verify(user?.passwordHash ?? null, input.password);
    if (!user || !valid || user.status !== 'ACTIVE') {
      this.logger.warn({ requestId: meta.requestId, ip: meta.ipAddress }, 'Failed sign-in attempt');
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    const memberships = await this.listMemberships(user.id);
    const first = memberships[0];
    if (!first) {
      throw new ForbiddenException({
        code: 'NO_WORKSPACE',
        message: 'Your account is not a member of any active workspace.',
      });
    }

    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await this.prisma.run({ tenantId: first.tenantId, userId: user.id }, (tx) =>
      this.audit.record(tx, {
        tenantId: first.tenantId,
        actorUserId: user.id,
        action: 'auth.login',
        entityType: 'user',
        entityId: user.id,
        meta,
      }),
    );
    return this.startSession(user.id, first.tenantId, meta);
  }

  /** Rotates the refresh token. Reuse of an already-rotated token revokes every session of the user. */
  async refresh(refreshToken: string | undefined, meta: RequestMeta): Promise<IssuedTokens> {
    if (!refreshToken) throw new UnauthorizedException({ code: 'NO_SESSION', message: 'Sign in to continue.' });
    const session = await this.prisma.session.findUnique({
      where: { refreshTokenHash: TokenService.hashRefresh(refreshToken) },
      include: { user: true },
    });
    if (!session) throw new UnauthorizedException({ code: 'NO_SESSION', message: 'Sign in to continue.' });

    if (session.revokedAt) {
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

    const memberships = await this.listMemberships(session.userId);
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
      accessToken: await this.tokens.signAccess({ sub: session.userId, tid: tenantId, sid: created.id }),
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
    const memberships = await this.listMemberships(auth.userId);
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
    return this.tokens.signAccess({ sub: auth.userId, tid: tenantId, sid: auth.sessionId });
  }

  async me(auth: AuthContext): Promise<MeResponse> {
    const [user, tenant, memberships] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: auth.userId } }),
      this.prisma.run(auth, (tx) =>
        tx.tenant.findUniqueOrThrow({ where: { id: auth.tenantId }, include: { subscription: true } }),
      ),
      this.listMemberships(auth.userId),
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
    return this.startSession(userId, tenantId, meta);
  }

  /** Active memberships of a user across tenants, visible through the membership_read policy. */
  async listMemberships(userId: string): Promise<MembershipSummary[]> {
    const rows = await this.prisma.run({ userId }, (tx) =>
      tx.membership.findMany({
        where: { userId, status: 'ACTIVE', tenant: { status: 'ACTIVE', deletedAt: null } },
        include: { tenant: true, role: true },
        orderBy: { createdAt: 'asc' },
      }),
    );
    return rows.map((m) => ({
      tenantId: m.tenantId,
      tenantName: m.tenant.name,
      tenantSlug: m.tenant.slug,
      role: m.role.key,
    }));
  }

  private async startSession(userId: string, tenantId: string, meta: RequestMeta): Promise<IssuedTokens> {
    const refresh = this.tokens.newRefreshToken();
    const session = await this.prisma.session.create({
      data: {
        userId,
        activeTenantId: tenantId,
        refreshTokenHash: refresh.hash,
        userAgent: meta.userAgent,
        ipAddress: meta.ipAddress,
        expiresAt: new Date(Date.now() + this.tokens.refreshTtlMs),
      },
    });
    return {
      accessToken: await this.tokens.signAccess({ sub: userId, tid: tenantId, sid: session.id }),
      refreshToken: refresh.token,
      tenantId,
      userId,
    };
  }
}
