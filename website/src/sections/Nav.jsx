import { useEffect, useState } from 'react';
import { motion, useScroll, useSpring } from 'framer-motion';
import { site } from '../content/site.js';
import { logoOnDark } from '../content/media.js';
import { Icon } from '../components/Icon.jsx';

export function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const { scrollYProgress } = useScroll();
  const progress = useSpring(scrollYProgress, { stiffness: 120, damping: 24 });

  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 24);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);

  return (
    <header className={`nav ${scrolled ? 'nav--scrolled' : ''} ${open ? 'nav--open' : ''}`}>
      <div className="nav__inner">
        <a href="#top" className="nav__logo" aria-label={`${site.brand.name} home`}>
          <img src={logoOnDark} alt={`${site.brand.name}, ${site.brand.tagline} by ${site.brand.owner}`} width="190" height="51" />
        </a>
        <nav className="nav__links" aria-label="Page sections">
          {site.nav.map((l) => (
            <a key={l.href} href={l.href} onClick={() => setOpen(false)}>
              {l.label}
            </a>
          ))}
        </nav>
        <div className="nav__cta">
          <a className="btn btn--primary btn--sm" href={site.links.demo}>
            <span className="btn__shine" aria-hidden="true" />
            {site.hero.primaryCta}
          </a>
          <button className="nav__burger" aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            <Icon name={open ? 'close' : 'menu'} size={22} />
          </button>
        </div>
      </div>
      <motion.div className="nav__progress" style={{ scaleX: progress }} aria-hidden="true">
        <span className="nav__spark" />
      </motion.div>
    </header>
  );
}
