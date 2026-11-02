'use client';

import { Button } from '@dealflow/ui';
import { EMAIL_TONE_LABELS, EMAIL_TONES, type EmailDraft, type EmailRewrite, type EmailSubjects, type EmailTone } from '@dealflow/types';
import { useMutation } from '@tanstack/react-query';
import { ChevronDown, Sparkles } from 'lucide-react';
import { useId, useState } from 'react';
import { Select } from '@/components/crm/select';
import { agentReason, aiErrorMessage, useAiStatus } from '@/lib/ai';
import { api } from '@/lib/api';
import { inSentence, useT } from '@/lib/i18n';
import { useCan } from '@/lib/session';

export interface EmailAssistTarget {
  leadId?: string;
  contactId?: string;
  dealId?: string;
  /** A received email to reply to. */
  emailId?: string;
}

type Proposal = { subject: string; body: string; notes: string[]; warnings: string[] };

/**
 * The Email Assistant inside an editor: draft from an objective, rewrite, change tone, suggest subjects.
 * Results are shown as a proposal; nothing changes in the editor until the person chooses "Use this", and nothing is sent.
 */
export function EmailAssist({
  subject,
  body,
  onApply,
  target,
  asTemplate = false,
  defaultOpen = false,
}: {
  subject: string;
  body: string;
  onApply: (v: { subject?: string; body?: string }) => void;
  target?: EmailAssistTarget;
  asTemplate?: boolean;
  defaultOpen?: boolean;
}) {
  const t = useT();
  const id = useId();
  const canUse = useCan('ai:use');
  const status = useAiStatus(canUse);
  const [open, setOpen] = useState(defaultOpen);
  const [objective, setObjective] = useState('');
  const [tone, setTone] = useState<EmailTone>('professional');
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [subjects, setSubjects] = useState<EmailSubjects['subjects'] | null>(null);
  const hasTarget = !!(target?.leadId || target?.contactId || target?.dealId || target?.emailId);

  const draft = useMutation({
    mutationFn: (mode: 'compose' | 'follow_up' | 'reply') =>
      api<EmailDraft>('/ai/email/draft', { method: 'POST', json: { mode, objective, tone, asTemplate, ...(asTemplate ? {} : target) } }),
    onSuccess: (d) => {
      setSubjects(null);
      setProposal({ subject: d.subject, body: d.body, notes: d.basedOn.length ? [t('Based on: {sources}', { sources: d.basedOn.join('; ') })] : [], warnings: d.checkBeforeSending });
    },
  });
  const rewrite = useMutation({
    mutationFn: (v: { action: 'improve' | 'shorten' | 'tone'; tone?: EmailTone }) => api<EmailRewrite>('/ai/email/rewrite', { method: 'POST', json: { ...v, subject, body } }),
    onSuccess: (r) => {
      setSubjects(null);
      setProposal({ subject: r.subject, body: r.body, notes: r.changes, warnings: [] });
    },
  });
  const suggest = useMutation({
    mutationFn: () => api<EmailSubjects>('/ai/email/subjects', { method: 'POST', json: { body, current: subject } }),
    onSuccess: (s) => {
      setProposal(null);
      setSubjects(s.subjects);
    },
  });

  if (!canUse) return null;
  const reason = agentReason(status.data, 'email_assistant');
  const busy = draft.isPending || rewrite.isPending || suggest.isPending;
  const error = draft.error ?? rewrite.error ?? suggest.error;
  const hasBody = body.trim().length > 0;

  return (
    <div className="rounded-lg border border-border">
      <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-start text-sm font-medium" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Sparkles className="size-4 text-accent" aria-hidden /> {t('Write with AI')}
        <ChevronDown className={`ms-auto size-4 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      {open && (
        <div className="space-y-3 border-t border-border p-3">
          {reason && <p className="text-xs text-warning">{t.maybe(reason)}</p>}
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-48 flex-1">
              <label htmlFor={`${id}-obj`} className="block text-xs font-medium">
                {t('What should the email achieve?')}
              </label>
              <input
                id={`${id}-obj`}
                className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
                maxLength={500}
                value={objective}
                placeholder={t('For example: book a 20-minute call about onboarding')}
                onChange={(e) => setObjective(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor={`${id}-tone`} className="block text-xs font-medium">
                {t('Tone')}
              </label>
              <Select id={`${id}-tone`} value={tone} onChange={(e) => setTone(e.target.value as EmailTone)}>
                {EMAIL_TONES.map((x) => (
                  <option key={x} value={x}>
                    {t.maybe(EMAIL_TONE_LABELS[x])}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" disabled={busy || !!reason || !objective.trim() || (!asTemplate && !hasTarget)} onClick={() => draft.mutate('compose')}>
              {t('Draft email')}
            </Button>
            {!asTemplate && target?.emailId && (
              <Button type="button" size="sm" variant="outline" disabled={busy || !!reason} onClick={() => draft.mutate('reply')}>
                {t('Draft a reply')}
              </Button>
            )}
            {!asTemplate && (target?.leadId || target?.contactId) && (
              <Button type="button" size="sm" variant="outline" disabled={busy || !!reason} onClick={() => draft.mutate('follow_up')}>
                {t('Draft a follow-up')}
              </Button>
            )}
            <Button type="button" size="sm" variant="outline" disabled={busy || !!reason || !hasBody} onClick={() => rewrite.mutate({ action: 'improve' })}>
              {t('Improve writing')}
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={busy || !!reason || !hasBody} onClick={() => rewrite.mutate({ action: 'shorten' })}>
              {t('Shorten')}
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={busy || !!reason || !hasBody} onClick={() => rewrite.mutate({ action: 'tone', tone })}>
              {t('Change tone to {tone}', { tone: inSentence(t, t.maybe(EMAIL_TONE_LABELS[tone])) })}
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={busy || !!reason || !hasBody} onClick={() => suggest.mutate()}>
              {t('Suggest subject lines')}
            </Button>
          </div>
          {!asTemplate && !hasTarget && <p className="text-xs text-muted-foreground">{t('Add a recipient who is a lead or contact to draft from their record. Rewriting works on any email.')}</p>}
          {busy && <p className="text-xs text-muted-foreground" role="status">{t('Writing…')}</p>}
          {error && (
            <p role="alert" className="text-sm text-critical">
              {t.maybe(aiErrorMessage(error))}
            </p>
          )}
          {proposal && (
            <div className="space-y-2 rounded-md bg-muted/40 p-3 text-sm" aria-label={t('AI suggestion')}>
              {proposal.subject && <p className="font-medium">{proposal.subject}</p>}
              <p className="whitespace-pre-wrap">{proposal.body}</p>
              {proposal.warnings.length > 0 && (
                <ul className="list-disc ps-5 text-xs text-warning">
                  {proposal.warnings.map((w) => (
                    <li key={w}>{t('Check before sending: {warning}', { warning: w })}</li>
                  ))}
                </ul>
              )}
              {proposal.notes.length > 0 && <p className="text-xs text-muted-foreground">{proposal.notes.join(' · ')}</p>}
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  onClick={() => {
                    onApply({ subject: proposal.subject || undefined, body: proposal.body });
                    setProposal(null);
                  }}
                >
                  {t('Use this')}
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setProposal(null)}>
                  {t('Discard')}
                </Button>
                <span className="self-center text-xs text-muted-foreground">{t('AI-written. Review it before you send; nothing is sent automatically.')}</span>
              </div>
            </div>
          )}
          {subjects && (
            <ul className="space-y-1 text-sm" aria-label={t('Suggested subject lines')}>
              {subjects.map((s) => (
                <li key={s.text} className="flex flex-wrap items-center gap-2">
                  <Button type="button" size="sm" variant="ghost" onClick={() => onApply({ subject: s.text })} aria-label={t('Use subject: {subject}', { subject: s.text })}>
                    {t('Use')}
                  </Button>
                  <span className="font-medium">{s.text}</span>
                  <span className="text-xs text-muted-foreground">{s.why}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
