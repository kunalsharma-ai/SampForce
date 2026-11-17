import { BadRequestException, Injectable } from '@nestjs/common';
import type { Prisma, TenantTx } from '@dealflow/database';
import {
  attributionCredits,
  attributionRuleOf,
  type Credit,
  type CreditRole,
  type CreditSplitInput,
  normaliseCredits,
  type PersonRef,
  type RevenueRecordRow,
  type RevenueRecordUpdate,
  shareOf,
  toBase,
} from '@dealflow/types';
import { AuditService } from '../audit/audit.service';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { loadRates } from '../revenue/fx';
import { notFound } from './crm-helpers';
import { personRefs, visibility, type Visibility } from './visibility';

type RecordModel = Prisma.RevenueRecordGetPayload<object>;

interface Source {
  key: string;
  source: 'DEAL' | 'RFQ';
  opportunityId: string | null;
  rfqId: string | null;
  companyId: string | null;
  project: string;
  amount: number;
  currency: string;
  closedAt: Date;
  closerId: string | null;
  leadCreatorId: string | null;
  accountOwnerId: string | null;
  managerId: string | null;
  departmentId: string | null;
  supporters: string[];
}

/** Last full reconcile per workspace, so dashboards opened in a row do not repeat it. */
const lastFull = new Map<string, number>();
const FULL_EVERY_MS = 15_000;

/**
 * Revenue records and their credits (ADR 0063). The records follow the won deals and won RFQs: `reconcile` creates
 * a record for each new win, updates it when the deal changes, and voids it when the deal is reopened, lost or
 * deleted. Deal and RFQ writes reconcile their own record at once; dashboards reconcile the whole workspace (at most
 * every 15 seconds) so wins made by imports, automation or seed data are counted too.
 */
@Injectable()
export class RevenueRecordsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Brings the records of some deals and RFQs, or of the whole workspace, in line with what is won now. */
  async reconcile(tx: TenantTx, tenantId: string, only?: { opportunityIds?: string[]; rfqIds?: string[] }): Promise<void> {
    if (!only) {
      const at = lastFull.get(tenantId) ?? 0;
      if (Date.now() - at < FULL_EVERY_MS) return;
    }
    const dealFilter = only ? { id: { in: only.opportunityIds ?? [] } } : {};
    const rfqFilter = only ? { id: { in: only.rfqIds ?? [] } } : {};
    const [deals, rfqs] = await Promise.all([
      only && !only.opportunityIds?.length
        ? Promise.resolve([])
        : tx.opportunity.findMany({
            where: { tenantId, deletedAt: null, status: 'WON', ...dealFilter },
            select: { id: true, name: true, amount: true, currency: true, closedAt: true, updatedAt: true, ownerId: true, companyId: true, managerId: true, leadCreatorId: true, supportingUserIds: true },
          }),
      only && !only.rfqIds?.length
        ? Promise.resolve([])
        : tx.rfq.findMany({
            where: { tenantId, deletedAt: null, status: 'WON', ...rfqFilter },
            select: { id: true, number: true, projectName: true, actualRevenue: true, totalQuotation: true, currency: true, statusChangedAt: true, updatedAt: true, ownerId: true, companyId: true, managerId: true, opportunityId: true },
          }),
    ]);
    const companyIds = [...new Set([...deals.map((d) => d.companyId), ...rfqs.map((r) => r.companyId)].filter((c): c is string => !!c))];
    const companies = new Map(
      (companyIds.length ? await tx.company.findMany({ where: { tenantId, id: { in: companyIds } }, select: { id: true, createdById: true, ownerId: true, managerId: true, departmentId: true } }) : []).map((c) => [c.id, c]),
    );
    const wins: Source[] = [];
    for (const d of deals) {
      const c = d.companyId ? companies.get(d.companyId) : undefined;
      wins.push({
        key: `DEAL:${d.id}`, source: 'DEAL', opportunityId: d.id, rfqId: null, companyId: d.companyId, project: d.name, amount: Number(d.amount), currency: d.currency,
        closedAt: d.closedAt ?? d.updatedAt, closerId: d.ownerId, leadCreatorId: d.leadCreatorId ?? c?.createdById ?? null, accountOwnerId: c?.ownerId ?? null,
        managerId: d.managerId ?? c?.managerId ?? null, departmentId: c?.departmentId ?? null, supporters: d.supportingUserIds ?? [],
      });
    }
    for (const r of rfqs) {
      // A won RFQ that became a deal is the deal's revenue, never its own as well.
      if (r.opportunityId) continue;
      const amount = r.actualRevenue ?? r.totalQuotation;
      if (amount === null || amount === undefined) continue;
      const c = companies.get(r.companyId);
      wins.push({
        key: `RFQ:${r.id}`, source: 'RFQ', opportunityId: null, rfqId: r.id, companyId: r.companyId, project: `${r.number} ${r.projectName}`, amount: Number(amount), currency: r.currency,
        closedAt: r.statusChangedAt ?? r.updatedAt, closerId: r.ownerId, leadCreatorId: c?.createdById ?? null, accountOwnerId: c?.ownerId ?? null,
        managerId: r.managerId ?? c?.managerId ?? null, departmentId: c?.departmentId ?? null, supporters: [],
      });
    }

    const recordWhere: Prisma.RevenueRecordWhereInput = only
      ? { tenantId, voidedAt: null, OR: [{ opportunityId: { in: only.opportunityIds ?? [] } }, { rfqId: { in: [...(only.rfqIds ?? []), ...rfqs.filter((r) => r.opportunityId).map((r) => r.id)] } }] }
      : { tenantId, voidedAt: null };
    const active = await tx.revenueRecord.findMany({ where: recordWhere });
    const keyOf = (r: RecordModel) => (r.source === 'DEAL' ? `DEAL:${r.opportunityId}` : `RFQ:${r.rfqId}`);
    const byKey = new Map(active.map((r) => [keyOf(r), r]));
    const rule = attributionRuleOf((await tx.tenant.findUnique({ where: { id: tenantId }, select: { revenueAttribution: true } }))?.revenueAttribution);

    for (const w of wins) {
      const cur = byKey.get(w.key);
      byKey.delete(w.key);
      const data = {
        companyId: w.companyId, project: w.project.slice(0, 300), amount: w.amount, currency: w.currency, closedAt: w.closedAt, closerId: w.closerId,
        leadCreatorId: w.leadCreatorId, accountOwnerId: w.accountOwnerId, managerId: w.managerId, departmentId: w.departmentId,
      };
      const credits = attributionCredits(rule, { creatorId: w.leadCreatorId, ownerId: w.accountOwnerId, closerId: w.closerId, supporters: w.supporters });
      if (!cur) {
        const rec = await tx.revenueRecord.create({ data: { tenantId, source: w.source, opportunityId: w.opportunityId, rfqId: w.rfqId, ...data } });
        await this.writeCredits(tx, tenantId, rec.id, w.closedAt, credits);
        continue;
      }
      const changed = (Object.keys(data) as (keyof typeof data)[]).some((k) => {
        const a = data[k];
        const b = cur[k];
        return a instanceof Date ? a.getTime() !== (b as Date).getTime() : (a ?? null) !== (b ?? null);
      });
      if (!changed && !(await this.creditsDiffer(tx, tenantId, cur, credits))) continue;
      await tx.revenueRecord.update({ where: { id: cur.id }, data });
      if (!cur.manual) await this.writeCredits(tx, tenantId, cur.id, w.closedAt, credits);
      else await tx.revenueCredit.updateMany({ where: { tenantId, recordId: cur.id }, data: { closedAt: w.closedAt } });
    }
    // Whatever is left is no longer won (reopened, lost, deleted, or an RFQ that became a deal).
    for (const gone of byKey.values()) {
      await tx.revenueRecord.update({ where: { id: gone.id }, data: { voidedAt: new Date() } });
      await tx.revenueCredit.updateMany({ where: { tenantId, recordId: gone.id }, data: { voided: true } });
    }
    if (!only) lastFull.set(tenantId, Date.now());
  }

  /** Forgets when the workspace was last reconciled, so the next dashboard read reconciles it (tests, rule changes). */
  static invalidate(tenantId: string): void {
    lastFull.delete(tenantId);
  }

  private async creditsDiffer(tx: TenantTx, tenantId: string, rec: RecordModel, next: Credit[]): Promise<boolean> {
    if (rec.manual) return false;
    const cur = await tx.revenueCredit.findMany({ where: { tenantId, recordId: rec.id }, select: { userId: true, percent: true } });
    const key = (l: { userId: string | null; percent: number }[]) => l.map((c) => `${c.userId ?? ''}:${c.percent}`).sort().join('|');
    return key(cur) !== key(next);
  }

  private async writeCredits(tx: TenantTx, tenantId: string, recordId: string, closedAt: Date, credits: Credit[]): Promise<void> {
    await tx.revenueCredit.deleteMany({ where: { tenantId, recordId } });
    for (const c of credits) await tx.revenueCredit.create({ data: { tenantId, recordId, userId: c.userId, roles: c.roles, percent: c.percent, closedAt } });
  }

  // ─── API ───

  /** Records closed in a range that the caller can see: their own credits, their team's, or all (record scope). */
  list(auth: AuthContext, q: { from?: string; to?: string; userId?: string }): Promise<RevenueRecordRow[]> {
    return this.prisma.run(auth, async (tx) => {
      await this.reconcile(tx, auth.tenantId);
      const v = await visibility(tx, auth);
      const range = { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lt: new Date(q.to) } : {}) };
      let ids: string[] | null = null;
      if (!v.all || q.userId) {
        const people = q.userId ? (v.all || v.userIds.includes(q.userId) ? [q.userId] : []) : v.userIds;
        const credits = await tx.revenueCredit.findMany({ where: { tenantId: auth.tenantId, voided: false, userId: { in: people }, ...(q.from || q.to ? { closedAt: range } : {}) }, select: { recordId: true } });
        ids = [...new Set(credits.map((c) => c.recordId))];
      }
      const rows = await tx.revenueRecord.findMany({
        where: { tenantId: auth.tenantId, voidedAt: null, ...(ids ? { id: { in: ids } } : {}), ...(q.from || q.to ? { closedAt: range } : {}) },
        orderBy: { closedAt: 'desc' },
        take: 500,
      });
      return this.rows(tx, auth.tenantId, rows, v);
    });
  }

  get(auth: AuthContext, id: string): Promise<RevenueRecordRow> {
    return this.prisma.run(auth, async (tx) => {
      const v = await visibility(tx, auth);
      const rec = await this.visible(tx, auth, v, id);
      return (await this.rows(tx, auth.tenantId, [rec], v))[0]!;
    });
  }

  /** Recognised and collected amounts, and the payment status, of one record. */
  update(auth: AuthContext, id: string, input: RevenueRecordUpdate, meta: RequestMeta): Promise<RevenueRecordRow> {
    return this.prisma.run(auth, async (tx) => {
      const v = await visibility(tx, auth);
      const rec = await this.visible(tx, auth, v, id);
      for (const k of ['recognisedAmount', 'collectedAmount'] as const) {
        const n = input[k];
        if (n !== undefined && n !== null && n > rec.amount + 0.005) {
          throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'This is more than the won value.', details: [{ path: k, message: 'more than the won value' }] });
        }
      }
      const row = await tx.revenueRecord.update({ where: { id }, data: input });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'revenue_record.updated', entityType: 'revenue_record', entityId: id, metadata: { ...input }, meta });
      return (await this.rows(tx, auth.tenantId, [row], v))[0]!;
    });
  }

  /** Replaces the split of one record by hand; a later rule change leaves it alone. */
  setCredits(auth: AuthContext, id: string, input: CreditSplitInput, meta: RequestMeta): Promise<RevenueRecordRow> {
    return this.prisma.run(auth, async (tx) => {
      const v = await visibility(tx, auth);
      const rec = await this.visible(tx, auth, v, id);
      const members = await tx.membership.findMany({ where: { tenantId: auth.tenantId, userId: { in: input.credits.map((c) => c.userId) } }, select: { userId: true } });
      const known = new Set(members.map((m) => m.userId));
      const missing = input.credits.findIndex((c) => !known.has(c.userId));
      if (missing >= 0) throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Choose people from this workspace.', details: [{ path: `credits.${missing}.userId`, message: 'not a member' }] });
      const before = await tx.revenueCredit.findMany({ where: { tenantId: auth.tenantId, recordId: id }, select: { userId: true, percent: true } });
      await this.writeCredits(tx, auth.tenantId, id, rec.closedAt, normaliseCredits(input.credits.map((c) => ({ userId: c.userId, roles: ['MANUAL'], percent: c.percent }))));
      const row = await tx.revenueRecord.update({ where: { id }, data: { manual: true } });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'revenue_record.credits_set', entityType: 'revenue_record', entityId: id, metadata: { from: before, to: input.credits }, meta });
      return (await this.rows(tx, auth.tenantId, [row], v))[0]!;
    });
  }

  /** Splits every record not split by hand again with the current rule (after the rule changes), or one record back to the rule. */
  recalculate(auth: AuthContext, meta: RequestMeta, recordId?: string): Promise<{ updated: number }> {
    return this.prisma.run(auth, async (tx) => {
      if (recordId) {
        const v = await visibility(tx, auth);
        await this.visible(tx, auth, v, recordId);
        await tx.revenueRecord.update({ where: { id: recordId }, data: { manual: false } });
      }
      RevenueRecordsService.invalidate(auth.tenantId);
      const before = await tx.revenueRecord.count({ where: { tenantId: auth.tenantId, voidedAt: null, manual: false } });
      // A full reconcile rewrites every credit that differs from the rule.
      await this.reconcile(tx, auth.tenantId);
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'revenue_record.recalculated', entityType: 'revenue_record', ...(recordId ? { entityId: recordId } : {}), meta });
      return { updated: before };
    });
  }

  private async visible(tx: TenantTx, auth: AuthContext, v: Visibility, id: string): Promise<RecordModel> {
    const rec = await tx.revenueRecord.findFirst({ where: { id, tenantId: auth.tenantId, voidedAt: null } });
    if (!rec) throw notFound('Revenue record');
    if (v.all) return rec;
    const mine = await tx.revenueCredit.count({ where: { tenantId: auth.tenantId, recordId: id, userId: { in: v.userIds } } });
    if (!mine && !(rec.closerId && v.userIds.includes(rec.closerId))) throw notFound('Revenue record');
    return rec;
  }

  /** Rows with people, credits and the value in the workspace currency. `viewer` decides whose share is the row's percent. */
  async rows(tx: TenantTx, tenantId: string, recs: RecordModel[], v: Visibility | null, viewer?: string[]): Promise<RevenueRecordRow[]> {
    if (!recs.length) return [];
    const [credits, tenant, rates, companies] = await Promise.all([
      tx.revenueCredit.findMany({ where: { tenantId, recordId: { in: recs.map((r) => r.id) } } }),
      tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { defaultCurrency: true } }),
      loadRates(tx, tenantId),
      tx.company.findMany({ where: { tenantId, id: { in: recs.map((r) => r.companyId).filter((c): c is string => !!c) } }, select: { id: true, name: true, leadNumber: true } }),
    ]);
    const people = await personRefs(tx, tenantId, [...recs.flatMap((r) => [r.closerId, r.leadCreatorId, r.managerId]), ...credits.map((c) => c.userId)]);
    const ref = (id: string | null): PersonRef | null => (id ? (people.get(id) ?? null) : null);
    const companyById = new Map(companies.map((c) => [c.id, c]));
    const base = tenant.defaultCurrency;
    const mine = new Set(viewer ?? (v && !v.all ? v.userIds : []));
    return recs.map((r) => {
      const own = credits.filter((c) => c.recordId === r.id);
      const baseValue = toBase(r.amount, r.currency, base, rates);
      const held = mine.size ? own.filter((c) => c.userId && mine.has(c.userId)) : own;
      const percent = Math.round(held.reduce((a, c) => a + c.percent, 0) * 100) / 100;
      const roles = [...new Set(held.flatMap((c) => c.roles as CreditRole[]))];
      return {
        recordId: r.id,
        source: r.source as 'DEAL' | 'RFQ',
        company: r.companyId ? (companyById.get(r.companyId) ?? null) : null,
        project: r.project,
        dealId: r.opportunityId,
        rfqId: r.rfqId,
        value: r.amount,
        currency: r.currency,
        baseValue,
        closedAt: r.closedAt.toISOString(),
        closer: ref(r.closerId),
        leadCreator: ref(r.leadCreatorId),
        manager: ref(r.managerId),
        roles,
        percent,
        contribution: baseValue === null ? null : shareOf(baseValue, percent),
        recognised: r.recognisedAmount,
        collected: r.collectedAmount,
        credits: own
          .sort((a, b) => b.percent - a.percent)
          .map((c) => ({ user: ref(c.userId), roles: c.roles as CreditRole[], percent: c.percent, amount: shareOf(r.amount, c.percent) })),
        manual: r.manual,
        paymentStatus: r.paymentStatus,
      };
    });
  }
}
