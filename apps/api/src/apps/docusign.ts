import { createHmac, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { assertPublicUrl } from '../common/net-guard';
import { API_ENV, type ApiEnv } from '../common/env';

export interface DocusignTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export interface DocusignAccount {
  accountId: string;
  accountName: string;
  /** e.g. https://na3.docusign.net; the REST API is under {baseUri}/restapi/v2.1. */
  baseUri: string;
  userEmail: string;
}

export class DocusignError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly revoked = false,
  ) {
    super(message);
  }
}

/**
 * DocuSign eSignature over plain HTTPS: OAuth Authorization Code Grant, userinfo (which account and base URI),
 * create and void envelopes, download the signed document, and Connect HMAC verification. Tested against a local
 * stand-in that follows DocuSign's published API; not yet against DocuSign itself.
 */
@Injectable()
export class DocusignClient {
  constructor(@Inject(API_ENV) private readonly env: ApiEnv) {}

  missingConfig(): string[] {
    return [!this.env.DOCUSIGN_INTEGRATION_KEY && 'DOCUSIGN_INTEGRATION_KEY', !this.env.DOCUSIGN_SECRET_KEY && 'DOCUSIGN_SECRET_KEY'].filter((x): x is string => !!x);
  }

  /** Status updates need DocuSign Connect messages, which are verified with this key. */
  get connectConfigured(): boolean {
    return !!this.env.DOCUSIGN_CONNECT_HMAC_KEY;
  }

  authorizeUrl(state: string, redirectUri: string): string {
    const u = new URL('/oauth/auth', this.env.DOCUSIGN_AUTH_BASE_URL);
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('scope', 'signature extended');
    u.searchParams.set('client_id', this.env.DOCUSIGN_INTEGRATION_KEY!);
    u.searchParams.set('redirect_uri', redirectUri);
    u.searchParams.set('state', state);
    return u.toString();
  }

  exchangeCode(code: string): Promise<DocusignTokens> {
    return this.token({ grant_type: 'authorization_code', code });
  }

  refresh(refreshToken: string): Promise<DocusignTokens> {
    return this.token({ grant_type: 'refresh_token', refresh_token: refreshToken });
  }

  /** The user's default eSignature account and the base URI its API lives on. */
  async account(accessToken: string): Promise<DocusignAccount> {
    const res = await fetch(new URL('/oauth/userinfo', this.env.DOCUSIGN_AUTH_BASE_URL), { headers: { authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(10_000) }).catch(() => {
      throw new DocusignError('unavailable', 'DocuSign could not be reached.');
    });
    if (!res.ok) throw new DocusignError('userinfo_failed', `DocuSign refused the sign-in (HTTP ${res.status}).`);
    const body = (await res.json()) as { email?: string; accounts?: { account_id: string; account_name: string; base_uri: string; is_default?: boolean | string }[] };
    const acct = body.accounts?.find((a) => a.is_default === true || a.is_default === 'true') ?? body.accounts?.[0];
    if (!acct) throw new DocusignError('no_account', 'This DocuSign user has no eSignature account.');
    await this.checkBaseUri(acct.base_uri);
    return { accountId: acct.account_id, accountName: acct.account_name, baseUri: acct.base_uri.replace(/\/$/, ''), userEmail: body.email ?? '' };
  }

  async createEnvelope(
    accessToken: string,
    a: Pick<DocusignAccount, 'accountId' | 'baseUri'>,
    e: { pdf: Buffer; documentName: string; signerName: string; signerEmail: string; emailSubject: string; message?: string; statusUrl: string | null },
  ): Promise<{ envelopeId: string; status: string }> {
    const body = {
      emailSubject: e.emailSubject,
      ...(e.message ? { emailBlurb: e.message } : {}),
      status: 'sent',
      documents: [{ documentId: '1', name: e.documentName, fileExtension: 'pdf', documentBase64: e.pdf.toString('base64') }],
      recipients: {
        signers: [
          {
            recipientId: '1',
            routingOrder: '1',
            name: e.signerName,
            email: e.signerEmail,
            tabs: {
              signHereTabs: [{ anchorString: '/sn1/', anchorUnits: 'pixels', anchorYOffset: '-6', anchorIgnoreIfNotPresent: 'false' }],
              dateSignedTabs: [{ anchorString: '/ds1/', anchorUnits: 'pixels', anchorYOffset: '-4' }],
            },
          },
        ],
      },
      // Per-envelope Connect: status events come back to DealFlow, signed with the account's HMAC key.
      ...(e.statusUrl
        ? {
            eventNotification: {
              url: e.statusUrl,
              requireAcknowledgment: 'true',
              includeHMAC: 'true',
              loggingEnabled: 'true',
              deliveryMode: 'SIM',
              events: ['envelope-sent', 'envelope-delivered', 'envelope-completed', 'envelope-declined', 'envelope-voided'],
              eventData: { version: 'restv2.1', format: 'json', includeData: ['recipients'] },
            },
          }
        : {}),
    };
    const r = await this.api<{ envelopeId: string; status: string }>(accessToken, a, 'POST', '/envelopes', body);
    return { envelopeId: r.envelopeId, status: r.status };
  }

  async voidEnvelope(accessToken: string, a: Pick<DocusignAccount, 'accountId' | 'baseUri'>, envelopeId: string, reason: string): Promise<void> {
    await this.api(accessToken, a, 'PUT', `/envelopes/${encodeURIComponent(envelopeId)}`, { status: 'voided', voidedReason: reason });
  }

  async getEnvelope(accessToken: string, a: Pick<DocusignAccount, 'accountId' | 'baseUri'>, envelopeId: string): Promise<{ status: string; completedAt: Date | null; signerName: string | null; declinedReason: string | null; voidedReason: string | null }> {
    const r = await this.api<{ status?: string; completedDateTime?: string; voidedReason?: string; recipients?: { signers?: { name?: string; declinedReason?: string }[] } }>(accessToken, a, 'GET', `/envelopes/${encodeURIComponent(envelopeId)}?include=recipients`);
    const s = r.recipients?.signers?.[0];
    return { status: r.status ?? '', completedAt: r.completedDateTime ? new Date(r.completedDateTime) : null, signerName: s?.name ?? null, declinedReason: s?.declinedReason ?? null, voidedReason: r.voidedReason ?? null };
  }

  /** The signed document with its certificate of completion, as one PDF. */
  async signedPdf(accessToken: string, a: Pick<DocusignAccount, 'accountId' | 'baseUri'>, envelopeId: string): Promise<Buffer> {
    const res = await this.raw(accessToken, a, 'GET', `/envelopes/${encodeURIComponent(envelopeId)}/documents/combined`);
    return Buffer.from(await res.arrayBuffer());
  }

  /** Connect HMAC: each X-DocuSign-Signature-N header is base64 HMAC-SHA256 of the raw body; any one may match (key rotation). */
  verifyConnect(rawBody: Buffer, signatures: string[]): boolean {
    const key = this.env.DOCUSIGN_CONNECT_HMAC_KEY;
    if (!key || signatures.length === 0) return false;
    const expected = Buffer.from(createHmac('sha256', key).update(rawBody).digest('base64'));
    return signatures.some((s) => {
      const b = Buffer.from(s);
      return b.length === expected.length && timingSafeEqual(b, expected);
    });
  }

  private async checkBaseUri(raw: string): Promise<void> {
    const u = await assertPublicUrl(raw, this.env.ALLOW_PRIVATE_NETWORK_TARGETS).catch(() => {
      throw new DocusignError('bad_base_uri', 'DocuSign returned an unexpected API address.');
    });
    if (!this.env.ALLOW_PRIVATE_NETWORK_TARGETS && (u.protocol !== 'https:' || !/(^|\.)docusign\.(net|com)$/i.test(u.hostname))) {
      throw new DocusignError('bad_base_uri', 'DocuSign returned an unexpected API address.');
    }
  }

  private async token(params: Record<string, string>): Promise<DocusignTokens> {
    const res = await fetch(new URL('/oauth/token', this.env.DOCUSIGN_AUTH_BASE_URL), {
      method: 'POST',
      headers: { authorization: `Basic ${Buffer.from(`${this.env.DOCUSIGN_INTEGRATION_KEY}:${this.env.DOCUSIGN_SECRET_KEY}`).toString('base64')}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params),
      signal: AbortSignal.timeout(10_000),
    }).catch(() => {
      throw new DocusignError('unavailable', 'DocuSign could not be reached.');
    });
    const body = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string };
    if (!res.ok || !body.access_token || !body.refresh_token) {
      const revoked = body.error === 'invalid_grant' || res.status === 401;
      throw new DocusignError(body.error ?? 'token_failed', revoked ? 'DocuSign no longer accepts the DealFlow connection. Reconnect DocuSign in Integrations.' : `DocuSign refused the sign-in (${body.error_description ?? body.error ?? res.status}).`, revoked);
    }
    return { accessToken: body.access_token, refreshToken: body.refresh_token, expiresAt: Date.now() + (body.expires_in ?? 28_800) * 1000 };
  }

  private async raw(accessToken: string, a: Pick<DocusignAccount, 'accountId' | 'baseUri'>, method: string, path: string, json?: object): Promise<Response> {
    await this.checkBaseUri(a.baseUri);
    let res: Response;
    try {
      res = await fetch(`${a.baseUri}/restapi/v2.1/accounts/${encodeURIComponent(a.accountId)}${path}`, {
        method,
        headers: { authorization: `Bearer ${accessToken}`, ...(json ? { 'content-type': 'application/json' } : {}) },
        body: json ? JSON.stringify(json) : undefined,
        signal: AbortSignal.timeout(30_000),
      });
    } catch (e) {
      throw new DocusignError('unavailable', e instanceof Error && e.name === 'TimeoutError' ? 'DocuSign did not answer in time.' : 'DocuSign could not be reached.');
    }
    if (res.ok) return res;
    const body = (await res.json().catch(() => ({}))) as { errorCode?: string; message?: string };
    if (res.status === 401) throw new DocusignError('unauthorized', 'DocuSign refused the access token.');
    if (res.status === 429) throw new DocusignError('ratelimited', 'DocuSign is limiting requests. Try again in a minute.');
    throw new DocusignError(body.errorCode ?? `http_${res.status}`, body.message ? `DocuSign: ${body.message}` : `DocuSign answered HTTP ${res.status}.`);
  }

  private async api<T>(accessToken: string, a: Pick<DocusignAccount, 'accountId' | 'baseUri'>, method: string, path: string, json?: object): Promise<T> {
    const res = await this.raw(accessToken, a, method, path, json);
    return (await res.json().catch(() => ({}))) as T;
  }
}
