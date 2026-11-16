'use client';

import { PORTAL_DOCUMENT_MAX_BYTES, PORTAL_DOCUMENT_TYPES, RFQ_STATUSES, type RfqRow, type RfqStatus, rfqInputSchema } from '@dealflow/types';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Dialog, DialogContent, DialogDescription, DialogTitle, Field, Input, Skeleton } from '@dealflow/ui';
import { useQueryClient } from '@tanstack/react-query';
import { CalendarClock, FileText, Handshake, Pencil, Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';
import { formatBytes, UploadZone } from '@/components/forms/upload-zone';
import { InfoTip } from '@/components/info-tip';
import { personLabel, uploadCompanyFile } from '@/lib/company-leads';
import { formatMoneyList, fromLocalInput, toLocalInput, useRfq, useRfqMutations, useRfqs } from '@/lib/company-work';
import { SendRfqToSampbidx } from '@/components/sampbidx/sampbidx';
import { formatDate } from '@/lib/crm';
import { useHasFeature } from '@/lib/features';
import { useT } from '@/lib/i18n';
import { useCan } from '@/lib/session';
import { useCompanyAction } from './company-actions';
import { CountrySelect, CurrencySelect } from '@/components/forms/inputs';
import { PersonSelect } from './lead-fields';
import { Select, Textarea } from './select';
import { RFQ_STATUS_LABEL, RFQ_STATUS_TONE } from './work-labels';

export function RfqStatusBadge({ status }: { status: RfqStatus }) {
  const t = useT();
  return <Badge tone={RFQ_STATUS_TONE[status]}>{t(RFQ_STATUS_LABEL[status])}</Badge>;
}

const money = (amount: number | null, currency: string) => (amount == null ? '—' : formatMoneyList([{ currency, amount }]));

/** One RFQ as a card: number, project, status, pricing (LOI, IR, CPI, sample) and deadline. */
export function RfqItem({ r, showCompany = true, onEdit }: { r: RfqRow; showCompany?: boolean; onEdit?: (r: RfqRow) => void }) {
  const t = useT();
  const due = r.deadlineAt && !['WON', 'LOST', 'CANCELLED'].includes(r.status) ? new Date(r.deadlineAt).getTime() - Date.now() : null;
  return (
    <li className="rounded-lg border border-border p-3 text-sm">
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1 space-y-1">
          <p className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-muted-foreground">{r.number}</span>
            <span className="font-medium">{r.projectName}</span>
            <RfqStatusBadge status={r.status} />
            {due != null && due < 0 && <Badge tone="critical">{t('Deadline passed')}</Badge>}
            {due != null && due >= 0 && due < 2 * 86_400_000 && <Badge tone="warning">{t('Deadline soon')}</Badge>}
          </p>
          <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            {showCompany && (
              <Link className="inline-flex min-h-6 items-center text-primary hover:underline" href={`/app/companies/${r.company.id}`}>
                {[r.company.leadNumber, r.company.name].filter(Boolean).join(' ')}
              </Link>
            )}
            {r.contact && <span>{r.contact.name}</span>}
            {r.methodology && <span>{r.methodology}</span>}
            {r.market && <span>{r.market}</span>}
            {r.owner && <span>{t('Owner: {name}', { name: personLabel(r.owner) })}</span>}
          </p>
          <dl className="grid grid-cols-3 gap-2 pt-1 sm:grid-cols-6">
            {(
              [
                ['Sample', r.sampleSize?.toLocaleString() ?? '—'],
                ['LOI', r.loi != null ? t('{n} min', { n: r.loi }) : '—'],
                ['IR', r.ir != null ? `${r.ir}%` : '—'],
                ['CPI', money(r.cpi, r.currency)],
                ['Quotation', money(r.totalQuotation, r.currency)],
                ['Deadline', r.deadlineAt ? formatDate(r.deadlineAt) : '—'],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="rounded-md bg-muted/60 px-2 py-1">
                <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{t(label)}</dt>
                <dd className="font-medium tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
          {r.deal && (
            <p className="text-xs">
              <Handshake aria-hidden className="me-1 inline size-3.5" />
              <Link className="text-primary hover:underline" href={`/app/deals/${r.deal.id}`}>
                {r.deal.name}
              </Link>
            </p>
          )}
          {r.outcomeReason && <p className="text-xs text-muted-foreground">{t('Won / lost reason: {text}', { text: r.outcomeReason })}</p>}
        </div>
        {onEdit && (
          <Button size="sm" variant="outline" onClick={() => onEdit(r)} aria-label={t('Open {number}', { number: r.number })}>
            <Pencil aria-hidden /> {t('Open')}
          </Button>
        )}
      </div>
    </li>
  );
}

interface RfqForm {
  contactId: string;
  projectName: string;
  description: string;
  methodology: string;
  market: string;
  industry: string;
  targetAudience: string;
  sampleSize: string;
  loi: string;
  ir: string;
  cpi: string;
  totalQuotation: string;
  currency: string;
  receivedAt: string;
  submittedAt: string;
  deadlineAt: string;
  status: RfqStatus;
  ownerId: string;
  managerId: string;
  expectedRevenue: string;
  actualRevenue: string;
  outcomeReason: string;
}

const num = (v: number | null | undefined) => (v == null ? '' : String(v));
function formOf(r: RfqRow | null, defaults: { ownerId?: string | null; currency?: string }): RfqForm {
  return {
    contactId: r?.contact?.id ?? '',
    projectName: r?.projectName ?? '',
    description: r?.description ?? '',
    methodology: r?.methodology ?? '',
    market: r?.market ?? '',
    industry: r?.industry ?? '',
    targetAudience: r?.targetAudience ?? '',
    sampleSize: num(r?.sampleSize),
    loi: num(r?.loi),
    ir: num(r?.ir),
    cpi: num(r?.cpi),
    totalQuotation: num(r?.totalQuotation),
    currency: r?.currency ?? defaults.currency ?? 'USD',
    receivedAt: toLocalInput(r?.receivedAt ?? new Date()),
    submittedAt: toLocalInput(r?.submittedAt),
    deadlineAt: toLocalInput(r?.deadlineAt),
    status: r?.status ?? 'RECEIVED',
    ownerId: r?.owner?.id ?? defaults.ownerId ?? '',
    managerId: r?.manager?.id ?? '',
    expectedRevenue: num(r?.expectedRevenue),
    actualRevenue: num(r?.actualRevenue),
    outcomeReason: r?.outcomeReason ?? '',
  };
}

/** Records or edits an RFQ: project, research specification, pricing, dates, status, people and outcome. */
export function RfqDialog({
  company,
  rfq,
  open,
  onOpenChange,
  employees,
}: {
  company: { id: string; name: string; ownerId?: string | null };
  rfq: RfqRow | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  employees?: { id: string; name: string }[];
}) {
  const t = useT();
  const qc = useQueryClient();
  const m = useRfqMutations();
  const canDeal = useCan('deals:write');
  // "Save and add attachments" keeps the dialog open on the new RFQ, so files and SampBidx come next.
  const [saved, setSaved] = React.useState<RfqRow | null>(null);
  const live = useRfq(open ? (rfq?.id ?? saved?.id ?? null) : null);
  const current = live.data ?? rfq ?? saved;
  const [v, setV] = React.useState<RfqForm>(() => formOf(rfq, { ownerId: company.ownerId }));
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [uploading, setUploading] = React.useState(false);
  React.useEffect(() => {
    if (open) {
      setV(formOf(rfq, { ownerId: company.ownerId }));
      setSaved(null);
      setErrors({});
      setFormError(null);
    }
  }, [open, rfq, company.ownerId]);
  // The form is "dirty" while it differs from the RFQ as saved; SampBidx gets only what is saved.
  const savedForm = React.useMemo(() => (current ? JSON.stringify(formOf(current, { ownerId: company.ownerId })) : null), [current, company.ownerId]);
  const dirty = !!savedForm && JSON.stringify(v) !== savedForm;
  const set = (p: Partial<RfqForm>) => setV((x) => ({ ...x, ...p }));
  const computed = v.sampleSize && v.cpi ? Math.round(Number(v.sampleSize) * Number(v.cpi) * 100) / 100 : null;
  const submit = async (e: React.FormEvent, stay = false) => {
    e.preventDefault();
    const body = {
      companyId: company.id,
      contactId: v.contactId || null,
      projectName: v.projectName,
      description: v.description || null,
      methodology: v.methodology || null,
      market: v.market || null,
      industry: v.industry || null,
      targetAudience: v.targetAudience || null,
      sampleSize: v.sampleSize,
      loi: v.loi,
      ir: v.ir,
      cpi: v.cpi,
      totalQuotation: v.totalQuotation,
      currency: v.currency,
      receivedAt: fromLocalInput(v.receivedAt) ?? undefined,
      submittedAt: fromLocalInput(v.submittedAt),
      deadlineAt: fromLocalInput(v.deadlineAt),
      status: v.status,
      ownerId: v.ownerId || null,
      managerId: v.managerId || null,
      expectedRevenue: v.expectedRevenue,
      actualRevenue: v.actualRevenue,
      outcomeReason: v.outcomeReason || null,
    };
    const parsed = rfqInputSchema.safeParse(body);
    if (!parsed.success) {
      const out: Record<string, string> = {};
      for (const i of parsed.error.issues) out[String(i.path[0])] ??= t.maybe(i.message);
      setErrors(out);
      requestAnimationFrame(() => (document.querySelector('[role="dialog"] [aria-invalid="true"]') as HTMLElement | null)?.focus());
      return;
    }
    const { companyId: _c, ...update } = parsed.data;
    // Unchanged fields of an existing RFQ are sent as they are; a cleared total becomes the computed one again.
    try {
      const row = await m.save.mutateAsync({ id: current?.id ?? null, input: current ? update : parsed.data });
      if (stay) {
        setSaved(row);
        setV(formOf(row, { ownerId: company.ownerId }));
        requestAnimationFrame(() => document.getElementById('rfq-attachments')?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
      } else onOpenChange(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : t('Could not save.'));
    }
  };
  const upload = async (file: File) => {
    if (!current) return;
    setUploading(true);
    try {
      await uploadCompanyFile(company.id, file, current.id);
      await Promise.all([qc.invalidateQueries({ queryKey: ['rfqs'] }), qc.invalidateQueries({ queryKey: ['company-files', company.id] }), qc.invalidateQueries({ queryKey: ['sampbidx'] })]);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : t('Could not upload.'));
    } finally {
      setUploading(false);
    }
  };
  const text = (key: keyof RfqForm, label: Parameters<typeof t>[0], props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <Field id={`rfq-${key}`} label={t(label)} error={errors[key]}>
      <Input value={v[key]} onChange={(e) => set({ [key]: e.target.value } as Partial<RfqForm>)} {...props} />
    </Field>
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-[3%] max-h-[94vh] max-w-3xl overflow-y-auto p-6">
        <DialogTitle className="text-lg font-semibold">{current ? t('{number}: {project}', { number: current.number, project: current.projectName }) : t('Add RFQ')}</DialogTitle>
        <DialogDescription className="mb-4 text-sm text-muted-foreground">
          {current ? t('From {company}. Received {date}.', { company: company.name, date: formatDate(current.receivedAt) }) : t('From {company}. It gets the next RFQ number and is logged as an interaction.', { company: company.name })}
        </DialogDescription>
        <form onSubmit={submit} noValidate className="space-y-5">
          <fieldset className="grid gap-4 sm:grid-cols-2">
            <legend className="mb-2 text-sm font-semibold">{t('Project')}</legend>
            <div className="sm:col-span-2">{text('projectName', 'Project name *', { maxLength: 200 })}</div>
            {employees && (
              <Field id="rfq-contactId" label={t('POC / employee')} error={errors.contactId}>
                <Select value={v.contactId} onChange={(e) => set({ contactId: e.target.value })}>
                  <option value="">{t('None')}</option>
                  {employees.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <Field id="rfq-status" label={t('Project status')}>
              <Select value={v.status} onChange={(e) => set({ status: e.target.value as RfqStatus })}>
                {RFQ_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {t(RFQ_STATUS_LABEL[s])}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="sm:col-span-2">
              <Field id="rfq-description" label={t('Project description')}>
                <Textarea rows={3} value={v.description} onChange={(e) => set({ description: e.target.value })} />
              </Field>
            </div>
          </fieldset>
          <fieldset className="grid gap-4 sm:grid-cols-3">
            <legend className="mb-2 text-sm font-semibold">{t('Research specification')}</legend>
            {text('methodology', 'Research methodology', { placeholder: t('e.g. Online survey') })}
            <Field id="rfq-market" label={t('Country / market')}>
              <CountrySelect value={v.market} onChange={(code) => set({ market: code })} />
            </Field>
            {text('industry', 'Industry')}
            <div className="sm:col-span-3">{text('targetAudience', 'Target audience')}</div>
            {text('sampleSize', 'Sample size', { inputMode: 'numeric' })}
            {text('loi', 'LOI (minutes)', { inputMode: 'decimal' })}
            {text('ir', 'IR (%)', { inputMode: 'decimal' })}
          </fieldset>
          <fieldset className="grid gap-4 sm:grid-cols-3">
            <legend className="mb-2 text-sm font-semibold">{t('Pricing')}</legend>
            {text('cpi', 'CPI', { inputMode: 'decimal' })}
            <Field id="rfq-currency" label={t('Currency')} error={errors.currency}>
              <CurrencySelect value={v.currency} onChange={(code) => set({ currency: code })} />
            </Field>
            <Field id="rfq-totalQuotation" label={t('Total quotation')} error={errors.totalQuotation} hint={computed != null ? t('Left empty: sample × CPI = {value}', { value: money(computed, v.currency.toUpperCase() || 'USD') }) : undefined}>
              <Input value={v.totalQuotation} inputMode="decimal" onChange={(e) => set({ totalQuotation: e.target.value })} />
            </Field>
            {text('expectedRevenue', 'Expected revenue', { inputMode: 'decimal' })}
            {text('actualRevenue', 'Actual revenue', { inputMode: 'decimal' })}
          </fieldset>
          <fieldset className="grid gap-4 sm:grid-cols-3">
            <legend className="mb-2 text-sm font-semibold">{t('Dates')}</legend>
            {text('receivedAt', 'RFQ received date', { type: 'datetime-local' })}
            {text('deadlineAt', 'Submission deadline', { type: 'datetime-local' })}
            {text('submittedAt', 'Quotation submission date', { type: 'datetime-local' })}
          </fieldset>
          <fieldset className="grid gap-4 sm:grid-cols-2">
            <legend className="mb-2 text-sm font-semibold">{t('People and outcome')}</legend>
            <Field id="rfq-owner" label={t('Deal owner')} hint={t('Left empty: the lead owner.')}>
              <PersonSelect value={v.ownerId} onChange={(id) => set({ ownerId: id })} />
            </Field>
            <Field id="rfq-manager" label={t('Manager')} hint={t('Left empty: the lead’s assigned manager.')}>
              <PersonSelect value={v.managerId} onChange={(id) => set({ managerId: id })} />
            </Field>
            <div className="sm:col-span-2">{text('outcomeReason', 'Won / lost reason')}</div>
          </fieldset>
          {current && (
            <div id="rfq-attachments" className="scroll-mt-4 space-y-2">
              <h3 className="text-sm font-semibold">{t('Attachments')}</h3>
              {current.files.length > 0 && (
                <ul className="space-y-1 text-sm">
                  {current.files.map((f) => (
                    <li key={f.id} className="flex items-center gap-2">
                      <FileText aria-hidden className="size-4 text-muted-foreground" />
                      <a className="inline-flex min-h-6 items-center text-primary hover:underline" href={`/api/v1/company-files/${f.id}/download`}>
                        {f.name}
                      </a>
                      <span className="text-xs text-muted-foreground">{formatBytes(f.sizeBytes)}</span>
                    </li>
                  ))}
                </ul>
              )}
              <UploadZone label={t('Add a file to this RFQ')} accept={[...PORTAL_DOCUMENT_TYPES]} maxBytes={PORTAL_DOCUMENT_MAX_BYTES} busy={uploading} onFile={(f) => void upload(f)} />
            </div>
          )}
          {current && <SendRfqToSampbidx rfq={current} dirty={dirty} />}
          {formError && (
            <p role="alert" className="text-sm text-critical">
              {formError}
            </p>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            {current && (
              <Button
                type="button"
                variant="ghost"
                className="me-auto text-critical"
                disabled={m.remove.isPending}
                onClick={async () => {
                  if (!window.confirm(t('Delete {number}?', { number: current.number }))) return;
                  await m.remove.mutateAsync(current.id);
                  onOpenChange(false);
                }}
              >
                <Trash2 aria-hidden /> {t('Delete')}
              </Button>
            )}
            {current && canDeal && !current.deal && !['LOST', 'CANCELLED'].includes(current.status) && (
              <Button
                type="button"
                variant="outline"
                disabled={m.convert.isPending}
                onClick={async () => {
                  try {
                    await m.convert.mutateAsync(current.id);
                    onOpenChange(false);
                  } catch (err) {
                    setFormError(err instanceof Error ? err.message : t('Could not save.'));
                  }
                }}
              >
                <Handshake aria-hidden /> {t('Convert to deal')}
              </Button>
            )}
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('Cancel')}
            </Button>
            {!current && (
              <Button type="button" variant="outline" disabled={m.save.isPending} onClick={(e) => void submit(e, true)}>
                {t('Save and add attachments')}
              </Button>
            )}
            <Button type="submit" disabled={m.save.isPending}>
              {m.save.isPending ? t('Saving…') : t('Save RFQ')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** The company's RFQs, newest first, with "Add RFQ". Hidden when the plan does not include RFQs. */
export function CompanyRfqs({ company, employees }: { company: { id: string; name: string; ownerId: string | null; restricted?: boolean }; employees: { id: string; name: string }[] }) {
  const t = useT();
  const enabled = useHasFeature('rfqs');
  const canWrite = useCan('companies:write') && !company.restricted;
  const list = useRfqs({ companyId: company.id }, enabled);
  const [editing, setEditing] = React.useState<RfqRow | null>(null);
  const [open, setOpen] = React.useState(false);
  const start = (r: RfqRow | null) => {
    setEditing(r);
    setOpen(true);
  };
  useCompanyAction('addRfq', enabled && canWrite ? () => start(null) : null);
  if (!enabled) return null;
  return (
    <Card id="company-rfqs">
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          {t('RFQs')} {list.data && <span className="text-muted-foreground">({list.data.total})</span>}
          <InfoTip topic="crm.rfqs" />
        </CardTitle>
        {canWrite && (
          <Button size="sm" variant="outline" onClick={() => start(null)}>
            <Plus aria-hidden /> {t('Add RFQ')}
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {list.isPending ? (
          <Skeleton className="h-20" />
        ) : !list.data?.items.length ? (
          <p className="text-sm text-muted-foreground">{t('No RFQs from this company yet.')}</p>
        ) : (
          <ul className="space-y-2" aria-label={t('RFQs')}>
            {list.data.items.map((r) => (
              <RfqItem key={r.id} r={r} showCompany={false} onEdit={canWrite ? start : undefined} />
            ))}
          </ul>
        )}
        {list.data && list.data.items.some((r) => r.deadlineAt) && (
          <p className="mt-3 inline-flex items-center gap-1 text-xs text-muted-foreground">
            <CalendarClock aria-hidden className="size-3.5" /> {t('RFQs with a deadline in the next two days are marked.')}
          </p>
        )}
      </CardContent>
      <RfqDialog company={company} rfq={editing} open={open} onOpenChange={setOpen} employees={employees} />
    </Card>
  );
}
