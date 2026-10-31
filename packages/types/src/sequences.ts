import { z } from 'zod';
import type { OwnerRef } from './crm';
import { LEAD_STATUSES } from './crm';

/**
 * Email templates and sequences. A sequence is a person-built list of steps (emails, tasks and
 * condition checks) sent one-to-one from the enrolling person's own connected mailbox, inside a send
 * window and under daily limits. Event rules say what happens when a recipient replies, opens, clicks,
 * bounces or unsubscribes. AI agents never create, start or enrol people in sequences.
 */

// ───────────── Merge fields ─────────────

export const MERGE_FIELDS = {
  first_name: 'First name',
  last_name: 'Last name',
  full_name: 'Full name',
  email: 'Email',
  company: 'Company',
  job_title: 'Job title',
  country: 'Country',
  sender_name: 'Your name',
  sender_first_name: 'Your first name',
  sender_email: 'Your email',
} as const;
export type MergeField = keyof typeof MERGE_FIELDS;
export const MERGE_FIELD_KEYS = Object.keys(MERGE_FIELDS) as MergeField[];
export type MergeValues = Partial<Record<MergeField, string | null | undefined>>;

/** `{{first_name}}` or `{{first_name|there}}`; spaces inside the braces are allowed. */
const TAG = /\{\{\s*([a-z_]+)\s*(?:\|([^}]*))?\}\}/g;

export interface RenderResult {
  text: string;
  /** Fields that were empty and had no fallback, so the text shows a gap. */
  missing: MergeField[];
  /** Tags that are not merge fields; they are left as typed. */
  unknown: string[];
}

export function renderMerge(text: string, values: MergeValues): RenderResult {
  const missing = new Set<MergeField>();
  const unknown = new Set<string>();
  const out = text.replace(TAG, (whole, key: string, fallback: string | undefined) => {
    if (!(key in MERGE_FIELDS)) {
      unknown.add(key);
      return whole;
    }
    const v = values[key as MergeField]?.trim();
    if (v) return v;
    if (fallback !== undefined) return fallback.trim();
    missing.add(key as MergeField);
    return '';
  });
  return { text: out, missing: [...missing], unknown: [...unknown] };
}

/** Tags used in a text, for validation and the editor's field list. */
export function mergeTags(text: string): string[] {
  return [...new Set([...text.matchAll(TAG)].map((m) => m[1]!))];
}

// ───────────── Templates ─────────────

const unknownTags = (v: { subject: string; body: string }, ctx: z.RefinementCtx) => {
  for (const [path, text] of [['subject', v.subject], ['body', v.body]] as const) {
    const bad = mergeTags(text).filter((t) => !(t in MERGE_FIELDS));
    if (bad.length) ctx.addIssue({ code: 'custom', path: [path], message: `Unknown merge field ${bad.map((b) => `{{${b}}}`).join(', ')}` });
  }
};

export const emailTemplateInputSchema = z
  .object({
    name: z.string().trim().min(1, 'Enter a name').max(120),
    subject: z.string().trim().min(1, 'Enter a subject').max(200),
    body: z.string().trim().min(1, 'Write the email').max(20_000),
    /** Shared templates are visible to the whole workspace; only people with marketing:manage can share. */
    shared: z.boolean().default(false),
  })
  .superRefine(unknownTags);
export type EmailTemplateInput = z.infer<typeof emailTemplateInputSchema>;

export interface EmailTemplateRow {
  id: string;
  name: string;
  subject: string;
  body: string;
  shared: boolean;
  owner: OwnerRef | null;
  /** Sequences whose steps use it. */
  usedBy: number;
  createdAt: string;
  updatedAt: string;
}

export const templatePreviewSchema = z.object({
  subject: z.string().max(200),
  body: z.string().max(20_000),
  leadId: z.string().uuid().optional(),
  contactId: z.string().uuid().optional(),
});

export interface TemplatePreview {
  subject: string;
  body: string;
  missing: MergeField[];
  recipient: { name: string; email: string | null } | null;
}

// ───────────── Sequences ─────────────

export const SEQUENCE_STATUSES = ['DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED'] as const;
export type SequenceStatus = (typeof SEQUENCE_STATUSES)[number];

/** What a recipient did, as DealFlow saw it. Replies and bounces come from mailbox sync; opens and clicks from tracking. */
export const EMAIL_EVENTS = ['replied', 'opened', 'clicked', 'bounced', 'unsubscribed'] as const;
export type EmailEvent = (typeof EMAIL_EVENTS)[number];
export const EMAIL_EVENT_LABELS: Record<EmailEvent, string> = {
  replied: 'Replies',
  opened: 'Opens an email (approximate)',
  clicked: 'Clicks a link',
  bounced: 'Email bounces',
  unsubscribed: 'Unsubscribes',
};

const stepId = z.string().regex(/^[a-z0-9_-]{1,40}$/i);

export const ruleActionSchema = z.discriminatedUnion('type', [
  /** Ends this person's run of the sequence. */
  z.object({ type: z.literal('stop') }),
  /** Ends it here and enrols them in another active sequence. */
  z.object({ type: z.literal('move_sequence'), sequenceId: z.string().uuid() }),
  z.object({ type: z.literal('set_lead_status'), status: z.enum(LEAD_STATUSES).exclude(['CONVERTED']) }),
  z.object({ type: z.literal('create_task'), title: z.string().trim().min(1).max(200), dueInDays: z.number().int().min(0).max(60).default(1) }),
  z.object({ type: z.literal('notify_owner') }),
]);
export type RuleAction = z.infer<typeof ruleActionSchema>;
export const RULE_ACTION_LABELS: Record<RuleAction['type'], string> = {
  stop: 'Stop the sequence for them',
  move_sequence: 'Move them to another sequence',
  set_lead_status: 'Change the lead status',
  create_task: 'Create a task for the sender',
  notify_owner: 'Notify the sender',
};

export const eventRuleSchema = z
  .object({
    on: z.enum(EMAIL_EVENTS),
    actions: z.array(ruleActionSchema).min(1, 'Add at least one action').max(5),
  })
  .refine((r) => r.actions.filter((a) => a.type === 'stop' || a.type === 'move_sequence').length <= 1, {
    message: 'Choose either stop or move to another sequence, not both',
    path: ['actions'],
  });
export type EventRule = z.infer<typeof eventRuleSchema>;

const delayDays = z.number().int().min(0).max(60);

export const sequenceStepSchema = z.discriminatedUnion('type', [
  z.object({
    id: stepId,
    type: z.literal('email'),
    /** Days to wait after the previous step; 0 on the first step sends at the next send-window slot. */
    delayDays,
    templateId: z.string().uuid().nullable().default(null),
    /** Used when there is no template, or to override the template for this step. */
    subject: z.string().trim().max(200).default(''),
    body: z.string().trim().max(20_000).default(''),
  }),
  z.object({ id: stepId, type: z.literal('task'), delayDays, title: z.string().trim().min(1, 'Name the task').max(200) }),
  z.object({
    id: stepId,
    type: z.literal('condition'),
    delayDays,
    /** Checked against every email this person has received from the sequence so far. */
    check: z.enum(['replied', 'opened', 'clicked']),
    /** A step id, `next` (carry on) or `stop`. */
    ifYes: z.string().max(40).default('stop'),
    ifNo: z.string().max(40).default('next'),
  }),
]);
export type SequenceStep = z.infer<typeof sequenceStepSchema>;

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM');

export const sequenceSettingsSchema = z
  .object({
    /** 0 = Sunday … 6 = Saturday. */
    sendDays: z.array(z.number().int().min(0).max(6)).min(1, 'Pick at least one day').max(7).default([1, 2, 3, 4, 5]),
    sendStart: hhmm.default('09:00'),
    sendEnd: hhmm.default('17:00'),
    timezone: z.string().min(1).max(64).default('UTC'),
    /** Emails this sequence may send per sender per day; the mailbox's own daily limit applies on top. */
    dailyLimit: z.number().int().min(1).max(500).default(50),
    trackOpens: z.boolean().default(true),
    trackClicks: z.boolean().default(true),
  })
  .refine((s) => s.sendStart < s.sendEnd, { message: 'The window must end after it starts', path: ['sendEnd'] })
  .refine((s) => isTimeZone(s.timezone), { message: 'Unknown time zone', path: ['timezone'] });
export type SequenceSettings = z.infer<typeof sequenceSettingsSchema>;

export function isTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Rules every new sequence starts with; people can change them. Unsubscribes and bounces always stop sending. */
export const DEFAULT_EVENT_RULES: EventRule[] = [
  { on: 'replied', actions: [{ type: 'stop' }, { type: 'notify_owner' }] },
  { on: 'bounced', actions: [{ type: 'stop' }] },
];

export const sequenceInputSchema = z
  .object({
    name: z.string().trim().min(1, 'Enter a name').max(120),
    description: z.string().trim().max(1000).nullable().optional(),
    steps: z.array(sequenceStepSchema).max(20).default([]),
    rules: z.array(eventRuleSchema).max(10).default(DEFAULT_EVENT_RULES),
    settings: sequenceSettingsSchema.default({}),
  })
  .superRefine((v, ctx) => {
    const ids = v.steps.map((s) => s.id);
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', path: ['steps'], message: 'Step ids must be unique' });
    v.steps.forEach((s, i) => {
      if (s.type === 'email') {
        if (!s.templateId && (!s.subject || !s.body)) ctx.addIssue({ code: 'custom', path: ['steps', i], message: `Step ${i + 1}: pick a template or write a subject and body` });
        const bad = [...mergeTags(s.subject), ...mergeTags(s.body)].filter((t) => !(t in MERGE_FIELDS));
        if (bad.length) ctx.addIssue({ code: 'custom', path: ['steps', i], message: `Step ${i + 1}: unknown merge field {{${bad[0]}}}` });
      }
      if (s.type === 'condition') {
        for (const target of [s.ifYes, s.ifNo]) {
          if (target === 'next' || target === 'stop') continue;
          const at = ids.indexOf(target);
          if (at < 0) ctx.addIssue({ code: 'custom', path: ['steps', i], message: `Step ${i + 1}: it jumps to a step that does not exist` });
          else if (at <= i) ctx.addIssue({ code: 'custom', path: ['steps', i], message: `Step ${i + 1}: it can only jump forward` });
        }
      }
    });
    const ons = v.rules.map((r) => r.on);
    if (new Set(ons).size !== ons.length) ctx.addIssue({ code: 'custom', path: ['rules'], message: 'Use one rule per event' });
  });
export type SequenceInput = z.infer<typeof sequenceInputSchema>;

export const sequenceStatusSchema = z.object({ status: z.enum(['ACTIVE', 'PAUSED', 'ARCHIVED']) });

export interface SequenceStats {
  active: number;
  finished: number;
  sent: number;
  replied: number;
  opened: number;
  clicked: number;
  bounced: number;
  unsubscribed: number;
}

export interface SequenceRow {
  id: string;
  name: string;
  description: string | null;
  status: SequenceStatus;
  owner: OwnerRef | null;
  steps: SequenceStep[];
  rules: EventRule[];
  settings: SequenceSettings;
  stats: SequenceStats;
  createdAt: string;
  updatedAt: string;
}

export interface SequenceStepStats {
  stepId: string;
  sent: number;
  replied: number;
  opened: number;
  clicked: number;
  bounced: number;
}

// ───────────── Enrolments ─────────────

export const ENROLLMENT_STATUSES = ['ACTIVE', 'PAUSED', 'COMPLETED', 'REPLIED', 'BOUNCED', 'UNSUBSCRIBED', 'STOPPED', 'MOVED', 'FAILED'] as const;
export type EnrollmentStatus = (typeof ENROLLMENT_STATUSES)[number];

export const enrollInputSchema = z
  .object({
    leadIds: z.array(z.string().uuid()).max(500).default([]),
    contactIds: z.array(z.string().uuid()).max(500).default([]),
    segmentId: z.string().uuid().optional(),
  })
  .refine((v) => v.leadIds.length + v.contactIds.length > 0 || v.segmentId, { message: 'Choose who to enrol' });
export type EnrollInput = z.infer<typeof enrollInputSchema>;

export type EnrollSkipReason = 'no_email' | 'opted_out' | 'suppressed' | 'already_enrolled' | 'not_found';
export const ENROLL_SKIP_LABELS: Record<EnrollSkipReason, string> = {
  no_email: 'no email address',
  opted_out: 'opted out of marketing',
  suppressed: 'on the do-not-email list',
  already_enrolled: 'already in this sequence',
  not_found: 'not found',
};

export interface EnrollResult {
  enrolled: number;
  skipped: { name: string; reason: EnrollSkipReason }[];
}

export interface EnrollmentRow {
  id: string;
  sequence: { id: string; name: string };
  person: { type: 'lead' | 'contact'; id: string; name: string };
  email: string;
  sender: OwnerRef | null;
  status: EnrollmentStatus;
  /** 1-based position of the next step, or null once finished. */
  nextStep: number | null;
  nextRunAt: string | null;
  lastError: string | null;
  sent: number;
  repliedAt: string | null;
  openedAt: string | null;
  clickedAt: string | null;
  createdAt: string;
}

export const ENROLLMENT_FINISHED: EnrollmentStatus[] = ['COMPLETED', 'REPLIED', 'BOUNCED', 'UNSUBSCRIBED', 'STOPPED', 'MOVED', 'FAILED'];

// ───────────── Do-not-email list ─────────────

export const SUPPRESSION_REASONS = ['UNSUBSCRIBED', 'BOUNCED', 'MANUAL'] as const;
export type SuppressionReason = (typeof SUPPRESSION_REASONS)[number];

export const suppressionInputSchema = z.object({
  emails: z.array(z.string().trim().toLowerCase().email('Enter valid email addresses').max(254)).min(1).max(1000),
});

export interface SuppressionRow {
  email: string;
  reason: SuppressionReason;
  createdAt: string;
}

// ───────────── Send window ─────────────

interface ZonedParts {
  day: number;
  minutes: number;
}

function zoned(at: Date, tz: string): ZonedParts {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  return { day, minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}

const toMinutes = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));

/**
 * The earliest moment at or after `from` that falls inside the send window. Steps through the window
 * minute-accurately in the sequence's time zone (daylight-saving safe because each candidate is re-checked).
 */
export function nextSendSlot(from: Date, s: Pick<SequenceSettings, 'sendDays' | 'sendStart' | 'sendEnd' | 'timezone'>): Date {
  const start = toMinutes(s.sendStart);
  const end = toMinutes(s.sendEnd);
  let t = new Date(Math.ceil(from.getTime() / 60_000) * 60_000);
  for (let i = 0; i < 8 * 24 * 4; i++) {
    const z = zoned(t, s.timezone);
    if (s.sendDays.includes(z.day) && z.minutes >= start && z.minutes < end) return t;
    // Jump to the window start today if we are before it, otherwise to midnight; re-check after each jump.
    const jump = s.sendDays.includes(z.day) && z.minutes < start ? start - z.minutes : 24 * 60 - z.minutes;
    t = new Date(t.getTime() + Math.max(1, jump) * 60_000);
  }
  return t;
}
