'use client';

import { Badge, Button, cn, Dialog, DialogContent, DialogTitle, Field, Input, Skeleton } from '@dealflow/ui';
import { DEAL_PRIORITIES, type DealHistoryItem, type DealInput, type DealPriority, type DealRow } from '@dealflow/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { useId, useRef, useState } from 'react';
import { DealIntelligenceCard } from '@/components/ai/record-ai';
import { DealHealthTrend } from '@/components/crm/deal-health-trend';
import { RecordConversations } from '@/components/crm/record-conversations';
import { Select } from '@/components/crm/select';
import { ActivityTimeline, RecordTasks } from '@/components/crm/timeline';
import { DealQuotes } from '@/components/revenue/record-commercial';
import { api } from '@/lib/api';
import { DEAL_STATUS_TONE, formatDate, formatMoney, titleCase, useMembers, useRecord } from '@/lib/crm';
import { relativeTime } from '@/lib/format';
import { useCan } from '@/lib/session';
import { PRIORITY_LABEL, PriorityBadge, RiskIndicator } from './deal-badges';
import { StageStepper } from './stage-stepper';

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'activity', label: 'Activity' },
  { key: 'emails', label: 'Emails' },
  { key: 'quotes', label: 'Quotes' },
  { key: 'insights', label: 'AI insights' },
  { key: 'history', label: 'History' },
] as const;
type Tab = (typeof TABS)[number]['key'];

/** Opens a deal over the current view (pipeline, calendar, forecast...) so people can work on it without leaving. */
export function DealSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  return (
    <Dialog open={!!id} onOpenChange={(o) => !o && onClose()}>
      <DialogContent side="right" className="max-w-2xl overflow-y-auto p-0" aria-describedby={undefined}>
        {id && <DealPanel id={id} headingAs={DialogTitle} />}
      </DialogContent>
    </Dialog>
  );
}

/** The deal workspace: summary and stage at the top, then tabs. Used in the slide-over and in the split view. */
export function DealPanel({ id, headingAs: Heading = 'h2' }: { id: string; headingAs?: React.ElementType }) {
  const deal = useRecord<DealRow>('deals', id);
  const [tab, setTab] = useState<Tab>('overview');
  const base = useId();
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  if (deal.isPending) {
    return (
      <div className="space-y-3 p-6" aria-busy="true">
        <Skeleton className="h-7 w-2/3" />
        <Skeleton className="h-5 w-1/3" />
        <Skeleton className="h-40" />
        {Heading !== 'h2' && <DialogTitle className="sr-only">Loading deal</DialogTitle>}
      </div>
    );
  }
  if (deal.error) {
    return (
      <div className="p-6">
        <Heading className="text-lg font-semibold">Deal unavailable</Heading>
        <p role="alert" className="mt-2 text-sm text-critical">
          {deal.error.message}
        </p>
      </div>
    );
  }
  const d = deal.data;

  const onKey = (e: React.KeyboardEvent, i: number) => {
    const next = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? TABS.length - 1 : null;
    if (next === null) return;
    e.preventDefault();
    const n = (next + TABS.length) % TABS.length;
    setTab(TABS[n]!.key);
    tabRefs.current[n]?.focus();
  };

  return (
    <div className="flex min-h-full flex-col">
      <header className="space-y-3 border-b border-border p-5 pr-12">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <Heading className="truncate text-xl font-semibold">{d.name}</Heading>
            <p className="mt-0.5 text-sm text-muted-foreground">
              <span className="tabular font-medium text-foreground">{formatMoney(d.amount, d.currency)}</span>
              {d.company && <> · {d.company.name}</>} · {d.pipeline.name}
            </p>
          </div>
          <Link href={`/app/deals/${d.id}`} className="inline-flex items-center gap-1 text-sm text-primary underline underline-offset-2">
            Open full page <ExternalLink className="size-3.5" aria-hidden />
          </Link>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={DEAL_STATUS_TONE[d.status]}>{titleCase(d.status)}</Badge>
          <PriorityBadge priority={d.priority} />
          <RiskIndicator health={d.health} />
          {d.owner && <span className="text-xs text-muted-foreground">Owner: {d.owner.name}</span>}
        </div>
        <StageStepper deal={d} />
      </header>

      <div role="tablist" aria-label="Deal sections" className="flex gap-1 overflow-x-auto border-b border-border px-3">
        {TABS.map((t, i) => (
          <button
            key={t.key}
            ref={(el) => {
              tabRefs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`${base}-tab-${t.key}`}
            aria-selected={tab === t.key}
            aria-controls={`${base}-panel`}
            tabIndex={tab === t.key ? 0 : -1}
            onClick={() => setTab(t.key)}
            onKeyDown={(e) => onKey(e, i)}
            className={cn(
              '-mb-px shrink-0 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              tab === t.key ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`${base}-panel`} aria-labelledby={`${base}-tab-${tab}`} className="flex-1 space-y-4 p-5" tabIndex={0}>
        {tab === 'overview' && <OverviewTab deal={d} />}
        {tab === 'activity' && (
          <>
            <ActivityTimeline related={{ opportunityId: d.id }} timeline={{ entity: 'deal', id: d.id }} />
            <RecordTasks related={{ opportunityId: d.id }} />
          </>
        )}
        {tab === 'emails' && <RecordConversations dealId={d.id} />}
        {tab === 'quotes' && <DealQuotes deal={{ id: d.id, name: d.name }} />}
        {tab === 'insights' && (
          <>
            <DealHealthTrend dealId={d.id} />
            <DealIntelligenceCard dealId={d.id} />
          </>
        )}
        {tab === 'history' && <HistoryTab id={d.id} />}
      </div>
    </div>
  );
}

type Draft = { amount: string; expectedCloseDate: string; probability: string; priority: '' | DealPriority; ownerId: string };
const toDraft = (d: DealRow): Draft => ({
  amount: String(d.amount),
  expectedCloseDate: d.expectedCloseDate ?? '',
  probability: d.probability === null ? '' : String(d.probability),
  priority: d.priority ?? '',
  ownerId: d.owner?.id ?? '',
});

/** Invalidates every view that shows deals after an edit in the panel. */
export function useRefreshDealViews() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['board'] });
    void qc.invalidateQueries({ queryKey: ['deals', 'list'] });
    void qc.invalidateQueries({ queryKey: ['deal-views'] });
    void qc.invalidateQueries({ queryKey: ['deals', 'history'] });
    void qc.invalidateQueries({ queryKey: ['dashboard'] });
  };
}

function OverviewTab({ deal }: { deal: DealRow }) {
  const canWrite = useCan('deals:write');
  const members = useMembers();
  const qc = useQueryClient();
  const refresh = useRefreshDealViews();
  const [draft, setDraft] = useState<Draft>(() => toDraft(deal));
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [baseline, setBaseline] = useState(deal.updatedAt);
  // Another tab or the board changed the deal: start again from the new values.
  if (baseline !== deal.updatedAt) {
    setBaseline(deal.updatedAt);
    setDraft(toDraft(deal));
  }
  const original = toDraft(deal);
  const changed = (Object.keys(draft) as (keyof Draft)[]).filter((k) => draft[k] !== original[k]);
  const amount = Number(draft.amount);
  const probability = draft.probability === '' ? null : Number(draft.probability);
  const errors = {
    amount: draft.amount.trim() === '' || !Number.isFinite(amount) || amount < 0 ? 'Enter an amount of 0 or more' : undefined,
    probability: probability !== null && (!Number.isInteger(probability) || probability < 0 || probability > 100) ? 'Use a whole number from 0 to 100, or leave it empty' : undefined,
  };
  const valid = !errors.amount && !errors.probability;

  const save = useMutation({
    mutationFn: () => {
      const body: Partial<DealInput> = {};
      if (changed.includes('amount')) body.amount = amount;
      if (changed.includes('expectedCloseDate')) body.expectedCloseDate = draft.expectedCloseDate || null;
      if (changed.includes('probability')) body.probability = probability;
      if (changed.includes('priority')) body.priority = draft.priority || null;
      if (changed.includes('ownerId')) body.ownerId = draft.ownerId || null;
      return api<DealRow>(`/deals/${deal.id}`, { method: 'PATCH', json: body });
    },
    onSuccess: (row) => {
      qc.setQueryData(['deals', 'detail', row.id], row);
      setSavedAt(new Date().toLocaleTimeString());
      refresh();
    },
  });

  const set = (k: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setSavedAt(null);
    setDraft({ ...draft, [k]: e.target.value });
  };

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid && changed.length) save.mutate();
      }}
    >
      <fieldset disabled={!canWrite || save.isPending} className="grid gap-4 sm:grid-cols-2">
        <legend className="sr-only">Deal details</legend>
        <Field id={`amount-${deal.id}`} label={`Amount (${deal.currency})`} error={errors.amount}>
          <Input inputMode="decimal" value={draft.amount} onChange={set('amount')} />
        </Field>
        <Field id={`close-${deal.id}`} label="Expected close">
          <Input type="date" value={draft.expectedCloseDate} onChange={set('expectedCloseDate')} />
        </Field>
        <Field id={`prob-${deal.id}`} label="Probability %" hint={`Empty uses the stage’s ${deal.stage.probability}%`} error={errors.probability}>
          <Input inputMode="numeric" value={draft.probability} onChange={set('probability')} placeholder={String(deal.stage.probability)} />
        </Field>
        <Field id={`priority-${deal.id}`} label="Priority">
          <Select value={draft.priority} onChange={set('priority')}>
            <option value="">Not set</option>
            {[...DEAL_PRIORITIES].reverse().map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABEL[p]}
              </option>
            ))}
          </Select>
        </Field>
        <Field id={`owner-${deal.id}`} label="Owner">
          <Select value={draft.ownerId} onChange={set('ownerId')}>
            <option value="">Unassigned</option>
            {(members.data ?? []).map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.name}
              </option>
            ))}
          </Select>
        </Field>
      </fieldset>
      {canWrite && (
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" size="sm" disabled={!changed.length || !valid || save.isPending}>
            {save.isPending ? 'Saving…' : 'Save changes'}
          </Button>
          {changed.length > 0 && (
            <Button type="button" variant="ghost" size="sm" onClick={() => setDraft(original)}>
              Discard
            </Button>
          )}
          <p role="status" className="text-xs text-muted-foreground">
            {save.isError ? '' : savedAt ? `Saved at ${savedAt}.` : changed.length ? `${changed.length} unsaved ${changed.length === 1 ? 'change' : 'changes'}.` : ''}
          </p>
        </div>
      )}
      {save.error && (
        <p role="alert" className="text-sm text-critical">
          {save.error.message}
        </p>
      )}
      <dl className="grid gap-x-4 gap-y-2 border-t border-border pt-4 text-sm sm:grid-cols-2">
        {(
          [
            ['Weighted value', formatMoney((deal.amount * deal.effectiveProbability) / 100, deal.currency)],
            ['Primary contact', deal.contact?.name],
            ['Created', formatDate(deal.createdAt)],
            ['Closed', deal.closedAt ? formatDate(deal.closedAt) : null],
            ['Loss reason', deal.lossReason],
          ] as const
        )
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <div key={k}>
              <dt className="text-xs text-muted-foreground">{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
      </dl>
    </form>
  );
}

const ACTION_LABEL: Record<string, string> = {
  'deal.created': 'Created the deal',
  'deal.updated': 'Updated the deal',
  'deal.stage_changed': 'Moved the deal',
  'deal.cloned': 'Cloned from another deal',
  'deal.assigned': 'Changed the owner',
  'deal.deleted': 'Deleted the deal',
};
const FIELD_LABEL: Record<string, string> = { amount: 'Amount', expectedCloseDate: 'Expected close', probability: 'Probability', priority: 'Priority', ownerId: 'Owner', name: 'Name', companyId: 'Company', contactId: 'Contact' };
const show = (v: unknown) => (v === null || v === undefined || v === '' ? 'empty' : String(v));

function HistoryTab({ id }: { id: string }) {
  const q = useQuery({ queryKey: ['deals', 'history', id], queryFn: () => api<DealHistoryItem[]>(`/deals/${id}/history`) });
  if (q.isPending) return <Skeleton className="h-40" />;
  if (q.error)
    return (
      <p role="alert" className="text-sm text-critical">
        {q.error.message}
      </p>
    );
  if (q.data.length === 0) return <p className="text-sm text-muted-foreground">No changes recorded yet.</p>;
  return (
    <ol className="space-y-3" aria-label="Deal history">
      {q.data.map((h) => {
        const stage = h.action === 'deal.stage_changed' ? (h.metadata as { from?: string; to?: string }) : null;
        return (
          <li key={h.id} className="rounded-md border border-border p-3 text-sm">
            <p>
              <span className="font-medium">{h.actorName ?? 'System'}</span> · {ACTION_LABEL[h.action] ?? h.action}
              <span className="text-muted-foreground"> · {relativeTime(h.createdAt)}</span>
            </p>
            {stage?.to && (
              <p className="mt-1 text-muted-foreground">
                {stage.from ? `${stage.from} → ` : ''}
                {stage.to}
              </p>
            )}
            {h.changes && Object.keys(h.changes).length > 0 && (
              <ul className="mt-1 space-y-0.5 text-muted-foreground">
                {Object.entries(h.changes).map(([k, c]) => (
                  <li key={k}>
                    {FIELD_LABEL[k] ?? k}: {k === 'ownerId' ? 'changed' : `${show(c.from)} → ${show(c.to)}`}
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ol>
  );
}
