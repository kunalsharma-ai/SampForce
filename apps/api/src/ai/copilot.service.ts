import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, transactionLock } from '@dealflow/database';
import type { CopilotAnswer, CopilotRequest, CopilotTurn, ProposedAction } from '@dealflow/types';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { ActivitiesService } from '../crm/activities.service';
import { DealsService } from '../crm/deals.service';
import { TasksService } from '../crm/tasks.service';
import { errorMessage } from '../worker/queue';
import { CopilotTools, type ToolRunState } from './copilot-tools';
import { AiGateway, AiUnavailable } from './gateway.service';
import { PROMPTS } from './prompts';
import { type ModelMessage, textOf } from './provider';
import { Redactor } from './redact';

const MAX_STEPS = 6;
const HISTORY_TURNS = 5;

/**
 * Copilot: a bounded tool-use loop on behalf of the signed-in person. It reads through permission-
 * checked tools and can only propose changes; the person confirms each one, and the change then runs
 * through the normal CRM services as that person, with the usual validation and audit trail.
 */
@Injectable()
export class CopilotService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: AiGateway,
    private readonly tools: CopilotTools,
    private readonly tasks: TasksService,
    private readonly activities: ActivitiesService,
    private readonly deals: DealsService,
    private readonly audit: AuditService,
  ) {}

  async ask(auth: AuthContext, req: CopilotRequest, meta: RequestMeta): Promise<CopilotAnswer> {
    const { redact } = await this.gateway.preflight({ tenantId: auth.tenantId, userId: auth.userId, agent: 'copilot' });
    const conversationId = req.conversationId ?? randomUUID();
    const history = req.conversationId ? await this.history(auth, req.conversationId) : [];
    if (req.conversationId && history === null) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Conversation not found.' });

    const run = await this.prisma.run(auth, (tx) =>
      tx.aiRun.create({
        data: {
          tenantId: auth.tenantId, userId: auth.userId, agent: 'copilot', status: 'RUNNING', conversationId,
          input: { question: req.question }, promptVersion: PROMPTS.copilot.version,
        },
      }),
    );
    const state: ToolRunState = { citations: new Map(), actions: [], tainted: false };
    const trace: Record<string, unknown>[] = [];
    const toolsUsed: string[] = [];
    const redactor = redact ? new Redactor() : null;
    const messages: ModelMessage[] = [...(history ?? []), { role: 'user', content: req.question }];
    let answer = '';
    let status: CopilotAnswer['status'] = 'SUCCEEDED';
    let model: string | null = null;

    try {
      for (let step = 0; step < MAX_STEPS; step++) {
        const res = await this.gateway.call(
          { tenantId: auth.tenantId, userId: auth.userId, agent: 'copilot', runId: run.id, promptVersion: PROMPTS.copilot.version },
          { system: PROMPTS.copilot.system, messages, tools: this.tools.toolsFor(auth), maxTokens: 4000, effort: this.gateway.effortFor('copilot') },
          redactor,
        );
        model = res.model;
        trace.push({ type: 'model', step, stopReason: res.stopReason, inputTokens: res.inputTokens, outputTokens: res.outputTokens });
        if (res.stopReason === 'refusal') {
          answer = 'Copilot can’t help with that request.';
          break;
        }
        const calls = res.content.filter((b) => b.type === 'tool_use');
        if (res.stopReason !== 'tool_use' || calls.length === 0) {
          answer = textOf(res.content) || 'I could not find an answer to that.';
          if (res.stopReason === 'max_tokens') answer += '\n\n(The answer was cut short.)';
          break;
        }
        messages.push({ role: 'assistant', content: res.content });
        const results = [];
        for (const call of calls) {
          if (call.type !== 'tool_use') continue;
          const out = await this.tools.execute(auth, call.name, call.input as Record<string, unknown>, state);
          toolsUsed.push(call.name);
          trace.push({ type: 'tool', name: call.name, input: call.input, ok: out.ok });
          results.push({ type: 'tool_result' as const, tool_use_id: call.id, content: out.content, ...(out.ok ? {} : { is_error: true }) });
        }
        messages.push({ role: 'user', content: results });
        if (step === MAX_STEPS - 1) answer = 'I stopped after several lookups without a final answer. Try a narrower question.';
      }
    } catch (err) {
      status = err instanceof AiUnavailable ? 'BLOCKED' : 'FAILED';
      answer =
        err instanceof AiUnavailable
          ? (err.getResponse() as { message: string }).message
          : 'Copilot could not finish because the AI provider call failed. Nothing was changed. Try again in a moment.';
      trace.push({ type: 'error', message: errorMessage(err) });
    }

    const mentioned = [...state.citations.values()].filter((c) => answer.includes(c.label));
    const result: CopilotAnswer = {
      runId: run.id,
      conversationId,
      status,
      answer,
      citations: (mentioned.length ? mentioned : [...state.citations.values()]).slice(0, 8),
      actions: status === 'SUCCEEDED' ? state.actions : [],
      toolsUsed,
      creditsUsed: 0,
    };
    await this.prisma.run(auth, async (tx) => {
      const used = await tx.aiUsage.aggregate({ where: { tenantId: auth.tenantId, runId: run.id }, _sum: { credits: true } });
      result.creditsUsed = used._sum.credits ?? 0;
      await tx.aiRun.update({
        where: { id: run.id },
        data: {
          status, model, output: result as unknown as Prisma.InputJsonValue, trace: trace as Prisma.InputJsonValue,
          creditsUsed: result.creditsUsed, error: status === 'SUCCEEDED' ? null : answer, finishedAt: new Date(),
        },
      });
      await this.audit.record(tx, {
        tenantId: auth.tenantId, actorUserId: auth.userId, action: 'ai.copilot_answered', entityType: 'ai_run', entityId: run.id,
        metadata: { status, tools: toolsUsed, proposals: result.actions.length, credits: result.creditsUsed }, meta,
      });
    });
    return result;
  }

  /** Earlier turns of a conversation, as plain text (tool results are never replayed from the client). */
  private async history(auth: AuthContext, conversationId: string): Promise<ModelMessage[] | null> {
    const runs = await this.prisma.run(auth, (tx) =>
      tx.aiRun.findMany({
        where: { tenantId: auth.tenantId, userId: auth.userId, agent: 'copilot', conversationId },
        orderBy: { createdAt: 'desc' },
        take: HISTORY_TURNS,
      }),
    );
    if (runs.length === 0) return null;
    return runs.reverse().flatMap((r): ModelMessage[] => {
      const out = r.output as unknown as CopilotAnswer | null;
      if (!out || r.status !== 'SUCCEEDED') return [];
      return [
        { role: 'user', content: String((r.input as { question?: string }).question ?? '') },
        { role: 'assistant', content: out.answer },
      ];
    });
  }

  async conversation(auth: AuthContext, conversationId: string): Promise<CopilotTurn[]> {
    const runs = await this.prisma.run(auth, (tx) =>
      tx.aiRun.findMany({ where: { tenantId: auth.tenantId, userId: auth.userId, agent: 'copilot', conversationId }, orderBy: { createdAt: 'asc' }, take: 50 }),
    );
    return runs
      .filter((r) => r.output)
      .map((r) => ({ runId: r.id, question: String((r.input as { question?: string }).question ?? ''), answer: r.output as unknown as CopilotAnswer, createdAt: r.createdAt.toISOString() }));
  }

  /**
   * Confirms or dismisses one proposal. Only the person who asked can decide, their role must still
   * allow the change, and the change runs as them through the normal services.
   */
  async decide(auth: AuthContext, runId: string, actionId: string, decision: 'confirm' | 'dismiss', meta: RequestMeta): Promise<ProposedAction> {
    const claimed = await this.prisma.run(auth, async (tx) => {
      const locked = await tx.aiRun.findFirst({ where: { id: runId, tenantId: auth.tenantId, userId: auth.userId, agent: 'copilot' }, select: { id: true } });
      if (locked) await transactionLock(tx, `ai_run:${runId}`);
      if (!locked) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Copilot answer not found.' });
      const run = await tx.aiRun.findUniqueOrThrow({ where: { id: runId } });
      const output = run.output as unknown as CopilotAnswer;
      const action = output.actions.find((a) => a.id === actionId);
      if (!action) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Proposal not found.' });
      if (action.status !== 'proposed') return { action, output, proceed: false };
      if (decision === 'confirm' && !auth.permissions.includes(action.permission)) {
        throw new ForbiddenException({ code: 'FORBIDDEN', message: `Your role no longer allows this change (${action.permission}).` });
      }
      action.status = decision === 'confirm' ? 'applied' : 'dismissed';
      await tx.aiRun.update({ where: { id: runId }, data: { output: output as unknown as Prisma.InputJsonValue } });
      return { action, output, proceed: decision === 'confirm' };
    });
    if (!claimed.proceed) return claimed.action;

    const { action } = claimed;
    try {
      action.result = await this.apply(auth, action, runId, meta);
    } catch (err) {
      action.status = 'failed';
      action.error = err instanceof Error ? err.message : 'The change failed.';
    }
    await this.prisma.run(auth, async (tx) => {
      const run = await tx.aiRun.findUniqueOrThrow({ where: { id: runId } });
      const output = run.output as unknown as CopilotAnswer;
      output.actions = output.actions.map((a) => (a.id === action.id ? action : a));
      await tx.aiRun.update({ where: { id: runId }, data: { output: output as unknown as Prisma.InputJsonValue } });
      await this.audit.record(tx, {
        tenantId: auth.tenantId, actorUserId: auth.userId, action: action.status === 'applied' ? 'ai.action_applied' : 'ai.action_failed',
        entityType: 'ai_run', entityId: runId, metadata: { tool: action.tool, title: action.title, fromUntrustedContent: action.fromUntrustedContent, error: action.error }, meta,
      });
    });
    return action;
  }

  private async apply(auth: AuthContext, action: ProposedAction, runId: string, meta: RequestMeta): Promise<Record<string, unknown>> {
    const i = action.input as Record<string, string | number | null>;
    const link = (type: unknown, id: unknown) =>
      type === 'lead' ? { leadId: id as string } : type === 'contact' ? { contactId: id as string } : type === 'deal' ? { opportunityId: id as string } : type === 'company' ? { companyId: id as string } : {};
    const aiMeta = { ...meta, userAgent: `sampforce-copilot run=${runId}` };
    switch (action.tool) {
      case 'create_task': {
        const dueAt = typeof i.dueInDays === 'number' ? new Date(Date.now() + i.dueInDays * 86_400_000).toISOString() : undefined;
        const { companyId: _ignored, ...refs } = link(i.relatedType, i.relatedId) as Record<string, string>;
        const task = await this.tasks.create(auth, { title: String(i.title), description: 'Suggested by Copilot and confirmed by you.', dueAt, assigneeId: auth.userId, ...refs }, aiMeta);
        return { taskId: task.id };
      }
      case 'log_note': {
        const note = await this.activities.create(auth, { type: 'NOTE', subject: String(i.subject), body: i.body ? String(i.body) : undefined, ...link(i.relatedType, i.relatedId) }, aiMeta, { aiAssisted: true });
        return { activityId: note.id };
      }
      case 'move_deal_stage': {
        const deal = await this.deals.move(auth, String(i.dealId), { stageId: String(i.stageId) }, aiMeta);
        return { dealId: deal.id, stage: deal.stage.name };
      }
    }
  }
}
