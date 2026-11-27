'use client';

import { SUPPORT_ATTACHMENT_MAX_BYTES, SUPPORT_ATTACHMENTS_MAX, type SupportAttachmentRow, type SupportRecordType } from '@dealflow/types';
import { Button } from '@dealflow/ui';
import { FileText, Image as ImageIcon, Loader2, Paperclip, X } from 'lucide-react';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { useT } from '@/lib/i18n';
import { supportFileHref, uploadSupportFile } from '@/lib/support';

const ACCEPT = 'image/*,.pdf,.txt,.csv,.xlsx,.xls,.doc,.docx,.log,.json,.zip';

function size(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Screenshots and files for a query or a reply (ADR 0073). Each file is uploaded as soon as it is chosen; the message
 * then sends their ids. In the Console, files go straight into the ticket.
 */
export function AttachmentPicker({ files, onChange, ticketId, id = 'support-files' }: { files: SupportAttachmentRow[]; onChange: (files: SupportAttachmentRow[]) => void; ticketId?: string; id?: string }) {
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const full = files.length + busy >= SUPPORT_ATTACHMENTS_MAX;

  const choose = async (list: FileList | null) => {
    setError(null);
    const chosen = Array.from(list ?? []).slice(0, SUPPORT_ATTACHMENTS_MAX - files.length);
    if (input.current) input.current.value = '';
    const tooBig = chosen.find((f) => f.size > SUPPORT_ATTACHMENT_MAX_BYTES);
    if (tooBig) return setError(t('{name} is larger than 10 MB.', { name: tooBig.name }));
    setBusy((n) => n + chosen.length);
    const added: SupportAttachmentRow[] = [];
    for (const f of chosen) {
      try {
        added.push(await uploadSupportFile(f, ticketId));
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy((n) => n - 1);
      }
    }
    onChange([...files, ...added]);
  };

  return (
    <div className="space-y-2" data-attachment-picker>
      <div className="flex flex-wrap items-center gap-2">
        <input id={id} ref={input} type="file" multiple accept={ACCEPT} className="sr-only" onChange={(e) => void choose(e.target.files)} disabled={full} aria-label={t('Attach screenshots or files')} />
        <Button type="button" variant="outline" size="sm" onClick={() => input.current?.click()} disabled={full}>
          {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Paperclip aria-hidden />} {t('Attach files')}
        </Button>
        <span className="text-xs text-muted-foreground">{t('Up to {count} files, 10 MB each', { count: SUPPORT_ATTACHMENTS_MAX })}</span>
      </div>
      {files.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label={t('Attached files')}>
          {files.map((f) => (
            <li key={f.id} className="flex items-center gap-1.5 rounded-full border border-border bg-muted/50 py-1 pe-1 ps-3 text-xs" data-attached-file={f.name}>
              {f.contentType.startsWith('image/') ? <ImageIcon className="size-3.5" aria-hidden /> : <FileText className="size-3.5" aria-hidden />}
              <span className="max-w-48 truncate">{f.name}</span>
              <span className="text-muted-foreground">{size(f.sizeBytes)}</span>
              <button type="button" className="rounded-full p-0.5 hover:bg-muted" onClick={() => onChange(files.filter((x) => x.id !== f.id))} aria-label={t('Remove {name}', { name: f.name })}>
                <X className="size-3.5" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className="text-xs text-critical">
          {error}
        </p>
      )}
    </div>
  );
}

/** The files sent with a message, opened in a new tab (they download with their own name). */
export function MessageFiles({ files, operatorTicketId, inverted }: { files: SupportAttachmentRow[]; operatorTicketId?: string; inverted?: boolean }) {
  const t = useT();
  if (!files.length) return null;
  return (
    <ul className="mt-2 flex flex-wrap gap-1.5" aria-label={t('Attached files')}>
      {files.map((f) => (
        <li key={f.id}>
          <a
            href={supportFileHref(f.id, operatorTicketId)}
            target="_blank"
            rel="noreferrer"
            className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs underline-offset-2 hover:underline ${inverted ? 'border-primary-foreground/30 text-primary-foreground' : 'border-border bg-background/60'}`}
            data-message-file={f.name}
          >
            {f.contentType.startsWith('image/') ? <ImageIcon className="size-3.5" aria-hidden /> : <FileText className="size-3.5" aria-hidden />}
            {f.name} <span className={inverted ? undefined : 'text-muted-foreground'}>{size(f.sizeBytes)}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}

const RECORD_PATH: Record<SupportRecordType, string> = { lead: '/app/leads', contact: '/app/contacts', company: '/app/companies', deal: '/app/deals' };

export function useRecordTypeLabel() {
  const t = useT();
  const labels: Record<SupportRecordType, string> = { lead: t('Inbound contact'), contact: t('Contact'), company: t('Company'), deal: t('Deal') };
  return (type: SupportRecordType) => labels[type];
}

/** The record a query is about, linked for people in the workspace and plain text in the Console. */
export function RelatedRecord({ record, link = true }: { record: { type: SupportRecordType; id: string; label: string }; link?: boolean }) {
  const label = useRecordTypeLabel();
  const text = `${label(record.type)}: ${record.label}`;
  return link ? (
    <Link href={`${RECORD_PATH[record.type]}/${record.id}`} className="font-medium text-primary underline-offset-2 hover:underline" data-related-record={record.type}>
      {text}
    </Link>
  ) : (
    <span className="font-medium" data-related-record={record.type}>
      {text}
    </span>
  );
}

/** Reads a record page's address, so a query raised from it is linked to that record without asking. */
export function recordFromPath(path: string | null | undefined): { type: SupportRecordType; id: string } | null {
  const m = path?.match(/^\/app\/(leads|contacts|companies|deals)\/([0-9a-f-]{36})(?:[/?#]|$)/i);
  if (!m) return null;
  const type = ({ leads: 'lead', contacts: 'contact', companies: 'company', deals: 'deal' } as const)[m[1] as 'leads' | 'contacts' | 'companies' | 'deals'];
  return { type, id: m[2]!.toLowerCase() };
}
