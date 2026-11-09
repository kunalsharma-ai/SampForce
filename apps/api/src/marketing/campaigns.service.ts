import { ConflictException, Injectable } from '@nestjs/common';
import { nullsLast, Prisma, type TenantTx } from '@dealflow/database';
import { type CampaignInput, type CampaignResults, type CampaignRow, campaignRatios } from '@dealflow/types';
import { AuditService } from '../audit/audit.service';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { assertRefs, notFound, ownerRefs } from '../crm/crm-helpers';

type CampaignModel = Prisma.CampaignGetPayload<object>;
const ymd = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

/**
 * Campaigns with first-touch attribution: a lead belongs to a campaign when it was captured by one of the
 * campaign's forms, linked by hand, or carries the campaign's UTM value as its campaign source. Deals count
 * when they were converted from those leads.
 */
@Injectable()
export class CampaignsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(auth: AuthContext): Promise<CampaignRow[]> {
    return this.prisma.run(auth, async (tx) => {
      const rows = await tx.campaign.findMany({ where: { tenantId: auth.tenantId }, orderBy: [{ startDate: nullsLast('desc') }, { name: 'asc' }] });
      const names = await ownerRefs(tx, rows.map((r) => r.ownerId));
      return Promise.all(rows.map(async (c) => toRow(c, names, await results(tx, auth.tenantId, c))));
    });
  }

  get(auth: AuthContext, id: string): Promise<CampaignRow> {
    return this.prisma.run(auth, async (tx) => {
      const c = await tx.campaign.findFirst({ where: { id, tenantId: auth.tenantId } });
      if (!c) throw notFound('Campaign');
      return toRow(c, await ownerRefs(tx, [c.ownerId]), await results(tx, auth.tenantId, c));
    });
  }

  save(auth: AuthContext, id: string | null, input: CampaignInput, meta: RequestMeta): Promise<CampaignRow> {
    return this.prisma.run(auth, async (tx) => {
      await assertRefs(tx, auth.tenantId, { ownerId: input.ownerId });
      const currency = input.currency ?? (await tx.tenant.findFirstOrThrow({ where: { id: auth.tenantId } })).defaultCurrency;
      const data = {
        ...input, currency, ownerId: input.ownerId ?? (id ? undefined : auth.userId),
        startDate: input.startDate ? new Date(input.startDate) : input.startDate === null ? null : undefined,
        endDate: input.endDate ? new Date(input.endDate) : input.endDate === null ? null : undefined,
      };
      try {
        let campaignId = id;
        if (id) {
          const { count } = await tx.campaign.updateMany({ where: { id, tenantId: auth.tenantId }, data });
          if (!count) throw notFound('Campaign');
        } else campaignId = (await tx.campaign.create({ data: { ...data, tenantId: auth.tenantId } })).id;
        await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: id ? 'campaign.updated' : 'campaign.created', entityType: 'campaign', entityId: campaignId!, metadata: { name: input.name }, meta });
        const c = await tx.campaign.findFirstOrThrow({ where: { id: campaignId! } });
        return toRow(c, await ownerRefs(tx, [c.ownerId]), await results(tx, auth.tenantId, c));
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') throw new ConflictException({ code: 'DUPLICATE', message: 'A campaign with this name already exists.' });
        throw err;
      }
    });
  }
}

export async function results(tx: TenantTx, tenantId: string, c: CampaignModel): Promise<CampaignResults> {
  const leads = await tx.lead.findMany({
    where: { tenantId, deletedAt: null, OR: [{ campaignId: c.id }, ...(c.utmCampaign ? [{ campaignSource: { equals: c.utmCampaign, mode: 'insensitive' as const } }] : [])] },
    select: { id: true, status: true },
  });
  const deals = leads.length
    ? await tx.opportunity.findMany({ where: { tenantId, deletedAt: null, sourceLeadId: { in: leads.map((l) => l.id) } }, select: { amount: true, currency: true, status: true } })
    : [];
  let pipeline = 0;
  let won = 0;
  let wonDeals = 0;
  let otherCurrencyDeals = 0;
  for (const d of deals) {
    if (d.currency !== c.currency) {
      otherCurrencyDeals++;
      continue;
    }
    if (d.status === 'OPEN') pipeline += Number(d.amount);
    if (d.status === 'WON') {
      won += Number(d.amount);
      wonDeals++;
    }
  }
  const budget = c.budget?? null;
  return {
    leads: leads.length,
    qualified: leads.filter((l) => l.status === 'QUALIFIED' || l.status === 'CONVERTED').length,
    converted: leads.filter((l) => l.status === 'CONVERTED').length,
    deals: deals.length,
    pipeline: Math.round(pipeline * 100) / 100,
    won: Math.round(won * 100) / 100,
    wonDeals,
    ...campaignRatios(budget, leads.length, won),
    otherCurrencyDeals,
  };
}

function toRow(c: CampaignModel, names: Map<string, { id: string; name: string }>, r: CampaignResults): CampaignRow {
  return {
    id: c.id, name: c.name, channel: c.channel as CampaignRow['channel'], status: c.status, startDate: ymd(c.startDate), endDate: ymd(c.endDate),
    budget: c.budget?? null, currency: c.currency, utmCampaign: c.utmCampaign, owner: c.ownerId ? (names.get(c.ownerId) ?? null) : null,
    description: c.description, results: r, createdAt: c.createdAt.toISOString(),
  };
}
