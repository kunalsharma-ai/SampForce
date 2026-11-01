'use client';

import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Field, Input, Skeleton } from '@dealflow/ui';
import { type MeetingAnalysis, meetingAnalysisSchema, type MeetingRecord, type MeetingRecordUpdate, type TranscriptionStatus } from '@dealflow/types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ExternalLink, Mail, Plus, Sparkles, Trash2, Upload, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { RecordPicker } from '@/components/crm/record-picker';
import { DetailError } from '@/components/crm/record-detail';
import { Select, Textarea } from '@/components/crm/select';
import { recordStage } from '@/components/meetings/record-meetings';
import { TranscriptionBanner } from '@/components/meetings/transcription-banner';
import { ComposeDialog } from '@/app/app/communication/mailbox';
import { aiErrorMessage } from '@/lib/ai';
import { api } from '@/lib/api';
import { relativeTime } from '@/lib/format';
import { uploadRecording, useMeetingRecord, useTranscriptionStatus } from '@/lib/meetings';
import { useCan } from '@/lib/session';
import { fmtLocale } from '@/lib/i18n/locale';

const SOURCE_LABEL = { notes: 'Notes', transcript: 'Transcript', recording: 'Transcribed recording' } as const;
const when = (iso: string) => new Date(iso).toLocaleString(fmtLocale(), { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function useRecordMutation<T>(id: string, fn: (arg: T) => Promise<MeetingRecord>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async (r) => {
      qc.setQueryData(['meeting-records', 'one', id], r);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['meeting-records'], predicate: (q) => q.queryKey[1] !== 'one' }),
        qc.invalidateQueries({ queryKey: ['meetings'] }),
        qc.invalidateQueries({ queryKey: ['tasks'] }),
        qc.invalidateQueries({ queryKey: ['activities'] }),
      ]);
    },
  });
}

function useUpdate(id: string) {
  return useRecordMutation(id, (body: MeetingRecordUpdate) => api<MeetingRecord>(`/meeting-records/${id}`, { method: 'PATCH', json: body }));
}

export function MeetingRecordView({ id }: { id: string }) {
  const rec = useMeetingRecord(id);
  const status = useTranscriptionStatus();
  const canWrite = useCan('activities:write');
  const router = useRouter();
  const update = useUpdate(id);
  const remove = useMutation({
    mutationFn: () => api(`/meeting-records/${id}`, { method: 'DELETE' }),
    onSuccess: () => router.push('/app/meetings'),
  });
  if (rec.isPending) return <Skeleton className="h-96 max-w-5xl" />;
  if (rec.error) return <DetailError error={rec.error} />;
  const r = rec.data;
  const stage = recordStage(r);
  const linked = r.deal ?? r.contact ?? r.lead;

  return (
    <div className="max-w-5xl space-y-4">
      <Link href="/app/meetings" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="rtl:-scale-x-100 size-4" aria-hidden /> Meetings
      </Link>
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">{r.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {when(r.occurredAt)} · {SOURCE_LABEL[r.source]}
            {r.createdBy && ` · added by ${r.createdBy.name}`}
          </p>
          {r.attendees.length > 0 && <p className="mt-1 text-xs text-muted-foreground">Invited: {r.attendees.join(', ')}</p>}
        </div>
        <Badge tone={stage.tone}>{stage.label}</Badge>
        {r.joinUrl && (
          <a href={r.joinUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm text-primary underline underline-offset-2">
            Meeting link <ExternalLink className="size-3" aria-hidden />
          </a>
        )}
        {canWrite && (
          <Button
            variant="outline"
            size="sm"
            disabled={remove.isPending}
            onClick={() => {
              if (window.confirm('Delete these meeting notes? Tasks and timeline notes already created stay.')) remove.mutate();
            }}
          >
            <Trash2 aria-hidden /> Delete notes
          </Button>
        )}
      </div>
      {remove.error && <p role="alert" className="text-sm text-critical">{remove.error.message}</p>}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Linked records</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {canWrite ? (
            <div className="grid gap-3 sm:grid-cols-3">
              {(
                [
                  ['deal', 'deals', 'Linked deal', r.deal],
                  ['contact', 'contacts', 'Linked contact', r.contact],
                  ['lead', 'leads', 'Linked lead', r.lead],
                ] as const
              ).map(([key, entity, label, value]) => (
                <div key={key} className="space-y-1">
                  <label htmlFor={`mr-${key}`} className="text-xs font-medium">
                    {label}
                  </label>
                  <RecordPicker id={`mr-${key}`} entity={entity} value={value} placeholder={`Search ${entity}`} onChange={(v) => update.mutate({ [`${key}Id`]: v?.id ?? null })} />
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm">{linked ? linked.name : 'Not linked to a record.'}</p>
          )}
          {update.error && <p role="alert" className="text-sm text-critical">{update.error.message}</p>}
        </CardContent>
      </Card>

      <TranscriptCard r={r} status={status.data} canWrite={canWrite} />
      <AnalysisCard r={r} canWrite={canWrite} />
    </div>
  );
}

function TranscriptCard({ r, status, canWrite }: { r: MeetingRecord; status: TranscriptionStatus | undefined; canWrite: boolean }) {
  const update = useUpdate(r.id);
  const [text, setText] = useState(r.transcript ?? '');
  const [source, setSource] = useState<'notes' | 'transcript'>(r.source === 'notes' ? 'notes' : 'transcript');
  const [editing, setEditing] = useState(!r.segments?.length);
  const [file, setFile] = useState<File | null>(null);
  const [consent, setConsent] = useState(false);
  const upload = useRecordMutation(r.id, (f: File) => uploadRecording(r.id, f));
  const names = new Map((r.analysis?.participants ?? []).filter((p) => p.speaker !== null).map((p) => [p.speaker!, p.name]));
  const dirty = text !== (r.transcript ?? '') || (r.source !== 'recording' && source !== r.source);
  const ready = status && status.state !== 'pending_configuration';
  const tooBig = file && status ? file.size > status.maxUploadMb * 1024 * 1024 : false;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Notes and transcript</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {r.segments?.length && !editing ? (
          <div className="space-y-2">
            <ol className="max-h-96 space-y-2 overflow-y-auto rounded-md border border-border p-3 text-sm" aria-label="Transcript">
              {r.segments.map((s, i) => (
                <li key={i} className="flex gap-3">
                  <span className="w-12 shrink-0 tabular-nums text-xs text-muted-foreground">{clock(s.start)}</span>
                  <span>
                    {s.speaker !== null && <span className="font-medium">{names.get(s.speaker) ?? `Speaker ${s.speaker}`}: </span>}
                    {s.text}
                  </span>
                </li>
              ))}
            </ol>
            {canWrite && (
              <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                Edit as text
              </Button>
            )}
          </div>
        ) : (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              update.mutate({ transcript: text, source }, { onSuccess: () => setEditing(false) });
            }}
          >
            <Field id="mr-transcript" label="Notes or transcript" hint={r.segments?.length ? 'Saving text replaces the speaker timings from the recording.' : 'Paste your notes, or a transcript you are allowed to share. "Speaker 1:" style lines help the AI tell people apart.'}>
              <Textarea value={text} readOnly={!canWrite} maxLength={200_000} className="min-h-56" onChange={(e) => setText(e.target.value)} placeholder="What was discussed, what was decided, who will do what…" />
            </Field>
            {canWrite && (
              <div className="flex flex-wrap items-end gap-2">
                <div className="space-y-1">
                  <label htmlFor="mr-source" className="text-xs font-medium">
                    This text is
                  </label>
                  <Select id="mr-source" className="w-auto" value={source} onChange={(e) => setSource(e.target.value as 'notes' | 'transcript')}>
                    <option value="notes">My notes</option>
                    <option value="transcript">A transcript</option>
                  </Select>
                </div>
                <Button type="submit" disabled={!dirty || update.isPending}>
                  Save notes
                </Button>
                {r.segments?.length ? (
                  <Button type="button" variant="outline" onClick={() => setEditing(false)}>
                    Cancel
                  </Button>
                ) : null}
              </div>
            )}
            {update.error && <p role="alert" className="text-sm text-critical">{update.error.message}</p>}
          </form>
        )}

        <div className="space-y-3 border-t border-border pt-4">
          <h3 className="text-sm font-semibold">Transcribe a recording</h3>
          <TranscriptionBanner status={status} />
          {r.recordingConsent && (
            <p className="text-xs text-muted-foreground">
              Recording consent confirmed by {r.recordingConsent.by?.name ?? 'a former user'} {relativeTime(r.recordingConsent.at)}.
            </p>
          )}
          {r.transcriptionStatus === 'failed' && r.transcriptionError && (
            <p role="alert" className="text-sm text-critical">
              The last transcription failed: {r.transcriptionError}
            </p>
          )}
          {canWrite && (
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (file) upload.mutate(file, { onSuccess: () => { setFile(null); setConsent(false); setEditing(false); } });
              }}
            >
              <Field id="mr-file" label="Recording (audio or video)" hint={`Up to ${status?.maxUploadMb ?? 100} MB. The file is sent to Deepgram for transcription and is not stored by DealFlow. A new transcription replaces the text above.`}>
                <input
                  type="file"
                  accept="audio/*,video/*"
                  disabled={!ready}
                  className="block text-sm file:me-3 file:rounded-md file:border file:border-border file:bg-background file:px-3 file:py-1.5 file:text-sm disabled:opacity-60"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
              </Field>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-0.5 size-4 accent-[hsl(var(--primary))]" checked={consent} disabled={!ready} onChange={(e) => setConsent(e.target.checked)} />
                <span>Everyone in this meeting agreed to it being recorded and transcribed.</span>
              </label>
              {tooBig && <p className="text-sm text-critical">This file is larger than {status?.maxUploadMb} MB.</p>}
              <Button type="submit" variant="outline" disabled={!ready || !file || !consent || !!tooBig || upload.isPending}>
                <Upload aria-hidden /> {upload.isPending ? 'Transcribing…' : 'Transcribe recording'}
              </Button>
              {upload.error && <p role="alert" className="text-sm text-critical">{upload.error.message}</p>}
            </form>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function AnalysisCard({ r, canWrite }: { r: MeetingRecord; canWrite: boolean }) {
  const canAi = useCan('ai:use');
  const analyse = useRecordMutation(r.id, () => api<MeetingRecord>(`/meeting-records/${r.id}/analyse`, { method: 'POST' }));
  const hasText = !!(r.transcript?.trim() || r.segments?.length);
  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">Meeting summary</CardTitle>
        {canWrite && canAi && (
          <Button
            size="sm"
            variant={r.analysis ? 'outline' : 'default'}
            disabled={!hasText || analyse.isPending}
            onClick={() => {
              if (r.reviewed && !window.confirm('Analysing again replaces your reviewed version with a new AI draft. Continue?')) return;
              analyse.mutate(undefined);
            }}
          >
            <Sparkles aria-hidden /> {analyse.isPending ? 'Analysing…' : r.analysis ? 'Analyse again' : 'Analyse with AI'}
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {analyse.error && <p role="alert" className="text-sm text-critical">{aiErrorMessage(analyse.error)}</p>}
        {!r.analysis ? (
          <p className="text-sm text-muted-foreground">
            {hasText
              ? 'Analyse the notes to get a summary, requirements, objections, decisions, action items and a follow-up email draft. You review and edit everything before it reaches the CRM.'
              : 'Add notes, a transcript or a recording first.'}
          </p>
        ) : (
          <AnalysisEditor key={`${r.analysedAt}-${r.reviewedAt}-${r.taskIds.length}`} r={r} analysis={r.analysis} canWrite={canWrite} />
        )}
      </CardContent>
    </Card>
  );
}

const lines = (s: string) => s.split('\n').map((l) => l.trim()).filter(Boolean);

function LinesField({ id, label, value, onChange, disabled }: { id: string; label: string; value: string[]; onChange: (v: string[]) => void; disabled: boolean }) {
  const [text, setText] = useState(value.join('\n'));
  return (
    <Field id={id} label={label} hint="One per line.">
      <Textarea
        value={text}
        readOnly={disabled}
        className="min-h-20"
        onChange={(e) => {
          setText(e.target.value);
          onChange(lines(e.target.value));
        }}
      />
    </Field>
  );
}

function AnalysisEditor({ r, analysis, canWrite }: { r: MeetingRecord; analysis: MeetingAnalysis; canWrite: boolean }) {
  const [draft, setDraft] = useState<MeetingAnalysis>(() => structuredClone(analysis));
  const [error, setError] = useState<string | null>(null);
  const [gen, setGen] = useState(0);
  const update = useUpdate(r.id);
  const dirty = JSON.stringify(draft) !== JSON.stringify(analysis);
  const set = <K extends keyof MeetingAnalysis>(k: K, v: MeetingAnalysis[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const ro = !canWrite;

  const save = () => {
    const parsed = meetingAnalysisSchema.safeParse(draft);
    if (!parsed.success) {
      const i = parsed.error.issues[0]!;
      setError(`${i.path.join(' › ')}: ${i.message}`);
      return;
    }
    setError(null);
    update.mutate({ analysis: parsed.data });
  };

  return (
    <div className="space-y-5 text-sm">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        {r.reviewed && r.reviewedBy ? (
          <Badge tone="success">Reviewed by {r.reviewedBy.name}</Badge>
        ) : (
          <Badge tone="warning">AI draft: check it, edit it and save it before using it</Badge>
        )}
        <span>AI-assisted{r.analysedAt && ` · analysed ${relativeTime(r.analysedAt)}`}{r.reviewedAt && ` · reviewed ${relativeTime(r.reviewedAt)}`}</span>
      </div>

      <Field id="mr-summary" label="Summary">
        <Textarea value={draft.summary} readOnly={ro} className="min-h-24" maxLength={4000} onChange={(e) => set('summary', e.target.value)} />
      </Field>
      <div className="grid gap-4 md:grid-cols-2">
        <LinesField key={`mr-key-points-${gen}`} id="mr-key-points" label="Key points" value={draft.keyPoints} onChange={(v) => set('keyPoints', v)} disabled={ro} />
        <LinesField key={`mr-requirements-${gen}`} id="mr-requirements" label="Requirements" value={draft.requirements} onChange={(v) => set('requirements', v)} disabled={ro} />
        <LinesField key={`mr-objections-${gen}`} id="mr-objections" label="Objections and concerns" value={draft.objections} onChange={(v) => set('objections', v)} disabled={ro} />
        <LinesField key={`mr-decisions-${gen}`} id="mr-decisions" label="Decisions" value={draft.decisions} onChange={(v) => set('decisions', v)} disabled={ro} />
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Action items</legend>
        {draft.actionItems.length === 0 && <p className="text-muted-foreground">No action items.</p>}
        {draft.actionItems.map((a, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <Input aria-label={`Action ${i + 1}`} className="min-w-48 flex-1" value={a.title} readOnly={ro} maxLength={200} onChange={(e) => set('actionItems', draft.actionItems.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} />
            <Select aria-label={`Who does action ${i + 1}`} className="w-auto" value={a.owner} disabled={ro} onChange={(e) => set('actionItems', draft.actionItems.map((x, j) => (j === i ? { ...x, owner: e.target.value as 'me' | 'customer' } : x)))}>
              <option value="me">Us</option>
              <option value="customer">Customer</option>
            </Select>
            <Input
              aria-label={`Days until action ${i + 1} is due`}
              type="number"
              min={0}
              max={365}
              placeholder="Days"
              className="w-28"
              readOnly={ro}
              value={a.dueInDays ?? ''}
              onChange={(e) => set('actionItems', draft.actionItems.map((x, j) => (j === i ? { ...x, dueInDays: e.target.value === '' ? null : Math.max(0, Math.min(365, Math.round(Number(e.target.value)))) } : x)))}
            />
            {a.taskId ? (
              <Badge tone="success">Task created</Badge>
            ) : (
              !ro && (
                <Button type="button" variant="ghost" size="sm" aria-label={`Remove action ${i + 1}`} onClick={() => set('actionItems', draft.actionItems.filter((_, j) => j !== i))}>
                  <X aria-hidden />
                </Button>
              )
            )}
          </div>
        ))}
        {!ro && draft.actionItems.length < 20 && (
          <Button type="button" variant="outline" size="sm" onClick={() => set('actionItems', [...draft.actionItems, { title: '', owner: 'me', dueInDays: null }])}>
            <Plus aria-hidden /> Add action
          </Button>
        )}
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Commitments</legend>
        {draft.commitments.length === 0 && <p className="text-muted-foreground">No commitments recorded.</p>}
        {draft.commitments.map((c, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <Input aria-label={`Who made commitment ${i + 1}`} className="w-40" value={c.who} readOnly={ro} maxLength={120} onChange={(e) => set('commitments', draft.commitments.map((x, j) => (j === i ? { ...x, who: e.target.value } : x)))} />
            <Input aria-label={`Commitment ${i + 1}`} className="min-w-48 flex-1" value={c.what} readOnly={ro} maxLength={500} onChange={(e) => set('commitments', draft.commitments.map((x, j) => (j === i ? { ...x, what: e.target.value } : x)))} />
            {!ro && (
              <Button type="button" variant="ghost" size="sm" aria-label={`Remove commitment ${i + 1}`} onClick={() => set('commitments', draft.commitments.filter((_, j) => j !== i))}>
                <X aria-hidden />
              </Button>
            )}
          </div>
        ))}
        {!ro && draft.commitments.length < 20 && (
          <Button type="button" variant="outline" size="sm" onClick={() => set('commitments', [...draft.commitments, { who: '', what: '' }])}>
            <Plus aria-hidden /> Add commitment
          </Button>
        )}
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Participants</legend>
        <p className="text-xs text-muted-foreground">Names come from what was said. Correct them here; nothing is looked up elsewhere.</p>
        {draft.participants.map((p, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            {p.speaker !== null && <span className="w-20 text-xs text-muted-foreground">Speaker {p.speaker}</span>}
            <Input aria-label={`Participant ${i + 1} name`} className="min-w-40 flex-1" value={p.name} readOnly={ro} maxLength={120} onChange={(e) => set('participants', draft.participants.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
            <Select aria-label={`Participant ${i + 1} side`} className="w-auto" value={p.side} disabled={ro} onChange={(e) => set('participants', draft.participants.map((x, j) => (j === i ? { ...x, side: e.target.value as 'us' | 'customer' | 'unknown' } : x)))}>
              <option value="us">Our team</option>
              <option value="customer">Customer</option>
              <option value="unknown">Not sure</option>
            </Select>
            {!ro && (
              <Button type="button" variant="ghost" size="sm" aria-label={`Remove participant ${i + 1}`} onClick={() => set('participants', draft.participants.filter((_, j) => j !== i))}>
                <X aria-hidden />
              </Button>
            )}
          </div>
        ))}
        {!ro && draft.participants.length < 30 && (
          <Button type="button" variant="outline" size="sm" onClick={() => set('participants', [...draft.participants, { name: '', speaker: null, side: 'unknown' }])}>
            <Plus aria-hidden /> Add participant
          </Button>
        )}
      </fieldset>

      <fieldset className="space-y-3 rounded-md border border-border p-3">
        <legend className="px-1 text-sm font-medium">Follow-up email draft</legend>
        <Field id="mr-fu-subject" label="Email subject">
          <Input value={draft.followUpEmail.subject} readOnly={ro} maxLength={200} onChange={(e) => set('followUpEmail', { ...draft.followUpEmail, subject: e.target.value })} />
        </Field>
        <Field id="mr-fu-body" label="Email body">
          <Textarea value={draft.followUpEmail.body} readOnly={ro} className="min-h-32" maxLength={5000} onChange={(e) => set('followUpEmail', { ...draft.followUpEmail, body: e.target.value })} />
        </Field>
      </fieldset>

      {canWrite && (
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={save} disabled={(!dirty && r.reviewed) || update.isPending}>
            {r.reviewed && !dirty ? 'Reviewed' : 'Save reviewed version'}
          </Button>
          {dirty && (
            <Button variant="outline" onClick={() => {
                setDraft(structuredClone(analysis));
                setGen((g) => g + 1);
              }}>
              Discard changes
            </Button>
          )}
          {(error || update.error) && <p role="alert" className="text-sm text-critical">{error ?? update.error?.message}</p>}
        </div>
      )}

      {canWrite && <UseIt r={r} analysis={analysis} blocked={dirty ? 'Save your edits first.' : !r.reviewed ? 'Save the reviewed version first. Nothing from an unreviewed AI draft goes onto the CRM.' : null} />}
    </div>
  );
}

function UseIt({ r, analysis, blocked }: { r: MeetingRecord; analysis: MeetingAnalysis; blocked: string | null }) {
  const open = analysis.actionItems.map((a, i) => ({ ...a, i })).filter((a) => !a.taskId);
  const [picked, setPicked] = useState<number[]>(() => open.filter((a) => a.owner === 'me').map((a) => a.i));
  const [composing, setComposing] = useState(false);
  const tasks = useRecordMutation(r.id, (indexes: number[]) => api<MeetingRecord>(`/meeting-records/${r.id}/tasks`, { method: 'POST', json: { indexes } }));
  const save = useRecordMutation(r.id, () => api<MeetingRecord>(`/meeting-records/${r.id}/save`, { method: 'POST' }));
  const target = r.deal ? `deal ${r.deal.name}` : r.contact ? r.contact.name : r.lead ? r.lead.name : null;
  const chosen = picked.filter((i) => open.some((a) => a.i === i));

  return (
    <section className="space-y-4 border-t border-border pt-4" aria-labelledby="mr-use">
      <h3 id="mr-use" className="text-sm font-semibold">
        Put it to use
      </h3>
      {blocked && <p className="text-sm text-muted-foreground">{blocked}</p>}

      {open.length > 0 && (
        <fieldset className="space-y-1.5" disabled={!!blocked}>
          <legend className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Create tasks</legend>
          {open.map((a) => (
            <label key={a.i} className="flex items-start gap-2">
              <input type="checkbox" className="mt-0.5 size-4 accent-[hsl(var(--primary))]" checked={picked.includes(a.i)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, a.i] : p.filter((x) => x !== a.i)))} />
              <span>
                {a.title}
                <span className="block text-xs text-muted-foreground">
                  {a.owner === 'me' ? 'For us' : 'For the customer (a reminder to follow up)'}
                  {a.dueInDays !== null && ` · due in ${a.dueInDays} day${a.dueInDays === 1 ? '' : 's'}`}
                </span>
              </span>
            </label>
          ))}
          <Button size="sm" onClick={() => tasks.mutate(chosen)} disabled={!chosen.length || tasks.isPending}>
            Create {chosen.length} task{chosen.length === 1 ? '' : 's'}
          </Button>
        </fieldset>
      )}
      {r.taskIds.length > 0 && (
        <p className="text-xs text-success">
          {r.taskIds.length} task{r.taskIds.length === 1 ? '' : 's'} created from this meeting.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {r.activityId ? (
          <p className="text-xs text-success">Summary added to the timeline of {target ?? 'the linked record'}.</p>
        ) : (
          <Button size="sm" variant="outline" disabled={!!blocked || !target || save.isPending} onClick={() => save.mutate(undefined)}>
            {target ? `Add summary to ${target}` : 'Add summary to a record'}
          </Button>
        )}
        {!target && !r.activityId && <span className="text-xs text-muted-foreground">Link a deal, contact or lead above first.</span>}
        <Button size="sm" variant="outline" disabled={!!blocked} onClick={() => setComposing(true)}>
          <Mail aria-hidden /> Write follow-up email
        </Button>
      </div>
      {(tasks.error || save.error) && <p role="alert" className="text-sm text-critical">{(tasks.error ?? save.error)?.message}</p>}
      {composing && (
        <ComposeDialog
          open={composing}
          onOpenChange={setComposing}
          contactId={r.contact?.id}
          leadId={r.contact ? undefined : r.lead?.id}
          subject={analysis.followUpEmail.subject}
          body={analysis.followUpEmail.body}
        />
      )}
    </section>
  );
}
