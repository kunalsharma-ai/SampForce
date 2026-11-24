'use client';

import { Badge, Button, Card, Input } from '@dealflow/ui';
import { CONSOLE_WORKSPACE_STATUS_LABEL, CONSOLE_WORKSPACE_STATUSES, type ConsoleDirectoryWorkspace, type ConsoleWorkspaceList, type ConsoleWorkspaceStatus } from '@dealflow/types';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Lock, Network, Search } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { ConsoleDenied, ConsoleEmpty, ConsoleError, ConsoleLoading } from '@/components/console/console-states';
import { day, LEVEL_LABEL, type WorkspaceActionKind, WorkspaceActionDialog, WorkspaceActionsMenu, WorkspaceStatusBadge } from '@/components/console/workspace-actions';
import { PageHeader } from '@/components/page-header';
import { api } from '@/lib/api';
import { selectClass } from '../console-ui';
import { can, useOperator } from '../operator-shell';

const LEVEL_TONE = { SUPER: 'accent', MANAGER: 'primary', EXECUTIVE: 'neutral' } as const;

/**
 * Workspace Management (workspace management, sections 18-22): every client's Super, Manager and Executive
 * Workspaces in one list, with who heads each, its status, users and parent, and the Console's actions on it.
 */
export default function ConsoleWorkspacesPage() {
  const me = useOperator();
  const [q, setQ] = useState('');
  const [level, setLevel] = useState('');
  const [status, setStatus] = useState<ConsoleWorkspaceStatus | ''>('');
  const [page, setPage] = useState(1);
  const [action, setAction] = useState<{ row: ConsoleDirectoryWorkspace; kind: WorkspaceActionKind } | null>(null);
  const params = new URLSearchParams({ page: String(page), ...(q.trim() ? { q: q.trim() } : {}), ...(level ? { level } : {}), ...(status ? { status } : {}) });
  const list = useQuery({
    enabled: !!me.data && can(me.data, 'workspaces.view'),
    queryKey: ['operator', 'workspaces', params.toString()],
    queryFn: () => api<ConsoleWorkspaceList>(`/operator/workspaces?${params}`),
    placeholderData: (prev) => prev,
  });
  if (!me.data) return <ConsoleLoading label="Loading workspaces" />;
  if (!can(me.data, 'workspaces.view')) return <ConsoleDenied what="the workspace directory" />;
  const manage = can(me.data, 'workspaces.manage');
  const data = list.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const all = data ? Object.values(data.counts).reduce((a, b) => a + b, 0) : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Workspace Management"
        description="Every Super, Manager and Executive Workspace of every client. Suspend, blacklist for a while, delete or restore any of them; each block and delete asks for your password and is written to the client's audit log and the Console's."
      />

      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by status" data-status-chips>
        <Chip active={!status} onClick={() => (setStatus(''), setPage(1))} label="All" count={all} />
        {CONSOLE_WORKSPACE_STATUSES.map((s) => (
          <Chip key={s} active={status === s} onClick={() => (setStatus(s), setPage(1))} label={CONSOLE_WORKSPACE_STATUS_LABEL[s]} count={data?.counts[s] ?? 0} />
        ))}
      </div>

      <Card className="p-0">
        <div className="flex flex-wrap items-end gap-3 border-b border-border p-4">
          <div className="min-w-56 flex-1">
            <label htmlFor="ws-search" className="text-sm font-medium">
              Search
            </label>
            <div className="relative mt-1">
              <Search className="pointer-events-none absolute start-2.5 top-2.5 size-4 text-muted-foreground" aria-hidden />
              <Input id="ws-search" className="ps-8" placeholder="Workspace, client, person or email" value={q} onChange={(e) => (setQ(e.target.value), setPage(1))} />
            </div>
          </div>
          <div className="w-52">
            <label htmlFor="ws-level" className="text-sm font-medium">
              Level
            </label>
            <select id="ws-level" className={`${selectClass} mt-1`} value={level} onChange={(e) => (setLevel(e.target.value), setPage(1))}>
              <option value="">Every level</option>
              <option value="SUPER">Super Workspaces</option>
              <option value="MANAGER">Manager Workspaces</option>
              <option value="EXECUTIVE">Executive Workspaces</option>
            </select>
          </div>
        </div>

        {list.error ? (
          <div className="p-4">
            <ConsoleError error={list.error} onRetry={() => void list.refetch()} />
          </div>
        ) : !data ? (
          <div className="p-4">
            <ConsoleLoading label="Loading workspaces" rows={4} />
          </div>
        ) : data.rows.length === 0 ? (
          <div className="p-4">
            <ConsoleEmpty icon={Network} title="No workspaces match" description="Change the search, the level or the status to see more." />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-sm" data-workspace-directory>
              <caption className="sr-only">Workspaces</caption>
              <thead className="border-b border-border bg-muted/40 text-start text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th scope="col" className="px-4 py-2 text-start font-medium">Workspace</th>
                  <th scope="col" className="px-4 py-2 text-start font-medium">Owner</th>
                  <th scope="col" className="px-4 py-2 text-start font-medium">Status</th>
                  <th scope="col" className="px-4 py-2 text-end font-medium">Users</th>
                  <th scope="col" className="px-4 py-2 text-start font-medium">Parent</th>
                  <th scope="col" className="px-4 py-2 text-start font-medium">Created</th>
                  <th scope="col" className="px-4 py-2 text-start font-medium">Permissions</th>
                  <th scope="col" className="px-4 py-2"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.rows.map((r) => (
                  <tr key={r.id} data-workspace-row={r.name} data-level={r.level}>
                    <td className="px-4 py-3">
                      <Link href={`/operator/workspaces/${encodeURIComponent(r.id)}`} className="font-medium hover:underline">
                        {r.name}
                      </Link>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                        <Badge tone={LEVEL_TONE[r.level]}>{LEVEL_LABEL[r.level]}</Badge>
                        {r.level !== 'SUPER' && <span>{r.client}</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {r.owner ? (
                        <>
                          <div>{r.owner.name}</div>
                          <div className="text-xs text-muted-foreground">{r.owner.email}</div>
                        </>
                      ) : r.invited ? (
                        <span className="text-muted-foreground">Invited: {r.invited}</span>
                      ) : (
                        <span className="text-muted-foreground">Nobody yet</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <WorkspaceStatusBadge row={r} />
                        {r.lockedByConsole && r.status !== 'DELETED' && <Lock className="size-3.5 text-muted-foreground" aria-label="Set by the Console" />}
                      </div>
                      {r.statusReason && <div className="mt-1 max-w-56 truncate text-xs text-muted-foreground" title={r.statusReason}>{r.statusReason}</div>}
                    </td>
                    <td className="px-4 py-3 text-end tabular">{r.users}</td>
                    <td className="px-4 py-3">{r.parent ? r.parent.name : <span className="text-muted-foreground">—</span>}</td>
                    <td className="px-4 py-3 whitespace-nowrap">{day(r.createdAt)}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {r.status === 'DELETED' ? '—' : `${r.permissions.features} features · ${r.permissions.deleteAllowed ? 'may delete' : 'no delete'}${r.level !== 'EXECUTIVE' && r.permissions.createsExecutives ? ' · creates executives' : ''}`}
                    </td>
                    <td className="px-4 py-3 text-end">
                      <WorkspaceActionsMenu row={r} canManage={manage} onAction={(kind) => setAction({ row: r, kind })} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && data.total > data.pageSize && (
          <div className="flex items-center justify-between gap-2 border-t border-border p-3 text-sm">
            <span className="text-muted-foreground">
              Page {page} of {pages} · {data.total} workspaces
            </span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="Previous page">
                <ChevronLeft className="rtl:-scale-x-100 size-4" aria-hidden />
              </Button>
              <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage(page + 1)} aria-label="Next page">
                <ChevronRight className="rtl:-scale-x-100 size-4" aria-hidden />
              </Button>
            </div>
          </div>
        )}
      </Card>
      {action && <WorkspaceActionDialog row={action.row} kind={action.kind} onClose={() => setAction(null)} />}
    </div>
  );
}

function Chip({ active, onClick, label, count }: { active: boolean; onClick: () => void; label: string; count: number }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${active ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-surface hover:bg-muted'}`}
    >
      {label} <span className="tabular">{count}</span>
    </button>
  );
}
