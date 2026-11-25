'use client';

import { Bot, FileSignature, GitBranch, HeartHandshake, KanbanSquare, LineChart, Megaphone, ShieldCheck } from 'lucide-react';
import { motion, useMotionValue, useSpring, useTransform } from 'motion/react';
import type { CSSProperties } from 'react';
import { LogoMark } from '@/components/logo';
import { Tr } from '@/lib/i18n';

/** The eight modules on the hero's orbits: the same ones the page describes below, nothing invented. */
const INNER = [
  { icon: KanbanSquare, label: 'Core CRM' },
  { icon: Bot, label: 'Revenue Copilot' },
  { icon: LineChart, label: 'Revenue intelligence' },
];
const OUTER = [
  { icon: GitBranch, label: 'Automation Studio' },
  { icon: FileSignature, label: 'Quotes and contracts' },
  { icon: Megaphone, label: 'Marketing' },
  { icon: HeartHandshake, label: 'Customer success' },
  { icon: ShieldCheck, label: 'Built for teams' },
];

/** Spiral paths the deals travel along into the core (in a 520×520 box centred on the core). */
const COMETS = [
  { path: "path('M 250 -10 C 520 40, 470 330, 260 260 S 255 255, 0 0')", delay: '0s', dur: '5s' },
  { path: "path('M -240 120 C -300 -200, 60 -260, 40 -40 S 5 0, 0 0')", delay: '1.7s', dur: '5s' },
  { path: "path('M 40 260 C -260 300, -320 -60, -60 10 S -4 2, 0 0')", delay: '3.3s', dur: '5s' },
];

/** Jagged arcs leaving the core in six directions; each flickers in turn. */
const ARCS = [
  'M 0 -40 L 8 -55 L -4 -64 L 6 -80',
  'M 36 -20 L 52 -22 L 58 -36 L 76 -38',
  'M 36 22 L 50 34 L 66 30 L 74 46',
  'M 0 42 L -9 56 L 4 66 L -5 82',
  'M -36 20 L -52 26 L -58 42 L -76 44',
  'M -36 -22 L -50 -32 L -66 -28 L -76 -46',
];

function Ring({ size, dur, reverse, solid, items }: { size: number; dur: string; reverse?: boolean; solid?: boolean; items: typeof INNER }) {
  return (
    <div
      className="sfx-ring absolute left-1/2 top-1/2 rounded-full"
      data-solid={solid || undefined}
      style={{ width: size, height: size, marginLeft: -size / 2, marginTop: -size / 2, '--dur': dur, '--dir': reverse ? 'reverse' : 'normal' } as CSSProperties}
    >
      {items.map((item, i) => (
        <div key={item.label} className="sfx-rider" style={{ '--a': `${(360 / items.length) * i}deg` } as CSSProperties}>
          {/* Turns back as fast as the ring turns forward, so the chip always reads level. */}
          <div
            className="sfx-chip sfx-chip-spin flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1.5 text-xs font-semibold text-foreground"
            style={{ '--dur': dur, '--rdir': reverse ? 'normal' : 'reverse' } as CSSProperties}
          >
            <item.icon className="size-3.5 text-primary" aria-hidden />
            <Tr text={item.label} />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * The hero's revenue orbit: SampForce's core with the modules circling it on two rings, and deals spiralling in to
 * land as wins. Decorative; the same modules are listed in text further down. Tilts towards the pointer.
 */
export function HeroOrbit() {
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const rx = useSpring(useTransform(my, [-1, 1], [16, -6]), { stiffness: 80, damping: 18 });
  const ry = useSpring(useTransform(mx, [-1, 1], [-14, 14]), { stiffness: 80, damping: 18 });

  return (
    <div
      aria-hidden
      data-hero-orbit=""
      className="sfx-orbit-stage relative mx-auto mt-6 aspect-square w-full max-w-[540px] select-none lg:mt-0"
      onPointerMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        mx.set(((e.clientX - r.left) / r.width) * 2 - 1);
        my.set(((e.clientY - r.top) / r.height) * 2 - 1);
      }}
      onPointerLeave={() => {
        mx.set(0);
        my.set(0);
      }}
    >
      <motion.div className="sfx-orbit-plane absolute inset-0 scale-[0.68] sm:scale-90 lg:scale-100" style={{ rotateX: rx, rotateY: ry }}>
        <Ring size={300} dur="26s" items={INNER} solid />
        <Ring size={490} dur="48s" reverse items={OUTER} />
        {/* The core. */}
        <div className="absolute left-1/2 top-1/2 -ml-12 -mt-12 size-24">
          <div className="sfx-core-pulse absolute inset-0 rounded-full" />
          <div className="sfx-core-pulse absolute inset-0 rounded-full [animation-delay:1.5s]" />
          {/* Electric arcs crackling off the core. */}
          <svg viewBox="-100 -100 200 200" className="sfx-arcs pointer-events-none absolute -inset-16 overflow-visible">
            {ARCS.map((d, i) => (
              <path key={d} d={d} className="sfx-arc" style={{ '--i': i } as CSSProperties} />
            ))}
          </svg>
          {/* The SampForce bolt itself at the centre, on a glowing ember core. */}
          <div className="sfx-core grid size-full place-items-center rounded-full">
            <span className="sf-logo-anim">
              <LogoMark className="size-14 drop-shadow-[0_0_14px_rgba(255,200,87,0.85)]" />
            </span>
          </div>
        </div>
        {/* Deals arriving. */}
        <div className="absolute left-1/2 top-1/2 size-0">
          {COMETS.map((c) => (
            <span key={c.delay} className="sfx-comet" style={{ '--path': c.path, '--delay': c.delay, '--dur': c.dur } as CSSProperties} />
          ))}
          {COMETS.map((c) => (
            <span
              key={`won-${c.delay}`}
              className="sfx-won absolute -top-24 left-0 whitespace-nowrap rounded-full bg-success px-2.5 py-1 text-[11px] font-bold text-background"
              style={{ '--delay': c.delay } as CSSProperties}
            >
              <Tr text="Won" /> ✦
            </span>
          ))}
        </div>
      </motion.div>
    </div>
  );
}
