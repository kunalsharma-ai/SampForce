'use client';

import { cn } from '@dealflow/ui';
import { useState } from 'react';
import { type SceneSupport, useSceneSupport } from '@/lib/motion';
import { useT } from '@/lib/i18n';

export type ViewMode = '3d' | '2d';

/**
 * Chooses between the 3D scene and its 2D equivalent. 2D is forced when the device cannot (or should not) draw 3D;
 * otherwise the person picks, and a lost GPU context drops back to 2D.
 */
export function useViewMode(): { support: SceneSupport; mode: ViewMode; setMode: (m: ViewMode) => void; contextLost: () => void; lost: boolean } {
  const support = useSceneSupport();
  const [choice, setChoice] = useState<ViewMode>('3d');
  const [lost, setLost] = useState(false);
  const mode: ViewMode = support.mode === '2d' || lost ? '2d' : choice;
  return { support, mode, setMode: setChoice, contextLost: () => setLost(true), lost };
}

export function ViewModeSwitch({ view, label }: { view: ReturnType<typeof useViewMode>; label: string }) {
  const t = useT();
  const { support, mode, setMode, lost } = view;
  const reason = lost ? t('The graphics context was lost (often after a GPU reset or low memory), so this view switched to 2D.') : support.reason && t.maybe(support.reason);
  return (
    <div className="flex flex-wrap items-center gap-3">
      {support.mode === '3d' && !lost && (
        <div role="radiogroup" aria-label={t('{name} view', { name: label })} className="inline-flex rounded-lg border border-border bg-muted/40 p-1">
          {(['3d', '2d'] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              onClick={() => setMode(m)}
              className={cn('rounded-md px-3 py-1 text-sm font-medium', mode === m ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}
            >
              {m === '3d' ? '3D' : '2D'}
            </button>
          ))}
        </div>
      )}
      {reason && <p className="text-xs text-muted-foreground">{reason}</p>}
    </div>
  );
}

/** Optional frame-rate readout, so the 60 FPS budget can be checked on a real device. */
export function FpsReadout({ fps }: { fps: { fps: number; dpr: number } | null }) {
  const t = useT();
  if (!fps) return null;
  return (
    <p className="pointer-events-none absolute bottom-2 start-2 rounded bg-background/80 px-2 py-0.5 font-mono text-[11px] text-muted-foreground" aria-hidden>
      {t('{fps} fps · {dpr}× pixels', { fps: fps.fps, dpr: fps.dpr })}
    </p>
  );
}
