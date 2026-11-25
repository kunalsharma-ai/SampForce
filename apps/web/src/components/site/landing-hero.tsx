'use client';

import { ArrowRight, KeyRound, PlayCircle } from 'lucide-react';
import { motion, useMotionValue, useSpring } from 'motion/react';
import Link from 'next/link';
import type { CSSProperties } from 'react';
import { useT } from '@/lib/i18n';
import { HeroOrbit } from './hero-orbit';
import { useSite } from './site-context';
import { BoltWatermark } from './site-motion';

/**
 * A line that rises into place letter by letter (word by word in Arabic, whose letters join). Screen readers get the
 * plain sentence once.
 */
function RisingText({ text, className, delay = 0, language }: { text: string; className?: string; delay?: number; language: string }) {
  const parts = language === 'ar' ? text.split(/(\s+)/) : Array.from(text);
  return (
    <span className={className}>
      <span className="sr-only">{text}</span>
      <span aria-hidden>
        {parts.map((p, i) =>
          /^\s+$/.test(p) ? (
            <span key={i}> </span>
          ) : (
            <span key={i} className="sfx-letter" style={{ '--i': i, '--d': `${delay}ms` } as CSSProperties}>
              {p}
            </span>
          ),
        )}
      </span>
    </span>
  );
}

/** The main button leans towards the pointer a little, as if drawn to it. */
function MagneticCta({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const sx = useSpring(x, { stiffness: 200, damping: 14 });
  const sy = useSpring(y, { stiffness: 200, damping: 14 });
  return (
    <motion.a
      href="/signup"
      style={{ x: sx, y: sy }}
      onPointerMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        x.set((e.clientX - r.left - r.width / 2) * 0.25);
        y.set((e.clientY - r.top - r.height / 2) * 0.35);
      }}
      onPointerLeave={() => {
        x.set(0);
        y.set(0);
      }}
      onClick={(e) => {
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        onClick();
      }}
      className="sfx-cta inline-flex h-14 items-center gap-2 px-7 text-base font-bold"
      data-hero-start=""
    >
      {children}
    </motion.a>
  );
}

export function LandingHero() {
  const t = useT();
  const { openPortal } = useSite();
  const words = [t('Sell.'), t('Close.'), t('Grow.')];
  return (
    <section className="relative mx-auto grid max-w-6xl items-center gap-10 px-4 pb-16 pt-14 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:pt-20" data-site-hero="">
      <BoltWatermark className="-start-24 top-0 -z-10 h-[34rem] sm:-start-10" />
      <div>
        <motion.p
          initial={{ y: 12, scale: 0.9 }}
          animate={{ y: 0, scale: 1 }}
          transition={{ type: 'spring', stiffness: 160, damping: 14 }}
          className="sfx-ring-border inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-bold uppercase tracking-[0.16em] text-foreground"
        >
          <span className="relative flex size-2">
            <span className="absolute inset-0 animate-ping rounded-full bg-accent" />
            <span className="relative size-2 rounded-full bg-accent" />
          </span>
          {t('SampForce by Sampledge')}
        </motion.p>
        <h1 className="mt-6 text-[2.6rem] font-black leading-[1.02] tracking-tight sm:text-6xl lg:text-[4.4rem]">
          <RisingText text={t('Close smarter.')} language={t.language} className="block" />
          {/* A gradient clipped to text cannot span letters that move on their own, so this line sweeps in whole. */}
          <span className="sfx-line-reveal block pb-2">
            <span className="sfx-gradient-text">{t('Grow faster.')}</span>
          </span>
        </h1>
        <p className="mt-4 flex items-baseline gap-3 text-2xl font-bold sm:text-3xl" data-hero-ticker="">
          <span className="sr-only">{t('Sell. Close. Grow.')}</span>
          <span aria-hidden className="text-muted-foreground">
            ✦
          </span>
          <span aria-hidden className="sfx-ticker text-foreground">
            {words.map((w, i) => (
              <span key={w} style={{ '--i': i } as CSSProperties}>
                {w}
              </span>
            ))}
          </span>
        </p>
        <motion.p initial={{ y: 16 }} animate={{ y: 0 }} transition={{ delay: 0.5 }} className="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground">
          {t('One workspace for leads, deals, automation, quotes and revenue analytics. The AI shows its reasoning, stays inside each person’s permissions, and asks before it acts.')}
        </motion.p>
        <div className="mt-9 flex flex-wrap items-center gap-3">
          <MagneticCta onClick={() => openPortal('start')}>
            {t('Start free')} <ArrowRight className="size-5 rtl:rotate-180" aria-hidden />
          </MagneticCta>
          <a
            href="/login"
            onClick={(e) => {
              if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
              e.preventDefault();
              openPortal('sign-in');
            }}
            className="sfx-ring-border inline-flex h-14 items-center gap-2 rounded-full px-6 text-base font-semibold"
            data-hero-sign-in=""
          >
            <KeyRound className="size-5 text-primary" aria-hidden /> {t('Sign in')}
          </a>
          <Link href="/#flow" className="inline-flex h-14 items-center gap-2 px-2 text-sm font-semibold text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
            <PlayCircle className="size-5" aria-hidden /> {t('See it move')}
          </Link>
        </div>
        <p className="mt-4 text-sm text-muted-foreground">{t('The Free plan covers 2 users with no card required.')}</p>
      </div>
      <HeroOrbit />
    </section>
  );
}
