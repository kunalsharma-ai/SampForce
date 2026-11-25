'use client';

import { ArrowRight, KeyRound, LifeBuoy } from 'lucide-react';
import { motion } from 'motion/react';
import { useT } from '@/lib/i18n';
import { useSite } from './site-context';
import { BoltWatermark } from './site-motion';

/** The closing call: one more way in, and a way to ask first. */
export function LandingFinale() {
  const t = useT();
  const { openPortal, openHelp } = useSite();
  return (
    <section className="mx-auto max-w-6xl px-4 pb-20 sm:px-6" aria-labelledby="finale">
      <motion.div
        initial={{ y: 40, scale: 0.96 }}
        whileInView={{ y: 0, scale: 1 }}
        viewport={{ once: true, margin: '-60px' }}
        transition={{ type: 'spring', stiffness: 90, damping: 16 }}
        className="sfx-ring-border rounded-[2rem]"
      >
        <div className="sfx-finale relative overflow-hidden rounded-[calc(2rem-1px)] px-6 py-14 text-center sm:px-12 sm:py-20">
          <BoltWatermark className="-end-10 -top-10 h-80" />
          <BoltWatermark className="-bottom-16 -start-8 h-56 [animation-delay:-6s]" />
          <h2 id="finale" className="mx-auto max-w-2xl text-3xl font-black tracking-tight sm:text-5xl">
            <span className="sfx-gradient-text">{t('Your pipeline, but alive.')}</span>
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-lg text-muted-foreground">{t('Create a workspace in under a minute. The Free plan covers 2 users with no card required.')}</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <button type="button" onClick={() => openPortal('start')} className="sfx-cta inline-flex h-14 items-center gap-2 px-7 text-base font-bold" data-finale-start="">
              {t('Start free')} <ArrowRight className="size-5 rtl:rotate-180" aria-hidden />
            </button>
            <button type="button" onClick={() => openPortal('sign-in')} className="inline-flex h-14 items-center gap-2 rounded-full border border-border bg-background/60 px-6 font-semibold transition hover:border-primary">
              <KeyRound className="size-5 text-primary" aria-hidden /> {t('Sign in')}
            </button>
            <button type="button" onClick={openHelp} className="inline-flex h-14 items-center gap-2 rounded-full px-4 font-semibold text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
              <LifeBuoy className="size-5" aria-hidden /> {t('Questions first? Ask us')}
            </button>
          </div>
        </div>
      </motion.div>
    </section>
  );
}
