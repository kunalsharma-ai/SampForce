import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { type AppConnection, createManySkipDuplicates, Prisma, type WhatsappMessage } from '@dealflow/database';
import type { AppStatus, WhatsappConnectInput, WhatsappMessageRow, WhatsappSendInput, WhatsappSettings, WhatsappTemplate, WhatsappThread } from '@dealflow/types';
import { AuditService } from '../audit/audit.service';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { SECRET_BOX, type SecretBox } from '../common/crypto';
import { API_ENV, type ApiEnv } from '../common/env';
import { PrismaService } from '../common/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AppError, AppsService } from './apps.service';
import { WhatsappClient, WhatsappError, type WhatsappKeys, waNumber } from './whatsapp';

const DAY = 24 * 60 * 60 * 1000;
/** Replies that end the person's agreement to WhatsApp messages. */
const STOP_WORDS = new Set(['STOP', 'STOP ALL', 'UNSUBSCRIBE', 'OPT OUT', 'OPT-OUT']);
const RANK: Record<string, number> = { accepted: 0, sent: 1, delivered: 2, read: 3, failed: 4 };

/**
 * WhatsApp Business through the workspace's own Cloud API number. A business-initiated message must be an approved
 * template and needs the contact's recorded consent; free-form text is allowed only within 24 hours of their last
 * message, as WhatsApp requires. Every send is one message to one person, confirmed by the sender or approved in a
 * workflow; there is no bulk send. Delivery and read status come only from Meta's signed webhook.
 */
@Injectable()
export class WhatsappService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly apps: AppsService,
    private readonly client: WhatsappClient,
    private readonly notifications: NotificationsService,
    @Inject(SECRET_BOX) private readonly box: SecretBox,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  /** Saves the credentials after a read proves them. The webhook URL and verify token survive replacing them. */
  async connect(auth: AuthContext, input: WhatsappConnectInput, meta: RequestMeta): Promise<AppStatus> {
    const keys: WhatsappKeys = { phoneNumberId: input.phoneNumberId, wabaId: input.wabaId, accessToken: input.accessToken, appSecret: input.appSecret };
    let checked: Awaited<ReturnType<WhatsappClient['check']>>;
    try {
      checked = await this.client.check(keys);
    } catch (e) {
      throw e instanceof WhatsappError ? new AppError(e.message) : e;
    }
    const existing = await this.prisma.run(auth, (tx) => tx.appConnection.findUnique({ where: { tenantId_provider: { tenantId: auth.tenantId, provider: 'WHATSAPP' } } }));
    const prior = existing?.settings as Partial<WhatsappSettings> | undefined;
    const hookId = existing?.externalAccountId ?? randomBytes(12).toString('hex');
    const sameApp = !!existing && this.keys(existing).appSecret === input.appSecret && prior?.phoneNumberId === input.phoneNumberId;
    const settings: WhatsappSettings = {
      phoneNumberId: input.phoneNumberId,
      wabaId: input.wabaId,
      displayPhoneNumber: checked.displayPhoneNumber,
      verifiedName: checked.verifiedName,
      qualityRating: checked.qualityRating,
      webhookUrl: `${this.env.PUBLIC_WEB_URL.replace(/\/$/, '')}/api/v1/apps/whatsapp/webhooks/${hookId}`,
      verifyToken: prior?.verifyToken ?? randomBytes(16).toString('hex'),
      lastWebhookAt: sameApp ? (prior?.lastWebhookAt ?? null) : null,
    };
    const data = {
      externalAccountId: hookId,
      accountName: `${checked.verifiedName} (${checked.displayPhoneNumber})`,
      scopes: [],
      credentialsEncrypted: this.box.seal(JSON.stringify(keys)),
      settings: settings as unknown as Prisma.InputJsonValue,
      status: 'CONNECTED' as const,
      lastError: null,
      lastUsedAt: new Date(),
      connectedById: auth.userId,
    };
    await this.prisma.run(auth, async (tx) => {
      const row = await tx.appConnection.upsert({ where: { tenantId_provider: { tenantId: auth.tenantId, provider: 'WHATSAPP' } }, create: { tenantId: auth.tenantId, provider: 'WHATSAPP', ...data }, update: data });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: existing ? 'app.keys_replaced' : 'app.connected', entityType: 'app_connection', entityId: row.id, metadata: { app: 'whatsapp', number: checked.displayPhoneNumber }, meta });
    });
    const conn = await this.apps.requireConnection(auth.tenantId, 'whatsapp');
    await this.apps.recordEvent(auth.tenantId, conn, { kind: 'keys.checked', ok: true, externalId: null, summary: `Credentials checked for ${checked.displayPhoneNumber}`, actorUserId: auth.userId });
    return (await this.apps.status(auth)).find((a) => a.key === 'whatsapp')!;
  }

  async templates(auth: AuthContext): Promise<WhatsappTemplate[]> {
    const conn = await this.apps.requireConnection(auth.tenantId, 'whatsapp');
    return this.guard(auth.tenantId, conn, () => this.client.templates(this.keys(conn)));
  }

  /** The WhatsApp panel on a contact: consent, the 24-hour window, and messages to and from their number. */
  async thread(auth: AuthContext, contactId: string): Promise<WhatsappThread> {
    return this.prisma.run(auth, async (tx) => {
      const contact = await tx.contact.findFirst({ where: { id: contactId, tenantId: auth.tenantId, deletedAt: null }, select: { phone: true } });
      if (!contact) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Contact not found.' });
      const n = waNumber(contact.phone);
      if (!n.phone) return { phone: null, phoneProblem: n.problem, consent: null, windowOpenUntil: null, messages: [] };
      const [consent, rows, lastIn] = await Promise.all([
        tx.whatsappConsent.findFirst({ where: { tenantId: auth.tenantId, contactId, phone: n.phone, revokedAt: null }, orderBy: { createdAt: 'desc' } }),
        tx.whatsappMessage.findMany({ where: { tenantId: auth.tenantId, phone: n.phone }, orderBy: { createdAt: 'desc' }, take: 100 }),
        tx.whatsappMessage.findFirst({ where: { tenantId: auth.tenantId, phone: n.phone, direction: 'in' }, orderBy: { createdAt: 'desc' } }),
      ]);
      const people = await tx.user.findMany({ where: { id: { in: [consent?.recordedById, ...rows.map((r) => r.sentById)].filter((x): x is string => !!x) } }, select: { id: true, name: true } });
      const name = (id: string | null) => people.find((p) => p.id === id)?.name ?? null;
      const until = lastIn ? new Date(lastIn.createdAt.getTime() + DAY) : null;
      return {
        phone: n.phone,
        phoneProblem: null,
        consent: consent ? { phone: consent.phone, source: consent.source, recordedBy: name(consent.recordedById), recordedAt: consent.createdAt.toISOString() } : null,
        windowOpenUntil: until && until > new Date() ? until.toISOString() : null,
        messages: rows.reverse().map((r) => toRow(r, name(r.sentById))),
      };
    });
  }

  async recordConsent(auth: AuthContext, input: { contactId: string; source: string }, meta: RequestMeta): Promise<WhatsappThread> {
    await this.prisma.run(auth, async (tx) => {
      const contact = await tx.contact.findFirst({ where: { id: input.contactId, tenantId: auth.tenantId, deletedAt: null }, select: { phone: true } });
      if (!contact) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Contact not found.' });
      const n = waNumber(contact.phone);
      if (!n.phone) throw new ConflictException({ code: 'NO_WHATSAPP_NUMBER', message: n.problem });
      await tx.whatsappConsent.updateMany({ where: { tenantId: auth.tenantId, contactId: input.contactId, revokedAt: null }, data: { revokedAt: new Date(), revokedBy: 'replaced' } });
      const c = await tx.whatsappConsent.create({ data: { tenantId: auth.tenantId, contactId: input.contactId, phone: n.phone, source: input.source, recordedById: auth.userId } });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'whatsapp.consent_recorded', entityType: 'contact', entityId: input.contactId, metadata: { consentId: c.id, source: input.source }, meta });
    });
    return this.thread(auth, input.contactId);
  }

  async revokeConsent(auth: AuthContext, contactId: string, meta: RequestMeta): Promise<WhatsappThread> {
    await this.prisma.run(auth, async (tx) => {
      const { count } = await tx.whatsappConsent.updateMany({ where: { tenantId: auth.tenantId, contactId, revokedAt: null }, data: { revokedAt: new Date(), revokedBy: auth.userId } });
      if (count) await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'whatsapp.consent_revoked', entityType: 'contact', entityId: contactId, metadata: {}, meta });
    });
    return this.thread(auth, contactId);
  }

  /** One message to one contact, confirmed by the sender (or approved in a workflow). */
  async send(auth: AuthContext, input: WhatsappSendInput, meta: RequestMeta, source: 'manual' | 'workflow' = 'manual'): Promise<WhatsappMessageRow> {
    const conn = await this.apps.requireConnection(auth.tenantId, 'whatsapp');
    if (conn.status === 'ERROR') throw new AppError(`WhatsApp needs new credentials: ${conn.lastError ?? 'the last call was refused'}. A workspace admin can replace them in Integrations.`);
    const thread = await this.thread(auth, input.contactId);
    if (!thread.phone) throw new AppError(thread.phoneProblem ?? 'This contact has no usable WhatsApp number.');
    const keys = this.keys(conn);
    let body: string;
    let templateName: string | null = null;
    let sent: { waMessageId: string };
    if (input.kind === 'template') {
      if (!thread.consent) throw new AppError('Record this contact’s WhatsApp consent before sending them a template. WhatsApp requires an opt-in for business-initiated messages.');
      const templates = await this.guard(auth.tenantId, conn, () => this.client.templates(keys));
      const t = templates.find((x) => x.name === input.templateName && x.language === input.language);
      if (!t) throw new AppError(`There is no approved template "${input.templateName}" (${input.language}) on this WhatsApp number.`);
      if (input.params.length !== t.params) throw new AppError(t.params === 1 ? `The template "${t.name}" needs 1 value; ${input.params.length} given.` : `The template "${t.name}" needs ${t.params} values; ${input.params.length} given.`);
      body = t.body.replace(/\{\{(\d+)\}\}/g, (_, i: string) => input.params[Number(i) - 1] ?? '');
      templateName = t.name;
      sent = await this.guard(auth.tenantId, conn, () => this.client.sendTemplate(keys, thread.phone!, { name: t.name, language: t.language, params: input.params }), { contactId: input.contactId, summary: `Template ${t.name}` });
    } else {
      if (!thread.windowOpenUntil) throw new AppError('More than 24 hours have passed since their last WhatsApp message (or they have not written yet), so only an approved template can be sent.');
      body = input.text;
      sent = await this.guard(auth.tenantId, conn, () => this.client.sendText(keys, thread.phone!, input.text), { contactId: input.contactId, summary: 'Reply' });
    }
    const row = await this.prisma.run(auth, async (tx) => {
      const m = await tx.whatsappMessage.create({
        data: { tenantId: auth.tenantId, connectionId: conn.id, contactId: input.contactId, direction: 'out', phone: thread.phone!, waMessageId: sent.waMessageId, kind: input.kind, body, templateName, status: 'accepted', sentById: auth.userId, source },
      });
      await tx.appConnection.update({ where: { id: conn.id }, data: { lastUsedAt: new Date() } });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'whatsapp.sent', entityType: 'contact', entityId: input.contactId, metadata: { messageId: m.id, kind: input.kind, template: templateName, source }, meta });
      return m;
    });
    await this.apps.recordEvent(auth.tenantId, conn, { kind: 'message.sent', ok: true, externalId: sent.waMessageId, summary: `${templateName ? `Template ${templateName}` : 'Reply'} sent to +${thread.phone}${source === 'workflow' ? ' (workflow)' : ''}`, actorUserId: auth.userId, entityType: 'contact', entityId: input.contactId });
    return toRow(row, null);
  }

  /** Meta's subscription check: echo the challenge only for this workspace's verify token. */
  async verifySubscription(hookId: string, q: { mode?: string; token?: string; challenge?: string }): Promise<string> {
    const conn = await this.byHook(hookId);
    const settings = conn ? (conn.settings as unknown as WhatsappSettings) : null;
    if (!conn || !settings || q.mode !== 'subscribe' || !q.token || q.token !== settings.verifyToken || !q.challenge) throw new ForbiddenException({ code: 'VERIFY_FAILED', message: 'Verification failed.' });
    return q.challenge.slice(0, 200);
  }

  /** Signed deliveries from Meta: inbound messages and delivery status for this workspace's number. */
  async webhook(hookId: string, raw: Buffer | undefined, signature: string | undefined): Promise<{ received: true }> {
    const conn = await this.byHook(hookId);
    if (!conn || !raw) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Unknown webhook.' });
    let w;
    try {
      w = this.client.parseWebhook(this.keys(conn), raw, signature);
    } catch (e) {
      if (e instanceof WhatsappError) throw new UnauthorizedException({ code: 'BAD_SIGNATURE', message: 'Signature check failed.' });
      throw e;
    }
    const tenantId = conn.tenantId;
    const settings = conn.settings as unknown as WhatsappSettings;
    if (!settings.lastWebhookAt) {
      await this.prisma.run({ tenantId }, (tx) => tx.appConnection.update({ where: { id: conn.id }, data: { settings: { ...settings, lastWebhookAt: new Date().toISOString() } as unknown as Prisma.InputJsonValue } }));
    }

    for (const m of w.inbound) {
      const outcome = await this.prisma.run({ tenantId }, async (tx) => {
        const matches = await tx.$queryRaw<{ id: string; owner_id: string | null; first_name: string | null; last_name: string | null }[]>`
          SELECT id, owner_id, first_name, last_name FROM contacts
          WHERE tenant_id = ${tenantId}::uuid AND deleted_at IS NULL AND phone ~ '^\\s*(\\+|00)'
            AND regexp_replace(regexp_replace(btrim(phone), '^00', ''), '\\D', '', 'g') = ${m.from}
          LIMIT 2`;
        // Only an unambiguous match is linked; the panel shows the conversation on every contact with that number.
        const contact = matches.length === 1 ? matches[0]! : null;
        const created = await createManySkipDuplicates(tx.whatsappMessage, 'WhatsappMessage', [{ tenantId, connectionId: conn.id, contactId: contact?.id ?? null, direction: 'in', phone: m.from, waMessageId: m.waMessageId, kind: m.kind, body: m.body, status: 'received', source: 'webhook' }]);
        if (!created.count) return null;
        const stop = STOP_WORDS.has(m.body.trim().toUpperCase());
        if (stop) {
          await tx.whatsappConsent.updateMany({ where: { tenantId, phone: m.from, revokedAt: null }, data: { revokedAt: new Date(), revokedBy: 'contact (replied STOP)' } });
        }
        const who = contact ? [contact.first_name, contact.last_name].filter(Boolean).join(' ') || `+${m.from}` : (m.name ?? `+${m.from}`);
        await this.notifications.send(tx, tenantId, [contact?.owner_id ?? conn.connectedById], {
          type: 'whatsapp.received',
          title: stop ? `${who} opted out of WhatsApp messages` : `WhatsApp message from ${who}`,
          body: stop ? 'They replied STOP, so their WhatsApp consent was withdrawn. Templates can no longer be sent to them.' : m.body.slice(0, 300),
          link: contact ? `/app/contacts/${contact.id}` : '/app/integrations',
        });
        return { contactId: contact?.id ?? null, stop };
      });
      if (outcome) {
        await this.apps.recordEvent(tenantId, conn, { kind: outcome.stop ? 'consent.revoked' : 'message.received', ok: true, externalId: m.waMessageId, summary: `${outcome.stop ? 'STOP received' : 'Message received'} from +${m.from}${outcome.contactId ? '' : ' (no single matching contact)'}`, actorUserId: null, entityType: outcome.contactId ? 'contact' : null, entityId: outcome.contactId });
      }
    }

    for (const s of w.statuses) {
      await this.prisma.run({ tenantId }, async (tx) => {
        const row = await tx.whatsappMessage.findUnique({ where: { tenantId_waMessageId: { tenantId, waMessageId: s.waMessageId } } });
        if (!row || row.direction !== 'out') return;
        // Status only moves forward; a late "sent" never undoes "read". Failure is final.
        if (row.status === 'failed' || (s.status !== 'failed' && RANK[s.status]! <= RANK[row.status]!)) return;
        await tx.whatsappMessage.update({ where: { id: row.id }, data: { status: s.status, statusAt: s.at, error: s.error } });
        if (s.status === 'failed' && row.sentById) {
          await this.notifications.send(tx, tenantId, [row.sentById], { type: 'whatsapp.failed', title: `WhatsApp message to +${row.phone} failed`, body: s.error ?? 'WhatsApp did not deliver it.', link: row.contactId ? `/app/contacts/${row.contactId}` : '/app/integrations' });
        }
      });
    }
    return { received: true };
  }

  private async byHook(hookId: string): Promise<AppConnection | null> {
    if (!/^[a-f0-9]{24}$/.test(hookId)) return null;
    const conn = await this.prisma.run({ lookup: { AppConnection: { provider: 'WHATSAPP', externalAccountId: hookId } } }, async (tx) => {
      return tx.appConnection.findFirst({ where: { provider: 'WHATSAPP', externalAccountId: hookId } });
    });
    return conn && conn.status !== 'DISCONNECTED' ? conn : null;
  }

  /** Runs a Meta call; a refused token marks the connection, and any refusal is logged and shown in plain words. */
  private async guard<T>(tenantId: string, conn: AppConnection, fn: () => Promise<T>, log?: { contactId: string; summary: string }): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (!(e instanceof WhatsappError)) throw e;
      if (e.revoked) await this.prisma.run({ tenantId }, (tx) => tx.appConnection.update({ where: { id: conn.id }, data: { status: 'ERROR', lastError: e.message } }));
      if (log) await this.apps.recordEvent(tenantId, conn, { kind: 'message.failed', ok: false, externalId: null, summary: `${log.summary} not sent: ${e.message}`, actorUserId: null, entityType: 'contact', entityId: log.contactId });
      throw new AppError(e.message);
    }
  }

  private keys(conn: AppConnection): WhatsappKeys {
    return JSON.parse(this.box.open(conn.credentialsEncrypted)) as WhatsappKeys;
  }
}

function toRow(r: WhatsappMessage, sentBy: string | null): WhatsappMessageRow {
  return {
    id: r.id,
    direction: r.direction as 'in' | 'out',
    kind: r.kind as WhatsappMessageRow['kind'],
    body: r.body,
    templateName: r.templateName,
    status: r.status as WhatsappMessageRow['status'],
    error: r.error,
    sentBy,
    source: r.source as WhatsappMessageRow['source'],
    createdAt: r.createdAt.toISOString(),
    statusAt: r.statusAt?.toISOString() ?? null,
  };
}
