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
import { Badge, Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger, Skeleton } from '@dealflow/ui';
import type { DealRow, StageRow } from '@dealflow/types';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { GripVertical, MoreHorizontal } from 'lucide-react';
import { useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { formatDate, formatMoney } from '@/lib/crm';
import { useT } from '@/lib/i18n';
import { useCan } from '@/lib/session';
import { initials, PriorityBadge, RiskIndicator } from '@/components/deals/deal-badges';
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
      <div className="flex gap-3 overflow-hidden">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-96 w-72 shrink-0" />
        ))}
      </div>
    );
  }
  if (board.error) return <p role="alert" className="text-sm text-critical">{board.error.message}</p>;

  const stages = board.data.columns.map((c) => c.stage);
  return (
    <div>
      {error && (
        <p role="alert" className="mb-3 text-sm text-critical">
          {error}
        </p>
      )}
      <p id="board-instructions" className="sr-only">
        {t('To move a deal with the keyboard, focus its handle and press space. Use the left and right arrow keys to choose a stage, then press space again. Each card also has a Move menu.')}
      </p>
      <DndContext sensors={sensors} collisionDetection={rectIntersection} onDragEnd={onDragEnd} accessibility={{ announcements, screenReaderInstructions: { draggable: '' } }}>
        {/* Focusable so keyboard users can scroll the board horizontally even when it has no cards. */}
        <div className="overflow-x-auto rounded-md pb-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" tabIndex={0} role="region" aria-label={t('{pipeline} board', { pipeline: board.data.pipeline.name })}>
          <div className="flex gap-3" role="list" aria-label={t('{pipeline} stages', { pipeline: board.data.pipeline.name })}>
            {board.data.columns.map((col) => (
              <Column key={col.stage.id} column={col} stages={stages} canWrite={canWrite} onMove={request} onOpen={onOpen} />
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

function Column({ column, stages, canWrite, onMove, onOpen }: { column: BoardColumn; stages: StageRow[]; canWrite: boolean; onMove: (d: DealRow, stageId: string) => void; onOpen: (id: string) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: column.stage.id });
  const tone = column.stage.category === 'WON' ? 'success' : column.stage.category === 'LOST' ? 'critical' : 'neutral';
  const currency = column.deals[0]?.currency ?? 'USD';
  const t = useT();
  return (
    <section
      role="listitem"
      ref={setNodeRef}
      aria-labelledby={`stage-${column.stage.id}`}
      className={`flex w-72 shrink-0 flex-col rounded-lg border bg-muted/30 transition-colors ${isOver ? 'border-primary bg-primary/5' : 'border-border'}`}
    >
      <header className="space-y-1 border-b border-border p-3">
        <div className="flex items-center justify-between gap-2">
          <h2 id={`stage-${column.stage.id}`} className="truncate text-sm font-semibold">
            {column.stage.name}
          </h2>
          <Badge tone={tone}>{column.stage.probability}%</Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          {t.plural('count.deals', column.total)} · {formatMoney(column.value, currency)}
        </p>
      </header>
      <ul className="flex min-h-24 flex-1 flex-col gap-2 p-2" aria-label={t('Deals in {stage}', { stage: column.stage.name })}>
        {column.deals.map((d) => (
          <DealCard key={d.id} deal={d} stages={stages} canWrite={canWrite} onMove={onMove} onOpen={onOpen} />
        ))}
        {column.deals.length === 0 && <li className="px-2 py-6 text-center text-xs text-muted-foreground">{t('Drop deals here')}</li>}
        {column.total > column.deals.length && (
          <li className="px-2 py-1 text-center text-xs text-muted-foreground">
            {t('Showing {shown} of {total}. Use the list view to see all.', { shown: column.deals.length, total: column.total })}
          </li>
        )}
      </ul>
    </section>
  );
}

function DealCard({ deal, stages, canWrite, onMove, onOpen }: { deal: DealRow; stages: StageRow[]; canWrite: boolean; onMove: (d: DealRow, stageId: string) => void; onOpen: (id: string) => void }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, isDragging } = useDraggable({
    id: deal.id,
    data: { stageId: deal.stage.id },
    disabled: !canWrite,
  });
  const t = useT();
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform) }}
      className={`rounded-md border border-border bg-surface p-3 shadow-sm ${isDragging ? 'relative z-10 rotate-1 shadow-lg ring-2 ring-primary' : ''}`}
    >
      <div className="flex items-start gap-1.5">
        {canWrite && (
          <button
            type="button"
            ref={setActivatorNodeRef}
            {...listeners}
            {...attributes}
            aria-describedby="board-instructions"
            aria-label={t('Move {deal}', { deal: deal.name })}
            className="-ms-1 mt-0.5 cursor-grab touch-none rounded p-0.5 text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
          >
            <GripVertical className="size-4" aria-hidden />
          </button>
        )}
        <div className="min-w-0 flex-1">
          <DealLink deal={deal} onOpen={onOpen} className="block truncate text-sm" />
          {deal.company && <p className="truncate text-xs text-muted-foreground">{deal.company.name}</p>}
        </div>
        {canWrite && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="-me-1 size-6" aria-label={t('Move {deal} to another stage', { deal: deal.name })}>
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
        )}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 text-xs">
        <span className="font-medium tabular-nums">{formatMoney(deal.amount, deal.currency)}</span>
        <span className={deal.status === 'OPEN' && deal.expectedCloseDate && deal.expectedCloseDate < new Date().toISOString().slice(0, 10) ? 'text-critical' : 'text-muted-foreground'}>
          {deal.expectedCloseDate ? t('Close {date}', { date: formatDate(deal.expectedCloseDate) }) : t('No close date')}
        </span>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <RiskIndicator health={deal.health} compact />
          <PriorityBadge priority={deal.priority} />
        </div>
        <span
          className="grid size-6 shrink-0 place-items-center rounded-full bg-primary/15 text-[10px] font-semibold text-primary"
          title={deal.owner ? t('Owner: {name}', { name: deal.owner.name }) : t('Unassigned')}
        >
          <span aria-hidden>{initials(deal.owner?.name)}</span>
          <span className="sr-only">{deal.owner ? t('Owner: {name}', { name: deal.owner.name }) : t('Unassigned')}</span>
        </span>
      </div>
    </li>
  );
}
