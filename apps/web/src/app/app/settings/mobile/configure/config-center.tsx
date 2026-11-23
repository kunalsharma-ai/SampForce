'use client';

import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Skeleton } from '@dealflow/ui';
import {
  type FieldRule,
  MOBILE_DASHBOARD_CARD_DEFS,
  MOBILE_DASHBOARD_CARDS,
  MOBILE_FIELDS,
  MOBILE_LEVELS,
  MOBILE_MODULE_BY_KEY,
  MOBILE_MODULE_DEFS,
  MOBILE_NOTIFICATION_TYPES,
  MOBILE_PHONE_ACTIONS,
  MOBILE_RECORD_MODULES,
  type MobileAppConfig,
  type MobileConfigCenter,
  type MobileDashboardCard,
  type MobileModuleKey,
  type MobileRecordModule,
  type MobileWorkspaceLevel,
  normalizeMobileConfig,
  type RecordRule,
} from '@dealflow/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ErrorText, Field } from '@/components/revenue/tabs';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { fmtLocale } from '@/lib/i18n/locale';
import { MOBILE_LEVEL_LABEL, MOBILE_NOTIFICATION_LABEL, MOBILE_PHONE_ACTION_LABEL } from '@/lib/mobile';
import { useCan } from '@/lib/session';
import { PhonePreview } from './phone-preview';

const STEPS = ['Modules', 'Fields', 'Workspace permissions', 'Dashboard and navigation', 'Preview', 'Publish'] as const;
type Step = (typeof STEPS)[number];
const KEY = ['mobile-config'];
const clone = (c: MobileAppConfig) => JSON.parse(JSON.stringify(c)) as MobileAppConfig;

/**
 * The Mobile Configuration Center (ADR 0072, M2): the Super Workspace decides how the app looks and what each
 * workspace level sees and may do, previews it, and publishes it. The API applies the same rules to every phone
 * request; this screen only edits them.
 */
export function MobileConfigCenterScreen() {
  const t = useT();
  const canManage = useCan('tenant:manage');
  const qc = useQueryClient();
  const q = useQuery({ enabled: canManage, queryKey: KEY, queryFn: () => api<MobileConfigCenter>('/mobile-config') });
  const [draft, setDraft] = useState<MobileAppConfig | null>(null);
  const [dirty, setDirty] = useState(false);
  const [step, setStep] = useState<Step>('Modules');
  useEffect(() => {
    if (q.data && !dirty) setDraft(q.data.draft);
  }, [q.data, dirty]);

  const onCenter = (c: MobileConfigCenter) => {
    qc.setQueryData(KEY, c);
    setDraft(c.draft);
    setDirty(false);
  };
  const save = useMutation({ mutationFn: (c: MobileAppConfig) => api<MobileConfigCenter>('/mobile-config/draft', { method: 'PUT', json: c }), onSuccess: onCenter });
  const discard = useMutation({ mutationFn: () => api<MobileConfigCenter>('/mobile-config/draft', { method: 'DELETE' }), onSuccess: onCenter });

  if (!canManage) return <p className="text-sm text-muted-foreground">{t('Only owners and administrators can manage the mobile app.')}</p>;
  if (q.isPending || !draft) return q.error ? <ErrorText error={q.error} /> : <Skeleton className="h-96" />;
  const center = q.data!;
  const edit = (fn: (c: MobileAppConfig) => void) => {
    const next = clone(draft);
    fn(next);
    setDraft(normalizeMobileConfig(next));
    setDirty(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Link href="/app/settings/mobile" className="text-primary underline-offset-2 hover:underline">
          {t('← Mobile access')}
        </Link>
        <span className="flex-1" />
        {center.published ? <Badge tone="success">{t('Version {n} is live', { n: center.published.version })}</Badge> : <Badge tone="warning">{t('Not published yet: phones use the standard layout')}</Badge>}
        {(dirty || center.unpublishedChanges) && <Badge tone="warning">{dirty ? t('Unsaved changes') : t('Saved, not published')}</Badge>}
      </div>

      <nav aria-label={t('Configuration steps')}>
        <ol className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {STEPS.map((s, i) => (
            <li key={s}>
              <button
                type="button"
                onClick={() => setStep(s)}
                aria-current={step === s ? 'step' : undefined}
                className={`w-full rounded-md border px-3 py-2 text-start text-sm transition-colors ${step === s ? 'border-primary bg-primary/10 font-medium' : 'border-border hover:bg-muted'}`}
              >
                <span className="block text-xs text-muted-foreground">{t('Step {n}', { n: i + 1 })}</span>
                {t.maybe(s)}
              </button>
            </li>
          ))}
        </ol>
      </nav>

      {step === 'Modules' && <ModulesStep draft={draft} edit={edit} features={center.features} />}
      {step === 'Fields' && <FieldsStep draft={draft} edit={edit} customFields={center.customFields} />}
      {step === 'Workspace permissions' && <PermissionsStep draft={draft} edit={edit} />}
      {step === 'Dashboard and navigation' && <DashboardStep draft={draft} edit={edit} />}
      {step === 'Preview' && <PreviewStep draft={draft} features={center.features} />}
      {step === 'Publish' && <PublishStep center={center} dirty={dirty} onCenter={onCenter} />}

      {step !== 'Publish' && step !== 'Preview' && (
        <div className="sticky bottom-0 flex flex-wrap items-center gap-3 border-t border-border bg-background py-3">
          <Button onClick={() => save.mutate(draft)} disabled={!dirty || save.isPending}>
            {save.isPending ? t('Saving…') : t('Save draft')}
          </Button>
          <Button variant="outline" onClick={() => (dirty ? (setDraft(center.draft), setDirty(false)) : discard.mutate())} disabled={(!dirty && !center.unpublishedChanges) || discard.isPending}>
            {dirty ? t('Undo unsaved changes') : center.published ? t('Go back to the live version') : t('Go back to the standard layout')}
          </Button>
          <span className="text-xs text-muted-foreground">{t('Phones change only when you publish.')}</span>
          <ErrorText error={save.error ?? discard.error} />
        </div>
      )}
    </div>
  );
}

type EditProps = { draft: MobileAppConfig; edit: (fn: (c: MobileAppConfig) => void) => void };

function Toggle({ checked, onChange, label, disabled, hideLabel }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean; hideLabel?: boolean }) {
  return (
    <label className={`inline-flex items-center gap-2 text-sm ${disabled ? 'opacity-60' : 'cursor-pointer'}`}>
      <input type="checkbox" className="size-4 accent-primary" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} aria-label={hideLabel ? label : undefined} />
      {!hideLabel && <span>{label}</span>}
    </label>
  );
}

function ModulesStep({ draft, edit, features }: EditProps & { features: string[] }) {
  const t = useT();
  const b = draft.branding;
  const [logoError, setLogoError] = useState('');
  const onLogo = (file: File | undefined) => {
    setLogoError('');
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return setLogoError(t('Use a PNG, JPEG or WebP image.'));
    if (file.size > 250 * 1024) return setLogoError(t('The logo is too large. Use an image under 250 KB.'));
    const reader = new FileReader();
    reader.onload = () => edit((c) => void (c.branding.logoDataUrl = String(reader.result)));
    reader.readAsDataURL(file);
  };
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t('App name, logo and colours')}</CardTitle>
          <CardDescription>{t('Your people see these after they sign in. The app in the stores stays “SampForce”.')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field id="mc-name" label={t('App name')}>
            <Input id="mc-name" value={b.appName} maxLength={30} onChange={(e) => edit((c) => void (c.branding.appName = e.target.value))} />
          </Field>
          <Field id="mc-theme" label={t('Theme')}>
            <select id="mc-theme" className="h-control w-full rounded-md border border-input bg-surface px-3 text-sm" value={b.theme} onChange={(e) => edit((c) => void (c.branding.theme = e.target.value as typeof b.theme))}>
              <option value="system">{t('Follow the phone')}</option>
              <option value="light">{t('Light')}</option>
              <option value="dark">{t('Dark')}</option>
            </select>
          </Field>
          {(['primaryColor', 'accentColor'] as const).map((k) => (
            <ColorField key={k} id={`mc-${k}`} label={k === 'primaryColor' ? t('Main colour') : t('Accent colour')} value={b[k]} onChange={(v) => edit((c) => void (c.branding[k] = v))} />
          ))}
          <Field id="mc-logo" label={t('Logo')} hint={t('PNG, JPEG or WebP, up to 250 KB. Square images look best.')} {...(logoError ? { error: logoError } : {})}>
            <div className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element -- a data URL the Super Workspace uploaded */}
              {b.logoDataUrl ? <img src={b.logoDataUrl} alt={t('Current logo')} className="size-12 rounded-md border border-border object-contain" /> : null}
              <input id="mc-logo" type="file" accept="image/png,image/jpeg,image/webp" className="text-sm" onChange={(e) => onLogo(e.target.files?.[0])} />
              {b.logoDataUrl && (
                <Button variant="outline" size="sm" onClick={() => edit((c) => void (c.branding.logoDataUrl = null))}>
                  {t('Remove logo')}
                </Button>
              )}
            </div>
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('Modules')}</CardTitle>
          <CardDescription>{t('Choose which parts of SampForce the app offers. Each level’s access is set in Workspace permissions.')}</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-3 sm:grid-cols-2">
            {MOBILE_MODULE_DEFS.map((m) => {
              const notInPlan = !!m.feature && !features.includes(m.feature);
              return (
                <li key={m.key} className="rounded-md border border-border p-3">
                  <Toggle checked={draft.modules[m.key].enabled} disabled={!!m.required} label={t.maybe(m.label)} onChange={(v) => edit((c) => void (c.modules[m.key].enabled = v))} />
                  <p className="mt-1 text-xs text-muted-foreground">{t.maybe(m.description)}</p>
                  {m.required && <p className="mt-1 text-xs text-muted-foreground">{t('Always on: the app needs it.')}</p>}
                  {notInPlan && <p className="mt-1 text-xs text-warning">{t('Your plan does not include this, so phones will not show it.')}</p>}
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('Chat, notifications and profile pictures')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Toggle checked={draft.chat.enabled} label={t('Team chat in the app')} disabled={!draft.modules.chat.enabled} onChange={(v) => edit((c) => void (c.chat.enabled = v))} />
          <Toggle checked={draft.profilePictures.visible} label={t('Show profile pictures')} onChange={(v) => edit((c) => void (c.profilePictures.visible = v))} />
          <div className="space-y-2">
            <Toggle checked={draft.notifications.enabled} label={t('Notifications on phones')} onChange={(v) => edit((c) => void (c.notifications.enabled = v))} />
            <fieldset className="grid gap-2 ps-6 sm:grid-cols-3" disabled={!draft.notifications.enabled}>
              <legend className="sr-only">{t('Notification types')}</legend>
              {MOBILE_NOTIFICATION_TYPES.map((n) => (
                <Toggle key={n} checked={draft.notifications.types[n]} disabled={!draft.notifications.enabled} label={t.maybe(MOBILE_NOTIFICATION_LABEL[n] ?? n)} onChange={(v) => edit((c) => void (c.notifications.types[n] = v))} />
              ))}
            </fieldset>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/** A colour as a hex code, with a picker beside it. The code updates the draft once it is a full #RRGGBB. */
function ColorField({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (v: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <Field id={id} label={label}>
      <div className="flex items-center gap-2">
        <input type="color" aria-hidden tabIndex={-1} value={value} onChange={(e) => onChange(e.target.value.toUpperCase())} className="h-control w-12 rounded-md border border-input bg-surface" />
        <Input
          id={id}
          value={text}
          maxLength={7}
          onChange={(e) => {
            setText(e.target.value);
            if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) onChange(e.target.value.toUpperCase());
          }}
          className="w-32 font-mono"
        />
      </div>
    </Field>
  );
}

const RULES: { key: keyof FieldRule; label: string }[] = [
  { key: 'view', label: 'View' },
  { key: 'edit', label: 'Edit' },
  { key: 'create', label: 'Set on new' },
  { key: 'delete', label: 'Clear' },
];

function FieldsStep({ draft, edit, customFields }: EditProps & { customFields: MobileConfigCenter['customFields'] }) {
  const t = useT();
  const [module, setModule] = useState<MobileRecordModule>('companies');
  const [level, setLevel] = useState<MobileWorkspaceLevel>('EXECUTIVE');
  const custom = customFields[module] ?? [];
  const rows = [...MOBILE_FIELDS[module].map((f) => ({ key: f.key, label: t.maybe(f.label), def: f })), ...custom.map((f) => ({ key: `cf.${f.key}`, label: f.label, def: undefined }))];
  const rule = (key: string): FieldRule => draft.fields[module][key]?.[level] ?? { view: false, edit: false, create: false, delete: false };
  const setRule = (key: string, k: keyof FieldRule, v: boolean) =>
    edit((c) => {
      const row = (c.fields[module][key] ??= { SUPER: { view: false, edit: false, create: false, delete: false }, MANAGER: { view: false, edit: false, create: false, delete: false }, EXECUTIVE: { view: false, edit: false, create: false, delete: false } });
      const r = row[level];
      r[k] = v;
      // Seeing is the floor: switching view off takes the rest with it; switching anything on turns view on.
      if (k === 'view' && !v) Object.assign(r, { edit: false, create: false, delete: false });
      if (k !== 'view' && v) r.view = true;
    });
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('Fields')}</CardTitle>
        <CardDescription>{t('Choose what each level can see and change in each record. The server refuses anything else, even from a modified app.')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-3">
          <Field id="mf-module" label={t('Module')}>
            <select id="mf-module" className="block h-control rounded-md border border-input bg-surface px-3 text-sm" value={module} onChange={(e) => setModule(e.target.value as MobileRecordModule)}>
              {MOBILE_RECORD_MODULES.map((m) => (
                <option key={m} value={m}>
                  {t.maybe(MOBILE_MODULE_BY_KEY[m].label)}
                </option>
              ))}
            </select>
          </Field>
          <LevelPicker id="mf-level" level={level} onChange={setLevel} />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <caption className="sr-only">{t('Field rules for {level}', { level: t.maybe(MOBILE_LEVEL_LABEL[level]) })}</caption>
            <thead className="text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="p-2 text-start font-medium">{t('Field')}</th>
                {RULES.map((r) => (
                  <th key={r.key} scope="col" className="p-2 text-center font-medium">{t.maybe(r.label)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((f) => (
                <tr key={f.key} className="border-t border-border">
                  <th scope="row" className="p-2 text-start font-normal">
                    {f.label}
                    {f.def?.readOnly && <span className="ms-2 text-xs text-muted-foreground">{t('read only')}</span>}
                    {f.def?.required && <span className="ms-2 text-xs text-muted-foreground">{t('always shown')}</span>}
                    {f.def?.sensitive && <span className="ms-2 text-xs text-warning">{t('sensitive')}</span>}
                    {!f.def && <span className="ms-2 text-xs text-muted-foreground">{t('custom field')}</span>}
                  </th>
                  {RULES.map((r) => {
                    const locked = (r.key === 'view' && !!f.def?.required) || (r.key !== 'view' && !!f.def?.readOnly) || (r.key === 'delete' && !!f.def?.required);
                    return (
                      <td key={r.key} className="p-2 text-center">
                        <Toggle hideLabel checked={rule(f.key)[r.key]} disabled={locked} label={`${f.label}: ${t.maybe(r.label)}`} onChange={(v) => setRule(f.key, r.key, v)} />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function LevelPicker({ id, level, onChange }: { id: string; level: MobileWorkspaceLevel; onChange: (l: MobileWorkspaceLevel) => void }) {
  const t = useT();
  return (
    <Field id={id} label={t('Workspace level')}>
      <select id={id} className="block h-control rounded-md border border-input bg-surface px-3 text-sm" value={level} onChange={(e) => onChange(e.target.value as MobileWorkspaceLevel)}>
        {MOBILE_LEVELS.map((l) => (
          <option key={l} value={l}>
            {t.maybe(MOBILE_LEVEL_LABEL[l])}
          </option>
        ))}
      </select>
    </Field>
  );
}

const RECORD_RULES: { key: keyof RecordRule; label: string }[] = [
  { key: 'view', label: 'View' },
  { key: 'create', label: 'Create' },
  { key: 'edit', label: 'Edit' },
  { key: 'delete', label: 'Delete' },
];

function PermissionsStep({ draft, edit }: EditProps) {
  const t = useT();
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t('Workspace permissions')}</CardTitle>
          <CardDescription>{t('What each workspace level may do in each module on the phone. A person’s role still applies: the app never allows more than the web.')}</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <caption className="sr-only">{t('Workspace permissions')}</caption>
            <thead className="text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="p-2 text-start font-medium">{t('Module')}</th>
                {MOBILE_LEVELS.map((l) => (
                  <th key={l} scope="col" className="p-2 text-start font-medium">{t.maybe(MOBILE_LEVEL_LABEL[l])}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {MOBILE_MODULE_DEFS.filter((m) => draft.modules[m.key].enabled).map((m) => (
                <tr key={m.key} className="border-t border-border align-top">
                  <th scope="row" className="p-2 text-start font-normal">{t.maybe(m.label)}</th>
                  {MOBILE_LEVELS.map((l) => (
                    <td key={l} className="p-2">
                      <div className="flex flex-wrap gap-x-3 gap-y-1">
                        {RECORD_RULES.filter((r) => r.key === 'view' || m.records).map((r) => (
                          <Toggle
                            key={r.key}
                            checked={draft.modules[m.key].levels[l][r.key]}
                            disabled={r.key === 'view' && !!m.required}
                            label={t.maybe(r.label)}
                            onChange={(v) =>
                              edit((c) => {
                                const rule = c.modules[m.key].levels[l];
                                rule[r.key] = v;
                                if (r.key !== 'view' && v) rule.view = true;
                              })
                            }
                          />
                        ))}
                      </div>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t('Phone actions')}</CardTitle>
          <CardDescription>{t('Buttons shown on a record to call, email or message the client from the phone.')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {MOBILE_LEVELS.map((l) => (
            <fieldset key={l} className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <legend className="w-48 text-sm font-medium">{t.maybe(MOBILE_LEVEL_LABEL[l])}</legend>
              {MOBILE_PHONE_ACTIONS.map((a) => (
                <Toggle
                  key={a}
                  checked={draft.phoneActions[l].includes(a)}
                  label={t.maybe(MOBILE_PHONE_ACTION_LABEL[a] ?? a)}
                  onChange={(v) => edit((c) => void (c.phoneActions[l] = v ? [...c.phoneActions[l], a] : c.phoneActions[l].filter((x) => x !== a)))}
                />
              ))}
            </fieldset>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function DashboardStep({ draft, edit }: EditProps) {
  const t = useT();
  const [level, setLevel] = useState<MobileWorkspaceLevel>('EXECUTIVE');
  const cards = draft.dashboard[level];
  const offered = MOBILE_DASHBOARD_CARDS.filter((c) => MOBILE_DASHBOARD_CARD_DEFS[c].levels.includes(level) && !cards.some((x) => x.card === c));
  const move = (i: number, by: number) =>
    edit((c) => {
      const list = c.dashboard[level];
      const [x] = list.splice(i, 1);
      list.splice(i + by, 0, x!);
    });
  const enabledModules = MOBILE_MODULE_DEFS.filter((m) => draft.modules[m.key].enabled && draft.modules[m.key].levels[level].view);
  const tabs = draft.navigation[level];
  const setTab = (m: MobileModuleKey, on: boolean) => edit((c) => void (c.navigation[level] = on ? [...c.navigation[level], m] : c.navigation[level].filter((x) => x !== m)));
  return (
    <div className="space-y-6">
      <LevelPicker id="md-level" level={level} onChange={setLevel} />
      <Card>
        <CardHeader>
          <CardTitle>{t('Dashboard cards')}</CardTitle>
          <CardDescription>{t('The home screen of the {level}, in this order.', { level: t.maybe(MOBILE_LEVEL_LABEL[level]) })}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {cards.length === 0 && <p className="text-sm text-muted-foreground">{t('No cards: the home screen shows only a greeting.')}</p>}
          <ol className="space-y-2">
            {cards.map((c, i) => (
              <li key={c.card} className="flex flex-wrap items-center gap-3 rounded-md border border-border p-2">
                <span className="w-6 text-center text-xs text-muted-foreground">{i + 1}</span>
                <span className="flex-1 text-sm">
                  <span className="font-medium">{t.maybe(MOBILE_DASHBOARD_CARD_DEFS[c.card].label)}</span>
                  <span className="block text-xs text-muted-foreground">{t.maybe(MOBILE_DASHBOARD_CARD_DEFS[c.card].description)}</span>
                </span>
                <Toggle checked={c.showChart} label={t('Chart')} onChange={(v) => edit((x) => void (x.dashboard[level][i]!.showChart = v))} />
                <Button variant="outline" size="sm" aria-label={t('Move up')} disabled={i === 0} onClick={() => move(i, -1)}>
                  <ArrowUp className="size-4" aria-hidden />
                </Button>
                <Button variant="outline" size="sm" aria-label={t('Move down')} disabled={i === cards.length - 1} onClick={() => move(i, 1)}>
                  <ArrowDown className="size-4" aria-hidden />
                </Button>
                <Button variant="outline" size="sm" onClick={() => edit((x) => void x.dashboard[level].splice(i, 1))}>
                  {t('Remove')}
                </Button>
              </li>
            ))}
          </ol>
          {offered.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-2">
              {offered.map((c: MobileDashboardCard) => (
                <Button key={c} variant="outline" size="sm" onClick={() => edit((x) => void x.dashboard[level].push({ card: c, showChart: true }))}>
                  {t('Add {card}', { card: t.maybe(MOBILE_DASHBOARD_CARD_DEFS[c].label) })}
                </Button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t('Bottom tabs')}</CardTitle>
          <CardDescription>{t('Up to 5 tabs, in the order you pick them. Everything else the person can use goes under More.')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm">{tabs.length ? tabs.map((m) => t.maybe(MOBILE_MODULE_BY_KEY[m].label)).join(' · ') : t('No tabs: everything is under More.')}</p>
          <div className="grid gap-2 sm:grid-cols-3">
            {enabledModules.map((m) => (
              <Toggle key={m.key} checked={tabs.includes(m.key)} disabled={!tabs.includes(m.key) && tabs.length >= 5} label={t.maybe(m.label)} onChange={(v) => setTab(m.key, v)} />
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function PreviewStep({ draft, features }: { draft: MobileAppConfig; features: string[] }) {
  const t = useT();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('Preview')}</CardTitle>
        <CardDescription>{t('How the app looks for each level with this draft, for a person whose role allows everything. Each person’s role can narrow it further.')}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap justify-center gap-6">
          {MOBILE_LEVELS.map((l) => (
            <PhonePreview key={l} config={draft} level={l} features={features} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function PublishStep({ center, dirty, onCenter }: { center: MobileConfigCenter; dirty: boolean; onCenter: (c: MobileConfigCenter) => void }) {
  const t = useT();
  const [note, setNote] = useState('');
  const publish = useMutation({ mutationFn: () => api<MobileConfigCenter>('/mobile-config/publish', { method: 'POST', json: note.trim() ? { note: note.trim() } : {} }), onSuccess: (c) => (onCenter(c), setNote('')) });
  const rollback = useMutation({ mutationFn: (version: number) => api<MobileConfigCenter>('/mobile-config/rollback', { method: 'POST', json: { version } }), onSuccess: onCenter });
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t('Publish')}</CardTitle>
          <CardDescription>{t('Publishing sends the saved draft to every phone. Phones pick it up the next time they open the app or come back online.')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {dirty && <p className="text-sm text-warning">{t('You have unsaved changes. Save the draft first; only the saved draft is published.')}</p>}
          {!center.unpublishedChanges && !dirty && <p className="text-sm text-muted-foreground">{t('The live version already matches the draft.')}</p>}
          <Field id="mp-note" label={t('What changed (optional)')}>
            <Input id="mp-note" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder={t('For example: deal amounts hidden from executives')} />
          </Field>
          <Button onClick={() => publish.mutate()} disabled={publish.isPending || dirty || (!center.unpublishedChanges && !!center.published)}>
            {publish.isPending ? t('Publishing…') : t('Publish to phones')}
          </Button>
          <ErrorText error={publish.error} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t('Versions')}</CardTitle>
          <CardDescription>{t('Put an older version back if a change does not work out. It is published again as a new version.')}</CardDescription>
        </CardHeader>
        <CardContent>
          {center.versions.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('Nothing published yet. Phones use the standard layout.')}</p>
          ) : (
            <ul className="divide-y divide-border text-sm" aria-label={t('Published versions')}>
              {center.versions.map((v) => (
                <li key={v.version} className="flex flex-wrap items-center gap-3 py-2">
                  <span className="font-medium">{t('Version {n}', { n: v.version })}</span>
                  {center.published?.version === v.version && <Badge tone="success">{t('Live')}</Badge>}
                  <span className="text-muted-foreground">
                    {new Date(v.publishedAt).toLocaleString(fmtLocale())}
                    {v.publishedBy ? ` · ${v.publishedBy}` : ''}
                  </span>
                  <span className="flex-1">{v.restoredFrom ? t('Put back version {n}', { n: v.restoredFrom }) : v.note ? `“${v.note}”` : ''}</span>
                  {center.published?.version !== v.version && (
                    <Button variant="outline" size="sm" disabled={rollback.isPending || dirty} onClick={() => rollback.mutate(v.version)}>
                      {t('Put this version back')}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
          <ErrorText error={rollback.error} />
        </CardContent>
      </Card>
    </div>
  );
}
