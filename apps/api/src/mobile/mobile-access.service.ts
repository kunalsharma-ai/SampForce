import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type TenantTx } from '@dealflow/database';
import type { MobileAccessState, MobileAccessStatus, MobileDeviceRow, MobilePlatform, OperatorMobileAction, OperatorMobileDetail, OperatorMobileOverview, OperatorMobileRow } from '@dealflow/types';
import { AuditService } from '../audit/audit.service';
import { entitlementsFor } from '../billing/entitlements';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import type { OperatorContext } from '../operator/operator-auth';
import { blockReason, mobileAccessState } from './mobile-gate';

/** Which Console decision is allowed from which status, and where it leads. */
const TRANSITIONS: Record<OperatorMobileAction, { from: MobileAccessStatus[]; to: MobileAccessStatus }> = {
  // Approving needs no request: the Console can switch mobile on for a client directly ("enable").
  approve: { from: ['OFF', 'REQUESTED', 'REJECTED', 'REVOKED'], to: 'APPROVED' },
  reject: { from: ['REQUESTED'], to: 'REJECTED' },
  suspend: { from: ['APPROVED'], to: 'SUSPENDED' },
  reinstate: { from: ['SUSPENDED'], to: 'APPROVED' },
  revoke: { from: ['APPROVED', 'SUSPENDED'], to: 'REVOKED' },
};

const DONE_ACTION: Record<OperatorMobileAction, string> = { approve: 'mobile.approved', reject: 'mobile.rejected', suspend: 'mobile.suspended', reinstate: 'mobile.reinstated', revoke: 'mobile.revoked' };

/**
 * Mobile access (ADR 0072): the Super Workspace asks for it, the Console Admin decides, the Super Workspace switches
 * it on. Switching it off at either level ends every phone session of the organisation at once; web access and the
 * organisation's data are never touched.
 */
@Injectable()
export class MobileAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ───────────── Super Workspace ─────────────

  state(auth: AuthContext): Promise<MobileAccessState> {
    return this.prisma.run(auth, (tx) => mobileAccessState(tx, auth.tenantId));
  }

  async request(auth: AuthContext, message: string | undefined, meta: RequestMeta): Promise<MobileAccessState> {
    return this.prisma.run(auth, async (tx) => {
      const row = await tx.mobileAccess.findUnique({ where: { tenantId: auth.tenantId } });
      const status = (row?.status ?? 'OFF') as MobileAccessStatus;
      if (status === 'REQUESTED') throw new ConflictException({ code: 'ALREADY_REQUESTED', message: 'Mobile access has already been requested. The SampForce team will decide soon.' });
      if (status === 'APPROVED') throw new ConflictException({ code: 'ALREADY_APPROVED', message: 'Mobile access is already approved.' });
      if (status === 'SUSPENDED') throw new ConflictException({ code: 'MOBILE_SUSPENDED', message: 'Mobile access is suspended. Contact SampForce support.' });
      const data = { status: 'REQUESTED', requestMessage: message || null, requestedAt: new Date(), requestedById: auth.userId };
      await tx.mobileAccess.upsert({ where: { tenantId: auth.tenantId }, create: { tenantId: auth.tenantId, ...data }, update: data });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'mobile.access_requested', entityType: 'mobile_access', entityId: auth.tenantId, metadata: { message: message ?? null }, meta });
      return mobileAccessState(tx, auth.tenantId);
    });
  }

  async setActivated(auth: AuthContext, activated: boolean, meta: RequestMeta): Promise<MobileAccessState> {
    const state = await this.prisma.run(auth, async (tx) => {
      const row = await tx.mobileAccess.findUnique({ where: { tenantId: auth.tenantId } });
      if (activated) {
        if (row?.status !== 'APPROVED') throw new ConflictException({ code: 'MOBILE_NOT_APPROVED', message: 'Mobile access has to be approved by the SampForce team before you can switch it on.' });
        if (!(await entitlementsFor(tx, auth.tenantId)).features.includes('mobile_app')) throw new ConflictException({ code: 'MOBILE_NOT_IN_PLAN', message: 'The mobile app is not included in your organisation’s plan.' });
        if (row.activatedAt) return mobileAccessState(tx, auth.tenantId);
        await tx.mobileAccess.update({ where: { tenantId: auth.tenantId }, data: { activatedAt: new Date(), activatedById: auth.userId } });
      } else {
        if (!row?.activatedAt) return mobileAccessState(tx, auth.tenantId);
        await tx.mobileAccess.update({ where: { tenantId: auth.tenantId }, data: { activatedAt: null, activatedById: null } });
      }
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: activated ? 'mobile.activated' : 'mobile.deactivated', entityType: 'mobile_access', entityId: auth.tenantId, meta });
      return null;
    });
    if (state) return state;
    if (!activated) await this.endAllPhones(auth.tenantId);
    return this.state(auth);
  }

  async devices(auth: AuthContext): Promise<MobileDeviceRow[]> {
    return this.prisma.run(auth, async (tx) => this.deviceRows(tx, auth.tenantId, true, auth.deviceId));
  }

  async signOutDevice(auth: AuthContext, id: string, meta: RequestMeta): Promise<MobileDeviceRow[]> {
    const device = await this.prisma.run(auth, (tx) => tx.mobileDevice.findFirst({ where: { id, tenantId: auth.tenantId } }));
    if (!device) throw new NotFoundException({ code: 'NOT_FOUND', message: 'That phone was not found.' });
    await this.prisma.session.updateMany({ where: { deviceId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    await this.prisma.run(auth, async (tx) => {
      await tx.mobileDevice.updateMany({ where: { id, signedOutAt: null }, data: { signedOutAt: new Date() } });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'mobile.device_signed_out', entityType: 'mobile_device', entityId: id, metadata: { platform: device.platform, userId: device.userId }, meta });
    });
    return this.devices(auth);
  }

  private async deviceRows(tx: TenantTx | Prisma.TransactionClient, tenantId: string, withPeople: boolean, currentId?: string): Promise<MobileDeviceRow[]> {
    const rows = await tx.mobileDevice.findMany({ where: { tenantId, signedOutAt: null }, orderBy: { lastSeenAt: 'desc' }, take: 500 });
    const people = new Map<string, { name: string; email: string }>();
    if (withPeople && rows.length) {
      for (const u of await tx.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.userId))] } }, select: { id: true, name: true, email: true } })) people.set(u.id, { name: u.name, email: u.email });
    }
    return rows.map((r) => ({
      id: r.id, platform: r.platform as MobilePlatform, model: r.model, osVersion: r.osVersion, appVersion: r.appVersion,
      name: withPeople ? r.name : null, person: withPeople ? (people.get(r.userId) ?? null) : null, pushEnabled: !!r.pushToken,
      createdAt: r.createdAt.toISOString(), lastSeenAt: r.lastSeenAt.toISOString(), ...(currentId ? { current: r.id === currentId } : {}),
    }));
  }

  /** Every phone of the organisation signs out (mobile switched off, suspended or revoked). */
  private async endAllPhones(tenantId: string): Promise<void> {
    await this.prisma.session.updateMany({ where: { activeTenantId: tenantId, client: 'MOBILE', revokedAt: null }, data: { revokedAt: new Date() } });
    await this.prisma.run({ tenantId }, (tx) => tx.mobileDevice.updateMany({ where: { tenantId, signedOutAt: null }, data: { signedOutAt: new Date() } }));
  }

  // ───────────── Console Admin ─────────────

  async overview(op: OperatorContext, ip: string | null): Promise<OperatorMobileOverview> {
    const data = await this.prisma.run({ operatorScan: true }, async (tx) => {
      const [tenants, access, devices] = await Promise.all([
        tx.tenant.findMany({ where: { deletedAt: null }, select: { id: true, name: true, status: true, subscription: { select: { planCode: true } } }, orderBy: { createdAt: 'desc' }, take: 500 }),
        tx.mobileAccess.findMany({}),
        tx.mobileDevice.findMany({ where: { signedOutAt: null }, select: { tenantId: true, platform: true, appVersion: true, lastSeenAt: true } }),
      ]);
      return { tenants, access, devices };
    });
    const byTenant = new Map(data.access.map((a) => [a.tenantId, a]));
    const rows: OperatorMobileRow[] = [];
    for (const t of data.tenants) {
      const a = byTenant.get(t.id) ?? null;
      const inPlan = (await this.prisma.run({ tenantId: t.id }, (tx) => entitlementsFor(tx, t.id))).features.includes('mobile_app');
      const ds = data.devices.filter((d) => d.tenantId === t.id);
      const live = blockReason({ tenantActive: t.status === 'ACTIVE', inPlan, row: a }) === null;
      rows.push({
        tenantId: t.id, name: t.name, planCode: t.subscription?.planCode ?? null, status: (a?.status ?? 'OFF') as MobileAccessStatus, inPlan, activated: !!a?.activatedAt, live,
        requestedAt: a?.status === 'REQUESTED' ? (a.requestedAt?.toISOString() ?? null) : null, requestMessage: a?.status === 'REQUESTED' ? a.requestMessage : null,
        devices: { active: ds.length, ios: ds.filter((d) => d.platform === 'IOS').length, android: ds.filter((d) => d.platform === 'ANDROID').length, web: ds.filter((d) => d.platform === 'WEB').length },
        lastSeenAt: ds.reduce<Date | null>((m, d) => (!m || d.lastSeenAt > m ? d.lastSeenAt : m), null)?.toISOString() ?? null,
      });
    }
    // Requests first, then organisations with mobile on, then the rest.
    const rank = (r: OperatorMobileRow) => (r.status === 'REQUESTED' ? 0 : r.status === 'OFF' ? 3 : r.live ? 1 : 2);
    rows.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
    const versions = new Map<string, { appVersion: string; platform: MobilePlatform; devices: number }>();
    for (const d of data.devices) {
      const k = `${d.platform}|${d.appVersion ?? 'unknown'}`;
      const v = versions.get(k) ?? { appVersion: d.appVersion ?? 'unknown', platform: d.platform as MobilePlatform, devices: 0 };
      v.devices += 1;
      versions.set(k, v);
    }
    await this.log(op.id, 'mobile.overview_viewed', null, {}, ip);
    return {
      totals: {
        organisations: rows.length, live: rows.filter((r) => r.live).length, requested: rows.filter((r) => r.status === 'REQUESTED').length, suspended: rows.filter((r) => r.status === 'SUSPENDED').length,
        devices: data.devices.length, ios: data.devices.filter((d) => d.platform === 'IOS').length, android: data.devices.filter((d) => d.platform === 'ANDROID').length,
      },
      versions: [...versions.values()].sort((a, b) => b.appVersion.localeCompare(a.appVersion, undefined, { numeric: true }) || b.devices - a.devices),
      rows,
    };
  }

  async detail(op: OperatorContext, tenantId: string, ip: string | null): Promise<OperatorMobileDetail> {
    const exists = await this.prisma.run({ operatorScan: true }, (tx) => tx.tenant.findFirst({ where: { id: tenantId, deletedAt: null }, select: { id: true } }));
    if (!exists) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Workspace not found.' });
    const now = new Date();
    const result = await this.prisma.run({ tenantId }, async (tx) => {
      // Names of the people behind the phones are member data: shown only while the organisation grants support access.
      const grant = await tx.supportGrant.findFirst({ where: { tenantId, revokedAt: null, expiresAt: { gt: now } } });
      return { state: await mobileAccessState(tx, tenantId), devices: await this.deviceRows(tx, tenantId, !!grant) };
    });
    const history = await this.prisma.platformAuditLog.findMany({ where: { targetTenantId: tenantId, action: { startsWith: 'mobile.' } }, include: { operator: { select: { name: true } } }, orderBy: { createdAt: 'desc' }, take: 50 });
    await this.log(op.id, 'mobile.viewed', tenantId, {}, ip);
    return {
      ...result,
      history: history
        .filter((h) => h.action !== 'mobile.viewed' && h.action !== 'mobile.overview_viewed')
        .map((h) => ({ action: h.action, reason: ((h.metadata as Record<string, unknown> | null)?.reason as string | undefined) ?? null, at: h.createdAt.toISOString(), by: h.operator?.name ?? null })),
    };
  }

  async decide(op: OperatorContext, tenantId: string, action: OperatorMobileAction, reason: string, ip: string | null): Promise<OperatorMobileDetail> {
    const t = TRANSITIONS[action];
    const endPhones = await this.prisma.run({ tenantId }, async (tx) => {
      const tenant = await tx.tenant.findFirst({ where: { id: tenantId, deletedAt: null }, select: { id: true } });
      if (!tenant) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Workspace not found.' });
      const row = await tx.mobileAccess.findUnique({ where: { tenantId } });
      const status = (row?.status ?? 'OFF') as MobileAccessStatus;
      if (!t.from.includes(status)) {
        throw new ConflictException({ code: 'INVALID_MOBILE_TRANSITION', message: 'That change is not possible in mobile access’s current state. Reload the page and try again.', details: [{ path: 'status', message: status }] });
      }
      if (action === 'approve' && !(await entitlementsFor(tx, tenantId)).features.includes('mobile_app')) {
        throw new ConflictException({ code: 'MOBILE_NOT_IN_PLAN', message: 'The client’s plan does not include the mobile app. Add “Mobile app” to the plan, or switch it on for this client under Plan features, first.' });
      }
      const data = {
        status: t.to, decisionStatus: t.to, decisionReason: reason, decidedAt: new Date(), decidedByOperatorId: op.id,
        // Revoking clears the Super Workspace's activation; suspending keeps it, so reinstating restores things as they were.
        ...(action === 'revoke' ? { activatedAt: null, activatedById: null } : {}),
      };
      await tx.mobileAccess.upsert({ where: { tenantId }, create: { tenantId, ...data }, update: data });
      await this.audit.record(tx, { tenantId, actorUserId: null, actorType: 'PLATFORM_ADMIN', action: DONE_ACTION[action], entityType: 'mobile_access', entityId: tenantId, metadata: { reason, operator: op.email } });
      // Suspending only blocks phones (every request and refresh is refused with the reason), so reinstating lets them
      // carry on; revoking signs them out.
      return action === 'revoke';
    });
    if (endPhones) await this.endAllPhones(tenantId);
    await this.log(op.id, `mobile.${action}`, tenantId, { reason }, ip);
    return this.detail(op, tenantId, ip);
  }

  async setLimits(op: OperatorContext, tenantId: string, maxDevices: number | null, reason: string, ip: string | null): Promise<OperatorMobileDetail> {
    await this.prisma.run({ tenantId }, async (tx) => {
      const tenant = await tx.tenant.findFirst({ where: { id: tenantId, deletedAt: null }, select: { id: true } });
      if (!tenant) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Workspace not found.' });
      await tx.mobileAccess.upsert({ where: { tenantId }, create: { tenantId, maxDevices }, update: { maxDevices } });
      await this.audit.record(tx, { tenantId, actorUserId: null, actorType: 'PLATFORM_ADMIN', action: 'mobile.limits_changed', entityType: 'mobile_access', entityId: tenantId, metadata: { maxDevices, reason, operator: op.email } });
    });
    await this.log(op.id, 'mobile.limits', tenantId, { maxDevices, reason }, ip);
    return this.detail(op, tenantId, ip);
  }

  private async log(operatorId: string, action: string, targetTenantId: string | null, metadata: Record<string, unknown>, ip: string | null): Promise<void> {
    await this.prisma.platformAuditLog.create({ data: { operatorId, action, targetTenantId, metadata: metadata as Prisma.InputJsonValue, ip } });
  }
}
