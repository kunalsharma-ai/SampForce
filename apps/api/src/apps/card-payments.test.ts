import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { ApiEnv } from '../common/env';
import { CardPaymentsClient, toMinorUnits } from './card-payments';

const client = new CardPaymentsClient({ STRIPE_API_BASE_URL: 'http://stripe.invalid', RAZORPAY_API_BASE_URL: 'http://razorpay.invalid' } as ApiEnv);
const stripeKeys = { provider: 'stripe' as const, secretKey: 'sk_test_x', webhookSecret: 'whsec_test' };
const rzpKeys = { provider: 'razorpay' as const, keyId: 'rzp_test_x', keySecret: 'secret', webhookSecret: 'rzp-hook' };

describe('toMinorUnits', () => {
  it('uses cents for most currencies and whole units for zero-decimal ones', () => {
    expect(toMinorUnits(1000, 'USD')).toBe(100000);
    expect(toMinorUnits(19.99, 'inr')).toBe(1999);
    expect(toMinorUnits(0.1 + 0.2, 'EUR')).toBe(30);
    expect(toMinorUnits(5000, 'JPY')).toBe(5000);
  });
  it('refuses three-decimal currencies rather than guessing', () => {
    expect(() => toMinorUnits(10, 'KWD')).toThrow('not supported');
  });
});

describe('parseWebhook', () => {
  const stripeBody = JSON.stringify({ type: 'checkout.session.completed', data: { object: { id: 'cs_1', payment_status: 'paid', payment_intent: 'pi_1', amount_total: 1000, currency: 'usd', metadata: { dealflow_payment_id: 'p1' } } } });
  const sign = (body: string, t: number, secret = 'whsec_test') => `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;
  const now = 1_800_000_000_000;

  it('reads a signed Stripe checkout completion', () => {
    const ev = client.parseWebhook(stripeKeys, Buffer.from(stripeBody), { 'stripe-signature': sign(stripeBody, now / 1000) }, now);
    expect(ev).toEqual({ outcome: 'paid', paymentId: 'p1', providerPaymentId: 'pi_1', payerEmail: null, amountMinor: 1000, currency: 'USD' });
  });

  it('refuses a Stripe event signed with another secret, older than five minutes, or edited', () => {
    expect(() => client.parseWebhook(stripeKeys, Buffer.from(stripeBody), { 'stripe-signature': sign(stripeBody, now / 1000, 'whsec_other') }, now)).toThrow('Signature');
    expect(() => client.parseWebhook(stripeKeys, Buffer.from(stripeBody), { 'stripe-signature': sign(stripeBody, now / 1000 - 301) }, now)).toThrow('Signature');
    expect(() => client.parseWebhook(stripeKeys, Buffer.from(stripeBody.replace('1000', '1')), { 'stripe-signature': sign(stripeBody, now / 1000) }, now)).toThrow('Signature');
    expect(() => client.parseWebhook(stripeKeys, Buffer.from(stripeBody), {}, now)).toThrow('Signature');
  });

  it('does not count an unpaid completion (a delayed bank payment) as paid', () => {
    const body = stripeBody.replace('"paid"', '"unpaid"');
    expect(client.parseWebhook(stripeKeys, Buffer.from(body), { 'stripe-signature': sign(body, now / 1000) }, now).outcome).toBe('ignored');
  });

  it('reads a signed Razorpay payment_link.paid and refuses a bad signature', () => {
    const body = JSON.stringify({ event: 'payment_link.paid', payload: { payment_link: { entity: { reference_id: 'p2', amount: 500, currency: 'INR' } }, payment: { entity: { id: 'pay_1', amount: 500, currency: 'INR', email: 'a@b.test' } } } });
    const sig = createHmac('sha256', 'rzp-hook').update(body).digest('hex');
    expect(client.parseWebhook(rzpKeys, Buffer.from(body), { 'x-razorpay-signature': sig })).toEqual({ outcome: 'paid', paymentId: 'p2', providerPaymentId: 'pay_1', payerEmail: 'a@b.test', amountMinor: 500, currency: 'INR' });
    expect(() => client.parseWebhook(rzpKeys, Buffer.from(body), { 'x-razorpay-signature': sig.replace(/^./, sig[0] === 'a' ? 'b' : 'a') })).toThrow('Signature');
  });
});
