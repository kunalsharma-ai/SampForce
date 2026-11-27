import { describe, expect, it } from 'vitest';
import { dayPart, lineOfTheDay } from './welcome-banner';

const at = (h: number, m = 0) => new Date(2026, 10, 26, h, m);

describe('welcome banner', () => {
  it('greets by the local time of day', () => {
    expect([4, 5, 11].map((h) => dayPart(at(h)))).toEqual(['night', 'morning', 'morning']);
    expect([12, 16].map((h) => dayPart(at(h)))).toEqual(['afternoon', 'afternoon']);
    expect([17, 20, 21, 23, 0].map((h) => dayPart(at(h)))).toEqual(['evening', 'evening', 'night', 'night', 'night']);
  });
  it('shows one line all day and another the next day', () => {
    const lines = ['a', 'b', 'c'];
    expect(lineOfTheDay(lines, at(8))).toBe(lineOfTheDay(lines, at(22)));
    expect(lineOfTheDay(lines, new Date(2026, 10, 27, 8))).not.toBe(lineOfTheDay(lines, at(8)));
  });
});
