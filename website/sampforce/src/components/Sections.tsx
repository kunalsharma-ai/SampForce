import { AnimatePresence, motion, useReducedMotion, useScroll, useTransform } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import {
  ai, features, finalCta, immersive, integrationList, languages, links, mobile, nav, plans, pricingNote, security,
  showNamedComparison, why,
} from '../content';
import { Arrow, Check, LogoMark, Reveal, SplitWords, Tilt, Wordmark } from './ui';

/* ------------------------------------------------------------------ nav */
export function Nav() {
  const [solid, setSolid] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const on = () => setSolid(window.scrollY > 40);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);
  const { scrollYProgress } = useScroll();
  return (
    <header className={`nav ${solid ? 'solid' : ''} ${open ? 'open' : ''}`}>
      <motion.div className="nav-progress" style={{ scaleX: scrollYProgress }} aria-hidden />
      <div className="wrap nav-inner">
        <a href="#top" aria-label="SampForce home">
          <Wordmark size={30} />
        </a>
        <nav aria-label="Page sections">
          <ul>
            {nav.map((n) => (
              <li key={n.href}>
                <a href={n.href} onClick={() => setOpen(false)}>{n.label}</a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="nav-cta">
          <a href={links.login} className="nav-login">Sign in</a>
          <a href={links.signup} className="btn btn-force btn-sm">Start free <Arrow /></a>
          <button className="burger" aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open} onClick={() => setOpen(!open)}>
            <span /><span />
          </button>
        </div>
      </div>
    </header>
  );
}

/* ------------------------------------------------------------------ features bento */
export function Features() {
  return (
    <section className="section features" id="features">
      <div className="wrap">
        <div className="sec-head">
          <Reveal><span className="eyebrow">What is in the box</span></Reveal>
          <h2 className="h-lg">
            <SplitWords text="Built for the whole" /> <span className="t-force"><SplitWords text="revenue team." delay={0.25} /></span>
          </h2>
          <Reveal delay={0.15}><p className="lead">Every screen below is the real product, captured from a SampForce workspace filled with sample data.</p></Reveal>
        </div>
        <div className="bento">
          {features.map((f, i) => (
            <Reveal key={f.title} delay={(i % 3) * 0.08} className={`bento-cell b-${f.size}`}>
              <Tilt className="bento-card" max={6}>
                <div className="bento-text">
                  <span className="bento-tag">{f.tag}</span>
                  <h3>{f.title}</h3>
                  <p>{f.body}</p>
                </div>
                <div className="bento-img">
                  <img src={f.image} alt={`SampForce ${f.title}`} loading="lazy" decoding="async" />
                </div>
              </Tilt>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ AI */
export function AiSection() {
  const reduced = useReducedMotion();
  const [step, setStep] = useState(reduced ? ai.chat.length : 0);
  const [approved, setApproved] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const [started, setStarted] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setStarted(true), { threshold: 0.4 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    if (!started || reduced) return;
    if (step >= ai.chat.length) {
      const t = setTimeout(() => setApproved(true), 1400);
      const r = setTimeout(() => { setStep(0); setApproved(false); }, 7000);
      return () => { clearTimeout(t); clearTimeout(r); };
    }
    const t = setTimeout(() => setStep((s) => s + 1), step === 0 ? 400 : 1500);
    return () => clearTimeout(t);
  }, [started, step, reduced]);

  return (
    <section className="section ai grain" id="ai">
      <div className="aurora">
        <b style={{ width: 700, height: 700, left: '-15%', top: '10%', background: '#8057ff' }} />
        <b style={{ width: 500, height: 500, right: '-10%', bottom: '0%', background: '#00d9ff', animationDelay: '-8s' }} />
      </div>
      <div className="wrap ai-grid">
        <div>
          <Reveal><span className="eyebrow">Responsible AI, built in</span></Reveal>
          <h2 className="h-lg">
            <SplitWords text={ai.title} /> <span className="serif t-spectrum"><SplitWords text={ai.accent} delay={0.3} /></span>
          </h2>
          <Reveal delay={0.2}><p className="lead">{ai.body}</p></Reveal>
          <div className="ai-pillars">
            {ai.pillars.map((p, i) => (
              <Reveal key={p.t} delay={0.1 * i} className="ai-pillar">
                <b>{p.t}</b>
                <span>{p.d}</span>
              </Reveal>
            ))}
          </div>
        </div>

        <div className="ai-demo" ref={ref}>
          <div className="orbit" aria-hidden>
            {ai.agents.map((a, i) => (
              <span key={a} className="orbit-chip" style={{ ['--i' as string]: i, ['--n' as string]: ai.agents.length }}>
                <span>{a}</span>
              </span>
            ))}
          </div>
          <div className="glass chat" role="img" aria-label="Example: SampForce Copilot finds deals at risk and asks for approval before changing them">
            <div className="chat-head">
              <LogoMark size={22} /> <b>SampForce Copilot</b> <span className="chip chip-xs"><span className="dot" /> reads with your permissions</span>
            </div>
            <div className="chat-body">
              <AnimatePresence>
                {ai.chat.slice(0, step).map((m) => (
                  <motion.div key={m.text} className={`msg msg-${m.who}`} initial={{ opacity: 0, y: 14, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.45 }}>
                    {m.who === 'tool' && <span className="msg-label">Tool call · read only · ran at once</span>}
                    {m.who === 'approve' ? (
                      <div className={`approve ${approved ? 'done' : ''}`}>
                        <span className="msg-label">Needs your approval · changes data</span>
                        <div className="approve-row">
                          <span>{m.text}</span>
                          <span className="approve-btn">{approved ? <><Check /> Approved</> : 'Approve'}</span>
                        </div>
                      </div>
                    ) : (
                      <p>{m.text}</p>
                    )}
                  </motion.div>
                ))}
              </AnimatePresence>
              {step < ai.chat.length && step > 0 && (
                <div className="typing" aria-hidden><i /><i /><i /></div>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ immersive 3D carousel */
export function Immersive() {
  const reduced = useReducedMotion();
  const [i, setI] = useState(0);
  const n = immersive.length;
  useEffect(() => {
    if (reduced) return;
    const t = setInterval(() => setI((x) => (x + 1) % n), 4200);
    return () => clearInterval(t);
  }, [n, reduced]);
  const cur = immersive[i];
  return (
    <section className="section immersive">
      <div className="wrap sec-head center">
        <Reveal><span className="eyebrow">Immersive analytics</span></Reveal>
        <h2 className="h-lg">
          <SplitWords text="See your revenue" /> <span className="serif t-force"><SplitWords text="in three dimensions." delay={0.25} /></span>
        </h2>
      </div>
      <div className="carousel" aria-roledescription="carousel" aria-label="Immersive report views">
        <div className="carousel-ring" style={{ transform: `translateZ(calc(var(--rz) * -1)) rotateY(${(-360 / n) * i}deg)` }}>
          {immersive.map((v, k) => (
            <figure key={v.title} className={`carousel-item ${k === i ? 'on' : ''}`} style={{ transform: `rotateY(${(360 / n) * k}deg) translateZ(var(--rz))` }} aria-hidden={k !== i}>
              <img src={v.image} alt={v.title} loading="lazy" />
            </figure>
          ))}
        </div>
      </div>
      <div className="wrap carousel-caption">
        <AnimatePresence mode="wait">
          <motion.div key={cur.title} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
            <h3>{cur.title}</h3>
            <p>{cur.body}</p>
          </motion.div>
        </AnimatePresence>
        <div className="carousel-dots" role="tablist">
          {immersive.map((v, k) => (
            <button key={v.title} role="tab" aria-selected={k === i} aria-label={v.title} className={k === i ? 'on' : ''} onClick={() => setI(k)} />
          ))}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ why us */
export function Why() {
  return (
    <section className="section why" id="why">
      <div className="why-bg" aria-hidden />
      <div className="wrap">
        <div className="sec-head">
          <Reveal><span className="eyebrow eyebrow-dark">Why SampForce</span></Reveal>
          <h2 className="h-lg">
            <SplitWords text={why.title} />
          </h2>
          <Reveal delay={0.15}><p className="lead">{why.sub}</p></Reveal>
        </div>
        <div className="why-grid">
          {why.pillars.map((p, i) => (
            <Reveal key={p.t} delay={(i % 3) * 0.08}>
              <Tilt className="why-card" max={7}>
                <span className="why-big">{p.big}</span>
                <b>{p.t}</b>
                <p>{p.d}</p>
              </Tilt>
            </Reveal>
          ))}
        </div>

        {showNamedComparison && (
          <Reveal className="compare">
            <div className="compare-head">
              <span />
              <span className="compare-us"><LogoMark size={22} /> SampForce</span>
              <span>What another vendor’s pricing page states</span>
            </div>
            {why.comparison.map((r) => (
              <div className="compare-row" key={r.topic}>
                <span className="compare-topic">{r.topic}</span>
                <span className="compare-us-cell"><Check color="#e02424" /> {r.us}</span>
                <span className="compare-them">{r.them}</span>
              </div>
            ))}
            <p className="compare-src">{why.source}</p>
          </Reveal>
        )}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ everywhere (mobile + languages) */
export function Everywhere() {
  const [lang, setLang] = useState(0);
  const reduced = useReducedMotion();
  useEffect(() => {
    if (reduced) return;
    const t = setInterval(() => setLang((l) => (l + 1) % languages.length), 2200);
    return () => clearInterval(t);
  }, [reduced]);
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] });
  const y1 = useTransform(scrollYProgress, [0, 1], [80, -80]);
  const y2 = useTransform(scrollYProgress, [0, 1], [-40, 60]);
  const l = languages[lang];
  return (
    <section className="section everywhere" ref={ref}>
      <div className="wrap ev-grid">
        <div className="ev-phones" aria-hidden>
          <motion.div className="phone p1" style={reduced ? undefined : { y: y1 }}><img src={mobile.mobileCommand} alt="" loading="lazy" /></motion.div>
          <motion.div className="phone p2" style={reduced ? undefined : { y: y2 }}><img src={mobile.mobileDeals} alt="" loading="lazy" /></motion.div>
        </div>
        <div>
          <Reveal><span className="eyebrow">Anywhere, in any language</span></Reveal>
          <h2 className="h-lg">
            <SplitWords text="Made for phones," /> <span className="serif t-cool"><SplitWords text="fluent worldwide." delay={0.25} /></span>
          </h2>
          <Reveal delay={0.1}>
            <p className="lead">A bottom bar, card lists and full-screen deal panels on phones. Five languages with right-to-left Arabic, local number and date formats, and quotes, proposals and contracts printed in the reader’s language.</p>
          </Reveal>
          <div className="lang-stage" dir={l.rtl ? 'rtl' : 'ltr'} lang={l.code.toLowerCase()}>
            <AnimatePresence mode="wait">
              <motion.span key={l.code} className="lang-line t-force" initial={{ opacity: 0, y: 30, filter: 'blur(10px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }} exit={{ opacity: 0, y: -30, filter: 'blur(10px)' }} transition={{ duration: 0.5 }}>
                {l.line}
              </motion.span>
            </AnimatePresence>
          </div>
          <div className="lang-chips">
            {languages.map((x, k) => (
              <button key={x.code} className={`chip ${k === lang ? 'on' : ''}`} onClick={() => setLang(k)} aria-pressed={k === lang}>
                <b>{x.code}</b> {x.name}
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ security + integrations */
export function Trust() {
  return (
    <section className="section trust">
      <div className="wrap trust-grid">
        <div>
          <Reveal><span className="eyebrow">Security and trust</span></Reveal>
          <h2 className="h-md"><SplitWords text={security.title} /></h2>
          <div className="trust-list">
            {security.items.map((s, i) => (
              <Reveal key={s.t} delay={i * 0.06} className="trust-item">
                <span className="shield" aria-hidden>
                  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"><path d="M12 3l7 3v6c0 4.5-3 7.8-7 9-4-1.2-7-4.5-7-9V6z" /><path d="M9 12l2 2 4-4" strokeLinecap="round" /></svg>
                </span>
                <div><b>{s.t}</b><p>{s.d}</p></div>
              </Reveal>
            ))}
          </div>
        </div>
        <div className="integ">
          <Reveal><span className="eyebrow">Plays well with your stack</span></Reveal>
          <h2 className="h-md"><SplitWords text="Connect the tools you already use." /></h2>
          <div className="integ-orbit" aria-label="Integrations">
            <div className="integ-core"><LogoMark size={64} /></div>
            {[0, 1, 2].map((ring) => (
              <div key={ring} className={`integ-ring r${ring}`}>
                {integrationList.filter((_, k) => k % 3 === ring).map((name, k, arr) => (
                  <span key={name} className="integ-chip" style={{ ['--a' as string]: `${(360 / arr.length) * k}deg` }}>
                    <span>{name}</span>
                  </span>
                ))}
              </div>
            ))}
          </div>
          <ul className="sr-only">{integrationList.map((n) => <li key={n}>{n}</li>)}</ul>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ pricing */
export function Pricing() {
  const [annual, setAnnual] = useState(true);
  return (
    <section className="section pricing" id="pricing">
      <div className="wrap">
        <div className="sec-head center">
          <Reveal><span className="eyebrow">Simple pricing</span></Reveal>
          <h2 className="h-lg"><SplitWords text="Start free." /> <span className="t-force"><SplitWords text="Scale fairly." delay={0.2} /></span></h2>
          <div className="toggle" role="group" aria-label="Billing period">
            <button className={!annual ? 'on' : ''} onClick={() => setAnnual(false)} aria-pressed={!annual}>Monthly</button>
            <button className={annual ? 'on' : ''} onClick={() => setAnnual(true)} aria-pressed={annual}>Annual <em>save up to 25%</em></button>
          </div>
        </div>
        <div className="plans">
          {plans.map((p, i) => (
            <Reveal key={p.name} delay={(i % 3) * 0.07} className={`plan ${p.featured ? 'featured' : ''}`}>
              {p.featured && <span className="plan-badge">Most popular</span>}
              <h3>{p.name}</h3>
              <span className="plan-who">{p.who}</span>
              <div className="plan-price">
                <AnimatePresence mode="wait">
                  <motion.span key={`${p.name}${annual}`} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }}>
                    ${annual ? p.annual : p.monthly}
                  </motion.span>
                </AnimatePresence>
                <small>{p.monthly === 0 ? (p.note ?? '') : '/ user / mo'}</small>
              </div>
              <ul>
                {p.points.map((x) => <li key={x}><Check color={p.featured ? '#ff8a8a' : '#22d3ee'} /> {x}</li>)}
              </ul>
              <a className={`btn ${p.featured ? 'btn-force' : ''}`} href={links.signup}>{p.monthly === 0 ? 'Start free' : `Choose ${p.name}`}</a>
            </Reveal>
          ))}
        </div>
        <p className="pricing-note">{pricingNote} <a href={links.contactSales}>Talk to sales</a></p>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ final CTA + footer */
export function FinalCta() {
  return (
    <section className="final grain">
      <div className="final-burst" aria-hidden>
        {Array.from({ length: 18 }).map((_, k) => <i key={k} style={{ ['--k' as string]: k }} />)}
      </div>
      <div className="wrap final-inner">
        <motion.div className="final-mark" initial={{ scale: 0.5, opacity: 0, rotate: -12 }} whileInView={{ scale: 1, opacity: 1, rotate: 0 }} viewport={{ once: true }} transition={{ type: 'spring', stiffness: 120, damping: 12 }}>
          <LogoMark size={120} />
        </motion.div>
        <h2 className="h-lg"><SplitWords text={finalCta.title} /></h2>
        <Reveal delay={0.2}><p className="lead">{finalCta.body}</p></Reveal>
        <Reveal delay={0.3} className="hero-ctas center">
          <a className="btn btn-force" href={links.signup}>Start free <Arrow /></a>
          <a className="btn" href={links.contactSales}>Book a demo</a>
        </Reveal>
      </div>
    </section>
  );
}

export function Footer() {
  return (
    <footer className="footer">
      <div className="wrap footer-inner">
        <div>
          <Wordmark size={28} />
          <p>Sell. Close. Grow. The AI-native revenue platform by Sampledge.</p>
        </div>
        <nav aria-label="Footer">
          {nav.map((n) => <a key={n.href} href={n.href}>{n.label}</a>)}
          <a href={links.login}>Sign in</a>
          <a href={links.sampledge}>Sampledge</a>
        </nav>
      </div>
      <div className="wrap footer-legal">
        <span>© {new Date().getFullYear()} Sampledge. All rights reserved.</span>
        <span>Product screenshots show sample data.</span>
      </div>
    </footer>
  );
}

