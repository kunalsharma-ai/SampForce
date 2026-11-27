import { describe, expect, it } from 'vitest';
import { overallPercent, planLastDay, runningStatus } from '@dealflow/types';
import { addDays, dayStart, localDay, periodOf, weekday } from './calendar';
import { windowOf } from './performance.service';

const plan = { startsOn: '2026-12-01', endsOn: '2026-12-31', workingDays: [1, 2, 3, 4, 5], skipDates: ['2026-12-25'] };

describe('recurring task calendar (ADR 0096)', () => {
  it('works out plan lengths', () => {
    expect(planLastDay('ONE_DAY', '2026-12-01')).toBe('2026-12-01');
    expect(planLastDay('TWO_DAYS', '2026-12-31')).toBe('2027-01-01');
    expect(planLastDay('ONE_WEEK', '2026-12-01')).toBe('2026-12-07');
    expect(planLastDay('ONE_MONTH', '2026-01-31')).toBe('2026-03-02');
    expect(planLastDay('ONE_MONTH', '2026-12-01')).toBe('2026-12-31');
    expect(planLastDay('ONE_QUARTER', '2026-12-01')).toBe('2027-02-28');
    expect(planLastDay('SIX_MONTHS', '2026-12-01')).toBe('2027-05-31');
    expect(planLastDay('ONE_YEAR', '2026-12-01')).toBe('2027-11-30');
    expect(planLastDay('CUSTOM', '2026-12-01', '2026-12-10')).toBe('2026-12-10');
  });

  it('makes daily periods only on working days that are not days off', () => {
    expect(weekday('2026-12-05')).toBe(6);
    expect(periodOf('DAY', '2026-12-04', plan)).toEqual({ cadence: 'DAY', first: '2026-12-04', last: '2026-12-04' });
    expect(periodOf('DAY', '2026-12-05', plan)).toBeNull();
    expect(periodOf('DAY', '2026-12-25', plan)).toBeNull();
    expect(periodOf('DAY', '2027-01-04', plan)).toBeNull();
  });

  it('cuts weeks and months to the plan', () => {
    // 2026-12-01 is a Tuesday: the first week starts with the plan, not on Monday.
    expect(periodOf('WEEK', '2026-12-02', plan)).toEqual({ cadence: 'WEEK', first: '2026-12-01', last: '2026-12-06' });
    expect(periodOf('WEEK', '2026-12-30', plan)).toEqual({ cadence: 'WEEK', first: '2026-12-28', last: '2026-12-31' });
    expect(periodOf('MONTH', '2026-12-15', { ...plan, startsOn: '2026-12-10' })).toEqual({ cadence: 'MONTH', first: '2026-12-10', last: '2026-12-31' });
  });

  it('finds midnight in any time zone, even far from UTC', () => {
    expect(dayStart('2026-12-01', 'UTC').toISOString()).toBe('2026-12-01T00:00:00.000Z');
    expect(dayStart('2026-12-01', 'Asia/Kolkata').toISOString()).toBe('2026-11-30T18:30:00.000Z');
    expect(dayStart('2026-12-01', 'America/Los_Angeles').toISOString()).toBe('2026-12-01T08:00:00.000Z');
    expect(dayStart('2026-12-01', 'Pacific/Kiritimati').toISOString()).toBe('2026-11-30T10:00:00.000Z');
    expect(dayStart('2026-12-01', 'Pacific/Pago_Pago').toISOString()).toBe('2026-12-01T11:00:00.000Z');
    expect(localDay(new Date('2026-11-30T19:00:00Z'), 'Asia/Kolkata')).toBe('2026-12-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('measures progress so that overdoing one thing never hides another', () => {
    expect(overallPercent([{ amount: 20, done: 40 }, { amount: 100, done: 0 }])).toBe(50);
    expect(overallPercent([{ amount: 20, done: 15 }])).toBe(75);
    expect(runningStatus(0)).toBe('NOT_STARTED');
    expect(runningStatus(30)).toBe('IN_PROGRESS');
    expect(runningStatus(50)).toBe('HALF_COMPLETED');
    expect(runningStatus(100)).toBe('COMPLETED');
  });

  it('ranks over whole calendar periods', () => {
    expect(windowOf('WEEK', 0, '2026-12-03', 'UTC')).toMatchObject({ first: '2026-11-30', last: '2026-12-06' });
    expect(windowOf('WEEK', -1, '2026-12-03', 'UTC')).toMatchObject({ first: '2026-11-23', last: '2026-11-29' });
    expect(windowOf('MONTH', -1, '2026-01-15', 'UTC')).toMatchObject({ first: '2025-12-01', last: '2025-12-31' });
    expect(windowOf('QUARTER', 0, '2026-11-27', 'UTC')).toMatchObject({ first: '2026-10-01', last: '2026-12-31' });
    expect(windowOf('QUARTER', -1, '2026-02-10', 'UTC')).toMatchObject({ first: '2025-10-01', last: '2025-12-31' });
  });
});
