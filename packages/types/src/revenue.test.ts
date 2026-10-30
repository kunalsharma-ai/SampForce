import { describe, expect, it } from 'vitest';
import { daysBetween, formatReference, lineTotals, needsDiscountApproval, quoteTotals } from './commercial';
import { campaignRatios, formSubmissionSchema, segmentInputSchema } from './marketing';
import { customerHealth, salesVelocity, toBase, winRate } from './revenue';

describe('quote maths', () => {
  it('rounds per line and adds up exactly', () => {
    expect(lineTotals({ quantity: 3, unitPrice: 33.333, discountPercent: 10, taxPercent: 18 })).toEqual({ gross: 100, discount: 10, net: 90, tax: 16.2 });
    const t = quoteTotals([
      { quantity: 2, unitPrice: 1000, discountPercent: 0, taxPercent: 0 },
      { quantity: 1, unitPrice: 500, discountPercent: 15, taxPercent: 10 },
    ]);
    expect(t).toEqual({ subtotal: 2500, discountTotal: 75, taxTotal: 42.5, total: 2467.5, maxDiscountPercent: 15 });
  });

  it('asks for approval only above the threshold', () => {
    expect(needsDiscountApproval(10, 10)).toBe(false);
    expect(needsDiscountApproval(10.01, 10)).toBe(true);
  });

  it('formats references and day counts', () => {
    expect(formatReference('Q', 7)).toBe('Q-0007');
    expect(formatReference('Q', 7, 2)).toBe('Q-0007 v2');
    expect(daysBetween('2026-10-30', '2026-11-29')).toBe(30);
  });
});

describe('segments and forms', () => {
  it('validates rules against the field catalogue', () => {
    const ok = segmentInputSchema.safeParse({ name: 'Hot', entity: 'lead', rules: { match: 'all', rules: [{ field: 'estimatedValue', op: 'gte', value: 50000 }, { field: 'status', op: 'eq', value: 'NEW' }] } });
    expect(ok.success).toBe(true);
    const bad = segmentInputSchema.safeParse({ name: 'Bad', entity: 'contact', rules: { match: 'all', rules: [{ field: 'estimatedValue', op: 'gte', value: 1 }, { field: 'marketingConsent', op: 'eq', value: 'MAYBE' }] } });
    expect(bad.success).toBe(false);
    expect(bad.error!.issues.map((i) => i.message)).toEqual(['Unknown field estimatedValue', 'Choose one of UNKNOWN, OPTED_IN, OPTED_OUT']);
  });

  it('builds a submission schema from the form fields and rejects bots', () => {
    const schema = formSubmissionSchema([
      { key: 'fullName', label: 'Full name', required: true },
      { key: 'email', label: 'Email', required: true },
      { key: 'phone', label: 'Phone', required: false },
    ]);
    expect(schema.parse({ fullName: ' Ada ', email: 'ADA@x.io', phone: '', consent: true })).toEqual({ fullName: 'Ada', email: 'ada@x.io', phone: undefined, consent: true });
    expect(schema.safeParse({ fullName: 'Ada', email: 'ada@x.io', website: 'http://spam' }).success).toBe(false);
    expect(schema.safeParse({ fullName: 'Ada' }).success).toBe(false);
  });

  it('computes campaign ratios only when there is a budget', () => {
    expect(campaignRatios(1000, 4, 5000)).toEqual({ costPerLead: 250, returnOnSpend: 5 });
    expect(campaignRatios(null, 4, 5000)).toEqual({ costPerLead: null, returnOnSpend: null });
  });
});

describe('revenue and health', () => {
  it('converts with known rates only', () => {
    const rates = new Map([['EUR', 1.1]]);
    expect(toBase(100, 'USD', 'USD', rates)).toBe(100);
    expect(toBase(100, 'EUR', 'USD', rates)).toBe(110);
    expect(toBase(100, 'GBP', 'USD', rates)).toBeNull();
  });

  it('measures win rate and velocity', () => {
    expect(winRate(3, 1)).toBe(75);
    expect(winRate(0, 0)).toBeNull();
    expect(salesVelocity(10, 50, 2000, 40)).toBe(250);
    expect(salesVelocity(10, null, 2000, 40)).toBeNull();
  });

  it('scores customer health from explained signals', () => {
    expect(customerHealth({ lastActivityDays: 3, openEscalations: [], daysToRenewal: 200, renewalInProgress: false, overdueTasks: 0 })).toEqual({ score: 100, band: 'healthy', signals: [] });
    const risky = customerHealth({ lastActivityDays: 75, openEscalations: ['HIGH'], daysToRenewal: 20, renewalInProgress: false, overdueTasks: 4 });
    expect(risky.signals.map((s) => s.key)).toEqual(['quiet_60', 'escalation_high', 'renewal_30', 'overdue_tasks']);
    expect(risky).toMatchObject({ score: 10, band: 'at_risk' });
    expect(customerHealth({ lastActivityDays: 5, openEscalations: [], daysToRenewal: 20, renewalInProgress: true, overdueTasks: 0 }).score).toBe(100);
  });
});
