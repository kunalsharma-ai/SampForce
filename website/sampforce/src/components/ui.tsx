import { animate, motion, useInView, useMotionValue, useSpring, useTransform } from 'framer-motion';
import { type ReactNode, useEffect, useRef, useState } from 'react';

/** Fades and lifts its children into view once. */
export function Reveal({ children, delay = 0, y = 40, className }: { children: ReactNode; delay?: number; y?: number; className?: string }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y, filter: 'blur(8px)' }}
      whileInView={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
      viewport={{ once: true, margin: '-80px' }}
      transition={{ duration: 0.9, delay, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </motion.div>
  );
}

/**
 * Splits a heading into words that rise from a mask one after another. The wrapper is what is observed: a word
 * pushed fully below its mask is clipped, and the browser would never report it as in view.
 */
export function SplitWords({ text, className, delay = 0 }: { text: string; className?: string; delay?: number }) {
  const words = text.split(' ');
  return (
    <motion.span className={className} aria-label={text} role="text" initial="hidden" whileInView="show" viewport={{ once: true, margin: '-60px' }}>
      {words.map((w, i) => (
        <span key={i} className="mask" aria-hidden>
          <motion.span
            style={{ display: 'inline-block' }}
            variants={{ hidden: { y: '110%', rotate: 4 }, show: { y: '0%', rotate: 0 } }}
            transition={{ duration: 0.9, delay: delay + i * 0.06, ease: [0.16, 1, 0.3, 1] }}
          >
            {w}
          </motion.span>
          {i < words.length - 1 ? '\u00a0' : ''}
        </span>
      ))}
    </motion.span>
  );
}

/** Counts up to a number when it scrolls into view. */
export function Counter({ to, prefix = '', suffix = '' }: { to: number; prefix?: string; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const [v, setV] = useState(0);
  useEffect(() => {
    if (!inView) return;
    const c = animate(0, to, { duration: 1.8, ease: [0.16, 1, 0.3, 1], onUpdate: (x) => setV(Math.round(x)) });
    return () => c.stop();
  }, [inView, to]);
  return (
    <span ref={ref}>
      {prefix}
      {v.toLocaleString('en-US')}
      {suffix}
    </span>
  );
}

/** A card that tilts towards the pointer in 3D and lights up where the pointer is. */
export function Tilt({ children, className, max = 10 }: { children: ReactNode; className?: string; max?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const mx = useMotionValue(0.5);
  const my = useMotionValue(0.5);
  const rx = useSpring(useTransform(my, [0, 1], [max, -max]), { stiffness: 160, damping: 18 });
  const ry = useSpring(useTransform(mx, [0, 1], [-max, max]), { stiffness: 160, damping: 18 });
  const glowX = useTransform(mx, (v) => `${v * 100}%`);
  const glowY = useTransform(my, (v) => `${v * 100}%`);
  return (
    <motion.div
      ref={ref}
      className={`tilt ${className ?? ''}`}
      style={{ rotateX: rx, rotateY: ry, transformPerspective: 1000, ['--gx' as string]: glowX, ['--gy' as string]: glowY }}
      onPointerMove={(e) => {
        const r = ref.current!.getBoundingClientRect();
        mx.set((e.clientX - r.left) / r.width);
        my.set((e.clientY - r.top) / r.height);
      }}
      onPointerLeave={() => {
        mx.set(0.5);
        my.set(0.5);
      }}
    >
      {children}
    </motion.div>
  );
}

/** A screenshot in a browser window. */
export function Frame({ src, alt, url = 'app.sampforce.com', className, eager }: { src: string; alt: string; url?: string; className?: string; eager?: boolean }) {
  return (
    <div className={`frame ${className ?? ''}`}>
      <div className="frame-bar">
        <i />
        <i />
        <i />
        <span>{url}</span>
      </div>
      <img src={src} alt={alt} loading={eager ? 'eager' : 'lazy'} decoding="async" width={1920} height={1200} />
    </div>
  );
}

/** The SampForce mark (static) and wordmark. */
export function LogoMark({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="-4 -1 66 66" aria-hidden>
      <defs>
        <linearGradient id="lm-a" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#FFC857" /><stop offset="1" stopColor="#E02424" /></linearGradient>
        <linearGradient id="lm-b" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#E02424" /><stop offset="1" stopColor="#7F1D1D" /></linearGradient>
        <linearGradient id="lm-h" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fff" stopOpacity=".55" /><stop offset=".55" stopColor="#fff" stopOpacity="0" /></linearGradient>
      </defs>
      <g className="lm-streaks">
        <rect x="1" y="19" width="10" height="3.4" rx="1.7" fill="url(#lm-a)" />
        <rect x="-2" y="27.5" width="8" height="3.4" rx="1.7" fill="url(#lm-a)" />
        <rect x="2" y="47" width="9" height="3.4" rx="1.7" fill="url(#lm-b)" />
      </g>
      <polygon points="41,2 13,37.5 31.5,37.5 36.5,27" fill="url(#lm-a)" />
      <polygon points="41,2 13,37.5 31.5,37.5 36.5,27" fill="url(#lm-h)" />
      <polygon points="33,27 53,27 24,62 29.5,37.5" fill="url(#lm-b)" />
      <polygon points="33,27 53,27 24,62 29.5,37.5" fill="url(#lm-h)" opacity=".5" />
      <path className="lm-spark" d="M55 4C55.6 7.4 55.6 7.4 59 8C55.6 8.6 55.6 8.6 55 12C54.4 8.6 54.4 8.6 51 8C54.4 7.4 54.4 7.4 55 4Z" fill="#FFC857" />
    </svg>
  );
}

export function Wordmark({ size = 34 }: { size?: number }) {
  return (
    <span className="wordmark" translate="no">
      <LogoMark size={size} />
      <span className="wm-text">
        <span className="wm-name"><span className="wm-samp">Samp</span><span className="wm-force">Force</span></span>
        <span className="wm-by">by Sampledge</span>
      </span>
    </span>
  );
}

export const Arrow = () => (
  <svg className="arrow" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);

export const Check = ({ color = 'currentColor' }: { color?: string }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </svg>
);
