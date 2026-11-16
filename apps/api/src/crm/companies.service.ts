import { BadRequestException, Injectable } from '@nestjs/common';
import { assignLeadNumbers, companyMatchKeys, points, Prisma, type TenantTx } from '@dealflow/database';
import { companyNameKey, type CompanyAddress, type CompanyDuplicateCheck, type CompanyInput, type CompanyRow, type ContactPoint, type CrmStatusRef, type DuplicateMatch, type ListQuery, matchKeys, type Page, type PersonRef } from '@dealflow/types';
import { AuditService } from '../audit/audit.service';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { assertRefs, badRef, diff, notFound, orderBy, paging } from './crm-helpers';
import { CustomFieldsService } from './custom-fields.service';
import { canSeeDetails, companyScope, personRefs, visibility, type Visibility } from './visibility';

const SORTABLE = ['name', 'domain', 'createdAt', 'updatedAt', 'industry', 'country', 'leadSeq', 'statusChangedAt'] as const;
const include = {
  parent: { select: { id: true, name: true } },
  _count: { select: { contacts: { where: { deletedAt: null } }, opportunities: { where: { deletedAt: null, status: 'OPEN' as const } } } },
} satisfies Prisma.CompanyInclude;
type CompanyWith = Prisma.CompanyGetPayload<{ include: typeof include }>;

/** Extra filters of the company list (on top of ListQuery). */
export interface CompanyFilters {
  statusId?: string;
  createdById?: string;
  managerId?: string;
  country?: string;
  industry?: string;
}

interface RowContext {
  people: Map<string, PersonRef>;
  statuses: Map<string, CrmStatusRef>;
  departments: Map<string, string>;
  teams: Map<string, string>;
  v: Visibility;
}

@Injectable()
export class CompaniesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly fields: CustomFieldsService,
  ) {}

  list(auth: AuthContext, q: ListQuery, f: CompanyFilters = {}): Promise<Page<CompanyRow>> {
    return this.prisma.run(auth, async (tx) => {
      const v = await visibility(tx, auth);
      const search = q.q?.trim();
      const where: Prisma.CompanyWhereInput = {
        tenantId: auth.tenantId,
        deletedAt: null,
        AND: [
          companyScope(v),
          ...(search
            ? [
                {
                  OR: [
                    { name: { contains: search, mode: 'insensitive' as const } },
                    { domain: { contains: search, mode: 'insensitive' as const } },
                    { leadNumber: { equals: search.toUpperCase() } },
                    { matchKeys: { hasSome: matchKeys({ emails: [search], phones: [search], websites: [search], linkedin: [search] }) } },
                  ],
                },
              ]
            : []),
        ],
        ...(q.ownerId ? { ownerId: q.ownerId } : {}),
        ...(f.statusId ? { statusId: f.statusId } : {}),
        ...(f.createdById ? { createdById: f.createdById } : {}),
        ...(f.managerId ? { managerId: f.managerId } : {}),
        ...(f.country ? { country: f.country.toUpperCase() } : {}),
        ...(f.industry ? { industry: { equals: f.industry, mode: 'insensitive' as const } } : {}),
        // "customer" powers the Accounts view: companies with at least one won deal.
        ...(q.status === 'customer' ? { opportunities: { some: { status: 'WON' as const, deletedAt: null } } } : {}),
      };
      const [rows, total] = await Promise.all([
        tx.company.findMany({ where, include, orderBy: orderBy(q, SORTABLE, 'createdAt'), ...paging(q) }),
        tx.company.count({ where }),
      ]);
      const ctx = await rowContext(tx, auth.tenantId, rows, v);
      return { items: rows.map((r) => toRow(r, ctx)), total, page: q.page, pageSize: q.pageSize };
    });
  }

  get(auth: AuthContext, id: string): Promise<CompanyRow> {
    return this.prisma.run(auth, async (tx) => {
      const v = await visibility(tx, auth);
      const row = await tx.company.findFirst({ where: { id, tenantId: auth.tenantId, deletedAt: null, ...companyScope(v) }, include });
      if (!row) throw notFound('Company');
      return toRow(row, await rowContext(tx, auth.tenantId, [row], v));
    });
  }

  create(auth: AuthContext, input: CompanyInput, meta: RequestMeta): Promise<CompanyRow> {
    return this.prisma.run(auth, async (tx) => {
      const ownerId = input.ownerId ?? auth.userId;
      await assertRefs(tx, auth.tenantId, { ownerId, parentCompanyId: input.parentCompanyId });
      await assertCompanyRefs(tx, auth.tenantId, input);
      const customFields = await this.fields.validate(tx, auth.tenantId, 'COMPANY', input.customFields);
      const statusId = input.statusId ?? (await defaultStatusId(tx, auth.tenantId, 'COMPANY'));
      const data = normalise(input);
      const row = await tx.company.create({
        data: {
          ...data,
          ownerId,
          statusId,
          statusChangedAt: new Date(),
          statusChangedById: auth.userId,
          createdById: auth.userId,
          updatedById: auth.userId,
          tenantId: auth.tenantId,
          customFields: (customFields ?? {}) as Prisma.InputJsonValue,
        },
      });
      await assignLeadNumbers(tx, auth.tenantId);
      const numbered = await tx.company.findUniqueOrThrow({ where: { id: row.id }, include });
      await this.audit.record(tx, {
        tenantId: auth.tenantId, actorUserId: auth.userId, action: 'company.created', entityType: 'company', entityId: row.id,
        metadata: { name: row.name, leadNumber: numbered.leadNumber }, meta,
      });
      return toRow(numbered, await rowContext(tx, auth.tenantId, [numbered], await visibility(tx, auth)));
    });
  }

  update(auth: AuthContext, id: string, input: Partial<CompanyInput>, meta: RequestMeta): Promise<CompanyRow> {
    return this.prisma.run(auth, async (tx) => {
      const v = await visibility(tx, auth);
      const before = await tx.company.findFirst({ where: { id, tenantId: auth.tenantId, deletedAt: null, ...companyScope(v) } });
      if (!before) throw notFound('Company');
      if (!canSeeDetails(v, before.ownerId)) {
        // Someone who cannot see the details may still move the status, but cannot overwrite what they cannot read.
        const allowed = new Set(['statusId']);
        const blocked = Object.keys(input).filter((k) => input[k as keyof CompanyInput] !== undefined && !allowed.has(k));
        if (blocked.length) throw new BadRequestException({ code: 'DETAILS_HIDDEN', message: 'Your role cannot see or change the details of this company.', details: blocked.map((path) => ({ path, message: 'hidden' })) });
      }
      if (input.parentCompanyId === id) {
        throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'A company cannot be its own parent.', details: [{ path: 'parentCompanyId', message: 'cannot reference itself' }] });
      }
      await assertRefs(tx, auth.tenantId, { ownerId: input.ownerId, parentCompanyId: input.parentCompanyId });
      await assertCompanyRefs(tx, auth.tenantId, input);
      const customFields = await this.fields.validate(tx, auth.tenantId, 'COMPANY', input.customFields, before.customFields as Record<string, unknown>);
      const { customFields: _cf, ...rest } = input;
      const data = normalise(rest, before);
      const statusChanged = input.statusId !== undefined && input.statusId !== before.statusId;
      const row = await tx.company.update({
        where: { id },
        data: {
          ...data,
          ...(customFields ? { customFields: customFields as Prisma.InputJsonValue } : {}),
          ...(statusChanged ? { statusChangedAt: new Date(), statusChangedById: auth.userId } : {}),
          updatedById: auth.userId,
        },
        include,
      });
      const changes = diff(before, input);
      await this.audit.record(tx, {
        tenantId: auth.tenantId, actorUserId: auth.userId, action: 'company.updated', entityType: 'company', entityId: id,
        metadata: { changes }, meta,
      });
      if (statusChanged) {
        await this.audit.record(tx, {
          tenantId: auth.tenantId, actorUserId: auth.userId, action: 'company.status_changed', entityType: 'company', entityId: id,
          metadata: { from: before.statusId, to: input.statusId }, meta,
        });
      }
      if (input.ownerId !== undefined && input.ownerId !== before.ownerId) {
        await this.audit.record(tx, {
          tenantId: auth.tenantId, actorUserId: auth.userId, action: 'company.owner_changed', entityType: 'company', entityId: id,
          metadata: { from: before.ownerId, to: input.ownerId }, meta,
        });
      }
      return toRow(row, await rowContext(tx, auth.tenantId, [row], v));
    });
  }

  remove(auth: AuthContext, id: string, meta: RequestMeta): Promise<void> {
    return this.prisma.run(auth, async (tx) => {
      const v = await visibility(tx, auth);
      const { count } = await tx.company.updateMany({ where: { id, tenantId: auth.tenantId, deletedAt: null, ...companyScope(v) }, data: { deletedAt: new Date() } });
      if (count === 0) throw notFound('Company');
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'company.deleted', entityType: 'company', entityId: id, meta });
    });
  }

  /** Possible duplicates across the whole workspace, whoever owns them. Names only (DuplicateMatch). */
  duplicates(auth: AuthContext, input: CompanyDuplicateCheck): Promise<DuplicateMatch[]> {
    return this.prisma.run(auth, async (tx) => {
      const v = await visibility(tx, auth);
      const nameKey = companyNameKey(input.name);
      const keys = matchKeys({ websites: [input.website], emails: input.emails, phones: input.phones, linkedin: [input.linkedinUrl], emailDomains: true });
      if (!nameKey && !keys.length) return [];
      const or: Prisma.CompanyWhereInput[] = [];
      if (nameKey) or.push({ nameKey });
      if (keys.length) or.push({ matchKeys: { hasSome: keys } });
      const rows = await tx.company.findMany({
        where: { tenantId: auth.tenantId, deletedAt: null, OR: or, ...(input.excludeId ? { id: { not: input.excludeId } } : {}) },
        select: { id: true, name: true, leadNumber: true, ownerId: true, nameKey: true, matchKeys: true },
        take: 10,
      });
      const visible = new Set(
        v.all ? rows.map((r) => r.id) : (await tx.company.findMany({ where: { id: { in: rows.map((r) => r.id) }, ...companyScope(v) }, select: { id: true } })).map((r) => r.id),
      );
      const people = await personRefs(tx, auth.tenantId, rows.map((r) => r.ownerId));
      return rows.map((r) => ({
        id: r.id,
        entity: 'company' as const,
        name: r.name,
        leadNumber: r.leadNumber,
        company: null,
        owner: r.ownerId ? { id: r.ownerId, name: people.get(r.ownerId)?.name ?? '' } : null,
        reasons: reasons(r.nameKey === nameKey && !!nameKey, r.matchKeys, keys),
        visible: visible.has(r.id),
      }));
    });
  }
}

export function reasons(nameMatch: boolean, have: string[], wanted: string[]): DuplicateMatch['reasons'] {
  const out = new Set<DuplicateMatch['reasons'][number]>();
  if (nameMatch) out.add('name');
  const kinds = { d: 'domain', e: 'email', p: 'phone', l: 'linkedin' } as const;
  for (const k of have) if (wanted.includes(k)) out.add(kinds[k[0] as keyof typeof kinds]);
  return [...out];
}

/** Primary entries mirror the lists; duplicate keys follow every change. */
function normalise(input: Partial<CompanyInput>, before?: Prisma.CompanyGetPayload<object>): Prisma.CompanyUncheckedUpdateInput & Prisma.CompanyUncheckedCreateInput {
  const out: Record<string, unknown> = { ...input };
  const sync = (list: 'emails' | 'phones' | 'websites' | 'linkedinUrls', field: 'primaryEmail' | 'primaryPhone' | 'website' | 'linkedinUrl') => {
    if (input[list] !== undefined) {
      const items = withOnePrimary(input[list] as ContactPoint[], input[field] ?? undefined);
      out[list] = items as unknown as Prisma.InputJsonValue;
      if (input[field] === undefined) out[field] = items.find((p) => p.primary)?.value ?? null;
    } else if (input[field] !== undefined) {
      // A new primary value given alone replaces the old primary entry of the list.
      const old = points(before?.[list]).filter((p) => !p.primary);
      out[list] = (input[field] ? [{ value: input[field], primary: true }, ...old] : old) as unknown as Prisma.InputJsonValue;
    }
  };
  sync('emails', 'primaryEmail');
  sync('phones', 'primaryPhone');
  sync('websites', 'website');
  sync('linkedinUrls', 'linkedinUrl');
  if (input.addresses !== undefined) out.addresses = input.addresses as unknown as Prisma.InputJsonValue;
  // The old domain field (used by integrations and enrichment) follows the website.
  if (out.website !== undefined && input.domain === undefined) out.domain = out.website ? new URL(String(out.website)).hostname.replace(/^www\./, '') : (before?.domain ?? null);
  if (input.name !== undefined) out.nameKey = companyNameKey(input.name);
  const merged = { ...(before ?? {}), ...out } as Parameters<typeof companyMatchKeys>[0];
  out.matchKeys = companyMatchKeys(merged);
  delete out.customFields;
  return out as Prisma.CompanyUncheckedUpdateInput & Prisma.CompanyUncheckedCreateInput;
}

/** Exactly one primary entry when the list has any: the given primary value, else the first marked, else the first. */
export function withOnePrimary(list: ContactPoint[], primaryValue?: string | null): ContactPoint[] {
  const seen = new Set<string>();
  const items = list.filter((p) => {
    const k = p.value.trim().toLowerCase();
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  if (primaryValue && !items.some((p) => p.value.toLowerCase() === primaryValue.toLowerCase())) items.unshift({ value: primaryValue, primary: true });
  const idx = primaryValue ? items.findIndex((p) => p.value.toLowerCase() === primaryValue.toLowerCase()) : Math.max(0, items.findIndex((p) => p.primary));
  return items.map((p, i) => ({ value: p.value, label: p.label ?? null, primary: i === idx }));
}

export async function defaultStatusId(tx: TenantTx, tenantId: string, kind: 'COMPANY' | 'EMPLOYEE'): Promise<string | null> {
  const s =
    (await tx.crmStatus.findFirst({ where: { tenantId, kind, isDefault: true, archivedAt: null }, select: { id: true } })) ??
    (await tx.crmStatus.findFirst({ where: { tenantId, kind, archivedAt: null }, orderBy: { position: 'asc' }, select: { id: true } }));
  return s?.id ?? null;
}

export async function assertStatus(tx: TenantTx, tenantId: string, kind: 'COMPANY' | 'EMPLOYEE', id: string | null | undefined, field = 'statusId'): Promise<void> {
  if (!id) return;
  const s = await tx.crmStatus.findFirst({ where: { id, tenantId, kind }, select: { archivedAt: true } });
  if (!s) throw badRef(field);
  if (s.archivedAt) throw badRef(field, 'this status is deactivated');
}

async function assertCompanyRefs(tx: TenantTx, tenantId: string, input: Partial<CompanyInput>): Promise<void> {
  await assertStatus(tx, tenantId, 'COMPANY', input.statusId);
  if (input.managerId && !(await tx.membership.findFirst({ where: { tenantId, userId: input.managerId, status: 'ACTIVE' }, select: { id: true } }))) throw badRef('managerId');
  if (input.departmentId && !(await tx.department.findFirst({ where: { tenantId, id: input.departmentId }, select: { id: true } }))) throw badRef('departmentId');
  if (input.teamId && !(await tx.team.findFirst({ where: { tenantId, id: input.teamId }, select: { id: true } }))) throw badRef('teamId');
}

export async function statusRefs(tx: TenantTx, tenantId: string, ids: (string | null | undefined)[]): Promise<Map<string, CrmStatusRef>> {
  const unique = [...new Set(ids.filter((v): v is string => !!v))];
  if (!unique.length) return new Map();
  const rows = await tx.crmStatus.findMany({ where: { tenantId, id: { in: unique } }, select: { id: true, name: true, color: true, meaning: true } });
  return new Map(rows.map((r) => [r.id, r]));
}

async function rowContext(tx: TenantTx, tenantId: string, rows: Prisma.CompanyGetPayload<object>[], v: Visibility): Promise<RowContext> {
  const depIds = [...new Set(rows.map((r) => r.departmentId).filter((d): d is string => !!d))];
  const teamIds = [...new Set(rows.map((r) => r.teamId).filter((d): d is string => !!d))];
  const [people, statuses, departments, teams] = await Promise.all([
    personRefs(tx, tenantId, rows.flatMap((r) => [r.ownerId, r.createdById, r.updatedById, r.managerId])),
    statusRefs(tx, tenantId, rows.map((r) => r.statusId)),
    depIds.length ? tx.department.findMany({ where: { tenantId, id: { in: depIds } }, select: { id: true, name: true } }) : Promise.resolve([]),
    teamIds.length ? tx.team.findMany({ where: { tenantId, id: { in: teamIds } }, select: { id: true, name: true } }) : Promise.resolve([]),
  ]);
  return { people, statuses, departments: new Map(departments.map((d) => [d.id, d.name])), teams: new Map(teams.map((d) => [d.id, d.name])), v };
}

function toRow(r: CompanyWith, ctx: RowContext): CompanyRow {
  const person = (id: string | null) => (id ? (ctx.people.get(id) ?? null) : null);
  const show = canSeeDetails(ctx.v, r.ownerId);
  const hide = <T>(value: T, empty: T): T => (show ? value : empty);
  const owner = person(r.ownerId);
  return {
    id: r.id,
    name: r.name,
    domain: hide(r.domain, null),
    industry: r.industry,
    country: r.country,
    owner: owner ? { id: owner.id, name: owner.name } : null,
    ownerPerson: owner,
    parentCompany: r.parent,
    contactCount: r._count.contacts,
    openDealCount: r._count.opportunities,
    customFields: hide((r.customFields ?? {}) as Record<string, unknown>, {}),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    leadNumber: r.leadNumber,
    status: r.statusId ? (ctx.statuses.get(r.statusId) ?? null) : null,
    statusChangedAt: r.statusChangedAt?.toISOString() ?? null,
    createdBy: person(r.createdById),
    updatedBy: person(r.updatedById),
    manager: person(r.managerId),
    department: r.departmentId && ctx.departments.has(r.departmentId) ? { id: r.departmentId, name: ctx.departments.get(r.departmentId)! } : null,
    team: r.teamId && ctx.teams.has(r.teamId) ? { id: r.teamId, name: ctx.teams.get(r.teamId)! } : null,
    website: hide(r.website, null),
    linkedinUrl: hide(r.linkedinUrl, null),
    primaryEmail: hide(r.primaryEmail, null),
    primaryPhone: hide(r.primaryPhone, null),
    overview: hide(r.overview, null),
    foundedYear: r.foundedYear,
    branchCount: r.branchCount,
    companySize: r.companySize,
    companyType: r.companyType,
    headquarters: r.headquarters,
    specialties: hide(r.specialties, null),
    businessCategory: r.businessCategory,
    state: r.state,
    city: r.city,
    address: hide(r.address, null),
    postalCode: hide(r.postalCode, null),
    timezone: r.timezone,
    notes: hide(r.notes, null),
    emails: hide(points(r.emails), []),
    phones: hide(points(r.phones), []),
    websites: hide(points(r.websites), []),
    linkedinUrls: hide(points(r.linkedinUrls), []),
    addresses: hide((Array.isArray(r.addresses) ? r.addresses : []) as unknown as CompanyAddress[], []),
    restricted: !show,
  };
}
