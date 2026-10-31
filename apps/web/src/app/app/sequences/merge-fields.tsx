'use client';

import { Button } from '@dealflow/ui';
import { MERGE_FIELD_KEYS, MERGE_FIELDS, type MergeField, type SequenceTestSendResult, type TemplatePreview } from '@dealflow/types';
import { useMutation } from '@tanstack/react-query';
import { Send } from 'lucide-react';
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
/** Where a "Send me a test" goes: one saved email step of a sequence. */
export interface TestSendTarget {
  seqId: string;
  stepId: string;
  variant: 'A' | 'B';
  /** Unsaved changes: the test would send the saved version, so ask to save first. */
  dirty: boolean;
}

export function PreviewPanel({ subject, body, idBase = 'tpl', test }: { subject: string; body: string; idBase?: string; test?: TestSendTarget }) {
  const [lead, setLead] = useState<PickerValue | null>(null);
  const preview = useMutation({
    mutationFn: () => api<TemplatePreview>('/email-templates/preview', { method: 'POST', json: { subject, body, leadId: lead?.id } }),
  });
  const send = useMutation({
    mutationFn: () => api<SequenceTestSendResult>(`/sequences/${test!.seqId}/test-send`, { method: 'POST', json: { stepId: test!.stepId, variant: test!.variant, leadId: lead?.id } }),
  });
  const pickerId = `preview-lead-${idBase}`;
  return (
    <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-56 flex-1">
          <label htmlFor={pickerId} className="text-xs font-medium">
            Preview for a lead
          </label>
          <RecordPicker id={pickerId} entity="leads" value={lead} onChange={setLead} placeholder="Search leads (optional)" />
        </div>
        <Button type="button" size="sm" variant="outline" onClick={() => preview.mutate()} disabled={preview.isPending || !subject || !body}>
          Preview
        </Button>
        {test && (
          <Button type="button" size="sm" variant="outline" onClick={() => send.mutate()} disabled={send.isPending || test.dirty || !subject || !body}>
            <Send className="h-4 w-4" aria-hidden /> Send me a test
          </Button>
        )}
      </div>
      {test?.dirty && <p className="text-xs text-muted-foreground">Save your changes to send a test of this email.</p>}
      <ErrorText error={preview.error ?? send.error} />
      {send.data && (
        <p role="status" className="text-xs text-success">
          Test sent to {send.data.to} with the subject “{send.data.subject}”.
          {send.data.missing.length > 0 && ` Empty fields are marked in it: ${send.data.missing.map((m) => MERGE_FIELDS[m]).join(', ')}.`}
        </p>
      )}
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
