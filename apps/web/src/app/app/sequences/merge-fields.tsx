'use client';

import { Button } from '@dealflow/ui';
import { MERGE_FIELD_KEYS, MERGE_FIELDS, mergeTagLabel, type EmailDesign, type MergeField, type SequenceTestSendResult, type TemplatePreview } from '@dealflow/types';
import { useMutation } from '@tanstack/react-query';
import { Send } from 'lucide-react';
import { useMemo, useState } from 'react';
import { RecordPicker, type PickerValue } from '@/components/crm/record-picker';
import { ErrorText } from '@/components/revenue/tabs';
import { api } from '@/lib/api';
import { useCustomFields } from '@/lib/crm';
import { useEmailVariables } from '@/lib/sequences';

/** Custom fields on leads and contacts plus workspace variables, as insertable tags with readable labels. */
export function useExtraMergeFields() {
  const leads = useCustomFields('leads');
  const contacts = useCustomFields('contacts');
  const vars = useEmailVariables();
  return useMemo(() => {
    const options: { tag: string; label: string; group: 'Custom fields' | 'Workspace variables' }[] = [];
    const seen = new Set<string>();
    for (const f of [...(leads.data ?? []), ...(contacts.data ?? [])]) {
      if (seen.has(f.key)) continue;
      seen.add(f.key);
      options.push({ tag: `custom.${f.key}`, label: f.label, group: 'Custom fields' });
    }
    for (const v of vars.data ?? []) options.push({ tag: `var.${v.key}`, label: v.label, group: 'Workspace variables' });
    const labels = Object.fromEntries(options.map((o) => [o.tag, o.label]));
    return { options, labels };
  }, [leads.data, contacts.data, vars.data]);
}

/** Buttons that insert `{{field}}` at the cursor of the last focused subject or body box. */
export function MergeFieldBar({ onInsert, idBase = 'mf' }: { onInsert: (tag: string) => void; idBase?: string }) {
  const { options } = useExtraMergeFields();
  const groups = ['Custom fields', 'Workspace variables'] as const;
  return (
    <div className="flex flex-wrap items-center gap-1" aria-label="Insert a merge field">
      <span className="me-1 text-xs text-muted-foreground">Insert:</span>
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
      {options.length > 0 && (
        <>
          <label htmlFor={`${idBase}-extra`} className="sr-only">
            Insert a custom field or workspace variable
          </label>
          <select
            id={`${idBase}-extra`}
            className="h-7 rounded-md border border-border bg-background px-1 text-xs"
            value=""
            onChange={(e) => {
              if (e.target.value) onInsert(`{{${e.target.value}}}`);
            }}
          >
            <option value="">More fields…</option>
            {groups.map((g) =>
              options.some((o) => o.group === g) ? (
                <optgroup key={g} label={g}>
                  {options
                    .filter((o) => o.group === g)
                    .map((o) => (
                      <option key={o.tag} value={o.tag}>
                        {o.label}
                      </option>
                    ))}
                </optgroup>
              ) : null,
            )}
          </select>
        </>
      )}
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
    // Put the cursor back after the field, unless the person has already moved on to another box.
    const now = document.activeElement;
    if (now && now !== el && now !== document.body && (now instanceof HTMLInputElement || now instanceof HTMLTextAreaElement || now instanceof HTMLSelectElement)) return;
    el.focus();
    el.setSelectionRange(start + text.length, start + text.length);
  });
  return next;
}

/** Where a "Send me a test" goes: one saved email step of a sequence. */
export interface TestSendTarget {
  seqId: string;
  stepId: string;
  variant: 'A' | 'B';
  /** Unsaved changes: the test would send the saved version, so ask to save first. */
  dirty: boolean;
}

/** Renders the email for a real lead so people see exactly what goes out, including empty fields. */
export function PreviewPanel({ subject, body, design, idBase = 'tpl', test }: { subject: string; body: string; design?: EmailDesign | null; idBase?: string; test?: TestSendTarget }) {
  const [lead, setLead] = useState<PickerValue | null>(null);
  const preview = useMutation({
    mutationFn: () => api<TemplatePreview>('/email-templates/preview', { method: 'POST', json: { subject, body, design: design ?? undefined, leadId: lead?.id } }),
  });
  const ready = !!subject && (!!body || !!design);
  const send = useMutation({
    mutationFn: () => api<SequenceTestSendResult>(`/sequences/${test!.seqId}/test-send`, { method: 'POST', json: { stepId: test!.stepId, variant: test!.variant, leadId: lead?.id } }),
  });
  const pickerId = `preview-lead-${idBase}`;
  const { labels } = useExtraMergeFields();
  return (
    <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-56 flex-1">
          <label htmlFor={pickerId} className="text-xs font-medium">
            Preview for a lead
          </label>
          <RecordPicker id={pickerId} entity="leads" value={lead} onChange={setLead} placeholder="Search leads (optional)" />
        </div>
        <Button type="button" size="sm" variant="outline" onClick={() => preview.mutate()} disabled={preview.isPending || !ready}>
          Preview
        </Button>
        {test && (
          <Button type="button" size="sm" variant="outline" onClick={() => send.mutate()} disabled={send.isPending || test.dirty || !ready}>
            <Send className="h-4 w-4" aria-hidden /> Send me a test
          </Button>
        )}
      </div>
      {test?.dirty && <p className="text-xs text-muted-foreground">Save your changes to send a test of this email.</p>}
      <ErrorText error={preview.error ?? send.error} />
      {send.data && (
        <p role="status" className="text-xs text-success">
          Test sent to {send.data.to} with the subject “{send.data.subject}”.
          {send.data.missing.length > 0 && ` Empty fields are marked in it: ${send.data.missing.map((m) => mergeTagLabel(m, labels)).join(', ')}.`}
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
          {preview.data.html ? (
            <iframe title={`Email preview for ${preview.data.recipient?.name ?? 'a blank lead'}`} srcDoc={preview.data.html} sandbox="" className="h-[560px] w-full rounded border border-border bg-white" />
          ) : (
            <p className="whitespace-pre-wrap">{preview.data.body}</p>
          )}
          {preview.data.missing.length > 0 && (
            <p role="alert" className="text-xs text-warning">
              Empty with no fallback: {preview.data.missing.map((m) => mergeTagLabel(m, labels)).join(', ')}. A sequence pauses for people like this instead of sending a gap.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
