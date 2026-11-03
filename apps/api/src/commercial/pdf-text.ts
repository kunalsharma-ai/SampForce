import { existsSync } from 'node:fs';
import { join } from 'node:path';
import bidiFactory from 'bidi-js';
import type PDFDocument from 'pdfkit';

/**
 * Text drawing for the quote and contract PDFs (ADR 0054).
 *
 * Latin text keeps pdfkit's built-in Helvetica or Times. Arabic text is drawn with IBM Plex Sans Arabic or, for serif bid
 * templates, Amiri (both SIL Open Font License, apps/api/assets/fonts/OFL-*.txt), embedded and subset by pdfkit. Both
 * have a glyph for every shaped letter form, so the PDF's text map gives back the right letters on copy and search
 * (fonts that build letters from a dotless base plus dots do not). fontkit shapes each
 * Arabic run (joining forms, ligatures, marks) and the Unicode bidi algorithm (bidi-js) orders the runs of a line, so
 * a line such as "عرض السعر Q-0001" reads correctly with the reference and amounts left to right inside it.
 *
 * A PDF in Arabic is laid out right to left: boxes are mirrored across the page and left and right alignment swap.
 * Any other PDF is drawn exactly as before unless something people typed contains Arabic, in which case only the
 * text drawing changes, so an Arabic company name prints instead of question marks.
 */

type Doc = InstanceType<typeof PDFDocument>;
export type Align = 'left' | 'right' | 'center';
export interface TextOptions {
  bold?: boolean;
  width?: number;
  align?: Align;
}

/** The latin-1 range the built-in fonts can draw; anything else prints as "?" rather than as gibberish. */
export const latin1 = (s: string) => s.replace(/[^\x20-\x7E\xA0-\xFF\n]/g, '?');

/** Arabic script letters, marks, digits and presentation forms. */
const ARABIC = /[\u0600-\u06FF\u0750-\u077F\u0870-\u089F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
/** Bidi formatting marks: they steer the ordering and are never drawn. */
const BIDI_MARK = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/;

export const hasArabic = (s: string) => ARABIC.test(s);

const FONT_DIR = join(__dirname, '..', '..', 'assets', 'fonts');
const ARABIC_FILES = {
  sans: { regular: 'IBMPlexSansArabic-Regular.ttf', bold: 'IBMPlexSansArabic-Bold.ttf' },
  serif: { regular: 'Amiri-Regular.ttf', bold: 'Amiri-Bold.ttf' },
} as const;

/** The path of a bundled Arabic font; a missing file is a broken install, so it fails loudly. */
export function arabicFontPath(family: 'sans' | 'serif', weight: 'regular' | 'bold'): string {
  const path = join(FONT_DIR, ARABIC_FILES[family][weight]);
  if (!existsSync(path)) throw new Error(`Arabic PDF font missing: ${path}`);
  return path;
}

let bidi: ReturnType<typeof bidiFactory> | undefined;
const getBidi = () => (bidi ??= bidiFactory());

interface Run {
  /** What to hand pdfkit, already in the order it should be drawn. */
  text: string;
  arabic: boolean;
}

export class PdfText {
  readonly rtl: boolean;
  readonly unicode: boolean;
  private readonly latinFont: { regular: string; bold: string };
  private bold = false;

  /**
   * @param rtl lay the page out right to left (the PDF is in Arabic)
   * @param unicode draw through the shaping path; true whenever the PDF is in Arabic or any of its text contains Arabic
   */
  constructor(
    readonly doc: Doc,
    opts: { rtl: boolean; unicode: boolean; family: 'sans' | 'serif' },
  ) {
    this.rtl = opts.rtl;
    this.unicode = opts.unicode || opts.rtl;
    this.latinFont = opts.family === 'serif' ? { regular: 'Times-Roman', bold: 'Times-Bold' } : { regular: 'Helvetica', bold: 'Helvetica-Bold' };
    if (this.unicode) {
      for (const weight of ['regular', 'bold'] as const) doc.registerFont(`arabic-${weight}`, arabicFontPath(opts.family, weight));
    }
  }

  /** Sets the weight for following text and selects the matching Latin font, so moveDown keeps its usual spacing. */
  font(bold = false): this {
    this.bold = bold;
    this.doc.font(bold ? this.latinFont.bold : this.latinFont.regular);
    return this;
  }

  /** The x of a box of `width` starting at `x`, mirrored across the page in a right-to-left PDF. */
  x(x: number, width = 0): number {
    return this.rtl ? this.doc.page.width - x - width : x;
  }

  /**
   * Draws `s` in a box from `x` (the left margin when left out) of `width` (to the right margin), from `y` (the current
   * position), wrapping as needed, and moves the cursor below it like doc.text does.
   */
  text(s: string, x?: number, y?: number, opts: TextOptions = {}): this {
    const doc = this.doc;
    if (opts.bold !== undefined) this.font(opts.bold);
    const left = x ?? doc.x;
    const width = opts.width ?? doc.page.width - doc.page.margins.right - left;
    const top = y ?? doc.y;
    if (!this.unicode) {
      doc.text(latin1(s), x, y, { ...(opts.width !== undefined && { width }), ...(opts.align && { align: opts.align }) });
      return this;
    }
    const align = this.rtl ? mirror(opts.align ?? 'left') : (opts.align ?? 'left');
    const boxX = this.x(left, width);
    const { ascent, height } = this.lineMetrics();
    let lineTop = top;
    const bottom = doc.page.height - doc.page.margins.bottom;
    for (const line of this.lines(s, width)) {
      if (lineTop + height > bottom && lineTop > doc.page.margins.top) {
        doc.addPage();
        lineTop = doc.page.margins.top;
      }
      const lineWidth = line.reduce((sum, r) => sum + this.widthOf(r), 0);
      let cx = align === 'left' ? boxX : align === 'right' ? boxX + width - lineWidth : boxX + (width - lineWidth) / 2;
      for (const r of line) {
        this.select(r.arabic);
        doc.text(r.text, cx, lineTop + ascent, { lineBreak: false, baseline: 'alphabetic' });
        cx += this.widthOf(r);
      }
      lineTop += height;
    }
    this.font(this.bold);
    doc.x = left;
    doc.y = lineTop;
    return this;
  }

  /**
   * Ends the document. Before pdfkit writes each embedded font's map from glyphs back to text, the entries of Arabic
   * ligatures (lam-alef and the like) are put in display order: their glyphs sit in a right-to-left run that PDF
   * readers turn back into reading order, so a map in reading order would come out swapped ("األفق" for "الأفق").
   * Relies on pdfkit 0.15's EmbeddedFont.unicode (the version is pinned; the Arabic PDF tests read the text back).
   */
  end(): void {
    if (this.unicode) {
      const families = (this.doc as unknown as { _fontFamilies: Record<string, { unicode?: number[][] }> })._fontFamilies;
      // A font is listed under its registered name and its PostScript name; fix each one once.
      for (const font of new Set(Object.values(families))) {
        if (!font.unicode) continue;
        font.unicode = font.unicode.map((cps) => (cps && cps.length > 1 && cps.every((c) => hasArabic(String.fromCodePoint(c))) ? [...cps].reverse() : cps));
      }
    }
    this.doc.end();
  }

  /** Line height that fits both fonts, so mixed lines share one baseline and never overlap. */
  private lineMetrics() {
    const size = (this.doc as unknown as { _fontSize: number })._fontSize;
    let ascent = 0;
    let descent = 0;
    let gap = 0;
    for (const arabic of [false, true]) {
      this.select(arabic);
      const f = (this.doc as unknown as { _font: { ascender: number; descender: number; lineGap: number } })._font;
      ascent = Math.max(ascent, (f.ascender / 1000) * size);
      descent = Math.min(descent, (f.descender / 1000) * size);
      gap = Math.max(gap, (f.lineGap / 1000) * size);
    }
    this.font(this.bold);
    return { ascent, height: ascent - descent + gap };
  }

  private select(arabic: boolean) {
    if (arabic) this.doc.font(this.bold ? 'arabic-bold' : 'arabic-regular');
    else this.doc.font(this.bold ? this.latinFont.bold : this.latinFont.regular);
  }

  private widthOf(r: Run): number {
    this.select(r.arabic);
    return this.doc.widthOfString(r.text);
  }

  /** Wraps each paragraph at spaces to `width` and returns every line as visual runs, left to right. */
  private lines(s: string, width: number): Run[][] {
    const out: Run[][] = [];
    for (const para of s.split('\n').map(isolateNumbers)) {
      if (!para.trim()) {
        out.push([]);
        continue;
      }
      const levels = getBidi().getEmbeddingLevels(para, this.rtl ? 'rtl' : 'ltr');
      // Break opportunities: after each run of spaces.
      const words = para.match(/\S+\s*|\s+/g) ?? [];
      let start = 0;
      let end = 0;
      let used = 0;
      for (const w of words) {
        const wordWidth = this.measure(para, levels, end, end + w.trimEnd().length);
        const fullWidth = this.measure(para, levels, end, end + w.length);
        if (used > 0 && used + wordWidth > width) {
          out.push(this.visualRuns(para, levels, start, end));
          start = end;
          used = 0;
        }
        used += fullWidth;
        end += w.length;
      }
      out.push(this.visualRuns(para, levels, start, end));
    }
    return out;
  }

  /** The drawn width of para[from, to). */
  private measure(para: string, levels: EmbeddingLevels, from: number, to: number): number {
    if (to <= from) return 0;
    return this.runsOf(para, levels, from, to).reduce((sum, r) => sum + this.widthOf(r), 0);
  }

  /** The line para[from, to), trailing spaces dropped, as runs in visual order. */
  private visualRuns(para: string, levels: EmbeddingLevels, from: number, to: number): Run[] {
    let end = to;
    while (end > from && /\s/.test(para[end - 1]!)) end--;
    return end > from ? this.runsOf(para, levels, from, end) : [];
  }

  /**
   * Splits para[from, to) into runs that pdfkit can draw one by one, left to right.
   *
   * The characters are reordered for display with the bidi algorithm (rule L2), then grouped into runs of one font
   * and one level that are contiguous in the source text. A Latin run is handed over in display order with mirrored
   * brackets. An Arabic run is handed over in reading order, because fontkit needs it to pick joining forms and
   * reverses Arabic script itself; an Arabic run at a left-to-right level (Arabic-Indic digits) is pre-reversed so
   * that fontkit's reversal puts it back.
   */
  private runsOf(para: string, levels: EmbeddingLevels, from: number, to: number): Run[] {
    const b = getBidi();
    const order: number[] = [];
    for (let i = from; i < to; i++) order.push(i);
    for (const [s, e] of b.getReorderSegments(para, levels, from, to - 1)) {
      const seg = order.slice(s - from, e - from + 1).reverse();
      order.splice(s - from, seg.length, ...seg);
    }
    const mirrored = b.getMirroredCharactersMap(para, levels.levels, from, to - 1);
    const runs: Run[] = [];
    let group: number[] = [];
    const flush = () => {
      if (!group.length) return;
      const first = group[0]!;
      const arabic = hasArabic(para[first]!);
      const rtl = (levels.levels[first]! & 1) === 1;
      if (arabic) {
        const logical = [...group].sort((a, c) => a - c).map((i) => para[i]!).join('');
        runs.push({ arabic, text: rtl ? logical : [...logical].reverse().join('') });
      } else {
        runs.push({ arabic, text: latin1(group.map((i) => mirrored.get(i) ?? para[i]!).join('')) });
      }
      group = [];
    };
    for (const i of order) {
      if (BIDI_MARK.test(para[i]!)) continue;
      const prev = group[group.length - 1];
      const same =
        prev !== undefined &&
        hasArabic(para[prev]!) === hasArabic(para[i]!) &&
        levels.levels[prev] === levels.levels[i] &&
        Math.abs(prev - i) === 1;
      if (!same) flush();
      group.push(i);
    }
    flush();
    return runs;
  }
}

type EmbeddingLevels = ReturnType<ReturnType<typeof bidiFactory>['getEmbeddingLevels']>;

/**
 * Wraps numbers joined by hyphens or plus signs ("2026-11-02", "+966-55-123") in a left-to-right isolate. After Arabic
 * letters the bidi algorithm treats their digits as Arabic numbers, which a hyphen does not join, so a date would
 * otherwise print as "02-11-2026".
 */
export function isolateNumbers(s: string): string {
  return s.replace(/\+?\d+(?:[-+]\d+)+/g, (m) => `\u2066${m}\u2069`);
}

function mirror(a: Align): Align {
  return a === 'left' ? 'right' : a === 'right' ? 'left' : a;
}
