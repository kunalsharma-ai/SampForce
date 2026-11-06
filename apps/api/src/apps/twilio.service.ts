import { ConflictException, Inject, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { type AppConnection, Prisma, type SmsMessage } from '@dealflow/database';
import { type AppStatus, type SmsMessageRow, type SmsSendInput, type SmsThread, type TwilioConnectInput, type TwilioSettings } from '@dealflow/types';
import { AuditService } from '../audit/audit.service';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { SECRET_BOX, type SecretBox } from '../common/crypto';
import { API_ENV, type ApiEnv } from '../common/env';
import { PrismaService } from '../common/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AppError, AppsService } from './apps.service';
import { describeTwilioError, SMS_START_WORDS, SMS_STATUS_RANK, SMS_STOP_WORDS, smsNumber, TwilioClient, TwilioError, type TwilioKeys } from './twilio';

const TWIML_EMPTY = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

/** Twilio's message states mapped to SampForce's: queued and accepted are "accepted", sending is "sent". */
const STATUS_MAP: Record<string, SmsMessageRow['status']> = { queued: 'accepted', accepted: 'accepted', sending: 'sent', sent: 'sent', delivered: 'delivered', undelivered: 'undelivered', failed: 'failed' };

/**
 * SMS through the workspace's own Twilio account and number. Every send is one message to one contact who has a
 * recorded SMS consent and has not replied STOP, confirmed by the sender or approved in a workflow; there is no bulk
 * send. Delivery status and replies come only from Twilio's signed requests.
 */
@Injectable()
export class TwilioService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly apps: AppsService,
    private readonly client: TwilioClient,
    private readonly notifications: NotificationsService,
    @Inject(SECRET_BOX) private readonly box: SecretBox,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  /** Saves the credentials after reads prove them and the number. The webhook URLs survive replacing them. */
  async connect(auth: AuthContext, input: TwilioConnectInput, meta: RequestMeta): Promise<AppStatus> {
    const keys: TwilioKeys = { accountSid: input.accountSid, authToken: input.authToken, fromNumber: input.fromNumber };
    let checked: { friendlyName: string; trial: boolean };
    try {
      checked = await this.client.check(keys);
    } catch (e) {
      throw e instanceof TwilioError ? new AppError(e.message) : e;
    }
    const existing = await this.prisma.run(auth, (tx) => tx.appConnection.findUnique({ where: { tenantId_provider: { tenantId: auth.tenantId, provider: 'TWILIO' } } }));
    const prior = existing?.settings as Partial<TwilioSettings> | undefined;
    const hookId = existing?.externalAccountId ?? randomBytes(12).toString('hex');
    const sameAccount = !!existing && prior?.accountSid === input.accountSid && this.keys(existing).authToken === input.authToken;
    const settings: TwilioSettings = {
      accountSid: input.accountSid,
      fromNumber: input.fromNumber,
      friendlyName: checked.friendlyName,
      trial: checked.trial,
      inboundUrl: this.hookUrl(hookId, 'inbound'),
      lastWebhookAt: sameAccount ? (prior?.lastWebhookAt ?? null) : null,
    };
    const data = {
      externalAccountId: hookId,
      accountName: `${checked.friendlyName} (${input.fromNumber})`,
      scopes: [],
      credentialsEncrypted: this.box.seal(JSON.stringify(keys)),
      settings: settings as unknown as Prisma.InputJsonValue,
      status: 'CONNECTED' as const,
      lastError: null,
      lastUsedAt: new Date(),
      connectedById: auth.userId,
    };
    await this.prisma.run(auth, async (tx) => {
      const row = await tx.appConnection.upsert({ where: { tenantId_provider: { tenantId: auth.tenantId, provider: 'TWILIO' } }, create: { tenantId: auth.tenantId, provider: 'TWILIO', ...data }, update: data });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: existing ? 'app.keys_replaced' : 'app.connected', entityType: 'app_connection', entityId: row.id, metadata: { app: 'twilio', number: input.fromNumber, trial: checked.trial }, meta });
    });
    const conn = await this.apps.requireConnection(auth.tenantId, 'twilio');
    await this.apps.recordEvent(auth.tenantId, conn, { kind: 'keys.checked', ok: true, externalId: null, summary: `Credentials checked for ${input.fromNumber}${checked.trial ? ' (trial account)' : ''}`, actorUserId: auth.userId });
    return (await this.apps.status(auth)).find((a) => a.key === 'twilio')!;
  }

  /** The SMS panel on a contact: consent, opt-out, and messages to and from their number. */
  async thread(auth: AuthContext, contactId: string): Promise<SmsThread> {
    return this.prisma.run(auth, async (tx) => {
      const contact = await tx.contact.findFirst({ where: { id: contactId, tenantId: auth.tenantId, deletedAt: null }, select: { phone: true } });
      if (!contact) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Contact not found.' });
      const n = smsNumber(contact.phone);
      if (!n.phone) return { phone: null, phoneProblem: n.problem, consent: null, optedOutAt: null, messages: [] };
      const [consent, rows, optedOutAt] = await Promise.all([
        tx.smsConsent.findFirst({ where: { tenantId: auth.tenantId, contactId, phone: n.phone, revokedAt: null }, orderBy: { createdAt: 'desc' } }),
        tx.smsMessage.findMany({ where: { tenantId: auth.tenantId, phone: n.phone }, orderBy: { createdAt: 'desc' }, take: 100 }),
        this.optedOut(tx, auth.tenantId, n.phone),
      ]);
      const people = await tx.user.findMany({ where: { id: { in: [consent?.recordedById, ...rows.map((r) => r.sentById)].filter((x): x is string => !!x) } }, select: { id: true, name: true } });
      const name = (id: string | null) => people.find((p) => p.id === id)?.name ?? null;
      return {
        phone: n.phone,
        phoneProblem: null,
        consent: consent ? { phone: consent.phone, source: consent.source, recordedBy: name(consent.recordedById), recordedAt: consent.createdAt.toISOString() } : null,
        optedOutAt: optedOutAt?.toISOString() ?? null,
        messages: rows.reverse().map((r) => toRow(r, name(r.sentById))),
      };
    });
  }

  async recordConsent(auth: AuthContext, input: { contactId: string; source: string }, meta: RequestMeta): Promise<SmsThread> {
    await this.prisma.run(auth, async (tx) => {
      const contact = await tx.contact.findFirst({ where: { id: input.contactId, tenantId: auth.tenantId, deletedAt: null }, select: { phone: true } });
      if (!contact) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Contact not found.' });
      const n = smsNumber(contact.phone);
      if (!n.phone) throw new ConflictException({ code: 'NO_SMS_NUMBER', message: n.problem });
      // A STOP reply outranks a consent typed in by a colleague: only the person can undo it, by texting START.
      if (await this.optedOut(tx, auth.tenantId, n.phone)) {
        throw new ConflictException({ code: 'SMS_OPTED_OUT', message: 'This person replied STOP. They have to text START to your number before consent can be recorded again.' });
      }
      await tx.smsConsent.updateMany({ where: { tenantId: auth.tenantId, contactId: input.contactId, revokedAt: null }, data: { revokedAt: new Date(), revokedBy: 'replaced' } });
      const c = await tx.smsConsent.create({ data: { tenantId: auth.tenantId, contactId: input.contactId, phone: n.phone, source: input.source, recordedById: auth.userId } });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'sms.consent_recorded', entityType: 'contact', entityId: input.contactId, metadata: { consentId: c.id, source: input.source }, meta });
    });
    return this.thread(auth, input.contactId);
  }

  async revokeConsent(auth: AuthContext, contactId: string, meta: RequestMeta): Promise<SmsThread> {
    await this.prisma.run(auth, async (tx) => {
      const { count } = await tx.smsConsent.updateMany({ where: { tenantId: auth.tenantId, contactId, revokedAt: null }, data: { revokedAt: new Date(), revokedBy: auth.userId } });
      if (count) await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'sms.consent_revoked', entityType: 'contact', entityId: contactId, metadata: {}, meta });
    });
    return this.thread(auth, contactId);
  }

  /** One SMS to one contact, confirmed by the sender (or approved in a workflow). */
  async send(auth: AuthContext, input: SmsSendInput, meta: RequestMeta, source: 'manual' | 'workflow' = 'manual'): Promise<SmsMessageRow> {
    const conn = await this.apps.requireConnection(auth.tenantId, 'twilio');
    if (conn.status === 'ERROR') throw new AppError(`SMS needs new Twilio credentials: ${conn.lastError ?? 'the last call was refused'}. A workspace admin can replace them in Integrations.`);
    const thread = await this.thread(auth, input.contactId);
    if (!thread.phone) throw new AppError(thread.phoneProblem ?? 'This contact has no usable phone number.');
    if (thread.optedOutAt) throw new AppError(describeTwilioError(21610));
    if (!thread.consent) throw new AppError('Record this contact’s SMS consent before texting them.');
    const keys = this.keys(conn);
    let sent: { sid: string; segments: number };
    try {
      sent = await this.client.send(keys, thread.phone, input.text, this.hookUrl(conn.externalAccountId, 'status'));
    } catch (e) {
      if (!(e instanceof TwilioError)) throw e;
      if (e.revoked) await this.prisma.run({ tenantId: auth.tenantId }, (tx) => tx.appConnection.update({ where: { id: conn.id }, data: { status: 'ERROR', lastError: e.message } }));
      await this.apps.recordEvent(auth.tenantId, conn, { kind: 'message.failed', ok: false, externalId: null, summary: `SMS to ${thread.phone} not sent: ${e.message}`, actorUserId: auth.userId, entityType: 'contact', entityId: input.contactId });
      throw new AppError(e.message);
    }
    const row = await this.prisma.run(auth, async (tx) => {
      const m = await tx.smsMessage.create({
        data: { tenantId: auth.tenantId, connectionId: conn.id, contactId: input.contactId, direction: 'out', phone: thread.phone!, twilioSid: sent.sid, body: input.text, segments: sent.segments, status: 'accepted', sentById: auth.userId, source },
      });
      await tx.appConnection.update({ where: { id: conn.id }, data: { lastUsedAt: new Date() } });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'sms.sent', entityType: 'contact', entityId: input.contactId, metadata: { messageId: m.id, segments: sent.segments, source }, meta });
      return m;
    });
    await this.apps.recordEvent(auth.tenantId, conn, { kind: 'message.sent', ok: true, externalId: sent.sid, summary: `SMS sent to ${thread.phone} (${sent.segments} segment${sent.segments === 1 ? '' : 's'})${source === 'workflow' ? ' (workflow)' : ''}`, actorUserId: auth.userId, entityType: 'contact', entityId: input.contactId });
    return toRow(row, null);
  }

  /** An inbound SMS to the workspace's number, signed by Twilio. Answers with empty TwiML (no auto-reply). */
  async inbound(hookId: string, params: Record<string, string>, signature: string | undefined): Promise<string> {
    const conn = await this.verified(hookId, 'inbound', params, signature);
    const tenantId = conn.tenantId;
    const sid = params.MessageSid ?? params.SmsSid;
    const from = params.From ?? '';
    if (!sid || !/^\+[1-9]\d{7,14}$/.test(from)) return TWIML_EMPTY;
    const body = (params.Body ?? '').slice(0, 1600);
    const word = body.trim().toUpperCase();
    // Twilio sends OptOutType when Advanced Opt-Out handled a keyword; the standard words are checked as well.
    const optType = (params.OptOutType ?? '').toUpperCase();
    const stop = optType === 'STOP' || SMS_STOP_WORDS.has(word);
    const start = !stop && (optType === 'START' || SMS_START_WORDS.has(word));
    const outcome = await this.prisma.run({ tenantId }, async (tx) => {
      const matches = await tx.$queryRaw<{ id: string; owner_id: string | null; first_name: string | null; last_name: string | null }[]>`
        SELECT id, owner_id, first_name, last_name FROM contacts
        WHERE tenant_id = ${tenantId}::uuid AND deleted_at IS NULL AND phone ~ '^\\s*(\\+|00)'
          AND '+' || regexp_replace(regexp_replace(btrim(phone), '^00', ''), '\\D', '', 'g') = ${from}
        LIMIT 2`;
      // Only an unambiguous match is linked; the panel shows the conversation on every contact with that number.
      const contact = matches.length === 1 ? matches[0]! : null;
      const created = await tx.smsMessage.createMany({
        data: [{ tenantId, connectionId: conn.id, contactId: contact?.id ?? null, direction: 'in', phone: from, twilioSid: sid, body, segments: Math.max(1, Number(params.NumSegments ?? 1) || 1), status: 'received', source: 'webhook' }],
        skipDuplicates: true,
      });
      if (!created.count) return null;
      if (stop) await tx.smsConsent.updateMany({ where: { tenantId, phone: from, revokedAt: null }, data: { revokedAt: new Date(), revokedBy: 'contact (replied STOP)' } });
      const who = contact ? [contact.first_name, contact.last_name].filter(Boolean).join(' ') || from : from;
      await this.notifications.send(tx, tenantId, [contact?.owner_id ?? conn.connectedById], {
        type: 'sms.received',
        title: stop ? `${who} opted out of text messages` : start ? `${who} opted back in to texts` : `Text from ${who}`,
        body: stop
          ? 'They replied STOP, so their SMS consent was withdrawn and Twilio will block texts to them until they reply START.'
          : start
            ? 'They replied START. Record their consent again before texting them.'
            : body.slice(0, 300),
        link: contact ? `/app/contacts/${contact.id}` : '/app/integrations',
      });
      return { contactId: contact?.id ?? null };
    });
    if (outcome) {
      await this.apps.recordEvent(tenantId, conn, { kind: stop ? 'consent.revoked' : 'message.received', ok: true, externalId: sid, summary: `${stop ? 'STOP received' : start ? 'START received' : 'Text received'} from ${from}${outcome.contactId ? '' : ' (no single matching contact)'}`, actorUserId: null, entityType: outcome.contactId ? 'contact' : null, entityId: outcome.contactId });
    }
    return TWIML_EMPTY;
  }

  /** A status callback for a message SampForce sent, signed by Twilio. Status only moves forward. */
  async status(hookId: string, params: Record<string, string>, signature: string | undefined): Promise<void> {
    const conn = await this.verified(hookId, 'status', params, signature);
    const tenantId = conn.tenantId;
    const sid = params.MessageSid ?? params.SmsSid;
    const next = STATUS_MAP[(params.MessageStatus ?? params.SmsStatus ?? '').toLowerCase()];
    if (!sid || !next) return;
    const code = params.ErrorCode ? Number(params.ErrorCode) : undefined;
    await this.prisma.run({ tenantId }, async (tx) => {
      const row = await tx.smsMessage.findUnique({ where: { tenantId_twilioSid: { tenantId, twilioSid: sid } } });
      if (!row || row.direction !== 'out') return;
      // A late "sent" never undoes "delivered"; undelivered and failed are final.
      if (row.status === 'failed' || row.status === 'undelivered' || SMS_STATUS_RANK[next]! <= SMS_STATUS_RANK[row.status]!) return;
      const failed = next === 'failed' || next === 'undelivered';
      await tx.smsMessage.update({ where: { id: row.id }, data: { status: next, statusAt: new Date(), error: failed ? describeTwilioError(code) : null } });
      if (failed && row.sentById) {
        await this.notifications.send(tx, tenantId, [row.sentById], { type: 'sms.failed', title: `Text to ${row.phone} was not delivered`, body: describeTwilioError(code), link: row.contactId ? `/app/contacts/${row.contactId}` : '/app/integrations' });
      }
    });
  }

  /** The connection for this endpoint, after checking X-Twilio-Signature against the URL Twilio was given. */
  private async verified(hookId: string, kind: 'inbound' | 'status', params: Record<string, string>, signature: string | undefined): Promise<AppConnection> {
    const conn = await this.byHook(hookId);
    if (!conn) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Unknown webhook.' });
    const keys = this.keys(conn);
    if (!this.client.verify(keys, this.hookUrl(hookId, kind), params, signature)) throw new UnauthorizedException({ code: 'BAD_SIGNATURE', message: 'Signature check failed.' });
    if (params.AccountSid && params.AccountSid !== keys.accountSid) throw new UnauthorizedException({ code: 'BAD_SIGNATURE', message: 'Signature check failed.' });
    const settings = conn.settings as unknown as TwilioSettings;
    if (!settings.lastWebhookAt) {
      await this.prisma.run({ tenantId: conn.tenantId }, (tx) => tx.appConnection.update({ where: { id: conn.id }, data: { settings: { ...settings, lastWebhookAt: new Date().toISOString() } as unknown as Prisma.InputJsonValue } }));
    }
    return conn;
  }

  /** When the number last opted out (STOP) with no START since, or null. */
  private async optedOut(tx: Prisma.TransactionClient, tenantId: string, phone: string): Promise<Date | null> {
    const recent = await tx.smsMessage.findMany({ where: { tenantId, phone, direction: 'in' }, orderBy: { createdAt: 'desc' }, take: 200, select: { body: true, createdAt: true } });
    for (const m of recent) {
      const w = m.body.trim().toUpperCase();
      if (SMS_STOP_WORDS.has(w)) return m.createdAt;
      if (SMS_START_WORDS.has(w)) return null;
    }
    return null;
  }

  private hookUrl(hookId: string, kind: 'inbound' | 'status'): string {
    return `${this.env.PUBLIC_WEB_URL.replace(/\/$/, '')}/api/v1/apps/twilio/webhooks/${hookId}/${kind}`;
  }

  private async byHook(hookId: string): Promise<AppConnection | null> {
    if (!/^[a-f0-9]{24}$/.test(hookId)) return null;
    const conn = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.app_provider', 'TWILIO', true), set_config('app.app_account', ${hookId}, true)`;
      return tx.appConnection.findFirst({ where: { provider: 'TWILIO', externalAccountId: hookId } });
    });
    return conn && conn.status !== 'DISCONNECTED' ? conn : null;
  }

  private keys(conn: AppConnection): TwilioKeys {
    return JSON.parse(this.box.open(conn.credentialsEncrypted)) as TwilioKeys;
  }
}

function toRow(r: SmsMessage, sentBy: string | null): SmsMessageRow {
  return {
    id: r.id,
    direction: r.direction as 'in' | 'out',
    body: r.body,
    segments: r.segments,
    status: r.status as SmsMessageRow['status'],
    error: r.error,
    sentBy,
    source: r.source as SmsMessageRow['source'],
    createdAt: r.createdAt.toISOString(),
    statusAt: r.statusAt?.toISOString() ?? null,
  };
}
