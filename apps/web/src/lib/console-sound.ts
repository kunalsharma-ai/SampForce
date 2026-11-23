'use client';

/**
 * Optional Console feedback sounds (ADR 0074): off unless the operator turns them on. Short, quiet tones made with Web
 * Audio, so there are no sound files to load, and nothing in the Console depends on hearing them.
 */

export type ConsoleSound = 'success' | 'alert' | 'error';

const TONES: Record<ConsoleSound, { freq: number[]; ms: number }> = {
  success: { freq: [880], ms: 90 },
  alert: { freq: [660, 990], ms: 110 },
  error: { freq: [220], ms: 160 },
};

let ctx: AudioContext | null = null;

export function playConsoleSound(kind: ConsoleSound): void {
  if (typeof window === 'undefined' || typeof window.AudioContext === 'undefined') return;
  try {
    ctx ??= new window.AudioContext();
    const { freq, ms } = TONES[kind];
    let at = ctx.currentTime;
    for (const f of freq) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = f;
      // About -18 dB, with a soft attack and release so it never clicks.
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(0.12, at + 0.01);
      gain.gain.linearRampToValueAtTime(0, at + ms / 1000);
      osc.connect(gain).connect(ctx.destination);
      osc.start(at);
      osc.stop(at + ms / 1000 + 0.02);
      at += ms / 1000;
    }
  } catch {
    // No audio device or the browser refused: sounds are optional.
  }
}
