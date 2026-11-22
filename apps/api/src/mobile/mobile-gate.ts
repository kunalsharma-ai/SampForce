import { ForbiddenException } from '@nestjs/common';
import type { TenantTx } from '@dealflow/database';
import type { MobileAccessState, MobileAccessStatus, MobileBlockReason } from '@dealflow/types';
import { entitlementsFor } from '../billing/entitlements';

/**
 * The mobile gate (ADR 0072): whether phones of one organisation may use SampForce right now. Checked at sign-in, at
 * every refresh and on every request a phone makes, so a Console decision or a Super Workspace switch takes effect
 * at once, whatever the phone has cached.
 */

type Reader = Pick<TenantTx, 'plan' | 'subscription' | 'tenantFeatureOverride' | 'mobileAccess' | 'tenant'>;

export interface MobileGateRow {
  status: string;
  activatedAt: Date | null;
}

/** Why phones are blocked, from the organisation's status, plan and mobile access row; null = they may sign in. */
export function blockReason(input: { tenantActive: boolean; inPlan: boolean; row: MobileGateRow | null }): MobileBlockReason | null {
  if (!input.tenantActive) return 'WORKSPACE_SUSPENDED';
  const status = (input.row?.status ?? 'OFF') as MobileAccessStatus;
  if (status === 'SUSPENDED') return 'SUSPENDED';
  if (status === 'REVOKED') return 'REVOKED';
  if (status !== 'APPROVED') return 'NOT_APPROVED';
  if (!input.inPlan) return 'NOT_IN_PLAN';
  if (!input.row?.activatedAt) return 'NOT_ACTIVATED';
  return null;
}

export async function mobileBlockReason(tx: Reader, tenantId: string): Promise<MobileBlockReason | null> {
  const [tenant, row, ent] = await Promise.all([
    tx.tenant.findUnique({ where: { id: tenantId }, select: { status: true, deletedAt: true } }),
    tx.mobileAccess.findUnique({ where: { tenantId }, select: { status: true, activatedAt: true } }),
    entitlementsFor(tx, tenantId),
  ]);
  return blockReason({ tenantActive: !!tenant && tenant.status === 'ACTIVE' && !tenant.deletedAt, inPlan: ent.features.includes('mobile_app'), row });
}

const BLOCK_MESSAGE: Record<MobileBlockReason, string> = {
  NOT_IN_PLAN: 'The mobile app is not included in your organisation’s plan.',
  NOT_APPROVED: 'Mobile access has not been approved for your organisation yet.',
  SUSPENDED: 'Mobile access for your organisation is suspended. You can keep using SampForce in your browser.',
  REVOKED: 'Mobile access for your organisation has been withdrawn. You can keep using SampForce in your browser.',
  NOT_ACTIVATED: 'Your organisation has not switched on the mobile app yet. Ask your administrator.',
  WORKSPACE_SUSPENDED: 'This workspace is suspended.',
};

/** The refusal a phone gets: the reason travels in `details` so the app can show the right screen. */
export function mobileBlocked(reason: MobileBlockReason): ForbiddenException {
  return new ForbiddenException({ code: 'MOBILE_ACCESS_BLOCKED', message: BLOCK_MESSAGE[reason], details: [{ path: 'reason', message: reason }] });
}

/** The full state the Console and the Super Workspace see. */
export async function mobileAccessState(tx: Pick<TenantTx, 'plan' | 'subscription' | 'tenantFeatureOverride' | 'mobileAccess' | 'mobileDevice' | 'tenant' | 'user'>, tenantId: string): Promise<MobileAccessState> {
  const [tenant, row, ent, devices] = await Promise.all([
    tx.tenant.findUnique({ where: { id: tenantId }, select: { status: true, deletedAt: true } }),
    tx.mobileAccess.findUnique({ where: { tenantId } }),
    entitlementsFor(tx, tenantId),
    tx.mobileDevice.groupBy({ by: ['platform'], where: { tenantId, signedOutAt: null }, _count: { _all: true } }),
  ]);
  const inPlan = ent.features.includes('mobile_app');
  const blockedBy = blockReason({ tenantActive: !!tenant && tenant.status === 'ACTIVE' && !tenant.deletedAt, inPlan, row });
  const names = new Map<string, string>();
  const ids = [row?.activatedById, row?.requestedById].filter((x): x is string => !!x);
  if (ids.length) for (const u of await tx.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })) names.set(u.id, u.name);
  const count = (p: string) => devices.find((d) => d.platform === p)?._count._all ?? 0;
  return {
    status: (row?.status ?? 'OFF') as MobileAccessStatus,
    inPlan,
    activated: !!row?.activatedAt,
    activatedAt: row?.activatedAt?.toISOString() ?? null,
    activatedBy: row?.activatedById ? (names.get(row.activatedById) ?? null) : null,
    live: blockedBy === null,
    blockedBy,
    request: row?.requestedAt ? { message: row.requestMessage, requestedAt: row.requestedAt.toISOString(), requestedBy: row.requestedById ? (names.get(row.requestedById) ?? null) : null } : null,
    decision: row?.decidedAt && row.decisionStatus ? { status: row.decisionStatus as MobileAccessStatus, reason: row.decisionReason, decidedAt: row.decidedAt.toISOString() } : null,
    maxDevices: row?.maxDevices ?? null,
    devices: { active: count('IOS') + count('ANDROID') + count('WEB'), ios: count('IOS'), android: count('ANDROID'), web: count('WEB') },
  };
}
