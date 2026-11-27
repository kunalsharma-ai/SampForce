import { BadRequestException, Inject, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { createHmac, randomBytes } from 'node:crypto';
import type { Dialer, PhoneCall, Prisma, TenantTx } from '@dealflow/database';
import {
  CALL_OUTCOME_LABELS,
  CALL_REACHED,
  type CallDetails,
  type CallHandoff,
  type CallListQuery,
  callListQuerySchema,
  type BulkActionResult,
  type DeleteAllInput,
  type CallLogInput,
  type CallOutcome,
  type CallRow,
  type CallStarted,
  type CallStartInput,
  type CallStats,
  type CallStatus,
  type CallTarget,
  type CallUpdateInput,
  callWindow,
  dialable,
  DIALER_PRESETS,
  type DialerInput,
  type DialerKind,
  type DialerRow,
  type DialerSettings,
  e164,
  fillDialerTemplate,
  startOfDayIn,
} from '@dealflow/types';
import { AuditService } from '../audit/audit.service';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { SECRET_BOX, type SecretBox } from '../common/crypto';
import { API_ENV, type ApiEnv } from '../common/env';
import { assertPublicUrl, publicFetch, UnsafeTargetError } from '../common/net-guard';
import { PrismaService } from '../common/prisma.service';
import { deleteAllMatching, parseListQuery } from '../common/delete-all';
import { TwilioClient, TwilioError, type TwilioKeys } from '../apps/twilio';
import { CompanyLogosService } from '../crm/company-logos.service';
import { CompanyWorkService } from '../crm/company-work.service';
import { canSeeDetails, companyScope, contactScope, personRefs, reportingTree, scopeOf, visibility, type Visibility } from '../crm/visibility';

const DAY = 86_400_000;
const PHONE_APP = DIALER_PRESETS[0];
const fullName = (c: { firstName: string; lastName?: string | null }) => [c.firstName, c.lastName].filter(Boolean).join(' ');
const callError = (message: string) => new BadRequestException({ code: 'CALL_ERROR', message });

/** Twilio's call states, as the Calls page shows them. */
const TWILIO_STATUS: Record<string, CallStatus> = { queued: 'RINGING', initiated: 'RINGING', ringing: 'RINGING', 'in-progress': 'IN_PROGRESS', answered: 'IN_PROGRESS', completed: 'ENDED', busy: 'FAILED', 'no-answer': 'FAILED', failed: 'FAILED', canceled: 'FAILED' };

/**
 * The Calls section (ADR 0088): personal dialers, the call card with everything about the company and employee being
 * called, placing a call through the chosen dialer (with the details handed over), logging it as a call interaction
 * with remarks and the next call as a follow-up, and the call history. A call is always the caller's own; managers see
 * their team's history as record visibility allows.
 */
@Injectable()
export class CallsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly work: CompanyWorkService,
    private readonly logos: CompanyLogosService,
    private readonly twilio: TwilioClient,
    @Inject(SECRET_BOX) private readonly box: SecretBox,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  // ─── Dialers ───

  settings(auth: AuthContext): Promise<DialerSettings> {
    return this.prisma.run(auth, async (tx) => {
      const [rows, tw] = await Promise.all([
        tx.dialer.findMany({ where: { tenantId: auth.tenantId, userId: auth.userId, deletedAt: null }, orderBy: { createdAt: 'asc' } }),
        this.twilioConnection(tx, auth.tenantId),
      ]);
      return {
        dialers: rows.map((d) => dialerRow(d, null)),
        builtIn: { name: PHONE_APP.name, urlTemplate: PHONE_APP.urlTemplate },
        twilio: { connected: !!tw, fromNumber: tw?.fromNumber ?? null },
      };
    });
  }

  async createDialer(auth: AuthContext, input: DialerInput, meta: RequestMeta): Promise<DialerRow> {
    const webhookUrl = await this.checkedWebhook(input.webhookUrl);
    const secret = webhookUrl ? randomBytes(24).toString('base64url') : null;
    return this.prisma.run(auth, async (tx) => {
      if (input.kind === 'TWILIO' && !(await this.twilioConnection(tx, auth.tenantId))) throw callError('Twilio is not connected. A workspace admin can connect it in Integrations.');
      const count = await tx.dialer.count({ where: { tenantId: auth.tenantId, userId: auth.userId, deletedAt: null } });
      if (count >= 10) throw callError('You can keep up to 10 dialers. Remove one first.');
      const isDefault = input.isDefault ?? count === 0;
      if (isDefault) await tx.dialer.updateMany({ where: { tenantId: auth.tenantId, userId: auth.userId, deletedAt: null }, data: { isDefault: false } });
      const row = await tx.dialer.create({
        data: {
          tenantId: auth.tenantId,
          userId: auth.userId,
          name: input.name,
          kind: input.kind,
          urlTemplate: input.kind === 'LINK' ? (input.urlTemplate ?? null) : null,
          webhookUrl,
          webhookSecretEncrypted: secret ? this.box.seal(secret) : null,
          agentPhone: input.kind === 'TWILIO' ? e164(input.agentPhone) : null,
          isDefault,
        },
      });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'dialer.created', entityType: 'dialer', entityId: row.id, metadata: { kind: row.kind, webhook: !!webhookUrl }, meta });
      return dialerRow(row, secret);
    });
  }

  async updateDialer(auth: AuthContext, id: string, input: DialerInput, meta: RequestMeta): Promise<DialerRow> {
    const webhookUrl = await this.checkedWebhook(input.webhookUrl);
    return this.prisma.run(auth, async (tx) => {
      const before = await this.ownDialer(tx, auth, id);
      if (input.kind === 'TWILIO' && !(await this.twilioConnection(tx, auth.tenantId))) throw callError('Twilio is not connected. A workspace admin can connect it in Integrations.');
      // A webhook keeps its secret while it stays set; a new webhook gets a new one, shown once.
      const secret = webhookUrl && !before.webhookSecretEncrypted ? randomBytes(24).toString('base64url') : null;
      if (input.isDefault) await tx.dialer.updateMany({ where: { tenantId: auth.tenantId, userId: auth.userId, deletedAt: null, id: { not: id } }, data: { isDefault: false } });
      const row = await tx.dialer.update({
        where: { id },
        data: {
          name: input.name,
          kind: input.kind,
          urlTemplate: input.kind === 'LINK' ? (input.urlTemplate ?? null) : null,
          webhookUrl,
          webhookSecretEncrypted: webhookUrl ? (secret ? this.box.seal(secret) : before.webhookSecretEncrypted) : null,
          agentPhone: input.kind === 'TWILIO' ? e164(input.agentPhone) : null,
          ...(input.isDefault !== undefined ? { isDefault: input.isDefault || before.isDefault } : {}),
        },
      });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'dialer.updated', entityType: 'dialer', entityId: id, metadata: { kind: row.kind, webhook: !!webhookUrl }, meta });
      return dialerRow(row, secret);
    });
  }

  /** A new webhook signing secret, shown once. */
  renewSecret(auth: AuthContext, id: string, meta: RequestMeta): Promise<DialerRow> {
    return this.prisma.run(auth, async (tx) => {
      const d = await this.ownDialer(tx, auth, id);
      if (!d.webhookUrl) throw callError('This dialer has no webhook.');
      const secret = randomBytes(24).toString('base64url');
      const row = await tx.dialer.update({ where: { id }, data: { webhookSecretEncrypted: this.box.seal(secret) } });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'dialer.secret_renewed', entityType: 'dialer', entityId: id, meta });
      return dialerRow(row, secret);
    });
  }

  removeDialer(auth: AuthContext, id: string, meta: RequestMeta): Promise<void> {
    return this.prisma.run(auth, async (tx) => {
      const d = await this.ownDialer(tx, auth, id);
      await tx.dialer.update({ where: { id }, data: { deletedAt: new Date(), isDefault: false } });
      if (d.isDefault) {
        const next = await tx.dialer.findFirst({ where: { tenantId: auth.tenantId, userId: auth.userId, deletedAt: null }, orderBy: { createdAt: 'asc' } });
        if (next) await tx.dialer.update({ where: { id: next.id }, data: { isDefault: true } });
      }
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'dialer.deleted', entityType: 'dialer', entityId: id, meta });
    });
  }

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
    });
  }

  /** The call card: the company and employee, their numbers, their local time, the last and next call. */
  details(auth: AuthContext, ids: { companyId?: string | null; contactId?: string | null }): Promise<CallDetails> {
    return this.prisma.run(auth, (tx) => this.detailsIn(tx, auth, ids));
  }

  private async detailsIn(tx: TenantTx, auth: AuthContext, ids: { companyId?: string | null; contactId?: string | null }): Promise<CallDetails> {
    if (!ids.companyId && !ids.contactId) throw callError('Choose a company or an employee to call.');
    const v = await visibility(tx, auth);
    const contact = ids.contactId
      ? await tx.contact.findFirst({ where: { id: ids.contactId, tenantId: auth.tenantId, deletedAt: null, ...contactScope(v) }, select: { id: true, firstName: true, lastName: true, jobTitle: true, email: true, phone: true, timezone: true, companyId: true, ownerId: true } })
      : null;
    if (ids.contactId && !contact) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Employee not found.' });
    const companyId = ids.companyId ?? contact?.companyId ?? null;
    if (ids.companyId && contact?.companyId && contact.companyId !== ids.companyId) throw callError('This employee does not work at this company.');
    const company = companyId
      ? await tx.company.findFirst({ where: { id: companyId, tenantId: auth.tenantId, deletedAt: null, ...companyScope(v) }, select: { id: true, name: true, primaryPhone: true, leadNumber: true, country: true, timezone: true, ownerId: true } })
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
    const [last, next] = await Promise.all([
      tx.activity.findFirst({ where: { tenantId: auth.tenantId, deletedAt: null, type: 'CALL', ...about }, orderBy: { occurredAt: 'desc' }, select: { id: true, occurredAt: true, outcome: true, ownerId: true, body: true } }),
      tx.task.findFirst({
        where: { tenantId: auth.tenantId, deletedAt: null, status: 'OPEN', followUpType: 'CALL', ...(contact ? { contactId: contact.id } : { companyId: company!.id }) },
        orderBy: { dueAt: 'asc' },
        select: { id: true, dueAt: true, title: true },
      }),
    ]);
    const lastCall = last ? await tx.phoneCall.findFirst({ where: { tenantId: auth.tenantId, activityId: last.id }, select: { outcome: true } }) : null;
    const logo = company ? ((await this.logos.refsIn(tx, auth.tenantId, [company.id])).get(company.id) ?? null) : null;
    const lastBy = last?.ownerId ? (await personRefs(tx, auth.tenantId, [last.ownerId])).get(last.ownerId) : undefined;
    return {
      company: company ? { id: company.id, name: company.name, phone: companyDetails ? company.primaryPhone : null, leadNumber: company.leadNumber, logo, country: company.country, timezone: company.timezone } : null,
      employee: contact
        ? { id: contact.id, name: fullName(contact), designation: contact.jobTitle, email: contactDetails ? contact.email : null, phone: contactDetails ? contact.phone : null, timezone: contact.timezone }
        : null,
      detailsHidden: !companyDetails || !contactDetails,
      colleagues: colleagues.filter((c) => canSeeDetails(v, c.ownerId) && c.phone).map((c) => ({ id: c.id, name: fullName(c), designation: c.jobTitle, phone: c.phone! })),
      localTime: callWindow(contact?.timezone || company?.timezone),
      lastCall: last ? { at: last.occurredAt.toISOString(), outcome: (lastCall?.outcome as CallOutcome | null) ?? null, by: lastBy?.name ?? null, remarks: last.body } : null,
      nextCall: next?.dueAt ? { id: next.id, dueAt: next.dueAt.toISOString(), title: next.title } : null,
    };
  }

  // ─── Placing and logging calls ───

  async start(auth: AuthContext, input: CallStartInput, meta: RequestMeta): Promise<CallStarted> {
    const prepared = await this.prisma.run(auth, async (tx) => {
      const d = input.companyId || input.contactId ? await this.detailsIn(tx, auth, input) : null;
      const number =
        input.numberSource === 'EMPLOYEE' ? d?.employee?.phone : input.numberSource === 'COMPANY' ? d?.company?.phone : input.number;
      if (!number?.trim()) throw callError(input.numberSource === 'COMPANY' ? 'This company has no phone number on file.' : input.numberSource === 'EMPLOYEE' ? 'This employee has no phone number on file.' : 'Type the number to call.');
      if (number.replace(/\D/g, '').length < 5) throw callError('That does not look like a phone number.');
      const dialer = input.dialerId
        ? await this.ownDialer(tx, auth, input.dialerId)
        : await tx.dialer.findFirst({ where: { tenantId: auth.tenantId, userId: auth.userId, deletedAt: null, isDefault: true } });
      const handoff: CallHandoff = {
        companyName: d?.company?.name ?? null,
        companyPhone: d?.company?.phone ?? null,
        employeeName: d?.employee?.name ?? null,
        designation: d?.employee?.designation ?? null,
        email: d?.employee?.email ?? null,
        employeePhone: d?.employee?.phone ?? null,
      };
      const kind = (dialer?.kind ?? 'LINK') as DialerKind;
      const twilio = kind === 'TWILIO' ? await this.twilioConnection(tx, auth.tenantId) : null;
      if (kind === 'TWILIO' && !twilio) throw callError('Twilio is not connected any more. Choose another dialer, or ask a workspace admin to connect Twilio in Integrations.');
      if (kind === 'TWILIO' && !e164(number)) throw callError('Calling through Twilio needs the number with its country code, for example +44 7700 900123.');
      const call = await tx.phoneCall.create({
        data: {
          tenantId: auth.tenantId,
          userId: auth.userId,
          companyId: d?.company?.id ?? null,
          contactId: d?.employee?.id ?? null,
          number: number.trim(),
          numberSource: input.numberSource,
          dialerId: dialer?.id ?? null,
          dialerName: dialer?.name ?? PHONE_APP.name,
          dialerKind: kind,
          status: kind === 'TWILIO' ? 'RINGING' : 'OPEN',
          details: handoff as unknown as Prisma.InputJsonValue,
          searchText: [handoff.companyName, handoff.employeeName, number, number.replace(/\D/g, '')].filter(Boolean).join(' ').toLowerCase(),
        },
      });
      if (dialer) await tx.dialer.update({ where: { id: dialer.id }, data: { lastUsedAt: new Date() } });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'call.started', entityType: 'phone_call', entityId: call.id, metadata: { dialer: kind, companyId: call.companyId, contactId: call.contactId }, meta });
      const me = await tx.user.findUnique({ where: { id: auth.userId }, select: { name: true, email: true } });
      return { call, dialer, handoff, twilio, me };
    });
    const { call, dialer, handoff, twilio, me } = prepared;
    const values = {
      phone: call.number,
      phoneE164: e164(call.number) ?? dialable(call.number),
      phoneDigits: call.number.replace(/\D/g, ''),
      companyName: handoff.companyName,
      companyPhone: handoff.companyPhone,
      employeeName: handoff.employeeName,
      designation: handoff.designation,
      email: handoff.email,
      employeePhone: handoff.employeePhone,
      callId: call.id,
      companyUrl: call.companyId ? `${this.env.PUBLIC_WEB_URL.replace(/\/$/, '')}/app/companies/${call.companyId}` : null,
    };
    const update: Prisma.PhoneCallUpdateInput = {};
    // The details go to the dialer's webhook too. A failed delivery is shown on the call; the call itself goes ahead.
    if (dialer?.webhookUrl && dialer.webhookSecretEncrypted) {
      const r = await this.postWebhook(dialer, { event: 'call.started', callId: call.id, startedAt: call.startedAt.toISOString(), number: call.number, numberE164: e164(call.number), dialer: { id: dialer.id, name: dialer.name }, caller: { id: auth.userId, name: me?.name ?? null, email: me?.email ?? null }, company: call.companyId ? { id: call.companyId, name: handoff.companyName, phone: handoff.companyPhone, url: values.companyUrl } : null, employee: call.contactId ? { id: call.contactId, name: handoff.employeeName, designation: handoff.designation, email: handoff.email, phone: handoff.employeePhone } : null });
      Object.assign(update, { webhookStatus: r.ok ? 'SENT' : 'FAILED', webhookAt: new Date(), webhookError: r.error });
    }
    let twilioError: string | null = null;
    if (dialer?.kind === 'TWILIO' && twilio) {
      try {
        const placed = await this.twilio.placeCall(twilio.keys, { agentPhone: dialer.agentPhone!, to: e164(call.number)!, statusCallback: this.statusUrl(twilio.hookId, call.id) });
        Object.assign(update, { twilioSid: placed.sid, twilioStatus: placed.status });
      } catch (e) {
        if (!(e instanceof TwilioError)) throw e;
        twilioError = e.message;
        Object.assign(update, { status: 'FAILED', error: e.message, endedAt: new Date() });
      }
    }
    const saved = Object.keys(update).length ? await this.prisma.run(auth, (tx) => tx.phoneCall.update({ where: { id: call.id }, data: update })) : call;
    if (twilioError) throw callError(`Twilio could not place the call: ${twilioError}`);
    const launchUrl = (dialer?.kind ?? 'LINK') === 'LINK' ? fillDialerTemplate(dialer?.urlTemplate ?? PHONE_APP.urlTemplate, values) : null;
    return { call: (await this.rows(auth, [saved]))[0]!, launchUrl };
  }

  /** Logs the call: outcome, remarks and talk time; a call interaction on the company and the next call as a follow-up. */
  async log(auth: AuthContext, id: string, input: CallLogInput, meta: RequestMeta): Promise<CallRow> {
    const call = await this.prisma.run(auth, (tx) => this.ownCall(tx, auth, id));
    if (call.status === 'LOGGED') throw callError('This call is already logged. Edit it from the call history.');
    if (input.nextCallAt && !call.companyId) throw callError('Only calls to a company or employee can schedule the next call. Find them in the search first.');
    if (input.nextCallAt && new Date(input.nextCallAt).getTime() < Date.now() - 60_000) throw callError('Choose a time in the future for the next call.');
    const handoff = call.details as unknown as CallHandoff;
    const label = CALL_OUTCOME_LABELS[input.outcome];
    let activityId: string | null = null;
    let followUpId: string | null = null;
    if (call.companyId) {
      const who = handoff.employeeName ?? handoff.companyName ?? call.number;
      const interaction = await this.work.logInteraction(
        auth,
        {
          companyId: call.companyId,
          contactId: call.contactId,
          kind: 'CALL_OUTGOING',
          subject: `Call with ${who}: ${label}`.slice(0, 200),
          occurredAt: call.startedAt.toISOString(),
          recipient: call.number,
          outcome: label,
          sentiment: input.sentiment ?? null,
          remarks: input.remarks ?? null,
          nextAction: input.nextCallAt ? (input.nextCallNote ?? 'Call again') : null,
          followUpAt: null,
        },
        meta,
        { attempt: !CALL_REACHED.has(input.outcome) },
      );
      activityId = interaction.id;
      if (input.nextCallAt) {
        const f = await this.work.createFollowUp(
          auth,
          {
            companyId: call.companyId,
            contactId: call.contactId,
            type: 'CALL',
            title: (input.nextCallNote || `Call ${who} again`).slice(0, 200),
            dueAt: input.nextCallAt,
            priority: 'NORMAL',
            assigneeId: auth.userId,
            summary: input.remarks ?? `Last call: ${label}`,
            nextAction: input.nextCallNote ?? null,
          } as Parameters<CompanyWorkService['createFollowUp']>[1],
          meta,
        );
        followUpId = f.id;
      }
    }
    const row = await this.prisma.run(auth, async (tx) => {
      const ended = call.endedAt ?? new Date();
      const saved = await tx.phoneCall.update({
        where: { id },
        data: {
          status: 'LOGGED',
          outcome: input.outcome,
          remarks: input.remarks ?? null,
          sentiment: input.sentiment ?? null,
          durationSec: input.durationSec ?? call.durationSec ?? null,
          endedAt: ended,
          activityId,
          followUpId,
        },
      });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'call.logged', entityType: 'phone_call', entityId: id, metadata: { outcome: input.outcome, activityId, followUpId }, meta });
      return saved;
    });
    return (await this.rows(auth, [row]))[0]!;
  }

  /** Edits a logged call's outcome, remarks or talk time; the call interaction on the company follows. */
  async update(auth: AuthContext, id: string, input: CallUpdateInput, meta: RequestMeta): Promise<CallRow> {
    const call = await this.prisma.run(auth, (tx) => this.ownCall(tx, auth, id));
    if (call.status !== 'LOGGED') throw callError('Log the call first.');
    if (call.activityId && (input.outcome || input.remarks !== undefined || input.sentiment !== undefined)) {
      await this.work.updateInteraction(
        auth,
        call.activityId,
        {
          ...(input.outcome ? { outcome: CALL_OUTCOME_LABELS[input.outcome] } : {}),
          ...(input.remarks !== undefined ? { remarks: input.remarks } : {}),
          ...(input.sentiment !== undefined ? { sentiment: input.sentiment } : {}),
        },
        meta,
      );
    }
    const row = await this.prisma.run(auth, async (tx) => {
      const saved = await tx.phoneCall.update({
        where: { id },
        data: {
          ...(input.outcome ? { outcome: input.outcome } : {}),
          ...(input.remarks !== undefined ? { remarks: input.remarks ?? null } : {}),
          ...(input.sentiment !== undefined ? { sentiment: input.sentiment ?? null } : {}),
          ...(input.durationSec !== undefined ? { durationSec: input.durationSec ?? null } : {}),
        },
      });
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
      const rows = await tx.phoneCall.findMany({ where: await this.listWhere(tx, auth, q), orderBy: [{ startedAt: 'desc' }, { id: 'desc' }], take: q.limit });
      return this.rowsIn(tx, auth.tenantId, rows);
    });
  }

  private async listWhere(tx: TenantTx, auth: AuthContext, q: CallListQuery): Promise<Prisma.PhoneCallWhereInput> {
    return {
      AND: [
        await this.historyWhere(tx, auth, q.scope),
        ...(q.outcome ? [{ outcome: q.outcome }] : []),
        ...(q.companyId ? [{ companyId: q.companyId }] : []),
        ...(q.contactId ? [{ contactId: q.contactId }] : []),
        ...(q.q ? [{ searchText: { contains: q.q.toLowerCase() } }] : []),
        ...(q.before ? [{ startedAt: { lt: new Date(q.before) } }] : []),
      ],
    };
  }

  /** Every call the history shows for this query (no page of 50), for "delete all" (ADR 0096). */
  matchingIds(auth: AuthContext, query: Record<string, string>): Promise<string[]> {
    const { before: _before, ...rest } = query;
    const q = parseListQuery(callListQuerySchema, rest);
    return this.prisma.run(auth, async (tx) => (await tx.phoneCall.findMany({ where: await this.listWhere(tx, auth, q), select: { id: true } })).map((r) => r.id));
  }

  async deleteAll(auth: AuthContext, input: DeleteAllInput, meta: RequestMeta): Promise<BulkActionResult> {
    return deleteAllMatching({ prisma: this.prisma, audit: this.audit }, auth, meta, 'calls', input, await this.matchingIds(auth, input.query), (id) => this.removeCall(auth, id, meta));
  }

  /**
   * Deletes a call from the history, logged or not, with the interaction it logged on the company (ADR 0096). Used by
   * "delete all": the person reaches only the calls their history shows them.
   */
  removeCall(auth: AuthContext, id: string, meta: RequestMeta): Promise<void> {
    return this.prisma.run(auth, async (tx) => {
      const call = await tx.phoneCall.findFirst({ where: { AND: [await this.historyWhere(tx, auth, 'all'), { id }] } });
      if (!call) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Call not found.' });
      const now = new Date();
      await tx.phoneCall.update({ where: { id }, data: { deletedAt: now } });
      if (call.activityId) await tx.activity.updateMany({ where: { id: call.activityId, tenantId: auth.tenantId, deletedAt: null }, data: { deletedAt: now } });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'call.deleted', entityType: 'phone_call', entityId: id, metadata: { logged: call.status === 'LOGGED', interactionId: call.activityId }, meta });
    });
  }

  stats(auth: AuthContext, tz: string): Promise<CallStats> {
    return this.prisma.run(auth, async (tx) => {
      const now = new Date();
      const today = startOfDayIn(now, tz);
      const tomorrow = new Date(today.getTime() + DAY);
      const mine = { tenantId: auth.tenantId, userId: auth.userId, deletedAt: null };
      const todays = await tx.phoneCall.findMany({ where: { ...mine, startedAt: { gte: today, lt: tomorrow } }, select: { outcome: true, durationSec: true, status: true } });
      const tasks = { tenantId: auth.tenantId, deletedAt: null, status: 'OPEN' as const, followUpType: 'CALL', assigneeId: auth.userId };
      const [notLogged, nextCallsToday, overdueCalls] = await Promise.all([
        tx.phoneCall.count({ where: { ...mine, status: { not: 'LOGGED' } } }),
        tx.task.count({ where: { ...tasks, dueAt: { gte: now < today ? today : now, lt: tomorrow } } }),
        tx.task.count({ where: { ...tasks, dueAt: { lt: now } } }),
      ]);
      return {
        today: {
          calls: todays.length,
          reached: todays.filter((c) => c.outcome && CALL_REACHED.has(c.outcome as CallOutcome)).length,
          talkSec: todays.reduce((s, c) => s + (c.durationSec ?? 0), 0),
          notLogged,
        },
        nextCallsToday,
        overdueCalls,
      };
    });
  }

  // ─── Twilio's call status callbacks ───

  /** Twilio reports each leg's status: the caller's phone (agent) and the person called (party). Signed by Twilio. */
  async twilioStatus(hookId: string, callId: string, leg: string, params: Record<string, string>, signature: string | undefined): Promise<void> {
    if (!/^[a-f0-9]{24}$/.test(hookId) || !/^[0-9a-f-]{36}$/.test(callId) || (leg !== 'agent' && leg !== 'party')) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Unknown webhook.' });
    const conn = await this.prisma.run({ lookup: { AppConnection: { provider: 'TWILIO', externalAccountId: hookId } } }, (tx) => tx.appConnection.findFirst({ where: { provider: 'TWILIO', externalAccountId: hookId } }));
    if (!conn || conn.status === 'DISCONNECTED') throw new NotFoundException({ code: 'NOT_FOUND', message: 'Unknown webhook.' });
    const keys = JSON.parse(this.box.open(conn.credentialsEncrypted)) as TwilioKeys;
    const url = `${this.statusUrl(hookId, callId)}?leg=${leg}`;
    if (!this.twilio.verify(keys, url, params, signature) || (params.AccountSid && params.AccountSid !== keys.accountSid)) throw new UnauthorizedException({ code: 'BAD_SIGNATURE', message: 'Signature check failed.' });
    const tstatus = (params.CallStatus ?? '').toLowerCase();
    await this.prisma.run({ tenantId: conn.tenantId }, async (tx) => {
      const call = await tx.phoneCall.findFirst({ where: { id: callId, tenantId: conn.tenantId, deletedAt: null } });
      if (!call || call.dialerKind !== 'TWILIO') return;
      // The agent leg's SID is the one Twilio returned; the party leg is its child.
      if (leg === 'agent' && call.twilioSid && params.CallSid && params.CallSid !== call.twilioSid) return;
      if (leg === 'party' && call.twilioSid && params.ParentCallSid && params.ParentCallSid !== call.twilioSid) return;
      const data: Prisma.PhoneCallUpdateInput = { twilioStatus: leg === 'party' ? `party ${tstatus}` : tstatus };
      const logged = call.status === 'LOGGED';
      if (leg === 'party') {
        if (tstatus === 'in-progress' || tstatus === 'answered') Object.assign(data, { answeredAt: call.answeredAt ?? new Date(), ...(logged ? {} : { status: 'IN_PROGRESS' }) });
        if (tstatus === 'completed') Object.assign(data, { endedAt: call.endedAt ?? new Date(), durationSec: call.durationSec ?? (Number(params.CallDuration) || 0), ...(logged ? {} : { status: 'ENDED' }) });
        if (['busy', 'no-answer', 'failed', 'canceled'].includes(tstatus)) Object.assign(data, { endedAt: call.endedAt ?? new Date(), ...(logged ? {} : { status: 'ENDED', error: partyError(tstatus) }) });
      } else {
        const mapped = TWILIO_STATUS[tstatus];
        if (mapped === 'FAILED' && !logged) Object.assign(data, { status: 'FAILED', endedAt: new Date(), error: tstatus === 'no-answer' || tstatus === 'busy' ? 'Your phone did not answer, so the call was not connected.' : 'Twilio could not ring your phone.' });
        else if (mapped === 'ENDED' && !logged && call.status !== 'ENDED') Object.assign(data, { status: 'ENDED', endedAt: call.endedAt ?? new Date() });
        else if (mapped === 'RINGING' && call.status === 'RINGING') Object.assign(data, {});
      }
      await tx.phoneCall.update({ where: { id: call.id }, data });
    });
  }

  // ─── Helpers ───

  private statusUrl(hookId: string, callId: string): string {
    return `${this.env.PUBLIC_WEB_URL.replace(/\/$/, '')}/api/v1/calls/twilio/${hookId}/${callId}`;
  }

  private async twilioConnection(tx: TenantTx, tenantId: string): Promise<{ hookId: string; fromNumber: string; keys: TwilioKeys } | null> {
    const conn = await tx.appConnection.findUnique({ where: { tenantId_provider: { tenantId, provider: 'TWILIO' } } });
    if (!conn || conn.status !== 'CONNECTED' || !conn.externalAccountId) return null;
    const keys = JSON.parse(this.box.open(conn.credentialsEncrypted)) as TwilioKeys;
    return { hookId: conn.externalAccountId, fromNumber: keys.fromNumber, keys };
  }

  private async checkedWebhook(url: string | null | undefined): Promise<string | null> {
    if (!url) return null;
    try {
      return (await assertPublicUrl(url, this.env.ALLOW_PRIVATE_NETWORK_TARGETS)).toString();
    } catch (e) {
      if (e instanceof UnsafeTargetError) throw callError(`The webhook address cannot be used: ${e.message}`);
      throw callError('The webhook address is not a valid web address.');
    }
  }

  private async postWebhook(dialer: Dialer, payload: object): Promise<{ ok: boolean; error: string | null }> {
    const body = JSON.stringify(payload);
    const t = Math.floor(Date.now() / 1000);
    const sig = createHmac('sha256', this.box.open(dialer.webhookSecretEncrypted!)).update(`${t}.${body}`).digest('hex');
    try {
      const url = await assertPublicUrl(dialer.webhookUrl!, this.env.ALLOW_PRIVATE_NETWORK_TARGETS);
      const res = await publicFetch(
        url,
        { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'SampForce-Calls/1.0', 'X-SampForce-Signature': `t=${t},v1=${sig}`, 'X-SampForce-Event': 'call.started' }, body, redirect: 'manual', signal: AbortSignal.timeout(8_000) },
        this.env.ALLOW_PRIVATE_NETWORK_TARGETS,
      );
      return res.status >= 200 && res.status < 300 ? { ok: true, error: null } : { ok: false, error: `Your dialer answered ${res.status}.` };
    } catch (e) {
      return { ok: false, error: e instanceof UnsafeTargetError ? e.message : 'Your dialer could not be reached.' };
    }
  }

  private async ownDialer(tx: TenantTx, auth: AuthContext, id: string): Promise<Dialer> {
    const d = await tx.dialer.findFirst({ where: { id, tenantId: auth.tenantId, userId: auth.userId, deletedAt: null } });
    if (!d) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Dialer not found.' });
    return d;
  }

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
    const ids = (k: 'companyId' | 'contactId' | 'followUpId') => [...new Set(calls.map((c) => c[k]).filter((x): x is string => !!x))];
    const [people, companies, contacts, tasks] = await Promise.all([
      personRefs(tx, tenantId, calls.map((c) => c.userId)),
      tx.company.findMany({ where: { tenantId, id: { in: ids('companyId') } }, select: { id: true, name: true } }),
      tx.contact.findMany({ where: { tenantId, id: { in: ids('contactId') } }, select: { id: true, firstName: true, lastName: true, jobTitle: true } }),
      tx.task.findMany({ where: { tenantId, id: { in: ids('followUpId') } }, select: { id: true, dueAt: true, title: true, status: true, deletedAt: true } }),
    ]);
    const co = new Map(companies.map((c) => [c.id, c]));
    const ct = new Map(contacts.map((c) => [c.id, c]));
    const tk = new Map(tasks.map((t) => [t.id, t]));
    return calls.map((c) => {
      const handoff = c.details as unknown as CallHandoff;
      const company = c.companyId ? co.get(c.companyId) : undefined;
      const contact = c.contactId ? ct.get(c.contactId) : undefined;
      const task = c.followUpId ? tk.get(c.followUpId) : undefined;
      return {
        id: c.id,
        status: c.status as CallStatus,
        outcome: (c.outcome as CallOutcome | null) ?? null,
        number: c.number,
        numberSource: c.numberSource as CallRow['numberSource'],
        dialer: { id: c.dialerId, name: c.dialerName, kind: c.dialerKind as DialerKind },
        company: c.companyId ? { id: c.companyId, name: company?.name ?? handoff.companyName ?? '' } : null,
        employee: c.contactId ? { id: c.contactId, name: contact ? fullName(contact) : (handoff.employeeName ?? ''), designation: contact?.jobTitle ?? handoff.designation ?? null } : null,
        details: handoff,
        startedAt: c.startedAt.toISOString(),
        answeredAt: c.answeredAt?.toISOString() ?? null,
        endedAt: c.endedAt?.toISOString() ?? null,
        durationSec: c.durationSec,
        remarks: c.remarks,
        sentiment: (c.sentiment as CallRow['sentiment']) ?? null,
        nextCall: task && !task.deletedAt ? { id: task.id, dueAt: task.dueAt?.toISOString() ?? null, title: task.title, status: task.status } : null,
        interactionId: c.activityId,
        webhook: c.webhookStatus ? { status: c.webhookStatus as 'SENT' | 'FAILED', at: c.webhookAt!.toISOString(), error: c.webhookError } : null,
        twilioStatus: c.twilioStatus,
        error: c.error,
        by: people.get(c.userId) ?? null,
      };
    });
  }
}

function partyError(status: string): string {
  return status === 'busy' ? 'The line was busy.' : status === 'no-answer' ? 'Nobody answered.' : status === 'canceled' ? 'The call was cancelled before they answered.' : 'The call could not be connected.';
}

function dialerRow(d: Dialer, secret: string | null): DialerRow {
  return {
    id: d.id,
    name: d.name,
    kind: d.kind as DialerKind,
    urlTemplate: d.urlTemplate,
    webhookUrl: d.webhookUrl,
    webhookSecret: secret,
    hasWebhookSecret: !!d.webhookSecretEncrypted,
    agentPhone: d.agentPhone,
    isDefault: d.isDefault,
    lastUsedAt: d.lastUsedAt?.toISOString() ?? null,
    createdAt: d.createdAt.toISOString(),
  };
}
