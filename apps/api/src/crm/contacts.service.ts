import { Injectable } from '@nestjs/common';
import { Prisma } from '@dealflow/database';
import type { ContactInput, ContactRow, EmailStatus, ListQuery, Page } from '@dealflow/types';
import { AuditService } from '../audit/audit.service';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { assertRefs, diff, notFound, orderBy, ownerRefs, paging, consentFields } from './crm-helpers';
import { CustomFieldsService } from './custom-fields.service';

const SORTABLE = ['firstName', 'lastName', 'email', 'createdAt', 'updatedAt'] as const;
const include = { company: { select: { id: true, name: true } } } satisfies Prisma.ContactInclude;
type ContactWith = Prisma.ContactGetPayload<{ include: typeof include }>;

@Injectable()
export class ContactsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly fields: CustomFieldsService,
  ) {}

  list(auth: AuthContext, q: ListQuery): Promise<Page<ContactRow>> {
    return this.prisma.run(auth, async (tx) => {
      const where: Prisma.ContactWhereInput = {
        tenantId: auth.tenantId,
        deletedAt: null,
        ...(q.ownerId ? { ownerId: q.ownerId } : {}),
        ...(q.companyId ? { companyId: q.companyId } : {}),
        ...(q.q
          ? {
              OR: [
                { firstName: { contains: q.q, mode: 'insensitive' } },
                { lastName: { contains: q.q, mode: 'insensitive' } },
                { email: { contains: q.q, mode: 'insensitive' } },
              ],
            }
          : {}),
      };
      const [rows, total] = await Promise.all([
        tx.contact.findMany({ where, include, orderBy: orderBy(q, SORTABLE, 'createdAt'), ...paging(q) }),
        tx.contact.count({ where }),
      ]);
      const owners = await ownerRefs(tx, rows.map((r) => r.ownerId));
      return { items: rows.map((r) => toContactRow(r, owners)), total, page: q.page, pageSize: q.pageSize };
    });
  }

  get(auth: AuthContext, id: string): Promise<ContactRow> {
    return this.prisma.run(auth, async (tx) => {
      const row = await tx.contact.findFirst({ where: { id, tenantId: auth.tenantId, deletedAt: null }, include });
      if (!row) throw notFound('Contact');
      return toContactRow(row, await ownerRefs(tx, [row.ownerId]));
    });
  }

  create(auth: AuthContext, input: ContactInput, meta: RequestMeta): Promise<ContactRow> {
    return this.prisma.run(auth, async (tx) => {
      const ownerId = input.ownerId ?? auth.userId;
      await assertRefs(tx, auth.tenantId, { ownerId, companyId: input.companyId });
      const customFields = await this.fields.validate(tx, auth.tenantId, 'CONTACT', input.customFields);
      const row = await tx.contact.create({
        data: { ...input, ...consentFields(input.marketingConsent, 'manual'), ownerId, tenantId: auth.tenantId, customFields: (customFields ?? {}) as Prisma.InputJsonValue },
        include,
      });
      await this.audit.record(tx, {
        tenantId: auth.tenantId, actorUserId: auth.userId, action: 'contact.created', entityType: 'contact', entityId: row.id, meta,
      });
      return toContactRow(row, await ownerRefs(tx, [row.ownerId]));
    });
  }

  update(auth: AuthContext, id: string, input: Partial<ContactInput>, meta: RequestMeta): Promise<ContactRow> {
    return this.prisma.run(auth, async (tx) => {
      const before = await tx.contact.findFirst({ where: { id, tenantId: auth.tenantId, deletedAt: null } });
      if (!before) throw notFound('Contact');
      await assertRefs(tx, auth.tenantId, { ownerId: input.ownerId, companyId: input.companyId });
      const customFields = await this.fields.validate(tx, auth.tenantId, 'CONTACT', input.customFields, before.customFields as Record<string, unknown>);
      const { customFields: _cf, ...rest } = input;
      const row = await tx.contact.update({
        where: { id },
        data: {
          ...rest,
          ...(input.marketingConsent && input.marketingConsent !== before.marketingConsent ? consentFields(input.marketingConsent, 'manual') : {}),
          ...(customFields ? { customFields: customFields as Prisma.InputJsonValue } : {}),
          ...(input.email !== undefined && (input.email ?? null) !== before.email ? { emailStatus: null } : {}),
        },
        include,
      });
      await this.audit.record(tx, {
        tenantId: auth.tenantId, actorUserId: auth.userId, action: 'contact.updated', entityType: 'contact', entityId: id,
        metadata: { changes: diff(before, input) }, meta,
      });
      return toContactRow(row, await ownerRefs(tx, [row.ownerId]));
    });
  }

  remove(auth: AuthContext, id: string, meta: RequestMeta): Promise<void> {
    return this.prisma.run(auth, async (tx) => {
      const { count } = await tx.contact.updateMany({ where: { id, tenantId: auth.tenantId, deletedAt: null }, data: { deletedAt: new Date() } });
      if (count === 0) throw notFound('Contact');
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'contact.deleted', entityType: 'contact', entityId: id, meta });
    });
  }
}

export function toContactRow(r: ContactWith, owners: Map<string, { id: string; name: string }>): ContactRow {
  return {
    id: r.id,
    firstName: r.firstName,
    lastName: r.lastName,
    fullName: [r.firstName, r.lastName].filter(Boolean).join(' '),
    email: r.email,
    phone: r.phone,
    jobTitle: r.jobTitle,
    country: r.country,
    timezone: r.timezone,
    company: r.company,
    owner: r.ownerId ? (owners.get(r.ownerId) ?? null) : null,
    marketingConsent: r.marketingConsent,
    consentSource: r.consentSource,
    consentUpdatedAt: r.consentUpdatedAt?.toISOString() ?? null,
    emailStatus: (r.emailStatus as EmailStatus | null) ?? null,
    engagementScore: r.engagementScore,
    customFields: (r.customFields ?? {}) as Record<string, unknown>,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}
