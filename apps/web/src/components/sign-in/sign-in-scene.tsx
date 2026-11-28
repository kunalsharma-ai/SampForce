'use client';

import { cn } from '@dealflow/ui';
import { Crown, Rocket, ShieldCheck, Users } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { LOGO_PARTS } from '@/components/logo';
import { useT } from '@/lib/i18n';
import './sign-in-scene.css';

/**
 * The animated SampForce sign-in (ADR 0075). One world per level in the logo's red, deep red and amber. Each has a
 * quiet full-screen backdrop (`SceneBackground`) and its main animation on a stage of its own (`SceneStage`), placed
 * beside the words, never under them:
 * - Console (Sampledge staff only): a black command center, a 3D grid floor, a security radar around a lock.
 * - Super Workspace: a crimson galaxy, the company as a crowned sun with its workspaces orbiting it.
 * - Manager Workspace: a sunrise, a honeycomb of the team lighting up in waves, a team-target gauge, a heartbeat.
 * - Executive Workspace: bright red speed, the SampForce bolt launching, deal cards popping, a confetti peak.
 * Pure SVG and CSS, decorative only (hidden from assistive technology), and still under reduced motion.
 */
export type SceneVariant = 'console' | 'super' | 'manager' | 'executive';

export const SCENE_COPY: Record<SceneVariant, { eyebrow: string; headline: string; sub: string }> = {
  console: { eyebrow: 'SampForce Console', headline: 'Welcome to the SampForce Console', sub: 'The control center for every SampForce client.' },
  super: { eyebrow: 'Super Workspace', headline: 'Your whole company, in one place', sub: 'Workspaces, teams, targets and every client relationship, from the top.' },
  manager: { eyebrow: 'Manager Workspace', headline: 'Guide your team to the next win', sub: 'Assign work, track targets and coach your executives as it happens.' },
  executive: { eyebrow: 'Executive Workspace', headline: 'Ready to close? Let’s sell.', sub: 'Your companies, follow-ups and deals, ready the moment you sign in.' },
};

/** The SampForce mark, part by part, so its halves can fly in and lock together. Same shapes and colours as LogoMark. */
export function AnimatedMark({ className, animate = true }: { className?: string; animate?: boolean }) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const a = `sfm-a-${id}`;
  const b = `sfm-b-${id}`;
  const h = `sfm-h-${id}`;
  const clip = `sfm-c-${id}`;
  const glow = `sfm-g-${id}`;
  const on = (c: string) => (animate ? c : undefined);
  return (
    <svg viewBox="-12 -10 82 84" className={cn('overflow-visible', className)} aria-hidden data-animated-mark="">
      <defs>
        <linearGradient id={a} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#FFC857" />
          <stop offset="1" stopColor="#E02424" />
        </linearGradient>
        <linearGradient id={b} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#E02424" />
          <stop offset="1" stopColor="#7F1D1D" />
        </linearGradient>
        <linearGradient id={h} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity=".55" />
          <stop offset=".55" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <radialGradient id={glow}>
          <stop offset="0" stopColor="#E02424" stopOpacity=".75" />
          <stop offset=".5" stopColor="#E02424" stopOpacity=".18" />
          <stop offset="1" stopColor="#E02424" stopOpacity="0" />
        </radialGradient>
        <clipPath id={clip}>
          <polygon points={LOGO_PARTS.upper} />
          <polygon points={LOGO_PARTS.lower} />
        </clipPath>
      </defs>
      <circle cx="30" cy="32" r="40" fill={`url(#${glow})`} className={on('sfs-glow')} />
      <g className={on('sfs-float')}>
        {LOGO_PARTS.streaks.map((s, i) => (
          <rect key={i} {...s} rx="1.7" fill={`url(#${i === 2 ? b : a})`} className={on(`sfs-streak sfs-streak-${i + 1}`)} />
        ))}
        <g className={on('sfs-logo-a')}>
          <polygon points={LOGO_PARTS.upper} fill={`url(#${a})`} />
          <polygon points={LOGO_PARTS.upper} fill={`url(#${h})`} />
        </g>
        <g className={on('sfs-logo-b')}>
          <polygon points={LOGO_PARTS.lower} fill={`url(#${b})`} />
          <polygon points={LOGO_PARTS.lower} fill={`url(#${h})`} opacity=".5" />
        </g>
        {animate && (
          <>
            <polygon points={LOGO_PARTS.joined} fill="#fff" className="sfs-flash" fillOpacity="0" />
            <g clipPath={`url(#${clip})`}>
              <rect x="-10" y="-5" width="16" height="80" fill="#fff" fillOpacity=".45" className="sfs-sweep" />
            </g>
          </>
        )}
        <path d={LOGO_PARTS.spark} fill="#FFC857" className={on('sfs-spark')} />
      </g>
    </svg>
  );
}

/** Deterministic "random" numbers, so the server and the browser draw the same stars. */
function rnd(n: number) {
  const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return Math.round((x - Math.floor(x)) * 1000) / 1000;
}

/* ───────────────────────── Names, greetings, the badge ───────────────────────── */

const BADGE: Record<SceneVariant, { icon: typeof Crown; name: string; role: string }> = {
  console: { icon: ShieldCheck, name: 'SampForce Console', role: 'Super Admin · Sampledge staff only' },
  super: { icon: Crown, name: 'Super Workspace', role: 'For owners and admins' },
  manager: { icon: Users, name: 'Manager Workspace', role: 'For team managers' },
  executive: { icon: Rocket, name: 'Executive Workspace', role: 'For sales executives' },
};

/** The level's name, as people read it. */
export function sceneName(variant: SceneVariant) {
  return BADGE[variant].name;
}

/** Good morning, afternoon or evening by this device's clock (worked out after loading, so pages render the same). */
export function useDayPart(): 'Good morning' | 'Good afternoon' | 'Good evening' | null {
  const [part, setPart] = useState<'Good morning' | 'Good afternoon' | 'Good evening' | null>(null);
  useEffect(() => {
    const h = new Date().getHours();
    setPart(h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening');
  }, []);
  return part;
}

/** A translated sentence with one part in bold, e.g. "Welcome to **Manager Workspace**". */
export function BoldIn({ template, value, className }: { template: string; value: string; className?: string }) {
  const [before, after = ''] = template.split('\u0001');
  return (
    <>
      {before}
      <strong className={cn('font-extrabold', className)}>{value}</strong>
      {after}
    </>
  );
}

/** "Good evening 👋 Welcome to **Manager Workspace**": the greeting above each level's headline. */
export function SceneGreeting({ variant, translate = true }: { variant: SceneVariant; translate?: boolean }) {
  const t = useT();
  const part = useDayPart();
  const name = translate ? t.maybe(BADGE[variant].name) : BADGE[variant].name;
  const welcome = translate ? t('Welcome to {name}', { name: '\u0001' }) : 'Welcome to \u0001';
  return (
    <p className="sfs-greet text-lg leading-snug text-[color:var(--sfs-ink)] sm:text-xl" data-scene-greeting={variant}>
      <span className="sfs-wave me-2 inline-block" aria-hidden>
        👋
      </span>
      {part && <span className="me-2 font-semibold text-[color:var(--sfs-gold)]">{translate ? t(part) : part}!</span>}
      <BoldIn template={welcome} value={name} className="text-[color:var(--sfs-ink)]" />
    </p>
  );
}

/** The card's header: "You're signing in to" and the level's name in bold, beside its animated emblem. */
export function WorkspaceBadge({ variant, translate = true }: { variant: SceneVariant; translate?: boolean }) {
  const t = useT();
  const b = BADGE[variant];
  const tr = (s: string) => (translate ? t.maybe(s) : s);
  return (
    <div className="sfs-badge relative flex min-w-0 items-center gap-3.5" data-workspace-badge={variant}>
      <span className="sfs-emblem relative grid size-14 shrink-0 place-items-center" aria-hidden>
        <svg viewBox="0 0 56 56" className="sfs-emblem-ring absolute inset-[-6px] size-[68px]">
          <circle cx="28" cy="28" r="26" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="4 6" strokeLinecap="round" />
        </svg>
        <span className="sfs-emblem-core grid size-14 place-items-center rounded-2xl text-white">
          <b.icon className="size-7" aria-hidden />
        </span>
      </span>
      <span className="min-w-0">
        <span className="block text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">{tr('You’re signing in to')}</span>
        <span className="block text-xl font-extrabold leading-tight tracking-tight">{tr(b.name)}</span>
        <span className="block text-xs text-muted-foreground">{tr(b.role)}</span>
      </span>
      <span aria-hidden className="sfs-badge-shine pointer-events-none absolute inset-y-0 -start-1/2 w-1/3" />
    </div>
  );
}

/** A line that rises in word by word. Screen readers get the whole sentence once. */
export function RevealText({ text, delay = 0.35 }: { text: string; delay?: number }) {
  const words = text.split(' ');
  return (
    <>
      <span className="sr-only">{text}</span>
      <span aria-hidden>
        {words.map((w, i) => (
          <span key={i}>
            <span className="sfs-word-wrap">
              <span className="sfs-word" style={{ animationDelay: `${delay + i * 0.07}s` }}>
                {w}
              </span>
            </span>
            {i < words.length - 1 ? ' ' : ''}
          </span>
        ))}
      </span>
    </>
  );
}

/* ───────────────────────── The backdrop and the stage ───────────────────────── */

/** The quiet full-screen backdrop: colour, light and slow movement, nothing that competes with the words. */
export function SceneBackground({ variant }: { variant: SceneVariant }) {
  return (
    <div aria-hidden className="sfs-tint pointer-events-none absolute inset-0 overflow-hidden" data-scene={variant}>
      {variant === 'console' && <ConsoleBackdrop />}
      {variant === 'super' && <SuperBackdrop />}
      {variant === 'manager' && <ManagerBackdrop />}
      {variant === 'executive' && <ExecutiveBackdrop />}
      <div className="absolute inset-0 bg-[radial-gradient(rgba(255,255,255,0.05)_1px,transparent_1px)] [background-size:26px_26px]" />
    </div>
  );
}

const STAGE_BOX: Record<SceneVariant, string> = {
  console: '-400 -300 800 600',
  super: '-390 -215 780 430',
  manager: '-290 -240 790 480',
  executive: '0 0 780 430',
};

/** The level's main animation, on its own stage so it never runs under text. */
export function SceneStage({ variant, className }: { variant: SceneVariant; className?: string }) {
  return (
    <svg viewBox={STAGE_BOX[variant]} preserveAspectRatio="xMidYMid meet" className={cn('sfs-tint overflow-hidden', className)} aria-hidden data-scene-stage={variant}>
      {variant === 'console' && <ConsoleStage />}
      {variant === 'super' && <SuperStage />}
      {variant === 'manager' && <ManagerStage />}
      {variant === 'executive' && <ExecutiveStage />}
    </svg>
  );
}

/* ───────────────────────── Console: the command center ───────────────────────── */

function ConsoleBackdrop() {
  return (
    <>
      <div className="sfs-bg-base absolute inset-0 bg-[radial-gradient(90%_75%_at_35%_70%,#3d0a0e_0%,#14050a_48%,#030305_100%)]" />
      <div className="sfs-floor-wrap absolute inset-x-[-40%] bottom-0 h-[34%]">
        <div className="sfs-floor h-full w-full" />
      </div>
      <div className="sfs-drift-a absolute -left-[10%] bottom-[5%] h-[50vh] w-[50vh] rounded-full bg-[#e02424] opacity-25 blur-[120px]" />
    </>
  );
}

function ConsoleStage() {
  const blips = Array.from({ length: 9 }, (_, i) => {
    const a = rnd(i + 1) * Math.PI * 2;
    const r = 90 + rnd(i + 20) * 170;
    return { x: Math.round(Math.cos(a) * r), y: Math.round(Math.sin(a) * r), d: (rnd(i + 40) * 6).toFixed(2) };
  });
  return (
    <g>
      <defs>
        <radialGradient id="sfs-cone" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="scale(280)">
          <stop offset="0" stopColor="#e02424" stopOpacity=".05" />
          <stop offset="1" stopColor="#ff4d4d" stopOpacity=".6" />
        </radialGradient>
        <linearGradient id="sfs-scanband" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ff3b3b" stopOpacity="0" />
          <stop offset=".85" stopColor="#ff3b3b" stopOpacity=".22" />
          <stop offset="1" stopColor="#ff9a9a" stopOpacity=".7" />
        </linearGradient>
      </defs>
      <line x1="-390" x2="-110" y1="0" y2="0" stroke="#fff" strokeOpacity=".18" />
      <line x1="110" x2="390" y1="0" y2="0" stroke="#fff" strokeOpacity=".18" />
      <circle r="285" fill="none" stroke="#e02424" strokeOpacity=".35" />
      <g className="sfs-hud-spin" style={{ animationDuration: '70s' }}>
        <circle r="255" fill="none" stroke="#ffc857" strokeOpacity=".6" strokeWidth="12" strokeDasharray="2 15" />
      </g>
      <g className="sfs-hud-spin sfs-rev" style={{ animationDuration: '16s' }}>
        <circle r="205" fill="none" stroke="#ff3b3b" strokeWidth="4" strokeLinecap="round" strokeDasharray="200 120 50 120 110 690" />
      </g>
      <g className="sfs-hud-spin" style={{ animationDuration: '24s' }}>
        <circle r="155" fill="none" stroke="#ffc857" strokeOpacity=".55" strokeWidth="1.5" strokeDasharray="6 8" />
      </g>
      <g className="sfs-hud-spin" style={{ animationDuration: '5s' }}>
        <path d="M0 0 L280 0 A280 280 0 0 0 214 -180 Z" fill="url(#sfs-cone)" />
        <line x1="0" y1="0" x2="280" y2="0" stroke="#ff6b6b" strokeWidth="2.5" />
      </g>
      {blips.map((b, i) => (
        <g key={i} transform={`translate(${b.x} ${b.y})`}>
          <circle r="15" fill="none" stroke="#ffc857" strokeWidth="2" className="sfs-blip" style={{ animationDelay: `${b.d}s` }} />
          <circle r="4" fill={i % 3 ? '#ff6b6b' : '#ffc857'} />
        </g>
      ))}
      <g className="sfs-hex-spin">
        <polygon points="0,-74 64,-37 64,37 0,74 -64,37 -64,-37" fill="#e02424" fillOpacity=".16" stroke="#ff4d4d" strokeWidth="2" />
      </g>
      <g className="sfs-lock">
        <path d="M-17 -6 v-12 a17 17 0 0 1 34 0 v12" fill="none" stroke="#fff" strokeWidth="6" strokeLinecap="round" />
        <rect x="-26" y="-8" width="52" height="40" rx="8" fill="#fff" />
        <circle cy="8" r="5" fill="#e02424" />
        <rect x="-2.5" y="9" width="5" height="11" rx="2" fill="#e02424" />
      </g>
      {[
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ].map(([sx, sy], i) => (
        <path key={i} d={`M${sx! * 370} ${sy! * 270} v${-sy! * 46} M${sx! * 370} ${sy! * 270} h${-sx! * 46}`} stroke="#ffc857" strokeWidth="3.5" strokeLinecap="round" className="sfs-bracket" style={{ animationDelay: `${0.3 + i * 0.1}s` }} />
      ))}
      <rect x="-400" y="-300" width="800" height="90" fill="url(#sfs-scanband)" className="sfs-scan" />
    </g>
  );
}

/* ───────────────────────── Super: the company galaxy ───────────────────────── */

const SQUASH = 0.34;

function SuperBackdrop() {
  const stars = Array.from({ length: 70 }, (_, i) => ({ x: Math.round(rnd(i) * 1600), y: Math.round(rnd(i + 200) * 900), r: (0.6 + rnd(i + 400) * 1.6).toFixed(1), d: (-rnd(i + 600) * 4).toFixed(2) }));
  return (
    <>
      <div className="sfs-bg-base absolute inset-0 bg-[radial-gradient(85%_75%_at_35%_65%,#5a0d24_0%,#260612_45%,#0a0206_100%)]" />
      <div className="sfs-nebula absolute left-[-10%] top-[20%] size-[110vh] rounded-full blur-[100px]" />
      <svg viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full">
        <defs>
          <linearGradient id="sfs-comet" x1="0" x2="1">
            <stop offset="0" stopColor="#fff" stopOpacity="0" />
            <stop offset="1" stopColor="#fff" stopOpacity=".95" />
          </linearGradient>
        </defs>
        {stars.map((s, i) => (
          <circle key={i} cx={s.x} cy={s.y} r={s.r} fill={i % 7 ? '#fff' : '#ffc857'} className="sfs-twinkle" style={{ animationDelay: `${s.d}s` }} />
        ))}
        {[
          [1000, 40, 1.5],
          [1250, 120, 5],
          [900, 760, 8.5],
        ].map(([x, y, d], i) => (
          <g key={i} transform={`translate(${x} ${y}) rotate(22)`}>
            <rect width="170" height="2.5" rx="1.25" fill="url(#sfs-comet)" className="sfs-comet" style={{ animationDelay: `${d}s` }} />
          </g>
        ))}
      </svg>
    </>
  );
}

function SuperStage() {
  const orbits = [
    { r: 165, n: 3, dur: 16, size: 11 },
    { r: 250, n: 4, dur: 26, size: 14 },
    { r: 340, n: 6, dur: 40, size: 9 },
  ];
  const colors = ['#ffc857', '#ff6b6b', '#ffffff', '#e02424'];
  return (
    <g>
      <defs>
        <radialGradient id="sfs-sun">
          <stop offset="0" stopColor="#fff3c4" />
          <stop offset=".35" stopColor="#ffc857" />
          <stop offset="1" stopColor="#e02424" />
        </radialGradient>
        <radialGradient id="sfs-corona">
          <stop offset="0" stopColor="#ffc857" stopOpacity=".7" />
          <stop offset=".45" stopColor="#e02424" stopOpacity=".3" />
          <stop offset="1" stopColor="#e02424" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle r="150" fill="url(#sfs-corona)" className="sfs-corona" />
      {orbits.map((o, k) => (
        <g key={k} transform={`rotate(-12) scale(1 ${SQUASH})`}>
          <circle r={o.r} fill="none" stroke="#ffc857" strokeOpacity=".5" strokeWidth="1.5" strokeDasharray={k === 1 ? '0' : '4 8'} vectorEffect="non-scaling-stroke" />
          <g className="sfs-hud-spin" style={{ animationDuration: `${o.dur}s` }}>
            {Array.from({ length: o.n }, (_, i) => {
              const a = (i / o.n) * Math.PI * 2 + k;
              const x = Math.round(Math.cos(a) * o.r);
              const y = Math.round(Math.sin(a) * o.r);
              const s = i === 0 ? o.size * 1.35 : o.size;
              return (
                <g key={i} transform={`translate(${x} ${y})`}>
                  <g className="sfs-counter" style={{ animationDuration: `${o.dur}s` }}>
                    <ellipse rx={s * 1.9} ry={(s * 1.9) / SQUASH} fill="#ffc857" fillOpacity=".16" />
                    <ellipse rx={s} ry={s / SQUASH} fill={colors[(i + k) % colors.length]} />
                  </g>
                </g>
              );
            })}
          </g>
        </g>
      ))}
      <circle r="56" fill="url(#sfs-sun)" />
      <circle r="56" fill="none" stroke="#fff" strokeOpacity=".5" strokeWidth="2" className="sfs-sun-ring" />
      <g className="sfs-crown">
        <path d="M-24 10 L-24 -9 L-12 2 L0 -18 L12 2 L24 -9 L24 10 Z" fill="#7f1d1d" />
        <rect x="-24" y="14" width="48" height="6" rx="3" fill="#7f1d1d" />
      </g>
    </g>
  );
}

/* ───────────────────────── Manager: the team sunrise ───────────────────────── */

function ManagerBackdrop() {
  return (
    <>
      <div className="sfs-bg-base absolute inset-0 bg-[linear-gradient(165deg,#1e0406_0%,#4f0a10_42%,#7d1416_100%)]" />
      <div className="sfs-sun absolute -bottom-[48vh] right-[-14vh] size-[95vh] rounded-full bg-[radial-gradient(circle,#ffe08a_0%,#ff9a4d_32%,#e02424_62%,rgba(224,36,36,0)_72%)]" />
      <div className="sfs-drift-a absolute -left-[10%] bottom-[0%] h-[55vh] w-[55vh] rounded-full bg-[#ff7a45] opacity-20 blur-[110px]" />
    </>
  );
}

function ManagerStage() {
  const R = 40;
  const hexes: { x: number; y: number; ring: number }[] = [];
  for (let q = -3; q <= 3; q++)
    for (let r = Math.max(-3, -q - 3); r <= Math.min(3, -q + 3); r++) {
      const ring = Math.max(Math.abs(q), Math.abs(r), Math.abs(-q - r));
      hexes.push({ x: Math.round(R * Math.sqrt(3) * (q + r / 2)), y: Math.round(R * 1.5 * r), ring });
    }
  const hex = (s: number) =>
    Array.from({ length: 6 }, (_, i) => {
      const a = (Math.PI / 3) * i + Math.PI / 6;
      return `${(Math.cos(a) * s).toFixed(1)},${(Math.sin(a) * s).toFixed(1)}`;
    }).join(' ');
  const people = hexes.filter((h, i) => h.ring === 1 || (h.ring === 2 && i % 2 === 0));
  const person = (s: number) => (
    <>
      <circle cy={-s * 0.28} r={s * 0.3} fill="#fff" />
      <path d={`M${-s * 0.55} ${s * 0.55} a${s * 0.55} ${s * 0.45} 0 0 1 ${s * 1.1} 0 Z`} fill="#fff" />
    </>
  );
  const ecg = 'M-290 0 H-170 l14 -6 l14 6 H-70 l12 -46 l14 84 l12 -56 l10 18 H50 l14 -6 l14 6 H170 l12 -46 l14 84 l12 -56 l10 18 H330 l14 -6 l14 6 H500';
  return (
    <g>
      <g transform="translate(0 -18)">
        {people.map((p, i) => (
          <line key={i} x1="0" y1="0" x2={p.x} y2={p.y} stroke="#ffd98a" strokeOpacity=".55" strokeWidth="2" strokeDasharray="6 220" className="sfs-link" style={{ animationDelay: `${(i * 0.37).toFixed(2)}s` }} />
        ))}
        {hexes.map((h, i) => (
          <g key={i} transform={`translate(${h.x} ${h.y})`}>
            <polygon points={hex(R - 4)} fill="#ff8a5c" stroke="#ffc857" strokeOpacity=".5" strokeWidth="1.5" className="sfs-hex" style={{ animationDelay: `${(h.ring * 0.28).toFixed(2)}s` }} />
          </g>
        ))}
        {people.map((p, i) => (
          <g key={i} transform={`translate(${p.x} ${p.y})`}>
            <g className="sfs-node" style={{ animationDelay: `${(0.5 + i * 0.06).toFixed(2)}s` }}>
              {person(24)}
            </g>
          </g>
        ))}
        <g className="sfs-node" style={{ animationDelay: '0.3s' }}>
          <polygon points={hex(R + 6)} fill="#e02424" stroke="#ffc857" strokeWidth="3" />
          {person(32)}
          <path d="M0 -54 l5 10 l11 1.5 l-8 7.5 l2 11 l-10 -5.5 l-10 5.5 l2 -11 l-8 -7.5 l11 -1.5 Z" fill="#ffc857" className="sfs-star" />
        </g>
      </g>
      <g transform="translate(405 -90)">
        <circle r="62" fill="#1e0406" fillOpacity=".6" stroke="#fff" strokeOpacity=".18" strokeWidth="10" />
        <circle r="62" fill="none" stroke="#ffc857" strokeWidth="10" strokeLinecap="round" transform="rotate(-90)" className="sfs-gauge" />
        <text textAnchor="middle" y="9" fontSize="28" fontWeight="700" fill="#fff">
          86%
        </text>
        <text textAnchor="middle" y="94" fontSize="13" letterSpacing="3" fontWeight="600" fill="#ffd98a">
          TEAM TARGET
        </text>
      </g>
      <g transform="translate(0 212)">
        <path d={ecg} fill="none" stroke="#ffc857" strokeOpacity=".22" strokeWidth="2" />
        <path d={ecg} fill="none" stroke="#ffd98a" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="sfs-ecg" />
      </g>
    </g>
  );
}

/* ───────────────────────── Executive: launch and sell ───────────────────────── */

function ExecutiveBackdrop() {
  const lines = Array.from({ length: 26 }, (_, i) => ({ y: -200 + i * 52, w: 180 + Math.round(rnd(i + 300) * 360), h: i % 4 ? 2 : 5, dur: (0.9 + rnd(i + 320) * 1.1).toFixed(2), d: (-rnd(i + 340) * 2).toFixed(2) }));
  return (
    <>
      <div className="sfs-bg-base absolute inset-0 bg-[linear-gradient(125deg,#6f0b10_0%,#c41c1c_38%,#e02424_58%,#8f1116_100%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(120%_90%_at_50%_50%,transparent_45%,rgba(20,2,4,0.55)_100%)]" />
      <svg viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" className="sfs-speed-field absolute inset-0 h-full w-full">
        <defs>
          <linearGradient id="sfs-speed" x1="0" x2="1">
            <stop offset="0" stopColor="#fff" stopOpacity="0" />
            <stop offset="1" stopColor="#fff" stopOpacity=".6" />
          </linearGradient>
        </defs>
        <g transform="rotate(-18 800 450)">
          {lines.map((l, i) => (
            <rect key={i} x="0" y={l.y} width={l.w} height={l.h} rx={l.h / 2} fill="url(#sfs-speed)" className="sfs-speed" style={{ animationDuration: `${l.dur}s`, animationDelay: `${l.d}s` }} />
          ))}
        </g>
      </svg>
    </>
  );
}

function ExecutiveStage() {
  const toasts = [
    { x: 470, y: 30, text: 'Deal won', icon: 'check', d: 0.6 },
    { x: 520, y: 150, text: '+3 new companies', icon: 'up', d: 2.1 },
    { x: 480, y: 270, text: 'Meeting booked', icon: 'cal', d: 3.6 },
  ];
  const bars = [60, 95, 85, 130, 120, 175, 230];
  const confetti = Array.from({ length: 18 }, (_, i) => {
    const a = (i / 18) * Math.PI * 2;
    const dist = 55 + rnd(i + 700) * 60;
    return { dx: Math.round(Math.cos(a) * dist), dy: Math.round(Math.sin(a) * dist), c: ['#ffc857', '#fff', '#ff8a8a'][i % 3]!, rot: Math.round(rnd(i + 720) * 360) };
  });
  return (
    <g>
      <defs>
        <linearGradient id="sfs-flame" x1="1" x2="0">
          <stop offset="0" stopColor="#fff3c4" />
          <stop offset=".3" stopColor="#ffc857" />
          <stop offset="1" stopColor="#ffc857" stopOpacity="0" />
        </linearGradient>
      </defs>
      <g transform="translate(-120 520) rotate(-27)">
        <g className="sfs-rocket">
          <path d="M0 -22 L-420 -5 L-420 5 L0 22 Z" fill="url(#sfs-flame)" className="sfs-flame" />
          <g transform="translate(-26 -54) scale(1.7)">
            {LOGO_PARTS.streaks.map((s, i) => (
              <rect key={i} {...s} rx="1.7" fill="#fff" fillOpacity=".85" />
            ))}
            <polygon points={LOGO_PARTS.upper} fill="#ffc857" />
            <polygon points={LOGO_PARTS.lower} fill="#fff" />
          </g>
        </g>
      </g>
      <g transform="translate(30 415)">
        <line x1="-10" x2="380" y1="0" y2="0" stroke="#fff" strokeOpacity=".35" strokeWidth="2" />
        {bars.map((h, i) => (
          <rect key={i} x={i * 52} y={-h} width="34" height={h} rx="6" fill={i === bars.length - 1 ? '#ffc857' : '#fff'} fillOpacity={i === bars.length - 1 ? 1 : 0.2 + i * 0.07} className="sfs-bar" style={{ animationDelay: `${0.3 + i * 0.09}s` }} />
        ))}
        <path d={`M17 ${-bars[0]! - 24} ${bars.map((h, i) => `L${i * 52 + 17} ${-h - 24}`).join(' ')}`} fill="none" stroke="#fff" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" className="sfs-trend" />
        <g transform={`translate(${(bars.length - 1) * 52 + 17} ${-bars[bars.length - 1]! - 24})`}>
          {confetti.map((c, i) => (
            <rect key={i} x="-4" y="-2" width="8" height="4" rx="1" fill={c.c} className="sfs-confetti" style={{ '--dx': `${c.dx}px`, '--dy': `${c.dy}px`, '--rot': `${c.rot}deg` } as React.CSSProperties} />
          ))}
          <circle r="9" fill="#fff" className="sfs-node" style={{ animationDelay: '2s' }} />
        </g>
      </g>
      {toasts.map((t, i) => (
        <g key={i} transform={`translate(${t.x} ${t.y})`}>
          <g className="sfs-toast" style={{ animationDelay: `${t.d}s` }}>
            <rect width="230" height="58" rx="16" fill="#fff" />
            <circle cx="31" cy="29" r="16" fill={t.icon === 'check' ? '#16a34a' : '#e02424'} />
            {t.icon === 'check' && <path d="M24 29 l5 5 l10 -11" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />}
            {t.icon === 'up' && <path d="M31 37 V22 M24 28 l7 -7 l7 7" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />}
            {t.icon === 'cal' && <path d="M24 24 h14 v12 h-14 Z M24 28 h14 M28 21 v5 M34 21 v5" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />}
            <text x="58" y="36" fontSize="19" fontWeight="700" fill="#7f1d1d">
              {t.text}
            </text>
          </g>
        </g>
      ))}
    </g>
  );
}
