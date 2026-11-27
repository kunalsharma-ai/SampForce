import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { type AppConnection, type AppProvider, Prisma, type TenantTx } from '@dealflow/database';
import { APP_FEATURES, APP_KEYS, type AppEventRow, type AppKey, type AppStatus } from '@dealflow/types';
import { AuditService } from '../audit/audit.service';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { SECRET_BOX, type SecretBox, signToken, verifyToken } from '../common/crypto';
import { API_ENV, type ApiEnv } from '../common/env';
import { hasFeature } from '../billing/entitlements';
import { PrismaService } from '../common/prisma.service';
import { DocusignClient } from './docusign';

interface AppState {
  t: string;
  u: string;
  a: AppKey;
  n: string;
  exp: number;
}

/** DocuSign: OAuth tokens and the account's API base URI. */
export interface StoredDocusign {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  accountId: string;
  baseUri: string;
  email: string;
}

const META: Record<AppKey, { name: string; description: string; provider: AppProvider }> = {
  payments: { name: 'Card payments', description: 'Let customers pay accepted proposals by card, into your own Stripe or Razorpay account.', provider: 'PAYMENTS' },
  docusign: { name: 'DocuSign', description: 'Send contracts for e-signature; a completed envelope marks the contract signed.', provider: 'DOCUSIGN' },
  whatsapp: { name: 'WhatsApp Business', description: 'Message contacts on WhatsApp from their record and from approved workflow steps, through your own WhatsApp Business number.', provider: 'WHATSAPP' },
  twilio: { name: 'SMS (Twilio)', description: 'Text contacts from their record and from approved workflow steps, through your own Twilio number. Replies and STOP opt-outs come back to the contact.', provider: 'TWILIO' },
  sampbidx: { name: 'SampBidx', description: 'Send RFQs with their attachments, or the RFQ emails themselves, to your SampBidx bidding tool and follow their status here.', provider: 'SAMPBIDX' },
};

/** Thrown when an app call fails in a way a person must fix; workflow steps fail with this message. */
export class AppError extends Error {}

/**
 * Workspace apps. An admin connects the workspace's account once through the provider's OAuth; the token is sealed
 * with SecretBox and never leaves the server. Every message or call is recorded in app_events and failures mark the
 * connection so the Integrations page can say what to fix.
 */
@Injectable()
export class AppsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    readonly docusign: DocusignClient,
    @Inject(SECRET_BOX) private readonly box: SecretBox,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  static parseApp(raw: string): AppKey {
    const key = raw.toLowerCase();
    if (!(APP_KEYS as readonly string[]).includes(key)) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Unknown app.' });
    return key as AppKey;
  }

  private missingConfig(app: AppKey): string[] {
    return { docusign: () => this.docusign.missingConfig(), payments: () => [], whatsapp: () => [], twilio: () => [], sampbidx: () => [] }[app]();
  }

  redirectUri(app: AppKey): string {
    return `${this.env.PUBLIC_WEB_URL.replace(/\/$/, '')}/api/v1/apps/${app}/callback`;
  }

  async status(auth: AuthContext): Promise<AppStatus[]> {
    return this.prisma.run(auth, async (tx) => {
      const rows = await tx.appConnection.findMany({ where: { tenantId: auth.tenantId } });
      const people = await tx.user.findMany({ where: { id: { in: rows.map((r) => r.connectedById) } }, select: { id: true, name: true } });
      return APP_KEYS.map((key) => {
        const m = META[key];
        const missing = this.missingConfig(key);
        const c = rows.find((r) => r.provider === m.provider && r.status !== 'DISCONNECTED');
        const state: AppStatus['state'] = missing.length ? 'pending_configuration' : !c ? 'not_connected' : c.status === 'ERROR' ? 'error' : 'connected';
        return {
          key,
          name: m.name,
          description: m.description,
          state,
          missingConfig: missing,
          warnings: missing.length
            ? []
            : key === 'docusign' && !this.docusign.connectConfigured
                ? ['Signing status updates are Pending Configuration: an operator must add DOCUSIGN_CONNECT_HMAC_KEY. Until then contracts are not marked signed automatically.']
                : key === 'payments' && c && !(c.settings as { lastWebhookAt?: string | null }).lastWebhookAt
                  ? ['No payment confirmation has arrived yet. Add the webhook below in your provider’s dashboard; payments are marked paid only when the provider confirms them.']
                  : key === 'whatsapp' && c && !(c.settings as { lastWebhookAt?: string | null }).lastWebhookAt
                    ? ['Replies and delivery status are Pending Configuration until Meta sends the first signed webhook. Add the callback URL and verify token below in your Meta app.']
                    : key === 'twilio' && c && !(c.settings as { lastWebhookAt?: string | null }).lastWebhookAt
                      ? ['Replies and delivery status are Pending Configuration until Twilio sends the first signed request. Set the inbound URL below as your number’s “A message comes in” webhook.']
                      : key === 'sampbidx' && c && !(c.settings as { lastCallbackAt?: string | null }).lastCallbackAt
                        ? ['Status updates from SampBidx are Pending Configuration until SampBidx sends the first signed callback. Give SampBidx the callback URL and signing secret below.']
                        : [],
          connection: c
            ? {
                accountName: c.accountName,
                externalAccountId: c.externalAccountId,
                connectedAt: c.createdAt.toISOString(),
                connectedBy: people.find((p) => p.id === c.connectedById)?.name ?? null,
                lastUsedAt: c.lastUsedAt?.toISOString() ?? null,
                lastError: c.lastError,
                settings: c.settings as Record<string, unknown>,
              }
            : null,
        };
      });
    });
  }

  connectUrl(auth: AuthContext, app: AppKey): { url: string } {
    if (app !== 'docusign') {
      throw new BadRequestException({ code: 'NOT_OAUTH', message: app === 'payments' ? 'Card payments are connected by saving your Stripe or Razorpay keys.' : app === 'twilio' ? 'SMS is connected by saving your Twilio Account SID, Auth Token and number.' : app === 'sampbidx' ? 'SampBidx is connected by saving its API address and key.' : 'WhatsApp Business is connected by saving your Cloud API number id, business account id, access token and App Secret.' });
    }
    const missing = this.missingConfig(app);
    if (missing.length) {
      throw new ConflictException({ code: 'PROVIDER_NOT_CONFIGURED', message: `${META[app].name} is Pending Configuration on this SampForce installation. An operator must add ${missing.join(' and ')}.` });
    }
    const state = signToken(this.stateSecret(), { t: auth.tenantId, u: auth.userId, a: app, n: randomBytes(8).toString('hex'), exp: Date.now() + 10 * 60_000 } satisfies AppState);
    const redirect = this.redirectUri(app);
    return { url: this.docusign.authorizeUrl(state, redirect) };
  }

  /** The OAuth redirect. The state must have been issued to the same signed-in person in the same workspace. */
  async completeConnect(auth: AuthContext, app: AppKey, code: string, rawState: string, meta: RequestMeta): Promise<void> {
    const state = verifyToken<AppState>(this.stateSecret(), rawState);
    if (app !== 'docusign' || !state || state.exp < Date.now() || state.a !== app || state.t !== auth.tenantId || state.u !== auth.userId) {
      throw new BadRequestException({ code: 'OAUTH_STATE_INVALID', message: 'The connect link expired or belongs to another session. Try connecting again.' });
    }
    const t = await this.docusign.exchangeCode(code);
    // Learn the account and the API address it lives on (that also proves the token works).
    const a = await this.docusign.account(t.accessToken);
    const install: { accountId: string; accountName: string; scopes: string[]; credentials: StoredDocusign } = { accountId: a.accountId, accountName: a.accountName, scopes: ['signature', 'extended'], credentials: { accessToken: t.accessToken, refreshToken: t.refreshToken, expiresAt: t.expiresAt, accountId: a.accountId, baseUri: a.baseUri, email: a.userEmail } };
    const data = {
      externalAccountId: install.accountId,
      accountName: install.accountName,
      scopes: install.scopes,
      credentialsEncrypted: this.box.seal(JSON.stringify(install.credentials)),
      status: 'CONNECTED' as const,
      lastError: null,
      connectedById: auth.userId,
    };
    await this.prisma.run(auth, async (tx) => {
      const row = await tx.appConnection.upsert({
        where: { tenantId_provider: { tenantId: auth.tenantId, provider: META[app].provider } },
        create: { tenantId: auth.tenantId, provider: META[app].provider, ...data },
        update: data,
      });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'app.connected', entityType: 'app_connection', entityId: row.id, metadata: { app, account: install.accountName, accountId: install.accountId }, meta });
    });
  }

  async disconnect(auth: AuthContext, app: AppKey, meta: RequestMeta): Promise<void> {
    const conn = await this.prisma.run(auth, (tx) => tx.appConnection.findUnique({ where: { tenantId_provider: { tenantId: auth.tenantId, provider: META[app].provider } } }));
    if (!conn) return;
    await this.prisma.run(auth, async (tx) => {
      await tx.appConnection.delete({ where: { id: conn.id } });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'app.disconnected', entityType: 'app_connection', entityId: conn.id, metadata: { app, account: conn.accountName }, meta });
    });
  }

  async events(auth: AuthContext, app: AppKey): Promise<AppEventRow[]> {
    const rows = await this.prisma.run(auth, (tx) => tx.appEvent.findMany({ where: { tenantId: auth.tenantId, provider: META[app].provider }, orderBy: { createdAt: 'desc' }, take: 50 }));
    return rows.map((r) => ({ id: r.id, kind: r.kind, ok: r.ok, summary: r.summary, externalId: r.externalId, entityType: r.entityType, entityId: r.entityId, createdAt: r.createdAt.toISOString() }));
  }

  // ───── Shared ─────

  /** Looks up the workspace's connection outside a request (workflow steps run in the worker). */
  async requireConnection(tenantId: string, app: AppKey): Promise<AppConnection> {
    const conn = await this.prisma.run({ tenantId }, (tx) => tx.appConnection.findUnique({ where: { tenantId_provider: { tenantId, provider: META[app].provider } } }));
    if (!conn || conn.status === 'DISCONNECTED') throw new AppError(`${META[app].name} is not connected. A workspace admin can connect it in Integrations.`);
    // A connected app stops working while the plan leaves it out (ADR 0057); the connection is kept for when it returns.
    if (!(await this.prisma.run({ tenantId }, (tx) => hasFeature(tx, tenantId, APP_FEATURES[app])))) throw new AppError(`${META[app].name} is not included in your plan. A workspace admin can upgrade on the Billing page.`);
    return conn;
  }

  async recordEvent(
    tenantId: string,
    conn: AppConnection,
    e: { kind: string; ok: boolean; externalId: string | null; summary: string; actorUserId: string | null; entityType?: string | null; entityId?: string | null; detail?: object },
  ): Promise<void> {
    await this.prisma.run({ tenantId }, (tx: TenantTx) =>
      tx.appEvent.create({
        data: {
          tenantId,
          connectionId: conn.id,
          provider: conn.provider,
          kind: e.kind,
          ok: e.ok,
          externalId: e.externalId,
          summary: e.summary.slice(0, 500),
          detail: (e.detail ?? null) as Prisma.InputJsonValue,
          entityType: e.entityType ?? null,
          entityId: e.entityId ?? null,
          actorUserId: e.actorUserId,
        },
      }),
    );
  }

  private stateSecret(): string {
    return `${this.env.JWT_ACCESS_SECRET}:app-oauth-state`;
  }
}
