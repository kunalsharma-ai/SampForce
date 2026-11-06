import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { site } from '../content/site.js';
import { media } from '../content/media.js';
import { SectionHead } from '../components/ui.jsx';
import { Icon } from '../components/Icon.jsx';

/**
 * 3D carousel: screenshots stand on a ring that spins slowly. Drag to spin, click a screen to open it full size.
 * Filter chips limit the ring to one product area.
 */
export function Tour() {
  const t = site.tour;
  const reduce = useReducedMotion();
  const groups = useMemo(() => ['All', ...new Set(t.shots.map((s) => s.group))], [t.shots]);
  const [group, setGroup] = useState('All');
  const shots = group === 'All' ? t.shots : t.shots.filter((s) => s.group === group);
  const [open, setOpen] = useState(null);
  const ring = useRef(null);
  const angle = useRef(0);
  const vel = useRef(reduce ? 0 : 0.08);
  const drag = useRef(null);
  const moved = useRef(false);

  useEffect(() => {
    let raf;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (!drag.current) vel.current += ((reduce ? 0 : 0.08) - vel.current) * 0.02;
      angle.current += vel.current;
      if (ring.current) ring.current.style.transform = `translateZ(calc(var(--radius) * -1)) rotateX(-2deg) rotateY(${angle.current}deg)`;
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [reduce]);

  useEffect(() => {
    if (open === null) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(null);
      if (e.key === 'ArrowRight') setOpen((o) => (o + 1) % shots.length);
      if (e.key === 'ArrowLeft') setOpen((o) => (o - 1 + shots.length) % shots.length);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, shots.length]);

  const n = shots.length;
  const step = 360 / n;
  // Ring radius grows with the number of panels so they never overlap.
  const radius = `max(${Math.round(n * 52)}px, calc(var(--panel-w) * ${(n / (2 * Math.PI)).toFixed(2)} * 1.15))`;

  return (
    <section className="tour" id="tour">
      <SectionHead eyebrow={t.eyebrow} title={t.title} sub={t.sub} accent="volt" />
      <div className="tour__chips" role="tablist" aria-label="Filter screens">
        {groups.map((g) => (
          <button key={g} role="tab" aria-selected={g === group} className={g === group ? 'is-on' : ''} onClick={() => { setGroup(g); angle.current = 0; }}>
            {g}
          </button>
        ))}
      </div>
      <div
        className="tour__scene"
        style={{ '--radius': radius }}
        onPointerDown={(e) => { drag.current = { x: e.clientX }; moved.current = false; }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          const dx = e.clientX - drag.current.x;
          if (Math.abs(dx) > 3) moved.current = true;
          vel.current = dx * 0.12;
          drag.current.x = e.clientX;
        }}
        onPointerUp={() => { drag.current = null; }}
        onPointerLeave={() => { drag.current = null; }}
      >
        <div className="tour__ring" ref={ring} aria-hidden="true">
          {shots.map((s, i) => (
            <button
              key={s.media}
              className="tour__panel"
              style={{ transform: `rotateY(${i * step}deg) translateZ(var(--radius))` }}
              onClick={() => { if (!moved.current) setOpen(i); }}
              tabIndex={-1}
            >
              <img src={media(s.media)} alt="" loading="lazy" draggable="false" />
              <span>{s.title}</span>
            </button>
          ))}
        </div>
        <div className="tour__floor" aria-hidden="true" />
      </div>

      <ul className="tour__list" aria-label="All screens">
        {shots.map((s, i) => (
          <li key={s.media}>
            <button onClick={() => setOpen(i)} aria-label={`Open ${s.title}`}>
              <img src={media(s.media)} alt="" loading="lazy" />
              <span>{s.title}</span>
            </button>
          </li>
        ))}
      </ul>

      <AnimatePresence>
        {open !== null && (
          <motion.div className="lightbox" role="dialog" aria-modal="true" aria-label={shots[open].title} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setOpen(null)}>
            <motion.figure key={open} initial={{ scale: 0.92, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 200, damping: 22 }} onClick={(e) => e.stopPropagation()}>
              <img src={media(shots[open].media)} alt={`${shots[open].title} screen in SampForce`} />
              <figcaption>
                <span className="lightbox__group">{shots[open].group}</span> {shots[open].title}
                <small>Demo workspace with synthetic data</small>
              </figcaption>
            </motion.figure>
            <button className="lightbox__close" onClick={() => setOpen(null)} aria-label="Close">
              <Icon name="close" size={22} />
            </button>
            <button className="lightbox__nav lightbox__nav--l" onClick={(e) => { e.stopPropagation(); setOpen((o) => (o - 1 + n) % n); }} aria-label="Previous screen">
              <Icon name="chevronL" size={26} />
            </button>
            <button className="lightbox__nav lightbox__nav--r" onClick={(e) => { e.stopPropagation(); setOpen((o) => (o + 1) % n); }} aria-label="Next screen">
              <Icon name="chevron" size={26} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
