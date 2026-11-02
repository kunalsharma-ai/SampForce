import { Inject, Injectable } from '@nestjs/common';
import { API_ENV, type ApiEnv } from '../common/env';
import { publicFetch } from '../common/net-guard';
import { MailerService } from '../mail/mailer.service';

const TIMEOUT = 10_000;
/** A made-up authorization code. Exchanging it can never succeed, so nothing is issued or connected. */
export const PROBE_CODE = 'dealflow-connection-test';

const trim = (u: string) => u.replace(/\/+$/, '');

async function readJson(res: Response): Promise<Record<string, unknown>> {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * OAuth apps have no "is this client secret right?" endpoint. The standard probe, used here, exchanges a made-up
 * authorization code: the provider checks the client credentials first, so `invalid_client` means the keys are wrong,
 * while `invalid_grant` (the code is not valid) means the provider accepted the keys and refused only the code.
 * Nothing is issued, and no account is connected.
 */
function judgeOAuth(provider: string, status: number, body: Record<string, unknown>): string {
  const error = String(body.error ?? '');
  const detail = String(body.error_description ?? body.reason ?? '').slice(0, 160);
  if (status === 400 && (error === 'invalid_grant' || error === 'invalid_request')) {
    return `${provider} accepted the client ID and secret (the test code was refused, as expected). Nothing was connected.`;
  }
  if (error === 'invalid_client' || error === 'unauthorized_client' || status === 401) {
    throw new Error(`${provider} refused the client ID or secret (${error || status})${detail ? `: ${detail}` : ''}.`);
  }
  throw new Error(`${provider} answered ${status}${error ? ` ${error}` : ''}${detail ? `: ${detail}` : ''}.`);
}

/**
 * Connection tests for the providers the operator console can hold keys for, beyond Apollo, Hunter and Deepgram
 * (their clients carry their own `check()`). Each is the cheapest call that proves the keys: nothing is sent,
 * charged, transcribed or connected. Built against each provider's published documentation and tested only against
 * local stand-ins until real keys are added.
 */
@Injectable()
export class ConnectionTests {
  constructor(
    @Inject(API_ENV) private readonly env: ApiEnv,
    private readonly mailer: MailerService,
  ) {}

  private appRedirect(app: string): string {
    return `${trim(this.env.PUBLIC_WEB_URL)}/api/v1/apps/${app}/callback`;
  }

  private mailboxRedirect(provider: string): string {
    return `${trim(this.env.PUBLIC_WEB_URL)}/api/v1/integrations/${provider}/callback`;
  }

  private post(url: string, form: Record<string, string>, basic?: [string, string]): Promise<Response> {
    return fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json', ...(basic ? { authorization: `Basic ${Buffer.from(`${basic[0]}:${basic[1]}`).toString('base64')}` } : {}) },
      body: new URLSearchParams(form),
      signal: AbortSignal.timeout(TIMEOUT),
    });
  }

  /** GET /v1/models lists the models the key may use. It is free: no tokens are spent. */
  async anthropic(): Promise<string> {
    const res = await fetch(`${trim(this.env.AI_API_BASE_URL)}/v1/models?limit=20`, {
      headers: { 'x-api-key': this.env.ANTHROPIC_API_KEY ?? '', 'anthropic-version': '2023-06-01' },
      signal: AbortSignal.timeout(TIMEOUT),
    });
    if (res.status === 401 || res.status === 403) throw new Error(`Anthropic refused the API key (${res.status}). Check ANTHROPIC_API_KEY.`);
    if (!res.ok) throw new Error(`Anthropic answered ${res.status}.`);
    const body = await readJson(res);
    const ids = Array.isArray(body.data) ? (body.data as { id?: string }[]).map((m) => m.id).filter(Boolean) : [];
    const model = this.env.AI_MODEL;
    return `Key accepted (${ids.length} model${ids.length === 1 ? '' : 's'} listed${ids.length ? `; ${ids.includes(model) ? `${model} is available` : `${model} was not in the first page`}` : ''}). No tokens were used.`;
  }

  async google(): Promise<string> {
    const res = await this.post(this.env.GOOGLE_TOKEN_URL, {
      grant_type: 'authorization_code', code: PROBE_CODE, redirect_uri: this.mailboxRedirect('google'),
      client_id: this.env.GOOGLE_CLIENT_ID ?? '', client_secret: this.env.GOOGLE_CLIENT_SECRET ?? '',
    });
    return judgeOAuth('Google', res.status, await readJson(res));
  }

  async microsoft(): Promise<string> {
    const url = `${trim(this.env.MICROSOFT_LOGIN_BASE_URL)}/${encodeURIComponent(this.env.MICROSOFT_TENANT || 'common')}/oauth2/v2.0/token`;
    const res = await this.post(url, {
      grant_type: 'authorization_code', code: PROBE_CODE, redirect_uri: this.mailboxRedirect('microsoft'), scope: 'offline_access openid email',
      client_id: this.env.MICROSOFT_CLIENT_ID ?? '', client_secret: this.env.MICROSOFT_CLIENT_SECRET ?? '',
    });
    return judgeOAuth('Microsoft', res.status, await readJson(res));
  }

  /** Slack answers 200 with `ok: false`; `invalid_code` means the client ID and secret were accepted. */
  async slack(): Promise<string> {
    const res = await this.post(`${trim(this.env.SLACK_API_BASE_URL)}/oauth.v2.access`, { code: PROBE_CODE, redirect_uri: this.appRedirect('slack') }, [this.env.SLACK_CLIENT_ID ?? '', this.env.SLACK_CLIENT_SECRET ?? '']);
    const body = await readJson(res);
    const error = String(body.error ?? '');
    if (error === 'invalid_code' || error === 'bad_redirect_uri') return 'Slack accepted the client ID and secret (the test code was refused, as expected). Nothing was connected.';
    if (error === 'invalid_client_id' || error === 'bad_client_secret' || error === 'invalid_client') throw new Error(`Slack refused the client ID or secret (${error}).`);
    throw new Error(`Slack answered ${res.status}${error ? ` ${error}` : ''}.`);
  }

  async zoom(): Promise<string> {
    const res = await this.post(`${trim(this.env.ZOOM_AUTH_BASE_URL)}/oauth/token`, { grant_type: 'authorization_code', code: PROBE_CODE, redirect_uri: this.appRedirect('zoom') }, [this.env.ZOOM_CLIENT_ID ?? '', this.env.ZOOM_CLIENT_SECRET ?? '']);
    return judgeOAuth('Zoom', res.status, await readJson(res));
  }

  async docusign(): Promise<string> {
    const res = await this.post(new URL('/oauth/token', this.env.DOCUSIGN_AUTH_BASE_URL).toString(), { grant_type: 'authorization_code', code: PROBE_CODE }, [this.env.DOCUSIGN_INTEGRATION_KEY ?? '', this.env.DOCUSIGN_SECRET_KEY ?? '']);
    return judgeOAuth('DocuSign', res.status, await readJson(res));
  }

  /** Connects and signs in to the email service, then disconnects. No email is sent. */
  async smtp(): Promise<string> {
    try {
      return await this.mailer.verify();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Never echo the URL back: it holds the password.
      throw new Error(`The email service refused the connection or sign-in: ${msg.replace(/smtps?:\/\/\S+/g, '[SMTP_URL]').slice(0, 200)}`);
    }
  }

  /** Opens the invite link the way a person's browser would. Zapier answers with the invite page or a redirect to it. */
  async zapier(): Promise<string> {
    const url = this.env.ZAPIER_INVITE_URL;
    if (!url) throw new Error('ZAPIER_INVITE_URL is not set.');
    const res = await publicFetch(url, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT) }, this.env.ALLOW_PRIVATE_NETWORK_TARGETS);
    if (res.status >= 200 && res.status < 400) return `The invite link opens (HTTP ${res.status}).`;
    throw new Error(`The invite link answered HTTP ${res.status}. Copy it again from Zapier's developer platform.`);
  }

  /** GET /v1/balance reads the account balance: no charge, no customer, no change. */
  async stripe(): Promise<string> {
    const res = await fetch(`${trim(this.env.STRIPE_API_BASE_URL)}/v1/balance`, { headers: { authorization: `Bearer ${this.env.STRIPE_SECRET_KEY ?? ''}` }, signal: AbortSignal.timeout(TIMEOUT) });
    if (res.status === 401 || res.status === 403) throw new Error(`Stripe refused the secret key (${res.status}). Check STRIPE_SECRET_KEY.`);
    if (!res.ok) throw new Error(`Stripe answered ${res.status}.`);
    const body = await readJson(res);
    return `Key accepted (${body.livemode === true ? 'live mode' : 'test mode'}). Nothing was charged.`;
  }

  /** GET /v1/plans?count=1 lists one subscription plan: read-only. */
  async razorpay(): Promise<string> {
    const auth = Buffer.from(`${this.env.RAZORPAY_KEY_ID ?? ''}:${this.env.RAZORPAY_KEY_SECRET ?? ''}`).toString('base64');
    const res = await fetch(`${trim(this.env.RAZORPAY_API_BASE_URL)}/v1/plans?count=1`, { headers: { authorization: `Basic ${auth}` }, signal: AbortSignal.timeout(TIMEOUT) });
    if (res.status === 401 || res.status === 403) throw new Error(`Razorpay refused the key ID or secret (${res.status}).`);
    if (!res.ok) throw new Error(`Razorpay answered ${res.status}.`);
    return `Keys accepted (${String(this.env.RAZORPAY_KEY_ID ?? '').startsWith('rzp_live_') ? 'live mode' : 'test mode'}). Nothing was charged.`;
  }
}
