import { describe, expect, it } from 'vitest';
import { dealHealth, scoreLead } from './scoring';

const now = new Date('2026-10-30T12:00:00Z');
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);

describe('lead signals', () => {
  it('scores a strong inbound lead highly and explains each point', () => {
    const r = scoreLead(
      { email: 'cto@buyer.test', phone: '+1 555 0100', jobTitle: 'CTO', companyName: 'Buyer', industry: 'SaaS', estimatedValue: 80_000, source: 'Referral', status: 'NEW', activityDates: [daysAgo(2), daysAgo(5)] },
      now,
    );
    expect(r.score).toBe(10 + 5 + 15 + 5 + 5 + 20 + 10 + 10);
    expect(r.grade).toBe('A');
    expect(r.signals.reduce((s, x) => s + x.points, 0)).toBe(r.score);
  });

  it('keeps sparse and disqualified leads low', () => {
    const empty = { email: null, phone: null, jobTitle: null, companyName: null, industry: null, estimatedValue: null, source: null, status: 'NEW', activityDates: [] };
    expect(scoreLead(empty, now)).toMatchObject({ score: 0, grade: 'D' });
    expect(scoreLead({ ...empty, email: 'a@b.test', status: 'DISQUALIFIED' }, now).score).toBe(0);
  });
});

describe('deal health', () => {
  const base = { status: 'OPEN', amount: 10_000, expectedCloseDate: daysAgo(-20), createdAt: daysAgo(10), stageEnteredAt: daysAgo(5), lastActivityAt: daysAgo(1), openTasks: 1, overdueTasks: 0, hasContact: true };

  it('rates an active, scheduled deal as healthy', () => {
    expect(dealHealth(base, now)).toMatchObject({ health: 100, risk: 'low', signals: [] });
  });

  it('adds up risk signals', () => {
    const r = dealHealth({ ...base, lastActivityAt: daysAgo(40), expectedCloseDate: daysAgo(3), stageEnteredAt: daysAgo(45), openTasks: 0 }, now);
    expect(r.signals.map((s) => s.key)).toEqual(['stale', 'close_date_passed', 'stuck', 'no_next_step']);
    expect(r).toMatchObject({ health: 20, risk: 'high' });
  });

  it('does not score closed deals', () => {
    expect(dealHealth({ ...base, status: 'WON' }, now).risk).toBe('low');
  });
});
