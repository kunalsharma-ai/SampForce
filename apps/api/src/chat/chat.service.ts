import { createHash } from 'node:crypto';
import { BadRequestException, ForbiddenException, Injectable, PayloadTooLargeException } from '@nestjs/common';
import { Prisma, type TenantTx } from '@dealflow/database';
import {
  CHAT_ATTACHMENT_MAX_BYTES,
  CHAT_WRITTEN_AT_MAX_AGE_MS,
  type ChatAttachmentRow,
  type ChatConversationRow,
  type ChatKind,
  type ChatLink,
  type ChatLinkOption,
  type ChatLinkType,
  type ChatMemberRow,
  type ChatMessageRow,
  type ChatDirectoryPerson,
  type ChatPerson,
  type ChatSearchHit,
  type ChatStreamEvent,
  chatConversationInputSchema,
  chatConversationUpdateSchema,
  chatMessageInputSchema,
  chatMessagesQuerySchema,
  chatEventsQuerySchema,
  type ChatEventsPage,
  chatSearchQuerySchema,
  hasPermission,
  type Permission,
  type z,
} from '@dealflow/types';
import { AuditService } from '../audit/audit.service';
import { assertFeature, featureNotIncluded, hasFeature } from '../billing/entitlements';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { notFound } from '../crm/crm-helpers';
import { companyScope, visibility } from '../crm/visibility';
import type { OperatorContext } from '../operator/operator-auth';
import { type ChatAudience, ChatBus, type ChatListener } from './chat-bus';
import { isOnline } from './chat-presence';
import { ChatReach, chatNotAllowed } from './chat-reach';

/** A workspace user (in their workspace), or a super admin from the operator console acting in one workspace. */
export type ChatActor = { kind: 'user'; auth: AuthContext } | { kind: 'operator'; op: OperatorContext };

type ConversationRecord = Prisma.ChatConversationGetPayload<{ include: { members: true } }>;
type MessageRecord = Prisma.ChatMessageGetPayload<object>;
type Signal = { audience: ChatAudience; event: ChatStreamEvent };

export const SUPPORT_KEY = 'support';
export const SUPPORT_TITLE = 'SampForce support';
const PREVIEW_MAX = 140;

const tenantOf = (a: ChatActor, tenantId?: string) => (a.kind === 'user' ? a.auth.tenantId : tenantId!);
const personId = (a: ChatActor) => (a.kind === 'user' ? a.auth.userId : a.op.id);
const isAdmin = (a: ChatActor) => a.kind === 'user' && hasPermission(a.auth.permissions, 'tenant:manage');

function badRequest(code: string, message: string, path?: string): BadRequestException {
  return new BadRequestException({ code, message, ...(path ? { details: [{ path, message }] } : {}) });
}
const forbidden = (message: string) => new ForbiddenException({ code: 'FORBIDDEN', message });

/**
 * Team chat (ADR 0064): conversations, messages, read receipts, files, search and record links. Every change is
 * stored first and then announced on the live stream (ChatBus), so people who are offline see it when they return.
 */
@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bus: ChatBus,
    private readonly audit: AuditService,
  ) {}

  /** Runs `fn` in the workspace's context: the user's own session, or the workspace for an operator. */
  private async run<T>(actor: ChatActor, tenantId: string | undefined, fn: (tx: TenantTx, signals: Signal[]) => Promise<T>): Promise<T> {
    const signals: Signal[] = [];
    const ctx = actor.kind === 'user' ? actor.auth : { tenantId: tenantId! };
    const out = await this.prisma.run(ctx, async (tx) => {
      // Operators reach a workspace only while its plan includes team chat; workspace routes check it in FeatureGuard.
      if (actor.kind === 'operator') await assertFeature(tx, tenantId!, 'team_chat');
      signals.length = 0;
      return fn(tx, signals);
    });
    this.bus.deliver(signals);
    return out;
  }

  // ─── People ───

  private async people(tx: TenantTx, userIds: (string | null | undefined)[], operatorIds: (string | null | undefined)[]): Promise<Map<string, ChatPerson>> {
    const u = [...new Set(userIds.filter((v): v is string => !!v))];
    const o = [...new Set(operatorIds.filter((v): v is string => !!v))];
    const [users, ops] = await Promise.all([
      u.length ? tx.user.findMany({ where: { id: { in: u } }, select: { id: true, name: true } }) : [],
      o.length ? tx.platformOperator.findMany({ where: { id: { in: o } }, select: { id: true, name: true } }) : [],
    ]);
    const map = new Map<string, ChatPerson>();
    for (const x of users) map.set(`u:${x.id}`, { id: x.id, name: x.name, operator: false });
    for (const x of ops) map.set(`o:${x.id}`, { id: x.id, name: x.name, operator: true });
    return map;
  }

  /** Active members of the workspace who may be added to a conversation. */
  private async assertMembers(tx: TenantTx, tenantId: string, userIds: string[], path: string): Promise<void> {
    const unique = [...new Set(userIds)];
    if (!unique.length) return;
    const found = await tx.membership.count({ where: { tenantId, userId: { in: unique }, status: 'ACTIVE' } });
    if (found !== unique.length) throw badRequest('VALIDATION_FAILED', 'Choose people from this workspace.', path);
  }

  /**
   * People holding tenant:manage in the Super Workspace: the organisation's administrators, who are always on the
   * support line. Managers and executives reach SampForce through their Super Workspace (ADR 0071 part 5).
   */
  private async adminIds(tx: TenantTx, tenantId: string): Promise<string[]> {
    const roles = await tx.role.findMany({ where: { tenantId, permissions: { has: 'tenant:manage' } }, select: { id: true } });
    if (!roles.length) return [];
    const rows = await tx.membership.findMany({ where: { tenantId, status: 'ACTIVE', roleId: { in: roles.map((r) => r.id) } }, select: { userId: true } });
    const reach = await ChatReach.load(tx, tenantId);
    return rows.map((r) => r.userId).filter((u) => reach.isSuper(u));
  }

  /** The workspace's support line to super admins, created on first use, with every workspace admin on it. */
  private async supportLine(tx: TenantTx, tenantId: string): Promise<ConversationRecord> {
    let conv = await tx.chatConversation.findFirst({ where: { tenantId, directKey: SUPPORT_KEY }, include: { members: true } });
    if (!conv) {
      conv = await tx.chatConversation.create({ data: { tenantId, kind: 'SUPPORT', directKey: SUPPORT_KEY, name: SUPPORT_TITLE }, include: { members: true } });
    }
    const have = new Set(conv.members.map((m) => m.userId).filter(Boolean));
    const missing = (await this.adminIds(tx, tenantId)).filter((id) => !have.has(id));
    if (missing.length) {
      await tx.chatMember.createMany({ data: missing.map((userId) => ({ tenantId, conversationId: conv!.id, userId, role: 'MEMBER' as const })) });
      conv = await tx.chatConversation.findFirstOrThrow({ where: { id: conv.id, tenantId }, include: { members: true } });
    }
    return conv;
  }

  /** The conversation if the actor is in it (operators are in every support line); 404 otherwise. */
  private async conversation(tx: TenantTx, actor: ChatActor, tenantId: string, id: string): Promise<ConversationRecord> {
    const conv = await tx.chatConversation.findFirst({ where: { id, tenantId }, include: { members: true } });
    if (!conv) throw notFound('Conversation');
    if (actor.kind === 'operator') {
      if (conv.kind !== 'SUPPORT') throw notFound('Conversation');
      if (!conv.members.some((m) => m.operatorId === actor.op.id)) {
        const m = await tx.chatMember.create({ data: { tenantId, conversationId: id, operatorId: actor.op.id } });
        conv.members.push(m);
      }
      return conv;
    }
    if (!conv.members.some((m) => m.userId === actor.auth.userId)) {
      // Admins who joined after the support line was made are added the first time they open it.
      if (conv.kind === 'SUPPORT' && isAdmin(actor)) {
        const line = await this.supportLine(tx, tenantId);
        if (line.members.some((m) => m.userId === actor.auth.userId)) return line;
      }
      throw notFound('Conversation');
    }
    return conv;
  }

  private audience(conv: ConversationRecord): ChatAudience {
    return { tenantId: conv.tenantId, conversationId: conv.id, userIds: conv.members.map((m) => m.userId).filter((v): v is string => !!v), operators: conv.kind === 'SUPPORT' };
  }

  private canManage(actor: ChatActor, conv: ConversationRecord): boolean {
    if (conv.kind === 'DIRECT' || actor.kind === 'operator') return false;
    if (isAdmin(actor)) return true;
    return conv.kind === 'CHANNEL' && conv.members.some((m) => m.userId === actor.auth.userId && m.role === 'OWNER');
  }

  // ─── Rows ───

  private linkOf(type: ChatLinkType | null, id: string | null, label: string | null, actor: ChatActor): ChatLink | null {
    if (!type || !id) return null;
    const href = actor.kind === 'operator' ? null : type === 'COMPANY' ? `/app/companies/${id}` : type === 'RFQ' ? `/app/rfqs?open=${id}` : `/app/deals/${id}`;
    return { type, id, label: label ?? '', href };
  }

  private async unread(tx: TenantTx, actor: ChatActor, conv: ConversationRecord): Promise<number> {
    const me = conv.members.find((m) => (actor.kind === 'user' ? m.userId === actor.auth.userId : m.operatorId === actor.op.id));
    const notMine = actor.kind === 'user' ? { OR: [{ authorUserId: { not: actor.auth.userId } }, { authorUserId: null }] } : { OR: [{ authorOperatorId: { not: actor.op.id } }, { authorOperatorId: null }] };
    return tx.chatMessage.count({ where: { tenantId: conv.tenantId, conversationId: conv.id, deletedAt: null, ...(me?.lastReadAt ? { createdAt: { gt: me.lastReadAt } } : {}), ...notMine } });
  }

  private async conversationRows(tx: TenantTx, actor: ChatActor, convs: ConversationRecord[], workspaces?: Map<string, string>): Promise<ChatConversationRow[]> {
    const people = await this.people(tx, convs.flatMap((c) => c.members.map((m) => m.userId)), convs.flatMap((c) => c.members.map((m) => m.operatorId)));
    const names = workspaces ?? new Map((await tx.tenant.findMany({ where: { id: { in: [...new Set(convs.map((c) => c.tenantId))] } }, select: { id: true, name: true } })).map((t) => [t.id, t.name]));
    const unread = await Promise.all(convs.map((c) => this.unread(tx, actor, c)));
    return convs.map((c, i) => {
      const members = c.members
        .map((m) => ({
          person: people.get(m.userId ? `u:${m.userId}` : `o:${m.operatorId}`),
          role: m.role,
          lastReadAt: m.lastReadAt?.toISOString() ?? null,
          // Read implies it reached a device.
          lastDeliveredAt: latest(m.lastDeliveredAt, m.lastReadAt)?.toISOString() ?? null,
        }))
        .filter((m): m is ChatMemberRow & { person: ChatPerson } => !!m.person)
        .sort((a, b) => Number(a.person.operator) - Number(b.person.operator) || a.person.name.localeCompare(b.person.name));
      const other = c.kind === 'DIRECT' ? members.find((m) => m.person.id !== personId(actor)) : undefined;
      return {
        id: c.id,
        tenantId: c.tenantId,
        workspace: names.get(c.tenantId) ?? '',
        kind: c.kind as ChatKind,
        title: c.kind === 'SUPPORT' ? SUPPORT_TITLE : c.kind === 'DIRECT' ? (other?.person.name ?? members[0]?.person.name ?? '') : (c.name ?? ''),
        topic: c.topic,
        link: this.linkOf(c.linkType, c.linkId, c.linkLabel, actor),
        archived: !!c.archivedAt,
        members,
        unread: unread[i]!,
        lastMessageAt: c.lastMessageAt?.toISOString() ?? null,
        lastMessagePreview: c.lastMessagePreview,
        canManage: this.canManage(actor, c),
        createdAt: c.createdAt.toISOString(),
      };
    });
  }

  private async messageRows(tx: TenantTx, actor: ChatActor, tenantId: string, rows: MessageRecord[]): Promise<ChatMessageRow[]> {
    const ids = rows.map((r) => r.id);
    const [people, files] = await Promise.all([
      this.people(tx, rows.map((r) => r.authorUserId), rows.map((r) => r.authorOperatorId)),
      ids.length ? tx.chatAttachment.findMany({ where: { tenantId, messageId: { in: ids } }, select: { id: true, messageId: true, name: true, contentType: true, sizeBytes: true }, orderBy: { createdAt: 'asc' } }) : [],
    ]);
    const byMessage = new Map<string, ChatAttachmentRow[]>();
    for (const f of files) byMessage.set(f.messageId!, [...(byMessage.get(f.messageId!) ?? []), { id: f.id, name: f.name, contentType: f.contentType, sizeBytes: f.sizeBytes }]);
    return rows.map((r) => {
      const deleted = !!r.deletedAt;
      return {
        id: r.id,
        conversationId: r.conversationId,
        clientId: r.clientId,
        author: (r.authorUserId ? people.get(`u:${r.authorUserId}`) : r.authorOperatorId ? people.get(`o:${r.authorOperatorId}`) : null) ?? null,
        body: deleted ? '' : r.body,
        link: deleted ? null : this.linkOf(r.linkType, r.linkId, r.linkLabel, actor),
        attachments: deleted ? [] : (byMessage.get(r.id) ?? []),
        createdAt: r.createdAt.toISOString(),
        writtenAt: r.writtenAt?.toISOString() ?? null,
        editedAt: r.editedAt?.toISOString() ?? null,
        deleted,
      };
    });
  }

  // ─── Links to records ───

  /** The record's label, if the user may see it. Operators cannot link workspace records. */
  private async resolveLink(tx: TenantTx, actor: ChatActor, tenantId: string, link: { type: ChatLinkType; id: string } | null | undefined, path: string): Promise<{ type: ChatLinkType; id: string; label: string } | null> {
    if (!link) return null;
    if (actor.kind === 'operator') throw badRequest('VALIDATION_FAILED', 'Super admins cannot link workspace records.', path);
    const auth = actor.auth;
    const can = (p: Permission) => hasPermission(auth.permissions, p);
    const missing = () => badRequest('VALIDATION_FAILED', 'refers to a record that does not exist', path);
    if (link.type === 'DEAL') {
      if (!can('deals:read')) throw missing();
      const d = await tx.opportunity.findFirst({ where: { id: link.id, tenantId, deletedAt: null }, select: { name: true } });
      if (!d) throw missing();
      return { ...link, label: d.name };
    }
    if (!can('companies:read')) throw missing();
    const v = await visibility(tx, auth);
    if (link.type === 'COMPANY') {
      const c = await tx.company.findFirst({ where: { id: link.id, tenantId, deletedAt: null, ...companyScope(v) }, select: { name: true, leadNumber: true } });
      if (!c) throw missing();
      return { ...link, label: c.leadNumber ? `${c.leadNumber} ${c.name}` : c.name };
    }
    if (!(await hasFeature(tx, tenantId, 'rfqs'))) throw missing();
    const r = await tx.rfq.findFirst({ where: { id: link.id, tenantId, deletedAt: null }, select: { number: true, projectName: true, companyId: true } });
    if (!r || !(await tx.company.findFirst({ where: { id: r.companyId, tenantId, ...companyScope(v) }, select: { id: true } }))) throw missing();
    return { ...link, label: `${r.number} ${r.projectName}` };
  }

  linkOptions(auth: AuthContext, q: string): Promise<ChatLinkOption[]> {
    return this.prisma.run(auth, async (tx) => {
      const tid = auth.tenantId;
      const text = q.trim();
      const can = (p: Permission) => hasPermission(auth.permissions, p);
      const out: ChatLinkOption[] = [];
      if (can('companies:read')) {
        const v = await visibility(tx, auth);
        const match = text ? { OR: [{ name: { contains: text, mode: 'insensitive' as const } }, { leadNumber: { contains: text, mode: 'insensitive' as const } }] } : {};
        const companies = await tx.company.findMany({ where: { tenantId: tid, deletedAt: null, AND: [companyScope(v), match] }, select: { id: true, name: true, leadNumber: true }, orderBy: { updatedAt: 'desc' }, take: 8 });
        out.push(...companies.map((c) => ({ type: 'COMPANY' as const, id: c.id, label: c.leadNumber ? `${c.leadNumber} ${c.name}` : c.name })));
        if (await hasFeature(tx, tid, 'rfqs')) {
          const visible = v.all ? null : (await tx.company.findMany({ where: { tenantId: tid, deletedAt: null, ...companyScope(v) }, select: { id: true } })).map((c) => c.id);
          const rfqMatch = text ? { OR: [{ number: { contains: text, mode: 'insensitive' as const } }, { projectName: { contains: text, mode: 'insensitive' as const } }] } : {};
          const rfqs = await tx.rfq.findMany({ where: { tenantId: tid, deletedAt: null, ...(visible ? { companyId: { in: visible } } : {}), ...rfqMatch }, select: { id: true, number: true, projectName: true }, orderBy: { receivedAt: 'desc' }, take: 8 });
          out.push(...rfqs.map((r) => ({ type: 'RFQ' as const, id: r.id, label: `${r.number} ${r.projectName}` })));
        }
      }
      if (can('deals:read')) {
        const deals = await tx.opportunity.findMany({ where: { tenantId: tid, deletedAt: null, ...(text ? { name: { contains: text, mode: 'insensitive' } } : {}) }, select: { id: true, name: true }, orderBy: { updatedAt: 'desc' }, take: 8 });
        out.push(...deals.map((d) => ({ type: 'DEAL' as const, id: d.id, label: d.name })));
      }
      return out;
    });
  }

  // ─── Conversations ───

  /** People of the workspace to start a direct message or fill a channel with. */
  /** Everyone active in the workspace, with email, role and whether they are online, for the people picker. */
  directory(auth: AuthContext): Promise<ChatDirectoryPerson[]> {
    return this.prisma.run(auth, async (tx) => {
      const [rows, presence] = await Promise.all([
        tx.membership.findMany({ where: { tenantId: auth.tenantId, status: 'ACTIVE', user: { status: 'ACTIVE' } }, include: { user: { select: { id: true, name: true, email: true } }, role: { select: { name: true } } } }),
        tx.chatPresence.findMany({ where: { tenantId: auth.tenantId } }),
      ]);
      const seen = new Map(presence.map((p) => [p.userId, p]));
      const now = Date.now();
      // Only the people the caller's workspace may chat with (ADR 0071 part 5).
      const reach = await ChatReach.load(tx, auth.tenantId);
      return rows
        .filter((r) => reach.canTalk(auth.userId, r.user.id))
        .map((r) => {
          const p = seen.get(r.user.id);
          return {
            id: r.user.id,
            name: r.user.name,
            operator: false,
            email: r.user.email,
            role: r.role?.name ?? null,
            online: isOnline(p, now),
            lastSeenAt: p ? latest(p.lastSeenAt, p.offlineAt)!.toISOString() : null,
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
    });
  }

  list(auth: AuthContext, archived: boolean): Promise<ChatConversationRow[]> {
    const actor: ChatActor = { kind: 'user', auth };
    return this.run(actor, undefined, async (tx) => {
      if (isAdmin(actor) && (await ChatReach.load(tx, auth.tenantId)).isSuper(auth.userId)) await this.supportLine(tx, auth.tenantId);
      const mine = await tx.chatMember.findMany({ where: { tenantId: auth.tenantId, userId: auth.userId }, select: { conversationId: true } });
      const convs = await tx.chatConversation.findMany({
        where: { tenantId: auth.tenantId, id: { in: mine.map((m) => m.conversationId) }, archivedAt: archived ? { not: null } : null },
        include: { members: true },
      });
      return sortConversations(await this.conversationRows(tx, actor, convs));
    });
  }

  get(actor: ChatActor, id: string, tenantId?: string): Promise<ChatConversationRow> {
    return this.run(actor, tenantId, async (tx) => (await this.conversationRows(tx, actor, [await this.conversation(tx, actor, tenantOf(actor, tenantId), id)]))[0]!);
  }

  create(auth: AuthContext, input: z.output<typeof chatConversationInputSchema>, meta: RequestMeta): Promise<ChatConversationRow> {
    const actor: ChatActor = { kind: 'user', auth };
    const tid = auth.tenantId;
    return this.run(actor, undefined, async (tx, signals) => {
      let conv: ConversationRecord;
      if (input.kind === 'DIRECT') {
        if (input.userId === auth.userId) throw badRequest('VALIDATION_FAILED', 'Choose someone other than yourself.', 'userId');
        await this.assertMembers(tx, tid, [input.userId], 'userId');
        (await ChatReach.load(tx, tid)).assert(auth.userId, [input.userId]);
        const directKey = [auth.userId, input.userId].sort().join(':');
        const existing = await tx.chatConversation.findFirst({ where: { tenantId: tid, directKey }, include: { members: true } });
        if (existing) return (await this.conversationRows(tx, actor, [existing]))[0]!;
        conv = await tx.chatConversation.create({
          data: { tenantId: tid, kind: 'DIRECT', directKey, createdById: auth.userId, members: { create: [{ tenantId: tid, userId: auth.userId }, { tenantId: tid, userId: input.userId }] } },
          include: { members: true },
        });
      } else {
        const memberIds = [...new Set(input.memberIds.filter((id) => id !== auth.userId))];
        await this.assertMembers(tx, tid, memberIds, 'memberIds');
        (await ChatReach.load(tx, tid)).assert(auth.userId, memberIds);
        const link = await this.resolveLink(tx, actor, tid, input.link, 'link');
        conv = await tx.chatConversation.create({
          data: {
            tenantId: tid, kind: 'CHANNEL', name: input.name, topic: input.topic ?? null, createdById: auth.userId,
            linkType: link?.type ?? null, linkId: link?.id ?? null, linkLabel: link?.label ?? null,
            members: { create: [{ tenantId: tid, userId: auth.userId, role: 'OWNER' }, ...memberIds.map((userId) => ({ tenantId: tid, userId }))] },
          },
          include: { members: true },
        });
        await this.audit.record(tx, { tenantId: tid, actorUserId: auth.userId, action: 'chat.channel_created', entityType: 'chat_conversation', entityId: conv.id, metadata: { name: input.name, members: memberIds.length + 1 }, meta });
      }
      signals.push(await this.bus.record(tx, this.audience(conv), { type: 'conversation', conversationId: conv.id }));
      return (await this.conversationRows(tx, actor, [conv]))[0]!;
    });
  }

  update(auth: AuthContext, id: string, input: z.output<typeof chatConversationUpdateSchema>, meta: RequestMeta): Promise<ChatConversationRow> {
    const actor: ChatActor = { kind: 'user', auth };
    return this.run(actor, undefined, async (tx, signals) => {
      const conv = await this.conversation(tx, actor, auth.tenantId, id);
      if (conv.kind !== 'CHANNEL' || !this.canManage(actor, conv)) throw forbidden('Only the channel owner or a workspace admin can change this channel.');
      const link = input.link === undefined ? undefined : await this.resolveLink(tx, actor, auth.tenantId, input.link, 'link');
      const data: Prisma.ChatConversationUpdateInput = {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.topic !== undefined ? { topic: input.topic } : {}),
        ...(link !== undefined ? { linkType: link?.type ?? null, linkId: link?.id ?? null, linkLabel: link?.label ?? null } : {}),
        ...(input.archived !== undefined ? { archivedAt: input.archived ? new Date() : null } : {}),
      };
      const next = await tx.chatConversation.update({ where: { id }, data, include: { members: true } });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: input.archived === true ? 'chat.channel_archived' : 'chat.channel_updated', entityType: 'chat_conversation', entityId: id, metadata: { fields: Object.keys(input) }, meta });
      signals.push(await this.bus.record(tx, this.audience(next), { type: 'conversation', conversationId: id }));
      return (await this.conversationRows(tx, actor, [next]))[0]!;
    });
  }

  addMembers(auth: AuthContext, id: string, userIds: string[], meta: RequestMeta): Promise<ChatConversationRow> {
    const actor: ChatActor = { kind: 'user', auth };
    return this.run(actor, undefined, async (tx, signals) => {
      const conv = await this.conversation(tx, actor, auth.tenantId, id);
      if (!this.canManage(actor, conv)) throw forbidden('Only the channel owner or a workspace admin can change who is in it.');
      await this.assertMembers(tx, auth.tenantId, userIds, 'userIds');
      (await ChatReach.load(tx, auth.tenantId)).assert(auth.userId, userIds);
      const have = new Set(conv.members.map((m) => m.userId));
      const add = [...new Set(userIds)].filter((u) => !have.has(u));
      if (add.length) await tx.chatMember.createMany({ data: add.map((userId) => ({ tenantId: auth.tenantId, conversationId: id, userId })) });
      const next = await tx.chatConversation.findFirstOrThrow({ where: { id, tenantId: auth.tenantId }, include: { members: true } });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'chat.members_added', entityType: 'chat_conversation', entityId: id, metadata: { userIds: add }, meta });
      signals.push(await this.bus.record(tx, this.audience(next), { type: 'conversation', conversationId: id }));
      return (await this.conversationRows(tx, actor, [next]))[0]!;
    });
  }

  /** Takes someone out of a channel or the support line; anyone may leave a channel themselves. */
  removeMember(auth: AuthContext, id: string, userId: string, meta: RequestMeta): Promise<void> {
    const actor: ChatActor = { kind: 'user', auth };
    return this.run(actor, undefined, async (tx, signals) => {
      const conv = await this.conversation(tx, actor, auth.tenantId, id);
      if (conv.kind === 'DIRECT') throw forbidden('People cannot be removed from a direct message.');
      if (userId !== auth.userId && !this.canManage(actor, conv)) throw forbidden('Only the channel owner or a workspace admin can change who is in it.');
      if (conv.kind === 'SUPPORT' && (await this.adminIds(tx, auth.tenantId)).includes(userId)) throw forbidden('Workspace admins are always on the support line.');
      const m = conv.members.find((x) => x.userId === userId);
      if (!m) throw notFound('Member');
      await tx.chatMember.delete({ where: { id: m.id } });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: userId === auth.userId ? 'chat.left' : 'chat.member_removed', entityType: 'chat_conversation', entityId: id, metadata: { userId }, meta });
      // The person who left is told too, so their list drops the conversation.
      signals.push(await this.bus.record(tx, this.audience(conv), { type: 'conversation', conversationId: id }));
    });
  }

  // ─── Messages ───

  messages(actor: ChatActor, id: string, q: z.output<typeof chatMessagesQuerySchema>, tenantId?: string): Promise<ChatMessageRow[]> {
    return this.run(actor, tenantId, async (tx) => {
      const tid = tenantOf(actor, tenantId);
      await this.conversation(tx, actor, tid, id);
      let before: Date | undefined;
      if (q.before) {
        const m = await tx.chatMessage.findFirst({ where: { id: q.before, tenantId: tid, conversationId: id }, select: { createdAt: true } });
        if (!m) throw notFound('Message');
        before = m.createdAt;
      }
      const createdAt = { ...(before ? { lt: before } : {}), ...(q.after ? { gt: new Date(q.after) } : {}) };
      const rows = await tx.chatMessage.findMany({
        where: { tenantId: tid, conversationId: id, ...(before || q.after ? { createdAt } : {}) },
        orderBy: { createdAt: q.after ? 'asc' : 'desc' },
        take: q.limit,
      });
      if (!q.after) rows.reverse();
      return this.messageRows(tx, actor, tid, rows);
    });
  }

  async send(actor: ChatActor, id: string, input: z.output<typeof chatMessageInputSchema>, tenantId?: string): Promise<ChatMessageRow> {
    const tid = tenantOf(actor, tenantId);
    try {
      return await this.sendOnce(actor, id, input, tid);
    } catch (err) {
      // The same message arrived twice at once (an outbox retry racing the first try): return the stored one.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const again = await this.existing(actor, id, input.clientId, tid);
        if (again) return again;
      }
      throw err;
    }
  }

  private existing(actor: ChatActor, id: string, clientId: string, tid: string): Promise<ChatMessageRow | null> {
    return this.run(actor, tid, async (tx) => {
      const m = await tx.chatMessage.findFirst({ where: { tenantId: tid, conversationId: id, clientId } });
      if (!m) return null;
      if ((actor.kind === 'user' ? m.authorUserId : m.authorOperatorId) !== personId(actor)) throw badRequest('VALIDATION_FAILED', 'This message id is already used.', 'clientId');
      return (await this.messageRows(tx, actor, tid, [m]))[0]!;
    });
  }

  private sendOnce(actor: ChatActor, id: string, input: z.output<typeof chatMessageInputSchema>, tid: string): Promise<ChatMessageRow> {
    return this.run(actor, tid, async (tx, signals) => {
      const conv = await this.conversation(tx, actor, tid, id);
      // Sending again from an outbox returns what was stored the first time.
      const dup = await tx.chatMessage.findFirst({ where: { tenantId: tid, conversationId: id, clientId: input.clientId } });
      if (dup) {
        if ((actor.kind === 'user' ? dup.authorUserId : dup.authorOperatorId) !== personId(actor)) throw badRequest('VALIDATION_FAILED', 'This message id is already used.', 'clientId');
        return (await this.messageRows(tx, actor, tid, [dup]))[0]!;
      }
      if (conv.archivedAt) throw forbidden('This channel is archived.');
      // A direct conversation stops taking messages when the hierarchy no longer lets the two talk; its history stays.
      if (conv.kind === 'DIRECT' && actor.kind === 'user') {
        const other = conv.members.find((m) => m.userId && m.userId !== actor.auth.userId)?.userId;
        if (other && !(await ChatReach.load(tx, tid)).canTalk(actor.auth.userId, other)) throw chatNotAllowed();
      }
      const link = await this.resolveLink(tx, actor, tid, input.link, 'link');
      const files = input.attachmentIds.length
        ? await tx.chatAttachment.findMany({ where: { tenantId: tid, id: { in: input.attachmentIds }, conversationId: id, messageId: null, ...(actor.kind === 'user' ? { uploadedByUserId: actor.auth.userId } : { uploadedByOperatorId: actor.op.id }) }, select: { id: true, name: true } })
        : [];
      if (files.length !== new Set(input.attachmentIds).size) throw badRequest('VALIDATION_FAILED', 'refers to a record that does not exist', 'attachmentIds');
      const now = new Date();
      const written = input.writtenAt ? new Date(input.writtenAt) : null;
      // Only a message that really waited keeps its writing time, and never one from the future or long ago.
      const writtenAt = written && written.getTime() < now.getTime() - 60_000 && written.getTime() > now.getTime() - CHAT_WRITTEN_AT_MAX_AGE_MS ? written : null;
      const msg = await tx.chatMessage.create({
        data: {
          tenantId: tid, conversationId: id, clientId: input.clientId, body: input.body, writtenAt,
          ...(actor.kind === 'user' ? { authorUserId: actor.auth.userId } : { authorOperatorId: actor.op.id }),
          linkType: link?.type ?? null, linkId: link?.id ?? null, linkLabel: link?.label ?? null,
        },
      });
      if (files.length) await tx.chatAttachment.updateMany({ where: { tenantId: tid, id: { in: files.map((f) => f.id) } }, data: { messageId: msg.id } });
      const preview = (input.body || files.map((f) => f.name).join(', ') || link?.label || '').replace(/\s+/g, ' ').slice(0, PREVIEW_MAX);
      await tx.chatConversation.update({ where: { id }, data: { lastMessageAt: msg.createdAt, lastMessagePreview: preview } });
      // Your own message is read by you.
      const mine = conv.members.find((m) => (actor.kind === 'user' ? m.userId === actor.auth.userId : m.operatorId === actor.op.id));
      if (mine) await tx.chatMember.update({ where: { id: mine.id }, data: { lastReadAt: msg.createdAt, lastDeliveredAt: msg.createdAt } });
      signals.push(await this.bus.record(tx, this.audience(conv), { type: 'message', conversationId: id, messageId: msg.id, authorId: personId(actor) }));
      return (await this.messageRows(tx, actor, tid, [msg]))[0]!;
    });
  }

  private async ownMessage(tx: TenantTx, actor: ChatActor, tid: string, messageId: string, allowManager: boolean): Promise<{ msg: MessageRecord; conv: ConversationRecord }> {
    const msg = await tx.chatMessage.findFirst({ where: { id: messageId, tenantId: tid } });
    if (!msg) throw notFound('Message');
    const conv = await this.conversation(tx, actor, tid, msg.conversationId);
    const mine = (actor.kind === 'user' ? msg.authorUserId : msg.authorOperatorId) === personId(actor);
    if (!mine && !(allowManager && this.canManage(actor, conv))) throw forbidden('You can only change your own messages.');
    if (msg.deletedAt) throw badRequest('MESSAGE_DELETED', 'This message was deleted.');
    return { msg, conv };
  }

  edit(actor: ChatActor, messageId: string, body: string, tenantId?: string): Promise<ChatMessageRow> {
    const tid = tenantOf(actor, tenantId);
    return this.run(actor, tid, async (tx, signals) => {
      const { msg, conv } = await this.ownMessage(tx, actor, tid, messageId, false);
      const next = await tx.chatMessage.update({ where: { id: msg.id }, data: { body, editedAt: new Date() } });
      signals.push(await this.bus.record(tx, this.audience(conv), { type: 'message_changed', conversationId: conv.id, messageId: msg.id }));
      return (await this.messageRows(tx, actor, tid, [next]))[0]!;
    });
  }

  /** Deletes the text and files of a message; the conversation keeps a "message deleted" line. */
  remove(actor: ChatActor, messageId: string, meta: RequestMeta | undefined, tenantId?: string): Promise<void> {
    const tid = tenantOf(actor, tenantId);
    return this.run(actor, tid, async (tx, signals) => {
      const { msg, conv } = await this.ownMessage(tx, actor, tid, messageId, true);
      await tx.chatMessage.update({ where: { id: msg.id }, data: { body: '', deletedAt: new Date(), linkType: null, linkId: null, linkLabel: null } });
      await tx.chatAttachment.deleteMany({ where: { tenantId: tid, messageId: msg.id } });
      const byOther = (actor.kind === 'user' ? msg.authorUserId : msg.authorOperatorId) !== personId(actor);
      if (byOther && actor.kind === 'user') {
        await this.audit.record(tx, { tenantId: tid, actorUserId: actor.auth.userId, action: 'chat.message_removed', entityType: 'chat_conversation', entityId: conv.id, metadata: { messageId: msg.id, authorUserId: msg.authorUserId }, meta });
      }
      signals.push(await this.bus.record(tx, this.audience(conv), { type: 'message_changed', conversationId: conv.id, messageId: msg.id }));
    });
  }

  /** Marks everything up to the message (or now) as read: the unread count drops and others see the read receipt. */
  markRead(actor: ChatActor, id: string, messageId: string | null | undefined, tenantId?: string): Promise<{ lastReadAt: string }> {
    const tid = tenantOf(actor, tenantId);
    return this.run(actor, tid, async (tx, signals) => {
      const conv = await this.conversation(tx, actor, tid, id);
      const me = conv.members.find((m) => (actor.kind === 'user' ? m.userId === actor.auth.userId : m.operatorId === actor.op.id))!;
      let at = new Date();
      if (messageId) {
        const m = await tx.chatMessage.findFirst({ where: { id: messageId, tenantId: tid, conversationId: id }, select: { createdAt: true } });
        if (!m) throw notFound('Message');
        at = m.createdAt;
      } else {
        const last = await tx.chatMessage.findFirst({ where: { tenantId: tid, conversationId: id }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } });
        at = last?.createdAt ?? at;
      }
      if (me.lastReadAt && me.lastReadAt >= at) return { lastReadAt: me.lastReadAt.toISOString() };
      await tx.chatMember.update({ where: { id: me.id }, data: { lastReadAt: at, ...(!me.lastDeliveredAt || me.lastDeliveredAt < at ? { lastDeliveredAt: at } : {}) } });
      signals.push(await this.bus.record(tx, this.audience(conv), { type: 'read', conversationId: id, personId: personId(actor), at: at.toISOString() }));
      return { lastReadAt: at.toISOString() };
    });
  }

  // ─── Files ───

  upload(actor: ChatActor, id: string, file: { name: string; contentType: string; data: Buffer }, tenantId?: string): Promise<ChatAttachmentRow> {
    const tid = tenantOf(actor, tenantId);
    if (file.data.length === 0) throw badRequest('EMPTY_FILE', 'The file is empty.');
    if (file.data.length > CHAT_ATTACHMENT_MAX_BYTES) throw new PayloadTooLargeException({ code: 'PAYLOAD_TOO_LARGE', message: 'Files can be up to 10 MB.' });
    if (!file.name || file.name.length > 200) throw badRequest('INVALID_NAME', 'Give the file a name.');
    return this.run(actor, tid, async (tx) => {
      const conv = await this.conversation(tx, actor, tid, id);
      if (conv.archivedAt) throw forbidden('This channel is archived.');
      const row = await tx.chatAttachment.create({
        data: {
          tenantId: tid, conversationId: id, name: file.name, contentType: file.contentType || 'application/octet-stream', sizeBytes: file.data.length,
          data: new Uint8Array(file.data), sha256: createHash('sha256').update(file.data).digest('hex'),
          ...(actor.kind === 'user' ? { uploadedByUserId: actor.auth.userId } : { uploadedByOperatorId: actor.op.id }),
        },
      });
      return { id: row.id, name: row.name, contentType: row.contentType, sizeBytes: row.sizeBytes };
    });
  }

  download(actor: ChatActor, attachmentId: string, tenantId?: string, conversationId?: string): Promise<{ name: string; contentType: string; data: Buffer }> {
    const tid = tenantOf(actor, tenantId);
    return this.run(actor, tid, async (tx) => {
      const f = await tx.chatAttachment.findFirst({ where: { id: attachmentId, tenantId: tid, ...(conversationId ? { conversationId } : {}) } });
      if (!f) throw notFound('File');
      await this.conversation(tx, actor, tid, f.conversationId);
      // Before it is sent, only the person who uploaded it can open it.
      if (!f.messageId && (actor.kind === 'user' ? f.uploadedByUserId : f.uploadedByOperatorId) !== personId(actor)) throw notFound('File');
      return { name: f.name, contentType: f.contentType, data: Buffer.from(f.data) };
    });
  }

  // ─── Search ───

  search(auth: AuthContext, q: z.output<typeof chatSearchQuerySchema>): Promise<ChatSearchHit[]> {
    const actor: ChatActor = { kind: 'user', auth };
    return this.run(actor, undefined, async (tx) => {
      const mine = await tx.chatMember.findMany({ where: { tenantId: auth.tenantId, userId: auth.userId }, select: { conversationId: true } });
      const ids = mine.map((m) => m.conversationId).filter((c) => !q.conversationId || c === q.conversationId);
      if (!ids.length) return [];
      const rows = await tx.chatMessage.findMany({
        where: { tenantId: auth.tenantId, conversationId: { in: ids }, deletedAt: null, OR: [{ body: { contains: q.q, mode: 'insensitive' } }, { linkLabel: { contains: q.q, mode: 'insensitive' } }] },
        orderBy: { createdAt: 'desc' },
        take: q.limit,
      });
      const convs = await tx.chatConversation.findMany({ where: { tenantId: auth.tenantId, id: { in: [...new Set(rows.map((r) => r.conversationId))] } }, include: { members: true } });
      const convRows = new Map((await this.conversationRows(tx, actor, convs)).map((c) => [c.id, c]));
      const messages = await this.messageRows(tx, actor, auth.tenantId, rows);
      return messages.map((m) => {
        const c = convRows.get(m.conversationId)!;
        return { message: m, conversation: { id: c.id, title: c.title, kind: c.kind } };
      });
    });
  }

  unreadTotal(auth: AuthContext): Promise<{ total: number; conversations: number }> {
    const actor: ChatActor = { kind: 'user', auth };
    return this.run(actor, undefined, async (tx) => {
      const mine = await tx.chatMember.findMany({ where: { tenantId: auth.tenantId, userId: auth.userId }, select: { conversationId: true } });
      const convs = await tx.chatConversation.findMany({ where: { tenantId: auth.tenantId, id: { in: mine.map((m) => m.conversationId) }, archivedAt: null }, include: { members: true } });
      const counts = await Promise.all(convs.map((c) => this.unread(tx, actor, c)));
      return { total: counts.reduce((a, b) => a + b, 0), conversations: counts.filter((n) => n > 0).length };
    });
  }

  // ─── Delivery, typing and catch-up (ADR 0069) ───

  /**
   * Everything in the caller's conversations has reached this device: their "Delivered" moves up to each
   * conversation's latest message, and the senders hear about it. Called by the browser when it connects and when a
   * message arrives. Only conversations with something new are written.
   */
  markDelivered(actor: ChatActor, conversationId?: string, tenantId?: string): Promise<{ updated: number }> {
    const tid = tenantOf(actor, tenantId);
    return this.run(actor, tid, async (tx, signals) => {
      const who = actor.kind === 'user' ? { userId: actor.auth.userId } : { operatorId: actor.op.id };
      const mine = await tx.chatMember.findMany({ where: { tenantId: tid, ...who, ...(conversationId ? { conversationId } : {}) } });
      if (!mine.length) return { updated: 0 };
      const convs = await tx.chatConversation.findMany({ where: { tenantId: tid, id: { in: mine.map((m) => m.conversationId) }, lastMessageAt: { not: null } }, include: { members: true } });
      const byId = new Map(convs.map((c) => [c.id, c]));
      let updated = 0;
      for (const m of mine) {
        const conv = byId.get(m.conversationId);
        const at = conv?.lastMessageAt;
        const have = latest(m.lastDeliveredAt, m.lastReadAt);
        if (!conv || !at || (have && have >= at)) continue;
        await tx.chatMember.update({ where: { id: m.id }, data: { lastDeliveredAt: at } });
        signals.push(await this.bus.record(tx, this.audience(conv), { type: 'delivered', conversationId: conv.id, personId: personId(actor), at: at.toISOString() }));
        updated++;
      }
      return { updated };
    });
  }

  /** "X is typing": sent to the conversation's other people when the caller is in it; never stored for long. */
  async typing(who: { tenantId: string; userId: string } | { operatorId: string }, conversationId: string): Promise<void> {
    if ('operatorId' in who) {
      const tenantId = await this.tenantOfConversation(conversationId);
      const op = await this.prisma.platformOperator.findUnique({ where: { id: who.operatorId }, select: { name: true, status: true } });
      if (!op || op.status !== 'ACTIVE') return;
      const conv = await this.prisma.run({ tenantId }, (tx) => tx.chatConversation.findFirst({ where: { id: conversationId, tenantId, kind: 'SUPPORT', archivedAt: null }, include: { members: true } }));
      if (!conv) return;
      await this.bus.emit(this.audience(conv), { type: 'typing', conversationId, personId: who.operatorId, name: op.name });
      return;
    }
    const found = await this.prisma.run({ tenantId: who.tenantId, userId: who.userId }, async (tx) => {
      const conv = await tx.chatConversation.findFirst({ where: { id: conversationId, tenantId: who.tenantId, archivedAt: null }, include: { members: true } });
      if (!conv || !conv.members.some((m) => m.userId === who.userId)) return null;
      const user = await tx.user.findFirst({ where: { id: who.userId }, select: { name: true } });
      return { conv, name: user?.name ?? '' };
    });
    if (!found) throw notFound('Conversation');
    await this.bus.emit(this.audience(found.conv), { type: 'typing', conversationId, personId: who.userId, name: found.name });
  }

  /**
   * Events for the caller after `cursor`, for browsers that cannot keep a WebSocket open (a gateway that does not
   * pass them on). Answers at once when something is waiting, otherwise holds the request for up to `wait` seconds.
   * The first call (no cursor) or a cursor older than two minutes answers "ready": re-read everything.
   */
  async events(who: { realm: 'user'; tenantId: string; userId: string } | { realm: 'operator'; operatorId: string }, q: z.output<typeof chatEventsQuerySchema>, closed: Promise<void>): Promise<ChatEventsPage> {
    const started = new Date();
    const cursor = q.cursor ? new Date(q.cursor) : null;
    if (!cursor || started.getTime() - cursor.getTime() > 120_000 || cursor.getTime() > started.getTime() + 5000) {
      return { events: [{ type: 'ready' }], cursor: started.toISOString() };
    }
    const seen = new Set(q.seen);
    const queue: ChatStreamEvent[] = [];
    let wake: (() => void) | null = null;
    // Listen first, then read what is stored, so nothing falls between the two.
    const unsubscribe = this.bus.subscribe({
      ...(who.realm === 'user' ? { realm: 'user', tenantId: who.tenantId, userId: who.userId } : { realm: 'operator', operatorId: who.operatorId }),
      send: (e: ChatStreamEvent) => {
        queue.push(e);
        wake?.();
      },
    } as ChatListener);
    try {
      // Look back five seconds: a signal is stamped a moment before its change commits.
      const since = new Date(Math.min(cursor.getTime(), started.getTime()) - 5000);
      const rows =
        who.realm === 'user'
          ? await this.prisma.run({ tenantId: who.tenantId }, (tx) => tx.chatSignal.findMany({ where: { tenantId: who.tenantId, createdAt: { gt: since }, userIds: { has: who.userId } }, orderBy: { createdAt: 'asc' }, take: 500 }))
          : await this.prisma.run({ chatRelay: true }, (tx) => tx.chatSignal.findMany({ where: { createdAt: { gt: since }, operators: true }, orderBy: { createdAt: 'asc' }, take: 500 }));
      const out: ChatStreamEvent[] = [];
      const add = (e: ChatStreamEvent) => {
        if (e.sid) {
          if (seen.has(e.sid)) return;
          seen.add(e.sid);
        }
        out.push(e);
      };
      for (const r of rows) add({ ...(r.event as unknown as ChatStreamEvent), sid: r.id });
      if (!out.length && !queue.length && q.wait > 0) {
        await Promise.race([new Promise<void>((resolve) => (wake = resolve)), new Promise<void>((resolve) => setTimeout(resolve, q.wait * 1000).unref()), closed]);
        // Gather what else arrives in the same moment (a message and its delivery to others).
        if (queue.length) await new Promise((r) => setTimeout(r, 30));
      }
      for (const e of queue) add(e);
      return { events: out, cursor: started.toISOString() };
    } finally {
      unsubscribe();
    }
  }

  // ─── Operator console ───

  /** Every workspace's support line, busiest first, with this super admin's unread count. */
  operatorList(op: OperatorContext): Promise<ChatConversationRow[]> {
    const actor: ChatActor = { kind: 'operator', op };
    return this.prisma.run({ operatorScan: true }, async (tx) => {
      const convs = await tx.chatConversation.findMany({ where: { kind: 'SUPPORT' }, include: { members: true }, orderBy: { lastMessageAt: 'desc' }, take: 300 });
      const tenants = await tx.tenant.findMany({ where: { id: { in: convs.map((c) => c.tenantId) } }, select: { id: true, name: true } });
      const open: ConversationRecord[] = [];
      for (const c of convs) if (await hasFeature(tx, c.tenantId, 'team_chat')) open.push(c);
      return sortConversations(await this.conversationRows(tx, actor, open, new Map(tenants.map((t) => [t.id, t.name]))));
    });
  }

  operatorUnread(op: OperatorContext): Promise<{ total: number; conversations: number }> {
    return this.operatorList(op).then((rows) => ({ total: rows.reduce((a, r) => a + r.unread, 0), conversations: rows.filter((r) => r.unread > 0).length }));
  }

  /** Opens (creating if needed) a workspace's support line, so a super admin can write first. */
  operatorOpen(op: OperatorContext, tenantId: string): Promise<ChatConversationRow> {
    const actor: ChatActor = { kind: 'operator', op };
    return this.prisma.run({ tenantId }, async (tx) => {
      if (!(await tx.tenant.findFirst({ where: { id: tenantId }, select: { id: true } }))) throw notFound('Workspace');
      if (!(await hasFeature(tx, tenantId, 'team_chat'))) throw featureNotIncluded('team_chat');
      const conv = await this.conversation(tx, actor, tenantId, (await this.supportLine(tx, tenantId)).id);
      return (await this.conversationRows(tx, actor, [conv]))[0]!;
    });
  }

  /** Which workspace a support line belongs to (operator routes name only the conversation). */
  async tenantOfConversation(conversationId: string): Promise<string> {
    const c = await this.prisma.run({ operatorScan: true }, (tx) => tx.chatConversation.findFirst({ where: { id: conversationId, kind: 'SUPPORT' }, select: { tenantId: true } }));
    if (!c) throw notFound('Conversation');
    return c.tenantId;
  }

  async tenantOfMessage(messageId: string): Promise<string> {
    const m = await this.prisma.run({ operatorScan: true }, (tx) => tx.chatMessage.findFirst({ where: { id: messageId }, select: { conversationId: true } }));
    if (!m) throw notFound('Message');
    return this.tenantOfConversation(m.conversationId);
  }

}

/** The later of two optional times. */
function latest(a: Date | null | undefined, b: Date | null | undefined): Date | null {
  if (!a) return b ?? null;
  if (!b) return a;
  return a > b ? a : b;
}

/** Unread first, then the latest message, then the newest conversation. */
function sortConversations(rows: ChatConversationRow[]): ChatConversationRow[] {
  const t = (r: ChatConversationRow) => new Date(r.lastMessageAt ?? r.createdAt).getTime();
  return rows.sort((a, b) => Number(b.unread > 0) - Number(a.unread > 0) || t(b) - t(a));
}
