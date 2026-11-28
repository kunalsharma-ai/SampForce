'use client';

import { isSingleEmoji, MOOD_PRESETS, type PersonMood } from '@dealflow/types';
import { Button, cn, Dialog, DialogContent, DialogDescription, DialogTitle, Input } from '@dealflow/ui';
import * as React from 'react';
import { ApiError } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { useSetMood } from '@/lib/people';

/** More emoji to choose from, in a few friendly groups. */
const EMOJI_GROUPS: { label: string; emoji: string[] }[] = [
  { label: 'Feelings', emoji: ['😀', '😄', '😊', '🥳', '😎', '🤩', '😌', '🙂', '🤔', '😴', '🥱', '😅', '😤', '🤯', '🥶', '🤗'] },
  { label: 'Work', emoji: ['💼', '📈', '💰', '🏆', '🔥', '⚡', '✅', '📞', '📊', '✍️', '💡', '🧩', '🛠️', '📣', '🎤', '⏳'] },
  { label: 'Life', emoji: ['☕', '🍕', '🏋️', '🧘', '🎧', '🎮', '📚', '🌍', '🚗', '🏠', '👶', '🐶', '🌞', '🌧️', '🎂', '❤️'] },
];

/** How long a mood lasts before it clears itself. "Today" ends at midnight in the person's own time zone. */
const CLEAR_AFTER = [
  { key: 'never', label: 'Don’t clear' },
  { key: '30m', label: '30 minutes' },
  { key: '1h', label: '1 hour' },
  { key: '4h', label: '4 hours' },
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This week' },
] as const;
type ClearAfter = (typeof CLEAR_AFTER)[number]['key'];

export function expiryFor(key: ClearAfter, now = new Date()): string | null {
  const minutes = { '30m': 30, '1h': 60, '4h': 240 } as Record<string, number>;
  if (key === 'never') return null;
  if (minutes[key]) return new Date(now.getTime() + minutes[key] * 60_000).toISOString();
  const end = new Date(now);
  end.setHours(23, 59, 59, 0);
  // "This week" runs to the end of Sunday.
  if (key === 'week') end.setDate(end.getDate() + ((7 - end.getDay()) % 7));
  return end.toISOString();
}

/**
 * Set your mood (ADR 0087): an emoji and a few words teammates see on your avatar, in chat and on your profile card,
 * that clears itself when you choose.
 */
export function MoodPicker({ open, onOpenChange, current }: { open: boolean; onOpenChange: (open: boolean) => void; current: PersonMood | null }) {
  const t = useT();
  const save = useSetMood();
  const [emoji, setEmoji] = React.useState(current?.emoji ?? '');
  const [text, setText] = React.useState(current?.text ?? '');
  const [clearAfter, setClearAfter] = React.useState<ClearAfter>('today');
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setEmoji(current?.emoji ?? '');
      setText(current?.text ? t.maybe(current.text) : '');
      setClearAfter(current ? 'never' : 'today');
      setError(null);
    }
    // Only when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const submit = (mood: { emoji: string; text: string | null } | null) => {
    setError(null);
    save.mutate(mood ? { emoji: mood.emoji, text: mood.text, expiresAt: expiryFor(clearAfter) } : null, {
      onSuccess: () => onOpenChange(false),
      onError: (e) => setError(e instanceof ApiError ? e.message : t('Your mood could not be saved. Try again.')),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-[5%] max-h-[90vh] w-[min(100vw-2rem,32rem)] overflow-y-auto p-5">
        <DialogTitle className="text-lg font-semibold">{t('How are you feeling?')}</DialogTitle>
        <DialogDescription className="mb-4 text-sm text-muted-foreground">{t('Your mood shows on your photo, in team chat and on your profile card.')}</DialogDescription>

        <div className="mb-4 flex items-center gap-3 rounded-2xl bg-gradient-to-r from-primary/10 via-accent/10 to-transparent p-3">
          <span data-mood-preview className="grid size-12 shrink-0 place-items-center rounded-full bg-surface text-2xl shadow ring-1 ring-border">{emoji || '🙂'}</span>
          <Input value={text} maxLength={60} onChange={(e) => setText(e.target.value)} placeholder={t('What’s on your mind?')} aria-label={t('Mood text')} className="flex-1" />
        </div>

        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('Quick picks')}</p>
        <div className="mb-4 grid grid-cols-2 gap-2">
          {MOOD_PRESETS.map((m) => (
            <button
              key={m.emoji}
              type="button"
              onClick={() => {
                setEmoji(m.emoji);
                setText(t.maybe(m.text));
              }}
              className={cn('flex items-center gap-2 rounded-xl border px-3 py-2 text-start text-sm transition-all hover:-translate-y-0.5 hover:shadow-md', emoji === m.emoji ? 'border-primary bg-primary/10' : 'border-border bg-surface')}
            >
              <span className="text-xl leading-none">{m.emoji}</span>
              <span className="truncate">{t.maybe(m.text)}</span>
            </button>
          ))}
        </div>

        {EMOJI_GROUPS.map((g) => (
          <div key={g.label} className="mb-3">
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t.maybe(g.label)}</p>
            <div className="flex flex-wrap gap-1" role="group" aria-label={t.maybe(g.label)}>
              {g.emoji.map((e) => (
                <button
                  key={e}
                  type="button"
                  aria-label={e}
                  aria-pressed={emoji === e}
                  onClick={() => setEmoji(e)}
                  className={cn('grid size-9 place-items-center rounded-lg text-xl transition-transform hover:scale-125', emoji === e && 'bg-primary/15 ring-2 ring-primary')}
                >
                  {e}
                </button>
              ))}
            </div>
          </div>
        ))}

        <label className="mb-1 mt-2 block text-xs font-semibold uppercase tracking-wide text-muted-foreground" htmlFor="mood-clear">
          {t('Clear after')}
        </label>
        <select id="mood-clear" value={clearAfter} onChange={(e) => setClearAfter(e.target.value as ClearAfter)} className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm">
          {CLEAR_AFTER.map((c) => (
            <option key={c.key} value={c.key}>
              {t.maybe(c.label)}
            </option>
          ))}
        </select>

        {error && (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="mt-5 flex flex-wrap justify-between gap-2">
          {current ? (
            <Button type="button" variant="ghost" disabled={save.isPending} onClick={() => submit(null)}>
              {t('Clear mood')}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('Cancel')}
            </Button>
            <Button type="button" disabled={!isSingleEmoji(emoji) || save.isPending} onClick={() => submit({ emoji, text: text.trim() || null })}>
              {t('Set mood')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
