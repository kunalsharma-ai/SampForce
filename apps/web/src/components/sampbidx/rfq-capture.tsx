'use client';

import { SAMPBIDX_ATTACHMENT_MAX_BYTES, SAMPBIDX_PASTED_EMAIL_MAX_CHARS, SAMPBIDX_PASTED_MAX_FILES, type SampbidxCaptureSourceRef, type SampbidxMatchConfidence, type SampbidxTransferRow } from '@dealflow/types';
import { Button, cn } from '@dealflow/ui';
import { AlertTriangle, Building2, CheckCircle2, ClipboardPaste, Copy, ExternalLink, FileUp, Loader2, Paperclip, RotateCw, Send, Sparkles, UserRound, X, XCircle } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';
import { Select, Textarea } from '@/components/crm/select';
import { formatBytes } from '@/components/forms/upload-zone';
import { InfoTip } from '@/components/info-tip';
import { useCompanyEmployees } from '@/lib/company-work';
import { relativeTime } from '@/lib/format';
import { type MessageKey, useT } from '@/lib/i18n';
import { type SampbidxUploadedFile, useSampbidxApp, useSampbidxAttachments, useSampbidxPastedCheck, useSampbidxSend } from '@/lib/sampbidx';
import { useCan, useSession } from '@/lib/session';
import { useSampbidxEnabled } from './sampbidx';

/** What the capture card shows as its one status. "Sent" only once SampBidx has answered with its own id. */
type Status = 'empty' | 'ready' | 'review' | 'duplicate' | 'processing' | 'sent' | 'failed';

const STATUS: Record<Status, { label: MessageKey; tone: string; icon: typeof Send }> = {
  empty: { label: 'Waiting for an email', tone: 'border-border bg-muted text-muted-foreground', icon: ClipboardPaste },
  ready: { label: 'Ready to send', tone: 'border-primary/40 bg-primary/10 text-primary', icon: Sparkles },
  review: { label: 'Check the client', tone: 'border-warning/50 bg-warning/15 text-foreground', icon: AlertTriangle },
  duplicate: { label: 'Duplicate RFQ detected', tone: 'border-warning/50 bg-warning/15 text-foreground', icon: Copy },
  processing: { label: 'Sending to SampBidx…', tone: 'border-primary/40 bg-primary/10 text-primary', icon: Loader2 },
  sent: { label: 'Sent to SampBidx', tone: 'border-success/50 bg-success/15 text-foreground', icon: CheckCircle2 },
  failed: { label: 'Transfer failed', tone: 'border-critical/50 bg-critical/10 text-foreground', icon: XCircle },
};

const MATCH: Record<SampbidxMatchConfidence, { label: MessageKey; tone: string }> = {
  given: { label: 'This page', tone: 'bg-muted text-muted-foreground' },
  contact: { label: 'Matched by email address', tone: 'bg-success/15 text-foreground' },
  domain: { label: 'Suggested from the email domain', tone: 'bg-warning/20 text-foreground' },
  none: { label: 'No client found', tone: 'bg-warning/20 text-foreground' },
};

export interface RfqCaptureProps {
  /** Where the card sits, kept on the transfer and sent to SampBidx as the source reference. */
  source: SampbidxCaptureSourceRef;
  /** The client the page is about, when known. */
  companyId?: string | null;
  contactId?: string | null;
  /** Text to start with, for an email already in SampForce (the inbox). */
  initialText?: string;
  /** Bare: no outer card (inside a dialog or another card). */
  bare?: boolean;
  onSent?: (row: SampbidxTransferRow) => void;
}

/** Shown only where the plan has SampBidx and the person can log client communication. */
export function RfqCapture(props: RfqCaptureProps) {
  const enabled = useSampbidxEnabled();
  const canWrite = useCan('activities:write');
  if (!enabled || !canWrite) return null;
  return <RfqCaptureCard {...props} />;
}

/**
 * "Capture RFQ & send to SampBidx": paste a client's RFQ email exactly as received and press one button. SampForce
 * reads the subject, sender and date, links the client it is sure of (and asks the person to check when it is not),
 * keeps any files added next to it, and shows one clear status: ready, sending, sent (only once SampBidx answers
 * with its id), failed with Try again (the text stays), or duplicate.
 */
function RfqCaptureCard({ source, companyId = null, contactId = null, initialText = '', bare = false, onSent }: RfqCaptureProps) {
  const t = useT();
  const id = React.useId();
  const me = useSession().data?.user;
  const app = useSampbidxApp();
  const send = useSampbidxSend();
  const files = useSampbidxAttachments();
  const [text, setText] = React.useState(initialText);
  const [subject, setSubject] = React.useState<string | null>(null);
  const [company, setCompany] = React.useState<string | null | undefined>(undefined);
  const [contact, setContact] = React.useState<string | null | undefined>(undefined);
  const [log, setLog] = React.useState(true);
  const [note, setNote] = React.useState('');
  const [attached, setAttached] = React.useState<SampbidxUploadedFile[]>([]);
  const [fileError, setFileError] = React.useState<string | null>(null);
  const [sent, setSent] = React.useState<SampbidxTransferRow | null>(null);
  const [failure, setFailure] = React.useState<{ message: string; row: SampbidxTransferRow | null } | null>(null);
  const fileInput = React.useRef<HTMLInputElement>(null);
  const check = useSampbidxPastedCheck(text, companyId, contactId);
  const c = text.trim().length >= 20 ? check.data : undefined;
  // What was read from the text fills the choices until the person changes them.
  const chosenCompany = company !== undefined ? company : (c?.company?.id ?? companyId ?? null);
  const chosenContact = contact !== undefined ? contact : (c?.contact && (!chosenCompany || c.contact.companyId === chosenCompany) ? c.contact.id : (contactId ?? null));
  const employees = useCompanyEmployees(chosenCompany ?? '', !!chosenCompany);
  const people = chosenCompany ? (employees.data ?? []) : [];
  const companies = React.useMemo(() => {
    const list = [...(c?.company ? [c.company] : []), ...(c?.candidates ?? [])];
    return list.filter((x, i) => list.findIndex((y) => y.id === x.id) === i);
  }, [c]);
  const connected = app.data?.state === 'connected' || app.data?.state === 'error';
  const ready = text.trim().length >= 20;
  const pending = send.pasted.isPending || send.retry.isPending;
  const uploading = files.add.isPending;
  const status: Status = pending
    ? 'processing'
    : sent
      ? 'sent'
      : failure
        ? 'failed'
        : !ready
          ? 'empty'
          : c?.duplicate
            ? 'duplicate'
            : c && c.confidence !== 'contact' && c.confidence !== 'given' && company === undefined
              ? 'review'
              : c?.review && company === undefined
                ? 'review'
                : 'ready';
  const S = STATUS[status];

  const reset = () => {
    setText('');
    setSubject(null);
    setCompany(undefined);
    setContact(undefined);
    setNote('');
    setAttached([]);
    setFailure(null);
    setFileError(null);
  };

  const addFiles = async (list: FileList | null) => {
    setFileError(null);
    for (const f of Array.from(list ?? [])) {
      if (attached.length >= SAMPBIDX_PASTED_MAX_FILES) return setFileError(t('Add at most {count} files.', { count: SAMPBIDX_PASTED_MAX_FILES }));
      if (f.size > SAMPBIDX_ATTACHMENT_MAX_BYTES) {
        setFileError(t('{name} is over 20 MB.', { name: f.name }));
        continue;
      }
      try {
        const row = await files.add.mutateAsync(f);
        setAttached((a) => [...a, row]);
      } catch (e) {
        setFileError(e instanceof Error ? e.message : String(e));
      }
    }
    if (fileInput.current) fileInput.current.value = '';
  };

  const removeFile = (f: SampbidxUploadedFile) => {
    setAttached((a) => a.filter((x) => x.id !== f.id));
    files.remove.mutate(f.id);
  };

  const go = async (resend?: boolean) => {
    setFailure(null);
    setSent(null);
    try {
      const row =
        failure?.row && !resend
          ? await send.retry.mutateAsync(failure.row.id)
          : await send.pasted.mutateAsync({
              companyId: chosenCompany,
              contactId: chosenContact,
              text,
              subject: subject?.trim() || null,
              date: c?.date ?? null,
              note: note.trim() || null,
              attachmentIds: attached.map((a) => a.id),
              logInteraction: log && !!chosenCompany,
              source,
              resend,
            });
      if (row.delivery === 'SENT') {
        setSent(row);
        reset();
        onSent?.(row);
      } else {
        setFailure({ message: row.lastError ?? t('SampBidx did not confirm it. Try again.'), row });
      }
    } catch (e) {
      setFailure({ message: e instanceof Error ? e.message : String(e), row: failure?.row ?? null });
    }
  };

  const body = (
    <div className="space-y-4">
      {/* Header: what this is, and its one status. */}
      <div className="flex flex-wrap items-start gap-3">
        <span aria-hidden className="grid size-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-primary to-accent text-primary-foreground shadow-md shadow-primary/20">
          <ClipboardPaste className="size-5" />
        </span>
        <div className="min-w-[12rem] flex-1">
          <h3 id={`${id}-title`} className="flex items-center gap-1.5 text-base font-semibold">
            {t('Capture RFQ & send to SampBidx')}
            <InfoTip topic="crm.pasteRfqEmail" />
          </h3>
          <p className="text-sm text-muted-foreground">{t('Paste the client’s email exactly as received. One click sends it, linked to the right client.')}</p>
        </div>
        <span role="status" aria-live="polite" className={cn('inline-flex min-h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold', S.tone)} data-testid="rfq-capture-status">
          <S.icon aria-hidden className={cn('size-4', status === 'processing' && 'motion-safe:animate-spin')} />
          {t(S.label)}
        </span>
      </div>

      {/* The progress track: paste, check, confirmed by SampBidx. */}
      <ol className="grid grid-cols-3 gap-2 text-xs" aria-label={t('Progress')}>
        {(
          [
            ['Paste', ready || status === 'sent'],
            ['Check the client', (ready && status !== 'review') || status === 'sent'],
            ['Confirmed by SampBidx', status === 'sent'],
          ] as [MessageKey, boolean][]
        ).map(([label, done], i) => (
          <li key={label} className="flex items-center gap-2">
            <span aria-hidden className={cn('grid size-6 shrink-0 place-items-center rounded-full border text-[11px] font-bold', done ? 'border-success bg-success text-white' : 'border-border bg-surface text-muted-foreground')}>
              {done ? <CheckCircle2 className="size-4" /> : i + 1}
            </span>
            <span className={cn('truncate', done ? 'font-medium text-foreground' : 'text-muted-foreground')}>{t(label)}</span>
            {i < 2 && <span aria-hidden className={cn('hidden h-px flex-1 sm:block', done ? 'bg-success/60' : 'bg-border')} />}
          </li>
        ))}
      </ol>

      {sent && (
        <div className="rounded-xl border border-success/40 bg-success/10 p-4" data-testid="rfq-capture-sent">
          <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
            <CheckCircle2 aria-hidden className="size-5 text-success" />
            {t('SampBidx received “{title}” as {id}.', { title: sent.title, id: sent.remoteId ?? '—' })}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {[t('Sent by {name}', { name: sent.sentBy ?? '—' }), sent.company?.name, sent.contact?.name, sent.clientPoc ? t('Client POC: {name}', { name: sent.clientPoc }) : null, sent.files.length ? t('{count} files', { count: sent.files.length }) : null]
              .filter(Boolean)
              .join(' · ')}
          </p>
          <div className="mt-2 flex flex-wrap gap-3 text-sm">
            {sent.remoteUrl && (
              <a className="inline-flex min-h-6 items-center gap-1 font-medium text-primary hover:underline" href={sent.remoteUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink aria-hidden className="size-4" /> {t('Open in SampBidx')}
              </a>
            )}
            <Link className="inline-flex min-h-6 items-center font-medium text-primary hover:underline" href="/app/rfqs?tab=sampbidx">
              {t('All RFQs sent to SampBidx')}
            </Link>
            <button type="button" className="inline-flex min-h-6 items-center font-medium text-primary hover:underline" onClick={() => setSent(null)}>
              {t('Capture another RFQ')}
            </button>
          </div>
        </div>
      )}

      {!sent && (
        <>
          <div className="relative">
            <label htmlFor={`${id}-text`} className="sr-only">
              {t('RFQ email text')}
            </label>
            <Textarea
              id={`${id}-text`}
              rows={ready ? 10 : 4}
              maxLength={SAMPBIDX_PASTED_EMAIL_MAX_CHARS}
              spellCheck={false}
              className="min-h-28 resize-y rounded-xl border-2 border-dashed border-primary/30 bg-surface font-mono text-[13px] leading-relaxed focus-visible:border-primary"
              placeholder={t('Paste the whole RFQ email here: From, Sent, To, Subject and the message.')}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setFailure(null);
              }}
            />
            {text && (
              <span className="pointer-events-none absolute bottom-2 end-3 text-[11px] text-muted-foreground">{t('{count} characters', { count: text.length.toLocaleString() })}</span>
            )}
          </div>

          {ready && c && (
            <div className="grid gap-3 md:grid-cols-2">
              {/* What was read from the email. */}
              <div className="space-y-2 rounded-xl border border-border bg-muted/40 p-3 text-sm">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('Read from the email')}</p>
                <label className="block">
                  <span className="text-xs text-muted-foreground">{t('Subject')}</span>
                  <input
                    className="mt-0.5 h-9 w-full rounded-md border border-border bg-surface px-2 text-sm"
                    value={subject ?? c.subject ?? ''}
                    maxLength={300}
                    placeholder={t('RFQ email from {name}', { name: c.contact?.name ?? c.company?.name ?? t('the client') })}
                    onChange={(e) => setSubject(e.target.value)}
                  />
                </label>
                <dl className="grid grid-cols-[5.5rem_1fr] gap-x-2 gap-y-1 text-xs">
                  <dt className="text-muted-foreground">{t('From')}</dt>
                  <dd className="min-w-0 break-words" data-testid="rfq-capture-from">{c.from ?? t('Not found in the text')}</dd>
                  <dt className="text-muted-foreground">{t('Received')}</dt>
                  <dd>{c.date ? new Date(c.date).toLocaleString() : t('Not found in the text')}</dd>
                  {(c.to.length > 0 || c.cc.length > 0) && (
                    <>
                      <dt className="text-muted-foreground">{t('To / Cc')}</dt>
                      <dd className="min-w-0 break-words">{[...c.to, ...c.cc].join(', ')}</dd>
                    </>
                  )}
                </dl>
              </div>

              {/* Who it is linked to, with the person's check when SampForce is not sure. */}
              <div className={cn('space-y-2 rounded-xl border p-3 text-sm', status === 'review' ? 'border-warning/60 bg-warning/10' : 'border-border bg-muted/40')} data-testid="rfq-capture-client">
                <p className="flex items-center justify-between gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t('Client')}
                  <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold normal-case tracking-normal', MATCH[c.confidence].tone)}>{t(MATCH[c.confidence].label)}</span>
                </p>
                <label className="block">
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Building2 aria-hidden className="size-3.5" /> {t('Company')}
                  </span>
                  <Select
                    className="mt-0.5 h-9"
                    value={chosenCompany ?? ''}
                    onChange={(e) => {
                      setCompany(e.target.value || null);
                      setContact(undefined);
                    }}
                  >
                    {!companyId && <option value="">{t('No company: send without linking')}</option>}
                    {companyId && !companies.some((x) => x.id === companyId) && <option value={companyId}>{t('This company')}</option>}
                    {companies.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                      </option>
                    ))}
                  </Select>
                </label>
                <label className="block">
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <UserRound aria-hidden className="size-3.5" /> {t('Contact person')}
                  </span>
                  <Select className="mt-0.5 h-9" value={chosenContact ?? ''} onChange={(e) => setContact(e.target.value || null)} disabled={!chosenCompany && !chosenContact}>
                    <option value="">{t('Not one of the employees')}</option>
                    {chosenContact && !people.some((p) => p.id === chosenContact) && c.contact?.id === chosenContact && <option value={chosenContact}>{c.contact.name}</option>}
                    {people.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.email ? `${p.name} (${p.email})` : p.name}
                      </option>
                    ))}
                  </Select>
                </label>
                {c.review && company === undefined && <p className="text-xs">{c.review}</p>}
                {status === 'review' && (
                  <Button type="button" size="sm" variant="outline" onClick={() => setCompany(chosenCompany)}>
                    <CheckCircle2 aria-hidden /> {chosenCompany ? t('This client is right') : t('Send without a client')}
                  </Button>
                )}
                <p className="text-xs text-muted-foreground">{t('Sent by {name}', { name: me?.name ?? '—' })}</p>
              </div>
            </div>
          )}

          {ready && c?.duplicate && (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-warning/50 bg-warning/10 p-3 text-sm" data-testid="rfq-capture-duplicate">
              <Copy aria-hidden className="size-4 shrink-0" />
              <span className="min-w-0 flex-1">
                {t('This RFQ email was already sent {time} by {name}{company}{id}.', {
                  time: c.duplicate.sentAt ? relativeTime(c.duplicate.sentAt) : '',
                  name: c.duplicate.sentBy ?? '—',
                  company: c.duplicate.company ? ` (${c.duplicate.company})` : '',
                  id: c.duplicate.remoteId ? `, ${c.duplicate.remoteId}` : '',
                })}
              </span>
            </div>
          )}

          {ready && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <input ref={fileInput} id={`${id}-files`} type="file" multiple tabIndex={-1} aria-label={t('Add the email’s attachments')} className="sr-only" onChange={(e) => void addFiles(e.target.files)} />
                <Button type="button" size="sm" variant="outline" disabled={uploading} onClick={() => fileInput.current?.click()}>
                  {uploading ? <Loader2 aria-hidden className="motion-safe:animate-spin" /> : <FileUp aria-hidden />} {t('Add the email’s attachments')}
                </Button>
                {attached.map((f) => (
                  <span key={f.id} className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-border bg-surface ps-3 pe-1 text-xs">
                    <Paperclip aria-hidden className="size-3.5 text-muted-foreground" />
                    {f.name} <span className="text-muted-foreground">({formatBytes(f.sizeBytes)})</span>
                    <button type="button" className="grid size-6 place-items-center rounded-full hover:bg-muted" aria-label={t('Remove {name}', { name: f.name })} onClick={() => removeFile(f)}>
                      <X aria-hidden className="size-3.5" />
                    </button>
                  </span>
                ))}
              </div>
              {c?.mentionsAttachments && !attached.length && (
                <p className="flex items-start gap-1.5 text-xs" data-testid="rfq-capture-attachment-hint">
                  <AlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0 text-warning" />
                  {t('The email mentions an attachment, and pasted text cannot carry files. Add them here so SampBidx gets them too.')}
                </p>
              )}
              {fileError && (
                <p role="alert" className="text-xs text-critical">
                  {fileError}
                </p>
              )}
              <label className="block">
                <span className="text-xs text-muted-foreground">{t('Note for the SampBidx team (optional)')}</span>
                <Textarea className="mt-0.5" rows={2} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
              </label>
              {chosenCompany && (
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" className="size-4 accent-[hsl(var(--primary))]" checked={log} onChange={(e) => setLog(e.target.checked)} />
                  {t('Also log it in Interactions as “RFQ received”')}
                </label>
              )}
            </div>
          )}

          {app.data && !connected && (
            <p className="rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm">{t('SampBidx is not connected yet. A workspace admin connects it in Integrations.')}</p>
          )}

          {failure && (
            <div role="alert" className="flex flex-wrap items-center gap-2 rounded-xl border border-critical/40 bg-critical/10 p-3 text-sm">
              <XCircle aria-hidden className="size-4 shrink-0 text-critical" />
              <span className="min-w-0 flex-1">{failure.message}</span>
              <span className="text-xs text-muted-foreground">{t('Your pasted email is kept.')}</span>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-end gap-2">
            {text && !pending && (
              <Button type="button" variant="ghost" onClick={reset}>
                {t('Clear')}
              </Button>
            )}
            {status === 'duplicate' ? (
              <Button type="button" variant="outline" disabled={!connected || pending} onClick={() => void go(true)}>
                <Send aria-hidden /> {t('Send another copy anyway')}
              </Button>
            ) : (
              <Button
                type="button"
                size="lg"
                className="min-w-56 bg-gradient-to-r from-primary to-accent text-primary-foreground shadow-lg shadow-primary/25 hover:opacity-95"
                disabled={!connected || !ready || pending || uploading || status === 'review'}
                onClick={() => void go()}
              >
                {status === 'failed' ? <RotateCw aria-hidden /> : pending ? <Loader2 aria-hidden className="motion-safe:animate-spin" /> : <Send aria-hidden />}
                {status === 'failed' ? t('Try again') : pending ? t('Sending to SampBidx…') : t('Send RFQ to SampBidx')}
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );

  if (bare) return <section aria-labelledby={`${id}-title`}>{body}</section>;
  return (
    <section aria-labelledby={`${id}-title`} className="relative overflow-hidden rounded-2xl border border-primary/30 bg-surface p-4 shadow-sm sm:p-5" data-testid="rfq-capture">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-r from-primary/15 via-accent/10 to-transparent" />
      <div className="relative">{body}</div>
    </section>
  );
}
