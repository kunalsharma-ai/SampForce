import type { TenantTx } from '@dealflow/database';
import { type ContactCadence, type FollowUpCadence, parseFollowUpCadence } from '@dealflow/types';

/** The organisation's follow-up cadence (ADR 0083); the default when it was never set. */
export async function cadenceSettingOf(tx: TenantTx, tenantId: string): Promise<FollowUpCadence> {
  const row = await tx.crmSettings.findUnique({ where: { tenantId }, select: { followUpCadence: true } });
  return parseFollowUpCadence(row?.followUpCadence);
}

/** Cadence state of several employees (lists, the employee card). A plain function so the stages service can use it without a cycle. */
export async function cadenceStates(tx: TenantTx, tenantId: string, contactIds: string[], now = new Date()): Promise<Map<string, ContactCadence>> {
  const out = new Map<string, ContactCadence>();
  if (!contactIds.length) return out;
  const { followUps } = await cadenceSettingOf(tx, tenantId);
  const [contacts, tasks] = await Promise.all([
    tx.contact.findMany({ where: { tenantId, id: { in: contactIds } }, select: { id: true, initialEmailAt: true, cadenceStoppedAt: true, cadenceStopReason: true, companyId: true, stageId: true } }),
    tx.task.findMany({ where: { tenantId, contactId: { in: contactIds }, deletedAt: null, cadenceStep: { not: null } }, select: { id: true, contactId: true, cadenceStep: true, status: true, dueAt: true } }),
  ]);
  const stageIds = [...new Set(contacts.map((c) => c.stageId).filter((v): v is string => !!v))];
  const stageKey = new Map((stageIds.length ? await tx.crmStatus.findMany({ where: { tenantId, id: { in: stageIds } }, select: { id: true, key: true } }) : []).map((s) => [s.id, s.key]));
  for (const c of contacts) {
    const key = c.stageId ? (stageKey.get(c.stageId) ?? null) : null;
    const mine = tasks.filter((t) => t.contactId === c.id);
    const completed = mine.filter((t) => t.status === 'DONE').length;
    const open = mine.filter((t) => t.status === 'OPEN').sort((a, b) => (a.cadenceStep ?? 0) - (b.cadenceStep ?? 0))[0];
    const state: ContactCadence['state'] = !c.initialEmailAt
      ? key === 'FRESH_EMAIL_PENDING' || (!c.stageId && c.companyId) ? 'FRESH' : 'NONE'
      : c.cadenceStoppedAt ? 'STOPPED' : open ? 'ACTIVE' : completed >= followUps ? 'COMPLETE' : 'ACTIVE';
    out.set(c.id, {
      state,
      initialEmailAt: c.initialEmailAt?.toISOString() ?? null,
      completed,
      total: followUps,
      next: open?.dueAt ? { taskId: open.id, step: open.cadenceStep!, dueAt: open.dueAt.toISOString(), overdue: open.dueAt < now } : null,
      stoppedReason: c.cadenceStoppedAt ? c.cadenceStopReason : null,
    });
  }
  return out;
}
