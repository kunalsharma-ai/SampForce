import type { AchievementLevel } from '@dealflow/types';

/*
 * A short, soft chime made in the browser (no audio files), played only when the person switched celebration sounds
 * on (off by default). Bigger achievements get a longer rising phrase.
 */

const NOTES: Record<AchievementLevel, number[]> = {
  ROUTINE: [880],
  DAILY: [659.25, 987.77],
  MAJOR: [523.25, 659.25, 783.99],
  EXCEPTIONAL: [523.25, 659.25, 783.99, 1046.5],
};

let ctx: AudioContext | null = null;

export function playChime(level: AchievementLevel): void {
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    ctx ??= new Ctor();
    if (ctx.state === 'suspended') void ctx.resume();
    const start = ctx.currentTime + 0.02;
    NOTES[level].forEach((freq, i) => {
      const osc = ctx!.createOscillator();
      const gain = ctx!.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const t0 = start + i * 0.12;
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(0.07, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.6);
      osc.connect(gain).connect(ctx!.destination);
      osc.start(t0);
      osc.stop(t0 + 0.65);
    });
  } catch {
    // Sound is a nicety; a browser that refuses it changes nothing else.
  }
}
