'use client';

/**
 * The notification chime (ADR 0075): a short, soft two-note bell made with Web Audio, so there is no sound file to
 * load. `soft` for everyday notifications, `bright` (a third note, a little higher) for urgent and action-required
 * ones. Browsers only allow sound after the person has interacted with the page; until then one chime waits and plays
 * at the next click or key press, within a minute, or is dropped.
 */

export type ChimeKind = 'soft' | 'bright';

const NOTES: Record<ChimeKind, number[]> = {
  // E6 then B5: a gentle falling fourth.
  soft: [1318.5, 987.8],
  // G5, C6, E6: a short rising major chord.
  bright: [784, 1046.5, 1318.5],
};

let ctx: AudioContext | null = null;
let pending: { kind: ChimeKind; volume: number; at: number } | null = null;
let unlockBound = false;

function context(): AudioContext | null {
  if (typeof window === 'undefined' || typeof window.AudioContext === 'undefined') return null;
  try {
    ctx ??= new window.AudioContext();
    return ctx;
  } catch {
    return null;
  }
}

function bindUnlock() {
  if (unlockBound || typeof window === 'undefined') return;
  unlockBound = true;
  const unlock = () => {
    const c = context();
    if (!c) return;
    void c.resume().then(() => {
      if (pending && Date.now() - pending.at < 60_000) ring(c, pending.kind, pending.volume);
      pending = null;
    });
  };
  window.addEventListener('pointerdown', unlock, { capture: true });
  window.addEventListener('keydown', unlock, { capture: true });
}

function ring(c: AudioContext, kind: ChimeKind, volume: number) {
  // The default volume 40 peaks near -20 dB; 100 near -12 dB. Never loud.
  const peak = 0.25 * Math.max(0, Math.min(100, volume)) / 100;
  let at = c.currentTime + 0.01;
  for (const freq of NOTES[kind]) {
    // A sine with a quiet octave above it and a bell-like decay.
    for (const [mult, share] of [[1, 1], [2, 0.18]] as const) {
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq * mult;
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(peak * share, at + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.55);
      osc.connect(gain).connect(c.destination);
      osc.start(at);
      osc.stop(at + 0.6);
    }
    at += 0.11;
  }
}

/** Plays the chime now if the browser allows it, otherwise at the person's next interaction (within a minute). */
export function playChime(kind: ChimeKind, volume: number): 'played' | 'waiting' | 'unavailable' {
  const c = context();
  if (!c || volume <= 0) return 'unavailable';
  bindUnlock();
  if (c.state === 'running') {
    ring(c, kind, volume);
    return 'played';
  }
  pending = { kind, volume, at: Date.now() };
  void c.resume().then(() => {
    if (c.state === 'running' && pending) {
      ring(c, pending.kind, pending.volume);
      pending = null;
    }
  }).catch(() => undefined);
  return 'waiting';
}
