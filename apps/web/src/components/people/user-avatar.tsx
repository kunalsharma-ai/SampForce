'use client';

import type { ProfileCover } from '@dealflow/types';
import { cn } from '@dealflow/ui';
import * as React from 'react';
import { initialsOf, usePeopleCards } from '@/lib/people';

/** The profile covers (ADR 0087): bright gradients that work behind white text in light and dark themes. */
export const COVERS: Record<ProfileCover, { label: string; css: string }> = {
  aurora: { label: 'Aurora', css: 'linear-gradient(135deg, #22d3ee 0%, #6366f1 50%, #a855f7 100%)' },
  sunset: { label: 'Sunset', css: 'linear-gradient(135deg, #f97316 0%, #ec4899 55%, #8b5cf6 100%)' },
  ocean: { label: 'Ocean', css: 'linear-gradient(135deg, #0ea5e9 0%, #2563eb 55%, #1e3a8a 100%)' },
  forest: { label: 'Forest', css: 'linear-gradient(135deg, #84cc16 0%, #10b981 50%, #0f766e 100%)' },
  ember: { label: 'Ember', css: 'linear-gradient(135deg, #facc15 0%, #f97316 45%, #dc2626 100%)' },
  galaxy: { label: 'Galaxy', css: 'radial-gradient(circle at 20% 30%, #f0abfc 0, transparent 30%), radial-gradient(circle at 80% 70%, #67e8f9 0, transparent 30%), linear-gradient(135deg, #1e1b4b 0%, #4c1d95 60%, #0f172a 100%)' },
  candy: { label: 'Candy', css: 'linear-gradient(135deg, #f9a8d4 0%, #c4b5fd 50%, #93c5fd 100%)' },
  midnight: { label: 'Midnight', css: 'linear-gradient(135deg, #0f172a 0%, #334155 60%, #0ea5e9 130%)' },
};

/** A steady colour per person, so initials are easy to tell apart. */
const TONES = ['from-cyan-500 to-indigo-500', 'from-orange-400 to-pink-500', 'from-emerald-400 to-teal-600', 'from-violet-500 to-fuchsia-500', 'from-amber-400 to-red-500', 'from-sky-400 to-blue-600'];
function toneOf(seed: string): string {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TONES[h % TONES.length]!;
}

export interface UserAvatarProps {
  /** The person's user id: their photo and mood come from the workspace's people cards. */
  userId?: string | null;
  name: string | null | undefined;
  /** A photo address the caller already has (it wins over the cards). */
  photoUrl?: string | null;
  /** Shows the person's mood emoji on the avatar's corner. */
  showMood?: boolean;
  /** Green or grey dot for online / offline; left out shows none. */
  online?: boolean;
  /** Size and text size, such as "size-8 text-[10px]". */
  className?: string;
  /** Override for the initials' background. */
  tone?: string;
}

/**
 * A person's avatar (ADR 0072, 0087): their profile photo, or their initials on a colour of their own, with their mood
 * emoji and an online dot when asked. A photo that fails to load falls back to the initials.
 */
export function UserAvatar({ userId, name, photoUrl, showMood = true, online, className, tone }: UserAvatarProps) {
  const cards = usePeopleCards();
  const card = userId ? cards.data?.get(userId) : undefined;
  const src = photoUrl ?? card?.photoUrl ?? null;
  const [broken, setBroken] = React.useState<string | null>(null);
  const mood = showMood ? card?.mood : null;
  const showImg = src && broken !== src;
  return (
    <span
      aria-hidden
      data-avatar={userId ?? undefined}
      className={cn('relative inline-grid size-10 shrink-0 place-items-center rounded-full text-xs font-semibold text-white shadow-sm ring-2 ring-surface', !showImg && cn('bg-gradient-to-br', tone ?? toneOf(userId ?? name ?? '')), className)}
    >
      {showImg ? (
        // eslint-disable-next-line @next/next/no-img-element -- a private, signed-in image that Next cannot optimise
        <img src={src} alt="" className="size-full rounded-full object-cover" onError={() => setBroken(src)} />
      ) : (
        initialsOf(name)
      )}
      {mood && (
        <span data-mood className="absolute -bottom-1 -end-1 grid size-[55%] max-h-5 max-w-5 min-h-3.5 min-w-3.5 place-items-center rounded-full bg-surface text-[0.7em] leading-none shadow ring-1 ring-border" title={mood.text ?? undefined}>
          {mood.emoji}
        </span>
      )}
      {online !== undefined && !mood && <span className={cn('absolute -bottom-0.5 -end-0.5 size-3 rounded-full ring-2 ring-surface transition-colors', online ? 'bg-success' : 'bg-muted-foreground/50')} />}
      {online !== undefined && mood && <span className={cn('absolute -top-0.5 -end-0.5 size-2.5 rounded-full ring-2 ring-surface', online ? 'bg-success' : 'bg-muted-foreground/50')} />}
    </span>
  );
}
