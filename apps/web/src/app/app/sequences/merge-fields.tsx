'use client';

import { Button } from '@dealflow/ui';
import { MERGE_FIELD_KEYS, MERGE_FIELDS, type MergeField, type TemplatePreview } from '@dealflow/types';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { RecordPicker, type PickerValue } from '@/components/crm/record-picker';
import { ErrorText } from '@/components/revenue/tabs';
import { api } from '@/lib/api';

/** Buttons that insert `{{field}}` at the cursor of the last focused subject or body box. */
export function MergeFieldBar({ onInsert }: { onInsert: (tag: string) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1" aria-label="Insert a merge field">
      <span className="mr-1 text-xs text-muted-foreground">Insert:</span>
      {MERGE_FIELD_KEYS.map((k) => (
        <button
          key={k}
          type="button"
          className="rounded-md border border-border px-2 py-0.5 text-xs hover:bg-muted"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onInsert(k === 'first_name' ? '{{first_name|there}}' : `{{${k}}}`)}
        >
          {MERGE_FIELDS[k as MergeField]}
        </button>
      ))}
    </div>
  );
}

/** Inserts text at the selection of a textarea or input and returns the new value. */
export function insertAt(el: HTMLInputElement | HTMLTextAreaElement | null, value: string, text: string): string {
  if (!el) return value + text;
  const start = el.selectionStart ?? value.length;
  const end = el.selectionEnd ?? value.length;
  const next = value.slice(0, start) + text + value.slice(end);
  requestAnimationFrame(() => {
    el.focus();
    el.setSelectionRange(start + text.length, start + text.length);
  });
  return next;
}

/** Renders the email for a real lead so people see exactly what goes out, including empty fields. */
export function PreviewPanel({ subject, body }: { subject: string; body: string }) {
  const [lead, setLead] = useState<PickerValue | null>(null);
  const preview = useMutation({
    mutationFn: () => api<TemplatePreview>('/email-templates/preview', { method: 'POST', json: { subject, body, leadId: lead?.id } }),
  });
  return (
    <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-56 flex-1">
          <label htmlFor="preview-lead" className="text-xs font-medium">
            Preview for a lead
          </label>
          <RecordPicker id="preview-lead" entity="leads" value={lead} onChange={setLead} placeholder="Search leads (optional)" />
        </div>
        <Button type="button" size="sm" variant="outline" onClick={() => preview.mutate()} disabled={preview.isPending || !subject || !body}>
          Preview
        </Button>
      </div>
      <ErrorText error={preview.error} />
      {preview.data && (
        <div className="space-y-1 text-sm">
          {preview.data.recipient && (
            <p className="text-xs text-muted-foreground">
              To {preview.data.recipient.name} {preview.data.recipient.email ? `<${preview.data.recipient.email}>` : '(no email address)'}
            </p>
          )}
          <p className="font-medium">{preview.data.subject || <span className="text-muted-foreground">(empty subject)</span>}</p>
          <p className="whitespace-pre-wrap">{preview.data.body}</p>
          {preview.data.missing.length > 0 && (
            <p role="alert" className="text-xs text-warning">
              Empty with no fallback: {preview.data.missing.map((m) => MERGE_FIELDS[m]).join(', ')}. A sequence pauses for people like this instead of sending a gap.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
