'use client';

import { Button, Card, Input, Skeleton } from '@dealflow/ui';
import type { Page } from '@dealflow/types';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Search } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

export interface Column<T> {
  key: string;
  header: string;
  /** Server-side sort key, when the column is sortable. */
  sort?: string;
  cell: (row: T) => React.ReactNode;
  className?: string;
}

interface Props<T extends { id: string }> {
  caption: string;
  columns: Column<T>[];
  data: Page<T> | undefined;
  loading: boolean;
  error?: Error | null;
  href: (row: T) => string;
  search: string;
  onSearch: (q: string) => void;
  sort: { key?: string; order: 'asc' | 'desc' };
  onSort: (key: string) => void;
  page: number;
  onPage: (p: number) => void;
  toolbar?: React.ReactNode;
  empty: React.ReactNode;
}

/** Server-paginated, sortable record table. The first column links to the record. */
export function DataTable<T extends { id: string }>(p: Props<T>) {
  const [text, setText] = useState(p.search);
  const latest = useRef({ search: p.search, onSearch: p.onSearch });
  latest.current = { search: p.search, onSearch: p.onSearch };
  useEffect(() => {
    const t = setTimeout(() => text !== latest.current.search && latest.current.onSearch(text), 250);
    return () => clearTimeout(t);
  }, [text]);

  const total = p.data?.total ?? 0;
  const pageSize = p.data?.pageSize ?? 25;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (p.page - 1) * pageSize + 1;
  const to = Math.min(total, p.page * pageSize);

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input aria-label={`Search ${p.caption.toLowerCase()}`} placeholder="Search…" className="pl-9" value={text} onChange={(e) => setText(e.target.value)} />
        </div>
        {p.toolbar}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <caption className="sr-only">{p.caption}</caption>
          <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
            <tr>
              {p.columns.map((c) => {
                const active = c.sort && p.sort.key === c.sort;
                return (
                  <th key={c.key} scope="col" aria-sort={active ? (p.sort.order === 'asc' ? 'ascending' : 'descending') : undefined} className={`px-4 py-2.5 font-medium ${c.className ?? ''}`}>
                    {c.sort ? (
                      <button type="button" onClick={() => p.onSort(c.sort!)} className="inline-flex items-center gap-1 rounded hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        {c.header}
                        {active && (p.sort.order === 'asc' ? <ArrowUp className="size-3" aria-hidden /> : <ArrowDown className="size-3" aria-hidden />)}
                      </button>
                    ) : (
                      c.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {p.loading && !p.data ? (
              Array.from({ length: 5 }, (_, i) => (
                <tr key={i} className="border-t border-border">
                  <td colSpan={p.columns.length} className="px-4 py-3">
                    <Skeleton className="h-5" />
                  </td>
                </tr>
              ))
            ) : p.error ? (
              <tr>
                <td colSpan={p.columns.length} role="alert" className="px-4 py-10 text-center text-critical">
                  {p.error.message}
                </td>
              </tr>
            ) : p.data?.items.length === 0 ? (
              <tr>
                <td colSpan={p.columns.length} className="px-4 py-12 text-center text-muted-foreground">
                  {p.empty}
                </td>
              </tr>
            ) : (
              p.data?.items.map((row) => (
                <tr key={row.id} className="border-t border-border hover:bg-muted/30">
                  {p.columns.map((c, i) => (
                    <td key={c.key} className={`px-4 py-2.5 ${c.className ?? ''}`}>
                      {i === 0 ? (
                        <Link href={p.href(row)} className="font-medium text-foreground hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                          {c.cell(row)}
                        </Link>
                      ) : (
                        c.cell(row)
                      )}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-2 text-xs text-muted-foreground">
        <span aria-live="polite">{total === 0 ? 'No records' : `${from}–${to} of ${total.toLocaleString('en-US')}`}</span>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" aria-label="Previous page" disabled={p.page <= 1} onClick={() => p.onPage(p.page - 1)}>
            <ChevronLeft aria-hidden />
          </Button>
          <span>
            Page {p.page} of {pages}
          </span>
          <Button variant="ghost" size="icon" aria-label="Next page" disabled={p.page >= pages} onClick={() => p.onPage(p.page + 1)}>
            <ChevronRight aria-hidden />
          </Button>
        </div>
      </div>
    </Card>
  );
}

/** Table state (search, sort, page) kept in one hook so list pages stay small. */
export function useTableState(defaultSort?: string) {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<{ key?: string; order: 'asc' | 'desc' }>({ key: defaultSort, order: 'desc' });
  return {
    q,
    page,
    sort,
    onSearch: (v: string) => {
      setQ(v);
      setPage(1);
    },
    onPage: setPage,
    onSort: (key: string) => setSort((s) => ({ key, order: s.key === key && s.order === 'desc' ? 'asc' : 'desc' })),
    params: { q, page, sort: sort.key, order: sort.order },
  };
}
