'use client';

import { useEffect, useRef } from 'react';
import type { SiteMode } from './site-theme';

/** The palette each mode paints with, as [r, g, b]. */
const COLOURS: Record<SiteMode, { ribbons: [number, number, number][]; star: [number, number, number]; alpha: number }> = {
  dark: { ribbons: [[162, 123, 255], [255, 92, 172], [64, 226, 255], [196, 255, 92]], star: [226, 220, 255], alpha: 0.2 },
  light: { ribbons: [[124, 58, 237], [219, 39, 119], [8, 145, 178], [132, 204, 22]], star: [76, 29, 149], alpha: 0.11 },
};

interface Star {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  tw: number;
}

/** How many stars a viewport gets: dense enough to form constellations, sparse on phones. */
export function starCount(width: number, height: number): number {
  return Math.max(24, Math.min(110, Math.round((width * height) / 16000)));
}

/**
 * The living sky behind the website (ADR 0078): aurora ribbons that drift and fold, and a field of stars that join
 * into constellations near each other and lean towards the pointer. Decorative only. It draws one still frame for
 * people who ask for less motion, and pauses while the tab is hidden.
 */
export function AuroraCanvas({ mode }: { mode: SiteMode }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const still =
      matchMedia('(prefers-reduced-motion: reduce)').matches && document.documentElement.dataset.motion !== 'full'
        ? true
        : document.documentElement.dataset.motion === 'off';
    const palette = COLOURS[mode];
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let w = 0;
    let h = 0;
    let stars: Star[] = [];
    const pointer = { x: -9999, y: -9999 };

    const resize = () => {
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const n = starCount(w, h);
      stars = Array.from({ length: n }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.18,
        vy: (Math.random() - 0.5) * 0.18,
        r: Math.random() * 1.4 + 0.4,
        tw: Math.random() * Math.PI * 2,
      }));
    };

    const ribbon = (t: number, i: number) => {
      const [r, g, b] = palette.ribbons[i % palette.ribbons.length]!;
      const baseY = h * (0.18 + i * 0.2);
      const amp = h * (0.07 + 0.03 * Math.sin(t * 0.0002 + i));
      const grad = ctx.createLinearGradient(0, baseY - amp * 2, 0, baseY + amp * 3);
      grad.addColorStop(0, `rgba(${r},${g},${b},0)`);
      grad.addColorStop(0.45, `rgba(${r},${g},${b},${palette.alpha})`);
      grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
      ctx.beginPath();
      ctx.moveTo(0, h);
      for (let x = 0; x <= w + 20; x += 20) {
        const y = baseY + Math.sin(x * 0.0026 + t * 0.00042 * (1 + i * 0.25) + i * 1.7) * amp + Math.sin(x * 0.0061 - t * 0.0003 + i) * amp * 0.35;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(w, h);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();
    };

    const draw = (t: number) => {
      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = mode === 'dark' ? 'lighter' : 'source-over';
      for (let i = 0; i < 4; i++) ribbon(t, i);
      ctx.globalCompositeOperation = 'source-over';
      const [sr, sg, sb] = palette.star;
      const linkDist = Math.min(150, w / 8);
      for (let i = 0; i < stars.length; i++) {
        const s = stars[i]!;
        if (!still) {
          const dx = pointer.x - s.x;
          const dy = pointer.y - s.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < 180 * 180) {
            s.vx += dx * 0.000012;
            s.vy += dy * 0.000012;
          }
          s.vx *= 0.995;
          s.vy *= 0.995;
          s.x += s.vx + Math.sign(s.vx) * 0.02;
          s.y += s.vy;
          if (s.x < -20) s.x = w + 20;
          if (s.x > w + 20) s.x = -20;
          if (s.y < -20) s.y = h + 20;
          if (s.y > h + 20) s.y = -20;
        }
        const twinkle = 0.55 + 0.45 * Math.sin(t * 0.002 + s.tw);
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${sr},${sg},${sb},${(mode === 'dark' ? 0.85 : 0.5) * twinkle})`;
        ctx.fill();
        for (let j = i + 1; j < stars.length; j++) {
          const o = stars[j]!;
          const dx = s.x - o.x;
          const dy = s.y - o.y;
          const d = Math.hypot(dx, dy);
          if (d < linkDist) {
            const near = Math.hypot(pointer.x - s.x, pointer.y - s.y) < 200 ? 2.2 : 1;
            ctx.strokeStyle = `rgba(${sr},${sg},${sb},${(1 - d / linkDist) * (mode === 'dark' ? 0.16 : 0.12) * near})`;
            ctx.lineWidth = 0.7;
            ctx.beginPath();
            ctx.moveTo(s.x, s.y);
            ctx.lineTo(o.x, o.y);
            ctx.stroke();
          }
        }
      }
    };

    resize();
    let frame = 0;
    const loop = (t: number) => {
      draw(t);
      frame = requestAnimationFrame(loop);
    };
    const start = () => {
      cancelAnimationFrame(frame);
      if (still) draw(4000);
      else frame = requestAnimationFrame(loop);
    };
    const onVisibility = () => (document.hidden ? cancelAnimationFrame(frame) : start());
    const onMove = (e: PointerEvent) => {
      pointer.x = e.clientX;
      pointer.y = e.clientY;
    };
    const onResize = () => {
      resize();
      if (still) draw(4000);
    };
    start();
    window.addEventListener('resize', onResize);
    window.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('pointermove', onMove);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [mode]);

  return <canvas ref={ref} aria-hidden data-site-sky={mode} className="pointer-events-none fixed inset-0 -z-10 h-full w-full" />;
}
