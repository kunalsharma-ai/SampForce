'use client';

import { Badge, Button, Card, Dialog, DialogContent, DialogDescription, DialogTitle, Input } from '@dealflow/ui';
import { CONSOLE_ACTIVITY_CATEGORIES, CONSOLE_ACTIVITY_PERMISSION, type ConsoleClientRow, type PlatformAuditRow } from '@dealflow/types';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Download, ScrollText } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { ActivityFeed } from '@/components/console/activity-feed';
import { actionLabel, TARGET_LABEL, targetLabel } from '@/components/console/audit-labels';
import { ConsoleDenied, ConsoleEmpty, ConsoleError, ConsoleLoading } from '@/components/console/console-states';
import { DiffView, fieldLabel } from '@/components/console/diff-view';
import { PageHeader } from '@/components/page-header';
import { ErrorText } from '@/components/revenue/tabs';
import { api, downloadFile } from '@/lib/api';
import { fmtLocale } from '@/lib/i18n/locale';
import { describeDevice } from '@/lib/security';
import { selectClass } from '../console-ui';
import { can, useOperator } from '../operator-shell';

const PAGE = 50;

interface Filters {
  q: string;
  tenantId: string;
  targetType: string;
  action: string;
  from: string;
  to: string;
}
const EMPTY: Filters = { q: '', tenantId: '', targetType: '', action: '', from: '', to: '' };

function query(f: Filters, extra: Record<string, string> = {}): string {
  const p = new URLSearchParams(extra);
  for (const [k, v] of Object.entries(f)) if (v.trim()) p.set(k, v.trim());
  return p.toString();
}

/** Short lines for an entry's other facts ("Reason: …", the changes it lists). */
function facts(m: Record<string, unknown>): string[] {
  const out: string[] = [];
  if (typeof m.reason === 'string' && m.reason) out.push(`Reason: ${m.reason}`);
  if (Array.isArray(m.changes)) for (const c of m.changes) if (typeof c === 'string') out.push(c);
  return out;
}

/**
 * Activity & audit log (ADR 0074, C3). Activity is the readable feed of what happened across SampForce. The audit log
 * is every operator sign-in, look and change, with what it was about, the values before and after, and the session
 * it came from. Entries cannot be edited or deleted; filters only narrow what is shown, and the CSV export is itself
 * recorded.
 */
export default function OperatorAuditPage() {
  return (
    <Suspense>
      <AuditPage />
    </Suspense>
  );
}

function AuditPage() {
  const me = useOperator();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const tab = params.get('tab') === 'activity' ? 'activity' : 'log';
  const entryId = params.get('entry');
  const go = (next: Record<string, string | null>) => {
    const p = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) if (v === null) p.delete(k);
    else p.set(k, v);
    router.replace(`${pathname}${p.size ? `?${p}` : ''}`, { scroll: false });
  };

  if (!me.data) return <ConsoleLoading />;
  if (!can(me.data, 'audit.view')) return <ConsoleDenied />;
  const categories = CONSOLE_ACTIVITY_CATEGORIES.filter((c) => can(me.data, CONSOLE_ACTIVITY_PERMISSION[c] as never));

  return (
    <>
      <PageHeader title="Activity & audit log" description="What happened across SampForce, and every operator sign-in, view and change. Entries cannot be edited or deleted." />
      <div role="tablist" aria-label="Activity and audit log" className="mb-6 inline-flex rounded-xl border border-border bg-surface p-1">
        {(
          [
            ['log', 'Audit log'],
            ['activity', 'Activity'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            role="tab"
            type="button"
            id={`tab-${key}`}
            aria-selected={tab === key}
            aria-controls={`panel-${key}`}
            onClick={() => go({ tab: key === 'log' ? null : key, entry: null })}
            className="rounded-lg px-4 py-1.5 text-sm font-medium text-muted-foreground aria-selected:bg-primary aria-selected:text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {label}
          </button>
        ))}
      </div>
      <section role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === 'activity' ? (
          can(me.data, 'clients.view') ? (
            <Card className="p-4 sm:p-6">
              <ActivityFeed categories={categories} />
            </Card>
          ) : (
            <ConsoleDenied />
          )
        ) : (
          <AuditLog open={(id) => go({ entry: id })} />
        )}
      </section>
      <EntryDrawer id={entryId} onClose={() => go({ entry: null })} />
    </>
  );
}

function AuditLog({ open }: { open: (id: string) => void }) {
  const [draft, setDraft] = useState<Filters>(EMPTY);
  const [f, setF] = useState<Filters>(EMPTY);
  // Filters apply as they change; typing waits a moment so each key press is not a request.
  useEffect(() => {
    const t = setTimeout(() => setF(draft), 300);
    return () => clearTimeout(t);
  }, [draft]);
  const [exportError, setExportError] = useState<Error | null>(null);
  const [exporting, setExporting] = useState(false);
  const clients = useQuery({ queryKey: ['operator', 'clients', 'all'], queryFn: () => api<ConsoleClientRow[]>('/operator/clients'), retry: false });
  const log = useInfiniteQuery({
    queryKey: ['operator', 'audit', f],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => api<PlatformAuditRow[]>(`/operator/audit-log?${query(f, { limit: String(PAGE), ...(pageParam ? { before: pageParam } : {}) })}`),
    getNextPageParam: (last) => (last.length === PAGE ? (last.at(-1)?.createdAt ?? null) : null),
  });
  const rows = log.data?.pages.flat() ?? [];
  const set = (k: keyof Filters) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setDraft((d) => ({ ...d, [k]: e.target.value }));
  const exportCsv = async () => {
    setExporting(true);
    setExportError(null);
    try {
      await downloadFile(`/operator/audit-log/export?${query(f)}`, 'sampforce-audit-log.csv');
    } catch (err) {
      setExportError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <form
        className="mb-4 grid gap-3 rounded-2xl border border-border bg-surface p-4 sm:grid-cols-2 lg:grid-cols-7"
        aria-label="Filter the audit log"
        onSubmit={(e) => {
          e.preventDefault();
          setF(draft);
        }}
        role="search"
      >
        <div className="space-y-1 text-sm lg:col-span-2">
          <label htmlFor="audit-q" className="block font-medium">Search</label>
          <Input id="audit-q" value={draft.q} onChange={set('q')} placeholder="Operator, client, action or name" />
        </div>
        <div className="space-y-1 text-sm">
          <label htmlFor="audit-client" className="block font-medium">Client</label>
          <select id="audit-client" className={selectClass} value={draft.tenantId} onChange={set('tenantId')}>
            <option value="">All clients and the platform</option>
            {clients.data?.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1 text-sm">
          <label htmlFor="audit-target" className="block font-medium">About</label>
          <select id="audit-target" className={selectClass} value={draft.targetType} onChange={set('targetType')}>
            <option value="">Anything</option>
            {Object.entries(TARGET_LABEL).map(([k, label]) => (
              <option key={k} value={k}>{label}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1 text-sm">
          <label htmlFor="audit-action" className="block font-medium">Action contains</label>
          <Input id="audit-action" value={draft.action} onChange={set('action')} placeholder="subscription, plan., operator." />
        </div>
        <div className="space-y-1 text-sm">
          <label htmlFor="audit-from" className="block font-medium">From</label>
          <Input id="audit-from" type="date" value={draft.from} onChange={set('from')} />
        </div>
        <div className="space-y-1 text-sm">
          <label htmlFor="audit-to" className="block font-medium">To</label>
          <Input id="audit-to" type="date" value={draft.to} onChange={set('to')} />
        </div>
        <div className="flex flex-wrap items-end gap-2 sm:col-span-2 lg:col-span-7">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setDraft(EMPTY);
              setF(EMPTY);
            }}
          >
            Clear
          </Button>
          <Button type="button" variant="outline" className="ms-auto" onClick={() => void exportCsv()} disabled={exporting}>
            <Download className="size-4" aria-hidden /> {exporting ? 'Exporting…' : 'Export CSV'}
          </Button>
        </div>
      </form>
      <ErrorText error={exportError} />
      {log.isError ? (
        <ConsoleError error={log.error} onRetry={() => void log.refetch()} />
      ) : log.isPending ? (
        <ConsoleLoading label="Loading the audit log" />
      ) : rows.length === 0 ? (
        <ConsoleEmpty icon={ScrollText} title="Nothing recorded matches these filters" description="Try a wider date range or clear the search." />
      ) : (
        <Card className="overflow-x-auto" data-platform-audit>
          <table className="w-full min-w-[820px] text-sm">
            <caption className="sr-only">Platform audit log, newest first</caption>
            <thead className="text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="p-3 text-start font-medium">When</th>
                <th scope="col" className="p-3 text-start font-medium">Operator</th>
                <th scope="col" className="p-3 text-start font-medium">Action</th>
                <th scope="col" className="p-3 text-start font-medium">About</th>
                <th scope="col" className="p-3 text-start font-medium">Client</th>
                <th scope="col" className="p-3 text-start font-medium"><span className="sr-only">Details</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const changed = r.after && typeof r.after === 'object' ? Object.keys(r.after as object).length : 0;
                return (
                  <tr key={r.id} className="border-t border-border align-top hover:bg-muted/50" data-platform-entry={r.action}>
                    <td className="whitespace-nowrap p-3 text-muted-foreground">
                      <time dateTime={r.createdAt}>{new Date(r.createdAt).toLocaleString(fmtLocale())}</time>
                    </td>
                    <td className="p-3">
                      {r.operator ? (
                        <>
                          <span className="block">{r.operator.name}</span>
                          <span className="block text-xs text-muted-foreground">{r.operator.email}</span>
                        </>
                      ) : (
                        'SampForce (automatic)'
                      )}
                    </td>
                    <td className="p-3">
                      <span className="block">{actionLabel(r.action)}</span>
                      <span className="block font-mono text-xs text-muted-foreground">{r.action}</span>
                      {facts(r.metadata).length > 0 && (
                        <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                          {facts(r.metadata)
                            .slice(0, 3)
                            .map((line, i) => (
                              <li key={i} className="break-words">{line}</li>
                            ))}
                        </ul>
                      )}
                    </td>
                    <td className="p-3" data-platform-target={r.target?.type ?? ''}>
                      {r.target ? (
                        <>
                          <span className="block text-xs text-muted-foreground">{targetLabel(r.target.type)}</span>
                          <span className="block">{r.target.label ?? (r.target.type === 'client' ? r.client?.name : null) ?? '—'}</span>
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="p-3" data-platform-client>{r.client ? (r.client.name ?? 'Deleted client') : '—'}</td>
                    <td className="p-3 text-end">
                      <Button variant="outline" size="sm" onClick={() => open(r.id)} aria-label={`Details: ${actionLabel(r.action)}, ${new Date(r.createdAt).toLocaleString(fmtLocale())}`}>
                        {changed ? `${changed} ${changed === 1 ? 'change' : 'changes'}` : 'Details'}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
      {log.hasNextPage && (
        <Button variant="outline" size="sm" className="mt-4" onClick={() => void log.fetchNextPage()} disabled={log.isFetchingNextPage}>
          {log.isFetchingNextPage ? 'Loading…' : 'Load more'}
        </Button>
      )}
    </>
  );
}

function EntryDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const entry = useQuery({ enabled: !!id, queryKey: ['operator', 'audit', 'entry', id], queryFn: () => api<PlatformAuditRow>(`/operator/audit-log/${id}`) });
  const r = entry.data;
  const other = r ? Object.entries(r.metadata).filter(([k]) => k !== 'reason' && k !== 'changes' && k !== 'from' && k !== 'to') : [];
  return (
    <Dialog open={!!id} onOpenChange={(o) => !o && onClose()}>
      <DialogContent side="right" className="w-full max-w-lg overflow-y-auto p-6" data-audit-entry>
        <DialogTitle className="pe-8 text-lg font-semibold">{r ? actionLabel(r.action) : 'Audit entry'}</DialogTitle>
        <DialogDescription className="mt-1 text-sm text-muted-foreground">
          {r ? `${r.operator?.name ?? 'SampForce (automatic)'} · ${new Date(r.createdAt).toLocaleString(fmtLocale())}` : 'Loading the entry.'}
        </DialogDescription>
        {entry.isError && <ConsoleError error={entry.error} />}
        {r && (
          <div className="mt-6 space-y-6">
            <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Action</dt>
              <dd className="font-mono text-xs">{r.action}</dd>
              {r.target && (
                <>
                  <dt className="text-muted-foreground">About</dt>
                  <dd>
                    <Badge tone="neutral">{targetLabel(r.target.type)}</Badge> {r.target.label ?? (r.target.type === 'client' ? r.client?.name : null) ?? r.target.id ?? ''}
                  </dd>
                </>
              )}
              {r.client && (
                <>
                  <dt className="text-muted-foreground">Client</dt>
                  <dd>{r.client.name ?? 'Deleted client'}</dd>
                </>
              )}
              {r.operator && (
                <>
                  <dt className="text-muted-foreground">Operator</dt>
                  <dd>{r.operator.name} ({r.operator.email})</dd>
                </>
              )}
              <dt className="text-muted-foreground">IP address</dt>
              <dd>{r.ip ?? '—'}</dd>
              <dt className="text-muted-foreground">Browser</dt>
              <dd>{r.userAgent ? describeDevice(r.userAgent) : '—'}</dd>
              <dt className="text-muted-foreground">Session</dt>
              <dd className="break-all font-mono text-xs">{r.sessionId ?? '—'}</dd>
            </dl>
            <section aria-labelledby="entry-changes">
              <h3 id="entry-changes" className="mb-2 text-sm font-semibold">Before and after</h3>
              <DiffView before={r.before} after={r.after} />
            </section>
            {facts(r.metadata).length > 0 && (
              <section aria-labelledby="entry-notes">
                <h3 id="entry-notes" className="mb-2 text-sm font-semibold">Notes</h3>
                <ul className="list-disc space-y-1 ps-5 text-sm">
                  {facts(r.metadata).map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ul>
              </section>
            )}
            {other.length > 0 && (
              <section aria-labelledby="entry-details">
                <h3 id="entry-details" className="mb-2 text-sm font-semibold">Other details</h3>
                <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1 text-sm">
                  {other.map(([k, v]) => (
                    <div key={k} className="contents">
                      <dt className="text-muted-foreground">{fieldLabel(k)}</dt>
                      <dd className="break-all font-mono text-xs">{typeof v === 'string' ? v : JSON.stringify(v)}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
