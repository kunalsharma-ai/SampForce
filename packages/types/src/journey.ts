import { z } from 'zod';
import type { CrmStatusRef, PersonRef } from './crm';
import { STAGE_KEYS, type StageKey, type StagePhase, stagePhaseOf } from './employee-stages';

/*
 * The company journey (redesign R5, ADR 0085). One fixed set of journey stages that every company is in, worked out
 * from its employees' communication stages (ADR 0080, 0083), its RFQs, its deals and its company status, so nothing
 * is typed twice. A Super Workspace administrator can rename, recolour or hide stages; the keys never change.
 */

/** The main path, in order; a company moves along it. */
export const JOURNEY_PATH = ['NEW', 'FRESH_EMAIL', 'INITIAL_EMAIL', 'FOLLOW_UP', 'DISCUSSION', 'RFQ', 'NEGOTIATION', 'WON'] as const;
/** Where a journey can end other than won, and the side state On Hold. */
export const JOURNEY_ENDINGS = ['LOST', 'REJECTED', 'NOT_INTERESTED', 'ON_HOLD'] as const;
export const JOURNEY_KEYS = [...JOURNEY_PATH, ...JOURNEY_ENDINGS] as const;
export type JourneyKey = (typeof JOURNEY_KEYS)[number];
export type JourneyPathKey = (typeof JOURNEY_PATH)[number];

export const DEFAULT_JOURNEY: Record<JourneyKey, { name: string; color: string }> = {
  NEW: { name: 'New Company', color: '#64748b' },
  FRESH_EMAIL: { name: 'Fresh Email Pending', color: '#0891b2' },
  INITIAL_EMAIL: { name: 'Initial Email Sent', color: '#7c3aed' },
  FOLLOW_UP: { name: 'In Follow-up', color: '#2563eb' },
  DISCUSSION: { name: 'In Discussion', color: '#d97706' },
  RFQ: { name: 'RFQ Received', color: '#0d9488' },
  NEGOTIATION: { name: 'Negotiation', color: '#ea580c' },
  WON: { name: 'Won', color: '#16a34a' },
  LOST: { name: 'Lost', color: '#4b5563' },
  REJECTED: { name: 'Rejected', color: '#dc2626' },
  NOT_INTERESTED: { name: 'Not Interested', color: '#991b1b' },
  ON_HOLD: { name: 'On Hold', color: '#b45309' },
};
/** Stages that cannot be hidden: every company has to land somewhere. */
export const JOURNEY_ALWAYS_SHOWN: readonly JourneyKey[] = ['NEW', 'RFQ', 'WON', 'LOST'];

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a colour like #2563eb').transform((v) => v.toLowerCase());
export const journeyStageSettingSchema = z.object({ name: z.string().trim().min(1).max(40).optional(), color: hex.optional(), hidden: z.boolean().optional() }).strict();
export const journeySettingsSchema = z
  .object({ stages: z.record(z.enum(JOURNEY_KEYS), journeyStageSettingSchema) })
  .strict()
  .superRefine((v, ctx) => {
    for (const k of JOURNEY_ALWAYS_SHOWN) if (v.stages[k]?.hidden) ctx.addIssue({ code: 'custom', path: ['stages', k, 'hidden'], message: 'cannot be hidden' });
  });
export type JourneySettingsInput = z.infer<typeof journeySettingsSchema>;

export interface JourneyStageRow {
  key: JourneyKey;
  name: string;
  color: string;
  hidden: boolean;
  /** True when the name or colour differs from the default. */
  customised: boolean;
}

export interface JourneySettings {
  stages: JourneyStageRow[];
  canEdit: boolean;
  updatedAt: string | null;
  updatedBy: { id: string; name: string } | null;
}

/** The stages with the workspace's names, colours and hidden flags applied, in board order. */
export function journeyStagesOf(raw: unknown): JourneyStageRow[] {
  const saved = (raw && typeof raw === 'object' ? ((raw as { stages?: unknown }).stages ?? {}) : {}) as Record<string, { name?: string; color?: string; hidden?: boolean }>;
  return JOURNEY_KEYS.map((key) => {
    const s = saved[key] ?? {};
    const d = DEFAULT_JOURNEY[key];
    const name = typeof s.name === 'string' && s.name.trim() ? s.name.trim() : d.name;
    const color = typeof s.color === 'string' && /^#[0-9a-f]{6}$/i.test(s.color) ? s.color.toLowerCase() : d.color;
    return { key, name, color, hidden: !JOURNEY_ALWAYS_SHOWN.includes(key) && s.hidden === true, customised: name !== d.name || color !== d.color };
  });
}

/** What a company's journey stage is worked out from. */
export interface JourneyFacts {
  /** The company status meaning (NEW, ACTIVE, CLIENT, CONCERN, ON_HOLD, LOST) and name. */
  statusMeaning: string | null;
  statusName: string | null;
  /** Won: a won deal, or the company won with a deal (ADR 0084). */
  won: boolean;
  openDeal: boolean;
  openRfq: boolean;
  /** Each employee's communication stage key, null when none. */
  contactStages: (StageKey | null)[];
}

/** How far along the main path the company has got, from its employees, RFQs and deals (ignores the status). */
export function journeyProgressOf(f: JourneyFacts): JourneyPathKey {
  const phases = new Set<StagePhase>(f.contactStages.filter((k): k is StageKey => !!k).map(stagePhaseOf));
  const keys = new Set(f.contactStages);
  if (f.won) return 'WON';
  if (f.openDeal || phases.has('NEGOTIATION')) return 'NEGOTIATION';
  // A won, lost, rejected or cancelled RFQ means the conversation reached RFQs.
  if (f.openRfq || phases.has('RFQ') || phases.has('WON') || phases.has('LOST')) return 'RFQ';
  if (phases.has('DISCUSSION') || phases.has('CALL')) return 'DISCUSSION';
  if (phases.has('FOLLOW_UP')) return 'FOLLOW_UP';
  if (keys.has('INITIAL_EMAIL_SENT')) return 'INITIAL_EMAIL';
  if (keys.has('FRESH_EMAIL_PENDING')) return 'FRESH_EMAIL';
  return 'NEW';
}

/** The company's journey stage: the status decides won, lost and on hold; the work decides the rest. */
export function journeyStageOf(f: JourneyFacts): JourneyKey {
  if (f.won || f.statusMeaning === 'CLIENT') return 'WON';
  if (f.statusMeaning === 'LOST') return /not\s*interested/i.test(f.statusName ?? '') ? 'NOT_INTERESTED' : /reject/i.test(f.statusName ?? '') ? 'REJECTED' : 'LOST';
  if (f.statusMeaning === 'ON_HOLD') return 'ON_HOLD';
  const known = f.contactStages.filter((k): k is StageKey => !!k);
  // Every employee's conversation ended without an RFQ or deal still open: the company is lost too.
  if (known.length && known.length === f.contactStages.length && !f.openRfq && !f.openDeal && known.every((k) => stagePhaseOf(k) === 'LOST')) {
    return known.includes('RFQ_REJECTED') ? 'REJECTED' : 'LOST';
  }
  return journeyProgressOf(f);
}

/** Where a company shows when its stage is hidden: the nearest earlier shown stage of the path (or Lost). */
export function visibleJourneyKey(key: JourneyKey, hidden: ReadonlySet<JourneyKey>): JourneyKey {
  if (!hidden.has(key)) return key;
  if (key === 'REJECTED' || key === 'NOT_INTERESTED') return 'LOST';
  if (key === 'ON_HOLD') return 'NEW';
  for (let i = JOURNEY_PATH.indexOf(key as JourneyPathKey) - 1; i >= 0; i--) if (!hidden.has(JOURNEY_PATH[i]!)) return JOURNEY_PATH[i]!;
  return 'NEW';
}

export const JOURNEY_STEP_STATES = ['DONE', 'CURRENT', 'NEXT', 'PENDING', 'WON', 'LOST', 'ON_HOLD'] as const;
export type JourneyStepState = (typeof JOURNEY_STEP_STATES)[number];

export interface JourneyStep {
  key: JourneyKey;
  name: string;
  color: string;
  state: JourneyStepState;
  /** When the company reached this step, when it is known. */
  at: string | null;
}

/**
 * The visual journey: the shown path steps done, current, next or pending, ending in Won, or in the lost or on-hold
 * stage the company is in (shown after the furthest step it reached).
 */
export function journeySteps(current: JourneyKey, progress: JourneyPathKey, stages: JourneyStageRow[], at: Partial<Record<JourneyKey, string | null>> = {}): JourneyStep[] {
  const byKey = new Map(stages.map((s) => [s.key, s]));
  const path = JOURNEY_PATH.filter((k) => !byKey.get(k)?.hidden);
  const step = (key: JourneyKey, state: JourneyStepState): JourneyStep => ({ key, name: byKey.get(key)?.name ?? DEFAULT_JOURNEY[key].name, color: byKey.get(key)?.color ?? DEFAULT_JOURNEY[key].color, state, at: at[key] ?? null });
  const ended = !(JOURNEY_PATH as readonly string[]).includes(current);
  const reached = path.indexOf(visibleJourneyKey(ended ? progress : current, new Set(stages.filter((s) => s.hidden).map((s) => s.key))) as JourneyPathKey);
  if (ended) {
    const shown = visibleJourneyKey(current, new Set(stages.filter((s) => s.hidden).map((s) => s.key)));
    return [
      ...path.slice(0, Math.max(reached, 0) + 1).filter((k) => k !== 'WON').map((k) => step(k, 'DONE')),
      step(shown, shown === 'ON_HOLD' ? 'ON_HOLD' : 'LOST'),
    ];
  }
  return path.map((k, i) => step(k, k === 'WON' && i === reached ? 'WON' : i < reached ? 'DONE' : i === reached ? 'CURRENT' : i === reached + 1 ? 'NEXT' : 'PENDING'));
}

export interface JourneyCard {
  companyId: string;
  name: string;
  leadNumber: string | null;
  logoUrl: string | null;
  owner: PersonRef | null;
  status: CrmStatusRef | null;
  stage: JourneyKey;
  /** "Follow-up 2 of 5" for the employee furthest along the cadence, null when no cadence runs. */
  followUp: { step: number; total: number } | null;
  /** The next open follow-up or task for the company. */
  nextAction: { title: string; dueAt: string | null; overdue: boolean } | null;
  employees: number;
  openRfqs: number;
  updatedAt: string;
}

export interface JourneyColumn {
  stage: JourneyStageRow;
  total: number;
  cards: JourneyCard[];
}

export interface JourneyBoard {
  columns: JourneyColumn[];
  /** Companies the caller can see in all. */
  total: number;
}

export interface CompanyJourney {
  companyId: string;
  name: string;
  stage: JourneyKey;
  progress: JourneyPathKey;
  steps: JourneyStep[];
}

export const journeyBoardQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  ownerId: z.string().uuid().optional(),
  mine: z.enum(['true', 'false']).optional(),
  perStage: z.coerce.number().int().min(1).max(200).default(50),
});
export type JourneyBoardQuery = z.infer<typeof journeyBoardQuerySchema>;

/** For tests and callers that need to check a key. */
export const isStageKey = (v: unknown): v is StageKey => typeof v === 'string' && (STAGE_KEYS as readonly string[]).includes(v);
