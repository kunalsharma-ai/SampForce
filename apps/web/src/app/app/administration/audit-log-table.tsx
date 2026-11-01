'use client';

import { Button, Card, CardContent, CardHeader, CardTitle, Skeleton } from '@dealflow/ui';
import type { CursorPage } from '@dealflow/types';
import { useInfiniteQuery } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { fmtLocale } from '@/lib/i18n/locale';

interface AuditRow {
  id: string;
  action: string;
  actorType: string;
  actorName: string | null;
  entityType: string | null;
  ipAddress: string | null;
  createdAt: string;
}

export function AuditLogTable() {
  const q = useInfiniteQuery({
    queryKey: ['audit-logs'],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api<CursorPage<AuditRow>>(`/audit-logs?limit=25${pageParam ? `&cursor=${pageParam}` : ''}`),
    getNextPageParam: (last) => last.nextCursor,
  });

  if (q.error instanceof ApiError && q.error.status === 403) {
    return <Card className="p-5 text-sm text-muted-foreground">Your role does not include access to the audit log.</Card>;
  }
  const rows = q.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Audit log</CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {q.isPending ? (
          <Skeleton className="h-40" />
        ) : (
          <table className="w-full min-w-[640px] text-sm">
            <caption className="sr-only">Audit events, newest first</caption>
            <thead className="text-start text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="py-2 font-medium">When</th>
                <th scope="col" className="py-2 font-medium">Actor</th>
                <th scope="col" className="py-2 font-medium">Action</th>
                <th scope="col" className="py-2 font-medium">Entity</th>
                <th scope="col" className="py-2 font-medium">IP address</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="py-2 tabular text-muted-foreground">
                    <time dateTime={r.createdAt}>{new Date(r.createdAt).toLocaleString(fmtLocale())}</time>
                  </td>
                  <td className="py-2">{r.actorName ?? r.actorType.toLowerCase()}</td>
                  <td className="py-2 font-mono text-xs">{r.action}</td>
                  <td className="py-2 text-muted-foreground">{r.entityType ?? '—'}</td>
                  <td className="py-2 font-mono text-xs text-muted-foreground">{r.ipAddress ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {q.hasNextPage && (
          <Button variant="outline" size="sm" className="mt-4" onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage}>
            {q.isFetchingNextPage ? 'Loading…' : 'Load more'}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
