'use client';

import * as React from 'react';

/**
 * Sounds for the dialer (ADR 0101): the keypad's touch tones (the real DTMF pair of frequencies for each key), a soft
 * ring while a call connects, and short tones when it connects or ends. Made with Web Audio, so there are no audio files
 * to load. Off with one switch, remembered on this device.
 */

const DTMF: Record<string, [number, number]> = {
  '1': [697, 1209], '2': [697, 1336], '3': [697, 1477],
  '4': [770, 1209], '5': [770, 1336], '6': [770, 1477],
  '7': [852, 1209], '8': [852, 1336], '9': [852, 1477],
  '*': [941, 1209], '0': [941, 1336], '#': [941, 1477],
  '+': [941, 1336],
};

const STORE = 'sampforce.calls.sounds';
let ctx: AudioContext | null = null;
const listeners = new Set<() => void>();

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    ctx ??= new Ctor();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

export function soundsOn(): boolean {
  try {
    return window.localStorage.getItem(STORE) !== 'off';
  } catch {
    return true;
  }
}

export function setSoundsOn(on: boolean): void {
  try {
    window.localStorage.setItem(STORE, on ? 'on' : 'off');
  } catch {
    // Private windows may refuse storage: the switch still works for this visit.
  }
  memory = on;
  listeners.forEach((l) => l());
}
let memory: boolean | null = null;
const current = () => memory ?? soundsOn();

/** The sounds switch, shared by every part of the page. */
export function useCallSounds(): [boolean, (on: boolean) => void] {
  const on = React.useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    current,
    () => true,
  );
  return [on, setSoundsOn];
}

function tone(freqs: number[], ms: number, volume = 0.08, delay = 0): void {
  const a = audio();
  if (!a) return;
  const start = a.currentTime + delay / 1000;
  const gain = a.createGain();
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(volume, start + 0.01);
  gain.gain.setValueAtTime(volume, start + ms / 1000 - 0.02);
  gain.gain.linearRampToValueAtTime(0, start + ms / 1000);
  gain.connect(a.destination);
  for (const f of freqs) {
    const o = a.createOscillator();
    o.type = 'sine';
    o.frequency.value = f;
    o.connect(gain);
    o.start(start);
    o.stop(start + ms / 1000 + 0.02);
  }
}

/** The key's touch tone, about as long as a phone's. */
export function playKey(key: string): void {
  if (!current()) return;
  const f = DTMF[key];
  if (f) tone(f, 120);
}

export function playConnected(): void {
  if (!current()) return;
  tone([660], 110, 0.06);
  tone([880], 140, 0.06, 130);
}

export function playEnded(): void {
  if (!current()) return;
  tone([480, 620], 180, 0.06);
  tone([480, 620], 180, 0.06, 260);
}

/** The ring-back tone heard while a call connects: 400 + 450 Hz, on 0.4 s, off 0.2 s, twice, every 3 s. Returns a stop. */
export function startRingback(): () => void {
  if (!current()) return () => {};
  const ring = () => {
    tone([400, 450], 400, 0.04);
    tone([400, 450], 400, 0.04, 600);
  };
  ring();
  const id = window.setInterval(ring, 3000);
  return () => window.clearInterval(id);
}

/** An incoming call's ring: two quick rising tones. */
export function playIncoming(): void {
  if (!current()) return;
  tone([880, 1320], 250, 0.05);
  tone([988, 1480], 250, 0.05, 320);
}
