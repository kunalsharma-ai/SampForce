import { AnimatePresence, motion, useMotionValueEvent, useScroll, useSpring } from 'framer-motion';
import { useRef, useState } from 'react';
import { loop } from '../content';
import { Check, Frame, Reveal, SplitWords } from './ui';

/** Sticky scroll story: four stages of the revenue loop, the screenshot and ring change as you scroll. */
export function ForceLoop() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end end'] });
  const progress = useSpring(scrollYProgress, { stiffness: 120, damping: 24 });
  const [active, setActive] = useState(0);
  useMotionValueEvent(scrollYProgress, 'change', (v) => setActive(Math.min(loop.length - 1, Math.max(0, Math.floor(v * loop.length)))));
  const stage = loop[active];

  return (
    <section className="loop" id="loop">
      <div className="wrap loop-head">
        <Reveal>
          <span className="eyebrow">The Force Loop</span>
        </Reveal>
        <h2 className="h-lg">
          <SplitWords text="One platform." /> <span className="serif t-cool"><SplitWords text="Every stage" delay={0.2} /></span>{' '}
          <SplitWords text="of revenue." delay={0.35} />
        </h2>
        <Reveal delay={0.2}>
          <p className="lead">Capture, engage, close and grow without switching tools, syncing hubs or paying for a second product.</p>
        </Reveal>
      </div>

      <div className="loop-track" ref={ref} style={{ height: `${loop.length * 100}vh` }}>
        <div className="loop-sticky">
          <div className="wrap loop-grid">
            <div className="loop-left">
              <div className="loop-ring" aria-hidden>
                <svg viewBox="0 0 120 120">
                  <defs>
                    <linearGradient id="ring-g" x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0" stopColor="#22d3ee" />
                      <stop offset=".5" stopColor="#8057ff" />
                      <stop offset="1" stopColor="#ffc857" />
                    </linearGradient>
                  </defs>
                  <circle cx="60" cy="60" r="52" className="ring-bg" />
                  <motion.circle cx="60" cy="60" r="52" className="ring-fg" style={{ pathLength: progress }} />
                </svg>
                <span className="ring-num" style={{ color: stage.color }}>{stage.step}</span>
              </div>
              <ol className="loop-steps">
                {loop.map((s, i) => (
                  <li key={s.key} className={i === active ? 'on' : ''} style={{ ['--c' as string]: s.color }}>
                    <span className="ls-n">{s.step}</span>
                    <span className="ls-t">{s.title}</span>
                  </li>
                ))}
              </ol>
              <AnimatePresence mode="wait">
                <motion.div
                  key={stage.key}
                  initial={{ opacity: 0, y: 24 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -24 }}
                  transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
                >
                  <h3 className="h-md" style={{ color: stage.color }}>{stage.head}</h3>
                  <p className="loop-body">{stage.body}</p>
                  <ul className="loop-points">
                    {stage.points.map((p) => (
                      <li key={p}>
                        <Check color={stage.color} /> {p}
                      </li>
                    ))}
                  </ul>
                </motion.div>
              </AnimatePresence>
            </div>
            <div className="loop-right">
              <AnimatePresence mode="popLayout">
                <motion.div
                  key={stage.key}
                  className="loop-shot"
                  initial={{ opacity: 0, rotateY: -18, x: 80, scale: 0.92 }}
                  animate={{ opacity: 1, rotateY: -6, x: 0, scale: 1 }}
                  exit={{ opacity: 0, rotateY: 10, x: -60, scale: 0.94 }}
                  transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
                  style={{ ['--c' as string]: stage.color, transformPerspective: 1600 }}
                >
                  <Frame src={stage.image} alt={`SampForce: ${stage.title}`} />
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
