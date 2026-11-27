import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { Dialer, Prisma, TenantTx } from '@dealflow/database';
import {
  type DialerConfig,
  type DialerInput,
  type DialerLogRow,
  type DialerRow,
  DIALER_PRESETS,
  DIALER_SECRETS,
  type DialerSecret,
  type DialerSettings,
  type DialerTestResult,
  dialerConfigSchema,
  e164,
  providerOf,
  type RecordingPolicy,
  recordingPolicySchema,
} from '@dealflow/types';
import { AuditService } from '../audit/audit.service';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { SECRET_BOX, type SecretBox } from '../common/crypto';
import { API_ENV, type ApiEnv } from '../common/env';
import { assertPublicUrl, publicFetch, UnsafeTargetError } from '../common/net-guard';
import { PrismaService } from '../common/prisma.service';
import type { TwilioKeys } from '../apps/twilio';
import { configOf, type DialContext, DialerAdapters, type LogFn, signWebhook } from './dialer-adapters';

export const PHONE_APP = DIALER_PRESETS[0];
export const callError = (message: string) => new BadRequestException({ code: 'CALL_ERROR', message });

/** Kinds people can add now. SIP (browser phone) and SIM (phone app) come with part 2 of ADR 0089. */
export const ADDABLE_KINDS = new Set(['LINK', 'API', 'TWILIO']);

/** A sample call, for testing a dialer without calling anyone. */
const SAMPLE = { phone: '+44 20 7946 0018', phoneE164: '+442079460018', phoneDigits: '442079460018', phoneNational: '2079460018', companyName: 'Sample Company', companyPhone: '+44 20 7946 0000', employeeName: 'Sam Sample', designation: 'Buyer', email: 'sam@example.com', employeePhone: '+44 20 7946 0018', callId: '00000000-0000-4000-8000-000000000000', companyUrl: null, providerCallId: 'sample' };

/**
 * Dialers (ADR 0088, universal dialer ADR 0089): each person's dialers with their settings, sealed secrets, connection
 * status, test and integration log. Placing calls goes through the adapters (dialer-adapters.ts).
 */
@Injectable()
export class DialersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    readonly adapters: DialerAdapters,
    @Inject(SECRET_BOX) private readonly box: SecretBox,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  settings(auth: AuthContext): Promise<DialerSettings> {
    return this.prisma.run(auth, async (tx) => {
      const [rows, tw, policy] = await Promise.all([
        tx.dialer.findMany({ where: { tenantId: auth.tenantId, userId: auth.userId, deletedAt: null }, orderBy: { createdAt: 'asc' } }),
        this.twilioConnection(tx, auth.tenantId),
        this.policyIn(tx, auth.tenantId),
      ]);
      return {
        dialers: rows.map((d) => this.row(d, null)),
        builtIn: { name: PHONE_APP.name, urlTemplate: PHONE_APP.urlTemplate },
        twilio: { connected: !!tw, fromNumber: tw?.fromNumber ?? null },
        devices: [],
        recordingPolicy: policy,
      };
    });
  }

  async createDialer(auth: AuthContext, input: DialerInput, meta: RequestMeta): Promise<DialerRow> {
    if (!ADDABLE_KINDS.has(input.kind)) throw callError('This kind of dialer is not available yet.');
    const webhookUrl = await this.checkedUrl(input.webhookUrl, 'webhook');
    const config = await this.checkedConfig(input);
    const secret = webhookUrl ? randomBytes(24).toString('base64url') : null;
    return this.prisma.run(auth, async (tx) => {
      if (input.kind === 'TWILIO' && !(await this.twilioConnection(tx, auth.tenantId))) throw callError('Twilio is not connected. A workspace admin can connect it in Integrations.');
      const count = await tx.dialer.count({ where: { tenantId: auth.tenantId, userId: auth.userId, deletedAt: null } });
      if (count >= 20) throw callError('You can keep up to 20 dialers. Remove one first.');
      const isDefault = input.isDefault ?? count === 0;
      if (isDefault) await tx.dialer.updateMany({ where: { tenantId: auth.tenantId, userId: auth.userId, deletedAt: null }, data: { isDefault: false } });
      const row = await tx.dialer.create({
        data: {
          tenantId: auth.tenantId,
          userId: auth.userId,
          name: input.name,
          kind: input.kind,
          provider: input.provider ?? null,
          urlTemplate: input.kind === 'LINK' ? config.urlTemplate : null,
          webhookUrl,
          webhookSecretEncrypted: secret ? this.box.seal(secret) : null,
          agentPhone: input.kind === 'TWILIO' ? e164(config.agentPhone) : (config.agentPhone ?? null),
          config: config as unknown as Prisma.InputJsonValue,
          secretsEncrypted: this.sealSecrets({}, input.secrets),
          eventsHookId: randomBytes(12).toString('hex'),
          eventsTokenEncrypted: this.box.seal(randomBytes(24).toString('base64url')),
          status: 'UNTESTED',
          active: input.active ?? true,
          isDefault,
        },
      });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'dialer.created', entityType: 'dialer', entityId: row.id, metadata: { kind: row.kind, provider: row.provider, webhook: !!webhookUrl }, meta });
      return this.row(row, secret);
    });
  }

  async updateDialer(auth: AuthContext, id: string, input: DialerInput, meta: RequestMeta): Promise<DialerRow> {
    const webhookUrl = await this.checkedUrl(input.webhookUrl, 'webhook');
    const config = await this.checkedConfig(input);
    return this.prisma.run(auth, async (tx) => {
      const before = await this.own(tx, auth, id);
      if (input.kind !== before.kind && !ADDABLE_KINDS.has(input.kind)) throw callError('This kind of dialer is not available yet.');
      if (input.kind === 'TWILIO' && !(await this.twilioConnection(tx, auth.tenantId))) throw callError('Twilio is not connected. A workspace admin can connect it in Integrations.');
      // A webhook keeps its secret while it stays set; a new webhook gets a new one, shown once.
      const secret = webhookUrl && !before.webhookSecretEncrypted ? randomBytes(24).toString('base64url') : null;
      if (input.isDefault) await tx.dialer.updateMany({ where: { tenantId: auth.tenantId, userId: auth.userId, deletedAt: null, id: { not: id } }, data: { isDefault: false } });
      const row = await tx.dialer.update({
        where: { id },
        data: {
          name: input.name,
          kind: input.kind,
          provider: input.provider ?? before.provider,
          urlTemplate: input.kind === 'LINK' ? config.urlTemplate : null,
          webhookUrl,
          webhookSecretEncrypted: webhookUrl ? (secret ? this.box.seal(secret) : before.webhookSecretEncrypted) : null,
          agentPhone: input.kind === 'TWILIO' ? e164(config.agentPhone) : (config.agentPhone ?? null),
          config: config as unknown as Prisma.InputJsonValue,
          secretsEncrypted: this.sealSecrets(this.secretsOf(before), input.secrets),
          // New settings: the last test no longer says anything about them.
          status: 'UNTESTED',
          statusAt: null,
          statusMessage: null,
          oauthTokenEncrypted: null,
          oauthExpiresAt: null,
          ...(input.active !== undefined ? { active: input.active } : {}),
          ...(input.isDefault !== undefined ? { isDefault: input.isDefault || before.isDefault } : {}),
          eventsHookId: before.eventsHookId ?? randomBytes(12).toString('hex'),
          eventsTokenEncrypted: before.eventsTokenEncrypted ?? this.box.seal(randomBytes(24).toString('base64url')),
        },
      });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'dialer.updated', entityType: 'dialer', entityId: id, metadata: { kind: row.kind, provider: row.provider, webhook: !!webhookUrl, secrets: Object.keys(input.secrets ?? {}) }, meta });
      return this.row(row, secret);
    });
  }

  /** Switches a dialer on or off. An inactive dialer is kept with its settings but cannot place calls. */
  setActive(auth: AuthContext, id: string, active: boolean, meta: RequestMeta): Promise<DialerRow> {
    return this.prisma.run(auth, async (tx) => {
      const d = await this.own(tx, auth, id);
      const row = await tx.dialer.update({ where: { id }, data: { active, ...(active ? {} : { isDefault: false }) } });
      if (!active && d.isDefault) await this.promoteNextDefault(tx, auth, id);
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: active ? 'dialer.activated' : 'dialer.deactivated', entityType: 'dialer', entityId: id, meta });
      return this.row(row, null);
    });
  }

  makeDefault(auth: AuthContext, id: string, meta: RequestMeta): Promise<DialerRow> {
    return this.prisma.run(auth, async (tx) => {
      const d = await this.own(tx, auth, id);
      if (!d.active) throw callError('Switch the dialer on first.');
      await tx.dialer.updateMany({ where: { tenantId: auth.tenantId, userId: auth.userId, deletedAt: null }, data: { isDefault: false } });
      const row = await tx.dialer.update({ where: { id }, data: { isDefault: true } });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'dialer.default', entityType: 'dialer', entityId: id, meta });
      return this.row(row, null);
    });
  }

  /** A new webhook signing secret, shown once. */
  renewSecret(auth: AuthContext, id: string, meta: RequestMeta): Promise<DialerRow> {
    return this.prisma.run(auth, async (tx) => {
      const d = await this.own(tx, auth, id);
      if (!d.webhookUrl) throw callError('This dialer has no webhook.');
      const secret = randomBytes(24).toString('base64url');
      const row = await tx.dialer.update({ where: { id }, data: { webhookSecretEncrypted: this.box.seal(secret) } });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'dialer.secret_renewed', entityType: 'dialer', entityId: id, meta });
      return this.row(row, secret);
    });
  }

  /** A new events address: the old one stops working at once. */
  renewEvents(auth: AuthContext, id: string, meta: RequestMeta): Promise<DialerRow> {
    return this.prisma.run(auth, async (tx) => {
      await this.own(tx, auth, id);
      const row = await tx.dialer.update({ where: { id }, data: { eventsHookId: randomBytes(12).toString('hex'), eventsTokenEncrypted: this.box.seal(randomBytes(24).toString('base64url')) } });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'dialer.events_renewed', entityType: 'dialer', entityId: id, meta });
      return this.row(row, null);
    });
  }

  removeDialer(auth: AuthContext, id: string, meta: RequestMeta): Promise<void> {
    return this.prisma.run(auth, async (tx) => {
      const d = await this.own(tx, auth, id);
      await tx.dialer.update({ where: { id }, data: { deletedAt: new Date(), isDefault: false, secretsEncrypted: null, oauthTokenEncrypted: null, eventsHookId: null } });
      if (d.isDefault) await this.promoteNextDefault(tx, auth, id);
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'dialer.deleted', entityType: 'dialer', entityId: id, meta });
    });
  }

  /** Tests the connection without calling anyone, and keeps the result as the dialer's status. */
  async test(auth: AuthContext, id: string, meta: RequestMeta): Promise<DialerTestResult> {
    const ctx = await this.prisma.run(auth, async (tx) => ({ ...(await this.context(tx, await this.own(tx, auth, id))), me: await tx.user.findUnique({ where: { id: auth.userId }, select: { name: true, email: true } }) }));
    const values = this.values(ctx, SAMPLE, ctx.me);
    const log = this.logger(ctx.dialer, null);
    const adapter = this.adapters.for(ctx.dialer.kind);
    const result = await adapter.test({ ...ctx, call: null, values, record: false, log } as never);
    // The webhook, when set, is tested too: a signed dialer.test event.
    if (ctx.dialer.webhookUrl && ctx.dialer.webhookSecretEncrypted) {
      const r = await this.postWebhook(ctx.dialer, 'dialer.test', { event: 'dialer.test', dialer: { id: ctx.dialer.id, name: ctx.dialer.name }, sample: SAMPLE }, null);
      result.steps.push({ label: 'The webhook answered', ok: r.ok, detail: r.error });
      if (!r.ok && result.status === 'NOT_TESTABLE') Object.assign(result, { ok: false, status: 'FAILED', message: r.error ?? 'The webhook did not answer.' });
    }
    await this.prisma.run(auth, async (tx) => {
      await tx.dialer.update({ where: { id }, data: { status: result.status, statusAt: new Date(), statusMessage: result.message.slice(0, 500) } });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'dialer.tested', entityType: 'dialer', entityId: id, metadata: { status: result.status }, meta });
    });
    await log({ action: 'TEST', ok: result.ok, message: result.message });
    return result;
  }

  logs(auth: AuthContext, id: string): Promise<DialerLogRow[]> {
    return this.prisma.run(auth, async (tx) => {
      await this.own(tx, auth, id);
      const rows = await tx.dialerLog.findMany({ where: { tenantId: auth.tenantId, dialerId: id }, orderBy: { createdAt: 'desc' }, take: 100 });
      return rows.map((r) => ({ id: r.id, action: r.action as DialerLogRow['action'], ok: r.ok, httpStatus: r.httpStatus, message: r.message, callId: r.callId, attempt: r.attempt, durationMs: r.durationMs, at: r.createdAt.toISOString() }));
    });
  }

  // ─── Workspace recording policy ───

  policy(auth: AuthContext): Promise<RecordingPolicy> {
    return this.prisma.run(auth, (tx) => this.policyIn(tx, auth.tenantId));
  }

  async policyIn(tx: TenantTx, tenantId: string): Promise<RecordingPolicy> {
    const s = await tx.callSettings.findUnique({ where: { tenantId } });
    return recordingPolicySchema.parse(s?.recordingPolicy ?? {});
  }

  setPolicy(auth: AuthContext, input: RecordingPolicy, meta: RequestMeta): Promise<RecordingPolicy> {
    return this.prisma.run(auth, async (tx) => {
      const policy = recordingPolicySchema.parse(input);
      await tx.callSettings.upsert({ where: { tenantId: auth.tenantId }, create: { tenantId: auth.tenantId, recordingPolicy: policy, updatedById: auth.userId }, update: { recordingPolicy: policy, updatedById: auth.userId } });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'calls.recording_policy', entityType: 'call_settings', entityId: auth.tenantId, metadata: policy, meta });
      return policy;
    });
  }

  // ─── For placing calls ───

  /** Everything an adapter needs about a dialer: its settings, opened secrets and the Twilio keys when it uses them. */
  async context(tx: TenantTx, dialer: Dialer): Promise<Pick<DialContext, 'dialer' | 'config' | 'secrets'> & { twilio: TwilioKeys | null; statusCallback: string | null; eventsUrl: string | null }> {
    const twilio = dialer.kind === 'TWILIO' ? await this.twilioConnection(tx, dialer.tenantId) : null;
    return { dialer, config: configOf(dialer), secrets: this.secretsOf(dialer), twilio: twilio?.keys ?? null, statusCallback: null, eventsUrl: this.eventsUrl(dialer) };
  }

  /** The {placeholder} values for a call. */
  values(ctx: { dialer: Dialer; config: DialerConfig; eventsUrl: string | null }, call: Record<string, string | null>, me: { name: string | null; email: string | null } | null, callerId?: string | null): Record<string, string | null> {
    const c = ctx.config;
    // Providers want numbers as +<digits>; an extension (no +) is sent as written.
    const plain = (n: string | null | undefined) => (n && /^\s*\+/.test(n) ? (e164(n) ?? n) : (n ?? null));
    return {
      ...Object.fromEntries(c.customParams.map((p) => [p.key, p.value])),
      ...call,
      agentPhone: plain(c.agentPhone ?? ctx.dialer.agentPhone),
      extension: c.extension ?? null,
      callerId: plain(callerId ?? c.callerIds[0] ?? null),
      account: c.account ?? null,
      callerName: me?.name ?? null,
      callerEmail: me?.email ?? null,
      eventsUrl: ctx.eventsUrl,
      recordFlag: c.recording === 'ALWAYS' ? 'true' : 'false',
    };
  }

  /** Writes to the dialer's integration log (kept for 100 entries' worth of reading; older ones stay for audit). */
  logger(dialer: Dialer, callId: string | null): LogFn {
    return async (e) => {
      await this.prisma
        .run({ tenantId: dialer.tenantId }, (tx) => tx.dialerLog.create({ data: { tenantId: dialer.tenantId, dialerId: dialer.id, callId, action: e.action, ok: e.ok, httpStatus: e.httpStatus ?? null, message: e.message.slice(0, 500), attempt: e.attempt ?? 1, durationMs: e.durationMs ?? null } }))
        .catch(() => undefined);
    };
  }

  async setStatus(dialer: Dialer, ok: boolean, message: string): Promise<void> {
    await this.prisma.run({ tenantId: dialer.tenantId }, (tx) => tx.dialer.update({ where: { id: dialer.id }, data: { status: ok ? 'CONNECTED' : 'FAILED', statusAt: new Date(), statusMessage: message.slice(0, 500) } })).catch(() => undefined);
  }

  async postWebhook(dialer: Dialer, event: string, payload: object, callId: string | null): Promise<{ ok: boolean; error: string | null }> {
    const body = JSON.stringify(payload);
    const log = this.logger(dialer, callId);
    try {
      const url = await assertPublicUrl(dialer.webhookUrl!, this.env.ALLOW_PRIVATE_NETWORK_TARGETS);
      const res = await publicFetch(
        url,
        { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'SampForce-Calls/1.0', 'X-SampForce-Signature': signWebhook(this.box.open(dialer.webhookSecretEncrypted!), body), 'X-SampForce-Event': event }, body, redirect: 'manual', signal: AbortSignal.timeout(8_000) },
        this.env.ALLOW_PRIVATE_NETWORK_TARGETS,
      );
      const ok = res.status >= 200 && res.status < 300;
      await log({ action: 'WEBHOOK', ok, httpStatus: res.status, message: ok ? `Webhook ${event} delivered.` : `Your dialer answered ${res.status}.` });
      return ok ? { ok: true, error: null } : { ok: false, error: `Your dialer answered ${res.status}.` };
    } catch (e) {
      const error = e instanceof UnsafeTargetError ? e.message : 'Your dialer could not be reached.';
      await log({ action: 'WEBHOOK', ok: false, message: error });
      return { ok: false, error };
    }
  }

  eventsUrl(d: Dialer): string | null {
    if (!d.eventsHookId || !d.eventsTokenEncrypted || (d.kind !== 'API' && d.kind !== 'LINK')) return null;
    return `${this.env.PUBLIC_WEB_URL.replace(/\/$/, '')}/api/v1/calls/events/${d.eventsHookId}/${this.box.open(d.eventsTokenEncrypted)}`;
  }

  /** Opens a value sealed with the workspace's encryption key. */
  open(sealed: string): string {
    return this.box.open(sealed);
  }

  webUrl(): string {
    return this.env.PUBLIC_WEB_URL.replace(/\/$/, '');
  }

  statusUrl(hookId: string, callId: string): string {
    return `${this.env.PUBLIC_WEB_URL.replace(/\/$/, '')}/api/v1/calls/twilio/${hookId}/${callId}`;
  }

  async twilioConnection(tx: TenantTx, tenantId: string): Promise<{ hookId: string; fromNumber: string; keys: TwilioKeys } | null> {
    const conn = await tx.appConnection.findUnique({ where: { tenantId_provider: { tenantId, provider: 'TWILIO' } } });
    if (!conn || conn.status !== 'CONNECTED' || !conn.externalAccountId) return null;
    const keys = JSON.parse(this.box.open(conn.credentialsEncrypted)) as TwilioKeys;
    return { hookId: conn.externalAccountId, fromNumber: keys.fromNumber, keys };
  }

  async own(tx: TenantTx, auth: AuthContext, id: string): Promise<Dialer> {
    const d = await tx.dialer.findFirst({ where: { id, tenantId: auth.tenantId, userId: auth.userId, deletedAt: null } });
    if (!d) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Dialer not found.' });
    return d;
  }

  secretsOf(d: Dialer): Partial<Record<DialerSecret, string>> {
    if (!d.secretsEncrypted) return {};
    try {
      return JSON.parse(this.box.open(d.secretsEncrypted)) as Partial<Record<DialerSecret, string>>;
    } catch {
      return {};
    }
  }

  row(d: Dialer, webhookSecret: string | null): DialerRow {
    const config = configOf(d);
    const secrets = this.secretsOf(d);
    const provider = providerOf(d);
    return {
      id: d.id,
      name: d.name,
      kind: d.kind as DialerRow['kind'],
      provider: d.provider ?? provider.key,
      urlTemplate: d.urlTemplate,
      webhookUrl: d.webhookUrl,
      webhookSecret,
      hasWebhookSecret: !!d.webhookSecretEncrypted,
      agentPhone: d.agentPhone,
      config,
      secretsSaved: Object.fromEntries(DIALER_SECRETS.map((k) => [k, !!secrets[k]])) as DialerRow['secretsSaved'],
      eventsUrl: this.eventsUrl(d),
      capabilities: this.adapters.for(d.kind).capabilities(d, config),
      status: d.status as DialerRow['status'],
      statusAt: d.statusAt?.toISOString() ?? null,
      statusMessage: d.statusMessage,
      device: null,
      active: d.active,
      isDefault: d.isDefault,
      lastUsedAt: d.lastUsedAt?.toISOString() ?? null,
      createdAt: d.createdAt.toISOString(),
    };
  }

  // ─── Helpers ───

  private async promoteNextDefault(tx: TenantTx, auth: AuthContext, exceptId: string): Promise<void> {
    const next = await tx.dialer.findFirst({ where: { tenantId: auth.tenantId, userId: auth.userId, deletedAt: null, active: true, id: { not: exceptId } }, orderBy: { createdAt: 'asc' } });
    if (next) await tx.dialer.update({ where: { id: next.id }, data: { isDefault: true } });
  }

  private sealSecrets(before: Partial<Record<DialerSecret, string>>, input: DialerInput['secrets']): string | null {
    const next: Partial<Record<DialerSecret, string>> = { ...before };
    for (const k of DIALER_SECRETS) {
      const v = input?.[k];
      if (v === null) delete next[k];
      else if (typeof v === 'string' && v.trim()) next[k] = v.trim();
    }
    return Object.keys(next).length ? this.box.seal(JSON.stringify(next)) : null;
  }

  private async checkedConfig(input: DialerInput): Promise<DialerConfig> {
    const config = dialerConfigSchema.parse({ ...(input.config ?? {}), urlTemplate: input.urlTemplate ?? input.config?.urlTemplate ?? null, agentPhone: input.agentPhone ?? input.config?.agentPhone ?? null });
    if (input.kind !== 'LINK') config.urlTemplate = null;
    if (input.kind === 'API') {
      await this.checkedUrl(config.apiBaseUrl, 'API');
      if (config.tokenUrl) await this.checkedUrl(config.tokenUrl, 'token');
    }
    return config;
  }

  private async checkedUrl(url: string | null | undefined, what: 'webhook' | 'API' | 'token'): Promise<string | null> {
    if (!url) return null;
    try {
      return (await assertPublicUrl(url, this.env.ALLOW_PRIVATE_NETWORK_TARGETS)).toString().replace(/\/$/, what === 'API' ? '' : '/');
    } catch (e) {
      const name = what === 'webhook' ? 'webhook' : what === 'API' ? 'API' : 'token';
      if (e instanceof UnsafeTargetError) throw callError(`The ${name} address cannot be used: ${e.message}`);
      throw callError(`The ${name} address is not a valid web address.`);
    }
  }
}
