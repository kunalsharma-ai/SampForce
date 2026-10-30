import { z } from 'zod';
import type { Permission } from './permissions';
import { PLAN_ENTITLEMENTS, type PlanCode } from './plans';

// ───────────── Agents ─────────────

/** Model tier an agent asks for. The gateway maps a tier to a model and an effort level. */
export type AiTier = 'fast' | 'balanced' | 'deep';

export const AI_AGENT_KEYS = ['copilot', 'lead_qualification', 'deal_intelligence', 'meeting_notes', 'proposal_draft', 'workflow_builder', 'forecast_explainer'] as const;
export type AiAgentKey = (typeof AI_AGENT_KEYS)[number];

export interface AiAgentDef {
  key: AiAgentKey;
  name: string;
  purpose: string;
  tier: AiTier;
  /** Permission a person needs to run the agent. */
  permission: Permission;
  /** What still works when no AI provider is configured or AI is switched off. */
  withoutModel: string | null;
  /** What the agent may do, in the action tiers of docs/AI_AND_AUTOMATION.md. */
  can: string[];
  cannot: string[];
}

export const AI_AGENTS: Record<AiAgentKey, AiAgentDef> = {
  copilot: {
    key: 'copilot',
    name: 'Copilot',
    purpose: 'Answers questions about your CRM data and proposes tasks, notes and deal updates for you to confirm.',
    tier: 'balanced',
    permission: 'ai:use',
    withoutModel: null,
    can: ['Read records your role can read', 'Propose a task, a note or a deal stage change'],
    cannot: ['Change anything before you confirm it', 'Send email or messages', 'Change amounts, prices or discounts', 'Export data', 'Change roles or security settings'],
  },
  lead_qualification: {
    key: 'lead_qualification',
    name: 'Lead Qualification',
    purpose: 'Scores a lead from explainable signals and writes a short qualification summary.',
    tier: 'fast',
    permission: 'leads:write',
    withoutModel: 'The rule-based score and its signals are still calculated; only the written summary needs the AI provider.',
    can: ['Read the lead and its activity', 'Store a score with the signals behind it'],
    cannot: ['Change the lead status or owner', 'Contact the lead'],
  },
  deal_intelligence: {
    key: 'deal_intelligence',
    name: 'Deal Intelligence',
    purpose: 'Checks deal health from activity, stage age and dates, and recommends a next step.',
    tier: 'fast',
    permission: 'deals:read',
    withoutModel: 'Health signals and the risk level are still calculated; the recommended next step needs the AI provider.',
    can: ['Read the deal, its activity and tasks', 'Recommend a next step you can turn into a task'],
    cannot: ['Change the deal', 'Contact anyone'],
  },
  meeting_notes: {
    key: 'meeting_notes',
    name: 'Meeting Notes',
    purpose: 'Turns meeting notes you paste in into a summary, action items and a follow-up email draft.',
    tier: 'balanced',
    permission: 'activities:write',
    withoutModel: null,
    can: ['Read the notes you provide and the related record', 'Propose tasks and a draft follow-up'],
    cannot: ['Record or transcribe meetings', 'Send the follow-up'],
  },
  proposal_draft: {
    key: 'proposal_draft',
    name: 'Proposal Draft',
    purpose: 'Drafts a proposal outline from the deal, company and activity history.',
    tier: 'balanced',
    permission: 'deals:read',
    withoutModel: null,
    can: ['Read the deal and related records', 'Write a draft you can copy and edit'],
    cannot: ['Change amounts, prices or discounts', 'Send the proposal'],
  },
  workflow_builder: {
    key: 'workflow_builder',
    name: 'Workflow Builder',
    purpose: 'Turns a plain-language description into a draft workflow you review, simulate and activate yourself.',
    tier: 'balanced',
    permission: 'automation:manage',
    withoutModel: null,
    can: ['Write a draft workflow definition'],
    cannot: ['Save or activate the workflow'],
  },
  forecast_explainer: {
    key: 'forecast_explainer',
    name: 'Forecast Explainer',
    purpose: 'Explains what changed between two forecast snapshots, using only the recorded differences.',
    tier: 'fast',
    permission: 'dashboard:read',
    withoutModel: 'The list of changed deals is still shown; only the written explanation needs the AI provider.',
    can: ['Read two forecast snapshots'],
    cannot: ['Change deals or forecasts'],
  },
};

// ───────────── Credits ─────────────

/** Credits charged for one model call. 1 credit ≈ 3,000 input + 500 output tokens (docs/PRICING_STRATEGY.md). */
export function creditsFor(inputTokens: number, outputTokens: number, tier: AiTier): number {
  const weighted = inputTokens + 6 * outputTokens;
  const base = Math.max(1, Math.ceil(weighted / 6000));
  return base * (tier === 'deep' ? 4 : tier === 'balanced' ? 2 : 1);
}

/** Plan allowance: credits per seat per month, pooled across the workspace's active seats. */
export function monthlyCreditAllowance(planCode: string, seats: number): number {
  const ent = PLAN_ENTITLEMENTS[planCode as PlanCode] ?? PLAN_ENTITLEMENTS.free;
  return ent.monthlyAiCredits * Math.max(1, seats);
}

// ───────────── Settings and status ─────────────

export const aiSettingsUpdateSchema = z.object({
  enabled: z.boolean().optional(),
  disabledAgents: z.array(z.enum(AI_AGENT_KEYS)).max(AI_AGENT_KEYS.length).optional(),
  autoQualifyLeads: z.boolean().optional(),
  redactPii: z.boolean().optional(),
  monthlyCreditCap: z.number().int().min(0).max(10_000_000).nullable().optional(),
});
export type AiSettingsUpdate = z.infer<typeof aiSettingsUpdateSchema>;

export interface AiStatus {
  provider: { configured: boolean; name: string; model: string | null; note: string };
  settings: { enabled: boolean; disabledAgents: AiAgentKey[]; autoQualifyLeads: boolean; redactPii: boolean; monthlyCreditCap: number | null };
  credits: { used: number; allowance: number; limit: number; remaining: number; periodStart: string; seats: number };
  /** Per agent: whether it can run a model call right now, and why not. */
  agents: { key: AiAgentKey; enabled: boolean; available: boolean; reason: string | null }[];
}

export interface AiUsageSummary {
  periodStart: string;
  byAgent: { agent: string; calls: number; credits: number; inputTokens: number; outputTokens: number }[];
  recentRuns: AiRunRow[];
}

export interface AiRunRow {
  id: string;
  agent: string;
  status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'BLOCKED';
  user: { id: string; name: string } | null;
  entityType: string | null;
  entityId: string | null;
  model: string | null;
  promptVersion: string;
  creditsUsed: number;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
}

// ───────────── Copilot ─────────────

export const copilotRequestSchema = z.object({
  question: z.string().trim().min(1, 'Ask a question').max(2000),
  conversationId: z.string().uuid().optional(),
});
export type CopilotRequest = z.infer<typeof copilotRequestSchema>;

export interface Citation {
  entity: 'lead' | 'contact' | 'company' | 'deal' | 'task';
  id: string;
  label: string;
}

export type ProposedActionTool = 'create_task' | 'log_note' | 'move_deal_stage';

export interface ProposedAction {
  id: string;
  tool: ProposedActionTool;
  title: string;
  input: Record<string, unknown>;
  /** Permission checked when the action was proposed, and again when it is confirmed. */
  permission: Permission;
  status: 'proposed' | 'applied' | 'dismissed' | 'failed';
  /** True when the run had read email or other external content before proposing this. */
  fromUntrustedContent: boolean;
  result: Record<string, unknown> | null;
  error: string | null;
}

export interface CopilotAnswer {
  runId: string;
  conversationId: string;
  status: 'SUCCEEDED' | 'FAILED' | 'BLOCKED';
  answer: string;
  citations: Citation[];
  actions: ProposedAction[];
  toolsUsed: string[];
  creditsUsed: number;
}

export interface CopilotTurn {
  runId: string;
  question: string;
  answer: CopilotAnswer;
  createdAt: string;
}

export const actionDecisionSchema = z.object({ decision: z.enum(['confirm', 'dismiss']) });

// ───────────── Agent results ─────────────

export interface Signal {
  key: string;
  label: string;
  /** Contribution to the score, or a risk weight for deal health. */
  points: number;
  detail: string;
}

export interface LeadQualification {
  score: number;
  grade: 'A' | 'B' | 'C' | 'D';
  signals: Signal[];
  summary: string | null;
  suggestedNextStep: string | null;
  /** Why the written part is missing, if it is. */
  summaryUnavailable: string | null;
}

export interface DealHealth {
  health: number;
  risk: 'low' | 'medium' | 'high';
  signals: Signal[];
  nextStep: { title: string; reason: string; dueInDays: number } | null;
  nextStepUnavailable: string | null;
}

export interface MeetingSummary {
  summary: string;
  decisions: string[];
  actionItems: { title: string; owner: 'me' | 'customer'; dueInDays: number | null }[];
  followUpEmail: { subject: string; body: string };
}

export interface ProposalDraft {
  title: string;
  sections: { heading: string; body: string }[];
  /** Facts the draft relies on, so a person can check them. */
  basedOn: string[];
  openQuestions: string[];
}

export interface RecommendationRow<T = Record<string, unknown>> {
  id: string;
  agent: string;
  kind: string;
  entityType: string;
  entityId: string;
  payload: T;
  promptVersion: string;
  status: 'PROPOSED' | 'ACCEPTED' | 'DISMISSED';
  decidedAt: string | null;
  createdAt: string;
}

export const meetingNotesRequestSchema = z
  .object({
    notes: z.string().trim().min(20, 'Paste at least a few lines of notes').max(20_000),
    meetingId: z.string().uuid().optional(),
    dealId: z.string().uuid().optional(),
    contactId: z.string().uuid().optional(),
    leadId: z.string().uuid().optional(),
  })
  .refine((v) => v.meetingId || v.dealId || v.contactId || v.leadId, { message: 'Link the notes to a meeting, deal, contact or lead', path: ['dealId'] });
export type MeetingNotesRequest = z.infer<typeof meetingNotesRequestSchema>;

export const workflowDraftRequestSchema = z.object({ description: z.string().trim().min(10, 'Describe the workflow in a sentence or two').max(2000) });

export const acceptNextStepSchema = z.object({ title: z.string().trim().min(1).max(200).optional(), dueInDays: z.number().int().min(0).max(365).optional() });

export const createActionItemsSchema = z.object({ indexes: z.array(z.number().int().min(0).max(50)).min(1).max(20) });
