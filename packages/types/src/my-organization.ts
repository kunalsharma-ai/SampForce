import { z } from 'zod';
import { socialLinkSchema, type SocialLink } from './company-enrichment';

/*
 * My Organization (ADR 0100): the organisation's own company record, its documents, credentials and the links that
 * share approved parts of it with clients. There is one record per organisation; every workspace reads the same one.
 *
 * Who does what is worked out on the server from the caller's workspace level and the actions its workspace was handed
 * down for the Administration module (the Permission Center), never from the screen:
 *  - everyone in the organisation views the profile and the documents meant for every workspace;
 *  - editing needs Edit on Administration: the Super Workspace always, Manager Workspaces by default, Executive
 *    Workspaces only when the workspace above grants it;
 *  - deleting needs Delete on Administration (off below the Super Workspace until it is turned on) and the password;
 *  - credentials are seen by the Super Workspace, and by Manager Workspaces only for credentials marked for them.
 *    Executives never see them, and they are never part of a client share.
 */

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional();
const day = z
  .string()
  .trim()
  .transform((v) => (v === '' ? null : v))
  .pipe(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').nullable())
  .nullable()
  .optional();
const country = z
  .string()
  .trim()
  .toUpperCase()
  .transform((v) => (v === '' ? null : v))
  .pipe(z.string().regex(/^[A-Z]{2}$/, 'Pick a country').nullable())
  .nullable()
  .optional();
const webUrl = z
  .string()
  .trim()
  .min(1, 'Enter a web address')
  .max(500)
  .transform((v) => (/^[a-z][a-z0-9+.-]*:\/\//i.test(v) ? v : `https://${v}`))
  .pipe(z.string().url('Enter a valid web address').refine((v) => /^https?:\/\//i.test(v), 'Use an http or https address'));
const optionalWebUrl = z
  .string()
  .trim()
  .max(500)
  .transform((v) => (v === '' ? null : /^[a-z][a-z0-9+.-]*:\/\//i.test(v) ? v : `https://${v}`))
  .pipe(z.string().url('Enter a valid web address').refine((v) => /^https?:\/\//i.test(v), 'Use an http or https address').nullable())
  .nullable()
  .optional();
const textList = (max: number, items = 60) =>
  z
    .array(z.string().trim().max(max))
    .max(items)
    .transform((list) => [...new Map(list.filter(Boolean).map((v) => [v.toLowerCase(), v])).values()])
    .optional();
const email = z.string().trim().toLowerCase().max(254).email('Enter a valid email');
const phone = z.string().trim().max(40).regex(/^\+?[0-9 ().-]{6,}$/, 'Enter a valid phone number');

// ───────────── Profile ─────────────

/** Parts of the profile a client can be shown. Everything else stays inside the organisation. */
export const ORG_SHARE_SECTIONS = ['overview', 'services', 'contact', 'addresses', 'links', 'registration', 'tax', 'key_contacts'] as const;
export type OrgShareSection = (typeof ORG_SHARE_SECTIONS)[number];
export const ORG_SHARE_SECTION_LABELS: Record<OrgShareSection, string> = {
  overview: 'Company overview',
  services: 'Services and industries',
  contact: 'Phone numbers and emails',
  addresses: 'Office addresses',
  links: 'Website and social links',
  registration: 'Registration and incorporation',
  tax: 'Tax and business IDs',
  key_contacts: 'Key contact persons',
};
/** What a new profile shares with clients until someone changes it: the public-facing parts only. */
export const DEFAULT_SHARED_SECTIONS: OrgShareSection[] = ['overview', 'services', 'contact', 'addresses', 'links'];

export const orgAddressSchema = z.object({
  label: text(60),
  country,
  state: text(120),
  city: text(120),
  address: text(500),
  postalCode: text(20),
});
export type OrgAddress = z.infer<typeof orgAddressSchema>;

export const orgLabelledValueSchema = z.object({ label: z.string().trim().min(1, 'Name it').max(80), value: z.string().trim().min(1, 'Enter a value').max(500) });
export type OrgLabelledValue = z.infer<typeof orgLabelledValueSchema>;

export const orgPhoneSchema = z.object({ value: phone, label: text(60) });
export const orgEmailSchema = z.object({ value: email, label: text(60) });
export const orgWebsiteLinkSchema = z.object({ label: z.string().trim().min(1, 'Name the link').max(80), url: webUrl });
export type OrgWebsiteLink = z.infer<typeof orgWebsiteLinkSchema>;

export const orgKeyContactSchema = z.object({
  name: z.string().trim().min(1, 'Enter a name').max(160),
  designation: text(160),
  department: text(120),
  email: email.nullable().optional().or(z.literal('').transform(() => null)),
  phone: phone.nullable().optional().or(z.literal('').transform(() => null)),
});
export type OrgKeyContact = z.infer<typeof orgKeyContactSchema>;

const year = z.number().int().min(1800, 'Enter a year from 1800').max(2100, 'Enter a year up to 2100');

/** Saving the profile: every field may be left out (kept as it is); the brand name is needed the first time. */
export const orgProfileInputSchema = z
  .object({
    brandName: z.string().trim().min(1, 'Enter your company name').max(200),
    legalName: text(200),
    tagline: text(200),
    description: text(5000),
    businessActivities: text(5000),
    services: textList(160),
    products: textList(160),
    industriesServed: textList(120),
    certifications: textList(160),
    companyType: text(80),
    companySize: text(40),
    employeeCount: z.number().int().min(1).max(10_000_000).nullable().optional(),
    foundedYear: year.nullable().optional(),
    incorporationDate: day,
    incorporationCountry: country,
    registrationNumber: text(120),
    registrationAuthority: text(200),
    taxIds: z.array(orgLabelledValueSchema).max(30).optional(),
    registeredAddress: orgAddressSchema.nullable().optional(),
    offices: z.array(orgAddressSchema).max(50).optional(),
    phones: z.array(orgPhoneSchema).max(20).optional(),
    emails: z.array(orgEmailSchema).max(20).optional(),
    website: optionalWebUrl,
    websiteLinks: z.array(orgWebsiteLinkSchema).max(60).optional(),
    socialLinks: z.array(socialLinkSchema).max(20).optional(),
    keyContacts: z.array(orgKeyContactSchema).max(50).optional(),
    moreDetails: z.array(orgLabelledValueSchema).max(60).optional(),
    brandColors: z
      .array(z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, 'Use a colour like #E8590C'))
      .max(8)
      .optional(),
    sharedSections: z.array(z.enum(ORG_SHARE_SECTIONS)).max(ORG_SHARE_SECTIONS.length).optional(),
  })
  .partial({ brandName: true })
  .strict();
export type OrgProfileInput = z.infer<typeof orgProfileInputSchema>;

/** What the caller may do in My Organization, worked out on the server. */
export interface OrgAccess {
  level: 'SUPER' | 'MANAGER' | 'EXECUTIVE';
  canEdit: boolean;
  canDelete: boolean;
  /** Add, change and remove credentials. */
  canManageCredentials: boolean;
  /** See the list of credentials (each one still has its own audience). */
  canSeeCredentials: boolean;
  /** Share approved items with clients. */
  canShare: boolean;
}

export interface OrgProfile {
  /** False until someone saves the profile for the first time. */
  exists: boolean;
  brandName: string;
  legalName: string | null;
  tagline: string | null;
  description: string | null;
  businessActivities: string | null;
  services: string[];
  products: string[];
  industriesServed: string[];
  certifications: string[];
  companyType: string | null;
  companySize: string | null;
  employeeCount: number | null;
  foundedYear: number | null;
  incorporationDate: string | null;
  incorporationCountry: string | null;
  registrationNumber: string | null;
  registrationAuthority: string | null;
  taxIds: OrgLabelledValue[];
  registeredAddress: OrgAddress | null;
  offices: OrgAddress[];
  phones: { value: string; label: string | null }[];
  emails: { value: string; label: string | null }[];
  website: string | null;
  websiteLinks: OrgWebsiteLink[];
  socialLinks: SocialLink[];
  keyContacts: OrgKeyContact[];
  moreDetails: OrgLabelledValue[];
  brandColors: string[];
  sharedSections: OrgShareSection[];
  /** Versioned image address, or null for the monogram. */
  logoUrl: string | null;
  /** How complete the profile is, 0-100, from the fields that matter most. */
  completeness: number;
  /** The fields counted as missing for `completeness`, in the order they are worth filling. */
  missing: string[];
  updatedAt: string | null;
  updatedBy: { id: string; name: string } | null;
}

export interface OrgOverview {
  profile: OrgProfile;
  access: OrgAccess;
  documents: { total: number; shareable: number; expiringSoon: number; expired: number; byCategory: Partial<Record<OrgDocumentCategory, number>> };
  /** Null when the caller may not see credentials. */
  credentials: number | null;
  shares: { active: number };
}

/** The profile fields that count towards completeness, with the label shown for a missing one. */
type CompletenessKey = 'brandName' | 'legalName' | 'logoUrl' | 'description' | 'services' | 'website' | 'emails' | 'phones' | 'registeredAddress' | 'registrationNumber' | 'incorporationDate' | 'taxIds' | 'socialLinks' | 'keyContacts';
export const ORG_COMPLETENESS_FIELDS: [CompletenessKey, string][] = [
  ['brandName', 'Company name'],
  ['legalName', 'Legal name'],
  ['logoUrl', 'Logo'],
  ['description', 'Company description'],
  ['services', 'Services'],
  ['website', 'Website'],
  ['emails', 'Official email'],
  ['phones', 'Phone number'],
  ['registeredAddress', 'Registered office'],
  ['registrationNumber', 'Registration number'],
  ['incorporationDate', 'Incorporation date'],
  ['taxIds', 'Tax ID'],
  ['socialLinks', 'Social links'],
  ['keyContacts', 'Key contacts'],
];

export function orgCompleteness(p: Pick<OrgProfile, CompletenessKey>): { completeness: number; missing: string[] } {
  const missing: string[] = [];
  for (const [key, label] of ORG_COMPLETENESS_FIELDS) {
    const v = p[key] as unknown;
    const filled = Array.isArray(v) ? v.length > 0 : v && typeof v === 'object' ? Object.values(v as Record<string, unknown>).some((x) => x && x !== '') : !!v;
    if (!filled) missing.push(label);
  }
  return { completeness: Math.round(((ORG_COMPLETENESS_FIELDS.length - missing.length) / ORG_COMPLETENESS_FIELDS.length) * 100), missing };
}

// ───────────── Documents ─────────────

export const ORG_DOCUMENT_CATEGORIES = ['registration', 'tax', 'certification', 'membership', 'credential', 'presentation', 'service_profile', 'legal', 'financial', 'brand', 'other'] as const;
export type OrgDocumentCategory = (typeof ORG_DOCUMENT_CATEGORIES)[number];
export const ORG_DOCUMENT_CATEGORY_LABELS: Record<OrgDocumentCategory, string> = {
  registration: 'Registration certificates',
  tax: 'Tax documents',
  certification: 'ISO and quality certificates',
  membership: 'Memberships',
  credential: 'Business credentials',
  presentation: 'Company presentations',
  service_profile: 'Service profiles',
  legal: 'Legal and policies',
  financial: 'Financial documents',
  brand: 'Brand assets',
  other: 'Other documents',
};

export const ORG_DOCUMENT_VISIBILITIES = ['ALL', 'MANAGERS', 'SUPER'] as const;
export type OrgDocumentVisibility = (typeof ORG_DOCUMENT_VISIBILITIES)[number];
export const ORG_DOCUMENT_VISIBILITY_LABELS: Record<OrgDocumentVisibility, string> = {
  ALL: 'Every workspace',
  MANAGERS: 'Super and Manager Workspaces',
  SUPER: 'Super Workspace only',
};

/** Files a document may hold: those a browser can show (PDF, images, text) and office files to download. */
export const ORG_DOCUMENT_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'text/plain',
  'text/csv',
  'application/msword',
  'application/vnd.ms-excel',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/zip',
] as const;
/** Each file version is one MongoDB document, which holds at most 16 MB, so files stop at 15 MB. */
export const ORG_DOCUMENT_MAX_BYTES = 15 * 1024 * 1024;
/** Types the browser can show inside the page. */
export const ORG_PREVIEW_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'text/plain', 'text/csv'];
export const ORG_LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'] as const;
export const ORG_LOGO_MAX_BYTES = 2 * 1024 * 1024;
/** A document is "expiring soon" this many days before its expiry date. */
export const ORG_EXPIRY_WARNING_DAYS = 30;

export const orgDocumentMetaSchema = z
  .object({
    title: z.string().trim().min(1, 'Give the document a title').max(200),
    category: z.enum(ORG_DOCUMENT_CATEGORIES),
    description: text(2000),
    issuer: text(200),
    referenceNumber: text(120),
    issueDate: day,
    expiryDate: day,
    tags: textList(40, 20),
    visibility: z.enum(ORG_DOCUMENT_VISIBILITIES).optional(),
    clientShareable: z.boolean().optional(),
  })
  .strict()
  .refine((d) => !d.issueDate || !d.expiryDate || d.expiryDate >= d.issueDate, { message: 'The expiry date must be after the issue date', path: ['expiryDate'] });
export type OrgDocumentMeta = z.infer<typeof orgDocumentMetaSchema>;

export const orgDocumentUpdateSchema = z
  .object({
    title: z.string().trim().min(1, 'Give the document a title').max(200).optional(),
    category: z.enum(ORG_DOCUMENT_CATEGORIES).optional(),
    description: text(2000),
    issuer: text(200),
    referenceNumber: text(120),
    issueDate: day,
    expiryDate: day,
    tags: textList(40, 20),
    visibility: z.enum(ORG_DOCUMENT_VISIBILITIES).optional(),
    clientShareable: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Change at least one thing')
  .refine((d) => !d.issueDate || !d.expiryDate || d.expiryDate >= d.issueDate, { message: 'The expiry date must be after the issue date', path: ['expiryDate'] });
export type OrgDocumentUpdate = z.infer<typeof orgDocumentUpdateSchema>;

export const ORG_EXPIRY_STATUSES = ['none', 'valid', 'expiring', 'expired'] as const;
export type OrgExpiryStatus = (typeof ORG_EXPIRY_STATUSES)[number];

export const orgDocumentQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  category: z.enum(ORG_DOCUMENT_CATEGORIES).optional(),
  expiry: z.enum(ORG_EXPIRY_STATUSES).optional(),
  shareable: z.enum(['true', 'false']).optional(),
  sort: z.enum(['recent', 'title', 'expiry']).optional(),
});
export type OrgDocumentQuery = z.infer<typeof orgDocumentQuerySchema>;

/** How a document's expiry date stands on `today` (YYYY-MM-DD). */
export function orgExpiryStatus(expiryDate: string | null | undefined, today: string): { status: OrgExpiryStatus; daysLeft: number | null } {
  if (!expiryDate) return { status: 'none', daysLeft: null };
  const days = Math.round((Date.parse(`${expiryDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  if (days < 0) return { status: 'expired', daysLeft: days };
  if (days <= ORG_EXPIRY_WARNING_DAYS) return { status: 'expiring', daysLeft: days };
  return { status: 'valid', daysLeft: days };
}

export interface OrgDocumentVersionRow {
  id: string;
  version: number;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  note: string | null;
  uploadedBy: { id: string; name: string } | null;
  createdAt: string;
}

export interface OrgDocumentRow {
  id: string;
  title: string;
  category: OrgDocumentCategory;
  description: string | null;
  issuer: string | null;
  referenceNumber: string | null;
  issueDate: string | null;
  expiryDate: string | null;
  expiry: OrgExpiryStatus;
  daysLeft: number | null;
  tags: string[];
  visibility: OrgDocumentVisibility;
  clientShareable: boolean;
  approvedBy: { id: string; name: string } | null;
  approvedAt: string | null;
  /** The current file. */
  file: { version: number; fileName: string; contentType: string; sizeBytes: number; previewable: boolean };
  versionCount: number;
  createdBy: { id: string; name: string } | null;
  updatedBy: { id: string; name: string } | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrgDocumentDetail extends OrgDocumentRow {
  versions: OrgDocumentVersionRow[];
}

// ───────────── Credentials ─────────────

export const ORG_CREDENTIAL_KINDS = ['portal_login', 'tax_portal', 'government_portal', 'membership_id', 'licence', 'bank', 'software', 'other'] as const;
export type OrgCredentialKind = (typeof ORG_CREDENTIAL_KINDS)[number];
export const ORG_CREDENTIAL_KIND_LABELS: Record<OrgCredentialKind, string> = {
  portal_login: 'Portal login',
  tax_portal: 'Tax portal',
  government_portal: 'Government portal',
  membership_id: 'Membership ID',
  licence: 'Licence number',
  bank: 'Bank details',
  software: 'Software account',
  other: 'Other credential',
};
export const ORG_CREDENTIAL_ACCESS = ['SUPER', 'MANAGERS'] as const;
export type OrgCredentialAccess = (typeof ORG_CREDENTIAL_ACCESS)[number];
export const ORG_CREDENTIAL_ACCESS_LABELS: Record<OrgCredentialAccess, string> = {
  SUPER: 'Super Workspace only',
  MANAGERS: 'Super and Manager Workspaces',
};

export const orgCredentialInputSchema = z
  .object({
    label: z.string().trim().min(1, 'Name the credential').max(160),
    kind: z.enum(ORG_CREDENTIAL_KINDS),
    url: optionalWebUrl,
    username: text(200),
    /** Sealed on the server; never sent back except through "Reveal". Empty keeps the stored one on an edit. */
    secret: z.string().max(2000).optional(),
    notes: text(2000),
    access: z.enum(ORG_CREDENTIAL_ACCESS).optional(),
  })
  .strict();
export type OrgCredentialInput = z.infer<typeof orgCredentialInputSchema>;
export const orgCredentialUpdateSchema = orgCredentialInputSchema
  .partial()
  .extend({ clearSecret: z.boolean().optional() })
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Change at least one thing');
export type OrgCredentialUpdate = z.infer<typeof orgCredentialUpdateSchema>;

export interface OrgCredentialRow {
  id: string;
  label: string;
  kind: OrgCredentialKind;
  url: string | null;
  username: string | null;
  hasSecret: boolean;
  hasNotes: boolean;
  access: OrgCredentialAccess;
  lastRevealedAt: string | null;
  updatedBy: { id: string; name: string } | null;
  updatedAt: string;
}

export interface OrgCredentialSecret {
  secret: string | null;
  notes: string | null;
}

// ───────────── Sharing with clients ─────────────

export const ORG_SHARE_MAX_DAYS = 30;

export const orgShareInputSchema = z
  .object({
    documentIds: z.array(z.string().uuid()).max(50).default([]),
    includeProfile: z.boolean().default(true),
    recipientName: text(160),
    recipientEmail: email.nullable().optional().or(z.literal('').transform(() => null)),
    /** The client company in the CRM this goes to, for the activity history. */
    companyId: z.string().uuid().nullable().optional(),
    message: text(1000),
    expiresInDays: z.number().int().min(1).max(ORG_SHARE_MAX_DAYS).default(7),
  })
  .strict()
  .refine((v) => v.includeProfile || v.documentIds.length > 0, 'Choose the profile or at least one document to share');
export type OrgShareInput = z.input<typeof orgShareInputSchema>;

export interface OrgShareRow {
  id: string;
  /** Only returned when the share is created: the link is not stored, only proven. */
  url?: string;
  includeProfile: boolean;
  documents: { id: string; title: string }[];
  recipientName: string | null;
  recipientEmail: string | null;
  company: { id: string; name: string } | null;
  message: string | null;
  expiresAt: string;
  revokedAt: string | null;
  status: 'active' | 'expired' | 'revoked';
  views: number;
  lastViewedAt: string | null;
  createdBy: { id: string; name: string } | null;
  createdAt: string;
}

/** What a client sees on a share link: only approved sections and approved documents. */
export interface OrgSharedView {
  organization: Partial<Omit<OrgProfile, 'exists' | 'completeness' | 'missing' | 'updatedAt' | 'updatedBy' | 'sharedSections'>> & { brandName: string; logoUrl: string | null };
  sections: OrgShareSection[];
  documents: { id: string; title: string; category: OrgDocumentCategory; description: string | null; issueDate: string | null; expiryDate: string | null; fileName: string; contentType: string; sizeBytes: number }[];
  message: string | null;
  recipientName: string | null;
  sharedBy: string | null;
  expiresAt: string;
}

// ───────────── Activity history ─────────────

export const ORG_ACTIVITY_LABELS: Record<string, string> = {
  'organization.profile_created': 'Created the organization profile',
  'organization.profile_updated': 'Updated the organization profile',
  'organization.logo_uploaded': 'Uploaded a new logo',
  'organization.logo_removed': 'Removed the logo',
  'organization.document_uploaded': 'Uploaded a document',
  'organization.document_updated': 'Edited a document',
  'organization.document_replaced': 'Replaced a document with a new version',
  'organization.document_approved': 'Approved a document for clients',
  'organization.document_unapproved': 'Withdrew a document from clients',
  'organization.document_deleted': 'Deleted a document',
  'organization.document_downloaded': 'Downloaded a document',
  'organization.credential_added': 'Added a credential',
  'organization.credential_updated': 'Changed a credential',
  'organization.credential_revealed': 'Revealed a credential',
  'organization.credential_deleted': 'Deleted a credential',
  'organization.shared': 'Shared with a client',
  'organization.share_revoked': 'Stopped a client share',
  'organization.share_viewed': 'A client opened a share',
};

export interface OrgActivityRow {
  id: string;
  action: string;
  label: string;
  actor: { id: string; name: string } | null;
  /** The document, credential or share it was about, by name. */
  subject: string | null;
  details: Record<string, unknown>;
  createdAt: string;
}
