import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { type Prisma, type TenantTx } from '@dealflow/database';
import {
  type CadenceChannel,
  cadenceTaskTitle,
  type ContactCadence,
  type FollowUpCadence,
  type followUpCadenceSchema,
  type FollowUpCadenceSettings,
  type InitialEmailInput,
  type InitialEmailSource,
  isSettledPhase,
  nextFollowUpDue,
  parseFollowUpCadence,
  type ResolvedCadence,
  type StageChangeSource,
  type StageKey,
} from '@dealflow/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { hasFeature } from '../billing/entitlements';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { badRef as invalid, notFound } from './crm-helpers';
import { errorMessage, scan } from '../worker/queue';
import { cadenceSettingOf, cadenceStates, resolvedCadences } from './cadence-state';
import { localDay } from './crm-reminders.service';
import { EmployeeStagesService } from './employee-stages.service';
import { inSuperWorkspace } from './super-workspace';
import { contactScope, visibility } from './visibility';

/** Who caused something: a signed-in person, or the owner of a synced mailbox. */
export type Actor = Pick<AuthContext, 'tenantId' | 'userId'>;

/** Stages that may start the cadence: the employee has had no outreach yet. */
const BEFORE_OUTREACH: (StageKey | null)[] = [null, 'NEW_CONTACT', 'FRESH_EMAIL_PENDING'];
/** Phases the cadence keeps running in; anything later (an RFQ, a reply, a call) means the employee answered. */
const CADENCE_PHASES = new Set(['NEW', 'FOLLOW_UP']);

const unset = (field: string) => [{ [field]: null }, { [field]: { isSet: false } }];
const DAY = 86_400_000;
const STAGE_SOURCE: Record<InitialEmailSource, Exclude<StageChangeSource, 'MANUAL'>> = { SENT: 'EMAIL', MAILBOX: 'EMAIL', LOGGED: 'INTERACTION', MANUAL: 'CADENCE' };
/** What the follow-up asks the owner to do, by how it is made. */
const NEXT_ACTION: Record<CadenceChannel, (step: number) => string> = {
  EMAIL: (n) => (n === 1 ? 'Send the first follow-up email.' : `Send follow-up email ${n}.`),
  CALL: (n) => `Call them for follow-up ${n}.`,
  WHATSAPP: (n) => `Send follow-up ${n} on WhatsApp.`,
  LINKEDIN: (n) => `Send follow-up ${n} on LinkedIn.`,
  MEETING: (n) => `Ask for a meeting (follow-up ${n}).`,
};
type CadenceInput = z.output<typeof followUpCadenceSchema>;

/**
 * The follow-up cadence (redesign R3, ADR 0083). New employees start in Fresh Email Pending; the first email moves them
 * to Initial Email Sent and plans follow-up 1; each completed follow-up plans the next until the Super Workspace's
 * number is reached. An answer of any kind stops it and cancels the follow-up still planned. Every step is a real
 * follow-up task, so reminders, overdue alerts, the Follow-ups page and dashboards see it like any other.
 */
@Injectable()
export class FollowUpCadenceService {
  private readonly log = new Logger(FollowUpCadenceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stages: EmployeeStagesService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  // ───────────── Settings ─────────────

  cadenceOf(tx: TenantTx, tenantId: string): Promise<FollowUpCadence> {
    return cadenceSettingOf(tx, tenantId);
  }

  settings(auth: AuthContext): Promise<FollowUpCadenceSettings> {
    return this.prisma.run(auth, async (tx) => this.settingsIn(tx, auth));
  }

  private async settingsIn(tx: TenantTx, auth: AuthContext): Promise<FollowUpCadenceSettings> {
    const row = await tx.crmSettings.findUnique({ where: { tenantId: auth.tenantId }, select: { followUpCadence: true } });
    const raw = (row?.followUpCadence ?? {}) as Record<string, unknown>;
    const byId = typeof raw.updatedById === 'string' ? raw.updatedById : null;
    const by = byId ? await tx.user.findUnique({ where: { id: byId }, select: { id: true, name: true } }) : null;
    const value = parseFollowUpCadence(raw);
    return {
      ...value,
      ruleTargets: await this.ruleTargets(tx, auth.tenantId, value),
      canEdit: auth.permissions.includes('crm:configure') && (await inSuperWorkspace(tx, auth)),
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : null,
      updatedBy: by,
    };
  }

  /** Only the Super Workspace sets the cadence for the organisation (Kunal: "into my super workspace"). */
  setSettings(auth: AuthContext, input: CadenceInput, meta: RequestMeta): Promise<FollowUpCadenceSettings> {
    return this.prisma.run(auth, async (tx) => {
      if (!(await inSuperWorkspace(tx, auth))) {
        throw new ForbiddenException({ code: 'CADENCE_SUPER_ONLY', message: 'Only the Super Workspace sets the follow-up cadence.' });
      }
      const before = await this.cadenceOf(tx, auth.tenantId);
      // Fields left out keep their value: older clients send only the count and the interval.
      const next: FollowUpCadence = {
        followUps: input.followUps,
        intervalDays: input.intervalDays,
        firstFollowUpDays: input.firstFollowUpDays === undefined ? before.firstFollowUpDays : input.firstFollowUpDays,
        channel: input.channel ?? before.channel,
        rules: input.rules ?? before.rules,
      };
      await this.checkRuleTargets(tx, auth.tenantId, next);
      const value = { ...next, updatedAt: new Date().toISOString(), updatedById: auth.userId };
      await tx.crmSettings.upsert({
        where: { tenantId: auth.tenantId },
        create: { tenantId: auth.tenantId, followUpCadence: value as unknown as Prisma.InputJsonValue, updatedById: auth.userId },
        update: { followUpCadence: value as unknown as Prisma.InputJsonValue, updatedById: auth.userId },
      });
      await this.audit.record(tx, {
        tenantId: auth.tenantId, actorUserId: auth.userId, action: 'crm_settings.follow_up_cadence_updated', entityType: 'tenant', entityId: auth.tenantId,
        metadata: { before, after: next }, meta,
      });
      return this.settingsIn(tx, auth);
    });
  }

  /** Names of the companies and teams the rules name. */
  private async ruleTargets(tx: TenantTx, tenantId: string, c: FollowUpCadence): Promise<Record<string, string | null>> {
    const companyIds = c.rules.filter((r) => r.scope === 'COMPANY').map((r) => r.targetId);
    const teamIds = c.rules.filter((r) => r.scope === 'TEAM').map((r) => r.targetId);
    const [companies, teams] = await Promise.all([
      companyIds.length ? tx.company.findMany({ where: { tenantId, id: { in: companyIds }, deletedAt: null }, select: { id: true, name: true } }) : [],
      teamIds.length ? tx.workspaceNode.findMany({ where: { tenantId, id: { in: teamIds } }, select: { id: true, name: true } }) : [],
    ]);
    const names = new Map([...companies, ...teams].map((x) => [x.id, x.name]));
    return Object.fromEntries(c.rules.map((r) => [r.targetId, names.get(r.targetId) ?? null]));
  }

  /** A rule names a company of this organisation, or one of its Manager Workspaces. */
  private async checkRuleTargets(tx: TenantTx, tenantId: string, c: FollowUpCadence): Promise<void> {
    const before = parseFollowUpCadence((await tx.crmSettings.findUnique({ where: { tenantId }, select: { followUpCadence: true } }))?.followUpCadence);
    const kept = new Set(before.rules.map((r) => `${r.scope}:${r.targetId}`));
    // A rule saved earlier may name a company deleted since; it is harmless, so it may stay.
    const fresh = c.rules.filter((r) => !kept.has(`${r.scope}:${r.targetId}`));
    const companyIds = fresh.filter((r) => r.scope === 'COMPANY').map((r) => r.targetId);
    const teamIds = fresh.filter((r) => r.scope === 'TEAM').map((r) => r.targetId);
    if (companyIds.length && (await tx.company.count({ where: { tenantId, id: { in: companyIds }, deletedAt: null } })) !== companyIds.length) throw invalid('rules', 'names a company that does not exist');
    if (teamIds.length && (await tx.workspaceNode.count({ where: { tenantId, id: { in: teamIds }, level: 'MANAGER' } })) !== teamIds.length) throw invalid('rules', 'names a team that is not a Manager Workspace');
  }

  // ───────────── Events ─────────────

  /** A new employee of a company starts in Fresh Email Pending. */
  async contactCreated(tx: TenantTx, actor: Actor, contact: { id: string; companyId: string | null }): Promise<void> {
    if (!contact.companyId) return;
    await this.stages.advance(tx, actor as AuthContext, contact.id, 'FRESH_EMAIL_PENDING', { source: 'CADENCE' });
  }

  /**
   * The Fresh Email Pending stage for bulk creation (imports), or null when stages are off for the workspace. The
   * stage is set on the rows directly; one history line per imported employee would swamp their timelines.
   */
  async freshStageId(tx: TenantTx, tenantId: string): Promise<string | null> {
    if (!(await hasFeature(tx, tenantId, 'rfq_contributors'))) return null;
    const stages = await this.stages.ensureStages(tx, tenantId);
    return stages.find((st) => st.key === 'FRESH_EMAIL_PENDING' && !st.archivedAt)?.id ?? null;
  }

  /**
   * The first email reached the employee: sent from SampForce (the provider accepted it), seen by mailbox sync, logged
   * as an interaction or marked by hand. Later emails change nothing; a cadence runs once per employee. The contact
   * leaves First Email Pending and waits; once the follow-up period has passed, follow-up 1 is created and it moves
   * into Follow-ups (ADR 0096). A backdated email whose period has already passed moves at once.
   */
  async initialEmailSent(tx: TenantTx, actor: Actor, contactId: string, at: Date, source: InitialEmailSource, note?: string | null): Promise<boolean> {
    const c = await tx.contact.findFirst({ where: { id: contactId, tenantId: actor.tenantId, deletedAt: null }, select: { id: true, initialEmailAt: true, stageId: true, companyId: true, ownerId: true } });
    if (!c || c.initialEmailAt) return false;
    const stage = c.stageId ? await tx.crmStatus.findFirst({ where: { id: c.stageId, tenantId: actor.tenantId }, select: { key: true, phase: true } }) : null;
    // Someone already in an RFQ, a discussion or later is past outreach: the email is just another email.
    if (stage && !BEFORE_OUTREACH.includes((stage.key ?? null) as StageKey | null) && stage.phase !== 'NEW') return false;
    const cadence = (await resolvedCadences(tx, actor.tenantId, [c])).get(c.id)!;
    const movesAt = new Date(at.getTime() + cadence.firstFollowUpDays * DAY);
    await tx.contact.update({ where: { id: c.id }, data: { initialEmailAt: at, initialEmailSource: source, cadenceMovesAt: movesAt, cadenceStoppedAt: null, cadenceStopReason: null } });
    await this.stages.advance(tx, actor as AuthContext, c.id, 'INITIAL_EMAIL_SENT', { source: STAGE_SOURCE[source], note: note ?? (source === 'MANUAL' ? 'Initial email marked as sent' : 'Initial email sent') });
    if (movesAt.getTime() <= Date.now()) await this.moveToFollowUps(tx, actor, c.id, new Date(), true);
    return true;
  }

  /**
   * The follow-up period after the first email has passed with no answer: follow-up 1 is created, due by the end of
   * that day in the workspace's time zone, and the contact moves into Follow-ups. Returns the follow-up's assignee and
   * id, or null when nothing was created (already moved, or the contact answered meanwhile, which stops the cadence).
   */
  async moveToFollowUps(tx: TenantTx, actor: Actor, contactId: string, now: Date, notify: boolean): Promise<{ taskId: string; assigneeId: string | null; name: string } | null> {
    const c = await tx.contact.findFirst({ where: { id: contactId, tenantId: actor.tenantId }, select: { id: true, cadenceMovesAt: true, deletedAt: true } });
    if (!c?.cadenceMovesAt) return null;
    // Claim it first, so two workers never move the same contact twice.
    const { count } = await tx.contact.updateMany({ where: { id: c.id, cadenceMovesAt: c.cadenceMovesAt }, data: { cadenceMovesAt: null } });
    if (!count || c.deletedAt) return null;
    if (!(await this.stillRunning(tx, actor.tenantId, c.id))) {
      await this.stop(tx, actor.tenantId, c.id, 'other activity after the first email');
      return null;
    }
    const tenant = await tx.tenant.findUnique({ where: { id: actor.tenantId }, select: { defaultTimezone: true } });
    const { endOfDay } = localDay(c.cadenceMovesAt, tenant?.defaultTimezone ?? 'UTC');
    const task = await this.plan(tx, actor, c.id, 1, endOfDay, notify);
    if (!task) return null;
    const cadence = (await this.cadenceFor(tx, actor.tenantId, c.id))!;
    await tx.activity.create({
      data: {
        tenantId: actor.tenantId, type: 'NOTE', contactId: c.id, companyId: task.companyId, occurredAt: now,
        subject: `Moved to Follow-ups: no answer ${cadence.firstFollowUpDays} days after the first email`.slice(0, 200),
      },
    });
    return { taskId: task.id, assigneeId: task.assigneeId, name: task.name };
  }

  /**
   * The background job (ADR 0096): contacts whose follow-up period after the first email has passed move into
   * Follow-ups. Each contact is claimed before it moves, so it never gets two follow-up 1s, and a failed pass is
   * simply tried again on the next one. Owners get one notification per pass.
   */
  async moveDue(now = new Date()): Promise<number> {
    const due = await scan(() =>
      this.prisma.contact.findMany({ where: { cadenceMovesAt: { not: null, lte: now }, deletedAt: null }, select: { id: true, tenantId: true }, orderBy: { cadenceMovesAt: 'asc' }, take: 500 }),
    );
    let moved = 0;
    for (const tenantId of new Set(due.map((d) => d.tenantId))) {
      try {
        moved += await this.prisma.run({ tenantId }, async (tx) => {
          const per = new Map<string, { taskId: string; name: string }[]>();
          let n = 0;
          for (const d of due.filter((x) => x.tenantId === tenantId)) {
            const owner = await tx.contact.findUnique({ where: { id: d.id }, select: { ownerId: true } });
            const r = await this.moveToFollowUps(tx, { tenantId, userId: owner?.ownerId ?? null } as Actor, d.id, now, false);
            if (!r) continue;
            n++;
            if (r.assigneeId) per.set(r.assigneeId, [...(per.get(r.assigneeId) ?? []), r]);
          }
          for (const [userId, rows] of per) {
            const one = rows.length === 1 ? rows[0]! : null;
            await this.notifications.send(tx, tenantId, [userId], {
              type: 'followup.assigned',
              title: one ? `${one.name} moved into Follow-ups: no answer to the first email` : `${rows.length} contacts moved into Follow-ups: no answer to the first email`,
              body: null,
              link: one ? `/app/follow-ups?task=${one.taskId}` : '/app/follow-ups?bucket=today',
              eventId: one ? `cadence:${one.taskId}` : `cadence-moved:${tenantId}:${userId}:${now.getTime()}`,
            });
          }
          return n;
        });
      } catch (err) {
        this.log.error({ err: errorMessage(err), tenantId }, 'moving contacts into follow-ups failed');
      }
    }
    return moved;
  }

  private async cadenceFor(tx: TenantTx, tenantId: string, contactId: string): Promise<ResolvedCadence | null> {
    const c = await tx.contact.findFirst({ where: { id: contactId, tenantId }, select: { id: true, companyId: true, ownerId: true } });
    return c ? (await resolvedCadences(tx, tenantId, [c])).get(c.id)! : null;
  }

  /** A follow-up of the cadence was completed: plan the next one, unless the cadence is done or stopped. */
  async followUpCompleted(tx: TenantTx, actor: Actor, task: { contactId: string | null; cadenceStep: number | null; completedAt: Date | null }): Promise<void> {
    if (!task.contactId || !task.cadenceStep) return;
    const cadence = await this.cadenceFor(tx, actor.tenantId, task.contactId);
    if (!cadence || task.cadenceStep >= cadence.followUps) return;
    if (!(await this.stillRunning(tx, actor.tenantId, task.contactId))) return;
    await this.plan(tx, actor, task.contactId, task.cadenceStep + 1, nextFollowUpDue(task.completedAt ?? new Date(), cadence.intervalDays), true);
  }

  /** The employee answered (a reply, a call, a meeting, an RFQ): the cadence stops and its planned follow-up goes. */
  async stop(tx: TenantTx, tenantId: string, contactId: string | null | undefined, reason: string): Promise<boolean> {
    if (!contactId) return false;
    const { count } = await tx.contact.updateMany({
      where: { id: contactId, tenantId, initialEmailAt: { not: null }, OR: unset('cadenceStoppedAt') },
      data: { cadenceStoppedAt: new Date(), cadenceStopReason: reason.slice(0, 200), cadenceMovesAt: null },
    });
    if (!count) return false;
    await tx.task.updateMany({
      where: { tenantId, contactId, status: 'OPEN', deletedAt: null, cadenceStep: { not: null } },
      data: { status: 'CANCELED', outcome: `Cadence stopped: ${reason}`.slice(0, 500) },
    });
    return true;
  }

  /** An email was stored (sent from SampForce or synced from a mailbox) for an employee. */
  async emailStored(tx: TenantTx, actor: Actor, email: { contactId: string | null; direction: string; sentAt: Date | string }, source: 'SENT' | 'MAILBOX' = 'MAILBOX'): Promise<void> {
    if (!email.contactId) return;
    if (email.direction === 'OUTBOUND') {
      await this.initialEmailSent(tx, actor, email.contactId, new Date(email.sentAt), source);
    } else if (email.direction === 'INBOUND') {
      if (await this.stop(tx, actor.tenantId, email.contactId, 'the contact replied by email')) {
        await this.stages.advance(tx, actor as AuthContext, email.contactId, 'DISCUSSION', { source: 'EMAIL', note: 'Replied by email' });
      }
    }
  }

  // ───────────── Reading ─────────────

  contactCadence(auth: AuthContext, contactId: string): Promise<ContactCadence> {
    return this.prisma.run(auth, async (tx) => {
      const v = await visibility(tx, auth);
      const c = await tx.contact.findFirst({ where: { id: contactId, tenantId: auth.tenantId, deletedAt: null, ...contactScope(v) }, select: { id: true } });
      if (!c) throw notFound('Contact');
      return (await this.cadences(tx, auth.tenantId, [contactId])).get(contactId)!;
    });
  }

  /** Cadence state of several employees, for lists. */
  cadences(tx: TenantTx, tenantId: string, contactIds: string[], now = new Date()): Promise<Map<string, ContactCadence>> {
    return cadenceStates(tx, tenantId, contactIds, now);
  }

  /** Marks the initial email as sent by hand (an email sent outside SampForce). */
  markInitialEmail(auth: AuthContext, contactId: string, input: InitialEmailInput, meta: RequestMeta): Promise<ContactCadence> {
    return this.prisma.run(auth, async (tx) => {
      const v = await visibility(tx, auth);
      const c = await tx.contact.findFirst({ where: { id: contactId, tenantId: auth.tenantId, deletedAt: null, ...contactScope(v) }, select: { id: true, initialEmailAt: true } });
      if (!c) throw notFound('Contact');
      if (c.initialEmailAt) throw invalid('contactId', 'already had the initial email');
      const at = input.sentAt ? new Date(input.sentAt) : new Date();
      if (at.getTime() > Date.now() + 60_000) throw invalid('sentAt', 'cannot be in the future');
      const started = await this.initialEmailSent(tx, auth, contactId, at, 'MANUAL', input.note ?? null);
      if (!started) throw invalid('contactId', 'is past outreach (an RFQ, a reply or a later stage)');
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'contact.initial_email_marked', entityType: 'contact', entityId: contactId, metadata: { sentAt: at.toISOString() }, meta });
      return (await this.cadences(tx, auth.tenantId, [contactId])).get(contactId)!;
    });
  }

  // ───────────── Planning ─────────────

  private async stillRunning(tx: TenantTx, tenantId: string, contactId: string): Promise<boolean> {
    const c = await tx.contact.findFirst({ where: { id: contactId, tenantId, deletedAt: null }, select: { initialEmailAt: true, cadenceStoppedAt: true, stageId: true } });
    if (!c?.initialEmailAt || c.cadenceStoppedAt) return false;
    const stage = c.stageId ? await tx.crmStatus.findFirst({ where: { id: c.stageId, tenantId }, select: { phase: true } }) : null;
    const phase = stage?.phase ?? 'NEW';
    return CADENCE_PHASES.has(phase) && !isSettledPhase(phase);
  }

  /**
   * Creates follow-up `step`, due at `dueAt`, for the employee's owner, made the way the contact's cadence says (an
   * email, a call…). Never twice for one step.
   */
  private async plan(tx: TenantTx, actor: Actor, contactId: string, step: number, dueAt: Date, notify: boolean): Promise<{ id: string; assigneeId: string | null; companyId: string | null; name: string } | null> {
    const exists = await tx.task.findFirst({ where: { tenantId: actor.tenantId, contactId, cadenceStep: step, deletedAt: null }, select: { id: true } });
    if (exists) return null;
    const cadence = (await this.cadenceFor(tx, actor.tenantId, contactId))!;
    const { followUps, channel } = cadence;
    if (step > followUps) return null;
    const c = await tx.contact.findFirstOrThrow({ where: { id: contactId, tenantId: actor.tenantId }, select: { firstName: true, lastName: true, ownerId: true, companyId: true } });
    const assigneeId = c.ownerId ?? actor.userId ?? null;
    const member = assigneeId ? await tx.membership.findFirst({ where: { tenantId: actor.tenantId, userId: assigneeId, status: 'ACTIVE' }, select: { workspaceNodeId: true } }) : null;
    const name = [c.firstName, c.lastName].filter(Boolean).join(' ') || 'employee';
    const task = await tx.task.create({
      data: {
        tenantId: actor.tenantId, title: cadenceTaskTitle(step, followUps, name), status: 'OPEN', priority: 'NORMAL', dueAt, assigneeId,
        contactId, companyId: c.companyId, followUpType: channel, cadenceStep: step, createdById: actor.userId ?? null,
        workspaceNodeId: member?.workspaceNodeId ?? null,
        nextAction: NEXT_ACTION[channel](step),
      },
    });
    await tx.contact.update({ where: { id: contactId }, data: { nextFollowUpAt: dueAt } });
    if (notify && assigneeId && assigneeId !== actor.userId) {
      await this.notifications.send(tx, actor.tenantId, [assigneeId], {
        type: 'followup.assigned', title: `Follow-up ${step} of ${followUps} planned: ${name}`, body: null, link: `/app/follow-ups?task=${task.id}`, senderId: actor.userId, eventId: `cadence:${task.id}`,
      });
    }
    return { id: task.id, assigneeId, companyId: c.companyId, name };
  }
}
