import { describe, expect, it } from 'vitest';
import { formatKpi, relativeTime } from './format';

describe('formatKpi', () => {
  it('formats each KPI type', () => {
    expect(formatKpi(15000, 'currency', 'USD')).toBe('$15,000');
    expect(formatKpi(0.3333, 'percent', 'USD')).toBe('33.3%');
    expect(formatKpi(20, 'days', 'USD')).toBe('20 d');
    expect(formatKpi(1234, 'number', 'USD')).toBe('1,234');
  });
});

describe('relativeTime', () => {
  it('describes recent times', () => {
    const now = Date.parse('2026-10-30T12:00:00Z');
    expect(relativeTime('2026-10-30T11:59:50Z', now)).toBe('now');
    expect(relativeTime('2026-10-30T10:00:00Z', now)).toBe('2 hours ago');
    expect(relativeTime('2026-10-30T10:00:00Z', now, 'de-DE')).toBe('vor 2 Stunden');
    expect(relativeTime('2026-10-30T10:00:00Z', now, 'es')).toBe('hace 2 horas');
    expect(relativeTime('2026-10-29T12:00:00Z', now)).toBe('yesterday');
  });
});
