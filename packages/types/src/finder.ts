import { z } from 'zod';
import type { ExtensionMatch } from './extension';

/**
 * Email finder (Phase 9). DealFlow's own finder reads a company's public website and works out its address
 * pattern; an optional data provider (Hunter.io, with the customer's own key) adds addresses it knows about.
 * Nothing is presented as verified unless it was published on the company's site or the provider says so.
 */

export const finderSearchSchema = z
  .object({
    /** A company name ("Kestrel Analytics") or a website or domain ("kestrel-analytics.com"). */
    company: z.string().trim().min(2, 'Enter a company name or website').max(200),
    firstName: z.string().trim().max(80).optional(),
    lastName: z.string().trim().max(80).optional(),
  })
  .refine((v) => !v.firstName === !v.lastName, { message: 'Enter both first and last name, or neither', path: ['lastName'] });
export type FinderSearchInput = z.infer<typeof finderSearchSchema>;

/** Patterns for a person's address, written with {first}, {last}, {f} and {l}. */
export const EMAIL_PATTERNS = ['{first}.{last}', '{first}', '{f}{last}', '{first}{last}', '{first}_{last}', '{f}.{last}', '{last}.{first}', '{first}{l}', '{last}'] as const;
export type EmailPattern = (typeof EMAIL_PATTERNS)[number];

export type DomainSource = 'given' | 'dealflow' | 'website' | 'provider';
export const DOMAIN_SOURCE_LABELS: Record<DomainSource, string> = {
  given: 'the website you entered',
  dealflow: 'the company record in DealFlow',
  website: 'a website that matches the company name',
  provider: 'the data provider',
};

/**
 * found: published on the company's own website (source page given).
 * provider: from the data provider, with its confidence score.
 * pattern: built from the pattern the company's published addresses follow.
 * guess: a common pattern, not checked against anything. Treat with care.
 */
export type FinderEmailStatus = 'found' | 'provider' | 'pattern' | 'guess';
export const FINDER_STATUS_LABELS: Record<FinderEmailStatus, string> = {
  found: 'On their website',
  provider: 'From data provider',
  pattern: 'Matches their pattern',
  guess: 'Guess, not checked',
};

export interface FinderEmail {
  email: string;
  name: string | null;
  position: string | null;
  status: FinderEmailStatus;
  /** Page the address was published on, for "found". */
  sourceUrl: string | null;
  /** 0–100, for provider results only. */
  confidence: number | null;
  /** Already in DealFlow. */
  match: ExtensionMatch | null;
  suppressed: boolean;
}

export interface FinderResult {
  id: string;
  query: FinderSearchInput;
  companyName: string;
  domain: string | null;
  domainSource: DomainSource | null;
  company: { id: string; name: string } | null;
  /** Whether the domain has a mail server (MX record). null when not checked. */
  mailServer: boolean | null;
  pattern: EmailPattern | null;
  /** How many published addresses the pattern is based on. */
  patternBasis: number;
  pagesRead: number;
  /** People at the company. */
  emails: FinderEmail[];
  /** The person asked about, best first. */
  person: FinderEmail[];
  provider: 'not_configured' | 'used' | 'failed';
  notes: string[];
  createdAt: string;
}

export interface FinderHistoryRow {
  id: string;
  companyName: string;
  domain: string | null;
  person: string | null;
  found: number;
  createdAt: string;
}

export interface FinderUsage {
  used: number;
  limit: number;
  provider: boolean;
}

export const finderSaveSchema = z.object({
  people: z
    .array(z.object({ email: z.string().trim().toLowerCase().email().max(254), fullName: z.string().trim().max(200).optional(), jobTitle: z.string().trim().max(160).optional() }))
    .min(1, 'Choose at least one address')
    .max(25),
  sequenceId: z.string().uuid().optional(),
});
export type FinderSaveInput = z.infer<typeof finderSaveSchema>;

const strip = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');

/** Fills a pattern for a person: ("{f}{last}", "Jane", "Doe") → "jdoe". */
export function applyPattern(pattern: EmailPattern, first: string, last: string): string | null {
  const f = strip(first);
  const l = strip(last);
  if (!f || !l) return null;
  return pattern.replace('{first}', f).replace('{last}', l).replace('{f}', f[0]!).replace('{l}', l[0]!);
}

/** Which pattern a known person's address follows, if any: ("jane.doe", "Jane", "Doe") → "{first}.{last}". */
export function detectPattern(local: string, first: string, last: string): EmailPattern | null {
  const lower = local.toLowerCase();
  return EMAIL_PATTERNS.find((p) => applyPattern(p, first, last) === lower) ?? null;
}

/** Splits "Jane van Doe" into first and last name; null when it is not a two-part name. */
export function splitName(name: string | null | undefined): { first: string; last: string } | null {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return null;
  return { first: parts[0]!, last: parts.slice(1).join('') };
}

/** Possible domains for a company name: "Kestrel Analytics Ltd" → kestrelanalytics.com, kestrel-analytics.com, … */
export function domainGuesses(company: string, tlds: readonly string[] = ['com', 'io', 'co', 'net', 'ai', 'org']): string[] {
  const words = company
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .filter((w, i, all) => !(i === all.length - 1 && all.length > 1 && /^(inc|llc|ltd|limited|gmbh|plc|corp|corporation|co|company|pvt|srl|sa|ag|bv)$/.test(w)));
  if (!words.length) return [];
  const stems = [...new Set([words.join(''), words.join('-'), words[0]!])];
  return tlds.flatMap((t) => stems.map((s) => `${s}.${t}`)).slice(0, 12);
}
