'use client';

import { Badge, Button, Card } from '@dealflow/ui';
import { CONSOLE_WORKSPACE_STATUS_TEXT, type ConsoleWorkspaceDetail, FEATURE_BY_KEY, type FeatureKey } from '@dealflow/types';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Lock } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { ConsoleDenied, ConsoleError, ConsoleLoading } from '@/components/console/console-states';
import { actionsFor, day, LEVEL_LABEL, type WorkspaceActionKind, WorkspaceActionDialog, WorkspaceStatusBadge } from '@/components/console/workspace-actions';
import { PageHeader } from '@/components/page-header';
import { api } from '@/lib/api';
import { can, useOperator } from '../../operator-shell';

const ACTION_TEXT: Record<WorkspaceActionKind, string> = { edit: 'Edit', suspend: 'Suspend', blacklist: 'Blacklist for a while', reactivate: 'Reactivate', delete: 'Delete', restore: 'Restore' };

/** One workspace in the Console: its status, people, workspaces below it, what it may use, and everything done to it. */
export default function ConsoleWorkspacePage() {
  const { id } = useParams<{ id: string }>();
  const workspaceId = decodeURIComponent(id);
  const router = useRouter();
  const me = useOperator();
  const [action, setAction] = useState<WorkspaceActionKind | null>(null);
  const q = useQuery({
    enabled: !!me.data && can(me.data, 'workspaces.view'),
    queryKey: ['operator', 'workspaces', 'detail', workspaceId],
    queryFn: () => api<ConsoleWorkspaceDetail>(`/operator/workspaces/${encodeURIComponent(workspaceId)}`),
  });
  if (!me.data) return <ConsoleLoading label="Loading workspace" />;
  if (!can(me.data, 'workspaces.view')) return <ConsoleDenied what="the workspace directory" />;
  if (q.error) return <ConsoleError error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data) return <ConsoleLoading label="Loading workspace" />;
  const w = q.data;
  const manage = can(me.data, 'workspaces.manage');
  const kinds = manage ? actionsFor(w) : [];

  return (
    <div className="space-y-6">
      <Link href="/operator/workspaces" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="rtl:-scale-x-100 size-4" aria-hidden />
        Workspace Management
      </Link>
      <PageHeader
        title={w.name}
        description={`${LEVEL_LABEL[w.level]}${w.level === 'SUPER' ? '' : ` of ${w.client}`} · ${w.designation}`}
        actions={
          <div className="flex flex-wrap gap-2">
            {kinds.map((k) => (
              <Button key={k} size="sm" variant={k === 'delete' ? 'destructive' : k === 'reactivate' || k === 'restore' ? 'default' : 'outline'} onClick={() => setAction(k)}>
                {k === 'delete' && w.level === 'SUPER' ? 'Close company' : k === 'restore' && w.level === 'SUPER' ? 'Reopen company' : ACTION_TEXT[k]}
              </Button>
            ))}
          </div>
        }
      />

      <Card className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4" data-workspace-summary>
        <Fact label="Status">
          <div className="flex flex-wrap items-center gap-1.5">
            <WorkspaceStatusBadge row={w} />
            {w.lockedByConsole && w.status !== 'DELETED' && (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Lock className="size-3.5" aria-hidden /> Set by the Console
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{CONSOLE_WORKSPACE_STATUS_TEXT[w.status]}</p>
          {w.statusReason && <p className="mt-1 text-xs" data-status-reason>Reason: {w.statusReason}</p>}
        </Fact>
        <Fact label="Owner">{w.owner ? `${w.owner.name} (${w.owner.email})` : w.invited ? `Invited: ${w.invited}` : 'Nobody yet'}</Fact>
        <Fact label="Parent">{w.parent ? <Link className="hover:underline" href={`/operator/workspaces/${encodeURIComponent(w.parent.id)}`}>{w.parent.name}</Link> : 'Top of the client'}</Fact>
        <Fact label="Created">{day(w.createdAt)}</Fact>
        <Fact label="Users">{w.users}</Fact>
        <Fact label="Client">
          <Link className="hover:underline" href={`/operator/clients/${w.tenantId}`}>
            {w.client}
          </Link>
        </Fact>
        <Fact label="Permissions">
          {w.status === 'DELETED' ? '—' : `${w.permissions.features} features · ${w.permissions.deleteAllowed ? 'may delete' : 'cannot delete'}${w.level !== 'EXECUTIVE' ? (w.permissions.createsExecutives ? ' · creates Executive Workspaces' : ' · no Executive Workspaces') : ''}`}
        </Fact>
        {w.description && <Fact label="Description">{w.description}</Fact>}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="font-medium">People</h2>
          {w.people.length ? (
            <ul className="mt-3 divide-y divide-border text-sm" data-workspace-people>
              {w.people.map((p) => (
                <li key={p.email} className="flex justify-between gap-2 py-2">
                  <span>
                    {p.name} <span className="text-muted-foreground">({p.email})</span>
                  </span>
                  <Badge tone="neutral">{p.role}</Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">Nobody works in it right now.</p>
          )}
        </Card>
        <Card className="p-5">
          <h2 className="font-medium">Workspaces below</h2>
          {w.children.length ? (
            <ul className="mt-3 divide-y divide-border text-sm" data-workspace-children>
              {w.children.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-2 py-2">
                  <Link className="hover:underline" href={`/operator/workspaces/${encodeURIComponent(c.id)}`}>
                    {c.name}
                  </Link>
                  <span className="flex items-center gap-1.5">
                    <Badge tone="neutral">{LEVEL_LABEL[c.level]}</Badge>
                    <WorkspaceStatusBadge row={{ status: c.status, statusUntil: null, level: c.level }} />
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">None.</p>
          )}
        </Card>
      </div>

      <Card className="p-5">
        <h2 className="font-medium">Audit trail</h2>
        <p className="text-sm text-muted-foreground">Who did what to this workspace, and when, from the client and from the Console.</p>
        {w.history.length ? (
          <ol className="mt-3 divide-y divide-border text-sm" data-workspace-history>
            {w.history.map((h, i) => (
              <li key={`${h.at}-${i}`} className="grid gap-1 py-2 sm:grid-cols-[10rem_1fr_auto]">
                <time className="text-muted-foreground" dateTime={h.at}>
                  {new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(h.at))}
                </time>
                <span>
                  <span className="font-medium">{h.action.replace(/^(workspace|tenant)\./, '').replace(/_/g, ' ')}</span> by {h.actor}
                  {h.detail && <span className="block text-xs text-muted-foreground">{h.detail}</span>}
                </span>
                <Badge tone={h.outcome === 'SUCCEEDED' ? 'success' : 'critical'}>{h.outcome === 'SUCCEEDED' ? 'Done' : h.outcome === 'REFUSED' ? 'Refused' : 'Failed'}</Badge>
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">Nothing recorded yet.</p>
        )}
      </Card>

      {w.features.length > 0 && (
        <Card className="p-5">
          <h2 className="font-medium">What it may use</h2>
          <ul className="mt-3 flex flex-wrap gap-1.5" data-workspace-features>
            {w.features.map((f) => (
              <li key={f}>
                <Badge tone="neutral">{FEATURE_BY_KEY[f as FeatureKey]?.label ?? f}</Badge>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {action && (
        <WorkspaceActionDialog
          row={w}
          kind={action}
          onClose={() => setAction(null)}
          onDone={(r) => {
            // The page follows a `root:` Super Workspace to the id it was stored under.
            const next = (r as { id?: string } | null)?.id;
            if (next && next !== workspaceId) router.replace(`/operator/workspaces/${encodeURIComponent(next)}`);
          }}
        />
      )}
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm">{children}</div>
    </div>
  );
}
