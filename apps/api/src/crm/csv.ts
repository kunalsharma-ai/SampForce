export { parseCsv } from '@dealflow/types';

/**
 * Serialises a cell. Values that a spreadsheet would evaluate as a formula are prefixed with an
 * apostrophe (CSV/formula injection, OWASP), and anything containing a delimiter is quoted.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let s = Array.isArray(value) ? value.join('; ') : value instanceof Date ? value.toISOString() : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers.map(csvCell).join(','), ...rows.map((r) => r.map(csvCell).join(','))].join('\r\n') + '\r\n';
}
