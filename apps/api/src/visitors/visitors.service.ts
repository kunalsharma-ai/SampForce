import { BadRequestException, ForbiddenException, HttpException, HttpStatus, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { Prisma, type TenantTx } from '@dealflow/database';
import {
  collectSchema,
  DEFAULT_VISITOR_SETTINGS,
  type Enquiry,
  enquirySchema,
  type ImportantPage,
  importantPageSchema,
  pageOf,
  type RecordWebActivity,
  type Utm,
  type VisitorDashboard,
  type VisitorDetail,
  type VisitorRef,
  type VisitorRow,
  type VisitorSession,
  type VisitorSettings,
  type VisitorSettingsInput,
  visitorIntent,
  z,
} from '@dealflow/types';
import { AuditService } from '../audit/audit.service';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { API_ENV, type ApiEnv } from '../common/env';
import { PrismaService } from '../common/prisma.service';
import { notFound } from '../crm/crm-helpers';
import { NotificationsService } from '../notifications/notifications.service';
import { claim, errorMessage } from '../worker/queue';

const DAY = 86_400_000;
const HOUR = 3_600_000;
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const MAX_ENQUIRIES_PER_IP_PER_10_MIN = 5;
const gone = () => new NotFoundException({ code: 'NOT_FOUND', message: 'Tracking is not available for this site.' });

type Settings = VisitorSettingsInput & { siteKey: string; updatedAt: Date | null };
type VisitorWithRefs = Prisma.WebVisitorGetPayload<{
  include: { lead: { select: { id: true; fullName: true; email: true } }; contact: { select: { id: true; firstName: true; lastName: true; email: true } }; campaign: { select: { id: true; name: true } } };
}>;
const visitorInclude = {
  lead: { select: { id: true, fullName: true, email: true } },
  contact: { select: { id: true, firstName: true, lastName: true, email: true } },
  campaign: { select: { id: true, name: true } },
} as const;

/** Host names allowed by the settings: exact, or any subdomain for "*.example.com". */
export function originAllowed(origin: string | undefined, domains: string[]): boolean {
  if (!origin) return false;
  let host: string;
  try {
    host = new URL(origin).hostname.toLowerCase();
  } catch {
    return false;
  }
  return domains.some((d) => (d.startsWith('*.') ? host === d.slice(2) || host.endsWith(d.slice(1)) : host === d));
}

/**
 * Website visitor intelligence (enhancement feature 15). The public half receives page views and enquiries from
 * the tracking script on allowed websites; the signed-in half shows dashboards, visitors, and activity on CRM records.
 * Visitors are anonymous until they send an enquiry: nothing here looks up IP addresses or fingerprints browsers.
 */
@Injectable()
export class VisitorsService {
  private readonly log = new Logger(VisitorsService.name);
  private lastSweep = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  // ───────────── settings ─────────────

  private async load(tx: TenantTx, tenantId: string): Promise<Settings> {
    let row = await tx.visitorSettings.findUnique({ where: { tenantId } });
    if (!row) {
      row = await tx.visitorSettings.create({
        data: { tenantId, siteKey: `dfs_${randomBytes(15).toString('base64url')}`, importantPages: DEFAULT_VISITOR_SETTINGS.importantPages as unknown as Prisma.InputJsonValue },
      });
    }
    const pages = z.array(importantPageSchema).safeParse(row.importantPages);
    return {
      enabled: row.enabled,
      consentMode: row.consentMode as Settings['consentMode'],
      allowedDomains: row.allowedDomains,
      retentionDays: row.retentionDays,
      createLeads: row.createLeads,
      enquiryConsentText: row.enquiryConsentText,
      highIntentScore: row.highIntentScore,
      importantPages: pages.success ? pages.data : DEFAULT_VISITOR_SETTINGS.importantPages,
      siteKey: row.siteKey,
      updatedAt: row.updatedById ? row.updatedAt : null,
    };
  }

  private view(s: Settings): VisitorSettings {
    return { ...s, updatedAt: s.updatedAt?.toISOString() ?? null };
  }

  settings(auth: AuthContext): Promise<VisitorSettings> {
    return this.prisma.run(auth, async (tx) => this.view(await this.load(tx, auth.tenantId)));
  }

  saveSettings(auth: AuthContext, input: VisitorSettingsInput, meta: RequestMeta): Promise<VisitorSettings> {
    return this.prisma.run(auth, async (tx) => {
      const before = await this.load(tx, auth.tenantId);
      if (input.enabled && input.allowedDomains.length === 0) {
        throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Add at least one website before turning tracking on.', details: [{ path: 'allowedDomains', message: 'Add your website' }] });
      }
      await tx.visitorSettings.update({
        where: { tenantId: auth.tenantId },
        data: { ...input, allowedDomains: [...new Set(input.allowedDomains)], importantPages: input.importantPages as unknown as Prisma.InputJsonValue, updatedById: auth.userId, updatedAt: new Date() },
      });
      const changed = (Object.keys(input) as (keyof VisitorSettingsInput)[]).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(input[k]));
      await this.audit.record(tx, {
        tenantId: auth.tenantId, actorUserId: auth.userId, action: 'visitors.settings_updated', entityType: 'visitor_settings', entityId: auth.tenantId,
        metadata: Object.fromEntries(changed.map((k) => [k, { from: before[k], to: input[k] }])), meta,
      });
      return this.view(await this.load(tx, auth.tenantId));
    });
  }

  /** A new site key; the old snippet stops working at once. */
  rotateKey(auth: AuthContext, meta: RequestMeta): Promise<VisitorSettings> {
    return this.prisma.run(auth, async (tx) => {
      await this.load(tx, auth.tenantId);
      await tx.visitorSettings.update({ where: { tenantId: auth.tenantId }, data: { siteKey: `dfs_${randomBytes(15).toString('base64url')}`, updatedById: auth.userId, updatedAt: new Date() } });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'visitors.site_key_rotated', entityType: 'visitor_settings', entityId: auth.tenantId, meta });
      return this.view(await this.load(tx, auth.tenantId));
    });
  }

  // ───────────── public: config, collect, enquiry ─────────────

  private async resolve(siteKey: string): Promise<string> {
    if (!/^dfs_[\w-]{10,40}$/.test(siteKey)) throw gone();
    const rows = await this.prisma.$queryRaw<{ t: string | null }[]>`SELECT app_visitor_site_tenant(${siteKey})::text AS t`;
    const tenantId = rows[0]?.t;
    if (!tenantId) throw gone();
    return tenantId;
  }

  private async site(siteKey: string, origin: string | undefined): Promise<{ tenantId: string; s: Settings }> {
    const tenantId = await this.resolve(siteKey);
    const s = await this.prisma.run({ tenantId }, (tx) => this.load(tx, tenantId));
    if (!originAllowed(origin, s.allowedDomains)) throw new ForbiddenException({ code: 'ORIGIN_NOT_ALLOWED', message: 'This website is not on the allowed list for tracking.' });
    return { tenantId, s };
  }

  /** What the script needs to know. Only answered for allowed websites, so other sites' scripts stay idle. */
  async publicConfig(siteKey: string, origin: string | undefined) {
    const { s } = await this.site(siteKey, origin);
    return { enabled: s.enabled, consentMode: s.consentMode, enquiryConsentText: s.enquiryConsentText };
  }

  /**
   * Records page views, custom events and time on page. Requests that carry a Global Privacy Control or Do Not
   * Track signal are accepted and dropped. Returns how many events were stored.
   */
  async collect(siteKey: string, origin: string | undefined, raw: unknown, privacySignal: boolean): Promise<{ stored: number }> {
    const { tenantId, s } = await this.site(siteKey, origin);
    if (privacySignal) return { stored: 0 };
    const parsed = collectSchema.safeParse(typeof raw === 'string' ? safeJson(raw) : raw);
    if (!parsed.success) throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Invalid tracking data.' });
    const body = parsed.data;
    const host = (() => {
      try {
        return new URL(origin!).hostname;
      } catch {
        return null;
      }
    })();
    return this.prisma.run({ tenantId }, async (tx) => {
      const now = new Date();
      const firstPage = body.events.find((e) => e.type === 'page');
      let visitor = await tx.webVisitor.findUnique({ where: { tenantId_clientId: { tenantId, clientId: body.visitorId } } });
      if (!visitor) {
        const utm = cleanUtm(firstPage?.utm);
        const campaignId = utm?.campaign ? ((await tx.campaign.findFirst({ where: { tenantId, utmCampaign: { equals: utm.campaign, mode: 'insensitive' } }, select: { id: true } }))?.id ?? null) : null;
        const referrer = firstPage?.referrer && firstPage.referrer !== host ? firstPage.referrer : null;
        visitor = await tx.webVisitor.create({
          data: { tenantId, clientId: body.visitorId, firstSeenAt: now, lastSeenAt: now, firstTouch: utm || referrer ? ({ ...(utm ?? {}), referrer } as Prisma.InputJsonValue) : Prisma.DbNull, campaignId },
        });
      }
      let session = await tx.webSession.findUnique({ where: { tenantId_clientId: { tenantId, clientId: body.sessionId } } });
      if (session && session.visitorId !== visitor.id) throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Invalid tracking data.' });
      let newVisit = false;
      if (!session) {
        newVisit = true;
        const referrer = firstPage?.referrer && firstPage.referrer !== host ? firstPage.referrer.slice(0, 200) : null;
        session = await tx.webSession.create({
          data: { tenantId, visitorId: visitor.id, clientId: body.sessionId, startedAt: now, lastAt: now, landingPath: firstPage?.path ?? body.events[0]!.path, referrerHost: referrer, utm: cleanUtm(firstPage?.utm) ?? Prisma.DbNull },
        });
      }
      let pages = 0;
      let engaged = 0;
      let stored = 0;
      for (const e of body.events) {
        if (e.type === 'engagement') {
          engaged += e.engagedSeconds ?? 0;
          continue;
        }
        await tx.webEvent.create({ data: { tenantId, visitorId: visitor.id, sessionId: session.id, type: e.type, path: e.path, title: e.title ?? null, name: e.type === 'event' ? (e.name ?? null) : null, occurredAt: now } });
        if (e.type === 'page') pages++;
        stored++;
      }
      // Time on page counts only for an open session (at most 30 minutes after its last activity).
      if (now.getTime() - session.lastAt.getTime() > 30 * 60_000) engaged = 0;
      await tx.webSession.update({ where: { id: session.id }, data: { lastAt: now, pageViews: { increment: pages }, engagedSeconds: { increment: engaged } } });
      await tx.webVisitor.update({ where: { id: visitor.id }, data: { lastSeenAt: now, visits: { increment: newVisit ? 1 : 0 }, pageViews: { increment: pages }, engagedSeconds: { increment: engaged } } });
      await this.rescore(tx, tenantId, visitor.id, s);
      return { stored };
    });
  }

  /** A website enquiry: links the visitor to a contact or open lead with the same email, or creates a lead. */
  async enquiry(siteKey: string, origin: string | undefined, raw: unknown, ip: string | null): Promise<{ message: string }> {
    const { tenantId, s } = await this.site(siteKey, origin);
    const parsed = enquirySchema.safeParse(typeof raw === 'string' ? safeJson(raw) : raw);
    if (!parsed.success) {
      throw new BadRequestException({ code: 'VALIDATION_FAILED', message: parsed.error.issues[0]?.message ?? 'Please check the form.', details: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
    }
    const e = parsed.data;
    const ipHash = ip ? createHmac('sha256', this.env.JWT_ACCESS_SECRET).update(`enquiry-ip:${ip}`).digest('hex') : null;
    return this.prisma.run({ tenantId }, async (tx) => {
      if (ipHash) {
        const recent = await tx.webEvent.count({ where: { tenantId, type: 'enquiry', occurredAt: { gte: new Date(Date.now() - 10 * 60_000) }, data: { path: ['ipHash'], equals: ipHash } } });
        if (recent >= MAX_ENQUIRIES_PER_IP_PER_10_MIN) throw new HttpException({ code: 'RATE_LIMITED', message: 'Too many enquiries. Please try again later.' }, HttpStatus.TOO_MANY_REQUESTS);
      }
      const visitor = e.visitorId ? await tx.webVisitor.findUnique({ where: { tenantId_clientId: { tenantId, clientId: e.visitorId } } }) : null;
      const consent = !!s.enquiryConsentText && e.consent;
      const linked = await this.linkPerson(tx, tenantId, s, e, consent, visitor?.campaignId ?? null, visitor?.firstTouch as Utm | null);
      const data = { fullName: e.fullName, email: e.email, companyName: e.companyName ?? null, consent, consentText: consent ? s.enquiryConsentText : null, ipHash, linked: linked ? { type: linked.type, id: linked.id, created: linked.created } : null };
      if (visitor) {
        const session = await tx.webSession.findFirst({ where: { visitorId: visitor.id }, orderBy: { lastAt: 'desc' }, select: { id: true } });
        await tx.webEvent.create({ data: { tenantId, visitorId: visitor.id, sessionId: session?.id ?? null, type: 'enquiry', path: e.path ?? null, data: data as Prisma.InputJsonValue } });
        await tx.webVisitor.update({
          where: { id: visitor.id },
          data: {
            enquiries: { increment: 1 }, lastSeenAt: new Date(),
            ...(linked ? { leadId: linked.type === 'lead' ? linked.id : visitor.leadId, contactId: linked.type === 'contact' ? linked.id : visitor.contactId, identifiedAt: visitor.identifiedAt ?? new Date(), identifiedVia: 'enquiry' } : {}),
          },
        });
        await this.rescore(tx, tenantId, visitor.id, s);
      } else {
        // No tracking consent: keep the enquiry itself as evidence on a visitor record with no browsing history.
        const v = await tx.webVisitor.create({ data: { tenantId, clientId: randomUUID(), enquiries: 1, ...(linked ? { leadId: linked.type === 'lead' ? linked.id : null, contactId: linked.type === 'contact' ? linked.id : null, identifiedAt: new Date(), identifiedVia: 'enquiry' } : {}) } });
        await tx.webEvent.create({ data: { tenantId, visitorId: v.id, type: 'enquiry', path: e.path ?? null, data: data as Prisma.InputJsonValue } });
        await this.rescore(tx, tenantId, v.id, s);
      }
      return { message: 'Thank you. We will be in touch soon.' };
    });
  }

  private async linkPerson(tx: TenantTx, tenantId: string, s: Settings, e: Enquiry, consent: boolean, campaignId: string | null, touch: Utm | null): Promise<{ type: 'lead' | 'contact'; id: string; created: boolean } | null> {
    const consentData = consent ? { marketingConsent: 'OPTED_IN' as const, consentSource: 'website enquiry', consentUpdatedAt: new Date() } : {};
    const note = (subject: string) => ({ tenantId, type: 'NOTE' as const, subject, body: e.message ?? null });
    const contact = await tx.contact.findFirst({ where: { tenantId, deletedAt: null, email: { equals: e.email, mode: 'insensitive' } }, orderBy: { createdAt: 'asc' } });
    if (contact) {
      if (consent) await tx.contact.update({ where: { id: contact.id }, data: consentData });
      await tx.activity.create({ data: { ...note('Website enquiry'), contactId: contact.id, companyId: contact.companyId, ownerId: contact.ownerId } });
      await this.audit.record(tx, { tenantId, actorUserId: null, actorType: 'SYSTEM', action: 'contact.website_enquiry', entityType: 'contact', entityId: contact.id, metadata: { consent } });
      return { type: 'contact', id: contact.id, created: false };
    }
    const lead = await tx.lead.findFirst({ where: { tenantId, deletedAt: null, status: { not: 'CONVERTED' }, email: { equals: e.email, mode: 'insensitive' } }, orderBy: { createdAt: 'asc' } });
    if (lead) {
      await tx.lead.update({ where: { id: lead.id }, data: { ...consentData, ...(lead.campaignId || !campaignId ? {} : { campaignId }) } });
      await tx.activity.create({ data: { ...note('Website enquiry'), leadId: lead.id, ownerId: lead.ownerId } });
      await this.audit.record(tx, { tenantId, actorUserId: null, actorType: 'SYSTEM', action: 'lead.website_enquiry', entityType: 'lead', entityId: lead.id, metadata: { consent } });
      return { type: 'lead', id: lead.id, created: false };
    }
    if (!s.createLeads) return null;
    const created = await tx.lead.create({
      data: {
        tenantId, fullName: e.fullName, email: e.email, phone: e.phone ?? null, companyName: e.companyName ?? null, source: 'Website', campaignId,
        campaignSource: touch?.campaign ?? touch?.source ?? null, ...consentData,
      },
    });
    if (e.message) await tx.activity.create({ data: { ...note('Website enquiry'), leadId: created.id } });
    // Audited as lead.created so workflows and auto-qualification treat it like any new lead.
    await this.audit.record(tx, { tenantId, actorUserId: null, actorType: 'SYSTEM', action: 'lead.created', entityType: 'lead', entityId: created.id, metadata: { source: 'Website', via: 'website_enquiry', consent } });
    return { type: 'lead', id: created.id, created: true };
  }

  /**
   * Recomputes the stored intent score. The first time a known visitor reaches the workspace threshold, the record
   * owner is notified and a `visitor.high_intent` event starts any matching workflow.
   */
  private async rescore(tx: TenantTx, tenantId: string, visitorId: string, s: Settings): Promise<void> {
    const v = await tx.webVisitor.findUniqueOrThrow({ where: { id: visitorId }, include: visitorInclude });
    const { score } = await this.intentOf(tx, v, s.importantPages);
    const crossing = score >= s.highIntentScore && !v.highIntentAt && (v.leadId || v.contactId);
    await tx.webVisitor.update({ where: { id: v.id }, data: { intentScore: score, ...(crossing ? { highIntentAt: new Date() } : {}) } });
    if (!crossing) return;
    const ref = refOf(v)!;
    const owner = ref.type === 'lead' ? (await tx.lead.findUnique({ where: { id: ref.id }, select: { ownerId: true } }))?.ownerId : (await tx.contact.findUnique({ where: { id: ref.id }, select: { ownerId: true } }))?.ownerId;
    await this.notifications.send(tx, tenantId, [owner], { type: 'visitor.high_intent', title: `${ref.name} is showing high intent on your website`, body: `Intent score ${score}/100.`, link: `/app/${ref.type === 'lead' ? 'leads' : 'contacts'}/${ref.id}` });
    await this.audit.publish(tx, { tenantId, type: 'visitor.high_intent', entityType: ref.type, entityId: ref.id, payload: { visitorId: v.id, score, threshold: s.highIntentScore } });
  }

  private async intentOf(tx: TenantTx, v: { id: string; visits: number; engagedSeconds: number; enquiries: number; lastSeenAt: Date }, pages: ImportantPage[]) {
    const views = await tx.webEvent.groupBy({ by: ['path'], where: { visitorId: v.id, type: 'page' }, _count: { _all: true } });
    return visitorIntent({ visits: v.visits, engagedSeconds: v.engagedSeconds, enquiries: v.enquiries, lastSeenAt: v.lastSeenAt, pages: views.map((p) => ({ path: p.path ?? '/', views: p._count._all })) }, pages);
  }

  // ───────────── signed-in views ─────────────

  private async rows(tx: TenantTx, s: Settings, visitors: VisitorWithRefs[]): Promise<VisitorRow[]> {
    const last = visitors.length
      ? await tx.webEvent.findMany({ where: { visitorId: { in: visitors.map((v) => v.id) }, type: 'page' }, orderBy: { occurredAt: 'desc' }, distinct: ['visitorId'], select: { visitorId: true, path: true } })
      : [];
    const lastPath = new Map(last.map((l) => [l.visitorId, l.path]));
    const out: VisitorRow[] = [];
    for (const v of visitors) {
      const intent = await this.intentOf(tx, v, s.importantPages);
      const ref = refOf(v);
      out.push({
        id: v.id,
        label: ref ? ref.name : `Anonymous visitor ${v.id.slice(0, 6)}`,
        identified: ref,
        identifiedVia: ref ? 'enquiry' : null,
        firstSeenAt: v.firstSeenAt.toISOString(),
        lastSeenAt: v.lastSeenAt.toISOString(),
        visits: v.visits,
        pageViews: v.pageViews,
        engagedSeconds: v.engagedSeconds,
        intent: { ...intent, high: intent.score >= s.highIntentScore },
        firstTouch: (v.firstTouch as VisitorRow['firstTouch']) ?? null,
        campaign: v.campaign,
        lastPath: lastPath.get(v.id) ?? null,
      });
    }
    return out;
  }

  list(auth: AuthContext, q: { segment: 'all' | 'identified' | 'anonymous' | 'high_intent'; search?: string }): Promise<VisitorRow[]> {
    return this.prisma.run(auth, async (tx) => {
      const s = await this.load(tx, auth.tenantId);
      const known: Prisma.WebVisitorWhereInput = { OR: [{ leadId: { not: null } }, { contactId: { not: null } }] };
      const where: Prisma.WebVisitorWhereInput = {
        tenantId: auth.tenantId,
        ...(q.segment === 'identified' ? known : q.segment === 'anonymous' ? { leadId: null, contactId: null } : q.segment === 'high_intent' ? { intentScore: { gte: s.highIntentScore } } : {}),
        ...(q.search
          ? { OR: [{ lead: { OR: [{ fullName: { contains: q.search, mode: 'insensitive' } }, { email: { contains: q.search, mode: 'insensitive' } }] } }, { contact: { OR: [{ firstName: { contains: q.search, mode: 'insensitive' } }, { lastName: { contains: q.search, mode: 'insensitive' } }, { email: { contains: q.search, mode: 'insensitive' } }] } }] }
          : {}),
      };
      const visitors = await tx.webVisitor.findMany({ where, include: visitorInclude, orderBy: q.segment === 'high_intent' ? [{ intentScore: 'desc' }, { lastSeenAt: 'desc' }] : { lastSeenAt: 'desc' }, take: 200 });
      return this.rows(tx, s, visitors);
    });
  }

  private async details(tx: TenantTx, s: Settings, visitors: VisitorWithRefs[]): Promise<VisitorDetail[]> {
    const rows = await this.rows(tx, s, visitors);
    const out: VisitorDetail[] = [];
    for (const row of rows) {
      const sessions = await tx.webSession.findMany({ where: { visitorId: row.id }, orderBy: { startedAt: 'desc' }, take: 20 });
      const events = await tx.webEvent.findMany({ where: { visitorId: row.id }, orderBy: { occurredAt: 'asc' }, take: 500 });
      const mapEvent = (e: (typeof events)[number]): VisitorSession['events'][number] => {
        const page = e.type === 'page' && e.path ? pageOf(s.importantPages, e.path) : null;
        return { type: e.type as 'page' | 'event' | 'enquiry', path: e.path, title: e.title, name: e.name, at: e.occurredAt.toISOString(), kind: page?.kind ?? null, label: page?.label ?? null };
      };
      const list: VisitorSession[] = sessions.map((x) => ({
        id: x.id, startedAt: x.startedAt.toISOString(), lastAt: x.lastAt.toISOString(), landingPath: x.landingPath, referrer: x.referrerHost, utm: (x.utm as Utm | null) ?? null, engagedSeconds: x.engagedSeconds,
        events: events.filter((e) => e.sessionId === x.id).map(mapEvent),
      }));
      // Enquiries sent without tracking consent have no session.
      const loose = events.filter((e) => !e.sessionId);
      if (loose.length) list.unshift({ id: `enquiries-${row.id}`, startedAt: loose[0]!.occurredAt.toISOString(), lastAt: loose.at(-1)!.occurredAt.toISOString(), landingPath: null, referrer: null, utm: null, engagedSeconds: 0, events: loose.map(mapEvent) });
      out.push({ ...row, sessions: list });
    }
    return out;
  }

  detail(auth: AuthContext, id: string): Promise<VisitorDetail> {
    return this.prisma.run(auth, async (tx) => {
      const v = await tx.webVisitor.findFirst({ where: { id, tenantId: auth.tenantId }, include: visitorInclude });
      if (!v) throw notFound('Visitor');
      return (await this.details(tx, await this.load(tx, auth.tenantId), [v]))[0]!;
    });
  }

  /** Website activity on a lead or contact (for a contact, also visits linked to the lead it was converted from). */
  forRecord(auth: AuthContext, type: 'lead' | 'contact', id: string): Promise<RecordWebActivity> {
    return this.prisma.run(auth, async (tx) => {
      let where: Prisma.WebVisitorWhereInput;
      if (type === 'lead') where = { tenantId: auth.tenantId, leadId: id };
      else {
        const leads = await tx.lead.findMany({ where: { tenantId: auth.tenantId, convertedContactId: id }, select: { id: true } });
        where = { tenantId: auth.tenantId, OR: [{ contactId: id }, ...(leads.length ? [{ leadId: { in: leads.map((l) => l.id) } }] : [])] };
      }
      const visitors = await tx.webVisitor.findMany({ where, include: visitorInclude, orderBy: { lastSeenAt: 'desc' }, take: 5 });
      return { visitors: await this.details(tx, await this.load(tx, auth.tenantId), visitors) };
    });
  }

  /** Deletes a visitor and everything recorded about their browsing (a privacy request). CRM records stay. */
  erase(auth: AuthContext, id: string, meta: RequestMeta): Promise<void> {
    return this.prisma.run(auth, async (tx) => {
      const v = await tx.webVisitor.findFirst({ where: { id, tenantId: auth.tenantId } });
      if (!v) throw notFound('Visitor');
      await tx.webVisitor.delete({ where: { id } });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'visitors.visitor_erased', entityType: 'web_visitor', entityId: id, metadata: { leadId: v.leadId, contactId: v.contactId }, meta });
    });
  }

  dashboard(auth: AuthContext, days: number): Promise<VisitorDashboard> {
    return this.prisma.run(auth, async (tx) => {
      const s = await this.load(tx, auth.tenantId);
      const t = auth.tenantId;
      const end = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()) + DAY);
      const start = new Date(end.getTime() - days * DAY);
      const daily = await tx.$queryRaw<{ day: Date; visitors: number; visits: number; page_views: number }[]>(Prisma.sql`
        SELECT d::date AS day,
          (SELECT count(DISTINCT s.visitor_id)::int FROM web_sessions s WHERE s.tenant_id = ${t}::uuid AND s.started_at >= d AND s.started_at < d + interval '1 day') AS visitors,
          (SELECT count(*)::int FROM web_sessions s WHERE s.tenant_id = ${t}::uuid AND s.started_at >= d AND s.started_at < d + interval '1 day') AS visits,
          (SELECT count(*)::int FROM web_events e WHERE e.tenant_id = ${t}::uuid AND e.type = 'page' AND e.occurred_at >= d AND e.occurred_at < d + interval '1 day') AS page_views
        FROM generate_series(${start}::timestamptz, ${end}::timestamptz - interval '1 day', interval '1 day') AS d`);
      const inRange = { tenantId: t, occurredAt: { gte: start, lt: end } };
      const [visits, visitorIds, pageViews, enquiries, leadsCreated] = await Promise.all([
        tx.webSession.count({ where: { tenantId: t, startedAt: { gte: start, lt: end } } }),
        tx.webSession.findMany({ where: { tenantId: t, startedAt: { gte: start, lt: end } }, distinct: ['visitorId'], select: { visitorId: true } }),
        tx.webEvent.count({ where: { ...inRange, type: 'page' } }),
        tx.webEvent.findMany({ where: { ...inRange, type: 'enquiry' }, select: { data: true } }),
        tx.lead.count({ where: { tenantId: t, source: 'Website', createdAt: { gte: start, lt: end } } }),
      ]);
      const ids = visitorIds.map((v) => v.visitorId);
      const [identified, returning, highIntent] = await Promise.all([
        tx.webVisitor.count({ where: { id: { in: ids }, OR: [{ leadId: { not: null } }, { contactId: { not: null } }] } }),
        tx.webVisitor.count({ where: { id: { in: ids }, visits: { gte: 2 } } }),
        tx.webVisitor.findMany({ where: { tenantId: t, lastSeenAt: { gte: start }, intentScore: { gte: s.highIntentScore } }, include: visitorInclude, orderBy: [{ intentScore: 'desc' }, { lastSeenAt: 'desc' }], take: 10 }),
      ]);
      const pages = await tx.$queryRaw<{ path: string; views: number; visitors: number }[]>(Prisma.sql`
        SELECT path, count(*)::int AS views, count(DISTINCT visitor_id)::int AS visitors FROM web_events
        WHERE tenant_id = ${t}::uuid AND type = 'page' AND occurred_at >= ${start} AND occurred_at < ${end} GROUP BY path ORDER BY views DESC LIMIT 200`);
      const important = new Map<string, { label: string; kind: ImportantPage['kind']; views: number; visitors: number }>();
      for (const p of pages) {
        const pg = pageOf(s.importantPages, p.path);
        if (!pg) continue;
        const cur = important.get(pg.label) ?? { label: pg.label, kind: pg.kind, views: 0, visitors: 0 };
        cur.views += p.views;
        cur.visitors += p.visitors;
        important.set(pg.label, cur);
      }
      const sources = await tx.$queryRaw<{ source: string; visits: number }[]>(Prisma.sql`
        SELECT COALESCE(NULLIF(utm->>'source', ''), referrer_host, 'Direct') AS source, count(*)::int AS visits FROM web_sessions
        WHERE tenant_id = ${t}::uuid AND started_at >= ${start} AND started_at < ${end} GROUP BY 1 ORDER BY 2 DESC LIMIT 10`);
      const camp = await tx.$queryRaw<{ utm_campaign: string; visits: number; visitors: number }[]>(Prisma.sql`
        SELECT utm->>'campaign' AS utm_campaign, count(*)::int AS visits, count(DISTINCT visitor_id)::int AS visitors FROM web_sessions
        WHERE tenant_id = ${t}::uuid AND started_at >= ${start} AND started_at < ${end} AND COALESCE(utm->>'campaign', '') <> '' GROUP BY 1 ORDER BY 2 DESC LIMIT 10`);
      const campaigns = await tx.campaign.findMany({ where: { tenantId: t, utmCampaign: { in: camp.map((c) => c.utm_campaign), mode: 'insensitive' } }, select: { id: true, name: true, utmCampaign: true } });
      const campaignRows = [];
      for (const c of camp) {
        const match = campaigns.find((x) => x.utmCampaign?.toLowerCase() === c.utm_campaign.toLowerCase()) ?? null;
        const leads = match ? await tx.lead.count({ where: { tenantId: t, campaignId: match.id, source: 'Website', createdAt: { gte: start, lt: end } } }) : 0;
        campaignRows.push({ campaign: match ? { id: match.id, name: match.name } : null, utmCampaign: c.utm_campaign, visits: c.visits, visitors: c.visitors, leads });
      }
      return {
        days,
        enabled: s.enabled,
        totals: { visitors: ids.length, visits, pageViews, identified, enquiries: enquiries.length, leadsCreated, highIntent: highIntent.length, returning },
        daily: daily.map((d) => ({ day: ymd(d.day), visitors: d.visitors, visits: d.visits, pageViews: d.page_views })),
        topPages: pages.slice(0, 10).map((p) => ({ ...p, label: pageOf(s.importantPages, p.path)?.label ?? null })),
        importantPages: [...important.values()].sort((a, b) => b.views - a.views),
        sources,
        campaigns: campaignRows,
        highIntent: await this.rows(tx, s, highIntent),
      };
    });
  }

  // ───────────── retention ─────────────

  /** Applies one workspace's retention period. Returns rows deleted. */
  async applyRetention(tx: TenantTx, tenantId: string, now = new Date()): Promise<number> {
    const s = await this.load(tx, tenantId);
    const cutoff = new Date(now.getTime() - s.retentionDays * DAY);
    const events = await tx.webEvent.deleteMany({ where: { tenantId, occurredAt: { lt: cutoff }, type: { not: 'enquiry' } } });
    const sessions = await tx.webSession.deleteMany({ where: { tenantId, lastAt: { lt: cutoff } } });
    // Anonymous visitors not seen since go entirely; known visitors keep their link and enquiries.
    const visitors = await tx.webVisitor.deleteMany({ where: { tenantId, lastSeenAt: { lt: cutoff }, leadId: null, contactId: null } });
    return events.count + sessions.count + visitors.count;
  }

  /** Worker job, at most hourly. */
  async sweep(force = false): Promise<number> {
    if (!force && Date.now() - this.lastSweep < HOUR) return 0;
    this.lastSweep = Date.now();
    const tenants = await claim<{ tenant_id: string }>(this.prisma, Prisma.sql`SELECT tenant_id FROM visitor_settings LIMIT 5000`);
    let n = 0;
    for (const t of tenants) {
      try {
        n += await this.prisma.run({ tenantId: t.tenant_id }, (tx) => this.applyRetention(tx, t.tenant_id));
      } catch (err) {
        this.log.error({ err: errorMessage(err), tenantId: t.tenant_id }, 'visitor retention sweep failed');
      }
    }
    return n;
  }
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function cleanUtm(u: Utm | undefined): Utm | null {
  if (!u) return null;
  const out = Object.fromEntries(Object.entries(u).filter(([, v]) => typeof v === 'string' && v.trim()).map(([k, v]) => [k, v!.trim()]));
  return Object.keys(out).length ? (out as Utm) : null;
}

function refOf(v: VisitorWithRefs): VisitorRef | null {
  if (v.contact) return { type: 'contact', id: v.contact.id, name: [v.contact.firstName, v.contact.lastName].filter(Boolean).join(' '), email: v.contact.email };
  if (v.lead) return { type: 'lead', id: v.lead.id, name: v.lead.fullName, email: v.lead.email };
  return null;
}
