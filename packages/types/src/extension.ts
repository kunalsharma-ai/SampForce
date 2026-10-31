import { z } from 'zod';

/**
 * The DealFlow browser extension (Phase 9). It signs in with its own revocable connection token,
 * never with the web app's cookies, and can only reach the /extension routes.
 */

export const EXTENSION_TOKEN_PREFIX = 'dfx_';
/** How long a connection lasts before the person reconnects. */
export const EXTENSION_TOKEN_DAYS = 90;
export const MAX_EXTENSION_TOKENS = 5;
/** What an extension token can do, at most. The person's role still has to allow each one. */
export const EXTENSION_SCOPES = ['leads:read', 'leads:write', 'contacts:read', 'companies:read', 'sequences:read', 'sequences:write', 'prospects:read', 'prospects:write', 'prospects:search'] as const;
export const EXTENSION_USER_AGENT = 'DealFlow browser extension';

/**
 * Free and personal mailbox providers. Addresses at these domains are never captured automatically:
 * they belong to private individuals rather than to a company. People can still save one by hand.
 */
export const PERSONAL_EMAIL_DOMAINS = [
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.in', 'yahoo.co.uk', 'ymail.com', 'rocketmail.com',
  'outlook.com', 'hotmail.com', 'hotmail.co.uk', 'live.com', 'msn.com', 'icloud.com', 'me.com', 'mac.com',
  'aol.com', 'proton.me', 'protonmail.com', 'pm.me', 'gmx.com', 'gmx.de', 'gmx.net', 'web.de', 'mail.com',
  'yandex.com', 'yandex.ru', 'mail.ru', 'qq.com', '163.com', '126.com', 'rediffmail.com', 'zohomail.com',
  'fastmail.com', 'tutanota.com', 'hey.com', 'naver.com', 'orange.fr', 'free.fr', 'libero.it', 't-online.de',
] as const;
const PERSONAL = new Set<string>(PERSONAL_EMAIL_DOMAINS);

export function emailDomain(email: string): string {
  return email.slice(email.lastIndexOf('@') + 1).toLowerCase();
}

export function isPersonalEmail(email: string): boolean {
  return PERSONAL.has(emailDomain(email));
}

/** Turns a site address or URL into its bare host name: "https://www.acme.com/about" → "acme.com". */
export function siteDomain(input: string | null | undefined): string | null {
  if (!input) return null;
  try {
    const host = new URL(/^[a-z]+:\/\//i.test(input) ? input : `https://${input}`).hostname.toLowerCase();
    return host.replace(/^www\./, '') || null;
  } catch {
    return null;
  }
}

export const extensionTokenCreateSchema = z.object({
  name: z.string().trim().min(1, 'Name this connection').max(60),
});
export type ExtensionTokenCreateInput = z.infer<typeof extensionTokenCreateSchema>;

/** Signing in from the extension with DealFlow credentials (same lockout and second-factor rules as the web app). */
export const extensionLoginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter your work email').max(254),
  password: z.string().min(1, 'Enter your password').max(200),
  name: z.string().trim().min(1).max(60).default('Browser extension'),
});
export const extensionLoginMfaSchema = z.object({
  challenge: z.string().min(10).max(2000),
  code: z.string().trim().min(6).max(32),
  name: z.string().trim().min(1).max(60).default('Browser extension'),
});

export interface ExtensionTokenRow {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string;
}

export interface ExtensionTokenCreated {
  /** Shown once. Only a hash is stored. */
  token: string;
  connection: ExtensionTokenRow;
}

export interface ExtensionMe {
  user: { id: string; name: string; email: string };
  workspace: { id: string; name: string };
  canSave: boolean;
  canEnroll: boolean;
  /** Whether the person has a connected mailbox, which enrolling needs. */
  mailboxConnected: boolean;
  sequences: { id: string; name: string }[];
  /** Prospect discovery (Part 2): what this person's role allows from the extension. */
  prospects: { canRead: boolean; canSave: boolean; canSearch: boolean };
}

const email = z.string().trim().toLowerCase().email().max(254);

export const extensionLookupSchema = z.object({
  emails: z.array(email).max(50).default([]),
  /** The site the person is looking at, to find the company already in DealFlow. */
  website: z.string().trim().max(2000).optional(),
});
export type ExtensionLookupInput = z.infer<typeof extensionLookupSchema>;

export type ExtensionMatch = { entity: 'lead' | 'contact'; id: string; label: string };

export interface ExtensionLookupResult {
  people: { email: string; match: ExtensionMatch | null; suppressed: boolean; personal: boolean }[];
  company: { id: string; name: string } | null;
}

export const extensionCaptureSchema = z.object({
  people: z
    .array(
      z.object({
        email,
        fullName: z.string().trim().max(200).optional(),
        jobTitle: z.string().trim().max(160).optional(),
      }),
    )
    .min(1, 'Choose at least one address')
    .max(25, 'Save up to 25 people at a time'),
  companyName: z.string().trim().max(200).optional(),
  website: z.string().trim().max(253).optional(),
  sourceUrl: z.string().trim().url().max(2000),
  sequenceId: z.string().uuid().optional(),
  /** Set by automatic capture: personal addresses are skipped and the leads are tagged. */
  auto: z.boolean().default(false),
});
export type ExtensionCaptureInput = z.infer<typeof extensionCaptureSchema>;

export type CaptureOutcome = 'created' | 'existing' | 'skipped';
export type CaptureSkipReason = 'personal' | 'suppressed';
export const CAPTURE_SKIP_LABELS: Record<CaptureSkipReason, string> = {
  personal: 'personal address, not captured automatically',
  suppressed: 'on the do-not-email list',
};

export interface ExtensionCaptureResult {
  results: {
    email: string;
    outcome: CaptureOutcome;
    reason?: CaptureSkipReason;
    match?: ExtensionMatch;
  }[];
  /** Present when a sequence was chosen. */
  enrollment?: { enrolled: number; skipped: { name: string; reason: string }[] };
}

/** A readable name from an address when the page gave none: "jane.doe@acme.com" → "Jane Doe". */
export function nameFromEmail(address: string): string {
  const local = address.slice(0, address.indexOf('@'));
  const parts = local.split(/[._-]+/).filter((p) => /^[a-z]{2,}$/i.test(p));
  if (!parts.length || ROLE_MAILBOXES.has(local.toLowerCase())) return address;
  return parts.map((p) => p[0]!.toUpperCase() + p.slice(1).toLowerCase()).join(' ');
}

const ROLE_MAILBOXES = new Set(['info', 'sales', 'contact', 'hello', 'support', 'admin', 'office', 'team', 'enquiries', 'inquiries', 'marketing', 'press', 'media', 'careers', 'jobs', 'hr', 'billing', 'help', 'service', 'privacy', 'legal', 'noreply', 'no-reply']);

// ───── Prospect discovery from the extension (Part 2) ─────

export const extensionDiscoverSchema = z.object({
  /** The company website being viewed. */
  domain: z.string().trim().toLowerCase().min(3).max(253),
  titles: z.array(z.string().trim().max(80)).max(10).default([]),
  page: z.number().int().min(1).max(50).default(1),
});

export const extensionProspectImportSchema = z.object({
  people: z.array(z.object({
    providerId: z.string().max(100),
    fullName: z.string().trim().max(160),
    firstName: z.string().max(80).nullable(),
    lastName: z.string().max(80).nullable(),
    title: z.string().max(160).nullable(),
    companyName: z.string().max(160).nullable(),
    domain: z.string().max(253).nullable(),
    industry: z.string().max(120).nullable(),
    country: z.string().max(80).nullable(),
    companySize: z.enum(['1-10', '11-50', '51-200', '201-500', '501-1000', '1001-5000', '5001+']).nullable(),
    email: z.string().email().max(254).nullable(),
    emailStatus: z.enum(['valid', 'risky', 'catch_all', 'invalid', 'unknown', 'bounced', 'needs_verification']).nullable(),
    sample: z.boolean(),
  })).min(1, 'Choose at least one person').max(25, 'Import up to 25 people at a time'),
  revealEmails: z.boolean().default(true),
  /** A prospect list (existing, or a new one by name), or straight into the CRM as leads. */
  destination: z.discriminatedUnion('type', [
    z.object({ type: z.literal('list'), listId: z.string().uuid() }),
    z.object({ type: z.literal('new_list'), name: z.string().trim().min(1).max(120) }),
    z.object({ type: z.literal('crm'), sequenceId: z.string().uuid().optional() }),
  ]),
  sourceUrl: z.string().trim().url().max(2000),
});

export interface ExtensionProspectImportResult {
  destination: { type: 'list'; id: string; name: string } | { type: 'crm' };
  results: { providerId: string; name: string; outcome: 'added' | 'duplicate' | 'existing' | 'skipped' | 'failed'; reason?: string; email?: string | null }[];
  enrollment?: { enrolled: number; skipped: { name: string; reason: string }[] };
  usage: { used: number; limit: number };
}
