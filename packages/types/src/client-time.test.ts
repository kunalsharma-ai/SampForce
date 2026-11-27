import { describe, expect, it } from 'vitest';
import {
  connectAdvice,
  countryProfile,
  DEFAULT_CONTACT_TIMES,
  formatDuration,
  resolveZone,
  standardHours,
  wallClock,
  workingHoursSchema,
  zoneAbbreviation,
  zonedInstant,
  zoneOffset,
} from './client-time';

const me = DEFAULT_CONTACT_TIMES;

describe('country profile', () => {
  it('gives codes, region and currency', () => {
    expect(countryProfile('us')).toMatchObject({ code: 'US', alpha3: 'USA', callingCode: '+1', region: 'North America', currency: { code: 'USD', symbol: '$', name: 'US Dollar' } });
    expect(countryProfile('IN')).toMatchObject({ alpha3: 'IND', callingCode: '+91', region: 'APAC', currency: { code: 'INR', symbol: '₹' }, zones: ['Asia/Kolkata'] });
    expect(countryProfile('AE')).toMatchObject({ alpha3: 'ARE', region: 'MENA', currency: { code: 'AED' } });
    expect(countryProfile('DE')).toMatchObject({ alpha3: 'DEU', region: 'Europe', currency: { symbol: '€' }, zones: expect.arrayContaining(['Europe/Berlin']) });
    expect(countryProfile('GB')).toMatchObject({ alpha3: 'GBR', callingCode: '+44', region: 'Europe', currency: { code: 'GBP', symbol: '£' } });
    expect(countryProfile('BR')).toMatchObject({ region: 'South America', zones: expect.arrayContaining(['America/Sao_Paulo']) });
    expect(countryProfile('MX')?.region).toBe('Central America & Caribbean');
    expect(countryProfile('NG')?.region).toBe('Sub-Saharan Africa');
    expect(countryProfile('AU')?.zones[0]).toBe('Australia/Sydney');
    expect(countryProfile('XX')).toBeNull();
    expect(countryProfile(null)).toBeNull();
  });

  it('keeps non-US dollars apart from the US dollar', () => {
    expect(countryProfile('AU')?.currency.symbol).not.toBe('$');
  });
});

describe('resolveZone', () => {
  it('uses the zone saved on the record first', () => {
    expect(resolveZone({ country: 'US', timezone: 'America/Denver' })).toEqual({ zone: 'America/Denver', basis: 'record', exact: true });
  });
  it('ignores a saved value that is not a zone', () => {
    expect(resolveZone({ country: 'SE', timezone: 'Sweden time' }).zone).toBe('Europe/Stockholm');
  });
  it('one-zone countries are exact from the country alone', () => {
    expect(resolveZone({ country: 'IN' })).toEqual({ zone: 'Asia/Kolkata', basis: 'country', exact: true });
    expect(resolveZone({ country: 'SE', city: 'Stockholm' })).toEqual({ zone: 'Europe/Stockholm', basis: 'country', exact: true });
  });
  it('finds the zone from the state name or code', () => {
    expect(resolveZone({ country: 'US', state: 'California' }).zone).toBe('America/Los_Angeles');
    expect(resolveZone({ country: 'US', state: 'tx' }).zone).toBe('America/Chicago');
    expect(resolveZone({ country: 'AU', state: 'Western Australia' }).zone).toBe('Australia/Perth');
    expect(resolveZone({ country: 'CA', state: 'British Columbia' }).zone).toBe('America/Vancouver');
  });
  it('finds the zone from a large city when the state is empty', () => {
    expect(resolveZone({ country: 'US', city: 'Los Angeles' })).toEqual({ zone: 'America/Los_Angeles', basis: 'city', exact: true });
    expect(resolveZone({ country: 'US', city: 'New York City' })).toEqual({ zone: 'America/New_York', basis: 'city', exact: true });
  });
  it('reads the headquarters text', () => {
    expect(resolveZone({ country: 'US', headquarters: 'Austin, Texas, United States' })).toMatchObject({ zone: 'America/Chicago', basis: 'city' });
    expect(resolveZone({ country: 'US', headquarters: 'Somewhere, Arizona' })).toMatchObject({ zone: 'America/Phoenix', basis: 'state' });
  });
  it("falls back to the country's main zone, marked as a guess", () => {
    expect(resolveZone({ country: 'US' })).toEqual({ zone: 'America/New_York', basis: 'country', exact: false });
    expect(resolveZone({})).toEqual({ zone: null, basis: 'none', exact: false });
  });
});

describe('clocks', () => {
  it('handles daylight saving with the real rules, not a fixed offset', () => {
    const summer = new Date('2026-07-15T14:00:00Z');
    const winter = new Date('2026-01-15T15:00:00Z');
    expect(wallClock('America/New_York', summer).minutes).toBe(10 * 60);
    expect(wallClock('America/New_York', winter).minutes).toBe(10 * 60);
    expect(zoneAbbreviation('America/New_York', summer)).toBe('EDT');
    expect(zoneAbbreviation('America/New_York', winter)).toBe('EST');
    expect(zoneAbbreviation('Asia/Kolkata', summer)).toBe('IST');
    expect(zoneAbbreviation('Europe/Berlin', winter)).toBe('CET');
    expect(zoneOffset('Asia/Kolkata', summer) - zoneOffset('America/New_York', summer)).toBe(570);
    expect(zoneOffset('Asia/Kolkata', winter) - zoneOffset('America/New_York', winter)).toBe(630);
    expect(wallClock('Asia/Kolkata', summer).minutes).toBe(19 * 60 + 30);
  });
  it('turns a wall-clock time into the right instant on both sides of a change', () => {
    expect(zonedInstant('America/New_York', 2026, 3, 9, 9 * 60).toISOString()).toBe('2026-03-09T13:00:00.000Z');
    expect(zonedInstant('America/New_York', 2026, 3, 6, 9 * 60).toISOString()).toBe('2026-03-06T14:00:00.000Z');
    expect(zonedInstant('Asia/Kolkata', 2026, 11, 26, 9 * 60).toISOString()).toBe('2026-11-26T03:30:00.000Z');
  });
  it('writes durations', () => {
    expect(formatDuration(570)).toBe('9 h 30 m');
    expect(formatDuration(-60)).toBe('1 h');
    expect(formatDuration(45)).toBe('45 m');
  });
});

describe('working hours', () => {
  it('uses the local weekend', () => {
    expect(standardHours('US').days).toEqual([1, 2, 3, 4, 5]);
    expect(standardHours('SA').days).toEqual([0, 1, 2, 3, 4]);
    expect(standardHours('AE').days).toEqual([1, 2, 3, 4, 5]);
  });
  it('validates typed hours', () => {
    expect(workingHoursSchema.safeParse({ days: [1, 2], start: '10:00', end: '09:00', source: 'user' }).success).toBe(false);
    expect(workingHoursSchema.parse({ days: [2, 1, 1], start: '08:30', end: '17:00', source: 'user' })).toEqual({ days: [1, 2], start: '08:30', end: '17:00', source: 'user' });
  });
});

describe('connectAdvice', () => {
  const ny = { clientZone: 'America/New_York', hours: standardHours('US'), me };
  // Thursday 2026-07-16 in New York.
  const at = (hh: number, mm = 0) => zonedInstant('America/New_York', 2026, 7, 16, hh * 60 + mm);

  it('perfect timing inside their hours', () => {
    const a = connectAdvice({ ...ny, now: at(10) });
    expect(a).toMatchObject({ status: 'perfect', tone: 'success', minutes: 8 * 60, difference: 570 });
    expect(a.window!.start.toISOString()).toBe('2026-07-16T13:00:00.000Z');
    expect(a.best!.start.toISOString()).toBe('2026-07-16T14:00:00.000Z');
    expect(a.best!.end.toISOString()).toBe('2026-07-16T16:00:00.000Z');
  });
  it('ending soon in the last hour', () => {
    expect(connectAdvice({ ...ny, now: at(17, 20) })).toMatchObject({ status: 'ending-soon', tone: 'warning', minutes: 40 });
  });
  it('starting soon in the hour before', () => {
    expect(connectAdvice({ ...ny, now: at(8, 15) })).toMatchObject({ status: 'starting-soon', minutes: 45 });
  });
  it('outside hours points at the next working day', () => {
    const a = connectAdvice({ ...ny, now: at(22) });
    expect(a.status).toBe('outside');
    expect(a.window!.start.toISOString()).toBe('2026-07-17T13:00:00.000Z');
    expect(a.minutes).toBe(11 * 60);
  });
  it('weekend skips to Monday', () => {
    const sat = zonedInstant('America/New_York', 2026, 7, 18, 11 * 60);
    const a = connectAdvice({ ...ny, now: sat });
    expect(a).toMatchObject({ status: 'weekend', weekendDay: true });
    expect(a.window!.start.toISOString()).toBe('2026-07-20T13:00:00.000Z');
  });
  it('a public holiday closes the day', () => {
    const a = connectAdvice({ ...ny, holidays: [{ date: '2026-07-16', name: 'Test Day' }], now: at(11) });
    expect(a).toMatchObject({ status: 'holiday', holiday: { name: 'Test Day' } });
    expect(a.window!.start.toISOString()).toBe('2026-07-17T13:00:00.000Z');
  });
  it('Friday is the weekend in Riyadh', () => {
    const fri = zonedInstant('Asia/Riyadh', 2026, 7, 17, 11 * 60);
    expect(connectAdvice({ clientZone: 'Asia/Riyadh', hours: standardHours('SA'), me, now: fri }).status).toBe('weekend');
  });
  it('knows whether it is inside my own hours', () => {
    // 10:00 in New York is 19:30 IST, inside 09:00-23:00; 17:20 is 02:50 IST, outside.
    expect(connectAdvice({ ...ny, now: at(10) }).insideMyHours).toBe(true);
    expect(connectAdvice({ ...ny, now: at(17, 20) }).insideMyHours).toBe(false);
  });
});
