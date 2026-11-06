import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion, useScroll, useTransform, AnimatePresence } from 'framer-motion';
import { site } from '../content/site.js';
import { media } from '../content/media.js';
import { Magnetic, TiltCard } from '../components/ui.jsx';
import { Icon } from '../components/Icon.jsx';
import { createHeroField } from '../three/heroField.js';

function supportsWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

const word = {
  hidden: { y: '110%', rotate: 6 },
  show: (i) => ({ y: '0%', rotate: 0, transition: { delay: 0.15 + i * 0.09, duration: 0.9, ease: [0.16, 1, 0.3, 1] } }),
};

export function Hero() {
  const h = site.hero;
  const canvasRef = useRef(null);
  const sectionRef = useRef(null);
  const reduce = useReducedMotion();
  const [webgl, setWebgl] = useState(true);
  const [cycle, setCycle] = useState(0);
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    if (!supportsWebGL()) { setWebgl(false); return undefined; }
    const field = createHeroField(canvasRef.current, { reducedMotion: !!reduce, onPhase: setPhase });
    return () => field.dispose();
  }, [reduce]);

  useEffect(() => {
    if (reduce) return undefined;
    const id = setInterval(() => setCycle((c) => (c + 1) % h.cycle.length), 1700);
    return () => clearInterval(id);
  }, [reduce, h.cycle.length]);

  const { scrollYProgress } = useScroll({ target: sectionRef, offset: ['start start', 'end start'] });
  const shotY = useTransform(scrollYProgress, [0, 1], [0, -140]);
  const shotRot = useTransform(scrollYProgress, [0, 1], [18, 0]);
  const fade = useTransform(scrollYProgress, [0, 0.8], [1, 0]);

  return (
    <section className="hero" id="top" ref={sectionRef}>
      <div className="hero__bg" aria-hidden="true">
        <div className="hero__aurora" />
        <div className="hero__grid" />
        {webgl ? <canvas ref={canvasRef} className="hero__canvas" /> : <div className="hero__fallback" />}
        <div className="hero__vignette" />
      </div>

      <motion.div className="hero__content" style={{ opacity: fade }}>
        <motion.a
          href="#journey"
          className="hero__kicker"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.05 }}
        >
          <span className="hero__kicker-badge">
            <Icon name="bolt" size={14} /> New
          </span>
          {h.kicker}
          <Icon name="arrow" size={14} />
        </motion.a>

        <h1 className="hero__title">
          <span className="line">
            <motion.span custom={0} variants={word} initial={reduce ? false : 'hidden'} animate="show">
              {h.titleTop}
            </motion.span>
          </span>
          <span className="line">
            <motion.span custom={1} variants={word} initial={reduce ? false : 'hidden'} animate="show" className="hero__accent">
              {h.titleAccent}
              <svg className="hero__zap" viewBox="0 0 400 24" preserveAspectRatio="none" aria-hidden="true">
                <path d="M2 14 L60 10 L80 18 L130 6 L150 16 L210 8 L232 18 L290 7 L312 15 L398 9" />
              </svg>
            </motion.span>
          </span>
        </h1>

        <motion.p className="hero__sub" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5, duration: 0.8 }}>
          {h.sub}
        </motion.p>

        <motion.div className="hero__cycle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.7 }} aria-label={h.cycle.join(', ')}>
          {h.cycle.map((c, i) => (
            <span key={c} className={i === cycle ? 'is-on' : i < cycle ? 'is-past' : ''}>
              {c}
              {i < h.cycle.length - 1 && <i aria-hidden="true" />}
            </span>
          ))}
        </motion.div>

        <motion.div className="hero__ctas" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.8, duration: 0.7 }}>
          <Magnetic href={site.links.demo}>
            {h.primaryCta} <Icon name="arrow" size={18} />
          </Magnetic>
          <Magnetic href="#tour" variant="ghost">
            <Icon name="play" size={16} /> {h.secondaryCta}
          </Magnetic>
        </motion.div>

        <motion.ul className="hero__proof" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1 }}>
          {h.proof.map((p) => (
            <li key={p}>
              <Icon name="check" size={15} /> {p}
            </li>
          ))}
        </motion.ul>

        <div className="hero__phase" aria-hidden="true">
          <span className={phase < 1 || phase === 3 ? 'on' : ''}>Leads</span>
          <i />
          <span className={phase === 1 || phase === 2 ? 'on' : ''}>Momentum</span>
        </div>
      </motion.div>

      <motion.div className="hero__stage" style={reduce ? undefined : { y: shotY, rotateX: shotRot }}>
        <TiltCard className="hero__screen" max={5}>
          <div className="hero__screen-glow" aria-hidden="true" />
          <div className="shot shot--hero">
            <div className="shot__bar" aria-hidden="true">
              <i /><i /><i />
              <span>app.sampforce.com · Command Center</span>
            </div>
            <img src={media('command')} alt="SampForce Command Center with next best actions and weekly summary" fetchpriority="high" />
          </div>
          <AnimatePresence>
            {h.pulses.map((p, i) => (
              <motion.div
                key={p.title}
                className={`pulse pulse--${i} pulse--${p.tone}`}
                initial={{ opacity: 0, scale: 0.8, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                transition={{ delay: 1.1 + i * 0.25, type: 'spring', stiffness: 160, damping: 16 }}
              >
                <span className="pulse__icon">
                  <Icon name={p.icon} size={16} />
                </span>
                <span>
                  <strong>{p.title}</strong>
                  <small>{p.meta}</small>
                </span>
              </motion.div>
            ))}
          </AnimatePresence>
        </TiltCard>
      </motion.div>

      <a href="#journey" className="hero__scroll" aria-label="Scroll to the platform overview">
        <span />
      </a>
    </section>
  );
}
