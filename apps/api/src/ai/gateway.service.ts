import { HttpException, HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import type { TenantTx } from '@dealflow/database';
import { AI_AGENTS, type AiAgentKey, type AiStatus, type AiTier, creditsFor, monthlyCreditAllowance } from '@dealflow/types';
import { entitlementsFor } from '../billing/entitlements';
import { API_ENV, type ApiEnv } from '../common/env';
import { PrismaService } from '../common/prisma.service';
import { errorMessage } from '../worker/queue';
import { AnthropicProvider, type Effort, type ModelBlock, type ModelMessage, type ModelProvider, type ModelRequest, type ModelResponse } from './provider';
import { Redactor } from './redact';

export const AI_PROVIDER = Symbol('AI_PROVIDER');

/** Why AI cannot run right now. The message is shown to people as is. */
export class AiUnavailable extends HttpException {
  constructor(
    readonly code: 'AI_NOT_CONFIGURED' | 'AI_DISABLED' | 'AGENT_DISABLED' | 'AI_CREDITS_EXHAUSTED' | 'AI_RATE_LIMITED' | 'AI_PROVIDER_ERROR',
    message: string,
  ) {
    const status =
      code === 'AI_NOT_CONFIGURED' || code === 'AI_PROVIDER_ERROR'
        ? HttpStatus.SERVICE_UNAVAILABLE
        : code === 'AI_RATE_LIMITED'
          ? HttpStatus.TOO_MANY_REQUESTS
          : code === 'AI_CREDITS_EXHAUSTED'
            ? HttpStatus.PAYMENT_REQUIRED
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
 * The only way DealFlow code reaches a model. Before each call it checks the tenant kill switch, the
 * agent switch, the provider configuration, the credit budget and the per-user rate; after each call
 * it records metering. Redaction, when the tenant turns it on, applies to everything sent.
 */
@Injectable()
export class AiGateway {
  private readonly log = new Logger(AiGateway.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(API_ENV) private readonly env: ApiEnv,
    @Inject(AI_PROVIDER) private readonly providers: ModelProviderSource,
  ) {}

  /** Resolved per call, so an ANTHROPIC_API_KEY saved in the operator console applies without a restart. */
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
    const allowance = monthlyCreditAllowance(ent.appliedPlan, seats);
    const limit = cap === null ? allowance : Math.min(allowance, cap);
    const usedCredits = used._sum.credits ?? 0;
    return { used: usedCredits, allowance, limit, remaining: Math.max(0, limit - usedCredits), seats };
  }

  async status(tenantId: string, userId: string): Promise<AiStatus> {
    return this.prisma.run({ tenantId, userId }, async (tx) => {
      const s = await this.settings(tx, tenantId);
      const credits = await this.credits(tx, tenantId, s.monthlyCreditCap);
      const disabled = new Set(s.disabledAgents);
      const agents = Object.values(AI_AGENTS).map((a) => {
        const reason = !s.enabled
          ? 'AI is switched off for this workspace.'
          : disabled.has(a.key)
            ? 'An administrator switched this agent off.'
            : !this.provider
              ? 'No AI provider is configured on this installation.'
              : credits.remaining <= 0
                ? 'This month’s AI credits are used up.'
                : null;
        return { key: a.key, enabled: s.enabled && !disabled.has(a.key), available: reason === null, reason };
      });
      return {
        provider: {
          configured: !!this.provider,
          name: 'Anthropic Claude',
          model: this.provider?.model ?? null,
          note: this.provider
            ? 'An API key is set. DealFlow has not verified it until the first call succeeds; failures are shown on each run.'
            : 'An operator must add ANTHROPIC_API_KEY in the operator console (Providers) or the deployment secrets. Until then AI features say they are unavailable.',
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
  async preflight(ctx: Omit<CallContext, 'promptVersion'>): Promise<{ redact: boolean }> {
    const agent = AI_AGENTS[ctx.agent];
    return this.prisma.run({ tenantId: ctx.tenantId, userId: ctx.userId ?? '' }, async (tx) => {
      const s = await this.settings(tx, ctx.tenantId);
      if (!s.enabled) throw new AiUnavailable('AI_DISABLED', 'AI is switched off for this workspace. An administrator can turn it back on in AI Agents.');
      if (s.disabledAgents.includes(ctx.agent)) throw new AiUnavailable('AGENT_DISABLED', `The ${agent.name} agent is switched off for this workspace.`);
      if (!this.provider) throw new AiUnavailable('AI_NOT_CONFIGURED', 'No AI provider is configured on this installation, so this needs an operator to add an API key.');
      const credits = await this.credits(tx, ctx.tenantId, s.monthlyCreditCap);
      if (credits.remaining < creditsFor(0, 0, agent.tier)) {
        throw new AiUnavailable('AI_CREDITS_EXHAUSTED', `This workspace has used its ${credits.limit} AI credits for this month.`);
      }
      if (ctx.userId) {
        const recent = await tx.aiUsage.count({ where: { tenantId: ctx.tenantId, userId: ctx.userId, createdAt: { gte: new Date(Date.now() - 60_000) } } });
        if (recent >= this.env.AI_USER_CALLS_PER_MINUTE) throw new AiUnavailable('AI_RATE_LIMITED', 'Too many AI requests in the last minute. Try again shortly.');
      }
      return { redact: s.redactPii };
    });
  }

  /**
   * One model call with metering. The redactor (shared across the calls of one run) is applied to the
   * system prompt, messages and tool definitions are left as they are.
   */
  async call(ctx: CallContext, req: ModelRequest, redactor: Redactor | null): Promise<ModelResponse> {
    await this.preflight(ctx);
    const provider = this.provider!;
    const tier = AI_AGENTS[ctx.agent].tier;
    const outgoing: ModelRequest = redactor
      ? { ...req, system: redactor.redact(req.system), messages: req.messages.map((m) => redactMessage(m, redactor)) }
      : req;
    const started = Date.now();
    let res: ModelResponse | null = null;
    let failure: unknown = null;
    try {
      res = await provider.generate({ ...outgoing, effort: outgoing.effort ?? EFFORT[tier] });
    } catch (err) {
      failure = err;
    }
    const credits = res ? creditsFor(res.inputTokens, res.outputTokens, tier) : 0;
    await this.prisma.run({ tenantId: ctx.tenantId, userId: ctx.userId ?? '' }, (tx) =>
      tx.aiUsage.create({
        data: {
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          runId: ctx.runId ?? null,
          agent: ctx.agent,
          provider: provider.name,
          model: res?.model ?? provider.model,
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

export interface ModelProviderSource {
  current(): ModelProvider | null;
}

/** The Claude client for the key set now: built once per key, rebuilt when the key changes, none without a key. */
export function providerFactory(env: ApiEnv): ModelProviderSource {
  let cached: { key: string; provider: ModelProvider } | null = null;
  return {
    current() {
      const key = env.ANTHROPIC_API_KEY;
      if (!key) return null;
      if (cached?.key !== key) cached = { key, provider: new AnthropicProvider(env) };
      return cached.provider;
    },
  };
}
