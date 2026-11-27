import { z } from 'zod';
import type { CompanyLogoRef, PersonRef } from './crm';

/*
 * Calls (ADR 0088): a Calls section where a salesperson dials any company or employee number through their own dialer.
 * A dialer is personal: the phone app on the device (tel:), a softphone (callto: or sip:), any third-party dialer that
 * opens from a link (a URL template with the call's details), and optionally a webhook that receives the details, or
 * the workspace's Twilio number ringing the caller's own phone first. Every call is kept with its outcome, remarks and
 * talk time, logged as a call interaction on the company, and the next call becomes a follow-up.
 */

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional().or(z.literal('').transform(() => null));
const uuidRef = z.string().uuid().nullable().optional();
const isoDateTime = z.string().datetime({ offset: true });
const optionalDateTime = isoDateTime.nullable().optional().or(z.literal('').transform(() => null));

// ───────────── Dialers ─────────────

/** LINK opens a URL built from the template (tel:, callto:, sip:, an app's own scheme or a web dialer). TWILIO calls through the workspace's Twilio number. */
export const DIALER_KINDS = ['LINK', 'TWILIO'] as const;
export type DialerKind = (typeof DIALER_KINDS)[number];

/** The details a dialer receives, as {placeholders} in its URL template and as fields in its webhook. */
export const DIALER_PLACEHOLDERS = {
  phone: 'The number being called, as written',
  phoneE164: 'The number in international form (+447700900123)',
  phoneDigits: 'Only the digits of the number',
  companyName: 'Company name',
  companyPhone: 'Company phone',
  employeeName: 'Employee name',
  designation: 'Employee designation',
  email: 'Employee email',
  employeePhone: 'Employee phone',
  callId: 'SampForce call id',
  companyUrl: 'Link to the company in SampForce',
} as const;
export type DialerPlaceholder = keyof typeof DIALER_PLACEHOLDERS;

/** Ready-made link dialers. Each opens whatever app the device has registered for that kind of link. */
export const DIALER_PRESETS = [
  { key: 'phone', name: 'Phone app', urlTemplate: 'tel:{phoneE164}', description: 'The phone app on this device, or the app it has for phone links (FaceTime, Phone Link, your softphone).' },
  { key: 'callto', name: 'Softphone (callto:)', urlTemplate: 'callto:{phoneE164}', description: 'Softphones that answer callto: links, such as Skype, Zoiper or MicroSIP.' },
  { key: 'sip', name: 'SIP softphone (sip:)', urlTemplate: 'sip:{phoneE164}', description: 'A SIP softphone or desk phone app that answers sip: links.' },
  { key: 'custom', name: 'My dialer (custom link)', urlTemplate: 'https://dialer.example.com/call?number={phoneE164}&name={employeeName}&company={companyName}', description: 'Any dialer that opens from a link: put the call details into the address with {placeholders}.' },
] as const;

/** Link schemes a dialer may not use: they would run code or read files instead of placing a call. */
const BLOCKED_SCHEMES = new Set(['javascript', 'data', 'vbscript', 'file', 'blob', 'about', 'filesystem']);

export function dialerTemplateProblem(t: string): string | null {
  const m = /^([a-z][a-z0-9+.-]*):/i.exec(t.trim());
  if (!m) return 'Start the link with its scheme, for example tel:, callto:, sip: or https://';
  if (BLOCKED_SCHEMES.has(m[1]!.toLowerCase())) return 'This kind of link cannot place a call.';
  if (!/\{(phone|phoneE164|phoneDigits)\}/.test(t)) return 'Put {phoneE164}, {phone} or {phoneDigits} where the number goes.';
  const unknown = [...t.matchAll(/\{(\w+)\}/g)].map((x) => x[1]!).filter((p) => !(p in DIALER_PLACEHOLDERS));
  if (unknown.length) return `Unknown placeholder {${unknown[0]}}.`;
  return null;
}

const phoneText = z.string().trim().max(40).regex(/^\+[1-9][\d\s().-]{6,30}$/, 'Write your phone number with its country code, for example +44 7700 900123');

export const dialerInputSchema = z
  .object({
    name: z.string().trim().min(1, 'Name your dialer').max(80),
    kind: z.enum(DIALER_KINDS),
    urlTemplate: optionalText(1000),
    /** Optional: the details of every call are also posted here, signed (HMAC-SHA256) with the dialer's secret. */
    webhookUrl: optionalText(1000),
    /** TWILIO: the caller's own phone, which Twilio rings first before connecting the other party. */
    agentPhone: phoneText.nullable().optional().or(z.literal('').transform(() => null)),
    isDefault: z.boolean().optional(),
  })
  .superRefine((d, ctx) => {
    if (d.kind === 'LINK') {
      if (!d.urlTemplate) ctx.addIssue({ code: 'custom', path: ['urlTemplate'], message: 'Enter the link your dialer opens' });
      else {
        const p = dialerTemplateProblem(d.urlTemplate);
        if (p) ctx.addIssue({ code: 'custom', path: ['urlTemplate'], message: p });
      }
    }
    if (d.kind === 'TWILIO' && !d.agentPhone) ctx.addIssue({ code: 'custom', path: ['agentPhone'], message: 'Enter the phone Twilio should ring first' });
    if (d.webhookUrl && !/^https?:\/\//i.test(d.webhookUrl)) ctx.addIssue({ code: 'custom', path: ['webhookUrl'], message: 'The webhook address starts with https://' });
  });
export type DialerInput = z.infer<typeof dialerInputSchema>;

export interface DialerRow {
  id: string;
  name: string;
  kind: DialerKind;
  urlTemplate: string | null;
  webhookUrl: string | null;
  /** Shown once, when the webhook is first set or the secret is renewed; otherwise null. */
  webhookSecret: string | null;
  hasWebhookSecret: boolean;
  agentPhone: string | null;
  isDefault: boolean;
  lastUsedAt: string | null;
  createdAt: string;
}

/** The caller's dialers and whether the workspace's Twilio number can place calls. */
export interface DialerSettings {
  dialers: DialerRow[];
  /** The built-in phone app dialer, used when the person has not added one. */
  builtIn: { name: string; urlTemplate: string };
  twilio: { connected: boolean; fromNumber: string | null };
}

// ───────────── Placing calls ─────────────

/** What happened on the call, chosen when it is logged. Only CONNECTED and CALL_BACK mean the person was reached. */
export const CALL_OUTCOMES = ['CONNECTED', 'CALL_BACK', 'NOT_INTERESTED', 'NO_ANSWER', 'BUSY', 'VOICEMAIL', 'WRONG_NUMBER'] as const;
export type CallOutcome = (typeof CALL_OUTCOMES)[number];
export const CALL_OUTCOME_LABELS: Record<CallOutcome, string> = {
  CONNECTED: 'Connected',
  CALL_BACK: 'Asked to call back',
  NOT_INTERESTED: 'Not interested',
  NO_ANSWER: 'No answer',
  BUSY: 'Busy',
  VOICEMAIL: 'Left voicemail',
  WRONG_NUMBER: 'Wrong number',
};
/** Outcomes where someone answered: the call counts as a conversation (stops the email cadence, moves the employee's stage). */
export const CALL_REACHED: ReadonlySet<CallOutcome> = new Set(['CONNECTED', 'CALL_BACK', 'NOT_INTERESTED']);

/** OPEN: placed, not logged yet. Twilio calls also pass through RINGING and IN_PROGRESS from Twilio's status callbacks. */
export const CALL_STATUSES = ['OPEN', 'RINGING', 'IN_PROGRESS', 'ENDED', 'FAILED', 'LOGGED'] as const;
export type CallStatus = (typeof CALL_STATUSES)[number];

/** Which number on the record was dialled. OTHER: typed on the keypad. */
export const CALL_NUMBER_SOURCES = ['EMPLOYEE', 'COMPANY', 'OTHER'] as const;
export type CallNumberSource = (typeof CALL_NUMBER_SOURCES)[number];

export const callStartSchema = z
  .object({
    companyId: uuidRef,
    contactId: uuidRef,
    /** Which of the record's numbers to call; or a number typed on the keypad. */
    numberSource: z.enum(CALL_NUMBER_SOURCES).default('EMPLOYEE'),
    number: z.string().trim().max(40).optional(),
    /** null or missing: the person's default dialer (the phone app when they have none). */
    dialerId: uuidRef,
  })
  .superRefine((d, ctx) => {
    if (d.numberSource === 'OTHER' && !d.number) ctx.addIssue({ code: 'custom', path: ['number'], message: 'Type the number to call' });
    if (d.numberSource === 'EMPLOYEE' && !d.contactId) ctx.addIssue({ code: 'custom', path: ['contactId'], message: 'Choose the employee to call' });
    if (d.numberSource === 'COMPANY' && !d.companyId) ctx.addIssue({ code: 'custom', path: ['companyId'], message: 'Choose the company to call' });
  });
export type CallStartInput = z.infer<typeof callStartSchema>;

export const callLogSchema = z.object({
  outcome: z.enum(CALL_OUTCOMES),
  remarks: optionalText(10_000),
  /** Talk time in seconds; Twilio calls fill it in themselves. */
  durationSec: z.coerce.number().int().min(0).max(86_400).nullable().optional(),
  sentiment: z.enum(['POSITIVE', 'NEUTRAL', 'NEGATIVE']).nullable().optional(),
  /** When set, the next call is scheduled as a call follow-up. */
  nextCallAt: optionalDateTime,
  nextCallNote: optionalText(500),
});
export type CallLogInput = z.infer<typeof callLogSchema>;

/** Editing a logged call: its outcome, remarks and talk time. The next call is changed on its follow-up. */
export const callUpdateSchema = callLogSchema.omit({ nextCallAt: true, nextCallNote: true }).partial().strict();
export type CallUpdateInput = z.infer<typeof callUpdateSchema>;

export const callListQuerySchema = z.object({
  scope: z.enum(['mine', 'team', 'all']).default('mine'),
  outcome: z.enum(CALL_OUTCOMES).optional(),
  companyId: z.string().uuid().optional(),
  contactId: z.string().uuid().optional(),
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  /** Calls placed before this time (the previous page's last startedAt). */
  before: isoDateTime.optional(),
});
export type CallListQuery = z.infer<typeof callListQuerySchema>;

export const callTargetSearchSchema = z.object({ q: z.string().trim().min(1).max(100) });

/** Everything a call needs about who is being called: what the dialer receives, and what the Calls page shows. */
export interface CallDetails {
  company: { id: string; name: string; phone: string | null; leadNumber: string | null; logo: CompanyLogoRef | null; country: string | null; timezone: string | null } | null;
  employee: { id: string; name: string; designation: string | null; email: string | null; phone: string | null; timezone: string | null } | null;
  /** Hidden by record visibility (the role may see the record but not someone else's contact details). */
  detailsHidden: boolean;
  /** The other employees of the company with a phone number, to switch to. */
  colleagues: { id: string; name: string; designation: string | null; phone: string }[];
  /** Is it a good time to call where they are? From the employee's time zone, else the company's. */
  localTime: CallWindow | null;
  lastCall: { at: string; outcome: CallOutcome | null; by: string | null; remarks: string | null } | null;
  nextCall: { id: string; dueAt: string; title: string } | null;
}

/** A company or employee found from the Calls search, with the numbers on file. */
export interface CallTarget {
  kind: 'company' | 'employee';
  companyId: string | null;
  contactId: string | null;
  name: string;
  subtitle: string | null;
  phone: string | null;
  companyPhone: string | null;
  /** The company's logo (for an employee, their company's). */
  companyName: string | null;
  logo: CompanyLogoRef | null;
}

export interface CallRow {
  id: string;
  status: CallStatus;
  outcome: CallOutcome | null;
  number: string;
  numberSource: CallNumberSource;
  dialer: { id: string | null; name: string; kind: DialerKind };
  company: { id: string; name: string } | null;
  employee: { id: string; name: string; designation: string | null } | null;
  /** The details handed to the dialer when the call started. */
  details: CallHandoff;
  startedAt: string;
  answeredAt: string | null;
  endedAt: string | null;
  durationSec: number | null;
  remarks: string | null;
  sentiment: 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE' | null;
  nextCall: { id: string; dueAt: string | null; title: string; status: 'OPEN' | 'DONE' | 'CANCELED' } | null;
  interactionId: string | null;
  webhook: { status: 'SENT' | 'FAILED'; at: string; error: string | null } | null;
  twilioStatus: string | null;
  error: string | null;
  by: PersonRef | null;
}

/** The details a call hands to the dialer. */
export interface CallHandoff {
  companyName: string | null;
  companyPhone: string | null;
  employeeName: string | null;
  designation: string | null;
  email: string | null;
  employeePhone: string | null;
}

export interface CallStarted {
  call: CallRow;
  /** LINK dialers: the address to open now. Null for Twilio, which rings the caller's phone itself. */
  launchUrl: string | null;
}

export interface CallStats {
  today: { calls: number; reached: number; talkSec: number; notLogged: number };
  nextCallsToday: number;
  overdueCalls: number;
}

// ───────────── Good time to call ─────────────

export type CallWindowKind = 'GOOD' | 'LUNCH' | 'EARLY' | 'LATE' | 'WEEKEND';
export interface CallWindow {
  timeZone: string;
  /** Their wall clock, HH:mm. */
  time: string;
  /** Mon..Sun in English; the page formats its own. */
  weekday: string;
  /** Minutes their clock is ahead of UTC. */
  offsetMinutes: number;
  kind: CallWindowKind;
  good: boolean;
}

export const CALL_WINDOW_LABELS: Record<CallWindowKind, string> = {
  GOOD: 'Good time to call',
  LUNCH: 'Lunch time there',
  EARLY: 'Too early there',
  LATE: 'After office hours there',
  WEEKEND: 'Weekend there',
};

/** Office hours: Monday to Friday 09:00 to 18:00 on their clock, lunch 13:00 to 14:00. */
export function callWindow(timeZone: string | null | undefined, now = new Date()): CallWindow | null {
  if (!timeZone) return null;
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', { timeZone, hour12: false, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(now);
  } catch {
    return null;
  }
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const hour = Number(get('hour')) % 24;
  const minute = Number(get('minute'));
  const weekday = get('weekday');
  const wall = Date.UTC(Number(get('year')), Number(get('month')) - 1, Number(get('day')), hour, minute);
  const offsetMinutes = Math.round((wall - Math.floor(now.getTime() / 60_000) * 60_000) / 60_000);
  const mins = hour * 60 + minute;
  const kind: CallWindowKind = weekday === 'Sat' || weekday === 'Sun' ? 'WEEKEND' : mins < 9 * 60 ? 'EARLY' : mins >= 18 * 60 ? 'LATE' : mins >= 13 * 60 && mins < 14 * 60 ? 'LUNCH' : 'GOOD';
  return { timeZone, time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`, weekday, offsetMinutes, kind, good: kind === 'GOOD' };
}

// ───────────── Numbers and links ─────────────

/** A number in international form, or null when it has no country code (+ or 00) or is not a plausible length. */
export function e164(phone: string | null | undefined): string | null {
  const t = phone?.trim();
  if (!t || !/^(\+|00)/.test(t)) return null;
  const digits = t.replace(/^00/, '').replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 15 || digits.startsWith('0')) return null;
  return `+${digits}`;
}

/** A number the device's dialer can take: international when possible, else only the digits (and a leading +). */
export function dialable(phone: string): string {
  return e164(phone) ?? phone.trim().replace(/(?!^\+)[^\d]/g, '');
}

/**
 * The dialer link with every {placeholder} filled in and encoded for a URL. A web address keeps + encoded (in a query
 * a bare + is a space); phone links (tel:, callto:, sip:, app schemes) keep the + of an international number as is.
 */
export function fillDialerTemplate(template: string, values: Partial<Record<DialerPlaceholder, string | null>>): string {
  const web = /^https?:/i.test(template.trim());
  return template.replace(/\{(\w+)\}/g, (all, key: string) => {
    if (!(key in DIALER_PLACEHOLDERS)) return all;
    const v = encodeURIComponent(values[key as DialerPlaceholder] ?? '');
    return web ? v : v.replace(/%2B/g, '+');
  });
}
