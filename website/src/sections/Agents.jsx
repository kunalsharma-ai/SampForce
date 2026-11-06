import { useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { site } from '../content/site.js';
import { media, iconStatic } from '../content/media.js';
import { SectionHead, Reveal, Shot } from '../components/ui.jsx';
import { Icon } from '../components/Icon.jsx';

const GUARD_ICONS = ['key', 'check', 'coins', 'log', 'switch', 'eye'];

/** Ten agents orbit the SampForce core. Hover or tap one to read what it does. */
export function Agents() {
  const a = site.agents;
  const [active, setActive] = useState(0);
  const reduce = useReducedMotion();
  const n = a.list.length;

  return (
    <section className="agents" id="agents">
      <SectionHead eyebrow={a.eyebrow} title={a.title} sub={a.sub} accent="plasma" />
      <div className="agents__wrap">
        <div className={`orbit ${reduce ? 'orbit--still' : ''}`}>
          <div className="orbit__rings" aria-hidden="true">
            <span /><span /><span />
          </div>
          <div className="orbit__core">
            <img src={iconStatic} alt="" />
            <AnimatePresence mode="wait">
              <motion.div
                key={active}
                className="orbit__readout"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.25 }}
                aria-live="polite"
              >
                <strong>{a.list[active].name}</strong>
                <span>{a.list[active].text}</span>
              </motion.div>
            </AnimatePresence>
          </div>
          <ul className="orbit__track" style={{ '--n': n }}>
            {a.list.map((ag, i) => (
              <li key={ag.name} style={{ '--i': i }}>
                <button
                  type="button"
                  className={`orbit__agent ${i === active ? 'is-active' : ''}`}
                  onPointerEnter={() => setActive(i)}
                  onFocus={() => setActive(i)}
                  onClick={() => setActive(i)}
                  aria-pressed={i === active}
                >
                  <Icon name="bot" size={16} />
                  <span>{ag.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div className="agents__side">
          <Reveal>
            <Shot src={media('agents')} alt="AI Agents page with provider status, credits and workspace controls" label="AI agents · controls" />
          </Reveal>
          <ul className="guards">
            {a.guardrails.map((g, i) => (
              <Reveal as="li" key={g} delay={i * 0.05}>
                <span className="guards__icon">
                  <Icon name={GUARD_ICONS[i % GUARD_ICONS.length]} size={18} />
                </span>
                {g}
              </Reveal>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
