'use client';

import { useEffect, useRef } from 'react';

export type ConfettiStyle = 'ribbons' | 'light' | 'gold' | 'sparks' | 'stars';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vr: number;
  size: number;
  color: string;
  shape: 'rect' | 'circle' | 'ribbon' | 'star';
  life: number;
  wobble: number;
}

const SETTINGS: Record<ConfettiStyle, { count: number; shapes: Particle['shape'][]; gravity: number; spread: number; speed: number; ms: number }> = {
  ribbons: { count: 140, shapes: ['ribbon', 'rect', 'circle'], gravity: 0.16, spread: 1.15, speed: 11, ms: 3200 },
  light: { count: 60, shapes: ['rect', 'circle'], gravity: 0.14, spread: 0.9, speed: 8, ms: 2400 },
  gold: { count: 170, shapes: ['rect', 'ribbon', 'star'], gravity: 0.15, spread: 1.3, speed: 12, ms: 3600 },
  sparks: { count: 90, shapes: ['circle'], gravity: 0.05, spread: 6.28, speed: 7, ms: 1800 },
  stars: { count: 120, shapes: ['star', 'circle'], gravity: 0.03, spread: 6.28, speed: 6, ms: 4200 },
};

function drawStar(ctx: CanvasRenderingContext2D, r: number) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = (Math.PI / 5) * i;
    const rr = i % 2 ? r * 0.45 : r;
    ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
}

/**
 * One burst of confetti on a canvas over the page that never takes a click. `origin` is where it starts, in parts of
 * the viewport (0.5, 0.85 is just above the middle of the bottom edge). It stops by itself and frees the canvas.
 */
export function Confetti({ style, colors, origin = { x: 0.5, y: 0.8 } }: { style: ConfettiStyle; colors: string[]; origin?: { x: number; y: number } }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const cfg = SETTINGS[style];
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const resize = () => {
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);
    // Fewer pieces on small screens keeps phones smooth.
    const count = Math.round(cfg.count * Math.min(1, window.innerWidth / 1100) + 20);
    const ox = window.innerWidth * origin.x;
    const oy = window.innerHeight * origin.y;
    const parts: Particle[] = Array.from({ length: count }, () => {
      const radial = cfg.spread > 3;
      const angle = radial ? Math.random() * Math.PI * 2 : -Math.PI / 2 + (Math.random() - 0.5) * cfg.spread;
      const speed = cfg.speed * (0.45 + Math.random() * 0.75);
      return {
        x: ox + (Math.random() - 0.5) * 40,
        y: oy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.3,
        size: 4 + Math.random() * 6,
        color: colors[Math.floor(Math.random() * colors.length)]!,
        shape: cfg.shapes[Math.floor(Math.random() * cfg.shapes.length)]!,
        life: 1,
        wobble: Math.random() * 10,
      };
    });
    const started = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const elapsed = now - started;
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      for (const p of parts) {
        p.vy += cfg.gravity;
        p.vx *= 0.985;
        p.vy *= 0.985;
        p.x += p.vx + Math.sin((elapsed / 300) + p.wobble) * 0.6;
        p.y += p.vy;
        p.rot += p.vr;
        p.life = Math.max(0, 1 - elapsed / cfg.ms);
        ctx.save();
        ctx.globalAlpha = Math.min(1, p.life * 1.6);
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        if (p.shape === 'circle') {
          ctx.beginPath();
          ctx.arc(0, 0, p.size / 2.4, 0, Math.PI * 2);
          ctx.fill();
        } else if (p.shape === 'ribbon') {
          ctx.scale(1, Math.cos(elapsed / 120 + p.wobble));
          ctx.fillRect(-p.size, -p.size / 5, p.size * 2, p.size / 2.5);
        } else if (p.shape === 'star') {
          drawStar(ctx, p.size / 1.6);
        } else {
          ctx.fillRect(-p.size / 2, -p.size / 3, p.size, p.size / 1.5);
        }
        ctx.restore();
      }
      if (elapsed < cfg.ms) frame = requestAnimationFrame(tick);
      else ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', resize);
    };
  }, [style, colors, origin.x, origin.y]);
  return <canvas ref={ref} aria-hidden className="pointer-events-none fixed inset-0 z-[75] size-full" data-confetti={style} />;
}
