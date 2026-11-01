'use client';

import { animate, useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { usePreferences } from '@/stores/preferences';

/** Counts up to `value`. Renders the final value immediately when motion is reduced or off. */
export function AnimatedNumber({ value, format }: { value: number; format: (n: number) => string }) {
  const systemReduced = useReducedMotion();
  const pref = usePreferences((s) => s.appearance.motion);
  const still = pref === 'off' || pref === 'minimal' || (pref === 'balanced' && !!systemReduced);
  const [display, setDisplay] = useState(still ? value : 0);
  const from = useRef(0);

  useEffect(() => {
    if (still) {
      setDisplay(value);
      return;
    }
    const controls = animate(from.current, value, {
      duration: 0.9,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: setDisplay,
    });
    from.current = value;
    return () => controls.stop();
  }, [value, still]);

  return (
    <>
      <span aria-hidden>{format(display)}</span>
      <span className="sr-only">{format(value)}</span>
    </>
  );
}
