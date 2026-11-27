import { describe, expect, it } from 'vitest';
import { openingHoursOf } from './opening-hours';

describe('openingHoursOf', () => {
  it('reads openingHoursSpecification, with schema.org day URLs', () => {
    expect(
      openingHoursOf({
        openingHoursSpecification: [
          { dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'https://schema.org/Friday'], opens: '09:00:00', closes: '17:30:00' },
          { dayOfWeek: 'Saturday', opens: '10:00', closes: '13:00' },
        ],
      }),
    ).toEqual({ days: [1, 2, 3, 4, 5, 6], start: '09:00', end: '17:30', source: 'website' });
  });
  it('reads the short openingHours text', () => {
    expect(openingHoursOf({ openingHours: 'Mo-Fr 08:00-16:00' })).toEqual({ days: [1, 2, 3, 4, 5], start: '08:00', end: '16:00', source: 'website' });
    expect(openingHoursOf({ openingHours: ['Su-Th 09:00-18:00'] })).toEqual({ days: [0, 1, 2, 3, 4], start: '09:00', end: '18:00', source: 'website' });
    expect(openingHoursOf({ openingHours: 'Mo,We,Fr 09:00-12:00' })?.days).toEqual([1, 3, 5]);
  });
  it('treats closing at midnight as the end of the day', () => {
    expect(openingHoursOf({ openingHoursSpecification: { dayOfWeek: 'Monday', opens: '18:00', closes: '00:00' } })).toMatchObject({ start: '18:00', end: '23:59' });
  });
  it('gives nothing for no hours, broken hours or around the clock', () => {
    expect(openingHoursOf({})).toBeNull();
    expect(openingHoursOf({ openingHours: 'Call us' })).toBeNull();
    expect(openingHoursOf({ openingHoursSpecification: { dayOfWeek: 'Monday', opens: '17:00', closes: '09:00' } })).toBeNull();
    expect(openingHoursOf({ openingHours: 'Mo-Su 00:00-24:00' })).toBeNull();
  });
});
