'use client';

import { FOLLOW_UP_PRIORITIES, FOLLOW_UP_TYPES, type FollowUpRow, type FollowUpType, followUpInputSchema } from '@dealflow/types';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, cn, Dialog, DialogContent, DialogDescription, DialogTitle, Field, Input, Skeleton } from '@dealflow/ui';
import { CalendarClock, Check, Flag, Plus, Repeat, X } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';
import { InfoTip } from '@/components/info-tip';
import { ApiError } from '@/lib/api';
import { fromLocalInput, toLocalInput, useFollowUpMutations, useFollowUps } from '@/lib/company-work';
import { personLabel } from '@/lib/company-leads';
import { useT } from '@/lib/i18n';
import { fmtLocale } from '@/lib/i18n/locale';
import { useCan } from '@/lib/session';
import { useOptionLookup, useOptions } from '@/lib/crm-admin';
import { useCompanyAction } from './company-actions';
import { CustomFieldInput, CustomFieldValue, fieldDefault, fieldPayloadValue, useFieldDefs } from './custom-field-input';
import { PersonSelect } from './lead-fields';
import { Select, Textarea } from './select';
import { DUE_LABEL, DUE_TONE, FOLLOW_UP_TYPE_LABEL, optionLabel, PRIORITY_LABEL } from './work-labels';

/** The workspace's name for a follow-up category (built-in or added in CRM configuration). */
export function useFollowUpTypeName() {
  const t = useT();
  const lookup = useOptionLookup('FOLLOW_UP_TYPE');
  return (type: string) => optionLabel(lookup(type), type, FOLLOW_UP_TYPE_LABEL, t);
}

/** Custom field values on a follow-up or RFQ, as a short line of "Label: value" pairs. */
export function CustomFieldSummary({ entity, values }: { entity: 'FOLLOW_UP' | 'RFQ'; values: Record<string, unknown> | undefined }) {
  const defs = useFieldDefs(entity);
  const shown = (defs.data ?? []).filter((d) => values && values[d.key] !== undefined && values[d.key] !== null && values[d.key] !== '');
  if (!shown.length) return null;
  return (
    <dl className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
      {shown.map((d) => (
        <div key={d.id} className="flex items-center gap-1">
          <dt className="text-muted-foreground">{d.label}:</dt>
          <dd>
            <CustomFieldValue def={d} value={values![d.key]} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(fmtLocale(), { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** A follow-up with its due state, company, employee and quick complete / reschedule / cancel. */
export function FollowUpItem({ f, showCompany = true }: { f: FollowUpRow; showCompany?: boolean }) {
  const t = useT();
  const canWrite = useCan('activities:write');
  const m = useFollowUpMutations();
  const typeName = useFollowUpTypeName();
  const [mode, setMode] = React.useState<'complete' | 'reschedule' | null>(null);
  const open = f.status === 'OPEN';
  return (
    <li className={cn('rounded-lg border border-border p-3 text-sm', f.due === 'OVERDUE' && 'border-critical/50 bg-critical/5', f.due === 'TODAY' && 'border-warning/50 bg-warning/5')}>
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1 space-y-1">
          <p className="flex flex-wrap items-center gap-2 font-medium">
            <span>{f.title}</span>
            <Badge tone={DUE_TONE[f.due]}>{t(DUE_LABEL[f.due])}</Badge>
            {f.priority === 'HIGH' && (
              <Badge tone="critical">
                <Flag aria-hidden className="size-3" /> {t('High priority')}
              </Badge>
            )}
            {f.rescheduleCount > 0 && (
              <Badge tone="neutral">
                <Repeat aria-hidden className="size-3" /> {t('Rescheduled {count}×', { count: f.rescheduleCount })}
              </Badge>
            )}
          </p>
          <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <CalendarClock aria-hidden className="size-3.5" /> {formatDateTime(f.dueAt)}
            </span>
            <span>{typeName(f.type)}</span>
            {showCompany && f.company && (
              <Link className="inline-flex min-h-6 items-center text-primary hover:underline" href={`/app/companies/${f.company.id}`}>
                {[f.company.leadNumber, f.company.name].filter(Boolean).join(' ')}
              </Link>
            )}
            {f.contact && (
              <Link className="inline-flex min-h-6 items-center text-primary hover:underline" href={`/app/contacts/${f.contact.id}`}>
                {f.contact.name}
              </Link>
            )}
            {f.assignee && <span>{t('Assigned to {name}', { name: personLabel(f.assignee) })}</span>}
          </p>
          {f.summary && <p className="text-xs">{t('Previous discussion: {text}', { text: f.summary })}</p>}
          {f.nextAction && <p className="text-xs">{t('Next action: {text}', { text: f.nextAction })}</p>}
          {f.outcome && <p className="text-xs text-success">{t('Outcome: {text}', { text: f.outcome })}</p>}
          <CustomFieldSummary entity="FOLLOW_UP" values={f.customFields} />
        </div>
        {canWrite && open && (
          <div className="flex flex-wrap gap-1">
            <Button size="sm" variant="outline" onClick={() => setMode('complete')} aria-label={t('Complete “{title}”', { title: f.title })}>
              <Check aria-hidden /> {t('Done')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setMode('reschedule')} aria-label={t('Reschedule “{title}”', { title: f.title })}>
              <Repeat aria-hidden />
            </Button>
            <Button size="sm" variant="ghost" disabled={m.cancel.isPending} onClick={() => window.confirm(t('Cancel the follow-up “{title}”?', { title: f.title })) && m.cancel.mutate(f.id)} aria-label={t('Cancel “{title}”', { title: f.title })}>
              <X aria-hidden />
            </Button>
          </div>
        )}
      </div>
      <FollowUpActionDialog f={f} mode={mode} onClose={() => setMode(null)} />
    </li>
  );
}

function FollowUpActionDialog({ f, mode, onClose }: { f: FollowUpRow; mode: 'complete' | 'reschedule' | null; onClose: () => void }) {
  const t = useT();
  const m = useFollowUpMutations();
  const [text, setText] = React.useState('');
  const [when, setWhen] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (mode) {
      setText('');
      setError(null);
      // A day after the later of its current date and now.
      setWhen(toLocalInput(new Date(Math.max(Date.parse(f.dueAt ?? '') || 0, Date.now()) + 86_400_000)));
    }
  }, [mode, f.dueAt]);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (mode === 'complete') await m.complete.mutateAsync({ id: f.id, outcome: text });
      else {
        const dueAt = fromLocalInput(when);
        if (!dueAt) return setError(t('Choose the new date and time.'));
        await m.reschedule.mutateAsync({ id: f.id, dueAt, reason: text });
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Could not save.'));
    }
  };
  return (
    <Dialog open={!!mode} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md p-6">
        <DialogTitle className="text-lg font-semibold">{mode === 'complete' ? t('Complete follow-up') : t('Reschedule follow-up')}</DialogTitle>
        <DialogDescription className="mb-4 text-sm text-muted-foreground">{f.title}</DialogDescription>
        <form onSubmit={submit} noValidate className="space-y-4">
          {mode === 'reschedule' && (
            <Field id={`fu-when-${f.id}`} label={t('New date and time')} error={error ?? undefined}>
              <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
            </Field>
          )}
          <Field id={`fu-text-${f.id}`} label={mode === 'complete' ? t('Outcome') : t('Reason')}>
            <Textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
          {mode === 'complete' && error && (
            <p role="alert" className="text-sm text-critical">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              {t('Cancel')}
            </Button>
            <Button type="submit" disabled={m.complete.isPending || m.reschedule.isPending}>
              {mode === 'complete' ? t('Mark done') : t('Reschedule')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export interface FollowUpPreset {
  companyId: string;
  companyName: string;
  ownerId?: string | null;
  type?: FollowUpType;
  contactId?: string | null;
  rfqId?: string | null;
}

/** Schedules a follow-up with a company: type, date and time, priority, people and the discussion so far. */
export function FollowUpDialog({ preset, open, onOpenChange, employees }: { preset: FollowUpPreset; open: boolean; onOpenChange: (o: boolean) => void; employees?: { id: string; name: string }[] }) {
  const t = useT();
  const m = useFollowUpMutations();
  const typeName = useFollowUpTypeName();
  const categories = useOptions('FOLLOW_UP_TYPE');
  const typeChoices = categories.data ? categories.data.filter((o) => o.active).map((o) => o.value) : [...FOLLOW_UP_TYPES];
  const fields = useFieldDefs('FOLLOW_UP');
  const formFields = (fields.data ?? []).filter((d) => d.showInForms);
  const [custom, setCustom] = React.useState<Record<string, unknown>>({});
  const blank = React.useCallback(
    () => ({ type: preset.type ?? ('CALL' as FollowUpType), title: '', dueAt: toLocalInput(new Date(Date.now() + 86_400_000)), priority: 'NORMAL' as (typeof FOLLOW_UP_PRIORITIES)[number], contactId: preset.contactId ?? '', assigneeId: preset.ownerId ?? '', managerId: '', summary: '', nextAction: '', remarks: '' }),
    [preset.type, preset.contactId, preset.ownerId],
  );
  const [v, setV] = React.useState(blank);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (open) {
      setV(blank());
      setCustom({});
      setErrors({});
      setFormError(null);
    }
  }, [open, blank]);
  const set = (p: Partial<typeof v>) => setV((x) => ({ ...x, ...p }));
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = {
      companyId: preset.companyId,
      contactId: v.contactId || null,
      type: v.type,
      title: v.title || `${typeName(v.type)}: ${preset.companyName}`,
      dueAt: fromLocalInput(v.dueAt) ?? '',
      priority: v.priority,
      assigneeId: v.assigneeId || null,
      managerId: v.managerId || null,
      summary: v.summary || null,
      nextAction: v.nextAction || null,
      remarks: v.remarks || null,
      rfqId: preset.rfqId ?? null,
      customFields: Object.fromEntries(
        formFields.filter((d) => d.access.edit).map((d) => [d.key, fieldPayloadValue(d, custom[d.key])] as const).filter(([, x]) => x !== ''),
      ),
    };
    const parsed = followUpInputSchema.safeParse(body);
    if (!parsed.success) {
      const out: Record<string, string> = {};
      for (const i of parsed.error.issues) out[String(i.path[0])] ??= i.path[0] === 'dueAt' ? t('Choose the date and time.') : t.maybe(i.message);
      setErrors(out);
      return;
    }
    try {
      await m.create.mutateAsync(parsed.data);
      onOpenChange(false);
    } catch (err) {
      if (err instanceof ApiError && err.details?.length) setErrors(Object.fromEntries(err.details.map((d) => [d.path, d.message])));
      setFormError(err instanceof Error ? err.message : t('Could not save.'));
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-[5%] max-h-[90vh] max-w-2xl overflow-y-auto p-6">
        <DialogTitle className="text-lg font-semibold">{preset.type === 'CALL' ? t('Schedule a call') : t('Add follow-up')}</DialogTitle>
        <DialogDescription className="mb-4 text-sm text-muted-foreground">{t('With {company}. The person it is assigned to is notified.', { company: preset.companyName })}</DialogDescription>
        <form onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
          <Field id="fu-type" label={t('Follow-up type')}>
            <Select value={v.type} onChange={(e) => set({ type: e.target.value as FollowUpType })}>
              {[...new Set([...typeChoices, v.type])].map((k) => (
                <option key={k} value={k}>
                  {typeName(k)}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="fu-due" label={t('Follow-up date and time')} error={errors.dueAt}>
            <Input type="datetime-local" value={v.dueAt} onChange={(e) => set({ dueAt: e.target.value })} />
          </Field>
          <div className="sm:col-span-2">
            <Field id="fu-title" label={t('What is it about?')} error={errors.title} hint={t('Left empty: “{example}”', { example: `${typeName(v.type)}: ${preset.companyName}` })}>
              <Input value={v.title} onChange={(e) => set({ title: e.target.value })} maxLength={200} />
            </Field>
          </div>
          {employees && (
            <Field id="fu-contact" label={t('Employee')}>
              <Select value={v.contactId} onChange={(e) => set({ contactId: e.target.value })}>
                <option value="">{t('Whole company')}</option>
                {employees.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field id="fu-priority" label={t('Priority')}>
            <Select value={v.priority} onChange={(e) => set({ priority: e.target.value as typeof v.priority })}>
              {FOLLOW_UP_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {t(PRIORITY_LABEL[p])}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="fu-assignee" label={t('Assigned executive')} hint={t('Left empty: the lead owner.')}>
            <PersonSelect value={v.assigneeId} onChange={(id) => set({ assigneeId: id })} />
          </Field>
          <Field id="fu-manager" label={t('Assigned manager')} hint={t('Left empty: the executive’s reporting manager.')}>
            <PersonSelect value={v.managerId} onChange={(id) => set({ managerId: id })} />
          </Field>
          <div className="sm:col-span-2">
            <Field id="fu-summary" label={t('Previous discussion summary')}>
              <Textarea rows={2} value={v.summary} onChange={(e) => set({ summary: e.target.value })} />
            </Field>
          </div>
          <Field id="fu-next" label={t('Required next action')}>
            <Input value={v.nextAction} onChange={(e) => set({ nextAction: e.target.value })} maxLength={500} />
          </Field>
          <Field id="fu-remarks" label={t('Remarks')}>
            <Input value={v.remarks} onChange={(e) => set({ remarks: e.target.value })} />
          </Field>
          {formFields.map((d) => (
            <CustomFieldInput
              key={d.id}
              def={d}
              entity="FOLLOW_UP"
              id={`fu-cf-${d.key}`}
              value={custom[d.key] === undefined ? fieldDefault(d) : custom[d.key]}
              onChange={(x) => setCustom((c) => ({ ...c, [d.key]: x }))}
              error={errors[`customFields.${d.key}`]}
            />
          ))}
          {formError && (
            <p role="alert" className="text-sm text-critical sm:col-span-2">
              {formError}
            </p>
          )}
          <div className="flex justify-end gap-2 sm:col-span-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('Cancel')}
            </Button>
            <Button type="submit" disabled={m.create.isPending}>
              {m.create.isPending ? t('Saving…') : t('Save follow-up')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Open follow-ups with this company, most urgent first, and "Add follow-up" / "Schedule call". */
export function CompanyFollowUps({ company, employees }: { company: { id: string; name: string; ownerId: string | null; restricted?: boolean }; employees: { id: string; name: string }[] }) {
  const t = useT();
  const canWrite = useCan('activities:write') && !company.restricted;
  const list = useFollowUps({ companyId: company.id, bucket: 'overdue' });
  const today = useFollowUps({ companyId: company.id, bucket: 'today' });
  const upcoming = useFollowUps({ companyId: company.id, bucket: 'upcoming' });
  const [preset, setPreset] = React.useState<FollowUpType | null>(null);
  useCompanyAction('addFollowUp', canWrite ? () => setPreset('OTHER') : null);
  useCompanyAction('scheduleCall', canWrite ? () => setPreset('CALL') : null);
  const items = [...(list.data ?? []), ...(today.data ?? []), ...(upcoming.data ?? [])];
  const pending = list.isPending || today.isPending || upcoming.isPending;
  return (
    <Card id="company-follow-ups">
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          {t('Follow-ups')} {!pending && <span className="text-muted-foreground">({items.length})</span>}
          <InfoTip topic="crm.followUps" />
        </CardTitle>
        {canWrite && (
          <Button size="sm" variant="outline" onClick={() => setPreset('OTHER')}>
            <Plus aria-hidden /> {t('Add follow-up')}
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {pending ? (
          <Skeleton className="h-16" />
        ) : !items.length ? (
          <p className="text-sm text-muted-foreground">{t('Nothing scheduled with this company.')}</p>
        ) : (
          <ul className="space-y-2" aria-label={t('Follow-ups')}>
            {items.slice(0, 8).map((f) => (
              <FollowUpItem key={f.id} f={f} showCompany={false} />
            ))}
          </ul>
        )}
        {items.length > 8 && (
          <Link className="mt-3 inline-flex min-h-6 items-center text-sm text-primary hover:underline" href="/app/follow-ups">
            {t('See all follow-ups')}
          </Link>
        )}
      </CardContent>
      <FollowUpDialog
        open={!!preset}
        onOpenChange={(o) => !o && setPreset(null)}
        preset={{ companyId: company.id, companyName: company.name, ownerId: company.ownerId, type: preset === 'OTHER' ? undefined : (preset ?? undefined) }}
        employees={employees}
      />
    </Card>
  );
}
