'use client';

import { cn } from '@dealflow/ui';
import { useId } from 'react';
import { LOGO_PARTS } from '@/components/logo';
import './sign-in-scene.css';

/**
 * The animated SampForce welcome behind every sign-in (ADR 0075). One scene per level, all in the logo's red, deep red
 * and amber: the Console's radar and orbiting clients, the Super Workspace's company tree, the Manager Workspace's team
 * orbits and the Executive Workspace's speed streaks and climbing chart. Pure SVG and CSS, decorative only, and still
 * under reduced motion.
 */
export type SceneVariant = 'console' | 'super' | 'manager' | 'executive';

export const SCENE_COPY: Record<SceneVariant, { eyebrow: string; headline: string; sub: string }> = {
  console: { eyebrow: 'SampForce Console', headline: 'Welcome to the SampForce Console', sub: 'The control center for every SampForce client.' },
  super: { eyebrow: 'Super Workspace', headline: 'Your whole company, in one place', sub: 'Workspaces, teams, targets and every client relationship, from the top.' },
  manager: { eyebrow: 'Manager Workspace', headline: 'Lead your team to the next win', sub: 'Assign work, track targets and coach your executives as it happens.' },
  executive: { eyebrow: 'Executive Workspace', headline: 'Ready to close? Let’s sell.', sub: 'Your leads, follow-ups and deals, ready the moment you sign in.' },
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

/** The scene's moving background, filling its container. */
export function SceneBackground({ variant }: { variant: SceneVariant }) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden" data-scene={variant}>
      <div className="absolute inset-0 bg-[radial-gradient(120%_90%_at_20%_45%,#7f1d1d_0%,#3b0a0c_45%,#140405_100%)]" />
      <div className="sfs-drift-a absolute -left-[10%] top-[8%] h-[60vh] w-[60vh] rounded-full bg-[#e02424] opacity-30 blur-[110px]" />
      <div className="sfs-drift-b absolute -bottom-[20%] right-[5%] h-[55vh] w-[55vh] rounded-full bg-[#ffc857] opacity-[0.12] blur-[120px]" />
      <svg viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full">
        <defs>
          <linearGradient id="sfs-line" x1="0" x2="1">
            <stop offset="0" stopColor="#ffc857" stopOpacity="0" />
            <stop offset=".5" stopColor="#ffc857" stopOpacity=".9" />
            <stop offset="1" stopColor="#e02424" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="sfs-col" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0" stopColor="#e02424" stopOpacity="0" />
            <stop offset=".6" stopColor="#e02424" stopOpacity=".35" />
            <stop offset="1" stopColor="#ffc857" stopOpacity="0" />
          </linearGradient>
        </defs>
        {variant === 'executive' && <SpeedStreaks />}
        {/* Each motif is drawn around (400, 450); placed beside the mark and above the welcome line. */}
        <g transform="translate(280 15) scale(0.7)">
          {variant === 'console' && <ConsoleMotif />}
          {variant === 'super' && <SuperMotif />}
          {variant === 'manager' && <ManagerMotif />}
          {variant === 'executive' && <ExecutiveMotif />}
        </g>
      </svg>
      <div className="absolute inset-0 bg-[radial-gradient(rgba(255,255,255,0.05)_1px,transparent_1px)] [background-size:26px_26px]" />
    </div>
  );
}

/** Authoritative: radar rings from the mark, a sweeping beam, clients orbiting, a grid running to the horizon. */
function ConsoleMotif() {
  const clients = Array.from({ length: 10 }, (_, i) => (i / 10) * Math.PI * 2);
  return (
    <g>
      <g stroke="#ffc857" strokeOpacity=".16" strokeWidth="1">
        {Array.from({ length: 13 }, (_, i) => (
          <line key={`v${i}`} x1={400 + (i - 6) * 30} y1="640" x2={400 + (i - 6) * 170} y2="900" />
        ))}
        <g className="sfs-grid">
          {Array.from({ length: 6 }, (_, i) => (
            <line key={`h${i}`} x1="-200" x2="1000" y1={600 + i * 60} y2={600 + i * 60} />
          ))}
        </g>
      </g>
      {[0, 1, 2].map((i) => (
        <circle key={i} cx="400" cy="450" r="120" fill="none" stroke="#e02424" strokeWidth="2" className={`sfs-radar sfs-radar-${i + 1}`} />
      ))}
      <circle cx="400" cy="450" r="250" fill="none" stroke="#ffc857" strokeOpacity=".22" strokeDasharray="2 10" />
      <circle cx="400" cy="450" r="350" fill="none" stroke="#e02424" strokeOpacity=".25" />
      <g className="sfs-beam">
        <path d="M400 450 L750 410 A352 352 0 0 1 750 490 Z" fill="url(#sfs-line)" opacity=".35" />
      </g>
      <g className="sfs-orbit">
        {clients.map((a, i) => (
          <circle key={i} cx={400 + Math.cos(a) * 250} cy={450 + Math.sin(a) * 250} r={i % 3 === 0 ? 7 : 4.5} fill={i % 2 ? '#ffc857' : '#ff6b6b'} />
        ))}
      </g>
      <g className="sfs-orbit-rev">
        {clients.slice(0, 6).map((a, i) => (
          <circle key={i} cx={400 + Math.cos(a + 0.3) * 350} cy={450 + Math.sin(a + 0.3) * 350} r="3.5" fill="#fff" fillOpacity=".7" />
        ))}
      </g>
    </g>
  );
}

/** Workspace management: the company tree drawing itself from the mark out to managers and executives. */
function SuperMotif() {
  const managers = [
    [700, 220],
    [760, 450],
    [700, 680],
  ] as const;
  const execs: [number, number][] = managers.flatMap(([x, y]): [number, number][] => [
    [x + 210, y - 70],
    [x + 230, y + 10],
    [x + 210, y + 80],
  ]);
  return (
    <g>
      {Array.from({ length: 9 }, (_, i) => (
        <rect key={i} x={80 + i * 170} y="900" width={i % 2 ? 26 : 14} height="420" fill="url(#sfs-col)" className="sfs-column" style={{ animationDelay: `${-i * 0.8}s` }} />
      ))}
      <g fill="none" stroke="#ffc857" strokeOpacity=".75" strokeWidth="2.5" strokeLinecap="round">
        {managers.map(([x, y], i) => (
          <path key={i} d={`M470 450 C 580 450, 590 ${y}, ${x - 16} ${y}`} className="sfs-branch" style={{ animationDelay: `${0.5 + i * 0.15}s` }} />
        ))}
      </g>
      <g fill="none" stroke="#ff8a8a" strokeOpacity=".6" strokeWidth="1.8" strokeLinecap="round">
        {execs.map(([x, y], i) => {
          const [mx, my] = managers[Math.floor(i / 3)]!;
          return <path key={i} d={`M${mx + 16} ${my} C ${mx + 110} ${my}, ${x - 90} ${y}, ${x - 10} ${y}`} className="sfs-branch" style={{ animationDelay: `${1.1 + i * 0.07}s` }} />;
        })}
      </g>
      <g fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round">
        {managers.map(([x, y], i) => (
          <path key={i} d={`M470 450 C 580 450, 590 ${y}, ${x - 16} ${y}`} className="sfs-pulse-line" style={{ animationDelay: `${2 + i * 0.6}s` }} />
        ))}
      </g>
      {managers.map(([x, y], i) => (
        <g key={i} className="sfs-node" style={{ animationDelay: `${1 + i * 0.15}s` }}>
          <circle cx={x} cy={y} r="18" fill="#e02424" />
          <circle cx={x} cy={y} r="26" fill="none" stroke="#ffc857" strokeOpacity=".5" />
          <circle cx={x} cy={y - 5} r="5" fill="#fff" />
          <path d={`M${x - 9} ${y + 11} a9 7.5 0 0 1 18 0 Z`} fill="#fff" />
        </g>
      ))}
      {execs.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="9" fill="#ffc857" className="sfs-node" style={{ animationDelay: `${1.6 + i * 0.06}s` }} />
      ))}
    </g>
  );
}

/** Team coordination: people on three orbits around the mark, linked by arcs that light up as they sync. */
function ManagerMotif() {
  const ring = (r: number, n: number, off = 0) => Array.from({ length: n }, (_, i) => [400 + Math.cos((i / n) * Math.PI * 2 + off) * r, 450 + Math.sin((i / n) * Math.PI * 2 + off) * r]);
  const rings = [ring(190, 4), ring(285, 6, 0.4), ring(380, 8, 0.15)];
  const person = (x: number, y: number, r: number, fill: string) => (
    <g>
      <circle cx={x} cy={y} r={r} fill={fill} />
      <circle cx={x} cy={y - r * 0.25} r={r * 0.32} fill="#fff" />
      <path d={`M${x - r * 0.5} ${y + r * 0.6} a${r * 0.5} ${r * 0.42} 0 0 1 ${r} 0 Z`} fill="#fff" />
    </g>
  );
  return (
    <g>
      {[190, 285, 380].map((r) => (
        <circle key={r} cx="400" cy="450" r={r} fill="none" stroke="#ffc857" strokeOpacity=".2" strokeDasharray="3 9" />
      ))}
      {[190, 285, 380].map((r, i) => (
        <circle key={`s${r}`} cx="400" cy="450" r={r} fill="none" stroke="#ff8a8a" strokeWidth="2.5" strokeLinecap="round" className="sfs-sync" style={{ animationDelay: `${-i * 1.6}s` }} />
      ))}
      <g className="sfs-team-1">{rings[0]!.map(([x, y], i) => <g key={i}>{person(x!, y!, 20, '#e02424')}</g>)}</g>
      <g className="sfs-team-2">{rings[1]!.map(([x, y], i) => <g key={i}>{person(x!, y!, 15, i % 2 ? '#b91c1c' : '#e02424')}</g>)}</g>
      <g className="sfs-team-3">{rings[2]!.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={i % 2 ? 6 : 8} fill={i % 2 ? '#ffc857' : '#ff8a8a'} />)}</g>
    </g>
  );
}

/** The logo's own speed streaks, racing across the whole Executive scene. */
function SpeedStreaks() {
  const streaks = Array.from({ length: 12 }, (_, i) => ({ y: 90 + i * 66, w: 140 + ((i * 53) % 220), d: -(i * 0.37) % 2.2, t: 1.6 + ((i * 7) % 10) / 10 }));
  return (
    <g>
      {streaks.map((s, i) => (
        <rect key={i} x="0" y={s.y} width={s.w} height={i % 3 ? 3 : 5} rx="2.5" fill="url(#sfs-line)" className="sfs-speed" style={{ animationDelay: `${s.d}s`, animationDuration: `${s.t}s` }} />
      ))}
    </g>
  );
}

/** Sales energy: a chart climbing and a spark trail beside the mark. */
function ExecutiveMotif() {
  const bars = [120, 170, 150, 230, 210, 300, 360];
  return (
    <g>
      <g transform="translate(420 760)">
        {bars.map((h, i) => (
          <rect key={i} x={i * 70} y={-h} width="40" height={h} rx="6" fill={i === bars.length - 1 ? '#ffc857' : '#e02424'} fillOpacity={0.35 + i * 0.08} className="sfs-bar" style={{ animationDelay: `${0.3 + i * 0.09}s` }} />
        ))}
        <path d={`M20 ${-bars[0]! - 30} ${bars.map((h, i) => `L${i * 70 + 20} ${-h - 30}`).join(' ')} L560 -470`} fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="sfs-trend" />
        <path d="M560 -470 l-22 4 l14 16 Z" fill="#fff" className="sfs-node" style={{ animationDelay: '2.2s' }} />
      </g>
      {Array.from({ length: 6 }, (_, i) => (
        <g key={i} transform={`translate(${560 + i * 26} ${300 - i * 22}) scale(${1.4 - i * 0.18})`}>
          <path d="M0 -8C1 -1 1 -1 8 0C1 1 1 1 0 8C-1 1 -1 1 -8 0C-1 -1 -1 -1 0 -8Z" fill="#ffc857" className="sfs-trail" style={{ animationDelay: `${-i * 0.3}s` }} />
        </g>
      ))}
    </g>
  );
}
