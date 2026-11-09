import { BadGatewayException, BadRequestException, ConflictException, ForbiddenException, HttpException, HttpStatus, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  companySizeFrom,
  type EmailStatus,
  type EnrollResult,
  type extensionProspectImportSchema,
  type ExtensionProspectImportResult,
  guessProspectField,
  isSampleEmail,
  type ListPerformance,
  MAX_PROSPECT_IMPORT_ROWS,
  parseCsv,
  PROSPECT_IMPORT_FIELDS,
  PROSPECT_PAGE_SIZE,
  SAMPLE_DOMAIN_SUFFIX,
  type ProspectAddResult,
  type ProspectBulkResult,
  type ProspectImportField,
  type ProspectImportPreview,
  type ProspectInput,
  prospectInputSchema,
  type ProspectListDetail,
  type ProspectListInput,
  type ProspectListRow,
  type ProspectQuery,
  type ProspectRow,
  type ProspectSettings,
  type ProspectSettingsInput,
  type ProspectSource,
  type ProspectUsage,
  type ProviderPerson,
  type ProviderSearchInput,
  type ProviderSearchResult,
  type ProspectProviderStatus,
  type z,
  type prospectUpdateSchema,
} from '@dealflow/types';
import { createManySkipDuplicates, nullsLast, Prisma, type Prospect, type TenantTx } from '@dealflow/database';
import { Workbook } from 'exceljs';
import { assertSafeZip, UnsafeZipError } from './zip-guard';
import { AuditService } from '../audit/audit.service';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { API_ENV, type ApiEnv } from '../common/env';
import { PrismaService } from '../common/prisma.service';
import { LeadsService } from '../crm/leads.service';
import { toCsv } from '../crm/csv';
import { ExtensionService } from '../extension/extension.service';
import { HunterClient } from '../finder/hunter';
import { NotificationsService } from '../notifications/notifications.service';
import { scanTenants } from '../worker/queue';
import { SequencesService } from '../sequences/sequences.service';
import { currentCheck, PROVIDER_CHECK_PREFIX, readProviderCheck, type StoredCheck } from '../operator/provider-checks';
import { ApolloClient, ProviderError } from './apollo';
import { sampleEmail, sampleSearch } from './sample-provider';

const DAY = 86_400_000;
const notFound = () => new NotFoundException({ code: 'NOT_FOUND', message: 'Prospect list not found.' });
const forbid = (message: string) => new ForbiddenException({ code: 'FORBIDDEN', message });

type NewProspect = ProspectInput & { emailStatus?: EmailStatus | null; source: ProspectSource; sourceRef?: string | null; sample?: boolean };

/** One key per person in a list: the email, or the name at the company when there is no email. */
function keyOf(p: { email?: string | null; fullName: string; domain?: string | null; companyName?: string | null }): string {
  if (p.email) return `e:${p.email.toLowerCase()}`;
  return `n:${p.fullName.trim().toLowerCase()}|${(p.domain || p.companyName || '').trim().toLowerCase()}`;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'a website';
  }
}

type ExtensionProspectImport = z.infer<typeof extensionProspectImportSchema>;

function fullNameOf(p: Pick<ProspectInput, 'fullName' | 'firstName' | 'lastName' | 'email'>): string {
  return p.fullName || [p.firstName, p.lastName].filter(Boolean).join(' ') || (p.email ? p.email.split('@')[0]!.replace(/[._-]+/g, ' ') : 'Unknown');
}

/** How filled-in a prospect is, to keep the best copy when removing duplicates. */
function richness(p: Prospect): number {
  return [p.email, p.title, p.companyName, p.domain, p.industry, p.country, p.companySize, p.phone, p.notes, p.emailStatus].filter(Boolean).length + (p.leadId || p.contactId ? 10 : 0);
}

@Injectable()
export class ProspectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly leads: LeadsService,
    private readonly sequences: SequencesService,
    private readonly extension: ExtensionService,
    private readonly notifications: NotificationsService,
    private readonly apollo: ApolloClient,
    private readonly hunter: HunterClient,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  // ───── Lists ─────

  private async names(tx: TenantTx, tenantId: string): Promise<Map<string, string>> {
    const m = await tx.membership.findMany({ where: { tenantId }, select: { userId: true, user: { select: { name: true } } } });
    return new Map(m.map((x) => [x.userId, x.user.name]));
  }

  private async listRows(tx: TenantTx, tenantId: string, ids?: string[]): Promise<ProspectListRow[]> {
    const lists = await tx.prospectList.findMany({ where: { tenantId, ...(ids ? { id: { in: ids } } : {}) }, orderBy: { updatedAt: 'desc' } });
    if (!lists.length) return [];
    const listIds = lists.map((l) => l.id);
    const base = { tenantId, listId: { in: listIds } };
    const [all, withEmail, inCrm, samples] = await Promise.all([
      tx.prospect.groupBy({ by: ['listId'], where: base, _count: { _all: true } }),
      tx.prospect.groupBy({ by: ['listId'], where: { ...base, email: { not: null } }, _count: { _all: true } }),
      tx.prospect.groupBy({ by: ['listId'], where: { ...base, OR: [{ leadId: { not: null } }, { contactId: { not: null } }] }, _count: { _all: true } }),
      tx.prospect.groupBy({ by: ['listId'], where: { ...base, sample: true }, _count: { _all: true } }),
    ]);
    const n = (rows: Array<{ listId: string; _count: { _all: number } }>, id: string) => rows.find((r) => r.listId === id)?._count._all ?? 0;
    const counts = listIds.map((id) => ({ list_id: id, total: n(all, id), in_crm: n(inCrm, id), with_email: n(withEmail, id), samples: n(samples, id) }));
    const byList = new Map(counts.map((c) => [c.list_id, c]));
    const names = await this.names(tx, tenantId);
    const ref = (id: string | null) => (id && names.has(id) ? { id, name: names.get(id)! } : null);
    return lists.map((l) => {
      const c = byList.get(l.id);
      return {
        id: l.id, name: l.name, description: l.description, owner: ref(l.ownerId), assignee: ref(l.assigneeId),
        prospects: Number(c?.total ?? 0), inCrm: Number(c?.in_crm ?? 0), withEmail: Number(c?.with_email ?? 0), samples: Number(c?.samples ?? 0),
        createdAt: l.createdAt.toISOString(), updatedAt: l.updatedAt.toISOString(),
      };
    });
  }

  lists(auth: AuthContext): Promise<ProspectListRow[]> {
    return this.prisma.run(auth, (tx) => this.listRows(tx, auth.tenantId));
  }

  private async findList(tx: TenantTx, tenantId: string, id: string) {
    const list = await tx.prospectList.findFirst({ where: { id, tenantId } });
    if (!list) throw notFound();
    return list;
  }

  private async checkAssignee(tx: TenantTx, tenantId: string, assigneeId: string | null | undefined) {
    if (!assigneeId) return;
    const m = await tx.membership.findFirst({ where: { tenantId, userId: assigneeId, status: 'ACTIVE' }, select: { userId: true } });
    if (!m) throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Choose an active member of this workspace.', details: [{ path: 'assigneeId', message: 'Not an active member' }] });
  }

  private nameTaken(e: unknown): never {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      throw new ConflictException({ code: 'NAME_TAKEN', message: 'A list with that name already exists.', details: [{ path: 'name', message: 'Choose another name' }] });
    }
    throw e;
  }

  createList(auth: AuthContext, input: ProspectListInput, meta: RequestMeta): Promise<ProspectListRow> {
    return this.prisma
      .run(auth, async (tx) => {
        await this.checkAssignee(tx, auth.tenantId, input.assigneeId);
        const list = await tx.prospectList.create({ data: { tenantId: auth.tenantId, name: input.name, description: input.description ?? null, ownerId: auth.userId, assigneeId: input.assigneeId ?? null } });
        await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'prospect_list.created', entityType: 'prospect_list', entityId: list.id, metadata: { name: list.name }, meta });
        await this.notifyAssignee(tx, auth, list.id, list.name, null, list.assigneeId);
        return (await this.listRows(tx, auth.tenantId, [list.id]))[0]!;
      })
      .catch((e) => this.nameTaken(e));
  }

  updateList(auth: AuthContext, id: string, input: ProspectListInput, meta: RequestMeta): Promise<ProspectListRow> {
    return this.prisma
      .run(auth, async (tx) => {
        const before = await this.findList(tx, auth.tenantId, id);
        await this.checkAssignee(tx, auth.tenantId, input.assigneeId);
        const list = await tx.prospectList.update({ where: { id }, data: { name: input.name, description: input.description ?? null, ...(input.assigneeId !== undefined ? { assigneeId: input.assigneeId } : {}) } });
        await this.audit.record(tx, {
          tenantId: auth.tenantId, actorUserId: auth.userId, action: 'prospect_list.updated', entityType: 'prospect_list', entityId: id,
          metadata: { before: { name: before.name, assigneeId: before.assigneeId }, after: { name: list.name, assigneeId: list.assigneeId } }, meta,
        });
        await this.notifyAssignee(tx, auth, id, list.name, before.assigneeId, list.assigneeId);
        return (await this.listRows(tx, auth.tenantId, [id]))[0]!;
      })
      .catch((e) => this.nameTaken(e));
  }

  private async notifyAssignee(tx: TenantTx, auth: AuthContext, listId: string, name: string, before: string | null, after: string | null) {
    if (!after || after === before || after === auth.userId) return;
    await this.notifications.send(tx, auth.tenantId, [after], { type: 'prospect_list.assigned', title: `Prospect list assigned to you: ${name}`, body: 'Open the list to work through its prospects.', link: `/app/prospects/${listId}` });
  }

  deleteList(auth: AuthContext, id: string, meta: RequestMeta): Promise<void> {
    return this.prisma.run(auth, async (tx) => {
      const list = await this.findList(tx, auth.tenantId, id);
      const count = await tx.prospect.count({ where: { tenantId: auth.tenantId, listId: id } });
      await tx.prospectList.delete({ where: { id } });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'prospect_list.deleted', entityType: 'prospect_list', entityId: id, metadata: { name: list.name, prospects: count }, meta });
    });
  }

  // ───── Prospects in a list ─────

  private where(tenantId: string, listId: string, q: ProspectQuery): Prisma.ProspectWhereInput {
    const where: Prisma.ProspectWhereInput = { tenantId, listId };
    const and: Prisma.ProspectWhereInput[] = [];
    if (q.search) {
      const c = { contains: q.search, mode: 'insensitive' as const };
      and.push({ OR: [{ fullName: c }, { email: c }, { companyName: c }, { title: c }, { domain: c }] });
    }
    if (q.industry) where.industry = { equals: q.industry, mode: 'insensitive' };
    if (q.country) where.country = { equals: q.country, mode: 'insensitive' };
    if (q.companySize) where.companySize = q.companySize;
    if (q.title) where.title = { contains: q.title, mode: 'insensitive' };
    if (q.emailStatus === 'none') where.email = null;
    else if (q.emailStatus) where.emailStatus = q.emailStatus;
    if (q.source) where.source = q.source;
    if (q.stage === 'in_crm') and.push({ OR: [{ leadId: { not: null } }, { contactId: { not: null } }] });
    if (q.stage === 'new') and.push({ leadId: null, contactId: null });
    if (and.length) where.AND = and;
    return where;
  }

  async detail(auth: AuthContext, listId: string, q: ProspectQuery): Promise<ProspectListDetail> {
    return this.prisma.run(auth, async (tx) => {
      await this.findList(tx, auth.tenantId, listId);
      const where = this.where(auth.tenantId, listId, q);
      const orderBy: Prisma.ProspectOrderByWithRelationInput[] =
        q.sort === 'name' ? [{ fullName: 'asc' }] : q.sort === 'company' ? [{ companyName: nullsLast('asc') }, { fullName: 'asc' }] : q.sort === 'title' ? [{ title: nullsLast('asc') }] : q.sort === 'country' ? [{ country: nullsLast('asc') }] : [{ createdAt: 'desc' }, { id: 'asc' }];
      const [rows, total, list] = await Promise.all([
        tx.prospect.findMany({ where, orderBy, skip: (q.page - 1) * PROSPECT_PAGE_SIZE, take: PROSPECT_PAGE_SIZE, include: { lead: { select: { id: true, fullName: true } }, contact: { select: { id: true, firstName: true, lastName: true } } } }),
        tx.prospect.count({ where }),
        this.listRows(tx, auth.tenantId, [listId]),
      ]);
      const facet = async (field: 'industry' | 'country' | 'companySize' | 'title' | 'emailStatus' | 'source', take = 15) => {
        const g = await tx.prospect.groupBy({ by: [field], where: { tenantId: auth.tenantId, listId, ...(field === 'source' ? {} : { [field]: { not: null } }) }, _count: { _all: true }, orderBy: { _count: { [field]: 'desc' } }, take });
        return g.map((x) => ({ value: String(x[field]), count: x._count._all }));
      };
      const [industry, country, companySize, title, emailStatus, source] = await Promise.all([facet('industry'), facet('country'), facet('companySize', 7), facet('title', 10), facet('emailStatus', 10), facet('source', 10)]);
      const suppressed = await this.suppressedOf(tx, auth.tenantId, rows.map((r) => r.email));
      return {
        list: list[0]!,
        prospects: rows.map((r) => this.row(r, suppressed)),
        total,
        page: q.page,
        pageSize: PROSPECT_PAGE_SIZE,
        facets: { industry, country, companySize, title, emailStatus, source },
      };
    });
  }

  private async suppressedOf(tx: TenantTx, tenantId: string, emails: (string | null)[]): Promise<Set<string>> {
    const list = emails.filter((e): e is string => !!e);
    if (!list.length) return new Set();
    const s = await tx.emailSuppression.findMany({ where: { tenantId, email: { in: list } }, select: { email: true } });
    return new Set(s.map((x) => x.email));
  }

  private row(r: Prospect & { lead?: { id: string; fullName: string } | null; contact?: { id: string; firstName: string | null; lastName: string | null } | null }, suppressed: Set<string>): ProspectRow {
    return {
      id: r.id, listId: r.listId, fullName: r.fullName, firstName: r.firstName, lastName: r.lastName, email: r.email,
      emailStatus: (r.emailStatus as EmailStatus | null) ?? null, emailCheckedAt: r.emailCheckedAt?.toISOString() ?? null,
      title: r.title, companyName: r.companyName, domain: r.domain, industry: r.industry, country: r.country,
      companySize: (r.companySize as ProspectRow['companySize']) ?? null, phone: r.phone, notes: r.notes,
      source: r.source as ProspectSource, sample: r.sample, suppressed: !!r.email && suppressed.has(r.email),
      crm: r.contact
        ? { type: 'contact', id: r.contact.id, label: [r.contact.firstName, r.contact.lastName].filter(Boolean).join(' ') || r.email || 'Contact' }
        : r.lead
          ? { type: 'lead', id: r.lead.id, label: r.lead.fullName }
          : null,
      createdAt: r.createdAt.toISOString(),
    };
  }

  /** Adds people to a list, skipping anyone already in it and linking anyone already in the CRM. */
  private async addMany(tx: TenantTx, auth: AuthContext, listId: string, people: NewProspect[], outcomes?: ('added' | 'duplicate')[]): Promise<Omit<ProspectAddResult, 'invalid'>> {
    const existing = await tx.prospect.findMany({ where: { tenantId: auth.tenantId, listId }, select: { email: true, fullName: true, domain: true, companyName: true } });
    const seen = new Set(existing.map(keyOf));
    const fresh: NewProspect[] = [];
    let duplicates = 0;
    for (const p of people) {
      const k = keyOf({ ...p, fullName: fullNameOf(p) });
      if (seen.has(k)) {
        duplicates++;
        outcomes?.push('duplicate');
        continue;
      }
      seen.add(k);
      fresh.push(p);
      outcomes?.push('added');
    }
    const emails = fresh.flatMap((p) => (p.email && !p.sample ? [p.email] : []));
    const { out } = await this.extension.matches(tx, auth.tenantId, emails);
    let inCrm = 0;
    await tx.prospect.createMany({
      data: fresh.map((p) => {
        const match = p.email ? out.get(p.email) : undefined;
        if (match) inCrm++;
        return {
          tenantId: auth.tenantId, listId, fullName: fullNameOf(p), firstName: p.firstName ?? null, lastName: p.lastName ?? null,
          email: p.email ?? null, emailStatus: p.email ? (p.emailStatus ?? null) : null, title: p.title ?? null, companyName: p.companyName ?? null,
          domain: p.domain ?? null, industry: p.industry ?? null, country: p.country ?? null, companySize: p.companySize ?? null, phone: p.phone ?? null,
          notes: p.notes ?? null, source: p.source, sourceRef: p.sourceRef ?? null, sample: !!p.sample || isSampleEmail(p.email),
          leadId: match?.entity === 'lead' ? match.id : null, contactId: match?.entity === 'contact' ? match.id : null, createdById: auth.userId,
        };
      }),
    });
    await tx.prospectList.update({ where: { id: listId }, data: { updatedAt: new Date() } });
    return { added: fresh.length, duplicates, inCrm };
  }

  add(auth: AuthContext, listId: string, people: ProspectInput[], meta: RequestMeta, source: ProspectSource = 'manual'): Promise<ProspectAddResult> {
    return this.prisma.run(auth, async (tx) => {
      await this.findList(tx, auth.tenantId, listId);
      const r = await this.addMany(tx, auth, listId, people.map((p) => ({ ...p, source })));
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'prospects.added', entityType: 'prospect_list', entityId: listId, metadata: { source, ...r }, meta });
      return { ...r, invalid: [] };
    });
  }

  update(auth: AuthContext, id: string, input: z.infer<typeof prospectUpdateSchema>): Promise<ProspectRow> {
    return this.prisma.run(auth, async (tx) => {
      const p = await tx.prospect.findFirst({ where: { id, tenantId: auth.tenantId } });
      if (!p) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Prospect not found.' });
      const data = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
      const fullName = input.fullName ?? ([input.firstName ?? p.firstName, input.lastName ?? p.lastName].filter(Boolean).join(' ') || p.fullName);
      const r = await tx.prospect.update({ where: { id }, data: { ...data, fullName }, include: { lead: { select: { id: true, fullName: true } }, contact: { select: { id: true, firstName: true, lastName: true } } } });
      return this.row(r, await this.suppressedOf(tx, auth.tenantId, [r.email]));
    });
  }

  private async owned(tx: TenantTx, tenantId: string, ids: string[]) {
    const rows = await tx.prospect.findMany({ where: { tenantId, id: { in: ids } } });
    if (!rows.length) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Those prospects were not found.' });
    return rows;
  }

  move(auth: AuthContext, input: { prospectIds: string[]; toListId: string; copy: boolean }, meta: RequestMeta): Promise<{ moved: number; duplicates: number }> {
    return this.prisma.run(auth, async (tx) => {
      const target = await this.findList(tx, auth.tenantId, input.toListId);
      const rows = (await this.owned(tx, auth.tenantId, input.prospectIds)).filter((r) => r.listId !== target.id);
      const inTarget = new Set((await tx.prospect.findMany({ where: { tenantId: auth.tenantId, listId: target.id }, select: { email: true, fullName: true, domain: true, companyName: true } })).map(keyOf));
      const go: Prospect[] = [];
      let duplicates = 0;
      for (const r of rows) {
        const k = keyOf(r);
        if (inTarget.has(k)) duplicates++;
        else {
          inTarget.add(k);
          go.push(r);
        }
      }
      if (input.copy) {
        await tx.prospect.createMany({ data: go.map(({ id: _id, createdAt: _c, updatedAt: _u, listId: _l, ...r }) => ({ ...r, listId: target.id, createdById: auth.userId })) });
      } else {
        await tx.prospect.updateMany({ where: { tenantId: auth.tenantId, id: { in: go.map((r) => r.id) } }, data: { listId: target.id } });
      }
      await tx.prospectList.update({ where: { id: target.id }, data: { updatedAt: new Date() } });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: input.copy ? 'prospects.copied' : 'prospects.moved', entityType: 'prospect_list', entityId: target.id, metadata: { count: go.length, duplicates }, meta });
      return { moved: go.length, duplicates };
    });
  }

  remove(auth: AuthContext, ids: string[], meta: RequestMeta): Promise<{ deleted: number }> {
    return this.prisma.run(auth, async (tx) => {
      const rows = await this.owned(tx, auth.tenantId, ids);
      const { count } = await tx.prospect.deleteMany({ where: { tenantId: auth.tenantId, id: { in: rows.map((r) => r.id) } } });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'prospects.deleted', entityType: 'prospect_list', entityId: rows[0]!.listId, metadata: { count }, meta });
      return { deleted: count };
    });
  }

  /** Keeps the most complete copy of each person (CRM-linked first, then most fields, then oldest). */
  dedupe(auth: AuthContext, listId: string, meta: RequestMeta): Promise<{ removed: number }> {
    return this.prisma.run(auth, async (tx) => {
      await this.findList(tx, auth.tenantId, listId);
      const rows = await tx.prospect.findMany({ where: { tenantId: auth.tenantId, listId }, orderBy: { createdAt: 'asc' } });
      const best = new Map<string, Prospect>();
      const drop: string[] = [];
      for (const r of rows) {
        const k = keyOf(r);
        const cur = best.get(k);
        if (!cur) best.set(k, r);
        else if (richness(r) > richness(cur)) {
          drop.push(cur.id);
          best.set(k, r);
        } else drop.push(r.id);
      }
      if (drop.length) await tx.prospect.deleteMany({ where: { tenantId: auth.tenantId, id: { in: drop } } });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'prospects.deduplicated', entityType: 'prospect_list', entityId: listId, metadata: { removed: drop.length }, meta });
      return { removed: drop.length };
    });
  }

  // ───── Import ─────

  async importPreview(auth: AuthContext, listId: string, file: { name: string; data: Buffer }): Promise<ProspectImportPreview> {
    const lower = file.name.toLowerCase();
    const kind = lower.endsWith('.csv') ? 'csv' : lower.endsWith('.xlsx') ? 'excel' : null;
    if (!kind) throw new BadRequestException({ code: 'UNSUPPORTED_FILE', message: 'Upload a .csv or .xlsx file. Older .xls files can be saved as .xlsx from Excel.' });
    let table: string[][];
    try {
      table = kind === 'csv' ? parseCsv(file.data.toString('utf8')) : await readXlsx(file.data);
    } catch (e) {
      if (e instanceof HttpException) throw e;
      throw new BadRequestException({ code: 'UNREADABLE_FILE', message: 'That file could not be read. Check it opens in a spreadsheet program.' });
    }
    table = table.filter((r) => r.some((c) => c.trim() !== ''));
    if (table.length < 2) throw new BadRequestException({ code: 'EMPTY_FILE', message: 'The file needs a heading row and at least one prospect.' });
    if (table.length - 1 > MAX_PROSPECT_IMPORT_ROWS) throw new BadRequestException({ code: 'TOO_MANY_ROWS', message: `Import up to ${MAX_PROSPECT_IMPORT_ROWS.toLocaleString('en')} rows at a time.` });
    const headers = table[0]!.slice(0, 60).map((h, i) => h.trim() || `Column ${i + 1}`);
    const rows = table.slice(1).map((r) => r.slice(0, 60).map((c) => c.trim().slice(0, 2000)));
    const mapping: Partial<Record<ProspectImportField, number>> = {};
    headers.forEach((h, i) => {
      const f = guessProspectField(h);
      if (f && mapping[f] === undefined) mapping[f] = i;
    });
    return this.prisma.run(auth, async (tx) => {
      await this.findList(tx, auth.tenantId, listId);
      await tx.prospectImport.deleteMany({ where: { tenantId: auth.tenantId, createdAt: { lt: new Date(Date.now() - DAY) } } });
      const imp = await tx.prospectImport.create({ data: { tenantId: auth.tenantId, listId, userId: auth.userId, fileName: file.name.slice(0, 200), kind, headers, rows } });
      return { importId: imp.id, fileName: imp.fileName, headers, sample: rows.slice(0, 5), rows: rows.length, mapping };
    });
  }

  importCommit(auth: AuthContext, listId: string, importId: string, mapping: Partial<Record<ProspectImportField, number>>, meta: RequestMeta): Promise<ProspectAddResult> {
    if (mapping.email === undefined && mapping.fullName === undefined && mapping.firstName === undefined) {
      throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Choose the column with email addresses or names.', details: [{ path: 'mapping.email', message: 'Required' }] });
    }
    return this.prisma.run(auth, async (tx) => {
      const imp = await tx.prospectImport.findFirst({ where: { id: importId, tenantId: auth.tenantId, listId, userId: auth.userId, createdAt: { gt: new Date(Date.now() - DAY) } } });
      if (!imp) throw new NotFoundException({ code: 'NOT_FOUND', message: 'That upload has expired. Upload the file again.' });
      const rows = imp.rows as string[][];
      const people: NewProspect[] = [];
      const invalid: ProspectAddResult['invalid'] = [];
      rows.forEach((r, i) => {
        const raw: Record<string, unknown> = {};
        for (const f of PROSPECT_IMPORT_FIELDS) {
          const col = mapping[f];
          if (col === undefined) continue;
          const v = r[col]?.trim();
          if (v) raw[f] = f === 'companySize' ? companySizeFrom(v) : v;
        }
        const parsed = prospectInputSchema.safeParse(raw);
        if (parsed.success) people.push({ ...parsed.data, source: imp.kind as ProspectSource });
        else invalid.push({ row: i + 2, message: parsed.error.issues[0]?.message ?? 'Invalid row' });
      });
      const r = await this.addMany(tx, auth, listId, people);
      await tx.prospectImport.delete({ where: { id: imp.id } });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'prospects.imported', entityType: 'prospect_list', entityId: listId, metadata: { file: imp.fileName, kind: imp.kind, rows: rows.length, ...r, invalid: invalid.length }, meta });
      return { ...r, invalid: invalid.slice(0, 200) };
    });
  }

  // ───── Into the CRM and outreach ─────

  async toCrm(auth: AuthContext, input: { prospectIds: string[]; sequenceId?: string }, meta: RequestMeta): Promise<ProspectBulkResult> {
    if (!auth.permissions.includes('leads:write')) throw forbid('Your role does not allow adding leads.');
    if (input.sequenceId) await this.checkSequence(auth, input.sequenceId);
    const rows = await this.prisma.run(auth, (tx) => this.owned(tx, auth.tenantId, input.prospectIds));
    const { out, suppressed } = await this.prisma.run(auth, (tx) => this.extension.matches(tx, auth.tenantId, rows.flatMap((r) => (r.email ? [r.email] : []))));
    const results: ProspectBulkResult['results'] = [];
    for (const p of rows) {
      if (p.sample) {
        results.push({ prospectId: p.id, outcome: 'skipped', reason: 'Sample data from Mock Mode cannot be added to the CRM.' });
        continue;
      }
      const linked = p.contactId ? { entity: 'contact' as const, id: p.contactId } : p.leadId ? { entity: 'lead' as const, id: p.leadId } : null;
      const match = (p.email ? out.get(p.email) : undefined) ?? (linked ? { ...linked, label: p.fullName } : undefined);
      if (match) {
        await this.prisma.run(auth, (tx) => tx.prospect.update({ where: { id: p.id }, data: match.entity === 'lead' ? { leadId: match.id } : { contactId: match.id } }));
        results.push({ prospectId: p.id, outcome: 'existing', crm: { type: match.entity, id: match.id, label: match.label } });
        continue;
      }
      try {
        const { lead } = await this.leads.create(
          auth,
          {
            fullName: p.fullName, email: p.email ?? undefined, companyName: p.companyName ?? undefined, jobTitle: p.title ?? undefined,
            industry: p.industry ?? undefined, phone: p.phone ?? undefined, website: p.domain ?? undefined,
            country: p.country && /^[a-z]{2}$/i.test(p.country) ? p.country.toUpperCase() : undefined,
            source: 'Prospect list', tags: ['prospect-list', ...(p.source === 'apollo' ? ['apollo'] : [])],
          },
          meta,
        );
        await this.prisma.run(auth, async (tx) => {
          await tx.prospect.update({ where: { id: p.id }, data: { leadId: lead.id } });
          if (p.emailStatus) await tx.lead.update({ where: { id: lead.id }, data: { emailStatus: p.emailStatus } });
        });
        results.push({ prospectId: p.id, outcome: 'added', crm: { type: 'lead', id: lead.id, label: lead.fullName } });
      } catch (e) {
        results.push({ prospectId: p.id, outcome: 'failed', reason: e instanceof HttpException ? String((e.getResponse() as { message?: string }).message ?? e.message) : 'Could not be added.' });
      }
    }
    await this.prisma.run(auth, (tx) =>
      this.audit.record(tx, {
        tenantId: auth.tenantId, actorUserId: auth.userId, action: 'prospects.added_to_crm', entityType: 'prospect_list', entityId: rows[0]!.listId,
        metadata: { added: results.filter((r) => r.outcome === 'added').length, existing: results.filter((r) => r.outcome === 'existing').length, skipped: results.filter((r) => r.outcome === 'skipped').length, sequenceId: input.sequenceId ?? null },
        meta,
      }),
    );
    if (!input.sequenceId) return { results };
    const targets = results.filter((r) => r.crm && rows.find((p) => p.id === r.prospectId)?.email && !suppressed.has(rows.find((p) => p.id === r.prospectId)!.email!));
    let enrollment: EnrollResult = { enrolled: 0, skipped: [] };
    if (targets.length) {
      enrollment = await this.sequences.enroll(
        auth,
        input.sequenceId,
        { leadIds: targets.filter((t) => t.crm!.type === 'lead').map((t) => t.crm!.id), contactIds: targets.filter((t) => t.crm!.type === 'contact').map((t) => t.crm!.id) },
        meta,
      );
    }
    const listIds = [...new Set(rows.map((r) => r.listId))];
    await this.prisma.run(auth, (tx) =>
      createManySkipDuplicates(tx.prospectOutreach, 'ProspectOutreach', listIds.map((listId) => ({ tenantId: auth.tenantId, listId, sequenceId: input.sequenceId!, createdById: auth.userId }))),
    );
    return { results, enrollment };
  }

  private async checkSequence(auth: AuthContext, sequenceId: string) {
    if (!auth.permissions.includes('sequences:write')) throw forbid('Your role does not allow enrolling people in sequences.');
    await this.prisma.run(auth, async (tx) => {
      const s = await tx.sequence.findFirst({ where: { id: sequenceId, tenantId: auth.tenantId }, select: { status: true } });
      if (!s) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Sequence not found.' });
      if (s.status !== 'ACTIVE') throw new ConflictException({ code: 'SEQUENCE_NOT_ACTIVE', message: 'That sequence is not running. Start it first or choose another.' });
      const mailbox = await tx.integrationConnection.findFirst({ where: { tenantId: auth.tenantId, userId: auth.userId, status: 'CONNECTED' }, select: { id: true } });
      if (!mailbox) throw new ConflictException({ code: 'NOT_CONNECTED', message: 'Connect your Google or Microsoft mailbox in Integrations before enrolling people. Emails go from your own mailbox.' });
    });
  }

  performance(auth: AuthContext, listId: string): Promise<ListPerformance> {
    return this.prisma.run(auth, async (tx) => {
      await this.findList(tx, auth.tenantId, listId);
      const outreach = await tx.prospectOutreach.findMany({ where: { tenantId: auth.tenantId, listId }, include: { sequence: { select: { id: true, name: true } } }, orderBy: { createdAt: 'asc' } });
      const people = await tx.prospect.findMany({ where: { tenantId: auth.tenantId, listId, OR: [{ leadId: { not: null } }, { contactId: { not: null } }] }, select: { leadId: true, contactId: true } });
      const leadIds = people.flatMap((p) => (p.leadId ? [p.leadId] : []));
      const contactIds = people.flatMap((p) => (p.contactId ? [p.contactId] : []));
      const sequences: ListPerformance['sequences'] = [];
      for (const o of outreach) {
        const enrollments = leadIds.length || contactIds.length
          ? await tx.sequenceEnrollment.findMany({
              where: { tenantId: auth.tenantId, sequenceId: o.sequenceId, OR: [{ leadId: { in: leadIds } }, { contactId: { in: contactIds } }] },
              select: { status: true, messages: { select: { openedAt: true, clickedAt: true, repliedAt: true, bouncedAt: true } } },
            })
          : [];
        const msgs = enrollments.flatMap((e) => e.messages);
        sequences.push({
          sequence: o.sequence,
          enrolled: enrollments.length,
          active: enrollments.filter((e) => e.status === 'ACTIVE' || e.status === 'PAUSED').length,
          sent: msgs.length,
          opened: msgs.filter((m) => m.openedAt).length,
          clicked: msgs.filter((m) => m.clickedAt).length,
          replied: enrollments.filter((e) => e.status === 'REPLIED' || e.messages.some((m) => m.repliedAt)).length,
          bounced: enrollments.filter((e) => e.status === 'BOUNCED' || e.messages.some((m) => m.bouncedAt)).length,
          unsubscribed: enrollments.filter((e) => e.status === 'UNSUBSCRIBED').length,
          completed: enrollments.filter((e) => e.status === 'COMPLETED').length,
        });
      }
      const sum = (k: 'enrolled' | 'sent' | 'opened' | 'clicked' | 'replied' | 'bounced' | 'unsubscribed') => sequences.reduce((a, s) => a + s[k], 0);
      return { sequences, totals: { enrolled: sum('enrolled'), sent: sum('sent'), opened: sum('opened'), clicked: sum('clicked'), replied: sum('replied'), bounced: sum('bounced'), unsubscribed: sum('unsubscribed') } };
    });
  }

  /** Eligible prospects only: real (not sample) people with an address that is not invalid, bounced or on the do-not-email list. */
  exportCsv(auth: AuthContext, listId: string, meta: RequestMeta): Promise<{ csv: string; name: string; rows: number; excluded: number }> {
    return this.prisma.run(auth, async (tx) => {
      const list = await this.findList(tx, auth.tenantId, listId);
      const rows = await tx.prospect.findMany({ where: { tenantId: auth.tenantId, listId }, orderBy: { fullName: 'asc' } });
      const suppressed = await this.suppressedOf(tx, auth.tenantId, rows.map((r) => r.email));
      const eligible = rows.filter((r) => !r.sample && r.email && !suppressed.has(r.email) && r.emailStatus !== 'invalid' && r.emailStatus !== 'bounced');
      const csv = toCsv(
        ['Full name', 'First name', 'Last name', 'Email', 'Email status', 'Job title', 'Company', 'Website', 'Industry', 'Country', 'Company size', 'Phone', 'Source'],
        eligible.map((r) => [r.fullName, r.firstName, r.lastName, r.email, r.emailStatus, r.title, r.companyName, r.domain, r.industry, r.country, r.companySize, r.phone, r.source]),
      );
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'prospects.exported', entityType: 'prospect_list', entityId: listId, metadata: { name: list.name, rows: eligible.length, excluded: rows.length - eligible.length }, meta });
      return { csv, name: list.name, rows: eligible.length, excluded: rows.length - eligible.length };
    });
  }

  // ───── Providers and allowance ─────

  private async settingsRow(tx: TenantTx, tenantId: string) {
    return tx.prospectSettings.findUnique({ where: { tenantId } });
  }

  private limitFor(s: { dailyLimit: number; userLimits: unknown } | null, userId: string): number {
    const overrides = (s?.userLimits ?? {}) as Record<string, number>;
    return overrides[userId] ?? s?.dailyLimit ?? this.env.PROSPECT_DAILY_LIMIT;
  }

  private async usageOf(tx: TenantTx, tenantId: string, userId: string): Promise<number> {
    const r = await tx.providerUsage.aggregate({ where: { tenantId, userId, createdAt: { gt: new Date(Date.now() - DAY) } }, _sum: { units: true } });
    return r._sum.units ?? 0;
  }

  usage(auth: AuthContext): Promise<ProspectUsage> {
    return this.prisma.run(auth, async (tx) => ({ used: await this.usageOf(tx, auth.tenantId, auth.userId), limit: this.limitFor(await this.settingsRow(tx, auth.tenantId), auth.userId) }));
  }

  /** Reserves allowance before a provider call. Mock Mode calls count too, so limits behave the same before a key is added. */
  private async spend(auth: AuthContext, provider: 'apollo' | 'hunter', kind: string, units: number, live: boolean): Promise<ProspectUsage> {
    return this.prisma.run(auth, async (tx) => {
      const limit = this.limitFor(await this.settingsRow(tx, auth.tenantId), auth.userId);
      const used = await this.usageOf(tx, auth.tenantId, auth.userId);
      if (used + units > limit) {
        throw new HttpException({ code: 'USAGE_LIMIT', message: units === 1 ? `That needs 1 provider call and you have ${Math.max(0, limit - used)} of ${limit} left in the last 24 hours. Ask an admin to raise your limit.` : `That needs ${units} provider calls and you have ${Math.max(0, limit - used)} of ${limit} left in the last 24 hours. Ask an admin to raise your limit.` }, HttpStatus.TOO_MANY_REQUESTS);
      }
      await tx.providerUsage.create({ data: { tenantId: auth.tenantId, userId: auth.userId, provider, kind, units, live } });
      return { used: used + units, limit };
    });
  }

  private async markLive(auth: AuthContext, provider: 'apollo' | 'hunter') {
    await this.prisma.run(auth, (tx) =>
      tx.prospectSettings.upsert({
        where: { tenantId: auth.tenantId },
        create: { tenantId: auth.tenantId, dailyLimit: this.env.PROSPECT_DAILY_LIMIT, ...(provider === 'apollo' ? { apolloLiveAt: new Date() } : { hunterLiveAt: new Date() }) },
        update: provider === 'apollo' ? { apolloLiveAt: new Date() } : { hunterLiveAt: new Date() },
      }),
    );
  }

  private providers(s: { apolloLiveAt: Date | null; hunterLiveAt: Date | null } | null, apolloCheck: StoredCheck | null = null): ProspectProviderStatus {
    const mode = (configured: boolean, liveAt: Date | null | undefined) => (!configured ? 'mock' : liveAt ? 'live' : 'pending') as 'mock' | 'live' | 'pending';
    // A successful people search from the operator console's provider check proves the same call works here too.
    const checked = apolloCheck?.ok ? new Date(apolloCheck.at) : null;
    const apolloLiveAt = [s?.apolloLiveAt, checked].filter((d): d is Date => !!d).sort((x, y) => y.getTime() - x.getTime())[0] ?? null;
    const a = mode(this.apollo.configured, apolloLiveAt);
    const h = mode(this.hunter.configured, s?.hunterLiveAt);
    return {
      apollo: {
        mode: a,
        detail: a === 'mock' ? 'Mock Mode: no APOLLO_API_KEY is set, so searches return labelled sample people on .example domains. They cannot be added to the CRM, enrolled or exported.' : a === 'pending' ? 'Pending Configuration: a key is set but no Apollo call has succeeded in this workspace yet.' : `Connected: last successful call ${apolloLiveAt!.toISOString().slice(0, 10)}.`,
      },
      hunter: {
        mode: h === 'mock' ? 'pending' : h,
        detail: h === 'mock' ? 'Pending Configuration: email verification needs HUNTER_API_KEY. Without it, statuses come only from Apollo or from bounces.' : h === 'pending' ? 'Pending Configuration: a key is set but no Hunter call has succeeded in this workspace yet.' : `Connected: last successful call ${s!.hunterLiveAt!.toISOString().slice(0, 10)}.`,
      },
    };
  }

  settings(auth: AuthContext): Promise<ProspectSettings> {
    return this.prisma.run(auth, async (tx) => {
      const s = await this.settingsRow(tx, auth.tenantId);
      const canManage = auth.permissions.includes('prospects:manage');
      let members: ProspectSettings['members'] = [];
      if (canManage) {
        const m = await tx.membership.findMany({ where: { tenantId: auth.tenantId, status: 'ACTIVE' }, select: { userId: true, user: { select: { name: true } } }, orderBy: { user: { name: 'asc' } } });
        const used = await tx.providerUsage.groupBy({ by: ['userId'], where: { tenantId: auth.tenantId, createdAt: { gt: new Date(Date.now() - DAY) } }, _sum: { units: true } });
        const byUser = new Map(used.map((u) => [u.userId, u._sum.units ?? 0]));
        members = m.map((x) => ({ id: x.userId, name: x.user.name, used: byUser.get(x.userId) ?? 0, limit: this.limitFor(s, x.userId) }));
      }
      return { dailyLimit: s?.dailyLimit ?? this.env.PROSPECT_DAILY_LIMIT, userLimits: (s?.userLimits ?? {}) as Record<string, number>, providers: this.providers(s, currentCheck(readProviderCheck((await tx.platformSetting.findUnique({ where: { key: `${PROVIDER_CHECK_PREFIX}apollo` } }))?.value), this.env.APOLLO_API_KEY)), members };
    });
  }

  async saveSettings(auth: AuthContext, input: ProspectSettingsInput, meta: RequestMeta): Promise<ProspectSettings> {
    await this.prisma.run(auth, async (tx) => {
      const before = await this.settingsRow(tx, auth.tenantId);
      await tx.prospectSettings.upsert({
        where: { tenantId: auth.tenantId },
        create: { tenantId: auth.tenantId, dailyLimit: input.dailyLimit, userLimits: input.userLimits, updatedById: auth.userId },
        update: { dailyLimit: input.dailyLimit, userLimits: input.userLimits, updatedById: auth.userId, updatedAt: new Date() },
      });
      await this.audit.record(tx, {
        tenantId: auth.tenantId, actorUserId: auth.userId, action: 'prospect_settings.updated', entityType: 'tenant', entityId: auth.tenantId,
        metadata: { before: before ? { dailyLimit: before.dailyLimit, userLimits: before.userLimits } : null, after: input }, meta,
      });
    });
    return this.settings(auth);
  }

  async search(auth: AuthContext, input: ProviderSearchInput): Promise<ProviderSearchResult> {
    const live = this.apollo.configured;
    const usage = await this.spend(auth, 'apollo', 'search', 1, live);
    if (!live) {
      const r = sampleSearch(input);
      return { provider: 'apollo', mode: 'mock', ...r, page: input.page, usage, notice: 'Mock Mode: these are sample people on .example domains, not real contacts. Add an Apollo.io key to search real data.' };
    }
    try {
      const r = await this.apollo.search(input);
      await this.markLive(auth, 'apollo');
      return { provider: 'apollo', mode: 'live', ...r, page: input.page, usage, notice: r.people.length ? 'Apollo does not return email addresses in search. Choose "Find email addresses" when adding people; it uses credits.' : null };
    } catch (e) {
      throw new BadGatewayException({ code: 'PROVIDER_ERROR', message: e instanceof ProviderError ? e.message : 'Apollo could not be reached. Try again later.' });
    }
  }

  /** Finds email addresses for provider people that have none: Apollo for real people, a .example address for samples. */
  private async reveal(auth: AuthContext, input: ProviderPerson[], revealEmails: boolean): Promise<{ people: ProviderPerson[]; revealed: number }> {
    const people = input.map((p) => ({ ...p }));
    let revealed = 0;
    const need = people.filter((p) => !p.email);
    if (!revealEmails || !need.length) return { people, revealed };
    if (!auth.permissions.includes('prospects:search')) throw forbid('Your role does not allow provider lookups.');
    const samples = need.filter((p) => p.sample);
    const real = need.filter((p) => !p.sample);
    if (real.length && !this.apollo.configured) throw new ConflictException({ code: 'PENDING_CONFIGURATION', message: 'Revealing email addresses needs an Apollo.io key (APOLLO_API_KEY).' });
    await this.spend(auth, 'apollo', 'reveal', need.length, real.length > 0);
    for (const p of samples) {
      p.email = sampleEmail(p);
      // Nothing was checked: a sample address has no status.
      p.emailStatus = null;
      revealed++;
    }
    if (real.length) {
      try {
        const found = await this.apollo.reveal(real.map((p) => p.providerId));
        await this.markLive(auth, 'apollo');
        for (const p of real) {
          const f = found.get(p.providerId);
          if (f) {
            p.email = f.email;
            p.emailStatus = f.emailStatus;
            revealed++;
          }
        }
      } catch (e) {
        throw new BadGatewayException({ code: 'PROVIDER_ERROR', message: e instanceof ProviderError ? e.message : 'Apollo could not be reached. Try again later.' });
      }
    }
    return { people, revealed };
  }

  private toNew(p: ProviderPerson): NewProspect {
    return {
      fullName: p.fullName, firstName: p.firstName ?? undefined, lastName: p.lastName ?? undefined, email: p.email ?? undefined, emailStatus: p.emailStatus,
      title: p.title ?? undefined, companyName: p.companyName ?? undefined, domain: p.domain ?? undefined, industry: p.industry ?? undefined,
      country: p.country ?? undefined, companySize: p.companySize ?? undefined, source: p.sample ? 'sample' : 'apollo', sourceRef: p.providerId, sample: p.sample,
    };
  }

  /** Adds provider results to a list, optionally revealing their email addresses first. */
  async addFromProvider(
    auth: AuthContext,
    listId: string,
    input: { people: ProviderPerson[]; revealEmails: boolean },
    meta: RequestMeta,
    via: 'provider' | 'extension' = 'provider',
  ): Promise<ProspectAddResult & { revealed: number; people: ProviderPerson[]; outcomes: ('added' | 'duplicate')[] }> {
    await this.prisma.run(auth, (tx) => this.findList(tx, auth.tenantId, listId));
    const { people, revealed } = await this.reveal(auth, input.people, input.revealEmails);
    return this.prisma.run(auth, async (tx) => {
      const outcomes: ('added' | 'duplicate')[] = [];
      const r = await this.addMany(tx, auth, listId, people.map((p) => this.toNew(p)), outcomes);
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'prospects.added', entityType: 'prospect_list', entityId: listId, metadata: { source: via, revealed, ...r }, meta });
      return { ...r, invalid: [], revealed, people, outcomes };
    });
  }

  // ───── From the browser extension (Part 2: prospect discovery on a company website) ─────

  /** People at the company whose website is open, from Apollo (or sample people in Mock Mode). */
  discover(auth: AuthContext, input: { domain: string; titles: string[]; page: number }): Promise<ProviderSearchResult> {
    const domain = input.domain.replace(/^www\./, '');
    return this.search(auth, { domains: [domain], titles: input.titles.filter(Boolean), countries: [], sizes: [], page: input.page });
  }

  async extensionImport(auth: AuthContext, raw: ExtensionProspectImport, meta: RequestMeta): Promise<ExtensionProspectImportResult> {
    // Mock Mode people stay marked sample whatever the caller says, so they can never reach the CRM.
    const input = { ...raw, people: raw.people.map((p) => ({ ...p, sample: p.sample || p.providerId.startsWith('sample_') || isSampleEmail(p.email) || !!p.domain?.endsWith(SAMPLE_DOMAIN_SUFFIX) })) };
    const d = input.destination;
    if (d.type === 'crm') return this.extensionToCrm(auth, input, d.sequenceId, meta);
    if (!auth.permissions.includes('prospects:write')) throw forbid('Your role does not allow saving prospects.');
    let list: { id: string; name: string };
    if (d.type === 'list') {
      list = await this.prisma.run(auth, (tx) => this.findList(tx, auth.tenantId, d.listId));
    } else {
      const same = await this.prisma.run(auth, (tx) => tx.prospectList.findFirst({ where: { tenantId: auth.tenantId, name: { equals: d.name, mode: 'insensitive' } }, select: { id: true, name: true } }));
      list = same ?? (await this.createList(auth, { name: d.name, description: `Saved from the browser extension (${hostOf(input.sourceUrl)}).` }, meta));
    }
    const r = await this.addFromProvider(auth, list.id, { people: input.people, revealEmails: input.revealEmails }, meta, 'extension');
    return {
      destination: { type: 'list', id: list.id, name: list.name },
      results: r.people.map((p, i) => ({
        providerId: p.providerId, name: p.fullName, email: p.email,
        outcome: r.outcomes[i] === 'duplicate' ? 'duplicate' : 'added',
        ...(r.outcomes[i] === 'duplicate' ? { reason: 'Already in this list.' } : !p.email ? { reason: 'Saved without an email address.' } : {}),
      })),
      usage: await this.usage(auth),
    };
  }

  /** Straight into the CRM as leads (through the extension's capture, so duplicates, workflows and enrolment rules apply). */
  private async extensionToCrm(auth: AuthContext, input: ExtensionProspectImport, sequenceId: string | undefined, meta: RequestMeta): Promise<ExtensionProspectImportResult> {
    if (!auth.permissions.includes('leads:write')) throw forbid('Your role does not allow adding leads.');
    if (sequenceId) await this.checkSequence(auth, sequenceId);
    const results: ExtensionProspectImportResult['results'] = [];
    const real = input.people.filter((p) => {
      if (!p.sample) return true;
      results.push({ providerId: p.providerId, name: p.fullName, email: null, outcome: 'skipped', reason: 'Sample data from Mock Mode cannot be added to the CRM.' });
      return false;
    });
    const { people } = await this.reveal(auth, real, input.revealEmails);
    const withEmail = people.filter((p) => {
      if (p.email) return true;
      results.push({ providerId: p.providerId, name: p.fullName, email: null, outcome: 'skipped', reason: 'No email address was found, so it was not added as a lead. Save it to a prospect list instead.' });
      return false;
    });
    let enrollment: ExtensionProspectImportResult['enrollment'];
    if (withEmail.length) {
      const captured = await this.extension.capture(
        auth,
        {
          people: withEmail.map((p) => ({ email: p.email!, fullName: p.fullName, jobTitle: p.title ?? undefined })),
          companyName: withEmail[0]!.companyName ?? undefined,
          website: withEmail[0]!.domain ?? undefined,
          sourceUrl: input.sourceUrl,
          sequenceId,
          auto: false,
        },
        meta,
        { source: 'Prospect discovery', tag: 'prospect-discovery', action: 'extension.prospects_imported' },
      );
      const byEmail = new Map(withEmail.map((p) => [p.email!.toLowerCase(), p]));
      for (const c of captured.results) {
        const p = byEmail.get(c.email.toLowerCase())!;
        if (c.outcome === 'created' && c.match && p.emailStatus) {
          await this.prisma.run(auth, (tx) => tx.lead.update({ where: { id: c.match!.id }, data: { emailStatus: p.emailStatus } }));
        }
        results.push({
          providerId: p.providerId, name: p.fullName, email: p.email,
          outcome: c.outcome === 'created' ? 'added' : c.outcome === 'existing' ? 'existing' : 'skipped',
          ...(c.outcome === 'existing' ? { reason: `Already in SampForce as ${c.match?.entity === 'contact' ? 'a contact' : 'a lead'}.` } : {}),
        });
      }
      if (captured.enrollment) {
        enrollment = { enrolled: captured.enrollment.enrolled, skipped: captured.enrollment.skipped };
      }
    }
    const order = new Map(input.people.map((p, i) => [p.providerId, i]));
    results.sort((a, b) => order.get(a.providerId)! - order.get(b.providerId)!);
    return { destination: { type: 'crm' }, results, ...(enrollment ? { enrollment } : {}), usage: await this.usage(auth) };
  }

  /** Checks addresses with Hunter.io's Email Verifier. Never guesses a status without the provider. */
  async verify(auth: AuthContext, ids: string[]): Promise<{ checked: number; skipped: number; results: { prospectId: string; status: EmailStatus }[] }> {
    if (!this.hunter.configured) throw new ConflictException({ code: 'PENDING_CONFIGURATION', message: 'Email verification is Pending Configuration: it needs a Hunter.io key (HUNTER_API_KEY).' });
    const rows = (await this.prisma.run(auth, (tx) => this.owned(tx, auth.tenantId, ids))).slice(0, 50);
    const todo = rows.filter((r) => r.email && !r.sample);
    if (!todo.length) return { checked: 0, skipped: rows.length, results: [] };
    await this.spend(auth, 'hunter', 'verify', todo.length, true);
    const results: { prospectId: string; status: EmailStatus }[] = [];
    let ok = false;
    for (const r of todo) {
      try {
        const status = await this.hunter.verify(r.email!);
        ok = true;
        results.push({ prospectId: r.id, status });
        await this.prisma.run(auth, (tx) => tx.prospect.update({ where: { id: r.id }, data: { emailStatus: status, emailCheckedAt: new Date() } }));
      } catch {
        // Leave the status as it was; the person can try again.
      }
    }
    if (ok) await this.markLive(auth, 'hunter');
    if (!ok) throw new BadGatewayException({ code: 'PROVIDER_ERROR', message: 'Hunter could not verify those addresses. Try again later.' });
    return { checked: results.length, skipped: rows.length - results.length, results };
  }

  /** Worker: forgets parsed uploads nobody finished mapping. */
  private lastSweep = 0;

  async sweep(): Promise<number> {
    if (Date.now() - this.lastSweep < 3_600_000) return 0;
    this.lastSweep = Date.now();
    const tenants = (await scanTenants(this.prisma.prospectImport, { createdAt: { lt: new Date(Date.now() - DAY) } }, 5000)).map((tenant_id) => ({ tenant_id }));
    let n = 0;
    for (const t of tenants) {
      const { count } = await this.prisma.run({ tenantId: t.tenant_id }, (tx) => tx.prospectImport.deleteMany({ where: { tenantId: t.tenant_id, createdAt: { lt: new Date(Date.now() - DAY) } } }));
      n += count;
    }
    return n;
  }
}

async function readXlsx(data: Buffer): Promise<string[][]> {
  try {
    assertSafeZip(data);
  } catch (e) {
    if (e instanceof UnsafeZipError) throw new BadRequestException({ code: 'INVALID_FILE', message: `That spreadsheet could not be read safely (${e.message}). Save it again as .xlsx or export it as CSV.` });
    throw e;
  }
  const wb = new Workbook();
  await wb.xlsx.load(data as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const out: string[][] = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    if (out.length > MAX_PROSPECT_IMPORT_ROWS + 1) return;
    const cells: string[] = [];
    for (let c = 1; c <= Math.min(row.cellCount, 60); c++) cells.push(row.getCell(c).text ?? '');
    out.push(cells);
  });
  return out;
}
