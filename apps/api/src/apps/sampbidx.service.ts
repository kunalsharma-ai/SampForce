import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { type AppConnection, Prisma, type SampbidxTransfer } from '@dealflow/database';
import {
  type AppStatus,
  parsePastedEmail,
  SAMPBIDX_MAX_FILES,
  SAMPBIDX_MAX_TOTAL_BYTES,
  SAMPBIDX_REQUIRED_RFQ_FIELDS,
  type RfqRow,
  type SampbidxCallback,
  sampbidxCallbackSchema,
  type SampbidxConnectInput,
  type SampbidxEmailFileQuery,
  type SampbidxMailboxEmail,
  type SampbidxRemoteStatus,
  type SampbidxRequiredField,
  type SampbidxRfqReadiness,
  type SampbidxSendMailboxEmailInput,
  type SampbidxPastedEmail,
  type SampbidxSendRfqInput,
  type SampbidxSettings,
  type SampbidxTransferKind,
  type SampbidxTransferListQuery,
  type SampbidxTransferRow,
} from '@dealflow/types';
import { AuditService } from '../audit/audit.service';
import { hasFeature } from '../billing/entitlements';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { SECRET_BOX, type SecretBox } from '../common/crypto';
import { API_ENV, type ApiEnv } from '../common/env';
import { PrismaService } from '../common/prisma.service';
import { CompanyWorkService } from '../crm/company-work.service';
import { personRefs } from '../crm/visibility';
import { NotificationsService } from '../notifications/notifications.service';
import { AppError, AppsService } from './apps.service';
import { emlHeaders, type Part, SampbidxClient, SampbidxError, type SampbidxKeys, verifySampbidxSignature } from './sampbidx';

/** A send still "SENDING" after this long is treated as interrupted, so it can be retried. */
const STALE_SENDING_MS = 2 * 60_000;

/**
 * Sends RFQs to the workspace's SampBidx (ADR 0061), in one of two ways the person picks:
 * 1. A filled-in RFQ: its details (checked for the fields SampBidx needs) and the files attached to it.
 * 2. The RFQ email itself: one from the person's synced mailbox, an .eml/.msg file they upload, or its text pasted
 *    on the company page.
 * Every send is a row in sampbidx_transfers with SampBidx's id once it accepts it; SampBidx reports progress back
 * through a signed callback. A failed send keeps its row and can be retried with the same Idempotency-Key.
 */
@Injectable()
export class SampbidxService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly apps: AppsService,
    private readonly client: SampbidxClient,
    private readonly work: CompanyWorkService,
    private readonly notifications: NotificationsService,
    @Inject(SECRET_BOX) private readonly box: SecretBox,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  // ─── Connection ───

  /** Saves the address and key after GET /v1/ping accepts them. The callback URL and secret survive replacing the key. */
  async connect(auth: AuthContext, input: SampbidxConnectInput, meta: RequestMeta): Promise<AppStatus> {
    const baseUrl = input.baseUrl.replace(/\/+$/, '');
    let checked: { accountName: string };
    try {
      checked = await this.client.check({ baseUrl, apiKey: input.apiKey });
    } catch (e) {
      throw e instanceof SampbidxError ? new AppError(e.message) : e;
    }
    const existing = await this.prisma.run(auth, (tx) => tx.appConnection.findUnique({ where: { tenantId_provider: { tenantId: auth.tenantId, provider: 'SAMPBIDX' } } }));
    const prior = existing ? this.keys(existing) : null;
    const prevSettings = existing?.settings as Partial<SampbidxSettings> | undefined;
    const hookId = existing?.externalAccountId ?? randomBytes(12).toString('hex');
    const keys: SampbidxKeys = { baseUrl, apiKey: input.apiKey, callbackSecret: prior?.callbackSecret ?? newSecret() };
    const settings: SampbidxSettings = { baseUrl, accountName: checked.accountName, callbackUrl: this.callbackUrl(hookId), lastCallbackAt: prior?.baseUrl === baseUrl ? (prevSettings?.lastCallbackAt ?? null) : null };
    const data = {
      externalAccountId: hookId,
      accountName: checked.accountName,
      scopes: [],
      credentialsEncrypted: this.box.seal(JSON.stringify(keys)),
      settings: settings as unknown as Prisma.InputJsonValue,
      status: 'CONNECTED' as const,
      lastError: null,
      lastUsedAt: new Date(),
      connectedById: auth.userId,
    };
    await this.prisma.run(auth, async (tx) => {
      const row = await tx.appConnection.upsert({ where: { tenantId_provider: { tenantId: auth.tenantId, provider: 'SAMPBIDX' } }, create: { tenantId: auth.tenantId, provider: 'SAMPBIDX', ...data }, update: data });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: existing ? 'app.keys_replaced' : 'app.connected', entityType: 'app_connection', entityId: row.id, metadata: { app: 'sampbidx', baseUrl }, meta });
    });
    const conn = await this.apps.requireConnection(auth.tenantId, 'sampbidx');
    await this.apps.recordEvent(auth.tenantId, conn, { kind: 'keys.checked', ok: true, externalId: null, summary: `API key checked with ${checked.accountName} at ${baseUrl}`, actorUserId: auth.userId });
    return (await this.apps.status(auth)).find((a) => a.key === 'sampbidx')!;
  }

  /** The callback signing secret, for an admin to paste into SampBidx. */
  async callbackSecret(auth: AuthContext): Promise<{ callbackUrl: string; secret: string }> {
    const conn = await this.connection(auth.tenantId);
    return { callbackUrl: this.callbackUrl(conn.externalAccountId), secret: this.keys(conn).callbackSecret };
  }

  /** A new callback secret; SampBidx must be given it, since callbacks signed with the old one are refused from now on. */
  async rotateCallbackSecret(auth: AuthContext, meta: RequestMeta): Promise<{ callbackUrl: string; secret: string }> {
    const conn = await this.connection(auth.tenantId);
    const keys = { ...this.keys(conn), callbackSecret: newSecret() };
    await this.prisma.run(auth, async (tx) => {
      await tx.appConnection.update({ where: { id: conn.id }, data: { credentialsEncrypted: this.box.seal(JSON.stringify(keys)) } });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'app.secret_rotated', entityType: 'app_connection', entityId: conn.id, metadata: { app: 'sampbidx' }, meta });
    });
    return { callbackUrl: this.callbackUrl(conn.externalAccountId), secret: keys.callbackSecret };
  }

  // ─── Option 1: a filled-in RFQ with its attachments ───

  /** Step 1 and 2 of "Send to SampBidx": which required details are missing, the files that can go, and earlier sends. */
  async readiness(auth: AuthContext, rfqId: string): Promise<SampbidxRfqReadiness> {
    const rfq = await this.work.getRfq(auth, rfqId);
    const conn = await this.prisma.run(auth, (tx) => tx.appConnection.findUnique({ where: { tenantId_provider: { tenantId: auth.tenantId, provider: 'SAMPBIDX' } } }));
    const files = await this.prisma.run(auth, (tx) =>
      tx.companyFile.findMany({ where: { tenantId: auth.tenantId, rfqId }, select: { id: true, name: true, sizeBytes: true, contentType: true }, orderBy: { createdAt: 'asc' } }),
    );
    return { connected: !!conn && conn.status !== 'DISCONNECTED', missing: missingFields(rfq), files, transfers: await this.list(auth, { rfqId, limit: 50 }) };
  }

  async sendRfq(auth: AuthContext, input: SampbidxSendRfqInput, meta: RequestMeta): Promise<SampbidxTransferRow> {
    const conn = await this.usableConnection(auth.tenantId);
    const rfq = await this.work.editableRfq(auth, input.rfqId);
    const missing = missingFields(rfq);
    if (missing.length) {
      throw new BadRequestException({ code: 'SAMPBIDX_INCOMPLETE', message: 'Fill in the missing RFQ details before sending it to SampBidx.', details: missing.map((m) => ({ path: m, message: 'is required' })) });
    }
    const files = await this.prisma.run(auth, (tx) =>
      tx.companyFile.findMany({ where: { tenantId: auth.tenantId, rfqId: rfq.id, ...(input.fileIds ? { id: { in: input.fileIds } } : {}) }, select: { id: true, name: true, sizeBytes: true }, orderBy: { createdAt: 'asc' } }),
    );
    if (input.fileIds && files.length !== new Set(input.fileIds).size) throw new BadRequestException({ code: 'INVALID_FILE', message: 'One of the chosen files is not attached to this RFQ.' });
    checkFileLimits(files);
    const transfer = await this.prisma.run(auth, async (tx) => {
      await this.assertNotDuplicate(tx, auth.tenantId, { rfqId: rfq.id, kind: 'RFQ' }, input.resend, `${rfq.number} is already with SampBidx. Send it again only if SampBidx should get a second copy.`);
      const t = await tx.sampbidxTransfer.create({
        data: {
          tenantId: auth.tenantId,
          kind: 'RFQ',
          title: `${rfq.number} ${rfq.projectName}`,
          rfqId: rfq.id,
          companyId: rfq.company.id,
          fileIds: files.map((f) => f.id),
          files: files.map((f) => ({ name: f.name, sizeBytes: f.sizeBytes })),
          note: input.note ?? null,
          createdById: auth.userId,
        },
      });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'sampbidx.rfq_sent', entityType: 'rfq', entityId: rfq.id, metadata: { transferId: t.id, files: files.length }, meta });
      return t;
    });
    return this.deliver(auth, conn, transfer);
  }

  // ─── Option 2: the RFQ email itself ───

  /** Emails from the person's own connected mailboxes, newest first, to pick one to transfer. */
  async mailbox(auth: AuthContext, q: { q?: string; limit: number }): Promise<SampbidxMailboxEmail[]> {
    return this.prisma.run(auth, async (tx) => {
      const connections = await tx.integrationConnection.findMany({ where: { tenantId: auth.tenantId, userId: auth.userId }, select: { id: true } });
      if (!connections.length) return [];
      const term = q.q?.trim();
      const rows = await tx.emailMessage.findMany({
        where: {
          tenantId: auth.tenantId,
          connectionId: { in: connections.map((c) => c.id) },
          ...(term ? { OR: [{ subject: { contains: term, mode: 'insensitive' } }, { fromAddress: { contains: term, mode: 'insensitive' } }, { snippet: { contains: term, mode: 'insensitive' } }] } : {}),
        },
        orderBy: { sentAt: 'desc' },
        take: q.limit,
        select: { id: true, subject: true, fromAddress: true, toAddresses: true, sentAt: true, snippet: true, direction: true, contactId: true },
      });
      const [contacts, transfers] = await Promise.all([
        tx.contact.findMany({ where: { tenantId: auth.tenantId, id: { in: rows.map((r) => r.contactId).filter((c): c is string => !!c) }, deletedAt: null }, select: { id: true, firstName: true, lastName: true, companyId: true } }),
        tx.sampbidxTransfer.findMany({ where: { tenantId: auth.tenantId, emailMessageId: { in: rows.map((r) => r.id) }, delivery: 'SENT' }, select: { emailMessageId: true, sentAt: true }, orderBy: { sentAt: 'desc' } }),
      ]);
      const companies = await tx.company.findMany({ where: { tenantId: auth.tenantId, id: { in: contacts.map((c) => c.companyId).filter((c): c is string => !!c) } }, select: { id: true, name: true } });
      return rows.map((r) => {
        const c = contacts.find((x) => x.id === r.contactId);
        return {
          id: r.id,
          subject: r.subject,
          fromAddress: r.fromAddress,
          toAddresses: r.toAddresses,
          sentAt: r.sentAt.toISOString(),
          snippet: r.snippet,
          direction: r.direction,
          transferredAt: transfers.find((t) => t.emailMessageId === r.id)?.sentAt?.toISOString() ?? null,
          contact: c ? { id: c.id, name: [c.firstName, c.lastName].filter(Boolean).join(' '), companyId: c.companyId, companyName: companies.find((x) => x.id === c.companyId)?.name ?? null } : null,
        };
      });
    });
  }

  async sendMailboxEmail(auth: AuthContext, input: SampbidxSendMailboxEmailInput, meta: RequestMeta): Promise<SampbidxTransferRow> {
    const conn = await this.usableConnection(auth.tenantId);
    const email = await this.prisma.run(auth, async (tx) => {
      const m = await tx.emailMessage.findFirst({ where: { id: input.emailMessageId, tenantId: auth.tenantId }, include: { connection: { select: { userId: true } } } });
      // Only the mailbox's owner can pick its emails; anyone else is told it does not exist.
      if (!m || m.connection.userId !== auth.userId) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Email not found.' });
      return m;
    });
    const link = await this.links(auth, input.companyId ?? null, input.rfqId ?? null, email.contactId);
    const transfer = await this.prisma.run(auth, async (tx) => {
      await this.assertNotDuplicate(tx, auth.tenantId, { emailMessageId: email.id }, input.resend, 'This email is already with SampBidx. Send it again only if SampBidx should get a second copy.');
      const t = await tx.sampbidxTransfer.create({
        data: {
          tenantId: auth.tenantId,
          kind: 'MAILBOX_EMAIL',
          title: email.subject || '(no subject)',
          emailMessageId: email.id,
          emailFrom: email.fromAddress,
          emailDate: email.sentAt,
          companyId: link.companyId,
          rfqId: link.rfqId,
          files: [],
          note: input.note ?? null,
          createdById: auth.userId,
        },
      });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'sampbidx.email_sent', entityType: 'email_message', entityId: email.id, metadata: { transferId: t.id }, meta });
      return t;
    });
    return this.deliver(auth, conn, transfer);
  }

  /** An .eml or .msg file the person saved from their mail program, sent to SampBidx as it is, attachments included. */
  async sendEmailFile(auth: AuthContext, q: SampbidxEmailFileQuery, file: { name: string; contentType: string; data: Buffer }, meta: RequestMeta): Promise<SampbidxTransferRow> {
    const conn = await this.usableConnection(auth.tenantId);
    const kind = emailFileKind(file.name, file.contentType, file.data);
    if (!kind) throw new BadRequestException({ code: 'UNSUPPORTED_TYPE', message: 'Upload the email as an .eml file (or an Outlook .msg file). Save or drag it out of your mail program.' });
    const head = kind === 'message/rfc822' ? emlHeaders(file.data) : { subject: null, from: null, date: null };
    const link = await this.links(auth, q.companyId ?? null, q.rfqId ?? null, null);
    const transfer = await this.prisma.run(auth, async (tx) => {
      const t = await tx.sampbidxTransfer.create({
        data: {
          tenantId: auth.tenantId,
          kind: 'EMAIL_FILE',
          title: head.subject || file.name,
          emailFrom: head.from,
          emailDate: head.date,
          emailFileName: file.name,
          emailFileType: kind,
          emailFileData: new Uint8Array(file.data),
          companyId: link.companyId,
          rfqId: link.rfqId,
          files: [{ name: file.name, sizeBytes: file.data.length }],
          note: q.note ?? null,
          createdById: auth.userId,
        },
      });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'sampbidx.email_file_sent', entityType: 'sampbidx_transfer', entityId: t.id, metadata: { name: file.name, bytes: file.data.length }, meta });
      return t;
    });
    return this.deliver(auth, conn, transfer);
  }

  /**
   * Email text a client sent, pasted on the company page and sent in one click. Subject, sender and date come from
   * the person when given, otherwise from the text. The sender is matched to one of the company's employees, and the
   * email is logged on the company as an "RFQ received" interaction unless the person turns that off.
   */
  async sendPastedEmail(auth: AuthContext, input: SampbidxPastedEmail, meta: RequestMeta): Promise<SampbidxTransferRow> {
    const conn = await this.usableConnection(auth.tenantId);
    const link = await this.links(auth, input.companyId, input.rfqId ?? null, null);
    const parsed = parsePastedEmail(input.text);
    const from = input.from?.trim() || parsed.from;
    const date = input.date ? new Date(input.date) : parsed.date;
    const contact = await this.prisma.run(auth, async (tx) => {
      if (input.contactId) {
        const c = await tx.contact.findFirst({ where: { id: input.contactId, tenantId: auth.tenantId, companyId: input.companyId, deletedAt: null }, select: { id: true, firstName: true, lastName: true, email: true } });
        if (!c) throw new BadRequestException({ code: 'INVALID_CONTACT', message: 'That employee is not at this company.' });
        return c;
      }
      const address = (from && from.match(/[^\s<>"'(),;:]+@[^\s<>"'(),;:]+\.[a-z]{2,}/i)?.[0]) || null;
      if (!address) return null;
      return tx.contact.findFirst({ where: { tenantId: auth.tenantId, companyId: input.companyId, deletedAt: null, email: { equals: address, mode: 'insensitive' } }, select: { id: true, firstName: true, lastName: true, email: true } });
    });
    const company = await this.prisma.run(auth, (tx) => tx.company.findFirstOrThrow({ where: { id: input.companyId, tenantId: auth.tenantId }, select: { name: true } }));
    const contactName = contact ? [contact.firstName, contact.lastName].filter(Boolean).join(' ') : null;
    const subject = input.subject?.trim() || parsed.subject || `RFQ email from ${contactName ?? company.name}`;
    const { transfer, isCopy } = await this.prisma.run(auth, async (tx) => {
      const prior = await tx.sampbidxTransfer.count({ where: { tenantId: auth.tenantId, companyId: input.companyId, kind: 'PASTED_EMAIL', emailText: input.text, delivery: 'SENT' } });
      await this.assertNotDuplicate(tx, auth.tenantId, { companyId: input.companyId, kind: 'PASTED_EMAIL', emailText: input.text }, input.resend, 'This email is already with SampBidx. Send it again only if SampBidx should get a second copy.');
      const t = await tx.sampbidxTransfer.create({
        data: {
          tenantId: auth.tenantId,
          kind: 'PASTED_EMAIL',
          title: subject.slice(0, 300),
          emailFrom: from ?? null,
          emailDate: date,
          emailText: input.text,
          contactId: contact?.id ?? null,
          companyId: link.companyId,
          rfqId: link.rfqId,
          files: [],
          note: input.note ?? null,
          createdById: auth.userId,
        },
      });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'sampbidx.pasted_email_sent', entityType: 'company', entityId: input.companyId, metadata: { transferId: t.id, chars: input.text.length }, meta });
      return { transfer: t, isCopy: prior > 0 };
    });
    // The client's email belongs in the company's communication history whatever SampBidx answers; a second copy is not logged twice.
    if (input.logInteraction && !isCopy && (await this.prisma.run(auth, (tx) => hasFeature(tx, auth.tenantId, 'interactions')))) {
      const logged = await this.work.logInteraction(
        auth,
        {
          companyId: input.companyId,
          contactId: contact?.id ?? null,
          kind: 'RFQ_RECEIVED',
          subject: subject.slice(0, 200),
          occurredAt: (date ?? new Date()).toISOString(),
          sender: from ? from.slice(0, 200) : null,
          remarks: input.text.slice(0, 10_000),
          rfqId: link.rfqId,
        },
        meta,
      );
      await this.prisma.run(auth, (tx) => tx.sampbidxTransfer.update({ where: { id: transfer.id }, data: { activityId: logged.id } }));
    }
    return this.deliver(auth, conn, transfer);
  }

  // ─── History and retries ───

  async list(auth: AuthContext, q: Partial<SampbidxTransferListQuery>): Promise<SampbidxTransferRow[]> {
    return this.prisma.run(auth, async (tx) => {
      const rows = await tx.sampbidxTransfer.findMany({
        where: { tenantId: auth.tenantId, ...(q.rfqId ? { rfqId: q.rfqId } : {}), ...(q.companyId ? { companyId: q.companyId } : {}), ...(q.delivery ? { delivery: q.delivery } : {}) },
        orderBy: { createdAt: 'desc' },
        take: q.limit ?? 50,
        omit: { emailFileData: true },
      });
      return this.rows(tx, auth.tenantId, rows);
    });
  }

  /** Sends a failed (or interrupted) transfer again, with the same Idempotency-Key. */
  async retry(auth: AuthContext, id: string, meta: RequestMeta): Promise<SampbidxTransferRow> {
    const conn = await this.usableConnection(auth.tenantId);
    const t = await this.prisma.run(auth, (tx) => tx.sampbidxTransfer.findFirst({ where: { id, tenantId: auth.tenantId } }));
    if (!t) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Transfer not found.' });
    if (t.delivery === 'SENT') throw new ConflictException({ code: 'ALREADY_SENT', message: 'SampBidx already has this one.' });
    if (t.delivery === 'SENDING' && Date.now() - t.updatedAt.getTime() < STALE_SENDING_MS) throw new ConflictException({ code: 'IN_PROGRESS', message: 'This is being sent right now.' });
    if (t.companyId) await this.work.assertEditable(auth, t.companyId, t.rfqId);
    else if (t.createdById !== auth.userId) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Transfer not found.' });
    await this.prisma.run(auth, (tx) => this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'sampbidx.retried', entityType: 'sampbidx_transfer', entityId: t.id, metadata: { attempts: t.attempts }, meta }));
    return this.deliver(auth, conn, t);
  }

  /** Set by SampBidx chat (ADR 0077): a status change as a line in the RFQ's chat. */
  onStatus: ((tenantId: string, transferId: string, text: string) => Promise<void>) | null = null;

  // ─── SampBidx's status callback ───

  /** A status update from SampBidx, signed with the workspace's callback secret. Unknown transfers are ignored. */
  async callback(hookId: string, raw: Buffer | undefined, timestamp: string | undefined, signature: string | undefined): Promise<{ ok: true; matched: boolean }> {
    const conn = /^[a-f0-9]{24}$/.test(hookId)
      ? await this.prisma.run({ lookup: { AppConnection: { provider: 'SAMPBIDX', externalAccountId: hookId } } }, (tx) => tx.appConnection.findFirst({ where: { provider: 'SAMPBIDX', externalAccountId: hookId } }))
      : null;
    if (!conn || conn.status === 'DISCONNECTED' || !raw || !verifySampbidxSignature(this.keys(conn).callbackSecret, timestamp, raw, signature)) {
      throw new UnauthorizedException({ code: 'INVALID_SIGNATURE', message: 'The request signature is not valid.' });
    }
    let body: SampbidxCallback;
    try {
      body = sampbidxCallbackSchema.parse(JSON.parse(raw.toString('utf8')));
    } catch {
      throw new BadRequestException({ code: 'INVALID_BODY', message: 'The request body is not valid.' });
    }
    const tenantId = conn.tenantId;
    const now = new Date();
    const updated = await this.prisma.run({ tenantId }, async (tx) => {
      const t = await tx.sampbidxTransfer.findFirst({
        where: { tenantId, OR: [...(body.transferId ? [{ id: body.transferId }] : []), ...(body.sampbidxId ? [{ remoteId: body.sampbidxId }] : [])] },
        omit: { emailFileData: true },
      });
      await tx.appConnection.update({ where: { id: conn.id }, data: { settings: { ...(conn.settings as object), lastCallbackAt: now.toISOString() } as Prisma.InputJsonValue } });
      if (!t) return null;
      const row = await tx.sampbidxTransfer.update({
        where: { id: t.id },
        data: {
          remoteStatus: body.status,
          remoteNote: body.note ?? t.remoteNote,
          remoteUrl: body.url ?? t.remoteUrl,
          remoteId: t.remoteId ?? body.sampbidxId ?? null,
          remoteUpdatedAt: now,
          // A callback proves SampBidx has it, even if SampForce never saw the answer to the send.
          ...(t.delivery !== 'SENT' ? { delivery: 'SENT', sentAt: t.sentAt ?? now, lastError: null } : {}),
        },
        omit: { emailFileData: true },
      });
      await this.notifications.send(tx, tenantId, [t.createdById], {
        type: 'sampbidx.status',
        title: remoteTitle(body.status, t.title),
        body: body.note ?? '',
        link: t.rfqId ? `/app/rfqs?open=${t.rfqId}` : '/app/rfqs?tab=sampbidx',
      });
      return row;
    });
    // The RFQ's chat with the SampBidx team shows the change too (ADR 0077).
    if (updated) await this.onStatus?.(tenantId, updated.id, `${remoteTitle(body.status, updated.title)}${body.note ? `: ${body.note}` : ''}`);
    await this.apps.recordEvent(tenantId, conn, {
      kind: 'status.received',
      ok: true,
      externalId: body.sampbidxId ?? null,
      summary: updated ? `${updated.title}: ${REMOTE_LABEL[body.status]}` : `Status ${body.status} for an RFQ SampForce does not know`,
      actorUserId: null,
      entityType: updated?.rfqId ? 'rfq' : null,
      entityId: updated?.rfqId ?? null,
    });
    return { ok: true, matched: !!updated };
  }

  // ─── Sending ───

  private async deliver(auth: AuthContext, conn: AppConnection, t: SampbidxTransfer | Omit<SampbidxTransfer, 'emailFileData'>): Promise<SampbidxTransferRow> {
    const keys = this.keys(conn);
    await this.prisma.run(auth, (tx) => tx.sampbidxTransfer.update({ where: { id: t.id }, data: { delivery: 'SENDING', attempts: { increment: 1 } } }));
    let accepted: { id: string; url: string | null; status: string | null } | null = null;
    let failure: string | null = null;
    try {
      accepted = await this.send(auth, keys, t.id);
    } catch (e) {
      if (!(e instanceof SampbidxError)) {
        await this.prisma.run(auth, (tx) => tx.sampbidxTransfer.update({ where: { id: t.id }, data: { delivery: 'FAILED', lastError: 'SampForce could not prepare this RFQ for sending.' } }));
        throw e;
      }
      failure = e.message;
      if (e.revoked) await this.prisma.run({ tenantId: auth.tenantId }, (tx) => tx.appConnection.update({ where: { id: conn.id }, data: { status: 'ERROR', lastError: e.message } }));
    }
    const row = await this.prisma.run(auth, async (tx) => {
      const remoteStatus = accepted?.status ? accepted.status.toUpperCase() : null;
      const updated = await tx.sampbidxTransfer.update({
        where: { id: t.id },
        data: accepted
          ? { delivery: 'SENT', sentAt: new Date(), lastError: null, remoteId: accepted.id, remoteUrl: accepted.url, remoteStatus: isRemote(remoteStatus) ? remoteStatus : 'RECEIVED', remoteUpdatedAt: new Date() }
          : { delivery: 'FAILED', lastError: failure },
        omit: { emailFileData: true },
      });
      if (accepted) await tx.appConnection.update({ where: { id: conn.id }, data: { lastUsedAt: new Date(), status: 'CONNECTED', lastError: null } });
      return (await this.rows(tx, auth.tenantId, [updated]))[0]!;
    });
    await this.apps.recordEvent(auth.tenantId, conn, {
      kind: accepted ? 'transfer.sent' : 'transfer.failed',
      ok: !!accepted,
      externalId: accepted?.id ?? null,
      summary: accepted ? `${t.title} sent to SampBidx` : `${t.title} not sent: ${failure}`,
      actorUserId: auth.userId,
      entityType: t.rfqId ? 'rfq' : null,
      entityId: t.rfqId,
    });
    return row;
  }

  /** Builds the request from what is stored now, so a retry sends the RFQ as it is at that moment. */
  private async send(auth: AuthContext, keys: SampbidxKeys, transferId: string) {
    const t = await this.prisma.run(auth, (tx) => tx.sampbidxTransfer.findUniqueOrThrow({ where: { id: transferId } }));
    const sender = await this.prisma.run(auth, async (tx) => (await personRefs(tx, auth.tenantId, [auth.userId])).get(auth.userId) ?? null);
    const tenant = await this.prisma.run(auth, (tx) => tx.tenant.findUniqueOrThrow({ where: { id: auth.tenantId }, select: { name: true } }));
    const source = { system: 'SampForce', workspace: tenant.name, transferId: t.id, sentBy: sender ? { name: sender.name } : null, note: t.note };
    if (t.kind === 'RFQ') {
      const rfq = await this.work.getRfq(auth, t.rfqId!);
      const files = await this.prisma.run(auth, (tx) => tx.companyFile.findMany({ where: { tenantId: auth.tenantId, id: { in: t.fileIds }, rfqId: t.rfqId }, orderBy: { createdAt: 'asc' } }));
      const parts: Part[] = files.map((f) => ({ name: 'files', filename: f.name, contentType: f.contentType || 'application/octet-stream', data: Buffer.from(f.data) }));
      return this.client.sendRfq(keys, t.id, { ...source, rfq: rfqPayload(rfq), attachments: files.map((f) => ({ name: f.name, contentType: f.contentType, sizeBytes: f.sizeBytes, sha256: f.sha256 })) }, parts);
    }
    const links = await this.linkPayload(auth, t);
    if (t.kind === 'MAILBOX_EMAIL') {
      const m = await this.prisma.run(auth, (tx) => tx.emailMessage.findFirst({ where: { id: t.emailMessageId!, tenantId: auth.tenantId } }));
      if (!m) throw new SampbidxError('gone', 'The email is no longer in the synced mailbox.');
      return this.client.sendEmail(
        keys,
        t.id,
        { ...source, ...links, source: 'mailbox', email: { subject: m.subject, from: m.fromAddress, to: m.toAddresses, cc: m.ccAddresses, date: m.sentAt.toISOString(), text: m.bodyText ?? m.snippet ?? '', attachmentsIncluded: false } },
        null,
      );
    }
    if (t.kind === 'PASTED_EMAIL') {
      const parsed = parsePastedEmail(t.emailText ?? '');
      const contact = t.contactId
        ? await this.prisma.run(auth, (tx) => tx.contact.findFirst({ where: { id: t.contactId!, tenantId: auth.tenantId }, select: { id: true, firstName: true, lastName: true, email: true } }))
        : null;
      return this.client.sendEmail(
        keys,
        t.id,
        {
          ...source,
          ...links,
          source: 'pasted',
          contact: contact ? { id: contact.id, name: [contact.firstName, contact.lastName].filter(Boolean).join(' '), email: contact.email } : null,
          email: { subject: t.title, from: t.emailFrom, to: parsed.to, cc: parsed.cc, date: t.emailDate?.toISOString() ?? null, text: t.emailText ?? '', attachmentsIncluded: false },
        },
        null,
      );
    }
    return this.client.sendEmail(
      keys,
      t.id,
      { ...source, ...links, source: 'file', email: { subject: t.title, from: t.emailFrom, date: t.emailDate?.toISOString() ?? null, fileName: t.emailFileName, attachmentsIncluded: true } },
      { name: 'message', filename: t.emailFileName ?? 'rfq.eml', contentType: t.emailFileType ?? 'message/rfc822', data: Buffer.from(t.emailFileData ?? []) },
    );
  }

  // ─── Helpers ───

  private async linkPayload(auth: AuthContext, t: Pick<SampbidxTransfer, 'companyId' | 'rfqId'>) {
    const company = t.companyId ? await this.prisma.run(auth, (tx) => tx.company.findFirst({ where: { id: t.companyId!, tenantId: auth.tenantId }, select: { id: true, name: true, leadNumber: true, country: true } })) : null;
    const rfq = t.rfqId ? await this.work.getRfq(auth, t.rfqId).catch(() => null) : null;
    return { company: company ? { id: company.id, name: company.name, leadNumber: company.leadNumber, country: company.country } : null, rfq: rfq ? rfqPayload(rfq) : null };
  }

  /** Optional company and RFQ links for an email transfer; the email's contact's company is used when none is given. */
  private async links(auth: AuthContext, companyId: string | null, rfqId: string | null, contactId: string | null): Promise<{ companyId: string | null; rfqId: string | null }> {
    if (rfqId && !companyId) companyId = (await this.work.getRfq(auth, rfqId)).company.id;
    if (companyId) {
      await this.work.assertEditable(auth, companyId, rfqId);
      return { companyId, rfqId };
    }
    if (contactId) {
      const c = await this.prisma.run(auth, (tx) => tx.contact.findFirst({ where: { id: contactId, tenantId: auth.tenantId, deletedAt: null }, select: { companyId: true } }));
      if (c?.companyId) {
        try {
          await this.work.assertEditable(auth, c.companyId);
          return { companyId: c.companyId, rfqId: null };
        } catch {
          // A company the person cannot change is simply not linked.
        }
      }
    }
    return { companyId: null, rfqId: null };
  }

  private async assertNotDuplicate(tx: Prisma.TransactionClient, tenantId: string, where: Prisma.SampbidxTransferWhereInput, resend: boolean | undefined, message: string) {
    const prior = await tx.sampbidxTransfer.findMany({ where: { tenantId, ...where, delivery: { in: ['SENT', 'SENDING'] } }, select: { delivery: true, updatedAt: true }, take: 5 });
    if (prior.some((p) => p.delivery === 'SENDING' && Date.now() - p.updatedAt.getTime() < STALE_SENDING_MS)) throw new ConflictException({ code: 'IN_PROGRESS', message: 'This is being sent right now.' });
    if (!resend && prior.some((p) => p.delivery === 'SENT')) throw new ConflictException({ code: 'ALREADY_SENT', message });
  }

  private async rows(tx: Prisma.TransactionClient, tenantId: string, rows: Omit<SampbidxTransfer, 'emailFileData'>[]): Promise<SampbidxTransferRow[]> {
    if (!rows.length) return [];
    const [rfqs, companies, people] = await Promise.all([
      tx.rfq.findMany({ where: { tenantId, id: { in: rows.map((r) => r.rfqId).filter((x): x is string => !!x) } }, select: { id: true, number: true, projectName: true } }),
      tx.company.findMany({ where: { tenantId, id: { in: rows.map((r) => r.companyId).filter((x): x is string => !!x) } }, select: { id: true, name: true } }),
      personRefs(tx as never, tenantId, rows.map((r) => r.createdById)),
    ]);
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind as SampbidxTransferKind,
      title: r.title,
      rfq: rfqs.find((x) => x.id === r.rfqId) ?? null,
      company: companies.find((x) => x.id === r.companyId) ?? null,
      emailFrom: r.emailFrom,
      emailDate: r.emailDate?.toISOString() ?? null,
      files: Array.isArray(r.files) ? (r.files as { name: string; sizeBytes: number }[]) : [],
      note: r.note,
      delivery: r.delivery as SampbidxTransferRow['delivery'],
      attempts: r.attempts,
      lastError: r.lastError,
      remoteId: r.remoteId,
      remoteUrl: safeLink(r.remoteUrl),
      remoteStatus: isRemote(r.remoteStatus) ? r.remoteStatus : null,
      remoteNote: r.remoteNote,
      remoteUpdatedAt: r.remoteUpdatedAt?.toISOString() ?? null,
      sentBy: people.get(r.createdById)?.name ?? null,
      sentAt: r.sentAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  private async connection(tenantId: string): Promise<AppConnection> {
    const conn = await this.prisma.run({ tenantId }, (tx) => tx.appConnection.findUnique({ where: { tenantId_provider: { tenantId, provider: 'SAMPBIDX' } } }));
    if (!conn) throw new NotFoundException({ code: 'NOT_CONNECTED', message: 'SampBidx is not connected. A workspace admin can connect it in Integrations.' });
    return conn;
  }

  private async usableConnection(tenantId: string): Promise<AppConnection> {
    let conn: AppConnection;
    try {
      conn = await this.apps.requireConnection(tenantId, 'sampbidx');
    } catch (e) {
      if (e instanceof AppError) throw new BadRequestException({ code: 'APP_ERROR', message: e.message });
      throw e;
    }
    if (conn.status === 'ERROR') throw new BadRequestException({ code: 'APP_ERROR', message: `SampBidx needs a new API key: ${conn.lastError ?? 'the last call was refused'}. A workspace admin can replace it in Integrations.` });
    return conn;
  }

  private keys(conn: AppConnection): SampbidxKeys {
    return JSON.parse(this.box.open(conn.credentialsEncrypted)) as SampbidxKeys;
  }

  private callbackUrl(hookId: string): string {
    return `${this.env.PUBLIC_WEB_URL.replace(/\/$/, '')}/api/v1/apps/sampbidx/callbacks/${hookId}`;
  }
}

const REMOTE_LABEL: Record<SampbidxRemoteStatus, string> = {
  RECEIVED: 'received',
  IN_REVIEW: 'in review',
  BIDDING: 'in bidding',
  QUOTED: 'quoted',
  WON: 'won',
  LOST: 'lost',
  REJECTED: 'rejected',
  CANCELLED: 'cancelled',
};

/** One whole sentence per status, so each can be translated as a sentence. */
function remoteTitle(status: SampbidxRemoteStatus, title: string): string {
  switch (status) {
    case 'RECEIVED':
      return `SampBidx received ${title}`;
    case 'IN_REVIEW':
      return `SampBidx is reviewing ${title}`;
    case 'BIDDING':
      return `SampBidx is bidding on ${title}`;
    case 'QUOTED':
      return `SampBidx quoted ${title}`;
    case 'WON':
      return `${title} was won in SampBidx`;
    case 'LOST':
      return `${title} was lost in SampBidx`;
    case 'REJECTED':
      return `SampBidx rejected ${title}`;
    default:
      return `${title} was cancelled in SampBidx`;
  }
}

function isRemote(s: string | null): s is SampbidxRemoteStatus {
  return !!s && s in REMOTE_LABEL;
}

function newSecret(): string {
  return `sbxcb_${randomBytes(24).toString('base64url')}`;
}

/** Only http(s) links from SampBidx are shown as links. */
function safeLink(u: string | null): string | null {
  return u && /^https?:\/\//i.test(u) ? u : null;
}

export function missingFields(rfq: RfqRow): SampbidxRequiredField[] {
  return SAMPBIDX_REQUIRED_RFQ_FIELDS.filter((f) => {
    const v = rfq[f];
    return v === null || v === undefined || (typeof v === 'string' && !v.trim()) || (typeof v === 'number' && v <= 0);
  });
}

function checkFileLimits(files: { sizeBytes: number }[]) {
  if (files.length > SAMPBIDX_MAX_FILES) throw new BadRequestException({ code: 'TOO_MANY_FILES', message: `Send at most ${SAMPBIDX_MAX_FILES} files with one RFQ.` });
  if (files.reduce((n, f) => n + f.sizeBytes, 0) > SAMPBIDX_MAX_TOTAL_BYTES) throw new BadRequestException({ code: 'FILES_TOO_LARGE', message: 'The chosen files are over 40 MB together. Leave some out.' });
}

/** .eml (checked by its headers) or Outlook .msg (checked by its file signature). */
function emailFileKind(name: string, contentType: string, data: Buffer): 'message/rfc822' | 'application/vnd.ms-outlook' | null {
  const lower = name.toLowerCase();
  const msgMagic = data.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
  if ((lower.endsWith('.msg') || contentType === 'application/vnd.ms-outlook') && msgMagic) return 'application/vnd.ms-outlook';
  if (lower.endsWith('.eml') || contentType === 'message/rfc822') {
    const head = data.subarray(0, 8192).toString('latin1');
    if (/^(from|subject|date|to|received|return-path|message-id|mime-version|delivered-to|x-[\w-]+):/im.test(head)) return 'message/rfc822';
  }
  return null;
}

/** The RFQ as SampBidx receives it (docs/integrations/sampbidx-api.md). */
function rfqPayload(r: RfqRow) {
  return {
    id: r.id,
    number: r.number,
    projectName: r.projectName,
    description: r.description,
    status: r.status,
    methodology: r.methodology,
    market: r.market,
    industry: r.industry,
    targetAudience: r.targetAudience,
    sampleSize: r.sampleSize,
    loiMinutes: r.loi,
    incidenceRatePercent: r.ir,
    cpi: r.cpi,
    totalQuotation: r.totalQuotation,
    currency: r.currency,
    receivedAt: r.receivedAt,
    deadlineAt: r.deadlineAt,
    company: { id: r.company.id, name: r.company.name, leadNumber: r.company.leadNumber },
    contact: r.contact,
    owner: r.owner ? { name: r.owner.name } : null,
    manager: r.manager ? { name: r.manager.name } : null,
  };
}
