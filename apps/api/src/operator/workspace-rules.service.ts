import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@dealflow/database';
import {
  type ClientWorkspaceRules,
  DEFAULT_WORKSPACE_RULES,
  effectiveWorkspaceRules,
  parseWorkspaceRules,
  type PlanWorkspaceRulesRow,
  type PutClientWorkspaceRules,
  type PutPlanWorkspaceRules,
  type WorkspaceRules,
  type WorkspaceRulesOverride,
  workspaceRulesOverrideSchema,
} from '@dealflow/types';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../common/prisma.service';
import type { OperatorContext } from './operator-auth';
import { OperatorService } from './operator.service';

/**
 * Console rules for client workspaces (workspace redesign W3): per plan, with a per-client override. They cap what a
 * Super Workspace can give its Manager and Executive Workspaces (Delete, modules) and can require two-step sign-in
 * per level. Every change is written to the platform audit log, and a client change to the client's own log too.
 */
@Injectable()
export class WorkspaceRulesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ops: OperatorService,
    private readonly audit: AuditService,
  ) {}

  async plans(): Promise<{ defaults: WorkspaceRules; plans: PlanWorkspaceRulesRow[] }> {
    const [plans, stored] = await Promise.all([
      this.prisma.plan.findMany({ select: { code: true, name: true }, orderBy: { createdAt: 'asc' } }),
      this.prisma.planWorkspaceRules.findMany(),
    ]);
    const byCode = new Map(stored.map((r) => [r.planCode, r.rules]));
    return {
      defaults: DEFAULT_WORKSPACE_RULES,
      plans: plans.map((p) => ({ planCode: p.code, planName: p.name, rules: parseWorkspaceRules(byCode.get(p.code) ?? null), customised: byCode.has(p.code) })),
    };
  }

  async setPlan(op: OperatorContext, code: string, input: PutPlanWorkspaceRules, ip: string | null) {
    const plan = await this.prisma.plan.findUnique({ where: { code }, select: { code: true } });
    if (!plan) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Plan not found.' });
    const before = await this.prisma.planWorkspaceRules.findUnique({ where: { planCode: code } });
    const rules = input.rules as unknown as Prisma.InputJsonValue;
    await this.prisma.planWorkspaceRules.upsert({ where: { planCode: code }, create: { planCode: code, rules, updatedBy: op.email }, update: { rules, updatedBy: op.email } });
    await this.ops.log(op.id, 'plan.workspace_rules_changed', null, { plan: code, reason: input.reason, from: parseWorkspaceRules(before?.rules ?? null), to: input.rules }, ip);
    return this.plans();
  }

  async client(id: string): Promise<ClientWorkspaceRules> {
    return this.prisma.run({ tenantId: id }, async (tx) => {
      const sub = await tx.subscription.findFirst({ where: { tenantId: id, tenant: { deletedAt: null } }, select: { planCode: true, workspaceRules: true } });
      if (!sub) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Client not found.' });
      const plan = await tx.planWorkspaceRules.findUnique({ where: { planCode: sub.planCode }, select: { rules: true } });
      const parsed = workspaceRulesOverrideSchema.safeParse(sub.workspaceRules);
      const override: WorkspaceRulesOverride | null = sub.workspaceRules && parsed.success ? parsed.data : null;
      return {
        tenantId: id,
        planCode: sub.planCode,
        planRules: parseWorkspaceRules(plan?.rules ?? null),
        override,
        effective: effectiveWorkspaceRules(plan?.rules ?? null, override),
      };
    });
  }

  async setClient(op: OperatorContext, id: string, input: PutClientWorkspaceRules, ip: string | null): Promise<ClientWorkspaceRules> {
    const before = await this.client(id);
    const empty = !input.override || Object.keys(input.override).length === 0;
    await this.prisma.run({ tenantId: id }, async (tx) => {
      await tx.subscription.update({ where: { tenantId: id }, data: { workspaceRules: empty ? null : (input.override as Prisma.InputJsonValue) } });
      await this.audit.record(tx, {
        tenantId: id, actorUserId: null, actorType: 'PLATFORM_ADMIN', action: 'security.workspace_rules_changed', entityType: 'tenant', entityId: id,
        metadata: { operator: op.email, reason: input.reason, override: empty ? null : input.override },
      });
    });
    await this.ops.log(op.id, 'tenant.workspace_rules_changed', id, { reason: input.reason, from: before.override, to: empty ? null : input.override }, ip);
    return this.client(id);
  }
}
