import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@dealflow/database';
import { SECRET_BOX, type SecretBox } from '../common/crypto';
import { API_ENV, type ApiEnv } from '../common/env';
import { assertPublicUrl } from '../common/net-guard';
import { PrismaService } from '../common/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { claim, errorMessage } from '../worker/queue';
import { retryDelayMs, SIGNATURE_HEADER, signatureHeader } from './signing';

const TIMEOUT_MS = 10_000;
const LEASE_MS = 2 * 60_000;

/**
 * Delivers webhook events at least once. Receivers should de-duplicate on the event id. Failed
 * attempts retry with exponential backoff; after WEBHOOK_MAX_ATTEMPTS a delivery is marked failed
 * (and can be redelivered by hand), and an endpoint that keeps failing is switched off.
 */
@Injectable()
export class WebhookDeliverer {
  private readonly log = new Logger(WebhookDeliverer.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    @Inject(SECRET_BOX) private readonly box: SecretBox,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  async deliverDue(limit = 25): Promise<number> {
    const due = await claim<{ id: string; tenant_id: string }>(
      this.prisma,
      Prisma.sql`
        UPDATE webhook_deliveries SET next_attempt_at = now() + ${`${LEASE_MS} milliseconds`}::interval
        WHERE id IN (
          SELECT id FROM webhook_deliveries WHERE status = 'PENDING' AND next_attempt_at <= now()
          ORDER BY next_attempt_at LIMIT ${limit} FOR UPDATE SKIP LOCKED)
        RETURNING id, tenant_id`,
    );
    await Promise.all(due.map((d) => this.deliver(d.id, d.tenant_id).catch((err) => this.log.error({ deliveryId: d.id, err: errorMessage(err) }, 'delivery crashed'))));
    return due.length;
  }

  async deliver(deliveryId: string, tenantId: string): Promise<void> {
    const ctx = { tenantId };
    const loaded = await this.prisma.run(ctx, async (tx) => {
      const d = await tx.webhookDelivery.findFirst({ where: { id: deliveryId, tenantId, status: 'PENDING' }, include: { webhook: true } });
      if (!d) return null;
      const event = await tx.domainEvent.findFirst({ where: { id: d.eventId, tenantId } });
      return event ? { d, event } : null;
    });
    if (!loaded) return;
    const { d, event } = loaded;
    if (!d.webhook.active || d.webhook.deletedAt) {
      await this.prisma.run(ctx, (tx) => tx.webhookDelivery.update({ where: { id: d.id }, data: { status: 'FAILED', lastError: 'Webhook is disabled' } }));
      return;
    }

    const body = JSON.stringify({
      id: event.id,
      type: event.type,
      createdAt: event.createdAt.toISOString(),
      data: { entityType: event.entityType, entityId: event.entityId, actorUserId: event.actorUserId, changes: event.payload },
    });
    let responseCode: number | null = null;
    let error: string | null = null;
    try {
      const url = await assertPublicUrl(d.webhook.url, this.env.ALLOW_PRIVATE_NETWORK_TARGETS);
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'user-agent': 'DealFlow-Webhooks/1.0',
          'X-DealFlow-Event': event.type,
          'X-DealFlow-Delivery': d.id,
          [SIGNATURE_HEADER]: signatureHeader(this.box.open(d.webhook.secretEncrypted), body),
        },
        body,
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      responseCode = res.status;
      await res.body?.cancel().catch(() => undefined);
      if (res.status < 200 || res.status >= 300) error = `Endpoint answered ${res.status}`;
    } catch (err) {
      error = errorMessage(err);
    }

    await this.prisma.run(ctx, async (tx) => {
      const attempts = d.attempts + 1;
      // A REST-hook client (Zapier) answers 410 Gone when the Zap was turned off: that subscription ends here.
      if (responseCode === 410 && d.webhook.source === 'zapier') {
        await tx.webhookDelivery.update({ where: { id: d.id }, data: { status: 'FAILED', attempts, responseCode, lastError: 'The Zap was turned off (410 Gone); subscription removed' } });
        await tx.webhook.update({ where: { id: d.webhookId }, data: { active: false, deletedAt: new Date(), disabledReason: 'Removed: Zapier answered 410 Gone' } });
        return;
      }
      if (!error) {
        await tx.webhookDelivery.update({ where: { id: d.id }, data: { status: 'SUCCEEDED', attempts, responseCode, lastError: null, deliveredAt: new Date() } });
        await tx.webhook.update({ where: { id: d.webhookId }, data: { consecutiveFailures: 0 } });
        return;
      }
      const final = attempts >= this.env.WEBHOOK_MAX_ATTEMPTS;
      await tx.webhookDelivery.update({
        where: { id: d.id },
        data: { status: final ? 'FAILED' : 'PENDING', attempts, responseCode, lastError: error, nextAttemptAt: new Date(Date.now() + retryDelayMs(attempts)) },
      });
      const hook = await tx.webhook.update({ where: { id: d.webhookId }, data: { consecutiveFailures: { increment: 1 } } });
      if (hook.active && hook.consecutiveFailures >= this.env.WEBHOOK_DISABLE_AFTER_FAILURES) {
        await tx.webhook.update({
          where: { id: hook.id },
          data: { active: false, disabledReason: `Switched off after ${hook.consecutiveFailures} failed deliveries in a row. Last error: ${error}` },
        });
        await this.notifications.send(tx, tenantId, [hook.createdById, ...(await this.notifications.usersWithPermission(tx, tenantId, 'integrations:manage'))], {
          type: 'webhook.disabled',
          title: 'A webhook was switched off',
          body: `${hook.url} failed ${hook.consecutiveFailures} times in a row.`,
          link: '/app/integrations',
        });
      }
    });
  }
}
