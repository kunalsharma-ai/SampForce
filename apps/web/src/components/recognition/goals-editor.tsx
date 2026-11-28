'use client';

import { GOAL_MEASURE_LABEL, GOAL_PER, GOAL_PER_LABEL, type GoalInput, type GoalMeasure, type GoalProgress, goalUnit, type StaffCard } from '@dealflow/types';
import { Button, Input } from '@dealflow/ui';
import { Plus, Trash2 } from 'lucide-react';
import { Select } from '@/components/crm/select';
import { useT } from '@/lib/i18n';

/** A goal as typed in a form: the amount stays text until it is sent. */
export interface GoalDraft {
  id?: string;
  measure: GoalMeasure;
  amount: string;
  per: 'PERIOD' | 'DAY';
  label: string;
}

export function draftsOf(goals: GoalProgress[]): GoalDraft[] {
  return goals.map((g) => ({ id: g.id, measure: g.measure, amount: String(g.amount), per: g.per, label: g.label === GOAL_MEASURE_LABEL[g.measure] ? '' : g.label }));
}

export function goalsOf(drafts: GoalDraft[]): GoalInput[] {
  return drafts.map((d) => ({ ...(d.id ? { id: d.id } : {}), measure: d.measure, amount: Number(d.amount), per: goalUnit(d.measure) === 'percent' ? 'PERIOD' : d.per, ...(d.label.trim() ? { label: d.label.trim() } : {}) }));
}

/** Several goals, each a measure counted from the records (or a manager's evaluation on a plan), an amount and a period. */
export function GoalsEditor({ value, onChange, measures }: { value: GoalDraft[]; onChange: (v: GoalDraft[]) => void; measures: readonly GoalMeasure[] }) {
  const t = useT();
  const set = (i: number, patch: Partial<GoalDraft>) => onChange(value.map((g, j) => (j === i ? { ...g, ...patch } : g)));
  return (
    <fieldset className="space-y-2" data-goals-editor>
      <legend className="text-sm font-medium">{t('Goals')}</legend>
      {value.map((g, i) => {
        const percent = goalUnit(g.measure) === 'percent';
        return (
          <div key={g.id ?? i} className="grid gap-2 rounded-lg border border-border p-2 sm:grid-cols-[minmax(0,1.6fr)_6rem_minmax(0,1fr)_auto]" data-goal-row={i}>
            <Select aria-label={t('Measure')} value={g.measure} onChange={(e) => set(i, { measure: e.target.value as GoalMeasure, per: goalUnit(e.target.value as GoalMeasure) === 'percent' ? 'PERIOD' : g.per })}>
              {measures.map((m) => (
                <option key={m} value={m}>
                  {t.maybe(GOAL_MEASURE_LABEL[m])}
                </option>
              ))}
            </Select>
            <Input aria-label={percent ? t('Percentage') : t('Amount')} inputMode="decimal" value={g.amount} onChange={(e) => set(i, { amount: e.target.value })} />
            <Select aria-label={t('Period')} value={percent ? 'PERIOD' : g.per} disabled={percent} onChange={(e) => set(i, { per: e.target.value as 'PERIOD' | 'DAY' })}>
              {GOAL_PER.map((p) => (
                <option key={p} value={p}>
                  {t.maybe(GOAL_PER_LABEL[p])}
                </option>
              ))}
            </Select>
            <Button type="button" size="icon" variant="ghost" aria-label={t('Remove this goal')} disabled={value.length === 1} onClick={() => onChange(value.filter((_, j) => j !== i))}>
              <Trash2 className="size-4" aria-hidden />
            </Button>
            <Input className="sm:col-span-4" aria-label={t('Goal name (optional)')} placeholder={t('Goal name (optional)')} value={g.label} onChange={(e) => set(i, { label: e.target.value })} />
          </div>
        );
      })}
      <Button type="button" variant="outline" size="sm" disabled={value.length >= 10} onClick={() => onChange([...value, { measure: measures.find((m) => !value.some((g) => g.measure === m)) ?? measures[0]!, amount: '10', per: 'PERIOD', label: '' }])}>
        <Plus className="mr-1 size-4" aria-hidden />
        {t('Add a goal')}
      </Button>
    </fieldset>
  );
}

/** A person picker: name, designation and workspace. */
export function PersonSelect({ id, people, value, onChange, disabled }: { id: string; people: StaffCard[]; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const t = useT();
  return (
    <Select id={id} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      <option value="">{t('Choose a person')}</option>
      {people.map((p) => (
        <option key={p.id} value={p.id}>
          {[p.name, p.designation, p.workspace.name].filter(Boolean).join(' · ')}
        </option>
      ))}
    </Select>
  );
}
