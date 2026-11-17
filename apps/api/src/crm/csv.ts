export { parseCsv } from '@dealflow/types';

/**
 * Serialises a cell. Values that a spreadsheet would evaluate as a formula are prefixed with an
 * apostrophe (CSV/formula injection, OWASP), and anything containing a delimiter is quoted.
 */
export function csvCell(value: unknown, neutralise = true): string {
  if (value === null || value === undefined) return '';
  let s = Array.isArray(value) ? value.join('; ') : value instanceof Date ? value.toISOString() : String(value);
  if (neutralise && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** `neutralise` (on for exports): formula-like values get an apostrophe. Off for CSV that only the import reads. */
export function toCsv(headers: string[], rows: unknown[][], neutralise = true): string {
  const line = (r: unknown[]) => r.map((c) => csvCell(c, neutralise)).join(',');
  return [line(headers), ...rows.map(line)].join('\r\n') + '\r\n';
}
