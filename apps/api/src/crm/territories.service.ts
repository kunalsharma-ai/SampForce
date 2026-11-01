import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma, type TenantTx } from '@dealflow/database';
import type { OwnerRef, TerritoryInput, TerritoryRow, TerritorySummary, TerritoryView } from '@dealflow/types';
import { AuditService } from '../audit/audit.service';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { assertRefs, badRef, notFound, ownerRefs } from './crm-helpers';
import { dealInclude, toDealRow } from './deals.service';

const territoryInclude = { countries: { select: { country: true }, orderBy: { country: 'asc' } } } satisfies Prisma.TerritoryInclude;
type TerritoryWith = Prisma.TerritoryGetPayload<{ include: typeof territoryInclude }>;

function toRow(t: TerritoryWith, people: Map<string, OwnerRef>): TerritoryRow {
  return {
    id: t.id,
    name: t.name,
    description: t.description,
    manager: t.managerId ? (people.get(t.managerId) ?? null) : null,
    countries: t.countries.map((c) => c.country),
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' });
const nameTaken = () => new ConflictException({ code: 'NAME_TAKEN', message: 'A territory with this name already exists.' });
const isUnique = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

/** Start of the current calendar quarter, UTC. */
export function quarterStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), Math.floor(now.getUTCMonth() / 3) * 3, 1));
}

/**
 * Sales territories (ADR 0049). A territory is a named set of countries; a deal belongs to the territory holding its
 * company's country, so moving a company or editing a territory re-sorts deals without touching them. The database
 * keeps a country in at most one territory per workspace.
 */
@Injectable()
export class TerritoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(auth: AuthContext): Promise<TerritoryRow[]> {
    return this.prisma.run(auth, async (tx) => {
      const rows = await tx.territory.findMany({ where: { tenantId: auth.tenantId }, include: territoryInclude });
      const people = await ownerRefs(tx, rows.map((r) => r.managerId));
      return rows.sort(byName).map((r) => toRow(r, people));
    });
  }

  create(auth: AuthContext, input: TerritoryInput, meta: RequestMeta): Promise<TerritoryRow> {
    return this.prisma
      .run(auth, async (tx) => {
        await assertRefs(tx, auth.tenantId, { ownerId: input.managerId }).catch(() => {
          throw managerError();
        });
        await this.assertCountriesFree(tx, auth.tenantId, input.countries, null);
        const row = await tx.territory.create({
          data: {
            tenantId: auth.tenantId,
            name: input.name,
            description: input.description ?? null,
            managerId: input.managerId ?? null,
            countries: { create: input.countries.map((country) => ({ tenantId: auth.tenantId, country })) },
          },
          include: territoryInclude,
        });
        await this.audit.record(tx, {
          tenantId: auth.tenantId, actorUserId: auth.userId, action: 'territory.created', entityType: 'territory', entityId: row.id,
          metadata: { name: row.name, countries: input.countries }, meta,
        });
        return toRow(row, await ownerRefs(tx, [row.managerId]));
      })
      .catch((e) => {
        throw isUnique(e) ? nameTaken() : e;
      });
  }

  update(auth: AuthContext, id: string, input: Partial<TerritoryInput>, meta: RequestMeta): Promise<TerritoryRow> {
    return this.prisma
      .run(auth, async (tx) => {
        const before = await tx.territory.findFirst({ where: { id, tenantId: auth.tenantId }, include: territoryInclude });
        if (!before) throw notFound('Territory');
        if (input.managerId) {
          await assertRefs(tx, auth.tenantId, { ownerId: input.managerId }).catch(() => {
            throw managerError();
          });
        }
        if (input.countries) {
          await this.assertCountriesFree(tx, auth.tenantId, input.countries, id);
          await tx.territoryCountry.deleteMany({ where: { tenantId: auth.tenantId, territoryId: id } });
          await tx.territoryCountry.createMany({ data: input.countries.map((country) => ({ tenantId: auth.tenantId, territoryId: id, country })) });
        }
        const row = await tx.territory.update({
          where: { id },
          data: {
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.description !== undefined ? { description: input.description } : {}),
            ...(input.managerId !== undefined ? { managerId: input.managerId } : {}),
          },
          include: territoryInclude,
        });
        const changes: Record<string, { from: unknown; to: unknown }> = {};
        if (before.name !== row.name) changes.name = { from: before.name, to: row.name };
        if (before.description !== row.description) changes.description = { from: before.description, to: row.description };
        if (before.managerId !== row.managerId) changes.managerId = { from: before.managerId, to: row.managerId };
        const was = before.countries.map((c) => c.country).join(',');
        const now = row.countries.map((c) => c.country).join(',');
        if (was !== now) changes.countries = { from: was ? was.split(',') : [], to: now ? now.split(',') : [] };
        if (Object.keys(changes).length) {
          await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'territory.updated', entityType: 'territory', entityId: id, metadata: { changes }, meta });
        }
        return toRow(row, await ownerRefs(tx, [row.managerId]));
      })
      .catch((e) => {
        throw isUnique(e) ? nameTaken() : e;
      });
  }

  remove(auth: AuthContext, id: string, meta: RequestMeta): Promise<void> {
    return this.prisma.run(auth, async (tx) => {
      const row = await tx.territory.findFirst({ where: { id, tenantId: auth.tenantId }, include: territoryInclude });
      if (!row) throw notFound('Territory');
      await tx.territory.delete({ where: { id } });
      await this.audit.record(tx, {
        tenantId: auth.tenantId, actorUserId: auth.userId, action: 'territory.deleted', entityType: 'territory', entityId: id,
        metadata: { name: row.name, countries: row.countries.map((c) => c.country) }, meta,
      });
    });
  }

  /**
   * The territory view: open pipeline per territory (count, value, weighted value, overdue, owners, largest deals)
   * and deals won and lost this quarter. Values add up deals in the workspace currency only; deals in other
   * currencies are counted separately rather than converted at a guessed rate.
   */
  view(auth: AuthContext, f: { pipelineId?: string; ownerId?: string }, now = new Date()): Promise<TerritoryView> {
    return this.prisma.run(auth, async (tx) => {
      const since = quarterStart(now);
      const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      const scope: Prisma.OpportunityWhereInput = {
        tenantId: auth.tenantId,
        deletedAt: null,
        ...(f.pipelineId ? { pipelineId: f.pipelineId } : {}),
        ...(f.ownerId ? { ownerId: f.ownerId } : {}),
      };
      const include = { ...dealInclude, company: { select: { id: true, name: true, country: true } } } satisfies Prisma.OpportunityInclude;
      const [territories, open, closed, tenant] = await Promise.all([
        tx.territory.findMany({ where: { tenantId: auth.tenantId }, include: territoryInclude }).then((r) => r.sort(byName)),
        tx.opportunity.findMany({ where: { ...scope, status: 'OPEN' }, include, orderBy: [{ amount: 'desc' }, { id: 'asc' }], take: 5000 }),
        tx.opportunity.findMany({
          where: { ...scope, status: { in: ['WON', 'LOST'] }, closedAt: { gte: since } },
          select: { status: true, amount: true, currency: true, company: { select: { country: true } } },
          take: 5000,
        }),
        tx.tenant.findUniqueOrThrow({ where: { id: auth.tenantId }, select: { defaultCurrency: true } }),
      ]);
      const people = await ownerRefs(tx, [...territories.map((t) => t.managerId), ...open.map((d) => d.ownerId)]);
      const byCountry = new Map<string, string>();
      for (const t of territories) for (const c of t.countries) byCountry.set(c.country, t.id);

      type Acc = TerritorySummary & { ownerCounts: Map<string, number> };
      const blank = (territory: TerritoryRow | null): Acc => ({
        territory, openCount: 0, openValue: 0, weightedValue: 0, otherCurrencyCount: 0, overdueCount: 0,
        wonCount: 0, wonValue: 0, lostCount: 0, owners: [], deals: [], ownerCounts: new Map(),
      });
      const acc = new Map<string | null, Acc>([...territories.map((t) => [t.id, blank(toRow(t, people))] as const), [null, blank(null)]]);
      const keyOf = (country: string | null | undefined) => (country ? (byCountry.get(country) ?? null) : null);
      let noCompany = 0;
      let noCountry = 0;
      const uncovered = new Map<string, number>();

      for (const d of open) {
        const country = d.company?.country ?? null;
        const key = keyOf(country);
        if (key === null) {
          if (!d.company) noCompany += 1;
          else if (!country) noCountry += 1;
          else uncovered.set(country, (uncovered.get(country) ?? 0) + 1);
        }
        const a = acc.get(key)!;
        const row = toDealRow(d, people);
        a.openCount += 1;
        if (row.currency === tenant.defaultCurrency) {
          a.openValue += row.amount;
          a.weightedValue += (row.amount * row.effectiveProbability) / 100;
        } else a.otherCurrencyCount += 1;
        if (d.expectedCloseDate && d.expectedCloseDate < today) a.overdueCount += 1;
        const ownerKey = d.ownerId ?? '';
        a.ownerCounts.set(ownerKey, (a.ownerCounts.get(ownerKey) ?? 0) + 1);
        // Rows arrive largest first, so the first ten are the largest (amounts compared as numbers across currencies).
        if (a.deals.length < 10) a.deals.push(row);
      }
      for (const d of closed) {
        const a = acc.get(keyOf(d.company?.country))!;
        if (d.status === 'WON') {
          a.wonCount += 1;
          if (d.currency === tenant.defaultCurrency) a.wonValue += d.amount.toNumber();
        } else a.lostCount += 1;
      }

      const round = (v: number) => Math.round(v * 100) / 100;
      const finish = ({ ownerCounts, ...a }: Acc): TerritorySummary => ({
        ...a,
        openValue: round(a.openValue),
        weightedValue: round(a.weightedValue),
        wonValue: round(a.wonValue),
        owners: [...ownerCounts.entries()]
          .map(([id, count]) => ({ owner: id ? (people.get(id) ?? null) : null, count }))
          .sort((x, y) => y.count - x.count || (x.owner?.name ?? '').localeCompare(y.owner?.name ?? '')),
      });
      return {
        currency: tenant.defaultCurrency,
        closedSince: since.toISOString().slice(0, 10),
        territories: territories.map((t) => finish(acc.get(t.id)!)),
        unassigned: {
          ...finish(acc.get(null)!),
          noCompany,
          noCountry,
          uncoveredCountries: [...uncovered.entries()].map(([country, count]) => ({ country, count })).sort((a, b) => b.count - a.count || a.country.localeCompare(b.country)),
        },
      };
    });
  }

  private async assertCountriesFree(tx: TenantTx, tenantId: string, countries: string[], territoryId: string | null) {
    if (countries.length === 0) return;
    const taken = await tx.territoryCountry.findMany({
      where: { tenantId, country: { in: countries }, ...(territoryId ? { territoryId: { not: territoryId } } : {}) },
      include: { territory: { select: { name: true } } },
      orderBy: { country: 'asc' },
    });
    if (taken.length) {
      throw new ConflictException({
        code: 'COUNTRY_TAKEN',
        message: `${taken.map((t) => t.country).join(', ')} already ${taken.length === 1 ? 'belongs' : 'belong'} to ${[...new Set(taken.map((t) => t.territory.name))].join(', ')}. A country can be in one territory only.`,
        details: taken.map((t) => ({ path: 'countries', message: `${t.country} is in ${t.territory.name}` })),
      });
    }
  }
}

const managerError = () => badRef('managerId', 'is not an active member of this workspace');
