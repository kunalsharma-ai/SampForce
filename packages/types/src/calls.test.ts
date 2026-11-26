import { describe, expect, it } from 'vitest';
import { callWindow, dialable, dialerInputSchema, dialerTemplateProblem, e164, fillDialerTemplate } from './calls';

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
