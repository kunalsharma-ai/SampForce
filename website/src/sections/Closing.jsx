import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { site } from '../content/site.js';
import { iconStatic, logoOnDark } from '../content/media.js';
import { CountUp, Magnetic, Reveal, SectionHead, TiltCard } from '../components/ui.jsx';
import { Icon } from '../components/Icon.jsx';

export function Numbers() {
  return (
    <section className="numbers" aria-label="SampForce in numbers">
      <div className="numbers__grid">
      {site.numbers.map((n, i) => (
        <Reveal key={n.label} delay={i * 0.06} className="numbers__item">
          <strong className="grad-text grad-text--bolt">
            <CountUp value={n.value} prefix={n.prefix} suffix={n.suffix} />
          </strong>
          <span>{n.label}</span>
        </Reveal>
      ))}
      </div>
    </section>
  );
}

export function Pricing() {
  const p = site.pricing;
  const [annual, setAnnual] = useState(true);
  return (
    <section className="pricing" id="pricing">
      <SectionHead eyebrow={p.eyebrow} title={p.title} sub={p.sub} accent="gold" />
      <div className="pricing__toggle" role="radiogroup" aria-label="Billing period">
        <button role="radio" aria-checked={!annual} className={!annual ? 'is-on' : ''} onClick={() => setAnnual(false)}>
          Monthly
        </button>
        <button role="radio" aria-checked={annual} className={annual ? 'is-on' : ''} onClick={() => setAnnual(true)}>
          Annual <span>save up to 25%</span>
        </button>
        <motion.span className="pricing__pill" layout transition={{ type: 'spring', stiffness: 300, damping: 30 }} style={{ left: annual ? '50%' : '4px' }} aria-hidden="true" />
      </div>
      <div className="plans">
        {p.plans.map((plan, i) => {
          const price = annual ? plan.annual : plan.monthly;
          return (
            <Reveal key={plan.name} delay={(i % 3) * 0.06} className="plans__cell">
              <TiltCard className={`plan ${plan.featured ? 'plan--featured' : ''}`} max={4}>
                {plan.featured && <span className="plan__badge">Most popular</span>}
                <h3>{plan.name}</h3>
                <p className="plan__target">{plan.target}</p>
                <div className="plan__price">
                  <span className="plan__currency">$</span>
                  <AnimatePresence mode="popLayout" initial={false}>
                    <motion.span key={price} className="plan__amount" initial={{ y: 24, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -24, opacity: 0 }}>
                      {price}
                    </motion.span>
                  </AnimatePresence>
                  <span className="plan__per">/ user / mo</span>
                </div>
                <ul>
                  <li><Icon name="spark" size={15} /> <b>{plan.ai}</b> AI credits / seat</li>
                  <li><Icon name="switch" size={15} /> <b>{plan.runs}</b> automation runs</li>
                  <li><Icon name="arrow" size={15} /> <b>{plan.pipelines}</b> pipelines</li>
                  <li><Icon name="shield" size={15} /> SSO + SCIM included</li>
                </ul>
                <a className={`btn ${plan.featured ? 'btn--primary' : 'btn--ghost'} btn--block`} href={site.links.demo}>
                  <span className="btn__shine" aria-hidden="true" />
                  {plan.monthly === 0 ? 'Start free' : 'Get started'}
                </a>
              </TiltCard>
            </Reveal>
          );
        })}
      </div>
      <Reveal className="plans__custom">
        <div>
          <strong>{p.custom.name}</strong>
          <span>{p.custom.text}</span>
        </div>
        <a className="btn btn--ghost" href={site.links.contact}>
          <span className="btn__shine" aria-hidden="true" />
          Talk to sales <Icon name="arrow" size={16} />
        </a>
      </Reveal>
      <p className="pricing__foot">{p.footnote}</p>
    </section>
  );
}

const TRUST_ICONS = ['lock', 'key', 'shield', 'log', 'key', 'eye'];

export function Trust() {
  const t = site.trust;
  return (
    <section className="trust">
      <SectionHead eyebrow={t.eyebrow} title={t.title} accent="volt" />
      <div className="trust__grid">
        {t.items.map((it, i) => (
          <Reveal key={it.title} delay={(i % 3) * 0.06} className="trust__item">
            <span className="trust__icon">
              <Icon name={TRUST_ICONS[i]} size={22} />
            </span>
            <h3>{it.title}</h3>
            <p>{it.text}</p>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

export function FinalCta() {
  const c = site.cta;
  return (
    <section className="final">
      <div className="final__burst" aria-hidden="true">
        {Array.from({ length: 14 }).map((_, i) => (
          <span key={i} style={{ '--i': i }} />
        ))}
      </div>
      <Reveal className="final__icon">
        <img src={iconStatic} alt="" />
      </Reveal>
      <Reveal as="h2">
        <span className="grad-text grad-text--bolt">{c.title}</span>
      </Reveal>
      <Reveal as="p" delay={0.05}>
        {c.sub}
      </Reveal>
      <Reveal className="final__ctas" delay={0.1}>
        <Magnetic href={site.links.demo}>
          {c.primary} <Icon name="arrow" size={18} />
        </Magnetic>
        <Magnetic href={site.links.contact} variant="ghost">
          {c.secondary}
        </Magnetic>
      </Reveal>
    </section>
  );
}

export function Footer() {
  return (
    <footer className="footer">
      <div className="footer__top">
        <img src={logoOnDark} alt={`${site.brand.name} by ${site.brand.owner}`} width="220" height="59" />
        <nav aria-label="Footer">
          {site.nav.map((l) => (
            <a key={l.href} href={l.href}>
              {l.label}
            </a>
          ))}
          <a href={site.links.privacy}>Privacy</a>
          <a href={site.links.terms}>Terms</a>
        </nav>
      </div>
      <p className="footer__note">{site.footer.note}</p>
      <p className="footer__copy">
        © {new Date().getFullYear()} <a href={site.links.sampledge}>{site.brand.owner}</a>.
      </p>
    </footer>
  );
}
