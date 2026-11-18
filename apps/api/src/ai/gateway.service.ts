import { HttpException, HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import type { TenantTx } from '@dealflow/database';
import { AI_AGENTS, type AiAgentKey, type AiStatus, type AiTier, creditsFor } from '@dealflow/types';
import { entitlementsFor, hasFeature } from '../billing/entitlements';
import { API_ENV, type ApiEnv } from '../common/env';
import { PrismaService } from '../common/prisma.service';
import { requestLanguage } from '../common/request-language';
import { errorMessage } from '../worker/queue';
import { inLanguagePrompt } from './language';
import { OwnServersStore } from '../own-servers/own-servers.store';
import { AI_PROVIDER_DEFS, AiProviderChain, type OwnEntry } from './ai-providers';
import { type Effort, type ModelBlock, type ModelMessage, type ModelProvider, type ModelRequest, type ModelResponse } from './provider';
import { Redactor } from './redact';

export const AI_PROVIDER = Symbol('AI_PROVIDER');

/** Why AI cannot run right now. The message is shown to people as is. */
export class AiUnavailable extends HttpException {
  constructor(
    readonly code: 'AI_NOT_CONFIGURED' | 'AI_NOT_IN_PLAN' | 'AI_DISABLED' | 'AGENT_DISABLED' | 'AI_CREDITS_EXHAUSTED' | 'AI_RATE_LIMITED' | 'AI_PROVIDER_ERROR',
    message: string,
  ) {
    const status =
      code === 'AI_NOT_CONFIGURED' || code === 'AI_PROVIDER_ERROR'
        ? HttpStatus.SERVICE_UNAVAILABLE
        : code === 'AI_RATE_LIMITED'
          ? HttpStatus.TOO_MANY_REQUESTS
          : code === 'AI_CREDITS_EXHAUSTED'
            ? HttpStatus.PAYMENT_REQUIRED
            : code === 'AI_NOT_IN_PLAN'
              ? HttpStatus.FORBIDDEN
              : HttpStatus.CONFLICT;
    super({ code, message }, status);
  }
}

export interface CallContext {
  tenantId: string;
  userId: string | null;
  agent: AiAgentKey;
  runId?: string | null;
  promptVersion: string;
}

const EFFORT: Record<AiTier, Effort> = { fast: 'low', balanced: 'medium', deep: 'high' };

export const monthStart = (now = new Date()) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

/**
 * The only way SampForce code reaches a model. Before each call it checks the tenant kill switch, the
 * agent switch, the provider configuration, the credit budget and the per-user rate; after each call
 * it records metering. Redaction, when the tenant turns it on, applies to everything sent.
 */
@Injectable()
export class AiGateway {
  private readonly log = new Logger(AiGateway.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(API_ENV) private readonly env: ApiEnv,
    @Inject(AI_PROVIDER) private readonly providers: AiProviderChain,
    private readonly own: OwnServersStore,
  ) {}

  /** Resolved per call, so an AI key saved in the operator console applies without a restart (ADR 0051, 0067). */
  private get provider(): ModelProvider | null {
    return this.providers.current();
  }

  get configured(): boolean {
    return this.provider !== null;
  }

  async settings(tx: TenantTx, tenantId: string) {
    return (await tx.aiSettings.findUnique({ where: { tenantId } })) ?? (await tx.aiSettings.create({ data: { tenantId } }));
  }

  async credits(tx: TenantTx, tenantId: string, cap: number | null) {
    const [ent, seats, used] = await Promise.all([
      entitlementsFor(tx, tenantId),
      tx.membership.count({ where: { tenantId, status: 'ACTIVE' } }),
      tx.aiUsage.aggregate({ where: { tenantId, createdAt: { gte: monthStart() } }, _sum: { credits: true } }),
    ]);
    // The plan's live allowance (operators can change it in the console, ADR 0057), pooled across active seats.
    const allowance = ent.entitlements.monthlyAiCredits * Math.max(1, seats);
    const limit = cap === null ? allowance : Math.min(allowance, cap);
    const usedCredits = used._sum.credits ?? 0;
    return { used: usedCredits, allowance, limit, remaining: Math.max(0, limit - usedCredits), seats };
  }

  async status(tenantId: string, userId: string): Promise<AiStatus> {
    return this.prisma.run({ tenantId, userId }, async (tx) => {
      const s = await this.settings(tx, tenantId);
      const credits = await this.credits(tx, tenantId, s.monthlyCreditCap);
      const disabled = new Set(s.disabledAgents);
      const own = await this.own.ai(tenantId);
      const ownCount = own?.entries.length ?? 0;
      const agents = Object.values(AI_AGENTS).map((a) => {
        const reason = !s.enabled
          ? 'AI is switched off for this workspace.'
          : disabled.has(a.key)
            ? 'An administrator switched this agent off.'
            : !this.provider && !ownCount
              ? 'No AI provider is configured on this installation.'
              : credits.remaining <= 0 && !ownCount
                ? 'This month’s AI credits are used up.'
                : null;
        return { key: a.key, enabled: s.enabled && !disabled.has(a.key), available: reason === null, reason };
      });
      const plan = own && !own.useShared ? [] : this.providers.plan();
      const shared = plan.map((k) => ({ name: AI_PROVIDER_DEFS[k].name, model: AI_PROVIDER_DEFS[k].model(this.env) }));
      const ownRows = (own?.entries ?? []).map((e) => ({ name: `${e.name} (your workspace)`, model: e.provider.model || null }));
      const all = [...ownRows, ...shared];
      const first = all[0] ?? null;
      return {
        provider: {
          configured: !!first,
          name: first?.name ?? 'Anthropic Claude',
          model: first?.model ?? null,
          fallbacks: all.slice(1).map((r) => ({ name: r.name, model: r.model ?? '' })),
          note: ownCount
            ? own!.useShared && shared.length
              ? 'Your workspace’s own AI providers answer first, at no cost in AI credits. When they fail, SampForce’s shared providers answer and use AI credits.'
              : 'Your workspace’s own AI providers answer every request, at no cost in AI credits.'
            : first
              ? all.length > 1
                ? 'An API key is set. When this provider is busy, out of free quota or failing, SampForce moves on to the next provider at once.'
                : 'An API key is set. SampForce has not verified it until the first call succeeds; failures are shown on each run.'
              : 'An operator must add an AI provider key in the operator console under Providers: Anthropic, OpenAI, Google Gemini, Groq, OpenRouter, Mistral or a self-hosted server such as Ollama. A workspace admin can also add the workspace’s own keys or AI server under Integrations. Until then AI features say they are unavailable.',
        },
        settings: {
          enabled: s.enabled,
          disabledAgents: s.disabledAgents as AiAgentKey[],
          autoQualifyLeads: s.autoQualifyLeads,
          redactPii: s.redactPii,
          monthlyCreditCap: s.monthlyCreditCap,
        },
        credits: { ...credits, periodStart: monthStart().toISOString() },
        agents,
      };
    });
  }

  /** Throws AiUnavailable when the agent may not call a model now. Returns the redaction setting. */
  async preflight(ctx: Omit<CallContext, 'promptVersion'>): Promise<{ redact: boolean; own: OwnEntry[]; useShared: boolean }> {
    const own = await this.own.ai(ctx.tenantId);
    const ownEntries = own?.entries ?? [];
    const agent = AI_AGENTS[ctx.agent];
    return this.prisma.run({ tenantId: ctx.tenantId, userId: ctx.userId ?? '' }, async (tx) => {
      const s = await this.settings(tx, ctx.tenantId);
      if (!(await hasFeature(tx, ctx.tenantId, 'ai_assistant'))) throw new AiUnavailable('AI_NOT_IN_PLAN', 'AI is not included in this workspace’s plan. A workspace admin can upgrade on the Billing page.');
      if (!s.enabled) throw new AiUnavailable('AI_DISABLED', 'AI is switched off for this workspace. An administrator can turn it back on in AI Agents.');
      if (s.disabledAgents.includes(ctx.agent)) throw new AiUnavailable('AGENT_DISABLED', `The ${agent.name} agent is switched off for this workspace.`);
      let useShared = !own || own.useShared;
      if (!this.provider && !ownEntries.length) throw new AiUnavailable('AI_NOT_CONFIGURED', 'No AI provider is configured on this installation, so this needs an operator to add an API key.');
      const credits = await this.credits(tx, ctx.tenantId, s.monthlyCreditCap);
      if (credits.remaining < creditsFor(0, 0, agent.tier)) {
        // The workspace's own providers cost no credits (ADR 0068): with them, only the shared ones are left out.
        if (!ownEntries.length) throw new AiUnavailable('AI_CREDITS_EXHAUSTED', `This workspace has used its ${credits.limit} AI credits for this month.`);
        useShared = false;
      }
      if (ctx.userId) {
        const recent = await tx.aiUsage.count({ where: { tenantId: ctx.tenantId, userId: ctx.userId, createdAt: { gte: new Date(Date.now() - 60_000) } } });
        if (recent >= this.env.AI_USER_CALLS_PER_MINUTE) throw new AiUnavailable('AI_RATE_LIMITED', 'Too many AI requests in the last minute. Try again shortly.');
      }
      return { redact: s.redactPii, own: ownEntries, useShared };
    });
  }

  /**
   * One model call with metering. The system prompt gains a line asking for the person's language (see
   * `languageInstruction`). The redactor (shared across the calls of one run) is applied to the
   * system prompt, messages and tool definitions are left as they are.
   */
  async call(ctx: CallContext, req: ModelRequest, redactor: Redactor | null): Promise<ModelResponse> {
    const { own, useShared } = await this.preflight(ctx);
    const provider = this.provider;
    const fallbackName = own[0] ? `own:${own[0].kind}` : (provider?.name ?? 'none');
    const fallbackModel = own[0]?.provider.model ?? provider?.model ?? '';
    const tier = AI_AGENTS[ctx.agent].tier;
    const localized: ModelRequest = { ...req, system: inLanguagePrompt(req.system, requestLanguage()) };
    const outgoing: ModelRequest = redactor
      ? { ...localized, system: redactor.redact(localized.system), messages: localized.messages.map((m) => redactMessage(m, redactor)) }
      : localized;
    const started = Date.now();
    let res: ModelResponse | null = null;
    let failure: unknown = null;
    try {
      res = await this.providers.generateWith({ ...outgoing, effort: outgoing.effort ?? EFFORT[tier] }, own, useShared);
    } catch (err) {
      failure = err;
    }
    // An answer from the workspace's own provider is paid for by the workspace directly: no AI credits.
    const credits = res && !res.provider?.startsWith('own:') ? creditsFor(res.inputTokens, res.outputTokens, tier) : 0;
    await this.prisma.run({ tenantId: ctx.tenantId, userId: ctx.userId ?? '' }, (tx) =>
      tx.aiUsage.create({
        data: {
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          runId: ctx.runId ?? null,
          agent: ctx.agent,
          provider: res?.provider ?? fallbackName,
          model: res?.model ?? fallbackModel,
          inputTokens: res?.inputTokens ?? 0,
          outputTokens: res?.outputTokens ?? 0,
          credits,
          status: res ? 'ok' : 'error',
          latencyMs: Date.now() - started,
          promptVersion: ctx.promptVersion,
        },
      }),
    );
    if (!res) {
      this.log.warn({ agent: ctx.agent, err: errorMessage(failure) }, 'AI provider call failed');
      throw failure instanceof Error ? failure : new Error(String(failure));
    }
    return redactor ? { ...res, content: res.content.map((b) => restoreBlock(b, redactor)) } : res;
  }

  effortFor(agent: AiAgentKey): Effort {
    return EFFORT[AI_AGENTS[agent].tier];
  }
}

/** Thinking blocks are passed back exactly as received, so redaction only touches text, tool input and tool results. */
const OPAQUE = new Set(['thinking', 'redacted_thinking', 'fallback']);

function redactMessage(m: ModelMessage, r: Redactor): ModelMessage {
  if (typeof m.content === 'string') return { ...m, content: r.redact(m.content) } as ModelMessage;
  if (!Array.isArray(m.content)) return m;
  return { ...m, content: (m.content as { type: string }[]).map((b) => (OPAQUE.has(b.type) ? b : r.redactDeep(b))) } as ModelMessage;
}

function restoreBlock(b: ModelBlock, r: Redactor): ModelBlock {
  if (b.type === 'text') return { ...b, text: r.restore(b.text) };
  if (b.type === 'tool_use') return { ...b, input: r.restoreDeep(b.input) };
  return b;
}
