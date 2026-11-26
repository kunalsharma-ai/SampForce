'use client';

import { type ContributorStatus, type EmployeeStageRow, STAGE_PHASES, type StageKey, type StagePhase, type StageRef, stageTones } from '@dealflow/types';
import { cn, Popover, PopoverContent, PopoverTrigger } from '@dealflow/ui';
import {
  MailCheck,
  MailQuestion,
  Ban,
  BadgeCheck,
  CalendarClock,
  Check,
  ChevronDown,
  CirclePause,
  CircleSlash,
  CircleX,
  Handshake,
  Inbox,
  ListChecks,
  type LucideIcon,
  MessagesSquare,
  PhoneCall,
  Repeat,
  ScanSearch,
  Send,
  Sparkles,
  Trophy,
  UserPlus,
} from 'lucide-react';
import * as React from 'react';
import { type MessageKey, useT } from '@/lib/i18n';

/*
 * Communication stage chips (ADR 0080). Each stage has its own colour, drawn as a soft tint with readable text and
 * a border, in light and dark (stageTones checks 4.5:1 for both), plus its own icon, and follow-ups their number,
 * so no stage is told apart by colour alone.
 */

const KEY_ICON: Record<StageKey, LucideIcon> = {
  NEW_CONTACT: UserPlus,
  FRESH_EMAIL_PENDING: MailQuestion,
  INITIAL_EMAIL_SENT: MailCheck,
  RFQ_RECEIVED: Inbox,
  RFQ_REVIEW: ScanSearch,
  RFQ_QUALIFICATION: ListChecks,
  RFQ_SENT_SAMPBIDX: Send,
  FOLLOW_UP_1: Repeat,
  FOLLOW_UP_2: Repeat,
  FOLLOW_UP_3: Repeat,
  FOLLOW_UP_4: Repeat,
  FOLLOW_UP_5: Repeat,
  FOLLOW_UP_MORE: Repeat,
  DISCUSSION: MessagesSquare,
  CALL_SCHEDULED: CalendarClock,
  CALL_DONE: PhoneCall,
  NEGOTIATION: Handshake,
  RFQ_WON: Trophy,
  RFQ_REJECTED: CircleX,
  RFQ_LOST: CircleSlash,
  RFQ_CANCELLED: Ban,
  ON_HOLD: CirclePause,
};
const PHASE_ICON: Record<StagePhase, LucideIcon> = {
  NEW: UserPlus,
  RFQ: Inbox,
  FOLLOW_UP: Repeat,
  DISCUSSION: MessagesSquare,
  CALL: PhoneCall,
  NEGOTIATION: Handshake,
  WON: Trophy,
  LOST: CircleSlash,
  ON_HOLD: CirclePause,
};

export const PHASE_LABEL: Record<StagePhase, MessageKey> = {
  NEW: 'New',
  RFQ: 'RFQ',
  FOLLOW_UP: 'Follow-ups',
  DISCUSSION: 'Discussion',
  CALL: 'Calls',
  NEGOTIATION: 'Negotiation',
  WON: 'Won',
  LOST: 'Closed – not won',
  ON_HOLD: 'On hold',
};

/** CSS variables for a stage colour; the chip classes below read them in the light and the dark theme. */
export function stageStyle(color: string): React.CSSProperties {
  const t = stageTones(color);
  return {
    '--st-bg': t.light.bg,
    '--st-fg': t.light.fg,
    '--st-bd': t.light.border,
    '--st-dot': t.light.dot,
    '--st-bg-d': t.dark.bg,
    '--st-fg-d': t.dark.fg,
    '--st-bd-d': t.dark.border,
    '--st-dot-d': t.dark.dot,
  } as React.CSSProperties;
}
export const STAGE_CHIP = 'border bg-[var(--st-bg)] text-[var(--st-fg)] border-[var(--st-bd)] dark:bg-[var(--st-bg-d)] dark:text-[var(--st-fg-d)] dark:border-[var(--st-bd-d)]';
export const STAGE_DOT = 'bg-[var(--st-dot)] dark:bg-[var(--st-dot-d)]';

export function StageIcon({ stage, className }: { stage: Pick<StageRef, 'key' | 'phase'>; className?: string }) {
  const Icon = (stage.key && KEY_ICON[stage.key]) || PHASE_ICON[stage.phase] || Sparkles;
  const n = stage.key?.match(/^FOLLOW_UP_(\d)$/)?.[1] ?? (stage.key === 'FOLLOW_UP_MORE' ? '+' : null);
  if (n) {
    return (
      <span aria-hidden className={cn('inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-[var(--st-fg)] text-[10px] font-bold leading-none text-[var(--st-bg)] dark:bg-[var(--st-fg-d)] dark:text-[#0b1120]', className)}>
        {n}
      </span>
    );
  }
  return <Icon aria-hidden className={cn('size-3.5 shrink-0', className)} />;
}

/** A communication stage as a chip. `size="lg"` for headers. Long names wrap rather than being cut off. */
export function StageChip({ stage, size = 'sm', className, animate }: { stage: Pick<StageRef, 'name' | 'color' | 'key' | 'phase'> | null | undefined; size?: 'sm' | 'lg'; className?: string; animate?: boolean }) {
  const t = useT();
  if (!stage) {
    return <span className={cn('inline-flex items-center rounded-full border border-dashed border-border px-2 py-0.5 text-xs text-muted-foreground', className)}>{t('No stage yet')}</span>;
  }
  const name = t.maybe(stage.name);
  return (
    <span
      style={stageStyle(stage.color)}
      title={name}
      data-stage={stage.key ?? stage.phase}
      className={cn(
        'inline-flex max-w-full items-center gap-1.5 rounded-full text-start font-medium leading-snug',
        size === 'lg' ? 'px-3 py-1 text-sm' : 'px-2 py-0.5 text-xs',
        STAGE_CHIP,
        animate && 'duration-300 animate-in fade-in zoom-in-95',
        className,
      )}
    >
      <StageIcon stage={stage} />
      <span className="min-w-0 break-words">{name}</span>
    </span>
  );
}

const CONTRIBUTOR: Record<ContributorStatus, { label: MessageKey; cls: string; icon: LucideIcon | null }> = {
  ACTIVE: {
    label: 'Active RFQ Contributor',
    // Gold, the strongest signal on the row: this person sends RFQs now.
    cls: 'border-amber-400/70 bg-gradient-to-r from-amber-50 to-yellow-50 text-amber-900 dark:border-amber-400/50 dark:from-amber-400/15 dark:to-yellow-300/10 dark:text-amber-200',
    icon: Sparkles,
  },
  CONTRIBUTOR: {
    label: 'RFQ Contributor',
    cls: 'border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-400/40 dark:bg-sky-400/10 dark:text-sky-200',
    icon: BadgeCheck,
  },
  NONE: { label: 'No RFQ Received', cls: 'border-border bg-muted/40 text-muted-foreground', icon: null },
};

export function ContributorBadge({ status, className }: { status: ContributorStatus; className?: string }) {
  const t = useT();
  const c = CONTRIBUTOR[status];
  return (
    <span data-contributor={status} className={cn('inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-start text-xs font-semibold leading-snug', c.cls, className)}>
      {c.icon && <c.icon aria-hidden className="size-3.5 shrink-0" />}
      <span className="min-w-0 break-words">{t(c.label)}</span>
    </span>
  );
}

/**
 * Picks a stage: every active stage of the workspace, grouped by phase, each in its own colour. Any stage can be
 * picked at any time. An optional note goes into the employee's history with the change.
 */
export function StagePicker({
  stages,
  current,
  onPick,
  disabled,
  label,
  withNote = true,
}: {
  stages: EmployeeStageRow[];
  current: StageRef | null;
  onPick: (stageId: string, note: string | null) => void;
  disabled?: boolean;
  label: string;
  withNote?: boolean;
}) {
  const t = useT();
  const [open, setOpen] = React.useState(false);
  const [note, setNote] = React.useState('');
  const pick = (id: string) => {
    onPick(id, note.trim() || null);
    setNote('');
    setOpen(false);
  };
  const usable = stages.filter((s) => !s.archived || s.id === current?.id);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={label}
          className="group inline-flex max-w-full items-center gap-1 rounded-full text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed"
        >
          <StageChip stage={current} />
          {!disabled && <ChevronDown aria-hidden className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(22rem,calc(100vw-2rem))] p-0">
        <div className="max-h-[min(26rem,60vh)] overflow-y-auto p-2">
          {STAGE_PHASES.map((phase) => {
            const list = usable.filter((s) => s.phase === phase);
            if (!list.length) return null;
            return (
              <div key={phase} className="mb-1.5">
                <p className="px-2 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t(PHASE_LABEL[phase])}</p>
                <ul className="flex flex-wrap gap-1.5 px-1" aria-label={t(PHASE_LABEL[phase])}>
                  {list.map((s) => {
                    const on = s.id === current?.id;
                    return (
                      <li key={s.id}>
                        <button
                          type="button"
                          aria-pressed={on}
                          onClick={() => pick(s.id)}
                          className={cn('relative inline-flex min-h-7 items-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', on && 'ring-2 ring-foreground/60 ring-offset-1 ring-offset-popover')}
                        >
                          <StageChip stage={s} />
                          {on && <Check aria-hidden className="absolute -end-1 -top-1 size-3.5 rounded-full bg-foreground p-0.5 text-background" />}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
        {withNote && (
          <div className="border-t border-border p-2">
            <label className="sr-only" htmlFor="stage-note">
              {t('Note for the history (optional)')}
            </label>
            <input
              id="stage-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={1000}
              placeholder={t('Note for the history (optional)')}
              className="h-8 w-full rounded-md border border-input bg-surface px-2 text-sm"
            />
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** How the employees of a company spread over the stages: a slim bar plus a legend, each stage in its colour. */
export function StageSpread({ stages, counts, onPick, active }: { stages: EmployeeStageRow[]; counts: Map<string, number>; onPick?: (stageId: string | null) => void; active?: string | null }) {
  const t = useT();
  const used = stages.filter((s) => (counts.get(s.id) ?? 0) > 0);
  const total = used.reduce((n, s) => n + (counts.get(s.id) ?? 0), 0);
  if (!total) return null;
  return (
    <div className="space-y-2">
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted" role="img" aria-label={used.map((s) => `${t.maybe(s.name)}: ${counts.get(s.id)}`).join(', ')}>
        {used.map((s) => (
          <span key={s.id} style={{ ...stageStyle(s.color), width: `${((counts.get(s.id) ?? 0) / total) * 100}%` }} className={cn('h-full border-e border-background/60 last:border-e-0', STAGE_DOT)} />
        ))}
      </div>
      <ul className="flex flex-wrap gap-1.5" aria-label={t('Employees by stage')}>
        {used.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              aria-pressed={active === s.id}
              onClick={() => onPick?.(active === s.id ? null : s.id)}
              className={cn('inline-flex min-h-7 items-center gap-1 rounded-full transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', active && active !== s.id && 'opacity-50 hover:opacity-100')}
            >
              <StageChip stage={s} />
              <span className="text-xs font-semibold tabular-nums text-muted-foreground">{counts.get(s.id)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

