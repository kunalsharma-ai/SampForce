import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { Prisma } from '@dealflow/database';
import type { DomainEventType, WebhookCreated, WebhookRow } from '@dealflow/types';
import { AuditService } from '../audit/audit.service';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { SECRET_BOX, type SecretBox } from '../common/crypto';
import { API_ENV, type ApiEnv } from '../common/env';
import { assertPublicUrl, UnsafeTargetError } from '../common/net-guard';
import { PrismaService } from '../common/prisma.service';
import { notFound } from '../crm/crm-helpers';

type WebhookWith = Prisma.WebhookGetPayload<{ include: { deliveries: true } }>;

@Injectable()
export class WebhooksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(SECRET_BOX) private readonly box: SecretBox,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  list(auth: AuthContext): Promise<WebhookRow[]> {
    return this.prisma.run(auth, async (tx) => {
      const rows = await tx.webhook.findMany({
        where: { tenantId: auth.tenantId, deletedAt: null },
        include: { deliveries: { orderBy: { createdAt: 'desc' }, take: 10 } },
        orderBy: { createdAt: 'desc' },
      });
      return rows.map(toWebhookRow);
    });
  }

  async create(auth: AuthContext, input: { url: string; events: DomainEventType[] }, meta: RequestMeta): Promise<WebhookCreated> {
    await this.checkUrl(input.url);
    const secret = `whsec_${randomBytes(24).toString('base64url')}`;
    return this.prisma.run(auth, async (tx) => {
      const row = await tx.webhook.create({
        data: { tenantId: auth.tenantId, url: input.url, events: input.events, secretEncrypted: this.box.seal(secret), createdById: auth.userId },
        include: { deliveries: true },
      });
      await this.audit.record(tx, {
        tenantId: auth.tenantId, actorUserId: auth.userId, action: 'webhook.created', entityType: 'webhook', entityId: row.id,
        metadata: { url: row.url, events: row.events }, meta,
      });
      return { ...toWebhookRow(row), secret };
    });
  }

  async update(auth: AuthContext, id: string, input: { url?: string; events?: DomainEventType[]; active?: boolean }, meta: RequestMeta): Promise<WebhookRow> {
    if (input.url) await this.checkUrl(input.url);
    return this.prisma.run(auth, async (tx) => {
      const before = await tx.webhook.findFirst({ where: { id, tenantId: auth.tenantId, deletedAt: null } });
      if (!before) throw notFound('Webhook');
      if (before.source === 'zapier' && (input.url || input.events)) throw new BadRequestException({ code: 'ZAPIER_MANAGED', message: 'This subscription is managed by Zapier. Change it in the Zap, or delete it here.' });
      const row = await tx.webhook.update({
        where: { id },
        data: {
          ...(input.url ? { url: input.url } : {}),
          ...(input.events ? { events: input.events } : {}),
          // Re-enabling clears the failure streak so the endpoint gets a fresh start.
          ...(input.active !== undefined ? { active: input.active, ...(input.active ? { consecutiveFailures: 0, disabledReason: null } : {}) } : {}),
        },
        include: { deliveries: { orderBy: { createdAt: 'desc' }, take: 10 } },
      });
      await this.audit.record(tx, {
        tenantId: auth.tenantId, actorUserId: auth.userId, action: 'webhook.updated', entityType: 'webhook', entityId: id,
        metadata: { url: input.url, events: input.events, active: input.active }, meta,
      });
      return toWebhookRow(row);
    });
  }

  remove(auth: AuthContext, id: string, meta: RequestMeta): Promise<void> {
    return this.prisma.run(auth, async (tx) => {
      const { count } = await tx.webhook.updateMany({ where: { id, tenantId: auth.tenantId, deletedAt: null }, data: { deletedAt: new Date(), active: false } });
      if (count === 0) throw notFound('Webhook');
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'webhook.deleted', entityType: 'webhook', entityId: id, meta });
    });
  }

  /** Puts a failed delivery back in the queue for an immediate attempt. */
  redeliver(auth: AuthContext, webhookId: string, deliveryId: string): Promise<{ queued: true }> {
    return this.prisma.run(auth, async (tx) => {
      const { count } = await tx.webhookDelivery.updateMany({
        where: { id: deliveryId, webhookId, tenantId: auth.tenantId, status: 'FAILED', webhook: { deletedAt: null } },
        data: { status: 'PENDING', nextAttemptAt: new Date(), attempts: 0, lastError: null },
      });
      if (count === 0) throw notFound('Failed delivery');
      return { queued: true as const };
    });
  }

  private async checkUrl(url: string): Promise<void> {
    try {
      await assertPublicUrl(url, this.env.ALLOW_PRIVATE_NETWORK_TARGETS);
    } catch (err) {
      if (err instanceof UnsafeTargetError) {
        throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'The request contains invalid fields.', details: [{ path: 'url', message: err.message }] });
      }
      throw err;
    }
  }
}

export function toWebhookRow(r: WebhookWith): WebhookRow {
  return {
    id: r.id,
    url: r.source === 'zapier' ? `${safeHost(r.url)} (Zapier)` : r.url,
    source: r.source === 'zapier' ? 'zapier' : 'manual',
    events: r.events as DomainEventType[],
    active: r.active,
    consecutiveFailures: r.consecutiveFailures,
    disabledReason: r.disabledReason,
    createdAt: r.createdAt.toISOString(),
    recentDeliveries: r.deliveries.map((d) => ({
      id: d.id,
      eventType: d.eventType,
      status: d.status,
      attempts: d.attempts,
      responseCode: d.responseCode,
      lastError: d.lastError,
      createdAt: d.createdAt.toISOString(),
    })),
  };
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return 'zapier';
  }
}
