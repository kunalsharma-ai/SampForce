'use client';

import { CADENCE_CHANNELS, CADENCE_MAX_FOLLOW_UPS, CADENCE_MAX_INTERVAL_DAYS, CADENCE_MAX_RULES, type CadenceChannel, type CadenceRule, type CompanyRow, type FollowUpCadence } from '@dealflow/types';
import { Button, Card, CardContent, CardHeader, CardTitle, Field, Input, Skeleton } from '@dealflow/ui';
import { Building2, Trash2, Users } from 'lucide-react';
import { useState } from 'react';
import { InfoTip } from '@/components/info-tip';
import { Select } from '@/components/crm/select';
import { FOLLOW_UP_TYPE_LABEL } from '@/components/crm/work-labels';
import { ApiError } from '@/lib/api';
import { useRecordList } from '@/lib/crm';
import { useCadenceSettings } from '@/lib/follow-up-cadence';
import { relativeTime } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { useWorkspaceTree } from '@/lib/workspaces';

const inRange = (n: number, max: number) => Number.isInteger(n) && n >= 1 && n <= max;

/**
 * The follow-up cadence (redesign R3, ADR 0083; ADR 0096): how long after the first email a contact moves into
 * Follow-ups, how many follow-ups they get and how many days apart, how the follow-ups are made, and different periods
 * for some companies or teams. Everyone can read it; only the Super Workspace's administrators change it.
 */
export function FollowUpCadenceSection() {
  const t = useT();
  const { query, save } = useCadenceSettings();
  const [draft, setDraft] = useState<FollowUpCadence | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const tree = useWorkspaceTree();
  if (query.isPending) return <Skeleton className="h-64" />;
  if (query.error) return <p role="alert" className="text-sm text-critical">{query.error.message}</p>;
  const s = query.data;
  const v: FollowUpCadence = draft ?? { followUps: s.followUps, intervalDays: s.intervalDays, firstFollowUpDays: s.firstFollowUpDays, channel: s.channel, rules: s.rules };
  const set = (patch: Partial<FollowUpCadence>) => {
    setNotice(null);
    setDraft({ ...v, ...patch });
  };
  const first = v.firstFollowUpDays ?? v.intervalDays;
  const rulesValid = v.rules.every((r) => r.targetId && inRange(r.firstFollowUpDays, CADENCE_MAX_INTERVAL_DAYS) && inRange(r.intervalDays, CADENCE_MAX_INTERVAL_DAYS) && inRange(r.followUps, CADENCE_MAX_FOLLOW_UPS));
  const valid =
    inRange(v.followUps, CADENCE_MAX_FOLLOW_UPS) && inRange(v.intervalDays, CADENCE_MAX_INTERVAL_DAYS) && (v.firstFollowUpDays === null || inRange(v.firstFollowUpDays, CADENCE_MAX_INTERVAL_DAYS)) && rulesValid;
  const total = first + (v.followUps - 1) * v.intervalDays;
  const teams = (tree.data?.workspaces ?? []).filter((w) => w.level === 'MANAGER');
  const nameOf = (r: CadenceRule) => names[r.targetId] ?? s.ruleTargets[r.targetId] ?? teams.find((w) => w.id === r.targetId)?.name ?? null;
  const setRule = (i: number, patch: Partial<CadenceRule>) => set({ rules: v.rules.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  const addRule = (scope: CadenceRule['scope']) => set({ rules: [...v.rules, { scope, targetId: '', firstFollowUpDays: first, intervalDays: v.intervalDays, followUps: v.followUps, channel: v.channel }] });
  const taken = new Set(v.rules.map((r) => `${r.scope}:${r.targetId}`));

  return (
    <form
      className="space-y-4"
      data-cadence-settings
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        save.mutate(v, {
          onSuccess: () => {
            setDraft(null);
            setNotice(t('Saved.'));
          },
        });
      }}
    >
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            {t('Follow-up cadence')}
            <InfoTip topic="crm.followUpCadence" />
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">{t('Every new contact starts in First email pending. Once the first email is confirmed as sent, SampForce waits for the follow-up period; if nobody answers, it creates follow-up 1 for the contact owner and the contact moves into Follow-ups. It stops as soon as the contact answers or an RFQ arrives.')}</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="cadence-first" label={t('Days after the first email before follow-up 1')}>
              <Input
                type="number"
                min={1}
                max={CADENCE_MAX_INTERVAL_DAYS}
                step={1}
                value={Number.isNaN(first) ? '' : first}
                disabled={!s.canEdit}
                onChange={(e) => set({ firstFollowUpDays: e.target.valueAsNumber })}
              />
            </Field>
            <Field id="cadence-channel" label={t('Follow-ups are made by')}>
              <Select value={v.channel} disabled={!s.canEdit} onChange={(e) => set({ channel: e.target.value as CadenceChannel })}>
                {CADENCE_CHANNELS.map((c) => (
                  <option key={c} value={c}>
                    {t(FOLLOW_UP_TYPE_LABEL[c])}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="cadence-count" label={t('Follow-ups after the initial email')}>
              <Input type="number" min={1} max={CADENCE_MAX_FOLLOW_UPS} step={1} value={Number.isNaN(v.followUps) ? '' : v.followUps} disabled={!s.canEdit} onChange={(e) => set({ followUps: e.target.valueAsNumber })} />
            </Field>
            <Field id="cadence-days" label={t('Days between follow-ups')}>
              <Input type="number" min={1} max={CADENCE_MAX_INTERVAL_DAYS} step={1} value={Number.isNaN(v.intervalDays) ? '' : v.intervalDays} disabled={!s.canEdit} onChange={(e) => set({ intervalDays: e.target.valueAsNumber })} />
            </Field>
          </div>
          {valid ? (
            <p className="text-sm" data-cadence-summary>
              {t('Follow-up 1 comes {first} days after the first email, then one every {days} days: {count} follow-ups, the last one {total} days after the first email.', { first, days: v.intervalDays, count: v.followUps, total })}
            </p>
          ) : (
            <p role="alert" className="text-sm text-critical">
              {t('Choose 1 to {max} follow-ups, 1 to {days} days apart.', { max: CADENCE_MAX_FOLLOW_UPS, days: CADENCE_MAX_INTERVAL_DAYS })}
            </p>
          )}

          <div className="space-y-3 rounded-xl border border-border p-3" data-cadence-rules>
            <div>
              <h3 className="text-sm font-semibold">{t('Different periods for some companies or teams')}</h3>
              <p className="text-xs text-muted-foreground">{t('A company’s rule wins over its team’s, and a team’s over the organisation’s. A team is a Manager Workspace with the Executive Workspaces below it.')}</p>
            </div>
            {!v.rules.length && <p className="text-sm text-muted-foreground">{t('No rules: every contact follows the organisation’s cadence.')}</p>}
            <ul className="space-y-2">
              {v.rules.map((r, i) => (
                <li key={i} className="grid gap-2 rounded-lg bg-muted/50 p-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.6fr)_repeat(4,minmax(0,1fr))_auto] lg:items-end" data-cadence-rule={r.scope}>
                  {r.scope === 'TEAM' ? (
                    <Field id={`rule-${i}-team`} label={t('Team')}>
                      <Select value={r.targetId} disabled={!s.canEdit} onChange={(e) => setRule(i, { targetId: e.target.value })}>
                        <option value="">{t('Choose a team')}</option>
                        {teams.map((w) => (
                          <option key={w.id} value={w.id} disabled={w.id !== r.targetId && taken.has(`TEAM:${w.id}`)}>
                            {w.name}
                          </option>
                        ))}
                        {r.targetId && !teams.some((w) => w.id === r.targetId) && <option value={r.targetId}>{nameOf(r) ?? t('Deleted team')}</option>}
                      </Select>
                    </Field>
                  ) : (
                    <CompanyField
                      id={`rule-${i}-company`}
                      value={r.targetId ? { id: r.targetId, name: nameOf(r) ?? t('Deleted company') } : null}
                      disabled={!s.canEdit}
                      taken={taken}
                      onPick={(c) => {
                        setNames((n) => ({ ...n, [c.id]: c.name }));
                        setRule(i, { targetId: c.id });
                      }}
                    />
                  )}
                  <Field id={`rule-${i}-first`} label={t('Days to follow-up 1')}>
                    <Input type="number" min={1} max={CADENCE_MAX_INTERVAL_DAYS} value={Number.isNaN(r.firstFollowUpDays) ? '' : r.firstFollowUpDays} disabled={!s.canEdit} onChange={(e) => setRule(i, { firstFollowUpDays: e.target.valueAsNumber })} />
                  </Field>
                  <Field id={`rule-${i}-interval`} label={t('Days apart')}>
                    <Input type="number" min={1} max={CADENCE_MAX_INTERVAL_DAYS} value={Number.isNaN(r.intervalDays) ? '' : r.intervalDays} disabled={!s.canEdit} onChange={(e) => setRule(i, { intervalDays: e.target.valueAsNumber })} />
                  </Field>
                  <Field id={`rule-${i}-count`} label={t('Follow-ups')}>
                    <Input type="number" min={1} max={CADENCE_MAX_FOLLOW_UPS} value={Number.isNaN(r.followUps) ? '' : r.followUps} disabled={!s.canEdit} onChange={(e) => setRule(i, { followUps: e.target.valueAsNumber })} />
                  </Field>
                  <Field id={`rule-${i}-channel`} label={t('Made by')}>
                    <Select value={r.channel} disabled={!s.canEdit} onChange={(e) => setRule(i, { channel: e.target.value as CadenceChannel })}>
                      {CADENCE_CHANNELS.map((c) => (
                        <option key={c} value={c}>
                          {t(FOLLOW_UP_TYPE_LABEL[c])}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  {s.canEdit && (
                    <Button type="button" variant="ghost" size="sm" className="justify-self-start" onClick={() => set({ rules: v.rules.filter((_, j) => j !== i) })} aria-label={t('Remove this rule')}>
                      <Trash2 aria-hidden className="size-4" />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
            {s.canEdit && v.rules.length < CADENCE_MAX_RULES && (
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => addRule('COMPANY')}>
                  <Building2 aria-hidden className="size-4" />
                  {t('Add a company rule')}
                </Button>
                {teams.length > 0 && (
                  <Button type="button" variant="outline" size="sm" onClick={() => addRule('TEAM')}>
                    <Users aria-hidden className="size-4" />
                    {t('Add a team rule')}
                  </Button>
                )}
              </div>
            )}
            {!rulesValid && <p role="alert" className="text-sm text-critical">{t('Pick a company or team for each rule, with 1 to {days} days.', { days: CADENCE_MAX_INTERVAL_DAYS })}</p>}
          </div>

          {!s.canEdit && <p className="text-sm text-muted-foreground">{t('Only administrators of the Super Workspace can change the follow-up cadence.')}</p>}
          {s.updatedBy && <p className="text-xs text-muted-foreground">{t('Last changed by {name} {time}', { name: s.updatedBy.name, time: s.updatedAt ? relativeTime(s.updatedAt) : '' })}</p>}
        </CardContent>
      </Card>
      {s.canEdit && (
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={!draft || !valid || save.isPending}>
            {save.isPending ? t('Saving…') : t('Save')}
          </Button>
          <p role="status" aria-live="polite" className="text-sm text-muted-foreground">{notice}</p>
          {save.error ? <p role="alert" className="text-sm text-critical">{save.error instanceof ApiError || save.error instanceof Error ? save.error.message : null}</p> : null}
        </div>
      )}
    </form>
  );
}

/** Finds a company by name for a rule. */
function CompanyField({ id, value, disabled, taken, onPick }: { id: string; value: { id: string; name: string } | null; disabled: boolean; taken: Set<string>; onPick: (c: { id: string; name: string }) => void }) {
  const t = useT();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(!value);
  const found = useRecordList<CompanyRow>('companies', { q: q.trim() || undefined, pageSize: 8, sort: 'name', order: 'asc' }, open && !disabled);
  if (value && !open) {
    return (
      <div className="min-w-0 space-y-1.5">
        <p className="text-sm font-medium">{t('Company')}</p>
        <div className="flex h-10 min-w-0 items-center gap-2 rounded-md border border-input bg-surface px-3 text-sm">
          <span className="min-w-0 flex-1 truncate">{value.name}</span>
          {!disabled && (
            <button type="button" className="shrink-0 text-xs font-medium text-primary hover:underline" onClick={() => setOpen(true)}>
              {t('Change')}
            </button>
          )}
        </div>
      </div>
    );
  }
  return (
    <div className="min-w-0 space-y-1">
      <Field id={id} label={t('Company')}>
        <Input type="search" value={q} placeholder={t('Search companies')} disabled={disabled} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
      </Field>
      <ul className="max-h-40 overflow-y-auto rounded-md border border-border bg-surface text-sm" aria-label={t('Companies')}>
        {(found.data?.items ?? []).map((c) => (
          <li key={c.id}>
            <button
              type="button"
              disabled={taken.has(`COMPANY:${c.id}`)}
              className="block w-full truncate px-3 py-1.5 text-start hover:bg-muted disabled:opacity-50"
              onClick={() => {
                onPick({ id: c.id, name: c.name });
                setOpen(false);
                setQ('');
              }}
            >
              {c.name}
            </button>
          </li>
        ))}
        {found.data && !found.data.items.length && <li className="px-3 py-1.5 text-muted-foreground">{t('No companies found')}</li>}
      </ul>
    </div>
  );
}
