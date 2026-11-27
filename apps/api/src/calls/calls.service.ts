import { ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import type { Dialer, PhoneCall, Prisma, TenantTx } from '@dealflow/database';
import {
  type CallControlInput,
  type CallDetails,
  type CallFavorite,
  type CallHandoff,
  type CallListQuery,
  type CallLogInput,
  type CallOutcomeDef,
  type CallOutcomeInput,
  type CallRow,
  type CallStarted,
  type CallStartInput,
  type CallStats,
  type CallStatus,
  type CallTarget,
  type CallUpdateInput,
  callWindow,
  dialable,
  type DialerKind,
  DEFAULT_CALL_OUTCOMES,
  e164,
  fillDialerTemplate,
  mergeOutcomes,
  type ProviderEvent,
  readProviderEvent,
  RECORDING_MAX_BYTES,
  RECORDING_TYPES,
  type RecordingListQuery,
  type RecordingRow,
  type RecordingSource,
  startOfDayIn,
} from '@dealflow/types';
import { AuditService } from '../audit/audit.service';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { TwilioClient } from '../apps/twilio';
import { CompanyLogosService } from '../crm/company-logos.service';
import { CompanyWorkService } from '../crm/company-work.service';
import { DealsService } from '../crm/deals.service';
import { canSeeDetails, companyScope, contactScope, personRefs, reportingTree, scopeOf, visibility, type Visibility } from '../crm/visibility';
import { ApiAdapter, configOf, controlName, DialerError } from './dialer-adapters';
import { callError, DialersService, PHONE_APP } from './dialers.service';

const DAY = 86_400_000;
const fullName = (c: { firstName: string; lastName?: string | null }) => [c.firstName, c.lastName].filter(Boolean).join(' ');
const LIVE: CallStatus[] = ['OPEN', 'REQUESTED', 'RINGING', 'IN_PROGRESS', 'ON_HOLD'];

/** Twilio's call states, as the Calls page shows them. */
const TWILIO_STATUS: Record<string, CallStatus> = { queued: 'RINGING', initiated: 'RINGING', ringing: 'RINGING', 'in-progress': 'IN_PROGRESS', answered: 'IN_PROGRESS', completed: 'ENDED', busy: 'FAILED', 'no-answer': 'FAILED', failed: 'FAILED', canceled: 'FAILED' };

/**
 * The Calls section (ADR 0088, universal dialer ADR 0089): the call card with everything about the company and employee
 * being called, placing a call through the chosen dialer's adapter, in-call controls the dialer supports, logging the
 * outcome (with the follow-up it suggests, and the company and contact updated), the provider's status and recording
 * events, recordings, favourites, outcomes and the call history. A call is always the caller's own; managers see their
 * team's history as record visibility allows.
 */
@Injectable()
export class CallsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly work: CompanyWorkService,
    private readonly deals: DealsService,
    private readonly logos: CompanyLogosService,
    private readonly twilio: TwilioClient,
    private readonly dialers: DialersService,
    private readonly apiAdapter: ApiAdapter,
  ) {}

  // ─── Who is being called ───

  /** Companies and employees by name, email or number, with the numbers on file. */
  search(auth: AuthContext, q: string): Promise<CallTarget[]> {
    return this.prisma.run(auth, async (tx) => {
      const v = await visibility(tx, auth);
      const text = { contains: q, mode: 'insensitive' as const };
      const digits = q.replace(/\D/g, '');
      const [companies, contacts] = await Promise.all([
        tx.company.findMany({
          where: { tenantId: auth.tenantId, deletedAt: null, AND: [companyScope(v), { OR: [{ name: text }, { leadNumber: text }, ...(digits.length >= 4 ? [{ primaryPhone: { contains: digits.slice(-7) } }] : [])] }] },
          select: { id: true, name: true, primaryPhone: true, country: true, industry: true, ownerId: true },
          orderBy: { name: 'asc' },
          take: 8,
        }),
        tx.contact.findMany({
          where: {
            tenantId: auth.tenantId,
            deletedAt: null,
            AND: [contactScope(v), { OR: [{ firstName: text }, { lastName: text }, { email: text }, ...(digits.length >= 4 ? [{ phoneDigits: { contains: digits.slice(-10) } }] : [])] }],
          },
          select: { id: true, firstName: true, lastName: true, jobTitle: true, phone: true, companyId: true, ownerId: true },
          orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
          take: 12,
        }),
      ]);
      return this.targets(tx, auth, v, companies, contacts);
    });
  }

  private async targets(
    tx: TenantTx,
    auth: AuthContext,
    v: Visibility,
    companies: { id: string; name: string; primaryPhone: string | null; country: string | null; industry: string | null; ownerId: string | null }[],
    contacts: { id: string; firstName: string; lastName: string | null; jobTitle: string | null; phone: string | null; companyId: string | null; ownerId: string | null }[],
  ): Promise<CallTarget[]> {
    const companyIds = [...new Set(contacts.map((c) => c.companyId).filter((x): x is string => !!x))];
    const owners = await tx.company.findMany({ where: { tenantId: auth.tenantId, id: { in: companyIds } }, select: { id: true, name: true, primaryPhone: true, ownerId: true } });
    const byId = new Map(owners.map((c) => [c.id, c]));
    const logos = await this.logos.refsIn(tx, auth.tenantId, [...companies.map((c) => c.id), ...companyIds]);
    return [
      ...companies.map<CallTarget>((c) => ({
        kind: 'company',
        companyId: c.id,
        contactId: null,
        name: c.name,
        subtitle: [c.industry, c.country].filter(Boolean).join(' · ') || null,
        phone: null,
        companyPhone: canSeeDetails(v, c.ownerId) ? c.primaryPhone : null,
        companyName: c.name,
        logo: logos.get(c.id) ?? null,
      })),
      ...contacts.map<CallTarget>((c) => {
        const co = c.companyId ? byId.get(c.companyId) : undefined;
        return {
          kind: 'employee',
          companyId: c.companyId,
          contactId: c.id,
          name: fullName(c),
          subtitle: [c.jobTitle, co?.name].filter(Boolean).join(' · ') || null,
          phone: canSeeDetails(v, c.ownerId) ? c.phone : null,
          companyPhone: co && canSeeDetails(v, co.ownerId) ? co.primaryPhone : null,
          companyName: co?.name ?? null,
          logo: c.companyId ? (logos.get(c.companyId) ?? null) : null,
        };
      }),
    ];
  }

  /** The call card: the company and employee, their numbers, their local time, the last and next call, open deals. */
  details(auth: AuthContext, ids: { companyId?: string | null; contactId?: string | null }): Promise<CallDetails> {
    return this.prisma.run(auth, (tx) => this.detailsIn(tx, auth, ids));
  }

  private async detailsIn(tx: TenantTx, auth: AuthContext, ids: { companyId?: string | null; contactId?: string | null }): Promise<CallDetails> {
    if (!ids.companyId && !ids.contactId) throw callError('Choose a company or an employee to call.');
    const v = await visibility(tx, auth);
    const contact = ids.contactId
      ? await tx.contact.findFirst({
          where: { id: ids.contactId, tenantId: auth.tenantId, deletedAt: null, ...contactScope(v) },
          select: { id: true, firstName: true, lastName: true, jobTitle: true, email: true, phone: true, timezone: true, companyId: true, ownerId: true, phoneFlaggedAt: true, notInterestedAt: true },
        })
      : null;
    if (ids.contactId && !contact) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Employee not found.' });
    const companyId = ids.companyId ?? contact?.companyId ?? null;
    if (ids.companyId && contact?.companyId && contact.companyId !== ids.companyId) throw callError('This employee does not work at this company.');
    const company = companyId
      ? await tx.company.findFirst({ where: { id: companyId, tenantId: auth.tenantId, deletedAt: null, ...companyScope(v) }, select: { id: true, name: true, primaryPhone: true, leadNumber: true, country: true, timezone: true, ownerId: true, phoneFlaggedAt: true } })
      : null;
    if (ids.companyId && !company) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Company not found.' });
    const companyDetails = !company || canSeeDetails(v, company.ownerId);
    const contactDetails = !contact || canSeeDetails(v, contact.ownerId);
    const colleagues = company
      ? await tx.contact.findMany({
          where: { tenantId: auth.tenantId, companyId: company.id, deletedAt: null, phone: { not: null }, ...contactScope(v) },
          select: { id: true, firstName: true, lastName: true, jobTitle: true, phone: true, ownerId: true },
          orderBy: [{ firstName: 'asc' }],
          take: 30,
        })
      : [];
    const about: Prisma.ActivityWhereInput = contact ? { contactId: contact.id } : { companyId: company!.id };
    const callsAbout: Prisma.PhoneCallWhereInput = { tenantId: auth.tenantId, deletedAt: null, ...(contact ? { contactId: contact.id } : { companyId: company!.id }) };
    const [last, next, callCount, reachedCount, deals, fav] = await Promise.all([
      tx.activity.findFirst({ where: { tenantId: auth.tenantId, deletedAt: null, type: 'CALL', ...about }, orderBy: { occurredAt: 'desc' }, select: { id: true, occurredAt: true, outcome: true, ownerId: true, body: true } }),
      tx.task.findFirst({
        where: { tenantId: auth.tenantId, deletedAt: null, status: 'OPEN', followUpType: 'CALL', ...(contact ? { contactId: contact.id } : { companyId: company!.id }) },
        orderBy: { dueAt: 'asc' },
        select: { id: true, dueAt: true, title: true },
      }),
      tx.phoneCall.count({ where: callsAbout }),
      tx.phoneCall.count({ where: { ...callsAbout, outcome: { in: await this.reachedKeys(tx, auth.tenantId) } } }),
      company ? tx.opportunity.findMany({ where: { tenantId: auth.tenantId, companyId: company.id, deletedAt: null, status: 'OPEN' }, select: { id: true, name: true, amount: true, currency: true, stage: { select: { name: true } } }, orderBy: { updatedAt: 'desc' }, take: 10 }) : [],
      tx.callFavorite.findFirst({ where: { tenantId: auth.tenantId, userId: auth.userId, contactId: contact?.id ?? null, companyId: contact ? undefined : (company?.id ?? null) } }),
    ]);
    const lastCall = last ? await tx.phoneCall.findFirst({ where: { tenantId: auth.tenantId, activityId: last.id }, select: { outcome: true } }) : null;
    const logo = company ? ((await this.logos.refsIn(tx, auth.tenantId, [company.id])).get(company.id) ?? null) : null;
    const lastBy = last?.ownerId ? (await personRefs(tx, auth.tenantId, [last.ownerId])).get(last.ownerId) : undefined;
    return {
      company: company ? { id: company.id, name: company.name, phone: companyDetails ? company.primaryPhone : null, leadNumber: company.leadNumber, logo, country: company.country, timezone: company.timezone, phoneFlagged: !!company.phoneFlaggedAt } : null,
      employee: contact
        ? { id: contact.id, name: fullName(contact), designation: contact.jobTitle, email: contactDetails ? contact.email : null, phone: contactDetails ? contact.phone : null, timezone: contact.timezone, phoneFlagged: !!contact.phoneFlaggedAt, notInterested: !!contact.notInterestedAt }
        : null,
      detailsHidden: !companyDetails || !contactDetails,
      colleagues: colleagues.filter((c) => canSeeDetails(v, c.ownerId) && c.phone).map((c) => ({ id: c.id, name: fullName(c), designation: c.jobTitle, phone: c.phone! })),
      localTime: callWindow(contact?.timezone || company?.timezone),
      lastCall: last ? { at: last.occurredAt.toISOString(), outcome: lastCall?.outcome ?? null, by: lastBy?.name ?? null, remarks: last.body } : null,
      nextCall: next?.dueAt ? { id: next.id, dueAt: next.dueAt.toISOString(), title: next.title } : null,
      callCount,
      reachedCount,
      deals: deals.map((d) => ({ id: d.id, name: d.name, stage: d.stage?.name ?? null, amount: d.amount, currency: d.currency })),
      favorite: !!fav,
    };
  }

  /** Clears the "check this number" flag once the number is corrected or confirmed. */
  clearFlag(auth: AuthContext, ids: { companyId?: string | null; contactId?: string | null }, meta: RequestMeta): Promise<void> {
    return this.prisma.run(auth, async (tx) => {
      const v = await visibility(tx, auth);
      if (ids.contactId) {
        const c = await tx.contact.findFirst({ where: { id: ids.contactId, tenantId: auth.tenantId, deletedAt: null, ...contactScope(v) }, select: { id: true } });
        if (!c) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Employee not found.' });
        await tx.contact.update({ where: { id: c.id }, data: { phoneFlaggedAt: null } });
      } else if (ids.companyId) {
        const c = await tx.company.findFirst({ where: { id: ids.companyId, tenantId: auth.tenantId, deletedAt: null, ...companyScope(v) }, select: { id: true } });
        if (!c) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Company not found.' });
        await tx.company.update({ where: { id: c.id }, data: { phoneFlaggedAt: null } });
      }
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'call.number_flag_cleared', entityType: ids.contactId ? 'contact' : 'company', entityId: (ids.contactId ?? ids.companyId)!, meta });
    });
  }

  // ─── Favourites ───

  favorites(auth: AuthContext): Promise<CallFavorite[]> {
    return this.prisma.run(auth, async (tx) => {
      const favs = await tx.callFavorite.findMany({ where: { tenantId: auth.tenantId, userId: auth.userId }, orderBy: { createdAt: 'asc' }, take: 50 });
      const v = await visibility(tx, auth);
      const [companies, contacts] = await Promise.all([
        tx.company.findMany({ where: { tenantId: auth.tenantId, deletedAt: null, id: { in: favs.filter((f) => !f.contactId && f.companyId).map((f) => f.companyId!) }, ...companyScope(v) }, select: { id: true, name: true, primaryPhone: true, country: true, industry: true, ownerId: true, lastCallAt: true } }),
        tx.contact.findMany({ where: { tenantId: auth.tenantId, deletedAt: null, id: { in: favs.filter((f) => f.contactId).map((f) => f.contactId!) }, ...contactScope(v) }, select: { id: true, firstName: true, lastName: true, jobTitle: true, phone: true, companyId: true, ownerId: true, lastCallAt: true } }),
      ]);
      const targets = await this.targets(tx, auth, v, companies, contacts);
      const last = new Map<string, Date | null>([...companies.map((c) => [c.id, c.lastCallAt] as const), ...contacts.map((c) => [c.id, c.lastCallAt] as const)]);
      return favs
        .map((f) => {
          const t = targets.find((x) => (f.contactId ? x.contactId === f.contactId : x.kind === 'company' && x.companyId === f.companyId));
          return t ? { ...t, id: f.id, lastCallAt: last.get(f.contactId ?? f.companyId!)?.toISOString() ?? null } : null;
        })
        .filter((x): x is CallFavorite => !!x);
    });
  }

  setFavorite(auth: AuthContext, ids: { companyId?: string | null; contactId?: string | null }, on: boolean): Promise<void> {
    return this.prisma.run(auth, async (tx) => {
      const d = await this.detailsIn(tx, auth, ids);
      const where = { tenantId: auth.tenantId, userId: auth.userId, contactId: d.employee?.id ?? null, ...(d.employee ? {} : { companyId: d.company?.id ?? null }) };
      const existing = await tx.callFavorite.findFirst({ where });
      if (on && !existing) {
        if ((await tx.callFavorite.count({ where: { tenantId: auth.tenantId, userId: auth.userId } })) >= 50) throw callError('You can keep up to 50 favourites.');
        await tx.callFavorite.create({ data: { tenantId: auth.tenantId, userId: auth.userId, companyId: d.company?.id ?? null, contactId: d.employee?.id ?? null } });
      }
      if (!on && existing) await tx.callFavorite.delete({ where: { id: existing.id } });
    });
  }

  // ─── Outcomes ───

  outcomes(auth: AuthContext): Promise<CallOutcomeDef[]> {
    return this.prisma.run(auth, (tx) => this.outcomesIn(tx, auth.tenantId));
  }

  private async outcomesIn(tx: TenantTx, tenantId: string): Promise<CallOutcomeDef[]> {
    const rows = await tx.callOutcomeSetting.findMany({ where: { tenantId }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] });
    const def = (r: (typeof rows)[number]): CallOutcomeDef => ({ key: r.key, label: r.label, icon: r.icon, color: r.color, tone: r.tone as CallOutcomeDef['tone'], reached: r.reached, action: r.action as CallOutcomeDef['action'], followUpInMinutes: r.followUpInMinutes, custom: r.custom, active: r.active });
    return mergeOutcomes(Object.fromEntries(rows.filter((r) => !r.custom).map((r) => [r.key, def(r)])), rows.filter((r) => r.custom).map(def));
  }

  private async reachedKeys(tx: TenantTx, tenantId: string): Promise<string[]> {
    return (await this.outcomesIn(tx, tenantId)).filter((o) => o.reached).map((o) => o.key);
  }

  /** Changes one of SampForce's outcomes, or a workspace's own. */
  saveOutcome(auth: AuthContext, key: string, input: CallOutcomeInput, meta: RequestMeta): Promise<CallOutcomeDef[]> {
    return this.prisma.run(auth, async (tx) => {
      const builtIn = DEFAULT_CALL_OUTCOMES.some((d) => d.key === key);
      const existing = await tx.callOutcomeSetting.findUnique({ where: { tenantId_key: { tenantId: auth.tenantId, key } } });
      if (!builtIn && !existing) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Outcome not found.' });
      const data = { label: input.label, icon: input.icon, color: input.color, tone: input.tone, reached: input.reached, action: input.action, followUpInMinutes: input.followUpInMinutes ?? null, active: input.active };
      await tx.callOutcomeSetting.upsert({ where: { tenantId_key: { tenantId: auth.tenantId, key } }, create: { tenantId: auth.tenantId, key, custom: false, ...data }, update: data });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'call_outcome.updated', entityType: 'call_outcome', entityId: key, metadata: data, meta });
      return this.outcomesIn(tx, auth.tenantId);
    });
  }

  addOutcome(auth: AuthContext, input: CallOutcomeInput, meta: RequestMeta): Promise<CallOutcomeDef[]> {
    return this.prisma.run(auth, async (tx) => {
      const custom = await tx.callOutcomeSetting.count({ where: { tenantId: auth.tenantId, custom: true } });
      if (custom >= 30) throw callError('A workspace can have up to 30 outcomes of its own.');
      const slug = input.label.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30) || 'OUTCOME';
      let key = `CUSTOM_${slug}`;
      for (let i = 2; await tx.callOutcomeSetting.findUnique({ where: { tenantId_key: { tenantId: auth.tenantId, key } } }); i++) key = `CUSTOM_${slug}_${i}`;
      await tx.callOutcomeSetting.create({ data: { tenantId: auth.tenantId, key, custom: true, sortOrder: custom, label: input.label, icon: input.icon, color: input.color, tone: input.tone, reached: input.reached, action: input.action, followUpInMinutes: input.followUpInMinutes ?? null, active: input.active } });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'call_outcome.created', entityType: 'call_outcome', entityId: key, metadata: { label: input.label }, meta });
      return this.outcomesIn(tx, auth.tenantId);
    });
  }

  /** A workspace's own outcome is removed; calls logged with it keep its key and show it as "Other". */
  removeOutcome(auth: AuthContext, key: string, meta: RequestMeta): Promise<CallOutcomeDef[]> {
    return this.prisma.run(auth, async (tx) => {
      const existing = await tx.callOutcomeSetting.findUnique({ where: { tenantId_key: { tenantId: auth.tenantId, key } } });
      if (!existing) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Outcome not found.' });
      if (!existing.custom) {
        // SampForce's own go back to how they were.
        await tx.callOutcomeSetting.delete({ where: { id: existing.id } });
      } else if (await tx.phoneCall.count({ where: { tenantId: auth.tenantId, outcome: key } })) {
        await tx.callOutcomeSetting.update({ where: { id: existing.id }, data: { active: false } });
      } else {
        await tx.callOutcomeSetting.delete({ where: { id: existing.id } });
      }
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'call_outcome.deleted', entityType: 'call_outcome', entityId: key, meta });
      return this.outcomesIn(tx, auth.tenantId);
    });
  }

  // ─── Placing calls ───

  async start(auth: AuthContext, input: CallStartInput, meta: RequestMeta): Promise<CallStarted> {
    const prepared = await this.prisma.run(auth, async (tx) => {
      const d = input.companyId || input.contactId ? await this.detailsIn(tx, auth, input) : null;
      const dialer = input.dialerId
        ? await this.dialers.own(tx, auth, input.dialerId)
        : await tx.dialer.findFirst({ where: { tenantId: auth.tenantId, userId: auth.userId, deletedAt: null, isDefault: true, active: true } });
      if (dialer && !dialer.active) throw callError(`${dialer.name} is switched off. Switch it on in Dialer settings, or choose another dialer.`);
      const config = dialer ? configOf(dialer) : null;
      const written = input.numberSource === 'EMPLOYEE' ? d?.employee?.phone : input.numberSource === 'COMPANY' ? d?.company?.phone : input.number;
      if (!written?.trim()) throw callError(input.numberSource === 'COMPANY' ? 'This company has no phone number on file.' : input.numberSource === 'EMPLOYEE' ? 'This employee has no phone number on file.' : 'Type the number to call.');
      if (written.replace(/\D/g, '').length < 3) throw callError('That does not look like a phone number.');
      const country = input.countryCode ?? config?.defaultCountryCode ?? null;
      // A number typed without its country code gets the chosen one; numbers on records are kept as written.
      const number = input.numberSource === 'OTHER' && country && !/^(\+|00)/.test(written.trim()) && written.replace(/\D/g, '').length >= 6 ? `${country} ${written.trim().replace(/^0+/, '')}` : written.trim();
      const kind = (dialer?.kind ?? 'LINK') as DialerKind;
      if (config && !config.allowOutgoing) throw callError(`${dialer!.name} is set for incoming calls only.`);
      const intl = e164(number, config?.defaultCountryCode);
      if ((kind === 'TWILIO' || kind === 'API') && !intl) throw callError('This dialer needs the number with its country code, for example +44 7700 900123.');
      if (config?.regions.length && intl) {
        const { CALLING_CODES } = await import('@dealflow/types');
        const allowed = CALLING_CODES.filter((c) => config.regions.includes(c.country)).map((c) => c.code);
        if (!allowed.some((c) => intl.startsWith(c))) throw callError(`${dialer!.name} only calls ${config.regions.join(', ')}. Choose another dialer for this number.`);
      }
      const callerId = input.callerId ?? config?.callerIds[0] ?? null;
      if (input.callerId && !config?.callerIds.includes(input.callerId)) throw callError('Choose one of the dialer’s caller ids.');
      const ctx = dialer ? await this.dialers.context(tx, dialer) : null;
      if (kind === 'TWILIO' && !ctx?.twilio) throw callError('Twilio is not connected any more. Choose another dialer, or ask a workspace admin to connect Twilio in Integrations.');
      const policy = await this.dialers.policyIn(tx, auth.tenantId);
      const record = !!config && policy.enabled && config.recording === 'ALWAYS' && (!policy.requireConsent || !!input.recordingConsent);
      if (input.dealId && !(d?.deals.some((x) => x.id === input.dealId))) throw callError('This deal is not an open deal of the company.');
      const handoff: CallHandoff = {
        companyName: d?.company?.name ?? null,
        companyPhone: d?.company?.phone ?? null,
        employeeName: d?.employee?.name ?? null,
        designation: d?.employee?.designation ?? null,
        email: d?.employee?.email ?? null,
        employeePhone: d?.employee?.phone ?? null,
      };
      const call = await tx.phoneCall.create({
        data: {
          tenantId: auth.tenantId,
          userId: auth.userId,
          companyId: d?.company?.id ?? null,
          contactId: d?.employee?.id ?? null,
          dealId: input.dealId ?? null,
          direction: 'OUTGOING',
          number,
          numberSource: input.numberSource,
          callerId,
          dialerId: dialer?.id ?? null,
          dialerName: dialer?.name ?? PHONE_APP.name,
          dialerKind: kind,
          dialerProvider: dialer?.provider ?? (dialer ? null : 'phone'),
          status: kind === 'LINK' ? 'OPEN' : 'RINGING',
          details: handoff as unknown as Prisma.InputJsonValue,
          searchText: [handoff.companyName, handoff.employeeName, number, number.replace(/\D/g, '')].filter(Boolean).join(' ').toLowerCase(),
          recordingConsent: !!input.recordingConsent,
          recordingActive: record,
        },
      });
      if (dialer) await tx.dialer.update({ where: { id: dialer.id }, data: { lastUsedAt: new Date() } });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'call.started', entityType: 'phone_call', entityId: call.id, metadata: { dialer: kind, provider: dialer?.provider ?? null, companyId: call.companyId, contactId: call.contactId }, meta });
      const me = await tx.user.findUnique({ where: { id: auth.userId }, select: { name: true, email: true } });
      return { call, dialer, ctx, handoff, me, record, intl };
    });
    const { call, dialer, ctx, handoff, me, record, intl } = prepared;
    const base = {
      phone: call.number,
      phoneE164: intl ?? dialable(call.number),
      phoneDigits: call.number.replace(/\D/g, ''),
      phoneNational: (intl ?? call.number).replace(/^\+/, '').replace(/\D/g, ''),
      companyName: handoff.companyName,
      companyPhone: handoff.companyPhone,
      employeeName: handoff.employeeName,
      designation: handoff.designation,
      email: handoff.email,
      employeePhone: handoff.employeePhone,
      callId: call.id,
      companyUrl: call.companyId ? `${this.dialers.webUrl()}/app/companies/${call.companyId}` : null,
    };
    const values = ctx ? this.dialers.values(ctx, base, me, call.callerId) : base;
    const update: Prisma.PhoneCallUpdateInput = {};
    // The details go to the dialer's webhook too. A failed delivery is shown on the call; the call itself goes ahead.
    if (dialer?.webhookUrl && dialer.webhookSecretEncrypted) {
      const r = await this.dialers.postWebhook(
        dialer,
        'call.started',
        { event: 'call.started', callId: call.id, startedAt: call.startedAt.toISOString(), number: call.number, numberE164: intl, callerId: call.callerId, dialer: { id: dialer.id, name: dialer.name }, caller: { id: auth.userId, name: me?.name ?? null, email: me?.email ?? null }, company: call.companyId ? { id: call.companyId, name: handoff.companyName, phone: handoff.companyPhone, url: base.companyUrl } : null, employee: call.contactId ? { id: call.contactId, name: handoff.employeeName, designation: handoff.designation, email: handoff.email, phone: handoff.employeePhone } : null },
        call.id,
      );
      Object.assign(update, { webhookStatus: r.ok ? 'SENT' : 'FAILED', webhookAt: new Date(), webhookError: r.error });
    }
    let launchUrl: string | null = null;
    let sipTarget: string | null = null;
    let failure: string | null = null;
    if (!dialer) {
      launchUrl = fillDialerTemplate(PHONE_APP.urlTemplate, values);
    } else {
      const adapter = this.dialers.adapters.for(dialer.kind);
      const log = this.dialers.logger(dialer, call.id);
      try {
        const placed = await adapter.place({ ...ctx!, call, values, record, log, twilio: ctx!.twilio, statusCallback: ctx!.twilio ? this.dialers.statusUrl((await this.twilioHook(auth))!, call.id) : null } as never);
        launchUrl = placed.launchUrl ?? null;
        sipTarget = placed.sipTarget ?? null;
        Object.assign(update, { providerCallId: placed.providerCallId ?? null, providerStatus: placed.providerStatus ?? null, ...(placed.status ? { status: placed.status } : {}) });
        if (dialer.kind === 'API' || dialer.kind === 'TWILIO') await this.dialers.setStatus(dialer, true, 'The last call was placed.');
        if (dialer.kind === 'API') await log({ action: 'PLACE', ok: true, message: `Call placed${placed.providerCallId ? ` (provider id ${placed.providerCallId})` : ''}.` });
      } catch (e) {
        if (!(e instanceof DialerError)) throw e;
        failure = e.message;
        Object.assign(update, { status: 'FAILED', error: e.message, endedAt: new Date(), recordingActive: false });
        await this.dialers.setStatus(dialer, false, e.message);
      }
    }
    const saved = Object.keys(update).length ? await this.prisma.run(auth, (tx) => tx.phoneCall.update({ where: { id: call.id }, data: update })) : call;
    if (failure) throw callError(failure);
    return { call: (await this.rows(auth, [saved]))[0]!, launchUrl, sipTarget };
  }

  private async twilioHook(auth: AuthContext): Promise<string | null> {
    return this.prisma.run(auth, async (tx) => (await this.dialers.twilioConnection(tx, auth.tenantId))?.hookId ?? null);
  }

  /** In-call controls: what the call's dialer can do. Others are refused with the reason. */
  async control(auth: AuthContext, id: string, input: CallControlInput, meta: RequestMeta): Promise<CallRow> {
    const { call, dialer, ctx, policy, hook } = await this.prisma.run(auth, async (tx) => {
      const call = await this.ownCall(tx, auth, id);
      const dialer = call.dialerId ? await tx.dialer.findFirst({ where: { id: call.dialerId, tenantId: auth.tenantId } }) : null;
      return { call, dialer, ctx: dialer ? await this.dialers.context(tx, dialer) : null, policy: await this.dialers.policyIn(tx, auth.tenantId), hook: (await this.dialers.twilioConnection(tx, auth.tenantId))?.hookId ?? null };
    });
    if (!LIVE.includes(call.status as CallStatus) && input.action !== 'HANGUP') throw callError('This call has ended.');
    const update: Prisma.PhoneCallUpdateInput = {};
    if (input.action.startsWith('RECORD')) {
      if (!policy.enabled) throw callError('Recording is switched off for this workspace.');
      if (input.action === 'RECORD_START' && policy.requireConsent && !call.recordingConsent) throw callError('Confirm that the other person agreed to be recorded first.');
      if (ctx && ctx.config.recording === 'OFF') throw callError(`Recording is off for ${dialer!.name}. Turn it on in its settings.`);
    }
    if (dialer && ctx) {
      const caps = this.dialers.adapters.for(dialer.kind).capabilities(dialer, ctx.config);
      const allowed = input.action === 'HANGUP' ? caps.endCalls || dialer.kind === 'LINK' : input.action.startsWith('RECORD') ? caps.recordings : input.action === 'MUTE' || input.action === 'UNMUTE' ? caps.mute : caps.hold;
      if (!allowed) throw callError(`${controlName(input.action)} is not available with ${dialer.name}.`);
      try {
        await this.dialers.adapters.for(dialer.kind).control({ ...ctx, call, values: {}, record: false, log: this.dialers.logger(dialer, call.id), twilio: ctx.twilio } as never, input.action, { recordingCallback: hook ? `${this.dialers.statusUrl(hook, call.id)}?leg=recording` : '' });
      } catch (e) {
        if (e instanceof DialerError) throw callError(e.message);
        throw e;
      }
    } else if (input.action !== 'HANGUP') {
      throw callError(`${controlName(input.action)} is not available with the phone app.`);
    }
    if (input.action === 'HANGUP' && LIVE.includes(call.status as CallStatus)) Object.assign(update, { status: 'ENDED', endedAt: new Date(), ...(call.answeredAt && !call.durationSec ? { durationSec: Math.round((Date.now() - call.answeredAt.getTime()) / 1000) } : {}) });
    if (input.action === 'MUTE' || input.action === 'UNMUTE') update.muted = input.action === 'MUTE';
    if (input.action === 'HOLD' || input.action === 'RESUME') Object.assign(update, { onHold: input.action === 'HOLD', status: input.action === 'HOLD' ? 'ON_HOLD' : 'IN_PROGRESS' });
    if (input.action === 'RECORD_START' || input.action === 'RECORD_STOP') update.recordingActive = input.action === 'RECORD_START';
    const row = await this.prisma.run(auth, async (tx) => {
      const saved = Object.keys(update).length ? await tx.phoneCall.update({ where: { id }, data: update }) : call;
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: `call.${input.action.toLowerCase()}`, entityType: 'phone_call', entityId: id, meta });
      return saved;
    });
    return (await this.rows(auth, [row]))[0]!;
  }

  /** The caller confirms the other person agreed to be recorded (the workspace policy asks for it). */
  consent(auth: AuthContext, id: string, meta: RequestMeta): Promise<CallRow> {
    return this.prisma.run(auth, async (tx) => {
      await this.ownCall(tx, auth, id);
      const saved = await tx.phoneCall.update({ where: { id }, data: { recordingConsent: true } });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'call.recording_consent', entityType: 'phone_call', entityId: id, meta });
      return (await this.rowsIn(tx, auth.tenantId, [saved]))[0]!;
    });
  }

  // ─── Logging ───

  /**
   * Logs the call: outcome, remarks and talk time; a call interaction on the company and contact timelines; the
   * follow-up the outcome suggests; the number flagged, the contact marked not interested or a deal created when asked.
   * The company and contact keep the last call, its outcome and how many calls there were.
   */
  async log(auth: AuthContext, id: string, input: CallLogInput, meta: RequestMeta): Promise<CallRow> {
    const { call, outcomes } = await this.prisma.run(auth, async (tx) => ({ call: await this.ownCall(tx, auth, id), outcomes: await this.outcomesIn(tx, auth.tenantId) }));
    if (call.status === 'LOGGED') throw callError('This call is already logged. Edit it from the call history.');
    const outcome = outcomes.find((o) => o.key === input.outcome && o.active);
    if (!outcome) throw callError('Choose what happened on the call.');
    const followUp = input.followUp ?? (input.nextCallAt ? { type: 'CALL' as const, at: input.nextCallAt, note: input.nextCallNote ?? null } : null);
    if (followUp && !call.companyId) throw callError('Only calls to a company or employee can schedule a follow-up. Find them in the search first.');
    if (followUp && new Date(followUp.at).getTime() < Date.now() - 60_000) throw callError('Choose a time in the future for the follow-up.');
    if (input.createDeal && !call.companyId) throw callError('Only a call to a company can create a deal.');
    if (input.createDeal && !auth.permissions.includes('deals:write')) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Creating deals needs the deals permission.' });
    if (input.markNotInterested && !call.contactId) throw callError('Only a call to an employee can mark them not interested.');
    const handoff = call.details as unknown as CallHandoff;
    const label = outcome.label;
    const who = handoff.employeeName ?? handoff.companyName ?? call.number;
    let activityId: string | null = null;
    let followUpId: string | null = null;
    let dealId = input.dealId ?? call.dealId ?? null;
    if (dealId && call.companyId) {
      const ok = await this.prisma.run(auth, (tx) => tx.opportunity.count({ where: { id: dealId!, tenantId: auth.tenantId, companyId: call.companyId, deletedAt: null } }));
      if (!ok) throw callError('This deal is not one of the company’s deals.');
    }
    if (input.createDeal && call.companyId) {
      const deal = await this.deals.create(auth, { name: input.createDeal.name, amount: input.createDeal.amount, currency: input.createDeal.currency, companyId: call.companyId, contactId: call.contactId } as Parameters<DealsService['create']>[1], meta);
      dealId = deal.id;
    }
    const minutes = (s: number | null | undefined) => (s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : null);
    const duration = input.durationSec ?? call.durationSec ?? null;
    if (call.companyId) {
      const interaction = await this.work.logInteraction(
        auth,
        {
          companyId: call.companyId,
          contactId: call.contactId,
          kind: call.direction === 'INCOMING' ? 'CALL_INCOMING' : 'CALL_OUTGOING',
          subject: `Call with ${who}: ${label}`.slice(0, 200),
          occurredAt: call.startedAt.toISOString(),
          recipient: call.number,
          outcome: label,
          // The talk time goes on the timeline with the remarks.
          ...(minutes(duration) && input.remarks ? {} : {}),
          sentiment: input.sentiment ?? null,
          remarks: input.remarks ?? null,
          nextAction: followUp ? (followUp.note ?? (followUp.type === 'EMAIL' ? 'Email the details' : followUp.type === 'MEETING' ? 'Meeting' : 'Call again')) : null,
          followUpAt: null,
        },
        meta,
        // Nobody answered: an attempt, which neither moves the employee's stage nor stops the email cadence.
        { attempt: !outcome.reached },
      );
      activityId = interaction.id;
      if (followUp) {
        const title = followUp.note || (followUp.type === 'EMAIL' ? `Email the details to ${who}` : followUp.type === 'MEETING' ? `Meeting with ${who}` : outcome.action === 'CALLBACK' ? `Call ${who} back` : `Call ${who} again`);
        const f = await this.work.createFollowUp(
          auth,
          { companyId: call.companyId, contactId: call.contactId, type: followUp.type, title: title.slice(0, 200), dueAt: followUp.at, priority: outcome.action === 'CALLBACK' ? 'HIGH' : 'NORMAL', assigneeId: auth.userId, summary: input.remarks ?? `Last call: ${label}`, nextAction: followUp.note ?? null } as Parameters<CompanyWorkService['createFollowUp']>[1],
          meta,
        );
        followUpId = f.id;
      }
    }
    const row = await this.prisma.run(auth, async (tx) => {
      const ended = call.endedAt ?? new Date();
      const saved = await tx.phoneCall.update({
        where: { id },
        data: { status: 'LOGGED', outcome: outcome.key, remarks: input.remarks ?? null, sentiment: input.sentiment ?? null, durationSec: duration, endedAt: ended, activityId, followUpId, dealId, recordingActive: false },
      });
      // The company and the contact show the last call and keep count; a wrong number is flagged for checking.
      const flag = input.flagNumber ?? outcome.action === 'FLAG_NUMBER';
      if (call.contactId) {
        await tx.contact.update({
          where: { id: call.contactId },
          data: {
            lastCallAt: call.startedAt,
            lastCallOutcome: outcome.key,
            callCount: { increment: 1 },
            ...(flag && call.numberSource === 'EMPLOYEE' ? { phoneFlaggedAt: new Date() } : {}),
            ...(input.markNotInterested ? { notInterestedAt: new Date() } : {}),
            ...(followUp && followUp.type === 'CALL' ? { nextFollowUpAt: new Date(followUp.at) } : {}),
          },
        });
      }
      if (call.companyId) {
        await tx.company.update({
          where: { id: call.companyId },
          data: { lastCallAt: call.startedAt, lastCallOutcome: outcome.key, callCount: { increment: 1 }, ...(flag && call.numberSource === 'COMPANY' ? { phoneFlaggedAt: new Date() } : {}) },
        });
      }
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'call.logged', entityType: 'phone_call', entityId: id, metadata: { outcome: outcome.key, activityId, followUpId, dealId, flagged: flag, notInterested: !!input.markNotInterested }, meta });
      return saved;
    });
    return (await this.rows(auth, [row]))[0]!;
  }

  /** Edits a logged call's outcome, remarks, talk time or deal; the call interaction on the company follows. */
  async update(auth: AuthContext, id: string, input: CallUpdateInput, meta: RequestMeta): Promise<CallRow> {
    const { call, outcomes } = await this.prisma.run(auth, async (tx) => ({ call: await this.ownCall(tx, auth, id), outcomes: await this.outcomesIn(tx, auth.tenantId) }));
    if (call.status !== 'LOGGED') throw callError('Log the call first.');
    const outcome = input.outcome ? outcomes.find((o) => o.key === input.outcome) : null;
    if (input.outcome && !outcome) throw callError('Choose what happened on the call.');
    if (input.dealId && call.companyId) {
      const ok = await this.prisma.run(auth, (tx) => tx.opportunity.count({ where: { id: input.dealId!, tenantId: auth.tenantId, companyId: call.companyId, deletedAt: null } }));
      if (!ok) throw callError('This deal is not one of the company’s deals.');
    }
    if (call.activityId && (outcome || input.remarks !== undefined || input.sentiment !== undefined)) {
      await this.work.updateInteraction(
        auth,
        call.activityId,
        { ...(outcome ? { outcome: outcome.label } : {}), ...(input.remarks !== undefined ? { remarks: input.remarks } : {}), ...(input.sentiment !== undefined ? { sentiment: input.sentiment } : {}) },
        meta,
      );
    }
    const row = await this.prisma.run(auth, async (tx) => {
      const saved = await tx.phoneCall.update({
        where: { id },
        data: {
          ...(outcome ? { outcome: outcome.key } : {}),
          ...(input.remarks !== undefined ? { remarks: input.remarks ?? null } : {}),
          ...(input.sentiment !== undefined ? { sentiment: input.sentiment ?? null } : {}),
          ...(input.durationSec !== undefined ? { durationSec: input.durationSec ?? null } : {}),
          ...(input.dealId !== undefined ? { dealId: input.dealId ?? null } : {}),
        },
      });
      if (outcome && call.contactId) {
        const latest = await tx.phoneCall.findFirst({ where: { tenantId: auth.tenantId, contactId: call.contactId, status: 'LOGGED', deletedAt: null }, orderBy: { startedAt: 'desc' }, select: { id: true } });
        if (latest?.id === id) await tx.contact.update({ where: { id: call.contactId }, data: { lastCallOutcome: outcome.key } });
      }
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'call.updated', entityType: 'phone_call', entityId: id, metadata: { fields: Object.keys(input) }, meta });
      return saved;
    });
    return (await this.rows(auth, [row]))[0]!;
  }

  /** Removes a call that was placed by mistake and never logged. */
  discard(auth: AuthContext, id: string, meta: RequestMeta): Promise<void> {
    return this.prisma.run(auth, async (tx) => {
      const call = await this.ownCall(tx, auth, id);
      if (call.status === 'LOGGED') throw callError('A logged call stays in the history. Edit its remarks instead.');
      await tx.phoneCall.update({ where: { id }, data: { deletedAt: new Date() } });
      await tx.callRecording.updateMany({ where: { tenantId: auth.tenantId, callId: id, deletedAt: null }, data: { deletedAt: new Date(), data: null } });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'call.discarded', entityType: 'phone_call', entityId: id, meta });
    });
  }

  get(auth: AuthContext, id: string): Promise<CallRow> {
    return this.prisma.run(auth, async (tx) => {
      const where = await this.historyWhere(tx, auth, 'all');
      const call = await tx.phoneCall.findFirst({ where: { AND: [where, { id }] } });
      if (!call) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Call not found.' });
      return (await this.rowsIn(tx, auth.tenantId, [call]))[0]!;
    });
  }

  // ─── History and numbers ───

  list(auth: AuthContext, q: CallListQuery): Promise<CallRow[]> {
    return this.prisma.run(auth, async (tx) => {
      const withRecording = q.hasRecording === undefined ? null : (await tx.callRecording.findMany({ where: { tenantId: auth.tenantId, deletedAt: null }, select: { callId: true } })).map((r) => r.callId);
      const where: Prisma.PhoneCallWhereInput = {
        AND: [
          await this.historyWhere(tx, auth, q.scope),
          ...(q.outcome ? [{ outcome: q.outcome }] : []),
          ...(q.status ? [{ status: q.status }] : []),
          ...(q.direction ? [{ direction: q.direction }] : []),
          ...(q.companyId ? [{ companyId: q.companyId }] : []),
          ...(q.contactId ? [{ contactId: q.contactId }] : []),
          ...(q.dialerId ? [{ dialerId: q.dialerId }] : []),
          ...(q.userId ? [{ userId: q.userId }] : []),
          ...(withRecording ? [{ id: q.hasRecording ? { in: withRecording } : { notIn: withRecording } }] : []),
          ...(q.q ? [{ searchText: { contains: q.q.toLowerCase() } }] : []),
          ...(q.from ? [{ startedAt: { gte: new Date(q.from) } }] : []),
          ...(q.to ? [{ startedAt: { lt: new Date(q.to) } }] : []),
          ...(q.before && q.sort === 'newest' ? [{ startedAt: { lt: new Date(q.before) } }] : []),
        ],
      };
      const orderBy: Prisma.PhoneCallOrderByWithRelationInput[] =
        q.sort === 'oldest' ? [{ startedAt: 'asc' }] : q.sort === 'longest' ? [{ durationSec: 'desc' }, { startedAt: 'desc' }] : q.sort === 'company' ? [{ searchText: 'asc' }, { startedAt: 'desc' }] : [{ startedAt: 'desc' }, { id: 'desc' }];
      const rows = await tx.phoneCall.findMany({ where, orderBy, take: q.limit });
      return this.rowsIn(tx, auth.tenantId, rows);
    });
  }

  stats(auth: AuthContext, tz: string): Promise<CallStats> {
    return this.prisma.run(auth, async (tx) => {
      await this.purgeExpired(tx, auth.tenantId);
      const now = new Date();
      const today = startOfDayIn(now, tz);
      const tomorrow = new Date(today.getTime() + DAY);
      const dow = (new Date(today.getTime() + 12 * 3600_000).getUTCDay() + 6) % 7;
      const weekStart = startOfDayIn(new Date(today.getTime() - dow * DAY + 12 * 3600_000), tz);
      const mine = { tenantId: auth.tenantId, userId: auth.userId, deletedAt: null };
      const reached = new Set(await this.reachedKeys(tx, auth.tenantId));
      const week = await tx.phoneCall.findMany({ where: { ...mine, startedAt: { gte: weekStart, lt: tomorrow } }, select: { outcome: true, durationSec: true, status: true, startedAt: true } });
      const todays = week.filter((c) => c.startedAt >= today);
      const tasks = { tenantId: auth.tenantId, deletedAt: null, status: 'OPEN' as const, followUpType: 'CALL', assigneeId: auth.userId };
      const [notLogged, nextCallsToday, overdueCalls, ringing] = await Promise.all([
        tx.phoneCall.count({ where: { ...mine, status: { notIn: ['LOGGED', 'MISSED'] }, direction: 'OUTGOING' } }),
        tx.task.count({ where: { ...tasks, dueAt: { gte: now < today ? today : now, lt: tomorrow } } }),
        tx.task.count({ where: { ...tasks, dueAt: { lt: now } } }),
        tx.phoneCall.findMany({ where: { ...mine, direction: 'INCOMING', status: 'RINGING', startedAt: { gte: new Date(now.getTime() - 5 * 60_000) } }, orderBy: { startedAt: 'desc' }, take: 3 }),
      ]);
      const byOutcome = new Map<string, number>();
      for (const c of todays) if (c.outcome) byOutcome.set(c.outcome, (byOutcome.get(c.outcome) ?? 0) + 1);
      return {
        today: { calls: todays.length, reached: todays.filter((c) => c.outcome && reached.has(c.outcome)).length, talkSec: todays.reduce((s, c) => s + (c.durationSec ?? 0), 0), notLogged },
        nextCallsToday,
        overdueCalls,
        week: Array.from({ length: 7 }, (_, i) => {
          const from = new Date(weekStart.getTime() + i * DAY);
          const to = new Date(from.getTime() + DAY);
          const day = week.filter((c) => c.startedAt >= from && c.startedAt < to);
          return { day: from.toISOString(), calls: day.length, reached: day.filter((c) => c.outcome && reached.has(c.outcome)).length };
        }),
        outcomes: [...byOutcome].map(([outcome, count]) => ({ outcome, count })).sort((a, b) => b.count - a.count),
        ringing: await this.rowsIn(tx, auth.tenantId, ringing),
      };
    });
  }

  // ─── Provider events: status, talk time, recordings, incoming calls ───

  /** What a cloud dialer posts to its events address. The address's secret part is the proof it came from the provider. */
  async providerEvent(hookId: string, token: string, body: Record<string, unknown>): Promise<{ ok: true; callId: string | null }> {
    if (!/^[a-f0-9]{24}$/.test(hookId) || !token || token.length > 100) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Unknown events address.' });
    const dialer = await this.prisma.run({ lookup: { Dialer: { eventsHookId: hookId } } }, (tx) => tx.dialer.findFirst({ where: { eventsHookId: hookId, deletedAt: null } }));
    if (!dialer?.eventsTokenEncrypted) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Unknown events address.' });
    const real = Buffer.from(this.dialers.open(dialer.eventsTokenEncrypted));
    const given = Buffer.from(token);
    if (real.length !== given.length || !timingSafeEqual(real, given)) throw new UnauthorizedException({ code: 'BAD_TOKEN', message: 'Unknown events address.' });
    const e = readProviderEvent(body);
    const log = this.dialers.logger(dialer, e.callId);
    const callId = await this.prisma.run({ tenantId: dialer.tenantId }, (tx) => this.applyEvent(tx, dialer, e));
    await log({ action: 'EVENT', ok: !!callId, message: callId ? `Event ${e.rawStatus ?? 'received'}${e.durationSec !== null ? `, ${e.durationSec} s` : ''}${e.recordingUrl ? ', with a recording' : ''}.` : `Event ${e.rawStatus ?? ''} did not match a call.` });
    return { ok: true, callId };
  }

  private async applyEvent(tx: TenantTx, dialer: Dialer, e: ProviderEvent): Promise<string | null> {
    const config = configOf(dialer);
    let call = e.callId ? await tx.phoneCall.findFirst({ where: { id: e.callId, tenantId: dialer.tenantId, dialerId: dialer.id, deletedAt: null } }) : null;
    if (!call && e.providerCallId) call = await tx.phoneCall.findFirst({ where: { tenantId: dialer.tenantId, dialerId: dialer.id, providerCallId: e.providerCallId, deletedAt: null } });
    if (!call && e.direction === 'INCOMING' && config.allowIncoming && e.from) {
      // An incoming call the provider reports: kept for the dialer's owner, matched to the employee or company by number.
      const digits = e.from.replace(/\D/g, '');
      const contact = digits.length >= 6 ? await tx.contact.findFirst({ where: { tenantId: dialer.tenantId, deletedAt: null, phoneDigits: { endsWith: digits.slice(-9) } }, select: { id: true, firstName: true, lastName: true, jobTitle: true, email: true, phone: true, companyId: true } }) : null;
      const company = contact?.companyId
        ? await tx.company.findFirst({ where: { id: contact.companyId, tenantId: dialer.tenantId }, select: { id: true, name: true, primaryPhone: true } })
        : digits.length >= 6
          ? await tx.company.findFirst({ where: { tenantId: dialer.tenantId, deletedAt: null, primaryPhone: { contains: digits.slice(-7) } }, select: { id: true, name: true, primaryPhone: true } })
          : null;
      const handoff: CallHandoff = { companyName: company?.name ?? null, companyPhone: company?.primaryPhone ?? null, employeeName: contact ? fullName(contact) : null, designation: contact?.jobTitle ?? null, email: contact?.email ?? null, employeePhone: contact?.phone ?? null };
      call = await tx.phoneCall.create({
        data: {
          tenantId: dialer.tenantId, userId: dialer.userId, companyId: company?.id ?? null, contactId: contact?.id ?? null, direction: 'INCOMING', number: e.from, numberSource: contact ? 'EMPLOYEE' : company ? 'COMPANY' : 'OTHER',
          callerId: e.to, dialerId: dialer.id, dialerName: dialer.name, dialerKind: dialer.kind, dialerProvider: dialer.provider, status: e.status ?? 'RINGING', providerCallId: e.providerCallId, providerStatus: e.rawStatus,
          details: handoff as unknown as Prisma.InputJsonValue, searchText: [handoff.companyName, handoff.employeeName, e.from, digits].filter(Boolean).join(' ').toLowerCase(),
        },
      });
    }
    if (!call) return null;
    const logged = call.status === 'LOGGED';
    const data: Prisma.PhoneCallUpdateInput = { providerStatus: e.rawStatus ?? call.providerStatus, ...(e.providerCallId && !call.providerCallId ? { providerCallId: e.providerCallId } : {}) };
    if (e.status === 'IN_PROGRESS') Object.assign(data, { answeredAt: call.answeredAt ?? new Date(), ...(logged ? {} : { status: 'IN_PROGRESS', onHold: false }) });
    if (e.status === 'ON_HOLD' && !logged) Object.assign(data, { status: 'ON_HOLD', onHold: true });
    if (e.status === 'RINGING' && !logged && (call.status === 'OPEN' || call.status === 'REQUESTED')) data.status = 'RINGING';
    if (e.status === 'ENDED' || e.status === 'FAILED' || e.status === 'MISSED') {
      Object.assign(data, { endedAt: call.endedAt ?? new Date(), recordingActive: false });
      if (!logged) data.status = e.status === 'MISSED' || (e.status === 'FAILED' && call.direction === 'INCOMING') ? 'MISSED' : e.status === 'FAILED' ? 'FAILED' : 'ENDED';
      if (e.status === 'FAILED' && !logged) data.error = e.rawStatus === 'busy' ? 'The line was busy.' : e.rawStatus?.includes('answer') ? 'Nobody answered.' : 'The call could not be connected.';
    }
    if (e.durationSec !== null && !logged) data.durationSec = e.durationSec;
    else if (e.durationSec !== null && call.durationSec === null) data.durationSec = e.durationSec;
    await tx.phoneCall.update({ where: { id: call.id }, data });
    if (e.recordingUrl) await this.addProviderRecording(tx, call, e.recordingUrl, e.durationSec);
    return call.id;
  }

  private async addProviderRecording(tx: TenantTx, call: PhoneCall, url: string, durationSec: number | null): Promise<void> {
    if (!/^https?:\/\//i.test(url)) return;
    // The same recording sent twice (providers retry) is kept once.
    if (await tx.callRecording.findFirst({ where: { tenantId: call.tenantId, callId: call.id, providerUrl: url } })) return;
    const policy = await this.dialers.policyIn(tx, call.tenantId);
    if (!policy.enabled) return;
    await tx.callRecording.create({
      data: { tenantId: call.tenantId, callId: call.id, userId: call.userId, source: 'PROVIDER', providerUrl: url, durationSec, expiresAt: policy.retentionDays ? new Date(Date.now() + policy.retentionDays * DAY) : null },
    });
  }

  /** Twilio reports each leg's status (caller's phone: agent, person called: party) and recordings. Signed by Twilio. */
  async twilioStatus(hookId: string, callId: string, leg: string, params: Record<string, string>, signature: string | undefined): Promise<void> {
    if (!/^[a-f0-9]{24}$/.test(hookId) || !/^[0-9a-f-]{36}$/.test(callId) || !['agent', 'party', 'recording'].includes(leg)) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Unknown webhook.' });
    const conn = await this.prisma.run({ lookup: { AppConnection: { provider: 'TWILIO', externalAccountId: hookId } } }, (tx) => tx.appConnection.findFirst({ where: { provider: 'TWILIO', externalAccountId: hookId } }));
    if (!conn || conn.status === 'DISCONNECTED') throw new NotFoundException({ code: 'NOT_FOUND', message: 'Unknown webhook.' });
    const keys = JSON.parse(this.dialers.open(conn.credentialsEncrypted)) as Parameters<TwilioClient['verify']>[0];
    const url = `${this.dialers.statusUrl(hookId, callId)}?leg=${leg}`;
    if (!this.twilio.verify(keys, url, params, signature) || (params.AccountSid && params.AccountSid !== keys.accountSid)) throw new UnauthorizedException({ code: 'BAD_SIGNATURE', message: 'Signature check failed.' });
    const tstatus = (params.CallStatus ?? '').toLowerCase();
    await this.prisma.run({ tenantId: conn.tenantId }, async (tx) => {
      const call = await tx.phoneCall.findFirst({ where: { id: callId, tenantId: conn.tenantId, deletedAt: null } });
      if (!call || call.dialerKind !== 'TWILIO') return;
      if (leg === 'recording') {
        if (params.RecordingUrl && (params.RecordingStatus ?? 'completed') === 'completed') await this.addProviderRecording(tx, call, params.RecordingUrl, Number(params.RecordingDuration) || null);
        await tx.phoneCall.update({ where: { id: call.id }, data: { recordingActive: false } });
        return;
      }
      // The agent leg's SID is the one Twilio returned; the party leg is its child.
      if (leg === 'agent' && call.providerCallId && params.CallSid && params.CallSid !== call.providerCallId) return;
      if (leg === 'party' && call.providerCallId && params.ParentCallSid && params.ParentCallSid !== call.providerCallId) return;
      const data: Prisma.PhoneCallUpdateInput = { providerStatus: leg === 'party' ? `party ${tstatus}` : tstatus };
      const logged = call.status === 'LOGGED';
      if (leg === 'party') {
        if (tstatus === 'in-progress' || tstatus === 'answered') Object.assign(data, { answeredAt: call.answeredAt ?? new Date(), ...(logged ? {} : { status: 'IN_PROGRESS' }) });
        if (tstatus === 'completed') Object.assign(data, { endedAt: call.endedAt ?? new Date(), durationSec: call.durationSec ?? (Number(params.CallDuration) || 0), ...(logged ? {} : { status: 'ENDED' }) });
        if (['busy', 'no-answer', 'failed', 'canceled'].includes(tstatus)) Object.assign(data, { endedAt: call.endedAt ?? new Date(), ...(logged ? {} : { status: 'ENDED', error: partyError(tstatus) }) });
      } else {
        const mapped = TWILIO_STATUS[tstatus];
        if (mapped === 'FAILED' && !logged) Object.assign(data, { status: 'FAILED', endedAt: new Date(), error: tstatus === 'no-answer' || tstatus === 'busy' ? 'Your phone did not answer, so the call was not connected.' : 'Twilio could not ring your phone.' });
        else if (mapped === 'ENDED' && !logged && call.status !== 'ENDED') Object.assign(data, { status: 'ENDED', endedAt: call.endedAt ?? new Date() });
      }
      await tx.phoneCall.update({ where: { id: call.id }, data });
    });
  }

  // ─── Recordings ───

  recordings(auth: AuthContext, q: RecordingListQuery): Promise<RecordingRow[]> {
    return this.prisma.run(auth, async (tx) => {
      await this.purgeExpired(tx, auth.tenantId);
      const calls = await this.historyWhere(tx, auth, q.scope);
      const callFilter: Prisma.PhoneCallWhereInput = {
        AND: [
          calls,
          ...(q.dialerId ? [{ dialerId: q.dialerId }] : []),
          ...(q.userId ? [{ userId: q.userId }] : []),
          ...(q.outcome ? [{ outcome: q.outcome }] : []),
          ...(q.q ? [{ searchText: { contains: q.q.toLowerCase() } }] : []),
        ],
      };
      const callIds = (await tx.phoneCall.findMany({ where: callFilter, select: { id: true }, take: 5000, orderBy: { startedAt: 'desc' } })).map((c) => c.id);
      const rows = await tx.callRecording.findMany({
        where: {
          tenantId: auth.tenantId,
          deletedAt: null,
          callId: { in: callIds },
          ...(q.from || q.to || q.before ? { createdAt: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to || q.before ? { lt: new Date([q.to, q.before].filter(Boolean).sort()[0]!) } : {}) } } : {}),
        },
        select: { id: true, callId: true, source: true, contentType: true, sizeBytes: true, durationSec: true, notes: true, createdAt: true, expiresAt: true, providerUrl: true, userId: true },
        orderBy: { createdAt: 'desc' },
        take: q.limit,
      });
      return this.recordingRows(tx, auth, rows);
    });
  }

  private async recordingRows(tx: TenantTx, auth: AuthContext, rows: { id: string; callId: string; source: string; contentType: string | null; sizeBytes: number | null; durationSec: number | null; notes: string | null; createdAt: Date; expiresAt: Date | null; providerUrl: string | null; userId: string }[]): Promise<RecordingRow[]> {
    const calls = await tx.phoneCall.findMany({ where: { tenantId: auth.tenantId, id: { in: rows.map((r) => r.callId) } } });
    const callRows = new Map((await this.rowsIn(tx, auth.tenantId, calls)).map((c) => [c.id, c]));
    const policy = await this.dialers.policyIn(tx, auth.tenantId);
    const manager = auth.permissions.includes('members:manage') || auth.permissions.includes('tenant:manage') || scopeOf(auth) !== 'OWN';
    const canDownload = policy.download === 'ALL' || (policy.download === 'MANAGERS' && manager);
    return rows
      .map((r) => {
        const c = callRows.get(r.callId);
        if (!c) return null;
        return {
          id: r.id,
          callId: r.callId,
          source: r.source as RecordingSource,
          contentType: r.contentType,
          sizeBytes: r.sizeBytes,
          durationSec: r.durationSec,
          notes: r.notes,
          createdAt: r.createdAt.toISOString(),
          expiresAt: r.expiresAt?.toISOString() ?? null,
          playable: r.source !== 'PROVIDER' || !!r.providerUrl,
          canDownload,
          call: { startedAt: c.startedAt, direction: c.direction, outcome: c.outcome, number: c.number, dialer: { name: c.dialer.name, provider: c.dialer.provider } },
          company: c.company,
          employee: c.employee ? { id: c.employee.id, name: c.employee.name, designation: c.employee.designation } : null,
          by: c.by,
        } satisfies RecordingRow;
      })
      .filter((x): x is RecordingRow => !!x);
  }

  /** The recording's audio. A provider's recording is fetched with the dialer's keys the first time and kept. */
  async recordingAudio(auth: AuthContext, id: string, download: boolean): Promise<{ data: Buffer; contentType: string; name: string }> {
    const rec = await this.prisma.run(auth, async (tx) => {
      const r = await tx.callRecording.findFirst({ where: { id, tenantId: auth.tenantId, deletedAt: null } });
      if (!r) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Recording not found.' });
      const visible = await tx.phoneCall.findFirst({ where: { AND: [await this.historyWhere(tx, auth, 'all'), { id: r.callId }] }, select: { id: true, dialerId: true, startedAt: true } });
      if (!visible) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Recording not found.' });
      if (download) {
        const [row] = await this.recordingRows(tx, auth, [r]);
        if (!row?.canDownload) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Downloading recordings is not allowed for your role.' });
        await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'call_recording.downloaded', entityType: 'call_recording', entityId: id });
      }
      const dialer = visible.dialerId ? await tx.dialer.findFirst({ where: { id: visible.dialerId, tenantId: auth.tenantId } }) : null;
      return { r, dialer, ctx: dialer ? await this.dialers.context(tx, dialer) : null, startedAt: visible.startedAt };
    });
    const name = `call-${rec.startedAt.toISOString().slice(0, 16).replace(/[:T]/g, '-')}`;
    if (rec.r.data) return { data: Buffer.from(rec.r.data), contentType: rec.r.contentType ?? 'audio/mpeg', name: `${name}.${ext(rec.r.contentType)}` };
    if (!rec.r.providerUrl || !rec.ctx) throw new NotFoundException({ code: 'NOT_FOUND', message: 'The recording is no longer available.' });
    let audio: { data: Buffer; contentType: string };
    try {
      audio = rec.ctx.twilio ? await this.twilio.recordingAudio(rec.ctx.twilio, rec.r.providerUrl) : await this.apiAdapter.fetchRecording(rec.ctx, rec.r.providerUrl, this.dialers.logger(rec.dialer!, rec.r.callId));
    } catch (e) {
      throw callError(e instanceof Error ? e.message : 'The provider did not return the recording.');
    }
    if (audio.data.length <= 15 * 1024 * 1024) {
      await this.prisma.run(auth, (tx) => tx.callRecording.update({ where: { id }, data: { data: new Uint8Array(audio.data), contentType: audio.contentType, sizeBytes: audio.data.length } }));
    }
    return { ...audio, name: `${name}.${ext(audio.contentType)}` };
  }

  /** A recording uploaded, or recorded in the browser during the call. Only for one's own calls, within the policy. */
  async addRecording(auth: AuthContext, callId: string, input: { data: Buffer; contentType: string; source: 'UPLOAD' | 'BROWSER'; durationSec: number | null }, meta: RequestMeta): Promise<RecordingRow> {
    if (!input.data.length) throw callError('The recording is empty.');
    if (input.data.length > RECORDING_MAX_BYTES) throw callError('Recordings can be up to 12 MB.');
    if (!(RECORDING_TYPES as readonly string[]).includes(input.contentType)) throw callError('Upload an audio file: MP3, WAV, WebM, OGG, M4A or AAC.');
    return this.prisma.run(auth, async (tx) => {
      const call = await this.ownCall(tx, auth, callId);
      const policy = await this.dialers.policyIn(tx, auth.tenantId);
      if (!policy.enabled) throw callError('Recording is switched off for this workspace.');
      if (input.source === 'BROWSER' && policy.requireConsent && !call.recordingConsent) throw callError('Confirm that the other person agreed to be recorded first.');
      if ((await tx.callRecording.count({ where: { tenantId: auth.tenantId, callId, deletedAt: null } })) >= 5) throw callError('A call keeps up to 5 recordings.');
      const r = await tx.callRecording.create({
        data: { tenantId: auth.tenantId, callId, userId: call.userId, source: input.source, contentType: input.contentType, sizeBytes: input.data.length, data: new Uint8Array(input.data), durationSec: input.durationSec, createdById: auth.userId, expiresAt: policy.retentionDays ? new Date(Date.now() + policy.retentionDays * DAY) : null },
      });
      await tx.phoneCall.update({ where: { id: callId }, data: { recordingActive: false } });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'call_recording.added', entityType: 'call_recording', entityId: r.id, metadata: { callId, source: input.source, bytes: input.data.length }, meta });
      return (await this.recordingRows(tx, auth, [r]))[0]!;
    });
  }

  setRecordingNotes(auth: AuthContext, id: string, notes: string | null, meta: RequestMeta): Promise<RecordingRow> {
    return this.prisma.run(auth, async (tx) => {
      const r = await tx.callRecording.findFirst({ where: { id, tenantId: auth.tenantId, deletedAt: null } });
      if (!r) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Recording not found.' });
      if (!(await tx.phoneCall.findFirst({ where: { AND: [await this.historyWhere(tx, auth, 'all'), { id: r.callId }] }, select: { id: true } }))) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Recording not found.' });
      const saved = await tx.callRecording.update({ where: { id }, data: { notes: notes || null } });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'call_recording.notes', entityType: 'call_recording', entityId: id, meta });
      return (await this.recordingRows(tx, auth, [saved]))[0]!;
    });
  }

  removeRecording(auth: AuthContext, id: string, meta: RequestMeta): Promise<void> {
    return this.prisma.run(auth, async (tx) => {
      const r = await tx.callRecording.findFirst({ where: { id, tenantId: auth.tenantId, deletedAt: null } });
      const manager = auth.permissions.includes('members:manage') || auth.permissions.includes('tenant:manage');
      if (!r || (r.userId !== auth.userId && !manager)) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Recording not found.' });
      await tx.callRecording.update({ where: { id }, data: { deletedAt: new Date(), data: null } });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'call_recording.deleted', entityType: 'call_recording', entityId: id, meta });
    });
  }

  /** Recordings past the retention the policy set are removed (their audio is dropped at once). */
  private async purgeExpired(tx: TenantTx, tenantId: string): Promise<void> {
    await tx.callRecording.updateMany({ where: { tenantId, deletedAt: null, expiresAt: { lt: new Date() } }, data: { deletedAt: new Date(), data: null } });
  }

  // ─── Helpers ───

  private async ownCall(tx: TenantTx, auth: AuthContext, id: string): Promise<PhoneCall> {
    const c = await tx.phoneCall.findFirst({ where: { id, tenantId: auth.tenantId, userId: auth.userId, deletedAt: null } });
    if (!c) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Call not found.' });
    return c;
  }

  /** Mine: my calls. Team: mine and my team's (record visibility decides who). All: everyone's, for roles that see every record. */
  private async historyWhere(tx: TenantTx, auth: AuthContext, scope: CallListQuery['scope']): Promise<Prisma.PhoneCallWhereInput> {
    const base = { tenantId: auth.tenantId, deletedAt: null };
    if (scope === 'mine') return { ...base, userId: auth.userId };
    const role = scopeOf(auth);
    const v: Visibility = await visibility(tx, auth);
    if (scope === 'all' && v.all) return base;
    const team = role === 'OWN' ? [] : v.all ? await reportingTree(tx, auth.tenantId, auth.userId) : v.userIds.filter((id) => id !== auth.userId);
    return { ...base, userId: { in: [auth.userId, ...team] } };
  }

  private rows(auth: AuthContext, calls: PhoneCall[]): Promise<CallRow[]> {
    return this.prisma.run(auth, (tx) => this.rowsIn(tx, auth.tenantId, calls));
  }

  private async rowsIn(tx: TenantTx, tenantId: string, calls: PhoneCall[]): Promise<CallRow[]> {
    const ids = (k: 'companyId' | 'contactId' | 'followUpId' | 'dealId') => [...new Set(calls.map((c) => c[k]).filter((x): x is string => !!x))];
    const [people, companies, contacts, tasks, deals, recordings] = await Promise.all([
      personRefs(tx, tenantId, calls.map((c) => c.userId)),
      tx.company.findMany({ where: { tenantId, id: { in: ids('companyId') } }, select: { id: true, name: true } }),
      tx.contact.findMany({ where: { tenantId, id: { in: ids('contactId') } }, select: { id: true, firstName: true, lastName: true, jobTitle: true, email: true, phone: true } }),
      tx.task.findMany({ where: { tenantId, id: { in: ids('followUpId') } }, select: { id: true, dueAt: true, title: true, status: true, deletedAt: true, followUpType: true } }),
      tx.opportunity.findMany({ where: { tenantId, id: { in: ids('dealId') } }, select: { id: true, name: true } }),
      tx.callRecording.findMany({ where: { tenantId, callId: { in: calls.map((c) => c.id) }, deletedAt: null }, select: { id: true, callId: true, durationSec: true, source: true }, orderBy: { createdAt: 'desc' } }),
    ]);
    const co = new Map(companies.map((c) => [c.id, c]));
    const ct = new Map(contacts.map((c) => [c.id, c]));
    const tk = new Map(tasks.map((t) => [t.id, t]));
    const dl = new Map(deals.map((d) => [d.id, d]));
    const rec = new Map<string, (typeof recordings)[number]>();
    for (const r of recordings) if (!rec.has(r.callId)) rec.set(r.callId, r);
    return calls.map((c) => {
      const handoff = c.details as unknown as CallHandoff;
      const company = c.companyId ? co.get(c.companyId) : undefined;
      const contact = c.contactId ? ct.get(c.contactId) : undefined;
      const task = c.followUpId ? tk.get(c.followUpId) : undefined;
      const r = rec.get(c.id);
      return {
        id: c.id,
        direction: c.direction as CallRow['direction'],
        status: c.status as CallStatus,
        outcome: c.outcome ?? null,
        number: c.number,
        numberSource: c.numberSource as CallRow['numberSource'],
        callerId: c.callerId,
        dialer: { id: c.dialerId, name: c.dialerName, kind: c.dialerKind as DialerKind, provider: c.dialerProvider },
        company: c.companyId ? { id: c.companyId, name: company?.name ?? handoff.companyName ?? '' } : null,
        employee: c.contactId
          ? { id: c.contactId, name: contact ? fullName(contact) : (handoff.employeeName ?? ''), designation: contact?.jobTitle ?? handoff.designation ?? null, email: handoff.email ?? null, phone: handoff.employeePhone ?? null }
          : null,
        deal: c.dealId && dl.get(c.dealId) ? { id: c.dealId, name: dl.get(c.dealId)!.name } : null,
        details: handoff,
        startedAt: c.startedAt.toISOString(),
        answeredAt: c.answeredAt?.toISOString() ?? null,
        endedAt: c.endedAt?.toISOString() ?? null,
        durationSec: c.durationSec,
        remarks: c.remarks,
        sentiment: (c.sentiment as CallRow['sentiment']) ?? null,
        nextCall: task && !task.deletedAt ? { id: task.id, dueAt: task.dueAt?.toISOString() ?? null, title: task.title, status: task.status, type: task.followUpType } : null,
        interactionId: c.activityId,
        webhook: c.webhookStatus ? { status: c.webhookStatus as 'SENT' | 'FAILED', at: c.webhookAt!.toISOString(), error: c.webhookError } : null,
        providerStatus: c.providerStatus,
        recording: r ? { id: r.id, durationSec: r.durationSec, source: r.source as RecordingSource } : null,
        muted: c.muted,
        onHold: c.onHold,
        recordingActive: c.recordingActive,
        error: c.error,
        by: people.get(c.userId) ?? null,
      };
    });
  }
}

function partyError(status: string): string {
  return status === 'busy' ? 'The line was busy.' : status === 'no-answer' ? 'Nobody answered.' : status === 'canceled' ? 'The call was cancelled before they answered.' : 'The call could not be connected.';
}

function ext(contentType: string | null): string {
  const t = contentType ?? '';
  return t.includes('wav') ? 'wav' : t.includes('webm') ? 'webm' : t.includes('ogg') ? 'ogg' : t.includes('mp4') || t.includes('m4a') ? 'm4a' : t.includes('aac') ? 'aac' : 'mp3';
}
