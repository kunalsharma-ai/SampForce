import { createHash, randomUUID } from 'node:crypto';
import { BadRequestException, ForbiddenException, Inject, Injectable, Logger, type OnModuleInit, PayloadTooLargeException, UnauthorizedException } from '@nestjs/common';
import { type AppConnection, Prisma, type SampbidxTransfer, type TenantTx } from '@dealflow/database';
import {
  type ChatConversationRow,
  type ChatMessageRow,
  CHAT_ATTACHMENT_MAX_BYTES,
  hasPermission,
  SAMPBIDX_CHAT_MAX_TOTAL_BYTES,
  type SampbidxChatPeopleResponse,
  type SampbidxChatPerson,
  type SampbidxChatTransferOption,
  type SampbidxInboundMessage,
  sampbidxInboundMessageSchema,
} from '@dealflow/types';
import { hasFeature } from '../billing/entitlements';
import type { AuthContext } from '../common/auth-context';
import { SECRET_BOX, type SecretBox } from '../common/crypto';
import { PrismaService } from '../common/prisma.service';
import { ChatBus } from '../chat/chat-bus';
import { type ChatActor, ChatService } from '../chat/chat.service';
import { SAMPBIDX_GENERAL_KEY, SAMPBIDX_GENERAL_TITLE, sampbidxChatAllowed, sampbidxChatMembers, sampbidxChatRefused, sampbidxTransferKey } from '../chat/sampbidx-line';
import { notFound } from '../crm/crm-helpers';
import { companyScope, visibility } from '../crm/visibility';
import { queueMobilePush } from '../mobile/push/push-queue';
import { AppError, AppsService } from './apps.service';
import { SampbidxService } from './sampbidx.service';
import { type Part, SampbidxClient, SampbidxError, type SampbidxKeys, verifySampbidxSignature } from './sampbidx';

type ConversationRecord = Prisma.ChatConversationGetPayload<{ include: { members: true } }>;

/** Automatic tries of one message; after that it waits for "Try again". */
const MAX_AUTO_ATTEMPTS = 6;
/** Wait before the next automatic try, by tries so far. */
const BACKOFF_MS = [30_000, 2 * 60_000, 10 * 60_000, 30 * 60_000, 2 * 3600_000];
/** A try still running after this long is taken as interrupted (the server stopped mid-send). */
const LEASE_MS = 2 * 60_000;
/** SampBidx refusals that trying again will not change. */
const FINAL = new Set(['invalid', 'too_large', 'address', 'not_found', 'auth', 'forbidden']);
const PREVIEW_MAX = 140;
const PEOPLE_KEPT = 20;

/**
 * Chat with the SampBidx team (ADR 0078). Messages written in a SampBidx conversation of Team chat are posted to
 * SampBidx (POST /v1/messages) straight after they are stored, and retried by the worker until SampBidx has them.
 * SampBidx's people answer through a signed callback, and read the list of SampForce people who may chat through
 * another one. Status changes of a transferred RFQ appear in its chat as lines from SampBidx.
 */
@Injectable()
export class SampbidxChatService implements OnModuleInit {
  private readonly log = new Logger(SampbidxChatService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly chat: ChatService,
    private readonly bus: ChatBus,
    private readonly apps: AppsService,
    private readonly client: SampbidxClient,
    private readonly transfers: SampbidxService,
    @Inject(SECRET_BOX) private readonly box: SecretBox,
  ) {}

  onModuleInit(): void {
    this.transfers.onStatus = (tenantId, transferId, text) => this.statusLine(tenantId, transferId, text).catch((e: unknown) => this.log.warn(`SampBidx chat status line failed: ${e instanceof Error ? e.message : String(e)}`));
    this.chat.onSampbidxMessage = (tenantId, messageId) => {
      void this.deliver(tenantId, messageId).catch((e: unknown) => this.log.warn(`SampBidx chat delivery failed: ${e instanceof Error ? e.message : String(e)}`));
    };
  }

  // ─── In SampForce ───

  /** Transfers the person can see, to start (or open) the SampBidx chat about one. */
  transferOptions(auth: AuthContext, q: string): Promise<SampbidxChatTransferOption[]> {
    return this.prisma.run(auth, async (tx) => {
      await this.assertAllowed(tx, auth);
      const visible = await this.visibleTransfers(tx, auth);
      const text = q.trim();
      const rows = await tx.sampbidxTransfer.findMany({
        where: { tenantId: auth.tenantId, AND: [visible, ...(text ? [{ title: { contains: text, mode: 'insensitive' as const } }] : [])] },
        omit: { emailFileData: true },
        orderBy: { createdAt: 'desc' },
        take: 30,
      });
      const [rfqs, companies, convs] = await Promise.all([
        tx.rfq.findMany({ where: { tenantId: auth.tenantId, id: { in: rows.map((r) => r.rfqId).filter((v): v is string => !!v) } }, select: { id: true, number: true, projectName: true } }),
        tx.company.findMany({ where: { tenantId: auth.tenantId, id: { in: rows.map((r) => r.companyId).filter((v): v is string => !!v) } }, select: { id: true, name: true } }),
        tx.chatConversation.findMany({ where: { tenantId: auth.tenantId, kind: 'SAMPBIDX', sampbidxTransferId: { in: rows.map((r) => r.id) } }, select: { id: true, sampbidxTransferId: true } }),
      ]);
      const rfq = new Map(rfqs.map((r) => [r.id, r]));
      const company = new Map(companies.map((c) => [c.id, c]));
      const conv = new Map(convs.map((c) => [c.sampbidxTransferId, c.id]));
      return rows.map((t) => ({
        id: t.id,
        title: t.title,
        rfq: t.rfqId ? (rfq.get(t.rfqId) ?? null) : null,
        company: t.companyId ? (company.get(t.companyId) ?? null) : null,
        remoteId: t.remoteId,
        remoteStatus: t.remoteStatus,
        sentAt: t.sentAt?.toISOString() ?? null,
        conversationId: conv.get(t.id) ?? null,
      }));
    });
  }

  /** The chat about one transfer, started on first use with its sender and the company's owner; the caller joins. */
  openTransferChat(auth: AuthContext, transferId: string): Promise<ChatConversationRow> {
    const actor: ChatActor = { kind: 'user', auth };
    return this.withSignals(auth.tenantId, auth, async (tx, signals) => {
      await this.assertAllowed(tx, auth);
      const t = await tx.sampbidxTransfer.findFirst({ where: { tenantId: auth.tenantId, id: transferId, AND: [await this.visibleTransfers(tx, auth)] }, omit: { emailFileData: true } });
      if (!t) throw notFound('RFQ');
      let conv = await this.transferChat(tx, auth.tenantId, t, signals);
      if (!conv.members.some((m) => m.userId === auth.userId)) {
        await tx.chatMember.create({ data: { tenantId: auth.tenantId, conversationId: conv.id, userId: auth.userId } });
        conv = await tx.chatConversation.findFirstOrThrow({ where: { id: conv.id, tenantId: auth.tenantId }, include: { members: true } });
        signals.push(await this.bus.record(tx, this.chat.audience(conv), { type: 'conversation', conversationId: conv.id }));
      }
      return (await this.chat.conversationRows(tx, actor, [conv]))[0]!;
    });
  }

  /** "Try again" on a message SampBidx does not have yet. Only its writer can. */
  async retry(auth: AuthContext, messageId: string): Promise<ChatMessageRow> {
    await this.prisma.run(auth, async (tx) => {
      await this.assertAllowed(tx, auth);
      const m = await tx.chatMessage.findFirst({ where: { tenantId: auth.tenantId, id: messageId, authorUserId: auth.userId } });
      if (!m || !m.remoteDelivery) throw notFound('Message');
      if (m.remoteDelivery === 'SENT') return;
      await tx.chatMessage.update({ where: { id: m.id }, data: { remoteDelivery: 'SENDING', remoteRetryAt: new Date(), remoteError: null } });
    });
    await this.deliver(auth.tenantId, messageId);
    return this.prisma.run(auth, async (tx) => {
      const m = await tx.chatMessage.findFirstOrThrow({ where: { tenantId: auth.tenantId, id: messageId } });
      return (await this.chat.messageRows(tx, { kind: 'user', auth }, auth.tenantId, [m]))[0]!;
    });
  }

  // ─── To SampBidx ───

  /** Posts one message to SampBidx. Safe to call twice at once: a try takes a lease first, so one of them sends. */
  async deliver(tenantId: string, messageId: string): Promise<'sent' | 'failed' | 'skipped'> {
    const now = new Date();
    const claimed = await this.prisma.run({ tenantId }, (tx) =>
      tx.chatMessage.updateMany({
        where: { tenantId, id: messageId, remoteDelivery: { in: ['SENDING', 'FAILED'] }, OR: [{ remoteRetryAt: null }, { remoteRetryAt: { lte: new Date(now.getTime() + 61_000) } }] },
        data: { remoteDelivery: 'SENDING', remoteAttempts: { increment: 1 }, remoteRetryAt: new Date(now.getTime() + LEASE_MS) },
      }),
    );
    if (!claimed.count) return 'skipped';
    let failure: SampbidxError | null = null;
    let remoteId: string | null = null;
    let conn: AppConnection | null = null;
    try {
      conn = await this.apps.requireConnection(tenantId, 'sampbidx').catch((e: unknown) => {
        throw e instanceof AppError ? new SampbidxError('not_connected', e.message) : e;
      });
      if (!(await this.prisma.run({ tenantId }, (tx) => hasFeature(tx, tenantId, 'sampbidx_chat')))) throw new SampbidxError('chat_off', 'Chat with SampBidx team is switched off for your organisation.');
      const { payload, files } = await this.payload(tenantId, messageId);
      remoteId = (await this.client.postMessage(this.keys(conn), messageId, payload, files)).id;
    } catch (e) {
      if (!(e instanceof SampbidxError)) {
        this.log.warn(`SampBidx chat message ${messageId}: ${e instanceof Error ? e.message : String(e)}`);
        failure = new SampbidxError('internal', 'SampForce could not prepare this message for SampBidx.');
      } else failure = e.code === 'invalid' ? new SampbidxError('invalid', e.message.replace('refused the RFQ', 'refused the message')) : e;
      if (conn && e instanceof SampbidxError && e.revoked) await this.prisma.run({ tenantId }, (tx) => tx.appConnection.update({ where: { id: conn!.id }, data: { status: 'ERROR', lastError: e.message } }));
    }
    const signals: Awaited<ReturnType<ChatBus['record']>>[] = [];
    await this.prisma.run({ tenantId }, async (tx) => {
      const m = await tx.chatMessage.findFirstOrThrow({ where: { tenantId, id: messageId } });
      const attempts = m.remoteAttempts ?? 1;
      const again = failure && !FINAL.has(failure.code) && attempts < MAX_AUTO_ATTEMPTS ? new Date(Date.now() + BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)]!) : null;
      await tx.chatMessage.update({
        where: { id: m.id },
        data: failure ? { remoteDelivery: 'FAILED', remoteError: failure.message, remoteRetryAt: again } : { remoteDelivery: 'SENT', remoteError: null, remoteRetryAt: null, remoteId },
      });
      const conv = await tx.chatConversation.findFirstOrThrow({ where: { tenantId, id: m.conversationId }, include: { members: true } });
      signals.push(await this.bus.record(tx, this.chat.audience(conv), { type: 'message_changed', conversationId: conv.id, messageId: m.id }));
    });
    this.bus.deliver(signals);
    if (conn) {
      await this.apps.recordEvent(tenantId, conn, {
        kind: failure ? 'chat.failed' : 'chat.sent',
        ok: !failure,
        externalId: remoteId,
        summary: failure ? `Chat message not delivered: ${failure.message}` : 'Chat message delivered to SampBidx',
        actorUserId: null,
      });
    }
    return failure ? 'failed' : 'sent';
  }

  /** The worker's sweep: messages whose next try is due, in every organisation. */
  async sweep(limit = 20): Promise<number> {
    const due = await this.prisma.run({ workerScan: true }, (tx) =>
      tx.chatMessage.findMany({ where: { remoteDelivery: { in: ['SENDING', 'FAILED'] }, remoteRetryAt: { lte: new Date() } }, select: { id: true, tenantId: true }, orderBy: { remoteRetryAt: 'asc' }, take: limit }),
    );
    let n = 0;
    for (const m of due) if ((await this.deliver(m.tenantId, m.id)) !== 'skipped') n++;
    return n;
  }

  private async payload(tenantId: string, messageId: string): Promise<{ payload: object; files: Part[] }> {
    return this.prisma.run({ tenantId }, async (tx) => {
      const m = await tx.chatMessage.findFirstOrThrow({ where: { tenantId, id: messageId } });
      const conv = await tx.chatConversation.findFirstOrThrow({ where: { tenantId, id: m.conversationId } });
      const t = conv.sampbidxTransferId ? await tx.sampbidxTransfer.findFirst({ where: { tenantId, id: conv.sampbidxTransferId }, omit: { emailFileData: true } }) : null;
      const [tenant, author, membership, files] = await Promise.all([
        tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { name: true } }),
        m.authorUserId ? tx.user.findFirst({ where: { id: m.authorUserId }, select: { id: true, name: true, email: true } }) : null,
        m.authorUserId ? tx.membership.findFirst({ where: { tenantId, userId: m.authorUserId }, include: { role: { select: { name: true } } } }) : null,
        tx.chatAttachment.findMany({ where: { tenantId, messageId: m.id }, orderBy: { createdAt: 'asc' } }),
      ]);
      const node = membership?.workspaceNodeId ? await tx.workspaceNode.findFirst({ where: { tenantId, id: membership.workspaceNodeId }, select: { name: true } }) : null;
      const rfq = t?.rfqId ? await tx.rfq.findFirst({ where: { tenantId, id: t.rfqId }, select: { number: true, projectName: true } }) : null;
      const company = t?.companyId ? await tx.company.findFirst({ where: { tenantId, id: t.companyId }, select: { name: true } }) : null;
      const payload = {
        id: m.id,
        system: 'SampForce',
        workspace: tenant.name,
        conversation: t
          ? { type: 'rfq', transferId: t.id, sampbidxId: t.remoteId, title: t.title, rfq: rfq ? { number: rfq.number, projectName: rfq.projectName } : null, company: company ? { name: company.name } : null }
          : { type: 'general' },
        author: author ? { id: author.id, name: author.name, email: author.email, role: membership?.role?.name ?? null, workspace: node?.name ?? tenant.name } : null,
        text: m.body,
        sentAt: (m.writtenAt ?? m.createdAt).toISOString(),
        attachments: files.map((f) => ({ name: f.name, contentType: f.contentType, sizeBytes: f.sizeBytes, sha256: f.sha256 })),
      };
      return { payload, files: files.map((f) => ({ name: 'files', filename: f.name, contentType: f.contentType || 'application/octet-stream', data: Buffer.from(f.data) })) };
    });
  }

  // ─── From SampBidx ───

  /** A message from someone in SampBidx, signed like the status callbacks. */
  async receive(hookId: string, raw: Buffer | undefined, timestamp: string | undefined, signature: string | undefined): Promise<{ ok: true; matched: boolean; messageId: string | null; duplicate?: boolean }> {
    const conn = await this.verified(hookId, raw ?? Buffer.alloc(0), timestamp, signature);
    let body: SampbidxInboundMessage;
    try {
      body = sampbidxInboundMessageSchema.parse(JSON.parse(raw!.toString('utf8')));
    } catch {
      throw new BadRequestException({ code: 'INVALID_BODY', message: 'The request body is not valid.' });
    }
    const tenantId = conn.tenantId;
    if (!(await this.prisma.run({ tenantId }, (tx) => hasFeature(tx, tenantId, 'sampbidx_chat')))) {
      throw new ForbiddenException({ code: 'CHAT_OFF', message: 'Chat with SampBidx team is switched off for this SampForce organisation.' });
    }
    const files = body.attachments.map((a) => ({ name: a.name, contentType: a.contentType || 'application/octet-stream', data: Buffer.from(a.data, 'base64') }));
    if (files.some((f) => f.data.length === 0)) throw new BadRequestException({ code: 'INVALID_BODY', message: 'The request body is not valid.' });
    if (files.some((f) => f.data.length > CHAT_ATTACHMENT_MAX_BYTES) || files.reduce((n, f) => n + f.data.length, 0) > SAMPBIDX_CHAT_MAX_TOTAL_BYTES) {
      throw new PayloadTooLargeException({ code: 'PAYLOAD_TOO_LARGE', message: 'Files can be up to 10 MB each and 20 MB in all.' });
    }
    const author: SampbidxChatPerson = { id: body.author.id ?? null, name: body.author.name, email: body.author.email?.toLowerCase() ?? null, role: body.author.role ?? null };
    const result = await this.withSignals(tenantId, { tenantId }, async (tx, signals) => {
      let conv: ConversationRecord;
      if (body.transferId || body.sampbidxId) {
        const t = await tx.sampbidxTransfer.findFirst({
          where: { tenantId, OR: [...(body.transferId ? [{ id: body.transferId }] : []), ...(body.sampbidxId ? [{ remoteId: body.sampbidxId }] : [])] },
          omit: { emailFileData: true },
        });
        if (!t) return null;
        conv = await this.transferChat(tx, tenantId, t, signals);
      } else conv = await this.chat.sampbidxLine(tx, tenantId);
      const clientId = `sampbidx:${body.id}`;
      const dup = await tx.chatMessage.findFirst({ where: { tenantId, conversationId: conv.id, clientId }, select: { id: true } });
      if (dup) return { messageId: dup.id, duplicate: true };
      const now = new Date();
      const sent = body.sentAt ? new Date(body.sentAt) : null;
      const writtenAt = sent && sent.getTime() < now.getTime() - 60_000 && sent.getTime() > now.getTime() - 7 * 86_400_000 ? sent : null;
      const msg = await tx.chatMessage.create({ data: { tenantId, conversationId: conv.id, clientId, body: body.text.trim(), writtenAt, externalAuthor: author as unknown as Prisma.InputJsonValue } });
      for (const f of files) {
        await tx.chatAttachment.create({
          data: { tenantId, conversationId: conv.id, messageId: msg.id, name: f.name, contentType: f.contentType, sizeBytes: f.data.length, data: new Uint8Array(f.data), sha256: createHash('sha256').update(f.data).digest('hex') },
        });
      }
      const preview = `${author.name}: ${body.text.trim() || files.map((f) => f.name).join(', ')}`.replace(/\s+/g, ' ').slice(0, PREVIEW_MAX);
      const people = [author, ...((Array.isArray(conv.sampbidxPeople) ? conv.sampbidxPeople : []) as unknown as SampbidxChatPerson[]).filter((p) => samePerson(p, author) === false)].slice(0, PEOPLE_KEPT);
      await tx.chatConversation.update({ where: { id: conv.id }, data: { lastMessageAt: msg.createdAt, lastMessagePreview: preview, sampbidxPeople: people as unknown as Prisma.InputJsonValue } });
      signals.push(await this.bus.record(tx, this.chat.audience(conv), { type: 'message', conversationId: conv.id, messageId: msg.id, authorId: `sampbidx:${author.email ?? author.name}` }));
      const title = `${author.name} (SampBidx) in ${conv.directKey === SAMPBIDX_GENERAL_KEY ? SAMPBIDX_GENERAL_TITLE : (conv.name ?? '')}`;
      await queueMobilePush(tx, tenantId, conv.members.map((m) => m.userId), { type: 'chat_message', title, body: body.text.trim().slice(0, PREVIEW_MAX) || null, route: `/chat/${conv.id}` });
      return { messageId: msg.id, duplicate: false };
    });
    await this.apps.recordEvent(tenantId, conn, {
      kind: 'chat.received',
      ok: true,
      externalId: body.id,
      summary: result ? `Chat message from ${author.name}` : 'Chat message about an RFQ SampForce does not know',
      actorUserId: null,
    });
    if (!result) return { ok: true, matched: false, messageId: null };
    return { ok: true, matched: true, messageId: result.messageId, ...(result.duplicate ? { duplicate: true } : {}) };
  }

  /** SampForce people whose workspace has SampBidx chat: name, email, role and workspace only. */
  async people(hookId: string, timestamp: string | undefined, signature: string | undefined): Promise<SampbidxChatPeopleResponse> {
    const conn = await this.verified(hookId, Buffer.alloc(0), timestamp, signature);
    const tenantId = conn.tenantId;
    return this.prisma.run({ tenantId }, async (tx) => {
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { name: true } });
      if (!(await hasFeature(tx, tenantId, 'sampbidx_chat'))) return { workspace: tenant.name, people: [] };
      const people = await sampbidxChatMembers(tx, tenantId);
      return { workspace: tenant.name, people: people.map((p) => ({ id: p.userId, name: p.name, email: p.email, role: p.role, workspace: p.workspace, level: p.level })) };
    });
  }

  /** A status update of a transferred RFQ, as a line in its chat when the chat exists. Called by the status callback. */
  async statusLine(tenantId: string, transferId: string, text: string): Promise<void> {
    await this.withSignals(tenantId, { tenantId }, async (tx, signals) => {
      const conv = await tx.chatConversation.findFirst({ where: { tenantId, directKey: sampbidxTransferKey(transferId) }, include: { members: true } });
      if (!conv) return;
      const msg = await tx.chatMessage.create({ data: { tenantId, conversationId: conv.id, clientId: `sampbidx-status:${randomUUID()}`, body: text.slice(0, 4000), system: true } });
      await tx.chatConversation.update({ where: { id: conv.id }, data: { lastMessageAt: msg.createdAt, lastMessagePreview: text.replace(/\s+/g, ' ').slice(0, PREVIEW_MAX) } });
      signals.push(await this.bus.record(tx, this.chat.audience(conv), { type: 'message', conversationId: conv.id, messageId: msg.id, authorId: 'sampbidx' }));
    });
  }

  // ─── Helpers ───

  /** The chat about a transfer, created with its sender and the company's owner (those of them who have SampBidx chat). */
  private async transferChat(tx: TenantTx, tenantId: string, t: Omit<SampbidxTransfer, 'emailFileData'>, signals: Awaited<ReturnType<ChatBus['record']>>[]): Promise<ConversationRecord> {
    const directKey = sampbidxTransferKey(t.id);
    const found = await tx.chatConversation.findFirst({ where: { tenantId, directKey }, include: { members: true } });
    if (found) return found;
    const allowed = await sampbidxChatMembers(tx, tenantId);
    const allowedIds = new Set(allowed.map((m) => m.userId));
    const company = t.companyId ? await tx.company.findFirst({ where: { tenantId, id: t.companyId }, select: { ownerId: true, managerId: true } }) : null;
    let members = [...new Set([t.createdById, company?.ownerId, company?.managerId].filter((u): u is string => !!u && allowedIds.has(u)))];
    // Nobody close to the RFQ has SampBidx chat: everyone who has it hears about it, so a message is never unseen.
    if (!members.length) members = [...allowedIds];
    try {
      const conv = await tx.chatConversation.create({
        data: {
          tenantId, kind: 'SAMPBIDX', directKey, name: t.title.slice(0, 200), sampbidxTransferId: t.id, createdById: null,
          linkType: t.rfqId ? 'RFQ' : t.companyId ? 'COMPANY' : null, linkId: t.rfqId ?? t.companyId ?? null, linkLabel: t.title.slice(0, 200),
          members: { create: members.map((userId) => ({ tenantId, userId })) },
        },
        include: { members: true },
      });
      signals.push(await this.bus.record(tx, this.chat.audience(conv), { type: 'conversation', conversationId: conv.id }));
      return conv;
    } catch (e) {
      // Started at the same moment from both sides: use the one that won.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return tx.chatConversation.findFirstOrThrow({ where: { tenantId, directKey }, include: { members: true } });
      throw e;
    }
  }

  /** Transfers of companies the person can see, and their own sends. Admins see every one. */
  private async visibleTransfers(tx: TenantTx, auth: AuthContext): Promise<Prisma.SampbidxTransferWhereInput> {
    if (hasPermission(auth.permissions, 'tenant:manage')) return {};
    const v = await visibility(tx, auth);
    if (v.all) return {};
    const companies = await tx.company.findMany({ where: { tenantId: auth.tenantId, ...companyScope(v) }, select: { id: true } });
    return { OR: [{ createdById: auth.userId }, { companyId: { in: companies.map((c) => c.id) } }] };
  }

  private async assertAllowed(tx: TenantTx, auth: AuthContext): Promise<void> {
    if (!(await sampbidxChatAllowed(tx, auth.tenantId, auth.workspaceNodeId))) throw sampbidxChatRefused();
  }

  private async withSignals<T>(tenantId: string, ctx: AuthContext | { tenantId: string }, fn: (tx: TenantTx, signals: Awaited<ReturnType<ChatBus['record']>>[]) => Promise<T>): Promise<T> {
    const signals: Awaited<ReturnType<ChatBus['record']>>[] = [];
    const out = await this.prisma.run(ctx, (tx) => {
      signals.length = 0;
      return fn(tx, signals);
    });
    this.bus.deliver(signals);
    return out;
  }

  /** The workspace's SampBidx connection, when the request is signed with its callback secret. */
  private async verified(hookId: string, raw: Buffer, timestamp: string | undefined, signature: string | undefined): Promise<AppConnection> {
    const conn = /^[a-f0-9]{24}$/.test(hookId)
      ? await this.prisma.run({ lookup: { AppConnection: { provider: 'SAMPBIDX', externalAccountId: hookId } } }, (tx) => tx.appConnection.findFirst({ where: { provider: 'SAMPBIDX', externalAccountId: hookId } }))
      : null;
    if (!conn || conn.status === 'DISCONNECTED' || !verifySampbidxSignature(this.keys(conn).callbackSecret, timestamp, raw, signature)) {
      throw new UnauthorizedException({ code: 'INVALID_SIGNATURE', message: 'The request signature is not valid.' });
    }
    return conn;
  }

  private keys(conn: AppConnection): SampbidxKeys {
    return JSON.parse(this.box.open(conn.credentialsEncrypted)) as SampbidxKeys;
  }
}

function samePerson(a: SampbidxChatPerson, b: SampbidxChatPerson): boolean {
  if (a.id && b.id) return a.id === b.id;
  if (a.email && b.email) return a.email === b.email;
  return a.name === b.name;
}
