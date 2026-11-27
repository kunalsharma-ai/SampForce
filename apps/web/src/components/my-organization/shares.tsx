'use client';

import { ORG_DOCUMENT_CATEGORY_LABELS, type OrgShareRow } from '@dealflow/types';
import { Button, cn, Dialog, DialogContent, DialogDescription, DialogTitle, Field, Input } from '@dealflow/ui';
import { Ban, Building2, CheckCircle2, Clock, ExternalLink, Eye, FileText, Link2, Mail, MessageCircle, Send, Share2 } from 'lucide-react';
import * as React from 'react';
import { ComposeDialog } from '@/app/app/communication/mailbox';
import { Select, Textarea } from '@/components/crm/select';
import { useIntegrations } from '@/lib/automation';
import { useT } from '@/lib/i18n';
import { useOrgDocuments, useOrgMutations, useOrgShares, useOrgOverview } from '@/lib/my-organization';
import { useCan } from '@/lib/session';
import { CATEGORY_STYLE, CopyButton, EmptyState, formatDay, formatWhen, TONES } from './parts';

const DAYS = [1, 3, 7, 14, 30] as const;

/** The client links made so far: who they went to, what they hold, whether they were opened. */
export function SharePanel({ onShare, canManage }: { onShare: () => void; canManage: boolean }) {
  const t = useT();
  const shares = useOrgShares();
  const rows = shares.data ?? [];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-border bg-surface p-4 text-sm shadow-sm">
        <div className="space-y-0.5">
          <p className="font-semibold">{t('Share with clients by secure link')}</p>
          <p className="max-w-2xl text-muted-foreground">
            {t('A link shows only the profile sections and approved documents you choose, and stops working when it expires or you stop it. Credentials and internal documents are never included.')}
          </p>
        </div>
        <Button onClick={onShare}>
          <Send className="size-4" aria-hidden /> {t('New client link')}
        </Button>
      </div>
      {!canManage && <p className="text-xs text-muted-foreground">{t('You see the links you made. The Super and Manager Workspaces see every link.')}</p>}
      {shares.isPending ? (
        <div className="h-40 animate-pulse rounded-2xl bg-muted motion-reduce:animate-none" aria-busy />
      ) : shares.isError ? (
        <p className="rounded-xl border border-critical/40 bg-critical/5 p-4 text-sm">{t('Could not load the client links. Refresh to try again.')}</p>
      ) : rows.length === 0 ? (
        <EmptyState icon={Share2} title={t('No client links yet')} text={t('Send a client your company profile and approved certificates in one link.')} />
      ) : (
        <ul className="space-y-3">
          {rows.map((s) => (
            <ShareRow key={s.id} s={s} />
          ))}
        </ul>
      )}
    </div>
  );
}

const STATUS_STYLE: Record<OrgShareRow['status'], string> = {
  active: 'bg-emerald-500/10 text-emerald-700 ring-emerald-500/30 dark:text-emerald-300',
  expired: 'bg-muted text-muted-foreground ring-border',
  revoked: 'bg-rose-500/10 text-rose-700 ring-rose-500/30 dark:text-rose-300',
};

function ShareRow({ s }: { s: OrgShareRow }) {
  const t = useT();
  const { revoke } = useOrgMutations();
  const [confirm, setConfirm] = React.useState(false);
  const who = s.recipientName || s.recipientEmail || s.company?.name || t('A client');
  return (
    <li className="rounded-2xl border border-border bg-surface p-4 shadow-sm" data-share={who}>
      <div className="flex flex-wrap items-start gap-3">
        <span className={cn('inline-flex size-10 shrink-0 items-center justify-center rounded-xl', TONES.sky)}>
          <Link2 className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <p className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{who}</span>
            {s.recipientEmail && s.recipientName && <span className="text-sm text-muted-foreground">{s.recipientEmail}</span>}
            <span className={cn('rounded-full px-2 py-0.5 text-xs font-semibold ring-1', STATUS_STYLE[s.status])}>{s.status === 'active' ? t('Active') : s.status === 'expired' ? t('Expired') : t('Stopped')}</span>
          </p>
          <ul className="flex flex-wrap gap-1.5 text-xs" aria-label={t('What the link shows')}>
            {s.includeProfile && (
              <li className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary">
                <Building2 className="size-3" aria-hidden /> {t('Company profile')}
              </li>
            )}
            {s.documents.map((d) => (
              <li key={d.id} className="inline-flex max-w-[16rem] items-center gap-1 rounded-full bg-muted px-2 py-0.5 font-medium">
                <FileText className="size-3 shrink-0" aria-hidden />
                <span className="truncate">{d.title}</span>
              </li>
            ))}
          </ul>
          <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            <span>{t('Shared {when}', { when: formatWhen(s.createdAt, t.formatLocale) })}{s.createdBy && ` · ${s.createdBy.name}`}</span>
            <span className="inline-flex items-center gap-1">
              <Clock className="size-3" aria-hidden />
              {s.status === 'revoked' && s.revokedAt
                ? t('Stopped {when}', { when: formatWhen(s.revokedAt, t.formatLocale) })
                : s.status === 'expired'
                  ? t('Expired {date}', { date: formatDay(s.expiresAt.slice(0, 10), t.formatLocale) })
                  : t('Works until {when}', { when: formatWhen(s.expiresAt, t.formatLocale) })}
            </span>
            <span className="inline-flex items-center gap-1">
              <Eye className="size-3" aria-hidden />
              {s.views ? t('Opened {count} times, last {when}', { count: s.views, when: formatWhen(s.lastViewedAt ?? s.createdAt, t.formatLocale) }) : t('Not opened yet')}
            </span>
          </p>
        </div>
        {s.status === 'active' &&
          (confirm ? (
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium">{t('Stop this link?')}</span>
              <Button size="sm" variant="outline" onClick={() => setConfirm(false)}>
                {t('Keep')}
              </Button>
              <Button size="sm" variant="destructive" disabled={revoke.isPending} onClick={() => revoke.mutate(s.id, { onSettled: () => setConfirm(false) })}>
                {t('Stop link')}
              </Button>
            </div>
          ) : (
            <Button size="sm" variant="outline" onClick={() => setConfirm(true)}>
              <Ban className="size-4" aria-hidden /> {t('Stop link')}
            </Button>
          ))}
      </div>
      {revoke.error && (
        <p role="alert" className="mt-2 text-sm text-critical">
          {revoke.error.message}
        </p>
      )}
    </li>
  );
}

/**
 * Makes a client link: the profile and any approved documents, who it is for, a note and how long it works. Then it
 * hands over the link to copy, email from the connected mailbox, or send another way.
 */
export function ShareDialog({ open, profileReady, preselected, onOpenChange, onDone }: { open: boolean; profileReady: boolean; preselected: string[]; onOpenChange: (open: boolean) => void; onDone: () => void }) {
  const t = useT();
  const docs = useOrgDocuments({ shareable: 'true', sort: 'title' });
  const org = useOrgOverview();
  const { share } = useOrgMutations();
  const [includeProfile, setIncludeProfile] = React.useState(profileReady);
  const [ids, setIds] = React.useState<string[]>(preselected);
  const [recipientName, setRecipientName] = React.useState('');
  const [recipientEmail, setRecipientEmail] = React.useState('');
  const [message, setMessage] = React.useState('');
  const [days, setDays] = React.useState<number>(7);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [made, setMade] = React.useState<OrgShareRow | null>(null);
  const available = docs.data ?? [];

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!includeProfile && ids.length === 0) return setErrors({ form: t('Choose the profile or at least one document to share') });
    setErrors({});
    try {
      const row = await share.mutateAsync({ includeProfile, documentIds: ids, recipientName: recipientName.trim() || null, recipientEmail: recipientEmail.trim() || null, message: message.trim() || null, expiresInDays: days });
      setMade(row);
    } catch (err) {
      const details = (err as { details?: { path: string; message: string }[] }).details;
      const out: Record<string, string> = {};
      for (const d of details ?? []) out[d.path.split('.')[0] ?? ''] ??= d.message;
      setErrors(Object.keys(out).length ? out : { form: err instanceof Error ? err.message : String(err) });
    }
  };

  const close = (o: boolean) => {
    if (o || share.isPending) return;
    onOpenChange(false);
    if (made) onDone();
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="top-[4%] max-h-[92vh] max-w-2xl overflow-y-auto p-6">
        {made?.url ? (
          <ShareResult row={made} url={made.url} brand={org.data?.profile.brandName ?? ''} onClose={() => close(false)} />
        ) : (
          <>
            <DialogTitle className="text-lg font-semibold">{t('Share with a client')}</DialogTitle>
            <DialogDescription className="mb-4 text-sm text-muted-foreground">{t('Only approved documents can be shared. Credentials and internal documents are never included.')}</DialogDescription>
            <form onSubmit={submit} noValidate className="space-y-5">
              <fieldset className="space-y-2">
                <legend className="mb-1 text-sm font-semibold">{t('What to share')}</legend>
                <Choice checked={includeProfile} disabled={!profileReady} onChange={setIncludeProfile} icon={Building2} title={t('Company profile')} text={profileReady ? t('The sections chosen under "What clients may see" in the profile.') : t('Set up the profile first.')} />
                {docs.isPending ? (
                  <div className="h-16 animate-pulse rounded-xl bg-muted motion-reduce:animate-none" />
                ) : available.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-border p-3 text-sm text-muted-foreground">{t('No documents are approved for clients yet. Open a document and choose Approve for clients.')}</p>
                ) : (
                  <ul className="grid max-h-64 gap-2 overflow-y-auto sm:grid-cols-2">
                    {available.map((d) => {
                      const style = CATEGORY_STYLE[d.category];
                      return (
                        <li key={d.id}>
                          <Choice
                            checked={ids.includes(d.id)}
                            onChange={(on) => setIds((s) => (on ? [...s, d.id] : s.filter((x) => x !== d.id)))}
                            icon={style.icon}
                            tone={style.tone}
                            title={d.title}
                            text={t.maybe(ORG_DOCUMENT_CATEGORY_LABELS[d.category])}
                            warn={d.expiry === 'expired' ? t('Expired') : undefined}
                          />
                        </li>
                      );
                    })}
                  </ul>
                )}
              </fieldset>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field id="org-share-name" label={t('Client name')} error={errors.recipientName}>
                  <Input value={recipientName} onChange={(e) => setRecipientName(e.target.value)} maxLength={160} placeholder={t('For example, Priya at Acme Research')} />
                </Field>
                <Field id="org-share-email" label={t('Client email')} error={errors.recipientEmail}>
                  <Input type="email" value={recipientEmail} onChange={(e) => setRecipientEmail(e.target.value)} />
                </Field>
                <div className="sm:col-span-2">
                  <Field id="org-share-message" label={t('Note on the page (optional)')} error={errors.message}>
                    <Textarea rows={2} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={1000} />
                  </Field>
                </div>
                <Field id="org-share-days" label={t('Link works for')}>
                  <Select value={String(days)} onChange={(e) => setDays(Number(e.target.value))}>
                    {DAYS.map((d) => (
                      <option key={d} value={d}>
                        {d === 1 ? t('1 day') : t('{count} days', { count: d })}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              {errors.form && (
                <p role="alert" className="text-sm text-critical">
                  {errors.form}
                </p>
              )}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => close(false)}>
                  {t('Cancel')}
                </Button>
                <Button type="submit" disabled={share.isPending}>
                  <Link2 className="size-4" aria-hidden /> {share.isPending ? t('Making the link…') : t('Make the link')}
                </Button>
              </div>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Choice({ checked, disabled, onChange, icon: Icon, tone = 'primary', title, text, warn }: { checked: boolean; disabled?: boolean; onChange: (on: boolean) => void; icon: typeof Building2; tone?: keyof typeof TONES; title: string; text: string; warn?: string }) {
  return (
    <label className={cn('flex cursor-pointer items-center gap-3 rounded-xl border p-3 text-sm transition', checked ? 'border-primary bg-primary/5' : 'border-border bg-background/60 hover:border-primary/40', disabled && 'cursor-not-allowed opacity-60')}>
      <input type="checkbox" checked={checked && !disabled} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="size-4 shrink-0 accent-[hsl(var(--primary))]" />
      <span className={cn('inline-flex size-8 shrink-0 items-center justify-center rounded-lg', TONES[tone])}>
        <Icon className="size-4" aria-hidden />
      </span>
      <span className="min-w-0">
        <span className="block truncate font-medium">{title}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {text}
          {warn && <span className="ms-1 font-semibold text-rose-700 dark:text-rose-300">· {warn}</span>}
        </span>
      </span>
    </label>
  );
}

function ShareResult({ row, url, brand, onClose }: { row: OrgShareRow; url: string; brand: string; onClose: () => void }) {
  const t = useT();
  const integrations = useIntegrations();
  const canSend = useCan('activities:write');
  const mailbox = canSend && !!integrations.data?.some((p) => p.connection?.status === 'CONNECTED');
  const [composing, setComposing] = React.useState(false);
  const subject = t('{brand}: company profile and documents', { brand });
  const body = [row.recipientName ? t('Hello {name},', { name: row.recipientName }) : t('Hello,'), '', t('Here is our company profile and the documents you asked for:'), url, '', t('The link works until {date}.', { date: formatDay(row.expiresAt.slice(0, 10), t.formatLocale) })].join('\n');
  const mailto = `mailto:${encodeURIComponent(row.recipientEmail ?? '')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  const whatsapp = `https://wa.me/?text=${encodeURIComponent(`${subject}\n${url}`)}`;
  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
          <CheckCircle2 className="size-6" aria-hidden />
        </span>
        <div>
          <DialogTitle className="text-lg font-semibold">{t('The link is ready')}</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">{t('Copy it now: for safety it is shown only once. It works until {date}.', { date: formatWhen(row.expiresAt, t.formatLocale) })}</DialogDescription>
        </div>
      </div>
      <div className="flex items-center gap-2 rounded-xl border border-border bg-background/70 p-2">
        <Input readOnly value={url} aria-label={t('Client link')} className="border-0 bg-transparent font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
        <CopyButton value={url} label={t('Copy link')} />
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        {mailbox ? (
          <Button onClick={() => setComposing(true)}>
            <Mail className="size-4" aria-hidden /> {t('Email from SampForce')}
          </Button>
        ) : (
          <Button asChild>
            <a href={mailto}>
              <Mail className="size-4" aria-hidden /> {t('Email the link')}
            </a>
          </Button>
        )}
        <Button asChild variant="outline">
          <a href={whatsapp} target="_blank" rel="noopener noreferrer">
            <MessageCircle className="size-4" aria-hidden /> {t('WhatsApp')}
          </a>
        </Button>
        <Button asChild variant="outline">
          <a href={url} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="size-4" aria-hidden /> {t('Open as the client')}
          </a>
        </Button>
      </div>
      <div className="flex justify-end">
        <Button variant="outline" onClick={onClose}>
          {t('Done')}
        </Button>
      </div>
      {mailbox && <ComposeDialog open={composing} onOpenChange={setComposing} to={row.recipientEmail ?? ''} subject={subject} body={body} />}
    </div>
  );
}
