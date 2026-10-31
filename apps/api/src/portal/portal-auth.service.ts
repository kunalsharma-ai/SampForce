import { BadRequestException, ForbiddenException, Inject, Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import type { TenantTx } from '@dealflow/database';
import { createHash, randomBytes } from 'node:crypto';
import type { PortalBranding } from '@dealflow/types';
import { AuditService } from '../audit/audit.service';
import { PasswordService } from '../auth/password.service';
import type { RequestMeta } from '../common/auth-context';
import { API_ENV, type ApiEnv } from '../common/env';
import { PrismaService } from '../common/prisma.service';
import { MailerService } from '../mail/mailer.service';

export const PORTAL_COOKIE = 'df_portal';
export const PORTAL_COOKIE_PATH = '/api/v1/client-portal';
const SESSION_DAYS = 7;
const INVITE_DAYS = 7;
const RESET_MINUTES = 60;
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

export const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');
/** Portal tokens carry their workspace id in front so they can be looked up inside that workspace's data only. */
const newToken = (tenantId: string) => `${tenantId}.${randomBytes(32).toString('base64url')}`;
const tenantOf = (token: string) => {
  const id = token.split('.')[0] ?? '';
  return /^[0-9a-f-]{36}$/i.test(id) ? id : null;
};

export interface PortalContext {
  tenantId: string;
  sessionId: string;
  user: { id: string; name: string; email: string; role: 'viewer' | 'approver'; companyId: string };
}

const INVALID = { code: 'INVALID_CREDENTIALS', message: 'That email and password do not match.' };

/**
 * Sign-in for customers. Portal users are separate from workspace members: they have their own table, their own
 * session cookie scoped to the portal API path, and no route of the CRM accepts them.
 */
@Injectable()
export class PortalAuthService {
  private readonly log = new Logger(PortalAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly mailer: MailerService,
    private readonly audit: AuditService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  /** The workspace behind a portal's public name, only when the portal is switched on. */
  async tenantForSlug(slug: string): Promise<string | null> {
    const row = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.portal_slug', ${slug.toLowerCase()}, true)`;
      return tx.portalSettings.findFirst({ where: { slug: slug.toLowerCase(), enabled: true }, select: { tenantId: true } });
    });
    return row?.tenantId ?? null;
  }

  async branding(slug: string): Promise<PortalBranding> {
    const tenantId = await this.tenantForSlug(slug);
    if (!tenantId) throw new NotFoundException({ code: 'NOT_FOUND', message: 'This portal does not exist or is switched off.' });
    return this.prisma.run({ tenantId }, (tx) => brandingOf(tx, tenantId));
  }

  portalUrl(slug: string): string {
    return `${this.env.PUBLIC_WEB_URL.replace(/\/+$/, '')}/portal/${slug}`;
  }

  async login(slug: string, email: string, password: string, meta: RequestMeta): Promise<{ token: string }> {
    const tenantId = await this.tenantForSlug(slug);
    if (!tenantId) {
      await this.passwords.verify(null, password);
      throw new UnauthorizedException(INVALID);
    }
    const out = await this.prisma.run({ tenantId }, async (tx) => {
      const u = await tx.portalUser.findFirst({ where: { tenantId, email: email.toLowerCase() } });
      if (u?.lockedUntil && u.lockedUntil > new Date()) return { kind: 'locked' as const };
      const ok = await this.passwords.verify(u?.status === 'active' ? u.passwordHash : null, password);
      if (!u || !ok) return { kind: 'failed' as const, userId: u?.id ?? null };
      const token = newToken(tenantId);
      await tx.portalSession.create({ data: { tenantId, portalUserId: u.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + SESSION_DAYS * 86_400_000), ip: meta.ipAddress, userAgent: meta.userAgent?.slice(0, 300) ?? null } });
      await tx.portalUser.update({ where: { id: u.id }, data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() } });
      await this.audit.record(tx, { tenantId, actorUserId: null, action: 'portal.signed_in', entityType: 'portal_user', entityId: u.id, metadata: { email: u.email, companyId: u.companyId }, meta });
      return { kind: 'ok' as const, token };
    });
    if (out.kind === 'ok') return { token: out.token };
    if (out.kind === 'locked') throw new UnauthorizedException({ code: 'ACCOUNT_LOCKED', message: 'Too many attempts. Try again in 15 minutes or reset your password.' });
    // Counted in its own transaction: the refusal below must not roll the count back.
    if (out.userId) await this.countFailure(tenantId, out.userId, meta);
    throw new UnauthorizedException(INVALID);
  }

  private async countFailure(tenantId: string, userId: string, meta: RequestMeta): Promise<void> {
    await this.prisma.run({ tenantId }, async (tx) => {
      const [u] = await tx.$queryRaw<{ failed_logins: number; email: string }[]>`
        UPDATE portal_users SET failed_logins = failed_logins + 1 WHERE id = ${userId}::uuid AND tenant_id = ${tenantId}::uuid RETURNING failed_logins, email`;
      if (!u || u.failed_logins < MAX_FAILED) return;
      await tx.portalUser.update({ where: { id: userId }, data: { lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60_000), failedLogins: 0 } });
      await this.audit.record(tx, { tenantId, actorUserId: null, action: 'portal.user_locked', entityType: 'portal_user', entityId: userId, metadata: { email: u.email }, meta });
    });
  }

  /** Resolves the session cookie. The portal must still be on and the person still active. */
  async session(token: string | undefined): Promise<PortalContext> {
    const tenantId = token ? tenantOf(token) : null;
    if (!token || !tenantId) throw new UnauthorizedException({ code: 'UNAUTHENTICATED', message: 'Sign in to the portal.' });
    const ctx = await this.prisma.run({ tenantId }, async (tx) => {
      const s = await tx.portalSession.findFirst({ where: { tenantId, tokenHash: sha256(token), expiresAt: { gt: new Date() } }, include: { user: true } });
      if (!s || s.user.status !== 'active') return null;
      const settings = await tx.portalSettings.findUnique({ where: { tenantId }, select: { enabled: true } });
      if (!settings?.enabled) return null;
      if (Date.now() - s.lastSeenAt.getTime() > 5 * 60_000) await tx.portalSession.update({ where: { id: s.id }, data: { lastSeenAt: new Date() } });
      return { tenantId, sessionId: s.id, user: { id: s.user.id, name: s.user.name, email: s.user.email, role: s.user.role as 'viewer' | 'approver', companyId: s.user.companyId } };
    });
    if (!ctx) throw new UnauthorizedException({ code: 'UNAUTHENTICATED', message: 'Your portal session ended. Sign in again.' });
    return ctx;
  }

  async logout(token: string | undefined): Promise<void> {
    const tenantId = token ? tenantOf(token) : null;
    if (!token || !tenantId) return;
    await this.prisma.run({ tenantId }, (tx) => tx.portalSession.deleteMany({ where: { tenantId, tokenHash: sha256(token) } }));
  }

  /** Creates an invitation token for a portal user (staff side). Returns the link to share. */
  async issueInvite(tx: TenantTx, tenantId: string, userId: string, slug: string): Promise<string> {
    const token = newToken(tenantId);
    await tx.portalUser.update({ where: { id: userId }, data: { inviteTokenHash: sha256(token), inviteExpiresAt: new Date(Date.now() + INVITE_DAYS * 86_400_000) } });
    return `${this.portalUrl(slug)}/accept?token=${encodeURIComponent(token)}`;
  }

  async acceptInvite(token: string, password: string, meta: RequestMeta): Promise<{ token: string; slug: string }> {
    const tenantId = tenantOf(token);
    const bad = new BadRequestException({ code: 'INVALID_TOKEN', message: 'This invitation link is not valid or has expired. Ask your account manager for a new one.' });
    if (!tenantId) throw bad;
    const { email, slug } = await this.prisma.run({ tenantId }, async (tx) => {
      const u = await tx.portalUser.findFirst({ where: { tenantId, inviteTokenHash: sha256(token), inviteExpiresAt: { gt: new Date() } } });
      if (!u || u.status === 'disabled') throw bad;
      const settings = await tx.portalSettings.findUnique({ where: { tenantId } });
      if (!settings?.enabled) throw bad;
      await tx.portalUser.update({ where: { id: u.id }, data: { passwordHash: await this.passwords.hash(password), status: 'active', inviteTokenHash: null, inviteExpiresAt: null, failedLogins: 0, lockedUntil: null } });
      await this.audit.record(tx, { tenantId, actorUserId: null, action: 'portal.invitation_accepted', entityType: 'portal_user', entityId: u.id, metadata: { email: u.email, companyId: u.companyId }, meta });
      return { email: u.email, slug: settings.slug };
    });
    return { ...(await this.login(slug, email, password, meta)), slug };
  }

  /** Always answers the same way, so the form does not reveal who has portal access. */
  async forgot(slug: string, email: string, meta: RequestMeta): Promise<void> {
    const tenantId = await this.tenantForSlug(slug);
    if (!tenantId) return;
    const out = await this.prisma.run({ tenantId }, async (tx) => {
      const u = await tx.portalUser.findFirst({ where: { tenantId, email: email.toLowerCase(), status: 'active' } });
      if (!u) return null;
      const token = newToken(tenantId);
      await tx.portalUser.update({ where: { id: u.id }, data: { resetTokenHash: sha256(token), resetExpiresAt: new Date(Date.now() + RESET_MINUTES * 60_000) } });
      await this.audit.record(tx, { tenantId, actorUserId: null, action: 'portal.password_reset_requested', entityType: 'portal_user', entityId: u.id, metadata: { email: u.email }, meta });
      return { to: u.email, name: u.name, token, seller: (await brandingOf(tx, tenantId)).seller };
    });
    if (!out) return;
    if (!this.mailer.configured) {
      this.log.warn('Portal password reset requested but no email service is configured');
      return;
    }
    await this.mailer
      .send({
        to: out.to,
        subject: `Reset your ${out.seller} portal password`,
        text: `Hello ${out.name},\n\nUse this link within ${RESET_MINUTES} minutes to choose a new password:\n${this.portalUrl(slug)}/reset?token=${encodeURIComponent(out.token)}\n\nIf you did not ask for this, you can ignore this email.`,
      })
      .catch(() => undefined);
  }

  async reset(token: string, password: string, meta: RequestMeta): Promise<void> {
    const tenantId = tenantOf(token);
    const bad = new BadRequestException({ code: 'INVALID_TOKEN', message: 'This reset link is not valid or has expired. Request a new one.' });
    if (!tenantId) throw bad;
    await this.prisma.run({ tenantId }, async (tx) => {
      const u = await tx.portalUser.findFirst({ where: { tenantId, resetTokenHash: sha256(token), resetExpiresAt: { gt: new Date() }, status: 'active' } });
      if (!u) throw bad;
      await tx.portalUser.update({ where: { id: u.id }, data: { passwordHash: await this.passwords.hash(password), resetTokenHash: null, resetExpiresAt: null, failedLogins: 0, lockedUntil: null } });
      // Every other session ends: a reset is often a response to a lost or shared password.
      await tx.portalSession.deleteMany({ where: { tenantId, portalUserId: u.id } });
      await this.audit.record(tx, { tenantId, actorUserId: null, action: 'portal.password_reset', entityType: 'portal_user', entityId: u.id, metadata: { email: u.email }, meta });
    });
  }

  requireApprover(ctx: PortalContext): void {
    if (ctx.user.role !== 'approver') throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Your portal access does not include approving proposals.' });
  }
}

export async function brandingOf(tx: TenantTx, tenantId: string): Promise<PortalBranding> {
  const [tenant, settings, commercial] = await Promise.all([
    tx.tenant.findFirstOrThrow({ where: { id: tenantId }, select: { name: true, brandColor: true } }),
    tx.portalSettings.findUniqueOrThrow({ where: { tenantId } }),
    tx.commercialSettings.findUnique({ where: { tenantId }, select: { logoDataUrl: true } }),
  ]);
  return { slug: settings.slug, title: settings.title ?? `${tenant.name} client portal`, seller: tenant.name, logoDataUrl: commercial?.logoDataUrl ?? null, brandColor: tenant.brandColor, welcome: settings.welcome };
}
