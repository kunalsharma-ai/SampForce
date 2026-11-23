'use client';

import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label, Skeleton } from '@dealflow/ui';
import type { AnnouncementRow } from '@dealflow/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Megaphone } from 'lucide-react';
import { useState } from 'react';
import { ErrorText } from '@/components/revenue/tabs';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { fmtLocale } from '@/lib/i18n/locale';
import { useCan } from '@/lib/session';

/**
 * Announcements (ADR 0072, M8): everyone reads them; owners and administrators post and remove them. Posting one also
 * notifies everyone, on the web and on phones where the Mobile Configuration allows it.
 */
export function AnnouncementsBoard() {
  const t = useT();
  const canPost = useCan('tenant:manage');
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['announcements'], queryFn: () => api<AnnouncementRow[]>('/announcements') });
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const post = useMutation({
    mutationFn: () => api<AnnouncementRow>('/announcements', { method: 'POST', json: { title: title.trim(), body: body.trim() } }),
    onSuccess: () => {
      setTitle('');
      setBody('');
      void qc.invalidateQueries({ queryKey: ['announcements'] });
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/announcements/${id}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['announcements'] }),
  });

  return (
    <div className="space-y-6">
      {canPost && (
        <Card>
          <CardHeader>
            <CardTitle>{t('Post an announcement')}</CardTitle>
            <CardDescription>{t('Everyone in the organisation gets it as a notification.')}</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                post.mutate();
              }}
            >
              <div className="space-y-1">
                <Label htmlFor="announcement-title">{t('Title')}</Label>
                <Input id="announcement-title" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} required />
              </div>
              <div className="space-y-1">
                <Label htmlFor="announcement-body">{t('Message')}</Label>
                <textarea id="announcement-body" className="min-h-24 w-full rounded-md border border-border bg-background p-2 text-sm" maxLength={2000} value={body} onChange={(e) => setBody(e.target.value)} required />
              </div>
              {post.error && <ErrorText error={post.error} />}
              <Button type="submit" disabled={post.isPending || title.trim().length < 2 || !body.trim()}>
                {t('Post announcement')}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {list.isPending ? (
        <Skeleton className="h-40" />
      ) : list.error ? (
        <ErrorText error={list.error} />
      ) : list.data.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Megaphone className="size-4" aria-hidden />
          {t('No announcements yet.')}
        </p>
      ) : (
        <ul className="space-y-3">
          {list.data.map((a) => (
            <li key={a.id}>
              <Card>
                <CardHeader>
                  <CardTitle>{a.title}</CardTitle>
                  <CardDescription>
                    {new Date(a.createdAt).toLocaleString(fmtLocale(), { dateStyle: 'medium', timeStyle: 'short' })}
                    {a.author ? ` · ${a.author.name}` : ''}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="whitespace-pre-line text-sm">{a.body}</p>
                  {canPost && (
                    <Button variant="outline" size="sm" disabled={remove.isPending} onClick={() => remove.mutate(a.id)} aria-label={t('Remove "{title}"', { title: a.title })}>
                      {t('Remove')}
                    </Button>
                  )}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
