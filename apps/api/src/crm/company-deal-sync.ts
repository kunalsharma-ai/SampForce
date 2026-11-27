import type { TenantTx } from '@dealflow/database';
import type { AuditService } from '../audit/audit.service';
import type { AuthContext, RequestMeta } from '../common/auth-context';

/**
 * The company status a won client gets (ADR 0084): a status meaning CLIENT, preferring one named like "Existing
 * Client" over "Receiving Regular RFQs", or null when the workspace has none.
 */
export async function clientStatusId(tx: TenantTx, tenantId: string): Promise<string | null> {
  const rows = await tx.crmStatus.findMany({ where: { tenantId, kind: 'COMPANY', meaning: 'CLIENT', archivedAt: null }, orderBy: { position: 'asc' }, select: { id: true, name: true } });
  return (rows.find((r) => /client/i.test(r.name)) ?? rows[0])?.id ?? null;
}

export async function isClientStatus(tx: TenantTx, tenantId: string, statusId: string | null | undefined): Promise<boolean> {
  if (!statusId) return false;
  const s = await tx.crmStatus.findFirst({ where: { id: statusId, tenantId }, select: { meaning: true } });
  return s?.meaning === 'CLIENT';
}

/**
 * A deal was won: its company becomes a client (when it is not one already) and remembers the deal as its win, so
 * the company-won automation never makes a second deal for it. Plain function so DealsService can call it without
 * depending on the company services.
 */
export async function companyWonByDeal(tx: TenantTx, audit: AuditService, auth: AuthContext, companyId: string, dealId: string, meta: RequestMeta): Promise<void> {
  const c = await tx.company.findFirst({ where: { id: companyId, tenantId: auth.tenantId, deletedAt: null }, select: { id: true, statusId: true, wonDealId: true } });
  if (!c) return;
  const now = new Date();
  const data: { wonDealId?: string; wonAt?: Date; statusId?: string; statusChangedAt?: Date; statusChangedById?: string; updatedById?: string } = {};
  if (!c.wonDealId) Object.assign(data, { wonDealId: dealId, wonAt: now });
  if (!(await isClientStatus(tx, auth.tenantId, c.statusId))) {
    const to = await clientStatusId(tx, auth.tenantId);
    if (to) Object.assign(data, { statusId: to, statusChangedAt: now, statusChangedById: auth.userId, updatedById: auth.userId });
  }
  if (!Object.keys(data).length) return;
  await tx.company.update({ where: { id: companyId }, data });
  if (data.statusId) {
    await audit.record(tx, {
      tenantId: auth.tenantId, actorUserId: auth.userId, action: 'company.status_changed', entityType: 'company', entityId: companyId,
      metadata: { from: c.statusId, to: data.statusId, source: 'DEAL_WON', dealId }, meta,
    });
  }
}
