import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type { AppConnection } from '@dealflow/database';
import { OWN_AI_NAMES, type OwnAiKind, type OwnAiSaveInput, type OwnAiStatus, type OwnEmailSaveInput, type OwnEmailStatus, type OwnServerTestResult } from '@dealflow/types';
import { AI_PROVIDER_DEFS, buildOwnProvider, defaultModel, providerOrder } from '../ai/ai-providers';
import { AiProviderFailure } from '../ai/provider';
import { AuditService } from '../audit/audit.service';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { API_ENV, type ApiEnv } from '../common/env';
import { UnsafeTargetError } from '../common/net-guard';
import { explainNetworkError } from '../common/network-error';
import { PrismaService } from '../common/prisma.service';
import { assertWorkspaceUrl, allowedAddresses, workspaceFetch } from '../common/trusted-targets';
import { MailerService } from '../mail/mailer.service';
import { explainSmtpError, type OwnAiSecrets, type OwnAiSettings, type OwnEmailSecrets, type OwnEmailSettings, OwnServersStore } from './own-servers.store';

const bad = (message: string) => new BadRequestException({ code: 'VALIDATION_FAILED', message });
const hint = (key: string | undefined | null) => (key && key.length >= 8 ? key.slice(-4) : null);

/**
 * A workspace's own AI keys or AI server and its own email server (ADR 0068), entered by a workspace admin under
 * Integrations. Keys and passwords are sealed in the database and never sent back; each provider's last success and
 * failure is shown so the admin can see what to fix.
 */
@Injectable()
export class OwnServersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly store: OwnServersStore,
    private readonly mailer: MailerService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  private async who(tenantId: string, row: AppConnection | null): Promise<string | null> {
    if (!row) return null;
    const u = await this.prisma.run({ tenantId }, (tx) => tx.user.findFirst({ where: { id: row.connectedById }, select: { name: true } }));
    return u?.name ?? null;
  }

  // AI ------------------------------------------------------------------------------------------------------------

  async aiStatus(auth: AuthContext): Promise<OwnAiStatus> {
    const row = await this.store.row(auth.tenantId, 'AI');
    const s = row?.settings as unknown as OwnAiSettings | undefined;
    const keys = row ? (this.store.open<OwnAiSecrets>(row).keys ?? {}) : {};
    const providers = (s?.providers ?? []).map((p) => ({
      kind: p.kind,
      name: OWN_AI_NAMES[p.kind],
      model: p.model || defaultModel(this.env, p.kind),
      baseUrl: p.baseUrl,
      keyHint: p.keyHint,
      hasKey: !!keys[p.kind],
      lastOkAt: p.lastOkAt,
      lastError: p.lastError,
    }));
    return {
      configured: providers.length > 0,
      providers,
      useShared: s?.useShared ?? true,
      sharedAvailable: providerOrder(this.env).some((k) => AI_PROVIDER_DEFS[k].configured(this.env)),
      updatedAt: row?.updatedAt.toISOString() ?? null,
      updatedBy: await this.who(auth.tenantId, row),
    };
  }

  async saveAi(auth: AuthContext, input: OwnAiSaveInput, meta: RequestMeta): Promise<OwnAiStatus> {
    const kinds = input.providers.map((p) => p.kind);
    if (new Set(kinds).size !== kinds.length) throw bad('Each provider can be added once.');
    const existing = await this.store.row(auth.tenantId, 'AI');
    const prior = existing?.settings as unknown as OwnAiSettings | undefined;
    const priorKeys = existing ? (this.store.open<OwnAiSecrets>(existing).keys ?? {}) : {};
    const keys: OwnAiSecrets['keys'] = {};
    const providers: OwnAiSettings['providers'] = [];
    for (const p of input.providers) {
      const name = OWN_AI_NAMES[p.kind];
      const key = p.apiKey === undefined || p.apiKey === null ? priorKeys[p.kind] : p.apiKey;
      if (p.kind === 'custom_ai') {
        if (!p.baseUrl) throw bad('Enter the address of your AI server, for example https://ai.example.com/v1.');
        if (!p.model) throw bad('Enter the model your AI server should use, for example llama3.1.');
        try {
          await assertWorkspaceUrl(this.env, p.baseUrl);
        } catch (err) {
          throw bad(err instanceof UnsafeTargetError ? err.message : `${p.baseUrl}: ${explainNetworkError(err, 'The AI server', new URL(p.baseUrl).hostname, new URL(p.baseUrl).port)}`);
        }
      } else if (!key) {
        throw bad(`Enter an API key for ${name}.`);
      }
      if (key) keys[p.kind] = key;
      const before = prior?.providers?.find((x) => x.kind === p.kind);
      const same = before && before.model === (p.model ?? '') && before.baseUrl === (p.kind === 'custom_ai' ? p.baseUrl! : null) && priorKeys[p.kind] === key;
      providers.push({
        kind: p.kind,
        model: p.model ?? '',
        baseUrl: p.kind === 'custom_ai' ? p.baseUrl! : null,
        keyHint: hint(key),
        // A changed key, model or address starts a fresh history.
        lastOkAt: same ? before.lastOkAt : null,
        lastError: same ? before.lastError : null,
      });
    }
    const settings: OwnAiSettings = { useShared: input.useShared, providers };
    const data = {
      externalAccountId: 'ai',
      accountName: providers.map((p) => OWN_AI_NAMES[p.kind]).join(', '),
      scopes: [],
      credentialsEncrypted: this.store.seal({ keys } satisfies OwnAiSecrets),
      settings: settings as never,
      status: 'CONNECTED' as const,
      lastError: null,
      connectedById: auth.userId,
    };
    await this.prisma.run(auth, async (tx) => {
      const row = await tx.appConnection.upsert({ where: { tenantId_provider: { tenantId: auth.tenantId, provider: 'AI' } }, create: { tenantId: auth.tenantId, provider: 'AI', ...data }, update: data });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'own_ai.saved', entityType: 'app_connection', entityId: row.id, metadata: { providers: kinds, useShared: input.useShared }, meta });
    });
    return this.aiStatus(auth);
  }

  async removeAi(auth: AuthContext, meta: RequestMeta): Promise<OwnAiStatus> {
    await this.remove(auth, 'AI', 'own_ai.removed', meta);
    return this.aiStatus(auth);
  }

  /** Asks one of the workspace's providers for a one-word answer: proves the key, the model and the address. */
  async testAi(auth: AuthContext, kind: OwnAiKind): Promise<OwnServerTestResult> {
    const row = await this.store.row(auth.tenantId, 'AI');
    const s = row?.settings as unknown as OwnAiSettings | undefined;
    const p = s?.providers?.find((x) => x.kind === kind);
    if (!row || !p) throw bad(`${OWN_AI_NAMES[kind]} is not saved for this workspace.`);
    const key = this.store.open<OwnAiSecrets>(row).keys?.[kind] ?? null;
    const model = p.model || defaultModel(this.env, kind);
    const provider = buildOwnProvider(this.env, { kind, apiKey: key, model, baseUrl: p.baseUrl }, (url, init) => workspaceFetch(this.env, url, init));
    try {
      const res = await provider.generate({ system: 'You are a connection test.', messages: [{ role: 'user', content: 'Reply with the single word OK.' }], maxTokens: 16, effort: 'low' });
      await this.store.recordAi(auth.tenantId, kind, null);
      return { ok: true, message: `${OWN_AI_NAMES[kind]} answered with ${res.model || model} (${res.inputTokens + res.outputTokens} tokens, billed by the provider to your own key, not AI credits).` };
    } catch (err) {
      const message = err instanceof AiProviderFailure || err instanceof Error ? err.message : String(err);
      await this.store.recordAi(auth.tenantId, kind, new Error(message));
      return { ok: false, message };
    }
  }

  // Email ---------------------------------------------------------------------------------------------------------

  async emailStatus(auth: AuthContext): Promise<OwnEmailStatus> {
    const row = await this.store.row(auth.tenantId, 'SMTP');
    const s = row?.settings as unknown as OwnEmailSettings | undefined;
    const secrets = row ? this.store.open<OwnEmailSecrets>(row) : null;
    return {
      configured: !!s?.host,
      host: s?.host ?? null,
      port: s?.port ?? null,
      security: s?.security ?? null,
      username: s?.username ?? null,
      hasPassword: !!secrets?.password,
      fromAddress: s?.fromAddress ?? null,
      fromName: s?.fromName ?? null,
      lastOkAt: s?.lastOkAt ?? null,
      lastError: s?.lastError ?? null,
      sharedAvailable: this.mailer.configured,
      updatedAt: row?.updatedAt.toISOString() ?? null,
      updatedBy: await this.who(auth.tenantId, row),
    };
  }

  /** Saves the server only after it accepted a connection and sign-in, so a typo is caught before an invitation is lost. */
  async saveEmail(auth: AuthContext, input: OwnEmailSaveInput, meta: RequestMeta): Promise<OwnEmailStatus> {
    const existing = await this.store.row(auth.tenantId, 'SMTP');
    const priorPassword = existing ? this.store.open<OwnEmailSecrets>(existing).password : null;
    const password = input.password === undefined || input.password === null ? priorPassword : input.password || null;
    const settings: OwnEmailSettings = {
      host: input.host.replace(/^\[|\]$/g, ''),
      port: input.port,
      security: input.security,
      username: input.username || null,
      fromAddress: input.fromAddress,
      fromName: input.fromName || null,
      lastOkAt: null,
      lastError: null,
    };
    await this.verify(settings, password);
    settings.lastOkAt = new Date().toISOString();
    const data = {
      externalAccountId: 'smtp',
      accountName: `${settings.host}:${settings.port}`,
      scopes: [],
      credentialsEncrypted: this.store.seal({ password } satisfies OwnEmailSecrets),
      settings: settings as never,
      status: 'CONNECTED' as const,
      lastError: null,
      connectedById: auth.userId,
    };
    await this.prisma.run(auth, async (tx) => {
      const row = await tx.appConnection.upsert({ where: { tenantId_provider: { tenantId: auth.tenantId, provider: 'SMTP' } }, create: { tenantId: auth.tenantId, provider: 'SMTP', ...data }, update: data });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'own_email.saved', entityType: 'app_connection', entityId: row.id, metadata: { host: settings.host, port: settings.port, security: settings.security, from: settings.fromAddress }, meta });
    });
    return this.emailStatus(auth);
  }

  async removeEmail(auth: AuthContext, meta: RequestMeta): Promise<OwnEmailStatus> {
    await this.remove(auth, 'SMTP', 'own_email.removed', meta);
    return this.emailStatus(auth);
  }

  /** Signs in and sends one test email to the admin who pressed the button. */
  async testEmail(auth: AuthContext): Promise<OwnServerTestResult> {
    const row = await this.store.row(auth.tenantId, 'SMTP');
    if (!row) throw bad('Save your email server first.');
    const s = row.settings as unknown as OwnEmailSettings;
    const { password } = this.store.open<OwnEmailSecrets>(row);
    const me = await this.prisma.user.findUnique({ where: { id: auth.userId }, select: { email: true } });
    let mailer: Awaited<ReturnType<OwnServersStore['transportFor']>> | null = null;
    try {
      mailer = await this.store.transportFor(s, password);
      await mailer.transport.sendMail({
        from: mailer.from,
        to: me!.email,
        subject: 'SampForce test email',
        text: `This is a test from SampForce. Email your workspace sends (client portal invitations, replies and password resets) now goes through ${s.host}.`,
      });
      await this.store.recordEmail(auth.tenantId, null);
      return { ok: true, message: `The server accepted a test email to ${me!.email}. Check that it arrived (and is not in spam).` };
    } catch (err) {
      const message = err instanceof UnsafeTargetError ? err.message : explainSmtpError(err, s.host, s.port);
      await this.store.recordEmail(auth.tenantId, new Error(message));
      return { ok: false, message };
    } finally {
      mailer?.close();
    }
  }

  private async verify(s: OwnEmailSettings, password: string | null): Promise<void> {
    let mailer: Awaited<ReturnType<OwnServersStore['transportFor']>> | null = null;
    try {
      await allowedAddresses(this.env, s.host);
      mailer = await this.store.transportFor(s, password);
      await mailer.transport.verify();
    } catch (err) {
      throw bad(err instanceof UnsafeTargetError ? err.message : err instanceof Error && /must be encrypted/.test(err.message) ? err.message : explainSmtpError(err, s.host, s.port));
    } finally {
      mailer?.close();
    }
  }

  private async remove(auth: AuthContext, provider: 'AI' | 'SMTP', action: string, meta: RequestMeta): Promise<void> {
    await this.prisma.run(auth, async (tx) => {
      const row = await tx.appConnection.findUnique({ where: { tenantId_provider: { tenantId: auth.tenantId, provider } } });
      if (!row) return;
      await tx.appConnection.delete({ where: { id: row.id } });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action, entityType: 'app_connection', entityId: row.id, metadata: {}, meta });
    });
  }
}
