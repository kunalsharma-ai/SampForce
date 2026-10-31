import { z } from 'zod';

// ───────────── Client self-service portal (enhancement feature 11) ─────────────

const text = (max: number) => z.string().trim().max(max);
const password = z.string().min(10, 'Use at least 10 characters').max(200);

export const PORTAL_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
export const PORTAL_DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;
export const PORTAL_DOCUMENT_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'text/plain',
  'text/csv',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
] as const;

export const portalSettingsSchema = z.object({
  enabled: z.boolean(),
  slug: z.string().trim().toLowerCase().regex(PORTAL_SLUG_PATTERN, 'Use 3 to 40 lowercase letters, numbers and hyphens'),
  title: text(120).nullable(),
  welcome: text(2000).nullable(),
  showDeals: z.boolean(),
  showQuotes: z.boolean(),
  showContracts: z.boolean(),
  showTasks: z.boolean(),
  showDocuments: z.boolean(),
  allowRequests: z.boolean(),
  allowMessages: z.boolean(),
  allowUploads: z.boolean(),
  allowApprovals: z.boolean(),
});
export type PortalSettingsInput = z.infer<typeof portalSettingsSchema>;
export interface PortalSettings extends PortalSettingsInput {
  /** The sign-in address customers use. */
  url: string;
  updatedAt: string | null;
}

export const PORTAL_ROLES = ['viewer', 'approver'] as const;
export type PortalRole = (typeof PORTAL_ROLES)[number];
export const PORTAL_ROLE_LABELS: Record<PortalRole, string> = { viewer: 'Can view and ask', approver: 'Can also approve proposals' };

export const portalInviteSchema = z.object({
  companyId: z.string().uuid(),
  contactId: z.string().uuid().optional(),
  email: z.string().trim().toLowerCase().email('Enter a valid email'),
  name: text(120).min(1, 'Enter a name'),
  role: z.enum(PORTAL_ROLES),
});
export const portalUserUpdateSchema = z.object({ role: z.enum(PORTAL_ROLES).optional(), status: z.enum(['active', 'disabled']).optional() });

export interface PortalUserRow {
  id: string;
  company: { id: string; name: string };
  contact: { id: string; name: string } | null;
  email: string;
  name: string;
  role: PortalRole;
  status: 'invited' | 'active' | 'disabled';
  lastLoginAt: string | null;
  createdAt: string;
}

export const PORTAL_REQUEST_CATEGORIES = ['question', 'support', 'billing', 'change_request'] as const;
export const PORTAL_REQUEST_CATEGORY_LABELS: Record<(typeof PORTAL_REQUEST_CATEGORIES)[number], string> = {
  question: 'Question',
  support: 'Support',
  billing: 'Billing',
  change_request: 'Change request',
};
export const PORTAL_REQUEST_STATUSES = ['open', 'in_progress', 'resolved', 'closed'] as const;
export type PortalRequestStatus = (typeof PORTAL_REQUEST_STATUSES)[number];
export const PORTAL_REQUEST_STATUS_LABELS: Record<PortalRequestStatus, string> = { open: 'Open', in_progress: 'In progress', resolved: 'Resolved', closed: 'Closed' };

export const portalRequestCreateSchema = z.object({
  subject: text(200).min(3, 'Add a short subject'),
  category: z.enum(PORTAL_REQUEST_CATEGORIES),
  body: text(10_000).min(1, 'Describe what you need'),
});
export const portalRequestUpdateSchema = z.object({ status: z.enum(PORTAL_REQUEST_STATUSES).optional(), assignedToId: z.string().uuid().nullable().optional() });
export const portalMessageSchema = z.object({ body: text(10_000).min(1, 'Write a message') });
export const portalDecisionSchema = z.object({ decision: z.enum(['accept', 'decline']), note: text(2000).optional() });

export interface PortalMessageRow {
  id: string;
  body: string;
  /** "customer" for portal users, "team" for workspace members. */
  side: 'customer' | 'team';
  author: string;
  createdAt: string;
}

export interface PortalRequestRow {
  id: string;
  number: number;
  reference: string;
  subject: string;
  category: (typeof PORTAL_REQUEST_CATEGORIES)[number];
  status: PortalRequestStatus;
  company: { id: string; name: string };
  openedBy: string | null;
  assignedTo: { id: string; name: string } | null;
  messageCount: number;
  lastMessageAt: string;
  createdAt: string;
}
export interface PortalRequest extends PortalRequestRow {
  messages: PortalMessageRow[];
}

export interface PortalDocumentRow {
  id: string;
  name: string;
  contentType: string;
  sizeBytes: number;
  uploadedBy: string;
  side: 'customer' | 'team';
  createdAt: string;
}

// What a signed-in customer sees.

export interface PortalBranding {
  slug: string;
  title: string;
  seller: string;
  logoDataUrl: string | null;
  brandColor: string | null;
  welcome: string | null;
}

export interface PortalMe {
  user: { id: string; name: string; email: string; role: PortalRole };
  company: { id: string; name: string };
  accountManager: { name: string; email: string } | null;
  branding: PortalBranding;
  features: Pick<PortalSettingsInput, 'showDeals' | 'showQuotes' | 'showContracts' | 'showTasks' | 'showDocuments' | 'allowRequests' | 'allowMessages' | 'allowUploads' | 'allowApprovals'>;
  unreadUpdates: number;
}

export interface PortalDashboard {
  deals: { id: string; name: string; stage: string; status: 'OPEN' | 'WON' | 'LOST'; expectedCloseDate: string | null; progress: number }[];
  proposals: { id: string; reference: string; title: string; status: string; total: number; currency: string; validUntil: string | null; canDecide: boolean; decidedAt: string | null }[];
  contracts: { id: string; name: string; status: string; startDate: string; endDate: string | null; value: number; currency: string }[];
  milestones: { id: string; title: string; dueAt: string | null; done: boolean; deal: string | null }[];
  updates: { id: string; kind: string; title: string; body: string | null; createdAt: string; unread: boolean }[];
  openRequests: number;
  /** Invoices are not connected to DealFlow yet, so the portal says so instead of showing nothing. */
  invoices: 'not_connected';
}

export const portalLoginSchema = z.object({ email: z.string().trim().toLowerCase().email('Enter a valid email'), password: z.string().min(1, 'Enter your password').max(200) });
export const portalAcceptSchema = z.object({ token: z.string().min(20).max(200), password });
export const portalForgotSchema = z.object({ email: z.string().trim().toLowerCase().email('Enter a valid email') });
export const portalResetSchema = z.object({ token: z.string().min(20).max(200), password });
