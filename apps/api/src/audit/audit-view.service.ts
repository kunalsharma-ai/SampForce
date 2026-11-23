import { ForbiddenException, Injectable } from '@nestjs/common';
import type { Prisma, TenantTx } from '@dealflow/database';
import {
  type AuditLogFilters,
  type AuditLogPage,
  type AuditLogQuery,
  type AuditLogRow,
  type AuditScope,
  auditCategoryMatchers,
  auditCategoryOf,
  FEATURE_BY_KEY,
  type FeatureKey,
  TARGET_METRIC_LABEL,
  TARGET_PERIOD_LABEL,
  type TargetMetric,
  type TargetPeriod,
} from '@dealflow/types';
import type { AuthContext } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { branchIds, resolveOrganisation, type StoredNode } from '../workspaces/access';

/**
 * Reading the organisation's audit log by workspace level (ADR 0071, part 7). The Super Workspace reads everything
 * its organisation recorded. A Manager Workspace reads only what its own team did, or what was done to its team's
 * workspaces, and only while the Super Workspace allows it. Executive Workspaces never read the log. The entries
 * themselves stay append-only: nothing here changes them.
 */

interface Reach {
  scope: AuditScope;
  /** Null = the whole organisation. */
  userIds: string[] | null;
  workspaceIds: string[] | null;
  nodes: StoredNode[];
}

const auditNotPermitted = () =>
  new ForbiddenException({ code: 'AUDIT_NOT_PERMITTED', message: 'Your Super Workspace has not let your workspace read the audit log.' });

const asStrings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const featureName = (k: string) => FEATURE_BY_KEY[k as FeatureKey]?.label ?? k;

/** Short lines saying what changed, from the shapes the services write. */
export function changeLines(metadata: unknown): string[] {
  if (!metadata || typeof metadata !== 'object') return [];
  const m = metadata as Record<string, unknown>;
  const out: string[] = [];
  if (Array.isArray(m.changes)) {
    for (const c of m.changes) {
      if (typeof c === 'string') out.push(c);
      else if (c && typeof c === 'object' && 'field' in c) {
        const x = c as { field: string; from?: unknown; to?: unknown };
        out.push(`${x.field}: ${x.from ?? 'none'} → ${x.to ?? 'none'}`);
      }
    }
  }
  const on = asStrings(m.featuresEnabled);
  const off = asStrings(m.featuresDisabled);
  if (on.length) out.push(`Switched on: ${on.map(featureName).join(', ')}`);
  if (off.length) out.push(`Switched off: ${off.map(featureName).join(', ')}`);
  for (const [key, label] of [
    ['canCreateExecutives', 'May create Executive Workspaces'],
    ['canViewOtherManagers', 'May see other managers’ reports'],
    ['canViewAuditLog', 'May read its team’s audit log'],
    ['canChatWithPeers', 'May chat with workspaces of its level'],
  ] as const)
    if (typeof m[key] === 'boolean') out.push(`${label}: ${m[key] ? 'yes' : 'no'}`);
  if (m.actionsTo !== undefined) out.push('Actions changed');
  if (typeof m.amountFrom === 'number' && typeof m.amountTo === 'number' && m.amountFrom !== m.amountTo) out.push(`Amount: ${m.amountFrom} → ${m.amountTo}`);
  if (typeof m.metric === 'string' && typeof m.amount === 'number')
    out.push(`${TARGET_METRIC_LABEL[m.metric as TargetMetric] ?? m.metric}, ${TARGET_PERIOD_LABEL[m.period as TargetPeriod] ?? m.period ?? ''}: ${m.amount}`.replace(', :', ':'));
  if (typeof m.reason === 'string' && m.reason) out.push(`Reason: ${m.reason}`);
  return out;
}

@Injectable()
export class AuditViewService {
  constructor(private readonly prisma: PrismaService) {}

  async list(auth: AuthContext, q: AuditLogQuery): Promise<AuditLogPage> {
    return this.prisma.run(auth, async (tx) => {
      const reach = await this.reach(tx, auth);
      const where = await this.where(tx, auth, reach, q);
      const rows = await tx.auditLog.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: q.limit + 1,
        ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
      });
      const page = rows.slice(0, q.limit);
      return { items: await this.rows(tx, auth, reach, page), nextCursor: rows.length > q.limit ? (page.at(-1)?.id ?? null) : null, scope: reach.scope };
    });
  }

  async filters(auth: AuthContext): Promise<AuditLogFilters> {
    return this.prisma.run(auth, async (tx) => {
      const reach = await this.reach(tx, auth);
      const nodes = reach.nodes.filter((n) => !reach.workspaceIds || reach.workspaceIds.includes(n.id));
      const members = await tx.membership.findMany({
        where: { tenantId: auth.tenantId, ...(reach.userIds ? { userId: { in: reach.userIds } } : {}) },
        select: { user: { select: { id: true, name: true } } },
      });
      const people = [...new Map(members.map((m) => [m.user.id, { id: m.user.id, name: m.user.name }])).values()].sort((a, b) => a.name.localeCompare(b.name));
      return { scope: reach.scope, workspaces: nodes.map((n) => ({ id: n.id, name: n.name, level: n.level })), people };
    });
  }

  /** What the caller may read: the organisation, or its own team. */
  private async reach(tx: TenantTx, auth: AuthContext): Promise<Reach> {
    const org = await resolveOrganisation(tx, auth.tenantId);
    const nodes = [...org.byId.values()].map((a) => a.node);
    const me = auth.workspaceNodeId ? org.byId.get(auth.workspaceNodeId) : org.root;
    if (!me || me.level === 'SUPER') return { scope: 'ORGANISATION', userIds: null, workspaceIds: null, nodes };
    if (me.level !== 'MANAGER' || !me.node.canViewAuditLog || me.node.archivedAt) throw auditNotPermitted();
    const ids = [...branchIds(nodes, me.node.id)];
    // Everyone who has worked in the team, including people who have since left it, so their entries stay readable.
    const members = await tx.membership.findMany({ where: { tenantId: auth.tenantId, workspaceNodeId: { in: ids } }, select: { userId: true } });
    return { scope: 'TEAM', userIds: [...new Set(members.map((m) => m.userId))], workspaceIds: ids, nodes };
  }

  private async where(tx: TenantTx, auth: AuthContext, reach: Reach, q: AuditLogQuery): Promise<Prisma.AuditLogWhereInput> {
    const and: Prisma.AuditLogWhereInput[] = [{ tenantId: auth.tenantId }];
    if (reach.userIds && reach.workspaceIds)
      and.push({ OR: [{ actorUserId: { in: reach.userIds } }, { entityType: 'workspace', entityId: { in: reach.workspaceIds } }] });
    if (q.category) {
      const { exact, prefixes } = auditCategoryMatchers(q.category);
      and.push({ OR: [...(exact.length ? [{ action: { in: exact } }] : []), ...prefixes.map((p) => ({ action: { startsWith: p } }))] });
    }
    // The Super Workspace and everything below it is the whole organisation: no narrowing needed.
    const chosen = q.workspaceId ? reach.nodes.find((n) => n.id === q.workspaceId) : undefined;
    if (q.workspaceId && chosen?.level !== 'SUPER') {
      if (!chosen || (reach.workspaceIds && !reach.workspaceIds.includes(q.workspaceId))) throw auditNotPermitted();
      const ids = [...branchIds(reach.nodes, q.workspaceId)];
      const members = await tx.membership.findMany({ where: { tenantId: auth.tenantId, workspaceNodeId: { in: ids } }, select: { userId: true } });
      and.push({ OR: [{ actorUserId: { in: [...new Set(members.map((m) => m.userId))] } }, { entityType: 'workspace', entityId: { in: ids } }] });
    }
    if (q.actorUserId) and.push({ actorUserId: q.actorUserId });
    // Entries written before outcomes were recorded have none: they all happened.
    if (q.outcome) and.push(q.outcome === 'REFUSED' ? { outcome: 'REFUSED' } : { outcome: { not: 'REFUSED' } });
    if (q.from) and.push({ createdAt: { gte: new Date(`${q.from}T00:00:00.000Z`) } });
    if (q.to) and.push({ createdAt: { lt: new Date(new Date(`${q.to}T00:00:00.000Z`).getTime() + 86_400_000) } });
    return { AND: and };
  }

  private async rows(tx: TenantTx, auth: AuthContext, reach: Reach, page: Prisma.AuditLogGetPayload<object>[]): Promise<AuditLogRow[]> {
    const tenantId = auth.tenantId;
    const actorIds = [...new Set(page.map((r) => r.actorUserId).filter((v): v is string => !!v))];
    const ids = (type: string) => [...new Set(page.filter((r) => r.entityType === type && r.entityId).map((r) => r.entityId!))];
    const [users, memberships, tasks, companies, contacts, leads, deals, targets, tickets] = await Promise.all([
      actorIds.length ? this.prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } }) : [],
      actorIds.length ? tx.membership.findMany({ where: { tenantId, userId: { in: actorIds } }, select: { userId: true, workspaceNodeId: true } }) : [],
      ids('task').length ? tx.task.findMany({ where: { tenantId, id: { in: ids('task') } }, select: { id: true, title: true } }) : [],
      ids('company').length ? tx.company.findMany({ where: { tenantId, id: { in: ids('company') } }, select: { id: true, name: true } }) : [],
      ids('contact').length ? tx.contact.findMany({ where: { tenantId, id: { in: ids('contact') } }, select: { id: true, firstName: true, lastName: true } }) : [],
      ids('lead').length ? tx.lead.findMany({ where: { tenantId, id: { in: ids('lead') } }, select: { id: true, fullName: true } }) : [],
      ids('deal').length ? tx.opportunity.findMany({ where: { tenantId, id: { in: ids('deal') } }, select: { id: true, name: true } }) : [],
      ids('workspace_target').length ? tx.workspaceTarget.findMany({ where: { tenantId, id: { in: ids('workspace_target') } }, select: { id: true, metric: true, period: true, workspaceNodeId: true } }) : [],
      ids('support_ticket').length ? tx.supportTicket.findMany({ where: { tenantId, id: { in: ids('support_ticket') } }, select: { id: true, number: true, subject: true } }) : [],
    ]);
    const nodeById = new Map(reach.nodes.map((n) => [n.id, n]));
    const name = new Map(users.map((u) => [u.id, u.name]));
    const seat = new Map(memberships.map((m) => [m.userId, m.workspaceNodeId]));
    const rootNode = reach.nodes.find((n) => n.level === 'SUPER' && !n.parentId);
    const label = new Map<string, string>([
      ...tasks.map((t) => [t.id, t.title] as const),
      ...companies.map((c) => [c.id, c.name] as const),
      ...contacts.map((c) => [c.id, [c.firstName, c.lastName].filter(Boolean).join(' ')] as const),
      ...leads.map((l) => [l.id, l.fullName] as const),
      ...deals.map((d) => [d.id, d.name] as const),
      ...targets.map((t) => [t.id, `${TARGET_METRIC_LABEL[t.metric as TargetMetric] ?? t.metric}, ${TARGET_PERIOD_LABEL[t.period as TargetPeriod] ?? t.period}: ${nodeById.get(t.workspaceNodeId)?.name ?? ''}`.replace(/: $/, '')] as const),
      ...tickets.map((t) => [t.id, `#${t.number} ${t.subject}`] as const),
    ]);

    return page.map((r) => {
      const m = (r.metadata ?? {}) as Record<string, unknown>;
      const nodeId = r.actorUserId ? seat.get(r.actorUserId) : undefined;
      const node = nodeId ? nodeById.get(nodeId) : r.actorUserId ? rootNode : undefined;
      const fromMeta = [m.name, m.title, m.subject, m.workspace, m.email].find((v): v is string => typeof v === 'string' && !!v) ?? null;
      const recordLabel = !r.entityType
        ? null
        : r.entityType === 'workspace'
          ? (r.entityId ? nodeById.get(r.entityId)?.name : null) ?? fromMeta ?? (r.entityId?.startsWith('root:') || r.entityId === rootNode?.id ? 'Super Workspace' : null)
          : r.entityType === 'subscription'
            ? 'Subscription'
            : (r.entityId ? label.get(r.entityId) : null) ?? fromMeta;
      const actorName = r.actorUserId ? (name.get(r.actorUserId) ?? null) : null;
      return {
        id: r.id,
        action: r.action,
        outcome: r.outcome === 'REFUSED' ? 'REFUSED' : 'DONE',
        category: auditCategoryOf(r.action),
        actorType: r.actorType,
        actorName,
        actor: r.actorUserId && actorName ? { id: r.actorUserId, name: actorName, workspace: node ? { id: node.id, name: node.name, level: node.level } : null } : null,
        entityType: r.entityType,
        entityId: r.entityId,
        record: r.entityType ? { type: r.entityType, id: r.entityId, label: recordLabel ?? null } : null,
        changes: changeLines(m),
        metadata: r.metadata,
        ipAddress: r.ipAddress,
        createdAt: r.createdAt.toISOString(),
      };
    });
  }
}
