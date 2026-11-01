import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import type { ApiKey } from '@dealflow/database';
import { API_KEY_PREFIX, type ApiKeyCreated, type ApiKeyCreateInput, type ApiKeyRow, type ApiKeyScope, type ZapierEvent, ZAPIER_EVENTS, type ZapierMe, type ZapierStatus } from '@dealflow/types';
import { AuditService } from '../audit/audit.service';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { SECRET_BOX, type SecretBox } from '../common/crypto';
import { API_ENV, type ApiEnv } from '../common/env';
import { assertPublicUrl, UnsafeTargetError } from '../common/net-guard';
import { PrismaService } from '../common/prisma.service';
import { ownerRefs } from '../crm/crm-helpers';
import { CompaniesService } from '../crm/companies.service';
import { ContactsService } from '../crm/contacts.service';
import { DealsService } from '../crm/deals.service';
import { LeadsService } from '../crm/leads.service';
import { toTaskRow } from '../crm/tasks.service';

const MAX_KEYS = 25;
const MAX_HOOKS_PER_KEY = 50;
const ENTITY_SCOPE: Record<string, ApiKeyScope> = { lead: 'leads:read', contact: 'contacts:read', company: 'companies:read', deal: 'deals:read', task: 'activities:read' };

/**
 * Workspace API keys and the Zapier REST-hook endpoints that use them. Zapier subscriptions are ordinary outbound
 * webhooks (same signing, retries and auto-disable), tagged with the key that made them so they end with it.
 */
@Injectable()
export class ApiKeysService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly leads: LeadsService,
    private readonly contacts: ContactsService,
    private readonly companies: CompaniesService,
    private readonly deals: DealsService,
    @Inject(SECRET_BOX) private readonly box: SecretBox,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  list(auth: AuthContext): Promise<ApiKeyRow[]> {
    return this.prisma.run(auth, async (tx) => {
      const rows = await tx.apiKey.findMany({ where: { tenantId: auth.tenantId }, orderBy: { createdAt: 'desc' }, include: { _count: { select: { webhooks: { where: { deletedAt: null } } } } } });
      const owners = await ownerRefs(tx, rows.map((r) => r.createdById));
      return rows.map((r) => toRow(r, owners.get(r.createdById)?.name ?? null, r._count.webhooks));
    });
  }

  /** A new key, shown once. Scopes the creator's own role does not have are refused rather than silently dropped. */
  async create(auth: AuthContext, input: ApiKeyCreateInput, meta: RequestMeta): Promise<ApiKeyCreated> {
    const missing = input.scopes.filter((s) => !auth.permissions.includes(s));
    if (missing.length) throw new ForbiddenException({ code: 'SCOPE_NOT_ALLOWED', message: `Your role does not include ${missing.join(', ')}, so a key cannot have it either.` });
    const key = `${API_KEY_PREFIX}${randomBytes(30).toString('base64url')}`;
    const scopes = [...new Set(input.scopes)];
    return this.prisma.run(auth, async (tx) => {
      const active = await tx.apiKey.count({ where: { tenantId: auth.tenantId, revokedAt: null } });
      if (active >= MAX_KEYS) throw new ConflictException({ code: 'TOO_MANY_KEYS', message: `A workspace can have ${MAX_KEYS} active keys. Revoke one you no longer use.` });
      const row = await tx.apiKey.create({
        data: {
          tenantId: auth.tenantId,
          name: input.name,
          prefix: key.slice(0, 12),
          keyHash: createHash('sha256').update(key).digest('hex'),
          scopes,
          createdById: auth.userId,
          expiresAt: input.expiresInDays ? new Date(Date.now() + input.expiresInDays * 86_400_000) : null,
        },
      });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'api_key.created', entityType: 'api_key', entityId: row.id, metadata: { name: row.name, prefix: row.prefix, scopes }, meta });
      const owners = await ownerRefs(tx, [auth.userId]);
      return { ...toRow(row, owners.get(auth.userId)?.name ?? null, 0), key };
    });
  }

  /** Revoking a key stops it at once and removes the Zapier subscriptions made with it. */
  revoke(auth: AuthContext, id: string, meta: RequestMeta): Promise<void> {
    return this.prisma.run(auth, async (tx) => {
      const { count } = await tx.apiKey.updateMany({ where: { id, tenantId: auth.tenantId, revokedAt: null }, data: { revokedAt: new Date() } });
      if (!count) throw new NotFoundException({ code: 'NOT_FOUND', message: 'API key not found or already revoked.' });
      const hooks = await tx.webhook.updateMany({ where: { tenantId: auth.tenantId, apiKeyId: id, deletedAt: null }, data: { deletedAt: new Date(), active: false } });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'api_key.revoked', entityType: 'api_key', entityId: id, metadata: { hooksRemoved: hooks.count }, meta });
    });
  }

  // ───── Zapier ─────

  async zapierStatus(auth: AuthContext): Promise<ZapierStatus> {
    const subscriptions = await this.prisma.run(auth, (tx) => tx.webhook.count({ where: { tenantId: auth.tenantId, source: 'zapier', deletedAt: null } }));
    return { inviteUrl: this.env.ZAPIER_INVITE_URL ?? null, subscriptions };
  }

  /** Zapier's connection test and label. */
  me(auth: AuthContext): Promise<ZapierMe> {
    const keyId = this.keyId(auth);
    return this.prisma.run(auth, async (tx) => {
      const [tenant, user, key] = await Promise.all([
        tx.tenant.findFirstOrThrow({ where: { id: auth.tenantId }, select: { name: true } }),
        tx.user.findFirstOrThrow({ where: { id: auth.userId }, select: { name: true } }),
        tx.apiKey.findFirstOrThrow({ where: { id: keyId, tenantId: auth.tenantId } }),
      ]);
      return { workspace: tenant.name, user: user.name, keyName: key.name, scopes: key.scopes.filter((s) => auth.permissions.includes(s)) as ApiKeyScope[] };
    });
  }

  /** Zapier's REST-hook subscribe: an outbound webhook for one event, owned by this key. */
  async subscribe(auth: AuthContext, input: { event: ZapierEvent; targetUrl: string }, meta: RequestMeta): Promise<{ id: string }> {
    const keyId = this.keyId(auth);
    const scope = ZAPIER_EVENTS[input.event];
    if (!auth.permissions.includes(scope)) throw new ForbiddenException({ code: 'FORBIDDEN', message: `This key needs ${scope} to receive ${input.event}.` });
    try {
      await assertPublicUrl(input.targetUrl, this.env.ALLOW_PRIVATE_NETWORK_TARGETS);
    } catch (e) {
      if (e instanceof UnsafeTargetError) throw new ForbiddenException({ code: 'UNSAFE_URL', message: e.message });
      throw e;
    }
    return this.prisma.run(auth, async (tx) => {
      const count = await tx.webhook.count({ where: { tenantId: auth.tenantId, apiKeyId: keyId, deletedAt: null } });
      if (count >= MAX_HOOKS_PER_KEY) throw new ConflictException({ code: 'TOO_MANY_HOOKS', message: `One key can hold ${MAX_HOOKS_PER_KEY} subscriptions. Turn off Zaps you no longer use.` });
      const row = await tx.webhook.create({
        data: { tenantId: auth.tenantId, url: input.targetUrl, events: [input.event], secretEncrypted: this.box.seal(`whsec_${randomBytes(24).toString('base64url')}`), createdById: auth.userId, source: 'zapier', apiKeyId: keyId },
      });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'webhook.created', entityType: 'webhook', entityId: row.id, metadata: { source: 'zapier', event: input.event, host: new URL(input.targetUrl).host, apiKeyId: keyId }, meta });
      return { id: row.id };
    });
  }

  unsubscribe(auth: AuthContext, id: string, meta: RequestMeta): Promise<void> {
    const keyId = this.keyId(auth);
    return this.prisma.run(auth, async (tx) => {
      const { count } = await tx.webhook.updateMany({ where: { id, tenantId: auth.tenantId, apiKeyId: keyId, source: 'zapier', deletedAt: null }, data: { deletedAt: new Date(), active: false } });
      if (!count) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Subscription not found.' });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'webhook.deleted', entityType: 'webhook', entityId: id, metadata: { source: 'zapier' }, meta });
    });
  }

  /** One event with the record as it is now, for the Zapier trigger (the webhook itself carries only ids). */
  async event(auth: AuthContext, id: string): Promise<ZapierEventOut> {
    const ev = await this.prisma.run(auth, (tx) => tx.domainEvent.findFirst({ where: { id, tenantId: auth.tenantId } }));
    if (!ev || !(ev.type in ZAPIER_EVENTS)) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Event not found.' });
    return this.shape(auth, ev);
  }

  /** Recent events of one type, so Zapier can show sample data while a Zap is set up. */
  async samples(auth: AuthContext, event: ZapierEvent): Promise<ZapierEventOut[]> {
    if (!auth.permissions.includes(ZAPIER_EVENTS[event])) throw new ForbiddenException({ code: 'FORBIDDEN', message: `This key needs ${ZAPIER_EVENTS[event]} to read ${event}.` });
    const rows = await this.prisma.run(auth, (tx) => tx.domainEvent.findMany({ where: { tenantId: auth.tenantId, type: event }, orderBy: { createdAt: 'desc' }, take: 3 }));
    const out: ZapierEventOut[] = [];
    for (const r of rows) {
      const shaped = await this.shape(auth, r).catch(() => null);
      if (shaped) out.push(shaped);
    }
    return out;
  }

  private async shape(auth: AuthContext, ev: { id: string; type: string; entityType: string | null; entityId: string | null; createdAt: Date; payload: unknown }): Promise<ZapierEventOut> {
    const scope = ev.entityType ? ENTITY_SCOPE[ev.entityType] : undefined;
    if (!scope || !auth.permissions.includes(scope)) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'This key cannot read that record.' });
    return { id: ev.id, event: ev.type, occurredAt: ev.createdAt.toISOString(), entityType: ev.entityType!, entityId: ev.entityId, record: ev.entityId ? await this.record(auth, ev.entityType!, ev.entityId).catch(() => null) : null, changes: ev.payload };
  }

  private async record(auth: AuthContext, type: string, id: string): Promise<unknown> {
    switch (type) {
      case 'lead':
        return this.leads.get(auth, id);
      case 'contact':
        return this.contacts.get(auth, id);
      case 'company':
        return this.companies.get(auth, id);
      case 'deal':
        return this.deals.get(auth, id);
      case 'task':
        return this.prisma.run(auth, async (tx) => {
          const t = await tx.task.findFirst({ where: { id, tenantId: auth.tenantId, deletedAt: null } });
          return t ? toTaskRow(t, await ownerRefs(tx, [t.assigneeId]), new Date()) : null;
        });
      default:
        return null;
    }
  }

  private keyId(auth: AuthContext): string {
    if (auth.via !== 'api_key') throw new ForbiddenException({ code: 'API_KEY_REQUIRED', message: 'Zapier endpoints are used with an API key.' });
    return auth.sessionId;
  }
}

export interface ZapierEventOut {
  id: string;
  event: string;
  occurredAt: string;
  entityType: string;
  entityId: string | null;
  record: unknown;
  changes: unknown;
}

function toRow(r: ApiKey, createdBy: string | null, hooks: number): ApiKeyRow {
  return {
    id: r.id,
    name: r.name,
    prefix: r.prefix,
    scopes: r.scopes as ApiKeyScope[],
    createdBy,
    createdAt: r.createdAt.toISOString(),
    lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
    expiresAt: r.expiresAt?.toISOString() ?? null,
    revokedAt: r.revokedAt?.toISOString() ?? null,
    hooks,
  };
}
