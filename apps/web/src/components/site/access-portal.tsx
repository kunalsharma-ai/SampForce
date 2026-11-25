'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { cn, Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, Input } from '@dealflow/ui';
import { type LoginInput, type LoginResponse, loginSchema } from '@dealflow/types';
import { ArrowLeft, ArrowRight, Check, KeyRound, Lock, Rocket, Sparkles, X } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { SecondFactor } from '@/app/(auth)/login/login-form';
import { FloatingField } from '@/components/forms/floating-field';
import { SiteLogo } from './site-logo';
import { markWelcome } from '@/components/sign-in/welcome-overlay';
import { api, ApiError } from '@/lib/api';
import { Tr, useT } from '@/lib/i18n';
import { checkSignupStep, passwordChecks, passwordStrength, SIGNUP_STEPS, type SignupField, stepOfField } from '@/lib/signup-steps';
import { type PortalFace, useSite } from './site-context';

const STREAK_COLOURS = ['--sfx-red', '--sfx-ember', '--sfx-amber', '--sfx-spark'];

/** Light streaks rushing out from the centre, placed once per opening. */
function useStreaks(n: number) {
  return useMemo(
    () =>
      Array.from({ length: n }, (_, i) => ({
        a: `${(360 / n) * i + Math.random() * 10}deg`,
        c: `var(${STREAK_COLOURS[i % STREAK_COLOURS.length]})`,
        delay: `${(Math.random() * 2.6).toFixed(2)}s`,
        dur: `${(2 + Math.random() * 1.4).toFixed(2)}s`,
      })),
    [n],
  );
}

/**
 * The website's sign-in and sign-up portal (ADR 0078). It opens over the page from the click, out of a burst of
 * light; one card flips between signing in and creating a workspace. Both sides call the same API as the /login and
 * /signup pages (which stay for invitations, SSO returns and links with ?next=).
 */
export function AccessPortal({ face, onFace, onClose }: { face: PortalFace | null; onFace: (f: PortalFace) => void; onClose: () => void }) {
  const t = useT();
  const { mode } = useSite();
  const streaks = useStreaks(28);
  const [launching, setLaunching] = useState(false);
  const reduce = useReducedMotion();
  const open = face !== null;
  useEffect(() => {
    if (!open) setLaunching(false);
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !launching && onClose()}>
      <DialogContent
        hideClose
        className="sfx-scope fixed inset-0 left-0 top-0 flex h-dvh w-full max-w-none translate-x-0 items-center justify-center overflow-y-auto rounded-none border-0 bg-transparent p-4 shadow-none"
        data-sfx-mode={mode}
        data-site-portal={face ?? ''}
        aria-describedby="portal-description"
        onOpenAutoFocus={(e) => {
          // Straight to the first field, not the close button.
          e.preventDefault();
          setTimeout(() => document.querySelector<HTMLInputElement>('[data-site-portal] form input:not([type=hidden]):not([hidden])')?.focus(), 80);
        }}
      >
        <div className="sfx-portal-bg pointer-events-none fixed inset-0 overflow-hidden" aria-hidden>
          {streaks.map((s, i) => (
            <span key={i} className="sfx-warp" style={{ '--a': s.a, '--sfx-c': s.c, '--delay': s.delay, '--dur': s.dur } as CSSProperties} />
          ))}
        </div>
        <div className="fixed start-5 top-5 z-10">
          <SiteLogo />
        </div>
        <DialogClose className="fixed end-5 top-5 z-10 grid size-11 place-items-center rounded-full border border-border bg-surface/70 text-foreground backdrop-blur transition hover:rotate-90 hover:border-primary">
          <X className="size-5" aria-hidden />
          <span className="sr-only">{t('Close')}</span>
        </DialogClose>

        <motion.div
          initial={reduce ? false : { scale: 0.55, rotateX: 35, y: 60, filter: 'blur(14px)' }}
          animate={launching ? { scale: 1.25, y: -30, filter: 'blur(10px) brightness(1.6)' } : { scale: 1, rotateX: 0, y: 0, filter: 'blur(0px)' }}
          transition={launching ? { duration: 0.7, ease: [0.6, 0, 0.8, 0.4] } : { type: 'spring', stiffness: 120, damping: 16 }}
          style={{ transformPerspective: 1400 }}
          className="sfx-ring-border relative z-10 my-16 w-full max-w-[460px] rounded-[28px]"
        >
          <div className="sfx-portal-card relative overflow-hidden rounded-[27px] p-6 sm:p-8">
            <DialogTitle className="sr-only">{face === 'start' ? t('Create your workspace') : t('Sign in')}</DialogTitle>
            <DialogDescription id="portal-description" className="sr-only">
              {face === 'start' ? t('Free for up to 2 users. No card required.') : t('Welcome back to your revenue workspace.')}
            </DialogDescription>
            <FaceSwitch face={face ?? 'sign-in'} onFace={onFace} disabled={launching} />
            <div style={{ perspective: 1200 }} className="mt-6">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={face ?? 'none'}
                  initial={reduce ? false : { rotateY: face === 'start' ? -95 : 95 }}
                  animate={{ rotateY: 0 }}
                  exit={reduce ? undefined : { rotateY: face === 'start' ? 95 : -95 }}
                  transition={{ duration: 0.32, ease: [0.3, 0.8, 0.3, 1] }}
                  style={{ backfaceVisibility: 'hidden' }}
                >
                  {face === 'start' ? <SignUpFace onLaunch={() => setLaunching(true)} /> : <SignInFace onLaunch={() => setLaunching(true)} />}
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </motion.div>
      </DialogContent>
    </Dialog>
  );
}

function FaceSwitch({ face, onFace, disabled }: { face: PortalFace; onFace: (f: PortalFace) => void; disabled: boolean }) {
  const t = useT();
  return (
    <div role="tablist" aria-label={t('Sign in or create a workspace')} className="relative grid grid-cols-2 rounded-full border border-border bg-background/60 p-1">
      <span aria-hidden className={cn('sfx-switch-pill absolute inset-y-1 start-1 w-[calc(50%-0.25rem)] rounded-full', face === 'start' && 'translate-x-full rtl:-translate-x-full')} />
      {(['sign-in', 'start'] as const).map((f) => (
        <button
          key={f}
          type="button"
          role="tab"
          aria-selected={face === f}
          disabled={disabled}
          onClick={() => onFace(f)}
          className={cn('relative z-10 flex items-center justify-center gap-1.5 rounded-full py-2.5 text-sm font-bold transition-colors', face === f ? 'text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}
          data-portal-face={f}
        >
          {f === 'sign-in' ? <KeyRound className="size-4" aria-hidden /> : <Rocket className="size-4" aria-hidden />}
          {f === 'sign-in' ? t('Sign in') : t('Create workspace')}
        </button>
      ))}
    </div>
  );
}

/** Waits for the launch animation, then goes. */
function useLaunch(onLaunch: () => void) {
  const router = useRouter();
  const reduce = useReducedMotion();
  return (to: string, delay = 650) => {
    onLaunch();
    setTimeout(() => router.replace(to), reduce ? 0 : delay);
  };
}

/* ── Sign in ──────────────────────────────────────────────────────────────────────────────────────────────────── */

function SignInFace({ onLaunch }: { onLaunch: () => void }) {
  const t = useT();
  const launch = useLaunch(onLaunch);
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(0);
  const [challenge, setChallenge] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const form = useForm<LoginInput>({ resolver: zodResolver(loginSchema), mode: 'onTouched', defaultValues: { email: '', password: '' } });

  const finish = () => {
    setDone(true);
    markWelcome();
    launch('/app');
  };

  const onSubmit = form.handleSubmit(
    async (values) => {
      setError(null);
      try {
        const res = await api<LoginResponse>('/auth/login', { method: 'POST', json: values });
        if (res.mfaRequired && res.challenge) return setChallenge(res.challenge);
        finish();
      } catch (err) {
        setShake((n) => n + 1);
        setError(err instanceof ApiError ? err.message : t('Could not reach SampForce. Check your connection.'));
      }
    },
    () => setShake((n) => n + 1),
  );

  if (challenge) {
    return (
      <SecondFactor
        challenge={challenge}
        onDone={finish}
        onRestart={() => {
          setChallenge(null);
          form.setValue('password', '');
        }}
      />
    );
  }

  return (
    <div key={shake} className={cn('space-y-5', shake > 0 && 'sfx-shake')}>
      <div>
        <h2 className="text-2xl font-bold tracking-tight">
          {done ? t('Opening your workspace…') : <span className="sfx-gradient-text">{t('Welcome back')}</span>}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{t('Welcome back to your revenue workspace.')}</p>
      </div>
      <form onSubmit={onSubmit} noValidate className="space-y-4" data-portal-form="sign-in">
        <FloatingField id="portal-email" label={t('Work email')} error={form.formState.errors.email?.message}>
          <Input type="email" autoComplete="email" {...form.register('email')} />
        </FloatingField>
        <FloatingField id="portal-password" reveal label={t('Password')} error={form.formState.errors.password?.message}>
          <Input type="password" autoComplete="current-password" {...form.register('password')} />
        </FloatingField>
        <p className="-mt-1 text-end text-sm">
          <Link href="/forgot-password" className="font-medium text-primary underline-offset-2 hover:underline">
            {t('Forgot your password?')}
          </Link>
        </p>
        {error && (
          <p role="alert" className="rounded-xl border border-critical/40 bg-critical/10 px-3 py-2 text-sm text-critical">
            {error}
          </p>
        )}
        <button type="submit" disabled={form.formState.isSubmitting || done} className="sfx-cta flex h-12 w-full items-center justify-center gap-2 text-sm font-bold disabled:opacity-80">
          {done ? <Check className="size-5" aria-hidden /> : <Lock className="size-4" aria-hidden />}
          {form.formState.isSubmitting ? t('Signing in…') : done ? t('Signed in') : t('Sign in')}
        </button>
      </form>
      <div className="flex items-center gap-3 text-xs text-muted-foreground" aria-hidden="true">
        <span className="h-px flex-1 bg-border" />
        {t('or')}
        <span className="h-px flex-1 bg-border" />
      </div>
      <Link href="/login/sso" className="flex h-11 w-full items-center justify-center rounded-full border border-border text-sm font-semibold transition hover:border-primary hover:text-primary">
        {t('Sign in with SSO')}
      </Link>
    </div>
  );
}

/* ── Create a workspace ───────────────────────────────────────────────────────────────────────────────────────── */

const CONFETTI = ['--sfx-red', '--sfx-ember', '--sfx-amber', '--sfx-spark'];

function SignUpFace({ onLaunch }: { onLaunch: () => void }) {
  const t = useT();
  const launch = useLaunch(onLaunch);
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState(1);
  const [values, setValues] = useState<Record<SignupField, string>>({ name: '', email: '', password: '', organizationName: '' });
  const [errors, setErrors] = useState<Partial<Record<SignupField, string>>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [shake, setShake] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const current = SIGNUP_STEPS[step]!;
  const last = step === SIGNUP_STEPS.length - 1;
  const value = values[current.field];

  useEffect(() => {
    const id = setTimeout(() => inputRef.current?.focus(), 60);
    return () => clearTimeout(id);
  }, [step]);

  const go = (to: number) => {
    setDir(to > step ? 1 : -1);
    setStep(to);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setServerError(null);
    const problem = checkSignupStep(current.field, value);
    if (problem) {
      setErrors((x) => ({ ...x, [current.field]: problem }));
      setShake((n) => n + 1);
      return;
    }
    if (!last) return go(step + 1);
    setBusy(true);
    try {
      await api('/auth/register', { method: 'POST', json: values });
      setReady(true);
      launch('/app?welcome=1', 1500);
    } catch (err) {
      setBusy(false);
      setShake((n) => n + 1);
      if (err instanceof ApiError && err.details?.length) {
        const found: Partial<Record<SignupField, string>> = {};
        for (const d of err.details) found[d.path as SignupField] = d.message;
        setErrors(found);
        go(stepOfField(err.details[0]!.path));
      }
      setServerError(err instanceof ApiError ? err.message : t('Could not reach SampForce. Check your connection.'));
    }
  };

  if (ready) {
    return (
      <div className="relative py-8 text-center" role="status" data-portal-ready="">
        {Array.from({ length: 28 }, (_, i) => (
          <span
            key={i}
            aria-hidden
            className="sfx-confetti"
            style={{ '--c': `var(${CONFETTI[i % 4]})`, '--x': `${Math.cos(i) * (90 + (i % 5) * 30)}px`, '--y': `${Math.sin(i) * (70 + (i % 4) * 30) - 40}px`, '--r': `${i * 47}deg`, '--delay': `${(i % 6) * 0.03}s` } as CSSProperties}
          />
        ))}
        <motion.div initial={{ scale: 0, rotate: -180 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 220, damping: 12 }} className="sfx-help-orb mx-auto grid size-20 place-items-center rounded-3xl">
          <Rocket className="size-9" aria-hidden />
        </motion.div>
        <h2 className="mt-5 text-2xl font-bold">
          <span className="sfx-gradient-text">{t('Your workspace is ready')}</span>
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{t('Taking you to {name}…', { name: values.organizationName })}</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <Constellation step={step} />
      <form onSubmit={submit} noValidate data-portal-form="start" data-signup-step={current.field}>
        <AnimatePresence mode="wait" initial={false} custom={dir}>
          <motion.div
            key={step}
            custom={dir}
            initial={{ x: dir * 48, filter: 'blur(6px)' }}
            animate={{ x: 0, filter: 'blur(0px)' }}
            exit={{ x: dir * -48, filter: 'blur(6px)' }}
            transition={{ duration: 0.25, ease: [0.3, 0.8, 0.3, 1] }}
            className="space-y-4"
          >
            <div key={shake} className={cn(shake > 0 && 'sfx-shake')}>
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-primary">{t('Step {n} of {total}', { n: step + 1, total: SIGNUP_STEPS.length })}</p>
              <h2 className="mt-1 text-2xl font-bold tracking-tight">{t.maybe(current.title)}</h2>
            </div>
            {/* Password managers save the address with the password. */}
            {current.field === 'password' && <input type="email" autoComplete="username" value={values.email} readOnly hidden />}
            <FloatingField id={`portal-${current.field}`} reveal={current.field === 'password'} label={t.maybe(current.label)} error={errors[current.field]}>
              <Input
                ref={inputRef}
                type={current.type}
                autoComplete={current.autoComplete}
                value={value}
                onChange={(e) => {
                  const v = e.target.value;
                  setValues((x) => ({ ...x, [current.field]: v }));
                  if (errors[current.field]) setErrors((x) => ({ ...x, [current.field]: checkSignupStep(current.field, v) ?? undefined }));
                }}
              />
            </FloatingField>
            {current.field === 'password' && <PasswordMeter password={value} />}
            {current.field === 'organizationName' && <WorkspacePreview name={value} owner={values.name} />}
            {current.field === 'name' && <p className="text-sm text-muted-foreground">{t('Free for up to 2 users. No card required.')}</p>}
          </motion.div>
        </AnimatePresence>
        {serverError && (
          <p role="alert" className="mt-4 rounded-xl border border-critical/40 bg-critical/10 px-3 py-2 text-sm text-critical">
            {serverError}
          </p>
        )}
        <div className="mt-6 flex items-center gap-3">
          {step > 0 && (
            <button type="button" onClick={() => go(step - 1)} className="grid size-12 shrink-0 place-items-center rounded-full border border-border transition hover:border-primary hover:text-primary" disabled={busy}>
              <ArrowLeft className="size-5 rtl:rotate-180" aria-hidden />
              <span className="sr-only">{t('Back')}</span>
            </button>
          )}
          <button type="submit" disabled={busy} className="sfx-cta flex h-12 flex-1 items-center justify-center gap-2 text-sm font-bold disabled:opacity-80">
            {last ? (busy ? t('Creating workspace…') : t('Create workspace')) : t('Continue')}
            {last ? <Sparkles className="size-4" aria-hidden /> : <ArrowRight className="size-4 rtl:rotate-180" aria-hidden />}
          </button>
        </div>
      </form>
    </div>
  );
}

/** Four stars joined by light as the visitor moves through the steps. */
function Constellation({ step }: { step: number }) {
  return (
    <ol className="flex items-center" aria-hidden data-signup-progress={step + 1}>
      {SIGNUP_STEPS.map((s, i) => (
        <li key={s.field} className={cn('flex items-center', i < SIGNUP_STEPS.length - 1 && 'flex-1')}>
          <span className="sfx-star grid size-8 shrink-0 place-items-center rounded-full text-xs font-bold" data-state={i < step ? 'done' : i === step ? 'current' : 'todo'}>
            {i < step ? <Check className="size-4" /> : i + 1}
          </span>
          {i < SIGNUP_STEPS.length - 1 && (
            <span className="sfx-star-line mx-1.5 h-0.5 flex-1 overflow-hidden rounded-full">
              <span style={{ transform: `scaleX(${i < step ? 1 : 0})` }} />
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}

function PasswordMeter({ password }: { password: string }) {
  const t = useT();
  const checks = passwordChecks(password);
  const strength = passwordStrength(password);
  const colours = ['bg-border', 'bg-critical', 'bg-warning', 'bg-success', 'bg-success'];
  const words = ['', 'Too weak', 'Almost there', 'Strong', 'Very strong'];
  return (
    <div className="space-y-2" data-password-strength={strength}>
      <div className="sfx-strength grid grid-cols-4 gap-1.5" aria-hidden>
        {[1, 2, 3, 4].map((n) => (
          <span key={n} className={cn('h-1.5 rounded-full', strength >= n ? colours[strength] : 'bg-border')} style={{ transform: strength >= n ? 'scaleY(1.4)' : 'none' }} />
        ))}
      </div>
      <ul className="grid gap-1 text-xs sm:grid-cols-3">
        {[
          [checks.length, 'At least 10 characters'],
          [checks.letter, 'A letter'],
          [checks.number, 'A number'],
        ].map(([ok, label]) => (
          <li key={label as string} className={cn('flex items-center gap-1.5', ok ? 'text-success' : 'text-muted-foreground')} data-check-ok={ok ? 'yes' : 'no'}>
            <span className={cn('grid size-4 place-items-center rounded-full border', ok ? 'border-success bg-success text-background' : 'border-border')}>{ok && <Check className="size-3" aria-hidden />}</span>
            {t.maybe(label as string)}
          </li>
        ))}
      </ul>
      {strength > 0 && (
        <p className="text-xs font-semibold" aria-live="polite">
          <Tr text={words[strength]!} />
        </p>
      )}
    </div>
  );
}

/** The workspace taking shape as its name is typed. */
function WorkspacePreview({ name, owner }: { name: string; owner: string }) {
  const t = useT();
  const initials =
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? '')
      .join('') || '✦';
  return (
    <motion.div layout className="flex items-center gap-3 rounded-2xl border border-border bg-background/50 p-3" data-workspace-preview="">
      <motion.span key={initials} initial={{ scale: 0.5, rotate: -30 }} animate={{ scale: 1, rotate: 0 }} className="sfx-help-orb grid size-12 shrink-0 place-items-center rounded-xl text-base font-black">
        {initials}
      </motion.span>
      <div className="min-w-0">
        <p className="truncate font-semibold">{name.trim() || t('Your workspace')}</p>
        <p className="truncate text-xs text-muted-foreground">{t('Free plan · owner {name}', { name: owner.trim() || '…' })}</p>
      </div>
    </motion.div>
  );
}
