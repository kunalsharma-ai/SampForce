import { z } from 'zod';
import { EMAIL_LENGTHS, EMAIL_TONES } from './ai';

/*
 * The AI sales email assistant on the company page (ADR 0077). Emails are always written for the user's own
 * organisation: its name, services and value proposition come from the sales profile in Settings, which the Super
 * Workspace keeps and every Manager and Executive Workspace in the organisation uses. Nothing about the sender is
 * built in.
 */

const line = z.string().trim().min(1).max(160);
const lines = (max: number) => z.array(line).max(max).default([]);

/** PUT /tenants/current/sales-profile. Blank values are allowed: the assistant then says what is missing. */
export const salesProfileSchema = z
  .object({
    /** The name emails are signed for; blank = the workspace name. */
    companyName: z.string().trim().max(160).default(''),
    about: z.string().trim().max(1500).default(''),
    services: lines(30),
    valueProposition: z.string().trim().max(1000).default(''),
    differentiators: lines(15),
    industriesServed: lines(20),
    website: z.union([z.literal(''), z.string().trim().url('Enter a valid web address').max(300)]).default(''),
    /** Added under every draft, for example a phone number or a booking link. */
    signature: z.string().trim().max(600).default(''),
  })
  .strict();
export type SalesProfileInput = z.infer<typeof salesProfileSchema>;

export interface SalesProfile extends SalesProfileInput {
  /** The workspace's own name, used when companyName is blank. */
  workspaceName: string;
  updatedAt: string | null;
  updatedBy: { id: string; name: string } | null;
  /** Whether the caller may change it: tenant:manage in the Super Workspace. */
  editable: boolean;
}

/** What the assistant still needs from the sales profile to write a specific email. */
export function salesProfileGaps(p: Pick<SalesProfileInput, 'services' | 'valueProposition'>): ('services' | 'valueProposition')[] {
  const out: ('services' | 'valueProposition')[] = [];
  if (!p.services.length) out.push('services');
  if (!p.valueProposition.trim()) out.push('valueProposition');
  return out;
}

export const COMPANY_EMAIL_PURPOSES = ['introduction', 'follow_up', 'meeting_request', 'proposal', 're_engagement', 'thank_you', 'event_invitation'] as const;
export type CompanyEmailPurpose = (typeof COMPANY_EMAIL_PURPOSES)[number];
export const COMPANY_EMAIL_PURPOSE_LABELS: Record<CompanyEmailPurpose, string> = {
  introduction: 'First introduction',
  follow_up: 'Follow up',
  meeting_request: 'Ask for a meeting',
  proposal: 'Send a proposal',
  re_engagement: 'Reconnect after a while',
  thank_you: 'Say thank you',
  event_invitation: 'Invite to an event',
};

export const COMPANY_EMAIL_RECIPIENTS = ['decision_maker', 'procurement', 'technical', 'marketing', 'operations', 'general_inbox'] as const;
export type CompanyEmailRecipient = (typeof COMPANY_EMAIL_RECIPIENTS)[number];
export const COMPANY_EMAIL_RECIPIENT_LABELS: Record<CompanyEmailRecipient, string> = {
  decision_maker: 'Decision maker',
  procurement: 'Procurement',
  technical: 'Technical lead',
  marketing: 'Marketing',
  operations: 'Operations',
  general_inbox: 'General inbox',
};

export const COMPANY_EMAIL_CTAS = ['book_call', 'reply', 'share_requirements', 'request_quote', 'visit_website', 'none'] as const;
export type CompanyEmailCta = (typeof COMPANY_EMAIL_CTAS)[number];
export const COMPANY_EMAIL_CTA_LABELS: Record<CompanyEmailCta, string> = {
  book_call: 'Book a short call',
  reply: 'Reply to the email',
  share_requirements: 'Share their requirements',
  request_quote: 'Ask for a quote',
  visit_website: 'Visit our website',
  none: 'No call to action',
};

export const PERSONALISATION_LEVELS = ['light', 'balanced', 'deep'] as const;
export type PersonalisationLevel = (typeof PERSONALISATION_LEVELS)[number];
export const PERSONALISATION_LABELS: Record<PersonalisationLevel, string> = {
  light: 'Light',
  balanced: 'Balanced',
  deep: 'Deep',
};

/** POST /companies/:id/ai-email. */
export const companyEmailRequestSchema = z
  .object({
    purpose: z.enum(COMPANY_EMAIL_PURPOSES).default('introduction'),
    recipientType: z.enum(COMPANY_EMAIL_RECIPIENTS).default('decision_maker'),
    /** An employee of this company to write to; without one the email greets the role, never a made-up name. */
    contactId: z.string().uuid().optional(),
    tone: z.enum(EMAIL_TONES).default('professional'),
    length: z.enum(EMAIL_LENGTHS).default('short'),
    cta: z.enum(COMPANY_EMAIL_CTAS).default('book_call'),
    personalisation: z.enum(PERSONALISATION_LEVELS).default('balanced'),
    /** The sales objective in the person's words, for example "win their 2027 tracking study". */
    objective: z.string().trim().max(500).default(''),
    /** How many follow-up emails to draft after the first one. */
    followUps: z.number().int().min(0).max(3).default(0),
  })
  .strict();
export type CompanyEmailRequest = z.infer<typeof companyEmailRequestSchema>;

export interface CompanyEmailDraft {
  subject: string;
  body: string;
  subjectAlternatives: string[];
  followUps: { waitDays: number; subject: string; body: string }[];
  /** Facts from Business Information and the sales profile the draft relied on. */
  basedOn: string[];
  /** Placeholders to fill and claims to confirm before sending. */
  checkBeforeSending: string[];
  /** Who it is for: the chosen employee, or null when it is written to a role. */
  recipient: {
    contactId: string;
    name: string;
    jobTitle: string | null;
    email: string | null;
    /** They opted out of marketing email: think twice before sending. */
    optedOut: boolean;
    /** Their address bounced or was found invalid. */
    emailProblem: boolean;
  } | null;
  /** The address to send to: the employee's email or the company's main email, if known. */
  to: string | null;
  /** The organisation it is written for, and what its sales profile still lacks. */
  sender: { company: string; gaps: ('services' | 'valueProposition')[] };
  runId: string;
}
