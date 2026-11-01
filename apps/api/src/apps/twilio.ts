import { createHmac, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { API_ENV, type ApiEnv } from '../common/env';

/** The workspace's own Twilio credentials, sealed at rest. */
export interface TwilioKeys {
  accountSid: string;
  authToken: string;
  fromNumber: string;
}

export class TwilioError extends Error {
  constructor(
    readonly code: string,
    message: string,
    /** The credentials no longer work: the connection needs new ones. */
    readonly revoked = false,
  ) {
    super(message);
  }
}

/** One message as Twilio describes it after a send. */
export interface TwilioSent {
  sid: string;
  segments: number;
}

/** Twilio's message states that mean something to the sender, in the order they move. */
export const SMS_STATUS_RANK: Record<string, number> = { accepted: 0, sent: 1, delivered: 2, undelivered: 3, failed: 3 };

/** Words Twilio treats as an opt-out or opt-in on long codes and toll-free numbers (Advanced Opt-Out defaults). */
export const SMS_STOP_WORDS = new Set(['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT', 'OPTOUT', 'REVOKE']);
export const SMS_START_WORDS = new Set(['START', 'YES', 'UNSTOP', 'OPTIN']);

/**
 * Twilio Programmable Messaging (REST API 2010-04-01) for one workspace's own account and number: check the account
 * and number, send one SMS, and verify Twilio's signed requests. Tested against a local stand-in that follows
 * Twilio's published API; not yet against Twilio.
 */
@Injectable()
export class TwilioClient {
  constructor(@Inject(API_ENV) private readonly env: ApiEnv) {}

  /** Reads that prove the credentials and that the number is on the account and can send SMS. Sends nothing. */
  async check(keys: TwilioKeys): Promise<{ friendlyName: string; trial: boolean }> {
    const account = await this.call<{ friendly_name?: string; status?: string; type?: string }>(keys, 'GET', `/2010-04-01/Accounts/${keys.accountSid}.json`);
    if (account.status && account.status !== 'active') throw new TwilioError('inactive', `This Twilio account is ${account.status}.`);
    const numbers = await this.call<{ incoming_phone_numbers?: { phone_number: string; capabilities?: { sms?: boolean } }[] }>(
      keys,
      'GET',
      `/2010-04-01/Accounts/${keys.accountSid}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(keys.fromNumber)}&PageSize=20`,
    );
    const n = (numbers.incoming_phone_numbers ?? []).find((x) => x.phone_number === keys.fromNumber);
    if (!n) throw new TwilioError('number', `${keys.fromNumber} is not a phone number on this Twilio account.`);
    if (n.capabilities && n.capabilities.sms === false) throw new TwilioError('number', `${keys.fromNumber} cannot send SMS. Choose a number with SMS capability.`);
    return { friendlyName: account.friendly_name ?? 'Twilio', trial: account.type === 'Trial' };
  }

  async send(keys: TwilioKeys, to: string, body: string, statusCallback: string): Promise<TwilioSent> {
    const r = await this.call<{ sid?: string; num_segments?: string }>(keys, 'POST', `/2010-04-01/Accounts/${keys.accountSid}/Messages.json`, {
      To: to,
      From: keys.fromNumber,
      Body: body,
      StatusCallback: statusCallback,
    });
    if (!r.sid) throw new TwilioError('no_sid', 'Twilio did not return a message id.');
    return { sid: r.sid, segments: Math.max(1, Number(r.num_segments ?? 1) || 1) };
  }

  /**
   * Twilio's request signature: base64 HMAC-SHA1, keyed with the Auth Token, of the full URL Twilio called followed
   * by each POST parameter name and value, sorted by name.
   */
  verify(keys: TwilioKeys, url: string, params: Record<string, string>, signature: string | undefined): boolean {
    if (!signature) return false;
    const expected = twilioSignature(keys.authToken, url, params);
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  private async call<T>(keys: TwilioKeys, method: 'GET' | 'POST', path: string, form?: Record<string, string>): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.env.TWILIO_API_BASE_URL.replace(/\/$/, '')}${path}`, {
        method,
        headers: {
          authorization: `Basic ${Buffer.from(`${keys.accountSid}:${keys.authToken}`).toString('base64')}`,
          accept: 'application/json',
          ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
        },
        body: form ? new URLSearchParams(form).toString() : undefined,
        redirect: 'error',
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new TwilioError('unavailable', 'Twilio could not be reached. Try again shortly.');
    }
    const body = (await res.json().catch(() => ({}))) as T & { code?: number; message?: string };
    if (res.ok) return body;
    if (res.status === 401 || body.code === 20003) {
      throw new TwilioError('auth', 'Twilio refused the Account SID and Auth Token. Check them, or paste the new Auth Token if it was rotated.', true);
    }
    throw new TwilioError(`twilio_${body.code ?? res.status}`, describeTwilioError(body.code, body.message));
  }
}

export function twilioSignature(authToken: string, url: string, params: Record<string, string>): string {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, k) => acc + k + params[k], url);
  return createHmac('sha1', authToken).update(Buffer.from(data, 'utf8')).digest('base64');
}

/** Plain-language versions of the Twilio errors a sender can do something about. */
export function describeTwilioError(code: number | undefined, detail?: string | null): string {
  switch (code) {
    case 21211:
      return 'That phone number is not valid.';
    case 21408:
      return 'This Twilio account is not allowed to send SMS to that country. Enable it under Messaging, Geo permissions in the Twilio console.';
    case 21608:
      return 'Twilio trial accounts can only text numbers verified in the Twilio console.';
    case 21610:
      return 'This person replied STOP to your number, so Twilio blocks texts to them until they reply START.';
    case 21612:
    case 21614:
      return 'That number cannot receive SMS (it may be a landline).';
    case 21606:
      return 'Your Twilio number cannot send SMS to this destination.';
    case 30003:
      return 'The phone was unreachable (switched off or out of coverage).';
    case 30004:
      return 'The message was blocked by the recipient or their carrier.';
    case 30005:
      return 'The number does not exist or is no longer in service.';
    case 30006:
      return 'That number is a landline or cannot receive SMS.';
    case 30007:
      return "The recipient's carrier filtered the message as spam. Registering the number (A2P 10DLC in the US) usually fixes this.";
    case 30008:
      return 'The carrier did not deliver the message, without saying why.';
    case 30034:
      return 'US texts from this number are blocked until it is registered for A2P 10DLC.';
    default:
      return `Twilio refused the request${code ? ` (error ${code})` : ''}${detail ? `: ${detail.slice(0, 200)}` : '.'}`;
  }
}

/**
 * A contact's phone in E.164 for SMS. Only numbers written with their country code (+44…, 0044…) are used,
 * since guessing the country could text a stranger.
 */
export function smsNumber(phone: string | null | undefined): { phone: string | null; problem: string | null } {
  if (!phone?.trim()) return { phone: null, problem: 'This contact has no phone number.' };
  const t = phone.trim();
  if (!/^(\+|00)/.test(t)) return { phone: null, problem: 'Add the country code to their phone number (for example +44 7700 900123).' };
  const digits = t.replace(/^00/, '').replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 15 || digits.startsWith('0')) return { phone: null, problem: 'Their phone number does not look like a valid international number.' };
  return { phone: `+${digits}`, problem: null };
}
