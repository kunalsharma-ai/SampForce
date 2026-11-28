'use client';

import { ENQUIRY_CATEGORY_LABELS, ENQUIRY_STATUS_LABELS, ENQUIRY_STATUSES, ENQUIRY_TYPE_LABELS, type EnquiryDetail, type EnquiryStatus } from '@dealflow/types';
import { Badge, Button, cn, Dialog, DialogContent, DialogDescription, DialogTitle, Field, Input, Skeleton } from '@dealflow/ui';
import { ArrowUpRight, Building2, CheckCircle2, CircleAlert, Clock, ExternalLink, Globe, Mail, MailOpen, Phone, Sparkles, UserRound } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';
import { formatDateTime } from '@/components/crm/follow-ups';
import { Select, Textarea } from '@/components/crm/select';
import { useMembers } from '@/lib/crm';
import { useT } from '@/lib/i18n';
import { useCan } from '@/lib/session';
import { flagOf, initialsOf, useEnquiry, useEnquiryMutations } from '@/lib/website-enquiries';
import { STATUS_TONE, TYPE_STYLE } from './enquiry-style';

/** The panel that opens over the list (`?open=<id>`): everything the website sent, the follow-up and conversion. */
export function EnquirySheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const t = useT();
  const q = useEnquiry(id);
  return (
    <Dialog open={!!id} onOpenChange={(o) => !o && onClose()}>
      <DialogContent side="right" className="w-full max-w-2xl overflow-y-auto p-0 sm:max-w-2xl">
        {q.isPending ? (
          <div className="space-y-3 p-6">
            <DialogTitle className="sr-only">{t('Website enquiry')}</DialogTitle>
            <DialogDescription className="sr-only">{t('Loading…')}</DialogDescription>
            <Skeleton className="h-24" />
            <Skeleton className="h-64" />
          </div>
        ) : q.isError || !q.data ? (
          <div className="p-6">
            <DialogTitle>{t('Website enquiry')}</DialogTitle>
            <DialogDescription className="mt-2 text-sm text-critical">{q.error?.message ?? t('Could not load website enquiries.')}</DialogDescription>
          </div>
        ) : (
          <Detail d={q.data} onClose={onClose} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function Detail({ d, onClose }: { d: EnquiryDetail; onClose: () => void }) {
  const t = useT();
  const st = TYPE_STYLE[d.type];
  const m = useEnquiryMutations();
  const canWrite = useCan('enquiries:write');
  return (
    <div>
      <header className={cn('relative overflow-hidden bg-gradient-to-br p-6 pe-12 text-white', st.tile)}>
        <div aria-hidden className="pointer-events-none absolute -end-10 -top-10 size-40 rounded-full bg-white/15 blur-2xl" />
        <div className="relative flex items-start gap-4">
          <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-white/20 text-xl font-bold ring-2 ring-white/40" aria-hidden>
            {initialsOf(d.name, d.email)}
          </span>
          <div className="min-w-0 space-y-1">
            <p className="inline-flex items-center gap-1.5 rounded-full bg-black/20 px-2.5 py-0.5 text-xs font-semibold">
              <st.icon className="size-3.5" aria-hidden />
              {d.form.name ?? t.maybe(ENQUIRY_TYPE_LABELS[d.type])} · {t.maybe(ENQUIRY_CATEGORY_LABELS[d.category])}
            </p>
            <DialogTitle className="truncate text-2xl font-bold">{d.name ?? d.email ?? t('Someone')}</DialogTitle>
            <DialogDescription className="text-sm text-white">
              {[d.designation, d.company].filter(Boolean).join(' · ') || t('Sent from the website')} · {formatDateTime(d.submittedAt)}
            </DialogDescription>
          </div>
        </div>
      </header>

      <div className="space-y-6 p-6">
        <section aria-labelledby="enq-contact" className="grid gap-2 sm:grid-cols-2">
          <h3 id="enq-contact" className="sr-only">
            {t('Contact details')}
          </h3>
          {d.email && <Fact icon={Mail} label={t('Email')} value={<a className="text-primary underline-offset-4 hover:underline" href={`mailto:${d.email}`}>{d.email}</a>} />}
          {d.phone && <Fact icon={Phone} label={t('Phone')} value={<a className="text-primary underline-offset-4 hover:underline" href={`tel:${d.phone.replace(/\s+/g, '')}`}>{d.phone}</a>} />}
          {d.company && <Fact icon={Building2} label={t('Company')} value={d.company} />}
          {d.country && <Fact icon={Globe} label={t('Country')} value={`${flagOf(d.countryCode)} ${d.country}`.trim()} />}
        </section>

        <section aria-labelledby="enq-what" className="space-y-3">
          <h3 id="enq-what" className="text-sm font-semibold">
            {d.record === 'review' ? t('Their review') : d.record === 'contact' ? t('Newsletter sign-up') : t('What they asked')}
          </h3>
          {d.rating !== null && (
            <p className="text-2xl text-yellow-500" aria-label={t('{rating} out of 5', { rating: d.rating })}>
              {'★'.repeat(d.rating)}
              <span className="text-muted-foreground/40">{'★'.repeat(5 - d.rating)}</span>
            </p>
          )}
          {d.message && <blockquote className="whitespace-pre-wrap rounded-xl border-s-4 border-primary bg-muted/60 p-4 text-sm leading-relaxed">{d.message}</blockquote>}
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            {d.service && <Pair label={d.record === 'review' ? t('Services') : t('Service')} value={d.service} />}
            {d.timeline && <Pair label={t('Timeline')} value={d.timeline} />}
            {d.resource && <Pair label={t('Resource')} value={d.resource} />}
            {d.record === 'contact' && <Pair label={t('Subscribed')} value={d.subscribed ? t('Yes') : t('No, unsubscribed')} />}
            {d.record === 'lead' && <Pair label={t('Marketing consent')} value={d.consent ? t('Yes') : t('No')} />}
            {d.fields.map((f) => (
              <Pair key={f.label} label={f.label} value={f.value} />
            ))}
          </dl>
          {d.page && (
            <a href={d.page} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-sm text-primary underline-offset-4 hover:underline">
              <ExternalLink className="size-3.5" aria-hidden />
              {t('Sent from {page}', { page: shortUrl(d.page) })}
            </a>
          )}
          {(d.websiteOwner || d.websiteNote) && (
            <p className="rounded-lg bg-muted p-3 text-xs text-muted-foreground">
              {t('On the website:')} {[d.websiteOwner && t('owner {name}', { name: d.websiteOwner }), d.websiteNote].filter(Boolean).join(' · ')}
            </p>
          )}
        </section>

        {canWrite ? <FollowUp d={d} /> : <p className="text-sm text-muted-foreground">{t('Status: {status}', { status: t.maybe(ENQUIRY_STATUS_LABELS[d.status]) })}</p>}
        <Convert d={d} canWrite={canWrite} />

        <footer className="flex flex-wrap items-center justify-between gap-2 border-t pt-4 text-xs text-muted-foreground">
          <span>
            {d.source === 'webhook' ? t('Arrived instantly by webhook') : t('Brought in by the regular sync')} · {t('Website id {id}', { id: d.externalId })}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => m.unread.mutate(d.id, { onSuccess: onClose })}
            disabled={m.unread.isPending}
          >
            <MailOpen aria-hidden />
            {t('Mark as unread')}
          </Button>
        </footer>
      </div>
    </div>
  );
}

function shortUrl(u: string): string {
  try {
    const x = new URL(u);
    return `${x.hostname.replace(/^www\./, '')}${x.pathname === '/' ? '' : x.pathname}`;
  } catch {
    return u;
  }
}

function Fact({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string }>; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border bg-card p-3">
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
        <Icon className="size-4" aria-hidden />
      </span>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="truncate text-sm font-medium">{value}</p>
      </div>
    </div>
  );
}

function Pair({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="break-words">{value}</dd>
    </div>
  );
}

/** Status, stage, owner and note. A lead's change goes back to the website as well. */
function FollowUp({ d }: { d: EnquiryDetail }) {
  const t = useT();
  const m = useEnquiryMutations();
  const members = useMembers();
  const [stage, setStage] = React.useState(d.stage ?? '');
  const [note, setNote] = React.useState(d.note ?? '');
  const [assigneeId, setAssigneeId] = React.useState(d.assignee?.id ?? '');
  const [said, setSaid] = React.useState<string | null>(null);
  React.useEffect(() => {
    setStage(d.stage ?? '');
    setNote(d.note ?? '');
    setAssigneeId(d.assignee?.id ?? '');
  }, [d.id, d.stage, d.note, d.assignee?.id]);
  const dirty = stage !== (d.stage ?? '') || note !== (d.note ?? '') || assigneeId !== (d.assignee?.id ?? '');
  const setStatus = (status: EnquiryStatus) => m.update.mutate({ id: d.id, body: { status } }, { onSuccess: () => setSaid(null), onError: (e) => setSaid(e.message) });
  const save = () =>
    m.update.mutate(
      { id: d.id, body: { stage: stage.trim() || null, note: note.trim() || null, assigneeId: assigneeId || null } },
      { onSuccess: () => setSaid(t('Saved.')), onError: (e) => setSaid(e.message) },
    );
  return (
    <section aria-labelledby="enq-follow" className="space-y-4 rounded-2xl border bg-card p-4">
      <h3 id="enq-follow" className="text-sm font-semibold">
        {t('Follow-up')}
      </h3>
      <div role="radiogroup" aria-label={t('Status')} className="flex flex-wrap gap-2">
        {ENQUIRY_STATUSES.map((k) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={d.status === k}
            disabled={m.update.isPending}
            onClick={() => d.status !== k && setStatus(k)}
            className={cn(
              'rounded-full px-3 py-1 text-sm font-medium ring-1 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              d.status === k ? cn(STATUS_TONE[k], 'ring-2') : 'text-muted-foreground ring-border hover:bg-muted',
            )}
          >
            {t.maybe(ENQUIRY_STATUS_LABELS[k])}
          </button>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="enq-stage" label={t('Stage')}>
          <Input value={stage} maxLength={80} onChange={(e) => setStage(e.target.value)} placeholder={t('For example, Proposal sent')} />
        </Field>
        <Field id="enq-owner" label={t('Owner')}>
          <Select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
            <option value="">{t('Nobody yet')}</option>
            {(members.data ?? [])
              .filter((p) => p.status === 'ACTIVE')
              .map((p) => (
                <option key={p.userId} value={p.userId}>
                  {p.name}
                </option>
              ))}
          </Select>
        </Field>
      </div>
      <Field id="enq-note" label={t('Note')}>
        <Textarea value={note} maxLength={2000} rows={3} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <WriteBack d={d} />
        <Button onClick={save} disabled={!dirty || m.update.isPending}>
          {t('Save')}
        </Button>
      </div>
      {said && (
        <p role="status" className="text-sm">
          {said}
        </p>
      )}
    </section>
  );
}

function WriteBack({ d }: { d: EnquiryDetail }) {
  const t = useT();
  if (d.record !== 'lead') return <span className="text-xs text-muted-foreground">{t('Kept in SampForce only.')}</span>;
  const w = d.writeBack;
  if (w.state === 'sent')
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-300">
        <CheckCircle2 className="size-4" aria-hidden />
        {t('The website has the latest status')}
        {w.at && ` · ${formatDateTime(w.at)}`}
      </span>
    );
  if (w.state === 'waiting')
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-300">
        <Clock className="size-4" aria-hidden />
        {w.error ? t('Sending to the website again soon: {reason}', { reason: w.error }) : t('Sending to the website…')}
      </span>
    );
  if (w.state === 'failed')
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-critical">
        <CircleAlert className="size-4" aria-hidden />
        {t('The website did not take the change: {reason}', { reason: w.error ?? '' })}
      </span>
    );
  return <span className="text-xs text-muted-foreground">{t('Changes here are sent back to the website.')}</span>;
}

/** Turn it into a company and an employee, reusing ones that already match. */
function Convert({ d, canWrite }: { d: EnquiryDetail; canWrite: boolean }) {
  const t = useT();
  const m = useEnquiryMutations();
  const canCompanies = useCan('companies:write');
  const canContacts = useCan('contacts:write');
  const [companyName, setCompanyName] = React.useState(d.company ?? '');
  const [said, setSaid] = React.useState<string | null>(null);
  React.useEffect(() => setCompanyName(d.company ?? ''), [d.id, d.company]);
  const done = d.converted;
  const needsName = !d.matches.company && !d.matches.contact?.companyId && !d.company;
  return (
    <section aria-labelledby="enq-convert" className="relative space-y-3 overflow-hidden rounded-2xl border border-primary/40 bg-gradient-to-br from-primary/10 via-card to-accent/10 p-4">
      <h3 id="enq-convert" className="flex items-center gap-1.5 text-sm font-semibold">
        <Sparkles className="size-4 text-primary" aria-hidden />
        {done ? t('Converted') : t('Convert into a company and employee')}
      </h3>
      {done ? (
        <div className="flex flex-wrap gap-2">
          {done.company && (
            <Link href={`/app/companies/${done.company.id}`} className="inline-flex items-center gap-1.5 rounded-lg border bg-background px-3 py-2 text-sm font-medium hover:border-primary">
              <Building2 className="size-4" aria-hidden />
              {done.company.name}
              <ArrowUpRight className="size-3.5" aria-hidden />
            </Link>
          )}
          {done.contact && (
            <Link href={`/app/contacts/${done.contact.id}`} className="inline-flex items-center gap-1.5 rounded-lg border bg-background px-3 py-2 text-sm font-medium hover:border-primary">
              <UserRound className="size-4" aria-hidden />
              {done.contact.name}
              <ArrowUpRight className="size-3.5" aria-hidden />
            </Link>
          )}
          {d.convertedAt && <span className="self-center text-xs text-muted-foreground">{formatDateTime(d.convertedAt)}</span>}
        </div>
      ) : (
        <>
          <ul className="space-y-1 text-sm">
            <li className="flex items-center gap-2">
              <Building2 className="size-4 text-muted-foreground" aria-hidden />
              {d.matches.company ? (
                <span>
                  {t('Adds them to {name}, which is already in SampForce.', { name: d.matches.company.name })} <Badge tone="success">{t('Match')}</Badge>
                </span>
              ) : d.company ? (
                <span>{t('Creates the company {name}.', { name: d.company })}</span>
              ) : (
                <span>{t('No company on the enquiry. Type its name below.')}</span>
              )}
            </li>
            <li className="flex items-center gap-2">
              <UserRound className="size-4 text-muted-foreground" aria-hidden />
              {d.matches.contact ? (
                <span>
                  {t('Links {name}, who has the same email.', { name: d.matches.contact.name })} <Badge tone="success">{t('Match')}</Badge>
                </span>
              ) : (
                <span>{t('Creates the employee {name}.', { name: d.name ?? d.email ?? '' })}</span>
              )}
            </li>
          </ul>
          {!d.matches.company && !d.matches.contact?.companyId && (
            <Field id="enq-company" label={t('Company name')}>
              <Input value={companyName} onChange={(e) => setCompanyName(e.target.value)} maxLength={200} required={needsName} />
            </Field>
          )}
          {canWrite && canCompanies && canContacts ? (
            <Button
              onClick={() =>
                m.convert.mutate(
                  { id: d.id, body: companyName.trim() && companyName.trim() !== d.company ? { companyName: companyName.trim() } : {} },
                  {
                    onSuccess: (r) => setSaid(r.created.company || r.created.contact ? t('Converted. New records are in Companies and Employees.') : t('Converted and linked to the existing records.')),
                    onError: (e) => setSaid(e.message),
                  },
                )
              }
              disabled={m.convert.isPending || (needsName && !companyName.trim())}
              className="shadow-glow"
            >
              <Sparkles aria-hidden />
              {m.convert.isPending ? t('Converting…') : t('Convert')}
            </Button>
          ) : (
            <p className="text-xs text-muted-foreground">{t('Converting needs permission to add companies and employees.')}</p>
          )}
        </>
      )}
      {said && (
        <p role="status" className="text-sm">
          {said}
        </p>
      )}
    </section>
  );
}
