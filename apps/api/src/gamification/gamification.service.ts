import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { Prisma, type TenantTx } from '@dealflow/database';
import {
  type AwardRow,
  type BadgeInput,
  type BadgeMetric,
  type BadgeRow,
  type BadgeWindow,
  type CompetitionInput,
  type CompetitionMetric,
  type CompetitionRow,
  type CompetitionStanding,
  DEFAULT_BADGES,
  DEFAULT_SCORING_RULES,
  forecastPeriod,
  type GamificationMe,
  type GamificationSettings,
  type GamificationSettingsInput,
  type Leaderboard,
  type PersonScore,
  periodLabelOf,
  pointsFor,
  revenuePoints,
  type ScoreBreakdownItem,
  SCORING_RULE_KEYS,
  type ScoringRuleKey,
  type ScoringRules,
  scoringRulesSchema,
  type TeamScore,
  toBase,
} from '@dealflow/types';
import { AuditService } from '../audit/audit.service';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { badRef, notFound } from '../crm/crm-helpers';
import { NotificationsService } from '../notifications/notifications.service';
import { loadRates } from '../revenue/fx';
import { scanTenants, errorMessage } from '../worker/queue';

const DAY = 86_400_000;
const HOUR = 3_600_000;
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const r2 = (n: number) => Math.round(n * 100) / 100;
const r1 = (n: number) => Math.round(n * 10) / 10;
const utc = (day: string) => new Date(`${day}T00:00:00Z`);

/** What one person did in a window: per rule, the count on each UTC day; plus won revenue in the base currency. */
interface PersonStats {
  days: Map<ScoringRuleKey, Map<string, number>>;
  revenue: number;
  dealsWon: number;
}

interface Window {
  start: Date;
  /** Exclusive. */
  end: Date;
}

interface Scored {
  base: string;
  missingRates: number;
  stats: Map<string, PersonStats>;
}

const ACTIVITY_RULE: Record<string, ScoringRuleKey> = { CALL: 'call_logged', MEETING: 'meeting_logged', EMAIL: 'email_logged', NOTE: 'note_logged' };

function emptyStats(): PersonStats {
  return { days: new Map(), revenue: 0, dealsWon: 0 };
}

function count(s: PersonStats | undefined, key: ScoringRuleKey): number {
  let n = 0;
  for (const v of s?.days.get(key)?.values() ?? []) n += v;
  return n;
}

/** Points and the per-rule breakdown for one person under a rule set. */
export function scorePerson(rules: ScoringRules, s: PersonStats | undefined): { points: number; breakdown: ScoreBreakdownItem[]; activities: number } {
  const breakdown: ScoreBreakdownItem[] = [];
  let points = 0;
  for (const key of SCORING_RULE_KEYS) {
    if (key === 'revenue_won') {
      const thousands = Math.floor(Math.max(0, s?.revenue ?? 0) / 1000);
      const p = revenuePoints(rules, s?.revenue ?? 0);
      breakdown.push({ key, count: thousands, scored: rules.revenue_won.enabled ? thousands : 0, points: p });
      points += p;
      continue;
    }
    const r = pointsFor(rules, key, [...(s?.days.get(key)?.values() ?? [])]);
    breakdown.push({ key, ...r });
    points += r.points;
  }
  return { points, breakdown, activities: count(s, 'call_logged') + count(s, 'meeting_logged') + count(s, 'email_logged') };
}

/** Standard competition ranking: equal values share a rank, the next rank skips. */
function rank<T>(rows: T[], value: (r: T) => number, name: (r: T) => string): (T & { rank: number })[] {
  const sorted = [...rows].sort((a, b) => value(b) - value(a) || name(a).localeCompare(name(b)));
  let last = Number.NaN;
  let lastRank = 0;
  return sorted.map((r, i) => {
    const v = value(r);
    if (v !== last) lastRank = i + 1;
    last = v;
    return { ...r, rank: lastRank };
  });
}

function windowOf(label: string): Window & { label: string; granularity: 'month' | 'quarter' | 'year' } {
  const p = forecastPeriod(label);
  return { start: utc(p.start), end: utc(p.end), label: p.label, granularity: p.granularity };
}

function badgeWindow(window: BadgeWindow, at: Date): (Window & { label: string }) | null {
  if (window === 'all_time') return { start: new Date(0), end: new Date(at.getTime() + DAY), label: 'all' };
  return windowOf(periodLabelOf(at, window));
}

/**
 * Sales gamification (enhancement feature 14). Points are worked out from CRM records when asked for, under the
 * workspace's rules, so they always match the records and an admin's rule change applies everywhere at once.
 * Competitions use the copy of the rules taken when they were created. Badges are checked by the worker and on
 * demand, and stored as awards so a later rule change never takes one away.
 */
@Injectable()
export class GamificationService {
  private readonly log = new Logger(GamificationService.name);
  private lastSweep = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  // ───────────── settings ─────────────

  private async loadSettings(tx: TenantTx, tenantId: string) {
    const row = await tx.gamificationSettings.findUnique({ where: { tenantId } });
    const parsed = row ? scoringRulesSchema.safeParse({ ...DEFAULT_SCORING_RULES, ...(row.rules as object) }) : null;
    return {
      enabled: row?.enabled ?? false,
      visibility: (row?.visibility ?? 'everyone') as 'everyone' | 'managers',
      rules: parsed?.success ? parsed.data : DEFAULT_SCORING_RULES,
      updatedAt: row?.updatedAt ?? null,
      updatedById: row?.updatedById ?? null,
    };
  }

  private async baseCurrency(tx: TenantTx, tenantId: string): Promise<string> {
    return (await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { defaultCurrency: true } })).defaultCurrency;
  }

  settings(auth: AuthContext): Promise<GamificationSettings> {
    return this.prisma.run(auth, async (tx) => {
      const s = await this.loadSettings(tx, auth.tenantId);
      const by = s.updatedById ? await tx.user.findUnique({ where: { id: s.updatedById }, select: { id: true, name: true } }) : null;
      return { enabled: s.enabled, visibility: s.visibility, rules: s.rules, baseCurrency: await this.baseCurrency(tx, auth.tenantId), updatedAt: s.updatedAt?.toISOString() ?? null, updatedBy: by };
    });
  }

  async saveSettings(auth: AuthContext, input: GamificationSettingsInput, meta: RequestMeta): Promise<GamificationSettings> {
    await this.prisma.run(auth, async (tx) => {
      const before = await this.loadSettings(tx, auth.tenantId);
      const data = { enabled: input.enabled, visibility: input.visibility, rules: input.rules as unknown as Prisma.InputJsonValue, updatedById: auth.userId, updatedAt: new Date() };
      await tx.gamificationSettings.upsert({ where: { tenantId: auth.tenantId }, create: { tenantId: auth.tenantId, ...data }, update: data });
      const changedRules = SCORING_RULE_KEYS.filter((k) => JSON.stringify(before.rules[k]) !== JSON.stringify(input.rules[k]));
      await this.audit.record(tx, {
        tenantId: auth.tenantId,
        actorUserId: auth.userId,
        action: 'gamification.settings_updated',
        entityType: 'gamification',
        entityId: auth.tenantId,
        metadata: {
          ...(before.enabled !== input.enabled ? { enabled: { from: before.enabled, to: input.enabled } } : {}),
          ...(before.visibility !== input.visibility ? { visibility: { from: before.visibility, to: input.visibility } } : {}),
          ...(changedRules.length ? { rules: Object.fromEntries(changedRules.map((k) => [k, { from: before.rules[k], to: input.rules[k] }])) } : {}),
        },
        meta,
      });
    });
    return this.settings(auth);
  }

  // ───────────── the points engine ─────────────

  /** Counts every scoring event per person per UTC day in the window, straight from CRM records. */
  private async score(tx: TenantTx, tenantId: string, w: Window): Promise<Scored> {
    const rows = await tx.$queryRaw<{ user_id: string; kind: string; day: Date; n: number }[]>(Prisma.sql`
      SELECT owner_id AS user_id, type::text AS kind, (occurred_at AT TIME ZONE 'UTC')::date AS day, count(*)::int AS n
        FROM activities WHERE tenant_id = ${tenantId}::uuid AND deleted_at IS NULL AND owner_id IS NOT NULL AND occurred_at >= ${w.start} AND occurred_at < ${w.end} GROUP BY 1, 2, 3
      UNION ALL
      SELECT assignee_id, 'task_completed', (completed_at AT TIME ZONE 'UTC')::date, count(*)::int
        FROM tasks WHERE tenant_id = ${tenantId}::uuid AND deleted_at IS NULL AND assignee_id IS NOT NULL AND completed_at >= ${w.start} AND completed_at < ${w.end} GROUP BY 1, 3
      UNION ALL
      SELECT owner_id, 'lead_created', (created_at AT TIME ZONE 'UTC')::date, count(*)::int
        FROM leads WHERE tenant_id = ${tenantId}::uuid AND deleted_at IS NULL AND owner_id IS NOT NULL AND created_at >= ${w.start} AND created_at < ${w.end} GROUP BY 1, 3
      UNION ALL
      SELECT owner_id, 'lead_converted', (converted_at AT TIME ZONE 'UTC')::date, count(*)::int
        FROM leads WHERE tenant_id = ${tenantId}::uuid AND owner_id IS NOT NULL AND converted_at >= ${w.start} AND converted_at < ${w.end} GROUP BY 1, 3
      UNION ALL
      SELECT owner_id, 'deal_created', (created_at AT TIME ZONE 'UTC')::date, count(*)::int
        FROM opportunities WHERE tenant_id = ${tenantId}::uuid AND deleted_at IS NULL AND owner_id IS NOT NULL AND created_at >= ${w.start} AND created_at < ${w.end} GROUP BY 1, 3`);
    const won = await tx.opportunity.findMany({
      where: { tenantId, deletedAt: null, status: 'WON', ownerId: { not: null }, closedAt: { gte: w.start, lt: w.end } },
      select: { ownerId: true, amount: true, currency: true, closedAt: true },
    });
    const base = await this.baseCurrency(tx, tenantId);
    const rates = won.some((d) => d.currency !== base) ? await loadRates(tx, tenantId) : new Map<string, number>();

    const stats = new Map<string, PersonStats>();
    const of = (id: string) => {
      if (!stats.has(id)) stats.set(id, emptyStats());
      return stats.get(id)!;
    };
    const add = (s: PersonStats, key: ScoringRuleKey, day: string, n: number) => {
      if (!s.days.has(key)) s.days.set(key, new Map());
      const m = s.days.get(key)!;
      m.set(day, (m.get(day) ?? 0) + n);
    };
    for (const r of rows) {
      const key = (ACTIVITY_RULE[r.kind] ?? r.kind) as ScoringRuleKey;
      add(of(r.user_id), key, ymd(r.day), r.n);
    }
    let missingRates = 0;
    for (const d of won) {
      const s = of(d.ownerId!);
      add(s, 'deal_won', ymd(d.closedAt!), 1);
      s.dealsWon++;
      const v = toBase(Number(d.amount), d.currency, base, rates);
      if (v === null) missingRates++;
      else s.revenue += v;
    }
    return { base, missingRates, stats };
  }

  /** Active members of the workspace, and the teams they belong to. */
  private async people(tx: TenantTx, tenantId: string) {
    const members = await tx.membership.findMany({ where: { tenantId, status: 'ACTIVE' }, select: { userId: true, user: { select: { id: true, name: true } }, teamMembers: { select: { teamId: true } } } });
    const teams = await tx.team.findMany({ where: { tenantId }, select: { id: true, name: true }, orderBy: { name: 'asc' } });
    const teamUsers = new Map(teams.map((t) => [t.id, new Set<string>()]));
    for (const m of members) for (const tm of m.teamMembers) teamUsers.get(tm.teamId)?.add(m.userId);
    return { members: members.map((m) => m.user), teams, teamUsers };
  }

  private canSeeAll(auth: AuthContext, visibility: 'everyone' | 'managers'): boolean {
    return visibility === 'everyone' || auth.permissions.includes('gamification:manage');
  }

  private off(): ConflictException {
    return new ConflictException({ code: 'GAMIFICATION_OFF', message: 'Gamification is turned off for this workspace. An admin can turn it on in Gamification settings.' });
  }

  private async buildLeaderboard(tx: TenantTx, tenantId: string, label: string, rules: ScoringRules): Promise<Omit<Leaderboard, 'full'>> {
    const w = windowOf(label);
    const [scored, { members, teams, teamUsers }, targets, badgeCounts] = await Promise.all([
      this.score(tx, tenantId, w),
      this.people(tx, tenantId),
      tx.salesTarget.findMany({ where: { tenantId, period: w.label, userId: { not: null } }, select: { userId: true, amount: true } }),
      tx.gamificationAward.groupBy({ by: ['userId'], where: { tenantId }, _count: { _all: true } }),
    ]);
    const target = new Map(targets.map((t) => [t.userId!, Number(t.amount)]));
    const badges = new Map(badgeCounts.map((b) => [b.userId, b._count._all]));
    const scores = members.map((u) => {
      const s = scored.stats.get(u.id);
      const { points, breakdown, activities } = scorePerson(rules, s);
      const t = target.get(u.id) ?? null;
      const revenueWon = r2(s?.revenue ?? 0);
      return { user: u, points, breakdown, dealsWon: s?.dealsWon ?? 0, revenueWon, activities, target: t, attainment: t ? r1((revenueWon / t) * 100) : null, badges: badges.get(u.id) ?? 0 };
    });
    const people: PersonScore[] = rank(scores, (p) => p.points, (p) => p.user.name);
    const byUser = new Map(people.map((p) => [p.user.id, p]));
    const teamRows = teams
      .filter((t) => (teamUsers.get(t.id)?.size ?? 0) > 0)
      .map((t) => {
        const ps = [...teamUsers.get(t.id)!].map((id) => byUser.get(id)).filter((p): p is PersonScore => !!p);
        const points = ps.reduce((a, p) => a + p.points, 0);
        return { team: t, points, members: ps.length, perMember: r1(points / Math.max(1, ps.length)), dealsWon: ps.reduce((a, p) => a + p.dealsWon, 0), revenueWon: r2(ps.reduce((a, p) => a + p.revenueWon, 0)), activities: ps.reduce((a, p) => a + p.activities, 0) };
      });
    const teamScores: TeamScore[] = rank(teamRows, (t) => t.points, (t) => t.team.name);
    return { period: { label: w.label, start: ymd(w.start), end: ymd(w.end), granularity: w.granularity }, currency: scored.base, missingRates: scored.missingRates, people, teams: teamScores };
  }

  leaderboard(auth: AuthContext, period: string | undefined): Promise<Leaderboard> {
    return this.prisma.run(auth, async (tx) => {
      const s = await this.loadSettings(tx, auth.tenantId);
      if (!s.enabled) throw this.off();
      const board = await this.buildLeaderboard(tx, auth.tenantId, period ?? periodLabelOf(new Date(), 'month'), s.rules);
      if (this.canSeeAll(auth, s.visibility)) return { ...board, full: true };
      return { ...board, full: false, people: board.people.filter((p) => p.user.id === auth.userId), teams: [] };
    });
  }

  /** Your own dashboard: this month's score, personal target progress, badges and competitions you are in. */
  me(auth: AuthContext): Promise<GamificationMe> {
    return this.prisma.run(auth, async (tx) => {
      const s = await this.loadSettings(tx, auth.tenantId);
      const user = await tx.user.findUniqueOrThrow({ where: { id: auth.userId }, select: { id: true, name: true } });
      const now = new Date();
      const month = windowOf(periodLabelOf(now, 'month'));
      const canManage = auth.permissions.includes('gamification:manage');
      const period = { label: month.label, start: ymd(month.start), end: ymd(month.end), granularity: month.granularity };
      if (!s.enabled) return { enabled: false, canManage, user, period, currency: await this.baseCurrency(tx, auth.tenantId), score: null, targets: [], badges: [], competitions: [] };
      const board = await this.buildLeaderboard(tx, auth.tenantId, month.label, s.rules);
      const targets = [];
      for (const g of ['month', 'quarter', 'year'] as const) {
        const w = windowOf(periodLabelOf(now, g));
        const t = await tx.salesTarget.findFirst({ where: { tenantId: auth.tenantId, period: w.label, userId: auth.userId }, select: { amount: true } });
        const won = r2((await this.score(tx, auth.tenantId, w)).stats.get(auth.userId)?.revenue ?? 0);
        const target = Number(t?.amount) ?? null;
        targets.push({ period: w.label, granularity: g, target, won, attainment: target ? r1((won / target) * 100) : null });
      }
      const awards = await this.awardRows(tx, { tenantId: auth.tenantId, userId: auth.userId }, 50);
      const competitions = (await this.competitionRows(tx, auth, s.visibility)).filter((c) => (c.status === 'running' || c.status === 'upcoming') && (c.mine !== null || c.status === 'upcoming'));
      return { enabled: true, canManage, user, period, currency: board.currency, score: board.people.find((p) => p.user.id === auth.userId) ?? null, targets, badges: awards, competitions };
    });
  }

  // ───────────── badges ─────────────

  badges(auth: AuthContext): Promise<BadgeRow[]> {
    return this.prisma.run(auth, async (tx) => {
      const rows = await tx.gamificationBadge.findMany({ where: { tenantId: auth.tenantId }, orderBy: [{ active: 'desc' }, { name: 'asc' }], include: { _count: { select: { awards: true } } } });
      return rows.map(toBadgeRow);
    });
  }

  async createBadge(auth: AuthContext, input: BadgeInput, meta: RequestMeta): Promise<BadgeRow> {
    return this.prisma.run(auth, async (tx) => {
      if (await tx.gamificationBadge.findFirst({ where: { tenantId: auth.tenantId, name: input.name } })) throw new ConflictException({ code: 'DUPLICATE', message: `There is already a badge called "${input.name}".` });
      const row = await tx.gamificationBadge.create({ data: { tenantId: auth.tenantId, ...badgeData(input) }, include: { _count: { select: { awards: true } } } });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'gamification.badge_created', entityType: 'gamification_badge', entityId: row.id, metadata: { ...input }, meta });
      return toBadgeRow(row);
    });
  }

  async updateBadge(auth: AuthContext, id: string, input: BadgeInput, meta: RequestMeta): Promise<BadgeRow> {
    return this.prisma.run(auth, async (tx) => {
      const before = await tx.gamificationBadge.findFirst({ where: { id, tenantId: auth.tenantId } });
      if (!before) throw notFound('Badge');
      if (await tx.gamificationBadge.findFirst({ where: { tenantId: auth.tenantId, name: input.name, id: { not: id } } })) throw new ConflictException({ code: 'DUPLICATE', message: `There is already a badge called "${input.name}".` });
      const row = await tx.gamificationBadge.update({ where: { id }, data: badgeData(input), include: { _count: { select: { awards: true } } } });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'gamification.badge_updated', entityType: 'gamification_badge', entityId: id, metadata: { ...input }, meta });
      return toBadgeRow(row);
    });
  }

  async removeBadge(auth: AuthContext, id: string, meta: RequestMeta): Promise<void> {
    await this.prisma.run(auth, async (tx) => {
      const row = await tx.gamificationBadge.findFirst({ where: { id, tenantId: auth.tenantId } });
      if (!row) throw notFound('Badge');
      await tx.gamificationBadge.delete({ where: { id } });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'gamification.badge_deleted', entityType: 'gamification_badge', entityId: id, metadata: { name: row.name }, meta });
    });
  }

  /** Adds the suggested badges that are not there yet (matched by name). */
  async addDefaultBadges(auth: AuthContext, meta: RequestMeta): Promise<BadgeRow[]> {
    await this.prisma.run(auth, async (tx) => {
      const existing = new Set((await tx.gamificationBadge.findMany({ where: { tenantId: auth.tenantId }, select: { name: true } })).map((b) => b.name));
      const add = DEFAULT_BADGES.filter((b) => !existing.has(b.name));
      if (add.length) await tx.gamificationBadge.createMany({ data: add.map((b) => ({ tenantId: auth.tenantId, ...badgeData(b) })) });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'gamification.default_badges_added', entityType: 'gamification', entityId: auth.tenantId, metadata: { added: add.map((b) => b.name) }, meta });
    });
    return this.badges(auth);
  }

  /** Recent awards. When leaderboards are for managers only, other people see just their own. */
  awards(auth: AuthContext): Promise<AwardRow[]> {
    return this.prisma.run(auth, async (tx) => {
      const s = await this.loadSettings(tx, auth.tenantId);
      return this.awardRows(tx, { tenantId: auth.tenantId, ...(this.canSeeAll(auth, s.visibility) ? {} : { userId: auth.userId }) }, 100);
    });
  }

  private async awardRows(tx: TenantTx, where: Prisma.GamificationAwardWhereInput, take: number): Promise<AwardRow[]> {
    const rows = await tx.gamificationAward.findMany({ where, orderBy: { awardedAt: 'desc' }, take, include: { badge: { select: { id: true, name: true, icon: true, description: true } }, user: { select: { id: true, name: true } } } });
    return rows.map((r) => ({ id: r.id, badge: r.badge, user: r.user, period: r.period, value: Number(r.value), awardedAt: r.awardedAt.toISOString() }));
  }

  /** Checks every active badge for every active member and stores new awards (with a notification). Returns how many. */
  async evaluate(tx: TenantTx, tenantId: string, at = new Date()): Promise<number> {
    const s = await this.loadSettings(tx, tenantId);
    if (!s.enabled) return 0;
    const badges = await tx.gamificationBadge.findMany({ where: { tenantId, active: true } });
    if (!badges.length) return 0;
    const { members } = await this.people(tx, tenantId);
    const memberIds = new Set(members.map((m) => m.id));
    const cache = new Map<string, Promise<Scored>>();
    const scoredFor = (w: Window & { label: string }) => {
      if (!cache.has(w.label)) cache.set(w.label, this.score(tx, tenantId, w));
      return cache.get(w.label)!;
    };
    const existing = new Set((await tx.gamificationAward.findMany({ where: { tenantId, badgeId: { in: badges.map((b) => b.id) } }, select: { badgeId: true, userId: true, period: true } })).map((a) => `${a.badgeId}|${a.userId}|${a.period}`));
    let created = 0;
    for (const b of badges) {
      // The current period, and the one before so a threshold crossed just before a period ended is not missed.
      const windows = new Map<string, Window & { label: string }>();
      for (const d of [at, new Date(at.getTime() - 2 * DAY)]) {
        const w = badgeWindow(b.window as BadgeWindow, d);
        if (w && !windows.has(w.label)) windows.set(w.label, w);
      }
      for (const w of windows.values()) {
        const scored = await scoredFor(w);
        const targets = b.metric === 'target_attainment' ? new Map((await tx.salesTarget.findMany({ where: { tenantId, period: w.label, userId: { not: null } } })).map((t) => [t.userId!, Number(t.amount)])) : null;
        for (const userId of memberIds) {
          if (existing.has(`${b.id}|${userId}|${w.label}`)) continue;
          const value = metricValue(b.metric as BadgeMetric, s.rules, scored.stats.get(userId), targets?.get(userId) ?? null);
          if (value === null || value < Number(b.threshold)) continue;
          await tx.gamificationAward.create({ data: { tenantId, badgeId: b.id, userId, period: w.label, value: r2(value) } });
          existing.add(`${b.id}|${userId}|${w.label}`);
          created++;
          await this.notifications.send(tx, tenantId, [userId], { type: 'gamification.badge_awarded', title: `You earned the "${b.name}" badge`, body: b.description ?? `${b.name}${w.label === 'all' ? '' : ` for ${w.label}`}.`, link: '/app/gamification' });
          await this.audit.record(tx, { tenantId, actorUserId: null, actorType: 'SYSTEM', action: 'gamification.badge_awarded', entityType: 'gamification_badge', entityId: b.id, metadata: { userId, period: w.label, value: r2(value) } });
        }
      }
    }
    return created;
  }

  async evaluateNow(auth: AuthContext): Promise<{ awarded: number }> {
    return this.prisma.run(auth, async (tx) => {
      if (!(await this.loadSettings(tx, auth.tenantId)).enabled) throw this.off();
      return { awarded: await this.evaluate(tx, auth.tenantId) };
    });
  }

  /** Worker job, at most hourly: award badges in every workspace with gamification on. */
  async sweep(force = false): Promise<number> {
    if (!force && Date.now() - this.lastSweep < HOUR) return 0;
    this.lastSweep = Date.now();
    const tenants = (await scanTenants(this.prisma.gamificationSettings, { enabled: true })).map((tenant_id) => ({ tenant_id }));
    let n = 0;
    for (const t of tenants) {
      try {
        n += await this.prisma.run({ tenantId: t.tenant_id }, (tx) => this.evaluate(tx, t.tenant_id));
      } catch (err) {
        this.log.error({ err: errorMessage(err), tenantId: t.tenant_id }, 'badge sweep failed');
      }
    }
    return n;
  }

  // ───────────── competitions and team challenges ─────────────

  competitions(auth: AuthContext): Promise<CompetitionRow[]> {
    return this.prisma.run(auth, async (tx) => {
      const s = await this.loadSettings(tx, auth.tenantId);
      if (!s.enabled) throw this.off();
      return this.competitionRows(tx, auth, s.visibility);
    });
  }

  async createCompetition(auth: AuthContext, input: CompetitionInput, meta: RequestMeta): Promise<CompetitionRow> {
    const id = await this.prisma.run(auth, async (tx) => {
      const s = await this.loadSettings(tx, auth.tenantId);
      if (!s.enabled) throw this.off();
      let start: string;
      let endInclusive: string;
      if (input.period) {
        const w = windowOf(input.period);
        start = ymd(w.start);
        endInclusive = ymd(new Date(w.end.getTime() - DAY));
      } else {
        start = input.startDate!;
        endInclusive = input.endDate!;
      }
      const teamIds = [...new Set(input.teamIds)];
      if (teamIds.length && (await tx.team.count({ where: { tenantId: auth.tenantId, id: { in: teamIds } } })) !== teamIds.length) throw badRef('teamIds');
      const { members, teamUsers } = await this.people(tx, auth.tenantId);
      const participants = teamIds.length ? [...new Set(teamIds.flatMap((t) => [...(teamUsers.get(t) ?? [])]))] : members.map((m) => m.id);
      if (input.kind === 'team' && !(teamIds.length ? teamIds : [...teamUsers.keys()]).some((t) => (teamUsers.get(t)?.size ?? 0) > 0)) {
        throw new ConflictException({ code: 'NO_TEAMS', message: 'A team challenge needs at least one team with members. Add teams in Settings, Teams first.' });
      }
      const row = await tx.gamificationCompetition.create({
        data: {
          tenantId: auth.tenantId, name: input.name, description: input.description ?? null, kind: input.kind, metric: input.metric,
          startDate: utc(start), endDate: utc(endInclusive), goal: input.goal ?? null, reward: input.reward ?? null, teamIds, rules: s.rules as unknown as Prisma.InputJsonValue, createdById: auth.userId,
        },
      });
      await this.notifications.send(tx, auth.tenantId, participants.filter((u) => u !== auth.userId), { type: 'gamification.competition_created', title: input.kind === 'team' ? `New team challenge: ${input.name}` : `New competition: ${input.name}`, body: input.reward ? `${start} to ${endInclusive}. Reward: ${input.reward}` : `${start} to ${endInclusive}`, link: '/app/gamification' });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'gamification.competition_created', entityType: 'gamification_competition', entityId: row.id, metadata: { name: input.name, kind: input.kind, metric: input.metric, start, end: endInclusive, teamIds }, meta });
      return row.id;
    });
    return (await this.competitions(auth)).find((c) => c.id === id)!;
  }

  async cancelCompetition(auth: AuthContext, id: string, meta: RequestMeta): Promise<CompetitionRow> {
    await this.prisma.run(auth, async (tx) => {
      const row = await tx.gamificationCompetition.findFirst({ where: { id, tenantId: auth.tenantId } });
      if (!row) throw notFound('Competition');
      if (row.cancelledAt) throw new ConflictException({ code: 'ALREADY_CANCELLED', message: 'This competition is already cancelled.' });
      await tx.gamificationCompetition.update({ where: { id }, data: { cancelledAt: new Date() } });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'gamification.competition_cancelled', entityType: 'gamification_competition', entityId: id, metadata: { name: row.name }, meta });
    });
    return (await this.competitions(auth)).find((c) => c.id === id)!;
  }

  private async competitionRows(tx: TenantTx, auth: AuthContext, visibility: 'everyone' | 'managers'): Promise<CompetitionRow[]> {
    const rows = await tx.gamificationCompetition.findMany({ where: { tenantId: auth.tenantId }, orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }], take: 50 });
    if (!rows.length) return [];
    const { members, teams, teamUsers } = await this.people(tx, auth.tenantId);
    const creators = new Map((await tx.user.findMany({ where: { id: { in: rows.map((r) => r.createdById).filter((v): v is string => !!v) } }, select: { id: true, name: true } })).map((u) => [u.id, u]));
    const today = ymd(new Date());
    const seeAll = this.canSeeAll(auth, visibility);
    const out: CompetitionRow[] = [];
    for (const r of rows) {
      const start = ymd(r.startDate);
      const end = ymd(r.endDate);
      const status = r.cancelledAt ? 'cancelled' : today < start ? 'upcoming' : today > end ? 'finished' : 'running';
      const parsed = scoringRulesSchema.safeParse(r.rules);
      const rules = parsed.success ? parsed.data : DEFAULT_SCORING_RULES;
      const teamIds = r.teamIds.length ? r.teamIds : r.kind === 'team' ? teams.map((t) => t.id) : [];
      const goal = r.goal?? null;
      let standings: CompetitionStanding[] = [];
      let mine: CompetitionStanding | null = null;
      if (status !== 'upcoming') {
        const scored = await this.score(tx, auth.tenantId, { start: r.startDate, end: new Date(r.endDate.getTime() + DAY) });
        const value = (userId: string) => competitionValue(r.metric as CompetitionMetric, rules, scored.stats.get(userId));
        const progress = (v: number) => (goal ? r1((v / goal) * 100) : null);
        if (r.kind === 'team') {
          const rowsT = teamIds
            .map((tid) => ({ team: teams.find((t) => t.id === tid), users: [...(teamUsers.get(tid) ?? [])] }))
            .filter((t): t is { team: { id: string; name: string }; users: string[] } => !!t.team && t.users.length > 0)
            .map((t) => ({ id: t.team.id, name: t.team.name, value: r2(t.users.reduce((a, u) => a + value(u), 0)), users: t.users }));
          const ranked = rank(rowsT, (t) => t.value, (t) => t.name);
          standings = ranked.map(({ users: _u, ...t }) => ({ ...t, progress: progress(t.value) }));
          const myTeam = ranked.find((t) => t.users.includes(auth.userId));
          mine = myTeam ? standings.find((t) => t.id === myTeam.id)! : null;
        } else {
          const eligible = r.teamIds.length ? new Set(r.teamIds.flatMap((t) => [...(teamUsers.get(t) ?? [])])) : null;
          const people = members.filter((m) => !eligible || eligible.has(m.id)).map((m) => ({ id: m.id, name: m.name, value: r2(value(m.id)) }));
          standings = rank(people, (p) => p.value, (p) => p.name).map((p) => ({ ...p, progress: progress(p.value) }));
          mine = standings.find((p) => p.id === auth.userId) ?? null;
          if (!seeAll) standings = mine ? [mine] : [];
        }
      }
      out.push({
        id: r.id, name: r.name, description: r.description, kind: r.kind as 'individual' | 'team', metric: r.metric as CompetitionMetric, start, end, goal, reward: r.reward, status,
        teams: teamIds.map((id) => teams.find((t) => t.id === id)).filter((t): t is { id: string; name: string } => !!t),
        createdBy: r.createdById ? (creators.get(r.createdById) ?? null) : null, rules, standings, mine,
      });
    }
    return out;
  }
}

function metricValue(metric: BadgeMetric, rules: ScoringRules, s: PersonStats | undefined, target: number | null): number | null {
  switch (metric) {
    case 'points':
      return scorePerson(rules, s).points;
    case 'deals_won':
      return s?.dealsWon ?? 0;
    case 'revenue_won':
      return s?.revenue ?? 0;
    case 'calls':
      return count(s, 'call_logged');
    case 'meetings':
      return count(s, 'meeting_logged');
    case 'activities':
      return count(s, 'call_logged') + count(s, 'meeting_logged') + count(s, 'email_logged');
    case 'target_attainment':
      return target ? ((s?.revenue ?? 0) / target) * 100 : null;
  }
}

function competitionValue(metric: CompetitionMetric, rules: ScoringRules, s: PersonStats | undefined): number {
  switch (metric) {
    case 'points':
      return scorePerson(rules, s).points;
    case 'revenue_won':
      return s?.revenue ?? 0;
    case 'deals_won':
      return s?.dealsWon ?? 0;
    case 'activities':
      return count(s, 'call_logged') + count(s, 'meeting_logged') + count(s, 'email_logged');
  }
}

function badgeData(b: BadgeInput) {
  return { name: b.name, description: b.description ?? null, icon: b.icon, metric: b.metric, threshold: b.threshold, window: b.window, active: b.active };
}

function toBadgeRow(r: Prisma.GamificationBadgeGetPayload<{ include: { _count: { select: { awards: true } } } }>): BadgeRow {
  return { id: r.id, name: r.name, description: r.description, icon: r.icon as BadgeRow['icon'], metric: r.metric as BadgeMetric, threshold: Number(r.threshold), window: r.window as BadgeWindow, active: r.active, awardedCount: r._count.awards };
}
