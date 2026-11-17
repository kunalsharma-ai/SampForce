import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { ensureCompanyCrmDefaults, leadNumbering, type TenantTx } from '@dealflow/database';
import {
  type CrmStatusInput,
  type CrmStatusKind,
  type CrmStatusRow,
  type CrmStatusUpdate,
  type DepartmentInput,
  type DepartmentRow,
  type DesignationInput,
  type DesignationRow,
  formatLeadNumber,
  type LeadNumberingInput,
  type LeadNumberingRow,
  type StatusMeaning,
} from '@dealflow/types';
import { AuditService } from '../audit/audit.service';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { notFound } from './crm-helpers';

const conflictName = () => new ConflictException({ code: 'NAME_TAKEN', message: 'That name is already used.' });

/**
 * Settings → CRM Configuration (ADR 0060): company and employee statuses, departments, designations and lead
 * numbering. Reading is open to everyone who uses the CRM (the pickers need it); changes need crm:configure.
 */
@Injectable()
export class CrmConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ───────────── Statuses ─────────────

  statuses(auth: AuthContext, kind: CrmStatusKind): Promise<CrmStatusRow[]> {
    return this.prisma.run(auth, async (tx) => {
      await ensureDefaults(tx, auth.tenantId);
      const rows = await tx.crmStatus.findMany({ where: { tenantId: auth.tenantId, kind }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] });
      const counts = await statusCounts(tx, auth.tenantId, kind);
      return rows.map((r) => toStatusRow(r, counts.get(r.id) ?? 0));
    });
  }

  createStatus(auth: AuthContext, input: CrmStatusInput, meta: RequestMeta): Promise<CrmStatusRow> {
    return this.prisma.run(auth, async (tx) => {
      await ensureDefaults(tx, auth.tenantId);
      if (await tx.crmStatus.findFirst({ where: { tenantId: auth.tenantId, kind: input.kind, name: { equals: input.name, mode: 'insensitive' } } })) throw conflictName();
      const last = await tx.crmStatus.findFirst({ where: { tenantId: auth.tenantId, kind: input.kind }, orderBy: { position: 'desc' }, select: { position: true } });
      if (input.isDefault) await tx.crmStatus.updateMany({ where: { tenantId: auth.tenantId, kind: input.kind }, data: { isDefault: false } });
      const row = await tx.crmStatus.create({
        data: {
          tenantId: auth.tenantId, kind: input.kind, name: input.name, description: input.description ?? null, color: input.color, meaning: input.meaning,
          position: (last?.position ?? -1) + 1, isDefault: !!input.isDefault && !input.archived, archivedAt: input.archived ? new Date() : null,
        },
      });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'crm_status.created', entityType: 'crm_status', entityId: row.id, metadata: { kind: row.kind, name: row.name, color: row.color }, meta });
      return toStatusRow(row, 0);
    });
  }

  updateStatus(auth: AuthContext, id: string, input: CrmStatusUpdate, meta: RequestMeta): Promise<CrmStatusRow> {
    return this.prisma.run(auth, async (tx) => {
      const before = await tx.crmStatus.findFirst({ where: { id, tenantId: auth.tenantId } });
      if (!before) throw notFound('Status');
      if (input.name && input.name.toLowerCase() !== before.name.toLowerCase() && (await tx.crmStatus.findFirst({ where: { tenantId: auth.tenantId, kind: before.kind, name: { equals: input.name, mode: 'insensitive' }, id: { not: id } } }))) throw conflictName();
      const archiving = input.archived === true && !before.archivedAt;
      if ((archiving || input.isDefault === false) && before.isDefault) {
        throw new BadRequestException({ code: 'DEFAULT_STATUS', message: 'Pick another default status first.' });
      }
      if (input.isDefault && (input.archived ?? !!before.archivedAt)) throw new BadRequestException({ code: 'DEFAULT_STATUS', message: 'A deactivated status cannot be the default.' });
      if (input.isDefault) await tx.crmStatus.updateMany({ where: { tenantId: auth.tenantId, kind: before.kind, id: { not: id } }, data: { isDefault: false } });
      const row = await tx.crmStatus.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.color !== undefined ? { color: input.color } : {}),
          ...(input.meaning !== undefined ? { meaning: input.meaning } : {}),
          ...(input.isDefault !== undefined ? { isDefault: input.isDefault } : {}),
          ...(input.archived !== undefined ? { archivedAt: input.archived ? (before.archivedAt ?? new Date()) : null } : {}),
        },
      });
      await this.audit.record(tx, {
        tenantId: auth.tenantId, actorUserId: auth.userId, action: 'crm_status.updated', entityType: 'crm_status', entityId: id,
        metadata: { kind: before.kind, from: { name: before.name, color: before.color, archived: !!before.archivedAt }, to: input }, meta,
      });
      return toStatusRow(row, (await statusCounts(tx, auth.tenantId, before.kind as CrmStatusKind)).get(id) ?? 0);
    });
  }

  /** Deletes a status no record uses; one in use can only be deactivated, so no record loses its status. */
  deleteStatus(auth: AuthContext, id: string, meta: RequestMeta): Promise<void> {
    return this.prisma.run(auth, async (tx) => {
      const row = await tx.crmStatus.findFirst({ where: { id, tenantId: auth.tenantId } });
      if (!row) throw notFound('Status');
      if (row.isDefault) throw new BadRequestException({ code: 'DEFAULT_STATUS', message: 'Pick another default status first.' });
      const used = (await statusCounts(tx, auth.tenantId, row.kind as CrmStatusKind)).get(id) ?? 0;
      if (used) throw new ConflictException({ code: 'STATUS_IN_USE', message: `${used} records have this status. Deactivate it instead, or move them first.` });
      await tx.crmStatus.delete({ where: { id } });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'crm_status.deleted', entityType: 'crm_status', entityId: id, metadata: { kind: row.kind, name: row.name }, meta });
    });
  }

  reorderStatuses(auth: AuthContext, kind: CrmStatusKind, ids: string[], meta: RequestMeta): Promise<CrmStatusRow[]> {
    return this.prisma.run(auth, async (tx) => {
      const rows = await tx.crmStatus.findMany({ where: { tenantId: auth.tenantId, kind }, select: { id: true } });
      const all = new Set(rows.map((r) => r.id));
      if (ids.length !== all.size || ids.some((id) => !all.has(id)) || new Set(ids).size !== ids.length) {
        throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'List every status of this kind exactly once.' });
      }
      for (const [position, id] of ids.entries()) await tx.crmStatus.update({ where: { id }, data: { position } });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'crm_status.reordered', entityType: 'crm_status', metadata: { kind, ids }, meta });
      const fresh = await tx.crmStatus.findMany({ where: { tenantId: auth.tenantId, kind }, orderBy: { position: 'asc' } });
      const counts = await statusCounts(tx, auth.tenantId, kind);
      return fresh.map((r) => toStatusRow(r, counts.get(r.id) ?? 0));
    });
  }

  // ───────────── Departments and designations ─────────────

  departments(auth: AuthContext): Promise<DepartmentRow[]> {
    return this.prisma.run(auth, async (tx) => {
      await ensureDefaults(tx, auth.tenantId);
      const [rows, members] = await Promise.all([
        tx.department.findMany({ where: { tenantId: auth.tenantId }, orderBy: [{ position: 'asc' }, { name: 'asc' }] }),
        tx.membership.findMany({ where: { tenantId: auth.tenantId, status: 'ACTIVE' }, select: { departmentId: true } }),
      ]);
      return rows.map((r) => ({ id: r.id, name: r.name, description: r.description, position: r.position, archived: !!r.archivedAt, members: members.filter((m) => m.departmentId === r.id).length }));
    });
  }

  designations(auth: AuthContext): Promise<DesignationRow[]> {
    return this.prisma.run(auth, async (tx) => {
      await ensureDefaults(tx, auth.tenantId);
      const [rows, members] = await Promise.all([
        tx.designation.findMany({ where: { tenantId: auth.tenantId }, orderBy: [{ position: 'asc' }, { name: 'asc' }] }),
        tx.membership.findMany({ where: { tenantId: auth.tenantId, status: 'ACTIVE' }, select: { designationId: true } }),
      ]);
      return rows.map((r) => ({
        id: r.id, name: r.name, description: r.description, position: r.position, archived: !!r.archivedAt, tier: r.tier as DesignationRow['tier'],
        members: members.filter((m) => m.designationId === r.id).length,
      }));
    });
  }

  saveDepartment(auth: AuthContext, id: string | null, input: DepartmentInput, meta: RequestMeta): Promise<DepartmentRow> {
    return this.prisma.run(auth, async (tx) => {
      if (await tx.department.findFirst({ where: { tenantId: auth.tenantId, name: { equals: input.name, mode: 'insensitive' }, ...(id ? { id: { not: id } } : {}) } })) throw conflictName();
      const data = { name: input.name, description: input.description ?? null, archivedAt: input.archived ? new Date() : null };
      let row;
      if (id) {
        if (!(await tx.department.findFirst({ where: { id, tenantId: auth.tenantId } }))) throw notFound('Department');
        row = await tx.department.update({ where: { id }, data });
      } else {
        const last = await tx.department.findFirst({ where: { tenantId: auth.tenantId }, orderBy: { position: 'desc' }, select: { position: true } });
        row = await tx.department.create({ data: { ...data, tenantId: auth.tenantId, position: (last?.position ?? -1) + 1 } });
      }
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: id ? 'department.updated' : 'department.created', entityType: 'department', entityId: row.id, metadata: { name: row.name }, meta });
      const members = await tx.membership.count({ where: { tenantId: auth.tenantId, status: 'ACTIVE', departmentId: row.id } });
      return { id: row.id, name: row.name, description: row.description, position: row.position, archived: !!row.archivedAt, members };
    });
  }

  saveDesignation(auth: AuthContext, id: string | null, input: DesignationInput, meta: RequestMeta): Promise<DesignationRow> {
    return this.prisma.run(auth, async (tx) => {
      if (await tx.designation.findFirst({ where: { tenantId: auth.tenantId, name: { equals: input.name, mode: 'insensitive' }, ...(id ? { id: { not: id } } : {}) } })) throw conflictName();
      const data = { name: input.name, tier: input.tier, description: input.description ?? null, archivedAt: input.archived ? new Date() : null };
      let row;
      if (id) {
        if (!(await tx.designation.findFirst({ where: { id, tenantId: auth.tenantId } }))) throw notFound('Designation');
        row = await tx.designation.update({ where: { id }, data });
      } else {
        const last = await tx.designation.findFirst({ where: { tenantId: auth.tenantId }, orderBy: { position: 'desc' }, select: { position: true } });
        row = await tx.designation.create({ data: { ...data, tenantId: auth.tenantId, position: (last?.position ?? -1) + 1 } });
      }
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: id ? 'designation.updated' : 'designation.created', entityType: 'designation', entityId: row.id, metadata: { name: row.name, tier: row.tier }, meta });
      const members = await tx.membership.count({ where: { tenantId: auth.tenantId, status: 'ACTIVE', designationId: row.id } });
      return { id: row.id, name: row.name, description: row.description, position: row.position, archived: !!row.archivedAt, tier: row.tier as DesignationRow['tier'], members };
    });
  }

  /** Only unused departments and designations can be deleted; ones in use are deactivated instead. */
  deleteOrgItem(auth: AuthContext, kind: 'department' | 'designation', id: string, meta: RequestMeta): Promise<void> {
    return this.prisma.run(auth, async (tx) => {
      const exists = kind === 'department' ? await tx.department.findFirst({ where: { id, tenantId: auth.tenantId } }) : await tx.designation.findFirst({ where: { id, tenantId: auth.tenantId } });
      if (!exists) throw notFound(kind === 'department' ? 'Department' : 'Designation');
      const used =
        kind === 'department'
          ? (await tx.membership.count({ where: { tenantId: auth.tenantId, departmentId: id } })) + (await tx.company.count({ where: { tenantId: auth.tenantId, departmentId: id, deletedAt: null } }))
          : await tx.membership.count({ where: { tenantId: auth.tenantId, designationId: id } });
      if (used) throw new ConflictException({ code: 'IN_USE', message: 'Members or records use this. Deactivate it instead, or move them first.' });
      if (kind === 'department') await tx.department.delete({ where: { id } });
      else await tx.designation.delete({ where: { id } });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: `${kind}.deleted`, entityType: kind, entityId: id, meta });
    });
  }

  // ───────────── Lead numbering ─────────────

  numbering(auth: AuthContext): Promise<LeadNumberingRow> {
    return this.prisma.run(auth, (tx) => numberingRow(tx, auth.tenantId));
  }

  /**
   * Changes the prefix and digits. New company leads use them at once. With applyToExisting, every existing number
   * is re-lettered (FRFS07 becomes ABC07): the sequence is kept, so numbers stay unique and in order.
   */
  setNumbering(auth: AuthContext, input: LeadNumberingInput, meta: RequestMeta): Promise<LeadNumberingRow> {
    return this.prisma.run(
      auth,
      async (tx) => {
        const before = await leadNumbering(tx, auth.tenantId);
        await tx.tenant.update({ where: { id: auth.tenantId }, data: { leadNumberPrefix: input.prefix, leadNumberDigits: input.digits } });
        let renumbered = 0;
        if (input.applyToExisting) {
          const rows = await tx.company.findMany({ where: { tenantId: auth.tenantId, leadSeq: { not: null } }, select: { id: true, leadSeq: true, leadNumber: true } });
          // Clear first, then write: re-lettering never collides with a number another company still holds.
          const changed = rows.filter((r) => r.leadNumber !== formatLeadNumber(input.prefix, r.leadSeq!, input.digits));
          for (const r of changed) await tx.company.update({ where: { id: r.id }, data: { leadNumber: null } });
          for (const r of changed) await tx.company.update({ where: { id: r.id }, data: { leadNumber: formatLeadNumber(input.prefix, r.leadSeq!, input.digits) } });
          renumbered = changed.length;
        }
        await this.audit.record(tx, {
          tenantId: auth.tenantId, actorUserId: auth.userId, action: 'lead_numbering.updated', entityType: 'tenant', entityId: auth.tenantId,
          metadata: { from: { prefix: before.prefix, digits: before.digits }, to: { prefix: input.prefix, digits: input.digits }, applyToExisting: input.applyToExisting, renumbered }, meta,
        });
        return numberingRow(tx, auth.tenantId);
      },
      { timeoutMs: 60_000 },
    );
  }
}

async function ensureDefaults(tx: TenantTx, tenantId: string): Promise<void> {
  // Workspaces created before the upgrade ran (and test workspaces) get their defaults on first use.
  if (!(await tx.crmStatus.findFirst({ where: { tenantId }, select: { id: true } }))) await ensureCompanyCrmDefaults(tx, tenantId);
}

async function numberingRow(tx: TenantTx, tenantId: string): Promise<LeadNumberingRow> {
  const n = await leadNumbering(tx, tenantId);
  const counter = await tx.counter.findUnique({ where: { id: `seq:lead:${tenantId}` } });
  const issued = counter?.value ?? 0;
  return { prefix: n.prefix, digits: n.digits, isDefaultPrefix: n.isDefaultPrefix, next: formatLeadNumber(n.prefix, issued + 1, n.digits), issued };
}

async function statusCounts(tx: TenantTx, tenantId: string, kind: CrmStatusKind): Promise<Map<string, number>> {
  const groups =
    kind === 'COMPANY'
      ? await tx.company.groupBy({ by: ['statusId'], where: { tenantId, deletedAt: null }, _count: { _all: true } })
      : await tx.contact.groupBy({ by: ['statusId'], where: { tenantId, deletedAt: null }, _count: { _all: true } });
  return new Map(groups.filter((g) => g.statusId).map((g) => [g.statusId!, g._count._all]));
}

function toStatusRow(r: { id: string; kind: string; name: string; description: string | null; color: string; meaning: string | null; position: number; isDefault: boolean; archivedAt: Date | null }, inUse: number): CrmStatusRow {
  return {
    id: r.id, kind: r.kind as CrmStatusKind, name: r.name, description: r.description, color: r.color, meaning: (r.meaning ?? 'ACTIVE') as StatusMeaning,
    position: r.position, isDefault: r.isDefault, archived: !!r.archivedAt, inUse,
  };
}
