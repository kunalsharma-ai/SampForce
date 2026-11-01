'use client';

import type { Page } from '@dealflow/types';
import { Button, Card, cn, Input, Skeleton } from '@dealflow/ui';
import {
  type ColumnDef,
  type ColumnSizingState,
  getCoreRowModel,
  type RowSelectionState,
  type Updater,
  useReactTable,
} from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Search } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { BulkBar } from './bulk-bar';
import { Highlight } from './highlight';
import { ColumnsDialog, DensityMenu, ViewsMenu } from './table-menus';
import type { TableColumn, TableView } from './use-table-view';

const SELECT_W = 44;
const DEFAULT_W = 160;

interface Props<T extends { id: string }> {
  caption: string;
  view: TableView<T>;
  data: Page<T> | undefined;
  loading: boolean;
  error?: Error | null;
  href: (row: T) => string;
  noun: { one: string; many: string };
  /** Shown left of the view controls (filters). */
  filters?: React.ReactNode;
  empty: React.ReactNode;
  /** Bulk actions: rows can be selected when set. */
  bulk?: { statuses?: { value: string; label: string }[] };
}

/**
 * The shared enterprise table (design spec Part 10): server-paginated and sorted (Shift-click for a second or third
 * key), sticky header and first column, resizable and reorderable columns, saved views, density, row selection with
 * bulk actions, search highlighting, arrow-key movement between rows, and a card list on phones.
 */
export function DataTable<T extends { id: string }>(p: Props<T>) {
  const { view } = p;
  const [text, setText] = useState(view.config.q);
  const latest = useRef(view);
  latest.current = view;
  // Keep the box in step when a saved view changes the search.
  useEffect(() => setText(view.config.q), [view.config.q]);
  useEffect(() => {
    const t = setTimeout(
      () => text !== latest.current.config.q && latest.current.setQuery(text),
      250,
    );
    return () => clearTimeout(t);
  }, [text]);

  const [selection, setSelection] = useState<RowSelectionState>({});
  // A new filter, search or view is a new set of rows: start the selection again.
  const filterKey = JSON.stringify([view.config.q, view.config.filters, view.active?.id]);
  useEffect(() => setSelection({}), [filterKey]);
  const selectedIds = Object.keys(selection).filter((k) => selection[k]);

  const q = view.config.q;
  const visible = view.config.columns
    .map((id) => view.columns.find((c) => c.id === id))
    .filter((c): c is TableColumn<T> => !!c);

  const defs = useMemo<ColumnDef<T>[]>(() => {
    const cols: ColumnDef<T>[] = visible.map((c, i) => ({
      id: c.id,
      header: c.header,
      size: view.config.widths[c.id] ?? c.size ?? DEFAULT_W,
      minSize: 60,
      maxSize: 640,
      meta: { col: c, first: i === 0 },
    }));
    if (p.bulk)
      cols.unshift({
        id: '__select',
        size: SELECT_W,
        enableResizing: false,
        meta: { select: true },
      });
    return cols;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible.map((c) => c.id).join(), JSON.stringify(view.config.widths), !!p.bulk]);

  const sizing: ColumnSizingState = Object.fromEntries(defs.map((d) => [d.id!, d.size!]));
  const table = useReactTable({
    data: p.data?.items ?? [],
    columns: defs,
    getRowId: (r) => r.id,
    state: { rowSelection: selection, columnSizing: sizing },
    enableRowSelection: !!p.bulk,
    onRowSelectionChange: setSelection,
    columnResizeMode: 'onChange',
    onColumnSizingChange: (u: Updater<ColumnSizingState>) => {
      const next = typeof u === 'function' ? u(sizing) : u;
      for (const [id, w] of Object.entries(next))
        if (id !== '__select' && w !== sizing[id]) view.setWidth(id, w);
    },
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    manualSorting: true,
  });

  const total = p.data?.total ?? 0;
  const pageSize = p.data?.pageSize ?? 25;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (view.page - 1) * pageSize + 1;
  const to = Math.min(total, view.page * pageSize);
  const rows = table.getRowModel().rows;
  const firstLeft = p.bulk ? SELECT_W : 0;
  const sortIndex = (id: string) => view.config.sort.findIndex((s) => s.id === id);

  /** Up and Down move between rows, keeping the same column. */
  const onBodyKey = (e: React.KeyboardEvent<HTMLTableSectionElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const cell = (e.target as HTMLElement).closest('td');
    const row = cell?.parentElement as HTMLTableRowElement | null;
    if (!cell || !row) return;
    const next = (
      e.key === 'ArrowDown' ? row.nextElementSibling : row.previousElementSibling
    ) as HTMLTableRowElement | null;
    const target =
      next?.cells[cell.cellIndex]?.querySelector<HTMLElement>('a, button, input, [tabindex]') ??
      next?.querySelector<HTMLElement>('a, input');
    if (target) {
      e.preventDefault();
      target.focus();
    }
  };

  const status = p.empty;
  const phone = useIsPhone();

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
        <div className="relative min-w-0 basis-full sm:max-w-xs sm:flex-1 sm:basis-auto">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            aria-label={`Search ${p.caption.toLowerCase()}`}
            placeholder="Search…"
            className="pl-9"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </div>
        {p.filters}
        <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:ml-auto sm:w-auto">
          <ViewsMenu view={view} />
          <ColumnsDialog view={view} />
          <DensityMenu view={view} />
        </div>
      </div>
      {p.bulk && selectedIds.length > 0 && (
        <BulkBar
          entity={view.entity}
          ids={selectedIds}
          noun={p.noun}
          statuses={p.bulk.statuses}
          onClear={() => setSelection({})}
        />
      )}

      {/* Phones: one card per record instead of a squeezed table. Only one of the two layouts is rendered. */}
      {phone ? (
        <ul className="divide-y divide-border" aria-label={p.caption}>
          {p.loading && !p.data ? (
            <li className="p-4">
              <Skeleton className="h-10" />
            </li>
          ) : p.error ? (
            <li role="alert" className="p-6 text-center text-sm text-critical">
              {p.error.message}
            </li>
          ) : rows.length === 0 ? (
            <li className="p-8 text-center text-sm text-muted-foreground">{status}</li>
          ) : (
            rows.map((r) => {
              const [head, ...rest] = visible;
              return (
                <li key={r.id} className="flex items-start gap-3 px-4 py-3">
                  {p.bulk && (
                    <RowCheckbox
                      checked={r.getIsSelected()}
                      onChange={r.getToggleSelectedHandler()}
                      label={`Select ${head?.text?.(r.original) ?? 'row'}`}
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <Link
                      href={p.href(r.original)}
                      className="block truncate font-medium text-foreground underline-offset-2 hover:underline"
                    >
                      {head?.text ? (
                        <Highlight text={head.text(r.original) ?? '—'} query={q} />
                      ) : (
                        head?.cell(r.original, q)
                      )}
                    </Link>
                    <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
                      {rest.slice(0, 4).map((c) => (
                        <div key={c.id} className="min-w-0">
                          <dt className="sr-only">{c.header}</dt>
                          <dd className="truncate text-muted-foreground">
                            {c.cell(r.original, q)}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                </li>
              );
            })
          )}
        </ul>
      ) : (
        <div
          className="df-table max-h-[70vh] overflow-auto"
          data-density={view.config.density === 'auto' ? undefined : view.config.density}
        >
          <table
            className="table-fixed border-separate border-spacing-0 text-sm"
            style={{ width: table.getTotalSize(), minWidth: '100%' }}
          >
            <caption className="sr-only">
              {p.caption}
              {view.config.sort.length > 1 &&
                `, sorted by ${view.config.sort.map((s) => `${view.columns.find((c) => c.id === s.id)?.header} ${s.desc ? 'descending' : 'ascending'}`).join(', then ')}`}
            </caption>
            <thead className="text-left text-xs text-muted-foreground">
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id}>
                  {hg.headers.map((h) => {
                    const meta = h.column.columnDef.meta as {
                      col?: TableColumn<T>;
                      first?: boolean;
                      select?: boolean;
                    };
                    const sticky = meta.select ? 'left-0 z-30' : meta.first ? 'z-30' : 'z-20';
                    if (meta.select) {
                      const all = table.getIsAllPageRowsSelected();
                      return (
                        <th
                          key={h.id}
                          scope="col"
                          className={cn(
                            'sticky top-0 border-b border-border bg-muted px-3',
                            sticky,
                          )}
                          style={{ width: SELECT_W }}
                        >
                          <RowCheckbox
                            checked={all}
                            indeterminate={!all && table.getIsSomePageRowsSelected()}
                            onChange={table.getToggleAllPageRowsSelectedHandler()}
                            label="Select all rows on this page"
                          />
                        </th>
                      );
                    }
                    const col = meta.col!;
                    const si = sortIndex(col.id);
                    const s = si >= 0 ? view.config.sort[si] : undefined;
                    return (
                      <th
                        key={h.id}
                        scope="col"
                        aria-sort={si === 0 ? (s!.desc ? 'descending' : 'ascending') : undefined}
                        className={cn(
                          'group/th sticky top-0 border-b border-border bg-muted px-4 font-medium',
                          sticky,
                          col.align === 'right' && 'text-right',
                        )}
                        style={{ width: h.getSize(), ...(meta.first ? { left: firstLeft } : {}) }}
                      >
                        {col.sortKey ? (
                          <button
                            type="button"
                            title="Click to sort. Shift-click to add another sort."
                            onClick={(e) => view.toggleSort(col.id, e.shiftKey)}
                            className="inline-flex max-w-full items-center gap-1 rounded hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <span className="truncate">{col.header}</span>
                            {s &&
                              (s.desc ? (
                                <ArrowDown className="size-3 shrink-0" aria-hidden />
                              ) : (
                                <ArrowUp className="size-3 shrink-0" aria-hidden />
                              ))}
                            {s && view.config.sort.length > 1 && (
                              <span
                                className="text-[10px] tabular-nums"
                                aria-label={`sort ${si + 1}`}
                              >
                                {si + 1}
                              </span>
                            )}
                          </button>
                        ) : (
                          <span className="block truncate">{col.header}</span>
                        )}
                        <ResizeHandle
                          label={`Resize ${col.header} column`}
                          width={h.getSize()}
                          onPointerDown={h.getResizeHandler()}
                          onKeyResize={(d) => view.setWidth(col.id, h.getSize() + d)}
                          active={h.column.getIsResizing()}
                        />
                      </th>
                    );
                  })}
                </tr>
              ))}
            </thead>
            <tbody onKeyDown={onBodyKey}>
              {p.loading && !p.data ? (
                Array.from({ length: 5 }, (_, i) => (
                  <tr key={i}>
                    <td colSpan={defs.length} className="border-b border-border px-4">
                      <Skeleton className="h-5" />
                    </td>
                  </tr>
                ))
              ) : p.error ? (
                <tr>
                  <td
                    colSpan={defs.length}
                    role="alert"
                    className="px-4 py-10 text-center text-critical"
                  >
                    {p.error.message}
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={defs.length}
                    className="px-4 py-12 text-center text-muted-foreground"
                  >
                    {status}
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr
                    key={r.id}
                    data-state={r.getIsSelected() ? 'selected' : undefined}
                    className="group/row"
                  >
                    {r.getVisibleCells().map((cell) => {
                      const meta = cell.column.columnDef.meta as {
                        col?: TableColumn<T>;
                        first?: boolean;
                        select?: boolean;
                      };
                      const bg =
                        'bg-surface group-hover/row:bg-muted group-data-[state=selected]/row:bg-primary/10';
                      if (meta.select) {
                        return (
                          <td
                            key={cell.id}
                            className={cn('sticky left-0 z-10 border-b border-border px-3', bg)}
                          >
                            <RowCheckbox
                              checked={r.getIsSelected()}
                              onChange={r.getToggleSelectedHandler()}
                              label={`Select ${visible[0]?.text?.(r.original) ?? 'row'}`}
                            />
                          </td>
                        );
                      }
                      const col = meta.col!;
                      const content = col.text ? (
                        <Highlight text={col.text(r.original) ?? '—'} query={q} />
                      ) : (
                        col.cell(r.original, q)
                      );
                      return (
                        <td
                          key={cell.id}
                          className={cn(
                            'truncate border-b border-border px-4',
                            bg,
                            meta.first && 'sticky z-10',
                            col.align === 'right' && 'text-right tabular-nums',
                          )}
                          style={meta.first ? { left: firstLeft } : undefined}
                        >
                          {meta.first ? (
                            <Link
                              href={p.href(r.original)}
                              className="font-medium text-foreground hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              {content}
                            </Link>
                          ) : (
                            content
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-2 text-xs text-muted-foreground">
        <span aria-live="polite">
          {total === 0 ? 'No records' : `${from}–${to} of ${total.toLocaleString('en-US')}`}
        </span>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Previous page"
            disabled={view.page <= 1}
            onClick={() => view.setPage(view.page - 1)}
          >
            <ChevronLeft aria-hidden />
          </Button>
          <span>
            Page {view.page} of {pages}
          </span>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Next page"
            disabled={view.page >= pages}
            onClick={() => view.setPage(view.page + 1)}
          >
            <ChevronRight aria-hidden />
          </Button>
        </div>
      </div>
    </Card>
  );
}

/** True below the md breakpoint (768 px). Starts false so the server and first paint show the table. */
function useIsPhone(): boolean {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const on = () => setPhone(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return phone;
}

/** A 24 px checkbox target (WCAG 2.5.8) at every density. */
function RowCheckbox({
  checked,
  indeterminate,
  onChange,
  label,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: (e: unknown) => void;
  label: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = !!indeterminate;
  }, [indeterminate]);
  return (
    <label className="grid size-6 cursor-pointer place-items-center">
      <input
        ref={ref}
        type="checkbox"
        aria-label={label}
        checked={checked}
        onChange={onChange}
        className="size-4 accent-[hsl(var(--primary))]"
      />
    </label>
  );
}

/** Drag the edge to resize; with the keyboard, focus it and use Left and Right (Shift for bigger steps). */
function ResizeHandle({
  label,
  width,
  onPointerDown,
  onKeyResize,
  active,
}: {
  label: string;
  width: number;
  onPointerDown: (e: unknown) => void;
  onKeyResize: (delta: number) => void;
  active: boolean;
}) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={Math.round(width)}
      aria-valuemin={60}
      aria-valuemax={640}
      tabIndex={0}
      onMouseDown={onPointerDown}
      onTouchStart={onPointerDown}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          onKeyResize((e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 48 : 16));
        }
      }}
      className={cn(
        'absolute right-0 top-0 h-full w-2 cursor-col-resize touch-none select-none opacity-0 transition-opacity hover:opacity-100 focus-visible:opacity-100 group-hover/th:opacity-60',
        'after:absolute after:inset-y-1.5 after:right-0.5 after:w-0.5 after:rounded after:bg-primary',
        active && 'opacity-100',
      )}
    />
  );
}
