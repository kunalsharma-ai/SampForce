import { smsSegments } from '@dealflow/types';
import { describe, expect, it } from 'vitest';
import { describeTwilioError, smsNumber, TwilioClient, twilioSignature } from './twilio';

describe('Twilio helpers', () => {
  it('signs the URL followed by the parameters sorted by name, and verifies only an exact match', () => {
    const url = 'https://app.example.com/api/v1/apps/twilio/webhooks/abc/inbound';
    const params = { To: '+447700900100', From: '+447700900456', Body: 'Hi', AccountSid: 'AC1' };
    const sig = twilioSignature('token', url, params);
    // Order of the object does not matter: Twilio sorts by name.
    expect(twilioSignature('token', url, { Body: 'Hi', AccountSid: 'AC1', From: '+447700900456', To: '+447700900100' })).toBe(sig);
    const client = new TwilioClient({} as never);
    const keys = { accountSid: 'AC1', authToken: 'token', fromNumber: '+447700900100' };
    expect(client.verify(keys, url, params, sig)).toBe(true);
    expect(client.verify(keys, url, { ...params, Body: 'Hi!' }, sig)).toBe(false);
    expect(client.verify(keys, `${url}?x=1`, params, sig)).toBe(false);
    expect(client.verify({ ...keys, authToken: 'other' }, url, params, sig)).toBe(false);
    expect(client.verify(keys, url, params, undefined)).toBe(false);
  });

  it('uses only numbers written with a country code', () => {
    expect(smsNumber('+44 7700 900456')).toEqual({ phone: '+447700900456', problem: null });
    expect(smsNumber('0044 7700 900456')).toEqual({ phone: '+447700900456', problem: null });
    expect(smsNumber('07700 900456').problem).toContain('country code');
    expect(smsNumber('').problem).toContain('no phone number');
    expect(smsNumber('+0 123').problem).toContain('valid international');
  });

  it('explains the errors a sender can act on', () => {
    expect(describeTwilioError(21610)).toContain('replied STOP');
    expect(describeTwilioError(30007)).toContain('spam');
    expect(describeTwilioError(99999, 'odd')).toBe('Twilio refused the request (error 99999): odd');
  });

  it('counts SMS segments the way carriers do', () => {
    expect(smsSegments('x'.repeat(160))).toMatchObject({ encoding: 'GSM-7', segments: 1 });
    expect(smsSegments('x'.repeat(161))).toMatchObject({ segments: 2 });
    expect(smsSegments('x'.repeat(306))).toMatchObject({ segments: 2 });
    expect(smsSegments('x'.repeat(307))).toMatchObject({ segments: 3 });
    expect(smsSegments('€'.repeat(81))).toMatchObject({ encoding: 'GSM-7', units: 162, segments: 2 });
    expect(smsSegments('é'.repeat(70))).toMatchObject({ encoding: 'GSM-7', segments: 1 });
    expect(smsSegments('ą'.repeat(70))).toMatchObject({ encoding: 'UCS-2', segments: 1 });
    expect(smsSegments('ą'.repeat(71))).toMatchObject({ encoding: 'UCS-2', segments: 2 });
    expect(smsSegments('😊'.repeat(35))).toMatchObject({ encoding: 'UCS-2', units: 70, segments: 1 });
  });
});
