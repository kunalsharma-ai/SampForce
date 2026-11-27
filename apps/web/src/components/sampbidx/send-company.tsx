'use client';

import type { SampbidxCompanyCompletion, SampbidxCompanyPreview, SampbidxCompanySendResult, SampbidxPreviewContact, SampbidxPreviewValue, SampbidxTransferRow } from '@dealflow/types';
import { Button, cn, Dialog, DialogContent, DialogDescription, DialogTitle, Input, Skeleton } from '@dealflow/ui';
import { ArrowLeft, ArrowRight, Building2, Check, CircleCheck, ExternalLink, FileText, Info, Receipt, RotateCw, Send, TriangleAlert, UserRound } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';
import { CountryFlag } from '@/components/crm/status-chip';
import { ContributorBadge, StageChip } from '@/components/crm/stage-chip';
import { CountrySelect, TimeZoneSelect } from '@/components/forms/inputs';
import { countryName } from '@/components/forms/locale-data';
import { formatDate } from '@/lib/crm';
import { useRetrySampbidx, useSampbidxCompanyPreview, useSendCompanyToSampbidx } from '@/lib/employee-stages';
import { type MessageKey, useT } from '@/lib/i18n';
import { useCan } from '@/lib/session';
import { useSampbidxEnabled } from './sampbidx';

/*
 * "Send to SampBidx" on a company (ADR 0080). Three steps: pick the employee who shared the RFQ and the RFQ; review
 * what SampBidx will get, in four sections, completing anything it requires; then the real answer from SampBidx,
 * with its reference, or the reason it failed and a retry. Nothing says "sent" before SampBidx confirms it.
 */

type Step = 'choose' | 'review' | 'result';
type ContactFix = NonNullable<SampbidxCompanyCompletion['contacts']>[string];

const SERVICE_CATEGORY: Record<string, MessageKey> = { QUANTITATIVE: 'Quantitative', QUALITATIVE: 'Qualitative' };

export function SendCompanyToSampbidx({ company, open, onOpenChange, initialContactId }: { company: { id: string; name: string }; open: boolean; onOpenChange: (o: boolean) => void; initialContactId?: string | null }) {
  const t = useT();
  const [step, setStep] = React.useState<Step>('choose');
  const [contactId, setContactId] = React.useState<string | null>(initialContactId ?? null);
  const [rfqId, setRfqId] = React.useState<string | null>(null);
  const [extra, setExtra] = React.useState<string[]>([]);
  const [fixCompany, setFixCompany] = React.useState<NonNullable<SampbidxCompanyCompletion['company']>>({});
  const [fixContacts, setFixContacts] = React.useState<Record<string, ContactFix>>({});
  const [mayReceiveQuotes, setMayReceiveQuotes] = React.useState(true);
  const [note, setNote] = React.useState('');
  const [resend, setResend] = React.useState(false);
  const [result, setResult] = React.useState<SampbidxCompanySendResult | null>(null);
  const preview = useSampbidxCompanyPreview(company.id, { contactId, rfqId, extra }, open);
  const send = useSendCompanyToSampbidx();
  React.useEffect(() => {
    if (!open) return;
    setStep('choose');
    setResult(null);
    setContactId(initialContactId ?? null);
    setRfqId(null);
    setExtra([]);
    setFixCompany({});
    setFixContacts({});
    setNote('');
    setResend(false);
    send.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialContactId]);
  const p = preview.data;
  // The first employee who shares RFQs is the likely sender, never simply the company's primary contact.
  React.useEffect(() => {
    if (open && !contactId && p?.employees.length && p.employees[0]!.contributor !== 'NONE') setContactId(p.employees[0]!.id);
  }, [open, contactId, p?.employees]);

  const contactValue = (c: SampbidxPreviewContact, k: 'email' | 'jobTitle' | 'phone' | 'country' | 'timeZone') => fixContacts[c.id]?.[k] ?? (c[k].value as string | null);
  const localBlockers: string[] = [];
  if (p) {
    if (!p.connected) localBlockers.push(t('SampBidx is not connected. A workspace admin connects it in Integrations.'));
    if (!contactId) localBlockers.push(t('Pick the employee who shared the RFQ.'));
    for (const c of p.contacts) {
      for (const k of ['email', 'country', 'timeZone'] as const) {
        if (!contactValue(c, k)) localBlockers.push(t('{name}: {field} is required by SampBidx.', { name: String(c.name.value ?? ''), field: t(k === 'email' ? 'Email' : k === 'country' ? 'Country' : 'Time zone') }));
      }
    }
    if (p.rfq?.missing.length) localBlockers.push(t('{number} is missing required RFQ details. Fill them in on the RFQ.', { number: p.rfq.number }));
    const chosenRfq = p.rfqs.find((r) => r.id === rfqId);
    if (chosenRfq?.alreadySent && !resend) localBlockers.push(t('{number} is already with SampBidx. Tick “Send a second copy” only if SampBidx should get it again.', { number: chosenRfq.number }));
  }

  const submit = () => {
    if (!contactId) return;
    const completion: SampbidxCompanyCompletion = {
      company: Object.fromEntries(Object.entries(fixCompany).filter(([, v]) => v)),
      contacts: Object.fromEntries(Object.entries(fixContacts).map(([id, v]) => [id, Object.fromEntries(Object.entries(v).filter(([, x]) => x))])),
    };
    send.mutate(
      { companyId: company.id, contactId, extraContactIds: extra.filter((x) => x !== contactId), rfqId, mayReceiveQuotes, completion, note: note.trim() || null, resend },
      {
        onSuccess: (r) => {
          setResult(r);
          setStep('result');
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-[4%] flex max-h-[92vh] max-w-4xl flex-col gap-0 overflow-hidden p-0">
        <div className="relative overflow-hidden border-b border-border px-5 py-4 pe-12">
          <div aria-hidden className="absolute inset-0 bg-gradient-to-r from-teal-500/15 via-sky-500/10 to-violet-500/10" />
          <div className="relative flex items-start gap-3">
            <span aria-hidden className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-teal-500 to-sky-600 text-white shadow-md">
              <Send className="size-5" />
            </span>
            <div className="min-w-0">
              <DialogTitle className="break-words text-lg font-semibold">{t('Send {company} to SampBidx', { company: company.name })}</DialogTitle>
              <DialogDescription className="text-sm text-muted-foreground">{t('The company goes as a SampBidx client with the employees you pick, and the RFQ with the employee who shared it.')}</DialogDescription>
            </div>
          </div>
          <ol className="relative mt-4 flex flex-wrap items-center gap-2 text-xs font-medium" aria-label={t('Steps')}>
            {(
              [
                ['choose', 'Employee and RFQ'],
                ['review', 'Review'],
                ['result', 'Result'],
              ] as [Step, MessageKey][]
            ).map(([s, label], i) => {
              const at = ['choose', 'review', 'result'].indexOf(step);
              const done = i < at;
              return (
                <li key={s} className="flex items-center gap-2" aria-current={step === s ? 'step' : undefined}>
                  <span className={cn('flex size-6 items-center justify-center rounded-full border text-[11px] transition-colors', step === s ? 'border-primary bg-primary text-primary-foreground' : done ? 'border-success bg-success text-white' : 'border-border bg-surface text-muted-foreground')}>
                    {done ? <Check aria-hidden className="size-3.5" /> : i + 1}
                  </span>
                  <span className={cn(step === s ? 'text-foreground' : 'text-muted-foreground')}>{t(label)}</span>
                  {i < 2 && <span aria-hidden className="h-px w-6 bg-border" />}
                </li>
              );
            })}
          </ol>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {preview.isPending && !p ? (
            <Skeleton className="h-64" />
          ) : preview.error && !p ? (
            <p role="alert" className="text-sm text-critical">{preview.error.message}</p>
          ) : !p ? null : step === 'choose' ? (
            <ChooseStep p={p} contactId={contactId} setContactId={(id) => { setContactId(id); setExtra((x) => x.filter((e) => e !== id)); }} rfqId={rfqId} setRfqId={setRfqId} extra={extra} setExtra={setExtra} resend={resend} setResend={setResend} />
          ) : step === 'review' ? (
            <ReviewStep
              p={p}
              fixCompany={fixCompany}
              setFixCompany={setFixCompany}
              fixContacts={fixContacts}
              setFixContact={(id, v) => setFixContacts((m) => ({ ...m, [id]: { ...m[id], ...v } }))}
              contactValue={contactValue}
              blockers={localBlockers}
              mayReceiveQuotes={mayReceiveQuotes}
              setMayReceiveQuotes={setMayReceiveQuotes}
              note={note}
              setNote={setNote}
            />
          ) : result ? (
            <ResultStep result={result} onRetried={(r) => setResult((x) => (x ? { client: x.client.id === r.id ? r : x.client, rfq: x.rfq?.id === r.id ? r : x.rfq } : x))} />
          ) : null}
          {send.error && (
            <p role="alert" className="mt-3 rounded-lg border border-critical/40 bg-critical/5 px-3 py-2 text-sm text-critical">
              {send.error.message}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-muted/30 px-5 py-3">
          {step === 'review' ? (
            <Button variant="ghost" onClick={() => setStep('choose')}>
              <ArrowLeft aria-hidden className="rtl:-scale-x-100" /> {t('Back')}
            </Button>
          ) : (
            <span />
          )}
          {step === 'choose' && (
            <Button disabled={!contactId || !p} onClick={() => setStep('review')}>
              {t('Review what SampBidx gets')} <ArrowRight aria-hidden className="rtl:-scale-x-100" />
            </Button>
          )}
          {step === 'review' && (
            <Button disabled={!!localBlockers.length || send.isPending || preview.isFetching} onClick={submit} className="bg-gradient-to-r from-teal-600 to-sky-600 text-white hover:from-teal-700 hover:to-sky-700">
              <Send aria-hidden /> {send.isPending ? t('Waiting for SampBidx…') : rfqId ? t('Send client and RFQ') : t('Send client')}
            </Button>
          )}
          {step === 'result' && <Button onClick={() => onOpenChange(false)}>{t('Done')}</Button>}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ChooseStep({
  p,
  contactId,
  setContactId,
  rfqId,
  setRfqId,
  extra,
  setExtra,
  resend,
  setResend,
}: {
  p: SampbidxCompanyPreview;
  contactId: string | null;
  setContactId: (id: string) => void;
  rfqId: string | null;
  setRfqId: (id: string | null) => void;
  extra: string[];
  setExtra: React.Dispatch<React.SetStateAction<string[]>>;
  resend: boolean;
  setResend: (v: boolean) => void;
}) {
  const t = useT();
  const [q, setQ] = React.useState('');
  const needle = q.trim().toLowerCase();
  const people = p.employees.filter((e) => !needle || [e.name, e.jobTitle, e.email].some((x) => x?.toLowerCase().includes(needle)));
  const chosen = p.employees.find((e) => e.id === contactId);
  const chosenRfq = p.rfqs.find((r) => r.id === rfqId);
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <section aria-labelledby="who-shared" className="min-w-0 space-y-2">
        <h3 id="who-shared" className="text-sm font-semibold">
          {t('Who shared the RFQ?')}
        </h3>
        <p className="text-xs text-muted-foreground">{t('RFQ contributors come first. The company’s primary contact is never picked for you.')}</p>
        {p.employees.length > 6 && <Input aria-label={t('Search employees')} placeholder={t('Search employees')} className="h-9" value={q} onChange={(e) => setQ(e.target.value)} />}
        {!p.employees.length ? (
          <p className="text-sm text-muted-foreground">{t('Add the employee who shared the RFQ to this company first.')}</p>
        ) : (
          <div role="radiogroup" aria-labelledby="who-shared" className="max-h-80 space-y-1.5 overflow-y-auto pe-1">
            {people.map((e) => {
              const on = e.id === contactId;
              return (
                <div key={e.id}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setContactId(e.id)}
                    className={cn('flex w-full items-start gap-3 rounded-xl border px-3 py-2 text-start transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', on ? 'border-primary bg-primary/[0.07] shadow-sm' : 'border-border bg-surface hover:border-primary/40')}
                  >
                    <span aria-hidden className={cn('mt-1 flex size-4 shrink-0 items-center justify-center rounded-full border-2', on ? 'border-primary' : 'border-muted-foreground/50')}>
                      {on && <span className="size-2 rounded-full bg-primary" />}
                    </span>
                    <span className="min-w-0 flex-1 space-y-1">
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="truncate font-medium" title={e.name}>{e.name}</span>
                        <ContributorBadge status={e.contributor} />
                      </span>
                      <span className="block truncate text-xs text-muted-foreground" title={[e.jobTitle, e.email].filter(Boolean).join(' · ')}>
                        {[e.jobTitle, e.email].filter(Boolean).join(' · ') || '—'}
                      </span>
                      <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        {e.stage && <StageChip stage={{ ...e.stage, key: e.stage.key as never, phase: e.stage.phase as never }} />}
                        <span>{t('{n} RFQs', { n: String(e.rfqCount) })}</span>
                      </span>
                    </span>
                  </button>
                </div>
              );
            })}
          </div>
        )}
        {chosen && p.employees.length > 1 && (
          <details className="rounded-xl border border-border bg-surface px-3 py-2">
            <summary className="cursor-pointer text-sm font-medium">{t('Also send other employees as client contacts ({n})', { n: String(extra.length) })}</summary>
            <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto">
              {p.employees
                .filter((e) => e.id !== contactId)
                .map((e) => (
                  <li key={e.id}>
                    <label className="flex min-h-7 items-center gap-2 text-sm">
                      <input type="checkbox" className="size-4 accent-[hsl(var(--primary))]" checked={extra.includes(e.id)} onChange={(ev) => setExtra((x) => (ev.target.checked ? [...x, e.id] : x.filter((y) => y !== e.id)))} />
                      <span className="truncate">{e.name}</span>
                      {e.jobTitle && <span className="truncate text-xs text-muted-foreground">· {e.jobTitle}</span>}
                    </label>
                  </li>
                ))}
            </ul>
            <p className="mt-1 text-xs text-muted-foreground">{t('Only the employees you tick go to SampBidx. Internal notes and other records never do.')}</p>
          </details>
        )}
      </section>

      <section aria-labelledby="which-rfq" className="min-w-0 space-y-2">
        <h3 id="which-rfq" className="text-sm font-semibold">
          {t('Which RFQ?')}
        </h3>
        <div role="radiogroup" aria-labelledby="which-rfq" className="max-h-96 space-y-1.5 overflow-y-auto pe-1">
          <div>
            <RfqOption on={!rfqId} onClick={() => setRfqId(null)} title={t('Client details only')} sub={t('Create or update the client in SampBidx without an RFQ.')} />
          </div>
          {p.rfqs.map((r) => (
            <div key={r.id}>
              <RfqOption
                on={r.id === rfqId}
                onClick={() => setRfqId(r.id)}
                title={`${r.number} · ${r.projectName}`}
                sub={[formatDate(r.receivedAt), r.contact ? t('from {name}', { name: r.contact.name }) : t('No employee linked')].join(' · ')}
                badge={r.alreadySent ? t('Already in SampBidx') : r.contact?.id === contactId ? t('From this employee') : null}
                badgeTone={r.alreadySent ? 'teal' : 'primary'}
              />
            </div>
          ))}
        </div>
        {!p.rfqs.length && <p className="text-xs text-muted-foreground">{t('This company has no RFQs yet. Record the RFQ first, or send the client details only.')}</p>}
        {chosenRfq?.alreadySent && (
          <label className="flex min-h-7 items-center gap-2 text-sm">
            <input type="checkbox" className="size-4" checked={resend} onChange={(e) => setResend(e.target.checked)} />
            {t('Send a second copy')}
          </label>
        )}
        {chosenRfq && chosen && chosenRfq.contact && chosenRfq.contact.id !== chosen.id && (
          <p className="flex items-start gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900 dark:border-amber-400/40 dark:bg-amber-400/10 dark:text-amber-200">
            <Info aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            {t('This RFQ is linked to {other}. Sending it records {name} as the employee who shared it.', { other: chosenRfq.contact.name, name: chosen.name })}
          </p>
        )}
      </section>

      {p.transfers.length > 0 && (
        <section aria-labelledby="earlier-sends" className="space-y-2 lg:col-span-2">
          <h3 id="earlier-sends" className="text-sm font-semibold">
            {t('Earlier sends')}
          </h3>
          <ul className="divide-y divide-border rounded-xl border border-border">
            {p.transfers.slice(0, 6).map((x) => (
              <TransferLine key={x.id} x={x} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function RfqOption({ on, onClick, title, sub, badge, badgeTone }: { on: boolean; onClick: () => void; title: string; sub: string; badge?: string | null; badgeTone?: 'teal' | 'primary' }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      onClick={onClick}
      className={cn('flex w-full items-start gap-3 rounded-xl border px-3 py-2 text-start transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', on ? 'border-primary bg-primary/[0.07] shadow-sm' : 'border-border bg-surface hover:border-primary/40')}
    >
      <span aria-hidden className={cn('mt-1 flex size-4 shrink-0 items-center justify-center rounded-full border-2', on ? 'border-primary' : 'border-muted-foreground/50')}>
        {on && <span className="size-2 rounded-full bg-primary" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 break-words text-sm font-medium">{title}</span>
          {badge && (
            <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', badgeTone === 'teal' ? 'bg-teal-100 text-teal-900 dark:bg-teal-400/15 dark:text-teal-200' : 'bg-primary/10 text-primary')}>{badge}</span>
          )}
        </span>
        <span className="block truncate text-xs text-muted-foreground" title={sub}>
          {sub}
        </span>
      </span>
    </button>
  );
}

/** A labelled value: shown as read, or as an input when SampBidx needs it and SampForce has none. */
function FieldRow({ label, v, required, children, from, done }: { label: string; v: React.ReactNode; required?: boolean; children?: React.ReactNode; from?: SampbidxPreviewValue['from'] | null; done?: boolean }) {
  const t = useT();
  return (
    <div className={cn('grid min-w-0 gap-1 sm:grid-cols-[9.5rem_minmax(0,1fr)] sm:items-center sm:gap-3', children && required && !done && 'rounded-lg bg-critical/[0.06] p-1.5 ring-1 ring-critical/40')}>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
        {required && <span className="text-critical"> *</span>}
      </dt>
      <dd className="min-w-0 text-sm">
        {children ?? (
          <span className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span className="min-w-0 break-words">{v ?? <span className="text-muted-foreground">{t('Not in SampForce')}</span>}</span>
            {from === 'company' && <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{t('from the company')}</span>}
          </span>
        )}
      </dd>
    </div>
  );
}

function Section({ n, icon: Icon, title, children, tone }: { n: number; icon: typeof Building2; title: string; children: React.ReactNode; tone: string }) {
  return (
    <section className="min-w-0 overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
      <h3 className={cn('flex items-center gap-2 border-b border-border px-4 py-2.5 text-sm font-semibold', tone)}>
        <span className="flex size-6 items-center justify-center rounded-full bg-background/80 text-xs font-bold text-foreground shadow-sm">{n}</span>
        <Icon aria-hidden className="size-4" />
        <span className="text-foreground">{title}</span>
      </h3>
      <div className="space-y-3 p-4">{children}</div>
    </section>
  );
}

function ReviewStep({
  p,
  fixCompany,
  setFixCompany,
  setFixContact,
  contactValue,
  blockers,
  mayReceiveQuotes,
  setMayReceiveQuotes,
  note,
  setNote,
}: {
  p: SampbidxCompanyPreview;
  fixCompany: NonNullable<SampbidxCompanyCompletion['company']>;
  setFixCompany: React.Dispatch<React.SetStateAction<NonNullable<SampbidxCompanyCompletion['company']>>>;
  fixContacts: Record<string, ContactFix>;
  setFixContact: (id: string, v: ContactFix) => void;
  contactValue: (c: SampbidxPreviewContact, k: 'email' | 'jobTitle' | 'phone' | 'country' | 'timeZone') => string | null;
  blockers: string[];
  mayReceiveQuotes: boolean;
  setMayReceiveQuotes: (v: boolean) => void;
  note: string;
  setNote: (v: string) => void;
}) {
  const t = useT();
  const c = p.company;
  const show = (v: SampbidxPreviewValue) => (v.value === null || v.value === '' ? null : String(v.value));
  return (
    <div className="space-y-4">
      {blockers.length > 0 ? (
        <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-400/40 dark:bg-amber-400/10 dark:text-amber-100">
          <p className="flex items-center gap-1.5 font-semibold">
            <TriangleAlert aria-hidden className="size-4" /> {t('Complete these before sending')}
          </p>
          <ul className="mt-1 list-disc space-y-0.5 ps-5">
            {blockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="flex items-center gap-1.5 rounded-xl border border-success/40 bg-success/[0.07] px-4 py-2.5 text-sm font-medium text-success">
          <CircleCheck aria-hidden className="size-4" /> {t('Everything SampBidx requires is filled in.')}
        </p>
      )}
      <p className="text-xs text-muted-foreground">{t('Details you type here are saved to the SampForce records too, so you type them once.')}</p>
      <div className="grid gap-4 lg:grid-cols-2">
        <Section n={1} icon={Building2} title={t('Company information')} tone="bg-sky-500/10">
          <dl className="space-y-2.5">
            <FieldRow label={t('Company name')} v={show(c.name)} required />
            <FieldRow label={t('Website')} v={show(c.website)}>
              {!c.website.value ? <Input aria-label={t('Website')} className="h-8" placeholder="https://" value={fixCompany.website ?? ''} onChange={(e) => setFixCompany((f) => ({ ...f, website: e.target.value }))} /> : undefined}
            </FieldRow>
            <FieldRow label={t('Industry')} v={show(c.industry)}>
              {!c.industry.value ? <Input aria-label={t('Industry')} className="h-8" value={fixCompany.industry ?? ''} onChange={(e) => setFixCompany((f) => ({ ...f, industry: e.target.value }))} /> : undefined}
            </FieldRow>
            <FieldRow
              label={t('Head office')}
              v={
                c.office.country.value || c.office.city.value ? (
                  <span className="inline-flex flex-wrap items-center gap-1.5">
                    {c.office.country.value && <CountryFlag code={String(c.office.country.value)} decorative />}
                    {[c.office.city.value, c.office.country.value ? countryName(String(c.office.country.value), t.formatLocale) : null].filter(Boolean).join(', ')}
                  </span>
                ) : null
              }
            >
              {!c.office.country.value ? <CountrySelect aria-label={t('Head office country')} value={fixCompany.country ?? ''} onChange={(v) => setFixCompany((f) => ({ ...f, country: v || undefined }))} /> : undefined}
            </FieldRow>
            {c.leadNumber && <FieldRow label={t('Company number')} v={<span className="font-mono">{c.leadNumber}</span>} />}
            {p.client?.remoteId && (
              <FieldRow
                label={t('In SampBidx')}
                v={
                  <span className="inline-flex flex-wrap items-center gap-1.5">
                    <span className="font-mono">{p.client.remoteId}</span>
                    <span className="text-xs text-muted-foreground">{t('updated, not created again')}</span>
                  </span>
                }
              />
            )}
          </dl>
        </Section>

        <Section n={2} icon={UserRound} title={t('Client contact information')} tone="bg-violet-500/10">
          {p.contacts.map((pc, i) => (
            <div key={pc.id} className={cn('space-y-2.5', i > 0 && 'border-t border-border pt-3')}>
              <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                <span className="min-w-0 break-words">{String(pc.name.value ?? '')}</span>
                {i === 0 && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">{t('Shared the RFQ')}</span>}
                {pc.remoteId && <span className="font-mono text-[11px] text-muted-foreground">{pc.remoteId}</span>}
              </p>
              <dl className="space-y-2">
                <FieldRow label={t('Email')} v={contactValue(pc, 'email')} required done={!!contactValue(pc, 'email')}>
                  {!pc.email.value ? <Input aria-label={t('Email of {name}', { name: String(pc.name.value ?? '') })} type="email" className="h-8" value={contactValue(pc, 'email') ?? ''} onChange={(e) => setFixContact(pc.id, { email: e.target.value })} /> : undefined}
                </FieldRow>
                <FieldRow label={t('Job title')} v={contactValue(pc, 'jobTitle')}>
                  {!pc.jobTitle.value ? <Input aria-label={t('Job title of {name}', { name: String(pc.name.value ?? '') })} className="h-8" value={contactValue(pc, 'jobTitle') ?? ''} onChange={(e) => setFixContact(pc.id, { jobTitle: e.target.value })} /> : undefined}
                </FieldRow>
                <FieldRow label={t('Phone')} v={contactValue(pc, 'phone')}>
                  {!pc.phone.value ? <Input aria-label={t('Phone of {name}', { name: String(pc.name.value ?? '') })} className="h-8" value={contactValue(pc, 'phone') ?? ''} onChange={(e) => setFixContact(pc.id, { phone: e.target.value })} /> : undefined}
                </FieldRow>
                <FieldRow label={t('Country')} v={pc.country.value ? <span className="inline-flex items-center gap-1.5"><CountryFlag code={String(pc.country.value)} decorative />{countryName(String(pc.country.value), t.formatLocale)}</span> : null} required from={pc.country.from} done={!!contactValue(pc, 'country')}>
                  {!pc.country.value ? <CountrySelect aria-label={t('Country of {name}', { name: String(pc.name.value ?? '') })} value={contactValue(pc, 'country') ?? ''} onChange={(v) => setFixContact(pc.id, { country: v || undefined })} /> : undefined}
                </FieldRow>
                <FieldRow label={t('Time zone')} v={pc.timeZone.value ? String(pc.timeZone.value) : null} required from={pc.timeZone.from} done={!!contactValue(pc, 'timeZone')}>
                  {!pc.timeZone.value ? <TimeZoneSelect aria-label={t('Time zone of {name}', { name: String(pc.name.value ?? '') })} value={contactValue(pc, 'timeZone') ?? ''} onChange={(v) => setFixContact(pc.id, { timeZone: v || undefined })} /> : undefined}
                </FieldRow>
                <FieldRow label={t('Marketing consent')} v={pc.marketingConsent ? t('Given') : t('Not recorded')} />
              </dl>
            </div>
          ))}
          <label className="flex items-start gap-2 rounded-lg border border-border bg-background/60 px-3 py-2 text-sm">
            <input type="checkbox" className="mt-0.5 size-4" checked={mayReceiveQuotes} onChange={(e) => setMayReceiveQuotes(e.target.checked)} />
            <span>
              {t('May receive quotes SampBidx sends in reply to their request')}
              <span className="block text-xs text-muted-foreground">{t('Untick if this person asked not to be emailed.')}</span>
            </span>
          </label>
        </Section>

        <Section n={3} icon={FileText} title={t('RFQ and bid information')} tone="bg-teal-500/10">
          {!p.rfq ? (
            <p className="text-sm text-muted-foreground">{t('No RFQ: only the client details go to SampBidx.')}</p>
          ) : (
            <>
              <dl className="space-y-2.5">
                <FieldRow label={t('Reference')} v={<span className="font-mono">{p.rfq.number}</span>} />
                <FieldRow label={t('Project name')} v={p.rfq.projectName} required />
                <FieldRow label={t('Service category')} v={p.rfq.serviceCategory ? t(SERVICE_CATEGORY[p.rfq.serviceCategory] ?? 'Quantitative') : null} />
                <FieldRow label={t('Service')} v={p.rfq.service ? p.rfq.service.replace('_', ' ') : null} />
                <FieldRow label={t('Methodology')} v={p.rfq.methodology} required />
                <FieldRow label={t('Received')} v={formatDate(p.rfq.receivedAt)} />
                <FieldRow label={t('Submission deadline')} v={p.rfq.deadlineAt ? formatDate(p.rfq.deadlineAt) : null} required />
                {p.rfq.description && <FieldRow label={t('Project description')} v={<span className="line-clamp-4 whitespace-pre-line">{p.rfq.description}</span>} />}
                <FieldRow label={t('Attachments')} v={p.rfq.files.length ? p.rfq.files.map((f) => f.name).join(', ') : null} />
              </dl>
              {p.rfq.missing.length > 0 && (
                <Link href={`/app/rfqs?open=${p.rfq.id}`} className="inline-flex min-h-6 items-center gap-1 text-sm font-medium text-critical hover:underline">
                  <ExternalLink aria-hidden className="size-3.5" /> {t('Open the RFQ to fill in the missing details')}
                </Link>
              )}
            </>
          )}
        </Section>

        <Section n={4} icon={Receipt} title={t('Pricing and commercial information')} tone="bg-amber-500/10">
          {!p.rfq ? (
            <p className="text-sm text-muted-foreground">{t('No RFQ: no pricing goes to SampBidx.')}</p>
          ) : (
            <dl className="space-y-2.5">
              <FieldRow label={t('Currency')} v={p.rfq.currency} />
              <FieldRow label={t('Total quoted to the client')} v={p.rfq.totalQuotation !== null ? `${p.rfq.currency} ${p.rfq.totalQuotation.toLocaleString(t.formatLocale)}` : null} />
            </dl>
          )}
          <div className="rounded-lg border border-dashed border-border bg-background/60 px-3 py-2">
            <p className="text-xs font-semibold">{t('Set by the bid manager in SampBidx')}</p>
            <ul className="mt-1.5 flex flex-wrap gap-1.5">
              {(['Taxes', 'Project minimum fee (PMF)', 'Project setup fee (PSF)', 'Discount', 'Prepayment', 'Bidding validity', 'Terms and conditions'] as MessageKey[]).map((x) => (
                <li key={x} className="rounded-full border border-border bg-surface px-2 py-0.5 text-[11px] text-muted-foreground">
                  {t(x)}
                </li>
              ))}
            </ul>
            <p className="mt-1.5 text-xs text-muted-foreground">{t('SampForce never fills these in: it has no such values from the client.')}</p>
          </div>
        </Section>
      </div>

      {p.rfq && (
        <section aria-labelledby="rfq-rows" className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
          <h3 id="rfq-rows" className="border-b border-border bg-muted/40 px-4 py-2.5 text-sm font-semibold">
            {t('{category} – {service}: one row per country and target group', { category: p.rfq.serviceCategory ? t(SERVICE_CATEGORY[p.rfq.serviceCategory] ?? 'Quantitative') : t('Service'), service: p.rfq.service?.replace('_', ' ') ?? '—' })}
          </h3>
          {p.rfq.lines.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] text-sm">
                <thead className="text-xs text-muted-foreground">
                  <tr className="border-b border-border">
                    <th scope="col" className="px-4 py-2 text-start font-medium">{t('Country')}</th>
                    <th scope="col" className="px-2 py-2 text-start font-medium">{t('Target group')}</th>
                    <th scope="col" className="px-2 py-2 text-end font-medium">{t('Quota')}</th>
                    <th scope="col" className="px-2 py-2 text-end font-medium">{t('LOI (min)')}</th>
                    <th scope="col" className="px-2 py-2 text-end font-medium">{t('IR %')}</th>
                    <th scope="col" className="px-4 py-2 text-end font-medium">{t('CPI ({currency})', { currency: p.rfq.currency })}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {p.rfq.lines.map((l, i) => (
                    <tr key={`${l.country}-${i}`}>
                      <td className="px-4 py-2">
                        <span className="inline-flex items-center gap-1.5">
                          {/^[A-Z]{2}$/.test(l.country) && <CountryFlag code={l.country} decorative />}
                          {/^[A-Z]{2}$/.test(l.country) ? countryName(l.country, t.formatLocale) : l.country}
                        </span>
                      </td>
                      <td className="max-w-[16rem] px-2 py-2">
                        <span className="line-clamp-2 break-words">{l.targetGroup ?? '—'}</span>
                      </td>
                      <td className="px-2 py-2 text-end tabular-nums">{l.quota?.toLocaleString(t.formatLocale) ?? '—'}</td>
                      <td className="px-2 py-2 text-end tabular-nums">{l.loi ?? '—'}</td>
                      <td className="px-2 py-2 text-end tabular-nums">{l.ir ?? '—'}</td>
                      <td className="px-4 py-2 text-end tabular-nums">{l.cpi ?? <span className="text-muted-foreground">{t('to quote')}</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="px-4 py-3 text-sm text-muted-foreground">{t('No country rows: SampBidx gets the RFQ’s market and sample size.')}</p>
          )}
        </section>
      )}

      <label className="block space-y-1 text-sm">
        <span className="font-medium">{t('Note for the bid team (optional)')}</span>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} rows={2} className="w-full rounded-md border border-input bg-surface px-3 py-2 text-sm" />
      </label>
    </div>
  );
}

function ResultStep({ result, onRetried }: { result: SampbidxCompanySendResult; onRetried: (r: SampbidxTransferRow) => void }) {
  const t = useT();
  return (
    <div className="space-y-3" aria-live="polite">
      <ResultCard x={result.client} label={t('Client')} onRetried={onRetried} />
      {result.rfq ? (
        <ResultCard x={result.rfq} label={t('RFQ')} onRetried={onRetried} />
      ) : result.client.delivery !== 'SENT' && result.client.rfq ? (
        <p className="rounded-xl border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">{t('The RFQ waits until SampBidx has the client. Send again once the client is through.')}</p>
      ) : null}
      <p className="text-xs text-muted-foreground">{t('Sending to SampBidx does not mark the RFQ as won or accepted. Its status stays as it is.')}</p>
    </div>
  );
}

function ResultCard({ x, label, onRetried }: { x: SampbidxTransferRow; label: string; onRetried: (r: SampbidxTransferRow) => void }) {
  const t = useT();
  const retry = useRetrySampbidx();
  const ok = x.delivery === 'SENT';
  return (
    <div className={cn('flex items-start gap-3 rounded-xl border px-4 py-3 duration-500 animate-in fade-in slide-in-from-bottom-2', ok ? 'border-success/40 bg-success/[0.07]' : 'border-critical/40 bg-critical/[0.06]')} data-result={x.kind}>
      <span aria-hidden className={cn('flex size-9 shrink-0 items-center justify-center rounded-full text-white shadow-sm', ok ? 'bg-success duration-500 animate-in zoom-in-50' : 'bg-critical')}>
        {ok ? <Check className="size-5" /> : <TriangleAlert className="size-5" />}
      </span>
      <div className="min-w-0 flex-1 space-y-1">
        <p className="font-semibold">
          {label}: {ok ? (x.kind === 'CLIENT' ? t('SampBidx created or updated the client') : t('SampBidx accepted the RFQ')) : t('SampBidx did not accept it')}
        </p>
        <p className="break-words text-sm text-muted-foreground">{x.title}</p>
        {ok && x.remoteId && (
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <span>{t('SampBidx reference')}</span>
            <span className="rounded-md bg-background px-1.5 py-0.5 font-mono text-xs font-semibold">{x.remoteId}</span>
            {x.remoteUrl && (
              <a href={x.remoteUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-6 items-center gap-1 text-primary hover:underline">
                {t('Open in SampBidx')} <ExternalLink aria-hidden className="size-3.5" />
              </a>
            )}
          </p>
        )}
        {!ok && x.lastError && <p className="break-words text-sm text-critical">{x.lastError}</p>}
        {!ok && (
          <Button size="sm" variant="outline" disabled={retry.isPending} onClick={() => retry.mutate(x.id, { onSuccess: onRetried })}>
            <RotateCw aria-hidden className={cn(retry.isPending && 'animate-spin')} /> {retry.isPending ? t('Trying again…') : t('Try again')}
          </Button>
        )}
        {retry.error && <p role="alert" className="text-sm text-critical">{retry.error.message}</p>}
      </div>
    </div>
  );
}

function TransferLine({ x }: { x: SampbidxTransferRow }) {
  const ok = x.delivery === 'SENT';
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
      <span className="flex min-w-0 items-center gap-2">
        {ok ? <CircleCheck aria-hidden className="size-4 shrink-0 text-success" /> : <TriangleAlert aria-hidden className="size-4 shrink-0 text-critical" />}
        <span className="min-w-0 truncate" title={x.title}>{x.title}</span>
      </span>
      <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
        {x.remoteId && <span className="font-mono">{x.remoteId}</span>}
        <span>{formatDate(x.sentAt ?? x.createdAt)}</span>
        {x.sentBy && <span className="hidden sm:inline">· {x.sentBy}</span>}
      </span>
    </li>
  );
}

/** The "Send to SampBidx" button on the company profile; hidden when the plan has no SampBidx or the person cannot edit. */
export function SendCompanyButton({ company }: { company: { id: string; name: string } }) {
  const t = useT();
  const enabled = useSampbidxEnabled();
  const canSend = useCan('companies:write');
  const [open, setOpen] = React.useState(false);
  if (!enabled || !canSend) return null;
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Send className="size-4" aria-hidden /> {t('Send to SampBidx')}
      </Button>
      <SendCompanyToSampbidx company={company} open={open} onOpenChange={setOpen} />
    </>
  );
}
