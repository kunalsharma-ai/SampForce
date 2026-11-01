import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@dealflow/database';
import type { CompanyInput, CompanyRow, ListQuery, Page } from '@dealflow/types';
import { AuditService } from '../audit/audit.service';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { assertRefs, diff, notFound, orderBy, ownerRefs, paging } from './crm-helpers';
import { CustomFieldsService } from './custom-fields.service';

const SORTABLE = ['name', 'domain', 'createdAt', 'updatedAt', 'industry', 'country'] as const;
const include = {
  parent: { select: { id: true, name: true } },
  _count: { select: { contacts: { where: { deletedAt: null } }, opportunities: { where: { deletedAt: null, status: 'OPEN' as const } } } },
} satisfies Prisma.CompanyInclude;
type CompanyWith = Prisma.CompanyGetPayload<{ include: typeof include }>;

@Injectable()
export class CompaniesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly fields: CustomFieldsService,
  ) {}

  list(auth: AuthContext, q: ListQuery): Promise<Page<CompanyRow>> {
    return this.prisma.run(auth, async (tx) => {
      const where: Prisma.CompanyWhereInput = {
        tenantId: auth.tenantId,
        deletedAt: null,
        ...(q.ownerId ? { ownerId: q.ownerId } : {}),
        // "customer" powers the Accounts view: companies with at least one won deal.
        ...(q.status === 'customer' ? { opportunities: { some: { status: 'WON' as const, deletedAt: null } } } : {}),
        ...(q.q
          ? { OR: [{ name: { contains: q.q, mode: 'insensitive' } }, { domain: { contains: q.q, mode: 'insensitive' } }] }
          : {}),
      };
      const [rows, total] = await Promise.all([
        tx.company.findMany({ where, include, orderBy: orderBy(q, SORTABLE, 'createdAt'), ...paging(q) }),
        tx.company.count({ where }),
      ]);
      const owners = await ownerRefs(tx, rows.map((r) => r.ownerId));
      return { items: rows.map((r) => toRow(r, owners)), total, page: q.page, pageSize: q.pageSize };
    });
  }

  get(auth: AuthContext, id: string): Promise<CompanyRow> {
    return this.prisma.run(auth, async (tx) => {
      const row = await tx.company.findFirst({ where: { id, tenantId: auth.tenantId, deletedAt: null }, include });
      if (!row) throw notFound('Company');
      return toRow(row, await ownerRefs(tx, [row.ownerId]));
    });
  }

  create(auth: AuthContext, input: CompanyInput, meta: RequestMeta): Promise<CompanyRow> {
    return this.prisma.run(auth, async (tx) => {
      const ownerId = input.ownerId ?? auth.userId;
      await assertRefs(tx, auth.tenantId, { ownerId, parentCompanyId: input.parentCompanyId });
      const customFields = await this.fields.validate(tx, auth.tenantId, 'COMPANY', input.customFields);
      const row = await tx.company.create({
        data: { ...input, ownerId, tenantId: auth.tenantId, customFields: (customFields ?? {}) as Prisma.InputJsonValue },
        include,
      });
      await this.audit.record(tx, {
        tenantId: auth.tenantId, actorUserId: auth.userId, action: 'company.created', entityType: 'company', entityId: row.id,
        metadata: { name: row.name }, meta,
      });
      return toRow(row, await ownerRefs(tx, [row.ownerId]));
    });
  }

  update(auth: AuthContext, id: string, input: Partial<CompanyInput>, meta: RequestMeta): Promise<CompanyRow> {
    return this.prisma.run(auth, async (tx) => {
      const before = await tx.company.findFirst({ where: { id, tenantId: auth.tenantId, deletedAt: null } });
      if (!before) throw notFound('Company');
      if (input.parentCompanyId === id) {
        throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'A company cannot be its own parent.', details: [{ path: 'parentCompanyId', message: 'cannot reference itself' }] });
      }
      await assertRefs(tx, auth.tenantId, { ownerId: input.ownerId, parentCompanyId: input.parentCompanyId });
      const customFields = await this.fields.validate(tx, auth.tenantId, 'COMPANY', input.customFields, before.customFields as Record<string, unknown>);
      const { customFields: _cf, ...rest } = input;
      const row = await tx.company.update({
        where: { id },
        data: { ...rest, ...(customFields ? { customFields: customFields as Prisma.InputJsonValue } : {}) },
        include,
      });
      await this.audit.record(tx, {
        tenantId: auth.tenantId, actorUserId: auth.userId, action: 'company.updated', entityType: 'company', entityId: id,
        metadata: { changes: diff(before, input) }, meta,
      });
      return toRow(row, await ownerRefs(tx, [row.ownerId]));
    });
  }

  remove(auth: AuthContext, id: string, meta: RequestMeta): Promise<void> {
    return this.prisma.run(auth, async (tx) => {
      const { count } = await tx.company.updateMany({ where: { id, tenantId: auth.tenantId, deletedAt: null }, data: { deletedAt: new Date() } });
      if (count === 0) throw notFound('Company');
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'company.deleted', entityType: 'company', entityId: id, meta });
    });
  }
}

function toRow(r: CompanyWith, owners: Map<string, { id: string; name: string }>): CompanyRow {
  return {
    id: r.id,
    name: r.name,
    domain: r.domain,
    industry: r.industry,
    country: r.country,
    owner: r.ownerId ? (owners.get(r.ownerId) ?? null) : null,
    parentCompany: r.parent,
    contactCount: r._count.contacts,
    openDealCount: r._count.opportunities,
    customFields: (r.customFields ?? {}) as Record<string, unknown>,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}
