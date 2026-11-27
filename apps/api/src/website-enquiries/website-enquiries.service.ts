import { BadRequestException, ForbiddenException, Inject, Injectable, Logger, NotFoundException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { type Prisma, type TenantTx, type WebsiteEnquiry } from '@dealflow/database';
import {
  companyInputSchema,
  companyNameKey,
  contactInputSchema,
  domainKey,
  ENQUIRY_CATEGORIES,
  ENQUIRY_CATEGORY_LABELS,
  ENQUIRY_STATUS_LABELS,
  ENQUIRY_STATUSES,
  ENQUIRY_TYPE_LABELS,
  ENQUIRY_TYPES,
  type EnquiryConvertInput,
  type EnquiryConvertResult,
  type EnquiryCount,
  type EnquiryDetail,
  type EnquiryListQuery,
  type EnquiryPage,
  type EnquiryRecord,
  type EnquiryRow,
  type EnquirySummary,
  type EnquiryUpdateInput,
  FREE_MAIL_DOMAINS,
  knownCategory,
  knownStatus,
  knownType,
  websiteDeliverySchema,
} from '@dealflow/types';
import { AuditService } from '../audit/audit.service';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { API_ENV, type ApiEnv } from '../common/env';
import { PrismaService } from '../common/prisma.service';
import { WebhookReceipts } from '../common/webhook-receipts';
import { assertRefs } from '../crm/crm-helpers';
import { CompaniesService } from '../crm/companies.service';
import { ContactsService } from '../crm/contacts.service';
import { companyScope, contactScope, personRefs, visibility } from '../crm/visibility';
import { NotificationsService } from '../notifications/notifications.service';
import { countryCodeOf, type EnquiryData, mapWebsiteRecord, splitName } from './mapping';
import { verifySignature } from './website-api';

const DAY = 86_400_000;
const notFound = () => new NotFoundException({ code: 'NOT_FOUND', message: 'Website enquiry not found.' });

/** Which record each webhook event carries. */
const EVENT_RECORD: Record<string, EnquiryRecord> = {
  'lead.created': 'lead',
  'lead.updated': 'lead',
  'careers.created': 'lead',
  'newsletter.subscribed': 'contact',
  'review.created': 'review',
};

export interface IngestOutcome {
  id: string;
  created: boolean;
}

/**
 * Website Enquiry (ADR 0095): receives the company website's enquiries, downloads, chat leads, newsletter sign-ups
 * and reviews (webhook and pull both land in `ingest`), and serves the section's pages: counts, the list, one
 * enquiry, its status (sent back to the website by WebsiteEnquirySync) and conversion into a company and employee.
 */
@Injectable()
export class WebsiteEnquiriesService {
  private readonly log = new Logger(WebsiteEnquiriesService.name);
  private tenantCache: { slug: string; id: string | null; at: number } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly receipts: WebhookReceipts,
    private readonly companies: CompaniesService,
    private readonly contacts: ContactsService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  // ───────────── the receiving workspace ─────────────

  /** The workspace the Console named to receive the website's enquiries, or null when none (or it does not exist). */
  async receivingTenant(): Promise<string | null> {
    const slug = this.env.WEBSITE_ENQUIRY_WORKSPACE?.trim().toLowerCase();
    if (!slug) return null;
    if (this.tenantCache && this.tenantCache.slug === slug && Date.now() - this.tenantCache.at < 30_000) return this.tenantCache.id;
    const row = await this.prisma.run({ workerScan: true }, (tx) => tx.tenant.findFirst({ where: { slug }, select: { id: true } }));
    this.tenantCache = { slug, id: row?.id ?? null, at: Date.now() };
    return row?.id ?? null;
  }

  private async isReceiving(tenantId: string): Promise<boolean> {
    return (await this.receivingTenant()) === tenantId;
  }

  // ───────────── receiving ─────────────

  /**
   * Upserts one record the website sent, by (workspace, record, website id). The website's fields are refreshed; the
   * SampForce side (opened, star, owner, stage, conversion) is never touched. The website's lead status is adopted
   * when the website changed it and SampForce has no change of its own waiting to be sent.
   */
  async ingest(tenantId: string, record: EnquiryRecord, payload: unknown, source: 'webhook' | 'pull', opts: { notify: boolean }): Promise<IngestOutcome | null> {
    const d = mapWebsiteRecord(record, payload);
    if (!d) return null;
    return this.prisma.run({ tenantId }, async (tx) => {
      const before = await tx.websiteEnquiry.findUnique({ where: { tenantId_record_externalId: { tenantId, record, externalId: d.externalId } } });
      // An older copy (a slow retry, a page from before a change) never overwrites a newer one.
      if (before && before.websiteUpdatedAt > d.websiteUpdatedAt) return { id: before.id, created: false };
      const site = websiteColumns(d);
      if (before) {
        const adopt = d.leadStatus !== null && !before.writeBackAt && d.websiteStatus !== before.websiteStatus;
        await tx.websiteEnquiry.update({ where: { id: before.id }, data: { ...site, ...(adopt ? { status: d.leadStatus! } : {}), lastSyncedAt: new Date() } });
        return { id: before.id, created: false };
      }
      const row = await tx.websiteEnquiry.create({
        data: { tenantId, ...site, record, externalId: d.externalId, status: d.leadStatus ?? 'new', source, backfill: d.backfill },
      });
      if (opts.notify && !d.backfill) await this.notifyNew(tx, tenantId, row);
      return { id: row.id, created: true };
    });
  }

  private async notifyNew(tx: TenantTx, tenantId: string, row: WebsiteEnquiry): Promise<void> {
    const name = row.name || row.email || row.company || 'someone';
    const title =
      row.record === 'review' ? `New review from ${name}` : row.record === 'contact' ? `New newsletter sign-up from ${name}` : row.type === 'chat' ? `New live chat lead from ${name}` : row.type.includes('download') ? `New download from ${name}` : `New website enquiry from ${name}`;
    const body = [row.formName, row.company, row.service].filter(Boolean).join(' · ') || null;
    await this.notifications.send(tx, tenantId, await this.notifications.usersWithPermission(tx, tenantId, 'enquiries:write'), {
      type: `website_enquiry.${row.record === 'lead' ? 'received' : row.record === 'review' ? 'review' : 'signup'}`,
      title,
      body,
      link: `/app/website-enquiries?open=${row.id}`,
      eventId: `website_enquiry:${row.id}`,
      priority: row.category === 'rfq' ? 'HIGH' : null,
      actionRequired: row.record === 'lead',
    });
  }

  /**
   * The website's signed webhook (POST /hooks/website-enquiries). The raw body is checked against the signing secret
   * before anything is read; deliveries arrive again after a timeout, and the upsert by the website's id makes a
   * repeat harmless. Answered quickly: the website retries anything that is not 2xx.
   */
  async handleWebhook(raw: Buffer | undefined, headers: Record<string, string | string[] | undefined>): Promise<{ ok: true; received: boolean }> {
    const secret = this.env.WEBSITE_WEBHOOK_SECRET;
    if (!secret) throw new ServiceUnavailableException({ code: 'PENDING_CONFIGURATION', message: 'Website enquiries are not set up on this server yet.' });
    const header = headers['x-sampforce-signature'];
    const check = verifySignature(secret, Array.isArray(header) ? header[0] : header, raw ?? Buffer.alloc(0));
    if (!raw || !check.ok) {
      await this.receipts.rejected('website', check.ok ? 'The delivery had no body.' : check.reason);
      throw new UnauthorizedException({ code: 'BAD_SIGNATURE', message: 'Signature check failed.' });
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.toString('utf8'));
    } catch {
      throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'The body is not JSON.' });
    }
    const evt = websiteDeliverySchema.safeParse(parsed);
    if (!evt.success) throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Not a website delivery.' });
    await this.receipts.verified('website', evt.data.event);
    if (evt.data.event === 'ping') return { ok: true, received: false };
    const record = EVENT_RECORD[evt.data.event];
    // An event this release does not know (the website added one): accepted, so the website does not retry it forever.
    if (!record) return { ok: true, received: false };
    const tenantId = await this.receivingTenant();
    // 503 makes the website try again later (for up to 12 hours), so nothing is lost while the Console is being set up.
    if (!tenantId) throw new ServiceUnavailableException({ code: 'PENDING_CONFIGURATION', message: 'No workspace receives website enquiries yet. Set one in the Console under Providers > Website enquiries.' });
    const out = await this.ingest(tenantId, record, evt.data.data, 'webhook', { notify: true });
    if (!out) throw new BadRequestException({ code: 'VALIDATION_FAILED', message: `The ${record} in this delivery has no id or date.` });
    return { ok: true, received: true };
  }

  // ───────────── reading ─────────────

  async summary(auth: AuthContext, sync: EnquirySummary['sync']): Promise<EnquirySummary> {
    const connected = await this.isReceiving(auth.tenantId);
    return this.prisma.run(auth, async (tx) => {
      const tenantId = auth.tenantId;
      const where = { tenantId };
      const unreadWhere = { tenantId, seenAt: null };
      const now = Date.now();
      const startOfDay = new Date(new Date().toISOString().slice(0, 10));
      const [total, unread, today, week, converted, leads, byType, byTypeUnread, byCategory, byCategoryUnread, byStatus, byForm, byFormUnread, recent, latest, ratings] = await Promise.all([
        tx.websiteEnquiry.count({ where }),
        tx.websiteEnquiry.count({ where: unreadWhere }),
        tx.websiteEnquiry.count({ where: { tenantId, submittedAt: { gte: startOfDay } } }),
        tx.websiteEnquiry.count({ where: { tenantId, submittedAt: { gte: new Date(now - 7 * DAY) } } }),
        tx.websiteEnquiry.count({ where: { tenantId, OR: [{ companyId: { not: null } }, { contactId: { not: null } }] } }),
        tx.websiteEnquiry.count({ where: { tenantId, record: 'lead' } }),
        tx.websiteEnquiry.groupBy({ by: ['type'], where, _count: { _all: true } }),
        tx.websiteEnquiry.groupBy({ by: ['type'], where: unreadWhere, _count: { _all: true } }),
        tx.websiteEnquiry.groupBy({ by: ['category'], where, _count: { _all: true } }),
        tx.websiteEnquiry.groupBy({ by: ['category'], where: unreadWhere, _count: { _all: true } }),
        tx.websiteEnquiry.groupBy({ by: ['status'], where, _count: { _all: true } }),
        tx.websiteEnquiry.groupBy({ by: ['formName'], where, _count: { _all: true } }),
        tx.websiteEnquiry.groupBy({ by: ['formName'], where: unreadWhere, _count: { _all: true } }),
        tx.websiteEnquiry.findMany({ where: { tenantId, submittedAt: { gte: new Date(now - 14 * DAY) } }, select: { submittedAt: true }, take: 20_000 }),
        tx.websiteEnquiry.findMany({ where: unreadWhere, orderBy: { submittedAt: 'desc' }, take: 6 }),
        tx.websiteEnquiry.aggregate({ where: { tenantId, record: 'review', rating: { not: null } }, _avg: { rating: true } }),
      ]);
      const counts = <K extends string>(keys: readonly K[], labels: Record<K, string>, all: { _count: { _all: number } }[], fresh: { _count: { _all: number } }[], keyOf: (r: never) => string): EnquiryCount<K>[] => {
        const total = new Map(all.map((r) => [keyOf(r as never), r._count._all]));
        const unseen = new Map(fresh.map((r) => [keyOf(r as never), r._count._all]));
        return keys.map((k) => ({ key: k, label: labels[k], count: total.get(k) ?? 0, unread: unseen.get(k) ?? 0 }));
      };
      const days: { day: string; count: number }[] = [];
      for (let i = 13; i >= 0; i--) days.push({ day: new Date(startOfDay.getTime() - i * DAY).toISOString().slice(0, 10), count: 0 });
      const index = new Map(days.map((d, i) => [d.day, i]));
      for (const r of recent) {
        const i = index.get(r.submittedAt.toISOString().slice(0, 10));
        if (i !== undefined) days[i]!.count++;
      }
      const formUnread = new Map(byFormUnread.map((r) => [r.formName ?? '', r._count._all]));
      return {
        connected,
        total,
        unread,
        today,
        week,
        converted,
        conversionRate: leads ? Math.round((converted / Math.max(leads, converted)) * 100) : null,
        byType: counts(ENQUIRY_TYPES, ENQUIRY_TYPE_LABELS, byType, byTypeUnread, (r: { type: string }) => r.type).filter((c) => c.count > 0 || c.key !== 'careers'),
        byCategory: counts(ENQUIRY_CATEGORIES, ENQUIRY_CATEGORY_LABELS, byCategory, byCategoryUnread, (r: { category: string }) => r.category),
        byStatus: counts(ENQUIRY_STATUSES, ENQUIRY_STATUS_LABELS, byStatus, [], (r: { status: string }) => r.status),
        byForm: byForm
          .map((r) => ({ key: r.formName ?? '', label: r.formName ?? 'Form not named', count: r._count._all, unread: formUnread.get(r.formName ?? '') ?? 0 }))
          .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
          .slice(0, 12),
        daily: days,
        latest: await this.rows(tx, tenantId, latest),
        averageRating: ratings._avg.rating === null ? null : Math.round(ratings._avg.rating * 10) / 10,
        sync,
      };
    });
  }

  private listWhere(tenantId: string, q: EnquiryListQuery): Prisma.WebsiteEnquiryWhereInput {
    const and: Prisma.WebsiteEnquiryWhereInput[] = [{ tenantId }];
    if (q.view === 'unread') and.push({ seenAt: null });
    if (q.view === 'starred') and.push({ starred: true });
    if (q.view === 'converted') and.push({ OR: [{ companyId: { not: null } }, { contactId: { not: null } }] });
    if (q.view === 'open') and.push({ companyId: null, contactId: null, status: { notIn: ['won', 'lost', 'spam'] } });
    if (q.status?.length) and.push({ status: { in: q.status } });
    if (q.type?.length) and.push({ type: { in: q.type } });
    if (q.category?.length) and.push({ category: { in: q.category } });
    if (q.form) and.push({ formName: q.form });
    if (q.since) and.push({ submittedAt: { gte: new Date(q.since) } });
    if (q.q) and.push({ searchText: { contains: q.q.toLowerCase() } });
    return { AND: and };
  }

  list(auth: AuthContext, q: EnquiryListQuery): Promise<EnquiryPage> {
    return this.prisma.run(auth, async (tx) => {
      const where = this.listWhere(auth.tenantId, q);
      const [rows, total] = await Promise.all([
        tx.websiteEnquiry.findMany({ where, orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }], skip: q.offset, take: q.limit }),
        tx.websiteEnquiry.count({ where }),
      ]);
      return { items: await this.rows(tx, auth.tenantId, rows), total };
    });
  }

  /** Enquiries that became, or were linked to, this employee or company (the cards on their pages). */
  forRecord(auth: AuthContext, ref: { contactId?: string; companyId?: string }): Promise<EnquiryRow[]> {
    return this.prisma.run(auth, async (tx) => {
      const or: Prisma.WebsiteEnquiryWhereInput[] = [];
      if (ref.contactId) {
        or.push({ contactId: ref.contactId });
        const c = await tx.contact.findFirst({ where: { id: ref.contactId, tenantId: auth.tenantId, deletedAt: null }, select: { email: true } });
        if (c?.email) or.push({ email: c.email.toLowerCase() });
      }
      if (ref.companyId) or.push({ companyId: ref.companyId });
      if (!or.length) return [];
      const rows = await tx.websiteEnquiry.findMany({ where: { tenantId: auth.tenantId, OR: or }, orderBy: { submittedAt: 'desc' }, take: 20 });
      return this.rows(tx, auth.tenantId, rows);
    });
  }

  private async rows(tx: TenantTx, tenantId: string, rows: WebsiteEnquiry[]): Promise<EnquiryRow[]> {
    const people = await personRefs(tx, tenantId, rows.map((r) => r.assigneeId));
    const companyIds = [...new Set(rows.map((r) => r.companyId).filter((x): x is string => !!x))];
    const contactIds = [...new Set(rows.map((r) => r.contactId).filter((x): x is string => !!x))];
    const [companies, contacts] = await Promise.all([
      companyIds.length ? tx.company.findMany({ where: { tenantId, id: { in: companyIds }, deletedAt: null }, select: { id: true, name: true } }) : [],
      contactIds.length ? tx.contact.findMany({ where: { tenantId, id: { in: contactIds }, deletedAt: null }, select: { id: true, firstName: true, lastName: true } }) : [],
    ]);
    const companyById = new Map(companies.map((c) => [c.id, { id: c.id, name: c.name }]));
    const contactById = new Map(contacts.map((c) => [c.id, { id: c.id, name: [c.firstName, c.lastName].filter(Boolean).join(' ') }]));
    return rows.map((r) => {
      const company = r.companyId ? (companyById.get(r.companyId) ?? null) : null;
      const contact = r.contactId ? (contactById.get(r.contactId) ?? null) : null;
      const a = r.assigneeId ? people.get(r.assigneeId) : null;
      return {
        id: r.id,
        record: r.record as EnquiryRecord,
        externalId: r.externalId,
        type: knownType(r.type),
        category: knownCategory(r.category),
        status: knownStatus(r.status),
        websiteStatus: r.websiteStatus,
        form: { key: r.formKey, name: r.formName },
        name: r.name,
        email: r.email,
        phone: r.phone,
        country: r.country,
        countryCode: countryCodeOf(r.country),
        company: r.company,
        designation: r.designation,
        service: r.service,
        message: r.message ? r.message.slice(0, 280) : null,
        resource: r.resource,
        rating: r.rating,
        submittedAt: r.submittedAt.toISOString(),
        receivedAt: r.receivedAt.toISOString(),
        source: r.source === 'pull' ? 'pull' : 'webhook',
        unread: !r.seenAt,
        starred: r.starred,
        assignee: a ? { id: a.id, name: a.name } : null,
        stage: r.stage,
        converted: company || contact ? { company, contact } : null,
      };
    });
  }

  private async load(tx: TenantTx, tenantId: string, id: string): Promise<WebsiteEnquiry> {
    const row = await tx.websiteEnquiry.findFirst({ where: { id, tenantId } });
    if (!row) throw notFound();
    return row;
  }

  private async detailIn(tx: TenantTx, auth: AuthContext, row: WebsiteEnquiry): Promise<EnquiryDetail> {
    const [base] = await this.rows(tx, auth.tenantId, [row]);
    const seenBy = row.seenById ? (await personRefs(tx, auth.tenantId, [row.seenById])).get(row.seenById) : null;
    const fields = row.fields && typeof row.fields === 'object' && !Array.isArray(row.fields) ? Object.entries(row.fields as Record<string, unknown>).map(([label, value]) => ({ label, value: String(value) })) : [];
    return {
      ...base!,
      message: row.message,
      timeline: row.timeline,
      page: row.page,
      consent: row.consent,
      subscribed: row.subscribed,
      fields,
      websiteOwner: row.websiteOwner,
      websiteNote: row.websiteNote,
      note: row.note,
      websiteUpdatedAt: row.websiteUpdatedAt.toISOString(),
      lastSyncedAt: row.lastSyncedAt.toISOString(),
      seen: row.seenAt ? { at: row.seenAt.toISOString(), by: seenBy?.name ?? null } : null,
      convertedAt: row.convertedAt?.toISOString() ?? null,
      writeBack: row.record !== 'lead' ? { state: 'none', at: null, error: null }
        : row.writeBackAt ? { state: 'waiting', at: row.writeBackAt.toISOString(), error: row.writeBackError }
          : row.writeBackError ? { state: 'failed', at: row.writtenBackAt?.toISOString() ?? null, error: row.writeBackError }
            : row.writtenBackAt ? { state: 'sent', at: row.writtenBackAt.toISOString(), error: null } : { state: 'none', at: null, error: null },
      matches: await this.matches(tx, auth, row),
    };
  }

  /** An employee with the enquiry's email, and a company by name or (work) email domain, that the caller can see. */
  private async matches(tx: TenantTx, auth: AuthContext, row: Pick<WebsiteEnquiry, 'email' | 'company'>): Promise<EnquiryDetail['matches']> {
    const v = await visibility(tx, auth);
    const email = row.email?.toLowerCase() ?? null;
    const contact = email
      ? await tx.contact.findFirst({ where: { tenantId: auth.tenantId, deletedAt: null, ...contactScope(v), OR: [{ matchKeys: { has: `e:${email}` } }, { email: { equals: email, mode: 'insensitive' } }] }, select: { id: true, firstName: true, lastName: true, companyId: true }, orderBy: { createdAt: 'asc' } })
      : null;
    let company: { id: string; name: string } | null = null;
    if (contact?.companyId) company = await tx.company.findFirst({ where: { id: contact.companyId, tenantId: auth.tenantId, deletedAt: null, ...companyScope(v) }, select: { id: true, name: true } });
    const nameKey = companyNameKey(row.company);
    if (!company && nameKey) company = await tx.company.findFirst({ where: { tenantId: auth.tenantId, deletedAt: null, nameKey, ...companyScope(v) }, select: { id: true, name: true }, orderBy: { createdAt: 'asc' } });
    const domain = email ? domainKey(email) : null;
    if (!company && domain && !FREE_MAIL_DOMAINS.has(domain)) {
      company = await tx.company.findFirst({ where: { tenantId: auth.tenantId, deletedAt: null, ...companyScope(v), OR: [{ matchKeys: { has: `d:${domain}` } }, { domain: { equals: domain, mode: 'insensitive' } }] }, select: { id: true, name: true }, orderBy: { createdAt: 'asc' } });
    }
    return { contact: contact ? { id: contact.id, name: [contact.firstName, contact.lastName].filter(Boolean).join(' '), companyId: contact.companyId } : null, company };
  }

  /** One enquiry. Opening it marks it seen (it stops glowing as new) for everyone. */
  detail(auth: AuthContext, id: string): Promise<EnquiryDetail> {
    return this.prisma.run(auth, async (tx) => {
      let row = await this.load(tx, auth.tenantId, id);
      if (!row.seenAt) {
        await tx.websiteEnquiry.updateMany({ where: { id, seenAt: null }, data: { seenAt: new Date(), seenById: auth.userId } });
        row = await this.load(tx, auth.tenantId, id);
      }
      return this.detailIn(tx, auth, row);
    });
  }

  /** Marks every unread one (or those matching the list's filters) as seen. */
  markAllSeen(auth: AuthContext, q: EnquiryListQuery): Promise<{ updated: number }> {
    return this.prisma.run(auth, async (tx) => {
      const res = await tx.websiteEnquiry.updateMany({ where: { AND: [this.listWhere(auth.tenantId, q), { seenAt: null }] }, data: { seenAt: new Date(), seenById: auth.userId } });
      return { updated: res.count };
    });
  }

  markUnread(auth: AuthContext, id: string): Promise<EnquiryDetail> {
    return this.prisma.run(auth, async (tx) => {
      await this.load(tx, auth.tenantId, id);
      await tx.websiteEnquiry.update({ where: { id }, data: { seenAt: null, seenById: null } });
      return this.detailIn(tx, auth, await this.load(tx, auth.tenantId, id));
    });
  }

  /**
   * Status, stage, owner, note and star. A change to what the website shows on a lead (status, stage, owner, note) is
   * queued to be sent back to it.
   */
  update(auth: AuthContext, id: string, input: EnquiryUpdateInput, meta: RequestMeta): Promise<EnquiryDetail> {
    return this.prisma.run(auth, async (tx) => {
      const before = await this.load(tx, auth.tenantId, id);
      if (input.assigneeId) await assertRefs(tx, auth.tenantId, { ownerId: input.assigneeId });
      const data: Prisma.WebsiteEnquiryUpdateInput = {};
      const changes: Record<string, { from: unknown; to: unknown }> = {};
      const set = <K extends 'status' | 'stage' | 'note' | 'assigneeId' | 'starred'>(k: K, v: WebsiteEnquiry[K] | undefined) => {
        if (v === undefined || v === before[k]) return;
        (data as Record<string, unknown>)[k] = v;
        changes[k] = { from: before[k], to: v };
      };
      set('status', input.status);
      set('stage', input.stage === undefined ? undefined : input.stage || null);
      set('note', input.note === undefined ? undefined : input.note || null);
      set('assigneeId', input.assigneeId);
      set('starred', input.starred);
      if (!Object.keys(changes).length) return this.detailIn(tx, auth, before);
      const shown = ['status', 'stage', 'note', 'assigneeId'].some((k) => k in changes);
      if (shown && before.record === 'lead') Object.assign(data, { writeBackAt: new Date(), writeBackTries: 0, writeBackError: null });
      if (!before.seenAt) Object.assign(data, { seenAt: new Date(), seenById: auth.userId });
      await tx.websiteEnquiry.update({ where: { id }, data });
      if (Object.keys(changes).some((k) => k !== 'starred')) {
        await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'website_enquiry.updated', entityType: 'website_enquiry', entityId: id, metadata: { externalId: before.externalId, ...changes }, meta });
      }
      return this.detailIn(tx, auth, await this.load(tx, auth.tenantId, id));
    });
  }

  /**
   * Converts into a company and employee: the employee with the same email, else a new one; the chosen company, else
   * the employee's or one matched by name or work-email domain, else a new company from the enquiry. A new lead moves
   * to Qualified (and the website hears it).
   */
  convert(auth: AuthContext, id: string, input: EnquiryConvertInput, meta: RequestMeta): Promise<EnquiryConvertResult> {
    for (const p of ['companies:write', ...(input.createEmployee ? ['contacts:write'] : [])]) {
      if (!auth.permissions.includes(p)) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Your role cannot create companies and employees.' });
    }
    return this.prisma.run(auth, async (tx) => {
      const row = await this.load(tx, auth.tenantId, id);
      const v = await visibility(tx, auth);
      const found = await this.matches(tx, auth, row);
      let companyId: string | null = null;
      let createdCompany = false;
      if (input.companyId) {
        const c = await tx.company.findFirst({ where: { id: input.companyId, tenantId: auth.tenantId, deletedAt: null, ...companyScope(v) }, select: { id: true } });
        if (!c) throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Choose a company you can see.', details: [{ path: 'companyId', message: 'Company not found' }] });
        companyId = c.id;
      } else if (row.companyId && (await tx.company.findFirst({ where: { id: row.companyId, tenantId: auth.tenantId, deletedAt: null }, select: { id: true } }))) {
        companyId = row.companyId;
      } else if (found.company) {
        companyId = found.company.id;
      } else {
        const name = input.companyName ?? row.company ?? (row.email && domainKey(row.email) && !FREE_MAIL_DOMAINS.has(domainKey(row.email)!) ? domainKey(row.email)! : null);
        if (!name) throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'This enquiry has no company. Type the company name to create it.', details: [{ path: 'companyName', message: 'Enter a company name' }] });
        const domain = row.email ? domainKey(row.email) : null;
        const parsed = companyInputSchema.safeParse({
          name: name.slice(0, 200),
          country: countryCodeOf(row.country),
          website: domain && !FREE_MAIL_DOMAINS.has(domain) ? `https://${domain}` : undefined,
          notes: `From the website: ${[row.formName, row.service].filter(Boolean).join(', ') || 'enquiry'} on ${row.submittedAt.toISOString().slice(0, 10)}.`,
        });
        if (!parsed.success) throw new BadRequestException({ code: 'VALIDATION_FAILED', message: parsed.error.issues[0]?.message ?? 'Check the company name.' });
        companyId = await this.companies.createIn(tx, auth, parsed.data, meta);
        createdCompany = true;
      }
      let contactId: string | null = null;
      let createdContact = false;
      if (input.createEmployee) {
        if (found.contact) {
          contactId = found.contact.id;
          if (!found.contact.companyId && companyId) await tx.contact.update({ where: { id: contactId }, data: { companyId, updatedById: auth.userId } });
        } else {
          const { firstName, lastName } = splitName(row.name, row.email);
          const base = { firstName, lastName, companyId, country: countryCodeOf(row.country), jobTitle: row.designation?.slice(0, 160) ?? null, remarks: enquiryRemarks(row) };
          // Website forms take any phone text; one SampForce cannot read is left out rather than failing the convert.
          const parsed = contactInputSchema.safeParse({ ...base, email: row.email, phone: row.phone, marketingConsent: row.consent ? 'OPTED_IN' : undefined });
          const fallback = parsed.success ? parsed : contactInputSchema.safeParse({ ...base, email: row.email });
          const ok = fallback.success ? fallback : contactInputSchema.safeParse(base);
          if (!ok.success) throw new BadRequestException({ code: 'VALIDATION_FAILED', message: ok.error.issues[0]?.message ?? 'Check the employee details.' });
          contactId = (await this.contacts.createIn(tx, auth, ok.data, meta)).id;
          createdContact = true;
        }
      }
      const promote = row.record === 'lead' && (row.status === 'new' || row.status === 'contacted');
      await tx.websiteEnquiry.update({
        where: { id },
        data: {
          companyId,
          contactId: contactId ?? row.contactId,
          convertedAt: new Date(),
          convertedById: auth.userId,
          seenAt: row.seenAt ?? new Date(),
          seenById: row.seenById ?? auth.userId,
          ...(promote ? { status: 'qualified', writeBackAt: new Date(), writeBackTries: 0, writeBackError: null } : {}),
        },
      });
      await this.audit.record(tx, {
        tenantId: auth.tenantId, actorUserId: auth.userId, action: 'website_enquiry.converted', entityType: 'website_enquiry', entityId: id,
        metadata: { externalId: row.externalId, companyId, contactId, createdCompany, createdContact }, meta,
      });
      const after = await this.detailIn(tx, auth, await this.load(tx, auth.tenantId, id));
      return { enquiry: after, company: after.converted?.company ?? null, contact: after.converted?.contact ?? null, created: { company: createdCompany, contact: createdContact } };
    });
  }
}

/** The columns the website owns, refreshed on every delivery and sync. */
function websiteColumns(d: EnquiryData) {
  return {
    type: d.type,
    category: d.category,
    websiteStatus: d.websiteStatus,
    formKey: d.formKey,
    formName: d.formName,
    name: d.name,
    email: d.email,
    phone: d.phone,
    country: d.country,
    company: d.company,
    designation: d.designation,
    service: d.service,
    timeline: d.timeline,
    message: d.message,
    resource: d.resource,
    rating: d.rating,
    page: d.page,
    consent: d.consent,
    subscribed: d.subscribed,
    fields: (d.fields ?? undefined) as Prisma.InputJsonValue | undefined,
    websiteOwner: d.websiteOwner,
    websiteNote: d.websiteNote,
    raw: d.raw as Prisma.InputJsonValue,
    searchText: d.searchText,
    submittedAt: d.submittedAt,
    websiteUpdatedAt: d.websiteUpdatedAt,
  };
}

function enquiryRemarks(row: WebsiteEnquiry): string {
  const lines = [
    `Website ${row.formName ?? 'enquiry'} on ${row.submittedAt.toISOString().slice(0, 10)}`,
    row.service ? `Service: ${row.service}` : null,
    row.timeline ? `Timeline: ${row.timeline}` : null,
    row.resource ? `Asked for: ${row.resource}` : null,
    row.message ? `Message: ${row.message}` : null,
  ].filter(Boolean);
  return lines.join('\n').slice(0, 5000);
}

