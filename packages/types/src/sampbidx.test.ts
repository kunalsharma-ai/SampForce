import { describe, expect, it } from 'vitest';
import { parsePastedEmail, sampbidxSendPastedEmailSchema } from './sampbidx';

describe('parsePastedEmail', () => {
  it('reads the header block Outlook puts on a copied email', () => {
    const p = parsePastedEmail(
      [
        'From: Jonas Weber <jonas.weber@bluehill-insights.example>',
        'Sent: Monday, November 24, 2026 8:12 AM',
        'To: Anita Desai <anita@northwind.example>; Ops <ops@northwind.example>',
        'Cc: projects@bluehill-insights.example',
        'Subject: RFQ: UK grocery shoppers tracker W3',
        '',
        'Hi Anita,',
        'We need n=1,000 UK adults, LOI 12.',
      ].join('\r\n'),
    );
    expect(p.subject).toBe('RFQ: UK grocery shoppers tracker W3');
    expect(p.from).toBe('Jonas Weber <jonas.weber@bluehill-insights.example>');
    expect(p.fromEmail).toBe('jonas.weber@bluehill-insights.example');
    expect(p.to).toEqual(['anita@northwind.example', 'ops@northwind.example']);
    expect(p.cc).toEqual(['projects@bluehill-insights.example']);
    expect(p.date?.getFullYear()).toBe(2026);
    expect(p.date?.getMonth()).toBe(10);
    expect(p.date?.getDate()).toBe(24);
  });

  it('reads a Gmail forwarded message with an RFC date', () => {
    const p = parsePastedEmail(
      ['---------- Forwarded message ---------', 'From: Priya Nair <priya@acme.example>', 'Date: Mon, 24 Nov 2026 08:12:00 +0000', 'Subject: Quote needed: India B2B', 'To: <rahul@fr.example>', '', 'Body'].join('\n'),
    );
    expect(p.subject).toBe('Quote needed: India B2B');
    expect(p.fromEmail).toBe('priya@acme.example');
    expect(p.date?.toISOString()).toBe('2026-11-24T08:12:00.000Z');
  });

  it('reads the Gmail screen layout: subject line, then the sender', () => {
    const p = parsePastedEmail(['RFQ for 500 completes in Germany', 'Inbox', '', 'Lena Vogel <lena@marktblick.example>', 'Nov 24, 2026, 9:05 AM (2 hours ago)', 'to me', '', 'Hello, please quote…'].join('\n'));
    expect(p.subject).toBe('RFQ for 500 completes in Germany');
    expect(p.from).toBe('Lena Vogel <lena@marktblick.example>');
    expect(p.fromEmail).toBe('lena@marktblick.example');
    expect(p.date?.getDate()).toBe(24);
  });

  it('finds nothing in a plain body, without guessing', () => {
    const p = parsePastedEmail('Hi team, we need a quote for 300 nurses in the US, LOI 20 minutes. Thanks, Sam (sam@client.example)');
    expect(p).toEqual({ subject: null, from: null, fromEmail: null, to: [], cc: [], date: null });
  });
});

describe('sampbidxSendPastedEmailSchema', () => {
  it('needs the company and real email text, and logs an interaction unless told not to', () => {
    const companyId = '6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b';
    expect(sampbidxSendPastedEmailSchema.safeParse({ companyId, text: 'too short' }).success).toBe(false);
    const ok = sampbidxSendPastedEmailSchema.parse({ companyId, text: 'Please quote 1,000 UK adults, LOI 12.' });
    expect(ok.logInteraction).toBe(true);
    expect(sampbidxSendPastedEmailSchema.safeParse({ companyId: 'x', text: 'Please quote 1,000 UK adults, LOI 12.' }).success).toBe(false);
  });
});
