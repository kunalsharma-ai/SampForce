import { useRef, useState } from 'react';
import { motion, AnimatePresence, useScroll, useMotionValueEvent, useReducedMotion } from 'framer-motion';
import { site } from '../content/site.js';
import { media } from '../content/media.js';
import { SectionHead } from '../components/ui.jsx';
import { Icon } from '../components/Icon.jsx';

/**
 * Sticky scroll story: the left column lists the six stages, the right column pins a screen that changes
 * as each stage scrolls past. A lightning "current" fills along the stage rail.
 */
export function Journey() {
  const j = site.journey;
  const ref = useRef(null);
  const [active, setActive] = useState(0);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start 60%', 'end 70%'] });
  useMotionValueEvent(scrollYProgress, 'change', (v) => {
    setActive(Math.min(j.stages.length - 1, Math.max(0, Math.floor(v * j.stages.length))));
  });
  const stage = j.stages[active];

  return (
    <section className="journey" id="journey">
      <SectionHead eyebrow={j.eyebrow} title={j.title} sub={j.sub} accent="volt" />
      <div className="journey__body" ref={ref}>
        <ol className="journey__steps">
          <motion.span className="journey__current" style={{ scaleY: scrollYProgress }} aria-hidden="true" />
          {j.stages.map((s, i) => (
            <li key={s.key} className={`journey__step tone-${s.color} ${i === active ? 'is-active' : ''} ${i < active ? 'is-done' : ''}`}>
              <span className="journey__node" aria-hidden="true">
                <span>{String(i + 1).padStart(2, '0')}</span>
              </span>
              <div className="journey__text">
                <span className="journey__label">{s.label}</span>
                <h3>{s.title}</h3>
                <p>{s.text}</p>
                <ul>
                  {s.points.map((p) => (
                    <li key={p}>
                      <Icon name="check" size={14} /> {p}
                    </li>
                  ))}
                </ul>
                <img className="journey__inline-shot" src={media(s.media)} alt={`${s.label}: ${s.title}`} loading="lazy" />
              </div>
            </li>
          ))}
        </ol>
        <div className="journey__stage" aria-hidden="true">
          <div className={`journey__frame tone-${stage.color}`}>
            <div className="journey__halo" />
            <div className="shot">
              <div className="shot__bar">
                <i /><i /><i />
                <span>{stage.label}</span>
              </div>
              <div className="journey__screens">
                <AnimatePresence mode="popLayout" initial={false}>
                  <motion.img
                    key={stage.key}
                    src={media(stage.media)}
                    alt=""
                    initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 1.06, filter: 'blur(10px)', clipPath: 'inset(0 0 100% 0)' }}
                    animate={{ opacity: 1, scale: 1, filter: 'blur(0px)', clipPath: 'inset(0 0 0% 0)' }}
                    exit={{ opacity: 0, scale: 0.98 }}
                    transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
                  />
                </AnimatePresence>
              </div>
            </div>
            <div className="journey__dots">
              {j.stages.map((s, i) => (
                <span key={s.key} className={i === active ? 'on' : ''} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
