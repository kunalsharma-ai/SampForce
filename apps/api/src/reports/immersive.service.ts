import { ForbiddenException, Injectable } from '@nestjs/common';
import type { TenantTx } from '@dealflow/database';
import { type GalaxyEdge, type GalaxyGraph, type GalaxyNode, type GlobeData, type Permission, type PipelineFlow, type PipelineReplay, toBase } from '@dealflow/types';
import type { AuthContext } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { notFound } from '../crm/crm-helpers';
import { loadRates } from '../revenue/fx';

const DAY = 86_400_000;
export const GALAXY_MAX_COMPANIES = 150;
const GALAXY_MAX_CONTACTS = 600;
const GALAXY_MAX_DEALS = 800;
export const REPLAY_MAX_DEALS = 400;

function need(auth: AuthContext, ...ps: Permission[]) {
  for (const p of ps) {
    if (!auth.permissions.includes(p)) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'You do not have permission to do that.', details: [{ path: 'permission', message: p }] });
    }
  }
}

/**
 * Data for the immersive views (Relationship Galaxy, Revenue Globe, pipeline flow, replays). Every number here is
 * computed from workspace records; the views only draw it.
 */
@Injectable()
export class ImmersiveService {
  constructor(private readonly prisma: PrismaService) {}

  private async money(tx: TenantTx, tenantId: string) {
    const [tenant, rates] = await Promise.all([
      tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { defaultCurrency: true } }),
      loadRates(tx, tenantId),
    ]);
    const base = tenant.defaultCurrency;
    return { base, convert: (amount: number, currency: string) => toBase(amount, currency, base, rates) };
  }

  galaxy(auth: AuthContext): Promise<GalaxyGraph> {
    need(auth, 'companies:read');
    const withContacts = auth.permissions.includes('contacts:read');
    const withDeals = auth.permissions.includes('deals:read');
    return this.prisma.run(auth, async (tx) => {
      const { base, convert } = await this.money(tx, auth.tenantId);
      const deals = withDeals
        ? await tx.opportunity.findMany({
            where: { tenantId: auth.tenantId, deletedAt: null, OR: [{ companyId: { not: null } }, { contactId: { not: null } }] },
            select: { id: true, name: true, amount: true, currency: true, status: true, companyId: true, contactId: true },
            orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
            take: GALAXY_MAX_DEALS,
          })
        : [];
      const openValue = new Map<string, number>();
      for (const d of deals) {
        if (d.status !== 'OPEN' || !d.companyId) continue;
        openValue.set(d.companyId, (openValue.get(d.companyId) ?? 0) + (convert(d.amount.toNumber(), d.currency) ?? 0));
      }
      const companies = await tx.company.findMany({
        where: { tenantId: auth.tenantId, deletedAt: null },
        select: { id: true, name: true, parentCompanyId: true },
        orderBy: { updatedAt: 'desc' },
        take: 5_000,
      });
      companies.sort((a, b) => (openValue.get(b.id) ?? 0) - (openValue.get(a.id) ?? 0));
      const shown = companies.slice(0, GALAXY_MAX_COMPANIES);
      const ids = new Set(shown.map((c) => c.id));
      const nodes: GalaxyNode[] = shown.map((c) => ({ id: c.id, kind: 'company', label: c.name, companyId: c.id, value: openValue.get(c.id) ?? 0, href: `/app/companies/${c.id}` }));
      const edges: GalaxyEdge[] = shown.filter((c) => c.parentCompanyId && ids.has(c.parentCompanyId)).map((c) => ({ source: c.id, target: c.parentCompanyId!, kind: 'parent' }));
      const contactIds = new Set<string>();
      if (withContacts) {
        const contacts = await tx.contact.findMany({
          where: { tenantId: auth.tenantId, deletedAt: null, companyId: { in: [...ids] } },
          select: { id: true, firstName: true, lastName: true, companyId: true },
          orderBy: { updatedAt: 'desc' },
          take: GALAXY_MAX_CONTACTS,
        });
        for (const c of contacts) {
          contactIds.add(c.id);
          nodes.push({ id: c.id, kind: 'contact', label: [c.firstName, c.lastName].filter(Boolean).join(' '), companyId: c.companyId, href: `/app/contacts/${c.id}` });
          edges.push({ source: c.id, target: c.companyId!, kind: 'works_at' });
        }
      }
      for (const d of deals) {
        const onCompany = d.companyId && ids.has(d.companyId);
        const onContact = d.contactId && contactIds.has(d.contactId);
        if (!onCompany && !onContact) continue;
        nodes.push({ id: d.id, kind: 'deal', label: d.name, companyId: onCompany ? d.companyId : null, status: d.status, value: convert(d.amount.toNumber(), d.currency), href: `/app/deals/${d.id}` });
        if (onCompany) edges.push({ source: d.id, target: d.companyId!, kind: 'deal_of' });
        if (onContact) edges.push({ source: d.id, target: d.contactId!, kind: 'contact_on' });
      }
      return { nodes, edges, currency: base, truncated: companies.length > shown.length };
    });
  }

  globe(auth: AuthContext): Promise<GlobeData> {
    need(auth, 'companies:read', 'deals:read');
    return this.prisma.run(auth, async (tx) => {
      const { base, convert } = await this.money(tx, auth.tenantId);
      const companies = await tx.company.groupBy({ by: ['country'], where: { tenantId: auth.tenantId, deletedAt: null }, _count: { _all: true } });
      const since = new Date(Date.now() - 365 * DAY);
      // Summed in the database per country, status and currency; conversion is linear, so converting the sums
      // matches converting each deal (to the cent). Loading every deal into the API took ~250 ms at 20k deals.
      const deals = await tx.$queryRaw<{ country: string | null; status: 'OPEN' | 'WON'; currency: string; n: number; total: number }[]>`
        SELECT upper(c.country) AS country, o.status::text AS status, o.currency, count(*)::int AS n, sum(o.amount)::float8 AS total
        FROM opportunities o LEFT JOIN companies c ON c.id = o.company_id AND c.deleted_at IS NULL
        WHERE o.tenant_id = ${auth.tenantId}::uuid AND o.deleted_at IS NULL
          AND (o.status = 'OPEN' OR (o.status = 'WON' AND o.closed_at >= ${since}))
        GROUP BY 1, 2, 3`;
      const by = new Map<string, { companies: number; openDeals: number; openValue: number; wonValue: number }>();
      const row = (c: string) => by.get(c) ?? by.set(c, { companies: 0, openDeals: 0, openValue: 0, wonValue: 0 }).get(c)!;
      let unplacedCompanies = 0;
      for (const g of companies) {
        if (!g.country) unplacedCompanies += g._count._all;
        else row(g.country.toUpperCase()).companies += g._count._all;
      }
      let unplacedDeals = 0;
      let excludedDeals = 0;
      for (const d of deals) {
        if (!d.country) {
          if (d.status === 'OPEN') unplacedDeals += d.n;
          continue;
        }
        const v = convert(d.total, d.currency);
        if (v === null) excludedDeals += d.n;
        const r = row(d.country);
        if (d.status === 'OPEN') {
          r.openDeals += d.n;
          r.openValue += v ?? 0;
        } else r.wonValue += v ?? 0;
      }
      const r2 = (x: number) => Math.round(x * 100) / 100;
      return {
        countries: [...by.entries()].map(([country, r]) => ({ country, ...r, openValue: r2(r.openValue), wonValue: r2(r.wonValue) })).sort((a, b) => b.openValue - a.openValue || b.companies - a.companies),
        currency: base,
        unplaced: { companies: unplacedCompanies, openDeals: unplacedDeals },
        excludedDeals,
      };
    });
  }

  private async pipeline(tx: TenantTx, tenantId: string, pipelineId?: string) {
    const pipeline = await tx.pipeline.findFirst({
      where: { tenantId, deletedAt: null, ...(pipelineId ? { id: pipelineId } : {}) },
      orderBy: [{ isDefault: 'desc' }, { position: 'asc' }],
      include: { stages: { orderBy: { position: 'asc' } } },
    });
    if (!pipeline) throw notFound('Pipeline');
    return pipeline;
  }

  flow(auth: AuthContext, pipelineId: string | undefined, days: number): Promise<PipelineFlow> {
    need(auth, 'deals:read', 'pipelines:read');
    return this.prisma.run(auth, async (tx) => {
      const { base, convert } = await this.money(tx, auth.tenantId);
      const pipeline = await this.pipeline(tx, auth.tenantId, pipelineId);
      const since = new Date(Date.now() - days * DAY);
      const open = await tx.opportunity.findMany({
        where: { tenantId: auth.tenantId, pipelineId: pipeline.id, deletedAt: null, status: 'OPEN' },
        select: { stageId: true, amount: true, currency: true },
      });
      const transitions = await tx.$queryRaw<{ from: string; to: string; deals: number }[]>`
        SELECT e.from_stage_id::text AS "from", e.to_stage_id::text AS "to", count(DISTINCT e.opportunity_id)::int AS deals
        FROM deal_stage_events e JOIN opportunities o ON o.id = e.opportunity_id AND o.deleted_at IS NULL
        WHERE e.tenant_id = ${auth.tenantId}::uuid AND e.pipeline_id = ${pipeline.id}::uuid AND e.from_stage_id IS NOT NULL AND e.occurred_at >= ${since}
        GROUP BY 1, 2`;
      // Time in stage: from entering a stage to the next recorded move out of it, for moves out inside the window.
      const durations = await tx.$queryRaw<{ stage: string; median: number | null }[]>`
        WITH seq AS (
          SELECT e.opportunity_id, e.to_stage_id, e.occurred_at,
                 lead(e.occurred_at) OVER (PARTITION BY e.opportunity_id ORDER BY e.occurred_at, e.id) AS left_at
          FROM deal_stage_events e JOIN opportunities o ON o.id = e.opportunity_id AND o.deleted_at IS NULL
          WHERE e.tenant_id = ${auth.tenantId}::uuid AND e.pipeline_id = ${pipeline.id}::uuid
        )
        SELECT to_stage_id::text AS stage, percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM left_at - occurred_at) / 86400)::float8 AS median
        FROM seq WHERE left_at IS NOT NULL AND left_at >= ${since} GROUP BY 1`;
      const median = new Map(durations.map((d) => [d.stage, d.median]));
      return {
        pipelineId: pipeline.id,
        pipelineName: pipeline.name,
        currency: base,
        since: since.toISOString(),
        stages: pipeline.stages.map((s) => {
          const here = open.filter((d) => d.stageId === s.id);
          const m = median.get(s.id);
          return {
            id: s.id, name: s.name, category: s.category, position: s.position, openDeals: here.length,
            openValue: Math.round(here.reduce((sum, d) => sum + (convert(d.amount.toNumber(), d.currency) ?? 0), 0) * 100) / 100,
            medianDays: m === undefined || m === null ? null : Math.round(m * 10) / 10,
          };
        }),
        transitions: transitions.filter((t) => t.from !== t.to),
      };
    });
  }

  replay(auth: AuthContext, pipelineId: string | undefined, days: number): Promise<PipelineReplay> {
    need(auth, 'deals:read', 'pipelines:read');
    return this.prisma.run(auth, async (tx) => {
      const { base, convert } = await this.money(tx, auth.tenantId);
      const pipeline = await this.pipeline(tx, auth.tenantId, pipelineId);
      const to = new Date();
      const from = new Date(to.getTime() - days * DAY);
      const openStages = pipeline.stages.filter((s) => s.category === 'OPEN').map((s) => s.id);
      // Deals in play during the window: moved inside it, or sitting in an open stage when it began.
      const ids = await tx.$queryRaw<{ id: string; last: Date }[]>`
        WITH before AS (
          SELECT DISTINCT ON (e.opportunity_id) e.opportunity_id, e.to_stage_id, e.occurred_at
          FROM deal_stage_events e WHERE e.tenant_id = ${auth.tenantId}::uuid AND e.pipeline_id = ${pipeline.id}::uuid AND e.occurred_at < ${from}
          ORDER BY e.opportunity_id, e.occurred_at DESC, e.id DESC
        ), inside AS (
          SELECT e.opportunity_id, max(e.occurred_at) AS last FROM deal_stage_events e
          WHERE e.tenant_id = ${auth.tenantId}::uuid AND e.pipeline_id = ${pipeline.id}::uuid AND e.occurred_at >= ${from}
          GROUP BY 1
        )
        SELECT o.id::text AS id, COALESCE(i.last, b.occurred_at) AS last
        FROM opportunities o LEFT JOIN inside i ON i.opportunity_id = o.id LEFT JOIN before b ON b.opportunity_id = o.id
        WHERE o.tenant_id = ${auth.tenantId}::uuid AND o.pipeline_id = ${pipeline.id}::uuid AND o.deleted_at IS NULL
          AND (i.opportunity_id IS NOT NULL OR b.to_stage_id = ANY(${openStages}::uuid[]))
        ORDER BY last DESC LIMIT ${REPLAY_MAX_DEALS + 1}`;
      const truncated = ids.length > REPLAY_MAX_DEALS;
      const dealIds = ids.slice(0, REPLAY_MAX_DEALS).map((r) => r.id);
      const [deals, events] = dealIds.length
        ? [
            await tx.opportunity.findMany({ where: { id: { in: dealIds } }, select: { id: true, name: true, amount: true, currency: true } }),
            await tx.dealStageEvent.findMany({
              where: { tenantId: auth.tenantId, opportunityId: { in: dealIds }, occurredAt: { lte: to } },
              orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
              select: { opportunityId: true, occurredAt: true, fromStageId: true, toStageId: true, reconstructed: true },
            }),
          ]
        : [[], []];
      // Only the last event before the window matters for where a deal starts; drop older ones.
      const lastBefore = new Map<string, number>();
      events.forEach((e, i) => {
        if (e.occurredAt < from) lastBefore.set(e.opportunityId, i);
      });
      const kept = events.filter((e, i) => e.occurredAt >= from || lastBefore.get(e.opportunityId) === i);
      return {
        pipelineId: pipeline.id,
        pipelineName: pipeline.name,
        stages: pipeline.stages.map((s) => ({ id: s.id, name: s.name, category: s.category, position: s.position })),
        deals: deals.map((d) => ({ id: d.id, name: d.name, value: convert(d.amount.toNumber(), d.currency) })),
        events: kept.map((e) => ({ dealId: e.opportunityId, at: e.occurredAt.toISOString(), fromStageId: e.fromStageId, toStageId: e.toStageId })),
        from: from.toISOString(),
        to: to.toISOString(),
        currency: base,
        reconstructed: kept.some((e) => e.reconstructed),
        truncated,
      };
    });
  }
}
