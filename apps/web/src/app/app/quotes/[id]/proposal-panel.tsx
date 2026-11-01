'use client';

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Input,
} from '@dealflow/ui';
import {
  PROPOSAL_TEMPLATES,
  type ProposalDraft,
  type ProposalSection,
  type QuotePaymentRow,
  type QuoteRow,
  type RecommendationRow,
} from '@dealflow/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowDown,
  ArrowUp,
  ClipboardCopy,
  ExternalLink,
  Mail,
  Plus,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { useState } from 'react';
import { Select, Textarea } from '@/components/crm/select';
import { ErrorText, Field } from '@/components/revenue/tabs';
import { aiErrorMessage } from '@/lib/ai';
import { api } from '@/lib/api';
import { relativeTime } from '@/lib/format';
import { useCan } from '@/lib/session';

/**
 * Proposal sections shown above the price table. Templates and the AI draft only fill the editor;
 * nothing is saved until the person saves the draft, and prices always come from the quote lines.
 */
export function ProposalSections({
  dealId,
  sections,
  onChange,
  editable,
}: {
  dealId: string;
  sections: ProposalSection[];
  onChange: (s: ProposalSection[]) => void;
  editable: boolean;
}) {
  const canAi = useCan('ai:use');
  const [template, setTemplate] = useState('');
  const draft = useMutation({
    mutationFn: () =>
      api<RecommendationRow<ProposalDraft>>(`/ai/deals/${dealId}/proposal`, { method: 'POST' }),
  });
  const suggestion = draft.data?.payload;
  const set = (i: number, patch: Partial<ProposalSection>) =>
    onChange(sections.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const move = (i: number, by: number) => {
    const next = [...sections];
    const [s] = next.splice(i, 1);
    next.splice(i + by, 0, s!);
    onChange(next);
  };

  if (!editable) {
    if (sections.length === 0) return null;
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Proposal</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {sections.map((s, i) => (
            <section key={i} className="space-y-1">
              <h3 className="font-medium">{s.heading}</h3>
              <p className="whitespace-pre-wrap text-muted-foreground">{s.body}</p>
            </section>
          ))}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Proposal</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Sections appear above the price table on the online proposal and the PDF. Leave them empty
          to send a plain quote.
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label htmlFor="proposal-template" className="block text-xs font-medium">
              Start from a template
            </label>
            <Select
              id="proposal-template"
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
              className="h-9"
            >
              <option value="">Choose a template</option>
              {PROPOSAL_TEMPLATES.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.name}
                </option>
              ))}
            </Select>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!template}
            onClick={() => {
              const t = PROPOSAL_TEMPLATES.find((x) => x.key === template);
              if (t) onChange(t.sections.map((s) => ({ ...s })));
            }}
          >
            {sections.length ? 'Replace sections' : 'Use template'}
          </Button>
          {canAi && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={draft.isPending}
              onClick={() => draft.mutate()}
            >
              <Sparkles aria-hidden /> Draft sections with AI
            </Button>
          )}
        </div>
        {draft.isPending && (
          <p role="status" className="text-xs text-muted-foreground">
            Writing from the deal&apos;s details…
          </p>
        )}
        {draft.error && (
          <p role="alert" className="text-sm text-critical">
            {aiErrorMessage(draft.error)}
          </p>
        )}
        {suggestion && (
          <div
            className="space-y-2 rounded-md bg-muted/40 p-3 text-sm"
            aria-label="AI proposal suggestion"
          >
            <p className="font-medium">
              {suggestion.sections.length} suggested sections:{' '}
              {suggestion.sections.map((s) => s.heading).join(', ')}
            </p>
            {suggestion.basedOn.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Based on: {suggestion.basedOn.join('; ')}
              </p>
            )}
            {suggestion.openQuestions.length > 0 && (
              <ul className="list-disc pl-5 text-xs text-warning">
                {suggestion.openQuestions.map((q) => (
                  <li key={q}>Open question: {q}</li>
                ))}
              </ul>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  onChange(
                    suggestion.sections.slice(0, 20).map((s) => ({
                      heading: s.heading.slice(0, 120),
                      body: s.body.slice(0, 8000),
                    })),
                  );
                  draft.reset();
                }}
              >
                Use these sections
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => draft.reset()}>
                Discard
              </Button>
              <span className="self-center text-xs text-muted-foreground">
                AI-written. Check every fact; prices come from the quote lines.
              </span>
            </div>
          </div>
        )}
        {sections.map((s, i) => (
          <div key={i} className="space-y-2 rounded-md border border-border p-3">
            <div className="flex items-center gap-2">
              <Input
                aria-label={`Section ${i + 1} heading`}
                value={s.heading}
                maxLength={120}
                onChange={(e) => set(i, { heading: e.target.value })}
                className="h-9 font-medium"
              />
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label={`Move section ${i + 1} up`}
                disabled={i === 0}
                onClick={() => move(i, -1)}
              >
                <ArrowUp className="size-4" aria-hidden />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label={`Move section ${i + 1} down`}
                disabled={i === sections.length - 1}
                onClick={() => move(i, 1)}
              >
                <ArrowDown className="size-4" aria-hidden />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label={`Remove section ${i + 1}`}
                onClick={() => onChange(sections.filter((_, j) => j !== i))}
              >
                <Trash2 className="size-4" aria-hidden />
              </Button>
            </div>
            <Textarea
              aria-label={`Section ${i + 1} text`}
              value={s.body}
              maxLength={8000}
              rows={4}
              onChange={(e) => set(i, { body: e.target.value })}
            />
          </div>
        ))}
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={sections.length >= 20}
          onClick={() => onChange([...sections, { heading: 'New section', body: '' }])}
        >
          <Plus aria-hidden /> Add section
        </Button>
      </CardContent>
    </Card>
  );
}

/** The online proposal link and sending it by email. Opens are reported as likely views, because scanners open links too. */
export function ProposalSharing({
  quote: q,
  onSent,
}: {
  quote: QuoteRow;
  onSent: () => Promise<void>;
}) {
  const qc = useQueryClient();
  const canWrite = useCan('quotes:write');
  const canEmail = useCan('activities:write');
  const shareable = ['APPROVED', 'SENT', 'ACCEPTED', 'DECLINED'].includes(q.status);
  const link = useQuery({
    queryKey: ['quotes', 'share', q.id, q.share.enabled],
    queryFn: () => api<{ enabled: boolean; url: string | null }>(`/quotes/${q.id}/share`),
    enabled: shareable,
  });
  const toggle = useMutation({
    mutationFn: (enabled: boolean) =>
      api(`/quotes/${q.id}/share`, { method: 'POST', json: { enabled } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['quotes'] }),
  });
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(false);
  if (!shareable) return null;
  const url = link.data?.url ?? null;
  const canSend =
    canWrite &&
    canEmail &&
    q.isLatest &&
    (q.status === 'APPROVED' || q.status === 'SENT') &&
    !q.expired;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Online proposal</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {canSend && (
          <Button className="w-full" onClick={() => setOpen(true)}>
            <Mail aria-hidden /> Email proposal
          </Button>
        )}
        <div className="flex items-center gap-2">
          <Badge tone={q.share.enabled ? 'success' : 'neutral'}>
            {q.share.enabled ? 'Link is live' : 'Link is off'}
          </Badge>
          {canWrite && (
            <Button
              size="sm"
              variant="ghost"
              disabled={toggle.isPending}
              onClick={() => toggle.mutate(!q.share.enabled)}
            >
              {q.share.enabled ? 'Turn link off' : 'Turn link on'}
            </Button>
          )}
        </div>
        {url && (
          <div className="flex flex-wrap items-center gap-2">
            <Input
              readOnly
              aria-label="Proposal link"
              value={url}
              className="h-9 w-full text-xs"
              onFocus={(e) => e.target.select()}
            />
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                void navigator.clipboard?.writeText(url);
                setCopied(true);
              }}
            >
              <ClipboardCopy aria-hidden /> {copied ? 'Copied' : 'Copy'}
            </Button>
            <a
              href={`${url}?preview=1`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 self-center text-xs text-primary hover:underline"
            >
              <ExternalLink className="size-3" aria-hidden /> Preview (not counted)
            </a>
          </div>
        )}
        <div className="text-xs text-muted-foreground" aria-label="Proposal views">
          {q.share.viewCount === 0 ? (
            <p>Not opened yet.</p>
          ) : (
            <p>
              Opened {q.share.viewCount} {q.share.viewCount === 1 ? 'time' : 'times'}, first{' '}
              {relativeTime(q.share.firstViewedAt!)}, last {relativeTime(q.share.lastViewedAt!)}.
            </p>
          )}
          <p>Opens are estimates: email security scanners can open links before a person does.</p>
        </div>
        <CardPayments quote={q} />
        <ErrorText error={toggle.error ?? link.error} />
      </CardContent>
      {canSend && <SendDialog quote={q} open={open} onOpenChange={setOpen} onSent={onSent} />}
    </Card>
  );
}

const PAYMENT_STATUS: Record<QuotePaymentRow['status'], { label: string; tone: 'neutral' | 'success' | 'warning' | 'critical' }> = {
  pending: { label: 'Started, not confirmed', tone: 'neutral' },
  paid: { label: 'Paid', tone: 'success' },
  failed: { label: 'Failed', tone: 'critical' },
  expired: { label: 'Expired', tone: 'neutral' },
};

/** Card payments the customer started from the online proposal. "Paid" only ever comes from the provider's signed webhook. */
function CardPayments({ quote: q }: { quote: QuoteRow }) {
  const payments = useQuery({
    queryKey: ['quotes', 'payments', q.id],
    queryFn: () => api<QuotePaymentRow[]>(`/apps/payments/quotes/${q.id}`),
    enabled: q.status === 'ACCEPTED',
  });
  if (q.status !== 'ACCEPTED') return null;
  const rows = payments.data ?? [];
  return (
    <div className="space-y-1 border-t border-border pt-3" aria-label="Card payments">
      <p className="text-xs font-medium">Card payments</p>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          None yet. When card payments are set up under Integrations, the customer sees “Pay by
          card” on this accepted proposal.
        </p>
      ) : (
        <ul className="space-y-1 text-xs">
          {rows.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-2">
              <Badge tone={PAYMENT_STATUS[p.status].tone}>{PAYMENT_STATUS[p.status].label}</Badge>
              <span className="tabular-nums">
                {p.currency} {p.amount.toFixed(2)}
              </span>
              <span className="text-muted-foreground">
                {p.provider === 'stripe' ? 'Stripe' : 'Razorpay'} ·{' '}
                {p.paidAt ? `paid ${relativeTime(p.paidAt)}` : `started ${relativeTime(p.createdAt)}`}
                {p.payerEmail ? ` · ${p.payerEmail}` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
      <ErrorText error={payments.error} />
    </div>
  );
}

function SendDialog({
  quote: q,
  open,
  onOpenChange,
  onSent,
}: {
  quote: QuoteRow;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSent: () => Promise<void>;
}) {
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState(`Proposal: ${q.title}`);
  const [message, setMessage] = useState(
    `Hello,\n\nPlease find our proposal ${q.reference} for ${q.deal.companyName ?? q.deal.name}. You can view it online and download a PDF from the link below.\n\nKind regards`,
  );
  const send = useMutation({
    mutationFn: () =>
      api<QuoteRow>(`/quotes/${q.id}/send`, { method: 'POST', json: { to, subject, message } }),
    onSuccess: async () => {
      onOpenChange(false);
      await onSent();
    },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg p-6">
        <DialogTitle className="text-lg font-semibold">Email proposal</DialogTitle>
        <DialogDescription className="text-sm text-muted-foreground">
          Sent from your connected mailbox. A link to the online proposal is added below your
          message{q.status === 'APPROVED' ? ', and the quote is marked as sent' : ''}.
        </DialogDescription>
        <form
          className="mt-4 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            send.mutate();
          }}
        >
          <Field id="proposal-to" label="To">
            <Input
              id="proposal-to"
              type="email"
              required
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </Field>
          <Field id="proposal-subject" label="Email subject">
            <Input
              id="proposal-subject"
              required
              maxLength={200}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
          </Field>
          <Field id="proposal-message" label="Message">
            <Textarea
              id="proposal-message"
              required
              maxLength={5000}
              rows={6}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={send.isPending || !to.trim()}>
              Send
            </Button>
          </div>
          <ErrorText error={send.error} />
        </form>
      </DialogContent>
    </Dialog>
  );
}
