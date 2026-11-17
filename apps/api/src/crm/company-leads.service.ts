import { createHash } from 'node:crypto';
import { BadRequestException, Injectable } from '@nestjs/common';
import type { Prisma, TenantTx } from '@dealflow/database';
import type {
  BranchInput,
  BranchRow,
  CompanyFileRow,
  CompanyLeadResult,
  EmployeeStats,
  LeadDraftRow,
  LeadTransferReason,
  OwnerChangeRow,
  PersonRef,
} from '@dealflow/types';
import { companyLeadSchema, type CompanyInput, type z } from '@dealflow/types';
import { AuditService } from '../audit/audit.service';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { checkFile } from '../portal/portal.service';
import { CompaniesService, assignableUserIds } from './companies.service';
import { ContactsService } from './contacts.service';
import { notFound } from './crm-helpers';
import { canSeeDetails, companyScope, contactScope, personRefs, visibility } from './visibility';

type CompanyLead = z.output<typeof companyLeadSchema>;

/** A person who can be picked as a lead owner, manager or point of contact. */
export interface LeadPerson extends PersonRef {
  /** Whether the caller may make this person a lead's owner (record scope rules). */
  assignable: boolean;
}

/**
 * The lead form and what hangs off a company lead: branches, the ownership history, files and drafts (ADR 0060,
 * Phase 2b). Everything checks the caller's record visibility; details stay hidden from roles that may not see them.
 */
@Injectable()
export class CompanyLeadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly companies: CompaniesService,
    private readonly contacts: ContactsService,
  ) {}

  // ─── The lead form ───

  /** Saves the company, its branches and employees together: all of it or nothing. */
  create(auth: AuthContext, input: CompanyLead, meta: RequestMeta): Promise<CompanyLeadResult> {
    return this.prisma.run(auth, async (tx) => {
      const companyId = await this.companies.createIn(tx, auth, input.company as CompanyInput, meta);
      const branchIds: string[] = [];
      for (const b of input.branches) {
        const row = await tx.companyBranch.create({ data: { ...b, tenantId: auth.tenantId, companyId } });
        branchIds.push(row.id);
      }
      const employeeIds: string[] = [];
      for (const [i, e] of input.employees.entries()) {
        // Employees default to the lead owner as their assigned sales executive.
        const row = await this.contacts.createIn(tx, auth, { ...e, companyId, ownerId: e.ownerId ?? input.company.ownerId ?? auth.userId }, meta, `employees.${i}.`);
        employeeIds.push(row.id);
      }
      if (input.branches.length && input.company.branchCount == null) {
        await tx.company.update({ where: { id: companyId }, data: { branchCount: input.branches.length } });
      }
      if (input.draftId) await tx.leadDraft.deleteMany({ where: { id: input.draftId, tenantId: auth.tenantId, userId: auth.userId } });
      return { company: await this.companies.rowIn(tx, auth, companyId), branchIds, employeeIds };
    });
  }

  /** Workspace members with their designations, marking whom the caller may make a lead owner. */
  people(auth: AuthContext): Promise<LeadPerson[]> {
    return this.prisma.run(auth, async (tx) => {
      const members = await tx.membership.findMany({ where: { tenantId: auth.tenantId, status: 'ACTIVE', user: { status: 'ACTIVE' } }, select: { userId: true } });
      const refs = await personRefs(tx, auth.tenantId, members.map((m) => m.userId));
      const allowed = await assignableUserIds(tx, auth);
      return [...refs.values()]
        .map((p) => ({ ...p, assignable: allowed === 'all' || allowed.includes(p.id) }))
        .sort((a, b) => a.name.localeCompare(b.name));
    });
  }

  // ─── Drafts (private to the person writing them) ───

  drafts(auth: AuthContext): Promise<LeadDraftRow[]> {
    return this.prisma.run(auth, async (tx) =>
      (await tx.leadDraft.findMany({ where: { tenantId: auth.tenantId, userId: auth.userId }, orderBy: { updatedAt: 'desc' }, take: 50 })).map(draftRow),
    );
  }

  draft(auth: AuthContext, id: string): Promise<LeadDraftRow> {
    return this.prisma.run(auth, async (tx) => {
      const d = await tx.leadDraft.findFirst({ where: { id, tenantId: auth.tenantId, userId: auth.userId } });
      if (!d) throw notFound('Draft');
      return draftRow(d);
    });
  }

  saveDraft(auth: AuthContext, id: string | null, input: { step: number; data: Record<string, unknown> }): Promise<LeadDraftRow> {
    return this.prisma.run(auth, async (tx) => {
      const title = draftTitle(input.data);
      const data = { step: input.step, data: input.data as Prisma.InputJsonValue, title };
      if (!id) return draftRow(await tx.leadDraft.create({ data: { ...data, tenantId: auth.tenantId, userId: auth.userId } }));
      const { count } = await tx.leadDraft.updateMany({ where: { id, tenantId: auth.tenantId, userId: auth.userId }, data });
      if (!count) throw notFound('Draft');
      return draftRow(await tx.leadDraft.findUniqueOrThrow({ where: { id } }));
    });
  }

  removeDraft(auth: AuthContext, id: string): Promise<void> {
    return this.prisma.run(auth, async (tx) => {
      const { count } = await tx.leadDraft.deleteMany({ where: { id, tenantId: auth.tenantId, userId: auth.userId } });
      if (!count) throw notFound('Draft');
    });
  }

  // ─── Branches ───

  branches(auth: AuthContext, companyId: string): Promise<BranchRow[]> {
    return this.prisma.run(auth, async (tx) => {
      const { details } = await this.visibleCompany(tx, auth, companyId);
      const rows = await tx.companyBranch.findMany({ where: { tenantId: auth.tenantId, companyId }, orderBy: { createdAt: 'asc' } });
      return rows.map((r) => branchRow(r, details));
    });
  }

  saveBranch(auth: AuthContext, companyId: string, branchId: string | null, input: BranchInput, meta: RequestMeta): Promise<BranchRow> {
    return this.prisma.run(auth, async (tx) => {
      await this.editableCompany(tx, auth, companyId);
      let row;
      if (branchId) {
        const { count } = await tx.companyBranch.updateMany({ where: { id: branchId, tenantId: auth.tenantId, companyId }, data: input });
        if (!count) throw notFound('Branch');
        row = await tx.companyBranch.findUniqueOrThrow({ where: { id: branchId } });
      } else {
        row = await tx.companyBranch.create({ data: { ...input, tenantId: auth.tenantId, companyId } });
      }
      await this.syncBranchCount(tx, auth, companyId);
      await this.audit.record(tx, {
        tenantId: auth.tenantId, actorUserId: auth.userId, action: branchId ? 'company.branch_updated' : 'company.branch_added', entityType: 'company', entityId: companyId,
        metadata: { branchId: row.id, name: row.name }, meta,
      });
      return branchRow(row, true);
    });
  }

  removeBranch(auth: AuthContext, companyId: string, branchId: string, meta: RequestMeta): Promise<void> {
    return this.prisma.run(auth, async (tx) => {
      await this.editableCompany(tx, auth, companyId);
      const b = await tx.companyBranch.findFirst({ where: { id: branchId, tenantId: auth.tenantId, companyId }, select: { name: true } });
      if (!b) throw notFound('Branch');
      await tx.companyBranch.delete({ where: { id: branchId } });
      await this.syncBranchCount(tx, auth, companyId);
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'company.branch_removed', entityType: 'company', entityId: companyId, metadata: { branchId, name: b.name }, meta });
    });
  }

  /** "Number of branches" follows the branch list once branches are recorded. */
  private async syncBranchCount(tx: TenantTx, auth: AuthContext, companyId: string) {
    const count = await tx.companyBranch.count({ where: { tenantId: auth.tenantId, companyId } });
    await tx.company.update({ where: { id: companyId }, data: { branchCount: count, updatedById: auth.userId } });
  }

  // ─── Ownership ───

  ownerHistory(auth: AuthContext, companyId: string): Promise<OwnerChangeRow[]> {
    return this.prisma.run(auth, async (tx) => {
      await this.visibleCompany(tx, auth, companyId);
      const rows = await tx.leadOwnerChange.findMany({ where: { tenantId: auth.tenantId, companyId }, orderBy: { createdAt: 'desc' }, take: 100 });
      const people = await personRefs(tx, auth.tenantId, rows.flatMap((r) => [r.fromUserId, r.toUserId, r.byUserId]));
      const p = (id: string | null) => (id ? (people.get(id) ?? null) : null);
      return rows.map((r) => ({ id: r.id, from: p(r.fromUserId), to: p(r.toUserId), by: p(r.byUserId), reason: r.reason as LeadTransferReason | null, note: r.note, createdAt: r.createdAt.toISOString() }));
    });
  }

  // ─── Files ───

  files(auth: AuthContext, companyId: string): Promise<CompanyFileRow[]> {
    return this.prisma.run(auth, async (tx) => {
      const { details } = await this.visibleCompany(tx, auth, companyId);
      if (!details) return [];
      return fileRows(tx, auth.tenantId, companyId);
    });
  }

  /** `rfqId` files the upload under one RFQ of the company. */
  upload(auth: AuthContext, companyId: string, file: { name: string; contentType: string; data: Buffer }, meta: RequestMeta, rfqId?: string): Promise<CompanyFileRow> {
    checkFile(file);
    return this.prisma.run(auth, async (tx) => {
      await this.editableCompany(tx, auth, companyId);
      if (rfqId && !(await tx.rfq.findFirst({ where: { tenantId: auth.tenantId, id: rfqId, companyId, deletedAt: null }, select: { id: true } }))) throw notFound('RFQ');
      const doc = await tx.companyFile.create({
        data: {
          tenantId: auth.tenantId, companyId, name: file.name, contentType: file.contentType, sizeBytes: file.data.length,
          data: new Uint8Array(file.data), sha256: createHash('sha256').update(file.data).digest('hex'), uploadedById: auth.userId, rfqId: rfqId ?? null,
        },
      });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'company.file_added', entityType: 'company', entityId: companyId, metadata: { fileId: doc.id, name: file.name, size: file.data.length }, meta });
      return (await fileRows(tx, auth.tenantId, companyId)).find((f) => f.id === doc.id)!;
    });
  }

  download(auth: AuthContext, fileId: string): Promise<{ name: string; contentType: string; data: Buffer }> {
    return this.prisma.run(auth, async (tx) => {
      const f = await tx.companyFile.findFirst({ where: { id: fileId, tenantId: auth.tenantId }, select: { companyId: true, name: true, contentType: true, data: true } });
      if (!f) throw notFound('File');
      const { details } = await this.visibleCompany(tx, auth, f.companyId);
      if (!details) throw notFound('File');
      return { name: f.name, contentType: f.contentType, data: Buffer.from(f.data) };
    });
  }

  removeFile(auth: AuthContext, fileId: string, meta: RequestMeta): Promise<void> {
    return this.prisma.run(auth, async (tx) => {
      const f = await tx.companyFile.findFirst({ where: { id: fileId, tenantId: auth.tenantId }, select: { companyId: true, name: true } });
      if (!f) throw notFound('File');
      await this.editableCompany(tx, auth, f.companyId);
      await tx.companyFile.delete({ where: { id: fileId } });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'company.file_removed', entityType: 'company', entityId: f.companyId, metadata: { fileId, name: f.name }, meta });
    });
  }

  // ─── Employee relationship ───

  employeeStats(auth: AuthContext, contactId: string): Promise<EmployeeStats> {
    return this.prisma.run(auth, async (tx) => {
      const v = await visibility(tx, auth);
      const c = await tx.contact.findFirst({ where: { id: contactId, tenantId: auth.tenantId, deletedAt: null, ...contactScope(v) }, select: { id: true, nextFollowUpAt: true } });
      if (!c) throw notFound('Contact');
      const base = { tenantId: auth.tenantId, contactId, deletedAt: null };
      const [emailActs, loggedReplies, calls, meetings, sent, received, followUps, lastAct, lastEmail, nextTask] = await Promise.all([
        tx.activity.count({ where: { ...base, type: 'EMAIL', NOT: { interaction: 'EMAIL_RECEIVED' } } }),
        tx.activity.count({ where: { ...base, interaction: 'EMAIL_RECEIVED' } }),
        tx.activity.count({ where: { ...base, type: 'CALL' } }),
        tx.activity.count({ where: { ...base, type: 'MEETING' } }),
        tx.emailMessage.count({ where: { tenantId: auth.tenantId, contactId, direction: 'OUTBOUND' } }),
        tx.emailMessage.count({ where: { tenantId: auth.tenantId, contactId, direction: 'INBOUND' } }),
        tx.task.count({ where: { ...base, status: 'OPEN' } }),
        tx.activity.findFirst({ where: base, orderBy: { occurredAt: 'desc' }, select: { type: true, subject: true, occurredAt: true } }),
        tx.emailMessage.findFirst({ where: { tenantId: auth.tenantId, contactId }, orderBy: { sentAt: 'desc' }, select: { sentAt: true } }),
        tx.task.findFirst({ where: { ...base, status: 'OPEN', dueAt: { not: null } }, orderBy: { dueAt: 'asc' }, select: { dueAt: true } }),
      ]);
      const last = [lastAct?.occurredAt, lastEmail?.sentAt].filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0];
      const next = [c.nextFollowUpAt, nextTask?.dueAt].filter((d): d is Date => !!d).sort((a, b) => a.getTime() - b.getTime())[0];
      return {
        // Logged email activities and synced sent emails are separate records of different emails.
        emailsSent: emailActs + sent,
        responsesReceived: received + loggedReplies,
        calls,
        meetings,
        followUpsPending: followUps,
        lastInteractionAt: last?.toISOString() ?? null,
        latestUpdate: lastAct ? { type: lastAct.type, subject: lastAct.subject, at: lastAct.occurredAt.toISOString() } : null,
        nextFollowUpAt: next?.toISOString() ?? null,
      };
    });
  }

  // ─── Access ───

  private async visibleCompany(tx: TenantTx, auth: AuthContext, companyId: string) {
    const v = await visibility(tx, auth);
    const c = await tx.company.findFirst({ where: { id: companyId, tenantId: auth.tenantId, deletedAt: null, ...companyScope(v) }, select: { id: true, ownerId: true } });
    if (!c) throw notFound('Company');
    return { details: canSeeDetails(v, c.ownerId) };
  }

  private async editableCompany(tx: TenantTx, auth: AuthContext, companyId: string) {
    const { details } = await this.visibleCompany(tx, auth, companyId);
    if (!details) throw new BadRequestException({ code: 'DETAILS_HIDDEN', message: 'Your role cannot see or change the details of this company.' });
  }
}

function draftTitle(data: Record<string, unknown>): string | null {
  const company = data.company as { name?: unknown } | undefined;
  const name = typeof company?.name === 'string' ? company.name.trim() : '';
  return name ? name.slice(0, 200) : null;
}

function draftRow(d: { id: string; title: string | null; step: number; data: unknown; createdAt: Date; updatedAt: Date }): LeadDraftRow {
  return { id: d.id, title: d.title, step: d.step, data: (d.data ?? {}) as Record<string, unknown>, createdAt: d.createdAt.toISOString(), updatedAt: d.updatedAt.toISOString() };
}

function branchRow(r: Prisma.CompanyBranchGetPayload<object>, details: boolean): BranchRow {
  const hide = <T>(value: T): T | null => (details ? value : null);
  return {
    id: r.id, companyId: r.companyId, name: r.name, country: r.country, state: r.state, city: r.city,
    address: hide(r.address), postalCode: hide(r.postalCode), email: hide(r.email), phone: hide(r.phone),
    contactPerson: hide(r.contactPerson), website: hide(r.website), createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(),
  };
}

async function fileRows(tx: TenantTx, tenantId: string, companyId: string): Promise<CompanyFileRow[]> {
  const rows = await tx.companyFile.findMany({
    where: { tenantId, companyId },
    orderBy: { createdAt: 'desc' },
    select: { id: true, name: true, contentType: true, sizeBytes: true, uploadedById: true, createdAt: true },
  });
  const people = await personRefs(tx, tenantId, rows.map((r) => r.uploadedById));
  return rows.map((r) => ({ id: r.id, name: r.name, contentType: r.contentType, sizeBytes: r.sizeBytes, uploadedBy: r.uploadedById ? (people.get(r.uploadedById) ?? null) : null, createdAt: r.createdAt.toISOString() }));
}
