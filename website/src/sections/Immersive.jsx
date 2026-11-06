import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion, useScroll, useTransform } from 'framer-motion';
import { site } from '../content/site.js';
import { media } from '../content/media.js';
import { SectionHead } from '../components/ui.jsx';
import { createGlobe } from '../three/globe.js';

export function Immersive() {
  const s = site.immersive;
  const canvasRef = useRef(null);
  const ref = useRef(null);
  const reduce = useReducedMotion();
  const [ok, setOk] = useState(true);

  useEffect(() => {
    let g;
    try {
      g = createGlobe(canvasRef.current, { reducedMotion: !!reduce });
    } catch {
      setOk(false);
    }
    return () => g?.dispose();
  }, [reduce]);

  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] });
  const y1 = useTransform(scrollYProgress, [0, 1], [80, -80]);
  const y2 = useTransform(scrollYProgress, [0, 1], [140, -120]);
  const r1 = useTransform(scrollYProgress, [0, 1], [-10, -4]);
  const r2 = useTransform(scrollYProgress, [0, 1], [10, 4]);

  return (
    <section className="immersive" id="immersive" ref={ref}>
      <div className="immersive__glow" aria-hidden="true" />
      <SectionHead eyebrow={s.eyebrow} title={s.title} sub={s.sub} accent="mint" />
      <div className="immersive__stage">
        <motion.figure className="immersive__card immersive__card--l" style={reduce ? undefined : { y: y1, rotate: r1 }}>
          <img src={media('galaxy')} alt="Relationship Galaxy: companies, people and deals as a 3D network" loading="lazy" />
          <figcaption>Relationship Galaxy</figcaption>
        </motion.figure>
        <div className="immersive__globe">
          {ok ? <canvas ref={canvasRef} aria-label="Interactive globe showing deals flowing between cities. Drag to spin." role="img" /> : <img src={media('globe')} alt="Revenue Globe" />}
          <span className="immersive__hint">Drag to spin</span>
        </div>
        <motion.figure className="immersive__card immersive__card--r" style={reduce ? undefined : { y: y2, rotate: r2 }}>
          <img src={media('replay')} alt="Pipeline replay: deals as dots moving through stages over time" loading="lazy" />
          <figcaption>Pipeline replay</figcaption>
        </motion.figure>
      </div>
      <dl className="immersive__stats">
        {s.stats.map((st) => (
          <div key={st.label}>
            <dt>{st.value}</dt>
            <dd>{st.label}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
