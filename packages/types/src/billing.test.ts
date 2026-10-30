import { describe, expect, it } from 'vitest';
import { downgradeBlockers, effectiveEntitlements, TRIAL_SEATS } from './billing';

describe('effective entitlements', () => {
  it('Free is capped by users, paid plans by seats bought', () => {
    expect(effectiveEntitlements(null)).toMatchObject({ planCode: 'free', appliedPlan: 'free', seatLimit: 2, restricted: false });
    expect(effectiveEntitlements({ planCode: 'growth', status: 'ACTIVE', seats: 7 })).toMatchObject({ appliedPlan: 'growth', seatLimit: 7 });
    expect(effectiveEntitlements({ planCode: 'growth', status: 'TRIALING', seats: 1 }).seatLimit).toBe(TRIAL_SEATS);
  });

  it('past due keeps paid allowances; unpaid and canceled fall back to Free', () => {
    expect(effectiveEntitlements({ planCode: 'business', status: 'PAST_DUE', seats: 5 })).toMatchObject({ appliedPlan: 'business', restricted: false });
    for (const status of ['UNPAID', 'CANCELED'] as const) {
      expect(effectiveEntitlements({ planCode: 'business', status, seats: 5 })).toMatchObject({ planCode: 'business', appliedPlan: 'free', seatLimit: 2, restricted: true });
    }
  });

  it('unknown plan codes are treated as Free', () => {
    expect(effectiveEntitlements({ planCode: 'mystery', status: 'ACTIVE', seats: 3 }).appliedPlan).toBe('free');
  });

  it('lists what blocks a downgrade', () => {
    expect(downgradeBlockers('launch', 5, { members: 3, pipelines: 4 })).toEqual(['4 pipelines, but the new plan allows 3.']);
    expect(downgradeBlockers('free', 5, { members: 3, pipelines: 1 })).toEqual(['3 active members, but the new plan allows 2.']);
    expect(downgradeBlockers('enterprise', 5, { members: 5, pipelines: 80 })).toEqual([]);
  });
});
