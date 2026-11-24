'use client';

import { type CompanyRow, SOCIAL_PLATFORM_LABELS, SOCIAL_PLATFORMS, type SocialPlatform } from '@dealflow/types';
import { Globe } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { BRAND_MARKS } from './brand-marks';

/** Black marks get a light ring so they stay visible on dark themes. */
const DARK = new Set(['#000000', '#181717']);
export const INSTAGRAM_GRADIENT = 'radial-gradient(circle at 30% 107%, #fdf497 0%, #fdf497 5%, #fd5949 45%, #d6249f 60%, #285AEB 90%)';

export interface ProfileLink {
  platform: SocialPlatform | 'website';
  url: string;
}

/** The company's website and every social profile it has, one per platform, in a fixed order. */
export function profileLinks(c: Pick<CompanyRow, 'website' | 'domain' | 'linkedinUrl' | 'socialLinks'>): ProfileLink[] {
  const out: ProfileLink[] = [];
  const website = c.website ?? (c.domain ? `https://${c.domain}` : null);
  if (website) out.push({ platform: 'website', url: website });
  const by = new Map<SocialPlatform, string>();
  if (c.linkedinUrl) by.set('linkedin', c.linkedinUrl);
  for (const s of c.socialLinks) if (!by.has(s.platform)) by.set(s.platform, s.url);
  for (const p of SOCIAL_PLATFORMS) {
    const url = by.get(p);
    if (url) out.push({ platform: p, url });
  }
  return out;
}

/**
 * A row of round buttons, one per profile, each in its platform's own colours and opening the profile in a new tab.
 * Only profiles the company actually has are shown; with none, nothing renders.
 */
export function SocialIconRow({ company, size = 'md' }: { company: Pick<CompanyRow, 'name' | 'website' | 'domain' | 'linkedinUrl' | 'socialLinks'>; size?: 'sm' | 'md' }) {
  const t = useT();
  const links = profileLinks(company);
  if (!links.length) return null;
  const box = size === 'sm' ? 'size-8' : 'size-10';
  const glyph = size === 'sm' ? 'size-4' : 'size-5';
  return (
    <ul className="flex flex-wrap items-center gap-2" aria-label={t('Online profiles')}>
      {links.map((l) => {
        const name = l.platform === 'website' ? t('Website') : SOCIAL_PLATFORM_LABELS[l.platform];
        const label = t('{company} on {platform}', { company: company.name, platform: name });
        const mark = l.platform === 'website' ? null : BRAND_MARKS[l.platform];
        const style: React.CSSProperties =
          l.platform === 'instagram' ? { backgroundImage: INSTAGRAM_GRADIENT } : mark ? { backgroundColor: mark.hex } : {};
        return (
          <li key={l.platform}>
            <a
              href={l.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={label}
              title={`${name}: ${l.url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}`}
              data-platform={l.platform}
              style={style}
              className={`group inline-flex ${box} items-center justify-center rounded-full text-white shadow-sm ring-1 transition duration-150 hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none motion-reduce:hover:translate-y-0 ${
                l.platform === 'website' ? 'bg-primary text-primary-foreground ring-primary/30' : mark && DARK.has(mark.hex) ? 'ring-white/25' : 'ring-black/5'
              }`}
            >
              {mark ? (
                <svg viewBox="0 0 24 24" aria-hidden className={`${glyph} fill-current`}>
                  <path d={mark.path} />
                </svg>
              ) : (
                <Globe aria-hidden className={glyph} />
              )}
            </a>
          </li>
        );
      })}
    </ul>
  );
}
