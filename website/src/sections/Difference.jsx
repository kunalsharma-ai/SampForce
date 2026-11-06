import { useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { site } from '../content/site.js';
import { SectionHead, Reveal } from '../components/ui.jsx';
import { Icon } from '../components/Icon.jsx';

function FlipCard({ card, index }) {
  const [flipped, setFlipped] = useState(false);
  return (
    <Reveal delay={(index % 3) * 0.07} className="flip-wrap">
      <button
        type="button"
        className={`flip ${flipped ? 'is-flipped' : ''}`}
        onClick={() => setFlipped((f) => !f)}
        aria-pressed={flipped}
        aria-label={`${card.title}. ${flipped ? 'Showing the SampForce way' : 'Showing what is common in the market'}. Press to flip.`}
      >
        <span className="flip__inner">
          <span className="flip__face flip__face--front">
            <span className="flip__tag">Often in the market</span>
            <span className="flip__num">{String(index + 1).padStart(2, '0')}</span>
            <strong>{card.title}</strong>
            <span className="flip__text">{card.market}</span>
            <span className="flip__cta">
              <Icon name="flip" size={16} /> Flip to see our way
            </span>
          </span>
          <span className="flip__face flip__face--back">
            <span className="flip__tag flip__tag--us">
              <Icon name="bolt" size={13} /> The SampForce way
            </span>
            <strong>{card.title}</strong>
            <span className="flip__text">{card.us}</span>
            <span className="flip__cta">
              <Icon name="flip" size={16} /> Flip back
            </span>
          </span>
        </span>
      </button>
    </Reveal>
  );
}

function PriceChart({ chart }) {
  const reduce = useReducedMotion();
  const max = Math.max(...chart.rows.map((r) => r.price));
  return (
    <Reveal className="prices">
      <div className="prices__head">
        <h3>{chart.title}</h3>
        <span className="prices__unit">USD</span>
      </div>
      <ul>
        {chart.rows.map((r, i) => (
          <li key={r.name} className={r.us ? 'is-us' : ''}>
            <span className="prices__name">{r.name}</span>
            <span className="prices__bar">
              <motion.span
                initial={reduce ? false : { width: 0 }}
                whileInView={{ width: `${Math.max(6, (r.price / max) * 100)}%` }}
                viewport={{ once: true }}
                transition={{ duration: 1.1, delay: 0.1 + i * 0.06, ease: [0.16, 1, 0.3, 1] }}
                style={reduce ? { width: `${Math.max(6, (r.price / max) * 100)}%` } : undefined}
              />
            </span>
            <span className="prices__val">${r.price}</span>
          </li>
        ))}
      </ul>
      <p className="prices__note">{chart.note}</p>
    </Reveal>
  );
}

export function Difference() {
  const d = site.difference;
  return (
    <section className="difference" id="difference">
      <div className="difference__paper" aria-hidden="true" />
      <SectionHead eyebrow={d.eyebrow} title={d.title} sub={d.sub} tone="light" accent="bolt" />
      <div className="flips">
        {d.cards.map((c, i) => (
          <FlipCard key={c.title} card={c} index={i} />
        ))}
      </div>
      {site.showCompetitorPrices && <PriceChart chart={d.priceChart} />}
    </section>
  );
}
