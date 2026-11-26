import { ForbiddenException, Injectable } from '@nestjs/common';
import { type Prisma, type TenantTx } from '@dealflow/database';
import {
  cadenceTaskTitle,
  type ContactCadence,
  type FollowUpCadence,
  type FollowUpCadenceSettings,
  type InitialEmailInput,
  isSettledPhase,
  nextFollowUpDue,
  parseFollowUpCadence,
  type StageKey,
} from '@dealflow/types';
import { AuditService } from '../audit/audit.service';
import { hasFeature } from '../billing/entitlements';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { callerOf } from '../workspace-work/hierarchy';
import { resolveOrganisation } from '../workspaces/access';
import { badRef as invalid, notFound } from './crm-helpers';
import { cadenceSettingOf, cadenceStates } from './cadence-state';
import { EmployeeStagesService } from './employee-stages.service';
import { contactScope, visibility } from './visibility';

/** Who caused something: a signed-in person, or the owner of a synced mailbox. */
export type Actor = Pick<AuthContext, 'tenantId' | 'userId'>;

/** Stages that may start the cadence: the employee has had no outreach yet. */
const BEFORE_OUTREACH: (StageKey | null)[] = [null, 'NEW_CONTACT', 'FRESH_EMAIL_PENDING'];
/** Phases the cadence keeps running in; anything later (an RFQ, a reply, a call) means the employee answered. */
const CADENCE_PHASES = new Set(['NEW', 'FOLLOW_UP']);

const unset = (field: string) => [{ [field]: null }, { [field]: { isSet: false } }];

/**
 * The follow-up cadence (redesign R3, ADR 0083). New employees start in Fresh Email Pending; the first email moves them
 * to Initial Email Sent and plans follow-up 1; each completed follow-up plans the next until the Super Workspace's
 * number is reached. An answer of any kind stops it and cancels the follow-up still planned. Every step is a real
 * follow-up task, so reminders, overdue alerts, the Follow-ups page and dashboards see it like any other.
 */
@Injectable()
export class FollowUpCadenceService {
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
    return {
      ...parseFollowUpCadence(raw),
      canEdit: auth.permissions.includes('crm:configure') && (await this.inSuperWorkspace(tx, auth)),
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : null,
      updatedBy: by,
    };
  }

  private async inSuperWorkspace(tx: TenantTx, auth: AuthContext): Promise<boolean> {
    if (!auth.workspaceNodeId) return true;
    const org = await resolveOrganisation(tx, auth.tenantId);
    return callerOf(auth, org).level === 'SUPER';
  }

  /** Only the Super Workspace sets the cadence for the organisation (Kunal: "into my super workspace"). */
  setSettings(auth: AuthContext, input: FollowUpCadence, meta: RequestMeta): Promise<FollowUpCadenceSettings> {
    return this.prisma.run(auth, async (tx) => {
      if (!(await this.inSuperWorkspace(tx, auth))) {
        throw new ForbiddenException({ code: 'CADENCE_SUPER_ONLY', message: 'Only the Super Workspace sets the follow-up cadence.' });
      }
      const before = await this.cadenceOf(tx, auth.tenantId);
      const value = { followUps: input.followUps, intervalDays: input.intervalDays, updatedAt: new Date().toISOString(), updatedById: auth.userId };
      await tx.crmSettings.upsert({
        where: { tenantId: auth.tenantId },
        create: { tenantId: auth.tenantId, followUpCadence: value as Prisma.InputJsonValue, updatedById: auth.userId },
        update: { followUpCadence: value as Prisma.InputJsonValue, updatedById: auth.userId },
      });
      await this.audit.record(tx, {
        tenantId: auth.tenantId, actorUserId: auth.userId, action: 'crm_settings.follow_up_cadence_updated', entityType: 'tenant', entityId: auth.tenantId,
        metadata: { before, after: { followUps: input.followUps, intervalDays: input.intervalDays } }, meta,
      });
      return this.settingsIn(tx, auth);
    });
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
   * The first email reached the employee: from SampForce, from the synced mailbox, logged as an interaction or marked
   * by hand. Later emails change nothing; a cadence runs once per employee.
   */
  async initialEmailSent(tx: TenantTx, actor: Actor, contactId: string, at: Date, source: 'EMAIL' | 'INTERACTION' | 'MANUAL', note?: string | null): Promise<boolean> {
    const c = await tx.contact.findFirst({ where: { id: contactId, tenantId: actor.tenantId, deletedAt: null }, select: { id: true, initialEmailAt: true, stageId: true, companyId: true } });
    if (!c || c.initialEmailAt) return false;
    const stage = c.stageId ? await tx.crmStatus.findFirst({ where: { id: c.stageId, tenantId: actor.tenantId }, select: { key: true, phase: true } }) : null;
    // Someone already in an RFQ, a discussion or later is past outreach: the email is just another email.
    if (stage && !BEFORE_OUTREACH.includes((stage.key ?? null) as StageKey | null) && stage.phase !== 'NEW') return false;
    await tx.contact.update({ where: { id: c.id }, data: { initialEmailAt: at, cadenceStoppedAt: null, cadenceStopReason: null } });
    await this.stages.advance(tx, actor as AuthContext, c.id, 'INITIAL_EMAIL_SENT', { source: source === 'MANUAL' ? 'CADENCE' : source, note: note ?? (source === 'MANUAL' ? 'Initial email marked as sent' : 'Initial email sent') });
    await this.plan(tx, actor, c.id, 1, at);
    return true;
  }

  /** A follow-up of the cadence was completed: plan the next one, unless the cadence is done or stopped. */
  async followUpCompleted(tx: TenantTx, actor: Actor, task: { contactId: string | null; cadenceStep: number | null; completedAt: Date | null }): Promise<void> {
    if (!task.contactId || !task.cadenceStep) return;
    const { followUps } = await this.cadenceOf(tx, actor.tenantId);
    if (task.cadenceStep >= followUps) return;
    if (!(await this.stillRunning(tx, actor.tenantId, task.contactId))) return;
    await this.plan(tx, actor, task.contactId, task.cadenceStep + 1, task.completedAt ?? new Date());
  }

  /** The employee answered (a reply, a call, a meeting, an RFQ): the cadence stops and its planned follow-up goes. */
  async stop(tx: TenantTx, tenantId: string, contactId: string | null | undefined, reason: string): Promise<boolean> {
    if (!contactId) return false;
    const { count } = await tx.contact.updateMany({
      where: { id: contactId, tenantId, initialEmailAt: { not: null }, OR: unset('cadenceStoppedAt') },
      data: { cadenceStoppedAt: new Date(), cadenceStopReason: reason.slice(0, 200) },
    });
    if (!count) return false;
    await tx.task.updateMany({
      where: { tenantId, contactId, status: 'OPEN', deletedAt: null, cadenceStep: { not: null } },
      data: { status: 'CANCELED', outcome: `Cadence stopped: ${reason}`.slice(0, 500) },
    });
    return true;
  }

  /** An email was stored (sent from SampForce or synced from a mailbox) for an employee. */
  async emailStored(tx: TenantTx, actor: Actor, email: { contactId: string | null; direction: string; sentAt: Date | string }): Promise<void> {
    if (!email.contactId) return;
    if (email.direction === 'OUTBOUND') {
      await this.initialEmailSent(tx, actor, email.contactId, new Date(email.sentAt), 'EMAIL');
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

  /** Creates follow-up `step`, due one interval after `from`, for the employee's owner. */
  private async plan(tx: TenantTx, actor: Actor, contactId: string, step: number, from: Date): Promise<void> {
    const exists = await tx.task.findFirst({ where: { tenantId: actor.tenantId, contactId, cadenceStep: step, deletedAt: null }, select: { id: true } });
    if (exists) return;
    const { followUps, intervalDays } = await this.cadenceOf(tx, actor.tenantId);
    if (step > followUps) return;
    const c = await tx.contact.findFirstOrThrow({ where: { id: contactId, tenantId: actor.tenantId }, select: { firstName: true, lastName: true, ownerId: true, companyId: true } });
    const assigneeId = c.ownerId ?? actor.userId;
    const member = assigneeId ? await tx.membership.findFirst({ where: { tenantId: actor.tenantId, userId: assigneeId, status: 'ACTIVE' }, select: { workspaceNodeId: true } }) : null;
    const name = [c.firstName, c.lastName].filter(Boolean).join(' ') || 'employee';
    const dueAt = nextFollowUpDue(from, intervalDays);
    const task = await tx.task.create({
      data: {
        tenantId: actor.tenantId, title: cadenceTaskTitle(step, followUps, name), status: 'OPEN', priority: 'NORMAL', dueAt, assigneeId,
        contactId, companyId: c.companyId, followUpType: 'EMAIL', cadenceStep: step, createdById: actor.userId,
        workspaceNodeId: member?.workspaceNodeId ?? null,
        nextAction: step === 1 ? 'Send the first follow-up email.' : `Send follow-up email ${step}.`,
      },
    });
    await tx.contact.update({ where: { id: contactId }, data: { nextFollowUpAt: dueAt } });
    if (assigneeId && assigneeId !== actor.userId) {
      await this.notifications.send(tx, actor.tenantId, [assigneeId], {
        type: 'followup.assigned', title: `Follow-up ${step} of ${followUps} planned: ${name}`, body: null, link: `/app/follow-ups?task=${task.id}`, senderId: actor.userId, eventId: `cadence:${task.id}`,
      });
    }
  }
}
