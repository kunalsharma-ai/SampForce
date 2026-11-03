import { Inject, Injectable, Logger } from '@nestjs/common';
import { API_ENV, type ApiEnv } from './env';
import { PrismaService } from './prisma.service';
import { fingerprintOf } from './provider-keys';

/** Deployment-wide webhooks whose signing secret is entered in the operator console (ADR 0053). */
export const RECEIPT_PROVIDERS = ['stripe', 'razorpay', 'zoom', 'docusign'] as const;
export type ReceiptProvider = (typeof RECEIPT_PROVIDERS)[number];

export const WEBHOOK_RECEIPT_PREFIX = 'webhook_receipt:';

/** The secret each provider signs its events with. A receipt made under another secret no longer proves the current one. */
export const RECEIPT_SECRET = {
  stripe: 'STRIPE_WEBHOOK_SECRET',
  razorpay: 'RAZORPAY_WEBHOOK_SECRET',
  zoom: 'ZOOM_WEBHOOK_SECRET_TOKEN',
  docusign: 'DOCUSIGN_CONNECT_HMAC_KEY',
} as const satisfies Record<ReceiptProvider, keyof ApiEnv>;

/** Fingerprint of the signing secret set now, or null when none is set. */
export function receiptKey(env: ApiEnv, provider: ReceiptProvider): string | null {
  const secret = env[RECEIPT_SECRET[provider]];
  return secret ? fingerprintOf(secret) : null;
}

export interface WebhookReceipt {
  /** The last event whose signature matched the secret set now: the proof that the secret and the URL are right. */
  lastVerified: { at: string; event: string; key: string | null } | null;
  /** The last event refused because its signature did not match: usually a wrong or old signing secret. */
  lastRejected: { at: string; reason: string } | null;
}

export function readReceipt(raw: string | null | undefined): WebhookReceipt {
  try {
    const v = raw ? (JSON.parse(raw) as Partial<WebhookReceipt>) : {};
    return { lastVerified: v.lastVerified ?? null, lastRejected: v.lastRejected ?? null };
  } catch {
    return { lastVerified: null, lastRejected: null };
  }
}

/** Writes about the same outcome at most this often per process, so a burst of events costs one row update. */
const MIN_INTERVAL_MS = 30_000;

/**
 * Remembers when each provider last sent a signed event, so the operator console can show that a webhook secret and
 * URL work (or that events arrive but the secret is wrong) without anyone reading logs. Only the time, the event type
 * and the reason are kept: never the body, a header or a secret. Recording never fails the webhook itself.
 */
@Injectable()
export class WebhookReceipts {
  private readonly log = new Logger(WebhookReceipts.name);
  private readonly lastWrite = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  verified(provider: ReceiptProvider, event: string): Promise<void> {
    const key = receiptKey(this.env, provider);
    return this.write(provider, `verified:${key}`, (r) => ({ ...r, lastVerified: { at: new Date().toISOString(), event: event.slice(0, 80), key } }));
  }

  rejected(provider: ReceiptProvider, reason: string): Promise<void> {
    return this.write(provider, 'rejected', (r) => ({ ...r, lastRejected: { at: new Date().toISOString(), reason: reason.slice(0, 200) } }));
  }

  private async write(provider: ReceiptProvider, kind: string, next: (r: WebhookReceipt) => WebhookReceipt): Promise<void> {
    const throttle = `${provider}:${kind}`;
    const now = Date.now();
    if (now - (this.lastWrite.get(throttle) ?? 0) < MIN_INTERVAL_MS) return;
    this.lastWrite.set(throttle, now);
    const key = WEBHOOK_RECEIPT_PREFIX + provider;
    try {
      const row = await this.prisma.platformSetting.findUnique({ where: { key } });
      const value = JSON.stringify(next(readReceipt(row?.value)));
      await this.prisma.platformSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
    } catch (err) {
      this.log.warn({ provider, err: err instanceof Error ? err.message : String(err) }, 'Could not record a webhook receipt');
    }
  }
}
