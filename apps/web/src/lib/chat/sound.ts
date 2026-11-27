'use client';

import { create } from 'zustand';

/*
 * The new-message sound (redesign R9): a short two-note chime made with the Web Audio API, so there is no sound file
 * to load. On by default; the choice is kept on this device. Browsers play sound only after the person has clicked
 * or typed on the page once, which every signed-in session has.
 */

const KEY = 'sf.chatSound';

function readOn(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
}

interface SoundState {
  on: boolean;
  set: (on: boolean) => void;
}

export const useChatSound = create<SoundState>((set) => ({
  on: typeof window === 'undefined' ? true : readOn(),
  set: (on) => {
    try {
      localStorage.setItem(KEY, on ? 'on' : 'off');
    } catch {
      // Storage may be refused; the choice then lasts until the page reloads.
    }
    set({ on });
  },
}));

let ctx: AudioContext | null = null;
let lastPlayed = 0;
/** How many chimes played on this page; tests read it, since a headless browser has no speakers. */
export function chimesPlayed(): number {
  return (globalThis as { __sfChimes?: number }).__sfChimes ?? 0;
}

/** Plays the chime once, at most every 1.5 seconds so a burst of messages does not ring repeatedly. */
export function playMessageSound(): void {
  if (!useChatSound.getState().on) return;
  const now = Date.now();
  if (now - lastPlayed < 1500) return;
  lastPlayed = now;
  const g = globalThis as { __sfChimes?: number };
  g.__sfChimes = (g.__sfChimes ?? 0) + 1;
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx ??= new AC();
    if (ctx.state === 'suspended') void ctx.resume();
    const start = ctx.currentTime;
    for (const [i, freq] of [880, 1320].entries()) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const at = start + i * 0.12;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.18, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.25);
      osc.connect(gain).connect(ctx.destination);
      osc.start(at);
      osc.stop(at + 0.3);
    }
  } catch {
    // No audio device or blocked by the browser: the pop-up still shows.
  }
}
