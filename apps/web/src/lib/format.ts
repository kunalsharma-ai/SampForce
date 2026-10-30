import type { KpiFormat } from '@dealflow/types';

export function formatKpi(value: number, format: KpiFormat, currency: string, locale = 'en-US'): string {
  switch (format) {
    case 'currency':
      return new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 0 }).format(value);
    case 'percent':
      return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 }).format(value);
    case 'days':
      return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value)} d`;
    default:
      return new Intl.NumberFormat(locale).format(value);
  }
}

export function relativeTime(iso: string, now = Date.now()): string {
  const diff = (new Date(iso).getTime() - now) / 1000;
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
  ];
  for (const [unit, secs] of units) if (Math.abs(diff) >= secs) return rtf.format(Math.round(diff / secs), unit);
  return 'just now';
}
