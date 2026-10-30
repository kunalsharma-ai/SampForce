import { BadRequestException, ForbiddenException, Injectable, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@dealflow/database';
import {
  AI_AGENTS,
  type AiAgentKey,
  type DealHealth,
  type ForecastComparison,
  type LeadQualification,
  type MeetingNotesRequest,
  type MeetingSummary,
  type Permission,
  type ProposalDraft,
  type RecommendationRow,
  TRIGGER_EVENTS,
  UPDATABLE_FIELDS,
  type WorkflowDefinition,
  workflowDefinitionSchema,
  z,
} from '@dealflow/types';
import { AuditService } from '../audit/audit.service';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { ActivitiesService } from '../crm/activities.service';
import { notFound } from '../crm/crm-helpers';
import { TasksService } from '../crm/tasks.service';
import { errorMessage } from '../worker/queue';
import { ForecastService } from './forecast.service';
import { AiGateway, AiUnavailable } from './gateway.service';
import { PROMPTS, type PromptKey, SCHEMAS } from './prompts';
import { textOf } from './provider';
import { RecordContextBuilder, type RecordType } from './record-context';
import { Redactor, untrusted } from './redact';
import { dealHealth, SCORING_VERSION, scoreLead } from './scoring';

/** Identity for automatic runs: no user, read-only access to what the agent needs. */
export const systemActor = (tenantId: string, permissions: Permission[]): AuthContext => ({
  tenantId, userId: '', sessionId: 'ai-agent', membershipId: '', roleKey: 'system', permissions,
});

const leadSummarySchema = z.object({ summary: z.string().min(1).max(1500), nextStep: z.string().min(1).max(300) });
const nextStepSchema = z.object({ title: z.string().min(1).max(200), reason: z.string().min(1).max(500), dueInDays: z.number().int().min(0).max(90) });
const meetingSchema = z.object({
  summary: z.string().min(1).max(4000),
  decisions: z.array(z.string().max(500)).max(20),
  actionItems: z.array(z.object({ title: z.string().min(1).max(200), owner: z.enum(['me', 'customer']), dueInDays: z.number().int().min(0).max(365).nullable() })).max(20),
  followUpEmail: z.object({ subject: z.string().min(1).max(200), body: z.string().min(1).max(5000) }),
});
const proposalSchema = z.object({
  title: z.string().min(1).max(200),
  sections: z.array(z.object({ heading: z.string().min(1).max(120), body: z.string().min(1).max(4000) })).min(1).max(10),
  basedOn: z.array(z.string().max(300)).max(30),
  openQuestions: z.array(z.string().max(300)).max(30),
});
const workflowOutSchema = z.object({ name: z.string().min(1).max(120), definitionJson: z.string().min(2).max(50_000), notes: z.string().max(2000) });

const DAY = 86_400_000;

interface RunHandle {
  id: string;
  redactor: Redactor | null;
}

/**
 * The Digital Sales Team agents. Each run is recorded with its inputs, trace, prompt version and
 * credits; results that people act on are stored as recommendations with the signals behind them.
 * Agents never change deals, prices or contact details; anything beyond a score needs a person.
 */
@Injectable()
export class AgentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: AiGateway,
    private readonly records: RecordContextBuilder,
    private readonly forecast: ForecastService,
    private readonly tasks: TasksService,
    private readonly activities: ActivitiesService,
    private readonly audit: AuditService,
  ) {}

  // ───────────── Lead qualification ─────────────

  async qualifyLead(auth: AuthContext, leadId: string, opts: { runId?: string; meta?: RequestMeta } = {}): Promise<RecommendationRow<LeadQualification>> {
    const facts = await this.prisma.run(auth, async (tx) => {
      const lead = await tx.lead.findFirst({ where: { id: leadId, tenantId: auth.tenantId, deletedAt: null } });
      if (!lead) throw notFound('Lead');
      const acts = await tx.activity.findMany({ where: { tenantId: auth.tenantId, leadId, deletedAt: null }, select: { occurredAt: true }, orderBy: { occurredAt: 'desc' }, take: 50 });
      return { lead, dates: acts.map((a) => a.occurredAt) };
    });
    const base = scoreLead({
      email: facts.lead.email, phone: facts.lead.phone, jobTitle: facts.lead.jobTitle, companyName: facts.lead.companyName, industry: facts.lead.industry,
      estimatedValue: facts.lead.estimatedValue ? Number(facts.lead.estimatedValue) : null, source: facts.lead.source, status: facts.lead.status, activityDates: facts.dates,
    });

    return this.withRun(auth, 'lead_qualification', 'lead', leadId, { leadId }, opts.runId, async (run) => {
      const result: LeadQualification = { ...base, summary: null, suggestedNextStep: null, summaryUnavailable: null };
      try {
        const ctx = await this.records.load(auth, 'lead', leadId);
        const out = await this.structured(auth, run, 'lead_qualification', 'leadSummary', leadSummarySchema, {
          lead: ctx.facts, score: base.score, grade: base.grade, signals: base.signals,
        });
        result.summary = out.summary;
        result.suggestedNextStep = out.nextStep;
      } catch (err) {
        result.summaryUnavailable = unavailableReason(err);
      }
      const rec = await this.prisma.run(auth, async (tx) => {
        await tx.lead.update({ where: { id: leadId }, data: { aiScore: base.score } });
        const row = await tx.aiRecommendation.create({
          data: { tenantId: auth.tenantId, runId: run.id, agent: 'lead_qualification', kind: 'lead_qualification', entityType: 'lead', entityId: leadId, payload: result as unknown as Prisma.InputJsonValue, promptVersion: `${SCORING_VERSION}+${PROMPTS.leadSummary.version}` },
        });
        await this.audit.record(tx, {
          tenantId: auth.tenantId, actorUserId: auth.userId || null, actorType: auth.userId ? undefined : 'AI_AGENT', action: 'lead.ai_scored', entityType: 'lead', entityId: leadId,
          metadata: { score: base.score, grade: base.grade, runId: run.id, summary: !!result.summary }, meta: opts.meta,
        });
        return row;
      });
      return { output: result, rec: toRec<LeadQualification>(rec) };
    });
  }

  // ───────────── Deal intelligence ─────────────

  async analyseDeal(auth: AuthContext, dealId: string, meta: RequestMeta): Promise<RecommendationRow<DealHealth>> {
    const facts = await this.prisma.run(auth, async (tx) => {
      const d = await tx.opportunity.findFirst({ where: { id: dealId, tenantId: auth.tenantId, deletedAt: null } });
      if (!d) throw notFound('Deal');
      const [last, open, overdue, stageLog] = await Promise.all([
        tx.activity.findFirst({ where: { tenantId: auth.tenantId, opportunityId: dealId, deletedAt: null }, orderBy: { occurredAt: 'desc' }, select: { occurredAt: true } }),
        tx.task.count({ where: { tenantId: auth.tenantId, opportunityId: dealId, deletedAt: null, status: 'OPEN' } }),
        tx.task.count({ where: { tenantId: auth.tenantId, opportunityId: dealId, deletedAt: null, status: 'OPEN', dueAt: { lt: new Date() } } }),
        tx.auditLog.findFirst({ where: { tenantId: auth.tenantId, entityType: 'deal', entityId: dealId, action: 'deal.stage_changed' }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
      ]);
      return { d, last, open, overdue, stageLog };
    });
    const base = dealHealth({
      status: facts.d.status, amount: Number(facts.d.amount), expectedCloseDate: facts.d.expectedCloseDate, createdAt: facts.d.createdAt,
      stageEnteredAt: facts.stageLog?.createdAt ?? null, lastActivityAt: facts.last?.occurredAt ?? null, openTasks: facts.open, overdueTasks: facts.overdue, hasContact: !!facts.d.contactId,
    });
    return this.withRun(auth, 'deal_intelligence', 'deal', dealId, { dealId }, undefined, async (run) => {
      const result: DealHealth = { ...base, nextStep: null, nextStepUnavailable: null };
      if (facts.d.status === 'OPEN') {
        try {
          const ctx = await this.records.load(auth, 'deal', dealId);
          result.nextStep = await this.structured(auth, run, 'deal_intelligence', 'dealNextStep', nextStepSchema, { deal: ctx.facts, health: base.health, risk: base.risk, signals: base.signals });
        } catch (err) {
          result.nextStepUnavailable = unavailableReason(err);
        }
      } else result.nextStepUnavailable = 'The deal is closed.';
      const rec = await this.saveRec(auth, run.id, 'deal_intelligence', 'deal_health', 'deal', dealId, result, `${SCORING_VERSION}+${PROMPTS.dealNextStep.version}`, meta);
      return { output: result, rec: toRec<DealHealth>(rec) };
    });
  }

  // ───────────── Meeting notes ─────────────

  async meetingNotes(auth: AuthContext, req: MeetingNotesRequest, meta: RequestMeta): Promise<RecommendationRow<MeetingSummary>> {
    const target = await this.meetingTarget(auth, req);
    return this.withRun(auth, 'meeting_notes', target.type, target.id, { meetingId: req.meetingId ?? null, length: req.notes.length }, undefined, async (run) => {
      const ctx = await this.records.load(auth, target.type, target.id);
      const out = await this.structured(auth, run, 'meeting_notes', 'meetingNotes', meetingSchema, {
        meeting: target.meeting, record: ctx.facts, notes: untrusted('meeting_notes', req.notes),
      });
      const rec = await this.saveRec(auth, run.id, 'meeting_notes', 'meeting_summary', target.type, target.id, out, PROMPTS.meetingNotes.version, meta);
      return { output: out, rec: toRec<MeetingSummary>(rec) };
    });
  }

  private async meetingTarget(auth: AuthContext, req: MeetingNotesRequest): Promise<{ type: RecordType; id: string; meeting: Record<string, unknown> | null }> {
    let meeting: Record<string, unknown> | null = null;
    let contactId = req.contactId ?? null;
    if (req.meetingId) {
      const m = await this.prisma.run(auth, (tx) => tx.meeting.findFirst({ where: { id: req.meetingId, tenantId: auth.tenantId } }));
      if (!m) throw notFound('Meeting');
      meeting = { title: m.title, startsAt: m.startsAt.toISOString(), attendees: m.attendees.length };
      contactId ??= m.contactIds[0] ?? null;
    }
    if (req.dealId) return { type: 'deal', id: req.dealId, meeting };
    if (contactId) return { type: 'contact', id: contactId, meeting };
    if (req.leadId) return { type: 'lead', id: req.leadId, meeting };
    throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Link the notes to a deal, contact or lead.' });
  }

  // ───────────── Proposal draft ─────────────

  async proposal(auth: AuthContext, dealId: string, meta: RequestMeta): Promise<RecommendationRow<ProposalDraft>> {
    return this.withRun(auth, 'proposal_draft', 'deal', dealId, { dealId }, undefined, async (run) => {
      const deal = await this.records.load(auth, 'deal', dealId);
      const extra = await this.prisma.run(auth, async (tx) => {
        const d = await tx.opportunity.findFirstOrThrow({ where: { id: dealId, tenantId: auth.tenantId }, select: { companyId: true, contactId: true } });
        return d;
      });
      const company = extra.companyId && auth.permissions.includes('companies:read') ? (await this.records.load(auth, 'company', extra.companyId)).facts : null;
      const contact = extra.contactId && auth.permissions.includes('contacts:read') ? (await this.records.load(auth, 'contact', extra.contactId)).facts : null;
      // The latest quote supplies line items and prices from the price book; the model only restates them.
      const quote = auth.permissions.includes('quotes:read')
        ? await this.prisma.run(auth, (tx) =>
            tx.quote.findFirst({ where: { tenantId: auth.tenantId, opportunityId: dealId, isLatest: true }, orderBy: { number: 'desc' }, include: { lines: { orderBy: { position: 'asc' } } } }),
          )
        : null;
      const quoteFacts = quote && {
        status: quote.status, currency: quote.currency, subtotal: quote.subtotal.toNumber(), discountTotal: quote.discountTotal.toNumber(), taxTotal: quote.taxTotal.toNumber(), total: quote.total.toNumber(),
        lines: quote.lines.map((l) => ({ product: l.name, quantity: l.quantity.toNumber(), unitPrice: l.unitPrice.toNumber(), discountPercent: l.discountPercent.toNumber(), net: l.netTotal.toNumber() })),
      };
      const out = await this.structured(auth, run, 'proposal_draft', 'proposalDraft', proposalSchema, { deal: deal.facts, company, contact, quote: quoteFacts });
      const rec = await this.saveRec(auth, run.id, 'proposal_draft', 'proposal_draft', 'deal', dealId, out, PROMPTS.proposalDraft.version, meta);
      return { output: out, rec: toRec<ProposalDraft>(rec) };
    });
  }

  // ───────────── Workflow builder ─────────────

  async draftWorkflow(auth: AuthContext, description: string): Promise<{ runId: string; name: string; definition: WorkflowDefinition; notes: string }> {
    const members = await this.prisma.run(auth, (tx) =>
      tx.membership.findMany({ where: { tenantId: auth.tenantId, status: 'ACTIVE' }, include: { user: { select: { id: true, name: true } } }, take: 50 }),
    );
    const catalog = {
      triggerEvents: Object.fromEntries(Object.entries(TRIGGER_EVENTS).map(([k, v]) => [k, `${v.label} (record type: ${v.entity})`])),
      updatableFields: UPDATABLE_FIELDS,
      leadStatuses: ['NEW', 'CONTACTED', 'QUALIFIED', 'DISQUALIFIED'],
      users: members.map((m) => ({ id: m.user.id, name: m.user.name })),
    };
    let result: { runId: string; name: string; definition: WorkflowDefinition; notes: string } | null = null;
    await this.withRun(auth, 'workflow_builder', null, null, { description }, undefined, async (run) => {
      let feedback: string | null = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        const out = await this.structured(auth, run, 'workflow_builder', 'workflowBuilder', workflowOutSchema, {
          description: untrusted('person', description),
          catalog,
          ...(feedback ? { previousAttemptProblems: feedback } : {}),
        });
        let parsed: unknown;
        try {
          parsed = JSON.parse(out.definitionJson);
        } catch {
          feedback = 'definitionJson was not valid JSON.';
          continue;
        }
        const def = workflowDefinitionSchema.safeParse(parsed);
        if (def.success) {
          result = { runId: run.id, name: out.name, definition: def.data, notes: out.notes };
          return { output: { name: out.name, definition: def.data, notes: out.notes }, rec: null };
        }
        feedback = def.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ').slice(0, 2000);
      }
      throw new UnprocessableEntityException({ code: 'AI_INVALID_WORKFLOW', message: `The AI draft did not pass validation, so nothing was created. Details: ${feedback}` });
    });
    return result!;
  }

  // ───────────── Forecast explanation ─────────────

  async explainForecast(auth: AuthContext, fromId: string, toId: string): Promise<ForecastComparison & { explanation: string | null; explanationUnavailable: string | null }> {
    const cmp = await this.forecast.compare(auth, fromId, toId);
    let explanation: string | null = null;
    let explanationUnavailable: string | null = null;
    try {
      await this.withRun(auth, 'forecast_explainer', 'forecast_snapshot', toId, { fromId, toId }, undefined, async (run) => {
        const res = await this.gateway.call(
          { tenantId: auth.tenantId, userId: auth.userId || null, agent: 'forecast_explainer', runId: run.id, promptVersion: PROMPTS.forecastExplainer.version },
          {
            system: PROMPTS.forecastExplainer.system,
            messages: [{ role: 'user', content: JSON.stringify({ before: cmp.from.totals, after: cmp.to.totals, currency: cmp.to.currency, delta: cmp.delta, changes: cmp.changes.slice(0, 40) }) }],
            maxTokens: 1500,
            effort: this.gateway.effortFor('forecast_explainer'),
          },
          run.redactor,
        );
        explanation = textOf(res.content) || null;
        return { output: { explanation }, rec: null };
      });
    } catch (err) {
      explanationUnavailable = unavailableReason(err);
    }
    return { ...cmp, explanation, explanationUnavailable };
  }

  // ───────────── Recommendations ─────────────

  list(auth: AuthContext, entityType: string, entityId: string): Promise<RecommendationRow[]> {
    return this.prisma.run(auth, async (tx) =>
      (await tx.aiRecommendation.findMany({ where: { tenantId: auth.tenantId, entityType, entityId }, orderBy: { createdAt: 'desc' }, take: 20 })).map((r) => toRec(r)),
    );
  }

  /** Acting on a recommendation always runs as the person, through the normal services. */
  async accept(auth: AuthContext, id: string, edits: { title?: string; dueInDays?: number }, meta: RequestMeta): Promise<{ recommendation: RecommendationRow; created: Record<string, unknown> | null }> {
    const rec = await this.prisma.run(auth, (tx) => tx.aiRecommendation.findFirst({ where: { id, tenantId: auth.tenantId } }));
    if (!rec) throw notFound('Recommendation');
    if (rec.status !== 'PROPOSED') throw new BadRequestException({ code: 'ALREADY_DECIDED', message: 'This recommendation was already handled.' });
    let created: Record<string, unknown> | null = null;
    const ref = rec.entityType === 'deal' ? { opportunityId: rec.entityId } : rec.entityType === 'lead' ? { leadId: rec.entityId } : rec.entityType === 'contact' ? { contactId: rec.entityId } : {};
    if (rec.kind === 'deal_health') {
      const next = (rec.payload as unknown as DealHealth).nextStep;
      if (!next) throw new BadRequestException({ code: 'NOTHING_TO_ACCEPT', message: 'This analysis has no recommended next step.' });
      this.need(auth, 'activities:write');
      const days = edits.dueInDays ?? next.dueInDays;
      const task = await this.tasks.create(auth, { title: edits.title ?? next.title, description: `Recommended by Deal Intelligence: ${next.reason}`, dueAt: new Date(Date.now() + days * DAY).toISOString(), assigneeId: auth.userId, ...ref }, meta);
      created = { taskId: task.id };
    } else if (rec.kind === 'meeting_summary') {
      const m = rec.payload as unknown as MeetingSummary;
      this.need(auth, 'activities:write');
      const body = [m.summary, m.decisions.length ? `Decisions:\n${m.decisions.map((d) => `- ${d}`).join('\n')}` : null].filter(Boolean).join('\n\n');
      const note = await this.activities.create(auth, { type: 'NOTE', subject: 'Meeting summary', body, ...ref }, meta, { aiAssisted: true });
      created = { activityId: note.id };
    }
    const row = await this.decideRec(auth, id, 'ACCEPTED', meta);
    return { recommendation: row, created };
  }

  async createActionItems(auth: AuthContext, id: string, indexes: number[], meta: RequestMeta): Promise<{ taskIds: string[] }> {
    this.need(auth, 'activities:write');
    const rec = await this.prisma.run(auth, (tx) => tx.aiRecommendation.findFirst({ where: { id, tenantId: auth.tenantId, kind: 'meeting_summary' } }));
    if (!rec) throw notFound('Meeting summary');
    const items = (rec.payload as unknown as MeetingSummary).actionItems;
    const ref = rec.entityType === 'deal' ? { opportunityId: rec.entityId } : rec.entityType === 'lead' ? { leadId: rec.entityId } : { contactId: rec.entityId };
    const taskIds: string[] = [];
    for (const i of [...new Set(indexes)]) {
      const item = items[i];
      if (!item) continue;
      const task = await this.tasks.create(auth, {
        title: item.title, description: 'From an AI meeting summary, confirmed by you.', assigneeId: auth.userId,
        dueAt: item.dueInDays !== null ? new Date(Date.now() + item.dueInDays * DAY).toISOString() : undefined, ...ref,
      }, meta);
      taskIds.push(task.id);
    }
    return { taskIds };
  }

  async dismiss(auth: AuthContext, id: string, meta: RequestMeta): Promise<RecommendationRow> {
    return this.decideRec(auth, id, 'DISMISSED', meta);
  }

  private decideRec(auth: AuthContext, id: string, status: 'ACCEPTED' | 'DISMISSED', meta: RequestMeta): Promise<RecommendationRow> {
    return this.prisma.run(auth, async (tx) => {
      const { count } = await tx.aiRecommendation.updateMany({ where: { id, tenantId: auth.tenantId, status: 'PROPOSED' }, data: { status, decidedById: auth.userId, decidedAt: new Date() } });
      if (count === 0) throw new BadRequestException({ code: 'ALREADY_DECIDED', message: 'This recommendation was already handled.' });
      const row = await tx.aiRecommendation.findUniqueOrThrow({ where: { id } });
      await this.audit.record(tx, {
        tenantId: auth.tenantId, actorUserId: auth.userId, action: status === 'ACCEPTED' ? 'ai.recommendation_accepted' : 'ai.recommendation_dismissed',
        entityType: row.entityType, entityId: row.entityId, metadata: { recommendationId: id, kind: row.kind }, meta,
      });
      return toRec(row);
    });
  }

  // ───────────── Plumbing ─────────────

  private need(auth: AuthContext, p: Permission) {
    if (!auth.permissions.includes(p)) throw new ForbiddenException({ code: 'FORBIDDEN', message: `Your role does not allow this (${p}).` });
  }

  private async saveRec(auth: AuthContext, runId: string, agent: AiAgentKey, kind: string, entityType: string, entityId: string, payload: unknown, promptVersion: string, meta: RequestMeta) {
    return this.prisma.run(auth, async (tx) => {
      const row = await tx.aiRecommendation.create({
        data: { tenantId: auth.tenantId, runId, agent, kind, entityType, entityId, payload: payload as Prisma.InputJsonValue, promptVersion },
      });
      await this.audit.record(tx, {
        tenantId: auth.tenantId, actorUserId: auth.userId, action: 'ai.recommendation_created', entityType, entityId,
        metadata: { agent, kind, runId, recommendationId: row.id }, meta,
      });
      return row;
    });
  }

  /** A model call whose answer must match a JSON schema; the parsed answer is validated again with Zod. */
  private async structured<T>(auth: AuthContext, run: RunHandle, agent: AiAgentKey, prompt: PromptKey & keyof typeof SCHEMAS, schema: z.ZodType<T>, input: unknown): Promise<T> {
    const p = PROMPTS[prompt];
    const res = await this.gateway.call(
      { tenantId: auth.tenantId, userId: auth.userId || null, agent, runId: run.id, promptVersion: p.version },
      { system: p.system, messages: [{ role: 'user', content: JSON.stringify(input) }], maxTokens: 6000, effort: this.gateway.effortFor(agent), jsonSchema: SCHEMAS[prompt] as Record<string, unknown> },
      run.redactor,
    );
    if (res.stopReason === 'refusal') throw new AgentOutputError('The AI provider declined this request.');
    let json: unknown;
    try {
      json = JSON.parse(textOf(res.content));
    } catch {
      throw new AgentOutputError('The AI answer was not valid JSON.');
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) throw new AgentOutputError('The AI answer did not match the expected format.');
    return parsed.data;
  }

  /** Records an agent run around `fn`. Pass `existingRunId` when a queued run is being processed. */
  private async withRun<T>(
    auth: AuthContext,
    agent: AiAgentKey,
    entityType: string | null,
    entityId: string | null,
    input: Record<string, unknown>,
    existingRunId: string | undefined,
    fn: (run: RunHandle) => Promise<{ output: unknown; rec: T }>,
  ): Promise<T> {
    const def = AI_AGENTS[agent];
    if (auth.userId) this.need(auth, def.permission);
    const settings = await this.prisma.run(auth, (tx) => this.gateway.settings(tx, auth.tenantId));
    const runId = existingRunId ?? (
      await this.prisma.run(auth, (tx) =>
        tx.aiRun.create({
          data: { tenantId: auth.tenantId, userId: auth.userId || null, agent, status: 'RUNNING', entityType, entityId, input: input as Prisma.InputJsonValue, promptVersion: promptVersionOf(agent) },
        }),
      )
    ).id;
    const finish = (data: Prisma.AiRunUpdateInput) =>
      this.prisma.run(auth, async (tx) => {
        const used = await tx.aiUsage.aggregate({ where: { tenantId: auth.tenantId, runId }, _sum: { credits: true } });
        const last = await tx.aiUsage.findFirst({ where: { tenantId: auth.tenantId, runId }, orderBy: { createdAt: 'desc' }, select: { model: true } });
        await tx.aiRun.update({ where: { id: runId }, data: { ...data, creditsUsed: used._sum.credits ?? 0, model: last?.model ?? null, finishedAt: new Date(), leaseUntil: null } });
      });
    try {
      const { output, rec } = await fn({ id: runId, redactor: settings.redactPii ? new Redactor() : null });
      await finish({ status: 'SUCCEEDED', output: output as Prisma.InputJsonValue, error: null });
      return rec;
    } catch (err) {
      await finish({ status: err instanceof AiUnavailable ? 'BLOCKED' : 'FAILED', error: unavailableReason(err) });
      throw err;
    }
  }
}

export class AgentOutputError extends Error {}

function promptVersionOf(agent: AiAgentKey): string {
  const map: Partial<Record<AiAgentKey, string>> = {
    lead_qualification: `${SCORING_VERSION}+${PROMPTS.leadSummary.version}`,
    deal_intelligence: `${SCORING_VERSION}+${PROMPTS.dealNextStep.version}`,
    meeting_notes: PROMPTS.meetingNotes.version,
    proposal_draft: PROMPTS.proposalDraft.version,
    workflow_builder: PROMPTS.workflowBuilder.version,
    forecast_explainer: PROMPTS.forecastExplainer.version,
  };
  return map[agent] ?? PROMPTS.copilot.version;
}

/** A person-readable reason for a missing AI part. */
export function unavailableReason(err: unknown): string {
  if (err instanceof AiUnavailable) return (err.getResponse() as { message: string }).message;
  if (err instanceof AgentOutputError) return err.message;
  if (err instanceof UnprocessableEntityException) return (err.getResponse() as { message: string }).message;
  return `The AI provider call failed (${errorMessage(err).slice(0, 200)}).`;
}

function toRec<T = Record<string, unknown>>(r: { id: string; agent: string; kind: string; entityType: string; entityId: string; payload: unknown; promptVersion: string; status: string; decidedAt: Date | null; createdAt: Date }): RecommendationRow<T> {
  return {
    id: r.id, agent: r.agent, kind: r.kind, entityType: r.entityType, entityId: r.entityId, payload: r.payload as T, promptVersion: r.promptVersion,
    status: r.status as RecommendationRow['status'], decidedAt: r.decidedAt?.toISOString() ?? null, createdAt: r.createdAt.toISOString(),
  };
}
