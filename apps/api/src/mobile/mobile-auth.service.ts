import { ConflictException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { levelFromDesignationTier, type LoginInput, type MobileBlockReason, type MobileDeviceInfo, type MobileLoginResponse, type MobilePlatform, type MobileSession, type MobileTokens } from '@dealflow/types';
import { AuditService } from '../audit/audit.service';
import { AuthService, type SessionScope } from '../auth/auth.service';
import { TokenService } from '../auth/token.service';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { mobileBlocked, mobileBlockReason } from './mobile-gate';

const NO_SESSION = { code: 'NO_SESSION', message: 'Sign in to continue.' };

/**
 * Phone sign-in (ADR 0072). Same accounts, password rules, lockout and second factor as the web; the difference is
 * that the refresh token comes back in the body for the phone's secure storage (there is no cookie jar), the session
 * is marked MOBILE so the API guard holds it to the mobile routes, and it only starts in an organisation whose mobile
 * access is live.
 */
@Injectable()
export class MobileAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
  ) {}

  async login(input: LoginInput, device: MobileDeviceInfo, meta: RequestMeta): Promise<MobileLoginResponse> {
    const r = await this.auth.mobileCheckPassword(input, meta);
    if ('mfaRequired' in r) return r;
    return this.start(r.userId, r.scope, device, meta);
  }

  async verifyMfa(challenge: string, code: string, device: MobileDeviceInfo, meta: RequestMeta): Promise<MobileTokens> {
    const r = await this.auth.mobileCheckSecondFactor(challenge, code, meta);
    return this.start(r.userId, r.scope, device, meta);
  }

  /** Organisations of the person where phones may sign in now, in membership order. */
  private async liveWorkspaces(userId: string, scope: SessionScope): Promise<{ live: { tenantId: string; name: string }[]; firstReason: MobileBlockReason | null; any: boolean }> {
    const memberships = await this.auth.listMemberships(userId, scope);
    const live: { tenantId: string; name: string }[] = [];
    let firstReason: MobileBlockReason | null = null;
    for (const m of memberships) {
      const reason = await this.prisma.run({ tenantId: m.tenantId, userId }, (tx) => mobileBlockReason(tx, m.tenantId));
      if (reason === null) live.push({ tenantId: m.tenantId, name: m.tenantName });
      else firstReason ??= reason;
    }
    return { live, firstReason, any: memberships.length > 0 };
  }

  private async start(userId: string, scope: SessionScope, device: MobileDeviceInfo, meta: RequestMeta, preferredTenantId?: string): Promise<MobileTokens> {
    const { live, firstReason, any } = await this.liveWorkspaces(userId, scope);
    if (!any) {
      if ((await this.auth.listMemberships(userId)).length > 0) {
        throw new ForbiddenException({ code: 'SSO_REQUIRED', message: 'Your workspace requires single sign-on, which the mobile app does not support yet. Use SampForce in your browser.' });
      }
      throw new ForbiddenException({ code: 'NO_WORKSPACE', message: 'Your account is not a member of any active workspace.' });
    }
    const target = live.find((w) => w.tenantId === preferredTenantId) ?? live[0];
    if (!target) throw mobileBlocked(firstReason ?? 'NOT_APPROVED');
    const tenantId = target.tenantId;

    return this.prisma.run({ tenantId, userId }, async (tx) => {
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { requireMfa: true } });
      if (tenant.requireMfa && scope.authMethod === 'password') {
        throw new ForbiddenException({ code: 'MFA_REQUIRED', message: 'This workspace requires two-step verification. Turn it on in SampForce in your browser, then sign in here again.' });
      }
      const access = await tx.mobileAccess.findUnique({ where: { tenantId }, select: { maxDevices: true } });
      const existing = await tx.mobileDevice.findUnique({ where: { tenantId_userId_installId: { tenantId, userId, installId: device.installId } } });
      if (access?.maxDevices && !(existing && !existing.signedOutAt)) {
        const active = await tx.mobileDevice.count({ where: { tenantId, signedOutAt: null } });
        if (active >= access.maxDevices) {
          throw new ConflictException({ code: 'MOBILE_DEVICE_LIMIT', message: 'Your organisation has reached the number of phones it may sign in. Ask your administrator to sign out a phone that is no longer used.' });
        }
      }
      const fields = { platform: device.platform, model: device.model ?? null, osVersion: device.osVersion ?? null, appVersion: device.appVersion ?? null, name: device.name ?? null, signedOutAt: null, lastSeenAt: new Date() };
      const row = existing
        ? await tx.mobileDevice.update({ where: { id: existing.id }, data: fields })
        : await tx.mobileDevice.create({ data: { tenantId, userId, installId: device.installId, ...fields } });
      // One live session per phone: signing in again ends the phone's earlier session.
      await this.prisma.session.updateMany({ where: { deviceId: row.id, revokedAt: null }, data: { revokedAt: new Date() } });
      const refresh = this.tokens.newRefreshToken();
      const session = await this.prisma.session.create({
        data: {
          userId, activeTenantId: tenantId, refreshTokenHash: refresh.hash, userAgent: meta.userAgent, ipAddress: meta.ipAddress,
          expiresAt: new Date(Date.now() + this.tokens.refreshTtlMs), authMethod: scope.authMethod, ssoTenantId: scope.ssoTenantId ?? null,
          client: 'MOBILE', deviceId: row.id,
        },
      });
      await this.prisma.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
      await this.audit.record(tx, { tenantId, actorUserId: userId, action: 'auth.login', entityType: 'user', entityId: userId, metadata: { method: scope.authMethod, client: 'mobile', platform: device.platform, deviceId: row.id }, meta });
      return {
        accessToken: await this.tokens.signAccess({ sub: userId, tid: tenantId, sid: session.id, amr: scope.authMethod }),
        refreshToken: refresh.token,
        expiresIn: this.tokens.accessTtlSeconds,
        tenantId,
        deviceId: row.id,
      };
    });
  }

  /** Rotates a phone's refresh token. A blocked organisation ends the phone's session instead. */
  async refresh(refreshToken: string, meta: RequestMeta): Promise<MobileTokens> {
    const session = await this.prisma.session.findUnique({ where: { refreshTokenHash: TokenService.hashRefresh(refreshToken) } });
    if (!session || session.client !== 'MOBILE' || !session.deviceId) throw new UnauthorizedException(NO_SESSION);
    const ctx = { tenantId: session.activeTenantId, userId: session.userId };
    // The reason comes first, even for a session that has ended, so the phone can say why it was signed out.
    const reason = await this.prisma.run(ctx, (tx) => mobileBlockReason(tx, session.activeTenantId));
    if (reason) throw mobileBlocked(reason);
    let tokens;
    try {
      tokens = await this.auth.refresh(refreshToken, meta, 'MOBILE');
    } catch (err) {
      // A reused token ends every session of the person: phones left without a live session show as signed out.
      await this.markSignedOutPhones(session.activeTenantId, session.userId);
      throw err;
    }
    const device = await this.prisma.run({ tenantId: tokens.tenantId, userId: tokens.userId }, (tx) => tx.mobileDevice.findFirst({ where: { id: session.deviceId!, signedOutAt: null } }));
    if (!device) {
      // The person left the organisation the phone was signed in to: the phone signs in again.
      await this.prisma.session.updateMany({ where: { deviceId: session.deviceId, revokedAt: null }, data: { revokedAt: new Date() } });
      throw new UnauthorizedException({ code: 'SESSION_EXPIRED', message: 'Your session has expired. Sign in again.' });
    }
    await this.prisma.run({ tenantId: tokens.tenantId, userId: tokens.userId }, (tx) => tx.mobileDevice.update({ where: { id: device.id }, data: { lastSeenAt: new Date() } }));
    return { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, expiresIn: this.tokens.accessTtlSeconds, tenantId: tokens.tenantId, deviceId: device.id };
  }

  async logout(auth: AuthContext, meta: RequestMeta): Promise<void> {
    await this.auth.logout(undefined, auth, meta);
  }

  /** Moves the phone to another organisation of the person where mobile access is live. */
  async switchWorkspace(auth: AuthContext, tenantId: string, meta: RequestMeta): Promise<MobileTokens> {
    const live = await this.liveWorkspaces(auth.userId, { authMethod: auth.authMethod, ...(auth.ssoTenantId ? { ssoTenantId: auth.ssoTenantId } : {}) });
    if (!live.live.some((w) => w.tenantId === tenantId)) throw new ForbiddenException({ code: 'NOT_A_MEMBER', message: 'Mobile access is not available in that workspace.' });
    const device = await this.prisma.run(auth, (tx) => tx.mobileDevice.findUniqueOrThrow({ where: { id: auth.deviceId! } }));
    await this.auth.logout(undefined, auth, meta);
    return this.start(auth.userId, { authMethod: auth.authMethod }, {
      platform: device.platform as MobilePlatform, installId: device.installId,
      ...(device.model ? { model: device.model } : {}), ...(device.osVersion ? { osVersion: device.osVersion } : {}), ...(device.appVersion ? { appVersion: device.appVersion } : {}), ...(device.name ? { name: device.name } : {}),
    }, meta, tenantId);
  }

  /** Who is signed in on the phone. Also records that the phone was seen. */
  async session(auth: AuthContext): Promise<MobileSession> {
    const [user, live] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: auth.userId }, select: { id: true, name: true, email: true } }),
      this.liveWorkspaces(auth.userId, { authMethod: auth.authMethod, ...(auth.ssoTenantId ? { ssoTenantId: auth.ssoTenantId } : {}) }),
    ]);
    return this.prisma.run(auth, async (tx) => {
      const [tenant, membership, device] = await Promise.all([
        tx.tenant.findUniqueOrThrow({ where: { id: auth.tenantId }, select: { id: true, name: true, brandColor: true } }),
        tx.membership.findUniqueOrThrow({ where: { id: auth.membershipId }, include: { role: { select: { key: true, name: true } } } }),
        auth.deviceId ? tx.mobileDevice.update({ where: { id: auth.deviceId }, data: { lastSeenAt: new Date() } }) : null,
      ]);
      const designation = membership.designationId ? await tx.designation.findUnique({ where: { id: membership.designationId }, select: { name: true, tier: true } }) : null;
      return {
        user,
        organisation: { id: tenant.id, name: tenant.name, brandColor: tenant.brandColor },
        // Until the workspace hierarchy (ADR 0071) gives every person a workspace, the designation tier decides.
        level: levelFromDesignationTier(designation?.tier, membership.role.key),
        designation: designation?.name ?? null,
        role: membership.role.name,
        permissions: auth.permissions,
        workspaces: live.live,
        device: { id: device?.id ?? '', platform: (device?.platform ?? 'WEB') as MobilePlatform },
      };
    });
  }

  private async markSignedOutPhones(tenantId: string, userId: string): Promise<void> {
    const ctx = { tenantId, userId };
    const phones = await this.prisma.run(ctx, (tx) => tx.mobileDevice.findMany({ where: { tenantId, userId, signedOutAt: null }, select: { id: true } }));
    for (const p of phones) {
      const live = await this.prisma.session.count({ where: { deviceId: p.id, revokedAt: null, expiresAt: { gt: new Date() } } });
      if (!live) await this.prisma.run(ctx, (tx) => tx.mobileDevice.update({ where: { id: p.id }, data: { signedOutAt: new Date() } }));
    }
  }

  /** Ends a phone's sessions and marks it signed out. */
  async endDevice(tenantId: string, userId: string, deviceId: string): Promise<void> {
    await this.prisma.session.updateMany({ where: { deviceId, revokedAt: null }, data: { revokedAt: new Date() } });
    await this.prisma.run({ tenantId, userId }, (tx) => tx.mobileDevice.updateMany({ where: { id: deviceId, signedOutAt: null }, data: { signedOutAt: new Date() } }));
  }
}
