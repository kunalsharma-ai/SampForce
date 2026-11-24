'use client';

import {
  COMPANY_EMAIL_CTA_LABELS,
  COMPANY_EMAIL_CTAS,
  COMPANY_EMAIL_PURPOSE_LABELS,
  COMPANY_EMAIL_PURPOSES,
  COMPANY_EMAIL_RECIPIENT_LABELS,
  COMPANY_EMAIL_RECIPIENTS,
  type CompanyEmailDraft,
  type CompanyEmailPurpose,
  type CompanyEmailRequest,
  type CompanyRow,
  EMAIL_LENGTHS,
  EMAIL_TONE_LABELS,
  EMAIL_TONES,
  PERSONALISATION_LABELS,
  PERSONALISATION_LEVELS,
  type SalesProfile,
} from '@dealflow/types';
import { Badge, Button, Card, CardContent, Field, Input } from '@dealflow/ui';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  CalendarCheck,
  Check,
  Copy,
  FileText,
  Handshake,
  Heart,
  type LucideIcon,
  MailPlus,
  PartyPopper,
  RefreshCcw,
  Repeat2,
  Send,
  Sparkles,
} from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';
import { ComposeDialog } from '@/app/app/communication/mailbox';
import { InfoTip } from '@/components/info-tip';
import { gated } from '@/components/shell/feature-locked';
import { agentReason, aiErrorMessage, useAiStatus } from '@/lib/ai';
import { api } from '@/lib/api';
import { useCompanyEmployees } from '@/lib/company-work';
import { useT } from '@/lib/i18n';
import { useCan } from '@/lib/session';
import { focusSection, useCompanyAction } from './company-actions';
import { Select, Textarea } from './select';

const PURPOSE_ICONS: Record<CompanyEmailPurpose, LucideIcon> = {
  introduction: Handshake,
  follow_up: Repeat2,
  meeting_request: CalendarCheck,
  proposal: FileText,
  re_engagement: RefreshCcw,
  thank_you: Heart,
  event_invitation: PartyPopper,
};
const LENGTH_LABELS = { short: 'Short', medium: 'Medium', long: 'Long' } as const;

/** Square-bracket placeholders still in the text, such as [proposed time]. */
export const placeholdersIn = (text: string) => [...new Set(text.match(/\[[^\]\n]{1,60}\]/g) ?? [])];

type Draft = { subject: string; body: string; waitDays: number | null };

/**
 * The AI sales email assistant on the company page (ADR 0077). It writes for the person's own organisation, using the
 * sales profile kept in Settings, to this company, using its Business Information. The draft is shown in editable
 * fields and sent only through the normal email window, from the person's own mailbox.
 */
function CompanyEmailAssistantCard({ company: c }: { company: CompanyRow }) {
  const t = useT();
  const canAi = useCan('ai:use');
  const status = useAiStatus(canAi);
  const employees = useCompanyEmployees(c.id);
  const profile = useQuery({ enabled: canAi, queryKey: ['sales-profile'], queryFn: () => api<SalesProfile>('/tenants/current/sales-profile') });
  const [req, setReq] = React.useState<CompanyEmailRequest>({
    purpose: 'introduction',
    recipientType: 'decision_maker',
    tone: 'professional',
    length: 'short',
    cta: 'book_call',
    personalisation: 'balanced',
    objective: '',
    followUps: 0,
  });
  const [result, setResult] = React.useState<CompanyEmailDraft | null>(null);
  const [drafts, setDrafts] = React.useState<Draft[]>([]);
  const [tab, setTab] = React.useState(0);
  const [copied, setCopied] = React.useState(false);
  const [composing, setComposing] = React.useState(false);
  const write = useMutation({
    mutationFn: () => api<CompanyEmailDraft>(`/companies/${c.id}/ai-email`, { method: 'POST', json: { ...req, contactId: req.contactId || undefined } }),
    onSuccess: (d) => {
      setResult(d);
      setDrafts([{ subject: d.subject, body: d.body, waitDays: null }, ...d.followUps.map((f) => ({ subject: f.subject, body: f.body, waitDays: f.waitDays }))]);
      setTab(0);
      setCopied(false);
      window.requestAnimationFrame(() => document.getElementById('ai-email-result')?.focus());
    },
  });
  const run = React.useCallback(() => focusSection('company-email-assistant', 'button'), []);
  useCompanyAction('aiEmail', canAi && !c.restricted ? run : null);
  if (!canAi || c.restricted) return null;

  const reason = agentReason(status.data, 'email_assistant');
  const set = <K extends keyof CompanyEmailRequest>(k: K, v: CompanyEmailRequest[K]) => setReq((r) => ({ ...r, [k]: v }));
  const people = (employees.data ?? []).filter((e) => e.details);
  const contact = people.find((e) => e.id === req.contactId) ?? null;
  const senderName = profile.data ? profile.data.companyName || profile.data.workspaceName : null;
  const gaps = result?.sender.gaps ?? (profile.data && (!profile.data.services.length || !profile.data.valueProposition) ? ['missing'] : []);
  const current = drafts[tab];
  const placeholders = current ? placeholdersIn(`${current.subject}\n${current.body}`) : [];
  // The AI's own notes about [placeholders] are replaced by the live list, so a filled-in one disappears.
  const notes = result?.checkBeforeSending.filter((x) => !placeholdersIn(x).length) ?? [];
  const edit = (patch: Partial<Draft>) => setDrafts((ds) => ds.map((d, i) => (i === tab ? { ...d, ...patch } : d)));

  async function copy() {
    if (!current) return;
    try {
      await navigator.clipboard.writeText(`${current.subject}\n\n${current.body}`);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Card id="company-email-assistant" className="overflow-hidden">
      <div className="relative border-b border-border bg-gradient-to-r from-primary/15 via-accent/10 to-transparent px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="inline-flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-accent text-white shadow-sm">
              <MailPlus aria-hidden className="size-5" />
            </span>
            <div>
              <h2 className="flex items-center gap-2 text-base font-semibold">
                {t('AI email assistant')}
                <Badge tone="accent" className="px-1.5 py-0 text-[10px]">
                  AI
                </Badge>
                <InfoTip topic="crm.companyEmailAssistant" />
              </h2>
              <p className="text-xs text-muted-foreground">{t('Writes a sales email to {company} from its Business Information. You check and edit it before sending.', { company: c.name })}</p>
            </div>
          </div>
          {senderName && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1 text-xs">
              <span className="text-muted-foreground">{t('Writing for')}</span> <span className="font-semibold">{senderName}</span>
            </span>
          )}
        </div>
      </div>
      <CardContent className="space-y-4 p-5">
        {gaps.length > 0 && (
          <p className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
            <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
            <span>
              {t('Your sales profile has no services or value proposition yet, so the email can only describe your organisation in general.')}{' '}
              <Link href="/app/settings#sales-profile" className="font-medium text-primary hover:underline">
                {profile.data?.editable ? t('Add them in Settings') : t('Ask your Super Workspace to add them')}
              </Link>
            </span>
          </p>
        )}
        <fieldset>
          <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('Purpose')}</legend>
          <div className="flex flex-wrap gap-2">
            {COMPANY_EMAIL_PURPOSES.map((p) => {
              const Icon = PURPOSE_ICONS[p];
              return (
                <label
                  key={p}
                  className="inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-full border border-border bg-surface px-3 text-sm transition hover:border-primary/50 has-[:checked]:border-primary has-[:checked]:bg-primary has-[:checked]:text-primary-foreground has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring"
                >
                  <input type="radio" name={`purpose-${c.id}`} className="sr-only" checked={req.purpose === p} onChange={() => set('purpose', p)} />
                  <Icon aria-hidden className="size-4" /> {t.maybe(COMPANY_EMAIL_PURPOSE_LABELS[p])}
                </label>
              );
            })}
          </div>
        </fieldset>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <Field id="ai-email-to" label={t('Write to')}>
            <Select value={req.contactId ?? ''} onChange={(e) => set('contactId', e.target.value || undefined)}>
              <option value="">{t('A role, not a named person')}</option>
              {people.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.jobTitle ? `${e.name} · ${e.jobTitle}` : e.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="ai-email-role" label={t('Recipient type')}>
            <Select value={req.recipientType} onChange={(e) => set('recipientType', e.target.value as CompanyEmailRequest['recipientType'])}>
              {COMPANY_EMAIL_RECIPIENTS.map((r) => (
                <option key={r} value={r}>
                  {t.maybe(COMPANY_EMAIL_RECIPIENT_LABELS[r])}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="ai-email-tone" label={t('Tone')}>
            <Select value={req.tone} onChange={(e) => set('tone', e.target.value as CompanyEmailRequest['tone'])}>
              {EMAIL_TONES.map((x) => (
                <option key={x} value={x}>
                  {t.maybe(EMAIL_TONE_LABELS[x])}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="ai-email-cta" label={t('Call to action')}>
            <Select value={req.cta} onChange={(e) => set('cta', e.target.value as CompanyEmailRequest['cta'])}>
              {COMPANY_EMAIL_CTAS.map((x) => (
                <option key={x} value={x}>
                  {t.maybe(COMPANY_EMAIL_CTA_LABELS[x])}
                </option>
              ))}
            </Select>
          </Field>
          <Segmented label={t('Length')} value={req.length} options={EMAIL_LENGTHS.map((x) => ({ value: x, label: t.maybe(LENGTH_LABELS[x]) }))} onChange={(v) => set('length', v)} />
          <Segmented label={t('Personalisation')} value={req.personalisation} options={PERSONALISATION_LEVELS.map((x) => ({ value: x, label: t.maybe(PERSONALISATION_LABELS[x]) }))} onChange={(v) => set('personalisation', v)} />
          <div className="sm:col-span-2">
            <Field id="ai-email-objective" label={t('Sales objective')} hint={t('Optional. What you want from this company, in your own words.')}>
              <Input value={req.objective} maxLength={500} placeholder={t('For example: be their research partner for the 2027 product launch')} onChange={(e) => set('objective', e.target.value)} />
            </Field>
          </div>
          <Segmented label={t('Follow-ups')} value={String(req.followUps)} options={['0', '1', '2', '3'].map((x) => ({ value: x, label: x === '0' ? t('None') : x }))} onChange={(v) => set('followUps', Number(v))} />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button disabled={write.isPending || !!reason} onClick={() => write.mutate()}>
            <Sparkles aria-hidden /> {write.isPending ? t('Writing…') : result ? t('Write again') : t('Write email')}
          </Button>
          {reason && <p className="text-sm text-muted-foreground">{t.maybe(reason)}</p>}
        </div>
        {write.error && (
          <p role="alert" className="rounded-md border border-critical/40 bg-critical/10 p-2 text-sm">
            {t.maybe(aiErrorMessage(write.error))}
          </p>
        )}

        {result && current && (
          <section id="ai-email-result" tabIndex={-1} aria-label={t('Draft email')} className="space-y-3 rounded-xl border border-primary/30 bg-primary/[0.03] p-4 focus:outline-none">
            {result.recipient?.optedOut && (
              <p role="alert" className="flex items-center gap-2 rounded-md border border-critical/40 bg-critical/10 p-2 text-sm">
                <AlertTriangle aria-hidden className="size-4 text-critical" /> {t('{name} opted out of marketing email. Send only if this is a reply they expect.', { name: result.recipient.name })}
              </p>
            )}
            {result.recipient?.emailProblem && (
              <p className="flex items-center gap-2 rounded-md border border-warning/40 bg-warning/10 p-2 text-sm">
                <AlertTriangle aria-hidden className="size-4 text-warning" /> {t('Email to {name} bounced or the address looks invalid.', { name: result.recipient.name })}
              </p>
            )}
            {drafts.length > 1 && (
              <div role="tablist" aria-label={t('Emails in this sequence')} className="flex flex-wrap gap-1.5">
                {drafts.map((d, i) => (
                  <button
                    key={i}
                    type="button"
                    role="tab"
                    aria-selected={tab === i}
                    onClick={() => setTab(i)}
                    className={`min-h-8 rounded-full px-3 text-xs font-medium transition ${tab === i ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground hover:bg-muted/70'}`}
                  >
                    {i === 0 ? t('First email') : t('Follow-up {n} · after {days} days', { n: i, days: d.waitDays ?? 0 })}
                  </button>
                ))}
              </div>
            )}
            <div className="text-xs text-muted-foreground">
              {t('To')}: <span className="font-medium text-foreground">{result.to ?? t('No email address on record')}</span>
              {result.recipient ? ` · ${result.recipient.name}` : ` · ${t.maybe(COMPANY_EMAIL_RECIPIENT_LABELS[req.recipientType])}`}
            </div>
            <Field id="ai-email-subject" label={t('Subject')}>
              <Input value={current.subject} maxLength={200} onChange={(e) => edit({ subject: e.target.value })} />
            </Field>
            {tab === 0 && result.subjectAlternatives.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-muted-foreground">{t('Other subjects')}:</span>
                {result.subjectAlternatives.map((s) => (
                  <button key={s} type="button" onClick={() => edit({ subject: s })} className="min-h-7 rounded-full border border-border bg-surface px-2.5 text-xs hover:border-primary/50 hover:text-primary">
                    {s}
                  </button>
                ))}
              </div>
            )}
            <Field id="ai-email-body" label={t('Email')}>
              <Textarea value={current.body} rows={12} onChange={(e) => edit({ body: e.target.value })} className="font-[inherit] leading-relaxed" />
            </Field>
            {(placeholders.length > 0 || notes.length > 0) && (
              <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
                <p className="mb-1 flex items-center gap-1.5 font-medium">
                  <AlertTriangle aria-hidden className="size-4 text-warning" /> {t('Check before sending')}
                </p>
                <ul className="list-disc space-y-0.5 ps-5">
                  {placeholders.map((p) => (
                    <li key={p}>{t('Fill in {placeholder}', { placeholder: p })}</li>
                  ))}
                  {notes.map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
              </div>
            )}
            {result.basedOn.length > 0 && (
              <details className="text-xs text-muted-foreground">
                <summary className="cursor-pointer">{t('What the AI used ({count})', { count: result.basedOn.length })}</summary>
                <ul className="mt-1 list-disc space-y-0.5 ps-5">
                  {result.basedOn.map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
              </details>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={() => setComposing(true)}>
                <Send aria-hidden /> {t('Open in email')}
              </Button>
              <Button variant="outline" onClick={() => void copy()}>
                {copied ? <Check aria-hidden /> : <Copy aria-hidden />} {copied ? t('Copied') : t('Copy')}
              </Button>
              <p className="text-xs text-muted-foreground">{t('Written by AI. Nothing is sent until you press Send.')}</p>
            </div>
          </section>
        )}
      </CardContent>
      {composing && current && (
        <ComposeDialog
          open
          onOpenChange={(o) => !o && setComposing(false)}
          to={result?.to ?? ''}
          contactId={result?.recipient?.contactId ?? contact?.id}
          subject={current.subject}
          body={current.body}
        />
      )}
    </Card>
  );
}

function Segmented<V extends string>({ label, value, options, onChange }: { label: string; value: V; options: { value: V; label: string }[]; onChange: (v: V) => void }) {
  const id = React.useId();
  return (
    <div role="radiogroup" aria-labelledby={id} className="space-y-1.5">
      <span id={id} className="block text-sm font-medium">
        {label}
      </span>
      <div className="flex h-10 rounded-md border border-input bg-surface p-1">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            onClick={() => onChange(o.value)}
            className={`flex-1 rounded px-2 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${value === o.value ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export const CompanyEmailAssistant = gated('ai_assistant', CompanyEmailAssistantCard);
