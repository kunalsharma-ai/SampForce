'use client';

import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Skeleton } from '@dealflow/ui';
import { AUDIT_CATEGORIES, AUDIT_CATEGORY_LABEL, type AuditCategory, type AuditLogFilters, type AuditLogPage, type AuditLogRow } from '@dealflow/types';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { Select } from '@/components/crm/select';
import { InfoTip } from '@/components/info-tip';
import { api, ApiError } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { fmtLocale } from '@/lib/i18n/locale';

/**
 * The audit log by workspace level (ADR 0071, part 7): the Super Workspace reads its organisation, a manager its own
 * team once the Super Workspace allows it. Each entry says who, what, which record and when. The server decides what
 * the caller may read; the filters only narrow it.
 */

/** What each recorded action means, in words. Anything not listed is shown by its code. */
const ACTION_LABEL: Record<string, string> = {
  'workspace.created': 'Created a workspace',
  'workspace.updated': 'Changed a workspace',
  'workspace.moved': 'Moved a workspace to another team',
  'workspace.archived': 'Archived a workspace',
  'workspace.member_assigned': 'Placed a person in a workspace',
  'workspace.permissions_changed': 'Changed a workspace’s permissions',
  'workspace.features_changed': 'Switched features on or off',
  'workspace.limits_changed': 'Changed the workspace limits',
  'billing.subscription_changed': 'Changed the subscription',
  'billing.features_overridden': 'Changed the plan’s features',
  'billing.plan_overridden': 'Changed the plan',
  'tenant.updated': 'Changed the organisation’s settings',
  'tenant.suspended': 'Suspended the organisation',
  'tenant.reactivated': 'Reactivated the organisation',
  'target.set': 'Set a sales target',
  'target.updated': 'Changed a sales target',
  'target.distributed': 'Split a sales target',
  'target.removed': 'Removed a sales target',
  'task.created': 'Created a task',
  'task.assigned': 'Assigned a task',
  'task.updated': 'Changed a task',
  'task.completed': 'Completed a task',
  'task.commented': 'Commented on a task',
  'task.deleted': 'Deleted a task',
  'company.created': 'Added a company',
  'company.updated': 'Edited a company',
  'company.deleted': 'Deleted a company',
  'contact.created': 'Added a contact',
  'contact.updated': 'Edited a contact',
  'contact.deleted': 'Deleted a contact',
  'lead.created': 'Added a lead',
  'lead.deleted': 'Deleted a lead',
  'deal.created': 'Added a deal',
  'deal.updated': 'Edited a deal',
  'deal.deleted': 'Deleted a deal',
  'role.created': 'Created a role',
  'role.updated': 'Changed a role',
  'role.deleted': 'Deleted a role',
  'member.role_changed': 'Changed a person’s role',
  'member.invited': 'Invited a person',
  'member.joined': 'Joined the organisation',
  'support_ticket.raised': 'Raised a support query',
  'support_ticket.escalated': 'Passed a support query up',
};

const RECORD_LABEL: Record<string, string> = {
  workspace: 'Workspace',
  task: 'Task',
  company: 'Company',
  contact: 'Contact',
  lead: 'Lead',
  deal: 'Deal',
  workspace_target: 'Sales target',
  subscription: 'Subscription',
  support_ticket: 'Support query',
  tenant: 'Organisation',
  role: 'Role',
  invitation: 'Invitation',
  membership: 'Member',
};

const LEVEL_LABEL: Record<string, string> = { SUPER: 'Super Workspace', MANAGER: 'Manager Workspace', EXECUTIVE: 'Executive Workspace' };

const ACTOR_LABEL: Record<string, string> = { SYSTEM: 'System', AI_AGENT: 'AI agent', PLATFORM_ADMIN: 'SampForce Console' };

interface Filters {
  category: AuditCategory | '';
  workspaceId: string;
  actorUserId: string;
  from: string;
  to: string;
}
const NO_FILTERS: Filters = { category: '', workspaceId: '', actorUserId: '', from: '', to: '' };

function queryOf(f: Filters, cursor: string | null): string {
  const p = new URLSearchParams({ limit: '25' });
  for (const [k, v] of Object.entries(f)) if (v) p.set(k, v);
  if (cursor) p.set('cursor', cursor);
  return p.toString();
}

export function AuditLogView() {
  const t = useT();
  const [f, setF] = useState<Filters>(NO_FILTERS);
  const id = useId();
  const set = (patch: Partial<Filters>) => setF((prev) => ({ ...prev, ...patch }));
  const options = useQuery({ queryKey: ['audit-logs', 'filters'], queryFn: () => api<AuditLogFilters>('/audit-logs/filters'), retry: false });
  const log = useInfiniteQuery({
    queryKey: ['audit-logs', f],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => api<AuditLogPage>(`/audit-logs?${queryOf(f, pageParam)}`),
    getNextPageParam: (last) => last.nextCursor,
    retry: false,
  });

  const refused = log.error instanceof ApiError && log.error.status === 403 ? log.error : null;
  if (refused) {
    return (
      <Card className="p-5 text-sm text-muted-foreground" data-audit-refused>
        {refused.code === 'AUDIT_NOT_PERMITTED' ? t('Your Super Workspace has not let your workspace read the audit log.') : t('Your role does not include access to the audit log.')}
      </Card>
    );
  }
  const rows = log.data?.pages.flatMap((p) => p.items) ?? [];
  const scope = log.data?.pages[0]?.scope ?? options.data?.scope;
  const filtered = Object.values(f).some(Boolean);

  return (
    <Card data-audit-log data-audit-scope={scope}>
      <CardHeader>
        <div className="flex items-center gap-1.5">
          <CardTitle>{t('Audit log')}</CardTitle>
          <InfoTip topic="admin.auditLog" />
        </div>
        <CardDescription>
          {scope === 'TEAM'
            ? t('What the people of your team did, and what was done to your team’s workspaces. Entries cannot be changed or deleted.')
            : t('Everything your organisation recorded: who did it, what they did, which record it touched and when. Entries cannot be changed or deleted.')}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5" role="group" aria-label={t('Filter the audit log')}>
          <div className="space-y-1 text-sm">
            <label htmlFor={`${id}-1`} className="block font-medium">{t('Kind of change')}</label>
            <Select id={`${id}-1`} value={f.category} onChange={(e) => set({ category: e.target.value as AuditCategory | '' })}>
              <option value="">{t('All kinds')}</option>
              {AUDIT_CATEGORIES.map((c) => (
                <option key={c} value={c}>{t(AUDIT_CATEGORY_LABEL[c])}</option>
              ))}
            </Select>
          </div>
          <div className="space-y-1 text-sm">
            <label htmlFor={`${id}-2`} className="block font-medium">{t('Workspace')}</label>
            <Select id={`${id}-2`} value={f.workspaceId} onChange={(e) => set({ workspaceId: e.target.value })}>
              <option value="">{t('All workspaces')}</option>
              {options.data?.workspaces.map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </Select>
          </div>
          <div className="space-y-1 text-sm">
            <label htmlFor={`${id}-3`} className="block font-medium">{t('Person')}</label>
            <Select id={`${id}-3`} value={f.actorUserId} onChange={(e) => set({ actorUserId: e.target.value })}>
              <option value="">{t('Everyone')}</option>
              {options.data?.people.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </Select>
          </div>
          <div className="space-y-1 text-sm">
            <label htmlFor={`${id}-4`} className="block font-medium">{t('From')}</label>
            <Input id={`${id}-4`} type="date" value={f.from} max={f.to || undefined} onChange={(e) => set({ from: e.target.value })} />
          </div>
          <div className="space-y-1 text-sm">
            <label htmlFor={`${id}-5`} className="block font-medium">{t('To')}</label>
            <Input id={`${id}-5`} type="date" value={f.to} min={f.from || undefined} onChange={(e) => set({ to: e.target.value })} />
          </div>
        </div>
        {filtered && (
          <Button variant="outline" size="sm" onClick={() => setF(NO_FILTERS)}>
            {t('Clear filters')}
          </Button>
        )}

        <div className="overflow-x-auto">
          {log.isPending ? (
            <Skeleton className="h-40" />
          ) : rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{t('Nothing recorded matches these filters.')}</p>
          ) : (
            <table className="w-full min-w-[760px] text-sm">
              <caption className="sr-only">{t('Audit events, newest first')}</caption>
              <thead className="text-start text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="py-2 pe-3 text-start font-medium">{t('When')}</th>
                  <th scope="col" className="py-2 pe-3 text-start font-medium">{t('Who')}</th>
                  <th scope="col" className="py-2 pe-3 text-start font-medium">{t('What')}</th>
                  <th scope="col" className="py-2 text-start font-medium">{t('Record')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <AuditRow key={r.id} row={r} />
                ))}
              </tbody>
            </table>
          )}
        </div>
        {log.hasNextPage && (
          <Button variant="outline" size="sm" onClick={() => log.fetchNextPage()} disabled={log.isFetchingNextPage}>
            {log.isFetchingNextPage ? t('Loading…') : t('Load more')}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function AuditRow({ row: r }: { row: AuditLogRow }) {
  const t = useT();
  const when = new Date(r.createdAt);
  const label = ACTION_LABEL[r.action];
  return (
    <tr className="border-t border-border align-top" data-audit-entry={r.action}>
      <td className="py-2.5 pe-3 tabular text-muted-foreground">
        <time dateTime={r.createdAt}>
          <span className="block">{when.toLocaleDateString(fmtLocale(), { dateStyle: 'medium' })}</span>
          <span className="block text-xs">{when.toLocaleTimeString(fmtLocale(), { timeStyle: 'short' })}</span>
        </time>
      </td>
      <td className="py-2.5 pe-3" data-audit-actor>
        <span className="block font-medium">{r.actor?.name ?? r.actorName ?? t.maybe(ACTOR_LABEL[r.actorType] ?? 'System')}</span>
        {r.actor?.workspace && (
          <span className="block text-xs text-muted-foreground">
            {r.actor.workspace.name === LEVEL_LABEL[r.actor.workspace.level]
              ? t.maybe(r.actor.workspace.name)
              : `${r.actor.workspace.name} · ${t.maybe(LEVEL_LABEL[r.actor.workspace.level] ?? r.actor.workspace.level)}`}
          </span>
        )}
      </td>
      <td className="py-2.5 pe-3">
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="font-medium">{label ? t.maybe(label) : r.action}</span>
          {r.category && <Badge>{t(AUDIT_CATEGORY_LABEL[r.category])}</Badge>}
        </span>
        {label && <span className="block font-mono text-xs text-muted-foreground">{r.action}</span>}
        {r.changes.length > 0 && (
          <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground" data-audit-changes>
            {r.changes.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        )}
      </td>
      <td className="py-2.5" data-audit-record>
        {r.record ? (
          <>
            <span className="block">{r.record.label ? t.maybe(r.record.label) : '—'}</span>
            {r.record.label !== RECORD_LABEL[r.record.type] && <span className="block text-xs text-muted-foreground">{t.maybe(RECORD_LABEL[r.record.type] ?? r.record.type)}</span>}
          </>
        ) : (
          '—'
        )}
      </td>
    </tr>
  );
}
