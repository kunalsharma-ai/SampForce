import { z } from 'zod';

/**
 * Language and regional formats. The language picks the interface text and the reading direction; the format locale
 * (a BCP 47 tag such as "en-GB" or "de-CH") picks how dates, numbers and money are written. Leaving the format locale
 * empty uses the language with the browser's region where they match, so most people never need to set it.
 */
export const LANGUAGES = [
  { code: 'en', name: 'English', english: 'English', dir: 'ltr' },
  { code: 'es', name: 'Español', english: 'Spanish', dir: 'ltr' },
  { code: 'fr', name: 'Français', english: 'French', dir: 'ltr' },
  { code: 'de', name: 'Deutsch', english: 'German', dir: 'ltr' },
  { code: 'ar', name: 'العربية', english: 'Arabic', dir: 'rtl' },
] as const;

export type LanguageCode = (typeof LANGUAGES)[number]['code'];
export type TextDirection = 'ltr' | 'rtl';

export const languageCodeSchema = z.enum(LANGUAGES.map((l) => l.code) as [LanguageCode, ...LanguageCode[]]);

/** Format locales offered in the picker. Any valid BCP 47 tag is accepted by the API; these are the common ones. */
export const FORMAT_LOCALES = [
  'en-US', 'en-GB', 'en-IN', 'en-AU', 'en-CA', 'en-IE', 'en-NZ', 'en-SG', 'en-ZA',
  'es-ES', 'es-MX', 'es-AR', 'fr-FR', 'fr-CA', 'fr-CH', 'de-DE', 'de-AT', 'de-CH',
  'ar-AE', 'ar-SA', 'ar-EG', 'hi-IN', 'it-IT', 'nl-NL', 'pt-BR', 'pt-PT', 'sv-SE', 'pl-PL', 'ja-JP', 'zh-CN',
] as const;

/** A BCP 47 language tag the platform's Intl data understands, stored in its canonical spelling ("en-gb" → "en-GB"). */
export const formatLocaleSchema = z
  .string()
  .trim()
  .min(2)
  .max(35)
  .transform((v, ctx) => {
    try {
      const [canonical] = Intl.getCanonicalLocales(v);
      if (canonical) return canonical;
    } catch {
      /* reported below */
    }
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Use a locale tag such as en-GB or de-CH.' });
    return z.NEVER;
  });

export const regionalSchema = z
  .object({
    language: languageCodeSchema,
    /** Null follows the language (with the browser's region when it speaks the same language). */
    formatLocale: formatLocaleSchema.nullable(),
  })
  .strict();

export type Regional = z.infer<typeof regionalSchema>;

export const DEFAULT_REGIONAL: Regional = { language: 'en', formatLocale: null };

export interface RegionalResponse {
  regional: Regional;
  /** 'user' when the person saved their own settings; 'default' otherwise. */
  source: 'user' | 'default';
  updatedAt: string | null;
}

export function languageDir(code: string): TextDirection {
  return LANGUAGES.find((l) => l.code === code)?.dir ?? 'ltr';
}

/** Reads a stored value leniently: anything unknown falls back to the defaults rather than failing. */
export function normalizeRegional(raw: unknown): Regional {
  const parsed = regionalSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const language = languageCodeSchema.safeParse(o.language);
  const locale = formatLocaleSchema.safeParse(o.formatLocale);
  return { language: language.success ? language.data : DEFAULT_REGIONAL.language, formatLocale: locale.success ? locale.data : null };
}

/**
 * The locale used for dates, numbers and money. An explicit format locale wins; otherwise the browser's locale is used
 * when it is in the chosen language ("en-GB" for an English reader in the UK), else the language on its own.
 */
export function resolveFormatLocale(regional: Regional, browserLocales: readonly string[] = []): string {
  if (regional.formatLocale) return regional.formatLocale;
  for (const l of browserLocales) {
    try {
      const [c] = Intl.getCanonicalLocales(l);
      if (c && c.split('-')[0] === regional.language) return c;
    } catch {
      /* skip invalid browser tags */
    }
  }
  return regional.language;
}
