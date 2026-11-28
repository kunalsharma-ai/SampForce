'use client';

import {
  type Announcements,
  DndContext,
  type DragEndEvent,
  KeyboardCode,
  type KeyboardCoordinateGetter,
  KeyboardSensor,
  PointerSensor,
  rectIntersection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { Button, cn, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger, Skeleton } from '@dealflow/ui';
import type { DealRow, StageRow } from '@dealflow/types';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BellRing, Building2, CalendarClock, Contact, GripVertical, History, Inbox, MoreHorizontal, Send } from 'lucide-react';
import { useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { formatDate, formatMoney } from '@/lib/crm';
import { useT } from '@/lib/i18n';
import { useCan } from '@/lib/session';
import { initials, PriorityBadge, RiskIndicator } from '@/components/deals/deal-badges';
import { DealBulkBar } from '@/components/deals/deal-bulk-bar';
import { dealStageIcon, Icon3D, stageColours, tone } from '@/components/deals/deal-look';
import { relativeTime } from '@/lib/format';
import { UserAvatar } from '@/components/people/user-avatar';
import { DealLink } from '@/components/deals/views';
import { LossReasonDialog, useMoveDeal } from './deal-move';

interface BoardColumn {
  stage: StageRow;
  deals: DealRow[];
  total: number;
  value: number;
}
interface Board {
  pipeline: { id: string; name: string };
  columns: BoardColumn[];
}

/** Arrow keys jump a picked-up card to the neighbouring column instead of nudging it by pixels. */
const columnKeyboardCoordinates: KeyboardCoordinateGetter = (event, { context }) => {
  const { active, over, droppableRects, droppableContainers, collisionRect } = context;
  if (!active || !collisionRect) return undefined;
  if (event.code !== KeyboardCode.Right && event.code !== KeyboardCode.Left) {
    if (event.code === KeyboardCode.Up || event.code === KeyboardCode.Down) event.preventDefault();
    return undefined;
  }
  event.preventDefault();
  const columns = droppableContainers
    .getEnabled()
    .map((c) => ({ id: c.id, rect: droppableRects.get(c.id) }))
    .filter((c): c is { id: string | number; rect: NonNullable<typeof c.rect> } => !!c.rect)
    .sort((a, b) => a.rect.left - b.rect.left);
  const currentId = over?.id ?? (active.data.current as { stageId: string } | undefined)?.stageId;
  const index = columns.findIndex((c) => c.id === currentId);
  const target = columns[index + (event.code === KeyboardCode.Right ? 1 : -1)];
  if (!target) return undefined;
  return { x: target.rect.left + (target.rect.width - collisionRect.width) / 2, y: target.rect.top + 48 };
};

export function DealsBoard({ pipelineId, onOpen }: { pipelineId?: string; onOpen: (id: string) => void }) {
  const qc = useQueryClient();
  const t = useT();
  const canWrite = useCan('deals:write');
  const key = ['board', pipelineId ?? 'default'];
  const board = useQuery({ queryKey: key, queryFn: () => api<Board>(`/deals/board${pipelineId ? `?pipelineId=${pipelineId}` : ''}`) });
  const move = useMoveDeal();
  const [pendingLoss, setPendingLoss] = useState<{ deal: DealRow; stageId: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Deals picked for bulk changes (ADR 0096); cleared when the pipeline changes.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selFor, setSelFor] = useState(pipelineId);
  if (selFor !== pipelineId) {
    setSelFor(pipelineId);
    setSelected(new Set());
  }
  const toggle = (ids: string[], on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: columnKeyboardCoordinates }),
  );

  const dealsById = useMemo(() => new Map(board.data?.columns.flatMap((c) => c.deals.map((d) => [d.id, d])) ?? []), [board.data]);
  const stageName = (id: string | number | undefined) => board.data?.columns.find((c) => c.stage.id === id)?.stage.name ?? t('no stage');
  const dealName = (id: string | number) => dealsById.get(String(id))?.name ?? t('Deal');

  const announcements: Announcements = {
    onDragStart: ({ active }) => t('Picked up {deal}. Use the left and right arrow keys to choose a stage, space to drop, escape to cancel.', { deal: dealName(active.id) }),
    onDragOver: ({ active, over }) => (over ? t('{deal} is over {stage}.', { deal: dealName(active.id), stage: stageName(over.id) }) : t('{deal} is not over a stage.', { deal: dealName(active.id) })),
    onDragEnd: ({ active, over }) => (over ? t('{deal} dropped in {stage}.', { deal: dealName(active.id), stage: stageName(over.id) }) : t('{deal} was dropped outside the board.', { deal: dealName(active.id) })),
    onDragCancel: ({ active }) => t('Moving {deal} was cancelled.', { deal: dealName(active.id) }),
  };

  /** Moves the card in the cached board immediately, then confirms with the API. */
  function commit(deal: DealRow, stageId: string, lossReason?: string) {
    setError(null);
    const previous = qc.getQueryData<Board>(key);
    qc.setQueryData<Board>(key, (b) => {
      if (!b) return b;
      const target = b.columns.find((c) => c.stage.id === stageId)!;
      return {
        ...b,
        columns: b.columns.map((c) => {
          if (c.stage.id === deal.stage.id) return { ...c, deals: c.deals.filter((d) => d.id !== deal.id), total: c.total - 1, value: c.value - deal.amount };
          if (c.stage.id === stageId) return { ...c, deals: [{ ...deal, stage: target.stage }, ...c.deals], total: c.total + 1, value: c.value + deal.amount };
          return c;
        }),
      };
    });
    move.mutate(
      { id: deal.id, stageId, lossReason },
      {
        onError: (e) => {
          qc.setQueryData(key, previous);
          setError(t('Could not move “{deal}”: {error}', { deal: deal.name, error: e.message }));
        },
      },
    );
  }

  function request(deal: DealRow, stageId: string) {
    if (stageId === deal.stage.id) return;
    const stage = board.data?.columns.find((c) => c.stage.id === stageId)?.stage;
    if (stage?.category === 'LOST') setPendingLoss({ deal, stageId });
    else commit(deal, stageId);
  }

  function onDragEnd(e: DragEndEvent) {
    const deal = dealsById.get(String(e.active.id));
    if (deal && e.over) request(deal, String(e.over.id));
  }

  if (board.isPending) {
    return (
      <div className="flex gap-3 overflow-hidden" aria-busy="true">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-96 w-[18.5rem] shrink-0 rounded-2xl" />
        ))}
      </div>
    );
  }
  if (board.error) return <p role="alert" className="text-sm text-critical">{board.error.message}</p>;

  const stages = board.data.columns.map((c) => c.stage);
  const colours = stageColours(stages);
  const boardValue = board.data.columns.reduce((n, c) => n + (c.stage.category === 'LOST' ? 0 : c.value), 0);
  const visibleIds = new Set(board.data.columns.flatMap((c) => c.deals.map((d) => d.id)));
  const chosen = [...selected].filter((id) => visibleIds.has(id));
  return (
    <div>
      {error && (
        <p role="alert" className="mb-3 text-sm text-critical">
          {error}
        </p>
      )}
      {/* Above the board, in the page flow: it never covers a card, the phone bar or the chat tab. */}
      {canWrite && chosen.length > 0 && <DealBulkBar ids={chosen} stages={stages} onClear={() => setSelected(new Set())} />}
      <p id="board-instructions" className="sr-only">
        {t('To move a deal with the keyboard, focus its handle and press space. Use the left and right arrow keys to choose a stage, then press space again. Each card also has a Move menu.')}
      </p>
      <DndContext sensors={sensors} collisionDetection={rectIntersection} onDragEnd={onDragEnd} accessibility={{ announcements, screenReaderInstructions: { draggable: '' } }}>
        {/* Focusable so keyboard users can scroll the board horizontally even when it has no cards. */}
        <div className="-mx-1 overflow-x-auto rounded-2xl px-1 pb-4 pt-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" tabIndex={0} role="region" aria-label={t('{pipeline} board', { pipeline: board.data.pipeline.name })} data-deals-board>
          <div className="flex items-start gap-3" role="list" aria-label={t('{pipeline} stages', { pipeline: board.data.pipeline.name })}>
            {board.data.columns.map((col) => (
              <Column
                key={col.stage.id}
                column={col}
                colour={colours.get(col.stage.id)!}
                share={boardValue > 0 && col.stage.category !== 'LOST' ? col.value / boardValue : 0}
                stages={stages}
                canWrite={canWrite}
                selected={selected}
                onSelect={toggle}
                onMove={request}
                onOpen={onOpen}
              />
            ))}
          </div>
        </div>
      </DndContext>
      {pendingLoss && (
        <LossReasonDialog
          dealName={pendingLoss.deal.name}
          onCancel={() => setPendingLoss(null)}
          onConfirm={(reason) => {
            commit(pendingLoss.deal, pendingLoss.stageId, reason);
            setPendingLoss(null);
          }}
        />
      )}
    </div>
  );
}

interface ColumnProps {
  column: BoardColumn;
  colour: string;
  /** This stage's part of the board's open and won value, 0-1. */
  share: number;
  stages: StageRow[];
  canWrite: boolean;
  selected: Set<string>;
  onSelect: (ids: string[], on: boolean) => void;
  onMove: (d: DealRow, stageId: string) => void;
  onOpen: (id: string) => void;
}

function Column({ column, colour, share, stages, canWrite, selected, onSelect, onMove, onOpen }: ColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: column.stage.id });
  const currency = column.deals[0]?.currency ?? 'USD';
  const t = useT();
  const ids = column.deals.map((d) => d.id);
  const picked = ids.filter((id) => selected.has(id)).length;
  const Icon = dealStageIcon(column.stage);
  return (
    <section
      role="listitem"
      ref={setNodeRef}
      aria-labelledby={`stage-${column.stage.id}`}
      data-over={isOver}
      data-stage-column={column.stage.category}
      style={tone(colour)}
      className="sf-col flex w-[18.5rem] shrink-0 flex-col transition-shadow"
    >
      <header className="space-y-2.5 p-3 pb-2.5">
        <div className="flex items-center gap-2.5">
          <Icon3D icon={Icon} colour={colour} />
          <div className="min-w-0 flex-1">
            <h2 id={`stage-${column.stage.id}`} className="truncate text-sm font-semibold" title={column.stage.name}>
              {column.stage.name}
            </h2>
            <p className="truncate text-xs text-muted-foreground">
              <span className="sf-ink font-semibold tabular-nums">{formatMoney(column.value, currency)}</span> · {t.plural('count.deals', column.total)}
            </p>
          </div>
          <span className="sf-chip shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums" title={t('Stage probability')}>
            {column.stage.probability}%
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted" role="img" aria-label={t('{percent}% of the board’s value', { percent: Math.round(share * 100) })}>
            <div className="sf-bar h-full rounded-full transition-[width] duration-500" style={{ width: `${Math.max(share > 0 ? 3 : 0, share * 100)}%` }} />
          </div>
          {canWrite && ids.length > 0 && (
            <label className="inline-flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
              <input
                type="checkbox"
                className="size-4 accent-[hsl(var(--primary))]"
                checked={picked === ids.length}
                ref={(el) => {
                  if (el) el.indeterminate = picked > 0 && picked < ids.length;
                }}
                onChange={(e) => onSelect(ids, e.target.checked)}
                aria-label={t('Select every deal in {stage}', { stage: column.stage.name })}
              />
              {t('All')}
            </label>
          )}
        </div>
      </header>
      <ul className="flex min-h-24 flex-1 flex-col gap-2 p-2 pt-0" aria-label={t('Deals in {stage}', { stage: column.stage.name })}>
        {column.deals.map((d) => (
          <DealCard key={d.id} deal={d} colour={colour} stages={stages} canWrite={canWrite} selected={selected.has(d.id)} onSelect={onSelect} onMove={onMove} onOpen={onOpen} />
        ))}
        {column.deals.length === 0 && (
          <li className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border px-2 py-6 text-center text-xs text-muted-foreground">
            <Icon aria-hidden className="sf-ink size-5 opacity-60" />
            {t('Drop deals here')}
          </li>
        )}
        {column.total > column.deals.length && (
          <li className="px-2 py-1 text-center text-xs text-muted-foreground">
            {t('Showing {shown} of {total}. Use the list view to see all.', { shown: column.deals.length, total: column.total })}
          </li>
        )}
      </ul>
    </section>
  );
}

const today = () => new Date().toISOString().slice(0, 10);
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

interface CardProps {
  deal: DealRow;
  colour: string;
  stages: StageRow[];
  canWrite: boolean;
  selected: boolean;
  onSelect: (ids: string[], on: boolean) => void;
  onMove: (d: DealRow, stageId: string) => void;
  onOpen: (id: string) => void;
}

function DealCard({ deal, colour, stages, canWrite, selected, onSelect, onMove, onOpen }: CardProps) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, isDragging } = useDraggable({
    id: deal.id,
    data: { stageId: deal.stage.id },
    disabled: !canWrite,
  });
  const t = useT();
  const close = deal.expectedCloseDate;
  const overdue = deal.status === 'OPEN' && !!close && close < today();
  const soon = deal.status === 'OPEN' && !!close && !overdue && close <= inDays(7);
  const follow = deal.nextFollowUp;
  const followOverdue = !!follow?.dueAt && follow.dueAt.slice(0, 10) < today();
  return (
    <li
      ref={setNodeRef}
      style={{ ...tone(colour), transform: CSS.Translate.toString(transform) }}
      data-deal-card={deal.id}
      data-selected={selected}
      className={cn('sf-deal-card sf-lift p-3 ps-4', isDragging && 'relative z-10 rotate-1 shadow-lg ring-2 ring-primary')}
    >
      <div className="flex items-start gap-2">
        {canWrite && (
          <input
            type="checkbox"
            className="mt-1 size-4 shrink-0 accent-[hsl(var(--primary))]"
            checked={selected}
            onChange={(e) => onSelect([deal.id], e.target.checked)}
            aria-label={t('Select {deal}', { deal: deal.name })}
          />
        )}
        <span aria-hidden className="sf-chip grid size-8 shrink-0 place-items-center rounded-lg text-[11px] font-bold">
          {initials(deal.company?.name ?? deal.name)}
        </span>
        <div className="min-w-0 flex-1">
          <DealLink deal={deal} onOpen={onOpen} className="line-clamp-2 break-words text-sm font-semibold leading-snug" />
          <p className="truncate text-xs text-muted-foreground" title={deal.company?.name}>
            {deal.company ? (
              <span className="inline-flex max-w-full items-center gap-1">
                <Building2 aria-hidden className="size-3 shrink-0" />
                <span className="truncate">{deal.company.name}</span>
              </span>
            ) : (
              t('No company')
            )}
          </p>
        </div>
        {canWrite && (
          <div className="-me-1 flex shrink-0 flex-col items-center gap-0.5">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="size-6" aria-label={t('Move {deal} to another stage', { deal: deal.name })}>
                  <MoreHorizontal aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>{t('Move to')}</DropdownMenuLabel>
                {stages
                  .filter((s) => s.id !== deal.stage.id)
                  .map((s) => (
                    <DropdownMenuItem key={s.id} onSelect={() => onMove(deal, s.id)}>
                      {s.name}
                    </DropdownMenuItem>
                  ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <button
              type="button"
              ref={setActivatorNodeRef}
              {...listeners}
              {...attributes}
              aria-describedby="board-instructions"
              aria-label={t('Move {deal}', { deal: deal.name })}
              className="cursor-grab touch-none rounded p-0.5 text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
            >
              <GripVertical className="size-4" aria-hidden />
            </button>
          </div>
        )}
      </div>

      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <span className="sf-ink text-base font-bold tabular-nums">{formatMoney(deal.amount, deal.currency)}</span>
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium',
            overdue ? 'bg-critical/10 text-critical' : soon ? 'bg-warning/15 text-foreground' : 'bg-muted text-muted-foreground',
          )}
        >
          <CalendarClock aria-hidden className="size-3" />
          {close ? (overdue ? t('Overdue · {date}', { date: formatDate(close) }) : t('Close {date}', { date: formatDate(close) })) : t('No close date')}
        </span>
      </div>

      <ul className="mt-2 space-y-1 text-xs" aria-label={t('Deal details')}>
        {deal.contact && (
          <li className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
            <Contact aria-hidden className="size-3.5 shrink-0" />
            <span className="truncate">{deal.contact.name}</span>
          </li>
        )}
        <li className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
          <History aria-hidden className="size-3.5 shrink-0" />
          <span className="truncate">{deal.lastActivityAt ? t('Last activity {when}', { when: relativeTime(deal.lastActivityAt) }) : t('No activity yet')}</span>
        </li>
        <li className={cn('flex min-w-0 items-center gap-1.5', followOverdue ? 'font-medium text-critical' : 'text-muted-foreground')}>
          <BellRing aria-hidden className="size-3.5 shrink-0" />
          <span className="truncate" title={follow?.title}>
            {follow ? (follow.dueAt ? t('Follow-up {date}', { date: formatDate(follow.dueAt) }) : t('Follow-up: {title}', { title: follow.title })) : t('No follow-up booked')}
          </span>
        </li>
      </ul>

      <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-border/70 pt-2">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <RiskIndicator health={deal.health} compact />
          <PriorityBadge priority={deal.priority} />
          {deal.rfq && (
            <span className="inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground" title={deal.rfq.projectName}>
              <Inbox aria-hidden className="size-3" /> {deal.rfq.number}
            </span>
          )}
          {deal.sampbidx && (
            <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-[11px] text-primary" title={t('SampBidx')}>
              <Send aria-hidden className="size-3" /> {deal.sampbidx.delivery === 'SENT' ? t('In SampBidx') : deal.sampbidx.delivery === 'FAILED' ? t('SampBidx failed') : t('Sending')}
            </span>
          )}
        </div>
        <span className="relative shrink-0" title={deal.owner ? t('Owner: {name}', { name: deal.owner.name }) : t('Unassigned')}>
          <UserAvatar userId={deal.owner?.id} name={deal.owner?.name ?? '?'} className="size-7 text-[10px] ring-2 ring-surface" />
          <span className="sr-only">{deal.owner ? t('Owner: {name}', { name: deal.owner.name }) : t('Unassigned')}</span>
        </span>
      </div>
    </li>
  );
}
