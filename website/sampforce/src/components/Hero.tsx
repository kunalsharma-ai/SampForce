import { motion, useReducedMotion, useScroll, useTransform } from 'framer-motion';
import { useRef } from 'react';
import { hero, links, marquee, screens, stats } from '../content';
import { HeroScene } from './HeroScene';
import { Arrow, Counter, Frame } from './ui';

const tones: Record<string, string> = { amber: 'var(--amber)', cyan: 'var(--cyan)', violet: 'var(--violet)', coral: 'var(--coral)' };
const wordClass = ['w-sell', 'w-close', 'w-grow'];

export function Hero() {
  const reduced = !!useReducedMotion();
  const showcase = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: showcase, offset: ['start end', 'center center'] });
  const rotateX = useTransform(scrollYProgress, [0, 1], [38, 0]);
  const scale = useTransform(scrollYProgress, [0, 1], [0.82, 1]);
  const y = useTransform(scrollYProgress, [0, 1], [80, 0]);

  return (
    <>
      <section className="hero grain" id="top">
        <div className="aurora">
          <b style={{ width: 620, height: 620, left: '-10%', top: '-20%', background: '#2f6bff' }} />
          <b style={{ width: 520, height: 520, right: '-8%', top: '10%', background: '#e02424', animationDelay: '-6s' }} />
          <b style={{ width: 420, height: 420, left: '35%', bottom: '-25%', background: '#8057ff', animationDelay: '-12s' }} />
        </div>
        <HeroScene reduced={reduced} />
        <div className="hero-grid" aria-hidden />

        <div className="wrap hero-inner">
          <motion.a
            href="#loop"
            className="chip hero-eyebrow"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.1 }}
          >
            <span className="dot" /> {hero.eyebrow} <Arrow />
          </motion.a>

          <h1 className="h-xl hero-title">
            {hero.words.map((w, i) => (
              <span className="mask" key={w}>
                <motion.span
                  className={`hero-word ${wordClass[i]}`}
                  initial={{ y: '115%', rotateX: -60, opacity: 0 }}
                  animate={{ y: '0%', rotateX: 0, opacity: 1 }}
                  transition={{ duration: 1.1, delay: 0.25 + i * 0.16, ease: [0.16, 1, 0.3, 1] }}
                >
                  {w}
                </motion.span>
              </span>
            ))}
          </h1>

          <motion.p className="lead hero-sub" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.9, delay: 0.85 }}>
            {hero.sub}
          </motion.p>

          <motion.div className="hero-ctas" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.9, delay: 1 }}>
            <a className="btn btn-force" href={links.signup}>
              {hero.primary} <Arrow />
            </a>
            <a className="btn" href="#loop">
              <span className="play" aria-hidden>▶</span> {hero.secondary}
            </a>
          </motion.div>
          <motion.ul className="hero-micro" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.3 }}>
            {hero.micro.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </motion.ul>

          <div className="hero-floats" aria-hidden>
            {hero.floating.map((f, i) => (
              <motion.div
                key={f.k}
                className={`glass float-card fc-${i}`}
                style={{ ['--tone' as string]: tones[f.tone] }}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1, y: reduced ? 0 : [0, -10, 0] }}
                transition={{ opacity: { delay: 1.2 + i * 0.15 }, scale: { delay: 1.2 + i * 0.15 }, y: { duration: 5 + i, repeat: Infinity, ease: 'easeInOut' } }}
              >
                <span className="fc-k">{f.k}</span>
                <span className="fc-v">{f.v}</span>
              </motion.div>
            ))}
          </div>
        </div>

        <a href="#showcase" className="scroll-cue" aria-label="Scroll to the product">
          <span />
        </a>
      </section>

      <section className="showcase" id="showcase" ref={showcase}>
        <div className="wrap">
          <motion.div className="showcase-stage" style={reduced ? undefined : { rotateX, scale, y, transformPerspective: 1400 }}>
            <div className="showcase-glow" aria-hidden />
            <Frame src={screens.commandDark} alt="SampForce Command Center with next best actions and a weekly summary" eager />
            <motion.div className="glass annot a1" initial={{ opacity: 0, x: -30 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ delay: 0.4 }}>
              <b>Next best actions</b>
              <span>Ranked from replies, tasks, health and renewals</span>
            </motion.div>
            <motion.div className="glass annot a2" initial={{ opacity: 0, x: 30 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ delay: 0.6 }}>
              <b>Every KPI explains itself</b>
              <span>Hover a number to see its formula</span>
            </motion.div>
            <motion.div className="phone" initial={{ opacity: 0, y: 60 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: 0.5, duration: 1 }}>
              <img src={screens.mobileCommand} alt="SampForce on a phone" loading="lazy" />
            </motion.div>
          </motion.div>
        </div>

        <div className="marquee" aria-label="What SampForce covers">
          {[0, 1].map((k) => (
            <div className="marquee-track" key={k} aria-hidden={k === 1}>
              {marquee.map((m, i) => (
                <span key={m} className={`mq mq-${i % 4}`}>
                  {m}
                  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
                    <path d="M13 2 4 14h7l-1 8 9-12h-7z" fill="currentColor" />
                  </svg>
                </span>
              ))}
            </div>
          ))}
        </div>

        <div className="wrap stats">
          {stats.map((s) => (
            <div className="stat" key={s.label}>
              <span className="stat-v">
                <Counter to={s.value} prefix={s.prefix} suffix={s.suffix} />
              </span>
              <span className="stat-l">{s.label}</span>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
