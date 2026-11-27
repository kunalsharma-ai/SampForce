'use client';

import { CALL_OUTCOME_LABELS, type CallOutcome, type CallOutcomeDef, type CallOutcomeInput, OUTCOME_ACTION_LABELS, OUTCOME_ACTIONS, OUTCOME_ICONS, type RecordingPolicy } from '@dealflow/types';
import { Badge, Button, cn, Dialog, DialogContent, DialogDescription, DialogTitle, Field, Input } from '@dealflow/ui';
import { Pencil, Plus, Trash2, Volume2, VolumeX } from 'lucide-react';
import * as React from 'react';
import { OUTCOME_ICON, OutcomeIcon, readableOn, useOutcomeLabel, useOutcomeLookup } from '@/components/calls/outcomes';
import { Select, Textarea } from '@/components/crm/select';
import { useCallSounds } from '@/lib/call-sounds';
import { useOutcomeMutations, useRecordingPolicy, useSaveRecordingPolicy } from '@/lib/calls';
import { useT } from '@/lib/i18n';
import { useCan } from '@/lib/session';

/** The sounds switch: key tones, ringing and connect tones, remembered on this device. */
export function SoundsToggle({ compact }: { compact?: boolean }) {
  const t = useT();
  const [on, setOn] = useCallSounds();
  return (
    <button type="button" role="switch" aria-checked={on} onClick={() => setOn(!on)} className={cn('inline-flex items-center gap-1.5 rounded-full border border-border text-xs font-medium transition hover:bg-muted', compact ? 'size-9 justify-center' : 'h-9 px-3')} title={on ? t('Sounds on') : t('Sounds off')}>
      {on ? <Volume2 aria-hidden className="size-4" /> : <VolumeX aria-hidden className="size-4" />}
      <span className={cn(compact && 'sr-only')}>{on ? t('Sounds on') : t('Sounds off')}</span>
    </button>
  );
}

/** Workspace call settings for admins: the outcomes everyone chooses from, and the recording policy. */
export function WorkspaceCallSettings() {
  const t = useT();
  const canConfigure = useCan('crm:configure');
  return (
    <div className="space-y-5">
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-surface p-4">
        <div>
          <h3 className="text-sm font-semibold">{t('Dialer sounds')}</h3>
          <p className="text-xs text-muted-foreground">{t('Key tones, ringing and connect tones on this device.')}</p>
        </div>
        <SoundsToggle />
      </section>
      {canConfigure ? (
        <>
          <RecordingPolicyForm />
          <OutcomesEditor />
        </>
      ) : (
        <p className="text-xs text-muted-foreground">{t('Workspace admins choose the call outcomes and the recording policy.')}</p>
      )}
    </div>
  );
}

function RecordingPolicyForm() {
  const t = useT();
  const q = useRecordingPolicy();
  const save = useSaveRecordingPolicy();
  const [v, setV] = React.useState<RecordingPolicy | null>(null);
  const [saved, setSaved] = React.useState(false);
  React.useEffect(() => {
    if (q.data) setV(q.data);
  }, [q.data]);
  if (!v) return null;
  const set = (p: Partial<RecordingPolicy>) => {
    setSaved(false);
    setV((x) => ({ ...x!, ...p }));
  };
  return (
    <section aria-labelledby="recording-policy" className="space-y-3 rounded-2xl border border-border bg-surface p-4">
      <h3 id="recording-policy" className="text-sm font-semibold">
        {t('Recording policy')}
      </h3>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          await save.mutateAsync(v);
          setSaved(true);
        }}
      >
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={v.enabled} onChange={(e) => set({ enabled: e.target.checked })} className="mt-0.5 size-4" />
          <span>
            <span className="font-medium">{t('Calls may be recorded')}</span>
            <span className="block text-xs text-muted-foreground">{t('Off: no dialer records and no recording can be uploaded.')}</span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={v.requireConsent} onChange={(e) => set({ requireConsent: e.target.checked })} className="mt-0.5 size-4" disabled={!v.enabled} />
          <span>
            <span className="font-medium">{t('Ask for consent first')}</span>
            <span className="block text-xs text-muted-foreground">{t('The caller confirms the other person agreed before recording starts.')}</span>
          </span>
        </label>
        <Field id="policy-notice" label={t('What to tell them')}>
          <Textarea value={v.consentNotice} onChange={(e) => set({ consentNotice: e.target.value })} maxLength={400} className="min-h-16" />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="policy-retention" label={t('Keep recordings for (days)')} hint={t('Leave empty to keep them until deleted.')}>
            <Input inputMode="numeric" value={v.retentionDays ?? ''} onChange={(e) => set({ retentionDays: e.target.value ? Math.max(1, Math.min(3650, Number(e.target.value) || 1)) : null })} />
          </Field>
          <Field id="policy-download" label={t('Who can download')}>
            <Select value={v.download} onChange={(e) => set({ download: e.target.value as RecordingPolicy['download'] })}>
              <option value="MANAGERS">{t('Managers and admins')}</option>
              <option value="ALL">{t('Everyone who can play them')}</option>
              <option value="NONE">{t('Nobody')}</option>
            </Select>
          </Field>
        </div>
        <div className="flex items-center justify-end gap-2">
          {saved && <span className="text-xs text-success">{t('Saved')}</span>}
          <Button type="submit" size="sm" disabled={save.isPending}>
            {t('Save policy')}
          </Button>
        </div>
      </form>
    </section>
  );
}

function OutcomesEditor() {
  const t = useT();
  const { list } = useOutcomeLookup();
  const label = useOutcomeLabel();
  const m = useOutcomeMutations();
  const [editing, setEditing] = React.useState<CallOutcomeDef | 'new' | null>(null);
  return (
    <section aria-labelledby="outcomes-editor" className="space-y-3 rounded-2xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 id="outcomes-editor" className="text-sm font-semibold">
            {t('Call outcomes')}
          </h3>
          <p className="text-xs text-muted-foreground">{t('What people choose after a call. Each outcome has its colour, icon and what happens next.')}</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => setEditing('new')}>
          <Plus aria-hidden /> {t('Add an outcome')}
        </Button>
      </div>
      <ul className="divide-y divide-border" aria-label={t('Call outcomes')}>
        {list.map((o) => (
          <li key={o.key} className={cn('flex flex-wrap items-center gap-3 py-2', !o.active && 'opacity-60')}>
            <span className="flex size-8 items-center justify-center rounded-full text-white" style={{ backgroundColor: readableOn(o.color) }}>
              <OutcomeIcon def={o} className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                {label(o)}
                {o.custom && <Badge tone="accent">{t('Workspace')}</Badge>}
                {!o.active && <Badge tone="neutral">{t('Hidden')}</Badge>}
              </span>
              <span className="block text-xs text-muted-foreground">
                {t.maybe(OUTCOME_ACTION_LABELS[o.action])} · {o.reached ? t('Counts as reached') : t('Nobody answered')}
              </span>
            </span>
            <Button size="icon" variant="ghost" className="size-8" aria-label={t('Edit {name}', { name: label(o) })} onClick={() => setEditing(o)}>
              <Pencil aria-hidden className="size-3.5" />
            </Button>
            {o.custom && (
              <Button size="icon" variant="ghost" className="size-8 text-critical" aria-label={t('Remove {name}', { name: o.label })} onClick={() => window.confirm(t('Remove the outcome “{name}”? Calls logged with it keep it.', { name: o.label })) && m.remove.mutate(o.key)}>
                <Trash2 aria-hidden className="size-3.5" />
              </Button>
            )}
          </li>
        ))}
      </ul>
      <OutcomeDialog editing={editing} onClose={() => setEditing(null)} />
    </section>
  );
}

const COLOURS = ['#10b981', '#0ea5e9', '#6366f1', '#8b5cf6', '#ec4899', '#f43f5e', '#f97316', '#f59e0b', '#84cc16', '#14b8a6', '#64748b', '#334155'];

function OutcomeDialog({ editing, onClose }: { editing: CallOutcomeDef | 'new' | null; onClose: () => void }) {
  const t = useT();
  const m = useOutcomeMutations();
  const blank: CallOutcomeInput = { label: '', icon: 'Star', color: '#0ea5e9', tone: 'neutral', reached: false, action: 'NONE', followUpInMinutes: null, active: true };
  const [v, setV] = React.useState<CallOutcomeInput>(blank);
  const [error, setError] = React.useState<string | null>(null);
  const existing = editing && editing !== 'new' ? editing : null;
  React.useEffect(() => {
    setError(null);
    if (existing) {
      const builtInLabel = !existing.custom && CALL_OUTCOME_LABELS[existing.key as CallOutcome] === existing.label ? t.maybe(existing.label) : existing.label;
      setV({ label: builtInLabel, icon: existing.icon as CallOutcomeInput['icon'], color: existing.color, tone: existing.tone, reached: existing.reached, action: existing.action, followUpInMinutes: existing.followUpInMinutes, active: existing.active });
    } else setV(blank);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);
  const set = (p: Partial<CallOutcomeInput>) => setV((x) => ({ ...x, ...p }));
  const plans = ['CALLBACK', 'NEXT_CALL', 'EMAIL_TASK', 'MEETING'].includes(v.action);
  return (
    <Dialog open={!!editing} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="top-[5vh] flex max-h-[90vh] max-w-lg flex-col p-0">
        <header className="border-b border-border px-5 pb-3 pt-5 pe-12">
          <DialogTitle className="text-lg font-semibold">{existing ? t('Edit outcome') : t('Add an outcome')}</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">{t('Everyone in the workspace chooses from these after a call.')}</DialogDescription>
        </header>
        <form
          id="outcome-form"
          className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!v.label.trim()) return setError(t('Name the outcome'));
            try {
              // A built-in outcome left with its (translated) name keeps SampForce's name, so it stays translated for everyone.
              const own = existing && !existing.custom ? CALL_OUTCOME_LABELS[existing.key as CallOutcome] : undefined;
              if (existing) await m.save.mutateAsync({ key: existing.key, input: own && v.label === t.maybe(own) ? { ...v, label: own } : v });
              else await m.add.mutateAsync(v);
              onClose();
            } catch (err) {
              setError(err instanceof Error ? err.message : t('Could not save.'));
            }
          }}
        >
          <Field id="outcome-label" label={t('Name')}>
            <Input value={v.label} onChange={(e) => set({ label: e.target.value })} maxLength={60} />
          </Field>
          <fieldset>
            <legend className="mb-1.5 text-sm font-medium">{t('Colour')}</legend>
            <div className="flex flex-wrap gap-1.5">
              {COLOURS.map((c) => (
                <button key={c} type="button" aria-label={c} aria-pressed={v.color === c} onClick={() => set({ color: c })} className={cn('size-7 rounded-full ring-offset-2 ring-offset-background', v.color === c && 'ring-2 ring-foreground')} style={{ backgroundColor: c }} />
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="mb-1.5 text-sm font-medium">{t('Icon')}</legend>
            <div className="flex flex-wrap gap-1.5">
              {OUTCOME_ICONS.map((name) => {
                const Icon = OUTCOME_ICON[name]!;
                return (
                  <button key={name} type="button" aria-label={name} aria-pressed={v.icon === name} onClick={() => set({ icon: name })} className={cn('flex size-8 items-center justify-center rounded-lg border', v.icon === name ? 'border-transparent text-white' : 'border-border hover:bg-muted')} style={v.icon === name ? { backgroundColor: v.color } : undefined}>
                    <Icon aria-hidden className="size-4" />
                  </button>
                );
              })}
            </div>
          </fieldset>
          <Field id="outcome-action" label={t('What happens next')}>
            <Select value={v.action} onChange={(e) => set({ action: e.target.value as CallOutcomeInput['action'] })}>
              {OUTCOME_ACTIONS.map((a) => (
                <option key={a} value={a}>
                  {t.maybe(OUTCOME_ACTION_LABELS[a])}
                </option>
              ))}
            </Select>
          </Field>
          {plans && (
            <Field id="outcome-minutes" label={t('Suggest the follow-up in (hours)')}>
              <Input inputMode="decimal" value={v.followUpInMinutes ? String(v.followUpInMinutes / 60) : ''} onChange={(e) => set({ followUpInMinutes: e.target.value ? Math.max(5, Math.round(Number(e.target.value) * 60) || 60) : null })} />
            </Field>
          )}
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={v.reached} onChange={(e) => set({ reached: e.target.checked })} className="mt-0.5 size-4" />
            <span>
              <span className="font-medium">{t('Someone answered')}</span>
              <span className="block text-xs text-muted-foreground">{t('Counts as a conversation: it stops the email cadence and moves the employee’s stage.')}</span>
            </span>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={v.active} onChange={(e) => set({ active: e.target.checked })} className="size-4" /> {t('Offer it after calls')}
          </label>
          {error && (
            <p role="alert" className="text-sm text-critical">
              {error}
            </p>
          )}
        </form>
        <footer className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button type="submit" form="outcome-form" disabled={m.add.isPending || m.save.isPending}>
            {t('Save')}
          </Button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
