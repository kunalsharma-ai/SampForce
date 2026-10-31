import { Injectable } from '@nestjs/common';
import { Prisma } from '@dealflow/database';
import type { Citation, Permission, ProposedAction, SearchHit } from '@dealflow/types';
import { randomUUID } from 'node:crypto';
import type { AuthContext } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { SearchService } from '../crm/search.service';
import { TasksService } from '../crm/tasks.service';
import { DealHealthService } from '../intelligence/deal-health.service';
import { InsightsService } from '../intelligence/insights.service';
import { NextActionsService } from '../intelligence/next-actions.service';
import { RecordIntelligenceService } from '../intelligence/record-intelligence.service';
import { ForecastService } from './forecast.service';
import type { ModelTool } from './provider';
import { PermissionDenied, READ_PERMISSION, RecordContextBuilder, type RecordType } from './record-context';

export interface ToolRunState {
  citations: Map<string, Citation>;
  actions: ProposedAction[];
  /** Set once external content (email) has been read in this run. */
  tainted: boolean;
}

interface ToolDef {
  tool: ModelTool;
  /** Permissions the caller needs for the tool to be offered at all. */
  needs: Permission[];
  run(auth: AuthContext, input: Record<string, unknown>, state: ToolRunState): Promise<unknown>;
}

const RECORD_TYPES = ['lead', 'contact', 'company', 'deal'] as const;
const nullable = (type: string, extra: Record<string, unknown> = {}) => ({ type: [type, 'null'], ...extra });
const schema = (properties: Record<string, unknown>) => ({
  type: 'object' as const,
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

const DAY = 86_400_000;
const isoDay = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

/** Copilot's tool allowlist. Read tools return data; propose_ tools only record a proposal for the person to confirm. */
@Injectable()
export class CopilotTools {
  private readonly defs: ToolDef[];

  constructor(
    private readonly prisma: PrismaService,
    private readonly search: SearchService,
    private readonly tasks: TasksService,
    private readonly records: RecordContextBuilder,
    private readonly forecast: ForecastService,
    private readonly nextActions: NextActionsService,
    private readonly insights: InsightsService,
    private readonly dealHealth: DealHealthService,
    private readonly recordIntel: RecordIntelligenceService,
  ) {
    this.defs = [
      {
        needs: [],
        tool: {
          name: 'search_records',
          description: 'Find leads, contacts, companies and deals by name, email or company. Returns ids for get_record.',
          strict: true,
          input_schema: schema({ query: { type: 'string' }, types: nullable('array', { items: { type: 'string', enum: [...RECORD_TYPES] } }) }),
        },
        run: async (auth, input, state) => {
          const wanted = ((input.types as RecordType[] | null) ?? [...RECORD_TYPES]).filter((t) => auth.permissions.includes(READ_PERMISSION[t]));
          if (wanted.length === 0) return { error: 'Your role cannot read any of those record types.' };
          const hits: SearchHit[] = await this.search.search(auth, String(input.query ?? ''), wanted, 10);
          for (const h of hits) state.citations.set(`${h.entity}:${h.id}`, { entity: h.entity, id: h.id, label: h.title });
          return { results: hits.map((h) => ({ type: h.entity, id: h.id, name: h.title, detail: h.subtitle })) };
        },
      },
      {
        needs: [],
        tool: {
          name: 'get_record',
          description: 'Read one lead, contact, company or deal with its recent activity, open tasks and (for leads and contacts) recent emails.',
          strict: true,
          input_schema: schema({ type: { type: 'string', enum: [...RECORD_TYPES] }, id: { type: 'string' } }),
        },
        run: async (auth, input, state) => {
          const ctx = await this.records.load(auth, input.type as RecordType, String(input.id), { emails: true });
          state.citations.set(`${ctx.citation.entity}:${ctx.citation.id}`, ctx.citation);
          if (ctx.untrusted) state.tainted = true;
          return ctx.facts;
        },
      },
      {
        needs: ['deals:read'],
        tool: {
          name: 'list_deals',
          description: 'List deals with filters. Amounts are in each deal’s own currency. Use stalled_days to find deals with no activity for that many days.',
          strict: true,
          input_schema: schema({
            status: { type: 'string', enum: ['open', 'won', 'lost'] },
            closing_within_days: nullable('integer'),
            stalled_days: nullable('integer'),
            mine_only: { type: 'boolean' },
            min_amount: nullable('number'),
            limit: nullable('integer'),
          }),
        },
        run: (auth, input, state) => this.listDeals(auth, input, state),
      },
      {
        needs: ['deals:read'],
        tool: {
          name: 'pipeline_summary',
          description: 'Open pipeline by stage for the default pipeline, plus this quarter’s rule-based forecast (won, weighted, scenarios) in the workspace currency.',
          strict: true,
          input_schema: schema({}),
        },
        run: (auth) => this.pipelineSummary(auth),
      },
      {
        needs: ['dashboard:read'],
        tool: {
          name: 'my_next_actions',
          description: 'The signed-in person’s ranked next best actions (replies waiting, overdue tasks, risky deals, quotes, renewals, new leads), each with the rule that produced it.',
          strict: true,
          input_schema: schema({}),
        },
        run: async (auth, _input, state) => {
          const list = await this.nextActions.list(auth);
          for (const i of list.items) this.cite(state, i.record.type, i.record.id, i.record.name);
          return { actions: list.items.slice(0, 15).map((i) => ({ kind: i.kind, title: i.title, reason: i.reason, record: i.record })) };
        },
      },
      {
        needs: ['dashboard:read'],
        tool: {
          name: 'sales_insights',
          description: 'This week against last week: risky deals, new pipeline, wins, emails received, overdue tasks, untouched leads, sequence reply rate, renewals, customers at risk. Use it for a briefing.',
          strict: true,
          input_schema: schema({ scope: { type: 'string', enum: ['mine', 'team'] } }),
        },
        run: async (auth, input) => {
          const feed = await this.insights.feed(auth, input.scope === 'team' ? 'team' : 'mine');
          return { period: `last 7 days from ${feed.periodStart.slice(0, 10)}`, currency: feed.currency, insights: feed.items.map(({ title, detail, tone }) => ({ title, detail, tone })) };
        },
      },
      {
        needs: ['dashboard:read'],
        tool: {
          name: 'record_intelligence',
          description: 'For one lead, contact, company or deal: engagement trend, recent buying signals (opens marked as estimates), senior contacts at the company, account value and products not yet bought. Use with get_record to summarise a relationship.',
          strict: true,
          input_schema: schema({ type: { type: 'string', enum: ['lead', 'contact', 'company', 'deal'] }, id: { type: 'string' } }),
        },
        run: async (auth, input, state) => {
          const type = input.type as 'lead' | 'contact' | 'company' | 'deal';
          if (!auth.permissions.includes(READ_PERMISSION[type])) return { error: `Your role cannot read ${type}s.` };
          const intel = await this.recordIntel.get(auth, type, String(input.id));
          const ctx = await this.records.load(auth, type, String(input.id));
          state.citations.set(`${ctx.citation.entity}:${ctx.citation.id}`, ctx.citation);
          return intel;
        },
      },
      {
        needs: ['deals:read'],
        tool: {
          name: 'deals_at_risk',
          description: 'Open deals by stored health score (lowest first) with the signals behind each score, from the hourly deal health monitor.',
          strict: true,
          input_schema: schema({ risk: { type: 'string', enum: ['high', 'medium', 'low'] }, mine_only: { type: 'boolean' } }),
        },
        run: async (auth, input, state) => {
          const rows = await this.dealHealth.list(auth, { risk: input.risk as 'high' | 'medium' | 'low', mine: input.mine_only === true });
          for (const r of rows) state.citations.set(`deal:${r.deal.id}`, { entity: 'deal', id: r.deal.id, label: r.deal.name });
          return { deals: rows.slice(0, 20).map((r) => ({ id: r.deal.id, name: r.deal.name, stage: r.deal.stage, amount: r.deal.amount, currency: r.deal.currency, health: r.health, change7d: r.change7d, signals: r.signals.map((x) => x.label), owner: r.owner?.name ?? null })) };
        },
      },
      {
        needs: ['activities:read'],
        tool: {
          name: 'list_tasks',
          description: 'List open tasks, either the signed-in person’s or everyone’s.',
          strict: true,
          input_schema: schema({ scope: { type: 'string', enum: ['mine', 'all'] }, overdue_only: { type: 'boolean' } }),
        },
        run: async (auth, input) => {
          const rows = await this.tasks.list(auth, { scope: input.scope === 'all' ? 'all' : 'mine', status: 'OPEN' });
          const filtered = input.overdue_only ? rows.filter((t) => t.overdue) : rows;
          return { tasks: filtered.slice(0, 25).map((t) => ({ title: t.title, due: t.dueAt?.slice(0, 10) ?? null, overdue: t.overdue, assignee: t.assignee?.name ?? null })) };
        },
      },
      {
        needs: ['activities:write'],
        tool: {
          name: 'propose_create_task',
          description: 'Propose a task. Nothing is created until the person confirms it.',
          strict: true,
          input_schema: schema({
            title: { type: 'string' },
            due_in_days: nullable('integer'),
            related_type: nullable('string', { enum: ['lead', 'contact', 'deal', null] }),
            related_id: nullable('string'),
          }),
        },
        run: async (auth, input, state) => {
          const title = String(input.title ?? '').trim().slice(0, 200);
          if (!title) return { error: 'A task needs a title.' };
          const related = await this.related(auth, input.related_type as string | null, input.related_id as string | null, state);
          const due = typeof input.due_in_days === 'number' ? Math.max(0, Math.min(365, input.due_in_days)) : null;
          return this.propose(state, 'create_task', `Create task "${title}"${related ? ` for ${related.label}` : ''}${due !== null ? `, due in ${due} day${due === 1 ? '' : 's'}` : ''}`, 'activities:write', {
            title, dueInDays: due, relatedType: related?.entity ?? null, relatedId: related?.id ?? null,
          });
        },
      },
      {
        needs: ['activities:write'],
        tool: {
          name: 'propose_log_note',
          description: 'Propose logging a note on a lead, contact, company or deal. Nothing is saved until the person confirms it.',
          strict: true,
          input_schema: schema({ related_type: { type: 'string', enum: [...RECORD_TYPES] }, related_id: { type: 'string' }, subject: { type: 'string' }, body: { type: 'string' } }),
        },
        run: async (auth, input, state) => {
          const related = await this.related(auth, String(input.related_type), String(input.related_id), state);
          if (!related) return { error: 'Name the record the note belongs to.' };
          const subject = String(input.subject ?? '').trim().slice(0, 200) || 'Note';
          return this.propose(state, 'log_note', `Log note "${subject}" on ${related.label}`, 'activities:write', {
            relatedType: related.entity, relatedId: related.id, subject, body: String(input.body ?? '').slice(0, 5000),
          });
        },
      },
      {
        needs: ['deals:write'],
        tool: {
          name: 'propose_move_deal_stage',
          description: 'Propose moving a deal to another stage of its pipeline (not to a lost stage). Nothing changes until the person confirms it.',
          strict: true,
          input_schema: schema({ deal_id: { type: 'string' }, stage_name: { type: 'string' } }),
        },
        run: async (auth, input, state) => {
          const dealId = String(input.deal_id);
          const deal = await this.prisma.run(auth, (tx) =>
            tx.opportunity.findFirst({ where: { id: dealId, tenantId: auth.tenantId, deletedAt: null }, include: { stage: true, pipeline: { include: { stages: true } } } }),
          );
          if (!deal) return { error: 'No deal with that id.' };
          const target = deal.pipeline.stages.find((s) => s.name.toLowerCase() === String(input.stage_name).trim().toLowerCase());
          if (!target) return { error: `"${String(input.stage_name)}" is not a stage of ${deal.pipeline.name}. Stages: ${deal.pipeline.stages.map((s) => s.name).join(', ')}.` };
          if (target.category === 'LOST') return { error: 'Marking a deal lost needs a loss reason, so the person should do that on the deal page.' };
          if (target.id === deal.stageId) return { error: `The deal is already in ${target.name}.` };
          state.citations.set(`deal:${deal.id}`, { entity: 'deal', id: deal.id, label: deal.name });
          return this.propose(state, 'move_deal_stage', `Move ${deal.name} from ${deal.stage.name} to ${target.name}`, 'deals:write', {
            dealId: deal.id, stageId: target.id, fromStage: deal.stage.name, toStage: target.name,
          });
        },
      },
    ];
  }

  /** The tools this caller's role allows. Others are never offered to the model. */
  toolsFor(auth: AuthContext): ModelTool[] {
    return this.defs.filter((d) => d.needs.every((p) => auth.permissions.includes(p))).map((d) => d.tool);
  }

  /** Runs one tool call. Every call re-checks permissions, so a tool the model names without being offered it still fails. */
  async execute(auth: AuthContext, name: string, input: Record<string, unknown>, state: ToolRunState): Promise<{ ok: boolean; content: string }> {
    const def = this.defs.find((d) => d.tool.name === name);
    if (!def) return { ok: false, content: JSON.stringify({ error: `Unknown tool ${name}.` }) };
    const missing = def.needs.find((p) => !auth.permissions.includes(p));
    if (missing) return { ok: false, content: JSON.stringify({ error: `Your role does not allow ${name} (${missing}).` }) };
    try {
      const out = await def.run(auth, input ?? {}, state);
      const failed = !!out && typeof out === 'object' && 'error' in out;
      return { ok: !failed, content: JSON.stringify(out).slice(0, 15_000) };
    } catch (err) {
      const message = err instanceof PermissionDenied ? err.message : err instanceof Error && 'status' in err ? err.message : 'The lookup failed.';
      return { ok: false, content: JSON.stringify({ error: message }) };
    }
  }

  private cite(state: ToolRunState, type: string, id: string, label: string): void {
    if (type === 'lead' || type === 'contact' || type === 'company' || type === 'deal') state.citations.set(`${type}:${id}`, { entity: type, id, label });
  }

  private propose(state: ToolRunState, tool: ProposedAction['tool'], title: string, permission: Permission, input: Record<string, unknown>) {
    if (state.actions.length >= 5) return { error: 'At most five proposals per answer.' };
    const action: ProposedAction = { id: randomUUID(), tool, title, input, permission, status: 'proposed', fromUntrustedContent: state.tainted, result: null, error: null };
    state.actions.push(action);
    return { proposed: title, status: 'Waiting for the person to confirm. Nothing has changed yet.' };
  }

  private async related(auth: AuthContext, type: string | null, id: string | null, state: ToolRunState): Promise<Citation | null> {
    if (!type || !id) return null;
    const ctx = await this.records.load(auth, type as RecordType, id);
    state.citations.set(`${ctx.citation.entity}:${ctx.citation.id}`, ctx.citation);
    return ctx.citation;
  }

  private async listDeals(auth: AuthContext, input: Record<string, unknown>, state: ToolRunState) {
    const status = input.status === 'won' ? 'WON' : input.status === 'lost' ? 'LOST' : 'OPEN';
    const limit = Math.max(1, Math.min(25, typeof input.limit === 'number' ? input.limit : 10));
    const within = typeof input.closing_within_days === 'number' ? input.closing_within_days : null;
    const stalled = typeof input.stalled_days === 'number' ? input.stalled_days : null;
    const minAmount = typeof input.min_amount === 'number' ? input.min_amount : null;
    const now = new Date();
    const rows = await this.prisma.run(auth, (tx) =>
      tx.$queryRaw<{ id: string; name: string; amount: Prisma.Decimal; currency: string; stage: string; probability: number; close: Date | null; owner: string | null; last_activity: Date | null }[]>`
        SELECT o.id::text, o.name, o.amount, o.currency, s.name AS stage, COALESCE(o.probability, s.probability) AS probability,
               o.expected_close_date AS close, u.name AS owner,
               (SELECT max(a.occurred_at) FROM activities a WHERE a.tenant_id = o.tenant_id AND a.opportunity_id = o.id AND a.deleted_at IS NULL) AS last_activity
        FROM opportunities o
        JOIN pipeline_stages s ON s.id = o.stage_id
        LEFT JOIN users u ON u.id = o.owner_id
        WHERE o.tenant_id = ${auth.tenantId}::uuid AND o.deleted_at IS NULL AND o.status = ${status}::"OpportunityStatus"
          ${input.mine_only ? Prisma.sql`AND o.owner_id = ${auth.userId}::uuid` : Prisma.empty}
          ${minAmount !== null ? Prisma.sql`AND o.amount >= ${minAmount}` : Prisma.empty}
          ${within !== null ? Prisma.sql`AND o.expected_close_date >= ${isoDay(now)}::date AND o.expected_close_date <= ${isoDay(new Date(now.getTime() + within * DAY))}::date` : Prisma.empty}
        ORDER BY o.amount DESC
        LIMIT 200`,
    );
    const cutoff = stalled !== null ? new Date(now.getTime() - stalled * DAY) : null;
    const picked = rows.filter((r) => !cutoff || !r.last_activity || r.last_activity < cutoff).slice(0, limit);
    for (const r of picked) state.citations.set(`deal:${r.id}`, { entity: 'deal', id: r.id, label: r.name });
    return {
      count: picked.length,
      deals: picked.map((r) => ({
        id: r.id, name: r.name, amount: Number(r.amount), currency: r.currency, stage: r.stage, probability: r.probability,
        expectedClose: isoDay(r.close), owner: r.owner, lastActivity: isoDay(r.last_activity),
      })),
    };
  }

  private async pipelineSummary(auth: AuthContext) {
    const view = await this.forecast.current(auth, undefined);
    const stages = await this.prisma.run(auth, async (tx) => {
      const p = await tx.pipeline.findFirst({ where: { tenantId: auth.tenantId, deletedAt: null }, orderBy: [{ isDefault: 'desc' }, { position: 'asc' }], include: { stages: { orderBy: { position: 'asc' } } } });
      if (!p) return null;
      const grouped = await tx.opportunity.groupBy({ by: ['stageId'], where: { tenantId: auth.tenantId, pipelineId: p.id, deletedAt: null, status: 'OPEN', currency: view.currency }, _count: { _all: true }, _sum: { amount: true } });
      const by = new Map(grouped.map((g) => [g.stageId, g]));
      return { pipeline: p.name, stages: p.stages.map((s) => ({ stage: s.name, openDeals: by.get(s.id)?._count._all ?? 0, value: Number(by.get(s.id)?._sum.amount ?? 0) })) };
    });
    return {
      currency: view.currency,
      openPipeline: stages,
      quarter: { period: view.period.label, method: 'Rule-based projection, not a guarantee', ...view.totals },
      excludedFromForecast: view.excluded,
    };
  }
}
