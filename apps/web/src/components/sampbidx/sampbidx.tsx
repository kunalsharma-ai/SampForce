'use client';

import {
  type RfqRow,
  SAMPBIDX_EMAIL_FILE_MAX_BYTES,
  SAMPBIDX_MAX_FILES,
  type SampbidxDelivery,
  type SampbidxRemoteStatus,
  type SampbidxRequiredField,
  type SampbidxTransferRow,
} from '@dealflow/types';
import { Badge, Button, cn, Dialog, DialogContent, DialogDescription, DialogTitle, Field, Input, Skeleton } from '@dealflow/ui';
import { CheckCircle2, ClipboardPaste, ExternalLink, FileText, Inbox, Mail, RotateCw, Send, Upload } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';
import { Textarea } from '@/components/crm/select';
import { InfoTip } from '@/components/info-tip';
import { formatBytes, UploadZone } from '@/components/forms/upload-zone';
import { relativeTime } from '@/lib/format';
import { useHasFeature } from '@/lib/features';
import { type MessageKey, useT } from '@/lib/i18n';
import { useSampbidxApp, useSampbidxMailbox, useSampbidxReadiness, useSampbidxSend } from '@/lib/sampbidx';
import { useCan } from '@/lib/session';
import { RfqCapture } from './rfq-capture';

const FIELD_LABEL: Record<SampbidxRequiredField, MessageKey> = {
  projectName: 'Project name',
  methodology: 'Research methodology',
  market: 'Country / market',
  sampleSize: 'Sample size',
  deadlineAt: 'Submission deadline',
};

const DELIVERY: Record<SampbidxDelivery, { label: MessageKey; tone: 'neutral' | 'success' | 'critical' | 'warning' }> = {
  SENDING: { label: 'Sending…', tone: 'warning' },
  SENT: { label: 'With SampBidx', tone: 'success' },
  FAILED: { label: 'Not sent', tone: 'critical' },
};

const REMOTE: Record<SampbidxRemoteStatus, { label: MessageKey; tone: 'neutral' | 'primary' | 'success' | 'critical' | 'warning' }> = {
  RECEIVED: { label: 'Received', tone: 'neutral' },
  IN_REVIEW: { label: 'In review', tone: 'primary' },
  BIDDING: { label: 'Bidding', tone: 'primary' },
  QUOTED: { label: 'Quoted', tone: 'warning' },
  WON: { label: 'Won', tone: 'success' },
  LOST: { label: 'Lost', tone: 'critical' },
  REJECTED: { label: 'Rejected', tone: 'critical' },
  CANCELLED: { label: 'Cancelled', tone: 'neutral' },
};

const KIND: Record<SampbidxTransferRow['kind'], MessageKey> = { RFQ: 'RFQ details', MAILBOX_EMAIL: 'Email from mailbox', EMAIL_FILE: 'Email file', PASTED_EMAIL: 'Pasted email' };

/** True when the workspace's plan has SampBidx; the panels below stay hidden otherwise. */
export function useSampbidxEnabled(): boolean {
  return useHasFeature('sampbidx');
}

function NotConnected() {
  const t = useT();
  const canManage = useCan('integrations:manage');
  return (
    <p className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
      {t('SampBidx is not connected yet.')}{' '}
      {canManage ? (
        <Link className="font-medium text-primary hover:underline" href="/app/integrations#app-sampbidx">
          {t('Connect it in Integrations')}
        </Link>
      ) : (
        t('A workspace admin connects it in Integrations.')
      )}
    </p>
  );
}

/** One send to SampBidx: what went, whether SampBidx has it, and what SampBidx says about it since. */
export function SampbidxTransferItem({ x, showLinks = true }: { x: SampbidxTransferRow; showLinks?: boolean }) {
  const t = useT();
  const send = useSampbidxSend();
  const d = DELIVERY[x.delivery];
  const stale = x.delivery === 'SENDING' && Date.now() - new Date(x.createdAt).getTime() > 2 * 60_000;
  return (
    <li className="rounded-lg border border-border bg-surface p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        {x.kind === 'RFQ' ? <FileText aria-hidden className="size-4 text-muted-foreground" /> : <Mail aria-hidden className="size-4 text-muted-foreground" />}
        <span className="font-medium">{x.title}</span>
        <Badge tone={d.tone}>{t(d.label)}</Badge>
        {x.remoteStatus && <Badge tone={REMOTE[x.remoteStatus].tone}>{t('SampBidx: {status}', { status: t(REMOTE[x.remoteStatus].label) })}</Badge>}
        <span className="text-xs text-muted-foreground">{t(KIND[x.kind])}</span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {x.sentAt ? t('Sent {time} by {name}', { time: relativeTime(x.sentAt), name: x.sentBy ?? '—' }) : t('Started {time} by {name}', { time: relativeTime(x.createdAt), name: x.sentBy ?? '—' })}
        {x.remoteId && <> · {t('SampBidx id {id}', { id: x.remoteId })}</>}
        {x.attempts > 1 && <> · {t('{count} attempts', { count: x.attempts })}</>}
      </p>
      {showLinks && (x.company || x.rfq) && (
        <p className="mt-1 text-xs">
          {x.company && (
            <Link className="inline-flex min-h-6 items-center text-primary hover:underline" href={`/app/companies/${x.company.id}`}>
              {x.company.name}
            </Link>
          )}
          {x.company && x.rfq && ' · '}
          {x.rfq && (
            <Link className="inline-flex min-h-6 items-center text-primary hover:underline" href={`/app/rfqs?open=${x.rfq.id}`}>
              {x.rfq.number} {x.rfq.projectName}
            </Link>
          )}
        </p>
      )}
      {x.emailFrom && <p className="mt-1 text-xs text-muted-foreground">{t('From {sender}', { sender: x.emailFrom })}</p>}
      {x.files.length > 0 && <p className="mt-1 text-xs text-muted-foreground">{t('Files: {names}', { names: x.files.map((f) => `${f.name} (${formatBytes(f.sizeBytes)})`).join(', ') })}</p>}
      {x.note && <p className="mt-1 text-xs">{t('Note: {note}', { note: x.note })}</p>}
      {x.remoteNote && <p className="mt-1 text-xs">{t('SampBidx says: {note}', { note: x.remoteNote })}</p>}
      {x.lastError && x.delivery !== 'SENT' && (
        <p role="alert" className="mt-1 text-xs text-critical">
          {x.lastError}
        </p>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        {x.remoteUrl && (
          <a className="inline-flex min-h-6 items-center gap-1 text-xs font-medium text-primary hover:underline" href={x.remoteUrl} target="_blank" rel="noopener noreferrer">
            <ExternalLink aria-hidden className="size-3.5" /> {t('Open in SampBidx')}
          </a>
        )}
        {(x.delivery === 'FAILED' || stale) && (
          <Button size="sm" variant="outline" disabled={send.retry.isPending} onClick={() => send.retry.mutate(x.id)}>
            <RotateCw aria-hidden /> {send.retry.isPending ? t('Sending…') : t('Try again')}
          </Button>
        )}
      </div>
      {send.retry.error && (
        <p role="alert" className="mt-1 text-xs text-critical">
          {send.retry.error.message}
        </p>
      )}
    </li>
  );
}

export function SampbidxTransferList({ items, label, showLinks = true }: { items: SampbidxTransferRow[]; label: string; showLinks?: boolean }) {
  return (
    <ul className="space-y-2" aria-label={label}>
      {items.map((x) => (
        <SampbidxTransferItem key={x.id} x={x} showLinks={showLinks} />
      ))}
    </ul>
  );
}

function Step({ n, title, done, active, children }: { n: number; title: string; done: boolean; active: boolean; children: React.ReactNode }) {
  return (
    <li className={cn('relative rounded-lg border p-3', active ? 'border-primary/50 bg-primary/5' : 'border-border')}>
      <h4 className="flex items-center gap-2 text-sm font-semibold">
        {done ? <CheckCircle2 aria-hidden className="size-5 text-success" /> : <span aria-hidden className={cn('grid size-5 place-items-center rounded-full border text-[11px]', active ? 'border-primary text-primary' : 'border-border text-muted-foreground')}>{n}</span>}
        {title}
      </h4>
      <div className="mt-2 ps-7 text-sm">{children}</div>
    </li>
  );
}

/**
 * "Send to SampBidx" for one saved RFQ, as three steps: (1) the details SampBidx needs, filled in and saved on the RFQ;
 * (2) the attachments to include, with "Add a file" next to them; (3) the send button. Earlier sends follow.
 */
export function SendRfqToSampbidx({ rfq, dirty }: { rfq: RfqRow; dirty: boolean }) {
  const t = useT();
  const enabled = useSampbidxEnabled();
  const canSend = useCan('companies:write');
  const ready = useSampbidxReadiness(enabled ? rfq.id : null);
  const send = useSampbidxSend();
  const [chosen, setChosen] = React.useState<Set<string> | null>(null);
  const [note, setNote] = React.useState('');
  const [resend, setResend] = React.useState(false);
  const [emailOpen, setEmailOpen] = React.useState(false);
  const files = ready.data?.files ?? [];
  const picked = chosen ?? new Set(files.map((f) => f.id));
  // A file added after the person changed the selection is included too.
  const seen = React.useRef<Set<string>>(new Set());
  const fileKey = files.map((f) => f.id).join(',');
  React.useEffect(() => {
    const fresh = fileKey ? fileKey.split(',').filter((id) => !seen.current.has(id)) : [];
    for (const id of fresh) seen.current.add(id);
    if (fresh.length) setChosen((c) => (c ? new Set([...c, ...fresh]) : c));
  }, [fileKey]);
  if (!enabled) return null;
  if (ready.isPending) return <Skeleton className="h-40" />;
  if (ready.error || !ready.data) return null;
  const r = ready.data;
  const alreadySent = r.transfers.some((x) => x.delivery === 'SENT');
  const detailsDone = r.missing.length === 0 && !dirty;
  const tooMany = picked.size > SAMPBIDX_MAX_FILES;
  const go = async () => {
    try {
      await send.rfq.mutateAsync({ rfqId: rfq.id, fileIds: [...picked], note: note.trim() || null, resend: alreadySent ? true : undefined });
      setNote('');
      setResend(false);
    } catch {
      // Shown below.
    }
  };
  return (
    <section aria-labelledby={`sbx-${rfq.id}`} className="space-y-3 rounded-xl border border-primary/30 bg-gradient-to-br from-primary/5 to-transparent p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={`sbx-${rfq.id}`} className="flex items-center gap-2 text-sm font-semibold">
          <Send aria-hidden className="size-4 text-primary" /> {t('Send to SampBidx')}
          <InfoTip topic="crm.sampbidx" />
        </h3>
        {alreadySent && <Badge tone="success">{t('With SampBidx')}</Badge>}
      </div>
      {!r.connected && <NotConnected />}
      <ol className="space-y-2">
        <Step n={1} title={t('RFQ details')} done={detailsDone} active={!detailsDone}>
          {dirty ? (
            <p className="text-warning">{t('Save your changes above first: SampBidx gets the RFQ as it is saved.')}</p>
          ) : r.missing.length ? (
            <>
              <p>{t('SampBidx needs these before it can price the RFQ. Fill them in above and save:')}</p>
              <ul className="mt-1 flex flex-wrap gap-1.5" aria-label={t('Missing details')}>
                {r.missing.map((m) => (
                  <li key={m}>
                    <Badge tone="warning">{t(FIELD_LABEL[m])}</Badge>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-muted-foreground">{t('Project, methodology, market, sample size and deadline are filled in.')}</p>
          )}
        </Step>
        <Step n={2} title={t('Attachments')} done={detailsDone && !tooMany} active={detailsDone}>
          {files.length ? (
            <fieldset>
              <legend className="mb-1 text-muted-foreground">{t('Choose the files to send with it:')}</legend>
              <ul className="space-y-1">
                {files.map((f) => (
                  <li key={f.id}>
                    <label className="inline-flex min-h-6 items-center gap-2">
                      <input
                        type="checkbox"
                        className="size-4"
                        checked={picked.has(f.id)}
                        onChange={(e) => {
                          const next = new Set(picked);
                          if (e.target.checked) next.add(f.id);
                          else next.delete(f.id);
                          setChosen(next);
                        }}
                      />
                      <FileText aria-hidden className="size-4 text-muted-foreground" /> {f.name} <span className="text-xs text-muted-foreground">{formatBytes(f.sizeBytes)}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>
          ) : (
            <p className="text-muted-foreground">{t('No files yet. Add the questionnaire, brief or quota grid if there is one; an RFQ can also go without files.')}</p>
          )}
          {tooMany && <p className="mt-1 text-critical">{t('Send at most {count} files with one RFQ.', { count: SAMPBIDX_MAX_FILES })}</p>}
          <p className="mt-1 text-xs text-muted-foreground">{t('Add more files under Attachments above; they appear here.')}</p>
        </Step>
        <Step n={3} title={t('Send')} done={alreadySent} active={detailsDone && r.connected}>
          <Field id={`sbx-note-${rfq.id}`} label={t('Note for the SampBidx team (optional)')}>
            <Textarea rows={2} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          {alreadySent && (
            <label className="mt-2 inline-flex min-h-6 items-center gap-2 text-sm">
              <input type="checkbox" className="size-4" checked={resend} onChange={(e) => setResend(e.target.checked)} />
              {t('SampBidx already has this RFQ. Send another copy.')}
            </label>
          )}
          <div className="mt-2">
            <Button type="button" disabled={!canSend || !r.connected || !detailsDone || tooMany || send.rfq.isPending || (alreadySent && !resend)} onClick={() => void go()}>
              <Send aria-hidden /> {send.rfq.isPending ? t('Sending to SampBidx…') : t('Send this RFQ to SampBidx')}
            </Button>
          </div>
          {send.rfq.error && (
            <p role="alert" className="mt-2 text-sm text-critical">
              {send.rfq.error.message}
            </p>
          )}
          {send.rfq.data && send.rfq.data.delivery === 'SENT' && (
            <p role="status" className="mt-2 text-sm text-success">
              {t('Sent. SampBidx has it as {id}.', { id: send.rfq.data.remoteId ?? '—' })}
            </p>
          )}
        </Step>
      </ol>
      <p className="text-xs text-muted-foreground">
        {t('Or skip the form:')}{' '}
        <button type="button" className="inline-flex min-h-6 items-center gap-1 font-medium text-primary hover:underline" onClick={() => setEmailOpen(true)}>
          <Mail aria-hidden className="size-3.5" /> {t('Transfer the RFQ email instead')}
        </button>
      </p>
      <TransferEmailDialog open={emailOpen} onOpenChange={setEmailOpen} link={{ companyId: rfq.company.id, rfqId: rfq.id, label: `${rfq.number} ${rfq.projectName}` }} />
      {r.transfers.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('Sent to SampBidx')}</h4>
          <SampbidxTransferList items={r.transfers} label={t('Sends of this RFQ')} showLinks={false} />
        </div>
      )}
    </section>
  );
}

/**
 * The second way: send the RFQ email itself, either one from the person's synced mailbox or an .eml/.msg file saved
 * from their mail program (which keeps the email's own attachments).
 */
export function TransferEmailDialog({ open, onOpenChange, link }: { open: boolean; onOpenChange: (o: boolean) => void; link?: { companyId: string; rfqId?: string | null; label: string } | null }) {
  const t = useT();
  const app = useSampbidxApp(open);
  const [tab, setTab] = React.useState<'paste' | 'mailbox' | 'file'>('paste');
  const [q, setQ] = React.useState('');
  const [picked, setPicked] = React.useState<string | null>(null);
  const [file, setFile] = React.useState<File | null>(null);
  const [note, setNote] = React.useState('');
  const box = useSampbidxMailbox(q.trim(), open && tab === 'mailbox');
  const send = useSampbidxSend();
  React.useEffect(() => {
    if (open) {
      setPicked(null);
      setFile(null);
      setNote('');
      send.mailbox.reset();
      send.file.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const connected = app.data?.state === 'connected' || app.data?.state === 'error';
  const pending = send.mailbox.isPending || send.file.isPending;
  const result = tab === 'mailbox' ? send.mailbox : send.file;
  const pickedRow = box.data?.find((m) => m.id === picked);
  const go = async () => {
    try {
      if (tab === 'mailbox' && picked) await send.mailbox.mutateAsync({ emailMessageId: picked, companyId: link?.companyId ?? null, rfqId: link?.rfqId ?? null, note: note.trim() || null, resend: pickedRow?.transferredAt ? true : undefined });
      if (tab === 'file' && file) await send.file.mutateAsync({ file, companyId: link?.companyId ?? null, rfqId: link?.rfqId ?? null, note });
    } catch {
      // Shown below.
    }
  };
  const tabs: { id: typeof tab; label: MessageKey; icon: React.ReactNode }[] = [
    { id: 'paste', label: 'Paste the email', icon: <ClipboardPaste aria-hidden className="size-4" /> },
    { id: 'mailbox', label: 'From your mailbox', icon: <Inbox aria-hidden className="size-4" /> },
    { id: 'file', label: 'Upload the email file', icon: <Upload aria-hidden className="size-4" /> },
  ];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-[4%] max-h-[92vh] max-w-2xl overflow-y-auto p-6">
        <DialogTitle className="text-lg font-semibold">{t('Transfer an RFQ email to SampBidx')}</DialogTitle>
        <DialogDescription className="mb-3 text-sm text-muted-foreground">
          {link ? t('The whole email goes to SampBidx as it is, linked to {name}.', { name: link.label }) : t('The whole email goes to SampBidx as it is. No RFQ form to fill in.')}
        </DialogDescription>
        {app.data && !connected && <NotConnected />}
        <div className="mb-3 flex flex-wrap gap-2" role="tablist" aria-label={t('Where the email comes from')}>
          {tabs.map((x) => (
            <button
              key={x.id}
              type="button"
              role="tab"
              aria-selected={tab === x.id}
              onClick={() => setTab(x.id)}
              className={cn('inline-flex h-9 items-center gap-1.5 rounded-full border px-4 text-sm font-medium', tab === x.id ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-surface hover:bg-muted')}
            >
              {x.icon} {t(x.label)}
            </button>
          ))}
        </div>
        {tab === 'paste' ? (
          <RfqCapture bare source={{ type: 'rfqs' }} companyId={link?.companyId ?? null} />
        ) : tab === 'mailbox' ? (
          <div className="space-y-2">
            <Input aria-label={t('Search your mailbox')} placeholder={t('Search by subject or sender')} value={q} onChange={(e) => setQ(e.target.value)} />
            {box.isPending ? (
              <Skeleton className="h-32" />
            ) : !box.data?.length ? (
              <p className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
                {q ? t('No emails match.') : t('No synced emails. Connect your mailbox under Integrations, or upload the email file instead.')}
              </p>
            ) : (
              <fieldset>
                <legend className="sr-only">{t('Choose the RFQ email')}</legend>
                <ul className="max-h-72 space-y-1 overflow-y-auto">
                  {box.data.map((m) => (
                    <li key={m.id}>
                      <label className={cn('flex cursor-pointer gap-3 rounded-md border p-2 text-sm', picked === m.id ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted')}>
                        <input type="radio" name="sbx-email" className="mt-1 size-4" checked={picked === m.id} onChange={() => setPicked(m.id)} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{m.subject || t('(no subject)')}</span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {m.fromAddress} · {relativeTime(m.sentAt)}
                            {m.contact?.companyName && <> · {m.contact.companyName}</>}
                          </span>
                          {m.snippet && <span className="block truncate text-xs text-muted-foreground">{m.snippet}</span>}
                        </span>
                        {m.transferredAt && <Badge tone="success">{t('Already sent')}</Badge>}
                      </label>
                    </li>
                  ))}
                </ul>
              </fieldset>
            )}
            <p className="text-xs text-muted-foreground">{t('Synced emails carry their text, not their attachments. If the RFQ email has attachments, upload the email file instead.')}</p>
          </div>
        ) : (
          <div className="space-y-2">
            <UploadZone label={t('Drop the .eml or .msg file here')} accept={['.eml', '.msg']} maxBytes={SAMPBIDX_EMAIL_FILE_MAX_BYTES} file={file} onClear={() => setFile(null)} onFile={setFile} />
            <p className="text-xs text-muted-foreground">{t('In Outlook, drag the email to your desktop (.msg). In Gmail, open the email, choose More, then Download message (.eml). The file keeps the email’s attachments.')}</p>
          </div>
        )}
        {tab !== 'paste' && (
          <>
        <div className="mt-3">
          <Field id="sbx-email-note" label={t('Note for the SampBidx team (optional)')}>
            <Textarea rows={2} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
        {result.error && (
          <p role="alert" className="mt-2 text-sm text-critical">
            {result.error.message}
          </p>
        )}
        {result.data && (
          <div className="mt-3">
            <SampbidxTransferList items={[result.data]} label={t('Result')} />
          </div>
        )}
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {result.data ? t('Close') : t('Cancel')}
          </Button>
          <Button type="button" disabled={!connected || pending || (tab === 'mailbox' ? !picked : !file)} onClick={() => void go()}>
            <Send aria-hidden /> {pending ? t('Sending to SampBidx…') : pickedRow?.transferredAt && tab === 'mailbox' ? t('Send another copy to SampBidx') : t('Send email to SampBidx')}
          </Button>
        </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

