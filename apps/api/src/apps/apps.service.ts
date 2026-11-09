import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { type AppConnection, type AppProvider, Prisma, type TenantTx, transactionLock } from '@dealflow/database';
import { APP_FEATURES, APP_KEYS, type AppEventRow, type AppKey, type AppStatus, type SlackChannel, type SlackSettings, type TeamsAddChannelInput, type TeamsChannel, type TeamsSettings } from '@dealflow/types';
import { AuditService } from '../audit/audit.service';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { SECRET_BOX, type SecretBox, signToken, verifyToken } from '../common/crypto';
import { API_ENV, type ApiEnv } from '../common/env';
import { hasFeature } from '../billing/entitlements';
import { PrismaService } from '../common/prisma.service';
import { SlackClient, SlackError } from './slack';
import { TeamsClient, TeamsError, type TeamsMessage } from './teams';
import { DocusignClient } from './docusign';
import { ZoomClient } from './zoom';

interface AppState {
  t: string;
  u: string;
  a: AppKey;
  n: string;
  exp: number;
}

/** Zoom: OAuth tokens. Zoom rotates the refresh token on every refresh. */
export interface StoredZoom {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  userId: string;
  email: string;
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

interface StoredSlack {
  accessToken: string;
  botUserId: string | null;
}

/** Teams: each channel's Workflows URL, by SampForce channel id. The URL is the secret. */
interface StoredTeams {
  webhooks: Record<string, string>;
}

const TEAMS_MAX_CHANNELS = 20;

const META: Record<AppKey, { name: string; description: string; provider: AppProvider }> = {
  slack: { name: 'Slack', description: 'Post deal, lead and task updates to Slack channels from workflows.', provider: 'SLACK' },
  payments: { name: 'Card payments', description: 'Let customers pay accepted proposals by card, into your own Stripe or Razorpay account.', provider: 'PAYMENTS' },
  docusign: { name: 'DocuSign', description: 'Send contracts for e-signature; a completed envelope marks the contract signed.', provider: 'DOCUSIGN' },
  zoom: { name: 'Zoom', description: 'Schedule Zoom meetings from leads, contacts and deals, and bring recorded meetings’ transcripts into meeting notes.', provider: 'ZOOM' },
  whatsapp: { name: 'WhatsApp Business', description: 'Message contacts on WhatsApp from their record and from approved workflow steps, through your own WhatsApp Business number.', provider: 'WHATSAPP' },
  twilio: { name: 'SMS (Twilio)', description: 'Text contacts from their record and from approved workflow steps, through your own Twilio number. Replies and STOP opt-outs come back to the contact.', provider: 'TWILIO' },
  teams: { name: 'Microsoft Teams', description: 'Post deal, lead and task updates to Teams channels from workflows, through the Teams Workflows app.', provider: 'TEAMS' },
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
    readonly slack: SlackClient,
    readonly teams: TeamsClient,
    readonly zoom: ZoomClient,
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
    return { slack: () => this.slack.missingConfig(), teams: () => [], zoom: () => this.zoom.missingConfig(), docusign: () => this.docusign.missingConfig(), payments: () => [], whatsapp: () => [], twilio: () => [] }[app]();
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
            : key === 'zoom' && !this.zoom.webhookConfigured
              ? ['Transcript import is Pending Configuration: an operator must add ZOOM_WEBHOOK_SECRET_TOKEN and point Zoom’s event subscription at SampForce.']
              : key === 'docusign' && !this.docusign.connectConfigured
                ? ['Signing status updates are Pending Configuration: an operator must add DOCUSIGN_CONNECT_HMAC_KEY. Until then contracts are not marked signed automatically.']
                : key === 'payments' && c && !(c.settings as { lastWebhookAt?: string | null }).lastWebhookAt
                  ? ['No payment confirmation has arrived yet. Add the webhook below in your provider’s dashboard; payments are marked paid only when the provider confirms them.']
                  : key === 'whatsapp' && c && !(c.settings as { lastWebhookAt?: string | null }).lastWebhookAt
                    ? ['Replies and delivery status are Pending Configuration until Meta sends the first signed webhook. Add the callback URL and verify token below in your Meta app.']
                    : key === 'twilio' && c && !(c.settings as { lastWebhookAt?: string | null }).lastWebhookAt
                      ? ['Replies and delivery status are Pending Configuration until Twilio sends the first signed request. Set the inbound URL below as your number’s “A message comes in” webhook.']
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
    if (app === 'teams' || app === 'payments' || app === 'whatsapp' || app === 'twilio') {
      throw new BadRequestException({ code: 'NOT_OAUTH', message: app === 'teams' ? 'Microsoft Teams is connected by adding a channel with its Workflows URL.' : app === 'payments' ? 'Card payments are connected by saving your Stripe or Razorpay keys.' : app === 'twilio' ? 'SMS is connected by saving your Twilio Account SID, Auth Token and number.' : 'WhatsApp Business is connected by saving your Cloud API number id, business account id, access token and App Secret.' });
    }
    const missing = this.missingConfig(app);
    if (missing.length) {
      throw new ConflictException({ code: 'PROVIDER_NOT_CONFIGURED', message: `${META[app].name} is Pending Configuration on this SampForce installation. An operator must add ${missing.join(' and ')}.` });
    }
    const state = signToken(this.stateSecret(), { t: auth.tenantId, u: auth.userId, a: app, n: randomBytes(8).toString('hex'), exp: Date.now() + 10 * 60_000 } satisfies AppState);
    const redirect = this.redirectUri(app);
    return { url: app === 'zoom' ? this.zoom.authorizeUrl(state, redirect) : app === 'docusign' ? this.docusign.authorizeUrl(state, redirect) : this.slack.authorizeUrl(state, redirect) };
  }

  /** The OAuth redirect. The state must have been issued to the same signed-in person in the same workspace. */
  async completeConnect(auth: AuthContext, app: AppKey, code: string, rawState: string, meta: RequestMeta): Promise<void> {
    const state = verifyToken<AppState>(this.stateSecret(), rawState);
    if (app === 'teams' || app === 'payments' || app === 'whatsapp' || app === 'twilio' || !state || state.exp < Date.now() || state.a !== app || state.t !== auth.tenantId || state.u !== auth.userId) {
      throw new BadRequestException({ code: 'OAUTH_STATE_INVALID', message: 'The connect link expired or belongs to another session. Try connecting again.' });
    }
    let install: { accountId: string; accountName: string; scopes: string[]; credentials: StoredSlack | StoredZoom | StoredDocusign };
    if (app === 'docusign') {
      const t = await this.docusign.exchangeCode(code);
      // Learn the account and the API address it lives on (that also proves the token works).
      const a = await this.docusign.account(t.accessToken);
      install = { accountId: a.accountId, accountName: a.accountName, scopes: ['signature', 'extended'], credentials: { accessToken: t.accessToken, refreshToken: t.refreshToken, expiresAt: t.expiresAt, accountId: a.accountId, baseUri: a.baseUri, email: a.userEmail } };
    } else if (app === 'zoom') {
      const t = await this.zoom.exchangeCode(code, this.redirectUri(app));
      // Prove the token works, and learn which Zoom account it belongs to (events are routed by account id).
      const me = await this.zoom.me(t.accessToken);
      install = { accountId: me.accountId, accountName: `Zoom account of ${me.email}`, scopes: t.scopes, credentials: { accessToken: t.accessToken, refreshToken: t.refreshToken, expiresAt: t.expiresAt, userId: me.id, email: me.email } };
    } else {
      const s = await this.slack.exchangeCode(code, this.redirectUri(app));
      // Prove the token works before saving it.
      await this.slack.authTest(s.accessToken);
      install = { accountId: s.teamId, accountName: s.teamName, scopes: s.scopes, credentials: { accessToken: s.accessToken, botUserId: s.botUserId } };
    }
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
    if (app === 'slack' || app === 'zoom') {
      try {
        const token = (JSON.parse(this.box.open(conn.credentialsEncrypted)) as { accessToken: string }).accessToken;
        await (app === 'zoom' ? this.zoom.revoke(token) : this.slack.revoke(token));
      } catch {
        // The token is deleted below either way; the provider may already have revoked it.
      }
    }
    // Teams Workflows URLs cannot be revoked from outside; deleting them here is all SampForce can do, and the
    // Integrations page tells the admin to turn the workflow off in Teams as well.
    await this.prisma.run(auth, async (tx) => {
      await tx.appConnection.delete({ where: { id: conn.id } });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'app.disconnected', entityType: 'app_connection', entityId: conn.id, metadata: { app, account: conn.accountName }, meta });
    });
  }

  async events(auth: AuthContext, app: AppKey): Promise<AppEventRow[]> {
    const rows = await this.prisma.run(auth, (tx) => tx.appEvent.findMany({ where: { tenantId: auth.tenantId, provider: META[app].provider }, orderBy: { createdAt: 'desc' }, take: 50 }));
    return rows.map((r) => ({ id: r.id, kind: r.kind, ok: r.ok, summary: r.summary, externalId: r.externalId, entityType: r.entityType, entityId: r.entityId, createdAt: r.createdAt.toISOString() }));
  }

  // ───── Slack ─────

  async slackChannels(auth: AuthContext): Promise<SlackChannel[]> {
    const conn = await this.requireConnection(auth.tenantId, 'slack');
    return this.guard(auth.tenantId, conn, () => this.slack.listChannels(this.creds(conn).accessToken));
  }

  async slackSettings(auth: AuthContext, settings: SlackSettings, meta: RequestMeta): Promise<AppStatus> {
    const conn = await this.requireConnection(auth.tenantId, 'slack');
    await this.prisma.run(auth, async (tx) => {
      await tx.appConnection.update({ where: { id: conn.id }, data: { settings: settings as Prisma.InputJsonValue } });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'app.settings_changed', entityType: 'app_connection', entityId: conn.id, metadata: { app: 'slack', ...settings }, meta });
    });
    return (await this.status(auth)).find((s) => s.key === 'slack')!;
  }

  /** Posts a message to Slack and records it. `channelId` null means the default channel chosen in Integrations. */
  async postToSlack(
    tenantId: string,
    input: { channelId: string | null; channelName?: string | null; text: string; actorUserId: string | null; entityType?: string | null; entityId?: string | null; source: string },
  ): Promise<{ ts: string; channel: string }> {
    const conn = await this.requireConnection(tenantId, 'slack');
    const settings = conn.settings as Partial<SlackSettings>;
    const channel = input.channelId ?? settings.defaultChannelId ?? null;
    if (!channel) throw new AppError('Choose a Slack channel for this step, or set a default channel in Integrations.');
    const label = input.channelId && input.channelName ? `#${input.channelName}` : channelLabel(channel, settings);
    try {
      const r = await this.guard(tenantId, conn, () => this.slack.postMessage(this.creds(conn).accessToken, channel, input.text));
      await this.recordEvent(tenantId, conn, { kind: 'message.sent', ok: true, externalId: `${r.channel}/${r.ts}`, summary: `Posted to ${label} (${input.source})`, actorUserId: input.actorUserId, entityType: input.entityType, entityId: input.entityId });
      return r;
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Slack could not be reached.';
      await this.recordEvent(tenantId, conn, { kind: 'message.failed', ok: false, externalId: null, summary: `Not posted to ${label}: ${message}`, actorUserId: input.actorUserId, entityType: input.entityType, entityId: input.entityId });
      throw new AppError(message);
    }
  }

  // ───── Microsoft Teams ─────

  /**
   * Adds a channel by its Workflows URL. A welcome card is posted first: the channel is saved only if Teams accepts
   * it, so a listed channel is one that has worked at least once.
   */
  async teamsAddChannel(auth: AuthContext, input: TeamsAddChannelInput, meta: RequestMeta): Promise<AppStatus> {
    const existing = await this.prisma.run(auth, (tx) => tx.appConnection.findUnique({ where: { tenantId_provider: { tenantId: auth.tenantId, provider: 'TEAMS' } } }));
    const stored: StoredTeams = existing ? this.teamsCreds(existing) : { webhooks: {} };
    const settings = existing ? teamsSettings(existing) : { channels: [], defaultChannelId: null };
    const url = input.webhookUrl.trim();
    const dupe = Object.entries(stored.webhooks).find(([, u]) => u === url);
    if (dupe) throw new AppError(`That workflow URL is already added as "${settings.channels.find((c) => c.id === dupe[0])?.name ?? 'another channel'}".`);
    if (settings.channels.length >= TEAMS_MAX_CHANNELS) throw new AppError(`A workspace can add up to ${TEAMS_MAX_CHANNELS} Teams channels.`);
    try {
      await this.teams.post(url, { text: `**SampForce is connected to ${input.name}.** Workflow updates will appear in this channel.`, link: null });
    } catch (e) {
      if (e instanceof TeamsError) throw new AppError(e.message);
      throw e;
    }
    const channel: TeamsChannel = { id: `tc_${randomBytes(6).toString('hex')}`, name: input.name, addedAt: new Date().toISOString(), lastError: null };
    const next: TeamsSettings = { channels: [...settings.channels, channel], defaultChannelId: settings.defaultChannelId ?? channel.id };
    const data = {
      externalAccountId: 'workflows',
      accountName: 'Microsoft Teams',
      scopes: [],
      credentialsEncrypted: this.box.seal(JSON.stringify({ webhooks: { ...stored.webhooks, [channel.id]: url } } satisfies StoredTeams)),
      settings: next as unknown as Prisma.InputJsonValue,
      status: teamsHealthy(next) ? ('CONNECTED' as const) : ('ERROR' as const),
      lastUsedAt: new Date(),
    };
    await this.prisma.run(auth, async (tx) => {
      const row = await tx.appConnection.upsert({
        where: { tenantId_provider: { tenantId: auth.tenantId, provider: 'TEAMS' } },
        create: { tenantId: auth.tenantId, provider: 'TEAMS', connectedById: auth.userId, lastError: null, ...data },
        update: data,
      });
      // The URL itself is a secret: only a short fingerprint goes to the audit log.
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: existing ? 'app.channel_added' : 'app.connected', entityType: 'app_connection', entityId: row.id, metadata: { app: 'teams', channel: channel.name, channelId: channel.id, urlFingerprint: fingerprint(url) }, meta });
    });
    const conn = await this.requireConnection(auth.tenantId, 'teams');
    await this.recordEvent(auth.tenantId, conn, { kind: 'channel.added', ok: true, externalId: channel.id, summary: `Added ${channel.name}; welcome card accepted by Teams`, actorUserId: auth.userId });
    return (await this.status(auth)).find((s) => s.key === 'teams')!;
  }

  async teamsRemoveChannel(auth: AuthContext, channelId: string, meta: RequestMeta): Promise<AppStatus> {
    const conn = await this.requireConnection(auth.tenantId, 'teams');
    const settings = teamsSettings(conn);
    const channel = settings.channels.find((c) => c.id === channelId);
    if (!channel) throw new NotFoundException({ code: 'NOT_FOUND', message: 'That Teams channel is not in this workspace.' });
    const stored = this.teamsCreds(conn);
    delete stored.webhooks[channelId];
    const channels = settings.channels.filter((c) => c.id !== channelId);
    await this.prisma.run(auth, async (tx) => {
      if (channels.length === 0) {
        await tx.appConnection.delete({ where: { id: conn.id } });
        await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'app.disconnected', entityType: 'app_connection', entityId: conn.id, metadata: { app: 'teams', lastChannel: channel.name }, meta });
        return;
      }
      const next: TeamsSettings = { channels, defaultChannelId: settings.defaultChannelId === channelId ? channels[0]!.id : settings.defaultChannelId };
      await tx.appConnection.update({
        where: { id: conn.id },
        data: { settings: next as unknown as Prisma.InputJsonValue, credentialsEncrypted: this.box.seal(JSON.stringify(stored)), status: teamsHealthy(next) ? 'CONNECTED' : 'ERROR', lastError: teamsHealthy(next) ? null : conn.lastError },
      });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'app.channel_removed', entityType: 'app_connection', entityId: conn.id, metadata: { app: 'teams', channel: channel.name, channelId }, meta });
    });
    return (await this.status(auth)).find((s) => s.key === 'teams')!;
  }

  async teamsDefault(auth: AuthContext, defaultChannelId: string | null, meta: RequestMeta): Promise<AppStatus> {
    const conn = await this.requireConnection(auth.tenantId, 'teams');
    const settings = teamsSettings(conn);
    if (defaultChannelId && !settings.channels.some((c) => c.id === defaultChannelId)) throw new AppError('Choose one of the Teams channels added here.');
    await this.prisma.run(auth, async (tx) => {
      await tx.appConnection.update({ where: { id: conn.id }, data: { settings: { ...settings, defaultChannelId } as unknown as Prisma.InputJsonValue } });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'app.settings_changed', entityType: 'app_connection', entityId: conn.id, metadata: { app: 'teams', defaultChannelId }, meta });
    });
    return (await this.status(auth)).find((s) => s.key === 'teams')!;
  }

  /** Posts a card to a Teams channel and records it. `channelId` null means the default channel. */
  async postToTeams(
    tenantId: string,
    input: { channelId: string | null; message: TeamsMessage; actorUserId: string | null; entityType?: string | null; entityId?: string | null; source: string },
  ): Promise<{ channel: string }> {
    const conn = await this.requireConnection(tenantId, 'teams');
    const settings = teamsSettings(conn);
    const id = input.channelId ?? settings.defaultChannelId;
    if (!id) throw new AppError('Choose a Teams channel for this step, or set a default channel in Integrations.');
    const channel = settings.channels.find((c) => c.id === id);
    const url = this.teamsCreds(conn).webhooks[id];
    if (!channel || !url) throw new AppError('That Teams channel was removed. Choose another channel for this step.');
    try {
      await this.teams.post(url, input.message);
    } catch (e) {
      const err = e instanceof TeamsError ? e : null;
      const message = err?.message ?? 'Teams could not be reached.';
      if (err?.revoked) await this.markTeamsChannel(tenantId, conn.id, id, message);
      await this.recordEvent(tenantId, conn, { kind: 'message.failed', ok: false, externalId: id, summary: `Not posted to ${channel.name}: ${message}`, actorUserId: input.actorUserId, entityType: input.entityType, entityId: input.entityId });
      if (err) throw new AppError(message);
      throw e;
    }
    await this.markTeamsChannel(tenantId, conn.id, id, null);
    await this.recordEvent(tenantId, conn, { kind: 'message.sent', ok: true, externalId: id, summary: `Posted to ${channel.name} (${input.source})`, actorUserId: input.actorUserId, entityType: input.entityType, entityId: input.entityId });
    return { channel: channel.name };
  }

  /** Sets or clears one channel's error; the app shows Needs attention while any channel has one. */
  private async markTeamsChannel(tenantId: string, connectionId: string, channelId: string, error: string | null): Promise<void> {
    await this.prisma.run({ tenantId }, async (tx) => {
      await transactionLock(tx, `app_connection:${connectionId}`);
      const conn = await tx.appConnection.findUnique({ where: { id: connectionId } });
      if (!conn) return;
      const s = teamsSettings(conn);
      const next: TeamsSettings = { ...s, channels: s.channels.map((c) => (c.id === channelId ? { ...c, lastError: error } : c)) };
      const broken = next.channels.find((c) => c.lastError);
      await tx.appConnection.update({
        where: { id: connectionId },
        data: { settings: next as unknown as Prisma.InputJsonValue, status: broken ? 'ERROR' : 'CONNECTED', lastError: broken ? `${broken.name}: ${broken.lastError}` : null, ...(error ? {} : { lastUsedAt: new Date() }) },
      });
    });
  }

  private teamsCreds(conn: AppConnection): StoredTeams {
    return JSON.parse(this.box.open(conn.credentialsEncrypted)) as StoredTeams;
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

  /** Runs a provider call; a revoked token marks the connection as needing a reconnect, success clears that. */
  private async guard<T>(tenantId: string, conn: AppConnection, fn: () => Promise<T>): Promise<T> {
    try {
      const out = await fn();
      await this.prisma.run({ tenantId }, (tx) => tx.appConnection.update({ where: { id: conn.id }, data: { status: 'CONNECTED', lastError: null, lastUsedAt: new Date() } }));
      return out;
    } catch (e) {
      if (e instanceof SlackError && e.revoked) {
        await this.prisma.run({ tenantId }, (tx) => tx.appConnection.update({ where: { id: conn.id }, data: { status: 'ERROR', lastError: e.message } }));
      }
      if (e instanceof SlackError) throw new AppError(e.message);
      if (e instanceof Error && e.name === 'TimeoutError') throw new AppError('Slack did not answer in time.');
      throw e;
    }
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

  private creds(conn: AppConnection): StoredSlack {
    return JSON.parse(this.box.open(conn.credentialsEncrypted)) as StoredSlack;
  }

  private stateSecret(): string {
    return `${this.env.JWT_ACCESS_SECRET}:app-oauth-state`;
  }
}

function teamsSettings(conn: AppConnection): TeamsSettings {
  const s = conn.settings as Partial<TeamsSettings>;
  return { channels: (s.channels ?? []).map((c) => ({ ...c, lastError: c.lastError ?? null })), defaultChannelId: s.defaultChannelId ?? null };
}

function teamsHealthy(s: TeamsSettings): boolean {
  return !s.channels.some((c) => c.lastError);
}

function fingerprint(secret: string): string {
  return createHash('sha256').update(secret).digest('hex').slice(0, 12);
}

function channelLabel(id: string, settings: Partial<SlackSettings>): string {
  return id === settings.defaultChannelId && settings.defaultChannelName ? `#${settings.defaultChannelName}` : id;
}
