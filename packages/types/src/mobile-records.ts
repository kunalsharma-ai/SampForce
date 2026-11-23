import { z } from 'zod';
import type { MobileRecordModule } from './mobile-config';

/*
 * Records on the phone (ADR 0072, M4). The phone reads and writes leads, contacts, follow-ups and tasks through
 * /mobile/records/<module>, by the field names of MOBILE_FIELDS. The server narrows every record to the fields the
 * person may see and refuses writes to fields they may not set (apps/api/src/mobile/field-policy.ts).
 */

/** The modules the phone can work with records in so far. Deals follow in a later part. */
export const MOBILE_RECORD_MODULES_LIVE = ['companies', 'contacts', 'follow_ups', 'tasks'] as const satisfies readonly MobileRecordModule[];
export type MobileLiveRecordModule = (typeof MOBILE_RECORD_MODULES_LIVE)[number];

/** A reference to another record or a person, as the phone shows it. */
export interface MobileRef {
  id: string;
  name: string;
}

/** A status with its colour (lead and contact statuses from CRM configuration). */
export interface MobileStatusRef extends MobileRef {
  color: string;
}

/**
 * One record as the phone receives it: `id`, `updatedAt` and only the fields this person may see, by their
 * MOBILE_FIELDS names. References come as {id, name}; custom fields under `customFields` by their key.
 */
export type MobileRecord = { id: string; updatedAt?: string; customFields?: Record<string, unknown> } & Record<string, unknown>;

export interface MobileRecordPage {
  items: MobileRecord[];
  page: number;
  hasMore: boolean;
}

export const mobileRecordListQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  /** Follow-ups: which list (the same buckets as on the web). */
  bucket: z.enum(['today', 'upcoming', 'overdue', 'completed']).optional(),
  /** Tasks: open or done. */
  status: z.enum(['OPEN', 'DONE']).optional(),
  /** Follow-ups: the phone's time zone, for "today". */
  tz: z.string().max(64).optional(),
  /** Contacts and follow-ups of one company. */
  companyId: z.string().uuid().optional(),
});
export type MobileRecordListQuery = z.infer<typeof mobileRecordListQuerySchema>;

/**
 * A create or edit from the phone: field names as in MOBILE_FIELDS, references as ids, custom fields under
 * `customFields`. Values are checked twice: against the person's field rules, then by the CRM's own validation.
 */
export const mobileRecordWriteSchema = z
  .record(z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,60}$/), z.unknown())
  .refine((v) => Object.keys(v).length > 0, 'Change at least one field')
  .refine((v) => Object.keys(v).length <= 80, 'Too many fields');
export type MobileRecordWrite = z.infer<typeof mobileRecordWriteSchema>;

export const mobileFollowUpCompleteSchema = z.object({ outcome: z.string().trim().max(500).optional() }).strict();

/** Choices for the phone's pickers. */
export interface MobileRecordOptions {
  companyStatuses: MobileStatusRef[];
  contactStatuses: MobileStatusRef[];
  followUpTypes: { key: string; label: string }[];
  people: MobileRef[];
}
