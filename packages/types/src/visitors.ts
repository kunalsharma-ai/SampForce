import { z } from 'zod';

// ───────────── Website visitor intelligence (enhancement feature 15) ─────────────
//
// A small first-party script records page views on the customer's own website, only after the visitor consents
// (or, where the admin confirms the law allows it, until they decline). Visitors stay anonymous until they send an
// enquiry or submit a SampForce form. There is no IP lookup, fingerprinting or third-party identity data.

/** opt_in: nothing is recorded until the site calls dealflow('consent', true). notice: recorded unless declined. */
export const CONSENT_MODES = ['opt_in', 'notice'] as const;
export type ConsentMode = (typeof CONSENT_MODES)[number];

export const PAGE_KINDS = ['pricing', 'demo', 'product', 'case_study', 'docs', 'careers', 'other'] as const;
export type PageKind = (typeof PAGE_KINDS)[number];
export const PAGE_KIND_LABELS: Record<PageKind, string> = { pricing: 'Pricing', demo: 'Demo or contact', product: 'Product', case_study: 'Case study', docs: 'Documentation', careers: 'Careers', other: 'Other' };

const hostname = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^(\*\.)?([a-z0-9-]+\.)+[a-z]{2,}$|^localhost$/, 'Use a host name like www.example.com or *.example.com');

export const importantPageSchema = z.object({
  /** Path prefix: "/pricing" matches /pricing and /pricing/teams. A trailing * matches any path starting with it. */
  pattern: z.string().trim().regex(/^\/[^\s]*$/, 'Start with /').max(200),
  label: z.string().trim().min(1).max(60),
  kind: z.enum(PAGE_KINDS),
  /** Intent points for viewing it (once per page per visitor). Careers pages are usually 0. */
  weight: z.number().int().min(0).max(50),
});
export type ImportantPage = z.infer<typeof importantPageSchema>;

export const DEFAULT_IMPORTANT_PAGES: ImportantPage[] = [
  { pattern: '/pricing', label: 'Pricing', kind: 'pricing', weight: 20 },
  { pattern: '/demo', label: 'Book a demo', kind: 'demo', weight: 25 },
  { pattern: '/contact', label: 'Contact', kind: 'demo', weight: 20 },
  { pattern: '/product', label: 'Product pages', kind: 'product', weight: 10 },
  { pattern: '/case-studies', label: 'Case studies', kind: 'case_study', weight: 10 },
  { pattern: '/careers', label: 'Careers', kind: 'careers', weight: 0 },
];

export const visitorSettingsSchema = z.object({
  enabled: z.boolean(),
  consentMode: z.enum(CONSENT_MODES),
  /** Websites allowed to send data. Requests from anywhere else are refused. */
  allowedDomains: z.array(hostname).max(20),
  /** Page views and sessions older than this are deleted, and so are anonymous visitors not seen since. */
  retentionDays: z.number().int().min(30).max(730),
  /** Create a lead from an enquiry whose email matches no contact or open lead. */
  createLeads: z.boolean(),
  /** Shown next to the marketing consent checkbox on enquiry forms; consent is only recorded when this is set and ticked. */
  enquiryConsentText: z.string().trim().max(500).nullable(),
  highIntentScore: z.number().int().min(10).max(100),
  importantPages: z.array(importantPageSchema).max(30),
});
export type VisitorSettingsInput = z.infer<typeof visitorSettingsSchema>;

export interface VisitorSettings extends VisitorSettingsInput {
  /** Public key in the install snippet. It identifies the workspace; it is not a secret. */
  siteKey: string;
  updatedAt: string | null;
}

export const DEFAULT_VISITOR_SETTINGS: VisitorSettingsInput = {
  enabled: false,
  consentMode: 'opt_in',
  allowedDomains: [],
  retentionDays: 180,
  createLeads: true,
  enquiryConsentText: null,
  highIntentScore: 50,
  importantPages: DEFAULT_IMPORTANT_PAGES,
};

// Data the script sends.

const utmSchema = z
  .object({
    source: z.string().max(100).optional(),
    medium: z.string().max(100).optional(),
    campaign: z.string().max(100).optional(),
    term: z.string().max(100).optional(),
    content: z.string().max(100).optional(),
  })
  .strict();
export type Utm = z.infer<typeof utmSchema>;

export const trackEventSchema = z.object({
  type: z.enum(['page', 'event', 'engagement']),
  /** Path only. The script drops the query string apart from utm_ parameters, which arrive in `utm`. */
  path: z.string().max(500).regex(/^\//),
  title: z.string().max(200).optional(),
  /** Custom event name (type "event"), for example "pricing_calculator_used". */
  name: z.string().max(60).regex(/^[\w .:-]+$/).optional(),
  referrer: z.string().max(500).optional(),
  utm: utmSchema.optional(),
  /** Seconds the page was visible, sent when the visitor leaves the page (type "engagement"). */
  engagedSeconds: z.number().int().min(0).max(3600).optional(),
});
export type TrackEvent = z.infer<typeof trackEventSchema>;

export const collectSchema = z.object({
  visitorId: z.string().uuid(),
  sessionId: z.string().uuid(),
  events: z.array(trackEventSchema).min(1).max(20),
});

export const enquirySchema = z.object({
  visitorId: z.string().uuid().optional(),
  fullName: z.string().trim().min(1, 'Enter your name').max(120),
  email: z.string().trim().toLowerCase().email('Enter a valid email address').max(254),
  companyName: z.string().trim().max(160).optional(),
  phone: z.string().trim().max(40).optional(),
  message: z.string().trim().max(2000).optional(),
  /** The visitor ticked the marketing consent box. */
  consent: z.boolean().default(false),
  path: z.string().max(500).regex(/^\//).optional(),
  /** Honeypot: real people leave it empty. */
  website: z.string().max(0).optional(),
});
export type Enquiry = z.infer<typeof enquirySchema>;

// Intent

export interface IntentSignal {
  key: string;
  label: string;
  points: number;
}

export interface IntentInput {
  visits: number;
  engagedSeconds: number;
  enquiries: number;
  /** Views per path. */
  pages: { path: string; views: number }[];
  lastSeenAt: Date;
}

export function matchesPage(pattern: string, path: string): boolean {
  const p = path.toLowerCase();
  const pat = pattern.toLowerCase();
  if (pat.endsWith('*')) return p.startsWith(pat.slice(0, -1));
  const base = pat.length > 1 ? pat.replace(/\/$/, '') : pat;
  return p === base || p.startsWith(`${base}/`);
}

export function pageOf(pages: ImportantPage[], path: string): ImportantPage | null {
  return pages.find((pg) => matchesPage(pg.pattern, path)) ?? null;
}

/** Rule-based intent score, 0 to 100, with every point explained. Not a prediction of who will buy. */
export function visitorIntent(input: IntentInput, importantPages: ImportantPage[], now = new Date()): { score: number; signals: IntentSignal[] } {
  const signals: IntentSignal[] = [];
  if (input.enquiries > 0) signals.push({ key: 'enquiry', label: input.enquiries === 1 ? 'Sent an enquiry' : `Sent ${input.enquiries} enquiries`, points: 30 });
  if (input.visits >= 4) signals.push({ key: 'repeat', label: `Visited ${input.visits} times`, points: 20 });
  else if (input.visits >= 2) signals.push({ key: 'repeat', label: `Visited ${input.visits} times`, points: 10 });
  const byPage = new Map<string, { page: ImportantPage; views: number }>();
  for (const v of input.pages) {
    const page = pageOf(importantPages, v.path);
    if (!page || page.weight === 0) continue;
    const cur = byPage.get(page.label) ?? { page, views: 0 };
    cur.views += v.views;
    byPage.set(page.label, cur);
  }
  for (const { page, views } of [...byPage.values()].sort((a, b) => b.page.weight - a.page.weight)) {
    signals.push({ key: `page:${page.label}`, label: views > 1 ? `Viewed ${page.label} (${views} times)` : `Viewed ${page.label}`, points: page.weight });
  }
  if (input.engagedSeconds >= 600) signals.push({ key: 'engaged', label: `${Math.round(input.engagedSeconds / 60)} minutes on the site`, points: 15 });
  else if (input.engagedSeconds >= 180) signals.push({ key: 'engaged', label: `${Math.round(input.engagedSeconds / 60)} minutes on the site`, points: 10 });
  let score = Math.min(100, signals.reduce((a, s) => a + s.points, 0));
  const idleDays = Math.floor((now.getTime() - input.lastSeenAt.getTime()) / 86_400_000);
  if (idleDays > 30 && score > 0) {
    const cut = Math.ceil(score / 2);
    signals.push({ key: 'stale', label: `Last visit ${idleDays} days ago`, points: -cut });
    score -= cut;
  }
  return { score, signals };
}

// Rows

export interface VisitorRef {
  type: 'lead' | 'contact';
  id: string;
  name: string;
  email: string | null;
}

export interface VisitorRow {
  id: string;
  /** "Anonymous visitor" plus a short reference, or the linked lead or contact. */
  label: string;
  identified: VisitorRef | null;
  identifiedVia: 'enquiry' | 'form' | null;
  firstSeenAt: string;
  lastSeenAt: string;
  visits: number;
  pageViews: number;
  engagedSeconds: number;
  intent: { score: number; high: boolean; signals: IntentSignal[] };
  firstTouch: (Utm & { referrer?: string | null }) | null;
  campaign: { id: string; name: string } | null;
  lastPath: string | null;
}

export interface VisitorSession {
  id: string;
  startedAt: string;
  lastAt: string;
  landingPath: string | null;
  referrer: string | null;
  utm: Utm | null;
  engagedSeconds: number;
  events: { type: 'page' | 'event' | 'enquiry'; path: string | null; title: string | null; name: string | null; at: string; kind: PageKind | null; label: string | null }[];
}

export interface VisitorDetail extends VisitorRow {
  sessions: VisitorSession[];
}

export const VISITOR_DASHBOARD_DAYS = [7, 30, 90] as const;

export interface VisitorDashboard {
  days: number;
  enabled: boolean;
  totals: { visitors: number; visits: number; pageViews: number; identified: number; enquiries: number; leadsCreated: number; highIntent: number; returning: number };
  daily: { day: string; visitors: number; visits: number; pageViews: number }[];
  topPages: { path: string; views: number; visitors: number; label: string | null }[];
  importantPages: { label: string; kind: PageKind; views: number; visitors: number }[];
  sources: { source: string; visits: number }[];
  campaigns: { campaign: { id: string; name: string } | null; utmCampaign: string; visits: number; visitors: number; leads: number }[];
  highIntent: VisitorRow[];
}

/** Website activity shown on a lead or contact. */
export interface RecordWebActivity {
  visitors: VisitorDetail[];
}
