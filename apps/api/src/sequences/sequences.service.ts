import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma, type Sequence, type SequenceEnrollment, type TenantTx } from '@dealflow/database';
import {
  ENROLLMENT_FINISHED,
  type EnrollInput,
  type EnrollResult,
  type EnrollSkipReason,
  type EnrollmentRow,
  type EventRule,
  type SegmentRules,
  type SequenceInput,
  type SequenceRow,
  type SequenceSettings,
  type SequenceStats,
  type SequenceStep,
  type EmailCounts,
  type SequenceStepStats,
  type SuppressionRow,
  sequenceSettingsSchema,
} from '@dealflow/types';
import { AuditService } from '../audit/audit.service';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { iso, notFound, ownerRefs } from '../crm/crm-helpers';
import { segmentWhere } from '../marketing/segments.service';
import { loadContacts, loadLeads, type Person, personSubject } from './people';

const DAY = 86_400_000;
const MAX_ENROL = 500;

export const seqSteps = (s: Pick<Sequence, 'steps'>) => s.steps as unknown as SequenceStep[];
export const seqRules = (s: Pick<Sequence, 'rules'>) => s.rules as unknown as EventRule[];
export const seqSettings = (s: Pick<Sequence, 'settings'>): SequenceSettings => sequenceSettingsSchema.parse(s.settings ?? {});

/**
 * Sequences: CRUD, status, enrolment and the do-not-email list. Anyone with sequences:write can build
 * sequences and enrol people; each person's emails go from the enrolling person's own mailbox. Editing
 * someone else's sequence needs marketing:manage.
 */
@Injectable()
export class SequencesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(auth: AuthContext): Promise<SequenceRow[]> {
    return this.prisma.run(auth, async (tx) => {
      const rows = await tx.sequence.findMany({ where: { tenantId: auth.tenantId }, orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }] });
      return this.rows(tx, auth.tenantId, rows);
    });
  }

  get(auth: AuthContext, id: string): Promise<SequenceRow> {
    return this.prisma.run(auth, async (tx) => (await this.rows(tx, auth.tenantId, [await this.find(tx, auth.tenantId, id)]))[0]!);
  }

  create(auth: AuthContext, input: SequenceInput, meta: RequestMeta): Promise<SequenceRow> {
    return this.prisma.run(auth, async (tx) => {
      await this.assertRefs(tx, auth, input);
      const s = await tx.sequence.create({ data: { tenantId: auth.tenantId, ownerId: auth.userId, ...this.data(input) } });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'sequence.created', entityType: 'sequence', entityId: s.id, metadata: { name: s.name }, meta });
      return (await this.rows(tx, auth.tenantId, [s]))[0]!;
    });
  }

  update(auth: AuthContext, id: string, input: SequenceInput, meta: RequestMeta): Promise<SequenceRow> {
    return this.prisma.run(auth, async (tx) => {
      const s = await this.editable(tx, auth, id);
      await this.assertRefs(tx, auth, input, s.id);
      const before = seqSteps(s);
      // People part-way through keep their position by step id; removed steps end their run at the next step.
      const updated = await tx.sequence.update({ where: { id: s.id }, data: this.data(input) });
      if (before.length) {
        const after = input.steps.map((st) => st.id);
        const live = await tx.sequenceEnrollment.findMany({ where: { sequenceId: s.id, status: { in: ['ACTIVE', 'PAUSED'] } }, select: { id: true, stepIndex: true } });
        for (const e of live) {
          const currentId = before[e.stepIndex]?.id;
          const at = currentId ? after.indexOf(currentId) : -1;
          const next = at >= 0 ? at : Math.min(e.stepIndex, input.steps.length);
          if (next !== e.stepIndex) await tx.sequenceEnrollment.update({ where: { id: e.id }, data: { stepIndex: next } });
        }
      }
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'sequence.updated', entityType: 'sequence', entityId: s.id, metadata: { name: updated.name, steps: input.steps.length }, meta });
      return (await this.rows(tx, auth.tenantId, [updated]))[0]!;
    });
  }

  setStatus(auth: AuthContext, id: string, status: 'ACTIVE' | 'PAUSED' | 'ARCHIVED', meta: RequestMeta): Promise<SequenceRow> {
    return this.prisma.run(auth, async (tx) => {
      const s = await this.editable(tx, auth, id);
      if (status === 'ACTIVE') {
        const steps = seqSteps(s);
        if (!steps.some((st) => st.type === 'email')) throw new ConflictException({ code: 'NO_EMAIL_STEP', message: 'Add at least one email step before starting the sequence.' });
      }
      const updated = await tx.sequence.update({ where: { id: s.id }, data: { status } });
      if (status === 'ARCHIVED') {
        await tx.sequenceEnrollment.updateMany({ where: { sequenceId: s.id, status: { in: ['ACTIVE', 'PAUSED'] } }, data: { status: 'STOPPED', finishedAt: new Date(), nextRunAt: null, lastError: 'The sequence was archived.' } });
      }
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: `sequence.${status.toLowerCase()}`, entityType: 'sequence', entityId: s.id, metadata: { name: s.name, from: s.status }, meta });
      return (await this.rows(tx, auth.tenantId, [updated]))[0]!;
    });
  }

  // ───────────── Enrolment ─────────────

  enroll(auth: AuthContext, id: string, input: EnrollInput, meta: RequestMeta): Promise<EnrollResult> {
    return this.prisma.run(auth, async (tx) => {
      const s = await this.find(tx, auth.tenantId, id);
      let leadIds = input.leadIds;
      let contactIds = input.contactIds;
      if (input.segmentId) {
        const seg = await tx.segment.findFirst({ where: { id: input.segmentId, tenantId: auth.tenantId } });
        if (!seg) throw notFound('Segment');
        const where = segmentWhere(auth.tenantId, seg.rules as unknown as SegmentRules) as Prisma.LeadWhereInput & Prisma.ContactWhereInput;
        const found = seg.entity === 'lead'
          ? await tx.lead.findMany({ where, select: { id: true }, take: MAX_ENROL + 1 })
          : await tx.contact.findMany({ where, select: { id: true }, take: MAX_ENROL + 1 });
        if (found.length > MAX_ENROL) throw new BadRequestException({ code: 'TOO_MANY', message: `This segment has more than ${MAX_ENROL} people. Narrow it down and enrol in batches.` });
        if (seg.entity === 'lead') leadIds = [...leadIds, ...found.map((f) => f.id)];
        else contactIds = [...contactIds, ...found.map((f) => f.id)];
      }
      if (leadIds.length + contactIds.length > MAX_ENROL) throw new BadRequestException({ code: 'TOO_MANY', message: `Enrol up to ${MAX_ENROL} people at a time.` });
      const people = [...(await loadLeads(tx, auth.tenantId, [...new Set(leadIds)])), ...(await loadContacts(tx, auth.tenantId, [...new Set(contactIds)]))];
      const missing = leadIds.length + contactIds.length - people.length;
      const result = await this.enrollPeople(tx, auth.tenantId, s, people, auth.userId, auth.userId);
      if (missing > 0 && !input.segmentId) result.skipped.push(...Array.from({ length: missing }, () => ({ name: 'Unknown record', reason: 'not_found' as const })));
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'sequence.enrolled', entityType: 'sequence', entityId: s.id, metadata: { enrolled: result.enrolled, skipped: result.skipped.length, segmentId: input.segmentId ?? null }, meta });
      return result;
    });
  }

  /**
   * Shared by people, workflows and the extension. Skips anyone without an email, opted out, on the
   * do-not-email list or already live in the sequence. The sender must have a connected mailbox.
   */
  async enrollPeople(tx: TenantTx, tenantId: string, s: Sequence, people: Person[], senderId: string, enrolledById: string | null): Promise<EnrollResult> {
    if (s.status !== 'ACTIVE' && s.status !== 'PAUSED') throw new ConflictException({ code: 'SEQUENCE_NOT_ACTIVE', message: 'Start the sequence before enrolling people.' });
    const steps = seqSteps(s);
    if (!steps.length) throw new ConflictException({ code: 'NO_STEPS', message: 'This sequence has no steps yet.' });
    const mailbox = await tx.integrationConnection.findFirst({ where: { tenantId, userId: senderId, status: 'CONNECTED' }, select: { id: true } });
    if (!mailbox) throw new ConflictException({ code: 'NOT_CONNECTED', message: 'Connect your Google or Microsoft mailbox in Integrations before enrolling people. Emails go from your own mailbox.' });

    const emails = [...new Set(people.map((p) => p.email).filter((e): e is string => !!e))];
    const suppressed = new Set((await tx.emailSuppression.findMany({ where: { tenantId, email: { in: emails } }, select: { email: true } })).map((r) => r.email));
    const live = new Set((await tx.sequenceEnrollment.findMany({ where: { sequenceId: s.id, email: { in: emails }, status: { in: ['ACTIVE', 'PAUSED'] } }, select: { email: true } })).map((r) => r.email));

    const skipped: EnrollResult['skipped'] = [];
    const firstRun = new Date(Date.now() + steps[0]!.delayDays * DAY);
    let enrolled = 0;
    for (const p of people) {
      const reason: EnrollSkipReason | null = !p.email ? 'no_email' : p.consent === 'OPTED_OUT' ? 'opted_out' : suppressed.has(p.email) ? 'suppressed' : live.has(p.email) ? 'already_enrolled' : null;
      if (reason) {
        skipped.push({ name: p.name, reason });
        continue;
      }
      live.add(p.email!);
      const created = await tx.sequenceEnrollment.create({
        data: {
          tenantId,
          sequenceId: s.id,
          leadId: p.type === 'lead' ? p.id : null,
          contactId: p.type === 'contact' ? p.id : null,
          email: p.email!,
          senderId,
          enrolledById,
          status: 'ACTIVE',
          stepIndex: 0,
          // Spread first sends over a few minutes so a batch does not leave the mailbox at once.
          nextRunAt: new Date(firstRun.getTime() + enrolled * 45_000),
        },
      });
      await this.audit.publish(tx, {
        tenantId,
        type: 'sequence.enrolled',
        entityType: p.type,
        entityId: p.id,
        actorUserId: enrolledById,
        payload: { sequenceId: s.id, sequenceName: s.name, enrollmentId: created.id, email: p.email, senderId },
      });
      enrolled++;
    }
    return { enrolled, skipped };
  }

  enrollments(auth: AuthContext, q: { sequenceId?: string; leadId?: string; contactId?: string; status?: string }): Promise<EnrollmentRow[]> {
    return this.prisma.run(auth, async (tx) => {
      const where: Prisma.SequenceEnrollmentWhereInput = { tenantId: auth.tenantId };
      if (q.sequenceId) where.sequenceId = q.sequenceId;
      if (q.leadId) where.leadId = q.leadId;
      if (q.contactId) where.contactId = q.contactId;
      if (q.status === 'live') where.status = { in: ['ACTIVE', 'PAUSED'] };
      else if (q.status === 'finished') where.status = { in: ENROLLMENT_FINISHED };
      const rows = await tx.sequenceEnrollment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 500,
        include: { sequence: { select: { id: true, name: true, steps: true } }, _count: { select: { messages: true } } },
      });
      return this.enrollmentRows(tx, auth.tenantId, rows);
    });
  }

  /** Pause, resume or stop one person's run. Only the sender or someone who manages marketing can. */
  changeEnrollment(auth: AuthContext, id: string, action: 'pause' | 'resume' | 'stop', meta: RequestMeta): Promise<EnrollmentRow> {
    return this.prisma.run(auth, async (tx) => {
      const e = await tx.sequenceEnrollment.findFirst({ where: { id, tenantId: auth.tenantId } });
      if (!e) throw notFound('Enrolment');
      if (e.senderId !== auth.userId && !auth.permissions.includes('marketing:manage')) {
        throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Only the sender or someone who manages marketing can change this.' });
      }
      const live = e.status === 'ACTIVE' || e.status === 'PAUSED';
      if (!live) throw new ConflictException({ code: 'FINISHED', message: 'This run has already finished.' });
      const data: Prisma.SequenceEnrollmentUpdateInput =
        action === 'pause' ? { status: 'PAUSED' }
          : action === 'resume' ? { status: 'ACTIVE', lastError: null, attempts: 0, nextRunAt: e.nextRunAt && e.nextRunAt > new Date() ? e.nextRunAt : new Date() }
            : { status: 'STOPPED', finishedAt: new Date(), nextRunAt: null };
      if (action === 'resume') {
        const sup = await tx.emailSuppression.findUnique({ where: { tenantId_email: { tenantId: auth.tenantId, email: e.email } } });
        if (sup) throw new ConflictException({ code: 'SUPPRESSED', message: 'This address is on the do-not-email list.' });
      }
      await tx.sequenceEnrollment.update({ where: { id: e.id }, data });
      const who = personSubject(e);
      if (action === 'stop' && who) {
        const seq = await tx.sequence.findUnique({ where: { id: e.sequenceId }, select: { name: true } });
        await this.audit.publish(tx, { tenantId: auth.tenantId, type: 'sequence.removed', ...who, actorUserId: auth.userId, payload: { sequenceId: e.sequenceId, sequenceName: seq?.name ?? null, enrollmentId: e.id, email: e.email, reason: 'stopped' } });
      }
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: `sequence_enrollment.${action}`, entityType: 'sequence_enrollment', entityId: e.id, metadata: { sequenceId: e.sequenceId, email: e.email }, meta });
      const row = await tx.sequenceEnrollment.findFirstOrThrow({ where: { id: e.id }, include: { sequence: { select: { id: true, name: true, steps: true } }, _count: { select: { messages: true } } } });
      return (await this.enrollmentRows(tx, auth.tenantId, [row]))[0]!;
    });
  }

  stepStats(auth: AuthContext, id: string): Promise<SequenceStepStats[]> {
    return this.prisma.run(auth, async (tx) => {
      const s = await this.find(tx, auth.tenantId, id);
      const rows = await tx.$queryRaw<{ step_id: string; variant: string; sent: bigint; replied: bigint; opened: bigint; clicked: bigint; bounced: bigint }[]>`
        SELECT m.step_id, m.variant, count(*) AS sent, count(m.replied_at) AS replied, count(m.opened_at) AS opened,
               count(m.clicked_at) AS clicked, count(m.bounced_at) AS bounced
        FROM sequence_messages m JOIN sequence_enrollments e ON e.id = m.enrollment_id
        WHERE e.sequence_id = ${s.id}::uuid AND m.tenant_id = ${auth.tenantId}::uuid
        GROUP BY m.step_id, m.variant`;
      const counts = (r?: (typeof rows)[number]): EmailCounts => ({ sent: Number(r?.sent ?? 0), replied: Number(r?.replied ?? 0), opened: Number(r?.opened ?? 0), clicked: Number(r?.clicked ?? 0), bounced: Number(r?.bounced ?? 0) });
      return seqSteps(s)
        .filter((st) => st.type === 'email')
        .map((st) => {
          const a = counts(rows.find((r) => r.step_id === st.id && r.variant === 'A'));
          const b = counts(rows.find((r) => r.step_id === st.id && r.variant === 'B'));
          const total: EmailCounts = { sent: a.sent + b.sent, replied: a.replied + b.replied, opened: a.opened + b.opened, clicked: a.clicked + b.clicked, bounced: a.bounced + b.bounced };
          const tested = (st.type === 'email' && st.variantB) || b.sent > 0;
          return { stepId: st.id, ...total, variants: tested ? [{ variant: 'A' as const, counts: a }, { variant: 'B' as const, counts: b }] : null };
        });
    });
  }

  // ───────────── Do-not-email list ─────────────

  suppressions(auth: AuthContext, search?: string): Promise<SuppressionRow[]> {
    return this.prisma.run(auth, async (tx) => {
      const rows = await tx.emailSuppression.findMany({
        where: { tenantId: auth.tenantId, ...(search ? { email: { contains: search.toLowerCase() } } : {}) },
        orderBy: { createdAt: 'desc' },
        take: 500,
      });
      return rows.map((r) => ({ email: r.email, reason: r.reason, createdAt: r.createdAt.toISOString() }));
    });
  }

  addSuppressions(auth: AuthContext, emails: string[], meta: RequestMeta): Promise<{ added: number }> {
    return this.prisma.run(auth, async (tx) => {
      const unique = [...new Set(emails)];
      const r = await tx.emailSuppression.createMany({ data: unique.map((email) => ({ tenantId: auth.tenantId, email, reason: 'MANUAL' as const, createdById: auth.userId })), skipDuplicates: true });
      await tx.sequenceEnrollment.updateMany({
        where: { tenantId: auth.tenantId, email: { in: unique }, status: { in: ['ACTIVE', 'PAUSED'] } },
        data: { status: 'STOPPED', finishedAt: new Date(), nextRunAt: null, lastError: 'Added to the do-not-email list.' },
      });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'email_suppression.added', entityType: 'email_suppression', metadata: { count: r.count }, meta });
      return { added: r.count };
    });
  }

  /** Removing an unsubscribe needs a reason in the audit log: the person asked not to be emailed. */
  removeSuppression(auth: AuthContext, email: string, reason: string | undefined, meta: RequestMeta): Promise<void> {
    return this.prisma.run(auth, async (tx) => {
      const row = await tx.emailSuppression.findUnique({ where: { tenantId_email: { tenantId: auth.tenantId, email: email.toLowerCase() } } });
      if (!row) throw notFound('Address');
      if (row.reason === 'UNSUBSCRIBED' && !reason?.trim()) {
        throw new BadRequestException({ code: 'REASON_REQUIRED', message: 'This person unsubscribed. Say why they may be emailed again (for example, they asked to opt back in).' });
      }
      await tx.emailSuppression.delete({ where: { tenantId_email: { tenantId: auth.tenantId, email: row.email } } });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'email_suppression.removed', entityType: 'email_suppression', metadata: { email: row.email, was: row.reason, reason: reason?.trim() ?? null }, meta });
    });
  }

  // ───────────── Helpers ─────────────

  private data(input: SequenceInput) {
    return {
      name: input.name,
      description: input.description ?? null,
      steps: input.steps as unknown as Prisma.InputJsonValue,
      rules: input.rules as unknown as Prisma.InputJsonValue,
      settings: input.settings as unknown as Prisma.InputJsonValue,
    };
  }

  /** Templates must be visible to the editor; move targets must be other sequences in this workspace. */
  private async assertRefs(tx: TenantTx, auth: AuthContext, input: SequenceInput, selfId?: string): Promise<void> {
    const templateIds = [...new Set(input.steps.flatMap((s) => (s.type === 'email' ? [s.templateId, s.variantB?.templateId].filter((t): t is string => !!t) : [])))];
    if (templateIds.length) {
      const n = await tx.emailTemplate.count({ where: { tenantId: auth.tenantId, id: { in: templateIds }, OR: [{ shared: true }, { ownerId: auth.userId }] } });
      if (n !== templateIds.length) throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'A step uses a template that does not exist or is not shared with you.' });
    }
    const targets = [...new Set(input.rules.flatMap((r) => r.actions.flatMap((a) => (a.type === 'move_sequence' ? [a.sequenceId] : []))))];
    if (targets.includes(selfId ?? '')) throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'A rule cannot move people into the same sequence.' });
    if (targets.length) {
      const n = await tx.sequence.count({ where: { tenantId: auth.tenantId, id: { in: targets } } });
      if (n !== targets.length) throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'A rule moves people to a sequence that does not exist.' });
    }
  }

  /** A sequence in the tenant, for other services in this module. */
  findIn(tx: TenantTx, tenantId: string, id: string): Promise<Sequence> {
    return this.find(tx, tenantId, id);
  }

  private async find(tx: TenantTx, tenantId: string, id: string): Promise<Sequence> {
    const s = await tx.sequence.findFirst({ where: { id, tenantId } });
    if (!s) throw notFound('Sequence');
    return s;
  }

  private async editable(tx: TenantTx, auth: AuthContext, id: string): Promise<Sequence> {
    const s = await this.find(tx, auth.tenantId, id);
    if (s.ownerId !== auth.userId && !auth.permissions.includes('marketing:manage')) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Only its owner or someone who manages marketing can change this sequence.' });
    }
    return s;
  }

  private async rows(tx: TenantTx, tenantId: string, rows: Sequence[]): Promise<SequenceRow[]> {
    const ids = rows.map((r) => r.id);
    const names = await ownerRefs(tx, rows.map((r) => r.ownerId));
    const stats = new Map<string, SequenceStats>();
    if (ids.length) {
      const counts = await tx.$queryRaw<{ sequence_id: string; active: bigint; finished: bigint }[]>`
        SELECT sequence_id, count(*) FILTER (WHERE status IN ('ACTIVE','PAUSED')) AS active,
               count(*) FILTER (WHERE status NOT IN ('ACTIVE','PAUSED')) AS finished
        FROM sequence_enrollments WHERE tenant_id = ${tenantId}::uuid AND sequence_id = ANY(${ids}::uuid[]) GROUP BY sequence_id`;
      const msgs = await tx.$queryRaw<{ sequence_id: string; sent: bigint; replied: bigint; opened: bigint; clicked: bigint; bounced: bigint; unsubscribed: bigint }[]>`
        SELECT e.sequence_id, count(m.id) AS sent, count(m.replied_at) AS replied, count(m.opened_at) AS opened,
               count(m.clicked_at) AS clicked, count(m.bounced_at) AS bounced,
               count(DISTINCT e.id) FILTER (WHERE e.status = 'UNSUBSCRIBED') AS unsubscribed
        FROM sequence_enrollments e JOIN sequence_messages m ON m.enrollment_id = e.id
        WHERE e.tenant_id = ${tenantId}::uuid AND e.sequence_id = ANY(${ids}::uuid[]) GROUP BY e.sequence_id`;
      for (const id of ids) {
        const c = counts.find((r) => r.sequence_id === id);
        const m = msgs.find((r) => r.sequence_id === id);
        stats.set(id, {
          active: Number(c?.active ?? 0), finished: Number(c?.finished ?? 0), sent: Number(m?.sent ?? 0), replied: Number(m?.replied ?? 0),
          opened: Number(m?.opened ?? 0), clicked: Number(m?.clicked ?? 0), bounced: Number(m?.bounced ?? 0), unsubscribed: Number(m?.unsubscribed ?? 0),
        });
      }
    }
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      status: r.status,
      owner: r.ownerId ? (names.get(r.ownerId) ?? null) : null,
      steps: seqSteps(r),
      rules: seqRules(r),
      settings: seqSettings(r),
      stats: stats.get(r.id) ?? { active: 0, finished: 0, sent: 0, replied: 0, opened: 0, clicked: 0, bounced: 0, unsubscribed: 0 },
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }));
  }

  private async enrollmentRows(
    tx: TenantTx,
    tenantId: string,
    rows: (SequenceEnrollment & { sequence: { id: string; name: string; steps: Prisma.JsonValue }; _count: { messages: number } })[],
  ): Promise<EnrollmentRow[]> {
    const names = await ownerRefs(tx, rows.map((r) => r.senderId));
    const leads = new Map((await loadLeads(tx, tenantId, rows.flatMap((r) => (r.leadId ? [r.leadId] : [])))).map((p) => [p.id, p.name]));
    const contacts = new Map((await loadContacts(tx, tenantId, rows.flatMap((r) => (r.contactId ? [r.contactId] : [])))).map((p) => [p.id, p.name]));
    return rows.map((r) => {
      const live = r.status === 'ACTIVE' || r.status === 'PAUSED';
      const steps = (r.sequence.steps as unknown as SequenceStep[]) ?? [];
      return {
        id: r.id,
        sequence: { id: r.sequence.id, name: r.sequence.name },
        person: r.contactId
          ? { type: 'contact' as const, id: r.contactId, name: contacts.get(r.contactId) ?? 'Deleted contact' }
          : { type: 'lead' as const, id: r.leadId ?? '', name: (r.leadId && leads.get(r.leadId)) || 'Deleted lead' },
        email: r.email,
        sender: names.get(r.senderId) ?? null,
        status: r.status,
        nextStep: live && r.stepIndex < steps.length ? r.stepIndex + 1 : null,
        nextRunAt: live ? iso(r.nextRunAt) : null,
        lastError: r.lastError,
        sent: r._count.messages,
        repliedAt: iso(r.repliedAt),
        openedAt: iso(r.openedAt),
        clickedAt: iso(r.clickedAt),
        createdAt: r.createdAt.toISOString(),
      };
    });
  }
}
