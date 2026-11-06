'use client';

import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input } from '@dealflow/ui';
import { type ExtensionTokenCreated, type ExtensionTokenRow, MAX_EXTENSION_TOKENS } from '@dealflow/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Puzzle } from 'lucide-react';
import { useState } from 'react';
import { ErrorText } from '@/components/revenue/tabs';
import { api } from '@/lib/api';
import { relativeTime } from '@/lib/format';
import { useCan } from '@/lib/session';
import { fmtLocale } from '@/lib/i18n/locale';
import { rich, useT } from '@/lib/i18n';

/** Connection codes for the SampForce browser extension, which saves people from web pages as leads. */
export function BrowserExtension() {
  const t = useT();
  const qc = useQueryClient();
  const canSave = useCan('leads:write');
  const rows = useQuery({ queryKey: ['extension-connections'], queryFn: () => api<ExtensionTokenRow[]>('/extension/connections') });
  const [name, setName] = useState('Chrome');
  const [created, setCreated] = useState<ExtensionTokenCreated | null>(null);
  const [copied, setCopied] = useState(false);
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['extension-connections'] }), qc.invalidateQueries({ queryKey: ['sessions'] })]);
  const create = useMutation({
    mutationFn: () => api<ExtensionTokenCreated>('/extension/connections', { method: 'POST', json: { name } }),
    onSuccess: (r) => {
      setCreated(r);
      setCopied(false);
      void refresh();
    },
  });
  const remove = useMutation({ mutationFn: (id: string) => api(`/extension/connections/${id}`, { method: 'DELETE' }), onSuccess: refresh });
  const list = rows.data ?? [];
  const origin = typeof window === 'undefined' ? '' : window.location.origin;

  return (
    <section id="extension" aria-labelledby="extension-heading" className="space-y-3">
      <h2 id="extension-heading" className="text-base font-semibold">
        {t('Browser extension')}
      </h2>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Puzzle className="size-4" aria-hidden /> {t('SampForce lead capture for Chrome and Edge')}
          </CardTitle>
          <CardDescription>
            {t('Finds email addresses on the page you are reading and saves the people as leads, checking SampForce first so nobody is added twice. You can also enrol them in a sequence, or let it save new people automatically as you browse.')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <ol className="list-decimal space-y-1 ps-5">
            <li>
              {rich(t('Install the extension. It is not in the Chrome Web Store yet: your SampForce provider can share the package, which you load from {chrome} (or {edge}) with Developer mode on and {button}.'), {
                chrome: <code className="text-xs">chrome://extensions</code>,
                edge: <code className="text-xs">edge://extensions</code>,
                button: <em>{t('Load unpacked')}</em>,
              })}
            </li>
            <li>{t('Create a connection code below. It works only for you, in this workspace, and only for the extension.')}</li>
            <li>
              {rich(t('Open the extension, enter {address} and paste the code.'), { address: <code className="text-xs">{origin || t('your SampForce address')}</code> })}
            </li>
          </ol>
          {!canSave && <p className="text-muted-foreground">{t('Your role can look people up with the extension but not save leads.')}</p>}

          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate();
            }}
          >
            <div className="min-w-48 flex-1 space-y-1">
              <label htmlFor="ext-name" className="text-sm font-medium">
                {t('Name this connection')}
              </label>
              <Input id="ext-name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder={t('Chrome on my laptop')} />
            </div>
            <Button type="submit" disabled={!name.trim() || create.isPending || list.length >= MAX_EXTENSION_TOKENS}>
              {t('Create connection code')}
            </Button>
          </form>
          {list.length >= MAX_EXTENSION_TOKENS && <p className="text-muted-foreground">{t('You have {n} connections, the most allowed. Remove one to add another.', { n: MAX_EXTENSION_TOKENS })}</p>}
          <ErrorText error={create.error ?? remove.error ?? rows.error} />

          {created && (
            <div role="status" className="space-y-1 rounded-md border border-warning/40 bg-warning/10 p-3">
              <p className="font-medium">{t('Connection code for “{name}”, shown once. Paste it into the extension now.', { name: created.connection.name })}</p>
              <div className="flex items-center gap-2">
                <code className="break-all text-xs" data-testid="extension-code">
                  {created.token}
                </code>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={t('Copy connection code')}
                  onClick={() => void navigator.clipboard?.writeText(created.token).then(() => setCopied(true))}
                >
                  <Copy aria-hidden />
                </Button>
                {copied && <span className="text-xs text-muted-foreground">{t('Copied')}</span>}
              </div>
              <p className="text-xs text-muted-foreground">{t('It lasts 90 days. Anyone with the code can save leads as you, so do not share it.')}</p>
            </div>
          )}

          {list.length > 0 && (
            <ul className="divide-y divide-border rounded-md border border-border" aria-label={t('Extension connections')}>
              {list.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{c.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {c.lastUsedAt ? t('Last used {time}', { time: relativeTime(c.lastUsedAt) }) : t('Not used yet')} · {t('ends {date}', { date: new Date(c.expiresAt).toLocaleDateString(fmtLocale()) })}
                    </span>
                  </span>
                  {c.lastUsedAt ? <Badge tone="success">{t('In use')}</Badge> : <Badge>{t('Waiting')}</Badge>}
                  <Button size="sm" variant="outline" onClick={() => remove.mutate(c.id)} disabled={remove.isPending} aria-label={t('Remove {name}', { name: c.name })}>
                    {t('Remove')}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
