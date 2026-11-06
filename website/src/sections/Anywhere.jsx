import { motion, useReducedMotion, useScroll, useTransform } from 'framer-motion';
import { useRef } from 'react';
import { site } from '../content/site.js';
import { media } from '../content/media.js';
import { SectionHead, Reveal } from '../components/ui.jsx';
import { Icon } from '../components/Icon.jsx';

const ICONS = ['palette', 'contrast', 'phone', 'eye'];

export function Anywhere() {
  const a = site.anywhere;
  const ref = useRef(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] });
  const split = useTransform(scrollYProgress, [0.15, 0.55], ['0%', '100%']);
  const phoneY = useTransform(scrollYProgress, [0, 1], [120, -120]);
  const phone2Y = useTransform(scrollYProgress, [0, 1], [200, -60]);

  return (
    <section className="anywhere" ref={ref}>
      <SectionHead eyebrow={a.eyebrow} title={a.title} sub={a.sub} accent="rose" />
      <div className="anywhere__stage">
        <div className="anywhere__compare">
          <img src={media('command-light')} alt="Command Center in the light theme" loading="lazy" />
          <motion.div className="anywhere__dark" style={reduce ? { width: '50%' } : { width: split }}>
            <img src={media('command')} alt="Command Center in the dark theme" loading="lazy" />
          </motion.div>
          <motion.span className="anywhere__handle" style={reduce ? { left: '50%' } : { left: split }} aria-hidden="true">
            <Icon name="contrast" size={16} />
          </motion.span>
          <span className="anywhere__tag anywhere__tag--l">Dark</span>
          <span className="anywhere__tag anywhere__tag--r">Light</span>
        </div>
        <motion.img className="anywhere__phone anywhere__phone--1" src={media('mobile-command')} alt="SampForce Command Center on a phone" loading="lazy" style={reduce ? undefined : { y: phoneY }} />
        <motion.img className="anywhere__phone anywhere__phone--2" src={media('mobile-deals')} alt="SampForce deals board on a phone" loading="lazy" style={reduce ? undefined : { y: phone2Y }} />
      </div>
      <ul className="anywhere__points">
        {a.points.map((p, i) => (
          <Reveal as="li" key={p} delay={i * 0.06}>
            <Icon name={ICONS[i % ICONS.length]} size={20} />
            {p}
          </Reveal>
        ))}
      </ul>
      <Reveal className="anywhere__studio">
        <img src={media('theme-studio')} alt="Theme Studio with twelve themes, custom brand colours and a readability check" loading="lazy" />
      </Reveal>
    </section>
  );
}
