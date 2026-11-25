'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Button, cn, Dialog, DialogContent, DialogDescription, DialogTitle, Input } from '@dealflow/ui';
import { SITE_SUPPORT_TOPICS, type SiteSupportReceipt, type SiteSupportRequestInput, type SiteSupportTopic, siteSupportRequestSchema } from '@dealflow/types';
import { ArrowUpRight, ChevronDown, LifeBuoy, MessageSquareText, Search, SearchX, Send, Sparkles } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Textarea } from '@/components/crm/select';
import { FloatingField } from '@/components/forms/floating-field';
import { api, ApiError } from '@/lib/api';
import { Tr, useT } from '@/lib/i18n';
import { searchSiteFaqs, type SiteFaq, TOPIC_LABELS } from '@/lib/site-faq';
import { useSite } from './site-context';

/** The floating Help & Support button: a glowing orb that says what it is when you reach it. */
export function HelpOrb() {
  const t = useT();
  const { openHelp } = useSite();
  const [intro, setIntro] = useState(false);
  // Introduces itself once, a moment after the page settles.
  useEffect(() => {
    const show = setTimeout(() => setIntro(true), 1800);
    const hide = setTimeout(() => setIntro(false), 5200);
    return () => {
      clearTimeout(show);
      clearTimeout(hide);
    };
  }, []);
  return (
    <button
      type="button"
      onClick={openHelp}
      className="sfx-help-orb fixed bottom-5 end-5 z-40 flex h-14 items-center rounded-full px-4 text-sm font-semibold"
      data-intro={intro || undefined}
      data-site-help-button=""
    >
      <span className="sfx-help-ping pointer-events-none absolute inset-0 rounded-full" aria-hidden />
      <LifeBuoy className="sfx-help-icon size-6 shrink-0" aria-hidden />
      <span className="sfx-help-label overflow-hidden whitespace-nowrap">{t('Help & Support')}</span>
    </button>
  );
}

/** The Help & Support panel: searchable answers, quick ways out, and a message to SampForce. */
export function HelpPanel({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useT();
  const { mode, openPortal } = useSite();
  const [tab, setTab] = useState<'answers' | 'message'>('answers');
  const [topic, setTopic] = useState<SiteSupportTopic>('OTHER');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent side="right" className="sfx-scope flex flex-col gap-0 overflow-hidden border-border p-0 sm:max-w-[440px]" data-sfx-mode={mode} data-site-help-panel="">
        <div className="sfx-panel-head relative px-6 pb-5 pt-7">
          <motion.span
            initial={{ rotate: -120, scale: 0.4 }}
            animate={{ rotate: 0, scale: 1 }}
            transition={{ type: 'spring', stiffness: 180, damping: 12 }}
            className="sfx-help-orb mb-3 grid size-12 place-items-center rounded-2xl"
            aria-hidden
          >
            <LifeBuoy className="size-6" />
          </motion.span>
          <DialogTitle className="text-2xl font-bold tracking-tight">{t('Help & Support')}</DialogTitle>
          <DialogDescription className="mt-1 text-sm text-muted-foreground">{t('Answers to common questions, or a message straight to the SampForce team.')}</DialogDescription>
          <div role="tablist" aria-label={t('Help & Support')} className="relative mt-5 grid grid-cols-2 rounded-full border border-border bg-background/60 p-1">
            <span
              aria-hidden
              className={cn('sfx-switch-pill absolute inset-y-1 start-1 w-[calc(50%-0.25rem)] rounded-full', tab === 'message' && 'translate-x-full rtl:-translate-x-full')}
            />
            {(['answers', 'message'] as const).map((k) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={tab === k}
                onClick={() => setTab(k)}
                className={cn('relative z-10 flex items-center justify-center gap-1.5 rounded-full py-2 text-sm font-semibold transition-colors', tab === k ? 'text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}
                data-help-tab={k}
              >
                {k === 'answers' ? <Sparkles className="size-4" aria-hidden /> : <MessageSquareText className="size-4" aria-hidden />}
                {k === 'answers' ? t('Answers') : t('Message us')}
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-6 pb-8 pt-4">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={tab} initial={{ x: tab === 'answers' ? -24 : 24 }} animate={{ x: 0 }} exit={{ x: tab === 'answers' ? -24 : 24 }} transition={{ duration: 0.22 }}>
              {tab === 'answers' ? (
                <Answers
                  onAsk={(topicOf) => {
                    setTopic(topicOf);
                    setTab('message');
                  }}
                  onStart={() => {
                    onOpenChange(false);
                    openPortal('start');
                  }}
                />
              ) : (
                <MessageForm topic={topic} />
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Answers({ onAsk, onStart }: { onAsk: (topic: SiteSupportTopic) => void; onStart: () => void }) {
  const t = useT();
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const results = useMemo(() => searchSiteFaqs(q, (s) => t.maybe(s)), [q, t]);

  return (
    <div className="space-y-5">
      <div className="relative">
        <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <label htmlFor="site-help-search" className="sr-only">
          {t('Search help')}
        </label>
        <Input id="site-help-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Search: password, SSO, free plan…')} className="h-11 rounded-full ps-9" />
      </div>
      <div className="flex flex-wrap gap-2" aria-label={t('Quick links')} role="group">
        <QuickLink href="/forgot-password" label={t('Reset my password')} />
        <QuickLink href="/login/sso" label={t('Sign in with SSO')} />
        <QuickLink href="/pricing" label={t('See pricing')} />
        <button type="button" onClick={onStart} className="sfx-ring-border rounded-full px-3 py-1.5 text-xs font-semibold text-foreground">
          {t('Start free')}
        </button>
      </div>
      {results.length ? (
        <ul className="space-y-2" data-site-faqs="">
          {results.map((f, i) => (
            <FaqItem key={f.id} faq={f} i={i} open={openId === f.id} onToggle={() => setOpenId(openId === f.id ? null : f.id)} />
          ))}
        </ul>
      ) : (
        <div className="rounded-2xl border border-dashed border-border p-6 text-center" data-site-faq-empty="">
          <SearchX className="mx-auto size-8 text-muted-foreground" aria-hidden />
          <p className="mt-2 font-medium">{t('No answer matches that yet.')}</p>
          <Button className="mt-3" variant="outline" onClick={() => onAsk('OTHER')}>
            <Send aria-hidden /> {t('Ask us instead')}
          </Button>
        </div>
      )}
      <p className="text-center text-sm text-muted-foreground">
        {t('Still stuck?')}{' '}
        <button type="button" className="font-semibold text-primary underline underline-offset-2" onClick={() => onAsk('OTHER')}>
          {t('Send us a message')}
        </button>
      </p>
    </div>
  );
}

function QuickLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="flex items-center gap-1 rounded-full border border-border bg-background/60 px-3 py-1.5 text-xs font-semibold transition hover:border-primary hover:text-primary">
      {label} <ArrowUpRight className="size-3" aria-hidden />
    </Link>
  );
}

function FaqItem({ faq, i, open, onToggle }: { faq: SiteFaq; i: number; open: boolean; onToggle: () => void }) {
  const t = useT();
  const panel = `faq-${faq.id}`;
  return (
    <motion.li initial={{ y: 10 }} animate={{ y: 0 }} transition={{ delay: i * 0.04 }} className={cn('overflow-hidden rounded-2xl border transition-colors', open ? 'border-primary/50 bg-primary/5' : 'border-border bg-background/40')}>
      <button type="button" aria-expanded={open} aria-controls={panel} onClick={onToggle} className="flex w-full items-center gap-3 px-4 py-3 text-start text-sm font-semibold">
        <span className="flex-1">{t.maybe(faq.question)}</span>
        <ChevronDown className={cn('size-4 shrink-0 transition-transform duration-300', open && 'rotate-180')} aria-hidden />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div id={panel} initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} transition={{ duration: 0.28, ease: [0.2, 0.9, 0.3, 1] }} className="overflow-hidden">
            <div className="px-4 pb-4 text-sm leading-relaxed text-muted-foreground">
              <p>{t.maybe(faq.answer)}</p>
              {faq.action && (
                <Link href={faq.action.href} className="mt-3 inline-flex items-center gap-1 font-semibold text-primary underline underline-offset-2">
                  {t.maybe(faq.action.label)} <ArrowUpRight className="size-3.5" aria-hidden />
                </Link>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.li>
  );
}

function MessageForm({ topic }: { topic: SiteSupportTopic }) {
  const t = useT();
  const [sent, setSent] = useState<SiteSupportReceipt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const form = useForm<SiteSupportRequestInput>({
    resolver: zodResolver(siteSupportRequestSchema),
    mode: 'onTouched',
    defaultValues: { name: '', email: '', topic, message: '', website: '' },
  });
  const errors = form.formState.errors;

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      setSent(await api<SiteSupportReceipt>('/site/support-requests', { method: 'POST', json: { ...values, pagePath: window.location.pathname } }));
    } catch (err) {
      if (err instanceof ApiError && err.details) for (const d of err.details) form.setError(d.path as keyof SiteSupportRequestInput, { message: d.message });
      setError(err instanceof ApiError ? err.message : t('Could not reach SampForce. Check your connection.'));
    }
  });

  if (sent) {
    return (
      <div className="py-6 text-center" role="status" data-site-help-sent={sent.reference}>
        <motion.div initial={{ scale: 0, rotate: -90 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 200, damping: 12 }} className="sfx-help-orb mx-auto grid size-16 place-items-center rounded-full">
          <Send className="size-7" aria-hidden />
        </motion.div>
        <h3 className="mt-4 text-xl font-bold">{t('Message sent')}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{t('We will reply by email. Your reference is {reference}.', { reference: sent.reference })}</p>
        <Button
          variant="outline"
          className="mt-5"
          onClick={() => {
            setSent(null);
            form.reset({ name: form.getValues('name'), email: form.getValues('email'), topic: 'OTHER', message: '', website: '' });
          }}
        >
          {t('Send another message')}
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4" data-site-help-form="">
      <p className="text-sm text-muted-foreground">{t('Tell us what you need. Anyone at SampForce support can read it, and we answer by email.')}</p>
      <FloatingField id="help-name" label={t('Your name')} error={errors.name?.message}>
        <Input autoComplete="name" {...form.register('name')} />
      </FloatingField>
      <FloatingField id="help-email" label={t('Work email')} error={errors.email?.message}>
        <Input type="email" autoComplete="email" {...form.register('email')} />
      </FloatingField>
      <div className="space-y-1.5">
        <label htmlFor="help-topic" className="text-sm font-medium">
          {t('What is it about?')}
        </label>
        <select id="help-topic" className="h-11 w-full rounded-md border border-input bg-surface px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" {...form.register('topic')}>
          {SITE_SUPPORT_TOPICS.map((k) => (
            <option key={k} value={k}>
              {t.maybe(TOPIC_LABELS[k])}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1.5">
        <label htmlFor="help-message" className="text-sm font-medium">
          {t('Your message')}
        </label>
        <Textarea id="help-message" rows={5} aria-invalid={!!errors.message} aria-describedby={errors.message ? 'help-message-error' : undefined} {...form.register('message')} />
        {errors.message?.message && (
          <p id="help-message-error" role="alert" className="text-xs text-critical">
            <Tr text={errors.message.message} />
          </p>
        )}
      </div>
      {/* People never see this; bots fill it in. */}
      <div aria-hidden className="absolute -start-[9999px] size-px overflow-hidden">
        <label htmlFor="help-website">Website</label>
        <input id="help-website" tabIndex={-1} autoComplete="off" {...form.register('website')} />
      </div>
      {error && (
        <p role="alert" className="rounded-md border border-critical/40 bg-critical/10 px-3 py-2 text-sm text-critical">
          {error}
        </p>
      )}
      <button type="submit" disabled={form.formState.isSubmitting} className="sfx-cta flex h-12 w-full items-center justify-center gap-2 text-sm font-bold disabled:opacity-70">
        <Send className="size-4" aria-hidden /> {form.formState.isSubmitting ? t('Sending…') : t('Send message')}
      </button>
    </form>
  );
}
