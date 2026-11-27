'use client';

import { cn } from '@dealflow/ui';
import { Search } from 'lucide-react';
import * as React from 'react';
import { useT } from '@/lib/i18n';

/*
 * The full emoji picker for team chat (redesign R9): every Unicode emoji from Emojibase, in its groups, searchable by
 * name and keyword, with the ones you used last on top. The list (about 0.5 MB) loads only when a picker first opens.
 */

interface EmojiItem {
  unicode: string;
  label: string;
  tags?: string[];
  group?: number;
}

const GROUPS = [
  { id: 0, icon: '😀', label: 'Smileys and emotion' },
  { id: 1, icon: '👋', label: 'People and body' },
  { id: 3, icon: '🐶', label: 'Animals and nature' },
  { id: 4, icon: '🍔', label: 'Food and drink' },
  { id: 5, icon: '✈️', label: 'Travel and places' },
  { id: 6, icon: '⚽', label: 'Activities' },
  { id: 7, icon: '💡', label: 'Objects' },
  { id: 8, icon: '❤️', label: 'Symbols' },
  { id: 9, icon: '🏁', label: 'Flags' },
] as const;

const RECENT_KEY = 'sf.emojiRecent';
const RECENT_MAX = 24;
/** What the picker shows under "Recent" before you have used any. */
export const QUICK_EMOJI = ['👍', '❤️', '😂', '🎉', '🙏', '👀', '✅', '🔥'];

let cache: Promise<EmojiItem[]> | null = null;
function loadEmoji(): Promise<EmojiItem[]> {
  cache ??= import('emojibase-data/en/compact.json').then((m) => ((m.default ?? m) as unknown as EmojiItem[]).filter((e) => e.group !== undefined && e.group !== 2));
  return cache;
}

export function recentEmoji(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

export function rememberEmoji(e: string): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([e, ...recentEmoji().filter((x) => x !== e)].slice(0, RECENT_MAX)));
  } catch {
    // Private windows may refuse storage; the picker still works without "Recent".
  }
}

export function EmojiPicker({ onPick, label, className }: { onPick: (emoji: string) => void; label: string; className?: string }) {
  const t = useT();
  const [all, setAll] = React.useState<EmojiItem[] | null>(null);
  const [failed, setFailed] = React.useState(false);
  const [q, setQ] = React.useState('');
  const [group, setGroup] = React.useState<number>(-1);
  const [recent] = React.useState(() => recentEmoji());
  const search = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    let live = true;
    loadEmoji().then(
      (list) => live && setAll(list),
      () => live && setFailed(true),
    );
    search.current?.focus();
    return () => {
      live = false;
    };
  }, []);

  const needle = q.trim().toLowerCase();
  const shown: string[] = !all
    ? []
    : needle
      ? all.filter((e) => e.label.toLowerCase().includes(needle) || e.tags?.some((tag) => tag.startsWith(needle))).slice(0, 160).map((e) => e.unicode)
      : group === -1
        ? (recent.length ? recent : QUICK_EMOJI)
        : all.filter((e) => e.group === group).map((e) => e.unicode);
  const labelOf = React.useMemo(() => new Map((all ?? []).map((e) => [e.unicode, e.label])), [all]);
  const pick = (e: string) => {
    rememberEmoji(e);
    onPick(e);
  };

  return (
    <div className={cn('flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2 rounded-xl border border-border bg-popover p-2 text-popover-foreground shadow-lg', className)} role="dialog" aria-label={label} data-emoji-picker="">
      <label className="flex items-center gap-2 rounded-lg border border-input bg-background px-2">
        <Search className="size-4 text-muted-foreground" aria-hidden />
        <input ref={search} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Search emoji')} aria-label={t('Search emoji')} className="h-9 flex-1 bg-transparent text-sm outline-none" />
      </label>
      {!needle && (
        <div className="flex gap-0.5 overflow-x-auto" role="tablist" aria-label={t('Emoji groups')}>
          <button type="button" role="tab" aria-selected={group === -1} onClick={() => setGroup(-1)} className={cn('shrink-0 rounded-md px-1.5 py-1 text-xs', group === -1 ? 'bg-primary/15 text-primary' : 'hover:bg-muted')}>
            {t('Recent')}
          </button>
          {GROUPS.map((g) => (
            <button key={g.id} type="button" role="tab" aria-selected={group === g.id} title={t(g.label)} aria-label={t(g.label)} onClick={() => setGroup(g.id)} className={cn('shrink-0 rounded-md px-1.5 py-1 text-lg leading-none', group === g.id ? 'bg-primary/15' : 'hover:bg-muted')}>
              {g.icon}
            </button>
          ))}
        </div>
      )}
      <div className="grid max-h-60 grid-cols-8 gap-0.5 overflow-y-auto pe-1" data-emoji-grid="">
        {failed && <p className="col-span-8 p-2 text-sm text-critical">{t('Could not load the emoji. Check your connection and try again.')}</p>}
        {!all && !failed && <p className="col-span-8 p-2 text-sm text-muted-foreground">{t('Loading…')}</p>}
        {all && shown.length === 0 && <p className="col-span-8 p-2 text-sm text-muted-foreground">{t('No emoji found')}</p>}
        {shown.map((e) => (
          <button key={e} type="button" className="grid aspect-square place-items-center rounded-md text-xl transition-transform hover:scale-110 hover:bg-muted motion-reduce:hover:scale-100" onClick={() => pick(e)} aria-label={labelOf.get(e) ?? e} title={labelOf.get(e)}>
            {e}
          </button>
        ))}
      </div>
    </div>
  );
}
