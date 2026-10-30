import { describe, expect, it } from 'vitest';
import { csvCell, parseCsv, toCsv } from './csv';

describe('parseCsv', () => {
  it('parses quoted fields, escaped quotes, CRLF and embedded newlines', () => {
    const text = '﻿name,notes\r\n"Acme, Inc.","said ""hi""\nthen left"\r\nBeta,\n\n';
    expect(parseCsv(text)).toEqual([
      ['name', 'notes'],
      ['Acme, Inc.', 'said "hi"\nthen left'],
      ['Beta', ''],
    ]);
  });

  it('keeps a final row without a trailing newline', () => {
    expect(parseCsv('a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });
});

describe('csvCell', () => {
  it('neutralises spreadsheet formulas', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+1 555')).toBe("'+1 555");
    expect(csvCell('@cmd')).toBe("'@cmd");
  });

  it('quotes delimiters and renders empty values', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell(null)).toBe('');
    expect(csvCell(['x', 'y'])).toBe('x; y');
  });

  it('round-trips through parseCsv', () => {
    const csv = toCsv(['n', 'v'], [['O"Neil, Pat', 'line1\nline2']]);
    expect(parseCsv(csv)).toEqual([
      ['n', 'v'],
      ['O"Neil, Pat', 'line1\nline2'],
    ]);
  });
});
