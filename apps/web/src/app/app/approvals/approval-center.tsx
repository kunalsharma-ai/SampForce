'use client';

import { Badge, Button, Dialog, DialogContent, DialogDescription, DialogTitle, Input, Skeleton } from '@dealflow/ui';
import {
  FREE_APPROVAL_CATEGORIES,
  type RecycleBatchRow,
  TEAM_APPROVAL_CATEGORIES,
  TEAM_APPROVAL_STATUSES,
  type TeamApprovalCategory,
  type TeamApprovalRow,
  type TeamApprovalSettings,
} from '@dealflow/types';
import {
  ArchiveRestore,
  Bot,
  Check,
  CheckCheck,
  ClipboardList,
  FileClock,
  Inbox,
  type LucideIcon,
  Plus,
  RotateCcw,
  Search,
  Settings2,
  ShieldCheck,
  Trash2,
  Undo2,
  UserRound,
  X,
} from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useId, useMemo, useState } from 'react';
import { CATEGORY_LOOK, IconTile, PersonDot, STATUS_LOOK } from '@/components/approvals/approval-visuals';
import { Select, Textarea } from '@/components/crm/select';
import { ApiError } from '@/lib/api';
import { formatDate } from '@/lib/crm';
import { relativeTime } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { useApprovalMutations, useApprovalOverview, useDeletedItems, useTeamApprovals } from '@/lib/team-approvals';
import { ApprovalsInbox } from './approvals-inbox';

type Tab = 'decide' | 'mine' | 'all' | 'deleted' | 'automation' | 'rules';
type T = ReturnType<typeof useT>;

/**
 * The Approval section (ADR 0098), in every workspace: managers and the Super Workspace decide here, executives
 * follow their requests and finish approved deletes here, everyone finds and restores what was deleted, and the
 * Super Workspace sets the rules. Automation and quote approvals keep their own tab.
 */
export function ApprovalCenter() {
  const t = useT();
  const params = useSearchParams();
  const router = useRouter();
  const { data: me } = useSession();
  const overview = useApprovalOverview();
  const o = overview.data;
  const showAutomation = !!me?.permissions.some((p) => p === 'automation:manage' || p === 'quotes:approve');
  const tabs = useMemo(() => {
    const list: { key: Tab; label: string; icon: LucideIcon; count?: number }[] = [];
    if (o?.decides) list.push({ key: 'decide', label: t('Waiting for you'), icon: Inbox, count: o.counts.toDecide });
    if (o && o.level !== 'SUPER') list.push({ key: 'mine', label: t('My requests'), icon: ClipboardList, count: o.counts.minePending + o.counts.mineReady });
    if (o?.level === 'SUPER') list.push({ key: 'all', label: t('All requests'), icon: FileClock });
    list.push({ key: 'deleted', label: t('Deleted items'), icon: ArchiveRestore });
    if (showAutomation) list.push({ key: 'automation', label: t('Automation and quotes'), icon: Bot });
    if (o?.canChangeSettings) list.push({ key: 'rules', label: t('Rules'), icon: Settings2 });
    return list;
  }, [o, showAutomation, t]);
  const wanted = params.get('box') as Tab | null;
  const [tab, setTab] = useState<Tab | null>(null);
  const active: Tab | undefined = tab ?? (wanted && tabs.some((x) => x.key === wanted) ? wanted : params.get('request') && o?.level === 'EXECUTIVE' ? 'mine' : tabs[0]?.key);
  const [asking, setAsking] = useState(false);

  if (overview.isPending) return <Skeleton className="h-72" />;
  if (overview.error || !o) return <p role="alert" className="text-sm text-critical">{overview.error?.message}</p>;

  const choose = (k: Tab) => {
    setTab(k);
    router.replace(`/app/approvals?box=${k}`, { scroll: false });
  };

  return (
    <div className="space-y-6" data-approval-center>
      <section className="relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-primary/12 via-surface to-accent/10 p-5 shadow-sm">
        <div aria-hidden className="pointer-events-none absolute -end-16 -top-20 size-56 rounded-full bg-primary/15 blur-3xl" />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <IconTile icon={ShieldCheck} color="#4f46e5" size="lg" />
            <div className="min-w-0">
              <p className="text-sm font-semibold">
                {o.level === 'EXECUTIVE'
                  ? o.needsApprovalToDelete
                    ? t('Deletes in your workspace need your manager’s approval.')
                    : t('Your workspace deletes without asking.')
                  : o.level === 'MANAGER'
                    ? t('You delete directly. Your team’s requests come to you.')
                    : t('You delete directly and can decide every request.')}
              </p>
              <p className="mt-1 max-w-xl text-sm text-muted-foreground">
                {t('Every delete is kept in Deleted items for {days} days, so it can be restored.', { days: o.settings.keepDeletedDays })}
              </p>
            </div>
          </div>
          {o.level !== 'SUPER' && o.settings.freeFormRequests && (
            <Button onClick={() => setAsking(true)}>
              <Plus className="size-4" aria-hidden />
              {t('New request')}
            </Button>
          )}
        </div>
        <div className="relative mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {o.decides && <Kpi icon={Inbox} color="#d97706" label={t('Waiting for you')} value={o.counts.toDecide} onClick={() => choose('decide')} />}
          {o.level !== 'SUPER' && <Kpi icon={FileClock} color="#4f46e5" label={t('Your open requests')} value={o.counts.minePending} onClick={() => choose('mine')} />}
          {o.level !== 'SUPER' && <Kpi icon={CheckCheck} color="#059669" label={t('Approved, ready to finish')} value={o.counts.mineReady} onClick={() => choose('mine')} />}
          <DeletedKpi onClick={() => choose('deleted')} />
        </div>
      </section>

      <div role="tablist" aria-label={t('Approvals')} className="flex max-w-full gap-1 overflow-x-auto rounded-xl border border-border bg-surface p-1">
        {tabs.map((x) => (
          <button
            key={x.key}
            type="button"
            role="tab"
            aria-selected={active === x.key}
            onClick={() => choose(x.key)}
            className={`inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm transition-colors ${active === x.key ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
          >
            <x.icon className="size-4" aria-hidden />
            {x.label}
            {!!x.count && <span className={`rounded-full px-1.5 text-xs tabular ${active === x.key ? 'bg-primary-foreground/20' : 'bg-muted'}`}>{x.count}</span>}
          </button>
        ))}
      </div>

      {(active === 'decide' || active === 'mine' || active === 'all') && <RequestList box={active} focus={params.get('request')} />}
      {active === 'deleted' && <DeletedItems />}
      {active === 'automation' && <ApprovalsInbox />}
      {active === 'rules' && <Rules settings={o.settings} />}
      <NewRequestDialog open={asking} onClose={() => setAsking(false)} />
    </div>
  );
}

function Kpi({ icon, color, label, value, onClick }: { icon: LucideIcon; color: string; label: string; value: number; onClick: () => void }) {
  const t = useT();
  return (
    <button type="button" onClick={onClick} className="group flex min-w-0 items-center gap-3 rounded-xl border border-border bg-surface/90 p-3 text-start shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
      <IconTile icon={icon} color={color} />
      <span className="min-w-0">
        <span className="block text-2xl font-semibold leading-none tabular">{value.toLocaleString(t.formatLocale)}</span>
        <span className="mt-1 block truncate text-xs text-muted-foreground">{label}</span>
      </span>
    </button>
  );
}

function DeletedKpi({ onClick }: { onClick: () => void }) {
  const t = useT();
  const bin = useDeletedItems({ state: 'kept' });
  return <Kpi icon={Trash2} color="#e11d48" label={t('Deleted items you can restore')} value={bin.data?.length ?? 0} onClick={onClick} />;
}

// ---- requests ------------------------------------------------------------------------------------------------

function RequestList({ box, focus }: { box: 'decide' | 'mine' | 'all'; focus: string | null }) {
  const t = useT();
  const id = useId();
  const [status, setStatus] = useState<string>(box === 'decide' ? 'PENDING' : 'ANY');
  const [category, setCategory] = useState<string>('ANY');
  const [q, setQ] = useState('');
  const list = useTeamApprovals({ box, status: status as never, category: category as never, q: q.trim() || undefined });

  useEffect(() => {
    if (!focus || !list.data) return;
    document.querySelector(`[data-request-id="${focus}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [focus, list.data]);

  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_12rem_12rem]">
        <div className="relative">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <label htmlFor={`${id}-q`} className="sr-only">{t('Search requests')}</label>
          <Input id={`${id}-q`} className="ps-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Search by record, reason or request')} />
        </div>
        <label className="sr-only" htmlFor={`${id}-status`}>{t('Status')}</label>
        <Select id={`${id}-status`} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="ANY">{t('Every status')}</option>
          <option value="OPEN">{t('Open (pending or approved)')}</option>
          {TEAM_APPROVAL_STATUSES.map((s) => (
            <option key={s} value={s}>{t.maybe(STATUS_LOOK[s].label)}</option>
          ))}
        </Select>
        <label className="sr-only" htmlFor={`${id}-category`}>{t('Kind of request')}</label>
        <Select id={`${id}-category`} value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="ANY">{t('Every kind')}</option>
          {TEAM_APPROVAL_CATEGORIES.map((c) => (
            <option key={c} value={c}>{t.maybe(CATEGORY_LOOK[c].label)}</option>
          ))}
        </Select>
      </div>
      {list.isPending ? (
        <div className="space-y-3"><Skeleton className="h-36" /><Skeleton className="h-36" /></div>
      ) : list.error ? (
        <p role="alert" className="text-sm text-critical">{list.error.message}</p>
      ) : !list.data?.length ? (
        <Empty icon={box === 'decide' ? CheckCheck : ClipboardList} text={box === 'decide' ? t('Nothing is waiting for your decision.') : box === 'mine' ? t('You have not asked for anything yet.') : t('No requests match.')} />
      ) : (
        <ul className="space-y-3" aria-label={t('Requests')}>
          {list.data.map((r) => (
            <RequestCard key={r.id} row={r} highlighted={r.id === focus} />
          ))}
        </ul>
      )}
    </div>
  );
}

function Empty({ icon, text }: { icon: LucideIcon; text: string }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border px-6 py-12 text-center">
      <IconTile icon={icon} color="#059669" size="lg" />
      <p className="text-sm text-muted-foreground">{text}</p>
    </div>
  );
}

function headline(t: T, r: TeamApprovalRow): string {
  if (r.title) return r.title;
  const type = r.recordTypeLabel ? t.maybe(r.recordTypeLabel) : t('Record');
  if (r.recordName) return t('{type}: {name}', { type, name: r.recordName });
  if (r.recordCount && r.recordCount > 1) {
    return r.scope === 'all'
      ? t('Every match of a list: {count} {type}', { count: r.recordCount.toLocaleString(t.formatLocale), type: type.toLowerCase() })
      : t('{count} {type}', { count: r.recordCount.toLocaleString(t.formatLocale), type: type.toLowerCase() });
  }
  return type;
}

function RequestCard({ row: r, highlighted }: { row: TeamApprovalRow; highlighted: boolean }) {
  const t = useT();
  const id = useId();
  const m = useApprovalMutations();
  const [note, setNote] = useState('');
  const [done, setDone] = useState<string | null>(null);
  const cat = CATEGORY_LOOK[r.category];
  const st = STATUS_LOOK[r.status];
  const busy = m.decide.isPending || m.cancel.isPending || m.carryOut.isPending;
  const error = (m.decide.error ?? m.cancel.error ?? m.carryOut.error) as Error | null;
  const quiet = error instanceof ApiError && (error.code === 'CONFIRMATION_CANCELLED' || error.code === 'APPROVAL_NOT_REQUESTED');

  const steps: { label: string; at: string | null; color: string; on: boolean }[] = [
    { label: t('Asked'), at: r.createdAt, color: '#4f46e5', on: true },
    {
      label: r.status === 'REJECTED' ? t('Rejected') : r.status === 'CANCELLED' ? t('Cancelled') : r.status === 'EXPIRED' && !r.decidedAt ? t('Expired') : t('Approved'),
      at: r.decidedAt ?? r.cancelledAt,
      color: STATUS_LOOK[r.status === 'COMPLETED' ? 'APPROVED' : r.status].color,
      on: r.status !== 'PENDING',
    },
    ...(r.action ? [{ label: r.status === 'EXPIRED' && r.decidedAt ? t('Expired') : t('Done'), at: r.completedAt, color: '#2563eb', on: r.status === 'COMPLETED' || (r.status === 'EXPIRED' && !!r.decidedAt) }] : []),
  ];

  return (
    <li
      data-request-id={r.id}
      data-request-status={r.status}
      className={`group relative overflow-hidden rounded-2xl border bg-surface shadow-sm transition hover:shadow-md ${highlighted ? 'border-primary ring-2 ring-primary/30' : 'border-border'}`}
    >
      <span aria-hidden className="absolute inset-y-0 start-0 w-1" style={{ background: cat.color }} />
      <div className="space-y-4 p-4 ps-5">
        <div className="flex flex-wrap items-start gap-3">
          <IconTile icon={cat.icon} color={cat.color} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="min-w-0 break-words text-base font-semibold">{headline(t, r)}</h3>
              <Badge tone={st.tone} className="inline-flex items-center gap-1">
                <st.icon className="size-3.5" aria-hidden />
                {t.maybe(st.label)}
              </Badge>
              {r.escalated && r.status === 'PENDING' && <Badge tone="accent">{t('Moved up')}</Badge>}
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t('{kind} · {reference}', { kind: t.maybe(cat.label), reference: r.reference })}
              {r.recordId && ` · ${t('Record ID {id}', { id: r.recordId.slice(0, 8) })}`}
            </p>
          </div>
          <span className="text-xs text-muted-foreground" title={new Date(r.createdAt).toLocaleString(t.formatLocale)}>{relativeTime(r.createdAt)}</span>
        </div>

        <dl className="grid gap-3 text-sm sm:grid-cols-3">
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">{t('Asked by')}</dt>
            <dd className="mt-1 flex min-w-0 items-center gap-2">
              <PersonDot name={r.requester.name} />
              <span className="min-w-0">
                <span className="block truncate font-medium">{r.requester.name}</span>
                <span className="block truncate text-xs text-muted-foreground">{r.requesterWorkspace.name}</span>
              </span>
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">{t('Decided by')}</dt>
            <dd className="mt-1 flex min-w-0 items-center gap-2">
              {r.decidedBy ? <PersonDot name={r.decidedBy.name} /> : <UserRound className="size-5 shrink-0 text-muted-foreground" aria-hidden />}
              <span className="min-w-0">
                <span className="block truncate font-medium">{r.decidedBy?.name ?? (r.assignedManagers.map((p) => p.name).join(', ') || r.approverWorkspace.name)}</span>
                <span className="block truncate text-xs text-muted-foreground">{r.approverWorkspace.name}</span>
              </span>
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">{r.status === 'PENDING' ? t('Expires') : r.status === 'APPROVED' && r.approvedUntil ? t('Finish by') : t('Decided')}</dt>
            <dd className="mt-1 font-medium tabular">{formatDate(r.status === 'PENDING' ? r.expiresAt : r.status === 'APPROVED' && r.approvedUntil ? r.approvedUntil : (r.decidedAt ?? r.cancelledAt))}</dd>
          </div>
        </dl>

        <blockquote className="rounded-xl bg-muted/60 px-3 py-2 text-sm">
          <span className="text-xs font-medium text-muted-foreground">{t('Reason')}</span>
          <p className="mt-0.5 whitespace-pre-wrap break-words">{r.reason}</p>
        </blockquote>
        {r.decisionNote && (
          <blockquote className="rounded-xl border border-border px-3 py-2 text-sm">
            <span className="text-xs font-medium text-muted-foreground">{t('Manager’s comment')}</span>
            <p className="mt-0.5 whitespace-pre-wrap break-words">{r.decisionNote}</p>
          </blockquote>
        )}

        <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs" aria-label={t('Progress')}>
          {steps.map((s, i) => (
            <li key={i} className="flex items-center gap-2">
              {i > 0 && <span aria-hidden className={`h-px w-6 ${s.on ? 'bg-foreground/30' : 'bg-border'}`} />}
              <span className="size-2.5 rounded-full" style={{ background: s.on ? s.color : 'transparent', boxShadow: `inset 0 0 0 2px ${s.on ? s.color : '#94a3b8'}` }} aria-hidden />
              <span className={s.on ? 'font-medium' : 'text-muted-foreground'}>{s.label}</span>
              {s.on && s.at && <span className="text-muted-foreground">{formatDate(s.at)}</span>}
            </li>
          ))}
        </ol>

        {r.recordChanged && (
          <p className="rounded-xl bg-warning/10 px-3 py-2 text-sm" role="status">
            {t('This record changed after it was approved. Ask again so your manager sees it as it is now.')}
          </p>
        )}
        {done && <p className="rounded-xl bg-success/10 px-3 py-2 text-sm" role="status">{done}</p>}
        {error && !quiet && <p role="alert" className="text-sm text-critical">{error.message}</p>}

        {(r.canDecide || r.canCancel || r.canCarryOut) && (
          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
            {r.canDecide && (
              <>
                <label htmlFor={`${id}-note`} className="sr-only">{t('Comment for {name}', { name: r.requester.name })}</label>
                <Input id={`${id}-note`} className="h-9 min-w-48 flex-1" placeholder={t('Comment (optional)')} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
                <Button size="sm" disabled={busy} onClick={() => m.decide.mutate({ id: r.id, decision: 'approve', note })}>
                  <Check className="size-4" aria-hidden />
                  {t('Approve')}
                </Button>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => m.decide.mutate({ id: r.id, decision: 'reject', note })}>
                  <X className="size-4" aria-hidden />
                  {t('Reject')}
                </Button>
              </>
            )}
            {r.canCarryOut && (
              <Button
                size="sm"
                variant={r.category === 'delete' ? 'destructive' : 'default'}
                disabled={busy}
                onClick={() => m.carryOut.mutate(r, { onSuccess: () => setDone(r.category === 'delete' ? t('Deleted. You can restore it from Deleted items.') : t('Done.')) })}
              >
                {r.category === 'delete' ? <Trash2 className="size-4" aria-hidden /> : <Check className="size-4" aria-hidden />}
                {r.category === 'delete' ? t('Delete now') : t('Make the change now')}
              </Button>
            )}
            {r.canCancel && (
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => m.cancel.mutate(r.id)}>
                <Undo2 className="size-4" aria-hidden />
                {t('Cancel request')}
              </Button>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

function NewRequestDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const id = useId();
  const m = useApprovalMutations();
  const [category, setCategory] = useState<TeamApprovalCategory>('task_change');
  const [title, setTitle] = useState('');
  const [reason, setReason] = useState('');
  useEffect(() => {
    if (open) {
      setTitle('');
      setReason('');
      m.ask.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const ok = title.trim().length >= 3 && reason.trim().length >= 3;
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg p-6">
        <DialogTitle className="text-lg font-semibold">{t('Ask your manager')}</DialogTitle>
        <DialogDescription className="mt-1 text-sm text-muted-foreground">{t('For a change to a task, a target or data that you cannot make yourself.')}</DialogDescription>
        <form
          className="mt-4 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (ok) m.ask.mutate({ category, title: title.trim(), reason: reason.trim() }, { onSuccess: onClose });
          }}
        >
          <fieldset>
            <legend className="mb-2 text-sm font-medium">{t('Kind of request')}</legend>
            <div className="grid grid-cols-2 gap-2">
              {FREE_APPROVAL_CATEGORIES.map((c) => {
                const look = CATEGORY_LOOK[c];
                return (
                  <label key={c} className={`flex cursor-pointer items-center gap-2 rounded-xl border p-2 text-sm transition ${category === c ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted'}`}>
                    <input type="radio" name={`${id}-category`} className="sr-only" checked={category === c} onChange={() => setCategory(c)} />
                    <IconTile icon={look.icon} color={look.color} size="sm" />
                    {t.maybe(look.label)}
                  </label>
                );
              })}
            </div>
          </fieldset>
          <div className="space-y-1.5 text-sm">
            <label htmlFor={`${id}-title`} className="block font-medium">{t('What do you need?')}</label>
            <Input id={`${id}-title`} value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} placeholder={t('For example: lower my December target to 15 companies a day')} />
          </div>
          <div className="space-y-1.5 text-sm">
            <label htmlFor={`${id}-reason`} className="block font-medium">{t('Why? Your manager sees this')}</label>
            <Textarea id={`${id}-reason`} value={reason} maxLength={1000} onChange={(e) => setReason(e.target.value)} />
          </div>
          {m.ask.error && <p role="alert" className="text-sm text-critical">{m.ask.error.message}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>{t('Cancel')}</Button>
            <Button type="submit" disabled={!ok || m.ask.isPending}>{m.ask.isPending ? t('Sending…') : t('Send for approval')}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---- deleted items -------------------------------------------------------------------------------------------

function DeletedItems() {
  const t = useT();
  const id = useId();
  const [q, setQ] = useState('');
  // Everything by default: the deletion history, with restored items marked, so a restore stays in view with its result.
  const [state, setState] = useState<'kept' | 'restored' | 'any'>('any');
  const list = useDeletedItems({ q: q.trim() || undefined, state });
  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_14rem]">
        <div className="relative">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <label htmlFor={`${id}-q`} className="sr-only">{t('Search deleted items')}</label>
          <Input id={`${id}-q`} className="ps-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Search deleted items')} />
        </div>
        <label className="sr-only" htmlFor={`${id}-state`}>{t('Show')}</label>
        <Select id={`${id}-state`} value={state} onChange={(e) => setState(e.target.value as typeof state)}>
          <option value="kept">{t('Can be restored')}</option>
          <option value="restored">{t('Restored')}</option>
          <option value="any">{t('Everything')}</option>
        </Select>
      </div>
      {list.isPending ? (
        <Skeleton className="h-40" />
      ) : list.error ? (
        <p role="alert" className="text-sm text-critical">{list.error.message}</p>
      ) : !list.data?.length ? (
        <Empty icon={ArchiveRestore} text={t('Nothing deleted here yet.')} />
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2" aria-label={t('Deleted items')}>
          {list.data.map((b) => (
            <DeletedCard key={b.id} row={b} />
          ))}
        </ul>
      )}
    </div>
  );
}

function DeletedCard({ row: b }: { row: RecycleBatchRow }) {
  const t = useT();
  const m = useApprovalMutations();
  const [result, setResult] = useState<string | null>(null);
  const error = (m.restore.error ?? m.purge.error) as Error | null;
  const quiet = error instanceof ApiError && (error.code === 'CONFIRMATION_CANCELLED' || error.code === 'APPROVAL_NOT_REQUESTED' || error.code === 'APPROVAL_REQUESTED');
  return (
    <li data-deleted-item={b.id} className="flex min-w-0 flex-col gap-3 rounded-2xl border border-border bg-surface p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <IconTile icon={b.restoredAt ? RotateCcw : Trash2} color={b.restoredAt ? '#059669' : '#e11d48'} />
        <div className="min-w-0 flex-1">
          <h3 className="break-words text-sm font-semibold">{b.label}</h3>
          <p className="text-xs text-muted-foreground">{t.maybe(b.recordTypeLabel)}{b.approvalReference && ` · ${t('Approved as {reference}', { reference: b.approvalReference })}`}</p>
        </div>
        {b.restoredAt ? <Badge tone="success">{t('Restored')}</Badge> : <Badge tone="neutral">{t('Kept until {date}', { date: formatDate(b.purgeAfter) })}</Badge>}
      </div>
      {b.parts.length > 1 && (
        <ul className="flex flex-wrap gap-1.5" aria-label={t('Removed with it')}>
          {b.parts.map((p) => (
            <li key={p.label} className="rounded-full border border-border bg-muted/60 px-2 py-0.5 text-xs">{t('{count} {type}', { count: p.count.toLocaleString(t.formatLocale), type: t.maybe(p.label).toLowerCase() })}</li>
          ))}
        </ul>
      )}
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <PersonDot name={b.deletedBy.name} />
        <span className="min-w-0 truncate">{t('Deleted by {name} {when}', { name: b.deletedBy.name, when: relativeTime(b.deletedAt) })}</span>
      </div>
      {b.restoredAt && b.restoredBy && <p className="text-xs text-muted-foreground">{t('Restored by {name} {when}', { name: b.restoredBy.name, when: relativeTime(b.restoredAt) })}</p>}
      {b.partial && <p className="text-xs text-warning">{t('Only part of this delete could be kept.')}</p>}
      {result && <p role="status" className="rounded-lg bg-success/10 px-3 py-1.5 text-sm">{result}</p>}
      {error && !quiet && <p role="alert" className="text-sm text-critical">{error.message}</p>}
      {(b.canRestore || b.canPurge) && (
        <div className="mt-auto flex flex-wrap gap-2 border-t border-border pt-3">
          {b.canRestore && (
            <Button
              size="sm"
              disabled={m.restore.isPending}
              onClick={() =>
                m.restore.mutate(b.id, {
                  onSuccess: (r) => setResult(r.failed ? t('Restored {restored}. {failed} could not come back.', { restored: r.restored, failed: r.failed }) : t('Restored.')),
                })
              }
            >
              <RotateCcw className="size-4" aria-hidden />
              {t('Restore')}
            </Button>
          )}
          {b.canPurge && !b.restoredAt && (
            <Button size="sm" variant="outline" disabled={m.purge.isPending} onClick={() => m.purge.mutate(b.id)}>
              <Trash2 className="size-4" aria-hidden />
              {t('Remove for good')}
            </Button>
          )}
        </div>
      )}
    </li>
  );
}

// ---- rules ---------------------------------------------------------------------------------------------------

function Rules({ settings }: { settings: TeamApprovalSettings }) {
  const t = useT();
  const id = useId();
  const m = useApprovalMutations();
  const [s, setS] = useState(settings);
  useEffect(() => setS(settings), [settings]);
  const toggle = (key: 'lowerLevelsDelete' | 'deleteNeedsApproval' | 'editNeedsApproval' | 'freeFormRequests', label: string, hint: string) => (
    <label className="flex cursor-pointer items-start justify-between gap-4 rounded-xl border border-border p-3">
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </span>
      <input type="checkbox" role="switch" className="mt-1 size-5 shrink-0 accent-[hsl(var(--primary))]" checked={s[key]} onChange={(e) => setS({ ...s, [key]: e.target.checked })} />
    </label>
  );
  const number = (key: 'escalateAfterHours' | 'expireAfterDays' | 'approvalValidDays' | 'keepDeletedDays', label: string, min: number, max: number) => (
    <div className="space-y-1.5 text-sm">
      <label htmlFor={`${id}-${key}`} className="block font-medium">{label}</label>
      <Input id={`${id}-${key}`} type="number" min={min} max={max} value={s[key]} onChange={(e) => setS({ ...s, [key]: Math.max(min, Math.min(max, Number(e.target.value) || 0)) })} />
    </div>
  );
  return (
    <form
      className="space-y-5 rounded-2xl border border-border bg-surface p-5 shadow-sm"
      onSubmit={(e) => {
        e.preventDefault();
        m.saveSettings.mutate(s);
      }}
    >
      <div className="grid gap-3 lg:grid-cols-2">
        {toggle('lowerLevelsDelete', t('Manager and Executive Workspaces can delete'), t('Turns Delete on wherever they can edit, now and for new workspaces. Managers delete directly; executives ask first. Turning it off takes Delete away again.'))}
        {toggle('deleteNeedsApproval', t('Executives ask before deleting'), t('An Executive Workspace’s delete goes to its manager first.'))}
        {toggle('editNeedsApproval', t('Executives ask before editing companies, contacts and deals'), t('Off by default. Every change waits for the manager.'))}
        {toggle('freeFormRequests', t('People can send other requests'), t('Task, target and data change requests in words.'))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {number('escalateAfterHours', t('Move up after (hours, 0 = never)'), 0, 720)}
        {number('expireAfterDays', t('Requests expire after (days)'), 1, 90)}
        {number('approvalValidDays', t('Approvals stay usable for (days)'), 1, 30)}
        {number('keepDeletedDays', t('Keep deleted items for (days)'), 1, 365)}
      </div>
      {m.saveSettings.error && <p role="alert" className="text-sm text-critical">{m.saveSettings.error.message}</p>}
      {m.saveSettings.isSuccess && <p role="status" className="text-sm text-success">{t('Saved.')}</p>}
      <div className="flex justify-end">
        <Button type="submit" disabled={m.saveSettings.isPending}>{t('Save rules')}</Button>
      </div>
    </form>
  );
}
