import { z } from 'zod';

/*
 * Company auto-fill from public sources (ADR 0076). SampForce reads the company's own website (its pages and the
 * schema.org data in them) and Wikidata, and fills Business Information fields that are still empty. Every value it
 * fills keeps where it came from; people can undo a fill, and what they type or clear is never filled again.
 */

/** Official profiles shown as icons in the company header, in this order. */
export const SOCIAL_PLATFORMS = ['linkedin', 'x', 'facebook', 'instagram', 'youtube', 'tiktok', 'github', 'threads', 'pinterest', 'xing', 'crunchbase', 'glassdoor', 'whatsapp', 'telegram', 'vimeo', 'medium'] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];
export const SOCIAL_PLATFORM_LABELS: Record<SocialPlatform, string> = {
  linkedin: 'LinkedIn',
  x: 'X (Twitter)',
  facebook: 'Facebook',
  instagram: 'Instagram',
  youtube: 'YouTube',
  tiktok: 'TikTok',
  github: 'GitHub',
  threads: 'Threads',
  pinterest: 'Pinterest',
  xing: 'XING',
  crunchbase: 'Crunchbase',
  glassdoor: 'Glassdoor',
  whatsapp: 'WhatsApp',
  telegram: 'Telegram',
  vimeo: 'Vimeo',
  medium: 'Medium',
};

/** The host names (and path rules) that make a link an official profile on each platform. */
const SOCIAL_HOSTS: [SocialPlatform, RegExp, RegExp?][] = [
  // Company pages and showcase pages only; a person's /in/ profile is not the company's.
  ['linkedin', /(^|\.)linkedin\.com$/, /^\/(company|school|showcase)\/[^/]+/i],
  ['x', /(^|\.)(twitter|x)\.com$/, /^\/(?!intent\/|share|home|search|hashtag\/|i\/)[A-Za-z0-9_]{1,15}\/?$/],
  ['facebook', /(^|\.)(facebook|fb)\.com$/, /^\/(?!sharer|share|dialog\/|plugins\/|tr\b)[^?#]+/i],
  ['instagram', /(^|\.)instagram\.com$/, /^\/(?!p\/|reel\/|explore\/)[A-Za-z0-9_.]+\/?$/],
  ['youtube', /(^|\.)youtube\.com$/, /^\/(@[^/]+|channel\/[^/]+|c\/[^/]+|user\/[^/]+)/i],
  ['tiktok', /(^|\.)tiktok\.com$/, /^\/@[^/]+/],
  ['github', /(^|\.)github\.com$/, /^\/[A-Za-z0-9-]+\/?$/],
  ['threads', /(^|\.)threads\.(net|com)$/, /^\/@[^/]+/],
  ['pinterest', /(^|\.)pinterest\.[a-z.]+$/, /^\/[A-Za-z0-9_]+\/?$/],
  ['xing', /(^|\.)xing\.com$/, /^\/(pages|companies)\/[^/]+/i],
  ['crunchbase', /(^|\.)crunchbase\.com$/, /^\/organization\/[^/]+/i],
  ['glassdoor', /(^|\.)glassdoor\.[a-z.]+$/, /^\/(Overview|Reviews)\//i],
  ['whatsapp', /^(wa\.me|api\.whatsapp\.com)$/],
  ['telegram', /^(t\.me|telegram\.me)$/, /^\/[A-Za-z0-9_]{4,}\/?$/],
  ['vimeo', /(^|\.)vimeo\.com$/, /^\/[A-Za-z0-9_]+\/?$/],
  ['medium', /(^|\.)medium\.com$/, /^\/@?[A-Za-z0-9_.-]+\/?$/],
];

/** The platform of an official profile link, or null for share buttons, posts and anything else. */
export function socialPlatformOf(raw: string): SocialPlatform | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const host = u.hostname.toLowerCase().replace(/^(www|m|mobile)\./, '');
  for (const [platform, hostRule, pathRule] of SOCIAL_HOSTS) {
    if (!hostRule.test(host)) continue;
    if (pathRule && !pathRule.test(u.pathname)) return null;
    if (platform !== 'whatsapp' && u.pathname.replace(/\/+$/, '') === '') return null;
    return platform;
  }
  return null;
}

/** A profile link tidied for storage: https, no tracking query, no trailing slash. */
export function tidySocialUrl(raw: string): string {
  const u = new URL(raw);
  u.protocol = 'https:';
  u.hash = '';
  if (socialPlatformOf(raw) !== 'whatsapp') u.search = '';
  u.hostname = u.hostname.toLowerCase().replace(/^(m|mobile)\./, 'www.');
  return u.toString().replace(/\/+$/, '');
}

export const socialLinkSchema = z.object({
  platform: z.enum(SOCIAL_PLATFORMS),
  url: z
    .string()
    .trim()
    .max(500)
    .transform((v) => (/^[a-z][a-z0-9+.-]*:\/\//i.test(v) ? v : `https://${v}`))
    .pipe(z.string().url('Enter a valid web address').refine((v) => /^https?:\/\//i.test(v), 'Use an http or https address')),
});
export type SocialLink = z.infer<typeof socialLinkSchema>;

export const leaderSchema = z.object({ name: z.string().trim().min(1).max(160), title: z.string().trim().max(160).nullable().optional() });
export type Leader = z.infer<typeof leaderSchema>;

/** A detail with no column of its own (a slogan, a stock ticker, a VAT number), kept inside Business Information. */
export const moreDetailSchema = z.object({ label: z.string().trim().min(1, 'Name the detail').max(80), value: z.string().trim().min(1, 'Enter a value').max(1000) });
export type MoreDetail = z.infer<typeof moreDetailSchema>;

export const OPERATING_STATUSES = ['Active', 'Acquired', 'Merged', 'Dissolved', 'Inactive'] as const;

/** Where a value came from, best first: the company's own structured data, its pages, Wikidata, then AI. */
export const FIELD_SOURCES = ['SCHEMA_ORG', 'WEBSITE', 'WIKIDATA', 'AI', 'USER'] as const;
export type FieldSourceKind = (typeof FIELD_SOURCES)[number];
export const FIELD_SOURCE_LABELS: Record<FieldSourceKind, string> = {
  SCHEMA_ORG: 'Company website (structured data)',
  WEBSITE: 'Company website',
  WIKIDATA: 'Wikidata',
  AI: 'AI, from the website text',
  USER: 'Entered by you',
};
/**
 * high: stated by the company in structured data, or matched exactly. medium: read from page text by pattern.
 * low: guessed from weak signals (a country from the web address). uncertain: sources disagree.
 */
export type FieldConfidence = 'high' | 'medium' | 'low' | 'uncertain';

export interface FieldSource {
  source: FieldSourceKind;
  /** The page or Wikidata item the value was read from. */
  url: string | null;
  /** When it was read (ISO time). */
  at: string;
  confidence: FieldConfidence;
  /** The auto-fill run that wrote it; undo works per run. */
  runId: string | null;
  /** For list fields: the items that were added automatically (the rest are the user's). */
  items?: string[];
  /** For list fields: items someone removed or undid, which auto-fill does not add again. */
  rejected?: string[];
  /** Other values the sources gave, when they disagree. */
  alternatives?: { value: string; source: FieldSourceKind; url: string | null }[];
  /** Who typed or cleared it (USER only). */
  byUserId?: string | null;
}

/**
 * The Business Information fields auto-fill can write. Scalars are filled only while empty; lists get the missing
 * items added. A field someone typed, changed or cleared (source USER) is never written again automatically.
 */
export const ENRICH_FIELDS = [
  'website',
  'overview',
  'industry',
  'businessCategory',
  'specialties',
  'services',
  'products',
  'industriesServed',
  'foundedYear',
  'employeeCount',
  'companySize',
  'companyType',
  'branchCount',
  'legalName',
  'parentCompanyName',
  'ownership',
  'founders',
  'ceo',
  'leadership',
  'operatingStatus',
  'country',
  'headquarters',
  'state',
  'city',
  'address',
  'postalCode',
  'timezone',
  'workingHours',
  'addresses',
  'primaryEmail',
  'emails',
  'primaryPhone',
  'phones',
  'contactPageUrl',
  'linkedinUrl',
  'socialLinks',
  'certifications',
  'moreDetails',
] as const;
export type EnrichField = (typeof ENRICH_FIELDS)[number];
export const LIST_ENRICH_FIELDS: readonly EnrichField[] = ['services', 'products', 'industriesServed', 'founders', 'leadership', 'addresses', 'emails', 'phones', 'socialLinks', 'certifications', 'moreDetails'];

export const ENRICH_FIELD_LABELS: Record<EnrichField, string> = {
  website: 'Website',
  overview: 'Description',
  industry: 'Industry',
  businessCategory: 'Business category',
  specialties: 'Company specialties',
  services: 'Services',
  products: 'Products',
  industriesServed: 'Industries served',
  foundedYear: 'Founded',
  employeeCount: 'Employees',
  companySize: 'Company size',
  companyType: 'Company type',
  branchCount: 'Number of branches',
  legalName: 'Legal name',
  parentCompanyName: 'Parent company',
  ownership: 'Ownership',
  founders: 'Founders',
  ceo: 'CEO',
  leadership: 'Leadership',
  operatingStatus: 'Company status',
  country: 'Country',
  headquarters: 'Headquarters',
  state: 'State or region',
  city: 'City',
  address: 'Address',
  postalCode: 'Postal code',
  timezone: 'Time zone',
  workingHours: 'Working hours',
  addresses: 'Other offices',
  primaryEmail: 'Email',
  emails: 'Emails',
  primaryPhone: 'Phone',
  phones: 'Phones',
  contactPageUrl: 'Contact page',
  linkedinUrl: 'LinkedIn',
  socialLinks: 'Social profiles',
  certifications: 'Certifications',
  moreDetails: 'More details',
};

export const ENRICHMENT_STATUSES = ['PENDING', 'DONE', 'NOTHING_FOUND', 'FAILED'] as const;
export type EnrichmentStatus = (typeof ENRICHMENT_STATUSES)[number];
export const ENRICHMENT_TRIGGERS = ['CREATE', 'IMPORT', 'MANUAL', 'WEBSITE_CHANGED'] as const;
export type EnrichmentTrigger = (typeof ENRICHMENT_TRIGGERS)[number];

/** One value an auto-fill run wrote. */
export interface EnrichmentFill {
  field: EnrichField;
  /** What was written, as shown to people ("1998", "sales@acme.com", "LinkedIn: https://…"). */
  display: string;
  source: FieldSourceKind;
  url: string | null;
  confidence: FieldConfidence;
  /** True once someone undid it, or changed the field afterwards (then it is no longer this run's value). */
  undone: boolean;
}

export interface EnrichmentRun {
  id: string;
  status: EnrichmentStatus;
  trigger: EnrichmentTrigger;
  domain: string | null;
  requestedBy: { id: string; name: string } | null;
  createdAt: string;
  finishedAt: string | null;
  fills: EnrichmentFill[];
  /** The pages and Wikidata items that were read. */
  sources: { url: string; kind: 'WEBSITE' | 'WIKIDATA' }[];
  /** Why nothing could be read (the site was unreachable, Wikidata is switched off). */
  error: string | null;
}

export interface CompanyEnrichmentState {
  /** Newest first, at most 10. */
  runs: EnrichmentRun[];
  /** The source of every Business Information field that has one. */
  fieldSources: Partial<Record<EnrichField, FieldSource>>;
  /** True while a run is waiting or running. */
  busy: boolean;
  /** Whether auto-fill can run: the company needs a website or a name Wikidata knows. */
  canRun: boolean;
}

export const enrichmentUndoSchema = z.object({ fields: z.array(z.enum(ENRICH_FIELDS)).max(ENRICH_FIELDS.length).optional() }).strict();
export type EnrichmentUndo = z.infer<typeof enrichmentUndoSchema>;

/** Look a company up before it is saved (Create Company): nothing is stored. */
export const enrichmentPreviewSchema = z
  .object({ name: z.string().trim().min(1, 'Enter a company name').max(200), website: z.string().trim().max(500).nullable().optional() })
  .strict();
export type EnrichmentPreviewRequest = z.infer<typeof enrichmentPreviewSchema>;

export interface EnrichmentPreview {
  /** What auto-fill would fill on an empty company, best source first; `value` is the raw field value. */
  found: (Omit<EnrichmentFill, 'undone'> & { value: unknown })[];
  sources: { url: string; kind: 'WEBSITE' | 'WIKIDATA' }[];
  /** Why nothing was found (the site could not be reached...), or null. */
  error: string | null;
  /** People the company publishes (team page, leadership, Wikidata, data providers), for the employee step. */
  people: FoundPerson[];
}

/** Where a person was found (ADR 0079). */
export const PERSON_SOURCES = ['WEBSITE', 'SCHEMA_ORG', 'WIKIDATA', 'HUNTER', 'APOLLO'] as const;
export type PersonSource = (typeof PERSON_SOURCES)[number];
export const PERSON_SOURCE_LABELS: Record<PersonSource, string> = {
  WEBSITE: 'Company website',
  SCHEMA_ORG: 'Company website (structured data)',
  WIKIDATA: 'Wikidata',
  HUNTER: 'Hunter.io',
  APOLLO: 'Apollo.io',
};

/**
 * A person the company publishes about itself: only what the source shows next to the name. The email is the one
 * written on the page or given by the data provider, never a guess.
 */
export interface FoundPerson {
  name: string;
  /** Job title (designation) as written. */
  title: string | null;
  email: string | null;
  linkedinUrl: string | null;
  source: PersonSource;
  /** The page or item the person was read from (null for a data provider). */
  url: string | null;
}
