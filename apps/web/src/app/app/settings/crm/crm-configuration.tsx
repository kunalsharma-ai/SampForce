'use client';

import { useCanDelete, useHasFeature } from '@/lib/features';
import {
  type CrmStatusKind,
  type CrmStatusRow,
  crmStatusInputSchema,
  departmentInputSchema,
  DESIGNATION_TIERS,
  type DesignationRow,
  type DesignationTier,
  designationInputSchema,
  type DepartmentRow,
  leadNumberingSchema,
  STAGE_PHASES,
  type StageKey,
  type StagePhase,
  STATUS_MEANINGS,
  type StatusMeaning,
} from '@dealflow/types';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Field, Input, Skeleton } from '@dealflow/ui';
import { ArrowDown, ArrowUp, Pencil, Star, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Select } from '@/components/crm/select';
import { PHASE_LABEL, StageChip } from '@/components/crm/stage-chip';
import { StatusChip } from '@/components/crm/status-chip';
import { Segmented } from '@/components/forms/segmented';
import { InfoTip } from '@/components/info-tip';
import { ApiError } from '@/lib/api';
import { useCrmStatuses, useDepartments, useDesignations, useLeadNumbering, useOrgListMutations, useSaveLeadNumbering, useStatusMutations } from '@/lib/company-crm';
import { type MessageKey, useT } from '@/lib/i18n';
import { useCan } from '@/lib/session';
import { AttributionSection, CurrencySection, DashboardsSection, ExportSection, NotificationsSection, OptionsSection } from './admin-sections';
import { CustomFieldsSection } from './custom-fields-section';

type Tab =
  | 'numbering'
  | 'company'
  | 'employee'
  | 'stages'
  | 'departments'
  | 'designations'
  | 'fields'
  | 'rfq-statuses'
  | 'deal-statuses'
  | 'follow-up-types'
  | 'notifications'
  | 'currency'
  | 'exports'
  | 'dashboards'
  | 'attribution';
const TABS: Tab[] = ['numbering', 'company', 'employee', 'stages', 'departments', 'designations', 'fields', 'rfq-statuses', 'deal-statuses', 'follow-up-types', 'notifications', 'currency', 'exports', 'dashboards', 'attribution'];
/** Sections only administrators can open (their settings are not readable by everyone). */
const ADMIN_ONLY: Tab[] = ['notifications', 'exports', 'dashboards', 'attribution'];

export const MEANING_LABELS = {
  NEW: 'New',
  ACTIVE: 'In progress',
  CLIENT: 'Client',
  CONCERN: 'Concern',
  ON_HOLD: 'On hold',
  LOST: 'Lost',
} as const satisfies Record<StatusMeaning, MessageKey>;
export const TIER_LABELS = { EXECUTIVE: 'Executive', MANAGER: 'Manager', SENIOR: 'Senior management' } as const satisfies Record<DesignationTier, MessageKey>;

const errorText = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : null);

export function CrmConfiguration() {
  const t = useT();
  const canManage = useCan('crm:configure');
  const stagesOn = useHasFeature('rfq_contributors');
  const [tab, setTabState] = useState<Tab>('numbering');
  // A link can open a section directly: /app/settings/crm?section=fields (read after mount, so the server render matches).
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('section');
    if (TABS.includes(q as Tab)) setTabState(q as Tab);
  }, []);
  const setTab = (next: Tab) => {
    setTabState(next);
    const url = new URL(window.location.href);
    url.searchParams.set('section', next);
    window.history.replaceState(null, '', url);
  };
  return (
    <div className="space-y-4">
      {!canManage && <p className="text-sm text-muted-foreground">{t('Only owners and administrators can change the CRM configuration.')}</p>}
      <Segmented<Tab>
        legend={t('Section')}
        name="crm-config-tab"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'numbering', label: t('Lead numbers') },
          { value: 'company', label: t('Company statuses') },
          { value: 'employee', label: t('Employee statuses') },
          ...(stagesOn ? ([{ value: 'stages', label: t('Communication stages') }] as const) : []),
          { value: 'departments', label: t('Departments') },
          { value: 'designations', label: t('Designations') },
          { value: 'fields', label: t('Custom fields') },
          { value: 'rfq-statuses', label: t('RFQ statuses') },
          { value: 'deal-statuses', label: t('Deal statuses') },
          { value: 'follow-up-types', label: t('Follow-up categories') },
          { value: 'currency', label: t('Currency') },
          ...(canManage
            ? ([
                { value: 'notifications', label: t('Notifications') },
                { value: 'exports', label: t('Export permissions') },
                { value: 'dashboards', label: t('Dashboards') },
                { value: 'attribution', label: t('Revenue attribution') },
              ] as const)
            : []),
        ]}
      />
      {tab === 'numbering' && <LeadNumbering canManage={canManage} />}
      {tab === 'company' && <Statuses kind="COMPANY" canManage={canManage} />}
      {tab === 'employee' && <Statuses kind="EMPLOYEE" canManage={canManage} />}
      {stagesOn && tab === 'stages' && <Statuses kind="STAGE" canManage={canManage} />}
      {tab === 'departments' && <OrgList kind="departments" canManage={canManage} />}
      {tab === 'designations' && <OrgList kind="designations" canManage={canManage} />}
      {tab === 'fields' && <CustomFieldsSection canManage={canManage} />}
      {tab === 'rfq-statuses' && <OptionsSection kind="RFQ_STATUS" canManage={canManage} />}
      {tab === 'deal-statuses' && <OptionsSection kind="DEAL_STATUS" canManage={canManage} />}
      {tab === 'follow-up-types' && <OptionsSection kind="FOLLOW_UP_TYPE" canManage={canManage} />}
      {tab === 'currency' && <CurrencySection canManage={canManage} />}
      {canManage && tab === 'notifications' && <NotificationsSection />}
      {canManage && tab === 'exports' && <ExportSection />}
      {canManage && tab === 'dashboards' && <DashboardsSection canManage={canManage} />}
      {canManage && tab === 'attribution' && <AttributionSection canManage={canManage} />}
      {!canManage && ADMIN_ONLY.includes(tab) && <p className="text-sm text-muted-foreground">{t('Only owners and administrators can change the CRM configuration.')}</p>}
    </div>
  );
}

// ───────────── Lead numbers ─────────────

function LeadNumbering({ canManage }: { canManage: boolean }) {
  const t = useT();
  const current = useLeadNumbering();
  const save = useSaveLeadNumbering();
  const [draft, setDraft] = useState<{ prefix: string; digits: string; apply: 'new' | 'all' } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  if (current.isPending) return <Skeleton className="h-48" />;
  if (current.error) return <p role="alert" className="text-sm text-critical">{current.error.message}</p>;
  const row = current.data;
  const v = draft ?? { prefix: row.prefix, digits: String(row.digits), apply: 'new' as const };
  const digits = Number(v.digits) || row.digits;
  const preview = `${v.prefix.trim().toUpperCase() || row.prefix}${String(1).padStart(Math.min(Math.max(digits, 1), 8), '0')}`;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          {t('Lead numbers')}
          <InfoTip topic="crm.leadNumbers" />
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <dl className="grid gap-3 text-sm sm:grid-cols-3">
          <div className="rounded-lg border border-border p-3">
            <dt className="text-muted-foreground">{t('Prefix')}</dt>
            <dd className="mt-1 font-mono text-lg font-semibold">{row.prefix}</dd>
            {row.isDefaultPrefix && <dd className="text-xs text-muted-foreground">{t('From your workspace initials')}</dd>}
          </div>
          <div className="rounded-lg border border-border p-3">
            <dt className="text-muted-foreground">{t('Next lead number')}</dt>
            <dd className="mt-1 font-mono text-lg font-semibold">{row.next}</dd>
          </div>
          <div className="rounded-lg border border-border p-3">
            <dt className="text-muted-foreground">{t('Company leads numbered')}</dt>
            <dd className="mt-1 text-lg font-semibold tabular-nums">{row.issued.toLocaleString(t.formatLocale)}</dd>
          </div>
        </dl>
        {canManage && (
          <form
            noValidate
            className="grid gap-4 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              setNotice(null);
              const parsed = leadNumberingSchema.safeParse({ prefix: v.prefix, digits: v.digits, applyToExisting: v.apply === 'all' });
              if (!parsed.success) {
                setError(t.maybe(parsed.error.issues[0]!.message));
                return;
              }
              if (parsed.data.applyToExisting && !window.confirm(t('Change every existing lead number to the new prefix? The order of the numbers stays the same.'))) return;
              setError(null);
              save.mutate(parsed.data, {
                onSuccess: (r) => {
                  setDraft(null);
                  setNotice(t('Saved. The next lead will be {number}.', { number: r.next }));
                },
              });
            }}
          >
            <Field id="lead-prefix" label={t('Prefix')} hint={t('1 to 10 letters, digits or dashes, such as FRFS.')} error={error ?? undefined}>
              <Input value={v.prefix} maxLength={10} className="font-mono uppercase" onChange={(e) => setDraft({ ...v, prefix: e.target.value })} />
            </Field>
            <Field id="lead-digits" label={t('Minimum digits')} hint={t('Numbers grow past this when needed. Preview: {number}', { number: preview })}>
              <Input type="number" min={1} max={8} value={v.digits} onChange={(e) => setDraft({ ...v, digits: e.target.value })} />
            </Field>
            <div className="sm:col-span-2">
              <Segmented<'new' | 'all'>
                legend={t('Apply the change to')}
                name="lead-apply"
                value={v.apply}
                onChange={(apply) => setDraft({ ...v, apply })}
                options={[
                  { value: 'new', label: t('New leads only') },
                  { value: 'all', label: t('New and existing leads') },
                ]}
                description={v.apply === 'all' ? t('Existing numbers are rewritten with the new prefix; FRFS07 becomes ABC07.') : t('Existing numbers stay as they are.')}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
              <Button type="submit" disabled={save.isPending || !draft}>
                {save.isPending ? t('Saving…') : t('Save lead numbers')}
              </Button>
              <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
                {notice}
              </p>
            </div>
            {save.error && (
              <p role="alert" className="text-sm text-critical sm:col-span-2">
                {errorText(save.error)}
              </p>
            )}
          </form>
        )}
      </CardContent>
    </Card>
  );
}

// ───────────── Statuses ─────────────

type StatusDraft = { name: string; color: string; meaning: StatusMeaning; description: string; phase?: StagePhase };
const EMPTY_STATUS: StatusDraft = { name: '', color: '#3b82f6', meaning: 'ACTIVE', description: '' };
const EMPTY_STAGE: StatusDraft = { ...EMPTY_STATUS, color: '#0891b2', phase: 'DISCUSSION' };

function Statuses({ kind, canManage }: { kind: CrmStatusKind; canManage: boolean }) {
  const mayDelete = useCanDelete('crm_configuration');
  const t = useT();
  const list = useCrmStatuses(kind);
  const m = useStatusMutations(kind);
  const [editing, setEditing] = useState<CrmStatusRow | null>(null);
  const stage = kind === 'STAGE';
  const title = kind === 'COMPANY' ? t('Company statuses') : stage ? t('Communication stages') : t('Employee statuses');
  const rows = list.data ?? [];
  const move = (i: number, by: -1 | 1) => {
    const ids = rows.map((r) => r.id);
    [ids[i], ids[i + by]] = [ids[i + by]!, ids[i]!];
    m.reorder.mutate(ids);
  };
  const failure = m.update.error ?? m.reorder.error ?? m.remove.error;

  return (
    <div className="space-y-4">
      {canManage && <StatusForm key={editing?.id ?? `new-${kind}`} kind={kind} editing={editing} onDone={() => setEditing(null)} />}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            {title}
            <InfoTip topic="crm.statuses" />
          </CardTitle>
        </CardHeader>
        <CardContent>
          {list.isPending ? (
            <Skeleton className="h-64" />
          ) : list.error ? (
            <p role="alert" className="text-sm text-critical">
              {list.error.message}
            </p>
          ) : (
            <ol className="divide-y divide-border" aria-label={title}>
              {rows.map((row, i) => (
                <li key={row.id} className={`flex flex-wrap items-center gap-3 py-2.5 text-sm ${row.archived ? 'opacity-60' : ''}`}>
                  <span className="w-6 text-end text-xs tabular-nums text-muted-foreground">{i + 1}</span>
                  {stage ? <StageChip stage={{ key: (row.key ?? null) as StageKey | null, name: row.name, color: row.color, phase: (row.phase ?? 'DISCUSSION') as StagePhase }} /> : <StatusChip status={row} />}
                  <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                    <span className="text-xs text-muted-foreground">{stage && row.phase ? t(PHASE_LABEL[row.phase as StagePhase]) : t(MEANING_LABELS[row.meaning])}</span>
                    {row.isDefault && <Badge>{t('Default for new records')}</Badge>}
                    {row.archived && <Badge>{t('Deactivated')}</Badge>}
                    <span className="text-xs text-muted-foreground">· {t.plural('count.records', row.inUse)}</span>
                  </span>
                  {canManage && (
                    <span className="flex gap-0.5">
                      <Button variant="ghost" size="icon" aria-label={t('Move {name} up', { name: t.maybe(row.name) })} disabled={i === 0 || m.reorder.isPending} onClick={() => move(i, -1)}>
                        <ArrowUp aria-hidden />
                      </Button>
                      <Button variant="ghost" size="icon" aria-label={t('Move {name} down', { name: t.maybe(row.name) })} disabled={i === rows.length - 1 || m.reorder.isPending} onClick={() => move(i, 1)}>
                        <ArrowDown aria-hidden />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t('Make {name} the default', { name: t.maybe(row.name) })}
                        disabled={row.isDefault || row.archived || m.update.isPending}
                        onClick={() => m.update.mutate({ id: row.id, input: { isDefault: true } })}
                      >
                        <Star aria-hidden />
                      </Button>
                      <Button variant="ghost" size="icon" aria-label={t('Edit {name}', { name: t.maybe(row.name) })} onClick={() => setEditing(row)}>
                        <Pencil aria-hidden />
                      </Button>
                      {mayDelete && (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={t('Delete {name}', { name: t.maybe(row.name) })}
                          disabled={row.isDefault || m.remove.isPending}
                          onClick={() => {
                            if (row.inUse > 0) {
                              if (window.confirm(t('{count} records have this status, so it cannot be deleted. Deactivate it instead? Records keep it, but it can no longer be picked.', { count: row.inUse })))
                                m.update.mutate({ id: row.id, input: { archived: true } });
                            } else if (window.confirm(t('Delete {name}?', { name: t.maybe(row.name) }))) m.remove.mutate(row.id);
                          }}
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
          {failure && (
            <p role="alert" className="mt-2 text-sm text-critical">
              {errorText(failure)}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatusForm({ kind, editing, onDone }: { kind: CrmStatusKind; editing: CrmStatusRow | null; onDone: () => void }) {
  const t = useT();
  const m = useStatusMutations(kind);
  const stage = kind === 'STAGE';
  const empty = stage ? EMPTY_STAGE : EMPTY_STATUS;
  const [v, setV] = useState<StatusDraft>(
    editing ? { name: editing.name, color: editing.color, meaning: editing.meaning, description: editing.description ?? '', ...(stage ? { phase: (editing.phase ?? 'DISCUSSION') as StagePhase } : {}) } : empty,
  );
  const [archived, setArchived] = useState(editing?.archived ?? false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const pending = m.create.isPending || m.update.isPending;
  const failure = editing ? m.update.error : m.create.error;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{editing ? t('Edit {name}', { name: t.maybe(editing.name) }) : stage ? t('Add a communication stage') : t('Add a status')}</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          noValidate
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            setNotice(null);
            const parsed = crmStatusInputSchema.safeParse({ kind, ...v, archived });
            if (!parsed.success) {
              setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), t.maybe(i.message)])));
              return;
            }
            setErrors({});
            const { kind: _kind, ...input } = parsed.data;
            const done = (row: CrmStatusRow) => {
              setNotice(editing ? t('Saved {name}.', { name: t.maybe(row.name) }) : t('Added {name}.', { name: t.maybe(row.name) }));
              if (editing) onDone();
              else setV(empty);
            };
            if (editing) m.update.mutate({ id: editing.id, input }, { onSuccess: done });
            else m.create.mutate(parsed.data, { onSuccess: done });
          }}
        >
          <Field id="status-name" label={t('Name')} error={errors.name}>
            <Input value={v.name} maxLength={120} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder={t('For example: Proposal Sent')} />
          </Field>
          <div className="flex items-end gap-2">
            <input
              type="color"
              aria-label={t('Pick a colour')}
              value={/^#[0-9a-f]{6}$/i.test(v.color) ? v.color : '#000000'}
              onChange={(e) => setV({ ...v, color: e.target.value })}
              className="mb-0.5 h-9 w-12 shrink-0 cursor-pointer rounded border border-border bg-transparent"
            />
            <div className="min-w-0 flex-1">
              <Field id="status-color" label={t('Colour')} error={errors.color}>
                <Input value={v.color} maxLength={7} className="font-mono" onChange={(e) => setV({ ...v, color: e.target.value })} />
              </Field>
            </div>
            {stage ? (
              <StageChip className="mb-2.5" stage={{ key: (editing?.key ?? null) as StageKey | null, name: v.name || t('Preview'), color: /^#[0-9a-f]{6}$/i.test(v.color) ? v.color : '#9ca3af', phase: v.phase ?? 'DISCUSSION' }} />
            ) : (
              <StatusChip className="mb-2.5" status={{ name: v.name || t('Preview'), color: /^#[0-9a-f]{6}$/i.test(v.color) ? v.color : '#9ca3af' }} />
            )}
          </div>
          {stage ? (
            <Field id="status-phase" label={t('Part of')} hint={t('The employee activity filters and automatic moves go by this.')}>
              <Select value={v.phase ?? 'DISCUSSION'} disabled={!!editing?.key} onChange={(e) => setV({ ...v, phase: e.target.value as StagePhase })}>
                {STAGE_PHASES.map((p) => (
                  <option key={p} value={p}>
                    {t(PHASE_LABEL[p])}
                  </option>
                ))}
              </Select>
            </Field>
          ) : (
            <Field id="status-meaning" label={t('Counts as')} hint={t('Dashboards and reports group statuses by this.')}>
              <Select value={v.meaning} onChange={(e) => setV({ ...v, meaning: e.target.value as StatusMeaning })}>
                {STATUS_MEANINGS.map((s) => (
                  <option key={s} value={s}>
                    {t(MEANING_LABELS[s])}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field id="status-description" label={t('Description')} hint={t('Optional')}>
            <Input value={v.description} maxLength={500} onChange={(e) => setV({ ...v, description: e.target.value })} />
          </Field>
          {editing && (
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input type="checkbox" className="size-4 accent-[hsl(var(--primary))]" checked={archived} disabled={editing.isDefault} onChange={(e) => setArchived(e.target.checked)} />
              {t('Deactivated: records keep it, but it can no longer be picked')}
            </label>
          )}
          <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
            <Button type="submit" disabled={pending}>
              {pending ? t('Saving…') : editing ? t('Save changes') : t('Add status')}
            </Button>
            {editing && (
              <Button type="button" variant="ghost" onClick={onDone}>
                {t('Cancel')}
              </Button>
            )}
            <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
              {notice}
            </p>
          </div>
          {failure && (
            <p role="alert" className="text-sm text-critical sm:col-span-2">
              {errorText(failure)}
            </p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}

// ───────────── Departments and designations ─────────────

type OrgRow = DepartmentRow | DesignationRow;

function OrgList({ kind, canManage }: { kind: 'departments' | 'designations'; canManage: boolean }) {
  const mayDelete = useCanDelete('crm_configuration');
  const t = useT();
  const departments = useDepartments();
  const designations = useDesignations();
  const list = kind === 'departments' ? departments : designations;
  const m = useOrgListMutations(kind);
  const [editing, setEditing] = useState<OrgRow | null>(null);
  const title = kind === 'departments' ? t('Departments') : t('Designations');

  return (
    <div className="space-y-4">
      {canManage && <OrgForm key={editing?.id ?? `new-${kind}`} kind={kind} editing={editing} onDone={() => setEditing(null)} />}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            {title}
            {kind === 'departments' ? <InfoTip topic="crm.departments" /> : <InfoTip topic="crm.designations" />}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {list.isPending ? (
            <Skeleton className="h-40" />
          ) : list.error ? (
            <p role="alert" className="text-sm text-critical">
              {list.error.message}
            </p>
          ) : list.data.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('None yet.')}</p>
          ) : (
            <ul className="divide-y divide-border" aria-label={title}>
              {list.data.map((row) => (
                <li key={row.id} className={`flex flex-wrap items-center gap-2 py-2.5 text-sm ${row.archived ? 'opacity-60' : ''}`}>
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{t.maybe(row.name)}</span>
                    {kind === 'designations' && <Badge className="ms-2">{t(TIER_LABELS[(row as DesignationRow).tier])}</Badge>}
                    {row.archived && <Badge className="ms-2">{t('Deactivated')}</Badge>}
                    <span className="ms-2 text-xs text-muted-foreground">{t.plural('count.members', row.members)}</span>
                    {row.description && <span className="block text-xs text-muted-foreground">{row.description}</span>}
                  </span>
                  {canManage && (
                    <span className="flex gap-0.5">
                      <Button variant="ghost" size="icon" aria-label={t('Edit {name}', { name: t.maybe(row.name) })} onClick={() => setEditing(row)}>
                        <Pencil aria-hidden />
                      </Button>
                      {mayDelete && (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={t('Delete {name}', { name: t.maybe(row.name) })}
                          disabled={m.remove.isPending}
                          onClick={() => window.confirm(t('Delete {name}?', { name: t.maybe(row.name) })) && m.remove.mutate(row.id)}
                        >
                          <Trash2 aria-hidden />
                        </Button>
                      )}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {m.remove.error && (
            <p role="alert" className="mt-2 text-sm text-critical">
              {errorText(m.remove.error)}
            </p>
          )}
          {kind === 'designations' && <p className="mt-3 text-xs text-muted-foreground">{t('The level decides which Command Center a person sees. What they may do still comes from their role.')}</p>}
        </CardContent>
      </Card>
    </div>
  );
}

function OrgForm({ kind, editing, onDone }: { kind: 'departments' | 'designations'; editing: OrgRow | null; onDone: () => void }) {
  const t = useT();
  const m = useOrgListMutations(kind);
  const [v, setV] = useState({
    name: editing?.name ?? '',
    description: editing?.description ?? '',
    tier: (editing && 'tier' in editing ? editing.tier : 'EXECUTIVE') as DesignationTier,
    archived: editing?.archived ?? false,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const isDesignation = kind === 'designations';

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{editing ? t('Edit {name}', { name: t.maybe(editing.name) }) : isDesignation ? t('Add a designation') : t('Add a department')}</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          noValidate
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            setNotice(null);
            const parsed = isDesignation ? designationInputSchema.safeParse(v) : departmentInputSchema.safeParse({ name: v.name, description: v.description, archived: v.archived });
            if (!parsed.success) {
              setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), t.maybe(i.message)])));
              return;
            }
            setErrors({});
            m.save.mutate(
              { id: editing?.id ?? null, input: parsed.data },
              {
                onSuccess: () => {
                  setNotice(editing ? t('Saved {name}.', { name: v.name }) : t('Added {name}.', { name: v.name }));
                  if (editing) onDone();
                  else setV({ name: '', description: '', tier: 'EXECUTIVE', archived: false });
                },
              },
            );
          }}
        >
          <Field id={`${kind}-name`} label={t('Name')} error={errors.name}>
            <Input value={v.name} maxLength={120} onChange={(e) => setV({ ...v, name: e.target.value })} />
          </Field>
          {isDesignation ? (
            <Field id="designation-tier" label={t('Dashboard level')} hint={t('Which Command Center people with this designation see.')}>
              <Select value={v.tier} onChange={(e) => setV({ ...v, tier: e.target.value as DesignationTier })}>
                {DESIGNATION_TIERS.map((tier) => (
                  <option key={tier} value={tier}>
                    {t(TIER_LABELS[tier])}
                  </option>
                ))}
              </Select>
            </Field>
          ) : (
            <Field id="departments-description" label={t('Description')} hint={t('Optional')}>
              <Input value={v.description} maxLength={500} onChange={(e) => setV({ ...v, description: e.target.value })} />
            </Field>
          )}
          {isDesignation && (
            <Field id="designations-description" label={t('Description')} hint={t('Optional')}>
              <Input value={v.description} maxLength={500} onChange={(e) => setV({ ...v, description: e.target.value })} />
            </Field>
          )}
          {editing && (
            <label className="flex items-center gap-2 self-end text-sm">
              <input type="checkbox" className="size-4 accent-[hsl(var(--primary))]" checked={v.archived} onChange={(e) => setV({ ...v, archived: e.target.checked })} />
              {t('Deactivated: no longer offered for new choices')}
            </label>
          )}
          <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
            <Button type="submit" disabled={m.save.isPending}>
              {m.save.isPending ? t('Saving…') : editing ? t('Save changes') : t('Add')}
            </Button>
            {editing && (
              <Button type="button" variant="ghost" onClick={onDone}>
                {t('Cancel')}
              </Button>
            )}
            <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
              {notice}
            </p>
          </div>
          {m.save.error && (
            <p role="alert" className="text-sm text-critical sm:col-span-2">
              {errorText(m.save.error)}
            </p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
