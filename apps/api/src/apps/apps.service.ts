import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { type AppConnection, type AppProvider, Prisma, type TenantTx } from '@dealflow/database';
import { APP_KEYS, type AppEventRow, type AppKey, type AppStatus, type SlackChannel, type SlackSettings } from '@dealflow/types';
import { AuditService } from '../audit/audit.service';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { SECRET_BOX, type SecretBox, signToken, verifyToken } from '../common/crypto';
import { API_ENV, type ApiEnv } from '../common/env';
import { PrismaService } from '../common/prisma.service';
import { SlackClient, SlackError } from './slack';

interface AppState {
  t: string;
  u: string;
  a: AppKey;
  n: string;
  exp: number;
}

interface StoredSlack {
  accessToken: string;
  botUserId: string | null;
}

const META: Record<AppKey, { name: string; description: string; provider: AppProvider }> = {
  slack: { name: 'Slack', description: 'Post deal, lead and task updates to Slack channels from workflows.', provider: 'SLACK' },
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
    @Inject(SECRET_BOX) private readonly box: SecretBox,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  static parseApp(raw: string): AppKey {
    const key = raw.toLowerCase();
    if (!(APP_KEYS as readonly string[]).includes(key)) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Unknown app.' });
    return key as AppKey;
  }

  private missingConfig(app: AppKey): string[] {
    return { slack: () => this.slack.missingConfig() }[app]();
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
    const missing = this.missingConfig(app);
    if (missing.length) {
      throw new ConflictException({ code: 'PROVIDER_NOT_CONFIGURED', message: `${META[app].name} is Pending Configuration on this DealFlow installation. An operator must add ${missing.join(' and ')}.` });
    }
    const state = signToken(this.stateSecret(), { t: auth.tenantId, u: auth.userId, a: app, n: randomBytes(8).toString('hex'), exp: Date.now() + 10 * 60_000 } satisfies AppState);
    return { url: { slack: () => this.slack.authorizeUrl(state, this.redirectUri(app)) }[app]() };
  }

  /** The OAuth redirect. The state must have been issued to the same signed-in person in the same workspace. */
  async completeConnect(auth: AuthContext, app: AppKey, code: string, rawState: string, meta: RequestMeta): Promise<void> {
    const state = verifyToken<AppState>(this.stateSecret(), rawState);
    if (!state || state.exp < Date.now() || state.a !== app || state.t !== auth.tenantId || state.u !== auth.userId) {
      throw new BadRequestException({ code: 'OAUTH_STATE_INVALID', message: 'The connect link expired or belongs to another session. Try connecting again.' });
    }
    const install = await this.slack.exchangeCode(code, this.redirectUri(app));
    // Prove the token works before saving it.
    await this.slack.authTest(install.accessToken);
    const data = {
      externalAccountId: install.teamId,
      accountName: install.teamName,
      scopes: install.scopes,
      credentialsEncrypted: this.box.seal(JSON.stringify({ accessToken: install.accessToken, botUserId: install.botUserId } satisfies StoredSlack)),
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
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'app.connected', entityType: 'app_connection', entityId: row.id, metadata: { app, account: install.teamName, accountId: install.teamId }, meta });
    });
  }

  async disconnect(auth: AuthContext, app: AppKey, meta: RequestMeta): Promise<void> {
    const conn = await this.prisma.run(auth, (tx) => tx.appConnection.findUnique({ where: { tenantId_provider: { tenantId: auth.tenantId, provider: META[app].provider } } }));
    if (!conn) return;
    try {
      await this.slack.revoke(this.creds(conn).accessToken);
    } catch {
      // The token is deleted below either way; Slack may already have revoked it.
    }
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

  // ───── Shared ─────

  /** Looks up the workspace's connection outside a request (workflow steps run in the worker). */
  async requireConnection(tenantId: string, app: AppKey): Promise<AppConnection> {
    const conn = await this.prisma.run({ tenantId }, (tx) => tx.appConnection.findUnique({ where: { tenantId_provider: { tenantId, provider: META[app].provider } } }));
    if (!conn || conn.status === 'DISCONNECTED') throw new AppError(`${META[app].name} is not connected. A workspace admin can connect it in Integrations.`);
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

  private async recordEvent(
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
          detail: (e.detail ?? Prisma.DbNull) as Prisma.InputJsonValue,
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

function channelLabel(id: string, settings: Partial<SlackSettings>): string {
  return id === settings.defaultChannelId && settings.defaultChannelName ? `#${settings.defaultChannelName}` : id;
}
