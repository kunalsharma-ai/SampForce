import { createHmac, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { WhatsappTemplate } from '@dealflow/types';
import { API_ENV, type ApiEnv } from '../common/env';

/** The workspace's own WhatsApp Business credentials, sealed at rest. */
export interface WhatsappKeys {
  phoneNumberId: string;
  wabaId: string;
  accessToken: string;
  appSecret: string;
}

export class WhatsappError extends Error {
  constructor(
    readonly code: string,
    message: string,
    /** The token no longer works: the connection needs new credentials. */
    readonly revoked = false,
  ) {
    super(message);
  }
}

/** What one verified webhook delivery says. */
export interface WhatsappWebhook {
  phoneNumberId: string | null;
  inbound: { waMessageId: string; from: string; name: string | null; kind: 'text' | 'other'; body: string; at: Date }[];
  statuses: { waMessageId: string; status: 'sent' | 'delivered' | 'read' | 'failed'; at: Date; error: string | null }[];
}

/** Meta error codes that mean the token or its permissions are gone (see Graph API error handling). */
const TOKEN_CODES = new Set([190, 102, 10, 200]);

/**
 * WhatsApp Business Platform Cloud API (Meta Graph API) for one workspace's own number: read the number and its
 * approved templates, send template and text messages, and verify and read webhooks. Tested against a local
 * stand-in that follows Meta's published API; not yet against Meta.
 */
@Injectable()
export class WhatsappClient {
  constructor(@Inject(API_ENV) private readonly env: ApiEnv) {}

  /** A read that proves the token can see this number and this business account. Sends nothing. */
  async check(keys: WhatsappKeys): Promise<{ displayPhoneNumber: string; verifiedName: string; qualityRating: string | null }> {
    const n = await this.call<{ id: string; display_phone_number?: string; verified_name?: string; quality_rating?: string }>(keys, 'GET', `/${keys.phoneNumberId}?fields=display_phone_number,verified_name,quality_rating`);
    await this.call(keys, 'GET', `/${keys.wabaId}/phone_numbers?fields=id&limit=100`).then((r) => {
      const ids = ((r as { data?: { id: string }[] }).data ?? []).map((p) => p.id);
      if (!ids.includes(keys.phoneNumberId)) throw new WhatsappError('mismatch', 'That phone number id does not belong to that WhatsApp Business Account.');
    });
    return { displayPhoneNumber: n.display_phone_number ?? keys.phoneNumberId, verifiedName: n.verified_name ?? 'WhatsApp Business', qualityRating: n.quality_rating ?? null };
  }

  /** Approved templates whose only variables are in the body text (media headers and button variables are not supported yet). */
  async templates(keys: WhatsappKeys): Promise<WhatsappTemplate[]> {
    const r = await this.call<{ data?: { name: string; language: string; category: string; status: string; components?: { type: string; format?: string; text?: string; buttons?: { url?: string }[] }[] }[] }>(
      keys,
      'GET',
      `/${keys.wabaId}/message_templates?status=APPROVED&limit=100&fields=name,language,category,status,components`,
    );
    const out: WhatsappTemplate[] = [];
    for (const t of r.data ?? []) {
      if (t.status !== 'APPROVED') continue;
      const comps = t.components ?? [];
      const header = comps.find((c) => c.type === 'HEADER');
      if (header && (header.format !== 'TEXT' || /\{\{/.test(header.text ?? ''))) continue;
      if (comps.some((c) => c.type === 'BUTTONS' && c.buttons?.some((b) => /\{\{/.test(b.url ?? '')))) continue;
      const body = comps.find((c) => c.type === 'BODY')?.text ?? '';
      const params = new Set([...body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => m[1])).size;
      out.push({ name: t.name, language: t.language, category: t.category, body, params });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name) || a.language.localeCompare(b.language));
  }

  async sendTemplate(keys: WhatsappKeys, to: string, t: { name: string; language: string; params: string[] }): Promise<{ waMessageId: string }> {
    return this.send(keys, {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'template',
      template: { name: t.name, language: { code: t.language }, ...(t.params.length ? { components: [{ type: 'body', parameters: t.params.map((text) => ({ type: 'text', text })) }] } : {}) },
    });
  }

  async sendText(keys: WhatsappKeys, to: string, text: string): Promise<{ waMessageId: string }> {
    return this.send(keys, { messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'text', text: { body: text, preview_url: false } });
  }

  /** Checks X-Hub-Signature-256 (HMAC-SHA256 of the raw body with the Meta App Secret) and reads the delivery. */
  parseWebhook(keys: WhatsappKeys, raw: Buffer, signature: string | undefined): WhatsappWebhook {
    const expected = `sha256=${createHmac('sha256', keys.appSecret).update(raw).digest('hex')}`;
    if (!signature || !safeEqual(signature, expected)) throw new WhatsappError('bad_signature', 'Signature check failed.');
    const body = JSON.parse(raw.toString('utf8')) as {
      object?: string;
      entry?: {
        changes?: {
          field?: string;
          value?: {
            metadata?: { phone_number_id?: string };
            contacts?: { wa_id?: string; profile?: { name?: string } }[];
            messages?: { id: string; from: string; timestamp: string; type: string; text?: { body?: string }; button?: { text?: string }; interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } } }[];
            statuses?: { id: string; status: string; timestamp: string; errors?: { code?: number; title?: string; message?: string; error_data?: { details?: string } }[] }[];
          };
        }[];
      }[];
    };
    const out: WhatsappWebhook = { phoneNumberId: null, inbound: [], statuses: [] };
    if (body.object !== 'whatsapp_business_account') return out;
    for (const e of body.entry ?? []) {
      for (const c of e.changes ?? []) {
        if (c.field !== 'messages' || !c.value) continue;
        const v = c.value;
        out.phoneNumberId ??= v.metadata?.phone_number_id ?? null;
        // A delivery for another number of the same business account is not this connection's.
        if (v.metadata?.phone_number_id && v.metadata.phone_number_id !== keys.phoneNumberId) continue;
        for (const m of v.messages ?? []) {
          const text = m.text?.body ?? m.button?.text ?? m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title;
          out.inbound.push({
            waMessageId: m.id,
            from: m.from.replace(/\D/g, ''),
            name: v.contacts?.find((x) => x.wa_id === m.from)?.profile?.name ?? null,
            kind: text !== undefined ? 'text' : 'other',
            body: text !== undefined ? text.slice(0, 4096) : `(${m.type} message: open WhatsApp to see it)`,
            at: new Date(Number(m.timestamp) * 1000),
          });
        }
        for (const s of v.statuses ?? []) {
          if (!['sent', 'delivered', 'read', 'failed'].includes(s.status)) continue;
          const err = s.errors?.[0];
          out.statuses.push({ waMessageId: s.id, status: s.status as 'sent', at: new Date(Number(s.timestamp) * 1000), error: err ? describeError(err.code, err.error_data?.details ?? err.message ?? err.title) : null });
        }
      }
    }
    return out;
  }

  private async send(keys: WhatsappKeys, payload: object): Promise<{ waMessageId: string }> {
    const r = await this.call<{ messages?: { id: string }[] }>(keys, 'POST', `/${keys.phoneNumberId}/messages`, payload);
    const id = r.messages?.[0]?.id;
    if (!id) throw new WhatsappError('no_id', 'WhatsApp did not return a message id.');
    return { waMessageId: id };
  }

  private async call<T>(keys: WhatsappKeys, method: string, path: string, json?: object): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.env.WHATSAPP_API_BASE_URL.replace(/\/$/, '')}${path}`, {
        method,
        headers: { authorization: `Bearer ${keys.accessToken}`, ...(json ? { 'content-type': 'application/json' } : {}) },
        body: json ? JSON.stringify(json) : undefined,
        redirect: 'error',
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new WhatsappError('unavailable', 'WhatsApp could not be reached. Try again shortly.');
    }
    const body = (await res.json().catch(() => ({}))) as T & { error?: { code?: number; message?: string; error_data?: { details?: string } } };
    if (res.ok) return body;
    const code = body.error?.code;
    if (res.status === 401 || (code !== undefined && TOKEN_CODES.has(code))) {
      throw new WhatsappError('token', 'Meta refused the access token or it lacks the WhatsApp permissions. Paste a new System User token.', true);
    }
    throw new WhatsappError(`meta_${code ?? res.status}`, describeError(code, body.error?.error_data?.details ?? body.error?.message));
  }
}

/** Plain-language versions of the WhatsApp errors a sender can do something about. */
export function describeError(code: number | undefined, detail: string | undefined): string {
  switch (code) {
    case 131047:
      return 'More than 24 hours have passed since their last message, so only an approved template can be sent.';
    case 131026:
      return 'WhatsApp could not deliver to this number (it may not be on WhatsApp, or they have not accepted the latest terms).';
    case 131050:
      return 'This person has stopped marketing messages from your business on WhatsApp.';
    case 132000:
      return 'The template needs a different number of values.';
    case 132001:
      return 'That template does not exist in this language, or is not approved.';
    case 131056:
    case 130429:
      return 'WhatsApp is rate limiting this number. Try again in a few minutes.';
    case 133010:
      return 'This phone number is not registered with the Cloud API yet.';
    default:
      if (code && detail) return `WhatsApp refused the request (error ${code}): ${detail.slice(0, 200)}`;
      if (code) return `WhatsApp refused the request (error ${code}).`;
      if (detail) return `WhatsApp refused the request: ${detail.slice(0, 200)}`;
      return 'WhatsApp refused the request.';
  }
}

/**
 * A contact's phone as WhatsApp's international digits. Only numbers written with their country code (+44…, 0044…)
 * are used, since guessing the country could message a stranger.
 */
export function waNumber(phone: string | null | undefined): { phone: string | null; problem: string | null } {
  if (!phone?.trim()) return { phone: null, problem: 'This contact has no phone number.' };
  const t = phone.trim();
  if (!/^(\+|00)/.test(t)) return { phone: null, problem: 'Add the country code to their phone number (for example +44 20 7946 0000).' };
  const digits = t.replace(/^00/, '').replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 15 || digits.startsWith('0')) return { phone: null, problem: 'Their phone number does not look like a valid international number.' };
  return { phone: digits, problem: null };
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
