import { BadRequestException, Injectable } from '@nestjs/common';
import { cadenceStates } from './cadence-state';
import { type Prisma, type TenantTx } from '@dealflow/database';
import {
  ACTIVE_CONTRIBUTOR_DAYS,
  type CommunicationEvent,
  contributorStatus,
  DEFAULT_STATUSES,
  type EmployeeActivity,
  type EmployeeActivityRow,
  type EmployeeCommunication,
  followUpStageKey,
  type InteractionKind,
  isSettledPhase,
  type PersonRef,
  type StageChangeInput,
  type StageChangeSource,
  type StageKey,
  type StagePhase,
  type StageRef,
  type EmployeeStageRow,
  stageRank,
} from '@dealflow/types';
import { AuditService } from '../audit/audit.service';
import { hasFeature } from '../billing/entitlements';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { notFound } from './crm-helpers';
import { canSeeDetails, companyScope, contactScope, personRefs, visibility } from './visibility';

const unset = (field: string) => [{ [field]: null }, { [field]: { isSet: false } }];
type StageModel = { id: string; name: string; color: string; key: string | null; phase: string | null; description: string | null; position: number; archivedAt: Date | null };

/** What an automatic change does, apart from the stage it moves to. */
export interface AdvanceOptions {
  source: Exclude<StageChangeSource, 'MANUAL'>;
  rfqId?: string | null;
  note?: string | null;
  /**
   * Moves the employee even backwards or out of a won/lost/on-hold stage. Used for a new RFQ (a new cycle starts)
   * and for an RFQ's outcome (won, lost, cancelled), which is always the latest word.
   */
  override?: boolean;
}

/**
 * Employee communication stages and RFQ contributors (ADR 0080). Each employee has their own stage and history; a
 * person can set any stage at any time, and SampForce moves employees on by itself when something real happens: an
 * RFQ arrives, SampBidx confirms a transfer, a follow-up or call is done, the RFQ is won or lost. Automatic changes
 * only move forward and never out of won, lost or on hold, so they never undo what a person decided.
 */
@Injectable()
export class EmployeeStagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ─── Stages ───

  stages(auth: AuthContext): Promise<EmployeeStageRow[]> {
    return this.prisma.run(auth, async (tx) => this.stageRows(tx, auth.tenantId));
  }

  /** The workspace's stages, creating the built-in ones the first time and any a later release added. */
  async ensureStages(tx: TenantTx, tenantId: string): Promise<StageModel[]> {
    let rows = await tx.crmStatus.findMany({ where: { tenantId, kind: 'STAGE' }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] });
    if (!rows.length) {
      await tx.crmStatus.createMany({
        data: DEFAULT_STATUSES.STAGE.map((s, position) => ({
          tenantId, kind: 'STAGE', name: s.name, color: s.color, meaning: s.meaning, key: s.key ?? null, phase: s.phase ?? null, position, isDefault: position === 0, description: null, archivedAt: null,
        })),
      });
      rows = await tx.crmStatus.findMany({ where: { tenantId, kind: 'STAGE' }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] });
    } else {
      // Built-in stages added by a later release (Fresh Email Pending and Initial Email Sent, ADR 0083) join a
      // workspace's existing list next to the built-in stage before them, keeping the workspace's own order.
      const have = new Set(rows.map((r) => r.key).filter(Boolean));
      const missing = DEFAULT_STATUSES.STAGE.filter((s) => s.key && !have.has(s.key));
      if (missing.length) {
        for (const m of missing) {
          const i = DEFAULT_STATUSES.STAGE.indexOf(m);
          const before = DEFAULT_STATUSES.STAGE.slice(0, i).reverse().find((s) => rows.some((r) => r.key === s.key));
          const at = before ? rows.find((r) => r.key === before.key)!.position + 1 : 0;
          await tx.crmStatus.updateMany({ where: { tenantId, kind: 'STAGE', position: { gte: at } }, data: { position: { increment: 1 } } });
          await tx.crmStatus.create({ data: { tenantId, kind: 'STAGE', name: m.name, color: m.color, meaning: m.meaning, key: m.key ?? null, phase: m.phase ?? null, position: at, isDefault: false, description: null, archivedAt: null } });
          rows = await tx.crmStatus.findMany({ where: { tenantId, kind: 'STAGE' }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] });
        }
      }
    }
    return rows;
  }

  private async stageRows(tx: TenantTx, tenantId: string): Promise<EmployeeStageRow[]> {
    const rows = await this.ensureStages(tx, tenantId);
    const groups = await tx.contact.groupBy({ by: ['stageId'], where: { tenantId, deletedAt: null, stageId: { not: null } }, _count: { _all: true } });
    const used = new Map(groups.map((g) => [g.stageId!, g._count._all]));
    return rows.map((r) => ({ ...stageRef(r), description: r.description, position: r.position, archived: !!r.archivedAt, inUse: used.get(r.id) ?? 0 }));
  }

  // ─── Company employee activity ───

  /** Every employee of a company with RFQ activity, stage, follow-ups and contributor status (Part 7). */
  activity(auth: AuthContext, companyId: string): Promise<EmployeeActivity> {
    return this.prisma.run(auth, async (tx) => {
      const v = await visibility(tx, auth);
      const company = await tx.company.findFirst({ where: { id: companyId, tenantId: auth.tenantId, deletedAt: null, ...companyScope(v) }, select: { id: true, name: true } });
      if (!company) throw notFound('Company');
      const contacts = await tx.contact.findMany({ where: { tenantId: auth.tenantId, companyId, deletedAt: null, ...contactScope(v) }, orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }], take: 1000 });
      const stages = await this.stageRows(tx, auth.tenantId);
      const rows = await this.rowsFor(tx, auth.tenantId, contacts, new Map([[company.id, company.name]]), stages, (ownerId) => canSeeDetails(v, ownerId));
      return { rows, stages, activeDays: ACTIVE_CONTRIBUTOR_DAYS };
    });
  }

  /** One employee's row and full communication history, newest first (Part 8). */
  communication(auth: AuthContext, contactId: string): Promise<EmployeeCommunication> {
    return this.prisma.run(auth, async (tx) => {
      const v = await visibility(tx, auth);
      const c = await tx.contact.findFirst({ where: { id: contactId, tenantId: auth.tenantId, deletedAt: null, ...contactScope(v) } });
      if (!c) throw notFound('Contact');
      const tid = auth.tenantId;
      const company = c.companyId ? await tx.company.findFirst({ where: { id: c.companyId, tenantId: tid }, select: { id: true, name: true } }) : null;
      const stages = await this.stageRows(tx, tid);
      const [row] = await this.rowsFor(tx, tid, [c], new Map(company ? [[company.id, company.name]] : []), stages, (ownerId) => canSeeDetails(v, ownerId));
      const [changes, acts, tasks, transfers, rfqs] = await Promise.all([
        tx.contactStageChange.findMany({ where: { tenantId: tid, contactId }, orderBy: { at: 'desc' }, take: 500 }),
        tx.activity.findMany({ where: { tenantId: tid, contactId, deletedAt: null }, orderBy: { occurredAt: 'desc' }, take: 500 }),
        tx.task.findMany({ where: { tenantId: tid, contactId, deletedAt: null, followUpType: { not: null } }, orderBy: { createdAt: 'desc' }, take: 500 }),
        tx.sampbidxTransfer.findMany({ where: { tenantId: tid, OR: [{ contactId }, { rfqId: { in: (await tx.rfq.findMany({ where: { tenantId: tid, contactId, deletedAt: null }, select: { id: true } })).map((r) => r.id) } }] }, orderBy: { createdAt: 'desc' }, take: 200, omit: { emailFileData: true } }),
        tx.rfq.findMany({ where: { tenantId: tid, contactId }, select: { id: true, number: true } }),
      ]);
      const extraRfqIds = [...acts.map((a) => a.rfqId), ...tasks.map((t) => t.rfqId), ...changes.map((s) => s.rfqId), ...transfers.map((t) => t.rfqId)].filter((x): x is string => !!x && !rfqs.some((r) => r.id === x));
      const allRfqs = [...rfqs, ...(extraRfqIds.length ? await tx.rfq.findMany({ where: { tenantId: tid, id: { in: extraRfqIds } }, select: { id: true, number: true } }) : [])];
      const rfqRef = (id: string | null) => (id ? (allRfqs.find((r) => r.id === id) ?? null) : null);
      const people = await personRefs(tx, tid, [...changes.map((s) => s.changedById), ...acts.map((a) => a.ownerId), ...tasks.flatMap((t) => [t.assigneeId, t.createdById]), ...transfers.map((t) => t.createdById), c.rfqContributorById]);
      const who = (id: string | null | undefined): PersonRef | null => (id ? (people.get(id) ?? null) : null);
      const stageById = new Map(stages.map((s) => [s.id, s as StageRef]));
      const ref = (id: string | null) => (id ? (stageById.get(id) ?? null) : null);
      const now = Date.now();
      const events: CommunicationEvent[] = [
        ...changes.map((s) => ({
          id: `stage:${s.id}`, kind: 'STAGE' as const, at: s.at.toISOString(), title: ref(s.toStageId)?.name ?? 'Stage changed', detail: s.note, by: who(s.changedById),
          from: ref(s.fromStageId), to: ref(s.toStageId), source: s.source as StageChangeSource, subKind: null, rfq: rfqRef(s.rfqId), remoteId: null,
        })),
        ...acts.map((a) => ({
          id: `activity:${a.id}`, kind: 'INTERACTION' as const, at: a.occurredAt.toISOString(), title: a.subject,
          detail: [a.outcome, a.body].filter(Boolean).join(' · ') || null, by: who(a.ownerId), from: null, to: null, source: null,
          subKind: a.interaction ?? a.type, rfq: rfqRef(a.rfqId), remoteId: null,
        })),
        ...tasks.flatMap((t) => {
          const scheduled = {
            id: `followup:${t.id}`, kind: 'FOLLOW_UP' as const, at: t.createdAt.toISOString(), title: t.title,
            detail: t.dueAt ? `due ${t.dueAt.toISOString()}` : null, by: who(t.createdById), from: null, to: null, source: null,
            subKind: t.status === 'OPEN' ? (t.dueAt && t.dueAt.getTime() < now ? 'OVERDUE' : 'OPEN') : t.status === 'CANCELED' ? 'CANCELED' : 'SCHEDULED',
            rfq: rfqRef(t.rfqId), remoteId: null,
          };
          if (t.status !== 'DONE' || !t.completedAt) return [scheduled];
          return [scheduled, { ...scheduled, id: `followup-done:${t.id}`, at: t.completedAt.toISOString(), detail: t.outcome, by: who(t.assigneeId), subKind: 'DONE' }];
        }),
        ...transfers.map((t) => ({
          id: `sampbidx:${t.id}`, kind: 'SAMPBIDX' as const, at: (t.sentAt ?? t.updatedAt).toISOString(), title: t.title,
          detail: t.delivery === 'FAILED' ? t.lastError : (t.remoteNote ?? null), by: who(t.createdById), from: null, to: null, source: null,
          subKind: t.kind === 'CLIENT' ? `CLIENT_${t.delivery}` : t.delivery, rfq: rfqRef(t.rfqId), remoteId: t.remoteId,
        })),
        ...(c.rfqContributorAt
          ? [{ id: `contributor:${c.id}`, kind: 'CONTRIBUTOR' as const, at: c.rfqContributorAt.toISOString(), title: 'Marked as RFQ contributor', detail: null, by: who(c.rfqContributorById), from: null, to: null, source: null, subKind: null, rfq: null, remoteId: null }]
          : []),
      ];
      return { employee: row!, events: events.sort((a, b) => b.at.localeCompare(a.at)) };
    });
  }

  private async rowsFor(
    tx: TenantTx,
    tid: string,
    contacts: Prisma.ContactGetPayload<object>[],
    companyNames: Map<string, string>,
    stages: EmployeeStageRow[],
    details: (ownerId: string | null) => boolean,
  ): Promise<EmployeeActivityRow[]> {
    const ids = contacts.map((c) => c.id);
    if (!ids.length) return [];
    const [rfqs, received, acts, emails, tasks, sent] = await Promise.all([
      tx.rfq.findMany({ where: { tenantId: tid, contactId: { in: ids }, deletedAt: null }, select: { id: true, contactId: true, receivedAt: true, status: true } }),
      // RFQs received without an RFQ record (a pasted RFQ email, a logged "RFQ received") count too.
      tx.activity.findMany({ where: { tenantId: tid, contactId: { in: ids }, deletedAt: null, interaction: 'RFQ_RECEIVED', OR: unset('rfqId') }, select: { contactId: true, occurredAt: true } }),
      tx.activity.findMany({ where: { tenantId: tid, contactId: { in: ids }, deletedAt: null }, select: { contactId: true, occurredAt: true }, orderBy: { occurredAt: 'desc' }, take: 20_000 }),
      tx.emailMessage.findMany({ where: { tenantId: tid, contactId: { in: ids } }, select: { contactId: true, sentAt: true }, orderBy: { sentAt: 'desc' }, take: 20_000 }),
      tx.task.findMany({ where: { tenantId: tid, contactId: { in: ids }, deletedAt: null, followUpType: { not: null } }, select: { contactId: true, status: true, dueAt: true } }),
      tx.sampbidxTransfer.findMany({ where: { tenantId: tid, delivery: 'SENT', kind: { not: 'CLIENT' }, contactId: { in: ids } }, select: { id: true, contactId: true, rfqId: true } }),
    ]);
    const sentRfq = await tx.sampbidxTransfer.findMany({ where: { tenantId: tid, delivery: 'SENT', rfqId: { in: rfqs.map((r) => r.id) } }, select: { rfqId: true } });
    const people = await personRefs(tx, tid, contacts.flatMap((c) => [c.ownerId, c.rfqContributorById]));
    const cadence = await cadenceStates(tx, tid, ids);
    const stageById = new Map(stages.map((s) => [s.id, s]));
    const now = Date.now();
    return contacts.map((c) => {
      const mine = rfqs.filter((r) => r.contactId === c.id);
      const loose = received.filter((a) => a.contactId === c.id);
      const rfqDates = [...mine.map((r) => r.receivedAt), ...loose.map((a) => a.occurredAt)].sort((a, b) => b.getTime() - a.getTime());
      const lastAct = [acts.find((a) => a.contactId === c.id)?.occurredAt, emails.find((e) => e.contactId === c.id)?.sentAt, c.stageChangedAt].filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0];
      const myTasks = tasks.filter((t) => t.contactId === c.id);
      const open = myTasks.filter((t) => t.status === 'OPEN' && t.dueAt).map((t) => t.dueAt!);
      const next = [...open, ...(c.nextFollowUpAt ? [c.nextFollowUpAt] : [])].sort((a, b) => a.getTime() - b.getTime())[0];
      // One count per RFQ (or per RFQ email without an RFQ record), however many copies went.
      const sentIds = new Set([...sent.filter((s) => s.contactId === c.id).map((s) => s.rfqId ?? s.id), ...sentRfq.filter((s) => mine.some((r) => r.id === s.rfqId)).map((s) => s.rfqId!)]);
      const stage = c.stageId ? stageById.get(c.stageId) : undefined;
      const lastRfqAt = rfqDates[0]?.toISOString() ?? null;
      const rfqCount = mine.length + loose.length;
      const canSee = details(c.ownerId);
      return {
        id: c.id,
        name: [c.firstName, c.lastName].filter(Boolean).join(' '),
        jobTitle: c.jobTitle,
        email: canSee ? c.email : null,
        phone: canSee ? c.phone : null,
        company: { id: c.companyId ?? '', name: (c.companyId && companyNames.get(c.companyId)) || '' },
        stage: stage ? { id: stage.id, name: stage.name, color: stage.color, key: stage.key, phase: stage.phase } : null,
        stageChangedAt: c.stageChangedAt?.toISOString() ?? null,
        contributor: contributorStatus({ rfqCount, lastRfqAt, markedAt: c.rfqContributorAt }),
        marked: c.rfqContributorAt ? { at: c.rfqContributorAt.toISOString(), by: c.rfqContributorById ? (people.get(c.rfqContributorById) ?? null) : null } : null,
        rfqCount,
        lastRfqAt,
        rfqsWon: mine.filter((r) => r.status === 'WON').length,
        rfqsLostOrRejected: mine.filter((r) => r.status === 'LOST' || r.status === 'CANCELLED').length,
        rfqsOpen: mine.filter((r) => !['WON', 'LOST', 'CANCELLED'].includes(r.status)).length,
        sentToSampbidx: sentIds.size,
        lastActivityAt: lastAct?.toISOString() ?? null,
        nextFollowUpAt: next?.toISOString() ?? null,
        followUpsOverdue: open.filter((d) => d.getTime() < now).length,
        followUpsCompleted: myTasks.filter((t) => t.status === 'DONE').length,
        cadence: cadence.get(c.id) ?? null,
        owner: c.ownerId ? (people.get(c.ownerId) ?? null) : null,
        details: canSee,
      };
    });
  }

  // ─── Changes by people ───

  /** A person sets the stage. Any stage, in any order: an RFQ can be won after the second follow-up. */
  changeStage(auth: AuthContext, contactId: string, input: StageChangeInput, meta: RequestMeta): Promise<EmployeeActivityRow> {
    return this.prisma.run(auth, async (tx) => {
      const c = await this.editableContact(tx, auth, contactId);
      const stage = await tx.crmStatus.findFirst({ where: { id: input.stageId, tenantId: auth.tenantId, kind: 'STAGE' } });
      if (!stage) throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Pick one of the communication stages.', details: [{ path: 'stageId', message: 'is not a stage' }] });
      if (stage.archivedAt && stage.id !== c.stageId) throw new BadRequestException({ code: 'STAGE_ARCHIVED', message: 'That stage is no longer used. Pick another one.' });
      if (input.rfqId && !(await tx.rfq.findFirst({ where: { id: input.rfqId, tenantId: auth.tenantId, deletedAt: null, ...(c.companyId ? { companyId: c.companyId } : {}) }, select: { id: true } }))) {
        throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'That RFQ is not from this company.', details: [{ path: 'rfqId', message: 'is not from this company' }] });
      }
      if (stage.id !== c.stageId || input.note) await this.record(tx, auth.tenantId, c, stage.id, 'MANUAL', auth.userId, input.rfqId ?? null, input.note ?? null);
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'contact.stage_changed', entityType: 'contact', entityId: contactId, metadata: { from: c.stageId, to: stage.id, name: stage.name }, meta });
      return this.rowOf(tx, auth, contactId);
    });
  }

  /** Marks an employee as an RFQ contributor by hand (for RFQs from before SampForce), or takes the mark away. */
  markContributor(auth: AuthContext, contactId: string, marked: boolean, meta: RequestMeta): Promise<EmployeeActivityRow> {
    return this.prisma.run(auth, async (tx) => {
      const c = await this.editableContact(tx, auth, contactId);
      if (marked !== !!c.rfqContributorAt) {
        await tx.contact.update({ where: { id: contactId }, data: marked ? { rfqContributorAt: new Date(), rfqContributorById: auth.userId } : { rfqContributorAt: null, rfqContributorById: null } });
        await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: marked ? 'contact.rfq_contributor_marked' : 'contact.rfq_contributor_unmarked', entityType: 'contact', entityId: contactId, meta });
      }
      return this.rowOf(tx, auth, contactId);
    });
  }

  private async rowOf(tx: TenantTx, auth: AuthContext, contactId: string): Promise<EmployeeActivityRow> {
    const v = await visibility(tx, auth);
    const c = await tx.contact.findFirstOrThrow({ where: { id: contactId, tenantId: auth.tenantId } });
    const company = c.companyId ? await tx.company.findFirst({ where: { id: c.companyId, tenantId: auth.tenantId }, select: { id: true, name: true } }) : null;
    const [row] = await this.rowsFor(tx, auth.tenantId, [c], new Map(company ? [[company.id, company.name]] : []), await this.stageRows(tx, auth.tenantId), (o) => canSeeDetails(v, o));
    return row!;
  }

  private async editableContact(tx: TenantTx, auth: AuthContext, contactId: string) {
    const v = await visibility(tx, auth);
    const c = await tx.contact.findFirst({ where: { id: contactId, tenantId: auth.tenantId, deletedAt: null, ...contactScope(v) } });
    if (!c) throw notFound('Contact');
    if (!canSeeDetails(v, c.ownerId)) throw new BadRequestException({ code: 'DETAILS_HIDDEN', message: 'Your role cannot see or change the details of this employee.' });
    return c;
  }

  // ─── Automatic changes ───

  /**
   * Moves an employee to a built-in stage because something happened. Skipped when the workspace's plan leaves out
   * RFQ contributors, when the stage was retired, when it would move the employee backwards, or out of won, lost or
   * on hold (unless `override`). Returns whether the stage changed.
   */
  async advance(tx: TenantTx, auth: AuthContext, contactId: string | null | undefined, key: StageKey, opts: AdvanceOptions): Promise<boolean> {
    if (!contactId) return false;
    if (!(await hasFeature(tx, auth.tenantId, 'rfq_contributors'))) return false;
    const stages = await this.ensureStages(tx, auth.tenantId);
    const target = stages.find((s) => s.key === key);
    if (!target || target.archivedAt) return false;
    const c = await tx.contact.findFirst({ where: { id: contactId, tenantId: auth.tenantId, deletedAt: null } });
    if (!c) return false;
    const current = c.stageId ? stages.find((s) => s.id === c.stageId) : undefined;
    if (current?.id === target.id) return false;
    if (!opts.override && current) {
      if (isSettledPhase(current.phase)) return false;
      if (stageRank(target) <= stageRank(current)) return false;
    }
    await this.record(tx, auth.tenantId, c, target.id, opts.source, auth.userId, opts.rfqId ?? null, opts.note ?? null);
    return true;
  }

  /** A completed follow-up: the n-th since the employee's latest RFQ gives "Follow-up n Completed". */
  async followUpDone(tx: TenantTx, auth: AuthContext, task: { contactId: string | null; followUpType: string | null; rfqId: string | null }): Promise<void> {
    if (!task.contactId) return;
    if (task.followUpType === 'CALL') {
      await this.advance(tx, auth, task.contactId, 'CALL_DONE', { source: 'FOLLOW_UP', rfqId: task.rfqId });
      return;
    }
    const stages = await this.ensureStages(tx, auth.tenantId);
    const rfqStage = stages.find((s) => s.key === 'RFQ_RECEIVED');
    const cycle = rfqStage ? await tx.contactStageChange.findFirst({ where: { tenantId: auth.tenantId, contactId: task.contactId, toStageId: rfqStage.id }, orderBy: { at: 'desc' }, select: { at: true } }) : null;
    const done = await tx.task.count({
      where: { tenantId: auth.tenantId, contactId: task.contactId, deletedAt: null, followUpType: { not: null }, status: 'DONE', ...(cycle ? { completedAt: { gte: cycle.at } } : {}) },
    });
    await this.advance(tx, auth, task.contactId, followUpStageKey(done), { source: 'FOLLOW_UP', rfqId: task.rfqId, note: `Follow-up ${done} completed` });
  }

  /** A logged interaction: a call, a meeting or a reply, negotiation, or an RFQ received without an RFQ record. */
  async interactionLogged(tx: TenantTx, auth: AuthContext, input: { contactId?: string | null; kind: InteractionKind; rfqId?: string | null }): Promise<void> {
    const by: Partial<Record<InteractionKind, StageKey>> = {
      CALL_OUTGOING: 'CALL_DONE',
      CALL_INCOMING: 'CALL_DONE',
      MEETING: 'DISCUSSION',
      EMAIL_RECEIVED: 'DISCUSSION',
      NEGOTIATION: 'NEGOTIATION',
    };
    if (input.kind === 'RFQ_RECEIVED' && !input.rfqId) {
      await this.advance(tx, auth, input.contactId, 'RFQ_RECEIVED', { source: 'RFQ', override: true });
      return;
    }
    const key = by[input.kind];
    if (key) await this.advance(tx, auth, input.contactId, key, { source: 'INTERACTION', rfqId: input.rfqId ?? null });
  }

  /** An RFQ's status changed: its outcome is always the employee's latest word; negotiation moves them on. */
  async rfqStatusChanged(tx: TenantTx, auth: AuthContext, rfq: { id: string; contactId: string | null; status: string }): Promise<void> {
    const outcome: Record<string, StageKey> = { WON: 'RFQ_WON', LOST: 'RFQ_LOST', CANCELLED: 'RFQ_CANCELLED' };
    if (outcome[rfq.status]) await this.advance(tx, auth, rfq.contactId, outcome[rfq.status]!, { source: 'RFQ_OUTCOME', rfqId: rfq.id, override: true });
    else if (rfq.status === 'NEGOTIATION') await this.advance(tx, auth, rfq.contactId, 'NEGOTIATION', { source: 'RFQ', rfqId: rfq.id });
    else if (rfq.status === 'UNDER_EVALUATION') await this.advance(tx, auth, rfq.contactId, 'RFQ_REVIEW', { source: 'RFQ', rfqId: rfq.id });
  }

  private async record(tx: TenantTx, tenantId: string, c: { id: string; companyId: string | null; stageId: string | null }, toStageId: string, source: StageChangeSource, by: string | null, rfqId: string | null, note: string | null) {
    const at = new Date();
    await tx.contactStageChange.create({ data: { tenantId, contactId: c.id, companyId: c.companyId, fromStageId: c.stageId, toStageId, source, note, rfqId, changedById: by, at } });
    await tx.contact.update({ where: { id: c.id }, data: { stageId: toStageId, stageChangedAt: at, stageChangedById: by } });
    c.stageId = toStageId;
  }
}

export function stageRef(r: Pick<StageModel, 'id' | 'name' | 'color' | 'key' | 'phase'>): StageRef {
  return { id: r.id, name: r.name, color: r.color, key: (r.key ?? null) as StageRef['key'], phase: (r.phase ?? 'NEW') as StagePhase };
}
