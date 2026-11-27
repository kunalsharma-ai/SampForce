import { forwardRef, Inject, Injectable } from '@nestjs/common';
import type { TenantTx } from '@dealflow/database';
import type { CompanyWonResult } from '@dealflow/types';
import { AuditService } from '../audit/audit.service';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { clientStatusId, isClientStatus } from './company-deal-sync';
import { notFound } from './crm-helpers';
import { DealsService } from './deals.service';
import { RevenueRecordsService } from './revenue-records.service';
import { companyScope, visibility } from './visibility';

const CLOSED_RFQ = ['LOST', 'CANCELLED'];

/**
 * Company to Deal (redesign R4, ADR 0084). A company that becomes a client gets its deal: the open deal it already
 * has is closed as won, or a won deal is made from the company, its contact and its RFQs (won RFQs first). The RFQs
 * are linked to the deal and the owner is told. One deal per win: a second win reuses it and only links new RFQs.
 */
@Injectable()
export class CompanyDealsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    // forwardRef: deals.service imports companies.service (reportingManagerOf), which imports this file.
    @Inject(forwardRef(() => DealsService)) private readonly deals: DealsService,
    private readonly revenue: RevenueRecordsService,
    private readonly notifications: NotificationsService,
  ) {}

  /** The "Mark as won" action on a company: makes it a client, then runs the automation. */
  markWon(auth: AuthContext, companyId: string, meta: RequestMeta): Promise<CompanyWonResult> {
    return this.prisma.run(auth, async (tx) => {
      const v = await visibility(tx, auth);
      const c = await tx.company.findFirst({ where: { id: companyId, tenantId: auth.tenantId, deletedAt: null, ...companyScope(v) }, select: { id: true, statusId: true } });
      if (!c) throw notFound('Company');
      if (!(await isClientStatus(tx, auth.tenantId, c.statusId))) {
        const to = await clientStatusId(tx, auth.tenantId);
        if (to) {
          await tx.company.update({ where: { id: companyId }, data: { statusId: to, statusChangedAt: new Date(), statusChangedById: auth.userId, updatedById: auth.userId } });
          await this.audit.record(tx, {
            tenantId: auth.tenantId, actorUserId: auth.userId, action: 'company.status_changed', entityType: 'company', entityId: companyId,
            metadata: { from: c.statusId, to, source: 'MARK_WON' }, meta,
          });
        }
      }
      return this.companyWon(tx, auth, companyId, meta);
    });
  }

  /** The company has just become a client. Runs inside the caller's transaction. */
  async companyWon(tx: TenantTx, auth: AuthContext, companyId: string, meta: RequestMeta): Promise<CompanyWonResult> {
    const company = await tx.company.findFirst({ where: { id: companyId, tenantId: auth.tenantId, deletedAt: null }, select: { id: true, name: true, ownerId: true, managerId: true, wonDealId: true } });
    if (!company) throw notFound('Company');
    const rfqs = await tx.rfq.findMany({
      where: { tenantId: auth.tenantId, companyId, deletedAt: null, status: { notIn: CLOSED_RFQ } },
      orderBy: { receivedAt: 'desc' },
      select: { id: true, projectName: true, status: true, contactId: true, currency: true, actualRevenue: true, totalQuotation: true, expectedRevenue: true, opportunityId: true },
    });
    const won = rfqs.filter((r) => r.status === 'WON');
    const basis = won.length ? won : rfqs;

    // The deal: the one this company was already won with, else its latest open deal, else a new won deal.
    let deal = company.wonDealId ? await tx.opportunity.findFirst({ where: { id: company.wonDealId, tenantId: auth.tenantId, deletedAt: null } }) : null;
    deal ??= await tx.opportunity.findFirst({ where: { tenantId: auth.tenantId, companyId, deletedAt: null, status: 'OPEN' }, orderBy: { updatedAt: 'desc' } });
    let created = false;
    if (deal && deal.status === 'OPEN') {
      const stage = await this.wonStage(tx, auth.tenantId, deal.pipelineId);
      if (stage) deal = await this.deals.moveIn(tx, auth, deal.id, { stageId: stage.id }, meta);
    } else if (!deal) {
      const stage = await this.wonStage(tx, auth.tenantId);
      if (!stage) return { companyId, deal: null, created: false, linkedRfqs: 0 };
      const currency = basis[0]?.currency;
      const amount = basis.filter((r) => r.currency === currency).reduce((sum, r) => sum + (r.actualRevenue ?? r.totalQuotation ?? r.expectedRevenue ?? 0), 0);
      const contactId = basis[0]?.contactId ?? (await tx.contact.findFirst({ where: { tenantId: auth.tenantId, companyId, deletedAt: null }, orderBy: { createdAt: 'asc' }, select: { id: true } }))?.id;
      const row = await this.deals.createIn(
        tx,
        auth,
        {
          name: basis.length === 1 ? `${company.name}: ${basis[0]!.projectName}` : company.name,
          amount,
          ...(currency ? { currency } : {}),
          pipelineId: stage.pipelineId,
          stageId: stage.id,
          companyId,
          ...(contactId ? { contactId } : {}),
          ...(company.ownerId ? { ownerId: company.ownerId } : {}),
          customFields: {},
        },
        meta,
      );
      deal = await tx.opportunity.findFirstOrThrow({ where: { id: row.id } });
      created = true;
    }
    if (company.wonDealId !== deal.id) await tx.company.update({ where: { id: companyId }, data: { wonDealId: deal.id, wonAt: new Date() } });

    // Link the RFQs that have no deal yet.
    const link = basis.filter((r) => !r.opportunityId).map((r) => r.id);
    if (link.length) {
      await tx.rfq.updateMany({ where: { tenantId: auth.tenantId, id: { in: link } }, data: { opportunityId: deal.id, updatedById: auth.userId } });
      await this.revenue.reconcile(tx, auth.tenantId, { rfqIds: link, opportunityIds: [deal.id] });
    }
    await this.audit.record(tx, {
      tenantId: auth.tenantId, actorUserId: auth.userId, action: 'company.won', entityType: 'company', entityId: companyId,
      metadata: { dealId: deal.id, created, rfqIds: link }, meta,
    });
    if (created) {
      const to = [...new Set([deal.ownerId, company.managerId].filter((u): u is string => !!u && u !== auth.userId))];
      if (to.length) {
        await this.notifications.send(tx, auth.tenantId, to, {
          type: 'deal.won', title: `Client won: deal ${deal.dealNumber ?? deal.name} created for ${company.name}`, body: null,
          link: `/app/deals/${deal.id}`, senderId: auth.userId, eventId: `company-won:${companyId}:${deal.id}`,
        });
      }
    }
    return {
      companyId,
      deal: { id: deal.id, name: deal.name, dealNumber: deal.dealNumber, status: deal.status, amount: Number(deal.amount), currency: deal.currency },
      created,
      linkedRfqs: link.length,
    };
  }

  /** The first won stage of the pipeline (or of the default pipeline). */
  private wonStage(tx: TenantTx, tenantId: string, pipelineId?: string) {
    return tx.pipelineStage.findFirst({
      where: { tenantId, category: 'WON', ...(pipelineId ? { pipelineId } : { pipeline: { deletedAt: null } }) },
      orderBy: pipelineId ? [{ position: 'asc' }] : [{ pipeline: { isDefault: 'desc' } }, { pipeline: { position: 'asc' } }, { position: 'asc' }],
    });
  }
}
