import { BadRequestException, Injectable } from '@nestjs/common';
import { nextSequenceValue, nullsLast, type Prisma, type TenantTx } from '@dealflow/database';
import {
  type CompanyDashboard,
  type CompanyEmployeeRow,
  FOLLOW_UP_BUCKETS,
  type FollowUpBucket,
  type FollowUpCounts,
  type FollowUpDue,
  type FollowUpInput,
  type FollowUpRow,
  type FollowUpType,
  INTERACTION_ACTIVITY_TYPE,
  type InteractionInput,
  type InteractionKind,
  type InteractionRow,
  type Page,
  RFQ_OPEN_STATUSES,
  RFQ_SUBMITTED_STATUSES,
  type RfqInput,
  type RfqReportRow,
  type RfqRow,
  type RfqStatus,
  startOfDayIn,
  sumByCurrency,
  type z,
  type followUpListQuerySchema,
  type followUpUpdateSchema,
  type interactionListQuerySchema,
  type rfqListQuerySchema,
  type rfqUpdateSchema,
} from '@dealflow/types';
import { AuditService } from '../audit/audit.service';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { DealsService } from './deals.service';
import { badRef, notFound } from './crm-helpers';
import { canSeeDetails, companyScope, contactScope, personRefs, reportingTree, scopeOf, visibility, type Visibility } from './visibility';

type FollowUpQuery = z.output<typeof followUpListQuerySchema>;
type InteractionQuery = z.output<typeof interactionListQuerySchema>;
type RfqQuery = z.output<typeof rfqListQuerySchema>;
type TaskModel = Prisma.TaskGetPayload<object>;
type RfqModel = Prisma.RfqGetPayload<object>;

const DAY = 86_400_000;
const EMAIL_SENT_KINDS = ['EMAIL_SENT'];
const unset = (field: string) => [{ [field]: null }, { [field]: { isSet: false } }];

/**
 * The company dashboard, interactions, follow-ups and RFQs (ADR 0060, Phase 3). Every number is counted from CRM
 * records; logged emails and emails synced from a mailbox are counted apart, and receiving an RFQ is never revenue.
 * Access follows the caller's record visibility: a company they cannot see has no dashboard, interactions or RFQs.
 */
@Injectable()
export class CompanyWorkService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly deals: DealsService,
  ) {}

  // ─── Company dashboard ───

  dashboard(auth: AuthContext, companyId: string): Promise<CompanyDashboard> {
    return this.prisma.run(auth, async (tx) => {
      await this.visibleCompany(tx, auth, companyId);
      const tid = auth.tenantId;
      const contacts = await tx.contact.findMany({ where: { tenantId: tid, companyId, deletedAt: null }, select: { id: true } });
      const contactIds = contacts.map((c) => c.id);
      const acts = await tx.activity.findMany({
        where: { tenantId: tid, deletedAt: null, OR: [{ companyId }, ...(contactIds.length ? [{ contactId: { in: contactIds } }] : [])] },
        select: { type: true, interaction: true, contactId: true, subject: true, occurredAt: true, ownerId: true },
        orderBy: { occurredAt: 'desc' },
        take: 20_000,
      });
      const emails = contactIds.length
        ? await tx.emailMessage.findMany({ where: { tenantId: tid, contactId: { in: contactIds } }, select: { direction: true, contactId: true, subject: true, sentAt: true }, orderBy: { sentAt: 'desc' }, take: 20_000 })
        : [];
      const now = new Date();
      const [followUpsPending, followUpsOverdue, nextTask, rfqs, deals] = await Promise.all([
        tx.task.count({ where: { tenantId: tid, companyId, deletedAt: null, status: 'OPEN' } }),
        tx.task.count({ where: { tenantId: tid, companyId, deletedAt: null, status: 'OPEN', dueAt: { lt: now } } }),
        tx.task.findFirst({ where: { tenantId: tid, companyId, deletedAt: null, status: 'OPEN', dueAt: { not: null } }, orderBy: { dueAt: 'asc' }, select: { id: true, title: true, dueAt: true } }),
        tx.rfq.findMany({ where: { tenantId: tid, companyId, deletedAt: null }, select: { id: true, number: true, projectName: true, status: true, totalQuotation: true, actualRevenue: true, currency: true, deadlineAt: true, opportunityId: true } }),
        tx.opportunity.findMany({ where: { tenantId: tid, companyId, deletedAt: null }, select: { status: true, amount: true, currency: true } }),
      ]);

      const kindOf = (a: { type: string; interaction: string | null }) => (a.interaction ?? (a.type === 'EMAIL' ? 'EMAIL_SENT' : a.type === 'CALL' ? 'CALL_OUTGOING' : a.type)) as string;
      const count = (pred: (k: string) => boolean) => acts.filter((a) => pred(kindOf(a))).length;
      const synced = { sent: emails.filter((e) => e.direction === 'OUTBOUND').length, received: emails.filter((e) => e.direction === 'INBOUND').length };
      const contacted = new Set<string>();
      for (const a of acts) if (a.contactId) contacted.add(a.contactId);
      for (const e of emails) if (e.contactId && e.direction === 'OUTBOUND') contacted.add(e.contactId);

      const submitted = rfqs.filter((r) => RFQ_SUBMITTED_STATUSES.includes(r.status as RfqStatus));
      const wonRfqs = rfqs.filter((r) => r.status === 'WON');
      const wonDeals = deals.filter((d) => d.status === 'WON');
      // Won business: won deals, plus won RFQs that never became a deal (so nothing is counted twice).
      const businessGenerated = sumByCurrency([
        ...wonDeals.map((d) => ({ currency: d.currency, amount: d.amount })),
        ...wonRfqs.filter((r) => !r.opportunityId).map((r) => ({ currency: r.currency, amount: r.actualRevenue ?? r.totalQuotation })),
      ]);

      const lastAct = acts[0];
      const lastEmail = emails[0];
      let latestUpdate: CompanyDashboard['latestUpdate'] = null;
      if (lastAct && (!lastEmail || lastAct.occurredAt >= lastEmail.sentAt)) {
        const by = lastAct.ownerId ? (await tx.user.findUnique({ where: { id: lastAct.ownerId }, select: { name: true } }))?.name ?? null : null;
        latestUpdate = { kind: kindOf(lastAct) as InteractionKind, subject: lastAct.subject, at: lastAct.occurredAt.toISOString(), by };
      } else if (lastEmail) {
        latestUpdate = { kind: 'EMAIL_SYNCED', subject: lastEmail.subject, at: lastEmail.sentAt.toISOString(), by: null };
      }
      const nextDeadline = rfqs
        .filter((r) => r.deadlineAt && RFQ_OPEN_STATUSES.includes(r.status as RfqStatus) && r.deadlineAt >= now)
        .sort((a, b) => a.deadlineAt!.getTime() - b.deadlineAt!.getTime())[0];
      let nextAction: CompanyDashboard['nextAction'] = nextTask?.dueAt ? { kind: 'FOLLOW_UP', title: nextTask.title, at: nextTask.dueAt.toISOString(), id: nextTask.id } : null;
      if (nextDeadline && (!nextAction || nextDeadline.deadlineAt! < new Date(nextAction.at))) {
        nextAction = { kind: 'RFQ_DEADLINE', title: `${nextDeadline.number} ${nextDeadline.projectName}`, at: nextDeadline.deadlineAt!.toISOString(), id: nextDeadline.id };
      }

      return {
        kpis: {
          employees: contacts.length,
          employeesContacted: contacted.size,
          emailsSent: count((k) => EMAIL_SENT_KINDS.includes(k)) + synced.sent,
          responsesReceived: count((k) => k === 'EMAIL_RECEIVED') + synced.received,
          calls: count((k) => k === 'CALL_OUTGOING' || k === 'CALL_INCOMING'),
          meetings: count((k) => k === 'MEETING'),
          followUpsPending,
          followUpsOverdue,
          rfqsReceived: rfqs.length,
          rfqsSubmitted: submitted.length,
          rfqsWon: wonRfqs.length,
          rfqsLost: rfqs.filter((r) => r.status === 'LOST').length,
          businessGenerated,
        },
        business: {
          opportunities: deals.length,
          open: deals.filter((d) => d.status === 'OPEN').length,
          won: wonDeals.length,
          lost: deals.filter((d) => d.status === 'LOST').length,
          quotedValue: sumByCurrency(submitted.map((r) => ({ currency: r.currency, amount: r.totalQuotation }))),
          wonRevenue: businessGenerated,
          outstanding: sumByCurrency(deals.filter((d) => d.status === 'OPEN').map((d) => ({ currency: d.currency, amount: d.amount }))),
        },
        syncedEmails: synced,
        latestUpdate,
        nextAction,
      };
    });
  }

  /** The employee directory: each employee with their email counts, last update and next follow-up. */
  employees(auth: AuthContext, companyId: string): Promise<CompanyEmployeeRow[]> {
    return this.prisma.run(auth, async (tx) => {
      const v = await this.visibleCompany(tx, auth, companyId);
      const tid = auth.tenantId;
      const rows = await tx.contact.findMany({ where: { tenantId: tid, companyId, deletedAt: null, ...contactScope(v) }, orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }], take: 1000 });
      const ids = rows.map((r) => r.id);
      if (!ids.length) return [];
      const [acts, emails, tasks, statuses, people] = await Promise.all([
        tx.activity.findMany({ where: { tenantId: tid, deletedAt: null, contactId: { in: ids } }, select: { contactId: true, type: true, interaction: true, occurredAt: true }, take: 50_000 }),
        tx.emailMessage.findMany({ where: { tenantId: tid, contactId: { in: ids } }, select: { contactId: true, direction: true, sentAt: true }, take: 50_000 }),
        tx.task.findMany({ where: { tenantId: tid, deletedAt: null, status: 'OPEN', contactId: { in: ids }, dueAt: { not: null } }, select: { contactId: true, dueAt: true } }),
        tx.crmStatus.findMany({ where: { tenantId: tid, id: { in: rows.map((r) => r.statusId).filter((s): s is string => !!s) } }, select: { id: true, name: true, color: true } }),
        personRefs(tx, tid, rows.map((r) => r.ownerId)),
      ]);
      const stat = new Map(ids.map((id) => [id, { sent: 0, received: 0, last: null as Date | null, next: null as Date | null }]));
      const later = (a: Date | null, b: Date) => (!a || b > a ? b : a);
      for (const a of acts) {
        const s = stat.get(a.contactId!)!;
        const kind = a.interaction ?? (a.type === 'EMAIL' ? 'EMAIL_SENT' : a.type);
        if (kind === 'EMAIL_SENT') s.sent++;
        if (kind === 'EMAIL_RECEIVED') s.received++;
        s.last = later(s.last, a.occurredAt);
      }
      for (const e of emails) {
        const s = stat.get(e.contactId!)!;
        if (e.direction === 'OUTBOUND') s.sent++;
        else s.received++;
        s.last = later(s.last, e.sentAt);
      }
      for (const t of tasks) {
        const s = stat.get(t.contactId!)!;
        if (!s.next || t.dueAt! < s.next) s.next = t.dueAt;
      }
      const statusById = new Map(statuses.map((s) => [s.id, s]));
      return rows.map((r) => {
        const s = stat.get(r.id)!;
        const details = canSeeDetails(v, r.ownerId);
        const next = [s.next, r.nextFollowUpAt].filter((d): d is Date => !!d).sort((a, b) => a.getTime() - b.getTime())[0];
        return {
          id: r.id,
          name: [r.firstName, r.lastName].filter(Boolean).join(' '),
          jobTitle: r.jobTitle,
          linkedinUrl: details ? r.linkedinUrl : null,
          email: details ? r.email : null,
          phone: details ? r.phone : null,
          status: r.statusId ? (statusById.get(r.statusId) ?? null) : null,
          emailsSent: s.sent,
          responsesReceived: s.received,
          lastUpdateAt: (s.last ?? r.updatedAt).toISOString(),
          nextFollowUpAt: next?.toISOString() ?? null,
          owner: r.ownerId ? (people.get(r.ownerId) ?? null) : null,
          remarks: details ? r.remarks : null,
          details,
        };
      });
    });
  }

  // ─── Interactions ───

  /** Logged interactions merged with emails synced from connected mailboxes, newest first. */
  interactions(auth: AuthContext, companyId: string, q: InteractionQuery): Promise<InteractionRow[]> {
    return this.prisma.run(auth, async (tx) => {
      await this.visibleCompany(tx, auth, companyId);
      const tid = auth.tenantId;
      const contacts = await tx.contact.findMany({ where: { tenantId: tid, companyId, deletedAt: null }, select: { id: true, firstName: true, lastName: true } });
      const contactIds = q.contactId ? contacts.filter((c) => c.id === q.contactId).map((c) => c.id) : contacts.map((c) => c.id);
      const where: Prisma.ActivityWhereInput = {
        tenantId: tid,
        deletedAt: null,
        ...(q.contactId ? { contactId: q.contactId } : { OR: [{ companyId }, ...(contactIds.length ? [{ contactId: { in: contactIds } }] : [])] }),
        ...(q.kind ? kindFilter(q.kind) : {}),
      };
      const acts = await tx.activity.findMany({ where, orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }], take: q.limit });
      const wantEmails = !q.kind || q.kind === 'EMAIL_SENT' || q.kind === 'EMAIL_RECEIVED';
      const emails =
        wantEmails && contactIds.length
          ? await tx.emailMessage.findMany({
              where: { tenantId: tid, contactId: { in: contactIds }, ...(q.kind ? { direction: q.kind === 'EMAIL_SENT' ? 'OUTBOUND' : 'INBOUND' } : {}) },
              orderBy: { sentAt: 'desc' },
              take: q.limit,
            })
          : [];
      const [people, files, rfqs] = await Promise.all([
        personRefs(tx, tid, acts.map((a) => a.ownerId)),
        tx.companyFile.findMany({ where: { tenantId: tid, id: { in: acts.map((a) => a.fileId).filter((f): f is string => !!f) } }, select: { id: true, name: true } }),
        tx.rfq.findMany({ where: { tenantId: tid, id: { in: acts.map((a) => a.rfqId).filter((f): f is string => !!f) } }, select: { id: true, number: true } }),
      ]);
      const contactName = new Map(contacts.map((c) => [c.id, [c.firstName, c.lastName].filter(Boolean).join(' ')]));
      const contactRef = (id: string | null) => (id && contactName.has(id) ? { id, name: contactName.get(id)! } : null);
      const fileById = new Map(files.map((f) => [f.id, f]));
      const rfqById = new Map(rfqs.map((r) => [r.id, r]));
      const rows: InteractionRow[] = [
        ...acts.map((a) => ({
          id: a.id,
          source: 'LOGGED' as const,
          kind: (a.interaction ?? legacyKind(a.type)) as InteractionKind,
          subject: a.subject,
          occurredAt: a.occurredAt.toISOString(),
          companyId: a.companyId,
          contact: contactRef(a.contactId),
          sender: a.sender,
          recipient: a.recipient,
          outcome: a.outcome,
          remarks: a.body,
          nextAction: a.nextAction,
          followUpAt: a.followUpAt?.toISOString() ?? null,
          file: a.fileId ? (fileById.get(a.fileId) ?? null) : null,
          rfq: a.rfqId ? (rfqById.get(a.rfqId) ?? null) : null,
          createdBy: a.ownerId ? (people.get(a.ownerId) ?? null) : null,
          aiAssisted: a.aiAssisted,
        })),
        ...emails.map((e) => ({
          id: e.id,
          source: 'SYNCED' as const,
          kind: (e.direction === 'OUTBOUND' ? 'EMAIL_SENT' : 'EMAIL_RECEIVED') as InteractionKind,
          subject: e.subject,
          occurredAt: e.sentAt.toISOString(),
          companyId,
          contact: contactRef(e.contactId),
          sender: e.fromAddress,
          recipient: e.toAddresses.join(', ') || null,
          outcome: null,
          remarks: e.snippet,
          nextAction: null,
          followUpAt: null,
          file: null,
          rfq: null,
          createdBy: null,
          aiAssisted: false,
        })),
      ];
      return rows.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)).slice(0, q.limit);
    });
  }

  logInteraction(auth: AuthContext, input: InteractionInput, meta: RequestMeta): Promise<InteractionRow> {
    return this.prisma.run(auth, async (tx) => {
      const company = await this.editableCompany(tx, auth, input.companyId);
      await this.assertCompanyChildren(tx, auth.tenantId, input.companyId, { contactId: input.contactId, fileId: input.fileId, rfqId: input.rfqId });
      const id = await this.logIn(tx, auth, input);
      if (input.followUpAt) {
        await this.createFollowUpIn(tx, auth, {
          companyId: input.companyId,
          contactId: input.contactId ?? null,
          type: followUpTypeFor(input.kind),
          title: input.nextAction || `Follow up: ${input.subject}`,
          dueAt: input.followUpAt,
          priority: 'NORMAL',
          assigneeId: company.ownerId ?? auth.userId,
          summary: input.outcome ?? input.remarks ?? null,
          nextAction: input.nextAction ?? null,
          rfqId: input.rfqId ?? null,
        });
      }
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'activity.logged', entityType: 'activity', entityId: id, metadata: { type: INTERACTION_ACTIVITY_TYPE[input.kind], interaction: input.kind }, meta });
      const rows = await this.interactionsIn(tx, auth.tenantId, [id]);
      return rows[0]!;
    });
  }

  removeInteraction(auth: AuthContext, id: string, meta: RequestMeta): Promise<void> {
    return this.prisma.run(auth, async (tx) => {
      const a = await tx.activity.findFirst({ where: { id, tenantId: auth.tenantId, deletedAt: null }, select: { companyId: true, ownerId: true } });
      if (!a?.companyId) throw notFound('Activity');
      await this.editableCompany(tx, auth, a.companyId);
      await tx.activity.update({ where: { id }, data: { deletedAt: new Date() } });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'activity.deleted', entityType: 'activity', entityId: id, meta });
    });
  }

  private async logIn(tx: TenantTx, auth: AuthContext, input: InteractionInput & { occurredAt?: string }): Promise<string> {
    const row = await tx.activity.create({
      data: {
        tenantId: auth.tenantId,
        type: INTERACTION_ACTIVITY_TYPE[input.kind],
        interaction: input.kind,
        subject: input.subject,
        body: input.remarks ?? null,
        occurredAt: input.occurredAt ? new Date(input.occurredAt) : new Date(),
        ownerId: auth.userId,
        companyId: input.companyId,
        contactId: input.contactId ?? null,
        sender: input.sender ?? null,
        recipient: input.recipient ?? null,
        outcome: input.outcome ?? null,
        nextAction: input.nextAction ?? null,
        followUpAt: input.followUpAt ? new Date(input.followUpAt) : null,
        fileId: input.fileId ?? null,
        rfqId: input.rfqId ?? null,
      },
    });
    return row.id;
  }

  private async interactionsIn(tx: TenantTx, tenantId: string, ids: string[]): Promise<InteractionRow[]> {
    const acts = await tx.activity.findMany({ where: { tenantId, id: { in: ids } } });
    const people = await personRefs(tx, tenantId, acts.map((a) => a.ownerId));
    const contacts = await tx.contact.findMany({ where: { tenantId, id: { in: acts.map((a) => a.contactId).filter((c): c is string => !!c) } }, select: { id: true, firstName: true, lastName: true } });
    const files = await tx.companyFile.findMany({ where: { tenantId, id: { in: acts.map((a) => a.fileId).filter((f): f is string => !!f) } }, select: { id: true, name: true } });
    const rfqs = await tx.rfq.findMany({ where: { tenantId, id: { in: acts.map((a) => a.rfqId).filter((f): f is string => !!f) } }, select: { id: true, number: true } });
    return acts.map((a) => {
      const c = contacts.find((x) => x.id === a.contactId);
      return {
        id: a.id, source: 'LOGGED', kind: (a.interaction ?? legacyKind(a.type)) as InteractionKind, subject: a.subject, occurredAt: a.occurredAt.toISOString(),
        companyId: a.companyId, contact: c ? { id: c.id, name: [c.firstName, c.lastName].filter(Boolean).join(' ') } : null,
        sender: a.sender, recipient: a.recipient, outcome: a.outcome, remarks: a.body, nextAction: a.nextAction, followUpAt: a.followUpAt?.toISOString() ?? null,
        file: files.find((f) => f.id === a.fileId) ?? null, rfq: rfqs.find((r) => r.id === a.rfqId) ?? null,
        createdBy: a.ownerId ? (people.get(a.ownerId) ?? null) : null, aiAssisted: a.aiAssisted,
      };
    });
  }

  // ─── Follow-ups ───

  followUps(auth: AuthContext, q: FollowUpQuery): Promise<FollowUpRow[]> {
    return this.prisma.run(auth, async (tx) => {
      const where = await this.followUpWhere(tx, auth, q);
      const now = new Date();
      const bucket = q.bucket ?? 'upcoming';
      const today = startOfDayIn(now, q.tz);
      const tomorrow = new Date(today.getTime() + DAY);
      const b = bucketWhere(bucket, now, today, tomorrow);
      const rows = await tx.task.findMany({
        where: { ...where, ...b },
        orderBy: bucket === 'completed' || bucket === 'cancelled' ? [{ completedAt: nullsLast('desc') }, { updatedAt: 'desc' }] : [{ dueAt: nullsLast('asc') }, { createdAt: 'asc' }],
        take: 300,
      });
      return this.followUpRows(tx, auth.tenantId, rows, now, q.tz);
    });
  }

  followUpCounts(auth: AuthContext, q: FollowUpQuery): Promise<FollowUpCounts> {
    return this.prisma.run(auth, async (tx) => {
      const where = await this.followUpWhere(tx, auth, q);
      const now = new Date();
      const today = startOfDayIn(now, q.tz);
      const tomorrow = new Date(today.getTime() + DAY);
      const counts = await Promise.all(FOLLOW_UP_BUCKETS.map((bk) => tx.task.count({ where: { ...where, ...bucketWhere(bk, now, today, tomorrow) } })));
      return Object.fromEntries(FOLLOW_UP_BUCKETS.map((bk, i) => [bk, counts[i]])) as FollowUpCounts;
    });
  }

  createFollowUp(auth: AuthContext, input: FollowUpInput, meta: RequestMeta): Promise<FollowUpRow> {
    return this.prisma.run(auth, async (tx) => {
      const company = await this.editableCompany(tx, auth, input.companyId);
      await this.assertCompanyChildren(tx, auth.tenantId, input.companyId, { contactId: input.contactId, rfqId: input.rfqId });
      const row = await this.createFollowUpIn(tx, auth, { ...input, assigneeId: input.assigneeId ?? company.ownerId ?? auth.userId });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'task.created', entityType: 'task', entityId: row.id, metadata: { followUp: input.type, assigneeId: row.assigneeId }, meta });
      return (await this.followUpRows(tx, auth.tenantId, [row], new Date(), 'UTC'))[0]!;
    });
  }

  updateFollowUp(auth: AuthContext, id: string, input: z.output<typeof followUpUpdateSchema>, meta: RequestMeta): Promise<FollowUpRow> {
    return this.prisma.run(auth, async (tx) => {
      const before = await this.editableFollowUp(tx, auth, id);
      await this.assertCompanyChildren(tx, auth.tenantId, before.companyId!, { contactId: input.contactId, rfqId: input.rfqId });
      if (input.assigneeId) await assertMember(tx, auth.tenantId, input.assigneeId, 'assigneeId');
      if (input.managerId) await assertMember(tx, auth.tenantId, input.managerId, 'managerId');
      const row = await tx.task.update({
        where: { id },
        data: {
          ...(input.type !== undefined ? { followUpType: input.type } : {}),
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.dueAt !== undefined ? { dueAt: new Date(input.dueAt) } : {}),
          ...(input.priority !== undefined ? { priority: input.priority } : {}),
          ...(input.contactId !== undefined ? { contactId: input.contactId } : {}),
          ...(input.assigneeId !== undefined ? { assigneeId: input.assigneeId } : {}),
          ...(input.managerId !== undefined ? { managerId: input.managerId } : {}),
          ...(input.summary !== undefined ? { summary: input.summary } : {}),
          ...(input.nextAction !== undefined ? { nextAction: input.nextAction } : {}),
          ...(input.remarks !== undefined ? { remarks: input.remarks } : {}),
          ...(input.rfqId !== undefined ? { rfqId: input.rfqId } : {}),
        },
      });
      if (input.assigneeId && input.assigneeId !== before.assigneeId) await this.notifyAssignee(tx, auth, row);
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'task.updated', entityType: 'task', entityId: id, metadata: { followUp: true }, meta });
      return (await this.followUpRows(tx, auth.tenantId, [row], new Date(), 'UTC'))[0]!;
    });
  }

  completeFollowUp(auth: AuthContext, id: string, outcome: string | null | undefined, meta: RequestMeta): Promise<FollowUpRow> {
    return this.prisma.run(auth, async (tx) => {
      const before = await this.editableFollowUp(tx, auth, id);
      if (before.status !== 'OPEN') throw notOpen();
      const row = await tx.task.update({ where: { id }, data: { status: 'DONE', completedAt: new Date(), outcome: outcome ?? null } });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'task.completed', entityType: 'task', entityId: id, metadata: { followUp: true }, meta });
      return (await this.followUpRows(tx, auth.tenantId, [row], new Date(), 'UTC'))[0]!;
    });
  }

  rescheduleFollowUp(auth: AuthContext, id: string, dueAt: string, reason: string | null | undefined, meta: RequestMeta): Promise<FollowUpRow> {
    return this.prisma.run(auth, async (tx) => {
      const before = await this.editableFollowUp(tx, auth, id);
      if (before.status !== 'OPEN') throw notOpen();
      const note = reason ? `${before.remarks ? `${before.remarks}\n` : ''}Rescheduled: ${reason}` : before.remarks;
      const row = await tx.task.update({ where: { id }, data: { dueAt: new Date(dueAt), rescheduleCount: { increment: 1 }, rescheduledAt: new Date(), remarks: note } });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'task.updated', entityType: 'task', entityId: id, metadata: { followUp: true, rescheduled: { from: before.dueAt?.toISOString() ?? null, to: dueAt } }, meta });
      return (await this.followUpRows(tx, auth.tenantId, [row], new Date(), 'UTC'))[0]!;
    });
  }

  cancelFollowUp(auth: AuthContext, id: string, meta: RequestMeta): Promise<FollowUpRow> {
    return this.prisma.run(auth, async (tx) => {
      const before = await this.editableFollowUp(tx, auth, id);
      if (before.status !== 'OPEN') throw notOpen();
      const row = await tx.task.update({ where: { id }, data: { status: 'CANCELED', completedAt: new Date() } });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'task.updated', entityType: 'task', entityId: id, metadata: { followUp: true, cancelled: true }, meta });
      return (await this.followUpRows(tx, auth.tenantId, [row], new Date(), 'UTC'))[0]!;
    });
  }

  private async createFollowUpIn(tx: TenantTx, auth: AuthContext, input: Omit<FollowUpInput, 'priority'> & { priority?: FollowUpInput['priority'] }): Promise<TaskModel> {
    const assigneeId = input.assigneeId ?? auth.userId;
    await assertMember(tx, auth.tenantId, assigneeId, 'assigneeId');
    if (input.managerId) await assertMember(tx, auth.tenantId, input.managerId, 'managerId');
    const managerId = input.managerId ?? (await tx.membership.findFirst({ where: { tenantId: auth.tenantId, userId: assigneeId, status: 'ACTIVE' }, select: { reportingManagerId: true } }))?.reportingManagerId ?? null;
    const row = await tx.task.create({
      data: {
        tenantId: auth.tenantId,
        title: input.title,
        priority: input.priority ?? 'NORMAL',
        dueAt: new Date(input.dueAt),
        assigneeId,
        managerId,
        companyId: input.companyId,
        contactId: input.contactId ?? null,
        followUpType: input.type,
        summary: input.summary ?? null,
        nextAction: input.nextAction ?? null,
        remarks: input.remarks ?? null,
        rfqId: input.rfqId ?? null,
        createdById: auth.userId,
      },
    });
    await this.notifyAssignee(tx, auth, row);
    return row;
  }

  private async notifyAssignee(tx: TenantTx, auth: AuthContext, row: TaskModel): Promise<void> {
    if (!row.assigneeId || row.assigneeId === auth.userId) return;
    const by = (await tx.user.findUnique({ where: { id: auth.userId }, select: { name: true } }))?.name ?? '';
    await this.notifications.send(tx, auth.tenantId, [row.assigneeId], {
      type: 'followup.assigned',
      title: `Follow-up assigned to you: ${row.title}`,
      body: `Assigned by ${by}.`,
      link: row.companyId ? `/app/companies/${row.companyId}` : '/app/follow-ups',
    });
  }

  /** Follow-ups the caller may list: by scope, and only for companies they can see. */
  private async followUpWhere(tx: TenantTx, auth: AuthContext, q: FollowUpQuery): Promise<Prisma.TaskWhereInput> {
    const base: Prisma.TaskWhereInput = { tenantId: auth.tenantId, deletedAt: null, followUpType: { not: null } };
    if (q.companyId) {
      await this.visibleCompany(tx, auth, q.companyId);
      return { ...base, companyId: q.companyId, ...(q.contactId ? { contactId: q.contactId } : {}) };
    }
    if (q.contactId) {
      const v = await visibility(tx, auth);
      if (!(await tx.contact.findFirst({ where: { id: q.contactId, tenantId: auth.tenantId, deletedAt: null, ...contactScope(v) }, select: { id: true } }))) throw notFound('Contact');
      return { ...base, contactId: q.contactId };
    }
    const scope = scopeOf(auth);
    if (q.scope === 'all' && scope === 'ALL') return base;
    if (q.scope === 'mine') return { ...base, assigneeId: auth.userId };
    // Team: me and everyone reporting to me. Roles limited to their own records see only their own follow-ups.
    const team = scope === 'OWN' ? [] : await reportingTree(tx, auth.tenantId, auth.userId);
    return { ...base, OR: [{ assigneeId: { in: [auth.userId, ...team] } }, { managerId: auth.userId }] };
  }

  private async editableFollowUp(tx: TenantTx, auth: AuthContext, id: string): Promise<TaskModel> {
    const t = await tx.task.findFirst({ where: { id, tenantId: auth.tenantId, deletedAt: null, followUpType: { not: null } } });
    if (!t?.companyId) throw notFound('Follow-up');
    // The assignee and their manager may always act on it; others need to be able to change the company.
    if (t.assigneeId !== auth.userId && t.managerId !== auth.userId) await this.editableCompany(tx, auth, t.companyId);
    return t;
  }

  private async followUpRows(tx: TenantTx, tenantId: string, rows: TaskModel[], now: Date, tz: string): Promise<FollowUpRow[]> {
    const [people, companies, contacts] = await Promise.all([
      personRefs(tx, tenantId, rows.flatMap((r) => [r.assigneeId, r.managerId])),
      tx.company.findMany({ where: { tenantId, id: { in: rows.map((r) => r.companyId).filter((c): c is string => !!c) } }, select: { id: true, name: true, leadNumber: true } }),
      tx.contact.findMany({ where: { tenantId, id: { in: rows.map((r) => r.contactId).filter((c): c is string => !!c) } }, select: { id: true, firstName: true, lastName: true } }),
    ]);
    const today = startOfDayIn(now, tz);
    const companyById = new Map(companies.map((c) => [c.id, c]));
    const contactById = new Map(contacts.map((c) => [c.id, { id: c.id, name: [c.firstName, c.lastName].filter(Boolean).join(' ') }]));
    return rows.map((r) => ({
      id: r.id,
      type: (r.followUpType ?? 'OTHER') as FollowUpType,
      title: r.title,
      dueAt: r.dueAt?.toISOString() ?? null,
      due: dueState(r, now, today),
      status: r.status,
      priority: r.priority,
      company: r.companyId ? (companyById.get(r.companyId) ?? null) : null,
      contact: r.contactId ? (contactById.get(r.contactId) ?? null) : null,
      assignee: r.assigneeId ? (people.get(r.assigneeId) ?? null) : null,
      manager: r.managerId ? (people.get(r.managerId) ?? null) : null,
      summary: r.summary,
      nextAction: r.nextAction,
      remarks: r.remarks,
      outcome: r.outcome,
      rescheduleCount: r.rescheduleCount,
      completedAt: r.completedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  // ─── RFQs ───

  listRfqs(auth: AuthContext, q: RfqQuery): Promise<Page<RfqRow>> {
    return this.prisma.run(auth, async (tx) => {
      const v = await visibility(tx, auth);
      if (q.companyId) await this.visibleCompany(tx, auth, q.companyId);
      const where: Prisma.RfqWhereInput = {
        tenantId: auth.tenantId,
        deletedAt: null,
        ...(q.companyId ? { companyId: q.companyId } : v.all ? {} : { companyId: { in: await visibleCompanyIds(tx, auth.tenantId, v) } }),
        ...(q.contactId ? { contactId: q.contactId } : {}),
        ...(q.ownerId ? { ownerId: q.ownerId } : {}),
        ...(q.status ? { status: q.status } : q.open === 'true' ? { status: { in: [...RFQ_OPEN_STATUSES] } } : q.open === 'false' ? { status: { notIn: [...RFQ_OPEN_STATUSES] } } : {}),
        ...(q.q ? { OR: [{ number: { contains: q.q, mode: 'insensitive' } }, { projectName: { contains: q.q, mode: 'insensitive' } }] } : {}),
      };
      const [rows, total] = await Promise.all([
        tx.rfq.findMany({ where, orderBy: [{ receivedAt: 'desc' }, { seq: 'desc' }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
        tx.rfq.count({ where }),
      ]);
      return { items: await this.rfqRows(tx, auth.tenantId, rows), total, page: q.page, pageSize: q.pageSize };
    });
  }

  getRfq(auth: AuthContext, id: string): Promise<RfqRow> {
    return this.prisma.run(auth, async (tx) => {
      const r = await this.visibleRfq(tx, auth, id);
      return (await this.rfqRows(tx, auth.tenantId, [r]))[0]!;
    });
  }

  createRfq(auth: AuthContext, input: RfqInput, meta: RequestMeta): Promise<RfqRow> {
    return this.prisma.run(auth, async (tx) => {
      const company = await this.editableCompany(tx, auth, input.companyId);
      await this.assertCompanyChildren(tx, auth.tenantId, input.companyId, { contactId: input.contactId });
      const ownerId = input.ownerId ?? company.ownerId ?? auth.userId;
      await assertMember(tx, auth.tenantId, ownerId, 'ownerId');
      if (input.managerId) await assertMember(tx, auth.tenantId, input.managerId, 'managerId');
      const seq = await nextSequenceValue(tx, `rfq:${auth.tenantId}`);
      const receivedAt = input.receivedAt ? new Date(input.receivedAt) : new Date();
      const row = await tx.rfq.create({
        data: {
          tenantId: auth.tenantId,
          number: `RFQ-${String(seq).padStart(4, '0')}`,
          seq,
          companyId: input.companyId,
          contactId: input.contactId ?? null,
          projectName: input.projectName,
          description: input.description ?? null,
          methodology: input.methodology ?? null,
          market: input.market ?? null,
          industry: input.industry ?? null,
          targetAudience: input.targetAudience ?? null,
          sampleSize: input.sampleSize ?? null,
          loi: input.loi ?? null,
          ir: input.ir ?? null,
          cpi: input.cpi ?? null,
          totalQuotation: input.totalQuotation ?? quotationOf(input.sampleSize, input.cpi),
          currency: input.currency,
          receivedAt,
          submittedAt: input.submittedAt ? new Date(input.submittedAt) : RFQ_SUBMITTED_STATUSES.includes(input.status) ? new Date() : null,
          deadlineAt: input.deadlineAt ? new Date(input.deadlineAt) : null,
          status: input.status,
          statusChangedAt: new Date(),
          ownerId,
          managerId: input.managerId ?? company.managerId ?? null,
          expectedRevenue: input.expectedRevenue ?? null,
          actualRevenue: input.actualRevenue ?? null,
          outcomeReason: input.outcomeReason ?? null,
          createdById: auth.userId,
          updatedById: auth.userId,
        },
      });
      // Receiving the RFQ is an interaction with the company in its own right.
      await this.logIn(tx, auth, { companyId: row.companyId, contactId: row.contactId, kind: 'RFQ_RECEIVED', subject: `${row.number}: ${row.projectName}`, occurredAt: receivedAt.toISOString(), rfqId: row.id });
      if (row.ownerId && row.ownerId !== auth.userId) {
        await this.notifications.send(tx, auth.tenantId, [row.ownerId], { type: 'rfq.assigned', title: `RFQ assigned to you: ${`${row.number} ${row.projectName}`}`, body: null, link: `/app/rfqs?open=${row.id}` });
      }
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'rfq.created', entityType: 'rfq', entityId: row.id, metadata: { number: row.number, companyId: row.companyId }, meta });
      return (await this.rfqRows(tx, auth.tenantId, [row]))[0]!;
    });
  }

  updateRfq(auth: AuthContext, id: string, input: z.output<typeof rfqUpdateSchema>, meta: RequestMeta): Promise<RfqRow> {
    return this.prisma.run(auth, async (tx) => {
      const before = await this.visibleRfq(tx, auth, id);
      await this.editableCompany(tx, auth, before.companyId);
      await this.assertCompanyChildren(tx, auth.tenantId, before.companyId, { contactId: input.contactId });
      if (input.ownerId) await assertMember(tx, auth.tenantId, input.ownerId, 'ownerId');
      if (input.managerId) await assertMember(tx, auth.tenantId, input.managerId, 'managerId');
      const statusChanged = input.status !== undefined && input.status !== before.status;
      const data: Prisma.RfqUncheckedUpdateInput = { updatedById: auth.userId };
      const keys = ['contactId', 'projectName', 'description', 'methodology', 'market', 'industry', 'targetAudience', 'sampleSize', 'loi', 'ir', 'cpi', 'totalQuotation', 'currency', 'ownerId', 'managerId', 'expectedRevenue', 'actualRevenue', 'outcomeReason'] as const;
      for (const k of keys) if (input[k] !== undefined) (data as Record<string, unknown>)[k] = input[k];
      if (input.receivedAt) data.receivedAt = new Date(input.receivedAt);
      for (const k of ['submittedAt', 'deadlineAt'] as const) if (input[k] !== undefined) data[k] = input[k] ? new Date(input[k]!) : null;
      if ((input.sampleSize !== undefined || input.cpi !== undefined) && input.totalQuotation === undefined && before.totalQuotation === quotationOf(before.sampleSize, before.cpi)) {
        // The total was the computed one; keep it in step with the new sample size or CPI.
        data.totalQuotation = quotationOf(input.sampleSize !== undefined ? input.sampleSize : before.sampleSize, input.cpi !== undefined ? input.cpi : before.cpi);
      }
      if (statusChanged) {
        data.status = input.status;
        data.statusChangedAt = new Date();
        if (RFQ_SUBMITTED_STATUSES.includes(input.status!) && !before.submittedAt && input.submittedAt === undefined) data.submittedAt = new Date();
      }
      const row = await tx.rfq.update({ where: { id }, data });
      if (statusChanged && input.status === 'QUOTATION_SUBMITTED') {
        await this.logIn(tx, auth, { companyId: row.companyId, contactId: row.contactId, kind: 'RFQ_SUBMITTED', subject: `${row.number}: quotation submitted`, rfqId: row.id });
      }
      await this.audit.record(tx, {
        tenantId: auth.tenantId, actorUserId: auth.userId, action: statusChanged ? 'rfq.status_changed' : 'rfq.updated', entityType: 'rfq', entityId: id,
        metadata: statusChanged ? { from: before.status, to: input.status } : { fields: Object.keys(input) }, meta,
      });
      return (await this.rfqRows(tx, auth.tenantId, [row]))[0]!;
    });
  }

  removeRfq(auth: AuthContext, id: string, meta: RequestMeta): Promise<void> {
    return this.prisma.run(auth, async (tx) => {
      const r = await this.visibleRfq(tx, auth, id);
      await this.editableCompany(tx, auth, r.companyId);
      await tx.rfq.update({ where: { id }, data: { deletedAt: new Date() } });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'rfq.deleted', entityType: 'rfq', entityId: id, metadata: { number: r.number }, meta });
    });
  }

  /** Creates the deal for a won (or nearly won) RFQ and links the two. */
  async convertRfq(auth: AuthContext, id: string, input: { name?: string; amount?: number | null }, meta: RequestMeta): Promise<RfqRow> {
    const r = await this.prisma.run(auth, async (tx) => {
      const rfq = await this.visibleRfq(tx, auth, id);
      await this.editableCompany(tx, auth, rfq.companyId);
      if (rfq.opportunityId) throw new BadRequestException({ code: 'RFQ_ALREADY_CONVERTED', message: 'This RFQ already has a deal.' });
      if (['LOST', 'CANCELLED'].includes(rfq.status)) throw new BadRequestException({ code: 'RFQ_CLOSED', message: 'A lost or cancelled RFQ cannot become a deal.' });
      return rfq;
    });
    const deal = await this.deals.create(
      auth,
      {
        name: input.name ?? `${r.number} ${r.projectName}`,
        amount: input.amount ?? r.actualRevenue ?? r.totalQuotation ?? r.expectedRevenue ?? 0,
        currency: r.currency,
        companyId: r.companyId,
        contactId: r.contactId,
        ownerId: r.ownerId,
        customFields: {},
      },
      meta,
    );
    return this.prisma.run(auth, async (tx) => {
      const row = await tx.rfq.update({ where: { id }, data: { opportunityId: deal.id, updatedById: auth.userId } });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'rfq.converted', entityType: 'rfq', entityId: id, metadata: { dealId: deal.id }, meta });
      return (await this.rfqRows(tx, auth.tenantId, [row]))[0]!;
    });
  }

  /** RFQ counts and values grouped by company, by the client employee (POC), or by the RFQ owner. */
  rfqReport(auth: AuthContext, by: 'company' | 'employee' | 'owner'): Promise<RfqReportRow[]> {
    return this.prisma.run(auth, async (tx) => {
      const v = await visibility(tx, auth);
      const rows = await tx.rfq.findMany({
        where: { tenantId: auth.tenantId, deletedAt: null, ...(v.all ? {} : { companyId: { in: await visibleCompanyIds(tx, auth.tenantId, v) } }) },
        select: { companyId: true, contactId: true, ownerId: true, status: true, totalQuotation: true, actualRevenue: true, currency: true },
        take: 50_000,
      });
      const keyOf = (r: (typeof rows)[number]) => (by === 'company' ? r.companyId : by === 'employee' ? r.contactId : r.ownerId);
      const groups = new Map<string | null, typeof rows>();
      for (const r of rows) groups.set(keyOf(r), [...(groups.get(keyOf(r)) ?? []), r]);
      const ids = [...groups.keys()].filter((k): k is string => !!k);
      const labels = new Map<string, string>();
      if (by === 'company') for (const c of await tx.company.findMany({ where: { tenantId: auth.tenantId, id: { in: ids } }, select: { id: true, name: true, leadNumber: true } })) labels.set(c.id, c.leadNumber ? `${c.leadNumber} ${c.name}` : c.name);
      if (by === 'employee') for (const c of await tx.contact.findMany({ where: { tenantId: auth.tenantId, id: { in: ids } }, select: { id: true, firstName: true, lastName: true } })) labels.set(c.id, [c.firstName, c.lastName].filter(Boolean).join(' '));
      if (by === 'owner') for (const [id, p] of await personRefs(tx, auth.tenantId, ids)) labels.set(id, p.name);
      return [...groups.entries()]
        .map(([key, list]) => ({
          key,
          label: key ? (labels.get(key) ?? '—') : '',
          received: list.length,
          submitted: list.filter((r) => RFQ_SUBMITTED_STATUSES.includes(r.status as RfqStatus)).length,
          won: list.filter((r) => r.status === 'WON').length,
          lost: list.filter((r) => r.status === 'LOST').length,
          open: list.filter((r) => RFQ_OPEN_STATUSES.includes(r.status as RfqStatus)).length,
          quoted: sumByCurrency(list.filter((r) => RFQ_SUBMITTED_STATUSES.includes(r.status as RfqStatus)).map((r) => ({ currency: r.currency, amount: r.totalQuotation }))),
          wonValue: sumByCurrency(list.filter((r) => r.status === 'WON').map((r) => ({ currency: r.currency, amount: r.actualRevenue ?? r.totalQuotation }))),
        }))
        .sort((a, b) => b.received - a.received || a.label.localeCompare(b.label));
    });
  }

  private async visibleRfq(tx: TenantTx, auth: AuthContext, id: string): Promise<RfqModel> {
    const r = await tx.rfq.findFirst({ where: { id, tenantId: auth.tenantId, deletedAt: null } });
    if (!r) throw notFound('RFQ');
    try {
      await this.visibleCompany(tx, auth, r.companyId);
    } catch {
      throw notFound('RFQ');
    }
    return r;
  }

  private async rfqRows(tx: TenantTx, tenantId: string, rows: RfqModel[]): Promise<RfqRow[]> {
    if (!rows.length) return [];
    const [companies, contacts, people, deals, files] = await Promise.all([
      tx.company.findMany({ where: { tenantId, id: { in: rows.map((r) => r.companyId) } }, select: { id: true, name: true, leadNumber: true } }),
      tx.contact.findMany({ where: { tenantId, id: { in: rows.map((r) => r.contactId).filter((c): c is string => !!c) } }, select: { id: true, firstName: true, lastName: true } }),
      personRefs(tx, tenantId, rows.flatMap((r) => [r.ownerId, r.managerId, r.createdById])),
      tx.opportunity.findMany({ where: { tenantId, id: { in: rows.map((r) => r.opportunityId).filter((c): c is string => !!c) } }, select: { id: true, name: true } }),
      tx.companyFile.findMany({ where: { tenantId, rfqId: { in: rows.map((r) => r.id) } }, select: { id: true, name: true, sizeBytes: true, rfqId: true }, orderBy: { createdAt: 'desc' } }),
    ]);
    const ref = (id: string | null) => (id ? (people.get(id) ?? null) : null);
    return rows.map((r) => {
      const c = contacts.find((x) => x.id === r.contactId);
      return {
        id: r.id, number: r.number,
        company: companies.find((x) => x.id === r.companyId) ?? { id: r.companyId, name: '', leadNumber: null },
        contact: c ? { id: c.id, name: [c.firstName, c.lastName].filter(Boolean).join(' ') } : null,
        projectName: r.projectName, description: r.description, methodology: r.methodology, market: r.market, industry: r.industry, targetAudience: r.targetAudience,
        sampleSize: r.sampleSize, loi: r.loi, ir: r.ir, cpi: r.cpi, totalQuotation: r.totalQuotation, currency: r.currency,
        receivedAt: r.receivedAt.toISOString(), submittedAt: r.submittedAt?.toISOString() ?? null, deadlineAt: r.deadlineAt?.toISOString() ?? null,
        status: r.status as RfqStatus, statusChangedAt: r.statusChangedAt?.toISOString() ?? null,
        owner: ref(r.ownerId), manager: ref(r.managerId), createdBy: ref(r.createdById),
        expectedRevenue: r.expectedRevenue, actualRevenue: r.actualRevenue, outcomeReason: r.outcomeReason,
        deal: deals.find((d) => d.id === r.opportunityId) ?? null,
        files: files.filter((f) => f.rfqId === r.id).map((f) => ({ id: f.id, name: f.name, sizeBytes: f.sizeBytes })),
        createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(),
      };
    });
  }

  // ─── Access ───

  private async visibleCompany(tx: TenantTx, auth: AuthContext, companyId: string): Promise<Visibility> {
    const v = await visibility(tx, auth);
    if (!(await tx.company.findFirst({ where: { id: companyId, tenantId: auth.tenantId, deletedAt: null, ...companyScope(v) }, select: { id: true } }))) throw notFound('Company');
    return v;
  }

  private async editableCompany(tx: TenantTx, auth: AuthContext, companyId: string) {
    const v = await visibility(tx, auth);
    const c = await tx.company.findFirst({ where: { id: companyId, tenantId: auth.tenantId, deletedAt: null, ...companyScope(v) }, select: { id: true, ownerId: true, managerId: true } });
    if (!c) throw notFound('Company');
    if (!canSeeDetails(v, c.ownerId)) throw new BadRequestException({ code: 'DETAILS_HIDDEN', message: 'Your role cannot see or change the details of this company.' });
    return c;
  }

  /** The employee, file and RFQ must belong to the same company. */
  private async assertCompanyChildren(tx: TenantTx, tenantId: string, companyId: string, refs: { contactId?: string | null; fileId?: string | null; rfqId?: string | null }) {
    if (refs.contactId && !(await tx.contact.findFirst({ where: { tenantId, id: refs.contactId, companyId, deletedAt: null }, select: { id: true } }))) throw badRef('contactId', 'is not an employee of this company');
    if (refs.fileId && !(await tx.companyFile.findFirst({ where: { tenantId, id: refs.fileId, companyId }, select: { id: true } }))) throw badRef('fileId');
    if (refs.rfqId && !(await tx.rfq.findFirst({ where: { tenantId, id: refs.rfqId, companyId, deletedAt: null }, select: { id: true } }))) throw badRef('rfqId');
  }
}

async function assertMember(tx: TenantTx, tenantId: string, userId: string, field: string) {
  if (!(await tx.membership.findFirst({ where: { tenantId, userId, status: 'ACTIVE' }, select: { id: true } }))) throw badRef(field, 'is not an active member of this workspace');
}

async function visibleCompanyIds(tx: TenantTx, tenantId: string, v: Visibility): Promise<string[]> {
  const rows = await tx.company.findMany({ where: { tenantId, deletedAt: null, ...companyScope(v) }, select: { id: true }, take: 100_000 });
  return rows.map((r) => r.id);
}

function notOpen() {
  return new BadRequestException({ code: 'FOLLOW_UP_CLOSED', message: 'This follow-up is already completed or cancelled.' });
}

function quotationOf(sampleSize: number | null | undefined, cpi: number | null | undefined): number | null {
  return sampleSize != null && cpi != null ? Math.round(sampleSize * cpi * 100) / 100 : null;
}

/** Activities logged before interaction kinds existed. */
function legacyKind(type: string): InteractionKind {
  return type === 'EMAIL' ? 'EMAIL_SENT' : type === 'CALL' ? 'CALL_OUTGOING' : type === 'MEETING' ? 'MEETING' : 'OTHER';
}

function kindFilter(kind: InteractionKind): Prisma.ActivityWhereInput {
  const legacy: Partial<Record<InteractionKind, 'EMAIL' | 'CALL' | 'MEETING' | 'NOTE'>> = { EMAIL_SENT: 'EMAIL', CALL_OUTGOING: 'CALL', MEETING: 'MEETING', OTHER: 'NOTE' };
  const old = legacy[kind];
  return old ? { OR: [{ interaction: kind }, { AND: [{ type: old }, { OR: unset('interaction') }] }] } : { interaction: kind };
}

function followUpTypeFor(kind: InteractionKind): FollowUpType {
  if (kind.startsWith('EMAIL')) return 'EMAIL';
  if (kind.startsWith('CALL')) return 'CALL';
  if (kind === 'MEETING') return 'MEETING';
  if (kind === 'LINKEDIN' || kind === 'WHATSAPP') return kind;
  if (kind.startsWith('RFQ')) return 'RFQ';
  return 'OTHER';
}

function bucketWhere(bucket: FollowUpBucket, now: Date, today: Date, tomorrow: Date): Prisma.TaskWhereInput {
  switch (bucket) {
    case 'today':
      return { status: 'OPEN', dueAt: { gte: now, lt: tomorrow } };
    case 'overdue':
      return { status: 'OPEN', dueAt: { lt: now } };
    case 'upcoming':
      return { status: 'OPEN', OR: [{ dueAt: { gte: tomorrow } }, ...unset('dueAt')] };
    case 'completed':
      return { status: 'DONE' };
    case 'rescheduled':
      return { status: 'OPEN', rescheduleCount: { gt: 0 } };
    case 'cancelled':
      return { status: 'CANCELED' };
  }
}

function dueState(r: TaskModel, now: Date, today: Date): FollowUpDue {
  if (r.status === 'DONE') return 'COMPLETED';
  if (r.status === 'CANCELED') return 'CANCELLED';
  if (!r.dueAt) return 'NO_DATE';
  // Overdue once its time has passed; due today until then.
  if (r.dueAt < now) return 'OVERDUE';
  const tomorrow = today.getTime() + DAY;
  if (r.dueAt.getTime() < tomorrow) return 'TODAY';
  if (r.dueAt.getTime() < tomorrow + DAY) return 'TOMORROW';
  return 'UPCOMING';
}

