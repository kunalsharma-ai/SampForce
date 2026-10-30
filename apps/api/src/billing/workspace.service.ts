import { Injectable, NotFoundException } from '@nestjs/common';
import type { OnboardingState, SupportGrantRow } from '@dealflow/types';
import { AuditService } from '../audit/audit.service';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { ownerRefs } from '../crm/crm-helpers';

const HOUR = 3_600_000;

/** Workspace-side pieces of Phase 6: the onboarding checklist and support-access grants. */
@Injectable()
export class WorkspaceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Each step is derived from real data, so it ticks itself off when the work is done anywhere in the app. */
  onboarding(auth: AuthContext): Promise<OnboardingState> {
    return this.prisma.run(auth, async (tx) => {
      const t = auth.tenantId;
      const [tenant, profile, pipeline, members, invites, people, deals, workflows] = await Promise.all([
        tx.tenant.findUniqueOrThrow({ where: { id: t }, select: { onboardingDismissedAt: true } }),
        tx.auditLog.count({ where: { tenantId: t, action: 'tenant.updated' } }),
        tx.auditLog.count({ where: { tenantId: t, action: { in: ['pipeline.created', 'pipeline.updated'] } } }),
        tx.membership.count({ where: { tenantId: t, status: 'ACTIVE' } }),
        tx.invitation.count({ where: { tenantId: t } }),
        Promise.all([tx.lead.count({ where: { tenantId: t, deletedAt: null } }), tx.contact.count({ where: { tenantId: t, deletedAt: null } })]),
        tx.opportunity.count({ where: { tenantId: t, deletedAt: null } }),
        tx.workflow.count({ where: { tenantId: t, deletedAt: null } }),
      ]);
      return {
        dismissed: !!tenant.onboardingDismissedAt,
        steps: [
          { key: 'profile', label: 'Set your workspace currency and time zone', done: profile > 0, href: '/app/settings' },
          { key: 'pipeline', label: 'Shape your sales pipeline stages', done: pipeline > 0, href: '/app/pipelines' },
          { key: 'invite', label: 'Invite a teammate', done: members > 1 || invites > 0, href: '/app/team' },
          { key: 'import', label: 'Add or import leads and contacts', done: people[0] + people[1] > 0, href: '/app/settings/import' },
          { key: 'deal', label: 'Create your first deal', done: deals > 0, href: '/app/deals' },
          { key: 'automation', label: 'Automate a follow-up', done: workflows > 0, href: '/app/automation' },
        ],
      };
    });
  }

  dismissOnboarding(auth: AuthContext, dismissed: boolean): Promise<void> {
    return this.prisma.run(auth, async (tx) => {
      await tx.tenant.update({ where: { id: auth.tenantId }, data: { onboardingDismissedAt: dismissed ? new Date() : null } });
    });
  }

  supportGrants(auth: AuthContext): Promise<SupportGrantRow[]> {
    return this.prisma.run(auth, async (tx) => {
      const rows = await tx.supportGrant.findMany({ where: { tenantId: auth.tenantId }, orderBy: { createdAt: 'desc' }, take: 50 });
      const names = await ownerRefs(tx, rows.map((r) => r.grantedById));
      return rows.map((r) => toGrantRow(r, names));
    });
  }

  /** Lets platform support read the member list and audit log for a few hours. Never CRM records. */
  grantSupport(auth: AuthContext, input: { hours: number; reason: string }, meta: RequestMeta): Promise<SupportGrantRow> {
    return this.prisma.run(auth, async (tx) => {
      await tx.supportGrant.updateMany({ where: { tenantId: auth.tenantId, revokedAt: null, expiresAt: { gt: new Date() } }, data: { revokedAt: new Date() } });
      const row = await tx.supportGrant.create({
        data: { tenantId: auth.tenantId, grantedById: auth.userId, reason: input.reason, expiresAt: new Date(Date.now() + input.hours * HOUR) },
      });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'support_access.granted', entityType: 'support_grant', entityId: row.id, metadata: { hours: input.hours, reason: input.reason }, meta });
      return toGrantRow(row, await ownerRefs(tx, [row.grantedById]));
    });
  }

  revokeSupport(auth: AuthContext, id: string, meta: RequestMeta): Promise<void> {
    return this.prisma.run(auth, async (tx) => {
      const { count } = await tx.supportGrant.updateMany({ where: { id, tenantId: auth.tenantId, revokedAt: null }, data: { revokedAt: new Date() } });
      if (!count) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Active support access not found.' });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'support_access.revoked', entityType: 'support_grant', entityId: id, meta });
    });
  }
}

function toGrantRow(r: { id: string; reason: string; grantedById: string; createdAt: Date; expiresAt: Date; revokedAt: Date | null }, names: Map<string, { id: string; name: string }>): SupportGrantRow {
  return {
    id: r.id, reason: r.reason, grantedBy: names.get(r.grantedById) ?? null, createdAt: r.createdAt.toISOString(), expiresAt: r.expiresAt.toISOString(),
    revokedAt: r.revokedAt?.toISOString() ?? null, active: !r.revokedAt && r.expiresAt > new Date(),
  };
}
