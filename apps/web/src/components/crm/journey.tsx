'use client';

import type { JourneyCard, JourneyStep, JourneyStageRow } from '@dealflow/types';
import { Button, Card, CardContent, CardHeader, CardTitle, cn, Dialog, DialogContent, DialogDescription, DialogTitle, Input, Skeleton } from '@dealflow/ui';
import { AlarmClock, Ban, Building2, CalendarClock, Check, CircleDot, CirclePause, CircleSlash, CircleX, Handshake, Inbox, type LucideIcon, MailCheck, MailQuestion, MessagesSquare, Repeat, Search, ThumbsDown, Trophy, UserPlus, UsersRound } from 'lucide-react';
import type { JourneyKey } from '@dealflow/types';
import { Icon3D } from '@/components/deals/deal-look';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import * as React from 'react';
import { formatDate } from '@/lib/crm';
import { useT } from '@/lib/i18n';
import { useCompanyJourney, useJourneyBoard } from '@/lib/journey';
import { StatusChip } from './status-chip';
import { STAGE_CHIP, STAGE_DOT, stageStyle } from './stage-chip';

/** An icon per journey stage, drawn as a raised tile on the column head (Deals and Pipeline redesign, ADR 0096). */
const JOURNEY_ICON: Record<JourneyKey, LucideIcon> = {
  NEW: UserPlus,
  FRESH_EMAIL: MailQuestion,
  INITIAL_EMAIL: MailCheck,
  FOLLOW_UP: Repeat,
  DISCUSSION: MessagesSquare,
  RFQ: Inbox,
  NEGOTIATION: Handshake,
  WON: Trophy,
  LOST: CircleSlash,
  REJECTED: Ban,
  NOT_INTERESTED: ThumbsDown,
  ON_HOLD: CirclePause,
};

/**
 * The Pipeline journey board (redesign R5, ADR 0085): every company the person can see, as a card in the column of
 * its journey stage. A card shows the stage, the follow-up it is on, the next action and when it is due; opening it
 * shows the company's visual journey.
 */
export function JourneyBoardView() {
  const t = useT();
  const [q, setQ] = React.useState('');
  const [query, setQuery] = React.useState('');
  // ?mine=true opens on the person's own companies (the dashboard's pipeline strip links here).
  const params = useSearchParams();
  const [mine, setMine] = React.useState(params.get('mine') === 'true');
  const [open, setOpen] = React.useState<JourneyCard | null>(null);
  React.useEffect(() => {
    const id = window.setTimeout(() => setQuery(q), 250);
    return () => window.clearTimeout(id);
  }, [q]);
  const board = useJourneyBoard({ q: query, mine });
  return (
    <div className="space-y-4" data-journey-board>
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-sm">
          <Search aria-hidden className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Search companies or company numbers')} aria-label={t('Search companies or company numbers')} className="ps-9" />
        </div>
        <label className="flex min-h-9 items-center gap-2 text-sm">
          <input type="checkbox" className="size-4 accent-[hsl(var(--primary))]" checked={mine} onChange={(e) => setMine(e.target.checked)} />
          {t('Only my companies')}
        </label>
        {board.data && <p className="ms-auto text-sm text-muted-foreground" role="status">{t.plural('count.companies', board.data.total)}</p>}
      </div>
      {board.data && board.data.total > 0 && <JourneySummary columns={board.data.columns} total={board.data.total} />}
      {board.error && <p role="alert" className="text-sm text-critical">{board.error.message}</p>}
      {board.isPending ? (
        <div className="flex gap-3 overflow-hidden">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-96 w-72 shrink-0 rounded-2xl" />)}
        </div>
      ) : (
        board.data && (
          <div className="-mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" role="list" aria-label={t('Journey stages')} tabIndex={0}>
            {board.data.columns.map((col) => (
              <section key={col.stage.key} role="listitem" aria-label={`${col.stage.name}: ${col.total}`} data-journey-column={col.stage.key} style={stageStyle(col.stage.color)} className="sf-col flex w-72 shrink-0 snap-start flex-col">
                <header className="flex items-center gap-2.5 px-3 pb-2 pt-3">
                  <Icon3D icon={JOURNEY_ICON[col.stage.key] ?? CircleDot} colour={col.stage.color} />
                  <div className="min-w-0 flex-1">
                    <h2 className="truncate text-sm font-semibold" title={t.maybe(col.stage.name)}>{t.maybe(col.stage.name)}</h2>
                    <p className="text-xs text-muted-foreground">{t.plural('count.companies', col.total)}</p>
                  </div>
                  <span className={cn('rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums', STAGE_CHIP)}>{col.total}</span>
                </header>
                <ul className="flex max-h-[70vh] flex-col gap-2 overflow-y-auto p-2 pt-1">
                  {col.cards.length === 0 && <li className="rounded-lg border border-dashed border-border p-3 text-center text-xs text-muted-foreground">{t('No companies here')}</li>}
                  {col.cards.map((c) => (
                    <li key={c.companyId}>
                      <JourneyCardView card={c} stage={col.stage} onOpen={() => setOpen(c)} />
                    </li>
                  ))}
                  {col.total > col.cards.length && <li className="px-1 text-xs text-muted-foreground">{t('{n} more: search to narrow the list', { n: String(col.total - col.cards.length) })}</li>}
                </ul>
              </section>
            ))}
          </div>
        )
      )}
      <Dialog open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="top-[5%] max-h-[90vh] max-w-2xl overflow-y-auto p-6">
          <DialogTitle className="text-lg font-semibold">{open?.name}</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">{t('Where this company is in its journey, and what comes next.')}</DialogDescription>
          {open && <CompanyJourneySteps companyId={open.companyId} />}
          {open && (
            <div className="flex justify-end">
              <Button asChild size="sm">
                <Link href={`/app/companies/${open.companyId}`}>{t('Open company')}</Link>
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Totals across the journey: companies on the way, won, ended, and where most of them are. */
function JourneySummary({ columns, total }: { columns: { stage: JourneyStageRow; total: number }[]; total: number }) {
  const t = useT();
  const sum = (keys: JourneyKey[]) => columns.filter((c) => keys.includes(c.stage.key)).reduce((n, c) => n + c.total, 0);
  const won = sum(['WON']);
  const ended = sum(['LOST', 'REJECTED', 'NOT_INTERESTED']);
  const active = total - won - ended - sum(['ON_HOLD']);
  const tiles: { label: string; value: number; icon: LucideIcon; colour: string }[] = [
    { label: t('All companies'), value: total, icon: Building2, colour: '#257de0' },
    { label: t('On the way'), value: active, icon: Repeat, colour: '#6a4ce2' },
    { label: t('Won'), value: won, icon: Trophy, colour: '#008a17' },
    { label: t('Ended'), value: ended, icon: CircleX, colour: '#ec4647' },
  ];
  return (
    <div className="space-y-3" data-journey-summary>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((x) => (
          <div key={x.label} className="sf-kpi sf-lift" style={stageStyle(x.colour)}>
            <Icon3D icon={x.icon} colour={x.colour} />
            <div className="min-w-0">
              <p className="truncate text-xs font-medium text-muted-foreground">{x.label}</p>
              <p className="text-xl font-bold tabular-nums leading-tight">{x.value.toLocaleString(t.formatLocale)}</p>
              <p className="text-xs text-muted-foreground">{total ? `${Math.round((x.value / total) * 100)}%` : '—'}</p>
            </div>
          </div>
        ))}
      </div>
      <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-muted" role="img" aria-label={t('Companies in each journey stage')}>
        {columns.filter((c) => c.total > 0).map((c) => (
          <span key={c.stage.key} title={`${t.maybe(c.stage.name)}: ${c.total}`} className={cn('h-full', STAGE_DOT)} style={{ ...stageStyle(c.stage.color), width: `${(c.total / total) * 100}%` }} />
        ))}
      </div>
    </div>
  );
}

function JourneyCardView({ card: c, stage, onOpen }: { card: JourneyCard; stage: JourneyStageRow; onOpen: () => void }) {
  const t = useT();
  const due = c.nextAction?.dueAt;
  return (
    <button
      type="button"
      onClick={onOpen}
      data-journey-card={c.companyId}
      aria-label={t('{company}: {stage}. Open the journey', { company: c.name, stage: t.maybe(stage.name) })}
      style={stageStyle(stage.color)}
      className="sf-deal-card w-full space-y-2 p-3 ps-4 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex min-w-0 items-start gap-2">
        {c.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={c.logoUrl} alt="" className="size-8 shrink-0 rounded-md border border-border bg-white object-contain" />
        ) : (
          <span aria-hidden className={cn('flex size-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold', STAGE_CHIP)}>
            {c.name.slice(0, 2).toUpperCase()}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold" title={c.name}>{c.name}</p>
          <p className="truncate text-xs text-muted-foreground">{[c.leadNumber, c.owner?.name].filter(Boolean).join(' · ') || '—'}</p>
        </div>
      </div>
      {c.status && <StatusChip status={c.status} className="max-w-full" />}
      <div className="space-y-1 text-xs">
        {c.followUp && (
          <p className="flex items-center gap-1 text-foreground">
            <Repeat aria-hidden className="size-3.5 shrink-0" /> {t('Follow-up {step} of {total}', { step: c.followUp.step, total: c.followUp.total })}
          </p>
        )}
        {c.nextAction ? (
          <p className={cn('flex min-w-0 items-start gap-1', c.nextAction.overdue ? 'font-semibold text-critical' : 'text-foreground')}>
            {c.nextAction.overdue ? <AlarmClock aria-hidden className="mt-0.5 size-3.5 shrink-0" /> : <CalendarClock aria-hidden className="mt-0.5 size-3.5 shrink-0" />}
            <span className="min-w-0 break-words">
              {c.nextAction.title}
              {due && <span className="block font-normal text-muted-foreground">{c.nextAction.overdue ? t('Overdue since {date}', { date: formatDate(due) }) : t('Due {date}', { date: formatDate(due) })}</span>}
            </span>
          </p>
        ) : (
          <p className="text-muted-foreground">{t('No next action')}</p>
        )}
        <p className="flex items-center gap-3 text-muted-foreground">
          <span className="inline-flex items-center gap-1"><UsersRound aria-hidden className="size-3.5" /> {c.employees}</span>
          {c.openRfqs > 0 && <span className="inline-flex items-center gap-1"><Inbox aria-hidden className="size-3.5" /> {t('{n} open RFQs', { n: String(c.openRfqs) })}</span>}
        </p>
      </div>
    </button>
  );
}

const STEP_LABEL = { DONE: 'Done', CURRENT: 'Current', NEXT: 'Next', PENDING: 'Pending', WON: 'Won', LOST: 'Ended', ON_HOLD: 'On hold' } as const;

/** A company's visual journey: steps done, current, next and pending, ending in Won or where it ended. */
export function CompanyJourneySteps({ companyId }: { companyId: string }) {
  const t = useT();
  const j = useCompanyJourney(companyId);
  if (j.isPending) return <Skeleton className="h-64" />;
  if (j.error) return <p role="alert" className="text-sm text-critical">{j.error.message}</p>;
  return (
    <ol className="relative space-y-0" aria-label={t('Company journey')} data-company-journey>
      {j.data.steps.map((s, i) => (
        <JourneyStepRow key={s.key} step={s} last={i === j.data.steps.length - 1} />
      ))}
    </ol>
  );
}

function JourneyStepRow({ step: s, last }: { step: JourneyStep; last: boolean }) {
  const t = useT();
  const Icon = s.state === 'DONE' ? Check : s.state === 'WON' ? Trophy : s.state === 'LOST' ? CircleX : s.state === 'ON_HOLD' ? CirclePause : CircleDot;
  const strong = s.state === 'CURRENT' || s.state === 'WON' || s.state === 'LOST' || s.state === 'ON_HOLD';
  return (
    <li className="relative flex gap-3 pb-4 last:pb-0" data-step={s.key} data-state={s.state} style={stageStyle(s.color)}>
      {!last && <span aria-hidden className={cn('absolute start-[15px] top-8 h-[calc(100%-1.5rem)] w-0.5', s.state === 'DONE' ? STAGE_DOT : 'bg-border')} />}
      <span
        aria-hidden
        className={cn(
          'relative flex size-8 shrink-0 items-center justify-center rounded-full border-2',
          s.state === 'PENDING' ? 'border-dashed border-border bg-surface text-muted-foreground' : s.state === 'NEXT' ? 'border-[var(--st-bd)] bg-surface text-[var(--st-fg)] dark:border-[var(--st-bd-d)] dark:text-[var(--st-fg-d)]' : STAGE_CHIP,
          strong && 'ring-4 ring-[var(--st-bg)] dark:ring-[var(--st-bg-d)]',
        )}
      >
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1 pt-1">
        <p className={cn('text-sm', strong ? 'font-semibold' : s.state === 'PENDING' ? 'text-muted-foreground' : 'font-medium')}>{t.maybe(s.name)}</p>
        <p className="text-xs text-muted-foreground">
          {t(STEP_LABEL[s.state])}
          {s.at && s.state !== 'PENDING' && s.state !== 'NEXT' ? ` · ${formatDate(s.at)}` : ''}
        </p>
      </div>
    </li>
  );
}

/** The journey on the company profile. */
export function CompanyJourneyCard({ companyId }: { companyId: string }) {
  const t = useT();
  return (
    <Card id="journey">
      <CardHeader>
        <CardTitle className="text-base">{t('Company journey')}</CardTitle>
      </CardHeader>
      <CardContent>
        <CompanyJourneySteps companyId={companyId} />
      </CardContent>
    </Card>
  );
}
