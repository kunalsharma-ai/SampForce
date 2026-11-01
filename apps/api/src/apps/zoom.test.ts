import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { ApiEnv } from '../common/env';
import { parseZoomVtt, ZoomClient } from './zoom';

const client = new ZoomClient({ ZOOM_WEBHOOK_SECRET_TOKEN: 's3cret' } as ApiEnv);
const sign = (body: string, ts: string, secret = 's3cret') => `v0=${createHmac('sha256', secret).update(`v0:${ts}:${body}`).digest('hex')}`;

describe('Zoom event signatures', () => {
  const now = 1_700_000_000_000;
  const ts = String(now / 1000);
  const body = Buffer.from('{"event":"x"}');

  it('accepts Zoom’s v0 signature and refuses tampering, other secrets and old timestamps', () => {
    expect(client.verifySignature(body, ts, sign(body.toString(), ts), now)).toBe(true);
    expect(client.verifySignature(Buffer.from('{"event":"y"}'), ts, sign(body.toString(), ts), now)).toBe(false);
    expect(client.verifySignature(body, ts, sign(body.toString(), ts, 'other'), now)).toBe(false);
    expect(client.verifySignature(body, ts, sign(body.toString(), ts), now + 10 * 60_000)).toBe(false);
    expect(client.verifySignature(body, undefined, sign(body.toString(), ts), now)).toBe(false);
  });

  it('answers URL validation with HMAC-SHA256 of the plain token', () => {
    expect(client.urlValidation('abc')).toEqual({ plainToken: 'abc', encryptedToken: createHmac('sha256', 's3cret').update('abc').digest('hex') });
  });
});

describe('parseZoomVtt', () => {
  it('keeps speakers and times, and copes with cues without a name', () => {
    const r = parseZoomVtt('WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.500\nAda: Hello there\n\n2\n01:00:03.000 --> 01:00:04.000\nno speaker line\n');
    expect(r.text).toBe('Ada: Hello there\nno speaker line');
    expect(r.segments).toEqual([
      { speaker: 0, start: 1, end: 2.5, text: 'Hello there' },
      { speaker: null, start: 3603, end: 3604, text: 'no speaker line' },
    ]);
  });
});
