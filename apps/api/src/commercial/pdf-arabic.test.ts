import { inflateSync } from 'node:zlib';
import { bidStyle } from '@dealflow/types';
import { describe, expect, it } from 'vitest';
import { inLanguage } from '../common/request-language';
import { renderContractPdf } from './contract-pdf';
import { isolateNumbers } from './pdf-text';
import { renderQuotePdf, type PdfQuote } from './quote-pdf';

/** One piece of drawn text: where it starts on the page (y grows downward) and what it says. */
interface Piece {
  x: number;
  y: number;
  /** What it says, in reading order (Arabic pieces reversed). */
  text: string;
  /** The characters as drawn, left to right. */
  visual: string;
  font: string;
  size: number;
}

const ARABIC = /[\u0600-\u06FF]/;

/**
 * Reads the text back the way a PDF reader does: glyphs of embedded fonts are decoded through the font's ToUnicode
 * map, built-in fonts as WinAnsi bytes. Arabic pieces are drawn in display order, so they are reversed back to reading
 * order (which also checks that ligatures were mapped in display order).
 */
function readPdf(pdf: Buffer): { pieces: Piece[]; fonts: string[]; pages: number } {
  const raw = pdf.toString('latin1');
  const objects = new Map<number, string>();
  for (const m of raw.matchAll(/(\d+) 0 obj\s*([\s\S]*?)endobj/g)) objects.set(Number(m[1]), m[2]!);
  const streamOf = (body: string) => {
    const m = /stream\r?\n([\s\S]*?)\r?\nendstream/.exec(body);
    if (!m) return '';
    try {
      return inflateSync(Buffer.from(m[1]!, 'latin1')).toString('latin1');
    } catch {
      return m[1]!;
    }
  };
  // Resource name (F1, F2, ...) to a decoder.
  const decoders = new Map<string, (hex: string) => string>();
  const fonts: string[] = [];
  for (const res of raw.matchAll(/\/Font <<([\s\S]*?)>>/g)) {
    for (const [, name, ref] of res[1]!.matchAll(/\/(F\d+) (\d+) 0 R/g)) {
      const font = objects.get(Number(ref)) ?? '';
      fonts.push(/\/BaseFont \/(\S+)/.exec(font)?.[1] ?? '');
      const toUnicode = /\/ToUnicode (\d+) 0 R/.exec(font);
      if (!toUnicode) {
        decoders.set(name!, (hex) => Buffer.from(hex, 'hex').toString('latin1'));
        continue;
      }
      const cmap = streamOf(objects.get(Number(toUnicode[1])) ?? '');
      const map = new Map<number, string>();
      for (const [, start, list] of cmap.matchAll(/<([0-9a-f]+)> <[0-9a-f]+> \[([^\]]*)\]/gi)) {
        [...list!.matchAll(/<([0-9a-f ]*)>/gi)].forEach((u, i) => {
          const cps = u[1]!.trim() ? u[1]!.trim().split(/\s+/).map((h) => parseInt(h, 16)) : [];
          map.set(parseInt(start!, 16) + i, String.fromCodePoint(...cps));
        });
      }
      decoders.set(name!, (hex) => (hex.match(/.{4}/g) ?? []).map((g) => map.get(parseInt(g, 16)) ?? '\uFFFD').join(''));
    }
  }
  const pieces: Piece[] = [];
  for (const body of objects.values()) {
    const content = streamOf(body);
    if (!content.includes(' Tf')) continue;
    let x = 0;
    let y = 0;
    let font = '';
    let size = 0;
    for (const op of content.matchAll(/([\d.\- ]+) Tm|\/(F\d+) ([\d.]+) Tf|\[([^\]]*)\] TJ/g)) {
      if (op[1]) [, , , , x, y] = op[1].trim().split(/\s+/).map(Number) as number[] as [number, number, number, number, number, number];
      else if (op[2]) {
        font = op[2];
        size = Number(op[3]);
      } else {
        const text = [...op[4]!.matchAll(/<([0-9a-f]*)>/gi)].map((h) => decoders.get(font)!(h[1]!)).join('');
        pieces.push({ x, y, font, size, visual: text, text: ARABIC.test(text) ? [...text].reverse().join('') : text });
      }
    }
  }
  return { pieces, fonts: [...new Set(fonts)], pages: (raw.match(/\/Type \/Page\b/g) ?? []).length };
}

/** Arabic letters (not Arabic-Indic digits, which read left to right). */
const ARABIC_LETTER = /[\u0621-\u064A\u0671-\u06D3]/;

interface Word {
  word: string;
  /** Left edge and baseline of the word on the page. */
  x: number;
  y: number;
}

/**
 * The words on the page in reading order within each word: pieces on one baseline are joined left to right, split at
 * spaces, and each word with Arabic letters is reversed back, as a reader turns display order into reading order.
 */
function wordsOf(pieces: Piece[]): Word[] {
  const lines = new Map<number, Piece[]>();
  for (const p of pieces) {
    const key = [...lines.keys()].find((y) => Math.abs(y - p.y) < 6) ?? p.y;
    lines.set(key, [...(lines.get(key) ?? []), p]);
  }
  const out: Word[] = [];
  for (const [y, line] of lines) {
    let current: { chars: string; x: number } | null = null;
    const flush = () => {
      if (current?.chars) out.push({ word: ARABIC_LETTER.test(current.chars) ? [...current.chars].reverse().join('') : current.chars, x: current.x, y });
      current = null;
    };
    let end = -Infinity;
    for (const p of line.sort((a, c) => a.x - c.x)) {
      // A wide gap (table columns, separate boxes) ends a word; widths are estimated at 0.6 em per character.
      if (p.x > end + p.size) flush();
      end = p.x + [...p.visual].length * p.size * 0.6;
      for (const ch of p.visual) {
        if (/\s/.test(ch)) flush();
        else if (current) current.chars += ch;
        else current = { chars: ch, x: p.x };
      }
    }
    flush();
  }
  return out;
}
const words = (pieces: Piece[]) => wordsOf(pieces).map((w) => w.word).join(' ');
const at = (pieces: Piece[], text: string) => {
  const w = wordsOf(pieces).find((q) => q.word === text);
  if (!w) throw new Error(`"${text}" not drawn; drawn: ${wordsOf(pieces).map((q) => q.word).join(' | ')}`);
  return w;
};

const quote: PdfQuote = {
  reference: 'Q-0001',
  title: 'تهيئة النظام',
  currency: 'SAR',
  createdAt: '2026-11-02T10:00:00.000Z',
  validUntil: '2026-12-01',
  subtotal: 5000,
  discountTotal: 0,
  taxTotal: 750,
  total: 5750,
  notes: null,
  terms: 'الدفع خلال ٣٠ يومًا (Net 30)',
  deal: { companyName: 'شركة الأفق' },
  lines: [{ name: 'مقاعد المستخدمين', description: null, quantity: 10, unitPrice: 500, discountPercent: 0, netTotal: 5000 }],
  sections: [],
};
const contract = { reference: 'C-0007', name: 'Acme MSA', company: { id: 'c1', name: 'Acme GmbH' }, value: 12000, currency: 'EUR', startDate: '2026-11-01', endDate: null, autoRenew: true, terms: null };

describe('Arabic PDFs (ADR 0054)', () => {
  it('writes a quote in Arabic with the bundled font, shaped and readable on copy', async () => {
    const { pieces, fonts } = readPdf(await inLanguage('ar', () => renderQuotePdf(quote, { name: 'شركة البائع' })));
    expect(fonts.some((f) => f.endsWith('+IBMPlexSansArabic-Regular'))).toBe(true);
    expect(fonts.some((f) => f.endsWith('+IBMPlexSansArabic-Bold'))).toBe(true);
    const text = words(pieces);
    // Labels from the Arabic text table, the seller and customer as typed (ligatures such as "لأ" read back in order).
    for (const w of ['عرض', 'السعر', 'التاريخ:', 'صالح', 'حتى:', 'لـ:', 'البند', 'الكمية', 'سعر', 'الوحدة', 'الصافي', 'المجموع', 'الفرعي', 'الضريبة', 'الإجمالي', 'الشروط', 'شركة', 'البائع', 'الأفق', 'تهيئة', 'النظام', 'مقاعد', 'المستخدمين', 'الدفع', '٣٠']) {
      expect(text).toContain(w);
    }
    // Numbers and references stay left to right inside Arabic lines, dates included.
    for (const s of ['Q-0001', '2026-11-02', '2026-12-01', 'SAR 5,750.00', 'Net 30']) expect(text).toContain(s);
    expect(text).not.toContain('?');
    expect(text).not.toContain('\uFFFD');
  });

  it('lays the page out right to left', async () => {
    const { pieces } = readPdf(await inLanguage('ar', () => renderQuotePdf(quote, { name: 'شركة البائع' })));
    // The item column is on the right and the net column on the left.
    expect(at(pieces, 'البند').x).toBeGreaterThan(400);
    expect(at(pieces, 'الصافي').x).toBeLessThan(150);
    // In "التاريخ: 2026-11-02" the label reads first, so it sits to the right of the date, on the same line.
    const label = at(pieces, 'التاريخ:');
    const date = at(pieces, '2026-11-02');
    expect(date.y).toBe(label.y);
    expect(date.x).toBeLessThan(label.x);
    // "شركة البائع" reads right to left: its first word is on the right, ending at the right margin.
    expect(at(pieces, 'شركة').x).toBeGreaterThan(at(pieces, 'البائع').x);
    expect(at(pieces, 'شركة').x).toBeGreaterThan(480);
    // Brackets around left-to-right text are mirrored so they still enclose it.
    expect(words(pieces)).toMatch(/\(\s*Net 30\s*\)/);
  });

  it('uses Amiri for serif bid templates', async () => {
    const { fonts } = readPdf(await inLanguage('ar', () => renderQuotePdf(quote, { name: 'شركة البائع', style: { ...bidStyle(null, null), font: 'serif' } })));
    expect(fonts.some((f) => f.endsWith('+Amiri-Regular'))).toBe(true);
    expect(fonts).toContain('Times-Roman');
  });

  it('writes contracts in Arabic and keeps the DocuSign anchors', async () => {
    const { pieces } = readPdf(await inLanguage('ar', () => renderContractPdf(contract as never, { name: 'Seller Co' }, 'Ivy Buyer')));
    const text = words(pieces);
    for (const w of ['العقد', 'C-0007', 'العميل:', 'Acme GmbH', 'القيمة:', 'يبدأ:', '2026-11-01', 'مفتوح', 'المدة', 'يتجدد', 'عن', 'العميل', 'التوقيع:', 'Ivy Buyer']) {
      expect(text).toContain(w);
    }
    expect(at(pieces, '/sn1/').x).toBeGreaterThan(at(pieces, '/ds1/').x);
  });

  it('prints Arabic that people typed in an English PDF instead of question marks', async () => {
    const { pieces, fonts } = readPdf(await inLanguage('en', () => renderQuotePdf(quote, { name: 'Seller Co' })));
    expect(fonts.some((f) => f.includes('IBMPlexSansArabic'))).toBe(true);
    const text = words(pieces);
    for (const s of ['Quote', 'Q-0001', 'Prepared', 'شركة', 'الأفق', 'Item', 'Total']) expect(text).toContain(s);
    expect(text).not.toContain('?');
    // English stays left to right.
    expect(at(pieces, 'Item').x).toBeLessThan(at(pieces, 'Net').x);
  });

  it('keeps PDFs without Arabic on the built-in fonts only', async () => {
    const plain = { ...quote, title: 'Onboarding', terms: 'Net 30', deal: { companyName: 'Acme GmbH' }, lines: [{ ...quote.lines[0]!, name: 'Seats' }] };
    const { fonts } = readPdf(await inLanguage('de', () => renderQuotePdf(plain, { name: 'Seller Co' })));
    expect(fonts.every((f) => ['Helvetica', 'Helvetica-Bold'].includes(f))).toBe(true);
  });

  it('wraps long Arabic terms and continues them on a new page', async () => {
    const terms = 'تنطبق الشروط والأحكام العامة على هذا العرض بما في ذلك سياسة الإلغاء والاسترداد. '.repeat(120);
    const { pieces, pages } = readPdf(await inLanguage('ar', () => renderQuotePdf({ ...quote, terms }, { name: 'شركة البائع' })));
    expect(pages).toBeGreaterThan(1);
    // Every line stays inside the margins.
    for (const p of pieces) {
      expect(p.x).toBeGreaterThanOrEqual(49);
      expect(p.y).toBeLessThan(841.89 - 50 + 1);
    }
  });

  it('isolates hyphenated numbers so dates keep their order after Arabic letters', () => {
    expect(isolateNumbers('التاريخ: 2026-11-02')).toBe('التاريخ: \u20662026-11-02\u2069');
    expect(isolateNumbers('هاتف +966-55-123')).toBe('هاتف \u2066+966-55-123\u2069');
    expect(isolateNumbers('Q-0001 and 5,000.00')).toBe('Q-0001 and 5,000.00');
  });
});
