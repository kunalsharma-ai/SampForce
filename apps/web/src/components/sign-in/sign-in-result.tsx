'use client';

import { useCallback, useState } from 'react';
import { useT } from '@/lib/i18n';

/**
 * The sign-in box's answer (ADR 0075): a green tick drawing itself when the password is right, a red cross and a
 * shake when it is wrong. The words are still said by the form (its alert, or this status); the drawing is decoration.
 */
export type SignInResultState = 'idle' | 'success' | 'error';

function reducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function useSignInResult() {
  const [state, setState] = useState<SignInResultState>('idle');
  const [round, setRound] = useState(0);
  /** Shows the tick, then resolves once it has been seen (at once under reduced motion). */
  const success = useCallback(async () => {
    setState('success');
    setRound((n) => n + 1);
    await new Promise((r) => setTimeout(r, reducedMotion() ? 0 : 950));
  }, []);
  const error = useCallback(() => {
    setState('error');
    setRound((n) => n + 1);
  }, []);
  const reset = useCallback(() => setState((s) => (s === 'error' ? 'idle' : s)), []);
  /** Attributes for the box that shakes and colours its fields. */
  const attrs = { 'data-sign-in-result': state, 'data-sign-in-round': round % 2 ? 'odd' : 'even' };
  return { state, round, success, error, reset, attrs };
}

/** The tick, over the sign-in box, or the cross, just above the message saying what went wrong. */
export function SignInResult({ state, round, translate = true, opening }: { state: SignInResultState; round: number; translate?: boolean; opening?: string }) {
  const t = useT();
  if (state === 'success')
    return (
      <div key={`ok-${round}`} className="sfs-result sfs-result-ok absolute inset-0 z-20 grid place-items-center rounded-[inherit]" data-sign-in-tick="">
        <div className="flex flex-col items-center text-center">
          <svg viewBox="0 0 120 120" className="size-28" aria-hidden>
            <circle cx="60" cy="60" r="44" fill="none" stroke="#16a34a" strokeOpacity=".25" strokeWidth="10" className="sfs-result-burst" />
            <circle cx="60" cy="60" r="44" fill="#16a34a" className="sfs-result-disc" />
            <path d="M40 62 l14 14 l28 -30" fill="none" stroke="#fff" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" className="sfs-result-mark" />
          </svg>
          <p role="status" className="mt-3 text-xl font-extrabold text-foreground">
            {translate ? t('Signed in') : 'Signed in'}
          </p>
          <p className="text-sm text-muted-foreground">{opening ?? (translate ? t('Opening your workspace…') : 'Opening your workspace…')}</p>
        </div>
      </div>
    );
  if (state === 'error')
    return (
      <div key={`no-${round}`} className="sfs-result-no flex justify-center" aria-hidden data-sign-in-cross="">
        <svg viewBox="0 0 120 120" className="size-14 drop-shadow-[0_10px_20px_rgba(220,38,38,0.45)]">
          <circle cx="60" cy="60" r="46" fill="#dc2626" className="sfs-result-disc" />
          <path d="M44 44 L76 76 M76 44 L44 76" fill="none" stroke="#fff" strokeWidth="10" strokeLinecap="round" className="sfs-result-mark" />
        </svg>
      </div>
    );
  return null;
}
