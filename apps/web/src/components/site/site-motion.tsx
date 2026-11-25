'use client';

import { motion, useReducedMotion, useScroll, useSpring } from 'motion/react';
import { useEffect, useState } from 'react';
import { Tr } from '@/lib/i18n';

/** The SampForce bolt as a plain path, for the strike, the watermarks and the section underlines. */
export const BOLT_PATH = 'M58 4 L20 66 H46 L36 116 L80 46 H54 Z';

const STRIKE_KEY = 'sampforce:site-strike';

/**
 * A lightning strike when the site first opens in a tab: the bolt flashes down the screen and the sky lights up for a
 * moment. Once per browser tab, never with reduced motion, and it never blocks a click.
 */
export function StrikeIntro() {
  const reduce = useReducedMotion();
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (reduce || document.documentElement.dataset.motion === 'off' || document.documentElement.dataset.motion === 'minimal') return;
    try {
      if (sessionStorage.getItem(STRIKE_KEY)) return;
      sessionStorage.setItem(STRIKE_KEY, '1');
    } catch {
      // Storage blocked: strike anyway, it is brief.
    }
    setShow(true);
    const done = window.setTimeout(() => setShow(false), 1400);
    return () => window.clearTimeout(done);
  }, [reduce]);
  if (!show) return null;
  return (
    <div aria-hidden className="sfx-strike pointer-events-none fixed inset-0 z-[60]" data-site-strike="">
      <div className="sfx-strike-flash absolute inset-0" />
      <svg viewBox="0 0 100 120" className="sfx-strike-bolt absolute left-1/2 top-0 h-[70vh] -translate-x-1/2">
        <path d={BOLT_PATH} />
      </svg>
    </div>
  );
}

/** A thin red-to-amber bar along the top that fills as the visitor scrolls. */
export function ScrollProgress() {
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, { stiffness: 140, damping: 26, restDelta: 0.001 });
  return <motion.div aria-hidden className="sfx-progress fixed inset-x-0 top-0 z-40 h-[3px] origin-left rtl:origin-right" style={{ scaleX }} data-site-progress="" />;
}

/** A large, faint bolt behind a section, drifting slowly. */
export function BoltWatermark({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 100 120" className={`sfx-watermark pointer-events-none absolute ${className ?? ''}`}>
      <path d={BOLT_PATH} />
    </svg>
  );
}

/** A section's heading: the kicker sparks in, the title rises, and a bolt-tipped line sweeps under it. */
export function SectionHead({ id, kicker, title, body }: { id: string; kicker: string; title: string; body: string }) {
  const view = { once: true, margin: '-80px' } as const;
  return (
    <div className="mx-auto mb-10 max-w-2xl text-center" data-section-head="">
      <motion.p
        initial={{ y: 10, scale: 0.9 }}
        whileInView={{ y: 0, scale: 1 }}
        viewport={view}
        transition={{ type: 'spring', stiffness: 200, damping: 14 }}
        className="sfx-kicker inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.22em] text-primary"
      >
        <svg aria-hidden viewBox="0 0 100 120" className="sfx-kicker-bolt size-3.5">
          <path d={BOLT_PATH} />
        </svg>
        <Tr text={kicker} />
      </motion.p>
      <motion.h2
        id={id}
        initial={{ y: 28 }}
        whileInView={{ y: 0 }}
        viewport={view}
        transition={{ type: 'spring', stiffness: 110, damping: 16, delay: 0.05 }}
        className="mt-3 text-3xl font-black tracking-tight sm:text-4xl"
      >
        <Tr text={title} />
      </motion.h2>
      <motion.span
        aria-hidden
        initial={{ scaleX: 0 }}
        whileInView={{ scaleX: 1 }}
        viewport={view}
        transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1], delay: 0.15 }}
        className="sfx-underline mx-auto mt-4 block h-[3px] w-40 origin-left rounded-full rtl:origin-right"
      />
      <motion.p initial={{ y: 14 }} whileInView={{ y: 0 }} viewport={view} transition={{ delay: 0.2 }} className="mt-4 text-muted-foreground">
        <Tr text={body} />
      </motion.p>
    </div>
  );
}
