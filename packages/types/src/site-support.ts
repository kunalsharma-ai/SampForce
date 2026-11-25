import { z } from 'zod';

/**
 * Help & Support on the public website (ADR 0078): visitors who are not signed in can send SampForce a message.
 * Messages land in the Console's Support tickets page under "Website messages"; nothing here touches a workspace.
 */
export const SITE_SUPPORT_TOPICS = ['SIGN_IN', 'SIGN_UP', 'BILLING', 'SALES', 'OTHER'] as const;
export type SiteSupportTopic = (typeof SITE_SUPPORT_TOPICS)[number];

export const SITE_SUPPORT_STATUSES = ['NEW', 'HANDLED'] as const;
export type SiteSupportStatus = (typeof SITE_SUPPORT_STATUSES)[number];

export const SITE_SUPPORT_MESSAGE_MAX = 2000;

export const siteSupportRequestSchema = z.object({
  name: z.string().trim().min(1, 'Enter your name').max(120),
  email: z.string().trim().toLowerCase().email('Enter a valid email address').max(254),
  topic: z.enum(SITE_SUPPORT_TOPICS).default('OTHER'),
  message: z.string().trim().min(10, 'Tell us a little more (at least 10 characters)').max(SITE_SUPPORT_MESSAGE_MAX),
  /** The page the visitor was on. */
  pagePath: z.string().trim().max(300).regex(/^\//).nullable().optional(),
  /** Left empty by people; bots fill every field. A filled one is accepted and dropped. */
  website: z.string().max(300).optional(),
});
export type SiteSupportRequestInput = z.input<typeof siteSupportRequestSchema>;

export interface SiteSupportReceipt {
  /** A short reference the visitor can quote, such as "SF-7K2M9Q". */
  reference: string;
}

export const operatorSiteSupportQuerySchema = z.object({
  status: z.enum(SITE_SUPPORT_STATUSES).optional(),
  q: z.string().trim().max(120).optional(),
});

export const operatorSiteSupportUpdateSchema = z.object({ status: z.enum(SITE_SUPPORT_STATUSES) });

export interface SiteSupportRow {
  id: string;
  reference: string;
  name: string;
  email: string;
  topic: SiteSupportTopic;
  message: string;
  pagePath: string | null;
  language: string | null;
  status: SiteSupportStatus;
  handledAt: string | null;
  handledByName: string | null;
  createdAt: string;
}

export interface SiteSupportList {
  rows: SiteSupportRow[];
  counts: Record<SiteSupportStatus, number>;
}
