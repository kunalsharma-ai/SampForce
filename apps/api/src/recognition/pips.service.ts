import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { nextSequenceValue, type Prisma, transactionLock, type TenantTx } from '@dealflow/database';
import {
  OPEN_PIP_STATUSES,
  PIP_STATUS_LABEL,
  type PipCard,
  type PipCreateInput,
  type PipDecisionInput,
  type PipDetail,
  type PipEvent,
  type PipEventKind,
  type PipReviewFrequency,
  type PipRow,
  type PipsView,
  type PipStatus,
  type PipUpdateInput,
} from '@dealflow/types';
import { randomUUID } from 'node:crypto';
import { AchievementsService } from '../achievements/achievements.service';
import { AuditService } from '../audit/audit.service';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { addDays, dayStart, localDay } from '../task-plans/calendar';
import { SlicedSweep } from '../worker/sliced-sweep';
import { scanTenants } from '../worker/queue';
import { averagePercent, describeGoal, evaluationsOf, GoalCounter, goalsOf, type StoredEvaluation, storeGoals, type Window } from './goals';
import { assertReaches, card, type Directory, loadDirectory, type Person, reachable, reaches, sees, unknownPerson } from './people';
import { timeZoneOf } from './recognition.service';

type Stored = Prisma.PerformancePlanGetPayload<object>;
type StoredEvent = Prisma.PerformancePlanEventGetPayload<object>;

const notFound = () => new NotFoundException({ code: 'NOT_FOUND', message: 'Improvement plan not found.' });
const closedPlan = () => new ConflictException({ code: 'PIP_CLOSED', message: 'This plan is closed and is kept as it was.' });
const OPEN = new Set<string>(OPEN_PIP_STATUSES);
/** Open statuses that SampForce may move to Ready for review by itself (and back, when a goal stops being met). */
const WORKING = new Set<string>(['ACTIVE', 'IN_PROGRESS', 'EXTENDED', 'UNDER_REVIEW']);
const MILESTONES = [50, 75] as const;
const DAY = 86_400_000;
const LINK = '/app/recognition?tab=plans';

const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);

/** Review dates from the frequency, always ending with the plan's last day. */
export function reviewDatesFor(frequency: PipReviewFrequency, startsOn: string, endsOn: string, custom: string[] = []): string[] {
  const out = new Set<string>();
  if (frequency === 'CUSTOM') for (const d of custom) out.add(d);
  else if (frequency === 'MONTHLY') {
    const [y, m, d] = startsOn.split('-').map(Number) as [number, number, number];
    for (let i = 1; i < 24; i++) {
      const at = new Date(Date.UTC(y, m - 1 + i, d)).toISOString().slice(0, 10);
      if (at > endsOn) break;
      out.add(at);
    }
  } else {
    const step = frequency === 'WEEKLY' ? 7 : 14;
    for (let at = addDays(startsOn, step); at <= endsOn; at = addDays(at, step)) out.add(at);
  }
  out.add(endsOn);
  return [...out].filter((d) => d >= startsOn && d <= endsOn).sort();
}

/**
 * Performance Improvement Plans (ADR 0102). The Super Workspace gives plans to managers and executives; a manager gives
 * plans to its own executives when the Super Workspace's policy allows it. Goals are counted from the person's real
 * records over the plan's dates (a manager evaluates what records cannot show). When every goal is met the plan moves
 * to Ready for review by itself, but only a person with the right decides: completed, extended, unsuccessful or
 * cancelled. A passed deadline never closes a plan on its own. Every step is kept in the plan's history.
 */
@Injectable()
export class PipsService {
  private readonly log = new Logger(PipsService.name);
  private readonly sweeper = new SlicedSweep(5 * 60_000, 3_000);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly achievements: AchievementsService,
  ) {}

  // ───────────── Reading ─────────────

  /** The dashboard: the open plan, or a recent completion the person has not closed. Nothing at all otherwise. */
  card(auth: AuthContext): Promise<PipCard> {
    return this.prisma.run(auth, async (tx) => {
      const ctx = await this.context(tx, auth);
      const open = await tx.performancePlan.findFirst({ where: { tenantId: auth.tenantId, userId: auth.userId, status: { in: [...OPEN_PIP_STATUSES] } }, orderBy: { createdAt: 'desc' } });
      const plan = open ? await this.row(tx, ctx, await this.evaluate(tx, ctx, open)) : null;
      const recent = plan
        ? null
        : await tx.performancePlan.findFirst({ where: { tenantId: auth.tenantId, userId: auth.userId, status: 'COMPLETED', completionSeenAt: null, completedAt: { gte: new Date(Date.now() - 14 * DAY) } }, orderBy: { completedAt: 'desc' } });
      return { plan, completed: recent ? await this.row(tx, ctx, recent) : null };
    });
  }

  list(auth: AuthContext): Promise<PipsView> {
    return this.prisma.run(auth, async (tx) => {
      const ctx = await this.context(tx, auth);
      const dir = ctx.dir;
      const rows = await tx.performancePlan.findMany({ where: { tenantId: auth.tenantId }, orderBy: [{ createdAt: 'desc' }], take: 1000 });
      const out: PipRow[] = [];
      for (const r of rows) {
        const p = dir.person(r.userId);
        const mine = r.userId === auth.userId;
        if (mine ? r.status === 'DRAFT' : !(p ? sees(dir, p, auth.userId) : dir.isSuper)) continue;
        out.push(await this.row(tx, ctx, OPEN.has(r.status) ? await this.evaluate(tx, ctx, r) : r));
      }
      const others = out.filter((r) => r.person.id !== auth.userId);
      return {
        level: dir.isSuper ? 'SUPER' : dir.me.level === 'SUPER' ? 'EXECUTIVE' : dir.me.level,
        canAssign: reachable(dir, 'plans').length > 0,
        people: reachable(dir, 'plans'),
        open: others.filter((r) => OPEN.has(r.status)),
        drafts: others.filter((r) => r.status === 'DRAFT'),
        closed: others.filter((r) => !OPEN.has(r.status) && r.status !== 'DRAFT'),
        mine: out.filter((r) => r.person.id === auth.userId),
      };
    });
  }

  get(auth: AuthContext, id: string): Promise<PipDetail> {
    return this.prisma.run(auth, async (tx) => {
      const ctx = await this.context(tx, auth);
      const plan = await this.visible(tx, ctx, id);
      return this.detail(tx, ctx, OPEN.has(plan.status) ? await this.evaluate(tx, ctx, plan) : plan);
    });
  }

  // ───────────── Managing ─────────────

  create(auth: AuthContext, input: PipCreateInput & { goals: NonNullable<PipCreateInput['goals']> }, meta: RequestMeta): Promise<PipDetail> {
    return this.prisma.run(auth, async (tx) => {
      await transactionLock(tx, `pips:${auth.tenantId}`);
      const ctx = await this.context(tx, auth);
      const person = assertReaches(ctx.dir, ctx.dir.person(input.userId), 'plans');
      const already = await tx.performancePlan.findFirst({ where: { tenantId: auth.tenantId, userId: person.id, status: { in: [...OPEN_PIP_STATUSES, 'DRAFT'] } } });
      if (already) throw new ConflictException({ code: 'PIP_EXISTS', message: 'This person already has an open or draft improvement plan. Change that plan instead.' });
      const number = `PIP-${String(await nextSequenceValue(tx, `pip:${auth.tenantId}`)).padStart(4, '0')}`;
      const goals = storeGoals(input.goals);
      const frequency = input.reviewFrequency ?? 'WEEKLY';
      const activate = input.activate ?? true;
      const now = new Date();
      const plan = await tx.performancePlan.create({
        data: {
          tenantId: auth.tenantId,
          number,
          title: input.title,
          userId: person.id,
          employeeCode: input.employeeCode || person.employeeCode,
          reason: input.reason,
          areas: input.areas,
          currentLevel: input.currentLevel || null,
          requiredLevel: input.requiredLevel || null,
          goals: goals as unknown as Prisma.InputJsonValue,
          requiredPercent: input.requiredPercent ?? 100,
          startsOn: input.startsOn,
          endsOn: input.endsOn,
          originalEndsOn: input.endsOn,
          startsAt: dayStart(input.startsOn, ctx.tz),
          endsAt: dayStart(addDays(input.endsOn, 1), ctx.tz),
          reviewFrequency: frequency,
          reviewDates: reviewDatesFor(frequency, input.startsOn, input.endsOn, input.reviewDates),
          status: activate ? 'ACTIVE' : 'DRAFT',
          managerComments: input.managerComments || null,
          documents: (input.documents ?? []) as Prisma.InputJsonValue,
          assignedById: auth.userId,
          assignedByLevel: ctx.dir.isSuper ? 'SUPER' : 'MANAGER',
          activatedAt: activate ? now : null,
          notified: [],
        },
      });
      await this.event(tx, plan, 'CREATED', auth.userId, 'MANAGER', input.managerComments || null, goals.map(describeGoal), input.documents);
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'pip.assigned', entityType: 'performance_plan', entityId: plan.id, metadata: { number, person: person.name, title: plan.title, status: plan.status, endsOn: plan.endsOn }, meta });
      if (activate) await this.announce(tx, ctx, plan, person);
      return this.detail(tx, ctx, activate ? await this.evaluate(tx, ctx, plan) : plan);
    });
  }

  activate(auth: AuthContext, id: string, meta: RequestMeta): Promise<PipDetail> {
    return this.prisma.run(auth, async (tx) => {
      const ctx = await this.context(tx, auth);
      const plan = await this.visible(tx, ctx, id);
      const person = assertReaches(ctx.dir, ctx.dir.person(plan.userId), 'plans');
      if (plan.status !== 'DRAFT') throw new ConflictException({ code: 'PIP_NOT_DRAFT', message: 'Only a draft plan can be started.' });
      const updated = await tx.performancePlan.update({ where: { id }, data: { status: 'ACTIVE', activatedAt: new Date() } });
      await this.event(tx, updated, 'ACTIVATED', auth.userId, 'MANAGER', null, []);
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'pip.activated', entityType: 'performance_plan', entityId: id, metadata: { number: plan.number, person: person.name }, meta });
      await this.announce(tx, ctx, updated, person);
      return this.detail(tx, ctx, await this.evaluate(tx, ctx, updated));
    });
  }

  update(auth: AuthContext, id: string, input: PipUpdateInput, meta: RequestMeta): Promise<PipDetail> {
    return this.prisma.run(auth, async (tx) => {
      const ctx = await this.context(tx, auth);
      const plan = await this.visible(tx, ctx, id);
      const person = assertReaches(ctx.dir, ctx.dir.person(plan.userId), 'plans');
      if (!OPEN.has(plan.status) && plan.status !== 'DRAFT') throw closedPlan();
      const changes: string[] = [];
      const data: Prisma.PerformancePlanUpdateInput = {};
      const text = (k: 'title' | 'reason' | 'currentLevel' | 'requiredLevel' | 'employeeCode', label: string) => {
        const v = input[k];
        if (v === undefined) return;
        const next = v || (k === 'title' || k === 'reason' ? plan[k] : null);
        if (next !== plan[k]) {
          changes.push(`${label}: ${plan[k] ?? '—'} → ${next ?? '—'}`);
          (data as Record<string, unknown>)[k] = next;
        }
      };
      text('title', 'Title');
      text('reason', 'Reason');
      text('currentLevel', 'Current performance level');
      text('requiredLevel', 'Required performance level');
      text('employeeCode', 'Employee code');
      if (input.areas && input.areas.join('|') !== plan.areas.join('|')) { changes.push(`Areas to improve: ${plan.areas.join(', ')} → ${input.areas.join(', ')}`); data.areas = input.areas; }
      const old = goalsOf(plan.goals);
      let goalsChanged = false;
      if (input.goals) {
        const goals = storeGoals(input.goals, old);
        const before = old.map(describeGoal).join('; ');
        const after = goals.map(describeGoal).join('; ');
        if (before !== after) { changes.push(`Goals: ${before} → ${after}`); data.goals = goals as unknown as Prisma.InputJsonValue; goalsChanged = true; }
      }
      if (input.requiredPercent !== undefined && input.requiredPercent !== plan.requiredPercent) { changes.push(`Required improvement: ${plan.requiredPercent}% → ${input.requiredPercent}%`); data.requiredPercent = input.requiredPercent; goalsChanged = true; }
      if (input.reviewFrequency !== undefined || input.reviewDates !== undefined) {
        const freq = input.reviewFrequency ?? (plan.reviewFrequency as PipReviewFrequency);
        const dates = reviewDatesFor(freq, plan.startsOn, plan.endsOn, input.reviewDates ?? plan.reviewDates);
        if (freq !== plan.reviewFrequency || dates.join() !== plan.reviewDates.join()) { changes.push(`Review dates: ${plan.reviewDates.join(', ')} → ${dates.join(', ')}`); data.reviewFrequency = freq; data.reviewDates = dates; }
      }
      if (input.documents) { changes.push('Supporting documents changed'); data.documents = input.documents as Prisma.InputJsonValue; }
      if (!changes.length) return this.detail(tx, ctx, plan);
      // New goals open the milestones and the ready-for-review step again; goals met before stay recorded in history.
      if (goalsChanged) data.notified = plan.notified.filter((k) => k.startsWith('review:'));
      const updated = await tx.performancePlan.update({ where: { id }, data });
      await this.event(tx, updated, 'UPDATED', auth.userId, 'MANAGER', input.comment || null, changes);
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'pip.updated', entityType: 'performance_plan', entityId: id, metadata: { number: plan.number, person: person.name, changes }, meta });
      if (updated.status !== 'DRAFT') {
        const n = await tx.performancePlanEvent.count({ where: { tenantId: auth.tenantId, planId: id } });
        await this.notifications.send(tx, auth.tenantId, [person.id], {
          type: 'pip.updated', title: `Your improvement plan ${plan.number} was updated`, body: [input.comment, ...changes].filter(Boolean).join('\n'), link: '/app', eventId: `pip:${id}:update:${n}`, senderId: auth.userId,
        });
      }
      return this.detail(tx, ctx, OPEN.has(updated.status) ? await this.evaluate(tx, ctx, updated) : updated);
    });
  }

  /** The person confirms they have read the plan. */
  acknowledge(auth: AuthContext, id: string, comment: string | undefined, meta: RequestMeta): Promise<PipDetail> {
    return this.prisma.run(auth, async (tx) => {
      const ctx = await this.context(tx, auth);
      const plan = await this.visible(tx, ctx, id);
      if (plan.userId !== auth.userId) throw new ConflictException({ code: 'PIP_NOT_YOURS', message: 'Only the person on the plan can do this.' });
      if (!OPEN.has(plan.status)) throw closedPlan();
      if (plan.acknowledgedAt) return this.detail(tx, ctx, plan);
      const status: PipStatus = plan.status === 'ACTIVE' ? 'IN_PROGRESS' : (plan.status as PipStatus);
      const updated = await tx.performancePlan.update({ where: { id }, data: { acknowledgedAt: new Date(), status } });
      await this.event(tx, updated, 'ACKNOWLEDGED', auth.userId, 'EMPLOYEE', comment?.trim() || null, []);
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'pip.acknowledged', entityType: 'performance_plan', entityId: id, metadata: { number: plan.number }, meta });
      const person = ctx.dir.person(plan.userId);
      await this.notifications.send(tx, auth.tenantId, this.reviewers(ctx.dir, plan, person), {
        type: 'pip.acknowledged', title: `${person?.name ?? ''} acknowledged improvement plan ${plan.number}`, body: comment?.trim() || null, link: `${LINK}&plan=${id}`, eventId: `pip:${id}:ack`, senderId: auth.userId,
      });
      return this.detail(tx, ctx, await this.evaluate(tx, ctx, updated));
    });
  }

  comment(auth: AuthContext, id: string, body: string, documents: { name: string; url: string }[] | undefined, meta: RequestMeta): Promise<PipDetail> {
    return this.prisma.run(auth, async (tx) => {
      const ctx = await this.context(tx, auth);
      const plan = await this.visible(tx, ctx, id);
      const person = ctx.dir.person(plan.userId);
      const employee = plan.userId === auth.userId;
      if (!employee && !(person && (reaches(ctx.dir, person, 'plans') || reaches(ctx.dir, person, 'decide')))) throw new ConflictException({ code: 'PIP_NOT_YOURS', message: 'Only the person on the plan and the people who manage it can comment.' });
      if (plan.status === 'DRAFT' && employee) throw notFound();
      await this.event(tx, plan, 'COMMENT', auth.userId, employee ? 'EMPLOYEE' : 'MANAGER', body, [], documents);
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'pip.commented', entityType: 'performance_plan', entityId: id, metadata: { number: plan.number }, meta });
      const n = await tx.performancePlanEvent.count({ where: { tenantId: auth.tenantId, planId: id } });
      const to = employee ? this.reviewers(ctx.dir, plan, person) : [plan.userId];
      if (plan.status !== 'DRAFT')
        await this.notifications.send(tx, auth.tenantId, to, {
          type: 'pip.comment', title: `New comment on improvement plan ${plan.number}`, body, link: employee ? `${LINK}&plan=${id}` : '/app', eventId: `pip:${id}:comment:${n}`, senderId: auth.userId,
        });
      return this.detail(tx, ctx, plan);
    });
  }

  /** A manager's evaluation of a goal that records cannot measure. */
  evaluateGoal(auth: AuthContext, id: string, input: { goalId: string; score: number; comments: string }, meta: RequestMeta): Promise<PipDetail> {
    return this.prisma.run(auth, async (tx) => {
      const ctx = await this.context(tx, auth);
      const plan = await this.visible(tx, ctx, id);
      const person = this.manager(ctx.dir, plan);
      if (!OPEN.has(plan.status)) throw closedPlan();
      const goal = goalsOf(plan.goals).find((g) => g.id === input.goalId);
      if (!goal || goal.measure !== 'MANUAL') throw new BadRequestException({ code: 'NOT_A_MANUAL_GOAL', message: 'Only a goal marked for manager evaluation can be scored.' });
      const evaluation: StoredEvaluation = { id: randomUUID().slice(0, 12), goalId: goal.id, score: input.score, comments: input.comments, evaluatorId: auth.userId, at: new Date().toISOString() };
      const updated = await tx.performancePlan.update({ where: { id }, data: { evaluations: [...evaluationsOf(plan.evaluations), evaluation] as unknown as Prisma.InputJsonValue } });
      await this.event(tx, updated, 'EVALUATION', auth.userId, 'MANAGER', input.comments, [`${goal.label || describeGoal(goal)}: ${input.score} / 100`]);
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'pip.evaluated', entityType: 'performance_plan', entityId: id, metadata: { number: plan.number, person: person.name, score: input.score }, meta });
      await this.notifications.send(tx, auth.tenantId, [plan.userId], {
        type: 'pip.evaluated', title: `Your manager evaluated improvement plan ${plan.number}`, body: `${input.score} / 100: ${input.comments}`, link: '/app', eventId: `pip:${id}:eval:${evaluation.id}`, senderId: auth.userId,
      });
      return this.detail(tx, ctx, await this.evaluate(tx, ctx, updated));
    });
  }

  /** Review notes; the plan is Under review until it is decided (unless every goal is met, which is Ready for review). */
  review(auth: AuthContext, id: string, input: { notes: string; nextReviewOn?: string }, meta: RequestMeta): Promise<PipDetail> {
    return this.prisma.run(auth, async (tx) => {
      const ctx = await this.context(tx, auth);
      const plan = await this.visible(tx, ctx, id);
      const person = this.manager(ctx.dir, plan);
      if (!OPEN.has(plan.status)) throw closedPlan();
      if (input.nextReviewOn && (input.nextReviewOn < plan.startsOn || input.nextReviewOn > plan.endsOn)) throw new BadRequestException({ code: 'INVALID_DATES', message: 'Review dates must be inside the plan.' });
      const dates = input.nextReviewOn ? [...new Set([...plan.reviewDates, input.nextReviewOn])].sort() : plan.reviewDates;
      const status: PipStatus = plan.status === 'READY_FOR_REVIEW' ? 'READY_FOR_REVIEW' : 'UNDER_REVIEW';
      const updated = await tx.performancePlan.update({ where: { id }, data: { status, reviewDates: dates } });
      await this.event(tx, updated, 'REVIEW', auth.userId, 'MANAGER', input.notes, input.nextReviewOn ? [`Next review: ${input.nextReviewOn}`] : []);
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'pip.reviewed', entityType: 'performance_plan', entityId: id, metadata: { number: plan.number, person: person.name }, meta });
      const n = await tx.performancePlanEvent.count({ where: { tenantId: auth.tenantId, planId: id } });
      await this.notifications.send(tx, auth.tenantId, [plan.userId], {
        type: 'pip.reviewed', title: `Review notes on improvement plan ${plan.number}`, body: input.notes, link: '/app', eventId: `pip:${id}:review:${n}`, senderId: auth.userId,
      });
      return this.detail(tx, ctx, await this.evaluate(tx, ctx, updated));
    });
  }

  decide(auth: AuthContext, id: string, input: PipDecisionInput, meta: RequestMeta): Promise<PipDetail> {
    return this.prisma.run(auth, async (tx) => {
      const ctx = await this.context(tx, auth);
      const found = await this.visible(tx, ctx, id);
      const person = assertReaches(ctx.dir, ctx.dir.person(found.userId), 'decide');
      if (!OPEN.has(found.status)) throw closedPlan();
      const plan = await this.evaluate(tx, ctx, found);
      const now = new Date();
      let data: Prisma.PerformancePlanUpdateInput;
      let kind: PipEventKind;
      const changes: string[] = [];
      if (input.decision === 'COMPLETE') {
        const ready = this.ready(plan);
        if (!ready) throw new ConflictException({ code: 'PIP_GOALS_NOT_MET', message: 'The plan’s goals are not met yet. Update the goals, extend the plan or record another decision.' });
        data = { status: 'COMPLETED', completedAt: now, closedAt: now, closedById: auth.userId, closingComment: input.comment };
        kind = 'COMPLETED';
      } else if (input.decision === 'EXTEND') {
        const endsOn = input.endsOn!;
        if (endsOn <= plan.endsOn) throw new BadRequestException({ code: 'INVALID_DATES', message: 'The new end date must be after the current one.' });
        data = { status: 'EXTENDED', endsOn, endsAt: dayStart(addDays(endsOn, 1), ctx.tz), reviewDates: [...new Set([...plan.reviewDates, endsOn])].sort(), notified: plan.notified.filter((k) => k !== 'ready') };
        kind = 'EXTENDED';
        changes.push(`End date: ${plan.endsOn} → ${endsOn}`);
      } else if (input.decision === 'UNSUCCESSFUL') {
        data = { status: 'UNSUCCESSFUL', closedAt: now, closedById: auth.userId, closingComment: input.comment };
        kind = 'UNSUCCESSFUL';
      } else {
        data = { status: 'CANCELLED', closedAt: now, closedById: auth.userId, closingComment: input.comment };
        kind = 'CANCELLED';
      }
      const updated = await tx.performancePlan.update({ where: { id }, data });
      await this.event(tx, updated, kind, auth.userId, 'MANAGER', input.comment, changes);
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: `pip.${kind.toLowerCase()}`, entityType: 'performance_plan', entityId: id, metadata: { number: plan.number, person: person.name, comment: input.comment, ...(changes.length ? { changes } : {}) }, meta });
      const TITLE: Record<string, string> = {
        COMPLETED: `Well done! Improvement plan ${plan.number} is successfully completed`,
        EXTENDED: `Improvement plan ${plan.number} was extended to ${updated.endsOn}`,
        UNSUCCESSFUL: `Improvement plan ${plan.number} was closed as unsuccessful`,
        CANCELLED: `Improvement plan ${plan.number} was cancelled`,
      };
      await this.notifications.send(tx, auth.tenantId, [plan.userId], {
        type: `pip.${kind.toLowerCase()}`, title: TITLE[kind]!, body: input.comment, link: '/app', priority: kind === 'COMPLETED' ? 'HIGH' : 'NORMAL', eventId: `pip:${id}:${kind.toLowerCase()}:${updated.endsOn}`, senderId: auth.userId,
      });
      const followers = this.reviewers(ctx.dir, plan, person).filter((u) => u !== auth.userId);
      await this.notifications.send(tx, auth.tenantId, followers, {
        type: `pip.${kind.toLowerCase()}`, title: `Improvement plan ${plan.number} of ${person.name}: ${PIP_STATUS_LABEL[updated.status as PipStatus]}`, body: input.comment, link: `${LINK}&plan=${id}`, eventId: `pip:${id}:${kind.toLowerCase()}:${updated.endsOn}`, senderId: auth.userId,
      });
      if (kind === 'COMPLETED')
        await this.achievements.award(tx, auth.tenantId, [{
          userId: plan.userId, kind: 'PIP_COMPLETED', level: 'MAJOR', dedupeKey: `pip-completed:${id}`,
          details: { planNumber: plan.number, planTitle: plan.title, percent: Math.round(plan.percent) }, entityType: 'performance_plan', entityId: id, link: '/app',
        }]);
      return this.detail(tx, ctx, OPEN.has(updated.status) ? await this.evaluate(tx, ctx, updated) : updated);
    });
  }

  /** The person closes the "plan completed" message on their dashboard. */
  dismissCompletion(auth: AuthContext, id: string): Promise<void> {
    return this.prisma.run(auth, async (tx) => {
      const plan = await tx.performancePlan.findFirst({ where: { id, tenantId: auth.tenantId, userId: auth.userId } });
      if (!plan) throw notFound();
      if (!plan.completionSeenAt) await tx.performancePlan.update({ where: { id }, data: { completionSeenAt: new Date() } });
    });
  }

  // ───────────── Worker ─────────────

  /** Counts open plans (goal, milestone and ready-for-review notices) and sends review reminders. */
  sweep(force = false): Promise<number> {
    return this.sweeper.run(
      force,
      async () => scanTenants(this.prisma.performancePlan, { status: { in: [...OPEN_PIP_STATUSES] } }),
      async (tenantId) => {
        try {
          await this.prisma.run({ tenantId }, async (tx) => {
            const admin = await tx.membership.findFirst({ where: { tenantId, status: 'ACTIVE', role: { permissions: { has: 'members:manage' } }, OR: [{ workspaceNodeId: null }, { workspaceNodeId: { isSet: false } }] }, orderBy: { createdAt: 'asc' } });
            if (!admin) return 0;
            const ctx = await this.context(tx, { userId: admin.userId, tenantId, permissions: ['members:manage'], workspaceNodeId: null } as unknown as AuthContext);
            const plans = await tx.performancePlan.findMany({ where: { tenantId, status: { in: [...OPEN_PIP_STATUSES] } }, take: 500 });
            for (const p of plans) await this.evaluate(tx, ctx, p);
            return plans.length;
          });
        } catch (err) {
          this.log.warn({ err: err instanceof Error ? err.message : err, tenantId }, 'improvement plan sweep failed');
        }
      },
    );
  }

  // ───────────── Helpers ─────────────

  private async context(tx: TenantTx, auth: AuthContext) {
    const dir = await loadDirectory(tx, auth);
    const tz = await timeZoneOf(tx, auth.tenantId);
    return { auth, dir, tz, today: localDay(new Date(), tz), counter: new GoalCounter(tx, auth.tenantId) };
  }

  /** A plan the caller may open: their own (once started), or one of a person in their reach. */
  private async visible(tx: TenantTx, ctx: Awaited<ReturnType<PipsService['context']>>, id: string): Promise<Stored> {
    const plan = await tx.performancePlan.findFirst({ where: { id, tenantId: ctx.auth.tenantId } });
    if (!plan) throw notFound();
    const p = ctx.dir.person(plan.userId);
    if (plan.userId === ctx.auth.userId) {
      if (plan.status === 'DRAFT') throw notFound();
      return plan;
    }
    if (!(p ? sees(ctx.dir, p, ctx.auth.userId) : ctx.dir.isSuper)) throw notFound();
    return plan;
  }

  /** The caller manages this plan: assigns (or decides) for its person. */
  private manager(dir: Directory, plan: Stored): Person {
    const p = dir.person(plan.userId);
    if (p && reaches(dir, p, 'decide')) return p;
    return assertReaches(dir, p, 'plans');
  }

  /** Who reviews a plan: the person's managers, whoever assigned it, and the Super Workspace when its policy says so. */
  private reviewers(dir: Directory, plan: Stored, person: Person | undefined): string[] {
    return [...new Set([...(person?.managers.map((m) => m.id) ?? []), plan.assignedById, ...(dir.policy.superFollowsAllPlans || plan.assignedByLevel === 'SUPER' ? dir.superAdmins : [])])].filter((u) => u !== plan.userId);
  }

  private ready(plan: Stored): boolean {
    return plan.percent >= plan.requiredPercent - 1e-9 && (plan.requiredPercent < 100 || plan.goalsMet === goalsOf(plan.goals).length);
  }

  private async announce(tx: TenantTx, ctx: Awaited<ReturnType<PipsService['context']>>, plan: Stored, person: Person): Promise<void> {
    await this.notifications.send(tx, ctx.auth.tenantId, [person.id], {
      type: 'pip.assigned',
      title: `Performance Improvement Plan ${plan.number}: ${plan.title}`,
      body: `Complete the plan’s goals by ${plan.endsOn} to clear it. Open your dashboard to see the goals and acknowledge the plan.`,
      link: '/app',
      priority: 'HIGH',
      actionRequired: true,
      eventId: `pip:${plan.id}:assigned`,
      senderId: ctx.auth.userId,
    });
  }

  private async event(tx: TenantTx, plan: Stored, kind: PipEventKind, actorId: string | null, role: 'EMPLOYEE' | 'MANAGER' | 'SYSTEM', body: string | null, changes: string[], documents?: { name: string; url: string }[]) {
    await tx.performancePlanEvent.create({ data: { tenantId: plan.tenantId, planId: plan.id, kind, actorId, actorRole: role, body, changes, documents: (documents ?? []) as Prisma.InputJsonValue } });
  }

  /**
   * Counts an open plan's goals, stores the figures, records goals met, and moves it to Ready for review (or back)
   * as the numbers say. Notices go out once each (the plan remembers what it sent).
   */
  private async evaluate(tx: TenantTx, ctx: Awaited<ReturnType<PipsService['context']>>, plan: Stored): Promise<Stored> {
    if (!OPEN.has(plan.status)) return plan;
    const goals = goalsOf(plan.goals);
    const w: Window = { first: plan.startsOn, last: plan.endsOn, start: plan.startsAt, end: plan.endsAt };
    const progress = await ctx.counter.progress(goals, plan.userId, w, { evaluations: evaluationsOf(plan.evaluations) });
    const percent = averagePercent(progress, true);
    const met = progress.filter((g) => g.met).length;
    const notified = new Set(plan.notified);
    const person = ctx.dir.person(plan.userId);
    const reviewers = this.reviewers(ctx.dir, plan, person);
    const name = person?.name ?? '';

    for (const g of progress.filter((x) => x.met)) {
      const key = `goal:${g.id}`;
      if (notified.has(key)) continue;
      notified.add(key);
      await this.event(tx, plan, 'GOAL_MET', null, 'SYSTEM', null, [`${g.label}: ${g.done} of ${g.required}`]);
      await this.notifications.send(tx, plan.tenantId, [plan.userId], { type: 'pip.target_completed', title: `Goal met on your improvement plan: ${g.label}`, body: plan.title, link: '/app', eventId: `pip:${plan.id}:goal:${g.id}:${g.required}` });
      await this.notifications.send(tx, plan.tenantId, reviewers, { type: 'pip.target_completed', title: `${name} met a goal of ${plan.number}: ${g.label}`, body: plan.title, link: `${LINK}&plan=${plan.id}`, eventId: `pip:${plan.id}:goal:${g.id}:${g.required}` });
    }
    for (const m of MILESTONES) {
      const key = `m${m}`;
      if (percent >= m && percent < 100 && !notified.has(key)) {
        notified.add(key);
        await this.notifications.send(tx, plan.tenantId, [plan.userId, ...reviewers], {
          type: 'pip.milestone', title: `Improvement plan ${plan.number} is ${m}% complete`, body: `${name}: ${plan.title}`, link: '/app', eventId: `pip:${plan.id}:m${m}:${goals.map((g) => g.amount).join("-")}`,
        });
      }
    }

    let status = plan.status as PipStatus;
    let readyAt = plan.readyAt;
    const allMeasurable = progress.every((g) => g.measurable);
    const ready = allMeasurable && percent >= plan.requiredPercent - 1e-9 && (plan.requiredPercent < 100 || met === goals.length);
    if (ready && WORKING.has(status)) {
      status = 'READY_FOR_REVIEW';
      readyAt = new Date();
      if (!notified.has('ready')) {
        notified.add('ready');
        await this.event(tx, plan, 'READY_FOR_REVIEW', null, 'SYSTEM', null, [`${met} of ${goals.length} goals met`]);
        await this.notifications.send(tx, plan.tenantId, reviewers, {
          type: 'pip.ready_for_review', title: `${name} met every goal of ${plan.number}: ready for review`, body: plan.title, link: `${LINK}&plan=${plan.id}`, priority: 'HIGH', actionRequired: true, eventId: `pip:${plan.id}:ready:${plan.endsOn}`,
        });
        await this.notifications.send(tx, plan.tenantId, [plan.userId], {
          type: 'pip.ready_for_review', title: `Every goal of ${plan.number} is met`, body: 'Your manager will review the plan and confirm it.', link: '/app', eventId: `pip:${plan.id}:ready:${plan.endsOn}`,
        });
      }
    } else if (!ready && status === 'READY_FOR_REVIEW') {
      // A record was deleted or a goal changed: back to work, honestly.
      status = plan.endsOn !== plan.originalEndsOn ? 'EXTENDED' : plan.acknowledgedAt ? 'IN_PROGRESS' : 'ACTIVE';
      readyAt = null;
      notified.delete('ready');
    }

    // Review reminders, a few days ahead as the policy says, once per review date.
    const next = plan.reviewDates.find((d) => d >= ctx.today) ?? null;
    if (next && daysBetween(ctx.today, next) <= ctx.dir.policy.reviewReminderDays && !notified.has(`review:${next}`)) {
      notified.add(`review:${next}`);
      await this.notifications.send(tx, plan.tenantId, reviewers, {
        type: 'pip.review_due', title: `Review of ${name}’s improvement plan ${plan.number} is due on ${next}`, body: plan.title, link: `${LINK}&plan=${plan.id}`, actionRequired: true, eventId: `pip:${plan.id}:review:${next}`,
      });
      await this.notifications.send(tx, plan.tenantId, [plan.userId], {
        type: 'pip.review_due', title: `Your improvement plan review is on ${next}`, body: plan.title, link: '/app', eventId: `pip:${plan.id}:review:${next}`,
      });
    }

    const changed = status !== plan.status || percent !== plan.percent || met !== plan.goalsMet || notified.size !== plan.notified.length || [...notified].some((k) => !plan.notified.includes(k));
    if (!changed) return plan;
    return tx.performancePlan.update({ where: { id: plan.id }, data: { status, percent, goalsMet: met, notified: [...notified], readyAt } });
  }

  private async row(tx: TenantTx, ctx: Awaited<ReturnType<PipsService['context']>>, plan: Stored, events?: StoredEvent[]): Promise<PipRow> {
    const dir = ctx.dir;
    const p = dir.person(plan.userId);
    const goals = goalsOf(plan.goals);
    const w: Window = { first: plan.startsOn, last: plan.endsOn, start: plan.startsAt, end: plan.endsAt };
    const progress = await ctx.counter.progress(goals, plan.userId, w, { evaluations: evaluationsOf(plan.evaluations), names: dir.names });
    const evs = events ?? (await tx.performancePlanEvent.findMany({ where: { tenantId: plan.tenantId, planId: plan.id, kind: { in: ['COMMENT', 'REVIEW', 'EVALUATION', 'ACKNOWLEDGED', 'CREATED'] } }, orderBy: { createdAt: 'desc' }, take: 50 }));
    const newest = (role: string) => [...evs].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).find((e) => e.actorRole === role && e.body)?.body ?? null;
    const open = OPEN.has(plan.status);
    const mine = plan.userId === ctx.auth.userId;
    const manages = !!p && reaches(dir, p, 'plans');
    const decides = !!p && reaches(dir, p, 'decide');
    return {
      id: plan.id,
      number: plan.number,
      title: plan.title,
      person: p ? card(p) : unknownPerson(plan.userId, dir.names.get(plan.userId) ?? '', dir),
      assignedBy: { id: plan.assignedById, name: dir.names.get(plan.assignedById) ?? '', level: plan.assignedByLevel === 'SUPER' ? 'SUPER' : 'MANAGER' },
      reason: plan.reason,
      areas: plan.areas,
      currentLevel: plan.currentLevel,
      requiredLevel: plan.requiredLevel,
      goals: progress,
      requiredPercent: plan.requiredPercent,
      currency: await ctx.counter.measures.baseCurrency(),
      percent: open ? averagePercent(progress, true) : plan.percent,
      goalsMet: open ? progress.filter((g) => g.met).length : plan.goalsMet,
      startsOn: plan.startsOn,
      endsOn: plan.endsOn,
      originalEndsOn: plan.originalEndsOn,
      daysRemaining: daysBetween(ctx.today, plan.endsOn) + 1,
      reviewFrequency: plan.reviewFrequency as PipReviewFrequency,
      reviewDates: plan.reviewDates,
      nextReviewOn: open ? (plan.reviewDates.find((d) => d >= ctx.today) ?? null) : null,
      status: plan.status as PipStatus,
      acknowledgedAt: plan.acknowledgedAt?.toISOString() ?? null,
      completedAt: plan.completedAt?.toISOString() ?? null,
      closedAt: plan.closedAt?.toISOString() ?? null,
      closingComment: plan.closingComment,
      managerFeedback: newest('MANAGER') ?? plan.managerComments,
      employeeComment: newest('EMPLOYEE'),
      documents: (plan.documents as { name: string; url: string }[]) ?? [],
      can: {
        edit: manages && (open || plan.status === 'DRAFT'),
        decide: decides && open,
        evaluate: (manages || decides) && open,
        review: (manages || decides) && open,
        acknowledge: mine && open && !plan.acknowledgedAt,
        comment: (mine && plan.status !== 'DRAFT') || manages || decides,
        activate: manages && plan.status === 'DRAFT',
      },
      createdAt: plan.createdAt.toISOString(),
    };
  }

  private async detail(tx: TenantTx, ctx: Awaited<ReturnType<PipsService['context']>>, plan: Stored): Promise<PipDetail> {
    const events = await tx.performancePlanEvent.findMany({ where: { tenantId: plan.tenantId, planId: plan.id }, orderBy: { createdAt: 'desc' }, take: 300 });
    const row = await this.row(tx, ctx, plan, events);
    return {
      ...row,
      events: events.map(
        (e): PipEvent => ({
          id: e.id,
          kind: e.kind as PipEventKind,
          by: e.actorId ? { id: e.actorId, name: ctx.dir.names.get(e.actorId) ?? '', role: e.actorRole as 'EMPLOYEE' | 'MANAGER' } : e.actorRole === 'SYSTEM' ? { id: '', name: 'SampForce', role: 'SYSTEM' } : null,
          body: e.body,
          changes: e.changes,
          documents: (e.documents as { name: string; url: string }[]) ?? [],
          at: e.createdAt.toISOString(),
        }),
      ),
    };
  }
}
