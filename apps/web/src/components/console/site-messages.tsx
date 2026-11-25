'use client';

import { SITE_SUPPORT_STATUSES, type SiteSupportList, type SiteSupportRow, type SiteSupportStatus } from '@dealflow/types';
import { Badge, Button, Card, Input, Skeleton } from '@dealflow/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Globe, Mail, RotateCcw, Search } from 'lucide-react';
import { useState } from 'react';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { TOPIC_LABELS } from '@/lib/site-faq';

const KEY = ['operator', 'site-support'] as const;

export function useSiteMessages(status: SiteSupportStatus | undefined, q: string, enabled: boolean) {
  return useQuery({
    enabled,
    queryKey: [...KEY, status ?? 'ALL', q],
    queryFn: () => api<SiteSupportList>(`/operator/support/site-requests?${new URLSearchParams({ ...(status ? { status } : {}), ...(q ? { q } : {}) })}`),
    refetchInterval: 60_000,
  });
}

/**
 * The Console's Website messages (ADR 0078): what signed-out visitors sent from Help & Support on the public site.
 * Someone replies by email, then marks the message handled.
 */
export function SiteMessagesView({ enabled }: { enabled: boolean }) {
  const t = useT();
  const [status, setStatus] = useState<SiteSupportStatus | undefined>('NEW');
  const [q, setQ] = useState('');
  const list = useSiteMessages(status, q.trim(), enabled);
  const client = useQueryClient();
  const update = useMutation({
    mutationFn: ({ id, next }: { id: string; next: SiteSupportStatus }) => api<SiteSupportRow>(`/operator/support/site-requests/${id}`, { method: 'PATCH', json: { status: next } }),
    onSuccess: () => client.invalidateQueries({ queryKey: KEY }),
  });
  const label = (s: SiteSupportStatus | undefined) => (s === 'NEW' ? t('New') : s === 'HANDLED' ? t('Handled') : t('All messages'));
  const count = (s: SiteSupportStatus | undefined) => {
    const c = list.data?.counts;
    if (!c) return null;
    return s ? c[s] : SITE_SUPPORT_STATUSES.reduce((n, x) => n + c[x], 0);
  };

  return (
    <div data-site-messages="">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label={t('Message status')} className="flex flex-wrap gap-1 rounded-xl border border-border bg-muted/40 p-1">
          {(['NEW', 'HANDLED', undefined] as const).map((s) => (
            <button
              key={s ?? 'ALL'}
              type="button"
              role="tab"
              aria-selected={status === s}
              onClick={() => setStatus(s)}
              className="rounded-lg px-3 py-1.5 text-sm text-muted-foreground aria-selected:bg-surface aria-selected:font-semibold aria-selected:text-foreground aria-selected:shadow-sm"
              data-site-status={s ?? 'ALL'}
            >
              {label(s)}
              {count(s) !== null && <span className="ms-1.5 rounded-full bg-background px-1.5 text-[11px] font-medium">{count(s)}</span>}
            </button>
          ))}
        </div>
        <div className="relative ms-auto w-full sm:w-72">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Search name, email or reference')} aria-label={t('Search website messages')} className="ps-9" />
        </div>
      </div>
      {list.isLoading || !enabled ? (
        <div className="space-y-2">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      ) : !list.data?.rows.length ? (
        <Card className="p-10 text-center" data-no-site-messages="">
          <Globe className="mx-auto size-10 text-muted-foreground" aria-hidden />
          <p className="mt-2 text-sm text-muted-foreground">{t('No website messages here.')}</p>
        </Card>
      ) : (
        <ul className="space-y-3" aria-label={t('Website messages')}>
          {list.data.rows.map((m) => (
            <li key={m.id} data-site-message={m.reference}>
              <Card className="p-4">
                <div className="flex flex-wrap items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{m.name}</span>
                      <Badge tone={m.status === 'NEW' ? 'primary' : 'success'}>{label(m.status)}</Badge>
                      <Badge>{t.maybe(TOPIC_LABELS[m.topic])}</Badge>
                    </p>
                    <p className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                      <span className="font-mono">{m.reference}</span>
                      <span>{new Date(m.createdAt).toLocaleString(t.formatLocale, { dateStyle: 'medium', timeStyle: 'short' })}</span>
                      {m.language && <span className="uppercase">{m.language}</span>}
                      {m.pagePath && <span>{m.pagePath}</span>}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <a
                      href={`mailto:${m.email}?subject=${encodeURIComponent(`SampForce ${m.reference}`)}`}
                      className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border px-3 text-sm font-medium hover:bg-muted"
                    >
                      <Mail className="size-4" aria-hidden /> {t('Reply to {email}', { email: m.email })}
                    </a>
                    <Button
                      size="sm"
                      variant={m.status === 'NEW' ? 'default' : 'outline'}
                      disabled={update.isPending}
                      onClick={() => update.mutate({ id: m.id, next: m.status === 'NEW' ? 'HANDLED' : 'NEW' })}
                      data-site-message-action={m.status === 'NEW' ? 'handle' : 'reopen'}
                    >
                      {m.status === 'NEW' ? <CheckCircle2 aria-hidden /> : <RotateCcw aria-hidden />}
                      {m.status === 'NEW' ? t('Mark handled') : t('Reopen')}
                    </Button>
                  </div>
                </div>
                <p className="mt-3 whitespace-pre-wrap text-sm">{m.message}</p>
                {m.handledAt && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {t('Handled by {name} on {date}', { name: m.handledByName ?? '—', date: new Date(m.handledAt).toLocaleString(t.formatLocale, { dateStyle: 'medium', timeStyle: 'short' }) })}
                  </p>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
