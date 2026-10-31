import { z } from 'zod';
import type { Permission } from './permissions';
import { PLAN_ENTITLEMENTS, type PlanCode } from './plans';

// ───────────── Agents ─────────────

/** Model tier an agent asks for. The gateway maps a tier to a model and an effort level. */
export type AiTier = 'fast' | 'balanced' | 'deep';

export const AI_AGENT_KEYS = ['copilot', 'lead_qualification', 'deal_intelligence', 'meeting_notes', 'proposal_draft', 'workflow_builder', 'forecast_explainer', 'email_assistant', 'voice_assistant'] as const;
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
    purpose: 'Turns meeting notes or a transcript into a summary, key points, requirements, objections, action items, commitments, speakers and a follow-up email draft for you to review.',
    tier: 'balanced',
    permission: 'activities:write',
    withoutModel: null,
    can: ['Read the notes or transcript you provide and the related record', 'Propose tasks, a record note and a draft follow-up for you to review'],
    cannot: ['Join or record meetings', 'Transcribe audio (a separate speech-to-text service does that when configured)', 'Create tasks or notes without your review', 'Send the follow-up'],
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
  email_assistant: {
    key: 'email_assistant',
    name: 'Email Assistant',
    purpose: 'Drafts, rewrites and improves emails from CRM data, suggests subject lines, and reads a received email for intent, objections and a suggested reply.',
    tier: 'balanced',
    permission: 'ai:use',
    withoutModel: 'Templates, merge fields and the rule-based sequence tips still work; drafting and reading emails need the AI provider.',
    can: ['Read the lead, contact or deal and its recent email', 'Write a draft into the editor for you to review'],
    cannot: ['Send an email', 'Change the record', 'Invent prices, dates or commitments'],
  },
  voice_assistant: {
    key: 'voice_assistant',
    name: 'Voice Assistant',
    purpose: 'Turns a dictated or recorded voice note into proposed tasks, notes, leads and contacts, and finds the summary of your last call.',
    tier: 'fast',
    permission: 'activities:write',
    withoutModel: 'You can still dictate or type a note and add tasks and notes by hand; turning a note into actions needs the AI provider.',
    can: ['Read the note you dictate and the record it is on', 'Propose tasks, notes, leads and contacts for you to check and confirm'],
    cannot: ['Save anything without your confirmation', 'Delete records, send emails or change amounts, stages or owners', 'Invent names, emails, phone numbers or dates'],
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

// ───────────── Email assistant (enhancement feature 5, Part 3 F) ─────────────

export const EMAIL_TONES = ['professional', 'friendly', 'formal', 'concise', 'confident', 'empathetic'] as const;
export type EmailTone = (typeof EMAIL_TONES)[number];
export const EMAIL_TONE_LABELS: Record<EmailTone, string> = {
  professional: 'Professional',
  friendly: 'Friendly',
  formal: 'Formal',
  concise: 'Concise',
  confident: 'Confident',
  empathetic: 'Empathetic',
};
export const EMAIL_LENGTHS = ['short', 'medium', 'long'] as const;

/**
 * Draft an email. `compose` writes a first email for an objective, `follow_up` follows up on the latest email to
 * the person, `reply` answers a received email. With `asTemplate` the draft uses merge tags instead of real values,
 * so it can be saved as a template or sequence step.
 */
export const emailDraftRequestSchema = z
  .object({
    mode: z.enum(['compose', 'follow_up', 'reply']).default('compose'),
    objective: z.string().trim().max(500).default(''),
    tone: z.enum(EMAIL_TONES).default('professional'),
    length: z.enum(EMAIL_LENGTHS).default('short'),
    leadId: z.string().uuid().optional(),
    contactId: z.string().uuid().optional(),
    dealId: z.string().uuid().optional(),
    /** For replies: the received email to answer. */
    emailId: z.string().uuid().optional(),
    asTemplate: z.boolean().default(false),
  })
  .superRefine((v, ctx) => {
    if (v.mode === 'reply' && !v.emailId) ctx.addIssue({ code: 'custom', path: ['emailId'], message: 'Pick the email to reply to' });
    if (v.mode === 'compose' && !v.objective) ctx.addIssue({ code: 'custom', path: ['objective'], message: 'Say what the email should achieve' });
    if (!v.asTemplate && !v.leadId && !v.contactId && !v.dealId && !v.emailId) ctx.addIssue({ code: 'custom', path: ['leadId'], message: 'Pick who the email is for, or write it as a template' });
  });
export type EmailDraftRequest = z.infer<typeof emailDraftRequestSchema>;

export interface EmailDraft {
  subject: string;
  body: string;
  subjectAlternatives: string[];
  /** Facts from the CRM the draft relied on. */
  basedOn: string[];
  /** Things to check before sending, such as a claim the CRM could not confirm. */
  checkBeforeSending: string[];
  /** Merge tags the draft uses (template drafts only). */
  mergeTags: string[];
}

export const EMAIL_REWRITE_ACTIONS = ['improve', 'shorten', 'tone'] as const;
export const emailRewriteRequestSchema = z
  .object({
    action: z.enum(EMAIL_REWRITE_ACTIONS),
    tone: z.enum(EMAIL_TONES).optional(),
    subject: z.string().max(200).default(''),
    body: z.string().trim().min(1, 'Write something to rewrite').max(20_000),
  })
  .refine((v) => v.action !== 'tone' || v.tone, { message: 'Pick a tone', path: ['tone'] });
export type EmailRewriteRequest = z.infer<typeof emailRewriteRequestSchema>;
export interface EmailRewrite {
  subject: string;
  body: string;
  /** What changed, in a few words each. */
  changes: string[];
}

export const emailSubjectsRequestSchema = z.object({ body: z.string().trim().min(1, 'Write the email first').max(20_000), current: z.string().max(200).default('') });
export interface EmailSubjects {
  subjects: { text: string; why: string }[];
}

/** What a received email asks for. Intent is the model's reading; confidence says how clear the email was. */
export const EMAIL_INTENTS = ['interested', 'meeting_request', 'question', 'objection', 'not_now', 'not_interested', 'unsubscribe', 'referral', 'out_of_office', 'other'] as const;
export type EmailIntent = (typeof EMAIL_INTENTS)[number];
export const EMAIL_INTENT_LABELS: Record<EmailIntent, string> = {
  interested: 'Interested',
  meeting_request: 'Wants a meeting',
  question: 'Has a question',
  objection: 'Raised an objection',
  not_now: 'Not now',
  not_interested: 'Not interested',
  unsubscribe: 'Asked not to be emailed',
  referral: 'Referred someone else',
  out_of_office: 'Out of office',
  other: 'Other',
};
export const EMAIL_NEXT_ACTIONS = ['reply_now', 'book_meeting', 'send_information', 'follow_up_later', 'contact_referral', 'stop_outreach', 'no_action'] as const;
export type EmailNextAction = (typeof EMAIL_NEXT_ACTIONS)[number];
export const EMAIL_NEXT_ACTION_LABELS: Record<EmailNextAction, string> = {
  reply_now: 'Reply now',
  book_meeting: 'Offer meeting times',
  send_information: 'Send the information they asked for',
  follow_up_later: 'Follow up later',
  contact_referral: 'Contact the person they referred',
  stop_outreach: 'Stop emailing them',
  no_action: 'No action needed',
};

export const emailAnalyseRequestSchema = z.object({ emailId: z.string().uuid() });
export interface EmailAnalysis {
  emailId: string;
  /** Summary of the conversation so far (this email and earlier ones with the same person). */
  summary: string;
  intent: EmailIntent;
  confidence: 'high' | 'medium' | 'low';
  objections: string[];
  buyingSignals: string[];
  nextAction: EmailNextAction;
  /** Days to wait before following up, or null when no follow-up is needed. */
  followUpInDays: number | null;
  reason: string;
  suggestedReply: { subject: string; body: string } | null;
  /** How many emails in the conversation were read. */
  messagesRead: number;
}
