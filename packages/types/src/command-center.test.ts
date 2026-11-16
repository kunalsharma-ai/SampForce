import { describe, expect, it } from 'vitest';
import { attributionCredits, attributionRuleOf, creditSplitSchema, DEFAULT_ATTRIBUTION_RULE, normaliseCredits, shareOf } from './attribution';
import { funnelStageOf, monthsOf, periodRange, targetFor } from './command-center';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';

describe('revenue attribution (ADR 0063)', () => {
  it('gives the whole record to the closer until a rule is chosen', () => {
    expect(attributionRuleOf(null)).toEqual(DEFAULT_ATTRIBUTION_RULE);
    expect(attributionRuleOf({ model: 'SHARED', leadCreatorPct: 50, closerPct: 10, accountOwnerPct: 0, supportersPct: 0 })).toEqual(DEFAULT_ATTRIBUTION_RULE);
    expect(attributionCredits(DEFAULT_ATTRIBUTION_RULE, { creatorId: A, closerId: B })).toEqual([{ userId: B, roles: ['DEAL_CLOSURE'], percent: 100 }]);
  });

  it('splits a shared rule, merges one person holding two roles and always sums to 100', () => {
    const rule = attributionRuleOf({ model: 'SHARED', leadCreatorPct: 30, closerPct: 50, accountOwnerPct: 20, supportersPct: 0 });
    const credits = attributionCredits(rule, { creatorId: A, ownerId: B, closerId: A });
    expect(credits).toEqual([
      { userId: A, roles: ['LEAD_GENERATION', 'DEAL_CLOSURE'], percent: 80 },
      { userId: B, roles: ['ACCOUNT_OWNERSHIP'], percent: 20 },
    ]);
    const thirds = attributionCredits(attributionRuleOf({ model: 'SHARED', leadCreatorPct: 0, closerPct: 0, accountOwnerPct: 0, supportersPct: 100 }), { closerId: A, supporters: [A, B, C] });
    expect(thirds.reduce((s, c) => s + c.percent, 0)).toBe(100);
    expect(thirds.map((c) => c.percent).sort()).toEqual([33.33, 33.33, 33.34]);
  });

  it('gives a missing person’s share to the closer, then the owner, then the creator', () => {
    const rule = attributionRuleOf({ model: 'SHARED', leadCreatorPct: 40, closerPct: 60, accountOwnerPct: 0, supportersPct: 0 });
    expect(attributionCredits(rule, { creatorId: null, closerId: B })).toEqual([{ userId: B, roles: ['LEAD_GENERATION', 'DEAL_CLOSURE'], percent: 100 }]);
    expect(attributionCredits(rule, {})).toEqual([{ userId: null, roles: ['LEAD_GENERATION', 'DEAL_CLOSURE'], percent: 100 }]);
    expect(normaliseCredits([])).toEqual([{ userId: null, roles: ['DEAL_CLOSURE'], percent: 100 }]);
  });

  it('accepts a split by hand only when it adds up to 100% with each person once', () => {
    expect(creditSplitSchema.safeParse({ credits: [{ userId: A, percent: 70 }, { userId: B, percent: 30 }] }).success).toBe(true);
    expect(creditSplitSchema.safeParse({ credits: [{ userId: A, percent: 70 }, { userId: B, percent: 20 }] }).error?.issues[0]?.message).toBe('The shares must add up to 100%');
    expect(creditSplitSchema.safeParse({ credits: [{ userId: A, percent: 50 }, { userId: A, percent: 50 }] }).error?.issues[0]?.message).toBe('Each person can appear once');
    expect(shareOf(10_000, 33.33)).toBe(3333);
  });
});

describe('reporting periods', () => {
  const now = new Date('2026-11-16T20:00:00Z'); // already 17 November in Kolkata

  it('works in the viewer’s time zone', () => {
    expect(periodRange('this_month', { tz: 'Asia/Kolkata', now })).toMatchObject({ start: '2026-10-31T18:30:00.000Z', end: '2026-11-30T18:30:00.000Z', fromDay: '2026-11-01', toDay: '2026-11-30' });
    expect(periodRange('last_month', { tz: 'UTC', now })).toMatchObject({ fromDay: '2026-10-01', toDay: '2026-10-31' });
    expect(periodRange('this_month', { tz: 'Pacific/Kiritimati', now: new Date('2026-11-30T12:00:00Z') }).fromDay).toBe('2026-12-01');
  });

  it('covers quarters, halves, years and financial years', () => {
    expect(periodRange('this_quarter', { tz: 'UTC', now })).toMatchObject({ fromDay: '2026-10-01', toDay: '2026-12-31' });
    expect(periodRange('last_quarter', { tz: 'UTC', now })).toMatchObject({ fromDay: '2026-07-01', toDay: '2026-09-30' });
    expect(periodRange('last_quarter', { tz: 'UTC', now: new Date('2026-02-10T00:00:00Z') })).toMatchObject({ fromDay: '2025-10-01', toDay: '2025-12-31' });
    expect(periodRange('h2', { tz: 'UTC', now })).toMatchObject({ fromDay: '2026-07-01', toDay: '2026-12-31' });
    expect(periodRange('this_fy', { tz: 'UTC', now })).toMatchObject({ fromDay: '2026-04-01', toDay: '2027-03-31' });
    expect(periodRange('this_fy', { tz: 'UTC', now: new Date('2026-02-01T00:00:00Z') })).toMatchObject({ fromDay: '2025-04-01', toDay: '2026-03-31' });
    expect(periodRange('last_fy', { tz: 'UTC', now, fyStart: 1 })).toMatchObject({ fromDay: '2025-01-01', toDay: '2025-12-31' });
    expect(periodRange('custom', { tz: 'UTC', now, from: '2026-02-03', to: '2026-02-05' })).toMatchObject({ start: '2026-02-03T00:00:00.000Z', end: '2026-02-06T00:00:00.000Z' });
  });

  it('takes a month’s target from the month, else its quarter, else its year', () => {
    const q = periodRange('this_quarter', { tz: 'UTC', now });
    expect(monthsOf(q)).toEqual(['2026-10', '2026-11', '2026-12']);
    expect(targetFor(['2026-11'], new Map([['2026-11', 900]]))).toBe(900);
    expect(targetFor(['2026-11'], new Map([['2026-Q4', 900]]))).toBe(300);
    expect(targetFor(['2026-11'], new Map([['2026', 1200]]))).toBe(100);
    expect(targetFor(monthsOf(q), new Map([['2026-10', 500], ['2026-Q4', 900]]))).toBe(1100);
    expect(targetFor(['2026-11'], new Map())).toBeNull();
  });
});

describe('funnel stages', () => {
  const none = { status: null, contacted: false, rfqStatuses: [], openDeals: 0, negotiating: false, won: false };
  it('places a company at the furthest stage its records show', () => {
    expect(funnelStageOf(none)).toBe('NEW');
    expect(funnelStageOf({ ...none, contacted: true })).toBe('CONTACTED');
    expect(funnelStageOf({ ...none, contacted: true, rfqStatuses: ['RECEIVED'] })).toBe('RFQ_RECEIVED');
    expect(funnelStageOf({ ...none, rfqStatuses: ['QUOTATION_SUBMITTED'] })).toBe('QUOTATION_SUBMITTED');
    expect(funnelStageOf({ ...none, openDeals: 1, negotiating: true })).toBe('NEGOTIATION');
    expect(funnelStageOf({ ...none, status: { name: 'Negotiation', meaning: null } })).toBe('NEGOTIATION');
  });
  it('lets a win or a lost status decide', () => {
    expect(funnelStageOf({ ...none, rfqStatuses: ['NEGOTIATION'], won: true })).toBe('WON');
    expect(funnelStageOf({ ...none, status: { name: 'Existing Client', meaning: 'CLIENT' } })).toBe('WON');
    expect(funnelStageOf({ ...none, contacted: true, status: { name: 'Not Interested', meaning: 'LOST' } })).toBe('LOST');
  });
});
