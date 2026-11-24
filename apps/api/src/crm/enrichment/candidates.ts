import { COMPANY_SIZES, type CompanyAddress, type ContactPoint, type EnrichField, type FieldConfidence, type FieldSourceKind, GEO_COUNTRIES, geoCountry, type Leader, type MoreDetail, type SocialLink } from '@dealflow/types';

/** The value types each auto-fill field takes. */
export interface FieldValues {
  website: string;
  overview: string;
  industry: string;
  businessCategory: string;
  specialties: string;
  services: string[];
  products: string[];
  industriesServed: string[];
  foundedYear: number;
  employeeCount: number;
  companySize: string;
  companyType: string;
  branchCount: number;
  legalName: string;
  parentCompanyName: string;
  ownership: string;
  founders: string[];
  ceo: string;
  leadership: Leader[];
  operatingStatus: string;
  country: string;
  headquarters: string;
  state: string;
  city: string;
  address: string;
  postalCode: string;
  timezone: string;
  addresses: CompanyAddress[];
  primaryEmail: string;
  emails: ContactPoint[];
  primaryPhone: string;
  phones: ContactPoint[];
  contactPageUrl: string;
  linkedinUrl: string;
  socialLinks: SocialLink[];
  certifications: string[];
  moreDetails: MoreDetail[];
}

/** One value a source offers for a field. Several sources may offer the same field; merge.ts picks. */
export type Candidate = {
  [F in EnrichField]: { field: F; value: FieldValues[F]; source: Exclude<FieldSourceKind, 'USER'>; url: string | null; confidence: Exclude<FieldConfidence, 'uncertain'> };
}[EnrichField];

export function candidate<F extends EnrichField>(field: F, value: FieldValues[F], source: Exclude<FieldSourceKind, 'USER'>, url: string | null, confidence: Exclude<FieldConfidence, 'uncertain'>): Candidate {
  return { field, value, source, url, confidence } as Candidate;
}

export const clean = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim();

/** Cuts long text at a sentence (or word) boundary. */
export function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  if (stop > max * 0.5) return cut.slice(0, stop + 1);
  return `${cut.slice(0, cut.lastIndexOf(' ') > 0 ? cut.lastIndexOf(' ') : max).trimEnd()}…`;
}

/** The size band for a head count, as the company forms use it. */
export function sizeBand(count: number): string {
  const bands: [number, (typeof COMPANY_SIZES)[number]][] = [[10, '1-10'], [50, '11-50'], [200, '51-200'], [500, '201-500'], [1000, '501-1000'], [5000, '1001-5000']];
  for (const [max, band] of bands) if (count <= max) return band;
  return '5001+';
}

/** The country's time zone when it has exactly one. */
export function singleTimezone(country: string | null | undefined): string | null {
  const zones = geoCountry(country)?.timezones ?? [];
  return zones.length === 1 ? zones[0]! : null;
}

const COUNTRY_ALIASES: [string, string][] = [
  ['usa', 'US'], ['u.s.a', 'US'], ['united states of america', 'US'], ['u.s.', 'US'], ['america', 'US'],
  ['uk', 'GB'], ['u.k.', 'GB'], ['england', 'GB'], ['scotland', 'GB'], ['wales', 'GB'], ['great britain', 'GB'], ['britain', 'GB'],
  ['uae', 'AE'], ['u.a.e', 'AE'], ['dubai', 'AE'], ['south korea', 'KR'], ['korea', 'KR'], ['russia', 'RU'], ['vietnam', 'VN'],
  ['the netherlands', 'NL'], ['holland', 'NL'], ['czech republic', 'CZ'], ['turkey', 'TR'], ['türkiye', 'TR'], ['hong kong', 'HK'],
  ['taiwan', 'TW'], ['iran', 'IR'], ['syria', 'SY'], ['laos', 'LA'], ['bolivia', 'BO'], ['venezuela', 'VE'], ['tanzania', 'TZ'],
  ['moldova', 'MD'], ['macedonia', 'MK'], ['ivory coast', 'CI'], ['singapore', 'SG'], ['ksa', 'SA'], ['saudi arabia', 'SA'],
];

/** Country names (and common short forms) to ISO codes, longest first so "United States" wins over "States". */
const COUNTRY_NAMES: [string, string][] = [
  ...GEO_COUNTRIES.map((c) => [c.name.toLowerCase(), c.code] as [string, string]),
  ...GEO_COUNTRIES.filter((c) => /,|\(/.test(c.name)).map((c) => [c.name.split(/[,(]/)[0]!.trim().toLowerCase(), c.code] as [string, string]),
  ...COUNTRY_ALIASES,
].sort((a, b) => b[0].length - a[0].length);

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const COUNTRY_RE = new RegExp(`(?:^|[^\\p{L}])(${COUNTRY_NAMES.map(([n]) => escape(n)).join('|')})(?=$|[^\\p{L}])`, 'iu');
const COUNTRY_BY_NAME = new Map(COUNTRY_NAMES);

/** The country a piece of text names (the last one, as addresses end with it), with the matched words. */
export function countryIn(text: string): { code: string; match: string } | null {
  let found: { code: string; match: string } | null = null;
  const re = new RegExp(COUNTRY_RE.source, 'giu');
  for (const m of text.matchAll(re)) {
    const code = COUNTRY_BY_NAME.get(m[1]!.toLowerCase());
    if (code) found = { code, match: m[1]! };
  }
  return found;
}

/** ISO code from a schema.org addressCountry (a code, a name, or a Country object). */
export function countryCodeOf(raw: unknown): string | null {
  const v = typeof raw === 'object' && raw ? ((raw as Record<string, unknown>).name ?? (raw as Record<string, unknown>).identifier) : raw;
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (/^[A-Za-z]{2}$/.test(s) && geoCountry(s)) return s.toUpperCase();
  return COUNTRY_BY_NAME.get(s.toLowerCase()) ?? countryIn(s)?.code ?? null;
}

/** Web addresses whose last label is a country code that is really used as one (not .io, .co, .ai and the like). */
const GENERIC_TLDS = new Set(['io', 'co', 'ai', 'me', 'tv', 'cc', 'ly', 'fm', 'gg', 'to', 'ws', 'la', 'sh', 'ac', 'is', 'it', 'am', 'im', 'so', 'vc', 'app', 'su', 'nu', 'tk', 'ml', 'ga', 'cf', 'gq', 'cx', 'eu']);
export function countryFromDomain(domain: string): string | null {
  const parts = domain.toLowerCase().split('.');
  const tld = parts.at(-1)!;
  if (tld === 'uk') return 'GB';
  if (tld.length !== 2 || GENERIC_TLDS.has(tld)) return null;
  return geoCountry(tld) ? tld.toUpperCase() : null;
}

/** Keys for "is this the same item": emails lower-case, phones by their last ten digits, everything else by words. */
export function itemKey(field: EnrichField, item: unknown): string {
  if (typeof item === 'string') return item.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const o = item as Record<string, unknown>;
  switch (field) {
    case 'emails':
      return String(o.value).toLowerCase();
    case 'phones':
      return String(o.value).replace(/\D/g, '').slice(-10);
    case 'socialLinks':
      return String(o.platform);
    case 'addresses':
      return [o.address, o.city, o.postalCode, o.country].map((x) => String(x ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')).join('|');
    case 'leadership':
      return String(o.name).toLowerCase();
    case 'moreDetails':
      return String(o.label).toLowerCase();
    default:
      return JSON.stringify(item);
  }
}

/** How a value is shown in "what was filled": short and readable. */
export function display(field: EnrichField, value: unknown): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map((v) => display(field, v)).join(', ');
  if (typeof value !== 'object') return String(value);
  const o = value as Record<string, unknown>;
  switch (field) {
    case 'emails':
    case 'phones':
      return o.label ? `${String(o.value)} (${String(o.label)})` : String(o.value);
    case 'socialLinks':
      return String(o.url);
    case 'addresses':
      return [o.label ? `${String(o.label)}:` : null, o.address, o.city, o.postalCode, o.country].filter(Boolean).join(' ');
    case 'leadership':
      return o.title ? `${String(o.name)} (${String(o.title)})` : String(o.name);
    case 'moreDetails':
      return `${String(o.label)}: ${String(o.value)}`;
    default:
      return JSON.stringify(value);
  }
}
