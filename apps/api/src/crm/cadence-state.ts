import type { TenantTx } from '@dealflow/database';
import { type ContactCadence, type FollowUpCadence, type InitialEmailSource, parseFollowUpCadence, type ResolvedCadence, resolveCadence } from '@dealflow/types';

/** The organisation's follow-up cadence (ADR 0083, rules from ADR 0096); the default when it was never set. */
export async function cadenceSettingOf(tx: TenantTx, tenantId: string): Promise<FollowUpCadence> {
  const row = await tx.crmSettings.findUnique({ where: { tenantId }, select: { followUpCadence: true } });
  return parseFollowUpCadence(row?.followUpCadence);
}

/**
 * The team (Manager Workspace) of each person (ADR 0096): their own workspace when it is a Manager Workspace, its
 * parent when it is an Executive Workspace, none in the Super Workspace or without workspaces.
 */
export async function teamsOf(tx: TenantTx, tenantId: string, userIds: (string | null | undefined)[]): Promise<Map<string, string>> {
  const ids = [...new Set(userIds.filter((v): v is string => !!v))];
  const out = new Map<string, string>();
  if (!ids.length) return out;
  const members = await tx.membership.findMany({ where: { tenantId, userId: { in: ids }, status: 'ACTIVE' }, select: { userId: true, workspaceNodeId: true } });
  const nodeIds = [...new Set(members.map((m) => m.workspaceNodeId).filter((v): v is string => !!v))];
  if (!nodeIds.length) return out;
  const nodes = new Map((await tx.workspaceNode.findMany({ where: { tenantId, id: { in: nodeIds } }, select: { id: true, level: true, parentId: true } })).map((n) => [n.id, n]));
  for (const m of members) {
    const n = m.workspaceNodeId ? nodes.get(m.workspaceNodeId) : undefined;
    if (n?.level === 'MANAGER') out.set(m.userId, n.id);
    else if (n?.level === 'EXECUTIVE' && n.parentId) out.set(m.userId, n.parentId);
  }
  return out;
}

/** The cadence each contact follows: its company's rule, else its owner's team's, else the organisation's. */
export async function resolvedCadences(
  tx: TenantTx,
  tenantId: string,
  contacts: { id: string; companyId: string | null; ownerId: string | null }[],
  setting?: FollowUpCadence,
): Promise<Map<string, ResolvedCadence>> {
  const c = setting ?? (await cadenceSettingOf(tx, tenantId));
  const teams = c.rules.some((r) => r.scope === 'TEAM') ? await teamsOf(tx, tenantId, contacts.map((x) => x.ownerId)) : new Map<string, string>();
  return new Map(contacts.map((x) => [x.id, resolveCadence(c, x.companyId, x.ownerId ? teams.get(x.ownerId) : null)]));
}

/** Cadence state of several employees (lists, the employee card). A plain function so the stages service can use it without a cycle. */
export async function cadenceStates(tx: TenantTx, tenantId: string, contactIds: string[], now = new Date()): Promise<Map<string, ContactCadence>> {
  const out = new Map<string, ContactCadence>();
  if (!contactIds.length) return out;
  const setting = await cadenceSettingOf(tx, tenantId);
  const [contacts, tasks] = await Promise.all([
    tx.contact.findMany({
      where: { tenantId, id: { in: contactIds } },
      select: { id: true, initialEmailAt: true, initialEmailSource: true, cadenceMovesAt: true, cadenceStoppedAt: true, cadenceStopReason: true, companyId: true, ownerId: true, stageId: true },
    }),
    tx.task.findMany({ where: { tenantId, contactId: { in: contactIds }, deletedAt: null, cadenceStep: { not: null } }, select: { id: true, contactId: true, cadenceStep: true, status: true, dueAt: true } }),
  ]);
  const resolved = await resolvedCadences(tx, tenantId, contacts, setting);
  const stageIds = [...new Set(contacts.map((c) => c.stageId).filter((v): v is string => !!v))];
  const stageKey = new Map((stageIds.length ? await tx.crmStatus.findMany({ where: { tenantId, id: { in: stageIds } }, select: { id: true, key: true } }) : []).map((s) => [s.id, s.key]));
  for (const c of contacts) {
    const followUps = resolved.get(c.id)!.followUps;
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
      initialEmailSource: (c.initialEmailSource as InitialEmailSource | null) ?? null,
      movesAt: !c.cadenceStoppedAt && c.cadenceMovesAt ? c.cadenceMovesAt.toISOString() : null,
    });
  }
  return out;
}
