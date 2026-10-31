import { z } from 'zod';

// ───────────── Triggers ─────────────

/** Domain events a workflow can start from. Each is published by the API in the same transaction as the change. */
export const TRIGGER_EVENTS = {
  'lead.created': { label: 'Lead is created', entity: 'lead' },
  'lead.updated': { label: 'Lead is updated', entity: 'lead' },
  'lead.assigned': { label: 'Lead is assigned', entity: 'lead' },
  'lead.converted': { label: 'Lead is converted', entity: 'lead' },
  'contact.created': { label: 'Contact is created', entity: 'contact' },
  'company.created': { label: 'Company is created', entity: 'company' },
  'deal.created': { label: 'Deal is created', entity: 'deal' },
  'deal.stage_changed': { label: 'Deal changes stage', entity: 'deal' },
  'deal.won': { label: 'Deal is won', entity: 'deal' },
  'deal.lost': { label: 'Deal is lost', entity: 'deal' },
  'task.completed': { label: 'Task is completed', entity: 'task' },
  'activity.logged': { label: 'Activity is logged', entity: 'activity' },
  'deal.health_dropped': { label: 'Deal health turns critical', entity: 'deal' },
  // Email and sequence events. The record is the lead or contact the email was sent to ("person").
  'email.sent': { label: 'Email is sent to them', entity: 'person' },
  'email.opened': { label: 'They open an email (estimate)', entity: 'person' },
  'email.clicked': { label: 'They click a link in an email', entity: 'person' },
  'email.replied': { label: 'They reply to an email', entity: 'person' },
  'email.bounced': { label: 'An email to them bounces', entity: 'person' },
  'email.unsubscribed': { label: 'They unsubscribe', entity: 'person' },
  'email.failed': { label: 'Sending to them fails', entity: 'person' },
  'sequence.enrolled': { label: 'They are added to a sequence', entity: 'person' },
  'sequence.removed': { label: 'They are removed from a sequence', entity: 'person' },
  // Website visitor intelligence: a known visitor's intent score reaches the workspace threshold.
  'visitor.high_intent': { label: 'They show high intent on your website', entity: 'person' },
} as const;
export type TriggerEvent = keyof typeof TRIGGER_EVENTS;
export type TriggerEntity = (typeof TRIGGER_EVENTS)[TriggerEvent]['entity'];

/**
 * Email events DealFlow can actually observe. There is no "delivered" event: Gmail and Outlook do not report
 * delivery to the sender, so DealFlow only knows an email was handed over (sent) or came back (bounced).
 * Opens are estimates (image loading, privacy proxies and scanners); clicks can come from security scanners too.
 */
export const EMAIL_TRIGGER_CONFIDENCE: Partial<Record<TriggerEvent, 'confirmed' | 'estimate' | 'likely'>> = {
  'email.sent': 'confirmed',
  'email.opened': 'estimate',
  'email.clicked': 'likely',
  'email.replied': 'confirmed',
  'email.bounced': 'confirmed',
  'email.unsubscribed': 'confirmed',
  'email.failed': 'confirmed',
};
export const TRIGGER_EVENT_KEYS = Object.keys(TRIGGER_EVENTS) as [TriggerEvent, ...TriggerEvent[]];

/** Every event type the outbox carries (triggers plus events only webhooks and notifications use). */
export const DOMAIN_EVENT_TYPES = [
  ...TRIGGER_EVENT_KEYS,
  'lead.deleted',
  'lead.merged',
  'contact.updated',
  'contact.deleted',
  'company.updated',
  'company.deleted',
  'deal.updated',
  'deal.deleted',
  'task.created',
  'task.updated',
] as const;
export type DomainEventType = (typeof DOMAIN_EVENT_TYPES)[number];

// ───────────── Conditions ─────────────

export const CONDITION_OPS = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains', 'in', 'empty', 'not_empty'] as const;
export type ConditionOp = (typeof CONDITION_OPS)[number];

const scalar = z.union([z.string().max(500), z.number(), z.boolean()]);
export const conditionRuleSchema = z.object({
  /** Dotted path into the evaluation context, e.g. `record.status`, `record.estimatedValue`, `event.to`. */
  field: z.string().regex(/^(record|event)\.[A-Za-z0-9_.]{1,80}$/, 'Use record.<field> or event.<field>'),
  op: z.enum(CONDITION_OPS),
  value: z.union([scalar, z.array(z.string().max(200)).max(50)]).optional(),
});
export type ConditionRule = z.infer<typeof conditionRuleSchema>;

export const conditionGroupSchema = z.object({
  match: z.enum(['all', 'any']).default('all'),
  rules: z.array(conditionRuleSchema).max(20).default([]),
});
export type ConditionGroup = z.infer<typeof conditionGroupSchema>;

// ───────────── Actions ─────────────

const assignee = z.union([z.literal('record_owner'), z.literal('trigger_actor'), z.string().uuid()]);

/** Lead fields a workflow may set. Anything touching money, ownership rules or security is excluded. */
export const UPDATABLE_FIELDS = {
  lead: ['status', 'source', 'industry'],
  deal: ['probability'],
} as const;

export const actionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('create_task'),
    title: z.string().trim().min(1).max(200),
    dueInDays: z.number().int().min(0).max(365).optional(),
    assignTo: assignee.default('record_owner'),
    priority: z.enum(['LOW', 'NORMAL', 'HIGH']).default('NORMAL'),
  }),
  z.object({ type: z.literal('assign_owner'), mode: z.enum(['round_robin', 'user']), userIds: z.array(z.string().uuid()).min(1).max(50) }),
  z.object({ type: z.literal('update_field'), field: z.string().max(40), value: z.union([z.string().max(200), z.number(), z.null()]) }),
  /** Leads only. */
  z.object({ type: z.literal('add_tag'), tag: z.string().trim().min(1).max(40) }),
  z.object({
    type: z.literal('notify'),
    to: assignee.default('record_owner'),
    title: z.string().trim().min(1).max(200),
    body: z.string().max(1000).optional(),
  }),
  z.object({ type: z.literal('log_note'), subject: z.string().trim().min(1).max(200), body: z.string().max(5000).optional() }),
  /** Leads and contacts: stop or pause every live sequence run to this person. */
  z.object({ type: z.literal('stop_sequences'), mode: z.enum(['stop', 'pause']).default('stop') }),
  /**
   * Leads and contacts: add them to an active sequence, which then sends under its own send window, daily limits,
   * do-not-email list and consent checks. One person per run; never a bulk enrolment.
   */
  z.object({ type: z.literal('enroll_in_sequence'), sequenceId: z.string().uuid() }),
  /** Leads and contacts: mark the email address as needing a check before anyone writes to it again. */
  z.object({ type: z.literal('flag_email'), status: z.enum(['needs_verification', 'invalid', 'valid']).default('needs_verification') }),
  /** Leads and contacts: add (or with a negative number, remove) engagement points. Kept between 0 and 100. */
  z.object({ type: z.literal('add_engagement_points'), points: z.number().int().min(-50).max(50).refine((n) => n !== 0, 'Use a number other than 0') }),
  /** External: always requires an approval before it runs. */
  z.object({ type: z.literal('send_webhook'), url: z.string().url().max(2000) }),
  /** External: one email to the record's address from the workflow owner's mailbox, after approval. */
  z.object({ type: z.literal('send_email'), subject: z.string().trim().min(1).max(200), body: z.string().min(1).max(10_000) }),
]);
export type WorkflowAction = z.infer<typeof actionSchema>;
export const EXTERNAL_ACTIONS = ['send_webhook', 'send_email'] as const;
/** Actions that only make sense for a lead or contact. */
export const PERSON_ACTIONS = new Set<WorkflowAction['type']>(['stop_sequences', 'enroll_in_sequence', 'flag_email', 'add_engagement_points']);

// ───────────── Nodes and definition ─────────────

const nodeId = z.string().regex(/^[a-z0-9_-]{1,40}$/i);
const nextRef = nodeId.nullable().default(null);

export const workflowNodeSchema = z.discriminatedUnion('type', [
  z.object({ id: nodeId, type: z.literal('condition'), label: z.string().max(80).optional(), condition: conditionGroupSchema, onTrue: nextRef, onFalse: nextRef }),
  z.object({ id: nodeId, type: z.literal('action'), label: z.string().max(80).optional(), action: actionSchema, next: nextRef }),
  z.object({ id: nodeId, type: z.literal('delay'), label: z.string().max(80).optional(), amount: z.number().int().min(1).max(365), unit: z.enum(['minutes', 'hours', 'days']), next: nextRef }),
  z.object({
    id: nodeId,
    type: z.literal('approval'),
    label: z.string().max(80).optional(),
    title: z.string().trim().min(1).max(200),
    next: nextRef,
    onReject: nextRef,
  }),
]);
export type WorkflowNode = z.infer<typeof workflowNodeSchema>;

export const workflowDefinitionSchema = z
  .object({
    trigger: z.object({ event: z.enum(TRIGGER_EVENT_KEYS), conditions: conditionGroupSchema.optional() }),
    start: nodeId.nullable(),
    nodes: z.array(workflowNodeSchema).max(50),
  })
  .superRefine((def, ctx) => {
    const ids = new Set<string>();
    for (const n of def.nodes) {
      if (ids.has(n.id)) ctx.addIssue({ code: 'custom', path: ['nodes'], message: `Duplicate step id "${n.id}"` });
      ids.add(n.id);
    }
    const refs = (n: WorkflowNode) =>
      n.type === 'condition' ? [n.onTrue, n.onFalse] : n.type === 'approval' ? [n.next, n.onReject] : [n.next];
    if (def.start && !ids.has(def.start)) ctx.addIssue({ code: 'custom', path: ['start'], message: 'Start step does not exist' });
    for (const n of def.nodes) {
      for (const r of refs(n)) if (r && !ids.has(r)) ctx.addIssue({ code: 'custom', path: ['nodes'], message: `Step "${n.id}" points to missing step "${r}"` });
    }
    // Graphs must be acyclic so every run ends; loops back into a workflow come only from new events.
    const byId = new Map(def.nodes.map((n) => [n.id, n]));
    const state = new Map<string, 1 | 2>();
    const visit = (id: string): boolean => {
      if (state.get(id) === 2) return false;
      if (state.get(id) === 1) return true;
      state.set(id, 1);
      const n = byId.get(id);
      const cyc = n ? refs(n).some((r) => r && visit(r)) : false;
      state.set(id, 2);
      return cyc;
    };
    if (def.nodes.some((n) => visit(n.id))) ctx.addIssue({ code: 'custom', path: ['nodes'], message: 'Steps must not loop back' });
    for (const n of def.nodes) {
      if (n.type === 'action' && n.action.type === 'update_field') {
        const entity = TRIGGER_EVENTS[def.trigger.event].entity;
        const allowed = (UPDATABLE_FIELDS as Record<string, readonly string[]>)[entity] ?? [];
        if (!allowed.includes(n.action.field)) ctx.addIssue({ code: 'custom', path: ['nodes'], message: `Step "${n.id}" cannot update "${n.action.field}" on a ${entity}` });
      }
      if (n.type === 'delay' && !n.next) {
        ctx.addIssue({ code: 'custom', path: ['nodes'], message: `Step "${n.id}" waits with nothing after it; add a step after the wait` });
      }
      if (n.type === 'action' && n.action.type === 'add_tag' && TRIGGER_EVENTS[def.trigger.event].entity !== 'lead') {
        ctx.addIssue({ code: 'custom', path: ['nodes'], message: `Step "${n.id}": tags can only be added to leads` });
      }
      if (n.type === 'action' && PERSON_ACTIONS.has(n.action.type) && !['lead', 'contact', 'person'].includes(TRIGGER_EVENTS[def.trigger.event].entity)) {
        ctx.addIssue({ code: 'custom', path: ['nodes'], message: `Step "${n.id}": this action needs a lead or contact, so use a lead, contact or email trigger` });
      }
    }
  });
export type WorkflowDefinition = z.infer<typeof workflowDefinitionSchema>;

export const workflowInputSchema = z.object({
  name: z.string().trim().min(1, 'Enter a name').max(120),
  description: z.string().trim().max(500).optional(),
  definition: workflowDefinitionSchema,
});
export type WorkflowInput = z.infer<typeof workflowInputSchema>;

export interface WorkflowRow {
  id: string;
  name: string;
  description: string | null;
  status: 'DRAFT' | 'ACTIVE' | 'PAUSED';
  triggerType: TriggerEvent;
  version: number;
  definition: WorkflowDefinition;
  runs30d: number;
  failures30d: number;
  createdBy: { id: string; name: string } | null;
  updatedAt: string;
}

export type ExecutionStatus = 'RUNNING' | 'WAITING' | 'AWAITING_APPROVAL' | 'SUCCEEDED' | 'FAILED' | 'CANCELED';

export interface ExecutionStepRow {
  nodeId: string;
  nodeType: string;
  status: string;
  output: Record<string, unknown>;
  error: string | null;
  startedAt: string;
}

export interface ExecutionRow {
  id: string;
  workflowId: string;
  workflowName: string;
  version: number;
  status: ExecutionStatus;
  simulation: boolean;
  eventType: string;
  entityType: string | null;
  entityId: string | null;
  error: string | null;
  resumeAt: string | null;
  startedAt: string;
  finishedAt: string | null;
  steps: ExecutionStepRow[];
}

export const simulateSchema = z.object({ definition: workflowDefinitionSchema, recordId: z.string().uuid() });

export interface SimulationResult {
  path: { nodeId: string; nodeType: string; outcome: string; detail?: string }[];
  triggerMatched: boolean;
  ended: 'completed' | 'waiting' | 'awaiting_approval' | 'trigger_not_matched' | 'failed';
}

// ───────────── Approvals ─────────────

export interface ApprovalRow {
  id: string;
  kind: string;
  title: string;
  summary: string | null;
  payload: Record<string, unknown>;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED' | 'CANCELED';
  workflow: { id: string; name: string } | null;
  executionId: string | null;
  decidedBy: { id: string; name: string } | null;
  decidedAt: string | null;
  decisionNote: string | null;
  expiresAt: string;
  createdAt: string;
}

export const approvalDecisionSchema = z.object({ decision: z.enum(['approve', 'reject']), note: z.string().trim().max(500).optional() });

// ───────────── Notifications ─────────────

export interface NotificationRow {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

// ───────────── Webhooks ─────────────

export const webhookInputSchema = z.object({
  url: z.string().trim().url('Enter a full https:// URL').max(2000),
  events: z.array(z.enum(DOMAIN_EVENT_TYPES)).min(1, 'Choose at least one event').max(DOMAIN_EVENT_TYPES.length),
});
export interface WebhookRow {
  id: string;
  url: string;
  events: DomainEventType[];
  active: boolean;
  consecutiveFailures: number;
  disabledReason: string | null;
  createdAt: string;
  recentDeliveries: { id: string; eventType: string; status: 'PENDING' | 'SUCCEEDED' | 'FAILED'; attempts: number; responseCode: number | null; lastError: string | null; createdAt: string }[];
}
export interface WebhookCreated extends WebhookRow {
  /** Shown once. Receivers verify `X-DealFlow-Signature: t=<unix>,v1=<hex HMAC-SHA256 of "t.body">`. */
  secret: string;
}

// ───────────── Integrations, email, meetings ─────────────

export const INTEGRATION_PROVIDERS = ['GOOGLE', 'MICROSOFT'] as const;
export type IntegrationProviderKey = (typeof INTEGRATION_PROVIDERS)[number];

export interface ProviderStatus {
  provider: IntegrationProviderKey;
  name: string;
  /** False when the platform has no OAuth client credentials for this provider. */
  configured: boolean;
  missingConfig: string[];
  connection: {
    id: string;
    accountEmail: string;
    status: 'CONNECTED' | 'ERROR' | 'DISCONNECTED';
    lastSyncAt: string | null;
    lastError: string | null;
    scopes: string[];
  } | null;
}

export interface EmailRow {
  id: string;
  direction: 'INBOUND' | 'OUTBOUND';
  from: string;
  to: string[];
  subject: string;
  snippet: string | null;
  sentAt: string;
  contactId: string | null;
  leadId: string | null;
  provider: IntegrationProviderKey;
  /** The Email Assistant's reading of a received email (an EMAIL_INTENTS key), when someone asked for it. */
  aiIntent: string | null;
  /** The inbox conversation this message belongs to. */
  conversationId: string | null;
}

export interface MeetingRow {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  location: string | null;
  attendees: string[];
  canceled: boolean;
  contactIds: string[];
  provider: IntegrationProviderKey;
  /** Google Meet, Teams or Zoom link from the calendar event. */
  joinUrl: string | null;
  platform: MeetingPlatform | null;
  /** The meeting record (notes, transcript, AI reading) opened for this meeting, if any. */
  recordId: string | null;
}

export type MeetingPlatform = 'google_meet' | 'zoom' | 'teams';
export const MEETING_PLATFORM_LABELS: Record<MeetingPlatform, string> = { google_meet: 'Google Meet', zoom: 'Zoom', teams: 'Microsoft Teams' };
export function meetingPlatform(url: string | null | undefined): MeetingPlatform | null {
  if (!url) return null;
  if (/meet\.google\.com/i.test(url)) return 'google_meet';
  if (/zoom\.us/i.test(url)) return 'zoom';
  if (/teams\.(microsoft|live)\.com/i.test(url)) return 'teams';
  return null;
}

export const sendEmailSchema = z.object({
  to: z.string().trim().toLowerCase().email().max(254),
  subject: z.string().trim().min(1, 'Enter a subject').max(200),
  body: z.string().min(1, 'Write a message').max(20_000),
  contactId: z.string().uuid().optional(),
  leadId: z.string().uuid().optional(),
  /** Reply inside this inbox conversation (same mailbox only). */
  conversationId: z.string().uuid().optional(),
});
export type SendEmailInput = z.infer<typeof sendEmailSchema>;

// ───────────── Inbox (enhancement feature 8) ─────────────

export const INBOX_STATUSES = ['OPEN', 'WAITING', 'CLOSED'] as const;
export type InboxStatus = (typeof INBOX_STATUSES)[number];
export const INBOX_STATUS_LABELS: Record<InboxStatus, string> = { OPEN: 'Open', WAITING: 'Waiting on them', CLOSED: 'Closed' };
export const INBOX_CATEGORIES = ['sales', 'support', 'billing', 'partnership', 'other'] as const;
export type InboxCategory = (typeof INBOX_CATEGORIES)[number];
export const INBOX_CATEGORY_LABELS: Record<InboxCategory, string> = { sales: 'Sales', support: 'Support', billing: 'Billing', partnership: 'Partnership', other: 'Other' };

export const inboxQuerySchema = z.object({
  /** ACTIVE means open or waiting (not closed). */
  status: z.enum([...INBOX_STATUSES, 'ACTIVE']).optional(),
  category: z.enum(INBOX_CATEGORIES).optional(),
  /** "me", "unassigned" or a user id. */
  assigned: z.union([z.enum(['me', 'unassigned']), z.string().uuid()]).optional(),
  /** Only conversations from my own mailboxes. */
  mine: z.enum(['true', 'false']).optional(),
  linked: z.enum(['deal', 'none']).optional(),
  dealId: z.string().uuid().optional(),
  contactId: z.string().uuid().optional(),
  leadId: z.string().uuid().optional(),
  q: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  /** Pass the previous page's nextCursor. */
  cursor: z.string().max(100).optional(),
});
export type InboxQuery = z.infer<typeof inboxQuerySchema>;

export const inboxUpdateSchema = z.object({
  status: z.enum(INBOX_STATUSES).optional(),
  category: z.enum(INBOX_CATEGORIES).nullable().optional(),
  assignedToId: z.string().uuid().nullable().optional(),
  dealId: z.string().uuid().nullable().optional(),
  contactId: z.string().uuid().nullable().optional(),
  leadId: z.string().uuid().nullable().optional(),
});
export type InboxUpdate = z.infer<typeof inboxUpdateSchema>;

export const inboxNoteSchema = z.object({ body: z.string().trim().min(1, 'Write a note').max(5000) });

export interface InboxThreadRow {
  id: string;
  subject: string;
  status: InboxStatus;
  category: InboxCategory | null;
  mailbox: { id: string; accountEmail: string; provider: IntegrationProviderKey; ownerId: string };
  assignedTo: { id: string; name: string } | null;
  contact: { id: string; name: string; companyId: string | null; companyName: string | null } | null;
  lead: { id: string; name: string } | null;
  deal: { id: string; name: string } | null;
  messageCount: number;
  lastMessageAt: string;
  lastDirection: 'INBOUND' | 'OUTBOUND';
  /** The latest message: who it is from and a short preview. */
  preview: { from: string; snippet: string | null } | null;
  /** The AI's reading of the latest analysed received email, if anyone asked. */
  aiIntent: string | null;
  noteCount: number;
}

/** What DealFlow observed for a sent message. Opens are estimates; "delivered" is not reported by Gmail or Outlook. */
export interface InboxMessageTracking {
  openedAt: string | null;
  openCount: number;
  clickedAt: string | null;
  clickCount: number;
  bouncedAt: string | null;
  repliedAt: string | null;
}

export interface InboxMessage extends EmailRow {
  cc: string[];
  bodyText: string | null;
  /** Present for sequence emails, which carry tracking. */
  tracking: InboxMessageTracking | null;
}

export interface InboxNote {
  id: string;
  body: string;
  author: { id: string; name: string } | null;
  createdAt: string;
}

export interface InboxThread extends InboxThreadRow {
  messages: InboxMessage[];
  notes: InboxNote[];
  /** False when the conversation is in someone else's mailbox: a reply goes from your own and starts a new conversation. */
  canReplyInThread: boolean;
}

export interface SyncLogRow {
  id: string;
  mailbox: { id: string; accountEmail: string; provider: IntegrationProviderKey };
  trigger: 'manual' | 'scheduled';
  ok: boolean;
  emails: number;
  meetings: number;
  error: string | null;
  startedAt: string;
  finishedAt: string;
}
