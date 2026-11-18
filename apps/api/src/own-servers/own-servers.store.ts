import { Inject, Injectable, Logger } from '@nestjs/common';
import { isIP } from 'node:net';
import { createTransport, type Transporter } from 'nodemailer';
import type { AppConnection } from '@dealflow/database';
import { OWN_AI_NAMES, type OwnAiKind } from '@dealflow/types';
import { buildOwnProvider, defaultModel, type OwnEntry } from '../ai/ai-providers';
import type { AiProviderFailure } from '../ai/provider';
import { SECRET_BOX, type SecretBox } from '../common/crypto';
import { API_ENV, type ApiEnv } from '../common/env';
import { PrismaService } from '../common/prisma.service';
import { isPrivateAddress } from '../common/net-guard';
import { explainNetworkError, networkCode } from '../common/network-error';
import { allowedAddresses, workspaceFetch } from '../common/trusted-targets';

/** What is saved for a workspace's own AI providers (ADR 0068). Keys are sealed separately. */
export interface OwnAiSettings {
  useShared: boolean;
  providers: {
    kind: OwnAiKind;
    model: string;
    baseUrl: string | null;
    keyHint: string | null;
    lastOkAt: string | null;
    lastError: { at: string; message: string } | null;
  }[];
}
export interface OwnAiSecrets {
  keys: Partial<Record<OwnAiKind, string>>;
}

/** What is saved for a workspace's own email server. The password is sealed separately. */
export interface OwnEmailSettings {
  host: string;
  port: number;
  security: 'tls' | 'starttls' | 'none';
  username: string | null;
  fromAddress: string;
  fromName: string | null;
  lastOkAt: string | null;
  lastError: { at: string; message: string } | null;
}
export interface OwnEmailSecrets {
  password: string | null;
}

export interface OwnMailer {
  transport: Transporter;
  host: { host: string; port: number };
  from: string;
  close(): void;
}

const FRESH_MS = 10 * 60_000;

/** Why an email server refused a connection or sign-in, in words, without echoing the password. */
export function explainSmtpError(err: unknown, host: string, port: number): string {
  const msg = err instanceof Error ? err.message : String(err);
  const code = networkCode(err);
  if ((err as { code?: string })?.code === 'EAUTH') return `The email server refused the user name or password (EAUTH): ${msg.slice(0, 160)}`;
  if (code === 'ETIMEDOUT' || /Greeting never received|Connection timeout/i.test(msg)) {
    return `The email server did not answer at ${host} port ${port} (ETIMEDOUT). Many cloud providers block outgoing email ports (25, 465, 587) on new servers: ask yours to open them, or try port 2525 if your email service offers it.`;
  }
  if (/wrong version number|ssl3_get_record|packet length too long/i.test(msg)) {
    return `The email server at ${host} port ${port} did not start an encrypted connection. Port 465 uses TLS; ports 587 and 2525 usually use STARTTLS.`;
  }
  if (code) return explainNetworkError(err, 'The email server', host, port);
  return `The email server refused the connection or sign-in: ${msg.slice(0, 200)}`;
}


/** "Acme Sales <sales@acme.com>", with the name quoted when it holds characters an address header cannot. */
export const fromHeader = (address: string, name: string | null): string =>
  name ? `"${name.replace(/["\\\r\n]/g, '')}" <${address}>` : address;

/**
 * Reads a workspace's own AI providers and email server (ADR 0068) for the AI gateway and the mailer, and records
 * each one's last success and failure for the Integrations page. Lives in the global mail module so both can use it
 * without a module cycle.
 */
@Injectable()
export class OwnServersStore {
  private readonly log = new Logger(OwnServersStore.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(SECRET_BOX) private readonly box: SecretBox,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  async row(tenantId: string, provider: 'AI' | 'SMTP'): Promise<AppConnection | null> {
    const row = await this.prisma.run({ tenantId }, (tx) => tx.appConnection.findUnique({ where: { tenantId_provider: { tenantId, provider } } }));
    return row && row.status !== 'DISCONNECTED' ? row : null;
  }

  open<T>(row: AppConnection): T {
    return JSON.parse(this.box.open(row.credentialsEncrypted)) as T;
  }

  seal(value: unknown): string {
    return this.box.seal(JSON.stringify(value));
  }

  /** The workspace's own AI providers, ready to call, in its order; null when it has none. */
  async ai(tenantId: string): Promise<{ entries: OwnEntry[]; useShared: boolean } | null> {
    const row = await this.row(tenantId, 'AI');
    if (!row) return null;
    const s = row.settings as unknown as OwnAiSettings;
    if (!s?.providers?.length) return null;
    const keys = this.open<OwnAiSecrets>(row).keys ?? {};
    const entries = s.providers.map((p): OwnEntry => ({
      id: `${tenantId}:${p.kind}`,
      kind: p.kind,
      name: OWN_AI_NAMES[p.kind],
      provider: buildOwnProvider(this.env, { kind: p.kind, apiKey: keys[p.kind] ?? null, model: p.model || defaultModel(this.env, p.kind), baseUrl: p.baseUrl }, (url, init) => workspaceFetch(this.env, url, init)),
      onResult: (err) => void this.recordAi(tenantId, p.kind, err).catch((e: unknown) => this.log.warn({ err: e instanceof Error ? e.message : String(e) }, 'Could not record own AI provider result')),
    }));
    return { entries, useShared: s.useShared !== false };
  }

  /** Writes a failure every time, a success only when it changes what the Integrations page shows. */
  async recordAi(tenantId: string, kind: OwnAiKind, err: AiProviderFailure | Error | null): Promise<void> {
    await this.prisma.run({ tenantId }, async (tx) => {
      const row = await tx.appConnection.findUnique({ where: { tenantId_provider: { tenantId, provider: 'AI' } } });
      if (!row) return;
      const s = row.settings as unknown as OwnAiSettings;
      const p = s.providers?.find((x) => x.kind === kind);
      if (!p) return;
      const now = new Date().toISOString();
      if (err) p.lastError = { at: now, message: err.message.slice(0, 300) };
      else {
        const fresh = p.lastOkAt && Date.now() - Date.parse(p.lastOkAt) < FRESH_MS && (!p.lastError || p.lastError.at < p.lastOkAt);
        if (fresh) return;
        p.lastOkAt = now;
      }
      await tx.appConnection.update({ where: { id: row.id }, data: { settings: s as never, lastUsedAt: new Date(), ...(err ? {} : { lastError: null }) } });
    });
  }

  /**
   * A mail transport to the workspace's own email server, or null when it has none. The host is resolved once and
   * checked (public, or a private address the operator approved), and the connection goes to that exact address,
   * with the name kept for the TLS certificate check.
   */
  async mailer(tenantId: string): Promise<OwnMailer | null> {
    const row = await this.row(tenantId, 'SMTP');
    if (!row) return null;
    const s = row.settings as unknown as OwnEmailSettings;
    if (!s?.host) return null;
    const { password } = this.open<OwnEmailSecrets>(row);
    return this.transportFor(s, password);
  }

  async transportFor(s: Omit<OwnEmailSettings, 'lastOkAt' | 'lastError'>, password: string | null): Promise<OwnMailer> {
    const [target] = await allowedAddresses(this.env, s.host);
    const bare = s.host.replace(/^\[|\]$/g, '');
    if (s.security === 'none' && !this.env.ALLOW_PRIVATE_NETWORK_TARGETS) {
      if (!isPrivateAddress(target!.address)) throw new Error('Email to a server on the internet must be encrypted: choose TLS or STARTTLS. No encryption is only allowed for a private server the operator approved.');
    }
    const transport = createTransport({
      host: target!.address,
      port: s.port,
      secure: s.security === 'tls',
      requireTLS: s.security === 'starttls',
      ignoreTLS: s.security === 'none',
      tls: { servername: isIP(bare) ? undefined : bare },
      name: 'sampforce',
      auth: s.username ? { user: s.username, pass: password ?? '' } : undefined,
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 30_000,
    });
    return { transport, host: { host: bare, port: s.port }, from: fromHeader(s.fromAddress, s.fromName), close: () => transport.close() };
  }

  async recordEmail(tenantId: string, err: Error | null): Promise<void> {
    await this.prisma.run({ tenantId }, async (tx) => {
      const row = await tx.appConnection.findUnique({ where: { tenantId_provider: { tenantId, provider: 'SMTP' } } });
      if (!row) return;
      const s = row.settings as unknown as OwnEmailSettings;
      const now = new Date().toISOString();
      if (err) s.lastError = { at: now, message: err.message.slice(0, 300) };
      else {
        const fresh = s.lastOkAt && Date.now() - Date.parse(s.lastOkAt) < FRESH_MS && (!s.lastError || s.lastError.at < s.lastOkAt);
        if (fresh) return;
        s.lastOkAt = now;
      }
      await tx.appConnection.update({ where: { id: row.id }, data: { settings: s as never, lastUsedAt: new Date() } });
    });
  }
}
