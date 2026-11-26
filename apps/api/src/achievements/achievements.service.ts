import { Injectable, Logger, NotFoundException, type OnModuleInit } from '@nestjs/common';
import { beforeCommit, createManySkipDuplicates, type Prisma, type TenantTx } from '@dealflow/database';
import {
  ACHIEVEMENT_BADGES,
  ACHIEVEMENT_CATEGORY_OF,
  type AchievementCategory,
  type AchievementDetails,
  type AchievementKind,
  type AchievementLevel,
  type AchievementListQuery,
  type AchievementPage,
  type AchievementRow,
  type AchievementSettingsInput,
  type AchievementSettingsView,
  type AchievementStyle,
  type AchievementSummary,
} from '@dealflow/types';
import { AuditService, type AuditEntry } from '../audit/audit.service';
import { currentAutomationScope } from '../automation/automation-context';
import type { AuthContext } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { type Candidate, Detector } from './detector';

/** What a transaction told us, gathered until it is about to commit. */
type Signal =
  | { kind: 'audit'; entry: AuditEntry; actor: string }
  | { kind: 'rfq-delivered'; userId: string; transferId: string }
  | { kind: 'checked-out'; userId: string; sessionId: string };

/** Audit actions that can earn an achievement. Everything else is ignored at once. */
const WATCHED = new Set(['company.won', 'lead.converted', 'deal.stage_changed', 'deal.created', 'task.completed', 'company.created']);
/** A pop-up is offered only for this long after the achievement; later it waits in the history instead. */
const CELEBRATE_WITHIN_MS = 30 * 60_000;

type Stored = Prisma.AchievementGetPayload<object>;

function rowOf(a: Stored): AchievementRow {
  return {
    id: a.id,
    kind: a.kind as AchievementKind,
    category: a.category as AchievementCategory,
    level: a.level as AchievementLevel,
    details: (a.details ?? {}) as AchievementDetails,
    link: a.link,
    achievedAt: a.achievedAt.toISOString(),
    celebrate: a.celebrate,
    shownAt: a.shownAt?.toISOString() ?? null,
  };
}

/**
 * Achievements and celebrations (ADR 0090). Business actions are observed as they are audited, plus two confirmed
 * facts that have no audit entry of their own (SampBidx accepting an RFQ, a check-out). At the end of the same
 * transaction the detector decides what was earned; each achievement is stored once per person (a unique key), so
 * an edit, a refresh, a retry or a sync never records or celebrates it again.
 */
@Injectable()
export class AchievementsService implements OnModuleInit {
  private readonly log = new Logger(AchievementsService.name);
  private readonly pending = new WeakMap<TenantTx, { tenantId: string; signals: Signal[] }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  onModuleInit(): void {
    this.audit.observe((tx, entry) => {
      if (!WATCHED.has(entry.action) || !entry.actorUserId) return;
      // Changes made by automation or the system are not the person's own achievement.
      if (currentAutomationScope() || (entry.actorType && entry.actorType !== 'USER')) return;
      if (entry.action === 'deal.stage_changed' && entry.metadata?.status !== 'WON') return;
      this.queue(tx, entry.tenantId, { kind: 'audit', entry, actor: entry.actorUserId });
    });
  }

  /** SampBidx accepted an RFQ (call inside the transaction that marks the transfer SENT). */
  rfqDelivered(tx: TenantTx, tenantId: string, userId: string, transferId: string): void {
    this.queue(tx, tenantId, { kind: 'rfq-delivered', userId, transferId });
  }

  /** The person checked out (call inside the check-out transaction). */
  checkedOut(tx: TenantTx, tenantId: string, userId: string, sessionId: string): void {
    this.queue(tx, tenantId, { kind: 'checked-out', userId, sessionId });
  }

  private queue(tx: TenantTx, tenantId: string, signal: Signal): void {
    const existing = this.pending.get(tx);
    if (existing) {
      existing.signals.push(signal);
      return;
    }
    const batch = { tenantId, signals: [signal] };
    this.pending.set(tx, batch);
    const run = async (t: TenantTx) => {
      this.pending.delete(tx);
      await this.detect(t, batch.tenantId, batch.signals);
    };
    // Without a withDbContext transaction (never in the API) the batch runs at once.
    if (!beforeCommit(run)) void run(tx).catch((err: unknown) => this.log.warn({ err }, 'achievement detection failed'));
  }

  /** Works out and stores what the transaction earned. A failed check never fails the business change. */
  private async detect(tx: TenantTx, tenantId: string, signals: Signal[]): Promise<void> {
    let found: Candidate[] = [];
    try {
      found = await this.findCandidates(new Detector(tx, tenantId), signals);
    } catch (err) {
      this.log.warn({ err: err instanceof Error ? err.message : err, tenantId }, 'achievement detection failed');
      return;
    }
    if (!found.length) return;
    const seen = new Set<string>();
    const rows: Prisma.AchievementCreateManyInput[] = [];
    for (const c of found) {
      const key = `${c.userId}|${c.dedupeKey}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const s = await tx.achievementSettings.findUnique({ where: { tenantId_userId: { tenantId, userId: c.userId } } });
      const category = ACHIEVEMENT_CATEGORY_OF[c.kind];
      rows.push({
        tenantId, userId: c.userId, kind: c.kind, category, level: c.level, dedupeKey: c.dedupeKey,
        details: c.details as Prisma.InputJsonValue, entityType: c.entityType, entityId: c.entityId, link: c.link,
        celebrate: (s?.enabled ?? true) && !(s?.mutedCategories ?? []).includes(category),
      });
    }
    await createManySkipDuplicates(tx.achievement, 'Achievement', rows);
  }

  private async findCandidates(d: Detector, signals: Signal[]): Promise<Candidate[]> {
    const out: (Candidate | null)[] = [];
    const wonDeals = new Map<string, string>();
    const tasks = new Map<string, string>();
    const taskPeople = new Set<string>();
    const leadPeople = new Set<string>();
    for (const s of signals) {
      if (s.kind === 'rfq-delivered') out.push(await d.rfqSubmitted(s.userId, s.transferId));
      else if (s.kind === 'checked-out') out.push(await d.consistency(s.userId, s.sessionId));
      else {
        const { entry, actor } = s;
        const meta = (entry.metadata ?? {}) as Record<string, unknown>;
        switch (entry.action) {
          case 'company.won':
            out.push(await d.dealConverted(actor, entry.entityId!, meta.dealId as string | undefined));
            if (typeof meta.dealId === 'string') wonDeals.set(meta.dealId, actor);
            break;
          case 'lead.converted':
            out.push(await d.prospectConverted(actor, entry.entityId!, meta.opportunityId as string | undefined));
            break;
          case 'deal.stage_changed':
          case 'deal.created':
            if (entry.entityId) wonDeals.set(entry.entityId, actor);
            break;
          case 'task.completed':
            if (entry.entityId) tasks.set(entry.entityId, actor);
            taskPeople.add(actor);
            break;
          case 'company.created':
            leadPeople.add(actor);
            break;
        }
      }
    }
    for (const [taskId, actor] of tasks) out.push(await d.taskImportant(actor, taskId));
    for (const p of taskPeople) out.push(await d.allTasksDone(p));
    for (const p of leadPeople) out.push(...(await d.leadTargets(p)));
    for (const [dealId, actor] of wonDeals) out.push(...(await d.dealWon(dealId, actor)));
    return out.filter((c): c is Candidate => !!c);
  }

  // ─── Reading ───

  /**
   * Takes the person's achievements that still wait for their pop-up, marking them shown in the same step, so only
   * one browser tab gets each one and a refresh never plays it again. Achievements earned while celebrations (or
   * their category) are switched off are marked shown without a pop-up.
   */
  claim(auth: AuthContext): Promise<AchievementRow[]> {
    return this.prisma.run(auth, async (tx) => {
      const now = new Date();
      const waiting = await tx.achievement.findMany({
        where: { tenantId: auth.tenantId, userId: auth.userId, shownAt: null, achievedAt: { gte: new Date(now.getTime() - CELEBRATE_WITHIN_MS) } },
        orderBy: { achievedAt: 'asc' },
        take: 10,
      });
      if (!waiting.length) return [];
      const s = await tx.achievementSettings.findUnique({ where: { tenantId_userId: { tenantId: auth.tenantId, userId: auth.userId } } });
      const out: AchievementRow[] = [];
      for (const a of waiting) {
        const taken = await tx.achievement.updateMany({ where: { id: a.id, shownAt: null }, data: { shownAt: now } });
        if (taken.count !== 1) continue;
        const wanted = a.celebrate && (s?.enabled ?? true) && !(s?.mutedCategories ?? []).includes(a.category);
        if (wanted) out.push(rowOf({ ...a, shownAt: now }));
      }
      return out;
    });
  }

  list(auth: AuthContext, q: AchievementListQuery): Promise<AchievementPage> {
    return this.prisma.run(auth, async (tx) => {
      let cursor: { at: Date; id: string } | null = null;
      if (q.cursor) {
        const [at, id] = q.cursor.split('|');
        const date = new Date(at ?? '');
        if (id && !Number.isNaN(date.getTime())) cursor = { at: date, id };
      }
      const rows = await tx.achievement.findMany({
        where: {
          tenantId: auth.tenantId,
          userId: auth.userId,
          ...(q.category ? { category: q.category } : {}),
          ...(cursor ? { OR: [{ achievedAt: { lt: cursor.at } }, { achievedAt: cursor.at, id: { lt: cursor.id } }] } : {}),
        },
        orderBy: [{ achievedAt: 'desc' }, { id: 'desc' }],
        take: q.limit + 1,
      });
      const more = rows.length > q.limit;
      const items = rows.slice(0, q.limit).map(rowOf);
      const last = items[items.length - 1];
      return { items, nextCursor: more && last ? `${last.achievedAt}|${last.id}` : null };
    });
  }

  get(auth: AuthContext, id: string): Promise<AchievementRow> {
    return this.prisma.run(auth, async (tx) => {
      const a = await tx.achievement.findFirst({ where: { id, tenantId: auth.tenantId, userId: auth.userId } });
      if (!a) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Achievement not found.' });
      return rowOf(a);
    });
  }

  summary(auth: AuthContext): Promise<AchievementSummary> {
    return this.prisma.run(auth, async (tx) => {
      const d = new Detector(tx, auth.tenantId);
      const mine = { tenantId: auth.tenantId, userId: auth.userId };
      const all = await tx.achievement.findMany({ where: mine, select: { kind: true, details: true, achievedAt: true }, orderBy: { achievedAt: 'asc' }, take: 20_000 });
      const byKind = new Map<string, { n: number; dates: Date[] }>();
      let daily = 0;
      let weekly = 0;
      let monthly = 0;
      for (const a of all) {
        const k = byKind.get(a.kind) ?? { n: 0, dates: [] };
        k.n++;
        k.dates.push(a.achievedAt);
        byKind.set(a.kind, k);
        if (a.kind === 'LEAD_TARGET') {
          const p = (a.details as AchievementDetails).period;
          if (p === 'DAY') daily++;
          else if (p === 'WEEK') weekly++;
          else monthly++;
        }
      }
      const n = (k: AchievementKind) => byKind.get(k)?.n ?? 0;
      const tasksCompleted = await tx.task.count({ where: { tenantId: auth.tenantId, assigneeId: auth.userId, deletedAt: null, status: 'DONE' } });
      const [today, week, month] = await Promise.all([d.leadProgress(auth.userId, 'DAY'), d.leadProgress(auth.userId, 'WEEK'), d.leadProgress(auth.userId, 'MONTH')]);
      const strip = <T extends { key: string }>({ key: _key, ...rest }: T) => rest;
      const sales = (await d.salesProgress(auth.userId)).map(strip);
      const { currency } = await d.info();
      return {
        totals: {
          dealsConverted: n('DEAL_CONVERTED') + n('PROSPECT_CONVERTED'),
          rfqsSubmitted: n('RFQ_SUBMITTED'),
          dailyLeadTargets: daily,
          weeklyLeadTargets: weekly,
          monthlyLeadTargets: monthly,
          tasksCompleted,
          allTasksDays: n('ALL_TASKS_DONE'),
          salesTargets: n('SALES_TARGET'),
          milestones: n('DEALS_WON_MILESTONE') + n('MAJOR_DEAL'),
        },
        leads: { today: strip(today), week: strip(week), month: strip(month) },
        sales,
        badges: ACHIEVEMENT_BADGES.map((b) => {
          const k = byKind.get(b.kind);
          return { key: b.key, kind: b.kind, goal: b.goal, progress: Math.min(k?.n ?? 0, b.goal), earnedAt: k && k.n >= b.goal ? k.dates[b.goal - 1]!.toISOString() : null };
        }),
        currency,
      };
    });
  }

  // ─── Settings ───

  settings(auth: AuthContext): Promise<AchievementSettingsView> {
    return this.prisma.run(auth, (tx) => this.view(tx, auth));
  }

  saveSettings(auth: AuthContext, input: AchievementSettingsInput): Promise<AchievementSettingsView> {
    return this.prisma.run(auth, async (tx) => {
      const data = { ...input, ...(input.mutedCategories ? { mutedCategories: [...new Set(input.mutedCategories)] } : {}) };
      await tx.achievementSettings.upsert({
        where: { tenantId_userId: { tenantId: auth.tenantId, userId: auth.userId } },
        create: { tenantId: auth.tenantId, userId: auth.userId, mutedCategories: [], ...data },
        update: data,
      });
      return this.view(tx, auth);
    });
  }

  private async view(tx: TenantTx, auth: AuthContext): Promise<AchievementSettingsView> {
    const s = await tx.achievementSettings.findUnique({ where: { tenantId_userId: { tenantId: auth.tenantId, userId: auth.userId } } });
    const d = new Detector(tx, auth.tenantId);
    const [day, week, month] = await Promise.all([d.leadProgress(auth.userId, 'DAY'), d.leadProgress(auth.userId, 'WEEK'), d.leadProgress(auth.userId, 'MONTH')]);
    const revenue = (await d.salesProgress(auth.userId)).find((p) => p.targetSource === 'ASSIGNED' && p.metric === 'REVENUE' && p.period === 'MONTH');
    const assigned = (p: typeof day) => (p.targetSource === 'ASSIGNED' ? p.target : null);
    return {
      enabled: s?.enabled ?? true,
      style: (s?.style as AchievementStyle | undefined) ?? 'EXPRESSIVE',
      sound: s?.sound ?? false,
      reduceMotion: s?.reduceMotion ?? false,
      mutedCategories: (s?.mutedCategories ?? []) as AchievementCategory[],
      dailyLeadTarget: s?.dailyLeadTarget ?? null,
      weeklyLeadTarget: s?.weeklyLeadTarget ?? null,
      monthlyLeadTarget: s?.monthlyLeadTarget ?? null,
      monthlyRevenueTarget: s?.monthlyRevenueTarget ?? null,
      majorDealAmount: s?.majorDealAmount ?? null,
      currency: (await d.info()).currency,
      assigned: { dailyLeads: assigned(day), weeklyLeads: assigned(week), monthlyLeads: assigned(month), monthlyRevenue: revenue?.target ?? null },
    };
  }
}
