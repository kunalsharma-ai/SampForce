import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { API_ENV, type ApiEnv } from '../common/env';
import { UnsafeTargetError } from '../common/net-guard';
import { workspaceFetch } from '../common/trusted-targets';

/** The workspace's SampBidx address and key, plus the secret SampBidx signs its status callbacks with. Sealed at rest. */
export interface SampbidxKeys {
  baseUrl: string;
  apiKey: string;
  callbackSecret: string;
}

export class SampbidxError extends Error {
  constructor(
    readonly code: string,
    message: string,
    /** The key no longer works: the connection needs a new one. */
    readonly revoked = false,
    /** The low-level cause when SampBidx could not be reached (refused, timed out, name not found), for Test connection. */
    readonly detail: string | null = null,
  ) {
    super(message);
  }
}

/** One part of a multipart/form-data body. */
export interface Part {
  name: string;
  filename?: string;
  contentType: string;
  data: Buffer;
}

/** What SampBidx answers when it accepts an RFQ or an email. */
export interface SampbidxAccepted {
  id: string;
  url: string | null;
  status: string | null;
}

/** Callback signatures older than this are refused, so a captured request cannot be replayed later. */
export const CALLBACK_MAX_AGE_SECONDS = 300;

/**
 * SampBidx's inbound API, version 1, as SampForce defines it in docs/integrations/sampbidx-api.md: check the key,
 * post an RFQ with its files, post an RFQ email. SampBidx is the workspace's own system, so its address is whatever
 * the admin enters; it is called through workspaceFetch (ADR 0068) like a workspace's own AI or email server: public
 * addresses always, a private one (SampBidx on the same server or LAN) only when the operator lists it in
 * TRUSTED_PRIVATE_HOSTS, and plain http only to such an approved private host. Tested against a local stand-in
 * that follows that document, not yet against SampBidx.
 */
@Injectable()
export class SampbidxClient {
  constructor(@Inject(API_ENV) private readonly env: ApiEnv) {}

  /** GET /v1/ping: proves the address and the key. Sends nothing. */
  async check(keys: Pick<SampbidxKeys, 'baseUrl' | 'apiKey'>, timeoutMs = 60_000): Promise<{ accountName: string }> {
    const body = await this.call<{ account?: { name?: string }; name?: string }>(keys, 'GET', '/v1/ping', undefined, {}, timeoutMs);
    return { accountName: body.account?.name ?? body.name ?? 'SampBidx' };
  }

  /** POST /v1/rfqs (multipart): the RFQ as JSON in the "rfq" part and each attachment as a "files" part. */
  sendRfq(keys: SampbidxKeys, transferId: string, rfq: unknown, files: Part[]): Promise<SampbidxAccepted> {
    return this.accept(keys, '/v1/rfqs', transferId, [{ name: 'rfq', contentType: 'application/json', data: Buffer.from(JSON.stringify(rfq)) }, ...files]);
  }

  /** POST /v1/rfq-emails (multipart): the email's details as JSON in "email", the original file in "message" if there is one, and files added next to pasted text as "files". */
  sendEmail(keys: SampbidxKeys, transferId: string, email: unknown, message: Part | null, files: Part[] = []): Promise<SampbidxAccepted> {
    return this.accept(keys, '/v1/rfq-emails', transferId, [{ name: 'email', contentType: 'application/json', data: Buffer.from(JSON.stringify(email)) }, ...(message ? [message] : []), ...files]);
  }

  /**
   * POST /v1/messages (multipart, ADR 0078): a chat message written in SampForce, as JSON in "message" and each file
   * as a "files" part. The message id is the Idempotency-Key, so a retry never shows twice in SampBidx.
   */
  async postMessage(keys: SampbidxKeys, messageId: string, message: unknown, files: Part[]): Promise<{ id: string | null }> {
    const { body, contentType } = multipart([{ name: 'message', contentType: 'application/json', data: Buffer.from(JSON.stringify(message)) }, ...files]);
    const r = await this.call<{ id?: string | number }>(keys, 'POST', '/v1/messages', body, { 'content-type': contentType, 'idempotency-key': messageId, 'x-sampforce-message-id': messageId });
    return { id: r.id === undefined || r.id === null || r.id === '' ? null : String(r.id) };
  }

  /**
   * PUT /v1/clients/{externalId} (ADR 0080): creates the client or updates the one SampBidx already has for this
   * SampForce company, so a client is never made twice. Answers the client's id, page and the ids of the contacts.
   */
  async upsertClient(keys: SampbidxKeys, externalId: string, transferId: string, client: unknown): Promise<SampbidxAccepted & { contacts: { externalId: string; id: string }[] }> {
    const r = await this.call<{ id?: string | number; url?: string; status?: string; contacts?: { externalId?: string; id?: string | number }[] }>(
      keys,
      'PUT',
      `/v1/clients/${encodeURIComponent(externalId)}`,
      Buffer.from(JSON.stringify(client)),
      { 'content-type': 'application/json', 'idempotency-key': transferId, 'x-sampforce-transfer-id': transferId },
    );
    if (r.id === undefined || r.id === null || r.id === '') throw new SampbidxError('no_id', 'SampBidx did not return an id for the client.');
    const contacts = Array.isArray(r.contacts)
      ? r.contacts.filter((c) => c && typeof c.externalId === 'string' && c.id !== undefined && c.id !== null).map((c) => ({ externalId: c.externalId!, id: String(c.id) }))
      : [];
    return { id: String(r.id), url: typeof r.url === 'string' ? r.url : null, status: typeof r.status === 'string' ? r.status : null, contacts };
  }

  /**
   * PUT /v1/deals/{externalId} (ADR 0099): creates the deal or updates the one SampBidx already has for this SampForce
   * deal, linked to its client. Answers SampBidx's id for the deal and optionally its page.
   */
  async upsertDeal(keys: SampbidxKeys, externalId: string, transferId: string, deal: unknown): Promise<SampbidxAccepted> {
    const r = await this.call<{ id?: string | number; url?: string; status?: string }>(
      keys,
      'PUT',
      `/v1/deals/${encodeURIComponent(externalId)}`,
      Buffer.from(JSON.stringify(deal)),
      { 'content-type': 'application/json', 'idempotency-key': transferId, 'x-sampforce-transfer-id': transferId },
    );
    if (r.id === undefined || r.id === null || r.id === '') throw new SampbidxError('no_id', 'SampBidx did not return an id for the deal.');
    return { id: String(r.id), url: typeof r.url === 'string' ? r.url : null, status: typeof r.status === 'string' ? r.status : null };
  }

  private async accept(keys: SampbidxKeys, path: string, transferId: string, parts: Part[]): Promise<SampbidxAccepted> {
    const { body, contentType } = multipart(parts);
    const r = await this.call<{ id?: string | number; url?: string; status?: string }>(keys, 'POST', path, body, {
      'content-type': contentType,
      // A retry of the same transfer carries the same key, so SampBidx can answer with the record it already made.
      'idempotency-key': transferId,
      'x-sampforce-transfer-id': transferId,
    });
    if (r.id === undefined || r.id === null || r.id === '') throw new SampbidxError('no_id', 'SampBidx did not return an id for the RFQ.');
    return { id: String(r.id), url: typeof r.url === 'string' ? r.url : null, status: typeof r.status === 'string' ? r.status : null };
  }

  private async call<T>(keys: Pick<SampbidxKeys, 'baseUrl' | 'apiKey'>, method: 'GET' | 'POST' | 'PUT', path: string, body?: Buffer, headers: Record<string, string> = {}, timeoutMs = 60_000): Promise<T> {
    let res: Response;
    try {
      res = await workspaceFetch(this.env, `${keys.baseUrl.replace(/\/+$/, '')}${path}`, {
        method,
        headers: { authorization: `Bearer ${keys.apiKey}`, accept: 'application/json', 'user-agent': 'SampForce', ...headers },
        body: body ? new Uint8Array(body) : undefined,
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      if (e instanceof UnsafeTargetError) throw new SampbidxError('address', `SampForce cannot call that SampBidx address: ${e.message}.`);
      throw new SampbidxError('unavailable', 'SampBidx could not be reached. Check the address, or try again shortly.', false, networkCause(e));
    }
    const data = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } | string; message?: string };
    if (res.ok) return data;
    const detail = typeof data.error === 'string' ? data.error : (data.error?.message ?? data.message ?? '');
    if (res.status === 401 || res.status === 403) throw new SampbidxError('auth', 'SampBidx refused the API key. Paste a current key from SampBidx.', true);
    if (res.status === 404) throw new SampbidxError('not_found', 'SampBidx has no API at that address. Check the address ends where the /v1 paths begin.');
    if (res.status === 413) throw new SampbidxError('too_large', 'SampBidx refused the files as too large. Send fewer or smaller attachments.');
    const what = path.startsWith('/v1/clients') ? 'the client' : path.startsWith('/v1/deals') ? 'the deal' : 'the RFQ';
    if (res.status === 400 || res.status === 422) throw new SampbidxError('invalid', detail ? `SampBidx refused ${what}: ${String(detail).slice(0, 300)}` : `SampBidx refused ${what} as incomplete.`);
    if (res.status === 409) throw new SampbidxError('conflict', detail ? `SampBidx reported a duplicate: ${String(detail).slice(0, 300)}` : `SampBidx reported ${what} as a duplicate.`);
    if (res.status === 429) throw new SampbidxError('busy', 'SampBidx is busy. Try again in a minute.');
    throw new SampbidxError(`http_${res.status}`, `SampBidx answered with an error (${res.status}). Try again shortly.`);
  }
}

/** Why a request never got an answer, in plain words: the name, the port, the certificate or the time. */
export function networkCause(e: unknown): string {
  const err = e as { name?: string; cause?: { code?: string; message?: string; errors?: { code?: string }[] } };
  const code = err.cause?.code ?? err.cause?.errors?.find((x) => x.code)?.code ?? '';
  if (/bad port/i.test(err.cause?.message ?? '')) return 'that port is blocked for web requests: use the port SampBidx’s API listens on, such as 443';
  if (err.name === 'TimeoutError' || err.name === 'AbortError') return 'no answer before the time limit';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'the server name was not found (DNS)';
  if (code === 'ECONNREFUSED') return 'the connection was refused: nothing is listening at that address and port';
  if (code === 'ECONNRESET') return 'the connection was closed by the other side';
  if (code === 'EHOSTUNREACH' || code === 'ENETUNREACH') return 'that network cannot be reached from the SampForce server';
  if (/CERT|SSL|TLS/i.test(code) || /certificate/i.test(err.cause?.message ?? '')) return 'the https certificate was not accepted';
  return code ? `network error ${code}` : 'network error';
}

/** Builds a multipart/form-data body by hand so the exact bytes are known (and the same on every retry). */
export function multipart(parts: Part[]): { body: Buffer; contentType: string } {
  const boundary = `----SampForce${randomBytes(12).toString('hex')}`;
  const chunks: Buffer[] = [];
  for (const p of parts) {
    const name = p.name.replace(/"/g, '');
    const file = p.filename !== undefined ? `; filename="${p.filename.replace(/["\r\n\\]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(p.filename)}` : '';
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"${file}\r\nContent-Type: ${p.contentType}\r\n\r\n`), p.data, Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
}

/** sha256=hex(HMAC-SHA256(secret, `${timestamp}.${rawBody}`)), as SampBidx signs its status callbacks. */
export function sampbidxSignature(secret: string, timestamp: string, rawBody: Buffer | string): string {
  return `sha256=${createHmac('sha256', secret).update(`${timestamp}.`).update(rawBody).digest('hex')}`;
}

export function verifySampbidxSignature(secret: string, timestamp: string | undefined, rawBody: Buffer, signature: string | undefined, now = Date.now()): boolean {
  if (!timestamp || !signature || !/^\d{9,11}$/.test(timestamp)) return false;
  if (Math.abs(now / 1000 - Number(timestamp)) > CALLBACK_MAX_AGE_SECONDS) return false;
  const a = Buffer.from(sampbidxSignature(secret, timestamp, rawBody));
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Reads the headers of an .eml file that a transfer list needs. Anything unreadable is left empty. */
export function emlHeaders(data: Buffer): { subject: string | null; from: string | null; date: Date | null } {
  const head = data.subarray(0, 64 * 1024).toString('latin1');
  const end = head.search(/\r?\n\r?\n/);
  const block = (end >= 0 ? head.slice(0, end) : head).replace(/\r?\n[ \t]+/g, ' ');
  const get = (name: string) => {
    const m = new RegExp(`^${name}:[ \\t]*(.*)$`, 'im').exec(block);
    return m ? decodeWords(m[1]!.trim()) : null;
  };
  const date = get('Date');
  const parsed = date ? new Date(date) : null;
  return { subject: get('Subject'), from: get('From'), date: parsed && !Number.isNaN(parsed.getTime()) ? parsed : null };
}

/** RFC 2047 encoded words (=?UTF-8?B?...?= and =?UTF-8?Q?...?=), the way most mail clients write non-ASCII subjects. */
function decodeWords(v: string): string {
  return v.replace(/=\?([^?]+)\?([bBqQ])\?([^?]*)\?=\s*/g, (_m, charset: string, enc: string, text: string) => {
    try {
      const bytes = enc.toUpperCase() === 'B' ? Buffer.from(text, 'base64') : Buffer.from(text.replace(/_/g, ' ').replace(/=([0-9A-Fa-f]{2})/g, (_x, h: string) => String.fromCharCode(parseInt(h, 16))), 'latin1');
      return new TextDecoder(/^utf-?8$/i.test(charset) ? 'utf-8' : charset).decode(bytes);
    } catch {
      return text;
    }
  });
}
