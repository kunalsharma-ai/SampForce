import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { type Prisma, transactionLock, type TenantTx } from '@dealflow/database';
import {
  type GoalProgress,
  type PerformanceScore,
  RANKING_CRITERION_LABEL,
  type RankingCriterion,
  type RecognitionAwardInput,
  type RecognitionAwardRow,
  type RecognitionCandidate,
  type RecognitionCard,
  type RecognitionPolicy,
  type RecognitionScopeView,
  type RecognitionStatus,
  type RecognitionTargetCreateInput,
  type RecognitionTargetRow,
  type RecognitionTargetUpdateInput,
  type RecognitionView,
  type WorkspaceRef,
} from '@dealflow/types';
import { AchievementsService } from '../achievements/achievements.service';
import { AuditService } from '../audit/audit.service';
import { tr } from '../common/request-language';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { addDays, dayStart, localDay } from '../task-plans/calendar';
import { SlicedSweep } from '../worker/sliced-sweep';
import { scanTenants } from '../worker/queue';
import { HierarchyError } from '../workspaces/workspaces.service';
import { refOf } from '../workspace-work/hierarchy';
import { averagePercent, describeGoal, GoalCounter, goalsOf, type StoredGoal, storeGoals, type Window } from './goals';
import { assertReaches, card, type Directory, loadDirectory, loadPolicy, reachable, reaches, sees, unknownPerson } from './people';

type Stored = Prisma.RecognitionTargetGetPayload<object>;
type StoredAward = Prisma.RecognitionAwardGetPayload<object>;

const notFound = () => new NotFoundException({ code: 'NOT_FOUND', message: 'Employee of the Month target not found.' });
const r1 = (n: number) => Math.round(n * 10) / 10;
const LINK = '/app/recognition';
const MILESTONES = [50, 75] as const;

export function monthBounds(month: string): { first: string; last: string } {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return { first: `${month}-01`, last: new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10) };
}

export async function timeZoneOf(tx: TenantTx, tenantId: string): Promise<string> {
  return (await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { defaultTimezone: true } })).defaultTimezone || 'UTC';
}

function windowOf(first: string, last: string, tz: string): Window {
  return { first, last, start: dayStart(first, tz), end: dayStart(addDays(last, 1), tz) };
}

/** The scope key of an award: one standing award per month for the organisation and for each manager's team. */
const liveKey = (month: string, teamNodeId: string | null) => `${month}|${teamNodeId ? `TEAM:${teamNodeId}` : 'ORG'}`;

interface Evaluated {
  row: RecognitionTargetRow;
  stored: Stored;
}

/**
 * Employee of the Month (ADR 0102). A manager (where the Super Workspace allows it) or the Super Workspace sets a
 * monthly target for a person: goals counted from the records, and the rule that makes the person eligible. SampForce
 * counts progress as people work, tells the person at 50% and 75%, and tells the person and their managers when every
 * condition is met. Being eligible is not winning: the winner is chosen by the Super Workspace's method, automatically
 * from the ranking it configured or by a person, and ties are never settled at random.
 */
@Injectable()
export class RecognitionService {
  private readonly log = new Logger(RecognitionService.name);
  private readonly sweeper = new SlicedSweep(5 * 60_000, 3_000);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly achievements: AchievementsService,
  ) {}

  // ───────────── Reading ─────────────

  /** The dashboard card: the person's own target and progress, the month's winners they can see, and their history. */
  card(auth: AuthContext): Promise<RecognitionCard> {
    return this.prisma.run(auth, async (tx) => {
      const dir = await loadDirectory(tx, auth);
      const tz = await timeZoneOf(tx, auth.tenantId);
      const month = localDay(new Date(), tz).slice(0, 7);
      const counter = new GoalCounter(tx, auth.tenantId);
      const mine = await tx.recognitionTarget.findFirst({ where: { tenantId: auth.tenantId, userId: auth.userId, month, cancelledAt: null }, orderBy: { createdAt: 'desc' } });
      const target = mine ? (await this.evaluate(tx, dir, counter, mine, tz)).row : null;
      const me = dir.person(auth.userId);
      const teamNode = me?.level === 'EXECUTIVE' ? me.node.node.parentId : me?.level === 'MANAGER' ? me.node.node.id : null;
      const keys = [liveKey(month, null), ...(teamNode && teamNode !== dir.org.root.node.id ? [liveKey(month, teamNode)] : [])];
      const awards = await tx.recognitionAward.findMany({ where: { tenantId: auth.tenantId, liveKey: { in: keys } }, orderBy: { awardedAt: 'asc' } });
      const history = await tx.recognitionAward.findMany({ where: { tenantId: auth.tenantId, userId: auth.userId, revokedAt: null, month: { not: month } }, orderBy: { awardedAt: 'desc' }, take: 24 });
      const winners = awards.map((a) => this.awardRow(dir, a, auth.userId));
      return {
        month,
        target,
        winners,
        mine: winners.find((w) => w.person.id === auth.userId) ?? null,
        history: history.map((a) => this.awardRow(dir, a, auth.userId)),
        currency: await counter.measures.baseCurrency(),
      };
    });
  }

  /** The management page for a month: targets, rankings and winners in the caller's reach. */
  view(auth: AuthContext, month?: string): Promise<RecognitionView> {
    return this.prisma.run(auth, async (tx) => {
      const dir = await loadDirectory(tx, auth);
      const tz = await timeZoneOf(tx, auth.tenantId);
      const current = localDay(new Date(), tz).slice(0, 7);
      const m = month && /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : current;
      const counter = new GoalCounter(tx, auth.tenantId);
      const stored = await tx.recognitionTarget.findMany({ where: { tenantId: auth.tenantId, month: m }, orderBy: { createdAt: 'asc' }, take: 1000 });
      const visible = stored.filter((t) => {
        const p = dir.person(t.userId);
        return p ? sees(dir, p, auth.userId) : dir.isSuper;
      });
      const evaluated: Evaluated[] = [];
      for (const t of visible) evaluated.push(await this.evaluate(tx, dir, counter, t, tz));
      const awards = await tx.recognitionAward.findMany({ where: { tenantId: auth.tenantId, month: m, revokedAt: null } });
      const scopes: RecognitionScopeView[] = [];
      if (dir.isSuper) {
        scopes.push(await this.scope(tx, dir, counter, evaluated, awards, null, auth.userId));
        for (const node of [...dir.org.byId.values()].filter((n) => n.level === 'MANAGER' && !n.node.archivedAt)) {
          if (evaluated.some((e) => dir.person(e.stored.userId)?.node.node.parentId === node.node.id) || awards.some((a) => a.teamNodeId === node.node.id))
            scopes.push(await this.scope(tx, dir, counter, evaluated, awards, node.node.id, auth.userId));
        }
      } else if (dir.me.level === 'MANAGER') {
        scopes.push(await this.scope(tx, dir, counter, evaluated, awards, dir.me.node.id, auth.userId));
        const org = awards.find((a) => !a.teamNodeId);
        if (org) scopes.push({ scope: 'ORGANISATION', team: null, award: this.awardRow(dir, org, auth.userId), candidates: [], canSelect: false, notice: null });
      }
      const history = (await tx.recognitionAward.findMany({ where: { tenantId: auth.tenantId }, orderBy: { awardedAt: 'desc' }, take: 200 })).filter((a) => {
        const p = dir.person(a.userId);
        return a.userId === auth.userId || (p ? sees(dir, p, auth.userId) : dir.isSuper);
      });
      return {
        month: m,
        currentMonth: current,
        level: dir.isSuper ? 'SUPER' : dir.me.level === 'SUPER' ? 'EXECUTIVE' : dir.me.level,
        policy: dir.policy,
        canSetTargets: reachable(dir, 'targets').length > 0,
        canEditPolicy: dir.isSuper,
        people: reachable(dir, 'targets'),
        targets: evaluated.map((e) => e.row),
        scopes,
        history: history.map((a) => this.awardRow(dir, a, auth.userId)),
        currency: await counter.measures.baseCurrency(),
      };
    });
  }

  // ───────────── Targets ─────────────

  create(auth: AuthContext, input: RecognitionTargetCreateInput & { goals: NonNullable<RecognitionTargetCreateInput['goals']> }, meta: RequestMeta): Promise<RecognitionTargetRow> {
    return this.prisma.run(auth, async (tx) => {
      await transactionLock(tx, `recognition:${auth.tenantId}`);
      const dir = await loadDirectory(tx, auth);
      const person = assertReaches(dir, dir.person(input.userId), 'targets');
      const tz = await timeZoneOf(tx, auth.tenantId);
      const current = localDay(new Date(), tz).slice(0, 7);
      if (input.month < current) throw new BadRequestException({ code: 'MONTH_PASSED', message: 'That month is over. Set targets for this month or a later one.' });
      const existing = await tx.recognitionTarget.findFirst({ where: { tenantId: auth.tenantId, userId: person.id, month: input.month, cancelledAt: null } });
      if (existing) throw new ConflictException({ code: 'RECOGNITION_TARGET_EXISTS', message: 'This person already has an Employee of the Month target for that month. Change it instead.' });
      const bounds = monthBounds(input.month);
      const first = input.startsOn ?? bounds.first;
      const last = input.endsOn ?? bounds.last;
      const w = windowOf(first, last, tz);
      const goals = storeGoals(input.goals);
      const row = await tx.recognitionTarget.create({
        data: {
          tenantId: auth.tenantId,
          userId: person.id,
          month: input.month,
          name: input.name,
          startsOn: first,
          endsOn: last,
          startsAt: w.start,
          endsAt: w.end,
          goals: goals as unknown as Prisma.InputJsonValue,
          eligibility: input.eligibility ?? 'EVERY_GOAL',
          minAchievementPercent: input.minAchievementPercent ?? 100,
          minScore: input.minScore ?? null,
          conditions: input.conditions || null,
          description: input.description || null,
          reward: input.reward || null,
          setById: auth.userId,
          setByLevel: dir.isSuper ? 'SUPER' : 'MANAGER',
          notified: [],
        },
      });
      await this.audit.record(tx, {
        tenantId: auth.tenantId, actorUserId: auth.userId, action: 'recognition.target_set', entityType: 'recognition_target', entityId: row.id,
        metadata: { person: person.name, month: row.month, goals: goals.map(describeGoal) }, meta,
      });
      await this.notifications.send(tx, auth.tenantId, [person.id], {
        type: 'recognition.target_set',
        title: `New Employee of the Month target: ${row.name}`,
        body: goals.map(describeGoal).join('; '),
        link: '/app',
        eventId: `recognition:${row.id}:set`,
        senderId: auth.userId,
      });
      return (await this.evaluate(tx, dir, new GoalCounter(tx, auth.tenantId), row, tz)).row;
    });
  }

  update(auth: AuthContext, id: string, input: RecognitionTargetUpdateInput, meta: RequestMeta): Promise<RecognitionTargetRow> {
    return this.prisma.run(auth, async (tx) => {
      const dir = await loadDirectory(tx, auth);
      const row = await this.find(tx, auth, id);
      const person = assertReaches(dir, dir.person(row.userId), 'targets');
      if (row.cancelledAt) throw new ConflictException({ code: 'RECOGNITION_TARGET_CLOSED', message: 'This target was cancelled and cannot be changed.' });
      const tz = await timeZoneOf(tx, auth.tenantId);
      if (row.endsAt <= new Date()) throw new ConflictException({ code: 'RECOGNITION_TARGET_CLOSED', message: 'This target’s period is over, so it is kept as it was.' });
      const changes: string[] = [];
      const data: Prisma.RecognitionTargetUpdateInput = {};
      const oldGoals = goalsOf(row.goals);
      if (input.name !== undefined && input.name !== row.name) { changes.push(`Name: ${row.name} → ${input.name}`); data.name = input.name; }
      if (input.goals) {
        const goals = storeGoals(input.goals, oldGoals);
        const before = oldGoals.map(describeGoal).join('; ');
        const after = goals.map(describeGoal).join('; ');
        if (before !== after) { changes.push(`Goals: ${before} → ${after}`); data.goals = goals as unknown as Prisma.InputJsonValue; }
      }
      if (input.eligibility !== undefined && input.eligibility !== row.eligibility) { changes.push(`Eligibility: ${row.eligibility} → ${input.eligibility}`); data.eligibility = input.eligibility; }
      if (input.minAchievementPercent !== undefined && input.minAchievementPercent !== row.minAchievementPercent) { changes.push(`Minimum achievement: ${row.minAchievementPercent}% → ${input.minAchievementPercent}%`); data.minAchievementPercent = input.minAchievementPercent; }
      if (input.minScore !== undefined && input.minScore !== row.minScore) { changes.push(`Minimum performance score: ${row.minScore ?? '—'} → ${input.minScore ?? '—'}`); data.minScore = input.minScore; }
      for (const k of ['conditions', 'description', 'reward'] as const) {
        if (input[k] !== undefined && (input[k] || null) !== row[k]) { changes.push(`${k[0]!.toUpperCase()}${k.slice(1)} changed`); data[k] = input[k] || null; }
      }
      if (input.endsOn !== undefined && input.endsOn !== row.endsOn) {
        if (input.endsOn.slice(0, 7) !== row.month || input.endsOn < row.startsOn) throw new BadRequestException({ code: 'INVALID_DATES', message: 'The dates must be inside the recognition month.' });
        changes.push(`End date: ${row.endsOn} → ${input.endsOn}`);
        data.endsOn = input.endsOn;
        data.endsAt = dayStart(addDays(input.endsOn, 1), tz);
      }
      if (!changes.length) return (await this.evaluate(tx, dir, new GoalCounter(tx, auth.tenantId), row, tz)).row;
      const revisions = [...((row.revisions as unknown[]) ?? []), { at: new Date().toISOString(), byId: auth.userId, changes }];
      // The milestones open again for the new goals; the record of the earlier ones stays in the notifications.
      const updated = await tx.recognitionTarget.update({ where: { id }, data: { ...data, revisions: revisions as Prisma.InputJsonValue, notified: [] } });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'recognition.target_updated', entityType: 'recognition_target', entityId: id, metadata: { person: person.name, changes }, meta });
      await this.notifications.send(tx, auth.tenantId, [person.id], {
        type: 'recognition.target_updated',
        title: `Your Employee of the Month target changed: ${updated.name}`,
        body: changes.join('\n'),
        link: '/app',
        eventId: `recognition:${id}:rev${revisions.length}`,
        senderId: auth.userId,
      });
      return (await this.evaluate(tx, dir, new GoalCounter(tx, auth.tenantId), updated, tz)).row;
    });
  }

  cancel(auth: AuthContext, id: string, meta: RequestMeta): Promise<void> {
    return this.prisma.run(auth, async (tx) => {
      const dir = await loadDirectory(tx, auth);
      const row = await this.find(tx, auth, id);
      const person = assertReaches(dir, dir.person(row.userId), 'targets');
      if (row.cancelledAt) return;
      const won = await tx.recognitionAward.findFirst({ where: { tenantId: auth.tenantId, targetId: id, revokedAt: null } });
      if (won) throw new ConflictException({ code: 'RECOGNITION_AWARDED', message: 'This target led to an award. Revoke the award first if it was a mistake.' });
      await tx.recognitionTarget.update({ where: { id }, data: { cancelledAt: new Date(), status: 'CANCELLED' } });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'recognition.target_cancelled', entityType: 'recognition_target', entityId: id, metadata: { person: person.name, month: row.month }, meta });
      await this.notifications.send(tx, auth.tenantId, [person.id], {
        type: 'recognition.target_cancelled', title: `Employee of the Month target cancelled: ${row.name}`, link: '/app', eventId: `recognition:${id}:cancelled`, senderId: auth.userId,
      });
    });
  }

  // ───────────── Selecting the winner ─────────────

  /** A person names the winner: the Super Workspace for the organisation, a manager for its own team. */
  award(auth: AuthContext, input: RecognitionAwardInput, meta: RequestMeta): Promise<RecognitionAwardRow> {
    return this.prisma.run(auth, async (tx) => {
      await transactionLock(tx, `recognition:${auth.tenantId}`);
      const dir = await loadDirectory(tx, auth);
      const person = assertReaches(dir, dir.person(input.userId), 'select');
      const teamNodeId = dir.isSuper ? null : dir.me.node.id;
      const tz = await timeZoneOf(tx, auth.tenantId);
      if (input.month > localDay(new Date(), tz).slice(0, 7)) throw new BadRequestException({ code: 'MONTH_NOT_STARTED', message: 'That month has not started yet.' });
      const target = await tx.recognitionTarget.findFirst({ where: { tenantId: auth.tenantId, userId: person.id, month: input.month, cancelledAt: null } });
      if (!target) throw new ConflictException({ code: 'NOT_ELIGIBLE', message: 'Only an eligible person can be named Employee of the Month.' });
      const counter = new GoalCounter(tx, auth.tenantId);
      const e = await this.evaluate(tx, dir, counter, target, tz);
      if (!e.row.eligible) throw new ConflictException({ code: 'NOT_ELIGIBLE', message: 'Only an eligible person can be named Employee of the Month.' });
      const row = await this.store(tx, dir, e, teamNodeId, 'MANUAL', auth.userId, input.note ?? null, meta);
      return this.awardRow(dir, row, auth.userId);
    });
  }

  /** The Super Workspace runs the automatic selection for a month now, the same way the worker does when it ends. */
  select(auth: AuthContext, month: string, meta: RequestMeta): Promise<RecognitionScopeView> {
    return this.prisma.run(auth, async (tx) => {
      await transactionLock(tx, `recognition:${auth.tenantId}`);
      const dir = await loadDirectory(tx, auth);
      if (!dir.isSuper) throw new HierarchyError('SUPER_ONLY', 'Only the Super Workspace can do this.');
      const tz = await timeZoneOf(tx, auth.tenantId);
      if (month > localDay(new Date(), tz).slice(0, 7)) throw new BadRequestException({ code: 'MONTH_NOT_STARTED', message: 'That month has not started yet.' });
      return this.autoSelect(tx, dir, month, tz, auth.userId, meta);
    });
  }

  revoke(auth: AuthContext, id: string, reason: string, meta: RequestMeta): Promise<void> {
    return this.prisma.run(auth, async (tx) => {
      const dir = await loadDirectory(tx, auth);
      const a = await tx.recognitionAward.findFirst({ where: { id, tenantId: auth.tenantId } });
      if (!a) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Award not found.' });
      if (!this.canRevoke(dir, a)) throw new HierarchyError('PERSON_NOT_IN_REACH', 'You can only do this for people in the workspaces below yours.');
      if (a.revokedAt) return;
      await tx.recognitionAward.update({ where: { id }, data: { revokedAt: new Date(), revokedById: auth.userId, revokeReason: reason, liveKey: `revoked:${id}` } });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'recognition.award_revoked', entityType: 'recognition_award', entityId: id, metadata: { person: dir.names.get(a.userId) ?? '', month: a.month, reason }, meta });
      await this.notifications.send(tx, auth.tenantId, [a.userId], {
        type: 'recognition.award_revoked', title: 'Your Employee of the Month award was withdrawn', body: reason, link: '/app', eventId: `recognition:award:${id}:revoked`, senderId: auth.userId,
      });
    });
  }

  policy(auth: AuthContext): Promise<RecognitionPolicy> {
    return this.prisma.run(auth, (tx) => loadPolicy(tx, auth.tenantId));
  }

  savePolicy(auth: AuthContext, policy: RecognitionPolicy, meta: RequestMeta): Promise<RecognitionPolicy> {
    return this.prisma.run(auth, async (tx) => {
      const dir = await loadDirectory(tx, auth);
      if (!dir.isSuper) throw new HierarchyError('SUPER_ONLY', 'Only the Super Workspace can do this.');
      await tx.recognitionPolicy.upsert({
        where: { tenantId: auth.tenantId },
        create: { tenantId: auth.tenantId, policy: policy as unknown as Prisma.InputJsonValue, updatedById: auth.userId },
        update: { policy: policy as unknown as Prisma.InputJsonValue, updatedById: auth.userId },
      });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'recognition.policy_changed', entityType: 'recognition_policy', entityId: auth.tenantId, metadata: { ...policy }, meta });
      return policy;
    });
  }

  /** An award the caller may print: their own, or one of someone they can see. */
  certificateData(auth: AuthContext, id: string): Promise<{ award: RecognitionAwardRow; orgName: string }> {
    return this.prisma.run(auth, async (tx) => {
      const dir = await loadDirectory(tx, auth);
      const a = await tx.recognitionAward.findFirst({ where: { id, tenantId: auth.tenantId, revokedAt: null } });
      const p = a ? dir.person(a.userId) : undefined;
      if (!a || !(a.userId === auth.userId || (p ? sees(dir, p, auth.userId) : dir.isSuper))) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Award not found.' });
      return { award: this.awardRow(dir, a, auth.userId), orgName: dir.orgName };
    });
  }

  // ───────────── Worker ─────────────

  /**
   * Counts running targets (milestones and eligibility notices even when nobody opens a page) and, once a month is
   * over, runs the automatic selection where the Super Workspace chose it.
   */
  sweep(force = false): Promise<number> {
    return this.sweeper.run(
      force,
      async () => [...new Set([...(await scanTenants(this.prisma.recognitionTarget, { cancelledAt: null, status: { in: ['ACTIVE', 'ELIGIBLE'] } }))])],
      async (tenantId) => {
        try {
          await this.prisma.run({ tenantId }, (tx) => this.runTenant(tx, tenantId));
        } catch (err) {
          this.log.warn({ err: err instanceof Error ? err.message : err, tenantId }, 'recognition sweep failed');
        }
      },
    );
  }

  private async runTenant(tx: TenantTx, tenantId: string): Promise<number> {
    const admin = await tx.membership.findFirst({ where: { tenantId, status: 'ACTIVE', role: { permissions: { has: 'members:manage' } }, OR: [{ workspaceNodeId: null }, { workspaceNodeId: { isSet: false } }] }, orderBy: { createdAt: 'asc' } });
    if (!admin) return 0;
    // The worker reads the organisation as its Super Workspace would.
    const auth = { userId: admin.userId, tenantId, permissions: ['members:manage'], workspaceNodeId: null } as unknown as AuthContext;
    const dir = await loadDirectory(tx, auth);
    const tz = await timeZoneOf(tx, tenantId);
    const counter = new GoalCounter(tx, tenantId);
    const current = localDay(new Date(), tz).slice(0, 7);
    const running = await tx.recognitionTarget.findMany({ where: { tenantId, cancelledAt: null, status: { in: ['ACTIVE', 'ELIGIBLE'] } }, take: 500 });
    let n = 0;
    for (const t of running) {
      await this.evaluate(tx, dir, counter, t, tz);
      n++;
    }
    if (dir.policy.selection === 'AUTOMATIC') {
      const ended = [...new Set(running.filter((t) => t.month < current).map((t) => t.month))];
      for (const month of ended) {
        const done = await tx.recognitionAward.findFirst({ where: { tenantId, liveKey: liveKey(month, null) } });
        if (!done) await this.autoSelect(tx, dir, month, tz, null, undefined);
      }
    }
    return n;
  }

  // ───────────── Counting ─────────────

  private async find(tx: TenantTx, auth: AuthContext, id: string): Promise<Stored> {
    const row = await tx.recognitionTarget.findFirst({ where: { id, tenantId: auth.tenantId } });
    if (!row) throw notFound();
    return row;
  }

  /** Counts a target, keeps its stored status up to date, and sends the milestone and eligibility notices once each. */
  private async evaluate(tx: TenantTx, dir: Directory, counter: GoalCounter, t: Stored, tz: string): Promise<Evaluated> {
    const goals = goalsOf(t.goals);
    const w: Window = { first: t.startsOn, last: t.endsOn, start: t.startsAt, end: t.endsAt };
    const progress = await counter.progress(goals, t.userId, w);
    const performance = await this.score(counter, t.userId, w, progress);
    const achievementPercent = averagePercent(progress, false);
    const capped = averagePercent(progress, true);
    const measurable = progress.every((g) => g.measurable);
    const goalsOk = measurable && (t.eligibility === 'OVERALL' ? capped >= t.minAchievementPercent - 1e-9 : progress.every((g) => g.percent >= t.minAchievementPercent - 1e-9));
    const eligible = goalsOk && (t.minScore === null || performance.score >= t.minScore - 1e-9);
    const now = new Date();
    const award = await tx.recognitionAward.findFirst({ where: { tenantId: t.tenantId, targetId: t.id, revokedAt: null } });
    const over = now >= t.endsAt;
    let status: RecognitionStatus = t.cancelledAt ? 'CANCELLED' : award ? 'AWARDED' : eligible ? 'ELIGIBLE' : over ? 'CLOSED' : 'ACTIVE';
    if (status === 'ELIGIBLE' && over && t.month < localDay(now, tz).slice(0, 7)) {
      const orgAward = await tx.recognitionAward.findFirst({ where: { tenantId: t.tenantId, liveKey: liveKey(t.month, null) } });
      if (orgAward) status = 'NOT_SELECTED';
    }

    const notified = new Set(t.notified);
    const person = dir.person(t.userId);
    if (!t.cancelledAt && !over && person) {
      for (const m of MILESTONES) {
        const key = `m${m}`;
        if (capped >= m && !eligible && !notified.has(key)) {
          notified.add(key);
          await this.notifications.send(tx, t.tenantId, [t.userId], {
            type: 'recognition.milestone',
            title: `You’re at ${m}% of your Employee of the Month target`,
            body: `${t.name}: keep going.`,
            link: '/app',
            eventId: `recognition:${t.id}:m${m}:${(t.revisions as unknown[]).length}`,
          });
        }
      }
    }
    if (eligible && !notified.has('eligible') && !t.cancelledAt && person) {
      notified.add('eligible');
      const version = (t.revisions as unknown[]).length;
      await this.notifications.send(tx, t.tenantId, [t.userId], {
        type: 'recognition.eligible',
        title: 'Congratulations! You have achieved your Employee of the Month target.',
        body: t.name,
        link: '/app',
        priority: 'HIGH',
        eventId: `recognition:${t.id}:eligible:${version}`,
      });
      const deciders = [...new Set([...person.managers.map((m) => m.id), t.setById, ...dir.superAdmins])].filter((u) => u !== t.userId);
      await this.notifications.send(tx, t.tenantId, deciders, {
        type: 'recognition.eligible',
        title: `${person.name} is eligible for Employee of the Month`,
        body: `${t.name} (${t.month})`,
        link: `${LINK}?month=${t.month}`,
        eventId: `recognition:${t.id}:eligible:${version}`,
      });
      await this.achievements.award(tx, t.tenantId, [{
        userId: t.userId, kind: 'RECOGNITION_ELIGIBLE', level: 'MAJOR', dedupeKey: `recognition-eligible:${t.id}:${version}`,
        details: { month: t.month, percent: Math.round(capped), score: performance.score, reward: t.reward },
        entityType: 'recognition_target', entityId: t.id, link: '/app',
      }]);
    }
    const eligibleAt = eligible ? (t.eligibleAt ?? now) : t.eligibleAt;
    let stored = t;
    if (status !== t.status || notified.size !== t.notified.length || r1(achievementPercent) !== t.achievementPercent || performance.score !== t.score || (eligible && !t.eligibleAt)) {
      stored = await tx.recognitionTarget.update({ where: { id: t.id }, data: { status, notified: [...notified], achievementPercent: r1(achievementPercent), score: performance.score, eligibleAt } });
    }
    const setter = dir.names.get(t.setById) ?? '';
    const row: RecognitionTargetRow = {
      id: t.id,
      name: t.name,
      month: t.month,
      startsOn: t.startsOn,
      endsOn: t.endsOn,
      person: person ? card(person) : unknownPerson(t.userId, dir.names.get(t.userId) ?? '', dir),
      goals: progress,
      eligibility: t.eligibility as RecognitionTargetRow['eligibility'],
      minAchievementPercent: t.minAchievementPercent,
      minScore: t.minScore,
      conditions: t.conditions,
      description: t.description,
      reward: t.reward,
      achievementPercent,
      performance,
      eligible,
      eligibleAt: eligibleAt?.toISOString() ?? null,
      status,
      setBy: { id: t.setById, name: setter },
      setByLevel: t.setByLevel === 'SUPER' ? 'SUPER' : 'MANAGER',
      editable: !!person && reaches(dir, person, 'targets') && !t.cancelledAt && !over,
      revisions: ((t.revisions as { at: string; byId: string; changes: string[] }[]) ?? []).map((r) => ({ at: r.at, by: dir.names.get(r.byId) ?? '', changes: r.changes })).reverse(),
      createdAt: t.createdAt.toISOString(),
    };
    return { row, stored };
  }

  /**
   * The performance score out of 100: the average of the parts that have data. The goals of this target (each up to
   * 100%), the person's workspace targets for the period, and their task completion. A part without data is left out
   * rather than counted as zero.
   */
  private async score(counter: GoalCounter, userId: string, w: Window, goals: GoalProgress[]): Promise<PerformanceScore> {
    const parts: PerformanceScore['parts'] = [
      { key: 'GOALS', label: 'Employee of the Month goals', value: goals.every((g) => g.measurable) ? averagePercent(goals, true) : null },
      { key: 'TARGETS', label: 'Workspace targets', value: await counter.targetAchievement(userId, w) },
      { key: 'TASKS', label: 'Task completion', value: await counter.taskCompletion(userId, w) },
    ];
    const known = parts.map((p) => p.value).filter((v): v is number => v !== null);
    return { score: known.length ? r1(known.reduce((a, v) => a + v, 0) / known.length) : 0, parts };
  }

  /** The ranking values of one eligible person, in the policy's order. */
  private async values(counter: GoalCounter, e: Evaluated, ranking: RankingCriterion[]): Promise<Partial<Record<RankingCriterion, number | null>>> {
    const w: Window = { first: e.stored.startsOn, last: e.stored.endsOn, start: e.stored.startsAt, end: e.stored.endsAt };
    const out: Partial<Record<RankingCriterion, number | null>> = {};
    for (const c of ranking) {
      if (c === 'ACHIEVEMENT') out[c] = e.row.achievementPercent;
      else if (c === 'SCORE') out[c] = e.row.performance.score;
      else if (c === 'REVENUE') out[c] = await counter.measures.count('REVENUE', [e.stored.userId], w.start, w.end);
      else if (c === 'DEALS_WON') out[c] = await counter.measures.count('DEALS_WON', [e.stored.userId], w.start, w.end);
      else if (c === 'TASK_COMPLETION') out[c] = await counter.taskCompletion(e.stored.userId, w);
      else out[c] = await counter.learningFigure('LEARNING_SCORE', e.stored.userId, w);
    }
    return out;
  }

  /** Eligible people of a scope, best first by the policy's criteria; equal values share a rank. */
  private async rank(counter: GoalCounter, dir: Directory, evaluated: Evaluated[]): Promise<RecognitionCandidate[]> {
    const ranking = dir.policy.ranking;
    const scored: { e: Evaluated; values: Partial<Record<RankingCriterion, number | null>> }[] = [];
    for (const e of evaluated.filter((x) => x.row.eligible)) scored.push({ e, values: await this.values(counter, e, ranking) });
    const cmp = (a: (typeof scored)[number], b: (typeof scored)[number]) => {
      for (const c of ranking) {
        const d = (b.values[c] ?? -1) - (a.values[c] ?? -1);
        if (Math.abs(d) > 1e-9) return d;
      }
      return 0;
    };
    scored.sort((a, b) => cmp(a, b) || a.e.row.person.name.localeCompare(b.e.row.person.name));
    let rank = 0;
    return scored.map((s, i) => {
      if (i === 0 || cmp(scored[i - 1]!, s) !== 0) rank = i + 1;
      return { rank, target: s.e.row, values: s.values, tiedWithNext: i + 1 < scored.length && cmp(s, scored[i + 1]!) === 0 };
    });
  }

  private inScope(dir: Directory, e: Evaluated, teamNodeId: string | null): boolean {
    const p = dir.person(e.stored.userId);
    if (!p || p.node === dir.org.root) return false;
    return teamNodeId ? p.level === 'EXECUTIVE' && p.node.node.parentId === teamNodeId : true;
  }

  private async scope(_tx: TenantTx, dir: Directory, counter: GoalCounter, evaluated: Evaluated[], awards: StoredAward[], teamNodeId: string | null, callerId: string): Promise<RecognitionScopeView> {
    const candidates = await this.rank(counter, dir, evaluated.filter((e) => this.inScope(dir, e, teamNodeId)));
    const award = awards.find((a) => (a.teamNodeId ?? null) === teamNodeId) ?? null;
    const teamNode = teamNodeId ? dir.org.byId.get(teamNodeId) : null;
    const canSelect = !award && (teamNodeId ? dir.isSuper || (dir.me.node.id === teamNodeId && dir.policy.managersSelectTeamWinner) : dir.isSuper) && candidates.length > 0;
    let notice: string | null = null;
    if (!award && candidates.length > 1 && candidates[0]!.tiedWithNext) notice = tr('Tie: {names} have the same ranking. Choose the winner.', { names: candidates.filter((c) => c.rank === 1).map((c) => c.target.person.name).join(', ') });
    return {
      scope: teamNodeId ? 'TEAM' : 'ORGANISATION',
      team: teamNode ? (refOf(teamNode, dir.org, dir.orgName) as WorkspaceRef) : null,
      award: award ? this.awardRow(dir, award, callerId) : null,
      candidates,
      canSelect,
      notice,
    };
  }

  /** The automatic selection for the organisation: the best ranked eligible person, unless the best are tied. */
  private async autoSelect(tx: TenantTx, dir: Directory, month: string, tz: string, actorId: string | null, meta: RequestMeta | undefined): Promise<RecognitionScopeView> {
    const counter = new GoalCounter(tx, dir.org.root.node.tenantId);
    const existing = await tx.recognitionAward.findFirst({ where: { tenantId: dir.org.root.node.tenantId, liveKey: liveKey(month, null) } });
    const stored = await tx.recognitionTarget.findMany({ where: { tenantId: dir.org.root.node.tenantId, month, cancelledAt: null }, take: 1000 });
    const evaluated: Evaluated[] = [];
    for (const t of stored) evaluated.push(await this.evaluate(tx, dir, counter, t, tz));
    const awards = existing ? [existing] : [];
    if (existing) return this.scope(tx, dir, counter, evaluated, awards, null, actorId ?? '');
    const candidates = await this.rank(counter, dir, evaluated.filter((e) => this.inScope(dir, e, null)));
    if (!candidates.length) return { scope: 'ORGANISATION', team: null, award: null, candidates: [], canSelect: false, notice: tr('Nobody is eligible yet, so there is no Employee of the Month to name.') };
    let top = candidates[0]!;
    if (top.tiedWithNext) {
      const tied = candidates.filter((c) => c.rank === 1);
      if (dir.policy.tieBreak === 'EARLIEST_ELIGIBLE') {
        const byTime = [...tied].sort((a, b) => (a.target.eligibleAt ?? '9').localeCompare(b.target.eligibleAt ?? '9'));
        if (byTime[0]!.target.eligibleAt === byTime[1]!.target.eligibleAt) return this.tie(tx, dir, month, tied, candidates);
        top = byTime[0]!;
      } else return this.tie(tx, dir, month, tied, candidates);
    }
    const e = evaluated.find((x) => x.row.id === top.target.id)!;
    const row = await this.store(tx, dir, e, null, 'AUTOMATIC', actorId, `Ranked first by: ${dir.policy.ranking.map((c) => RANKING_CRITERION_LABEL[c]).join(', ')}.`, meta);
    return { scope: 'ORGANISATION', team: null, award: this.awardRow(dir, row, actorId ?? ''), candidates, canSelect: false, notice: null };
  }

  private async tie(tx: TenantTx, dir: Directory, month: string, tied: RecognitionCandidate[], candidates: RecognitionCandidate[]): Promise<RecognitionScopeView> {
    const names = tied.map((c) => c.target.person.name).join(', ');
    await this.notifications.send(tx, dir.org.root.node.tenantId, dir.superAdmins, {
      type: 'recognition.tie',
      title: `Employee of the Month ${month}: a tie to decide`,
      body: `${names} have the same ranking. Choose the winner.`,
      link: `${LINK}?month=${month}`,
      actionRequired: true,
      priority: 'HIGH',
      eventId: `recognition:tie:${month}:${tied.map((c) => c.target.id).sort().join(',')}`,
    });
    return { scope: 'ORGANISATION', team: null, award: null, candidates, canSelect: dir.isSuper, notice: tr('Tie: {names} have the same ranking. Choose the winner.', { names }) };
  }

  /** Stores an award with the figures it was decided on, celebrates it, and tells the people concerned. */
  private async store(tx: TenantTx, dir: Directory, e: Evaluated, teamNodeId: string | null, method: 'AUTOMATIC' | 'MANUAL', actorId: string | null, note: string | null, meta: RequestMeta | undefined): Promise<StoredAward> {
    const tenantId = e.stored.tenantId;
    const key = liveKey(e.stored.month, teamNodeId);
    if (await tx.recognitionAward.findFirst({ where: { tenantId, liveKey: key } }))
      throw new ConflictException({ code: 'AWARD_EXISTS', message: 'Employee of the Month for that month is already named. Withdraw that award first to choose again.' });
    const criteria = e.row.goals.map((g) => describeGoal({ id: g.id, measure: g.measure, amount: g.amount, per: g.per, label: g.label } as StoredGoal)).join('; ');
    const row = await tx.recognitionAward.create({
      data: {
        tenantId,
        month: e.stored.month,
        scope: teamNodeId ? 'TEAM' : 'ORGANISATION',
        teamNodeId,
        liveKey: key,
        userId: e.stored.userId,
        targetId: e.stored.id,
        method,
        achievementPercent: e.row.achievementPercent,
        score: e.row.performance.score,
        goals: e.row.goals.map((g) => ({ label: g.label, required: g.required, done: g.done, unit: g.unit })) as Prisma.InputJsonValue,
        criteria,
        reward: e.stored.reward,
        note,
        selectedById: actorId,
      },
    });
    await tx.recognitionTarget.update({ where: { id: e.stored.id }, data: { status: 'AWARDED' } });
    const team = teamNodeId ? dir.org.byId.get(teamNodeId)?.node.name ?? null : null;
    await this.audit.record(tx, {
      tenantId, actorUserId: actorId, ...(actorId ? {} : { actorType: 'SYSTEM' as const }), action: 'recognition.awarded', entityType: 'recognition_award', entityId: row.id,
      metadata: { person: e.row.person.name, month: row.month, method, scope: row.scope, team, achievementPercent: row.achievementPercent, score: row.score }, meta,
    });
    await this.notifications.send(tx, tenantId, [e.stored.userId], {
      type: 'recognition.awarded',
      title: `Congratulations, ${e.row.person.name}! You have been selected as Employee of the Month.`,
      body: `${row.month}${team ? ` · ${team}` : ''}`,
      link: '/app',
      priority: 'HIGH',
      eventId: `recognition:award:${row.id}`,
      senderId: actorId,
    });
    const others = [...new Set([...e.row.person.managers.map((m) => m.id), e.stored.setById, ...dir.superAdmins])].filter((u) => u !== e.stored.userId && u !== actorId);
    await this.notifications.send(tx, tenantId, others, {
      type: 'recognition.awarded',
      title: `${e.row.person.name} is Employee of the Month`,
      body: `${row.month}${team ? ` · ${team}` : ''}`,
      link: `${LINK}?month=${row.month}`,
      eventId: `recognition:award:${row.id}`,
      senderId: actorId,
    });
    await this.achievements.award(tx, tenantId, [{
      userId: e.stored.userId, kind: 'EMPLOYEE_OF_THE_MONTH', level: 'EXCEPTIONAL', dedupeKey: `employee-of-the-month:${row.id}`,
      details: { month: row.month, scope: row.scope as 'ORGANISATION' | 'TEAM', teamName: team, percent: Math.round(row.achievementPercent), score: row.score, reward: row.reward },
      entityType: 'recognition_award', entityId: row.id, link: '/app',
    }]);
    return row;
  }

  private canRevoke(dir: Directory, a: StoredAward): boolean {
    if (a.revokedAt) return false;
    if (dir.isSuper) return true;
    return !!a.teamNodeId && a.teamNodeId === dir.me.node.id && dir.me.level === 'MANAGER' && dir.policy.managersSelectTeamWinner;
  }

  private awardRow(dir: Directory, a: StoredAward, _callerId: string): RecognitionAwardRow {
    const p = dir.person(a.userId);
    const team = a.teamNodeId ? dir.org.byId.get(a.teamNodeId) : undefined;
    return {
      id: a.id,
      month: a.month,
      scope: a.scope === 'TEAM' ? 'TEAM' : 'ORGANISATION',
      team: team ? (refOf(team, dir.org, dir.orgName) as WorkspaceRef) : null,
      person: p ? card(p) : unknownPerson(a.userId, dir.names.get(a.userId) ?? '', dir),
      method: a.method === 'AUTOMATIC' ? 'AUTOMATIC' : 'MANUAL',
      achievementPercent: a.achievementPercent,
      score: a.score,
      goals: (a.goals as RecognitionAwardRow['goals']) ?? [],
      criteria: a.criteria,
      reward: a.reward,
      note: a.note,
      selectedBy: a.selectedById ? { id: a.selectedById, name: dir.names.get(a.selectedById) ?? '' } : null,
      awardedAt: a.awardedAt.toISOString(),
      revoked: a.revokedAt ? { at: a.revokedAt.toISOString(), by: dir.names.get(a.revokedById ?? '') ?? '', reason: a.revokeReason ?? '' } : null,
      canRevoke: this.canRevoke(dir, a),
    };
  }
}
