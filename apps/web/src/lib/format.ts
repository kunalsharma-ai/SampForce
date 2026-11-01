import type { KpiFormat } from '@dealflow/types';
import { fmtLocale } from '@/lib/i18n/locale';

export function formatKpi(value: number, format: KpiFormat, currency: string, locale = fmtLocale()): string {
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

/** "3 days ago", "in 2 hours", "now", written in the person's format locale. */
export function relativeTime(iso: string, now = Date.now(), locale = fmtLocale()): string {
  const diff = (new Date(iso).getTime() - now) / 1000;
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
  ];
  for (const [unit, secs] of units) if (Math.abs(diff) >= secs) return rtf.format(Math.round(diff / secs), unit);
  return rtf.format(0, 'second');
}
