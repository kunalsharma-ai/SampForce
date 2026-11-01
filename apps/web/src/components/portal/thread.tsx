'use client';

import { Badge, Button, cn } from '@dealflow/ui';
import { type PortalMessageRow, PORTAL_REQUEST_STATUS_LABELS, type PortalRequestStatus } from '@dealflow/types';
import { FileText, Upload } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { Textarea } from '@/components/crm/select';
import { relativeTime } from '@/lib/format';
import { fileSize, type PortalDocument } from '@/lib/portal';

const STATUS_TONE: Record<PortalRequestStatus, 'primary' | 'warning' | 'success' | 'neutral'> = { open: 'primary', in_progress: 'warning', resolved: 'success', closed: 'neutral' };

export function RequestStatus({ status }: { status: PortalRequestStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{PORTAL_REQUEST_STATUS_LABELS[status]}</Badge>;
}

/** A conversation between the customer and the account team. `mine` is the side the viewer is on. */
export function MessageThread({ messages, mine, empty }: { messages: PortalMessageRow[]; mine: 'customer' | 'team'; empty: string }) {
  if (!messages.length) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <ol className="space-y-3" aria-label="Messages">
      {messages.map((m) => (
        <li key={m.id} className={cn('max-w-[85%] rounded-lg border p-3 text-sm', m.side === mine ? 'ms-auto border-primary/30 bg-primary/5' : 'border-border bg-muted/40')}>
          <p className="mb-1 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{m.author}</span>
            {m.side === 'team' && mine === 'customer' && ' · account team'} · <time dateTime={m.createdAt}>{relativeTime(m.createdAt)}</time>
          </p>
          <p className="whitespace-pre-wrap">{m.body}</p>
        </li>
      ))}
    </ol>
  );
}

export function Composer({ label, button, onSend, pending, error }: { label: string; button: string; onSend: (body: string) => Promise<unknown>; pending: boolean; error?: Error | null }) {
  const id = useId();
  const [body, setBody] = useState('');
  return (
    <form
      className="space-y-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!body.trim()) return;
        await onSend(body.trim());
        setBody('');
      }}
    >
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <Textarea id={id} value={body} onChange={(e) => setBody(e.target.value)} maxLength={10000} />
      {error && (
        <p role="alert" className="text-sm text-critical">
          {error.message}
        </p>
      )}
      <Button type="submit" size="sm" disabled={pending || !body.trim()}>
        {button}
      </Button>
    </form>
  );
}

export function DocumentList({ docs, mine, onRemove }: { docs: PortalDocument[]; mine: 'customer' | 'team'; onRemove?: (d: PortalDocument) => void }) {
  if (!docs.length) return <p className="text-sm text-muted-foreground">No documents shared yet.</p>;
  return (
    <ul className="divide-y divide-border">
      {docs.map((d) => (
        <li key={d.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
          <FileText className="size-4 text-muted-foreground" aria-hidden />
          <a className="font-medium text-primary hover:underline" href={d.downloadUrl}>
            {d.name}
          </a>
          <span className="text-xs text-muted-foreground">
            {fileSize(d.sizeBytes)} · {d.side === mine ? 'shared by you' : d.side === 'team' ? `from ${d.uploadedBy}, account team` : `from ${d.uploadedBy}`} · {relativeTime(d.createdAt)}
          </span>
          {onRemove && (
            <Button type="button" size="sm" variant="ghost" className="ms-auto" onClick={() => onRemove(d)} aria-label={`Remove ${d.name}`}>
              Remove
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}

export function UploadButton({ label, onFile, pending }: { label: string; onFile: (f: File) => void; pending: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  const id = useId();
  return (
    <>
      <input
        id={id}
        ref={ref}
        type="file"
        className="sr-only"
        aria-label={label}
        accept=".pdf,.png,.jpg,.jpeg,.txt,.csv,.docx,.xlsx,.pptx"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = '';
        }}
      />
      <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => ref.current?.click()}>
        <Upload aria-hidden /> {pending ? 'Uploading…' : label}
      </Button>
    </>
  );
}
