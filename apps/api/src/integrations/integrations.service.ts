import { BadRequestException, ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { type IntegrationConnection, Prisma, type TenantTx } from '@dealflow/database';
import { INTEGRATION_PROVIDERS, type IntegrationProviderKey, type ProviderStatus } from '@dealflow/types';
import { AuditService } from '../audit/audit.service';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { SECRET_BOX, type SecretBox, signToken, verifyToken } from '../common/crypto';
import { API_ENV, type ApiEnv } from '../common/env';
import { PrismaService } from '../common/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { claim, errorMessage } from '../worker/queue';
import { googleAdapter, microsoftAdapter, type ProviderAdapter, ProviderError, ReauthRequiredError, type TokenSet } from './providers';

interface OAuthState {
  t: string;
  u: string;
  p: IntegrationProviderKey;
  n: string;
  exp: number;
}

const SYNC_INTERVAL_MS = 15 * 60_000;
const INITIAL_MAIL_WINDOW_MS = 30 * 86_400_000;
const CALENDAR_PAST_MS = 30 * 86_400_000;
const CALENDAR_FUTURE_MS = 60 * 86_400_000;
const MAX_FAILURES = 5;

export interface SyncResult {
  emails: number;
  meetings: number;
}

@Injectable()
export class IntegrationsService {
  private readonly log = new Logger(IntegrationsService.name);
  readonly adapters: Record<IntegrationProviderKey, ProviderAdapter>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    @Inject(SECRET_BOX) private readonly box: SecretBox,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {
    this.adapters = { GOOGLE: googleAdapter(env), MICROSOFT: microsoftAdapter(env) };
  }

  static parseProvider(raw: string): IntegrationProviderKey {
    const key = raw.toUpperCase();
    if (!(INTEGRATION_PROVIDERS as readonly string[]).includes(key)) {
      throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Unknown provider.', details: [{ path: 'provider', message: 'Use google or microsoft' }] });
    }
    return key as IntegrationProviderKey;
  }

  redirectUri(provider: IntegrationProviderKey): string {
    return `${this.env.PUBLIC_WEB_URL.replace(/\/$/, '')}/api/v1/integrations/${provider.toLowerCase()}/callback`;
  }

  status(auth: AuthContext): Promise<ProviderStatus[]> {
    return this.prisma.run(auth, async (tx) => {
      const conns = await tx.integrationConnection.findMany({ where: { tenantId: auth.tenantId, userId: auth.userId } });
      return INTEGRATION_PROVIDERS.map((key) => {
        const a = this.adapters[key];
        const c = conns.find((x) => x.provider === key && x.status !== 'DISCONNECTED');
        const missing = a.missingConfig();
        return {
          provider: key,
          name: a.name,
          configured: missing.length === 0,
          missingConfig: missing,
          connection: c
            ? { id: c.id, accountEmail: c.accountEmail, status: c.status, lastSyncAt: c.lastSyncAt?.toISOString() ?? null, lastError: c.lastError, scopes: c.scopes }
            : null,
        };
      });
    });
  }

  connectUrl(auth: AuthContext, provider: IntegrationProviderKey): { url: string } {
    const a = this.adapters[provider];
    const missing = a.missingConfig();
    if (missing.length > 0) {
      throw new ConflictException({
        code: 'PROVIDER_NOT_CONFIGURED',
        message: `${a.name} is not set up on this DealFlow installation. An operator must add ${missing.join(' and ')}.`,
      });
    }
    const state = signToken(this.stateSecret(), {
      t: auth.tenantId,
      u: auth.userId,
      p: provider,
      n: randomBytes(8).toString('hex'),
      exp: Date.now() + 10 * 60_000,
    } satisfies OAuthState);
    return { url: a.authorizeUrl(state, this.redirectUri(provider)) };
  }

  /** Completes the OAuth redirect. The state must have been issued to the same signed-in user. */
  async completeConnect(auth: AuthContext, provider: IntegrationProviderKey, code: string, rawState: string, meta: RequestMeta): Promise<void> {
    const state = verifyToken<OAuthState>(this.stateSecret(), rawState);
    if (!state || state.exp < Date.now() || state.p !== provider || state.t !== auth.tenantId || state.u !== auth.userId) {
      throw new BadRequestException({ code: 'OAUTH_STATE_INVALID', message: 'The sign-in link expired or belongs to another session. Try connecting again.' });
    }
    const a = this.adapters[provider];
    const tokens = await a.exchangeCode(code, this.redirectUri(provider));
    const accountEmail = await a.accountEmail(tokens.accessToken);
    await this.prisma.run(auth, async (tx) => {
      const data = {
        accountEmail,
        scopes: tokens.scopes.length ? tokens.scopes : a.scopes,
        credentialsEncrypted: this.box.seal(JSON.stringify(tokens)),
        status: 'CONNECTED' as const,
        lastError: null,
        consecutiveFailures: 0,
        nextSyncAt: new Date(),
      };
      const row = await tx.integrationConnection.upsert({
        where: { tenantId_userId_provider: { tenantId: auth.tenantId, userId: auth.userId, provider } },
        create: { tenantId: auth.tenantId, userId: auth.userId, provider, ...data },
        update: data,
      });
      await this.audit.record(tx, {
        tenantId: auth.tenantId, actorUserId: auth.userId, action: 'integration.connected', entityType: 'integration', entityId: row.id,
        metadata: { provider, accountEmail }, meta,
      });
    });
  }

  /** Removes stored tokens. Emails and meetings already synced stay on their records. */
  disconnect(auth: AuthContext, provider: IntegrationProviderKey, meta: RequestMeta): Promise<void> {
    return this.prisma.run(auth, async (tx) => {
      const row = await tx.integrationConnection.findFirst({ where: { tenantId: auth.tenantId, userId: auth.userId, provider } });
      if (!row || row.status === 'DISCONNECTED') return;
      await tx.integrationConnection.update({ where: { id: row.id }, data: { status: 'DISCONNECTED', credentialsEncrypted: '', lastError: null } });
      await this.audit.record(tx, {
        tenantId: auth.tenantId, actorUserId: auth.userId, action: 'integration.disconnected', entityType: 'integration', entityId: row.id,
        metadata: { provider }, meta,
      });
    });
  }

  async syncForUser(auth: AuthContext, provider: IntegrationProviderKey): Promise<SyncResult> {
    const conn = await this.prisma.run(auth, (tx) =>
      tx.integrationConnection.findFirst({ where: { tenantId: auth.tenantId, userId: auth.userId, provider, status: { not: 'DISCONNECTED' } } }),
    );
    if (!conn) throw new ConflictException({ code: 'NOT_CONNECTED', message: 'Connect this account first.' });
    return this.sync(conn.id, conn.tenantId);
  }

  /** Returns a valid access token for a connection, refreshing and re-sealing it when needed. */
  async accessToken(tx: TenantTx, conn: IntegrationConnection): Promise<string> {
    if (!conn.credentialsEncrypted) throw new ReauthRequiredError('The account is disconnected');
    let tokens = JSON.parse(this.box.open(conn.credentialsEncrypted)) as TokenSet;
    if (tokens.expiresAt - 60_000 < Date.now()) {
      if (!tokens.refreshToken) throw new ReauthRequiredError('No refresh token stored');
      tokens = await this.adapters[conn.provider].refresh(tokens.refreshToken);
      await tx.integrationConnection.update({ where: { id: conn.id }, data: { credentialsEncrypted: this.box.seal(JSON.stringify(tokens)) } });
    }
    return tokens.accessToken;
  }

  /**
   * Pulls new mail and the calendar window for one connection. Only messages and meetings that
   * involve a known contact or lead are stored, so unrelated personal mail never enters the CRM.
   */
  async sync(connectionId: string, tenantId: string): Promise<SyncResult> {
    const ctx = { tenantId };
    try {
      return await this.prisma.run(
        ctx,
        async (tx) => {
          const conn = await tx.integrationConnection.findFirst({ where: { id: connectionId, tenantId } });
          if (!conn || conn.status === 'DISCONNECTED') return { emails: 0, meetings: 0 };
          const adapter = this.adapters[conn.provider];
          const token = await this.accessToken(tx, conn);
          const now = new Date();

          const since = conn.mailCursor ? new Date(Number(conn.mailCursor)) : new Date(now.getTime() - INITIAL_MAIL_WINDOW_MS);
          const messages = await adapter.listMessages(token, since, conn.accountEmail);
          const events = await adapter.listEvents(token, new Date(now.getTime() - CALENDAR_PAST_MS), new Date(now.getTime() + CALENDAR_FUTURE_MS));

          const people = [...new Set([...messages.flatMap((m) => [m.from, ...m.to, ...m.cc]), ...events.flatMap((e) => e.attendees)])].filter(
            (e) => e && e !== conn.accountEmail,
          );
          const matches = await matchPeople(tx, tenantId, people);

          let emails = 0;
          for (const m of messages) {
            const hit = [m.from, ...m.to, ...m.cc].map((e) => matches.get(e)).find(Boolean);
            if (!hit) continue;
            const r = await tx.emailMessage.createMany({
              data: [{
                tenantId,
                connectionId: conn.id,
                providerMessageId: m.providerMessageId,
                threadId: m.threadId,
                direction: m.outbound ? 'OUTBOUND' : 'INBOUND',
                fromAddress: m.from,
                toAddresses: m.to,
                ccAddresses: m.cc,
                subject: m.subject.slice(0, 500),
                snippet: m.snippet?.slice(0, 500) ?? null,
                bodyText: m.bodyText?.slice(0, 100_000) ?? null,
                sentAt: m.sentAt,
                contactId: hit.contactId ?? null,
                leadId: hit.contactId ? null : (hit.leadId ?? null),
              }],
              skipDuplicates: true,
            });
            emails += r.count;
          }

          let meetings = 0;
          for (const e of events) {
            const contactIds = [...new Set(e.attendees.map((a) => matches.get(a)?.contactId).filter((v): v is string => !!v))];
            if (contactIds.length === 0) continue;
            const data = {
              title: e.title.slice(0, 300),
              startsAt: e.startsAt,
              endsAt: e.endsAt,
              location: e.location?.slice(0, 300) ?? null,
              attendees: e.attendees.slice(0, 100),
              organizer: e.organizer,
              canceled: e.canceled,
              contactIds,
            };
            await tx.meeting.upsert({
              where: { connectionId_providerEventId: { connectionId: conn.id, providerEventId: e.providerEventId } },
              create: { tenantId, connectionId: conn.id, providerEventId: e.providerEventId, ...data },
              update: data,
            });
            meetings++;
          }

          const newest = messages.at(-1)?.sentAt;
          await tx.integrationConnection.update({
            where: { id: conn.id },
            data: {
              mailCursor: newest ? String(newest.getTime()) : conn.mailCursor,
              lastSyncAt: now,
              nextSyncAt: new Date(now.getTime() + SYNC_INTERVAL_MS),
              status: 'CONNECTED',
              consecutiveFailures: 0,
              lastError: null,
            },
          });
          return { emails, meetings };
        },
        { timeoutMs: 120_000 },
      );
    } catch (err) {
      await this.recordFailure(connectionId, tenantId, err);
      if (err instanceof ReauthRequiredError) {
        throw new ConflictException({ code: 'REAUTH_REQUIRED', message: 'The provider rejected the saved sign-in. Reconnect the account.' });
      }
      if (err instanceof ProviderError) throw new ConflictException({ code: 'PROVIDER_ERROR', message: err.message });
      throw err;
    }
  }

  /** Worker entry point: syncs connections whose next sync time has passed. */
  async syncDue(limit = 10): Promise<number> {
    const due = await claim<{ id: string; tenant_id: string }>(
      this.prisma,
      Prisma.sql`
        UPDATE integration_connections SET next_sync_at = now() + interval '10 minutes'
        WHERE id IN (
          SELECT id FROM integration_connections WHERE status = 'CONNECTED' AND next_sync_at <= now()
          ORDER BY next_sync_at LIMIT ${limit} FOR UPDATE SKIP LOCKED)
        RETURNING id, tenant_id`,
    );
    for (const c of due) await this.sync(c.id, c.tenant_id).catch(() => undefined);
    return due.length;
  }

  private async recordFailure(connectionId: string, tenantId: string, err: unknown): Promise<void> {
    const reauth = err instanceof ReauthRequiredError;
    await this.prisma.run({ tenantId }, async (tx) => {
      const conn = await tx.integrationConnection.findFirst({ where: { id: connectionId, tenantId } });
      if (!conn) return;
      const failures = conn.consecutiveFailures + 1;
      const giveUp = reauth || failures >= MAX_FAILURES;
      await tx.integrationConnection.update({
        where: { id: conn.id },
        data: {
          consecutiveFailures: failures,
          lastError: reauth ? 'The provider rejected the saved sign-in. Reconnect the account.' : errorMessage(err),
          status: giveUp ? 'ERROR' : conn.status,
          // Back off 15, 30, 60 ... minutes; stop scheduling once the connection needs attention.
          nextSyncAt: new Date(Date.now() + (giveUp ? 365 * 86_400_000 : SYNC_INTERVAL_MS * 2 ** (failures - 1))),
        },
      });
      if (giveUp && conn.status !== 'ERROR') {
        await this.notifications.send(tx, tenantId, [conn.userId], {
          type: 'integration.error',
          title: `Mailbox sync stopped for ${conn.accountEmail}`,
          body: reauth ? 'Reconnect the account to resume syncing.' : 'Syncing failed repeatedly. Check the integration settings.',
          link: '/app/integrations',
        });
      }
    });
    this.log.warn({ connectionId, err: errorMessage(err) }, 'integration sync failed');
  }

  private stateSecret(): string {
    return `${this.env.JWT_ACCESS_SECRET}:oauth-state`;
  }
}

export interface PersonMatch {
  contactId?: string;
  leadId?: string;
}

/** Maps email addresses to contacts (preferred) or open leads in the tenant. */
export async function matchPeople(tx: TenantTx, tenantId: string, emails: string[]): Promise<Map<string, PersonMatch>> {
  const out = new Map<string, PersonMatch>();
  if (emails.length === 0) return out;
  const [contacts, leads] = await Promise.all([
    tx.contact.findMany({ where: { tenantId, deletedAt: null, email: { in: emails, mode: 'insensitive' } }, select: { id: true, email: true } }),
    tx.lead.findMany({ where: { tenantId, deletedAt: null, email: { in: emails, mode: 'insensitive' } }, select: { id: true, email: true } }),
  ]);
  for (const l of leads) if (l.email) out.set(l.email.toLowerCase(), { leadId: l.id });
  for (const c of contacts) if (c.email) out.set(c.email.toLowerCase(), { contactId: c.id });
  return out;
}
