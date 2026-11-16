import { BadRequestException, Injectable } from '@nestjs/common';
import { contactMatchKeys, points, Prisma, type TenantTx } from '@dealflow/database';
import { type ContactDuplicateCheck, type ContactInput, type ContactPoint, type ContactRow, type CrmStatusRef, type DuplicateMatch, type EmailStatus, type ListQuery, matchKeys, type Page, type PersonRef } from '@dealflow/types';
import { AuditService } from '../audit/audit.service';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { assertRefs, diff, notFound, orderBy, paging, consentFields } from './crm-helpers';
import { CustomFieldsService } from './custom-fields.service';
import { assertStatus, defaultStatusId, reasons, statusRefs, withOnePrimary } from './companies.service';
import { canSeeDetails, contactScope, personRefs, visibility, type Visibility } from './visibility';

const SORTABLE = ['firstName', 'lastName', 'email', 'jobTitle', 'createdAt', 'updatedAt', 'nextFollowUpAt', 'statusChangedAt'] as const;
const include = { company: { select: { id: true, name: true } } } satisfies Prisma.ContactInclude;
type ContactWith = Prisma.ContactGetPayload<{ include: typeof include }>;

@Injectable()
export class ContactsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly fields: CustomFieldsService,
  ) {}

  list(auth: AuthContext, q: ListQuery, f: { statusId?: string } = {}): Promise<Page<ContactRow>> {
    return this.prisma.run(auth, async (tx) => {
      const v = await visibility(tx, auth);
      const where: Prisma.ContactWhereInput = {
        tenantId: auth.tenantId,
        deletedAt: null,
        AND: [
          contactScope(v),
          ...(q.q
            ? [
                {
                  OR: [
                    { firstName: { contains: q.q, mode: 'insensitive' as const } },
                    { lastName: { contains: q.q, mode: 'insensitive' as const } },
                    { email: { contains: q.q, mode: 'insensitive' as const } },
                    { matchKeys: { hasSome: matchKeys({ emails: [q.q], phones: [q.q], linkedin: [q.q] }) } },
                  ],
                },
              ]
            : []),
        ],
        ...(q.ownerId ? { ownerId: q.ownerId } : {}),
        ...(q.companyId ? { companyId: q.companyId } : {}),
        ...(f.statusId ? { statusId: f.statusId } : {}),
      };
      const [rows, total] = await Promise.all([
        tx.contact.findMany({ where, include, orderBy: orderBy(q, SORTABLE, 'createdAt'), ...paging(q) }),
        tx.contact.count({ where }),
      ]);
      const ctx = await contactContext(tx, auth.tenantId, rows, v);
      return { items: rows.map((r) => toContactRow(r, ctx.owners, ctx)), total, page: q.page, pageSize: q.pageSize };
    });
  }

  get(auth: AuthContext, id: string): Promise<ContactRow> {
    return this.prisma.run(auth, async (tx) => {
      const v = await visibility(tx, auth);
      const row = await tx.contact.findFirst({ where: { id, tenantId: auth.tenantId, deletedAt: null, ...contactScope(v) }, include });
      if (!row) throw notFound('Contact');
      const ctx = await contactContext(tx, auth.tenantId, [row], v);
      return toContactRow(row, ctx.owners, ctx);
    });
  }

  create(auth: AuthContext, input: ContactInput, meta: RequestMeta): Promise<ContactRow> {
    return this.prisma.run(auth, async (tx) => {
      const ownerId = input.ownerId ?? auth.userId;
      await assertRefs(tx, auth.tenantId, { ownerId, companyId: input.companyId });
      await assertStatus(tx, auth.tenantId, 'EMPLOYEE', input.statusId);
      const customFields = await this.fields.validate(tx, auth.tenantId, 'CONTACT', input.customFields);
      const statusId = input.statusId ?? (await defaultStatusId(tx, auth.tenantId, 'EMPLOYEE'));
      const row = await tx.contact.create({
        data: {
          ...(normaliseContact(input) as Prisma.ContactUncheckedCreateInput),
          ...consentFields(input.marketingConsent, 'manual'),
          ownerId,
          statusId,
          statusChangedAt: new Date(),
          statusChangedById: auth.userId,
          createdById: auth.userId,
          updatedById: auth.userId,
          tenantId: auth.tenantId,
          customFields: (customFields ?? {}) as Prisma.InputJsonValue,
        },
        include,
      });
      await this.audit.record(tx, {
        tenantId: auth.tenantId, actorUserId: auth.userId, action: 'contact.created', entityType: 'contact', entityId: row.id, meta,
      });
      const ctx = await contactContext(tx, auth.tenantId, [row], await visibility(tx, auth));
      return toContactRow(row, ctx.owners, ctx);
    });
  }

  update(auth: AuthContext, id: string, input: Partial<ContactInput>, meta: RequestMeta): Promise<ContactRow> {
    return this.prisma.run(auth, async (tx) => {
      const v = await visibility(tx, auth);
      const before = await tx.contact.findFirst({ where: { id, tenantId: auth.tenantId, deletedAt: null, ...contactScope(v) } });
      if (!before) throw notFound('Contact');
      if (!canSeeDetails(v, before.ownerId)) {
        const blocked = Object.keys(input).filter((k) => input[k as keyof ContactInput] !== undefined && k !== 'statusId');
        if (blocked.length) throw new BadRequestException({ code: 'DETAILS_HIDDEN', message: 'Your role cannot see or change the details of this employee.', details: blocked.map((path) => ({ path, message: 'hidden' })) });
      }
      await assertRefs(tx, auth.tenantId, { ownerId: input.ownerId, companyId: input.companyId });
      await assertStatus(tx, auth.tenantId, 'EMPLOYEE', input.statusId);
      const customFields = await this.fields.validate(tx, auth.tenantId, 'CONTACT', input.customFields, before.customFields as Record<string, unknown>);
      const { customFields: _cf, ...rest } = input;
      const statusChanged = input.statusId !== undefined && input.statusId !== before.statusId;
      const row = await tx.contact.update({
        where: { id },
        data: {
          ...normaliseContact(rest, before),
          ...(statusChanged ? { statusChangedAt: new Date(), statusChangedById: auth.userId } : {}),
          updatedById: auth.userId,
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
      if (statusChanged) {
        await this.audit.record(tx, {
          tenantId: auth.tenantId, actorUserId: auth.userId, action: 'contact.status_changed', entityType: 'contact', entityId: id,
          metadata: { from: before.statusId, to: input.statusId }, meta,
        });
      }
      const ctx = await contactContext(tx, auth.tenantId, [row], v);
      return toContactRow(row, ctx.owners, ctx);
    });
  }

  duplicates(auth: AuthContext, input: ContactDuplicateCheck): Promise<DuplicateMatch[]> {
    return this.prisma.run(auth, (tx) => contactDuplicates(tx, auth, input));
  }

  remove(auth: AuthContext, id: string, meta: RequestMeta): Promise<void> {
    return this.prisma.run(auth, async (tx) => {
      const v = await visibility(tx, auth);
      const { count } = await tx.contact.updateMany({ where: { id, tenantId: auth.tenantId, deletedAt: null, ...contactScope(v) }, data: { deletedAt: new Date() } });
      if (count === 0) throw notFound('Contact');
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'contact.deleted', entityType: 'contact', entityId: id, meta });
    });
  }
}

interface ContactContext {
  owners: Map<string, { id: string; name: string }>;
  people: Map<string, PersonRef>;
  statuses: Map<string, CrmStatusRef>;
  v: Visibility | null;
}

async function contactContext(tx: TenantTx, tenantId: string, rows: Prisma.ContactGetPayload<object>[], v: Visibility): Promise<ContactContext> {
  const [people, statuses] = await Promise.all([
    personRefs(tx, tenantId, rows.flatMap((r) => [r.ownerId, r.createdById, r.statusChangedById])),
    statusRefs(tx, tenantId, rows.map((r) => r.statusId)),
  ]);
  return { owners: new Map([...people].map(([k, p]) => [k, { id: p.id, name: p.name }])), people, statuses, v };
}

/** Primary entries mirror email and phone (which sequences, WhatsApp and SMS matching read); keys follow. */
function normaliseContact(input: Partial<ContactInput>, before?: Prisma.ContactGetPayload<object>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...input };
  const sync = (list: 'emails' | 'phones', field: 'email' | 'phone') => {
    if (input[list] !== undefined) {
      const items = withOnePrimary(input[list] as ContactPoint[], input[field] ?? undefined);
      out[list] = items as unknown as Prisma.InputJsonValue;
      if (input[field] === undefined) out[field] = items.find((p) => p.primary)?.value ?? null;
    } else if (input[field] !== undefined) {
      const old = points(before?.[list]).filter((p) => !p.primary && p.value !== input[field]);
      out[list] = (input[field] ? [{ value: input[field], primary: true }, ...old] : old) as unknown as Prisma.InputJsonValue;
    }
  };
  sync('emails', 'email');
  sync('phones', 'phone');
  if (typeof out.email === 'string') out.email = out.email.toLowerCase();
  if (input.nextFollowUpAt !== undefined) out.nextFollowUpAt = input.nextFollowUpAt ? new Date(input.nextFollowUpAt) : null;
  out.matchKeys = contactMatchKeys({ ...(before ?? {}), ...out } as Parameters<typeof contactMatchKeys>[0]);
  delete out.customFields;
  return out;
}

export async function contactDuplicates(tx: TenantTx, auth: AuthContext, input: ContactDuplicateCheck): Promise<DuplicateMatch[]> {
  const keys = matchKeys({ emails: input.emails, phones: input.phones, linkedin: [input.linkedinUrl] });
  if (!keys.length) return [];
  const v = await visibility(tx, auth);
  const rows = await tx.contact.findMany({
    where: { tenantId: auth.tenantId, deletedAt: null, matchKeys: { hasSome: keys }, ...(input.excludeId ? { id: { not: input.excludeId } } : {}) },
    select: { id: true, firstName: true, lastName: true, ownerId: true, matchKeys: true, company: { select: { id: true, name: true } } },
    take: 10,
  });
  const visible = new Set(
    v.all ? rows.map((r) => r.id) : (await tx.contact.findMany({ where: { id: { in: rows.map((r) => r.id) }, ...contactScope(v) }, select: { id: true } })).map((r) => r.id),
  );
  const people = await personRefs(tx, auth.tenantId, rows.map((r) => r.ownerId));
  return rows.map((r) => ({
    id: r.id,
    entity: 'contact' as const,
    name: [r.firstName, r.lastName].filter(Boolean).join(' '),
    leadNumber: null,
    company: r.company,
    owner: r.ownerId ? { id: r.ownerId, name: people.get(r.ownerId)?.name ?? '' } : null,
    reasons: reasons(false, r.matchKeys, keys),
    visible: visible.has(r.id),
  }));
}

export function toContactRow(r: ContactWith, owners: Map<string, { id: string; name: string }>, ctx?: ContactContext): ContactRow {
  const show = ctx?.v ? canSeeDetails(ctx.v, r.ownerId) : true;
  const hide = <T>(value: T, empty: T): T => (show ? value : empty);
  const person = (id: string | null) => (id ? (ctx?.people.get(id) ?? null) : null);
  return {
    status: r.statusId ? (ctx?.statuses.get(r.statusId) ?? null) : null,
    statusChangedAt: r.statusChangedAt?.toISOString() ?? null,
    statusChangedBy: person(r.statusChangedById),
    department: r.department,
    linkedinUrl: hide(r.linkedinUrl, null),
    state: r.state,
    city: r.city,
    remarks: hide(r.remarks, null),
    nextFollowUpAt: r.nextFollowUpAt?.toISOString() ?? null,
    emails: hide(points(r.emails), []),
    phones: hide(points(r.phones), []),
    ownerPerson: person(r.ownerId),
    createdBy: person(r.createdById),
    restricted: !show,
    id: r.id,
    firstName: r.firstName,
    lastName: r.lastName,
    fullName: [r.firstName, r.lastName].filter(Boolean).join(' '),
    email: hide(r.email, null),
    phone: hide(r.phone, null),
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
    customFields: hide((r.customFields ?? {}) as Record<string, unknown>, {}),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}
