'use client';

import type { AchievementLevel, AchievementRow } from '@dealflow/types';
import { Briefcase, Building2, Check, Crown, Gem, Handshake, Leaf, ListChecks, Medal, Send, Sparkles, Target, Trophy, UserPlus } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ConfettiStyle } from './confetti';

/*
 * One scene per kind of achievement (ADR 0090), so a converted company, an RFQ, a cleared day and a sales target each
 * look different. Scenes are decorative (aria-hidden): the card says everything in words.
 */

export type SceneLayout = 'toast' | 'compact' | 'card' | 'stage';
export type Tone = 'deal' | 'prospect' | 'rfq' | 'task' | 'sweep' | 'milestone' | 'quota' | 'target' | 'medal' | 'diamond' | 'rhythm';

export interface SceneSpec {
  tone: Tone;
  layout: SceneLayout;
  confetti: ConfettiStyle | null;
  colors: string[];
  /** How long the pop-up stays before it closes by itself (paused while hovered or focused). */
  ms: number;
  icon: typeof Check;
}

const PALETTE: Record<Tone, string[]> = {
  deal: ['#e02424', '#ffb347', '#ffd98a', '#ffffff', '#7f1d1d'],
  prospect: ['#0d9488', '#5eead4', '#ccfbf1', '#fde68a'],
  rfq: ['#2563eb', '#7dd3fc', '#e0f2fe', '#a5b4fc'],
  task: ['#059669', '#6ee7b7'],
  sweep: ['#7c3aed', '#c4b5fd', '#f5d0fe', '#fde68a'],
  milestone: ['#ea580c', '#fdba74'],
  quota: ['#f97316', '#fde047', '#fb7185', '#ffffff'],
  target: ['#b45309', '#fcd34d', '#fef3c7', '#f59e0b', '#ffffff'],
  medal: ['#be123c', '#fda4af', '#fcd34d', '#ffffff'],
  diamond: ['#a78bfa', '#f0abfc', '#67e8f9', '#ffffff', '#fde68a'],
  rhythm: ['#0f766e', '#a7f3d0'],
};

function spec(tone: Tone, layout: SceneLayout, confetti: ConfettiStyle | null, ms: number, icon: typeof Check): SceneSpec {
  return { tone, layout, confetti, colors: PALETTE[tone], ms, icon };
}

/** The look of an achievement. An exceptional milestone gets the full-screen stage. */
export function sceneFor(a: Pick<AchievementRow, 'kind' | 'level' | 'details'>): SceneSpec {
  const stage = a.level === 'EXCEPTIONAL';
  switch (a.kind) {
    case 'DEAL_CONVERTED':
      return spec('deal', 'card', 'ribbons', 9000, Handshake);
    case 'PROSPECT_CONVERTED':
      return spec('prospect', 'card', 'light', 7500, UserPlus);
    case 'RFQ_SUBMITTED':
      return spec('rfq', 'card', 'light', 7500, Send);
    case 'TASK_IMPORTANT':
      return spec('task', 'toast', null, 4500, Check);
    case 'ALL_TASKS_DONE':
      return spec('sweep', 'card', 'light', 7500, ListChecks);
    case 'LEAD_MILESTONE':
      return spec('milestone', 'compact', null, 5500, Target);
    case 'LEAD_TARGET':
      return spec('quota', 'card', a.level === 'DAILY' ? 'light' : 'ribbons', 8000, Target);
    case 'SALES_TARGET':
      return spec('target', stage ? 'stage' : 'card', 'gold', stage ? 10_000 : 9000, Trophy);
    case 'DEALS_WON_MILESTONE':
      return spec('medal', stage ? 'stage' : 'card', stage ? 'stars' : 'ribbons', stage ? 10_000 : 8500, Medal);
    case 'MAJOR_DEAL':
      return spec('diamond', 'stage', 'stars', 10_000, Gem);
    case 'CONSISTENCY':
      return spec('rhythm', 'card', null, 8000, Leaf);
  }
}

/** Counts up to `to` once (or shows it at once when still). */
export function useCountUp(to: number, still: boolean, ms = 1200, delay = 250): number {
  const [n, setN] = useState(still ? to : 0);
  useEffect(() => {
    if (still) {
      setN(to);
      return;
    }
    let frame = 0;
    const start = performance.now() + delay;
    const tick = (now: number) => {
      const p = Math.min(1, Math.max(0, (now - start) / ms));
      setN(Math.round(to * (1 - (1 - p) ** 3)));
      if (p < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [to, still, ms, delay]);
  return n;
}

// ─── Scenes ───

/** A company moving along Lead → Client → Deal won. */
function DealJourney() {
  return (
    <svg viewBox="0 0 260 92" className="h-[92px] w-full" aria-hidden>
      <rect x="30" y="44" width="200" height="6" rx="3" fill="rgba(255,255,255,0.22)" />
      <rect className="sfc-track-fill" x="30" y="44" width="200" height="6" rx="3" fill="#fff" />
      {[30, 130, 230].map((x, i) => (
        <g key={x} className={`sfc-node sfc-node-${i + 1}`}>
          <circle cx={x} cy="47" r={i === 2 ? 17 : 11} fill={i === 2 ? '#fff' : 'rgba(255,255,255,0.92)'} />
        </g>
      ))}
      <g className="sfc-burst" stroke="#ffd98a" strokeWidth="3" strokeLinecap="round">
        {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => {
          const r = (deg * Math.PI) / 180;
          return <line key={deg} x1={230 + Math.cos(r) * 22} y1={47 + Math.sin(r) * 22} x2={230 + Math.cos(r) * 34} y2={47 + Math.sin(r) * 34} />;
        })}
      </g>
      <g className="sfc-token" style={{ ['--sfc-travel' as string]: '200px' }}>
        <circle cx="30" cy="47" r="6" fill="var(--c2)" />
      </g>
      <foreignObject x="20" y="37" width="20" height="20"><Building2 className="size-5 text-[var(--c3)]" /></foreignObject>
      <foreignObject x="120" y="37" width="20" height="20"><Briefcase className="size-5 text-[var(--c3)]" /></foreignObject>
      <foreignObject x="218" y="35" width="24" height="24"><Handshake className="size-6 text-[var(--c1)]" /></foreignObject>
    </svg>
  );
}

function ProspectSeed() {
  return (
    <svg viewBox="0 0 120 92" className="h-[92px] w-full" aria-hidden>
      {[1, 2, 3].map((i) => (
        <circle key={i} className={`sfc-ripple sfc-ripple-${i}`} cx="60" cy="48" r="26" fill="none" stroke="#fff" strokeWidth="2" />
      ))}
      <circle cx="60" cy="48" r="22" fill="#fff" />
      <foreignObject className="sfc-sprout" x="46" y="34" width="28" height="28"><Sparkles className="size-7 text-[var(--c1)]" /></foreignObject>
    </svg>
  );
}

function RfqFlight({ still }: { still: boolean }) {
  return (
    <svg viewBox="0 0 260 104" className="h-[104px] w-full" aria-hidden>
      <path className="sfc-route" d="M 16 92 C 80 10, 170 10, 236 58" fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth="2" />
      <g className="sfc-trail" fill="#fff" opacity="0.7">
        <circle cx="52" cy="58" r="2" />
        <circle cx="86" cy="38" r="1.6" />
        <circle cx="122" cy="30" r="1.4" />
      </g>
      <g className="sfc-stamp">
        <circle cx="228" cy="62" r="24" fill="#fff" />
        <circle cx="228" cy="62" r="19" fill="none" stroke="var(--c1)" strokeWidth="2" strokeDasharray="3 3" />
        <path d="M218 62 l7 7 l13 -14" fill="none" stroke="var(--c1)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      </g>
      {/* The plane follows the route (SMIL, so it works on every browser); still, it waits at the stamp. */}
      <g transform={still ? 'translate(200 46) rotate(30)' : undefined}>
        <path d="M-12 -9 L14 0 L-12 9 L-6 0 Z" fill="#fff" stroke="var(--c3)" strokeWidth="1.2" strokeLinejoin="round">
          {!still && <animateMotion dur="1.6s" begin="0s" fill="freeze" rotate="auto" keyPoints="0;1" keyTimes="0;1" calcMode="spline" keySplines="0.5 0 0.3 1" path="M 16 92 C 80 10, 170 10, 200 46" />}
        </path>
      </g>
    </svg>
  );
}

export function DrawnCheck({ size = 44, color = 'var(--c1)' }: { size?: number; color?: string }) {
  return (
    <svg viewBox="0 0 60 60" width={size} height={size} aria-hidden>
      <circle className="sfc-halo" cx="30" cy="30" r="24" fill="none" stroke={color} strokeWidth="3" />
      <circle className="sfc-check-circle" cx="30" cy="30" r="25" fill="none" stroke={color} strokeWidth="4" transform="rotate(-90 30 30)" />
      <path className="sfc-check-mark" d="M18 31 l8 8 l16 -18" fill="none" stroke={color} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CleanSweep({ done }: { done: number }) {
  return (
    <div className="relative mx-auto h-[96px] w-[220px]" aria-hidden>
      {[3, 2, 1].map((i) => (
        <div
          key={i}
          className={`sfc-sheet sfc-sheet-${i} absolute start-[34px] flex h-9 w-[150px] items-center gap-2 rounded-lg bg-white/95 px-2.5 shadow-lg`}
          style={{ top: 12 + (3 - i) * 14, transform: `rotate(${(i - 2) * 3}deg)` }}
        >
          <span className="grid size-4 place-items-center rounded bg-[var(--c1)] text-white"><Check className="size-3" /></span>
          <span className="h-1.5 flex-1 rounded bg-[var(--c2)]" />
        </div>
      ))}
      <div className="sfc-sweep-final absolute inset-0 grid place-items-center">
        <div className="grid size-[76px] place-items-center rounded-full bg-white shadow-xl">
          <DrawnCheck size={54} />
        </div>
        <span className="absolute end-6 top-1 rounded-full bg-white px-2 py-0.5 text-xs font-bold text-[var(--c3)] shadow">{done}/{done}</span>
      </div>
    </div>
  );
}

/** The percent's font size: as large as fits inside the ring's hole (about 62% of its width) for that many characters. */
function ringFont(size: number, text: string): number {
  const hole = size * 0.62;
  return Math.max(10, Math.min(Math.round(size * 0.22), Math.floor(hole / (text.length * 0.62))));
}

/** A ring with marks at 25, 50 and 75 percent; fills from the previous milestone to this one. */
export function ProgressRing({ percent, from = 0, size = 104, still, label, light = true }: { percent: number; from?: number; size?: number; still: boolean; label: string; light?: boolean }) {
  const r = 42;
  const c = 2 * Math.PI * r;
  const shown = useCountUp(Math.min(100, Math.round(percent)), still, 1300, 200);
  const off = (p: number) => c * (1 - Math.min(100, p) / 100);
  const track = light ? 'rgba(255,255,255,0.25)' : 'color-mix(in srgb, var(--c1) 18%, transparent)';
  const fill = light ? '#fff' : 'var(--c1)';
  return (
    // shrink-0: inside a flex row the ring keeps its size, so the label always fits inside it.
    <div className="relative shrink-0" style={{ width: size, height: size }} aria-hidden data-progress-ring>
      <svg viewBox="0 0 100 100" className="size-full -rotate-90">
        <circle cx="50" cy="50" r={r} fill="none" stroke={track} strokeWidth="9" />
        <circle
          className="sfc-ring-fill"
          cx="50" cy="50" r={r} fill="none" stroke={fill} strokeWidth="9" strokeLinecap="round" strokeDasharray={c}
          strokeDashoffset={off(percent)}
          style={{ ['--sfc-from' as string]: `${off(from)}`, ['--sfc-to' as string]: `${off(percent)}` }}
        />
        {[25, 50, 75].map((m) => {
          const a = (m / 100) * Math.PI * 2;
          return <circle key={m} cx={50 + Math.cos(a) * r} cy={50 + Math.sin(a) * r} r="2.4" fill={percent >= m ? (light ? 'var(--c3)' : '#fff') : track} />;
        })}
        {percent >= 100 && (
          <g className="sfc-ray" stroke={light ? '#fff' : 'var(--c1)'} strokeWidth="3" strokeLinecap="round">
            {Array.from({ length: 12 }, (_, i) => {
              const a = (i / 12) * Math.PI * 2;
              return <line key={i} x1={50 + Math.cos(a) * 49} y1={50 + Math.sin(a) * 49} x2={50 + Math.cos(a) * 56} y2={50 + Math.sin(a) * 56} />;
            })}
          </g>
        )}
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div className="max-w-[62%]">
          <div data-ring-percent className={`font-extrabold tabular-nums leading-none ${light ? 'text-white' : 'sfc-accent'}`} style={{ fontSize: ringFont(size, `${shown}%`) }}>{shown}%</div>
          <div className={`mt-0.5 max-w-full truncate font-semibold uppercase tracking-wide ${light ? 'text-white/85' : 'text-muted-foreground'}`} style={{ fontSize: Math.max(9, Math.min(11, Math.round(size * 0.11))) }}>{label}</div>
        </div>
      </div>
    </div>
  );
}

function Gauge({ percent }: { percent: number }) {
  // -90deg is empty, +90deg is the target; beyond the target the needle stops just past it.
  const angle = -90 + Math.min(1.08, percent / 100) * 180;
  return (
    <svg viewBox="0 0 240 124" className="h-[112px] w-full" aria-hidden>
      <path d="M 24 112 A 96 96 0 0 1 216 112" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="14" strokeLinecap="round" />
      <path className="sfc-arc-fill" d="M 24 112 A 96 96 0 0 1 216 112" fill="none" stroke="url(#sfc-gold)" strokeWidth="14" strokeLinecap="round" />
      <defs>
        <linearGradient id="sfc-gold" x1="0" x2="1">
          <stop offset="0" stopColor="#fde68a" />
          <stop offset="1" stopColor="#fff" />
        </linearGradient>
      </defs>
      {Array.from({ length: 11 }, (_, i) => {
        const a = Math.PI + (i / 10) * Math.PI;
        return <line key={i} x1={120 + Math.cos(a) * 78} y1={112 + Math.sin(a) * 78} x2={120 + Math.cos(a) * (i % 5 === 0 ? 66 : 72)} y2={112 + Math.sin(a) * (i % 5 === 0 ? 66 : 72)} stroke="rgba(255,255,255,0.7)" strokeWidth="2" />;
      })}
      <g className="sfc-needle" style={{ ['--sfc-angle' as string]: `${angle}deg` }} transform={`rotate(${angle} 120 112)`}>
        <path d="M117 112 L120 40 L123 112 Z" fill="#fff" />
      </g>
      <circle cx="120" cy="112" r="9" fill="#fff" />
      <foreignObject className="sfc-trophy" x="104" y="58" width="32" height="32"><Trophy className="size-8 text-[#fde68a] drop-shadow" /></foreignObject>
    </svg>
  );
}

function MedalScene({ count, still }: { count: number; still: boolean }) {
  const n = useCountUp(count, still, 900, 400);
  const tier = count >= 100 ? ['#fde68a', '#f59e0b'] : count >= 25 ? ['#e5e7eb', '#9ca3af'] : ['#fed7aa', '#c2410c'];
  return (
    <div className="relative mx-auto grid h-[120px] w-[160px] place-items-center" aria-hidden>
      <svg viewBox="0 0 160 160" className="sfc-sunburst absolute size-[150px] opacity-60">
        {Array.from({ length: 16 }, (_, i) => (
          <path key={i} d="M80 80 L76 0 L84 0 Z" fill="#fff" opacity={i % 2 ? 0.25 : 0.5} transform={`rotate(${i * 22.5} 80 80)`} />
        ))}
      </svg>
      <div className="sfc-medal relative">
        <svg viewBox="0 0 80 104" className="h-[110px] w-[84px]">
          <path d="M22 0 L38 40 L28 46 L10 4 Z" fill="var(--c1)" />
          <path d="M58 0 L42 40 L52 46 L70 4 Z" fill="var(--c3)" />
          <circle cx="40" cy="66" r="32" fill={tier[1]} />
          <circle cx="40" cy="66" r="26" fill={tier[0]} />
        </svg>
        <span className="absolute inset-x-0 top-[50px] text-center text-2xl font-black tabular-nums text-[var(--c3)]">{n}</span>
      </div>
    </div>
  );
}

function DiamondScene() {
  return (
    <svg viewBox="0 0 200 150" className="h-[150px] w-full" aria-hidden>
      {[[30, 30, 1], [170, 40, 2], [150, 120, 3], [40, 118, 2], [100, 14, 3]].map(([x, y, k], i) => (
        <path key={i} className={`sfc-twinkle sfc-twinkle-${k}`} d={`M${x} ${y! - 8} L${x! + 2.5} ${y! - 2.5} L${x! + 8} ${y} L${x! + 2.5} ${y! + 2.5} L${x} ${y! + 8} L${x! - 2.5} ${y! + 2.5} L${x! - 8} ${y} L${x! - 2.5} ${y! - 2.5} Z`} fill="#fff" />
      ))}
      <g className="sfc-gem">
        <polygon points="100,128 52,62 70,38 130,38 148,62" fill="url(#sfc-gem-a)" />
        <polygon points="70,38 100,62 130,38" fill="rgba(255,255,255,0.55)" />
        <polygon points="52,62 100,62 100,128" fill="rgba(255,255,255,0.18)" />
        <polygon points="148,62 100,62 100,128" fill="rgba(0,0,0,0.12)" />
        <polyline points="52,62 148,62" stroke="rgba(255,255,255,0.7)" strokeWidth="1.5" fill="none" />
      </g>
      <defs>
        <linearGradient id="sfc-gem-a" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f0abfc" />
          <stop offset="0.5" stopColor="#a78bfa" />
          <stop offset="1" stopColor="#67e8f9" />
        </linearGradient>
      </defs>
    </svg>
  );
}

function Rhythm() {
  return (
    <svg viewBox="0 0 260 96" className="h-[96px] w-full" aria-hidden>
      <g className="sfc-sun">
        <circle cx="130" cy="78" r="30" fill="rgba(255,255,255,0.9)" />
        <circle cx="130" cy="78" r="42" fill="rgba(255,255,255,0.18)" />
      </g>
      <path className="sfc-wave" d="M0 70 C 22 56, 44 56, 66 70 S 110 84, 132 70 S 176 56, 198 70 S 242 84, 264 70" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
      <rect x="0" y="80" width="260" height="16" fill="var(--c3)" opacity="0.35" />
      <foreignObject className="sfc-leaf" x="200" y="18" width="30" height="30"><Leaf className="size-7 text-[var(--c2)]" /></foreignObject>
    </svg>
  );
}

/** The decorative band of a card. */
export function SceneArt({ a, still }: { a: Pick<AchievementRow, 'kind' | 'level' | 'details'>; still: boolean }) {
  const d = a.details;
  switch (a.kind) {
    case 'DEAL_CONVERTED':
      return <DealJourney />;
    case 'PROSPECT_CONVERTED':
      return <ProspectSeed />;
    case 'RFQ_SUBMITTED':
      return <RfqFlight still={still} />;
    case 'ALL_TASKS_DONE':
      return <CleanSweep done={d.tasksDone ?? 0} />;
    case 'LEAD_TARGET':
    case 'LEAD_MILESTONE':
      return (
        <div className="grid place-items-center py-1">
          <ProgressRing percent={d.percent ?? 0} from={a.kind === 'LEAD_TARGET' ? 75 : Math.max(0, (d.percent ?? 25) - 25)} still={still} label={`${d.actual ?? 0}/${d.target ?? 0}`} />
        </div>
      );
    case 'SALES_TARGET':
      return <Gauge percent={d.percent ?? 100} />;
    case 'DEALS_WON_MILESTONE':
      return <MedalScene count={d.count ?? 1} still={still} />;
    case 'MAJOR_DEAL':
      return <DiamondScene />;
    case 'CONSISTENCY':
      return <Rhythm />;
    case 'TASK_IMPORTANT':
      return <DrawnCheck />;
  }
}

/** The small badge in a corner of the card, by level. */
export function LevelMark({ level }: { level: AchievementLevel }) {
  if (level === 'EXCEPTIONAL') return <Crown className="size-4" aria-hidden />;
  if (level === 'MAJOR') return <Trophy className="size-4" aria-hidden />;
  return <Sparkles className="size-4" aria-hidden />;
}
