import { Inject, Injectable } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import type { Dialer, PhoneCall, Prisma, TenantTx } from '@dealflow/database';
import {
  type CallControlInput,
  type CallStatus,
  type DialerCapabilities,
  type DialerConfig,
  dialerConfigSchema,
  type DialerKind,
  type DialerSecret,
  type DialerStatus,
  type DialerTestResult,
  fillDialerTemplate,
  pickPath,
  providerOf,
} from '@dealflow/types';
import { SECRET_BOX, type SecretBox } from '../common/crypto';
import { API_ENV, type ApiEnv } from '../common/env';
import { assertPublicUrl, publicFetch, UnsafeTargetError } from '../common/net-guard';
import { PrismaService } from '../common/prisma.service';
import { TwilioClient, TwilioError, type TwilioKeys } from '../apps/twilio';

/*
 * The universal dialer's adapters (ADR 0089). Every dialer kind implements one interface, so the Calls section asks
 * "place this call", "end it", "test the connection" the same way whatever the provider is:
 * - LinkAdapter: builds the link the browser opens (and posts the signed webhook, when set).
 * - ApiAdapter: an HTTP request built from the dialer's settings, with Basic, Bearer, header-key or OAuth 2 sign-in.
 * - TwilioAdapter: Twilio's click-to-call bridge, hang-up and recording.
 * - SipAdapter: the browser phone (WebRTC) places the call itself; the server keeps its state.
 * - SimAdapter: the phone app dials on its SIM; the server keeps the request until the phone picks it up.
 * A new provider with a click-to-call API is new settings for ApiAdapter, not new code.
 */

export class DialerError extends Error {
  constructor(
    message: string,
    readonly httpStatus: number | null = null,
  ) {
    super(message);
  }
}

/** What an adapter gets to place a call: the call, its {placeholder} values and the dialer's settings and secrets. */
export interface DialContext {
  tx?: TenantTx;
  dialer: Dialer;
  config: DialerConfig;
  secrets: Partial<Record<DialerSecret, string>>;
  call: PhoneCall;
  values: Record<string, string | null>;
  /** Record the call (the dialer's recording setting and the workspace policy both allow it). */
  record: boolean;
}

export interface PlaceResult {
  launchUrl?: string | null;
  sipTarget?: string | null;
  providerCallId?: string | null;
  providerStatus?: string | null;
  status?: CallStatus;
}

export interface SampleRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | null;
}

export interface DialerAdapter {
  readonly kind: DialerKind;
  capabilities(d: Dialer, config: DialerConfig): DialerCapabilities;
  place(ctx: DialContext): Promise<PlaceResult>;
  /** In-call controls the dialer supports. Others say why they cannot. */
  control(ctx: DialContext, action: CallControlInput['action'], hooks: { recordingCallback: string }): Promise<void>;
  test(ctx: Omit<DialContext, 'call'> & { call: null }): Promise<DialerTestResult>;
}

/** A record of each provider request, for the dialer's integration log. */
export type LogFn = (entry: { action: 'TEST' | 'PLACE' | 'HANGUP' | 'EVENT' | 'RECORDING' | 'WEBHOOK' | 'TOKEN'; ok: boolean; httpStatus?: number | null; message: string; attempt?: number; durationMs?: number | null }) => Promise<void>;

export const configOf = (d: Dialer): DialerConfig => dialerConfigSchema.parse({ ...((d.config as object | null) ?? {}), urlTemplate: d.urlTemplate ?? (d.config as Record<string, unknown> | null)?.urlTemplate ?? null, agentPhone: d.agentPhone ?? (d.config as Record<string, unknown> | null)?.agentPhone ?? null });

const unsupported = (what: string, provider: string) => new DialerError(`${what} is not available with ${provider}.`);

class LinkAdapter implements DialerAdapter {
  readonly kind = 'LINK' as const;
  capabilities(d: Dialer): DialerCapabilities {
    return { ...providerOf(d).capabilities, sendsDetails: providerOf(d).capabilities.sendsDetails || !!d.webhookUrl };
  }
  async place(ctx: DialContext): Promise<PlaceResult> {
    return { launchUrl: fillDialerTemplate(ctx.config.urlTemplate ?? 'tel:{phoneE164}', ctx.values), status: 'OPEN' };
  }
  async control(ctx: DialContext, action: CallControlInput['action']): Promise<void> {
    // The call runs in another app: SampForce can only note that it ended.
    if (action !== 'HANGUP') throw unsupported(controlName(action), providerOf(ctx.dialer).name);
  }
  async test(ctx: Omit<DialContext, 'call'> & { call: null }): Promise<DialerTestResult> {
    const link = fillDialerTemplate(ctx.config.urlTemplate ?? 'tel:{phoneE164}', ctx.values);
    return {
      ok: true,
      status: 'NOT_TESTABLE',
      message: 'A link opens on your device, so it cannot be tested from the server. Place a call to try it: the link below is what opens.',
      steps: [{ label: 'The link is complete', ok: true, detail: link }],
      sample: { link, request: null },
    };
  }
}

/** Ready-made settings for any provider with a click-to-call API. */
@Injectable()
export class ApiAdapter implements DialerAdapter {
  readonly kind = 'API' as const;
  constructor(
    @Inject(API_ENV) private readonly env: ApiEnv,
    @Inject(SECRET_BOX) private readonly box: SecretBox,
    private readonly prisma: PrismaService,
  ) {}

  capabilities(d: Dialer, config: DialerConfig): DialerCapabilities {
    const p = providerOf(d).capabilities;
    return { ...p, endCalls: p.endCalls && !!config.hangupPath, recordings: p.recordings && config.recording !== 'OFF', incoming: p.incoming && config.allowIncoming, callerIdChoice: p.callerIdChoice && config.callerIds.length > 1, historySync: p.historySync && config.historySync };
  }

  /** The request a call sends, with every placeholder filled in. Secrets stay out of `shown`. */
  build(config: DialerConfig, secrets: DialContext['secrets'], values: Record<string, string | null>, path: string, withBody: boolean, token: string | null): { req: SampleRequest; shown: SampleRequest } {
    const base = (config.apiBaseUrl ?? '').replace(/\/+$/, '');
    const url = `${base}${fillDialerTemplate(path.startsWith('/') ? path : `/${path}`, values, 'url')}`;
    const headers: Record<string, string> = { accept: 'application/json', 'user-agent': 'SampForce-Calls/1.0' };
    const shownHeaders: Record<string, string> = { ...headers };
    const auth = (name: string, value: string, hidden: string) => {
      headers[name] = value;
      shownHeaders[name] = hidden;
    };
    if (config.apiAuth === 'BASIC') auth('authorization', `Basic ${Buffer.from(`${config.apiUser ?? ''}:${secrets.apiSecret ?? ''}`).toString('base64')}`, `Basic ${config.apiUser ?? ''}:••••••`);
    if (config.apiAuth === 'BEARER') auth('authorization', `Bearer ${secrets.accessToken ?? secrets.apiSecret ?? ''}`, 'Bearer ••••••');
    if (config.apiAuth === 'OAUTH2') auth('authorization', `Bearer ${token ?? ''}`, 'Bearer ••••••');
    if (config.apiAuth === 'HEADER' && config.apiHeaderName) {
      auth(config.apiHeaderName.toLowerCase(), secrets.apiSecret ?? '', '••••••');
      // A second key some providers want (Knowlarity's Authorization) goes in Authorization.
      if (config.apiUser) auth('authorization', config.apiUser, '••••••');
    }
    let body: string | null = null;
    let finalUrl = url;
    if (withBody && config.apiBody) {
      if (config.apiContentType === 'FORM') {
        const filled = fillDialerTemplate(config.apiBody, values, 'form');
        if (config.apiMethod === 'GET') finalUrl = `${url}${url.includes('?') ? '&' : '?'}${filled}`;
        else body = filled;
        headers['content-type'] = shownHeaders['content-type'] = 'application/x-www-form-urlencoded';
      } else {
        body = fillDialerTemplate(config.apiBody, values, 'json');
        try {
          JSON.parse(body);
        } catch {
          throw new DialerError('The request is not valid JSON once the call details are filled in. Check the quotes and brackets.');
        }
        headers['content-type'] = shownHeaders['content-type'] = 'application/json';
      }
    }
    const method = withBody ? config.apiMethod : 'GET';
    return { req: { method, url: finalUrl, headers, body: method === 'GET' ? null : body }, shown: { method, url: finalUrl, headers: shownHeaders, body: method === 'GET' ? null : body } };
  }

  /** Sends a request to the provider: SSRF-guarded, 10 s timeout, retried when the provider is briefly unavailable. */
  async send(req: SampleRequest, log: LogFn, action: 'PLACE' | 'HANGUP' | 'TEST' | 'RECORDING', retries = action === 'PLACE' ? 1 : 2): Promise<{ status: number; json: unknown; text: string }> {
    let url: URL;
    try {
      url = await assertPublicUrl(req.url, this.env.ALLOW_PRIVATE_NETWORK_TARGETS);
    } catch (e) {
      const msg = e instanceof UnsafeTargetError ? `The provider’s address cannot be used: ${e.message}.` : 'The provider’s address is not valid.';
      await log({ action, ok: false, message: msg });
      throw new DialerError(msg);
    }
    for (let attempt = 1; ; attempt++) {
      const t0 = Date.now();
      try {
        const res = await publicFetch(url, { method: req.method, headers: req.headers, body: req.body ?? undefined, redirect: 'manual', signal: AbortSignal.timeout(10_000) }, this.env.ALLOW_PRIVATE_NETWORK_TARGETS);
        const text = (await res.text()).slice(0, 20_000);
        let json: unknown = null;
        try {
          json = text ? JSON.parse(text) : null;
        } catch {
          json = null;
        }
        const ok = res.status >= 200 && res.status < 300;
        // 429 and 503 mean "not now": safe to try again, the provider did nothing.
        if (!ok && (res.status === 429 || res.status === 503) && attempt <= retries) {
          await log({ action, ok: false, httpStatus: res.status, message: `The provider answered ${res.status}; trying again.`, attempt, durationMs: Date.now() - t0 });
          await sleep(400 * attempt);
          continue;
        }
        await log({ action, ok, httpStatus: res.status, message: ok ? 'The provider accepted the request.' : `The provider answered ${res.status}: ${providerMessage(json, text)}`, attempt, durationMs: Date.now() - t0 });
        if (!ok) throw new DialerError(res.status === 401 || res.status === 403 ? `The provider refused the keys (${res.status}). Check the dialer’s keys.` : `The provider answered ${res.status}: ${providerMessage(json, text)}`, res.status);
        return { status: res.status, json, text };
      } catch (e) {
        if (e instanceof DialerError) throw e;
        // No answer at all: nothing reached the provider, so trying again cannot place the call twice.
        if (attempt <= retries) {
          await log({ action, ok: false, message: 'The provider could not be reached; trying again.', attempt, durationMs: Date.now() - t0 });
          await sleep(400 * attempt);
          continue;
        }
        await log({ action, ok: false, message: 'The provider could not be reached.', attempt, durationMs: Date.now() - t0 });
        throw new DialerError('The provider could not be reached. Try again shortly.');
      }
    }
  }

  /** OAuth 2: a token from the token address (client credentials, or the refresh token), kept sealed until it runs out. */
  async token(ctx: Pick<DialContext, 'dialer' | 'config' | 'secrets'>, log: LogFn, fresh = false): Promise<string | null> {
    if (ctx.config.apiAuth !== 'OAUTH2') return null;
    const d = ctx.dialer;
    if (!fresh && d.oauthTokenEncrypted && d.oauthExpiresAt && d.oauthExpiresAt.getTime() > Date.now() + 60_000) return this.box.open(d.oauthTokenEncrypted);
    if (!ctx.config.tokenUrl || !ctx.config.clientId) throw new DialerError('Enter the token address and client id.');
    const form: Record<string, string> = ctx.secrets.refreshToken ? { grant_type: 'refresh_token', refresh_token: ctx.secrets.refreshToken } : { grant_type: 'client_credentials' };
    const req: SampleRequest = {
      method: 'POST',
      url: ctx.config.tokenUrl,
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json', authorization: `Basic ${Buffer.from(`${ctx.config.clientId}:${ctx.secrets.clientSecret ?? ''}`).toString('base64')}` },
      body: new URLSearchParams(form).toString(),
    };
    let r: { json: unknown };
    try {
      r = await this.send(req, (e) => log({ ...e, action: 'TOKEN' }), 'TEST', 1);
    } catch (e) {
      throw new DialerError(`Could not get a sign-in token from the provider: ${(e as Error).message}`);
    }
    const access = pickPath(r.json, 'access_token');
    if (!access) throw new DialerError('The provider’s token answer had no access_token.');
    const expires = Number(pickPath(r.json, 'expires_in')) || 3600;
    await this.prisma.run({ tenantId: d.tenantId }, (tx) => tx.dialer.update({ where: { id: d.id }, data: { oauthTokenEncrypted: this.box.seal(access), oauthExpiresAt: new Date(Date.now() + expires * 1000) } }));
    return access;
  }

  async place(ctx: DialContext & { log?: LogFn }): Promise<PlaceResult> {
    const log = ctx.log ?? (async () => {});
    const go = async (fresh: boolean) => {
      const token = await this.token(ctx, log, fresh);
      const { req } = this.build(ctx.config, ctx.secrets, ctx.values, ctx.config.callPath ?? '/', true, token);
      return this.send(req, log, 'PLACE');
    };
    let r;
    try {
      r = await go(false);
    } catch (e) {
      // An OAuth token the provider no longer accepts: get a new one once.
      if (ctx.config.apiAuth === 'OAUTH2' && e instanceof DialerError && e.httpStatus === 401) r = await go(true);
      else throw e;
    }
    const providerCallId = pickPath(r.json, ctx.config.responseCallIdPath) ?? pickPath(r.json, 'id') ?? pickPath(r.json, 'call_id') ?? pickPath(r.json, 'Call.Sid') ?? pickPath(r.json, 'sid');
    return { providerCallId, providerStatus: 'requested', status: 'RINGING' };
  }

  async control(ctx: DialContext & { log?: LogFn }, action: CallControlInput['action']): Promise<void> {
    if (action !== 'HANGUP' || !ctx.config.hangupPath) throw unsupported(controlName(action), providerOf(ctx.dialer).name);
    if (!ctx.call.providerCallId && /\{providerCallId\}/.test(ctx.config.hangupPath)) throw new DialerError('The provider did not give this call an id, so it cannot be ended from SampForce. End it on your phone.');
    const log = ctx.log ?? (async () => {});
    const token = await this.token(ctx, log);
    const { req } = this.build({ ...ctx.config, apiMethod: 'POST' }, ctx.secrets, { ...ctx.values, providerCallId: ctx.call.providerCallId }, ctx.config.hangupPath, false, token);
    // Ending a call is a DELETE for most REST providers.
    await this.send({ ...req, method: 'DELETE' }, (e) => log({ ...e, action: 'HANGUP' }), 'HANGUP');
  }

  async test(ctx: Omit<DialContext, 'call'> & { call: null; log?: LogFn }): Promise<DialerTestResult> {
    const log = ctx.log ?? (async () => {});
    const steps: DialerTestResult['steps'] = [];
    let sample: DialerTestResult['sample'] = { link: null, request: null };
    try {
      sample = { link: null, request: this.build(ctx.config, ctx.secrets, ctx.values, ctx.config.callPath ?? '/', true, 'token').shown };
      steps.push({ label: 'The call request is complete', ok: true, detail: `${sample.request!.method} ${sample.request!.url}` });
    } catch (e) {
      steps.push({ label: 'The call request is complete', ok: false, detail: (e as Error).message });
      return { ok: false, status: 'FAILED', message: (e as Error).message, steps, sample };
    }
    const missing = ([['apiSecret', ['BASIC', 'HEADER']], ['clientSecret', ['OAUTH2']]] as const).filter(([k, a]) => (a as readonly string[]).includes(ctx.config.apiAuth) && !ctx.secrets[k]);
    if (ctx.config.apiAuth === 'BEARER' && !ctx.secrets.accessToken && !ctx.secrets.apiSecret) missing.push(['apiSecret', ['BEARER']] as never);
    if (missing.length) {
      steps.push({ label: 'The keys are saved', ok: false, detail: 'Save the API token or secret first.' });
      return { ok: false, status: 'FAILED', message: 'The dialer has no key saved yet.', steps, sample };
    }
    steps.push({ label: 'The keys are saved', ok: true, detail: null });
    try {
      const token = await this.token(ctx, log, true);
      if (ctx.config.apiAuth === 'OAUTH2') steps.push({ label: 'Signed in to the provider', ok: true, detail: 'A token came back from the token address.' });
      if (!ctx.config.testPath) {
        return {
          ok: true,
          status: ctx.config.apiAuth === 'OAUTH2' ? 'CONNECTED' : 'NOT_TESTABLE',
          message: ctx.config.apiAuth === 'OAUTH2' ? 'The provider signed SampForce in. Place a call to try the rest.' : 'This provider has no address for a test that places no call. Place a call to try it: the request below is what is sent.',
          steps,
          sample,
        };
      }
      const { req } = this.build(ctx.config, ctx.secrets, ctx.values, ctx.config.testPath, false, token);
      const r = await this.send(req, log, 'TEST');
      steps.push({ label: 'The provider accepted the keys', ok: true, detail: `${req.method} ${req.url} answered ${r.status}.` });
      return { ok: true, status: 'CONNECTED', message: 'Connected: the provider accepted the keys.', steps, sample };
    } catch (e) {
      steps.push({ label: 'The provider accepted the keys', ok: false, detail: (e as Error).message });
      return { ok: false, status: 'FAILED', message: (e as Error).message, steps, sample };
    }
  }

  /** A recording the provider keeps, read with the dialer's keys. */
  async fetchRecording(ctx: Pick<DialContext, 'dialer' | 'config' | 'secrets'>, url: string, log: LogFn): Promise<{ data: Buffer; contentType: string }> {
    const token = await this.token(ctx, log);
    const { req } = this.build(ctx.config, ctx.secrets, {}, '/', false, token);
    // The provider's recording address is often on another host (a CDN): send the keys only to the provider's own host.
    const sameHost = (() => {
      try {
        return new URL(url).host === new URL(ctx.config.apiBaseUrl ?? '').host;
      } catch {
        return false;
      }
    })();
    const headers = sameHost ? req.headers : { accept: '*/*', 'user-agent': 'SampForce-Calls/1.0' };
    const safe = await assertPublicUrl(url, this.env.ALLOW_PRIVATE_NETWORK_TARGETS).catch(() => {
      throw new DialerError('The recording address cannot be used.');
    });
    const res = await publicFetch(safe, { method: 'GET', headers, redirect: 'manual', signal: AbortSignal.timeout(30_000) }, this.env.ALLOW_PRIVATE_NETWORK_TARGETS).catch(() => null);
    if (!res || res.status < 200 || res.status >= 300) {
      await log({ action: 'RECORDING', ok: false, httpStatus: res?.status ?? null, message: 'The provider did not return the recording.' });
      throw new DialerError('The provider did not return the recording.');
    }
    const data = Buffer.from(await res.arrayBuffer());
    await log({ action: 'RECORDING', ok: true, httpStatus: res.status, message: `Recording fetched (${Math.round(data.length / 1024)} KB).` });
    return { data, contentType: res.headers.get('content-type')?.split(';')[0] ?? 'audio/mpeg' };
  }
}

@Injectable()
export class TwilioAdapter implements DialerAdapter {
  readonly kind = 'TWILIO' as const;
  constructor(private readonly twilio: TwilioClient) {}
  capabilities(d: Dialer, config: DialerConfig): DialerCapabilities {
    return { ...providerOf(d).capabilities, recordings: config.recording !== 'OFF' };
  }
  async place(ctx: DialContext & { twilio: TwilioKeys; statusCallback: string }): Promise<PlaceResult> {
    try {
      const placed = await this.twilio.placeCall(ctx.twilio, { agentPhone: ctx.config.agentPhone!, to: ctx.values.phoneE164!, statusCallback: ctx.statusCallback, record: ctx.record && ctx.config.recording === 'ALWAYS' });
      return { providerCallId: placed.sid, providerStatus: placed.status, status: 'RINGING' };
    } catch (e) {
      if (e instanceof TwilioError) throw new DialerError(`Twilio could not place the call: ${e.message}`);
      throw e;
    }
  }
  async control(ctx: DialContext & { twilio?: TwilioKeys }, action: CallControlInput['action'], hooks: { recordingCallback: string }): Promise<void> {
    if (!ctx.twilio) throw new DialerError('Twilio is not connected any more.');
    if (!ctx.call.providerCallId) throw new DialerError('Twilio did not give this call an id.');
    try {
      if (action === 'HANGUP') return await this.twilio.hangup(ctx.twilio, ctx.call.providerCallId);
      if (action === 'RECORD_START') return await this.twilio.startRecording(ctx.twilio, ctx.call.providerCallId, hooks.recordingCallback);
      if (action === 'RECORD_STOP') return await this.twilio.stopRecording(ctx.twilio, ctx.call.providerCallId);
    } catch (e) {
      if (e instanceof TwilioError) throw new DialerError(e.message);
      throw e;
    }
    throw unsupported(controlName(action), 'Twilio click-to-call');
  }
  async test(ctx: Omit<DialContext, 'call'> & { call: null; twilio?: TwilioKeys | null }): Promise<DialerTestResult> {
    const steps: DialerTestResult['steps'] = [];
    if (!ctx.twilio) return { ok: false, status: 'FAILED', message: 'Twilio is not connected. A workspace admin can connect it in Integrations.', steps: [{ label: 'Twilio is connected', ok: false, detail: null }], sample: { link: null, request: null } };
    try {
      const r = await this.twilio.check(ctx.twilio);
      steps.push({ label: 'Twilio accepted the keys', ok: true, detail: r.friendlyName });
      if (r.trial) steps.push({ label: 'Trial account', ok: false, detail: 'A trial account can only call numbers verified in Twilio.' });
      return { ok: true, status: 'CONNECTED', message: `Connected to Twilio. Calls ring ${ctx.config.agentPhone ?? 'your phone'} first, then come from ${ctx.twilio.fromNumber}.`, steps, sample: { link: null, request: null } };
    } catch (e) {
      const message = e instanceof TwilioError ? e.message : 'Twilio could not be reached.';
      steps.push({ label: 'Twilio accepted the keys', ok: false, detail: message });
      return { ok: false, status: 'FAILED', message, steps, sample: { link: null, request: null } };
    }
  }
}

/** Kinds whose calls run elsewhere (the browser phone, the phone app): the server keeps state only. Part 2 fills them in. */
class DeviceAdapter implements DialerAdapter {
  constructor(readonly kind: 'SIP' | 'SIM') {}
  capabilities(d: Dialer, config: DialerConfig): DialerCapabilities {
    return { ...providerOf(d).capabilities, incoming: providerOf(d).capabilities.incoming && config.allowIncoming, recordings: false };
  }
  async place(ctx: DialContext): Promise<PlaceResult> {
    if (this.kind === 'SIP') return { sipTarget: ctx.values.phoneE164 ?? ctx.values.phoneDigits, status: 'RINGING' };
    return { status: 'REQUESTED' };
  }
  async control(ctx: DialContext, action: CallControlInput['action']): Promise<void> {
    if (this.kind === 'SIM' && action !== 'HANGUP') throw unsupported(controlName(action), 'the phone app');
    if (action.startsWith('RECORD')) throw unsupported(controlName(action), providerOf(ctx.dialer).name);
  }
  async test(): Promise<DialerTestResult> {
    return { ok: true, status: 'NOT_TESTABLE', message: 'This dialer is tested from the device it runs on.', steps: [], sample: { link: null, request: null } };
  }
}

/** The adapter for each kind: the one place a new kind is added. */
@Injectable()
export class DialerAdapters {
  private readonly byKind: Record<DialerKind, DialerAdapter>;
  constructor(
    readonly api: ApiAdapter,
    readonly twilio: TwilioAdapter,
  ) {
    this.byKind = { LINK: new LinkAdapter(), API: api, TWILIO: twilio, SIP: new DeviceAdapter('SIP'), SIM: new DeviceAdapter('SIM') };
  }
  for(kind: string): DialerAdapter {
    return this.byKind[kind as DialerKind] ?? this.byKind.LINK;
  }
}

export function controlName(action: CallControlInput['action']): string {
  return { HANGUP: 'Ending the call', MUTE: 'Mute', UNMUTE: 'Mute', HOLD: 'Hold', RESUME: 'Hold', RECORD_START: 'Recording', RECORD_STOP: 'Recording' }[action];
}

function providerMessage(json: unknown, text: string): string {
  const m = pickPath(json, 'message') ?? pickPath(json, 'error.message') ?? pickPath(json, 'error_description') ?? pickPath(json, 'RestException.Message') ?? pickPath(json, 'error');
  return (m ?? (text.replace(/<[^>]+>/g, ' ').trim().slice(0, 160) || 'no details')).slice(0, 300);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Signs a webhook body the way dialers check it: HMAC-SHA256 of "timestamp.body". */
export function signWebhook(secret: string, body: string, t = Math.floor(Date.now() / 1000)): string {
  return `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;
}

export type { DialerStatus, Prisma };
