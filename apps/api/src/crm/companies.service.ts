import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { assignLeadNumbers, companyMatchKeys, points, Prisma, type TenantTx } from '@dealflow/database';
import { companyNameKey, type CompanyAddress, type CompanyDuplicateCheck, type CompanyLogoRef, type CompanyInput, type CompanyRow, type ContactPoint, type CrmStatusRef, type CustomFieldFilter, type DuplicateMatch, type FieldSource, type Leader, type ListQuery, matchKeys, type MoreDetail, type Page, type PersonRef, type SocialLink } from '@dealflow/types';
import { AuditService } from '../audit/audit.service';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { assertRefs, badRef, diff, notFound, orderBy, paging } from './crm-helpers';
import { NotificationsService } from '../notifications/notifications.service';
import { CustomFieldsService } from './custom-fields.service';
import { CompanyLogosService } from './company-logos.service';
import { CompanyEnrichmentService, publicSources } from './company-enrichment.service';
import type { CompanyNow } from './enrichment/merge';
import { canSeeDetails, companyScope, personRefs, reportingTree, scopeOf, visibility, type Visibility } from './visibility';

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
  /** Custom field filters (ADR 0062). */
  cf?: CustomFieldFilter[];
}

interface RowContext {
  people: Map<string, PersonRef>;
  statuses: Map<string, CrmStatusRef>;
  departments: Map<string, string>;
  teams: Map<string, string>;
  v: Visibility;
  /** Custom field values the caller may see (ADR 0062). */
  cf: (values: unknown) => Record<string, unknown>;
  /** Logo references by company id (ADR 0070). */
  logos: Map<string, CompanyLogoRef>;
}

@Injectable()
export class CompaniesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly fields: CustomFieldsService,
    private readonly notifications: NotificationsService,
    private readonly logos: CompanyLogosService,
    private readonly enrichment: CompanyEnrichmentService,
  ) {}

  /** The row context, with logo references; companies with a website that were never looked up are queued. */
  private async context(tx: TenantTx, auth: AuthContext, rows: CompanyWith[], v: Visibility): Promise<RowContext> {
    const ctx = await rowContext(tx, auth.tenantId, rows, v, await this.fields.reader(tx, auth, 'COMPANY'), await this.logos.refsIn(tx, auth.tenantId, rows.map((r) => r.id)));
    this.logos.backfill(auth.tenantId, rows, ctx.logos);
    return ctx;
  }

  list(auth: AuthContext, q: ListQuery, f: CompanyFilters = {}): Promise<Page<CompanyRow>> {
    return this.prisma.run(auth, async (tx) => {
      const v = await visibility(tx, auth);
      const search = q.q?.trim();
      const cfFilter = await this.fields.rawFilter(tx, auth, 'COMPANY', f.cf);
      const cfIds = cfFilter ? await this.fields.matchingIds(tx.company, cfFilter) : null;
      const where: Prisma.CompanyWhereInput = {
        tenantId: auth.tenantId,
        deletedAt: null,
        AND: [
          companyScope(v),
          ...(cfIds ? [{ id: { in: cfIds } }] : []),
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
      const ctx = await this.context(tx, auth, rows, v);
      return { items: rows.map((r) => toRow(r, ctx)), total, page: q.page, pageSize: q.pageSize };
    });
  }

  get(auth: AuthContext, id: string): Promise<CompanyRow> {
    return this.prisma.run(auth, async (tx) => {
      const v = await visibility(tx, auth);
      const row = await tx.company.findFirst({ where: { id, tenantId: auth.tenantId, deletedAt: null, ...companyScope(v) }, include });
      if (!row) throw notFound('Company');
      return toRow(row, await this.context(tx, auth, [row], v));
    });
  }

  create(auth: AuthContext, input: CompanyInput, meta: RequestMeta): Promise<CompanyRow> {
    return this.prisma.run(auth, async (tx) => {
      const id = await this.createIn(tx, auth, input, meta);
      return this.rowIn(tx, auth, id);
    });
  }

  /** Creates a company lead inside the caller's transaction (also used by the lead form). Returns its id. */
  async createIn(tx: TenantTx, auth: AuthContext, input: CompanyInput, meta: RequestMeta): Promise<string> {
    const ownerId = input.ownerId ?? auth.userId;
    await assertRefs(tx, auth.tenantId, { ownerId, parentCompanyId: input.parentCompanyId });
    await assertCompanyRefs(tx, auth.tenantId, input);
    await assertAssignable(tx, auth, ownerId);
    const customFields = await this.fields.validateFor(tx, auth, 'COMPANY', input.customFields);
    const statusId = input.statusId ?? (await defaultStatusId(tx, auth.tenantId, 'COMPANY'));
    const managerId = input.managerId !== undefined ? input.managerId : await reportingManagerOf(tx, auth.tenantId, ownerId);
    const data = normalise(input);
    const row = await tx.company.create({
      data: {
        ...data,
        ownerId,
        managerId,
        statusId,
        statusChangedAt: new Date(),
        statusChangedById: auth.userId,
        createdById: auth.userId,
        updatedById: auth.userId,
        tenantId: auth.tenantId,
        customFields: (customFields ?? {}) as Prisma.InputJsonValue,
      },
    });
    await this.fields.claimFiles(tx, auth.tenantId, 'COMPANY', row.id, customFields);
    // The logo is found from the website by the worker (ADR 0070).
    if (row.domain) await this.logos.domainChangedIn(tx, auth.tenantId, row.id, row.domain);
    // Missing details are filled from public sources by the worker (ADR 0076).
    await this.enrichment.queueIn(tx, auth.tenantId, row, 'CREATE', auth.userId);
    await assignLeadNumbers(tx, auth.tenantId);
    const numbered = await tx.company.findUniqueOrThrow({ where: { id: row.id }, select: { leadNumber: true } });
    await this.audit.record(tx, {
      tenantId: auth.tenantId, actorUserId: auth.userId, action: 'company.created', entityType: 'company', entityId: row.id,
      metadata: { name: row.name, leadNumber: numbered.leadNumber }, meta,
    });
    await this.recordOwnerChange(tx, auth, { id: row.id, name: row.name, leadNumber: numbered.leadNumber }, null, ownerId, null, null);
    return row.id;
  }

  /** The company as the caller sees it, inside their transaction. */
  async rowIn(tx: TenantTx, auth: AuthContext, id: string): Promise<CompanyRow> {
    const row = await tx.company.findUniqueOrThrow({ where: { id }, include });
    return toRow(row, await this.context(tx, auth, [row], await visibility(tx, auth)));
  }

  /**
   * Keeps the ownership history and tells the new owner. The first assignment is recorded too (from nobody), so the
   * history always starts with the creator's choice.
   */
  async recordOwnerChange(
    tx: TenantTx,
    auth: AuthContext,
    company: { id: string; name: string; leadNumber: string | null },
    fromUserId: string | null,
    toUserId: string | null,
    reason: string | null,
    note: string | null,
  ): Promise<void> {
    await tx.leadOwnerChange.create({ data: { tenantId: auth.tenantId, companyId: company.id, fromUserId, toUserId, byUserId: auth.userId, reason, note } });
    if (toUserId && toUserId !== auth.userId) {
      const by = (await tx.user.findUnique({ where: { id: auth.userId }, select: { name: true } }))?.name ?? '';
      const label = company.leadNumber ? `${company.leadNumber} ${company.name}` : company.name;
      await this.notifications.send(tx, auth.tenantId, [toUserId], {
        type: 'company.assigned',
        title: `Lead assigned to you: ${label}`,
        body: note ? `${by}: ${note}` : `Assigned by ${by}.`,
        link: `/app/companies/${company.id}`,
      });
    }
  }

  /** `extra` carries the reason and note of an owner change (POST /companies/:id/owner). */
  update(auth: AuthContext, id: string, input: Partial<CompanyInput>, meta: RequestMeta, extra?: { reason?: string | null; note?: string | null }): Promise<CompanyRow> {
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
      const ownerChanged = input.ownerId !== undefined && input.ownerId !== before.ownerId;
      if (ownerChanged && input.ownerId) await assertAssignable(tx, auth, input.ownerId);
      const customFields = await this.fields.validateFor(tx, auth, 'COMPANY', input.customFields, before.customFields as Record<string, unknown>);
      const { customFields: _cf, ...rest } = input;
      const data = normalise(rest, before);
      // What people type or clear is theirs: auto-fill never writes it again (ADR 0076).
      const sources = this.enrichment.userEdits(before as unknown as CompanyNow, rest as Record<string, unknown>, auth.userId);
      if (sources) data.fieldSources = sources as unknown as Prisma.InputJsonValue;
      // The assigned manager follows the new owner unless the change names one.
      if (ownerChanged && input.managerId === undefined) data.managerId = input.ownerId ? await reportingManagerOf(tx, auth.tenantId, input.ownerId) : null;
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
      if (customFields) await this.fields.claimFiles(tx, auth.tenantId, 'COMPANY', id, customFields);
      if (row.domain !== before.domain) {
        await this.logos.domainChangedIn(tx, auth.tenantId, id, row.domain);
        if (row.domain) await this.enrichment.queueIn(tx, auth.tenantId, row, 'WEBSITE_CHANGED', auth.userId);
      }
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
      if (ownerChanged) {
        await this.audit.record(tx, {
          tenantId: auth.tenantId, actorUserId: auth.userId, action: 'company.owner_changed', entityType: 'company', entityId: id,
          metadata: { from: before.ownerId, to: input.ownerId, reason: extra?.reason ?? null }, meta,
        });
        await this.recordOwnerChange(tx, auth, row, before.ownerId, input.ownerId ?? null, extra?.reason ?? 'REASSIGNED', extra?.note ?? null);
      }
      return toRow(row, await this.context(tx, auth, [row], v));
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

/** The reporting manager of a workspace member, who becomes the lead's assigned manager. */
export async function reportingManagerOf(tx: TenantTx, tenantId: string, userId: string | null | undefined): Promise<string | null> {
  if (!userId) return null;
  const m = await tx.membership.findFirst({ where: { tenantId, userId, status: 'ACTIVE' }, select: { reportingManagerId: true } });
  return m?.reportingManagerId ?? null;
}

/**
 * Who the caller may give a lead to: anyone (record scope ALL), themselves and the people reporting to them (TEAM),
 * or only themselves (OWN). Moving a lead elsewhere from OWN is a transfer request (Phase 4).
 */
export async function assignableUserIds(tx: TenantTx, auth: AuthContext): Promise<string[] | 'all'> {
  const scope = scopeOf(auth);
  if (scope === 'ALL') return 'all';
  if (scope === 'TEAM') return [auth.userId, ...(await reportingTree(tx, auth.tenantId, auth.userId))];
  return [auth.userId];
}

export async function assertAssignable(tx: TenantTx, auth: AuthContext, ownerId: string): Promise<void> {
  if (ownerId === auth.userId) return;
  const allowed = await assignableUserIds(tx, auth);
  if (allowed !== 'all' && !allowed.includes(ownerId)) {
    throw new ForbiddenException({ code: 'OWNER_NOT_ALLOWED', message: 'You can give leads only to yourself or to people who report to you.', details: [{ path: 'ownerId', message: 'not allowed' }] });
  }
}

async function assertCompanyRefs(tx: TenantTx, tenantId: string, input: Partial<CompanyInput>): Promise<void> {
  await assertStatus(tx, tenantId, 'COMPANY', input.statusId);
  if (input.managerId && !(await tx.membership.findFirst({ where: { tenantId, userId: input.managerId, status: 'ACTIVE' }, select: { id: true } }))) throw badRef('managerId');
  if (input.pocUserId && !(await tx.membership.findFirst({ where: { tenantId, userId: input.pocUserId, status: 'ACTIVE' }, select: { id: true } }))) throw badRef('pocUserId');
  if (input.departmentId && !(await tx.department.findFirst({ where: { tenantId, id: input.departmentId }, select: { id: true } }))) throw badRef('departmentId');
  if (input.teamId && !(await tx.team.findFirst({ where: { tenantId, id: input.teamId }, select: { id: true } }))) throw badRef('teamId');
}

export async function statusRefs(tx: TenantTx, tenantId: string, ids: (string | null | undefined)[]): Promise<Map<string, CrmStatusRef>> {
  const unique = [...new Set(ids.filter((v): v is string => !!v))];
  if (!unique.length) return new Map();
  const rows = await tx.crmStatus.findMany({ where: { tenantId, id: { in: unique } }, select: { id: true, name: true, color: true, meaning: true } });
  return new Map(rows.map((r) => [r.id, r]));
}

async function rowContext(tx: TenantTx, tenantId: string, rows: Prisma.CompanyGetPayload<object>[], v: Visibility, cf: RowContext['cf'], logos: RowContext['logos']): Promise<RowContext> {
  const depIds = [...new Set(rows.map((r) => r.departmentId).filter((d): d is string => !!d))];
  const teamIds = [...new Set(rows.map((r) => r.teamId).filter((d): d is string => !!d))];
  const [people, statuses, departments, teams] = await Promise.all([
    personRefs(tx, tenantId, rows.flatMap((r) => [r.ownerId, r.createdById, r.updatedById, r.managerId, r.pocUserId])),
    statusRefs(tx, tenantId, rows.map((r) => r.statusId)),
    depIds.length ? tx.department.findMany({ where: { tenantId, id: { in: depIds } }, select: { id: true, name: true } }) : Promise.resolve([]),
    teamIds.length ? tx.team.findMany({ where: { tenantId, id: { in: teamIds } }, select: { id: true, name: true } }) : Promise.resolve([]),
  ]);
  return { people, statuses, departments: new Map(departments.map((d) => [d.id, d.name])), teams: new Map(teams.map((d) => [d.id, d.name])), v, cf, logos };
}

function toRow(r: CompanyWith, ctx: RowContext): CompanyRow {
  const person = (id: string | null) => (id ? (ctx.people.get(id) ?? null) : null);
  const show = canSeeDetails(ctx.v, r.ownerId);
  const hide = <T>(value: T, empty: T): T => (show ? value : empty);
  const owner = person(r.ownerId);
  return {
    id: r.id,
    name: r.name,
    logo: ctx.logos.get(r.id) ?? null,
    domain: hide(r.domain, null),
    industry: r.industry,
    country: r.country,
    owner: owner ? { id: owner.id, name: owner.name } : null,
    ownerPerson: owner,
    parentCompany: r.parent,
    contactCount: r._count.contacts,
    openDealCount: r._count.opportunities,
    customFields: hide(ctx.cf(r.customFields), {}),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    leadNumber: r.leadNumber,
    status: r.statusId ? (ctx.statuses.get(r.statusId) ?? null) : null,
    statusChangedAt: r.statusChangedAt?.toISOString() ?? null,
    createdBy: person(r.createdById),
    updatedBy: person(r.updatedById),
    manager: person(r.managerId),
    poc: person(r.pocUserId),
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
    services: hide(r.services ?? [], []),
    products: hide(r.products ?? [], []),
    industriesServed: r.industriesServed ?? [],
    certifications: r.certifications ?? [],
    founders: r.founders ?? [],
    employeeCount: r.employeeCount ?? null,
    legalName: r.legalName ?? null,
    parentCompanyName: r.parentCompanyName ?? null,
    ownership: r.ownership ?? null,
    ceo: r.ceo ?? null,
    leadership: hide(jsonList<Leader>(r.leadership), []),
    operatingStatus: r.operatingStatus ?? null,
    contactPageUrl: hide(r.contactPageUrl ?? null, null),
    socialLinks: hide(jsonList<SocialLink>(r.socialLinks), []),
    moreDetails: hide(jsonList<MoreDetail>(r.moreDetails), []),
    aiSummary: hide(r.aiSummary ?? null, null),
    aiSummaryAt: hide(r.aiSummaryAt?.toISOString() ?? null, null),
    fieldSources: hide(publicSources(r.fieldSources) as Record<string, FieldSource>, {}),
    restricted: !show,
  };
}

const jsonList = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
