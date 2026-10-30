'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { usePreferences } from '@/stores/preferences';

export type MotionLevel = 'full' | 'reduced' | 'off';

function subscribeReduced(cb: () => void) {
  const m = window.matchMedia('(prefers-reduced-motion: reduce)');
  m.addEventListener('change', cb);
  return () => m.removeEventListener('change', cb);
}

/** The motion the user wants: their DealFlow setting, or the operating system's when set to "system". */
export function useMotionLevel(): MotionLevel {
  const pref = usePreferences((s) => s.motion);
  const systemReduced = useSyncExternalStore(subscribeReduced, () => window.matchMedia('(prefers-reduced-motion: reduce)').matches, () => false);
  if (pref === 'off') return 'off';
  if (pref === 'reduced') return 'reduced';
  if (pref === 'full') return 'full';
  return systemReduced ? 'reduced' : 'full';
}

let webglCache: boolean | undefined;
/** True when the browser can create a WebGL2 or WebGL context (checked once per page load). */
export function detectWebGL(): boolean {
  if (webglCache !== undefined) return webglCache;
  try {
    const c = document.createElement('canvas');
    webglCache = !!(c.getContext('webgl2') ?? c.getContext('webgl'));
  } catch {
    webglCache = false;
  }
  return webglCache;
}

export type SceneSupport = { mode: '3d' | '2d'; reason: string | null; ready: boolean };

/**
 * Whether a 3D scene should render. Low-power mode, a browser without WebGL, or a lost GPU context all mean the 2D
 * view; the person can also pick 2D themselves. Reduced motion keeps 3D but stops automatic movement.
 */
export function useSceneSupport(): SceneSupport {
  const lowPower = usePreferences((s) => s.lowPower);
  const [webgl, setWebgl] = useState<boolean | null>(null);
  useEffect(() => setWebgl(detectWebGL()), []);
  if (webgl === null) return { mode: '2d', reason: null, ready: false };
  if (lowPower) return { mode: '2d', reason: 'Low-power mode is on, so this view is shown in 2D. Turn it off in Settings to see it in 3D.', ready: true };
  if (!webgl) return { mode: '2d', reason: 'This browser cannot draw 3D graphics (WebGL is unavailable), so this view is shown in 2D.', ready: true };
  return { mode: '3d', reason: null, ready: true };
}
