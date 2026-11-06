import { site } from '../content/site.js';
import { Icon } from '../components/Icon.jsx';

export function Marquee() {
  const half = Math.ceil(site.marquee.length / 2);
  const rows = [site.marquee.slice(0, half), site.marquee.slice(half)];
  return (
    <section className="marquee" aria-label="Capabilities">
      {rows.map((row, r) => (
        <div key={r} className={`marquee__row marquee__row--${r}`}>
          <div className="marquee__track">
            {[...row, ...row].map((item, i) => (
              <span key={i} className="marquee__item" aria-hidden={i >= row.length}>
                <Icon name="bolt" size={14} />
                {item}
              </span>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}
