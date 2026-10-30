import { Injectable } from '@nestjs/common';
import type { AiRunRow, AiSettingsUpdate, AiStatus, AiUsageSummary } from '@dealflow/types';
import { AuditService } from '../audit/audit.service';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { notFound, ownerRefs } from '../crm/crm-helpers';
import { AiGateway, monthStart } from './gateway.service';

/** AI governance: settings (kill switches, redaction, caps), usage and the run log. */
@Injectable()
export class AiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: AiGateway,
    private readonly audit: AuditService,
  ) {}

  status(auth: AuthContext): Promise<AiStatus> {
    return this.gateway.status(auth.tenantId, auth.userId);
  }

  async updateSettings(auth: AuthContext, input: AiSettingsUpdate, meta: RequestMeta): Promise<AiStatus> {
    await this.prisma.run(auth, async (tx) => {
      const before = await this.gateway.settings(tx, auth.tenantId);
      const after = await tx.aiSettings.update({
        where: { tenantId: auth.tenantId },
        data: {
          ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
          ...(input.disabledAgents !== undefined ? { disabledAgents: [...new Set(input.disabledAgents)] } : {}),
          ...(input.autoQualifyLeads !== undefined ? { autoQualifyLeads: input.autoQualifyLeads } : {}),
          ...(input.redactPii !== undefined ? { redactPii: input.redactPii } : {}),
          ...(input.monthlyCreditCap !== undefined ? { monthlyCreditCap: input.monthlyCreditCap } : {}),
          updatedById: auth.userId,
        },
      });
      const changes = Object.fromEntries(
        (['enabled', 'disabledAgents', 'autoQualifyLeads', 'redactPii', 'monthlyCreditCap'] as const)
          .filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]))
          .map((k) => [k, { from: before[k], to: after[k] }]),
      );
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'ai.settings_updated', entityType: 'ai_settings', entityId: auth.tenantId, metadata: { changes }, meta });
    });
    return this.status(auth);
  }

  usage(auth: AuthContext): Promise<AiUsageSummary> {
    return this.prisma.run(auth, async (tx) => {
      const since = monthStart();
      const grouped = await tx.aiUsage.groupBy({
        by: ['agent'],
        where: { tenantId: auth.tenantId, createdAt: { gte: since } },
        _count: { _all: true },
        _sum: { credits: true, inputTokens: true, outputTokens: true },
      });
      const runs = await tx.aiRun.findMany({ where: { tenantId: auth.tenantId }, orderBy: { createdAt: 'desc' }, take: 25 });
      const names = await ownerRefs(tx, runs.map((r) => r.userId));
      return {
        periodStart: since.toISOString(),
        byAgent: grouped
          .map((g) => ({ agent: g.agent, calls: g._count._all, credits: g._sum.credits ?? 0, inputTokens: g._sum.inputTokens ?? 0, outputTokens: g._sum.outputTokens ?? 0 }))
          .sort((a, b) => b.credits - a.credits),
        recentRuns: runs.map((r) => toRunRow(r, names)),
      };
    });
  }

  run(auth: AuthContext, id: string): Promise<AiRunRow & { trace: unknown; output: unknown }> {
    return this.prisma.run(auth, async (tx) => {
      const r = await tx.aiRun.findFirst({ where: { id, tenantId: auth.tenantId } });
      if (!r) throw notFound('AI run');
      return { ...toRunRow(r, await ownerRefs(tx, [r.userId])), trace: r.trace, output: r.output };
    });
  }
}

function toRunRow(
  r: { id: string; agent: string; status: AiRunRow['status']; userId: string | null; entityType: string | null; entityId: string | null; model: string | null; promptVersion: string; creditsUsed: number; error: string | null; createdAt: Date; finishedAt: Date | null },
  names: Map<string, { id: string; name: string }>,
): AiRunRow {
  return {
    id: r.id, agent: r.agent, status: r.status, user: r.userId ? (names.get(r.userId) ?? null) : null, entityType: r.entityType, entityId: r.entityId,
    model: r.model, promptVersion: r.promptVersion, creditsUsed: r.creditsUsed, error: r.error, createdAt: r.createdAt.toISOString(), finishedAt: r.finishedAt?.toISOString() ?? null,
  };
}
