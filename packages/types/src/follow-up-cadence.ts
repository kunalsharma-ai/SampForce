import { z } from 'zod';

/*
 * The follow-up cadence (redesign R3, ADR 0083). Every new employee of a company starts in Fresh Email Pending. When the
 * first email reaches them (sent from SampForce, synced from the mailbox, logged as an interaction, or marked by hand)
 * they move to Initial Email Sent and follow-up 1 is planned. Completing a follow-up plans the next one, until the
 * Super Workspace's number of follow-ups is reached. A reply, a call, an RFQ or any later stage stops the cadence.
 */

export const CADENCE_MAX_FOLLOW_UPS = 20;
export const CADENCE_MAX_INTERVAL_DAYS = 90;

export interface FollowUpCadence {
  /** How many follow-ups after the initial email. */
  followUps: number;
  /** Days between the initial email and follow-up 1, and between follow-ups. */
  intervalDays: number;
}

export const DEFAULT_FOLLOW_UP_CADENCE: FollowUpCadence = { followUps: 5, intervalDays: 7 };

export const followUpCadenceSchema = z
  .object({
    followUps: z.number().int().min(1).max(CADENCE_MAX_FOLLOW_UPS),
    intervalDays: z.number().int().min(1).max(CADENCE_MAX_INTERVAL_DAYS),
  })
  .strict();

/** Reads a stored value, falling back to the default for anything missing or out of range. */
export function parseFollowUpCadence(stored: unknown): FollowUpCadence {
  const o = (stored && typeof stored === 'object' ? stored : {}) as Record<string, unknown>;
  const r = followUpCadenceSchema.safeParse({ followUps: o.followUps, intervalDays: o.intervalDays });
  return r.success ? r.data : { ...DEFAULT_FOLLOW_UP_CADENCE };
}

export interface FollowUpCadenceSettings extends FollowUpCadence {
  /** Only the Super Workspace's administrators change it; everyone else reads it. */
  canEdit: boolean;
  updatedAt: string | null;
  updatedBy: { id: string; name: string } | null;
}

export const CADENCE_STATES = ['FRESH', 'ACTIVE', 'COMPLETE', 'STOPPED', 'NONE'] as const;
export type CadenceState = (typeof CADENCE_STATES)[number];

/** Where one employee is in the cadence. */
export interface ContactCadence {
  state: CadenceState;
  /** When the initial email went out, if it did. */
  initialEmailAt: string | null;
  /** Follow-ups completed in this cadence, and how many it has. */
  completed: number;
  total: number;
  /** The open follow-up of the cadence, if one is planned. */
  next: { taskId: string; step: number; dueAt: string; overdue: boolean } | null;
  /** Why it stopped (a reply, a call, an RFQ, a later stage), when it did. */
  stoppedReason: string | null;
}

export const initialEmailSchema = z.object({
  /** When the email was sent, if not now (an email sent outside SampForce). Not in the future. */
  sentAt: z.string().datetime().optional(),
  note: z.string().trim().max(500).nullable().optional(),
});
export type InitialEmailInput = z.infer<typeof initialEmailSchema>;

const DAY = 86_400_000;

/** The due date of the follow-up after `from`: the interval later, at the same time of day. */
export function nextFollowUpDue(from: Date | string, intervalDays: number): Date {
  return new Date(new Date(from).getTime() + intervalDays * DAY);
}

/** "Follow-up 2 of 5: Priya Shah" */
export function cadenceTaskTitle(step: number, total: number, name: string): string {
  return `Follow-up ${step} of ${total}: ${name}`.slice(0, 200);
}
