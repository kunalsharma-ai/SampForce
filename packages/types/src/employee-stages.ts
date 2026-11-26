import { z } from 'zod';
import type { PersonRef } from './crm';

/*
 * Employee communication stages and RFQ contributors (ADR 0080).
 *
 * Every employee (a Contact at a company) has their own communication stage, apart from the employee status. Stages
 * are CrmStatus rows of kind STAGE, so a workspace can rename, recolour, add and retire them in CRM configuration.
 * The 20 built-in stages carry a `key`, which is how SampForce moves an employee on by itself (an RFQ arrives, a
 * follow-up is done, SampBidx confirms a transfer). Every stage has a `phase`, which the filters and dashboards use,
 * so a stage a workspace adds later is counted with the built-in ones of the same phase.
 */

export const STAGE_PHASES = ['NEW', 'RFQ', 'FOLLOW_UP', 'DISCUSSION', 'CALL', 'NEGOTIATION', 'WON', 'LOST', 'ON_HOLD'] as const;
export type StagePhase = (typeof STAGE_PHASES)[number];

export const STAGE_KEYS = [
  'NEW_CONTACT',
  'RFQ_RECEIVED',
  'RFQ_REVIEW',
  'RFQ_QUALIFICATION',
  'RFQ_SENT_SAMPBIDX',
  'FOLLOW_UP_1',
  'FOLLOW_UP_2',
  'FOLLOW_UP_3',
  'FOLLOW_UP_4',
  'FOLLOW_UP_5',
  'FOLLOW_UP_MORE',
  'DISCUSSION',
  'CALL_SCHEDULED',
  'CALL_DONE',
  'NEGOTIATION',
  'RFQ_WON',
  'RFQ_REJECTED',
  'RFQ_LOST',
  'RFQ_CANCELLED',
  'ON_HOLD',
] as const;
export type StageKey = (typeof STAGE_KEYS)[number];

export interface BuiltInStage {
  key: StageKey;
  name: string;
  /** The stage's own colour (#rrggbb). Chips are drawn from it with stageTones(), readable in light and dark. */
  color: string;
  phase: StagePhase;
}

/**
 * The built-in stages in pipeline order. Each colour is a distinct shade; chips also carry a per-stage icon and
 * follow-ups their number, so no stage is told apart by colour alone.
 */
export const BUILT_IN_STAGES: readonly BuiltInStage[] = [
  { key: 'NEW_CONTACT', name: 'New Contact', color: '#6b7280', phase: 'NEW' },
  { key: 'RFQ_RECEIVED', name: 'RFQ Received', color: '#2563eb', phase: 'RFQ' },
  { key: 'RFQ_REVIEW', name: 'RFQ Under Review', color: '#4f46e5', phase: 'RFQ' },
  { key: 'RFQ_QUALIFICATION', name: 'RFQ Qualification', color: '#8b5cf6', phase: 'RFQ' },
  { key: 'RFQ_SENT_SAMPBIDX', name: 'RFQ Sent to SampBidx', color: '#0d9488', phase: 'RFQ' },
  { key: 'FOLLOW_UP_1', name: 'Follow-up 1 Completed', color: '#60a5fa', phase: 'FOLLOW_UP' },
  { key: 'FOLLOW_UP_2', name: 'Follow-up 2 Completed', color: '#06b6d4', phase: 'FOLLOW_UP' },
  { key: 'FOLLOW_UP_3', name: 'Follow-up 3 Completed', color: '#1e40af', phase: 'FOLLOW_UP' },
  { key: 'FOLLOW_UP_4', name: 'Follow-up 4 Completed', color: '#a855f7', phase: 'FOLLOW_UP' },
  { key: 'FOLLOW_UP_5', name: 'Follow-up 5 Completed', color: '#6d28d9', phase: 'FOLLOW_UP' },
  { key: 'FOLLOW_UP_MORE', name: 'Additional Follow-ups', color: '#6a5acd', phase: 'FOLLOW_UP' },
  { key: 'DISCUSSION', name: 'Discussion in Progress', color: '#f59e0b', phase: 'DISCUSSION' },
  { key: 'CALL_SCHEDULED', name: 'Call Scheduled', color: '#0ea5e9', phase: 'CALL' },
  { key: 'CALL_DONE', name: 'Call Completed', color: '#14b8a6', phase: 'CALL' },
  { key: 'NEGOTIATION', name: 'Negotiation in Progress', color: '#f97316', phase: 'NEGOTIATION' },
  { key: 'RFQ_WON', name: 'RFQ Won', color: '#16a34a', phase: 'WON' },
  { key: 'RFQ_REJECTED', name: 'RFQ Rejected', color: '#dc2626', phase: 'LOST' },
  { key: 'RFQ_LOST', name: 'RFQ Lost', color: '#374151', phase: 'LOST' },
  { key: 'RFQ_CANCELLED', name: 'RFQ Cancelled', color: '#b45a5a', phase: 'LOST' },
  { key: 'ON_HOLD', name: 'On Hold', color: '#c2803f', phase: 'ON_HOLD' },
];

/** How far along the pipeline a stage is. Automatic changes only move an employee forward (see stageRank). */
const KEY_RANK: Record<StageKey, number> = Object.fromEntries(STAGE_KEYS.map((k, i) => [k, i])) as Record<StageKey, number>;
const PHASE_RANK: Record<StagePhase, number> = {
  NEW: KEY_RANK.NEW_CONTACT,
  RFQ: KEY_RANK.RFQ_RECEIVED,
  FOLLOW_UP: KEY_RANK.FOLLOW_UP_1,
  DISCUSSION: KEY_RANK.DISCUSSION,
  CALL: KEY_RANK.CALL_SCHEDULED,
  NEGOTIATION: KEY_RANK.NEGOTIATION,
  WON: KEY_RANK.RFQ_WON,
  LOST: KEY_RANK.RFQ_REJECTED,
  ON_HOLD: KEY_RANK.ON_HOLD,
};

/** A stage's place in the pipeline: built-in stages by key, a workspace's own stages by their phase. */
export function stageRank(stage: { key?: string | null; phase?: string | null } | null | undefined): number {
  if (!stage) return -1;
  if (stage.key && stage.key in KEY_RANK) return KEY_RANK[stage.key as StageKey];
  return PHASE_RANK[(stage.phase as StagePhase) ?? 'NEW'] ?? 0;
}

/** Won, lost, rejected, cancelled and on hold: only a person, or a new RFQ, moves an employee out of these. */
export function isSettledPhase(phase: string | null | undefined): boolean {
  return phase === 'WON' || phase === 'LOST' || phase === 'ON_HOLD';
}

/** The follow-up stage for the n-th completed follow-up (1-5, then "Additional Follow-ups"). */
export function followUpStageKey(n: number): StageKey {
  if (n <= 1) return 'FOLLOW_UP_1';
  if (n >= 6) return 'FOLLOW_UP_MORE';
  return `FOLLOW_UP_${n}` as StageKey;
}

// ───────────── Colours ─────────────

type Rgb = [number, number, number];
const toRgb = (hex: string): Rgb => {
  const n = parseInt(hex.replace('#', '').slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const toHex = ([r, g, b]: Rgb) => `#${[r, g, b].map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, '0')).join('')}`;
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const luminance = ([r, g, b]: Rgb) => {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};
/** WCAG contrast ratio of two colours. */
export function stageContrast(a: string, b: string): number {
  const [x, y] = [luminance(toRgb(a)), luminance(toRgb(b))];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

const WHITE: Rgb = [255, 255, 255];
const BLACK: Rgb = [0, 0, 0];
/** The darkest and lightest card colours the dark themes use; dark chips are checked against both. */
const DARK_SURFACES: Rgb[] = [
  [11, 17, 32],
  [31, 41, 55],
];

export interface StageTone {
  /** Background, a soft tint of the stage colour. */
  bg: string;
  /** Text, the stage colour made dark (light theme) or light (dark theme) enough for 4.5:1 on the background. */
  fg: string;
  /** Border, between the two. */
  border: string;
  /** A small solid dot or bar in the stage colour, 3:1 against the card (WCAG 1.4.11). */
  dot: string;
}

/**
 * Chip colours for a stage colour in the light and the dark theme: a soft tint with readable text and a border,
 * never a large solid block. Text is darkened (light) or lightened (dark) step by step until it reaches 4.5:1 on the
 * chip, so any colour a workspace picks for its own stage stays readable.
 */
export function stageTones(hex: string): { light: StageTone; dark: StageTone } {
  const base = toRgb(/^#[0-9a-f]{6}$/i.test(hex) ? hex : '#6b7280');
  const lightBg = mix(base, WHITE, 0.88);
  let lightFg = base;
  for (let t = 0; t <= 1 && stageContrast(toHex(lightFg), toHex(lightBg)) < 4.6; t += 0.04) lightFg = mix(base, BLACK, t);
  let lightDot = base;
  for (let t = 0; t <= 1 && stageContrast(toHex(lightDot), '#ffffff') < 3; t += 0.04) lightDot = mix(base, BLACK, t);

  // Dark: a tint over the darkest and the lightest dark card; text must pass on both.
  const darkBgs = DARK_SURFACES.map((s) => mix(s, base, 0.2));
  let darkFg = base;
  for (let t = 0; t <= 1 && darkBgs.some((bg) => stageContrast(toHex(darkFg), toHex(bg)) < 4.6); t += 0.04) darkFg = mix(base, WHITE, t);
  let darkDot = base;
  for (let t = 0; t <= 1 && DARK_SURFACES.some((s) => stageContrast(toHex(darkDot), toHex(s)) < 3); t += 0.04) darkDot = mix(base, WHITE, t);
  return {
    light: { bg: toHex(lightBg), fg: toHex(lightFg), border: toHex(mix(base, WHITE, 0.55)), dot: toHex(lightDot) },
    dark: { bg: `rgba(${base.join(', ')}, 0.2)`, fg: toHex(darkFg), border: `rgba(${base.join(', ')}, 0.55)`, dot: toHex(darkDot) },
  };
}

// ───────────── RFQ contributors ─────────────

/** An RFQ in this many days makes an employee an Active RFQ Contributor. */
export const ACTIVE_CONTRIBUTOR_DAYS = 90;

export const CONTRIBUTOR_STATUSES = ['ACTIVE', 'CONTRIBUTOR', 'NONE'] as const;
export type ContributorStatus = (typeof CONTRIBUTOR_STATUSES)[number];

/**
 * Worked out from recorded activity, never typed: an RFQ in the last 90 days makes an Active RFQ Contributor, any
 * RFQ (or the team's own mark, for RFQs from before SampForce) an RFQ Contributor, otherwise No RFQ Received.
 */
export function contributorStatus(input: { rfqCount: number; lastRfqAt: string | Date | null; markedAt: string | Date | null }, now = new Date()): ContributorStatus {
  const last = input.lastRfqAt ? new Date(input.lastRfqAt).getTime() : null;
  if (last !== null && now.getTime() - last <= ACTIVE_CONTRIBUTOR_DAYS * 86_400_000) return 'ACTIVE';
  if (input.rfqCount > 0 || input.markedAt) return 'CONTRIBUTOR';
  return 'NONE';
}

// ───────────── API shapes ─────────────

export interface StageRef {
  id: string;
  name: string;
  color: string;
  key: StageKey | null;
  phase: StagePhase;
}

export interface EmployeeStageRow extends StageRef {
  description: string | null;
  position: number;
  archived: boolean;
  /** Employees in this stage now. */
  inUse: number;
}

export const stageChangeSchema = z.object({
  stageId: z.string().uuid(),
  note: z.string().trim().max(1000).nullable().optional(),
  rfqId: z.string().uuid().nullable().optional(),
});
export type StageChangeInput = z.infer<typeof stageChangeSchema>;

export const contributorMarkSchema = z.object({ marked: z.boolean() });

/** Where an automatic stage change came from. MANUAL is a person picking the stage. */
export const STAGE_CHANGE_SOURCES = ['MANUAL', 'RFQ', 'FOLLOW_UP', 'INTERACTION', 'SAMPBIDX', 'RFQ_OUTCOME', 'CALL_SCHEDULED'] as const;
export type StageChangeSource = (typeof STAGE_CHANGE_SOURCES)[number];

export interface EmployeeActivityRow {
  id: string;
  name: string;
  jobTitle: string | null;
  email: string | null;
  phone: string | null;
  company: { id: string; name: string };
  stage: StageRef | null;
  stageChangedAt: string | null;
  contributor: ContributorStatus;
  /** Marked as an RFQ contributor by hand (for RFQs before SampForce), with who and when. */
  marked: { at: string; by: PersonRef | null } | null;
  rfqCount: number;
  lastRfqAt: string | null;
  rfqsWon: number;
  rfqsLostOrRejected: number;
  rfqsOpen: number;
  /** RFQs sent to SampBidx (confirmed by SampBidx). */
  sentToSampbidx: number;
  lastActivityAt: string | null;
  nextFollowUpAt: string | null;
  followUpsOverdue: number;
  followUpsCompleted: number;
  owner: PersonRef | null;
  /** False when the caller's role may not see this employee's contact details. */
  details: boolean;
}

export interface EmployeeActivity {
  rows: EmployeeActivityRow[];
  /** Every stage of the workspace in order, for the summary strip and the pickers. */
  stages: EmployeeStageRow[];
  activeDays: number;
}

export const COMMUNICATION_EVENT_KINDS = ['STAGE', 'INTERACTION', 'RFQ', 'FOLLOW_UP', 'SAMPBIDX', 'CONTRIBUTOR'] as const;
export type CommunicationEventKind = (typeof COMMUNICATION_EVENT_KINDS)[number];

/** One line of an employee's communication history, newest first. Nothing is ever overwritten. */
export interface CommunicationEvent {
  id: string;
  kind: CommunicationEventKind;
  at: string;
  title: string;
  /** Outcome, note or remarks. */
  detail: string | null;
  by: PersonRef | null;
  /** For STAGE: the stage moved from and to, and what moved it. */
  from: StageRef | null;
  to: StageRef | null;
  source: StageChangeSource | null;
  /** INTERACTION kind, follow-up state (DONE, OPEN, OVERDUE, CANCELED) or SampBidx delivery (SENT, FAILED, SENDING). */
  subKind: string | null;
  rfq: { id: string; number: string } | null;
  /** SampBidx's own reference for a confirmed transfer. */
  remoteId: string | null;
}

export interface EmployeeCommunication {
  employee: EmployeeActivityRow;
  events: CommunicationEvent[];
}
