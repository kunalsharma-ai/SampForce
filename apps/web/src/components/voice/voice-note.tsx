'use client';

import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Dialog, DialogContent, DialogDescription, DialogTitle, Field, Input } from '@dealflow/ui';
import {
  type VoiceAction,
  voiceActionSchema,
  VOICE_ACTION_LABELS,
  VOICE_LANGUAGES,
  type VoiceLanguage,
  type VoiceNote,
  type VoiceRecordType,
} from '@dealflow/types';
import { AlertTriangle, Check, ExternalLink, Mic, Pencil, Sparkles, Square, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Select, Textarea } from '@/components/crm/select';
import { TranscriptionBanner } from '@/components/meetings/transcription-banner';
import { aiErrorMessage } from '@/lib/ai';
import { relativeTime } from '@/lib/format';
import { type Translator, useT } from '@/lib/i18n';
import { useCan } from '@/lib/session';
import { voiceApi, useVoiceMutation, useVoiceNotes, useVoiceTranscriptionStatus } from '@/lib/voice';
import { gated } from '@/components/shell/feature-locked';

export interface VoiceRecordTarget {
  type: VoiceRecordType;
  id: string;
  name: string;
}

const MAX_SECONDS = 10 * 60;
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const languageName = (code: string | null) => VOICE_LANGUAGES.find(([c]) => c === code)?.[1] ?? code;

/** A button that opens a new voice note, optionally tied to a record. */
function VoiceNoteButtonPanel({ record, label: given, variant = 'outline', iconOnly }: { record: VoiceRecordTarget | null; label?: string; variant?: 'outline' | 'ghost'; iconOnly?: boolean }) {
  const t = useT();
  const label = given ?? t('Voice note');
  const canWrite = useCan('activities:write');
  const [open, setOpen] = useState(false);
  if (!canWrite) return null;
  return (
    <>
      <Button variant={variant} size={iconOnly ? 'icon' : 'sm'} onClick={() => setOpen(true)} aria-label={iconOnly ? label : undefined}>
        <Mic aria-hidden />
        {!iconOnly && label}
      </Button>
      {open && <VoiceNoteDialog open={open} onOpenChange={setOpen} record={record} />}
    </>
  );
}

/** Your voice notes on a lead, contact, deal or company. Notes are private to the person who made them. */
function RecordVoiceNotesPanel({ record }: { record: VoiceRecordTarget }) {
  const t = useT();
  const canWrite = useCan('activities:write');
  const notes = useVoiceNotes({ type: record.type, id: record.id }, canWrite);
  const [openNote, setOpenNote] = useState<VoiceNote | null>(null);
  if (!canWrite) return null;
  const items = notes.data ?? [];
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">{t('Voice notes')}</CardTitle>
        <VoiceNoteButton record={record} label={t('New voice note')} />
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('No voice notes yet. Speak or type a note and SampForce suggests tasks, notes and records for you to confirm.')}</p>
        ) : (
          <ul className="space-y-2 text-sm" aria-label={t('Voice notes')}>
            {items.slice(0, 5).map((n) => {
              const s = noteStage(t, n);
              return (
                <li key={n.id} className="flex flex-wrap items-start gap-2">
                  <button type="button" className="min-w-0 flex-1 truncate text-start text-primary underline underline-offset-2" onClick={() => setOpenNote(n)}>
                    {n.summary || n.transcript?.slice(0, 80) || t('Untitled voice note')}
                  </button>
                  <Badge tone={s.tone}>{s.label}</Badge>
                  <span className="shrink-0 text-xs text-muted-foreground">{relativeTime(n.createdAt)}</span>
                </li>
              );
            })}
          </ul>
        )}
        <p className="mt-3 text-xs text-muted-foreground">{t('Only you can see your voice notes. What you confirm is saved to the record like any other task or note.')}</p>
      </CardContent>
      {openNote && <VoiceNoteDialog open onOpenChange={(o) => !o && setOpenNote(null)} record={record} initial={openNote} />}
    </Card>
  );
}

function noteStage(t: Translator, n: VoiceNote): { label: string; tone: 'neutral' | 'warning' | 'success' | 'primary' | 'critical' } {
  const applied = n.actions.filter((a) => a.status === 'applied').length;
  if (applied > 0) return { label: t('{n} saved', { n: applied }), tone: 'success' };
  if (n.transcriptionStatus === 'failed') return { label: t('Transcription failed'), tone: 'critical' };
  if (n.interpretedAt) return { label: n.actions.length ? t('Suggestions to review') : t('Nothing to save'), tone: n.actions.length ? 'warning' : 'neutral' };
  return { label: t('Draft'), tone: 'neutral' };
}

export function VoiceNoteDialog({ open, onOpenChange, record, initial }: { open: boolean; onOpenChange: (o: boolean) => void; record: VoiceRecordTarget | null; initial?: VoiceNote }) {
  const t = useT();
  const [note, setNote] = useState<VoiceNote | null>(initial ?? null);
  const [editing, setEditing] = useState(!initial?.interpretedAt);
  const where = note?.record?.name ?? record?.name;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent side="right" className="flex flex-col gap-4 overflow-y-auto p-5 sm:max-w-lg">
        <div className="pe-8">
          <DialogTitle className="text-lg font-semibold">{t('Voice note')}</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            {where
              ? t('For {name}. Say or type what happened. SampForce suggests what to save and nothing is saved until you confirm it.', { name: where })
              : t('Say or type what happened. SampForce suggests what to save and nothing is saved until you confirm it.')}
          </DialogDescription>
        </div>
        {editing || !note?.interpretedAt ? (
          <Compose
            note={note}
            record={record}
            onNote={setNote}
            onInterpreted={(n) => {
              setNote(n);
              setEditing(false);
            }}
          />
        ) : (
          <Review note={note} onNote={setNote} onEdit={() => setEditing(true)} onClose={() => onOpenChange(false)} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function Compose({ note, record, onNote, onInterpreted }: { note: VoiceNote | null; record: VoiceRecordTarget | null; onNote: (n: VoiceNote) => void; onInterpreted: (n: VoiceNote) => void }) {
  const t = useT();
  const canAi = useCan('ai:use');
  const status = useVoiceTranscriptionStatus();
  const [mode, setMode] = useState<'type' | 'record'>(note?.source === 'recording' ? 'record' : 'type');
  const [language, setLanguage] = useState<VoiceLanguage>(note?.language ?? 'auto');
  const [text, setText] = useState(note?.transcript ?? '');
  const locked = !!note?.actions.some((a) => a.status === 'applied');

  /** Create the note on first use, or save the edited text, then return the latest note. */
  const ensure = async (withText: boolean): Promise<VoiceNote> => {
    if (!note) return voiceApi.create({ language, transcript: withText ? text : undefined, record: record ? { type: record.type, id: record.id } : null });
    const changes: { transcript?: string; language?: VoiceLanguage } = {};
    if (withText && text.trim() !== (note.transcript ?? '').trim()) changes.transcript = text;
    if (language !== note.language) changes.language = language;
    return Object.keys(changes).length ? voiceApi.update(note.id, changes) : note;
  };

  const interpret = useVoiceMutation(async () => {
    const n = await ensure(true);
    onNote(n);
    return voiceApi.interpret(n.id);
  }, onInterpreted);
  const transcribe = useVoiceMutation(async (audio: Blob) => {
    const n = await ensure(false);
    onNote(n);
    return voiceApi.transcribe(n.id, audio);
  }, (n) => {
    onNote(n);
    setText(n.transcript ?? '');
  });

  if (locked) {
    return <p className="text-sm text-muted-foreground">{t('Some suggestions from this note are already saved, so the note can no longer be changed. Start a new voice note instead.')}</p>;
  }
  const ready = status.data?.state !== 'pending_configuration' && !!status.data;
  return (
    <div className="space-y-4">
      <div role="tablist" aria-label={t('How to add the note')} className="inline-flex rounded-md border border-border p-0.5 text-sm">
        {(['type', 'record'] as const).map((m) => (
          <button
            key={m}
            role="tab"
            type="button"
            aria-selected={mode === m}
            onClick={() => setMode(m)}
            className={`rounded px-3 py-1 ${mode === m ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}
          >
            {m === 'type' ? t('Type') : t('Record')}
          </button>
        ))}
      </div>

      <Field id="vn-language" label={t('Language')} hint={t('Used for transcription. The suggestions are written in the language of the note.')}>
        <Select value={language} onChange={(e) => setLanguage(e.target.value as VoiceLanguage)}>
          {VOICE_LANGUAGES.map(([code, name]) => (
            <option key={code} value={code}>
              {t.maybe(name)}
            </option>
          ))}
        </Select>
      </Field>

      {mode === 'record' && (
        <div className="space-y-3 rounded-md border border-border p-3">
          <TranscriptionBanner status={status.data} fallback={t('You can type the note instead.')} />
          <Recorder disabled={!ready || transcribe.isPending} busy={transcribe.isPending} onAudio={(blob) => transcribe.mutate(blob)} />
          {note?.detectedLanguage && <p className="text-xs text-muted-foreground">{t('Detected language: {language}', { language: t.maybe(languageName(note.detectedLanguage) ?? '') })}</p>}
          {transcribe.error && (
            <p role="alert" className="text-sm text-critical">
              {t.maybe(transcribe.error.message)}
            </p>
          )}
        </div>
      )}

      {(mode === 'type' || text) && (
        <Field id="vn-text" label={mode === 'type' ? t('Your note') : t('Transcript (you can correct it)')}>
          <Textarea
            rows={7}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t('Called Priya at Acme. Follow up tomorrow at 3 pm with the revised quote. Note that they want a 12 month contract.')}
          />
        </Field>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => interpret.mutate(undefined)} disabled={!canAi || !text.trim() || interpret.isPending}>
          <Sparkles aria-hidden /> {interpret.isPending ? t('Working it out…') : t('Suggest actions')}
        </Button>
        {!canAi && <span className="text-xs text-muted-foreground">{t('Your role cannot use AI features.')}</span>}
      </div>
      {interpret.error && (
        <p role="alert" className="text-sm text-critical">
          {t.maybe(aiErrorMessage(interpret.error))}
        </p>
      )}
    </div>
  );
}

/** Browser microphone recording. Consent is asked for every recording; the audio goes to the server once and is not kept. */
function Recorder({ disabled, busy, onAudio }: { disabled: boolean; busy: boolean; onAudio: (b: Blob) => void }) {
  const t = useT();
  const [consent, setConsent] = useState(false);
  const [state, setState] = useState<'idle' | 'recording' | 'done'>('idle');
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stop = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    if (rec.current && rec.current.state !== 'inactive') rec.current.stop();
  };
  useEffect(() => stop, []);

  const start = async () => {
    setError(null);
    if (typeof window === 'undefined' || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError(t('This browser cannot record audio. Type the note instead.'));
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const r = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      r.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        setBlob(new Blob(chunks, { type: r.mimeType || 'audio/webm' }));
        setState('done');
      };
      rec.current = r;
      r.start();
      setSeconds(0);
      setState('recording');
      timer.current = setInterval(() => {
        setSeconds((s) => {
          if (s + 1 >= MAX_SECONDS) stop();
          return s + 1;
        });
      }, 1000);
    } catch {
      setError(t('Microphone access was blocked. Allow it in the browser, or type the note instead.'));
    }
  };

  return (
    <div className="space-y-3">
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-0.5 size-4 accent-[hsl(var(--primary))]" checked={consent} disabled={disabled || state === 'recording'} onChange={(e) => setConsent(e.target.checked)} />
        <span>{t('Everyone whose voice is on this recording agreed to it being transcribed.')}</span>
      </label>
      <div className="flex flex-wrap items-center gap-2">
        {state === 'recording' ? (
          <Button variant="outline" onClick={stop}>
            <Square aria-hidden /> {t('Stop ({time})', { time: clock(seconds) })}
          </Button>
        ) : (
          <Button variant="outline" onClick={() => void start()} disabled={disabled || !consent}>
            <Mic aria-hidden /> {state === 'done' ? t('Record again') : t('Start recording')}
          </Button>
        )}
        {state === 'done' && blob && (
          <Button onClick={() => onAudio(blob)} disabled={disabled || !consent}>
            {busy ? t('Transcribing…') : t('Transcribe {time}', { time: clock(seconds) })}
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{t('Up to 10 minutes. The audio is sent to Deepgram for transcription and is not stored by SampForce.')}</p>
      {error && (
        <p role="alert" className="text-sm text-critical">
          {error}
        </p>
      )}
    </div>
  );
}

/** Empty inputs mean "none", which the schema expresses as null. */
function clean(a: VoiceAction): VoiceAction {
  const out: Record<string, unknown> = { ...a };
  for (const [k, v] of Object.entries(out)) if (typeof v === 'string' && v.trim() === '' && k !== 'title' && k !== 'body' && k !== 'name' && k !== 'firstName') out[k] = null;
  return out as unknown as VoiceAction;
}

function Review({ note, onNote, onEdit, onClose }: { note: VoiceNote; onNote: (n: VoiceNote) => void; onEdit: () => void; onClose: () => void }) {
  const t = useT();
  const [drafts, setDrafts] = useState<VoiceAction[]>(() => note.actions.map((a) => a.action));
  // A note on no record cannot be saved, so it starts unticked; the warning on it says why.
  const [picked, setPicked] = useState<boolean[]>(() => note.actions.map((a) => a.status === 'proposed' && !(a.action.type === 'add_note' && !note.record)));
  const [errors, setErrors] = useState<Record<number, string>>({});
  const apply = useVoiceMutation((items: { index: number; action: VoiceAction }[]) => voiceApi.apply(note.id, items), (n) => {
    onNote(n);
    setDrafts(n.actions.map((a) => a.action));
    setPicked(n.actions.map(() => false));
  });
  const remove = useVoiceMutation(async () => {
    await voiceApi.remove(note.id);
    return note;
  }, onClose);

  const anyApplied = note.actions.some((a) => a.status === 'applied');
  const chosen = picked.map((p, i) => (p && note.actions[i]?.status === 'proposed' ? i : -1)).filter((i) => i >= 0);

  const save = () => {
    const errs: Record<number, string> = {};
    const items: { index: number; action: VoiceAction }[] = [];
    for (const i of chosen) {
      const parsed = voiceActionSchema.safeParse(clean(drafts[i]!));
      if (parsed.success) items.push({ index: i, action: parsed.data });
      else errs[i] = parsed.error.issues.map((x) => t.maybe(x.message)).join('. ');
    }
    setErrors(errs);
    if (Object.keys(errs).length === 0 && items.length) apply.mutate(items);
  };

  return (
    <div className="space-y-4">
      <section className="space-y-1 rounded-md border border-border bg-muted/40 p-3 text-sm">
        <div className="flex items-center gap-2">
          <Badge tone="accent">{t('AI suggestion')}</Badge>
          <span className="text-xs text-muted-foreground">{t('Check each item before saving.')}</span>
        </div>
        {note.summary && <p>{note.summary}</p>}
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">{t('Your note')}</summary>
          <p className="mt-1 whitespace-pre-wrap">{note.transcript}</p>
        </details>
      </section>

      {note.lastCall && (
        <section aria-label={t('Last call')} className="space-y-1 rounded-md border border-border p-3 text-sm">
          <h3 className="font-semibold">
            {t('Last call: {title}', { title: note.lastCall.title })} <span className="font-normal text-muted-foreground">({relativeTime(note.lastCall.occurredAt)})</span>
          </h3>
          <p className="whitespace-pre-wrap">{note.lastCall.summary}</p>
          <p className="text-xs text-muted-foreground">
            {note.lastCall.source === 'meeting_record' ? t('From the saved meeting summary.') : t('From the logged activity.')}{' '}
            <Link className="text-primary underline underline-offset-2" href={note.lastCall.link}>
              {t('Open')}
            </Link>
          </p>
        </section>
      )}
      {note.lastCallMissing && <p className="text-sm text-muted-foreground">{t('You asked about the last call, but there is no logged call or meeting summary to show yet.')}</p>}

      {note.unsupported.length > 0 && (
        <section aria-label={t('Not done')} className="space-y-1 rounded-md border border-warning/40 bg-warning/5 p-3 text-sm">
          <h3 className="flex items-center gap-1.5 font-semibold">
            <AlertTriangle className="size-4 text-warning" aria-hidden /> {t('Not done from a voice note')}
          </h3>
          <ul className="list-disc ps-5">
            {note.unsupported.map((u) => (
              <li key={u}>{t.maybe(u)}</li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">{t('Deleting records, sending email and changing amounts, stages or owners always need you to do it yourself on the record.')}</p>
        </section>
      )}

      {note.actions.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('Nothing in this note looks like a task, note, lead or contact to save.')}</p>
      ) : (
        <ul className="space-y-3" aria-label={t('Suggested actions')}>
          {note.actions.map((s, i) => (
            <li key={i} className="space-y-2 rounded-md border border-border p-3">
              <div className="flex items-center gap-2">
                {s.status === 'proposed' ? (
                  <input
                    type="checkbox"
                    aria-label={t('Save {kind} {n}', { kind: t.maybe(VOICE_ACTION_LABELS[s.action.type]), n: i + 1 })}
                    className="size-4 accent-[hsl(var(--primary))]"
                    checked={picked[i] ?? false}
                    onChange={(e) => setPicked((p) => p.map((v, j) => (j === i ? e.target.checked : v)))}
                  />
                ) : (
                  <Check className="size-4 text-success" aria-hidden />
                )}
                <Badge tone="primary">{t.maybe(VOICE_ACTION_LABELS[s.action.type])}</Badge>
                {s.status === 'applied' && s.result && (
                  <Link href={s.result.link} className="ms-auto inline-flex items-center gap-1 text-xs text-primary underline underline-offset-2">
                    {t('Saved')} <ExternalLink className="size-3" aria-hidden />
                  </Link>
                )}
              </div>
              {s.status === 'proposed' ? (
                <ActionFields id={`va-${i}`} action={drafts[i]!} onChange={(a) => setDrafts((d) => d.map((x, j) => (j === i ? a : x)))} />
              ) : (
                <p className="text-sm">{describe(t, s.action)}</p>
              )}
              {s.warnings.map((w) => (
                <p key={w} className="text-xs text-warning">
                  {t.maybe(w)}
                </p>
              ))}
              {errors[i] && (
                <p role="alert" className="text-xs text-critical">
                  {errors[i]}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
        {chosen.length > 0 && (
          <Button onClick={save} disabled={apply.isPending}>
            <Check aria-hidden /> {apply.isPending ? t('Saving…') : t('Save {n} selected', { n: chosen.length })}
          </Button>
        )}
        {!anyApplied && (
          <Button variant="outline" onClick={onEdit}>
            <Pencil aria-hidden /> {t('Change the note')}
          </Button>
        )}
        <Button variant="ghost" className="ms-auto text-critical" onClick={() => remove.mutate(undefined)} disabled={remove.isPending}>
          <Trash2 aria-hidden /> {t('Delete note')}
        </Button>
      </div>
      {anyApplied && <p className="text-xs text-muted-foreground">{t('Deleting this note does not remove what you already saved.')}</p>}
      {(apply.error || remove.error) && (
        <p role="alert" className="text-sm text-critical">
          {t.maybe((apply.error ?? remove.error)!.message)}
        </p>
      )}
    </div>
  );
}

function describe(t: Translator, a: VoiceAction): string {
  switch (a.type) {
    case 'create_task':
      return [a.title, a.dueDate && t('due {when}', { when: a.dueTime ? `${a.dueDate} ${a.dueTime}` : a.dueDate })].filter(Boolean).join(', ');
    case 'add_note':
      return a.body;
    case 'create_lead':
      return [a.name, a.company, a.email].filter(Boolean).join(', ');
    case 'create_contact':
      return [[a.firstName, a.lastName].filter(Boolean).join(' '), a.jobTitle, a.email].filter(Boolean).join(', ');
  }
}

function ActionFields({ id, action, onChange }: { id: string; action: VoiceAction; onChange: (a: VoiceAction) => void }) {
  const t = useT();
  const set = (k: string, v: unknown) => onChange({ ...action, [k]: v } as VoiceAction);
  const text = (k: string, label: string, opts: { type?: string } = {}) => (
    <Field id={`${id}-${k}`} label={t.maybe(label)}>
      <Input type={opts.type ?? 'text'} value={((action as Record<string, unknown>)[k] as string | null) ?? ''} onChange={(e) => set(k, e.target.value)} />
    </Field>
  );
  switch (action.type) {
    case 'create_task':
      return (
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="sm:col-span-2">{text('title', 'Task')}</div>
          {text('dueDate', 'Due date', { type: 'date' })}
          {text('dueTime', 'Time', { type: 'time' })}
          <label className="flex items-start gap-2 text-sm sm:col-span-2">
            <input type="checkbox" className="mt-0.5 size-4 accent-[hsl(var(--primary))]" checked={action.meeting} onChange={(e) => set('meeting', e.target.checked)} />
            <span>{t('This is a meeting to arrange. It is saved as a task; no calendar invite is sent.')}</span>
          </label>
        </div>
      );
    case 'add_note':
      return (
        <Field id={`${id}-body`} label={t('Note')}>
          <Textarea rows={3} value={action.body} onChange={(e) => set('body', e.target.value)} />
        </Field>
      );
    case 'create_lead':
      return (
        <div className="grid gap-2 sm:grid-cols-2">
          {text('name', 'Name')}
          {text('company', 'Company')}
          {text('email', 'Email', { type: 'email' })}
          {text('phone', 'Phone')}
        </div>
      );
    case 'create_contact':
      return (
        <div className="grid gap-2 sm:grid-cols-2">
          {text('firstName', 'First name')}
          {text('lastName', 'Last name')}
          {text('jobTitle', 'Job title')}
          {text('email', 'Email', { type: 'email' })}
          {text('phone', 'Phone')}
        </div>
      );
  }
}

/** Shown only while the plan includes voice_notes (ADR 0057). */
export const VoiceNoteButton = gated('voice_notes', VoiceNoteButtonPanel);

/** Shown only while the plan includes voice_notes (ADR 0057). */
export const RecordVoiceNotes = gated('voice_notes', RecordVoiceNotesPanel);
