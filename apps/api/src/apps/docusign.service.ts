import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import type { AppConnection, SignatureEnvelope } from '@dealflow/database';
import type { DocusignSendInput, EnvelopeStatus, SignatureEnvelopeRow } from '@dealflow/types';
import { formatReference } from '@dealflow/types';
import { AuditService } from '../audit/audit.service';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { SECRET_BOX, type SecretBox } from '../common/crypto';
import { API_ENV, type ApiEnv } from '../common/env';
import { PrismaService } from '../common/prisma.service';
import { renderContractPdf } from '../commercial/contract-pdf';
import { applyContractSignature } from '../commercial/contracts.service';
import { errorMessage } from '../worker/queue';
import { AppError, AppsService, type StoredDocusign } from './apps.service';
import { DocusignClient, DocusignError } from './docusign';
import { refreshUnderLock } from './oauth-refresh';

const OPEN: EnvelopeStatus[] = ['sent', 'delivered'];
const FINAL: EnvelopeStatus[] = ['completed', 'declined', 'voided'];
const EVENT_STATUS: Record<string, EnvelopeStatus> = {
  'envelope-sent': 'sent',
  'envelope-delivered': 'delivered',
  'envelope-completed': 'completed',
  'envelope-declined': 'declined',
  'envelope-voided': 'voided',
};

interface StatusUpdate {
  status: EnvelopeStatus;
  completedAt?: Date | null;
  signerName?: string | null;
  declinedReason?: string | null;
  voidedReason?: string | null;
}

/**
 * Contracts sent for e-signature through the workspace's DocuSign account. Sending emails the customer, so it is a
 * single, explicitly confirmed action per contract. A completed envelope marks the draft contract signed; status
 * comes from DocuSign Connect events (HMAC-verified) or from "Check status".
 */
@Injectable()
export class DocusignService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly apps: AppsService,
    private readonly docusign: DocusignClient,
    @Inject(SECRET_BOX) private readonly box: SecretBox,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  async send(auth: AuthContext, input: DocusignSendInput, meta: RequestMeta): Promise<SignatureEnvelopeRow> {
    const conn = await this.apps.requireConnection(auth.tenantId, 'docusign');
    if (conn.status === 'ERROR') throw new AppError(conn.lastError ?? 'DocuSign needs reconnecting in Integrations.');
    const { contract, seller } = await this.prisma.run(auth, async (tx) => {
      const c = await tx.contract.findFirst({ where: { id: input.contractId, tenantId: auth.tenantId }, include: { company: { select: { id: true, name: true } } } });
      if (!c) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Contract not found.' });
      if (c.status !== 'DRAFT') throw new ConflictException({ code: 'INVALID_TRANSITION', message: 'Only a draft contract can be sent for signature.' });
      const open = await tx.signatureEnvelope.findFirst({ where: { tenantId: auth.tenantId, contractId: c.id, status: { in: OPEN } } });
      if (open) throw new ConflictException({ code: 'ALREADY_SENT', message: `This contract is already out for signature with ${open.signerEmail}. Void that envelope first.` });
      const t = await tx.tenant.findUniqueOrThrow({ where: { id: auth.tenantId }, select: { name: true } });
      return { contract: c, seller: t };
    });
    const reference = formatReference('C', contract.number);
    const pdf = await renderContractPdf(
      {
        reference,
        name: contract.name,
        company: contract.company,
        value: contract.value.toNumber(),
        currency: contract.currency,
        startDate: contract.startDate.toISOString().slice(0, 10),
        endDate: contract.endDate?.toISOString().slice(0, 10) ?? null,
        autoRenew: contract.autoRenew,
        terms: contract.terms,
      },
      seller,
      input.signerName,
    );
    const statusUrl = this.docusign.connectConfigured ? `${this.env.PUBLIC_WEB_URL.replace(/\/$/, '')}/api/v1/apps/docusign/events` : null;
    const sent = await this.withToken(auth.tenantId, conn, (token, creds) =>
      this.docusign.createEnvelope(token, creds, {
        pdf,
        documentName: `${reference} ${contract.name}`.slice(0, 100),
        signerName: input.signerName,
        signerEmail: input.signerEmail,
        emailSubject: (input.emailSubject ?? `Please sign: ${contract.name}`).slice(0, 100),
        message: input.message,
        statusUrl,
      }),
    ).catch(async (e: unknown) => {
      await this.apps.recordEvent(auth.tenantId, conn, { kind: 'envelope.failed', ok: false, externalId: null, summary: `Not sent for signature: ${contract.name}: ${errorMessage(e)}`, actorUserId: auth.userId, entityType: 'contract', entityId: contract.id });
      throw e instanceof DocusignError ? new AppError(e.message) : e;
    });
    const row = await this.prisma.run(auth, async (tx) => {
      const env = await tx.signatureEnvelope.create({
        data: { tenantId: auth.tenantId, connectionId: conn.id, contractId: contract.id, envelopeId: sent.envelopeId, status: 'sent', signerName: input.signerName, signerEmail: input.signerEmail, sentById: auth.userId },
      });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'contract.sent_for_signature', entityType: 'contract', entityId: contract.id, metadata: { provider: 'docusign', envelopeId: sent.envelopeId, signerEmail: input.signerEmail, confirmed: true }, meta });
      return env;
    });
    await this.apps.recordEvent(auth.tenantId, conn, { kind: 'envelope.sent', ok: true, externalId: sent.envelopeId, summary: `Sent ${reference} to ${input.signerName} <${input.signerEmail}> for signature`, actorUserId: auth.userId, entityType: 'contract', entityId: contract.id });
    return (await this.rows(auth, [row]))[0]!;
  }

  async list(auth: AuthContext, contractId?: string): Promise<SignatureEnvelopeRow[]> {
    const rows = await this.prisma.run(auth, (tx) => tx.signatureEnvelope.findMany({ where: { tenantId: auth.tenantId, ...(contractId ? { contractId } : {}) }, orderBy: { sentAt: 'desc' }, take: 50 }));
    return this.rows(auth, rows);
  }

  async void(auth: AuthContext, id: string, reason: string, meta: RequestMeta): Promise<SignatureEnvelopeRow> {
    const env = await this.find(auth, id);
    if (!OPEN.includes(env.status as EnvelopeStatus)) throw new ConflictException({ code: 'INVALID_TRANSITION', message: 'Only an envelope that is still out for signature can be voided.' });
    const conn = await this.apps.requireConnection(auth.tenantId, 'docusign');
    await this.withToken(auth.tenantId, conn, (token, creds) => this.docusign.voidEnvelope(token, creds, env.envelopeId, reason)).catch((e: unknown) => {
      throw e instanceof DocusignError ? new AppError(e.message) : e;
    });
    await this.prisma.run(auth, (tx) => this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'contract.signature_voided', entityType: 'contract', entityId: env.contractId, metadata: { envelopeId: env.envelopeId, reason }, meta }));
    await this.applyStatus(auth.tenantId, conn, env, { status: 'voided', voidedReason: reason }, 'voided in DealFlow');
    return (await this.rows(auth, [await this.find(auth, id)]))[0]!;
  }

  /** Asks DocuSign for the envelope's status (for installations without Connect, or a missed event). */
  async check(auth: AuthContext, id: string): Promise<SignatureEnvelopeRow> {
    const env = await this.find(auth, id);
    const conn = await this.apps.requireConnection(auth.tenantId, 'docusign');
    const r = await this.withToken(auth.tenantId, conn, (token, creds) => this.docusign.getEnvelope(token, creds, env.envelopeId)).catch((e: unknown) => {
      throw e instanceof DocusignError ? new AppError(e.message) : e;
    });
    if (r.status && (r.status as EnvelopeStatus) !== env.status) {
      await this.applyStatus(auth.tenantId, conn, env, { status: r.status as EnvelopeStatus, completedAt: r.completedAt, signerName: r.signerName, declinedReason: r.declinedReason, voidedReason: r.voidedReason }, 'checked');
    }
    return (await this.rows(auth, [await this.find(auth, id)]))[0]!;
  }

  /** The signed PDF with DocuSign's certificate of completion, fetched from DocuSign when asked. */
  async signedDocument(auth: AuthContext, id: string): Promise<{ pdf: Buffer; filename: string }> {
    const env = await this.find(auth, id);
    if (env.status !== 'completed') throw new ConflictException({ code: 'NOT_SIGNED', message: 'The envelope has not been signed yet.' });
    const conn = await this.apps.requireConnection(auth.tenantId, 'docusign');
    const pdf = await this.withToken(auth.tenantId, conn, (token, creds) => this.docusign.signedPdf(token, creds, env.envelopeId)).catch((e: unknown) => {
      throw e instanceof DocusignError ? new AppError(e.message) : e;
    });
    return { pdf, filename: `signed-${env.envelopeId}.pdf` };
  }

  /** DocuSign Connect (JSON, SIM). Authenticated by HMAC only; unknown accounts and envelopes are acknowledged and ignored. */
  async handleConnect(raw: Buffer | undefined, headers: Record<string, string | string[] | undefined>): Promise<object> {
    if (!this.docusign.connectConfigured) throw new ForbiddenException({ code: 'PENDING_CONFIGURATION', message: 'DocuSign Connect is not configured on this installation.' });
    const sigs = Object.entries(headers)
      .filter(([k]) => /^x-docusign-signature-\d+$/i.test(k))
      .flatMap(([, v]) => (Array.isArray(v) ? v : v ? [v] : []));
    if (!raw || !this.docusign.verifyConnect(raw, sigs)) throw new UnauthorizedException({ code: 'BAD_SIGNATURE', message: 'Signature check failed.' });
    const body = JSON.parse(raw.toString('utf8')) as ConnectMessage;
    const status = EVENT_STATUS[body.event ?? ''];
    const accountId = body.data?.accountId;
    const envelopeId = body.data?.envelopeId;
    if (!status || !accountId || !envelopeId) return { ok: true };
    const summary = body.data?.envelopeSummary;
    const signer = summary?.recipients?.signers?.[0];
    for (const conn of await this.connectionsForAccount(accountId)) {
      const env = await this.prisma.run({ tenantId: conn.tenantId }, (tx) => tx.signatureEnvelope.findUnique({ where: { tenantId_envelopeId: { tenantId: conn.tenantId, envelopeId } } }));
      if (!env) continue;
      await this.applyStatus(conn.tenantId, conn, env, {
        status,
        completedAt: summary?.completedDateTime ? new Date(summary.completedDateTime) : null,
        signerName: signer?.name ?? null,
        declinedReason: signer?.declinedReason ?? null,
        voidedReason: summary?.voidedReason ?? null,
      }, 'DocuSign Connect');
    }
    return { ok: true };
  }

  /** Moves an envelope forward (never back from a final state); a completed envelope signs a draft contract. */
  private async applyStatus(tenantId: string, conn: AppConnection, env: SignatureEnvelope, u: StatusUpdate, source: string): Promise<void> {
    const current = env.status as EnvelopeStatus;
    if (FINAL.includes(current) || (current === 'delivered' && u.status === 'sent')) return;
    let signedContract = false;
    await this.prisma.run({ tenantId }, async (tx) => {
      const moved = await tx.signatureEnvelope.updateMany({
        where: { id: env.id, status: current },
        data: {
          status: u.status,
          lastEventAt: new Date(),
          ...(u.status === 'completed' ? { completedAt: u.completedAt ?? new Date() } : {}),
          ...(u.status === 'declined' ? { declinedReason: u.declinedReason?.slice(0, 500) ?? null } : {}),
          ...(u.status === 'voided' ? { voidedReason: u.voidedReason?.slice(0, 500) ?? null } : {}),
        },
      });
      if (!moved.count || u.status !== 'completed') return;
      const c = await tx.contract.findFirst({ where: { id: env.contractId, tenantId } });
      if (!c || c.status !== 'DRAFT') return;
      const signedBy = u.signerName || env.signerName;
      const signedAt = u.completedAt ?? new Date();
      await applyContractSignature(tx, c, { signedBy, signedAt, method: 'docusign' });
      await this.audit.record(tx, { tenantId, actorUserId: null, action: 'contract.signed', entityType: 'contract', entityId: c.id, metadata: { method: 'docusign', envelopeId: env.envelopeId, signedBy, signedAt: signedAt.toISOString(), source } });
      signedContract = true;
    });
    const label: Record<EnvelopeStatus, string> = { sent: 'sent', delivered: 'opened by the signer', completed: 'signed', declined: 'declined', voided: 'voided' };
    await this.apps.recordEvent(tenantId, conn, {
      kind: `envelope.${u.status}`,
      ok: u.status !== 'declined',
      externalId: env.envelopeId,
      summary: `Envelope for ${env.signerName} ${label[u.status]}${u.status === 'declined' && u.declinedReason ? `: ${u.declinedReason}` : ''}${signedContract ? '; contract marked signed' : ''} (${source})`.slice(0, 500),
      actorUserId: null,
      entityType: 'contract',
      entityId: env.contractId,
    });
  }

  private async find(auth: AuthContext, id: string): Promise<SignatureEnvelope> {
    const env = await this.prisma.run(auth, (tx) => tx.signatureEnvelope.findFirst({ where: { id, tenantId: auth.tenantId } }));
    if (!env) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Envelope not found.' });
    return env;
  }

  private async withToken<T>(tenantId: string, conn: AppConnection, fn: (token: string, creds: StoredDocusign) => Promise<T>): Promise<T> {
    let creds = JSON.parse(this.box.open(conn.credentialsEncrypted)) as StoredDocusign;
    const refresh = (stale?: string) =>
      refreshUnderLock<StoredDocusign>(this.prisma, this.box, tenantId, conn.id, (rt) => this.docusign.refresh(rt), (e): e is DocusignError => e instanceof DocusignError && e.revoked, stale);
    if (creds.expiresAt - 60_000 < Date.now()) creds = await refresh();
    try {
      const out = await fn(creds.accessToken, creds);
      await this.prisma.run({ tenantId }, (tx) => tx.appConnection.update({ where: { id: conn.id }, data: { lastUsedAt: new Date(), status: 'CONNECTED', lastError: null } }));
      return out;
    } catch (e) {
      if (!(e instanceof DocusignError) || e.code !== 'unauthorized') throw e;
      creds = await refresh(creds.accessToken);
      return fn(creds.accessToken, creds);
    }
  }

  private connectionsForAccount(accountId: string): Promise<AppConnection[]> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.app_provider', 'DOCUSIGN', true), set_config('app.app_account', ${accountId}, true)`;
      return tx.appConnection.findMany({ where: { provider: 'DOCUSIGN', externalAccountId: accountId }, take: 50 });
    });
  }

  private async rows(auth: AuthContext, rows: SignatureEnvelope[]): Promise<SignatureEnvelopeRow[]> {
    const people = await this.prisma.run(auth, (tx) => tx.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.sentById))] } }, select: { id: true, name: true } }));
    return rows.map((r) => ({
      id: r.id,
      contractId: r.contractId,
      envelopeId: r.envelopeId,
      status: r.status as EnvelopeStatus,
      signerName: r.signerName,
      signerEmail: r.signerEmail,
      sentBy: people.find((p) => p.id === r.sentById)?.name ?? null,
      sentAt: r.sentAt.toISOString(),
      completedAt: r.completedAt?.toISOString() ?? null,
      declinedReason: r.declinedReason,
      voidedReason: r.voidedReason,
      lastEventAt: r.lastEventAt?.toISOString() ?? null,
    }));
  }
}

interface ConnectMessage {
  event?: string;
  data?: {
    accountId?: string;
    envelopeId?: string;
    envelopeSummary?: { status?: string; completedDateTime?: string; voidedReason?: string; recipients?: { signers?: { name?: string; email?: string; status?: string; declinedReason?: string }[] } };
  };
}
