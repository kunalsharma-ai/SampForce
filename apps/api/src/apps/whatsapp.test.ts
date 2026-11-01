import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { ApiEnv } from '../common/env';
import { describeError, WhatsappClient, waNumber } from './whatsapp';

const client = new WhatsappClient({ WHATSAPP_API_BASE_URL: 'http://graph.invalid' } as ApiEnv);
const keys = { phoneNumberId: '111', wabaId: '222', accessToken: 'EAAx', appSecret: 'secret' };
const sign = (b: string, s = 'secret') => `sha256=${createHmac('sha256', s).update(b).digest('hex')}`;

describe('waNumber', () => {
  it('uses only numbers written with a country code', () => {
    expect(waNumber('+44 7700 900456')).toEqual({ phone: '447700900456', problem: null });
    expect(waNumber('0044 (7700) 900-456')).toEqual({ phone: '447700900456', problem: null });
    expect(waNumber('07700 900456').problem).toContain('country code');
    expect(waNumber('+0 123').problem).toContain('valid international number');
    expect(waNumber(null).problem).toContain('no phone number');
  });
});

describe('WhatsApp webhooks', () => {
  const body = JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [
      { changes: [{ field: 'messages', value: { metadata: { phone_number_id: '111' }, contacts: [{ wa_id: '4477', profile: { name: 'Gia' } }], messages: [{ id: 'm1', from: '4477', timestamp: '1700000000', type: 'text', text: { body: 'hi' } }, { id: 'm2', from: '4477', timestamp: '1700000001', type: 'image' }], statuses: [{ id: 'w1', status: 'failed', timestamp: '1700000002', errors: [{ code: 131047 }] }, { id: 'w2', status: 'deleted', timestamp: '1' }] } }] },
      { changes: [{ field: 'messages', value: { metadata: { phone_number_id: '999' }, messages: [{ id: 'm3', from: '1', timestamp: '1', type: 'text', text: { body: 'other number' } }] } }] },
    ],
  });

  it('reads text, labels other message types, skips other numbers and unknown statuses', () => {
    const w = client.parseWebhook(keys, Buffer.from(body), sign(body));
    expect(w.inbound.map((m) => [m.waMessageId, m.kind, m.body, m.name])).toEqual([
      ['m1', 'text', 'hi', 'Gia'],
      ['m2', 'other', '(image message: open WhatsApp to see it)', 'Gia'],
    ]);
    expect(w.statuses).toEqual([{ waMessageId: 'w1', status: 'failed', at: new Date(1700000002000), error: describeError(131047, undefined) }]);
  });

  it('refuses a missing, wrong or edited signature', () => {
    expect(() => client.parseWebhook(keys, Buffer.from(body), undefined)).toThrow('Signature');
    expect(() => client.parseWebhook(keys, Buffer.from(body), sign(body, 'other'))).toThrow('Signature');
    expect(() => client.parseWebhook(keys, Buffer.from(body.replace('hi', 'ho')), sign(body))).toThrow('Signature');
  });
});
