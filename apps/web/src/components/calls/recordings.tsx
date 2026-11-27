'use client';

import { RECORDING_SOURCE_LABELS, type RecordingRow } from '@dealflow/types';
import { Badge, Button, cn, Input, Skeleton } from '@dealflow/ui';
import { ArrowDownLeft, ArrowUpRight, Download, Pause, Play, Trash2, Volume2, VolumeX } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';
import { OutcomeChip } from '@/components/calls/outcomes';
import { formatDateTime } from '@/components/crm/follow-ups';
import { Select, Textarea } from '@/components/crm/select';
import { recordingAudioUrl, talkTime, useRecordingMutations, useRecordingPolicy, useRecordings } from '@/lib/calls';
import { useT } from '@/lib/i18n';

const dayStart = (v: string) => (v ? new Date(`${v}T00:00:00`).toISOString() : undefined);
const dayEnd = (v: string) => (v ? new Date(new Date(`${v}T00:00:00`).getTime() + 86_400_000).toISOString() : undefined);

/**
 * Call recordings (ADR 0101): every recording you may hear, with who the call was with, when, the dialer and the
 * outcome. Play, seek, volume and notes; download where the workspace allows it. Kept as long as the policy says.
 */
export function CallRecordings({ focus }: { focus: string | null }) {
  const t = useT();
  const policy = useRecordingPolicy();
  const [scope, setScope] = React.useState<'mine' | 'team' | 'all'>('mine');
  const [q, setQ] = React.useState('');
  const [debounced, setDebounced] = React.useState('');
  const [from, setFrom] = React.useState('');
  const [to, setTo] = React.useState('');
  React.useEffect(() => {
    const id = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(id);
  }, [q]);
  const list = useRecordings({ scope, q: debounced || undefined, from: dayStart(from), to: dayEnd(to), limit: 100 });
  const focused = React.useRef<HTMLLIElement>(null);
  React.useEffect(() => focused.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }), [focus, list.data]);
  return (
    <div className="space-y-3">
      {policy.data && !policy.data.enabled && <p className="rounded-xl bg-warning/10 p-3 text-sm">{t('Recording is switched off for this workspace. Recordings already kept stay here until they expire.')}</p>}
      {policy.data?.enabled && (
        <p className="text-xs text-muted-foreground">
          {policy.data.retentionDays ? t('Recordings are kept for {days} days.', { days: String(policy.data.retentionDays) }) : t('Recordings are kept until someone deletes them.')}{' '}
          {policy.data.download === 'NONE' ? t('Nobody can download them.') : policy.data.download === 'MANAGERS' ? t('Managers and admins can download them.') : t('Everyone who can play them can download them.')}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Select aria-label={t('Whose calls')} className="h-9 w-auto" value={scope} onChange={(e) => setScope(e.target.value as typeof scope)}>
          <option value="mine">{t('Mine')}</option>
          <option value="team">{t('My team')}</option>
          <option value="all">{t('Everyone')}</option>
        </Select>
        <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Search by company, contact or number')} aria-label={t('Search recordings')} className="h-9 w-full sm:w-64" />
        <Input type="date" aria-label={t('From')} className="h-9 w-auto" value={from} onChange={(e) => setFrom(e.target.value)} />
        <Input type="date" aria-label={t('To')} className="h-9 w-auto" value={to} onChange={(e) => setTo(e.target.value)} />
      </div>
      {list.isPending ? (
        <Skeleton className="h-32" />
      ) : !list.data?.length ? (
        <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">{t('No recordings here. Calls through a dialer that records, or with a recording uploaded, appear here.')}</p>
      ) : (
        <ul className="space-y-3" aria-label={t('Call recordings')}>
          {list.data.map((r) => (
            <li key={r.id} ref={r.id === focus ? focused : undefined} data-testid="recording-row" className={cn('rounded-2xl border bg-surface p-4 shadow-sm', r.id === focus ? 'border-rose-500 ring-2 ring-rose-500/30' : 'border-border')}>
              <RecordingCard r={r} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RecordingCard({ r }: { r: RecordingRow }) {
  const t = useT();
  const m = useRecordingMutations();
  const [notes, setNotes] = React.useState(r.notes ?? '');
  const [editing, setEditing] = React.useState(false);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
            {r.call.direction === 'INCOMING' ? <ArrowDownLeft aria-hidden className="size-4 text-sky-600" /> : <ArrowUpRight aria-hidden className="size-4 text-emerald-600 rtl:-scale-x-100" />}
            {r.employee?.name ?? r.company?.name ?? r.call.number}
            {r.call.outcome && <OutcomeChip outcome={r.call.outcome} />}
          </p>
          <p className="text-xs text-muted-foreground">
            {[r.employee?.designation, r.company?.name, formatDateTime(r.call.startedAt), r.call.dialer.name, r.by?.name].filter(Boolean).join(' · ')}
          </p>
        </div>
        <Badge tone="neutral">{t.maybe(RECORDING_SOURCE_LABELS[r.source])}</Badge>
        {r.company && (
          <Link href={`/app/companies/${r.company.id}`} className="text-xs font-medium text-primary hover:underline">
            {t('Open company')}
          </Link>
        )}
      </div>
      {r.playable ? <AudioPlayer src={recordingAudioUrl(r.id)} durationSec={r.durationSec} /> : <p className="text-sm text-muted-foreground">{t('The provider no longer has this recording.')}</p>}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {r.canDownload && (
          <a href={recordingAudioUrl(r.id, true)} className="inline-flex h-8 items-center gap-1 rounded-md border border-border px-3 font-medium hover:bg-muted" download>
            <Download aria-hidden className="size-3.5" /> {t('Download')}
          </a>
        )}
        {r.expiresAt && <span className="text-muted-foreground">{t('Kept until {date}', { date: formatDateTime(r.expiresAt) })}</span>}
        {r.sizeBytes != null && <span className="text-muted-foreground">{Math.max(1, Math.round(r.sizeBytes / 1024))} KB</span>}
        <span className="flex-1" />
        <Button size="sm" variant="ghost" onClick={() => setEditing((e) => !e)}>
          {r.notes ? t('Edit notes') : t('Add notes')}
        </Button>
        <Button size="icon" variant="ghost" className="size-8 text-critical" aria-label={t('Delete the recording')} onClick={() => window.confirm(t('Delete this recording? It cannot be brought back.')) && m.remove.mutate(r.id)}>
          <Trash2 aria-hidden className="size-3.5" />
        </Button>
      </div>
      {r.notes && !editing && <p className="whitespace-pre-line rounded-xl bg-muted/50 p-2 text-sm">{r.notes}</p>}
      {editing && (
        <form
          className="space-y-2"
          onSubmit={async (e) => {
            e.preventDefault();
            await m.notes.mutateAsync({ id: r.id, notes: notes || null });
            setEditing(false);
          }}
        >
          <Textarea aria-label={t('Notes')} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={5000} />
          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
              {t('Cancel')}
            </Button>
            <Button type="submit" size="sm" disabled={m.notes.isPending}>
              {t('Save notes')}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

/** A player with play and pause, a seek bar, the time, and volume. */
export function AudioPlayer({ src, durationSec }: { src: string; durationSec: number | null }) {
  const t = useT();
  const el = React.useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = React.useState(false);
  const [pos, setPos] = React.useState(0);
  const [length, setLength] = React.useState(durationSec ?? 0);
  const [volume, setVolume] = React.useState(1);
  const [muted, setMuted] = React.useState(false);
  const [error, setError] = React.useState(false);
  const toggle = () => {
    const a = el.current;
    if (!a) return;
    if (a.paused) void a.play().catch(() => setError(true));
    else a.pause();
  };
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl bg-gradient-to-r from-rose-500/10 via-violet-500/10 to-sky-500/10 p-3">
      <audio
        ref={el}
        src={src}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(e) => setPos(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => Number.isFinite(e.currentTarget.duration) && setLength(e.currentTarget.duration)}
        onError={() => setError(true)}
      />
      <button type="button" onClick={toggle} aria-label={playing ? t('Pause') : t('Play')} className="flex size-10 items-center justify-center rounded-full bg-rose-600 text-white shadow transition hover:bg-rose-700 active:scale-95">
        {playing ? <Pause aria-hidden className="size-4" /> : <Play aria-hidden className="size-4 translate-x-px" />}
      </button>
      <span className="w-12 text-end font-mono text-xs tabular-nums">{talkTime(Math.floor(pos))}</span>
      <input
        type="range"
        min={0}
        max={Math.max(1, length)}
        step={0.1}
        value={pos}
        aria-label={t('Position')}
        onChange={(e) => {
          const v = Number(e.target.value);
          setPos(v);
          if (el.current) el.current.currentTime = v;
        }}
        className="min-w-32 flex-1 accent-rose-600"
      />
      <span className="w-12 font-mono text-xs tabular-nums text-muted-foreground">{talkTime(Math.floor(length))}</span>
      <span className="flex items-center gap-1">
        <button type="button" onClick={() => {
          setMuted((x) => !x);
          if (el.current) el.current.muted = !muted;
        }} aria-label={muted ? t('Sound on') : t('Sound off')} className="rounded p-1 hover:bg-muted">
          {muted || volume === 0 ? <VolumeX aria-hidden className="size-4" /> : <Volume2 aria-hidden className="size-4" />}
        </button>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={volume}
          aria-label={t('Volume')}
          onChange={(e) => {
            const v = Number(e.target.value);
            setVolume(v);
            if (el.current) el.current.volume = v;
          }}
          className="w-20 accent-rose-600"
        />
      </span>
      {error && <p className="w-full text-xs text-critical">{t('The recording could not be played.')}</p>}
    </div>
  );
}
