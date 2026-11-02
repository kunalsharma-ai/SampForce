'use client';

import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Skeleton } from '@dealflow/ui';
import {
  EMAIL_EVENTS,
  ENROLL_SKIP_LABELS,
  type EmailEvent,
  type EmailCounts,
  type EmailVariant,
  type EmailVersion,
  type EnrollResult,
  type EventRule,
  LEAD_STATUSES,
  RULE_ACTION_LABELS,
  type RuleAction,
  type SequenceRow,
  type SequenceSettings,
  type SequenceStep,
} from '@dealflow/types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, CheckSquare, FlaskConical, GitBranch, Mail, Pause, Play, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useRef, useState } from 'react';
import { Select, Textarea } from '@/components/crm/select';
import { RecordPicker, type PickerValue } from '@/components/crm/record-picker';
import { ErrorText, Field, Tabs } from '@/components/revenue/tabs';
import { api } from '@/lib/api';
import { formatDate, titleCase } from '@/lib/crm';
import { useSegments } from '@/lib/revenue';
import { ENROLLMENT_LABEL, ENROLLMENT_TONE, pct, SEQUENCE_TONE, useEnrollments, useSequence, useSequences, useStepStats, useTemplates } from '@/lib/sequences';
import { useCan, useSession } from '@/lib/session';
import { EmailAssist } from '@/components/ai/email-assist';
import { insertAt, MergeFieldBar, PreviewPanel } from '../merge-fields';
import { inSentence, useT } from '@/lib/i18n';
import { fmtLocale } from '@/lib/i18n/locale';

type Tab = 'steps' | 'rules' | 'settings' | 'people' | 'results';
type Draft = Pick<SequenceRow, 'name' | 'description' | 'steps' | 'rules' | 'settings'>;

/** Short weekday names in the reader's language, Sunday first (index 0 = Sunday, as the API stores them). 2023-01-01 was a Sunday. */
const weekdays = (locale: string) => Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }).format(Date.UTC(2023, 0, 1 + i)));
const newId = () => `s${Math.random().toString(36).slice(2, 8)}`;

export function SequenceEditor({ id }: { id: string }) {
  const seq = useSequence(id);
  if (seq.isPending) return <Skeleton className="h-96" />;
  if (seq.error) return <ErrorText error={seq.error} />;
  return <Editor key={seq.data.updatedAt} seq={seq.data} />;
}

function Editor({ seq }: { seq: SequenceRow }) {
  const t = useT();
  const qc = useQueryClient();
  const me = useSession().data;
  const canManage = useCan('marketing:manage');
  const canEdit = useCan('sequences:write') && (seq.owner?.id === me?.user.id || canManage);
  const [tab, setTab] = useState<Tab>('steps');
  const [draft, setDraft] = useState<Draft>({ name: seq.name, description: seq.description, steps: seq.steps, rules: seq.rules, settings: seq.settings });
  const dirty = JSON.stringify(draft) !== JSON.stringify({ name: seq.name, description: seq.description, steps: seq.steps, rules: seq.rules, settings: seq.settings });
  const refresh = () => qc.invalidateQueries({ queryKey: ['sequences'] });
  const save = useMutation({ mutationFn: () => api<SequenceRow>(`/sequences/${seq.id}`, { method: 'PUT', json: draft }), onSuccess: refresh });
  const status = useMutation({ mutationFn: (s: 'ACTIVE' | 'PAUSED' | 'ARCHIVED') => api(`/sequences/${seq.id}/status`, { method: 'POST', json: { status: s } }), onSuccess: refresh });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <Link href="/app/sequences" className="text-xs text-muted-foreground hover:underline">
            ← {t('All sequences')}
          </Link>
          <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold">
            {seq.name} <Badge tone={SEQUENCE_TONE[seq.status]}>{t.maybe(titleCase(seq.status))}</Badge>
          </h1>
          <p className="text-sm text-muted-foreground">
            {t('In progress: {active} · sent: {sent} · replied: {replied} ({rate})', { active: seq.stats.active, sent: seq.stats.sent, replied: seq.stats.replied, rate: pct(seq.stats.replied, seq.stats.sent) })}
          </p>
        </div>
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            {dirty && (
              <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>
                {t('Save changes')}
              </Button>
            )}
            {seq.status !== 'ACTIVE' && seq.status !== 'ARCHIVED' && (
              <Button size="sm" variant="accent" onClick={() => status.mutate('ACTIVE')} disabled={dirty || status.isPending}>
                <Play aria-hidden /> {t('Start sequence')}
              </Button>
            )}
            {seq.status === 'ACTIVE' && (
              <Button size="sm" variant="outline" onClick={() => status.mutate('PAUSED')} disabled={status.isPending}>
                <Pause aria-hidden /> {t('Pause sending')}
              </Button>
            )}
            {seq.status !== 'ARCHIVED' && (
              <Button size="sm" variant="ghost" onClick={() => window.confirm(t('Archive this sequence? Everyone still in it stops.')) && status.mutate('ARCHIVED')}>
                {t('Archive')}
              </Button>
            )}
          </div>
        )}
      </div>
      <ErrorText error={save.error ?? status.error} />
      {dirty && <p className="text-xs text-warning">{seq.status === 'DRAFT' ? t('You have unsaved changes. Save before starting the sequence.') : t('You have unsaved changes.')}</p>}

      <Tabs<Tab>
        label={t('Sequence')}
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'steps', label: t('Steps ({count})', { count: draft.steps.length }) },
          { key: 'rules', label: t('When they respond') },
          { key: 'settings', label: t('Sending') },
          { key: 'people', label: t('People ({count})', { count: seq.stats.active }) },
          { key: 'results', label: t('Results') },
        ]}
      />
      {tab === 'steps' && <StepsTab draft={draft} setDraft={setDraft} readOnly={!canEdit} test={canEdit ? { seqId: seq.id, dirty } : undefined} />}
      {tab === 'rules' && <RulesTab seqId={seq.id} rules={draft.rules} onChange={(rules) => setDraft({ ...draft, rules })} readOnly={!canEdit} />}
      {tab === 'settings' && <SettingsTab draft={draft} setDraft={setDraft} readOnly={!canEdit} />}
      {tab === 'people' && <PeopleTab seq={seq} />}
      {tab === 'results' && <ResultsTab seq={seq} />}
    </div>
  );
}

// ───────────── Steps ─────────────

type TestTarget = { seqId: string; dirty: boolean };

function StepsTab({ draft, setDraft, readOnly, test }: { draft: Draft; setDraft: (d: Draft) => void; readOnly: boolean; test?: TestTarget }) {
  const t = useT();
  const steps = draft.steps;
  const set = (i: number, s: SequenceStep) => setDraft({ ...draft, steps: steps.map((x, j) => (j === i ? s : x)) });
  const move = (i: number, by: number) => {
    const next = [...steps];
    const [s] = next.splice(i, 1);
    next.splice(i + by, 0, s!);
    setDraft({ ...draft, steps: next });
  };
  const add = (type: SequenceStep['type']) => {
    const id = newId();
    const step: SequenceStep =
      type === 'email' ? { id, type, delayDays: 3, templateId: null, subject: '', body: '', variantB: null }
        : type === 'task' ? { id, type, delayDays: 0, title: t('Call {{first_name}}') }
          : { id, type, delayDays: 2, check: 'replied', ifYes: 'stop', ifNo: 'next' };
    setDraft({ ...draft, steps: [...steps, step] });
  };
  let day = 0;
  return (
    <div className="space-y-3">
      <Field id="seq-name" label={t('Name')}>
        <Input id="seq-name" value={draft.name} maxLength={120} disabled={readOnly} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
      </Field>
      <ol className="space-y-3">
        {steps.map((s, i) => {
          day += s.delayDays;
          return (
            <li key={s.id}>
              <StepCard step={s} index={i} day={day} steps={steps} readOnly={readOnly} test={test} onChange={(n) => set(i, n)}
                onUp={i > 0 ? () => move(i, -1) : undefined}
                onDown={i < steps.length - 1 ? () => move(i, 1) : undefined}
                onDelete={() => setDraft({ ...draft, steps: steps.filter((_, j) => j !== i) })}
              />
            </li>
          );
        })}
      </ol>
      {!readOnly && steps.length < 20 && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => add('email')}>
            <Mail aria-hidden /> {t('Add email')}
          </Button>
          <Button size="sm" variant="outline" onClick={() => add('task')}>
            <CheckSquare aria-hidden /> {t('Add task')}
          </Button>
          <Button size="sm" variant="outline" onClick={() => add('condition')}>
            <GitBranch aria-hidden /> {t('Add check')}
          </Button>
        </div>
      )}
    </div>
  );
}

const STEP_ICON = { email: Mail, task: CheckSquare, condition: GitBranch };
const STEP_LABEL = { email: 'Email', task: 'Task for you', condition: 'Check' } as const;

/** Rule card titles, one sentence per event so each language can word it naturally. */
const WHEN = {
  replied: 'When someone replies',
  opened: 'When someone opens an email (approximate)',
  clicked: 'When someone clicks a link',
  bounced: 'When an email bounces',
  unsubscribed: 'When someone unsubscribes',
} as const satisfies Record<EmailEvent, string>;

function StepCard({ step, index, day, steps, readOnly, test, onChange, onUp, onDown, onDelete }: {
  step: SequenceStep; index: number; day: number; steps: SequenceStep[]; readOnly: boolean; test?: TestTarget;
  onChange: (s: SequenceStep) => void; onUp?: () => void; onDown?: () => void; onDelete: () => void;
}) {
  const t = useT();
  const Icon = STEP_ICON[step.type];
  const delayId = `delay-${step.id}`;
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center gap-2 space-y-0 pb-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">{index + 1}</span>
        <Icon className="h-4 w-4 text-muted-foreground" aria-hidden />
        <CardTitle className="text-sm">{t(STEP_LABEL[step.type])}</CardTitle>
        <span className="text-xs text-muted-foreground">{t('Day {day}', { day })}</span>
        {!readOnly && (
          <div className="ms-auto flex gap-1">
            <Button size="icon" variant="ghost" className="h-8 w-8" aria-label={t('Move step {n} up', { n: index + 1 })} disabled={!onUp} onClick={onUp}>
              <ArrowUp className="h-4 w-4" aria-hidden />
            </Button>
            <Button size="icon" variant="ghost" className="h-8 w-8" aria-label={t('Move step {n} down', { n: index + 1 })} disabled={!onDown} onClick={onDown}>
              <ArrowDown className="h-4 w-4" aria-hidden />
            </Button>
            <Button size="icon" variant="ghost" className="h-8 w-8" aria-label={t('Delete step {n}', { n: index + 1 })} onClick={onDelete}>
              <Trash2 className="h-4 w-4" aria-hidden />
            </Button>
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <label htmlFor={delayId}>{t('Wait')}</label>
          <Input id={delayId} type="number" min={0} max={60} className="h-8 w-20" disabled={readOnly} value={step.delayDays} onChange={(e) => onChange({ ...step, delayDays: Math.max(0, Math.min(60, Number(e.target.value) || 0)) })} />
          <span className="text-muted-foreground">{index === 0 ? t('days after enrolment') : t('days after the previous step')}</span>
        </div>
        {step.type === 'email' && <EmailStep step={step} readOnly={readOnly} test={test} onChange={onChange} />}
        {step.type === 'task' && (
          <Field id={`task-${step.id}`} label={t('Task title')} hint={t('Created for the sender, due a day later.')}>
            <Input id={`task-${step.id}`} maxLength={200} disabled={readOnly} value={step.title} onChange={(e) => onChange({ ...step, title: e.target.value })} />
          </Field>
        )}
        {step.type === 'condition' && (
          <div className="grid gap-2 sm:grid-cols-3">
            <Field id={`check-${step.id}`} label={t('Has the person')}>
              <Select id={`check-${step.id}`} disabled={readOnly} value={step.check} onChange={(e) => onChange({ ...step, check: e.target.value as typeof step.check })}>
                <option value="replied">{t('replied')}</option>
                <option value="opened">{t('opened an email (approximate)')}</option>
                <option value="clicked">{t('clicked a link')}</option>
              </Select>
            </Field>
            <JumpSelect id={`yes-${step.id}`} label={t('If yes')} value={step.ifYes} steps={steps} after={index} readOnly={readOnly} onChange={(ifYes) => onChange({ ...step, ifYes })} />
            <JumpSelect id={`no-${step.id}`} label={t('If no')} value={step.ifNo} steps={steps} after={index} readOnly={readOnly} onChange={(ifNo) => onChange({ ...step, ifNo })} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function JumpSelect({ id, label, value, steps, after, readOnly, onChange }: { id: string; label: string; value: string; steps: SequenceStep[]; after: number; readOnly: boolean; onChange: (v: string) => void }) {
  const t = useT();
  return (
    <Field id={id} label={label}>
      <Select id={id} disabled={readOnly} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="next">{t('Carry on to the next step')}</option>
        <option value="stop">{t('End the sequence for them')}</option>
        {steps.slice(after + 2).map((s, j) => (
          <option key={s.id} value={s.id}>
            {t('Jump to step {n} ({kind})', { n: after + 3 + j, kind: inSentence(t, t(STEP_LABEL[s.type])) })}
          </option>
        ))}
      </Select>
    </Field>
  );
}

type EmailStepT = Extract<SequenceStep, { type: 'email' }>;

function EmailStep({ step, readOnly, test, onChange }: { step: EmailStepT; readOnly: boolean; test?: TestTarget; onChange: (s: SequenceStep) => void }) {
  const t = useT();
  const [shown, setShown] = useState<EmailVariant>('A');
  const variant: EmailVariant = step.variantB ? shown : 'A';
  const version: EmailVersion = variant === 'B' && step.variantB ? step.variantB : step;
  const setVersion = (v: EmailVersion) => onChange(variant === 'B' ? { ...step, variantB: v } : { ...step, ...v });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {step.variantB ? (
          <>
            <div className="inline-flex overflow-hidden rounded-md border border-border" role="group" aria-label={t('Versions of this email')}>
              {(['A', 'B'] as const).map((v) => (
                <button key={v} type="button" aria-pressed={variant === v} onClick={() => setShown(v)}
                  className={`px-3 py-1 text-sm ${variant === v ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}>
                  {t('Version {v}', { v })}
                </button>
              ))}
            </div>
            <span className="text-xs text-muted-foreground">{t('About half the people get each version. The Results tab compares them.')}</span>
            {!readOnly && (
              <Button type="button" size="sm" variant="ghost" className="ms-auto" onClick={() => { setShown('A'); onChange({ ...step, variantB: null }); }}>
                {t('Stop testing, keep version A')}
              </Button>
            )}
          </>
        ) : (
          !readOnly && (
            <Button type="button" size="sm" variant="outline" onClick={() => { onChange({ ...step, variantB: { templateId: null, subject: step.subject, body: step.body } }); setShown('B'); }}>
              <FlaskConical className="h-4 w-4" aria-hidden /> {t('A/B test this email')}
            </Button>
          )
        )}
      </div>
      <VersionFields key={variant} idBase={`${step.id}-${variant}`} version={version} readOnly={readOnly} onChange={setVersion}
        test={test ? { ...test, stepId: step.id, variant } : undefined} />
    </div>
  );
}

function VersionFields({ idBase, version, readOnly, test, onChange }: {
  idBase: string; version: EmailVersion; readOnly: boolean; test?: TestTarget & { stepId: string; variant: EmailVariant }; onChange: (v: EmailVersion) => void;
}) {
  const t = useT();
  const templates = useTemplates();
  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const last = useRef<'subject' | 'body'>('body');
  const tpl = templates.data?.find((x) => x.id === version.templateId);
  const insert = (tag: string) =>
    onChange(last.current === 'subject' ? { ...version, subject: insertAt(subjectRef.current, version.subject, tag) } : { ...version, body: insertAt(bodyRef.current, version.body, tag) });
  return (
    <div className="space-y-3">
      <Field id={`tpl-${idBase}`} label={t('Template')} hint={tpl ? t('Leave the boxes below empty to use the template as it is, or write here to change it for this step.') : undefined}>
        <Select id={`tpl-${idBase}`} disabled={readOnly} value={version.templateId ?? ''} onChange={(e) => onChange({ ...version, templateId: e.target.value || null })}>
          <option value="">{t('No template, write it here')}</option>
          {templates.data?.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field id={`subj-${idBase}`} label={t('Subject')}>
        <Input id={`subj-${idBase}`} ref={subjectRef} maxLength={200} disabled={readOnly} placeholder={tpl?.subject} value={version.subject} onFocus={() => (last.current = 'subject')} onChange={(e) => onChange({ ...version, subject: e.target.value })} />
      </Field>
      <Field id={`body-${idBase}`} label={t('Email')}>
        <Textarea id={`body-${idBase}`} ref={bodyRef} rows={7} maxLength={20_000} disabled={readOnly} placeholder={tpl?.body} value={version.body} onFocus={() => (last.current = 'body')} onChange={(e) => onChange({ ...version, body: e.target.value })} />
      </Field>
      {!readOnly && <MergeFieldBar idBase={idBase} onInsert={insert} />}
      {!readOnly && (
        <EmailAssist
          asTemplate
          subject={version.subject || tpl?.subject || ''}
          body={version.body || tpl?.body || ''}
          onApply={(x) => onChange({ ...version, ...(x.subject !== undefined ? { subject: x.subject } : {}), ...(x.body !== undefined ? { body: x.body } : {}) })}
        />
      )}
      <PreviewPanel idBase={idBase} subject={version.subject || tpl?.subject || ''} body={version.body || tpl?.body || ''} test={test} />
    </div>
  );
}

// ───────────── Rules ─────────────

function RulesTab({ seqId, rules, onChange, readOnly }: { seqId: string; rules: EventRule[]; onChange: (r: EventRule[]) => void; readOnly: boolean }) {
  const t = useT();
  const others = useSequences().data?.filter((s) => s.id !== seqId && s.status !== 'ARCHIVED') ?? [];
  const ruleFor = (on: EmailEvent) => rules.find((r) => r.on === on);
  const update = (on: EmailEvent, actions: RuleAction[]) => {
    const rest = rules.filter((r) => r.on !== on);
    onChange(actions.length ? [...rest, { on, actions }] : rest);
  };
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {t('Choose what DealFlow does when someone responds. Bounces and unsubscribes always stop all sending to that address, and add it to the do-not-email list.')}
      </p>
      {EMAIL_EVENTS.map((on) => (
        <RuleCard key={on} on={on} rule={ruleFor(on)} others={others} readOnly={readOnly} onChange={(a) => update(on, a)} />
      ))}
    </div>
  );
}

function RuleCard({ on, rule, others, readOnly, onChange }: { on: EmailEvent; rule?: EventRule; others: SequenceRow[]; readOnly: boolean; onChange: (a: RuleAction[]) => void }) {
  const t = useT();
  const actions = rule?.actions ?? [];
  const has = (type: RuleAction['type']) => actions.find((a) => a.type === type);
  const toggle = (type: RuleAction['type'], make: () => RuleAction) => {
    if (has(type)) return onChange(actions.filter((a) => a.type !== type));
    let next = [...actions, make()];
    if (type === 'stop') next = next.filter((a) => a.type !== 'move_sequence');
    if (type === 'move_sequence') next = next.filter((a) => a.type !== 'stop');
    onChange(next);
  };
  const patch = (type: RuleAction['type'], v: Partial<RuleAction>) => onChange(actions.map((a) => (a.type === type ? ({ ...a, ...v } as RuleAction) : a)));
  const move = has('move_sequence') as Extract<RuleAction, { type: 'move_sequence' }> | undefined;
  const status = has('set_lead_status') as Extract<RuleAction, { type: 'set_lead_status' }> | undefined;
  const task = has('create_task') as Extract<RuleAction, { type: 'create_task' }> | undefined;
  const box = (type: RuleAction['type'], make: () => RuleAction, disabled = false) => (
    <label className="flex items-center gap-2">
      <input type="checkbox" checked={!!has(type)} disabled={readOnly || disabled} onChange={() => toggle(type, make)} /> {t.maybe(RULE_ACTION_LABELS[type])}
    </label>
  );
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{t(WHEN[on])}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-2 text-sm sm:grid-cols-2">
        {on === 'bounced' || on === 'unsubscribed' ? (
          <p className="text-muted-foreground sm:col-span-2">{t('Sending to them always stops. You can also:')}</p>
        ) : (
          box('stop', () => ({ type: 'stop' }))
        )}
        {on !== 'bounced' && on !== 'unsubscribed' && (
          <div className="space-y-1">
            {box('move_sequence', () => ({ type: 'move_sequence', sequenceId: others[0]?.id ?? '' }), others.length === 0)}
            {move && (
              <Select aria-label={t('Sequence to move them to')} disabled={readOnly} value={move.sequenceId} onChange={(e) => patch('move_sequence', { sequenceId: e.target.value })}>
                {others.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            )}
          </div>
        )}
        <div className="space-y-1">
          {box('set_lead_status', () => ({ type: 'set_lead_status', status: on === 'replied' ? 'CONTACTED' : 'UNQUALIFIED' }))}
          {status && (
            <Select aria-label={t('New lead status')} disabled={readOnly} value={status.status} onChange={(e) => patch('set_lead_status', { status: e.target.value as typeof status.status })}>
              {LEAD_STATUSES.filter((s) => s !== 'CONVERTED').map((s) => (
                <option key={s} value={s}>
                  {t.maybe(titleCase(s))}
                </option>
              ))}
            </Select>
          )}
        </div>
        <div className="space-y-1">
          {box('create_task', () => ({ type: 'create_task', title: on === 'replied' ? t('Reply to {{first_name}}') : t('Follow up'), dueInDays: 1 }))}
          {task && <Input aria-label={t('Task title')} disabled={readOnly} maxLength={200} value={task.title} onChange={(e) => patch('create_task', { title: e.target.value })} />}
        </div>
        {box('notify_owner', () => ({ type: 'notify_owner' }))}
      </CardContent>
    </Card>
  );
}

// ───────────── Sending settings ─────────────

function SettingsTab({ draft, setDraft, readOnly }: { draft: Draft; setDraft: (d: Draft) => void; readOnly: boolean }) {
  const t = useT();
  const s = draft.settings;
  const days = useMemo(() => weekdays(t.formatLocale), [t.formatLocale]);
  const set = (v: Partial<SequenceSettings>) => setDraft({ ...draft, settings: { ...s, ...v } });
  const zones = useMemo(() => {
    try {
      return (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf('timeZone');
    } catch {
      return ['UTC'];
    }
  }, []);
  return (
    <Card>
      <CardContent className="grid gap-4 p-4 sm:grid-cols-2">
        <fieldset className="space-y-2 sm:col-span-2">
          <legend className="text-sm font-medium">{t('Send on')}</legend>
          <div className="flex flex-wrap gap-3 text-sm">
            {days.map((d, i) => (
              <label key={d} className="flex items-center gap-1">
                <input type="checkbox" disabled={readOnly} checked={s.sendDays.includes(i)} onChange={(e) => set({ sendDays: e.target.checked ? [...s.sendDays, i].sort() : s.sendDays.filter((x) => x !== i) })} /> {d}
              </label>
            ))}
          </div>
        </fieldset>
        <Field id="send-start" label={t('From')}>
          <Input id="send-start" type="time" disabled={readOnly} value={s.sendStart} onChange={(e) => set({ sendStart: e.target.value })} />
        </Field>
        <Field id="send-end" label={t('Until')}>
          <Input id="send-end" type="time" disabled={readOnly} value={s.sendEnd} onChange={(e) => set({ sendEnd: e.target.value })} />
        </Field>
        <Field id="send-tz" label={t('Time zone')} hint={t('The window uses this zone for everyone in the sequence.')}>
          <Input id="send-tz" list="tz-list" disabled={readOnly} value={s.timezone} onChange={(e) => set({ timezone: e.target.value })} />
          <datalist id="tz-list">
            {zones.map((z) => (
              <option key={z} value={z} />
            ))}
          </datalist>
        </Field>
        <Field id="send-limit" label={t('Emails per sender per day')} hint={t("Your mailbox's overall DealFlow limit also applies. Sends are spread out by a few minutes.")}>
          <Input id="send-limit" type="number" min={1} max={500} disabled={readOnly} value={s.dailyLimit} onChange={(e) => set({ dailyLimit: Math.max(1, Math.min(500, Number(e.target.value) || 1)) })} />
        </Field>
        <fieldset className="space-y-2 sm:col-span-2">
          <legend className="text-sm font-medium">{t('Tracking')}</legend>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" disabled={readOnly} checked={s.trackOpens} onChange={(e) => set({ trackOpens: e.target.checked })} /> {t('Track opens (approximate)')}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" disabled={readOnly} checked={s.trackClicks} onChange={(e) => set({ trackClicks: e.target.checked })} /> {t('Track link clicks')}
          </label>
          <p className="text-xs text-muted-foreground">
            {t('Tracking sends the email with an HTML part, a small image and rewritten links. Plain text with no tracking can land in the inbox more often. Replies are detected either way.')}
          </p>
        </fieldset>
      </CardContent>
    </Card>
  );
}

// ───────────── People ─────────────

function PeopleTab({ seq }: { seq: SequenceRow }) {
  const t = useT();
  const qc = useQueryClient();
  const me = useSession().data;
  const canWrite = useCan('sequences:write');
  const canManage = useCan('marketing:manage');
  const [filter, setFilter] = useState<'live' | 'finished' | undefined>('live');
  const rows = useEnrollments({ sequenceId: seq.id, status: filter });
  const segments = useSegments();
  const [lead, setLead] = useState<PickerValue | null>(null);
  const [segmentId, setSegmentId] = useState('');
  const refresh = () => qc.invalidateQueries({ queryKey: ['sequences'] });
  const enroll = useMutation({
    mutationFn: (json: { leadIds?: string[]; segmentId?: string }) => api<EnrollResult>(`/sequences/${seq.id}/enroll`, { method: 'POST', json }),
    onSuccess: () => {
      setLead(null);
      return refresh();
    },
  });
  const change = useMutation({ mutationFn: (v: { id: string; action: 'pause' | 'resume' | 'stop' }) => api(`/sequences/enrollments/${v.id}`, { method: 'POST', json: { action: v.action } }), onSuccess: refresh });
  const open = seq.status === 'ACTIVE' || seq.status === 'PAUSED';
  return (
    <div className="space-y-4">
      {canWrite && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{t('Enrol people')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {!open && <p className="text-warning">{t('Start the sequence before enrolling people.')}</p>}
            <p className="text-muted-foreground">{t('Emails go from your own connected mailbox. People who opted out, are on the do-not-email list or have no email address are skipped.')}</p>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <label htmlFor="enrol-lead" className="text-sm font-medium">
                    {t('A lead')}
                  </label>
                  <RecordPicker id="enrol-lead" entity="leads" value={lead} onChange={setLead} placeholder={t('Search leads')} />
                </div>
                <Button size="sm" disabled={!open || !lead || enroll.isPending} onClick={() => lead && enroll.mutate({ leadIds: [lead.id] })}>
                  {t('Enrol')}
                </Button>
              </div>
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <label htmlFor="enrol-seg" className="text-sm font-medium">
                    {t('A whole segment (up to 500)')}
                  </label>
                  <Select id="enrol-seg" value={segmentId} onChange={(e) => setSegmentId(e.target.value)}>
                    <option value="">{t('Choose a segment')}</option>
                    {segments.data?.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </Select>
                </div>
                <Button size="sm" disabled={!open || !segmentId || enroll.isPending} onClick={() => enroll.mutate({ segmentId })}>
                  {t('Enrol segment')}
                </Button>
              </div>
            </div>
            <ErrorText error={enroll.error} />
            {enroll.data && (
              <p role="status" className="text-sm">
                {t('Enrolled: {count}.', { count: enroll.data.enrolled })}
                {enroll.data.skipped.length > 0 &&
                  ` ${t('Skipped {count}: {people}.', {
                    count: enroll.data.skipped.length,
                    people: `${enroll.data.skipped.slice(0, 5).map((s) => `${s.name} (${t.maybe(ENROLL_SKIP_LABELS[s.reason])})`).join(', ')}${enroll.data.skipped.length > 5 ? '…' : ''}`,
                  })}`}
              </p>
            )}
          </CardContent>
        </Card>
      )}
      <div className="flex gap-2 text-sm">
        {(['live', 'finished', undefined] as const).map((f) => (
          <Button key={f ?? 'all'} size="sm" variant={filter === f ? 'default' : 'outline'} onClick={() => setFilter(f)}>
            {f === 'live' ? t('In progress') : f === 'finished' ? t('Finished') : t('Everyone')}
          </Button>
        ))}
      </div>
      <Card>
        <CardContent className="overflow-x-auto p-0">
          {rows.isPending ? (
            <Skeleton className="m-4 h-24" />
          ) : rows.error ? (
            <div className="p-4">
              <ErrorText error={rows.error} />
            </div>
          ) : rows.data.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">{t('Nobody here yet.')}</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b border-border text-start text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">{t('Person')}</th>
                  <th className="px-4 py-2 font-medium">{t('Status')}</th>
                  <th className="px-4 py-2 font-medium">{t('Next')}</th>
                  <th className="px-4 py-2 text-end font-medium">{t('Sent')}</th>
                  <th className="px-4 py-2 font-medium">{t('Activity')}</th>
                  <th className="sr-only">{t('Actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.data.map((r) => {
                  const mine = r.sender?.id === me?.user.id || canManage;
                  return (
                    <tr key={r.id}>
                      <td className="px-4 py-2">
                        <Link href={`/app/${r.person.type === 'lead' ? 'leads' : 'contacts'}/${r.person.id}`} className="font-medium hover:underline">
                          {r.person.name}
                        </Link>
                        <span className="block text-xs text-muted-foreground">
                          {r.email}
                          {r.sender ? ` · ${t('from {name}', { name: r.sender.name })}` : ''}
                        </span>
                      </td>
                      <td className="px-4 py-2">
                        <Badge tone={ENROLLMENT_TONE[r.status]}>{t.maybe(ENROLLMENT_LABEL[r.status])}</Badge>
                        {r.lastError && <span className="block max-w-xs text-xs text-warning">{r.lastError}</span>}
                      </td>
                      <td className="px-4 py-2 text-xs text-muted-foreground">{r.nextStep ? (r.nextRunAt ? t('Step {n}, {when}', { n: r.nextStep, when: new Date(r.nextRunAt).toLocaleString(fmtLocale()) }) : t('Step {n}', { n: r.nextStep })) : '—'}</td>
                      <td className="px-4 py-2 text-end tabular-nums">{r.sent}</td>
                      <td className="px-4 py-2 text-xs text-muted-foreground">
                        {[r.repliedAt && t('Replied {date}', { date: formatDate(r.repliedAt) }), r.clickedAt && t('Clicked'), !r.clickedAt && r.openedAt && t('Opened*')].filter(Boolean).join(' · ') || '—'}
                      </td>
                      <td className="px-4 py-2">
                        {canWrite && mine && (r.status === 'ACTIVE' || r.status === 'PAUSED') && (
                          <div className="flex gap-1">
                            <Button size="sm" variant="ghost" onClick={() => change.mutate({ id: r.id, action: r.status === 'ACTIVE' ? 'pause' : 'resume' })}>
                              {r.status === 'ACTIVE' ? t('Pause') : t('Resume')}
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => change.mutate({ id: r.id, action: 'stop' })}>
                              {t('Stop')}
                            </Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
      <ErrorText error={change.error} />
    </div>
  );
}

// ───────────── Results ─────────────

/** Each version must reach this many people before one is shown as ahead. */
const AB_MIN_SENT = 20;

function leader(variants: { variant: EmailVariant; counts: EmailCounts }[]): EmailVariant | null {
  const [a, b] = variants;
  if (!a || !b || a.counts.sent < AB_MIN_SENT || b.counts.sent < AB_MIN_SENT) return null;
  const ra = a.counts.replied / a.counts.sent;
  const rb = b.counts.replied / b.counts.sent;
  return ra === rb ? null : ra > rb ? a.variant : b.variant;
}

function StatsRow({ label, c, sub, lead }: { label: string; c: EmailCounts; sub?: boolean; lead?: boolean }) {
  const t = useT();
  return (
    <tr className={sub ? 'bg-muted/30' : undefined}>
      <td className={`px-4 py-2 ${sub ? 'ps-8 text-muted-foreground' : ''}`}>
        {label} {lead && <Badge tone="success">{t('Ahead on replies')}</Badge>}
      </td>
      <td className="px-4 py-2 text-end tabular-nums">{c.sent}</td>
      <td className="px-4 py-2 text-end tabular-nums">{c.replied} <span className="text-xs text-muted-foreground">{pct(c.replied, c.sent)}</span></td>
      <td className="px-4 py-2 text-end tabular-nums">{c.clicked} <span className="text-xs text-muted-foreground">{pct(c.clicked, c.sent)}</span></td>
      <td className="px-4 py-2 text-end tabular-nums">{c.opened} <span className="text-xs text-muted-foreground">{pct(c.opened, c.sent)}</span></td>
      <td className="px-4 py-2 text-end tabular-nums">{c.bounced}</td>
    </tr>
  );
}

function ResultsTab({ seq }: { seq: SequenceRow }) {
  const t = useT();
  const stats = useStepStats(seq.id);
  const n = seq.stats;
  const tiles: [string, number, string][] = [
    [t('Sent'), n.sent, ''],
    [t('Replied'), n.replied, pct(n.replied, n.sent)],
    [t('Clicked'), n.clicked, pct(n.clicked, n.sent)],
    [t('Opened*'), n.opened, pct(n.opened, n.sent)],
    [t('Bounced'), n.bounced, pct(n.bounced, n.sent)],
    [t('Unsubscribed'), n.unsubscribed, ''],
  ];
  const position = new Map(seq.steps.map((s, i) => [s.id, i + 1]));
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {tiles.map(([label, count, p]) => (
          <Card key={label}>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="text-2xl font-semibold tabular-nums">{count}</p>
              {p && <p className="text-xs text-muted-foreground">{p}</p>}
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardContent className="overflow-x-auto p-0">
          {stats.isPending ? (
            <Skeleton className="m-4 h-24" />
          ) : stats.error ? (
            <div className="p-4">
              <ErrorText error={stats.error} />
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b border-border text-start text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">{t('Email step')}</th>
                  <th className="px-4 py-2 text-end font-medium">{t('Sent')}</th>
                  <th className="px-4 py-2 text-end font-medium">{t('Replied')}</th>
                  <th className="px-4 py-2 text-end font-medium">{t('Clicked')}</th>
                  <th className="px-4 py-2 text-end font-medium">{t('Opened*')}</th>
                  <th className="px-4 py-2 text-end font-medium">{t('Bounced')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {stats.data.flatMap((r) => [
                  <StatsRow key={r.stepId} label={r.variants ? t('Step {n}, both versions', { n: position.get(r.stepId) ?? '?' }) : t('Step {n}', { n: position.get(r.stepId) ?? '?' })} c={r} />,
                  ...(r.variants ?? []).map((v) => (
                    <StatsRow key={`${r.stepId}-${v.variant}`} label={t('Version {v}', { v: v.variant })} c={v.counts} sub
                      lead={leader(r.variants!) === v.variant} />
                  )),
                ])}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground">{t('*Opens are approximate: some mail apps load images automatically and others block them. Replies and bounces come from your synced mailbox.')}</p>
      {stats.data?.some((r) => r.variants) && (
        <p className="text-xs text-muted-foreground">
          {t('A/B tests: “Ahead on replies” appears once each version has gone to at least {min} people and one has a higher reply rate. With small numbers the difference can be chance, so keep testing before you pick one.', { min: AB_MIN_SENT })}
        </p>
      )}
    </div>
  );
}
