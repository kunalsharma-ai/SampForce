import { Controller, ForbiddenException, HttpCode, Param, ParseUUIDPipe, Post, UnprocessableEntityException } from '@nestjs/common';
import { CHURN_RISK, type RetentionBrief, retentionBriefSchema } from '@dealflow/types';
import { Auth, type AuthContext, RequirePermissions } from '../common/auth-context';
import { SuccessService } from '../revenue/success.service';
import { AgentOutputError, AgentsService } from './agents.service';
import { PermissionDenied } from './record-context';
import { untrusted } from './redact';

/** Feature 13: the Retention Advisor writes a briefing from the churn-risk facts. A draft; nothing is created. */
@Controller('success/customers')
export class RetentionController {
  constructor(
    private readonly success: SuccessService,
    private readonly agents: AgentsService,
  ) {}

  @Post(':companyId/retention-brief')
  @HttpCode(200)
  @RequirePermissions('success:read', 'companies:read', 'ai:use')
  async brief(@Auth() auth: AuthContext, @Param('companyId', new ParseUUIDPipe()) companyId: string): Promise<RetentionBrief & { generatedAt: string }> {
    const f = await this.success.briefFacts(auth, companyId);
    const r = f.row;
    return this.agents.withRun(auth, 'retention_advisor', 'company', companyId, { op: 'retention_brief', score: r.health.score, signals: r.health.signals.map((s) => s.key) }, undefined, async (run) => {
      let out: RetentionBrief;
      try {
        out = await this.agents.structured(auth, run, 'retention_advisor', 'retentionBrief', retentionBriefSchema, {
          today: new Date().toISOString().slice(0, 10),
          customer: r.company.name,
          health: { score: r.health.score, risk: CHURN_RISK[r.health.band].label, signals: r.health.signals.map((s) => ({ label: s.label, detail: s.detail })) },
          contracts: { active: r.activeContracts, value: r.contractValue, currency: r.currency, nextEnd: r.nextRenewal ? { endDate: r.nextRenewal.endDate, daysToEnd: r.nextRenewal.daysToEnd } : null },
          engagement: r.engagement,
          deals: r.deals,
          recentActivity: f.activities,
          openEscalations: untrusted('escalations', JSON.stringify(f.escalations)),
          openPortalRequests: untrusted('portal_requests', JSON.stringify(f.requests)),
          ruleBasedSteps: r.plan.actions.map((a) => a.title),
        });
      } catch (err) {
        if (err instanceof AgentOutputError) throw new UnprocessableEntityException({ code: 'AI_OUTPUT_UNUSABLE', message: err.message });
        if (err instanceof PermissionDenied) throw new ForbiddenException({ code: 'FORBIDDEN', message: err.message });
        throw err;
      }
      return { output: out, rec: { ...out, generatedAt: new Date().toISOString() } };
    });
  }
}
