import { useRef, useState } from 'react';
import { motion, useMotionValue, useSpring, useTransform, useReducedMotion } from 'framer-motion';

/** Fades and lifts children into view once. */
export function Reveal({ children, delay = 0, y = 28, className, as = 'div' }) {
  const reduce = useReducedMotion();
  const M = motion[as] ?? motion.div;
  return (
    <M
      className={className}
      initial={reduce ? false : { opacity: 0, y, filter: 'blur(6px)' }}
      whileInView={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.8, delay, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </M>
  );
}

/** Section heading: mono eyebrow, display title with optional highlighted words (wrap them in *stars*), lead text. */
export function SectionHead({ eyebrow, title, sub, align = 'center', tone = 'dark', accent = 'bolt' }) {
  const parts = String(title).split(/(\*[^*]+\*)/g);
  return (
    <div className={`section-head section-head--${align} section-head--${tone}`}>
      <Reveal>
        <span className={`eyebrow eyebrow--${accent}`}>
          <span className="eyebrow__dot" />
          {eyebrow}
        </span>
      </Reveal>
      <Reveal delay={0.05} as="h2">
        {parts.map((p, i) => (p.startsWith('*') ? <em key={i} className={`grad-text grad-text--${accent}`}>{p.slice(1, -1)}</em> : <span key={i}>{p}</span>))}
      </Reveal>
      {sub && (
        <Reveal delay={0.1} as="p">
          {sub}
        </Reveal>
      )}
    </div>
  );
}

/** Card that tilts toward the pointer in 3D and paints a soft spotlight under it. */
export function TiltCard({ children, className = '', max = 8, style, ...rest }) {
  const ref = useRef(null);
  const reduce = useReducedMotion();
  const mx = useMotionValue(0.5);
  const my = useMotionValue(0.5);
  const rx = useSpring(useTransform(my, [0, 1], [max, -max]), { stiffness: 200, damping: 20 });
  const ry = useSpring(useTransform(mx, [0, 1], [-max, max]), { stiffness: 200, damping: 20 });
  function onMove(e) {
    const r = ref.current.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    mx.set(x);
    my.set(y);
    ref.current.style.setProperty('--mx', `${x * 100}%`);
    ref.current.style.setProperty('--my', `${y * 100}%`);
  }
  function onLeave() { mx.set(0.5); my.set(0.5); }
  return (
    <motion.div
      ref={ref}
      className={`tilt ${className}`}
      onPointerMove={reduce ? undefined : onMove}
      onPointerLeave={onLeave}
      style={reduce ? style : { ...style, rotateX: rx, rotateY: ry, transformPerspective: 1100 }}
      {...rest}
    >
      {children}
    </motion.div>
  );
}

/** A screenshot in a minimal app-window frame. */
export function Shot({ src, alt, className = '', label, eager = false }) {
  return (
    <figure className={`shot ${className}`}>
      <div className="shot__bar" aria-hidden="true">
        <i /><i /><i />
        {label && <span>{label}</span>}
      </div>
      <img src={src} alt={alt} loading={eager ? 'eager' : 'lazy'} decoding="async" />
    </figure>
  );
}

/** Button that is pulled slightly toward the pointer. */
export function Magnetic({ children, href, variant = 'primary', className = '', ...rest }) {
  const ref = useRef(null);
  const reduce = useReducedMotion();
  const x = useSpring(0, { stiffness: 250, damping: 15 });
  const y = useSpring(0, { stiffness: 250, damping: 15 });
  function onMove(e) {
    const r = ref.current.getBoundingClientRect();
    x.set((e.clientX - (r.left + r.width / 2)) * 0.25);
    y.set((e.clientY - (r.top + r.height / 2)) * 0.35);
  }
  return (
    <motion.a
      ref={ref}
      href={href}
      className={`btn btn--${variant} ${className}`}
      style={reduce ? undefined : { x, y }}
      onPointerMove={reduce ? undefined : onMove}
      onPointerLeave={() => { x.set(0); y.set(0); }}
      {...rest}
    >
      <span className="btn__shine" aria-hidden="true" />
      {children}
    </motion.a>
  );
}

/** Counts up to a number when scrolled into view. */
export function CountUp({ value, prefix = '', suffix = '', duration = 1.6 }) {
  const [shown, setShown] = useState(0);
  const reduce = useReducedMotion();
  return (
    <motion.span
      onViewportEnter={() => {
        if (reduce) return setShown(value);
        const start = performance.now();
        const tick = (now) => {
          const p = Math.min((now - start) / (duration * 1000), 1);
          setShown(Math.round(value * (1 - Math.pow(1 - p, 3))));
          if (p < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }}
      viewport={{ once: true }}
    >
      {prefix}
      {shown.toLocaleString('en-US')}
      {suffix}
    </motion.span>
  );
}
