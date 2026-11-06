import { site } from '../content/site.js';
import { media } from '../content/media.js';
import { Reveal, SectionHead, TiltCard } from '../components/ui.jsx';

export function Features() {
  const f = site.features;
  return (
    <section className="features" id="features">
      <SectionHead eyebrow={f.eyebrow} title={f.title} sub={f.sub} accent="bolt" />
      <div className="bento">
        {f.tiles.map((t, i) => (
          <Reveal key={t.key} className={`bento__cell bento__cell--${t.size}`} delay={(i % 3) * 0.06}>
            <TiltCard className={`bento__card tone-${t.color}`} max={5}>
              <div className="bento__spot" aria-hidden="true" />
              <div className="bento__copy">
                <span className="bento__index">{String(i + 1).padStart(2, '0')}</span>
                <h3>{t.title}</h3>
                <p>{t.text}</p>
              </div>
              <div className="bento__media">
                <img src={media(t.media)} alt={`${t.title} screen in SampForce`} loading="lazy" decoding="async" />
              </div>
            </TiltCard>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
