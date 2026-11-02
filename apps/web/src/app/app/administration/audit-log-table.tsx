'use client';

import { Button, Card, CardContent, CardHeader, CardTitle, Skeleton } from '@dealflow/ui';
import type { CursorPage } from '@dealflow/types';
import { useInfiniteQuery } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { fmtLocale } from '@/lib/i18n/locale';
import { useT } from '@/lib/i18n';

interface AuditRow {
  id: string;
  action: string;
  actorType: string;
  actorName: string | null;
  entityType: string | null;
  ipAddress: string | null;
  createdAt: string;
}

const ACTOR_LABEL: Record<string, string> = { USER: 'User', SYSTEM: 'System', AI_AGENT: 'AI agent', PLATFORM_ADMIN: 'Platform admin' };

export function AuditLogTable() {
  const t = useT();
  const q = useInfiniteQuery({
    queryKey: ['audit-logs'],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api<CursorPage<AuditRow>>(`/audit-logs?limit=25${pageParam ? `&cursor=${pageParam}` : ''}`),
    getNextPageParam: (last) => last.nextCursor,
  });

  if (q.error instanceof ApiError && q.error.status === 403) {
    return <Card className="p-5 text-sm text-muted-foreground">{t('Your role does not include access to the audit log.')}</Card>;
  }
  const rows = q.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('Audit log')}</CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {q.isPending ? (
          <Skeleton className="h-40" />
        ) : (
          <table className="w-full min-w-[640px] text-sm">
            <caption className="sr-only">{t('Audit events, newest first')}</caption>
            <thead className="text-start text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="py-2 font-medium">{t('When')}</th>
                <th scope="col" className="py-2 font-medium">{t('Actor')}</th>
                <th scope="col" className="py-2 font-medium">{t('Action')}</th>
                <th scope="col" className="py-2 font-medium">{t('Entity')}</th>
                <th scope="col" className="py-2 font-medium">{t('IP address')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="py-2 tabular text-muted-foreground">
                    <time dateTime={r.createdAt}>{new Date(r.createdAt).toLocaleString(fmtLocale())}</time>
                  </td>
                  <td className="py-2">{r.actorName ?? t.maybe(ACTOR_LABEL[r.actorType] ?? r.actorType)}</td>
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
            {q.isFetchingNextPage ? t('Loading…') : t('Load more')}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
