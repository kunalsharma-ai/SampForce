import { describe, expect, it } from 'vitest';
import { CALL_OUTCOMES, callingCodeOf, callWindow, DEFAULT_CALL_OUTCOMES, dialable, dialerApiProblem, dialerInputSchema, DIALER_PROVIDERS, dialerTemplateProblem, e164, fillDialerTemplate, mergeOutcomes, pickPath, providerOf, readProviderEvent } from './calls';

describe('calls (ADR 0088)', () => {
  it('says whether it is a good time to call on their clock', () => {
    // 2026-11-26 is a Thursday. 05:00 UTC is 10:30 in India, 00:00 in New York, 14:00 in Tokyo.
    const at = new Date('2026-11-26T05:00:00Z');
    expect(callWindow('Asia/Kolkata', at)).toEqual({ timeZone: 'Asia/Kolkata', time: '10:30', weekday: 'Thu', offsetMinutes: 330, kind: 'GOOD', good: true });
    expect(callWindow('America/New_York', at)).toMatchObject({ time: '00:00', kind: 'EARLY', good: false, offsetMinutes: -300 });
    expect(callWindow('Asia/Tokyo', at)).toMatchObject({ time: '14:00', kind: 'GOOD' });
    expect(callWindow('Asia/Tokyo', new Date('2026-11-26T04:30:00Z'))).toMatchObject({ time: '13:30', kind: 'LUNCH', good: false });
    expect(callWindow('Europe/London', new Date('2026-11-26T18:00:00Z'))).toMatchObject({ kind: 'LATE' });
    expect(callWindow('Europe/London', new Date('2026-11-28T11:00:00Z'))).toMatchObject({ weekday: 'Sat', kind: 'WEEKEND' });
    expect(callWindow(null)).toBeNull();
    expect(callWindow('Not/AZone')).toBeNull();
  });

  it('writes numbers in international form when it can', () => {
    expect(e164('+91 98200 12345')).toBe('+919820012345');
    expect(e164('0044 20 7946 0018')).toBe('+442079460018');
    expect(e164('022 4000 1000')).toBeNull();
    expect(dialable('022 4000 1000')).toBe('02240001000');
    expect(dialable('+44 (20) 7946-0018')).toBe('+442079460018');
  });

  it('fills dialer links: a web address keeps + encoded, a phone link keeps it as is', () => {
    const v = { phoneE164: '+919820012345', employeeName: 'Priya Nair', companyName: 'Acme & Co' };
    expect(fillDialerTemplate('tel:{phoneE164}', v)).toBe('tel:+919820012345');
    expect(fillDialerTemplate('https://d.example/call?n={phoneE164}&who={employeeName}&co={companyName}', v)).toBe('https://d.example/call?n=%2B919820012345&who=Priya%20Nair&co=Acme%20%26%20Co');
    expect(fillDialerTemplate('callto:{phoneE164}?x={designation}', v)).toBe('callto:+919820012345?x=');
  });

  it('refuses dialer links that cannot place a call', () => {
    expect(dialerTemplateProblem('tel:{phone}')).toBeNull();
    expect(dialerTemplateProblem('myapp://dial/{phoneDigits}')).toBeNull();
    expect(dialerTemplateProblem('javascript:alert({phone})')).toMatch(/cannot place a call/);
    expect(dialerTemplateProblem('DATA:text/html,{phone}')).toMatch(/cannot place a call/);
    expect(dialerTemplateProblem('https://d.example/call')).toMatch(/where the number goes/);
    expect(dialerTemplateProblem('{phone}')).toMatch(/scheme/);
    expect(dialerTemplateProblem('tel:{phone}&{secret}')).toMatch(/Unknown placeholder \{secret\}/);
    expect(dialerInputSchema.safeParse({ name: 'T', kind: 'TWILIO' }).success).toBe(false);
    expect(dialerInputSchema.safeParse({ name: 'T', kind: 'TWILIO', agentPhone: '+44 7700 900200' }).success).toBe(true);
    expect(dialerInputSchema.safeParse({ name: 'L', kind: 'LINK', urlTemplate: 'tel:{phone}', webhookUrl: 'ftp://x' }).success).toBe(false);
  });

});

describe('the universal dialer (ADR 0101)', () => {
  it('adds the dialer’s country code to numbers written without one', () => {
    expect(e164('098111 22334', '+91')).toBe('+919811122334');
    expect(e164('+44 20 7946 0018', '+91')).toBe('+442079460018');
    expect(callingCodeOf('+971 4 000 0000')).toBe('+971');
  });

  it('fills a provider’s request for a form, JSON or a path', () => {
    const v = { phoneE164: '+919811122334', employeeName: 'Priya "PM" Nair', callId: 'c-1' };
    expect(fillDialerTemplate('To={phoneE164}&Name={employeeName}', v, 'form')).toBe('To=%2B919811122334&Name=Priya%20%22PM%22%20Nair');
    expect(JSON.parse(fillDialerTemplate('{"to":"{phoneE164}","name":"{employeeName}"}', v, 'json'))).toEqual({ to: '+919811122334', name: 'Priya "PM" Nair' });
    expect(fillDialerTemplate('/calls/{callId}', v, 'url')).toBe('/calls/c-1');
  });

  it('checks a cloud dialer’s request before it is saved', () => {
    expect(dialerApiProblem({ apiBaseUrl: 'ftp://x', callPath: '/c' })?.field).toBe('apiBaseUrl');
    expect(dialerApiProblem({ apiBaseUrl: 'https://api.example.com', callPath: '/c', apiBody: '{}' })?.field).toBe('apiBody');
    expect(dialerApiProblem({ apiBaseUrl: 'https://api.example.com', callPath: '/c', apiBody: '{"to":"{phoneE164}","x":"{nope}"}' })?.message).toContain('{nope}');
    expect(dialerApiProblem({ apiBaseUrl: 'https://api.example.com', callPath: '/c', apiBody: 'To={phoneE164}&App={appId}' }, ['appId'])).toBeNull();
    const ok = dialerInputSchema.safeParse({ name: 'Exotel', kind: 'API', provider: 'exotel', agentPhone: '+91 98200 00001', config: { ...DIALER_PROVIDERS.find((p) => p.key === 'exotel')!.preset, account: 'acme', apiUser: 'key', callerIds: ['+91 80 4000 1000'] } });
    expect(ok.success).toBe(true);
    expect(dialerInputSchema.safeParse({ name: 'A', kind: 'API', config: { apiBaseUrl: 'https://a.example', callPath: '/c', apiBody: '{"to":"{phoneE164}"}', apiAuth: 'OAUTH2' } }).success).toBe(false);
  });

  it('knows the provider of dialers saved before providers existed', () => {
    expect(providerOf({ kind: 'TWILIO' }).key).toBe('twilio');
    expect(providerOf({ kind: 'LINK' }).key).toBe('custom');
    expect(providerOf({ provider: 'exotel', kind: 'API' }).name).toBe('Exotel');
  });

  it('reads provider events in the shapes providers send them', () => {
    expect(readProviderEvent({ CallSid: 'EX1', Status: 'completed', Duration: '87', RecordingUrl: 'https://r.example/1.mp3' })).toMatchObject({ providerCallId: 'EX1', status: 'ENDED', durationSec: 87, recordingUrl: 'https://r.example/1.mp3' });
    expect(readProviderEvent({ event: 'call.answered', data: { id: 42, direction: 'inbound', raw_digits: '+44 20 7946 0018' } })).toMatchObject({ providerCallId: '42', status: 'IN_PROGRESS', direction: 'INCOMING', from: '+44 20 7946 0018' });
    expect(readProviderEvent({ Status: 'no-answer', CustomField: '0B7C2A3E-1111-4222-8333-944455556666' })).toMatchObject({ status: 'FAILED', callId: '0b7c2a3e-1111-4222-8333-944455556666' });
    expect(pickPath({ Call: { Sid: 'X' } }, 'Call.Sid')).toBe('X');
  });

  it('has the 17 outcomes, never counts an unanswered call as reached, and keeps a workspace’s own', () => {
    expect(CALL_OUTCOMES.filter((o) => o !== 'VOICEMAIL')).toHaveLength(17);
    for (const k of ['NOT_PICKED', 'NO_ANSWER', 'BUSY', 'WRONG_NUMBER']) expect(DEFAULT_CALL_OUTCOMES.find((d) => d.key === k)!.reached).toBe(false);
    const merged = mergeOutcomes({ BUSY: { label: 'Line engaged' } }, [{ ...DEFAULT_CALL_OUTCOMES[0]!, key: 'CUSTOM_GATEKEEPER', label: 'Gatekeeper' }]);
    expect(merged.find((o) => o.key === 'BUSY')).toMatchObject({ label: 'Line engaged', custom: false });
    expect(merged.at(-1)).toMatchObject({ key: 'CUSTOM_GATEKEEPER', custom: true });
  });
});
