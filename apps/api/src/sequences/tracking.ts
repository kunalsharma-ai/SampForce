import { createHmac, timingSafeEqual } from 'node:crypto';
import { renderEmailDesign, type EmailDesign } from '@dealflow/types';

/**
 * Signed tokens for sequence tracking and unsubscribe links. A token carries the tenant id and the sent
 * message id, so the public endpoints can act inside the right tenant without a lookup table, and an
 * HMAC so nobody can forge one for another message. Click links also sign the destination URL, so the
 * redirect cannot be used to send people to arbitrary sites.
 */
export class TrackingSigner {
  private readonly key: Buffer;

  /** `purpose` keeps tokens for different links apart: a tracking token never opens a proposal. */
  constructor(secret: string, readonly baseUrl: string, purpose = 'dealflow-tracking-v1') {
    this.key = createHmac('sha256', secret).update(purpose).digest();
  }

  private mac(data: string, len = 16): string {
    return createHmac('sha256', this.key).update(data).digest().subarray(0, len).toString('base64url');
  }

  token(tenantId: string, messageId: string): string {
    const raw = Buffer.from((tenantId + messageId).replace(/-/g, ''), 'hex').toString('base64url');
    return `${raw}.${this.mac(raw)}`;
  }

  verify(token: string): { tenantId: string; messageId: string } | null {
    const [raw, sig] = token.split('.');
    if (!raw || !sig || raw.length !== 43 || !safeEqual(sig, this.mac(raw))) return null;
    const hex = Buffer.from(raw, 'base64url').toString('hex');
    if (hex.length !== 64) return null;
    const uuid = (h: string) => `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
    return { tenantId: uuid(hex.slice(0, 32)), messageId: uuid(hex.slice(32)) };
  }

  urlSignature(token: string, url: string): string {
    return this.mac(`${token}\n${url}`, 12);
  }

  verifyUrl(token: string, url: string, sig: string): boolean {
    return safeEqual(sig, this.urlSignature(token, url));
  }

  openUrl(token: string): string {
    return `${this.baseUrl}/api/v1/t/o/${token}.gif`;
  }

  clickUrl(token: string, url: string): string {
    return `${this.baseUrl}/api/v1/t/c/${token}?u=${encodeURIComponent(url)}&s=${this.urlSignature(token, url)}`;
  }

  /** The page people see; it asks them to confirm. */
  unsubscribePageUrl(token: string): string {
    return `${this.baseUrl}/unsubscribe/${token}`;
  }

  /** RFC 8058 one-click target for the List-Unsubscribe header. */
  unsubscribePostUrl(token: string): string {
    return `${this.baseUrl}/api/v1/t/u/${token}`;
  }
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const URL_RE = /\bhttps?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]]/g;

export interface BuiltEmail {
  body: string;
  html?: string;
  headers: Record<string, string>;
}

const UNSUB_TEXT = 'If you would rather not hear from me again, unsubscribe here:';
const unsubHtml = (url: string) => `<p style="margin:2em 0 0;font-size:12px;color:#666">If you would rather not hear from me again, <a href="${escapeHtml(url)}">unsubscribe here</a>.</p>`;
const pixelHtml = (url: string) => `<img src="${escapeHtml(url)}" width="1" height="1" alt="" style="display:block;border:0">`;
const unsubHeaders = (signer: TrackingSigner, token: string) => ({
  'List-Unsubscribe': `<${signer.unsubscribePostUrl(token)}>`,
  'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
});

/**
 * A designed sequence email (ADR 0050): the design's HTML with merge fields filled in, tracked links when click
 * tracking is on, the unsubscribe line and the open pixel; and its plain-text part with the unsubscribe line.
 */
export function buildDesignedSequenceEmail(
  design: EmailDesign,
  merge: (text: string) => string,
  opts: { signer: TrackingSigner; token: string; trackOpens: boolean; trackClicks: boolean },
): BuiltEmail {
  const { signer, token } = opts;
  const unsub = signer.unsubscribePageUrl(token);
  const r = renderEmailDesign(design, {
    merge,
    link: opts.trackClicks ? (url) => signer.clickUrl(token, url) : undefined,
    appendHtml: unsubHtml(unsub) + (opts.trackOpens ? pixelHtml(signer.openUrl(token)) : ''),
  });
  return { body: `${r.text.trimEnd()}\n\n${UNSUB_TEXT} ${unsub}`, html: r.html, headers: unsubHeaders(signer, token) };
}

/**
 * Turns a rendered plain-text sequence email into what is sent: the text part with an unsubscribe line,
 * an HTML part when open or click tracking is on, and List-Unsubscribe headers.
 */
export function buildSequenceEmail(text: string, opts: { signer: TrackingSigner; token: string; trackOpens: boolean; trackClicks: boolean }): BuiltEmail {
  const { signer, token } = opts;
  const unsub = signer.unsubscribePageUrl(token);
  const body = `${text.trimEnd()}\n\n${UNSUB_TEXT} ${unsub}`;
  const headers = unsubHeaders(signer, token);
  if (!opts.trackOpens && !opts.trackClicks) return { body, headers };

  const link = (url: string) => {
    const href = opts.trackClicks ? signer.clickUrl(token, url) : url;
    return `<a href="${escapeHtml(href)}">${escapeHtml(url)}</a>`;
  };
  const toHtml = (t: string) => {
    let out = '';
    let last = 0;
    for (const m of t.matchAll(URL_RE)) {
      out += escapeHtml(t.slice(last, m.index)) + link(m[0]);
      last = m.index! + m[0].length;
    }
    return out + escapeHtml(t.slice(last));
  };
  const paragraphs = text
    .trimEnd()
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 1em">${toHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
  const footerHtml = unsubHtml(unsub);
  const pixel = opts.trackOpens ? pixelHtml(signer.openUrl(token)) : '';
  const html = `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#222">${paragraphs}${footerHtml}${pixel}</body></html>`;
  return { body, html, headers };
}
