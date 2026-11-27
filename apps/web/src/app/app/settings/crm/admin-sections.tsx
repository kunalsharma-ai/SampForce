'use client';

import {
  ATTRIBUTION_MODELS,
  type AttributionModel,
  type AttributionRule,
  attributionRuleSchema,
  CUSTOM_OPTION_VALUE,
  type DashboardPolicy,
  type DashboardPolicyWidget,
  DESIGNATION_TIERS,
  type DesignationTier,
  dashboardWidgetCatalog,
  EXPORT_ENTITY_KEYS,
  EXPORT_FORMATS,
  type ExportEntityKey,
  type ExportFormat,
  type ExportPolicyRow,
  type ExportRolePolicy,
  NOTIFICATION_CATEGORIES,
  type NotificationSettings,
  type OptionListKind,
  type OptionRow,
  optionInputSchema,
} from '@dealflow/types';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Field, Input, Skeleton } from '@dealflow/ui';
import { ArrowDown, ArrowUp, Eye, EyeOff, Pencil, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { Select } from '@/components/crm/select';
import { StatusChip } from '@/components/crm/status-chip';
import { CurrencySelect } from '@/components/forms/inputs';
import { InfoTip } from '@/components/info-tip';
import { SECTION_LABEL } from '@/components/command-center/cc-labels';
import { ApiError } from '@/lib/api';
import { useAttributionRule, useCurrencySettings, useDashboardPolicies, useExportPolicy, useNotificationSettings, useOptionMutations, useOptions } from '@/lib/crm-admin';
import { useHasFeature, useCanDelete } from '@/lib/features';
import { type MessageKey, useT } from '@/lib/i18n';
import { TIER_LABELS } from './crm-configuration';

const errorText = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : null);
const today = () => new Date().toISOString().slice(0, 10);

function Saved({ text }: { text: string | null }) {
  return (
    <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
      {text}
    </p>
  );
}

function Failure({ error }: { error: unknown }) {
  return error ? (
    <p role="alert" className="text-sm text-critical">
      {errorText(error)}
    </p>
  ) : null;
}

// ───────────── RFQ statuses, deal statuses and follow-up categories ─────────────

export const OPTION_TITLE = { RFQ_STATUS: 'RFQ statuses', DEAL_STATUS: 'Deal statuses', FOLLOW_UP_TYPE: 'Follow-up categories' } as const satisfies Record<OptionListKind, MessageKey>;

export function OptionsSection({ kind, canManage }: { kind: OptionListKind; canManage: boolean }) {
  const mayDelete = useCanDelete('crm_configuration');
  const t = useT();
  const list = useOptions(kind);
  const m = useOptionMutations(kind);
  const [editing, setEditing] = useState<OptionRow | null>(null);
  const rows = list.data ?? [];
  const move = (i: number, by: -1 | 1) => {
    const values = rows.map((r) => r.value);
    [values[i], values[i + by]] = [values[i + by]!, values[i]!];
    m.reorder.mutate(values);
  };
  const failure = m.update.error ?? m.reorder.error ?? m.remove.error;
  const title = t(OPTION_TITLE[kind]);
  return (
    <div className="space-y-4">
      {canManage && (kind === 'FOLLOW_UP_TYPE' || editing) && <OptionForm key={editing?.value ?? `new-${kind}`} kind={kind} editing={editing} onDone={() => setEditing(null)} />}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            {title}
            <InfoTip topic="crm.options" />
          </CardTitle>
        </CardHeader>
        <CardContent>
          {list.isPending ? (
            <Skeleton className="h-56" />
          ) : list.error ? (
            <p role="alert" className="text-sm text-critical">
              {list.error.message}
            </p>
          ) : (
            <ol className="divide-y divide-border" aria-label={title}>
              {rows.map((row, i) => (
                <li key={row.value} className={`flex flex-wrap items-center gap-3 py-2.5 text-sm ${row.active ? '' : 'opacity-60'}`}>
                  <span className="w-6 text-end text-xs tabular-nums text-muted-foreground">{i + 1}</span>
                  <StatusChip status={{ name: t.maybe(row.label), color: row.color }} />
                  <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    {!row.builtIn && <Badge>{t('Added by you')}</Badge>}
                    {!row.active && <Badge>{t('Hidden')}</Badge>}
                    <span>· {t.plural('count.records', row.used)}</span>
                    {row.description && <span className="basis-full">{row.description}</span>}
                  </span>
                  {canManage && (
                    <span className="flex gap-0.5">
                      <Button variant="ghost" size="icon" aria-label={t('Move {name} up', { name: t.maybe(row.label) })} disabled={i === 0 || m.reorder.isPending} onClick={() => move(i, -1)}>
                        <ArrowUp aria-hidden />
                      </Button>
                      <Button variant="ghost" size="icon" aria-label={t('Move {name} down', { name: t.maybe(row.label) })} disabled={i === rows.length - 1 || m.reorder.isPending} onClick={() => move(i, 1)}>
                        <ArrowDown aria-hidden />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={row.active ? t('Hide {name}', { name: t.maybe(row.label) }) : t('Show {name}', { name: t.maybe(row.label) })}
                        disabled={m.update.isPending}
                        onClick={() => m.update.mutate({ value: row.value, input: { active: !row.active } })}
                      >
                        {row.active ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
                      </Button>
                      <Button variant="ghost" size="icon" aria-label={t('Edit {name}', { name: t.maybe(row.label) })} onClick={() => setEditing(row)}>
                        <Pencil aria-hidden />
                      </Button>
                      {CUSTOM_OPTION_VALUE.test(row.value) && mayDelete && (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={t('Delete {name}', { name: row.label })}
                          disabled={m.remove.isPending || row.used > 0}
                          title={row.used > 0 ? t('Records use this option. Switch it off instead; they keep it.') : undefined}
                          onClick={() => window.confirm(t('Delete {name}?', { name: row.label })) && m.remove.mutate(row.value)}
                        >
                          <Trash2 aria-hidden />
                        </Button>
                      )}
                    </span>
                  )}
                </li>
              ))}
            </ol>
          )}
          {failure && <div className="mt-2"><Failure error={failure} /></div>}
          <p className="mt-3 text-xs text-muted-foreground">
            {kind === 'FOLLOW_UP_TYPE'
              ? t('Hidden categories cannot be picked for new follow-ups; existing follow-ups keep them.')
              : t('These statuses drive reports and automation, so they cannot be added or deleted. Rename, recolour, reorder or hide them to match how your team works.')}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function OptionForm({ kind, editing, onDone }: { kind: OptionListKind; editing: OptionRow | null; onDone: () => void }) {
  const t = useT();
  const m = useOptionMutations(kind);
  const [v, setV] = useState({ label: editing ? t.maybe(editing.label) : '', color: editing?.color ?? '#3b82f6', description: editing?.description ?? '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const pending = m.create.isPending || m.update.isPending;
  const validColor = /^#[0-9a-f]{6}$/i.test(v.color);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{editing ? t('Edit {name}', { name: t.maybe(editing.label) }) : t('Add a follow-up category')}</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          noValidate
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            setNotice(null);
            const parsed = optionInputSchema.safeParse({ ...v, description: v.description || null });
            if (!parsed.success) {
              setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), t.maybe(i.message)])));
              return;
            }
            setErrors({});
            const done = (row: OptionRow) => {
              setNotice(editing ? t('Saved {name}.', { name: row.label }) : t('Added {name}.', { name: row.label }));
              if (editing) onDone();
              else setV({ label: '', color: '#3b82f6', description: '' });
            };
            const input = { label: parsed.data.label, color: parsed.data.color, description: parsed.data.description ?? null };
            if (editing) m.update.mutate({ value: editing.value, input }, { onSuccess: done });
            else m.create.mutate(input, { onSuccess: done });
          }}
        >
          <Field id={`opt-${kind}-label`} label={t('Name')} error={errors.label}>
            <Input value={v.label} maxLength={80} onChange={(e) => setV({ ...v, label: e.target.value })} placeholder={kind === 'FOLLOW_UP_TYPE' ? t('For example: Site visit') : undefined} />
          </Field>
          <div className="flex items-end gap-2">
            <input type="color" aria-label={t('Pick a colour')} value={validColor ? v.color : '#000000'} onChange={(e) => setV({ ...v, color: e.target.value })} className="mb-0.5 h-9 w-12 shrink-0 cursor-pointer rounded border border-border bg-transparent" />
            <div className="min-w-0 flex-1">
              <Field id={`opt-${kind}-color`} label={t('Colour')} error={errors.color}>
                <Input value={v.color} maxLength={7} className="font-mono" onChange={(e) => setV({ ...v, color: e.target.value })} />
              </Field>
            </div>
            <StatusChip className="mb-2.5" status={{ name: v.label || t('Preview'), color: validColor ? v.color : '#9ca3af' }} />
          </div>
          <div className="sm:col-span-2">
            <Field id={`opt-${kind}-description`} label={t('Description')} hint={t('Optional')}>
              <Input value={v.description} maxLength={500} onChange={(e) => setV({ ...v, description: e.target.value })} />
            </Field>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
            <Button type="submit" disabled={pending || !v.label.trim()}>
              {pending ? t('Saving…') : editing ? t('Save changes') : t('Add category')}
            </Button>
            {editing && (
              <Button type="button" variant="ghost" onClick={onDone}>
                {t('Cancel')}
              </Button>
            )}
            <Saved text={notice} />
          </div>
          <div className="sm:col-span-2">
            <Failure error={editing ? m.update.error : m.create.error} />
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

// ───────────── Notifications ─────────────

const BEFORE_CHOICES = [15, 30, 60, 120, 240, 1440] as const;

export function NotificationsSection() {
  const t = useT();
  const { query, save } = useNotificationSettings();
  const [draft, setDraft] = useState<NotificationSettings | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  if (query.isPending) return <Skeleton className="h-96" />;
  if (query.error) return <p role="alert" className="text-sm text-critical">{query.error.message}</p>;
  const v = draft ?? query.data;
  const r = v.reminders;
  const setR = (patch: Partial<NotificationSettings['reminders']>) => setDraft({ ...v, reminders: { ...r, ...patch } });
  const minutes = (n: number) => (n % 1440 === 0 ? t.plural('count.days', n / 1440) : n % 60 === 0 ? t.plural('count.hours', n / 60) : t.plural('count.minutes', n));

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        setNotice(null);
        save.mutate(v, { onSuccess: () => { setDraft(null); setNotice(t('Saved.')); } });
      }}
    >
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            {t('Reminders')}
            <InfoTip topic="crm.reminders" />
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field id="rem-before" label={t('Remind the owner before a follow-up is due')}>
            <Select value={r.followUpBeforeMinutes === null ? '' : String(r.followUpBeforeMinutes)} onChange={(e) => setR({ followUpBeforeMinutes: e.target.value === '' ? null : Number(e.target.value) })}>
              <option value="">{t('No reminder')}</option>
              {[...new Set([...BEFORE_CHOICES, ...(r.followUpBeforeMinutes ? [r.followUpBeforeMinutes] : [])])].sort((a, b) => a - b).map((n) => (
                <option key={n} value={n}>
                  {t('{time} before', { time: minutes(n) })}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="rem-rfq" label={t('Remind the owner before an RFQ deadline')}>
            <Select value={r.rfqDeadlineDays === null ? '' : String(r.rfqDeadlineDays)} onChange={(e) => setR({ rfqDeadlineDays: e.target.value === '' ? null : Number(e.target.value) })}>
              <option value="">{t('No reminder')}</option>
              {[1, 2, 3, 5, 7, 14].map((n) => (
                <option key={n} value={n}>
                  {t('{time} before', { time: t.plural('count.days', n) })}
                </option>
              ))}
            </Select>
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-[hsl(var(--primary))]" checked={r.followUpOverdue} onChange={(e) => setR({ followUpOverdue: e.target.checked })} />
            {t('Alert the owner once when a follow-up becomes overdue')}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-[hsl(var(--primary))]" checked={r.overdueNotifiesManager} disabled={!r.followUpOverdue} onChange={(e) => setR({ overdueNotifiesManager: e.target.checked })} />
            {t('Also alert their reporting manager')}
          </label>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('Notifications people receive')}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-sm text-muted-foreground">{t('Switched-off notifications are not sent to anyone in the workspace. Billing, security and failure alerts are always sent. Each person can still mute what they get in their own settings.')}</p>
          <ul className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
            {NOTIFICATION_CATEGORIES.map((c) => {
              const on = !v.disabled.includes(c.key);
              return (
                <li key={c.key}>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="size-4 accent-[hsl(var(--primary))]"
                      checked={on}
                      onChange={(e) => setDraft({ ...v, disabled: e.target.checked ? v.disabled.filter((k) => k !== c.key) : [...v.disabled, c.key] })}
                    />
                    {t.maybe(c.label)}
                  </label>
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={!draft || save.isPending}>
          {save.isPending ? t('Saving…') : t('Save notification settings')}
        </Button>
        <Saved text={notice} />
        <Failure error={save.error} />
      </div>
    </form>
  );
}

// ───────────── Currency ─────────────

export function CurrencySection({ canManage }: { canManage: boolean }) {
  const mayDelete = useCanDelete('crm_configuration');
  const t = useT();
  const c = useCurrencySettings();
  const [base, setBase] = useState<string | null>(null);
  const [adding, setAdding] = useState('');
  const [rate, setRate] = useState({ currency: '', rate: '', effectiveDate: today() });
  const [notice, setNotice] = useState<string | null>(null);
  const [rateError, setRateError] = useState<string | null>(null);
  if (c.query.isPending) return <Skeleton className="h-96" />;
  if (c.query.error) return <p role="alert" className="text-sm text-critical">{c.query.error.message}</p>;
  const s = c.query.data;
  const enabled = s.enabled;
  const setEnabled = (list: string[]) => c.save.mutate({ baseCurrency: s.baseCurrency, enabled: list });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            {t('Base currency')}
            <InfoTip topic="crm.currency" />
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">{t('Totals, targets, revenue and reports are shown in this currency. Amounts in other currencies are converted with the rates below.')}</p>
          <div className="flex flex-wrap items-end gap-2">
            <div className="w-64">
              <Field id="base-currency" label={t('Base currency')}>
                <CurrencySelect value={base ?? s.baseCurrency} disabled={!canManage} onChange={setBase} />
              </Field>
            </div>
            {canManage && (
              <Button
                disabled={!base || base === s.baseCurrency || c.save.isPending}
                onClick={() => {
                  if (!base || !window.confirm(t('Change the base currency to {currency}? Rates are relative to the base currency, so check them afterwards.', { currency: base }))) return;
                  c.save.mutate({ baseCurrency: base, enabled }, { onSuccess: () => { setBase(null); setNotice(t('Saved.')); } });
                }}
              >
                {t('Change base currency')}
              </Button>
            )}
            <Saved text={notice} />
          </div>
          <Failure error={c.save.error} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('Currencies your team uses')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">{t('Offered first when someone picks a currency on an RFQ, a deal or a currency field.')}</p>
          <ul className="flex flex-wrap gap-2" aria-label={t('Currencies your team uses')}>
            {[s.baseCurrency, ...enabled.filter((x) => x !== s.baseCurrency)].map((cur) => (
              <li key={cur}>
                <Badge tone={cur === s.baseCurrency ? 'primary' : 'neutral'} className="gap-1">
                  {cur}
                  {cur === s.baseCurrency ? ` · ${t('base')}` : null}
                  {canManage && cur !== s.baseCurrency && (
                    <button type="button" aria-label={t('Remove {name}', { name: cur })} onClick={() => setEnabled(enabled.filter((x) => x !== cur))}>
                      <X className="size-3" aria-hidden />
                    </button>
                  )}
                </Badge>
              </li>
            ))}
          </ul>
          {canManage && (
            <div className="flex flex-wrap items-end gap-2">
              <div className="w-64">
                <Field id="add-currency" label={t('Add a currency')}>
                  <CurrencySelect value={adding} onChange={setAdding} />
                </Field>
              </div>
              <Button variant="outline" disabled={!adding || enabled.includes(adding) || adding === s.baseCurrency} onClick={() => { setEnabled([...enabled, adding]); setAdding(''); }}>
                {t('Add')}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('Exchange rates')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {s.missingRates.length > 0 && (
            <p role="status" className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
              {t('Records use {currencies} without a rate, so totals leave them out. Add a rate for each.', { currencies: s.missingRates.join(', ') })}
            </p>
          )}
          {s.rates.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('No rates yet.')}</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-start text-xs text-muted-foreground">
                <tr>
                  <th className="py-1 text-start font-normal">{t('Currency')}</th>
                  <th className="py-1 text-end font-normal">{t('1 unit in {currency}', { currency: s.baseCurrency })}</th>
                  <th className="py-1 text-end font-normal">{t('From')}</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {s.rates.map((r) => (
                  <tr key={r.currency}>
                    <td className="py-2 font-mono">{r.currency}</td>
                    <td className="py-2 text-end tabular-nums">{r.rate.toLocaleString(t.formatLocale, { maximumFractionDigits: 6 })}</td>
                    <td className="py-2 text-end tabular-nums">{r.effectiveDate}</td>
                    <td className="py-2 text-end">
                      {canManage && mayDelete && (
                        <Button variant="ghost" size="icon" aria-label={t('Delete {name}', { name: r.currency })} onClick={() => c.removeRate.mutate(r.currency)}>
                          <Trash2 aria-hidden />
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {canManage && (
            <form
              noValidate
              className="flex flex-wrap items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const n = Number(rate.rate);
                if (!rate.currency || !Number.isFinite(n) || n <= 0) return setRateError(t('Pick a currency and enter a rate above 0.'));
                setRateError(null);
                c.addRate.mutate({ currency: rate.currency, rate: n, effectiveDate: rate.effectiveDate }, { onSuccess: () => setRate({ currency: '', rate: '', effectiveDate: today() }) });
              }}
            >
              <div className="w-56">
                <Field id="rate-currency" label={t('Currency')}>
                  <CurrencySelect value={rate.currency} onChange={(currency) => setRate({ ...rate, currency })} />
                </Field>
              </div>
              <div className="w-40">
                <Field id="rate-value" label={t('1 unit in {currency}', { currency: s.baseCurrency })}>
                  <Input inputMode="decimal" value={rate.rate} onChange={(e) => setRate({ ...rate, rate: e.target.value })} />
                </Field>
              </div>
              <div className="w-44">
                <Field id="rate-date" label={t('From')}>
                  <Input type="date" value={rate.effectiveDate} onChange={(e) => setRate({ ...rate, effectiveDate: e.target.value })} />
                </Field>
              </div>
              <Button type="submit" disabled={c.addRate.isPending}>
                {t('Save rate')}
              </Button>
              {rateError && <p role="alert" className="basis-full text-sm text-critical">{rateError}</p>}
              <div className="basis-full">
                <Failure error={c.addRate.error ?? c.removeRate.error} />
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ───────────── Export permissions ─────────────

export const EXPORT_ENTITY_LABEL = { companies: 'Companies', contacts: 'Employees', leads: 'Inbound contacts', deals: 'Deals', rfqs: 'RFQs' } as const satisfies Record<ExportEntityKey, MessageKey>;
const FORMAT_LABEL = { csv: 'CSV', xlsx: 'Excel' } as const satisfies Record<ExportFormat, MessageKey>;

export function ExportSection() {
  const t = useT();
  const excel = useHasFeature('excel_export');
  const { query, save } = useExportPolicy();
  const [draft, setDraft] = useState<ExportPolicyRow[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  if (query.isPending) return <Skeleton className="h-72" />;
  if (query.error) return <p role="alert" className="text-sm text-critical">{query.error.message}</p>;
  const rows = draft ?? query.data;
  const patch = (roleId: string, p: Partial<ExportRolePolicy>) => setDraft(rows.map((r) => (r.roleId === roleId ? { ...r, isDefault: false, policy: { ...r.policy, ...p } } : r)));
  const toggle = <T extends string>(list: T[], x: T, on: boolean) => (on ? [...new Set([...list, x])] : list.filter((y) => y !== x));

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        setNotice(null);
        save.mutate({ roles: rows.filter((r) => !r.isDefault).map((r) => r.policy) }, { onSuccess: () => { setDraft(null); setNotice(t('Saved.')); } });
      }}
    >
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            {t('Export permissions')}
            <InfoTip topic="crm.exports" />
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">{t('A role needs the Export data permission to export at all. Here you narrow what each role may export, and in which format. Exports only ever hold records and fields the person can see.')}</p>
          {!excel && <p className="rounded-md border border-border bg-muted/40 p-3 text-sm">{t('Excel exports need the Excel export feature of your plan; CSV is always available.')}</p>}
          <div className="divide-y divide-border">
            {rows.map((r) => (
              <fieldset key={r.roleId} className="space-y-2 py-3" disabled={!r.hasExportPermission}>
                <legend className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  {t.maybe(r.roleName)}
                  {!r.hasExportPermission && <Badge>{t('Cannot export')}</Badge>}
                  {r.hasExportPermission && r.isDefault && <Badge tone="success">{t('Everything allowed')}</Badge>}
                </legend>
                <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-sm">
                  {EXPORT_ENTITY_KEYS.map((en) => (
                    <label key={en} className="flex items-center gap-1.5">
                      <input type="checkbox" className="size-4 accent-[hsl(var(--primary))]" checked={r.policy.entities.includes(en)} onChange={(e) => patch(r.roleId, { entities: toggle(r.policy.entities, en, e.target.checked) })} />
                      {t(EXPORT_ENTITY_LABEL[en])}
                    </label>
                  ))}
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-sm">
                  {EXPORT_FORMATS.map((f) => (
                    <label key={f} className="flex items-center gap-1.5">
                      <input type="checkbox" className="size-4 accent-[hsl(var(--primary))]" checked={r.policy.formats.includes(f)} onChange={(e) => patch(r.roleId, { formats: toggle(r.policy.formats, f, e.target.checked) })} />
                      {t(FORMAT_LABEL[f])}
                    </label>
                  ))}
                  <label className="flex items-center gap-1.5">
                    <input type="checkbox" className="size-4 accent-[hsl(var(--primary))]" checked={r.policy.withoutContactDetails} onChange={(e) => patch(r.roleId, { withoutContactDetails: e.target.checked })} />
                    {t('Leave out emails, phone numbers and profile links')}
                  </label>
                </div>
              </fieldset>
            ))}
          </div>
        </CardContent>
      </Card>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={!draft || save.isPending}>
          {save.isPending ? t('Saving…') : t('Save export permissions')}
        </Button>
        <Saved text={notice} />
        <Failure error={save.error} />
      </div>
    </form>
  );
}

// ───────────── Dashboard widgets and layouts ─────────────

/** Names for dashboard widgets: the Command Center analytics widgets and the role dashboard sections. */
export const WIDGET_NAME: Record<string, MessageKey> = {
  kpis: 'Key metrics',
  nextActions: 'Next best actions',
  insights: 'Sales insights',
  pipeline: 'Pipeline by stage',
  revenueTrend: 'Revenue trend',
  stageConversion: 'Stage conversion',
  winLoss: 'Win and loss',
  team: 'Team performance',
  risk: 'Deal risk',
  goal: 'Goal attainment',
  // Role dashboard sections keep the names they have on the dashboards themselves.
  ...SECTION_LABEL,
};

export function DashboardsSection({ canManage }: { canManage: boolean }) {
  const t = useT();
  const [tier, setTier] = useState<DesignationTier>('EXECUTIVE');
  const { query } = useDashboardPolicies();
  if (query.isPending) return <Skeleton className="h-96" />;
  if (query.error) return <p role="alert" className="text-sm text-critical">{query.error.message}</p>;
  const policy = query.data.find((p) => p.tier === tier) ?? { tier, allowedWidgets: null, defaultLayout: null, canCustomize: true };
  return (
    <div className="space-y-4">
      <Field id="dash-tier" label={t('Dashboard level')} hint={t('Set per designation level: executives, managers and senior management each get their own.')}>
        <Select value={tier} onChange={(e) => setTier(e.target.value as DesignationTier)}>
          {DESIGNATION_TIERS.map((x) => (
            <option key={x} value={x}>
              {t(TIER_LABELS[x])}
            </option>
          ))}
        </Select>
      </Field>
      <DashboardPolicyForm key={`${tier}-${JSON.stringify(policy)}`} policy={policy} canManage={canManage} />
    </div>
  );
}

function DashboardPolicyForm({ policy, canManage }: { policy: DashboardPolicy; canManage: boolean }) {
  const t = useT();
  const { save } = useDashboardPolicies();
  const catalog = dashboardWidgetCatalog(policy.tier);
  const all = [...catalog.sections, ...catalog.analytics];
  const [allowed, setAllowed] = useState<string[]>(policy.allowedWidgets ?? all);
  const [layout, setLayout] = useState<DashboardPolicyWidget[] | null>(policy.defaultLayout);
  const [canCustomize, setCanCustomize] = useState(policy.canCustomize);
  const [notice, setNotice] = useState<string | null>(null);
  const shown = (layout ?? catalog.sections.map((id) => ({ id, size: 'full' as const, hidden: false }))).filter((w) => allowed.includes(w.id));
  const notInLayout = allowed.filter((id) => !shown.some((w) => w.id === id));
  const name = (id: string) => (WIDGET_NAME[id] ? t(WIDGET_NAME[id]) : id);
  const moveTo = (i: number, by: -1 | 1) => {
    const next = [...shown];
    [next[i], next[i + by]] = [next[i + by]!, next[i]!];
    setLayout(next);
  };
  const group = (title: MessageKey, ids: string[]) => (
    <fieldset className="space-y-1.5">
      <legend className="text-sm font-medium">{t(title)}</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
        {ids.map((id) => (
          <label key={id} className="flex items-center gap-1.5 text-sm">
            <input type="checkbox" className="size-4 accent-[hsl(var(--primary))]" disabled={!canManage} checked={allowed.includes(id)} onChange={(e) => setAllowed(e.target.checked ? [...allowed, id] : allowed.filter((x) => x !== id))} />
            {name(id)}
          </label>
        ))}
      </div>
    </fieldset>
  );

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        setNotice(null);
        const everything = all.every((id) => allowed.includes(id));
        save.mutate(
          { tier: policy.tier, allowedWidgets: everything ? null : allowed, defaultLayout: layout ? shown : null, canCustomize },
          { onSuccess: () => setNotice(t('Saved.')) },
        );
      }}
    >
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            {t('Widgets people may have')}
            <InfoTip topic="crm.dashboards" />
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {group('Role dashboard sections', catalog.sections)}
          {group('Command Center analytics', catalog.analytics)}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-[hsl(var(--primary))]" disabled={!canManage} checked={canCustomize} onChange={(e) => setCanCustomize(e.target.checked)} />
            {t('People may rearrange, resize and hide their widgets')}
          </label>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('Default layout')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {layout ? t('New people start with this layout. When customising is off, everyone keeps it.') : t('Using the built-in layout. Change the order or widths to set your own.')}
          </p>
          <ol className="divide-y divide-border" aria-label={t('Default layout')}>
            {shown.map((w, i) => (
              <li key={w.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                <span className="w-6 text-end text-xs tabular-nums text-muted-foreground">{i + 1}</span>
                <span className="min-w-0 flex-1 font-medium">{name(w.id)}</span>
                {canManage && (
                  <>
                    <Select aria-label={t('Width of {name}', { name: name(w.id) })} value={w.size} className="w-32" onChange={(e) => setLayout(shown.map((x) => (x.id === w.id ? { ...x, size: e.target.value as 'half' | 'full' } : x)))}>
                      <option value="full">{t('Full width')}</option>
                      <option value="half">{t('Half width')}</option>
                    </Select>
                    <Button type="button" variant="ghost" size="icon" aria-label={t('Move {name} up', { name: name(w.id) })} disabled={i === 0} onClick={() => moveTo(i, -1)}>
                      <ArrowUp aria-hidden />
                    </Button>
                    <Button type="button" variant="ghost" size="icon" aria-label={t('Move {name} down', { name: name(w.id) })} disabled={i === shown.length - 1} onClick={() => moveTo(i, 1)}>
                      <ArrowDown aria-hidden />
                    </Button>
                    <Button type="button" variant="ghost" size="icon" aria-label={t('Remove {name}', { name: name(w.id) })} onClick={() => setLayout(shown.filter((x) => x.id !== w.id))}>
                      <X aria-hidden />
                    </Button>
                  </>
                )}
              </li>
            ))}
          </ol>
          {canManage && notInLayout.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 text-sm">
              <span className="text-muted-foreground">{t('Add to the layout:')}</span>
              {notInLayout.map((id) => (
                <Button key={id} type="button" size="sm" variant="outline" onClick={() => setLayout([...shown, { id, size: 'half', hidden: false }])}>
                  {name(id)}
                </Button>
              ))}
            </div>
          )}
          {canManage && layout && (
            <Button type="button" variant="ghost" size="sm" onClick={() => setLayout(null)}>
              {t('Back to the built-in layout')}
            </Button>
          )}
        </CardContent>
      </Card>
      {canManage && (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={save.isPending || allowed.length === 0}>
            {save.isPending ? t('Saving…') : t('Save dashboard settings')}
          </Button>
          <Saved text={notice} />
          <Failure error={save.error} />
        </div>
      )}
    </form>
  );
}

// ───────────── Revenue attribution ─────────────

const MODEL_LABEL = {
  LEAD_GENERATION: 'Whoever created the company',
  DEAL_CLOSURE: 'Whoever closed the deal',
  ACCOUNT_OWNERSHIP: 'Whoever owns the account',
  SHARED: 'Shared between them',
} as const satisfies Record<AttributionModel, MessageKey>;

const SHARE_FIELDS = [
  ['leadCreatorPct', 'Company creator'],
  ['closerPct', 'Deal closer'],
  ['accountOwnerPct', 'Account owner'],
  ['supportersPct', 'Supporting colleagues'],
] as const satisfies readonly [keyof AttributionRule, MessageKey][];

export function AttributionSection({ canManage }: { canManage: boolean }) {
  const t = useT();
  const { query, save } = useAttributionRule();
  const [draft, setDraft] = useState<AttributionRule | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  if (query.isPending) return <Skeleton className="h-72" />;
  if (query.error) return <p role="alert" className="text-sm text-critical">{query.error.message}</p>;
  const v = draft ?? query.data;
  const total = SHARE_FIELDS.reduce((s, [k]) => s + Number(v[k] || 0), 0);

  return (
    <form
      className="space-y-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        setNotice(null);
        const parsed = attributionRuleSchema.safeParse(v);
        if (!parsed.success) return setError(t.maybe(parsed.error.issues[0]!.message));
        setError(null);
        save.mutate(parsed.data, { onSuccess: () => { setDraft(null); setNotice(t('Saved. New revenue records use this rule; splits someone set by hand stay as they are.')); } });
      }}
    >
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            {t('Who gets credit for revenue')}
            <InfoTip topic="crm.attribution" />
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">{t('Every won deal counts once for the organisation. This rule decides whose numbers it counts towards.')}</p>
          <fieldset className="space-y-2" disabled={!canManage}>
            <legend className="sr-only">{t('Who gets credit for revenue')}</legend>
            {ATTRIBUTION_MODELS.map((model) => (
              <label key={model} className="flex items-center gap-2 text-sm">
                <input type="radio" name="attribution-model" className="size-4 accent-[hsl(var(--primary))]" checked={v.model === model} onChange={() => setDraft({ ...v, model })} />
                {t(MODEL_LABEL[model])}
              </label>
            ))}
          </fieldset>
          {v.model === 'SHARED' && (
            <div className="grid gap-3 sm:grid-cols-4">
              {SHARE_FIELDS.map(([k, label]) => (
                <Field key={k} id={`attr-${k}`} label={t(label)}>
                  <Input type="number" min={0} max={100} disabled={!canManage} value={String(v[k])} onChange={(e) => setDraft({ ...v, [k]: e.target.value === '' ? 0 : Number(e.target.value) })} />
                </Field>
              ))}
              <p className={`text-sm sm:col-span-4 ${Math.abs(total - 100) < 0.001 ? 'text-muted-foreground' : 'text-critical'}`}>{t('Total: {pct}%', { pct: total })}</p>
            </div>
          )}
          {error && <p role="alert" className="text-sm text-critical">{error}</p>}
        </CardContent>
      </Card>
      {canManage && (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={!draft || save.isPending}>
            {save.isPending ? t('Saving…') : t('Save attribution rule')}
          </Button>
          <Saved text={notice} />
          <Failure error={save.error} />
        </div>
      )}
    </form>
  );
}
