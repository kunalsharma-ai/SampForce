/**
 * Minimal RFC 4180 CSV reader and writer. Handles quoted fields, escaped quotes, CRLF/LF line
 * endings, a UTF-8 BOM and embedded newlines. Kept dependency-free so the import path is easy to audit.
 */
export function parseCsv(text: string): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
      } else field += c;
      i++;
      continue;
    }
    if (c === '"' && field === '') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      row.push(field);
      field = '';
      if (row.some((v) => v !== '')) rows.push(row);
      row = [];
      if (c === '\r' && src[i + 1] === '\n') i++;
    } else field += c;
    i++;
  }
  row.push(field);
  if (row.some((v) => v !== '')) rows.push(row);
  return rows;
}
