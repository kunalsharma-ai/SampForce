'use client';

import { type SavedView, sortParam, type TableDensity, type TableEntity, type ViewConfig } from '@dealflow/types';
import { useEffect, useMemo, useState } from 'react';
import { useSession } from '@/lib/session';
import { sameConfig, useSavedViews } from '@/lib/table-views';

export interface TableColumn<T> {
  /** Stable id stored in saved views. */
  id: string;
  header: string;
  /** Server sort field, when the column can be sorted. */
  sortKey?: string;
  cell: (row: T, q: string) => React.ReactNode;
  /** Plain text for search highlighting and the phone layout. */
  text?: (row: T) => string | null;
  align?: 'right';
  /** Default width in pixels. */
  size?: number;
  /** Hidden until the person turns it on. */
  defaultHidden?: boolean;
}

const LAST_VIEW = (entity: string) => `dealflow:last-view:${entity}`;

/**
 * Everything that describes how a list looks: visible columns and their order and widths, sort keys, filters, search
 * and density. It starts from the default layout or a saved view, and knows when it has drifted from that view.
 */
export function useTableView<T>(entity: TableEntity, columns: TableColumn<T>[], defaultSort: { id: string; desc: boolean }[]) {
  const { data: me } = useSession();
  const views = useSavedViews(entity);
  const defaults = useMemo<ViewConfig>(
    () => ({ columns: columns.filter((c) => !c.defaultHidden).map((c) => c.id), widths: {}, sort: defaultSort, filters: {}, q: '', density: 'auto' }),
    // Columns and default sort are module constants for each list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entity],
  );
  const [config, setConfig] = useState<ViewConfig>(defaults);
  const [viewId, setViewId] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const active: SavedView | null = views.data?.find((v) => v.id === viewId) ?? null;
  const base = active?.config ?? defaults;
  const dirty = !sameConfig(config, base);

  // Reopen the view the person last used on this list.
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    if (restored || !views.data) return;
    setRestored(true);
    let last: string | null = null;
    try {
      last = localStorage.getItem(LAST_VIEW(entity));
    } catch {
      /* storage unavailable */
    }
    const v = views.data.find((x) => x.id === last);
    if (v) {
      setViewId(v.id);
      setConfig(sanitize(v.config, columns));
    }
  }, [views.data, restored, entity, columns]);

  const apply = (v: SavedView | null) => {
    setViewId(v?.id ?? null);
    setConfig(v ? sanitize(v.config, columns) : defaults);
    setPage(1);
    try {
      if (v) localStorage.setItem(LAST_VIEW(entity), v.id);
      else localStorage.removeItem(LAST_VIEW(entity));
    } catch {
      /* storage unavailable */
    }
  };

  const patch = (p: Partial<ViewConfig>, resetPage = true) => {
    setConfig((c) => ({ ...c, ...p }));
    if (resetPage) setPage(1);
  };

  /** Click sorts by one column (asc, desc, off); with Shift it adds or flips a secondary key (up to three). */
  const toggleSort = (id: string, additive: boolean) =>
    setConfig((c) => {
      const cur = c.sort.find((s) => s.id === id);
      let next: ViewConfig['sort'];
      if (!additive) next = !cur ? [{ id, desc: false }] : !cur.desc ? [{ id, desc: true }] : [];
      else if (!cur) next = [...c.sort, { id, desc: false }].slice(-3);
      else next = cur.desc ? c.sort.filter((s) => s.id !== id) : c.sort.map((s) => (s.id === id ? { ...s, desc: true } : s));
      return { ...c, sort: next };
    });

  const ownerId = config.filters.ownerId === 'me' ? me?.user.id : config.filters.ownerId;
  const sortCols = config.sort.map((s) => ({ id: columns.find((c) => c.id === s.id)?.sortKey ?? '', desc: s.desc })).filter((s) => s.id);
  const params = { page, q: config.q || undefined, sort: sortParam(sortCols), status: config.filters.status || undefined, ownerId };

  return {
    entity,
    columns,
    config,
    defaults,
    views,
    active,
    dirty,
    page,
    setPage,
    params,
    apply,
    toggleSort,
    setQuery: (q: string) => patch({ q }),
    setFilter: (f: Partial<ViewConfig['filters']>) => patch({ filters: { ...config.filters, ...f } }),
    setColumns: (cols: string[]) => patch({ columns: cols }, false),
    setWidth: (id: string, w: number) => patch({ widths: { ...config.widths, [id]: Math.round(Math.min(640, Math.max(60, w))) } }, false),
    setDensity: (density: TableDensity) => patch({ density }, false),
    reset: () => setConfig(base),
  };
}
export type TableView<T> = ReturnType<typeof useTableView<T>>;

/** Drops columns a saved view names that this list no longer has, keeping at least one. */
function sanitize<T>(c: ViewConfig, columns: TableColumn<T>[]): ViewConfig {
  const known = new Set(columns.map((x) => x.id));
  const cols = c.columns.filter((id) => known.has(id));
  return { ...c, columns: cols.length ? cols : [columns[0]!.id], sort: c.sort.filter((s) => known.has(s.id)) };
}
