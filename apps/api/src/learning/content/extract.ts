import { dirname, join } from 'node:path';
import { deflateSync } from 'node:zlib';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { LESSON_TEXT_MAX_CHARS, type LessonTextSource } from '@dealflow/types';
import { recognise } from './ocr';

/*
 * Reading learning material (ADR 0097): the text SampForce can honestly read from a file, for the reading view and
 * for drafting questions. Every reader says what it read (pages, slides, sheets) or, plainly, why it could not read
 * anything. Nothing is guessed: a file whose text cannot be read gives UNREADABLE and no text.
 *
 * Text comes back as plain lines with "# " before headings and a blank line between paragraphs.
 */

export interface Extracted {
  status: 'READY' | 'UNREADABLE';
  source: LessonTextSource | null;
  text: string | null;
  parts: number | null;
  note: string;
}

const unreadable = (note: string): Extracted => ({ status: 'UNREADABLE', source: null, text: null, parts: null, note });
const ready = (text: string, source: LessonTextSource, parts: number | null, note: string): Extracted => {
  const clean = tidy(text);
  if (letters(clean) < 20) return unreadable('SampForce could not find readable text in this file.');
  return { status: 'READY', source, text: clean.slice(0, LESSON_TEXT_MAX_CHARS), parts, note };
};

const letters = (s: string) => (s.match(/\p{L}/gu) ?? []).length;

/** Joins wrapped lines, keeps headings and paragraphs, drops repeated blank lines and stray spaces. */
export function tidy(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[\u00a0\t]+/g, ' ')
    .replaceAll('\u0000', '')
    .split('\n')
    .map((l) => l.replace(/ {2,}/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&');
}

const EXT = (name: string) => (/\.([a-z0-9]{1,6})$/i.exec(name)?.[1] ?? '').toLowerCase();

/** What kind of material a file is, from its type and name. */
export function kindOfFile(contentType: string, name: string): 'pdf' | 'docx' | 'pptx' | 'xlsx' | 'csv' | 'text' | 'html' | 'rtf' | 'odf' | 'legacy' | 'image' | 'video' | 'audio' | 'captions' | 'other' {
  const ext = EXT(name);
  if (contentType === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (ext === 'docx' || contentType.includes('wordprocessingml')) return 'docx';
  if (ext === 'pptx' || contentType.includes('presentationml')) return 'pptx';
  if (ext === 'xlsx' || contentType.includes('spreadsheetml')) return 'xlsx';
  if (ext === 'csv' || contentType === 'text/csv') return 'csv';
  if (ext === 'vtt' || ext === 'srt' || contentType === 'text/vtt' || contentType === 'application/x-subrip') return 'captions';
  if (['txt', 'md', 'markdown', 'text', 'log'].includes(ext) || contentType === 'text/plain' || contentType === 'text/markdown') return 'text';
  if (['html', 'htm'].includes(ext) || contentType === 'text/html') return 'html';
  if (ext === 'rtf' || contentType === 'application/rtf' || contentType === 'text/rtf') return 'rtf';
  if (['odt', 'odp', 'ods'].includes(ext) || contentType.includes('opendocument')) return 'odf';
  if (['doc', 'ppt', 'xls'].includes(ext) || ['application/msword', 'application/vnd.ms-powerpoint', 'application/vnd.ms-excel'].includes(contentType)) return 'legacy';
  if (contentType.startsWith('image/') || ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'tif', 'tiff'].includes(ext)) return 'image';
  if (contentType.startsWith('video/') || ['mp4', 'webm', 'mov', 'm4v', 'mkv', 'avi', 'ogv'].includes(ext)) return 'video';
  if (contentType.startsWith('audio/') || ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'oga', 'flac'].includes(ext)) return 'audio';
  return 'other';
}

/** Reads the text of an uploaded file. Never throws: a file it cannot read is UNREADABLE with the reason. */
export async function extractText(data: Buffer, contentType: string, name: string): Promise<Extracted> {
  const kind = kindOfFile(contentType, name);
  try {
    switch (kind) {
      case 'pdf':
        return await readPdf(data);
      case 'docx':
        return await readDocx(data);
      case 'pptx':
        return await readPptx(data);
      case 'xlsx':
        return await readXlsx(data);
      case 'csv':
        return readCsv(data.toString('utf8'));
      case 'text':
        return ready(decodeText(data), 'DOCUMENT', null, 'Read the whole text file.');
      case 'captions':
        return ready(captionsText(decodeText(data)), 'CAPTIONS', null, 'Read the captions file.');
      case 'html':
        return ready(htmlText(decodeText(data)), 'DOCUMENT', null, 'Read the text of the web page file.');
      case 'rtf':
        return ready(rtfText(decodeText(data)), 'DOCUMENT', null, 'Read the text of the RTF document.');
      case 'odf':
        return await readOdf(data);
      case 'legacy':
        return readLegacy(data, name);
      case 'image': {
        const r = await recognise([data]);
        if (!r) return unreadable('Text recognition is not available on this server, so the text in this image could not be read.');
        return letters(r.text) >= 20 ? ready(r.text, 'OCR', 1, `Recognised the text in the image (${Math.round(r.confidence)}% confidence). Check drafted questions carefully.`) : unreadable('No readable text was found in this image.');
      }
      case 'video':
      case 'audio':
        return unreadable('SampForce cannot listen to video or audio files. Upload a captions file (WebVTT or SRT) or paste a transcript to draft questions from it.');
      default:
        return unreadable('SampForce cannot read this type of file. Upload a PDF, Word, PowerPoint, Excel or text file, or paste the content as a written lesson.');
    }
  } catch {
    return unreadable(kind === 'pdf' ? 'This PDF could not be read. It may be damaged or protected by a password.' : 'This file could not be read. It may be damaged or protected by a password.');
  }
}

function decodeText(data: Buffer): string {
  if (data[0] === 0xff && data[1] === 0xfe) return data.subarray(2).toString('utf16le');
  if (data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf) return data.subarray(3).toString('utf8');
  return data.toString('utf8');
}

// ─── PDF ───

type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs');
let pdfjs: PdfJs | null = null;
function loadPdfJs(): PdfJs {
  // pdf.js is an ES module; Node 22+ loads it with require.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  pdfjs ??= require('pdfjs-dist/legacy/build/pdf.mjs') as PdfJs;
  return pdfjs;
}
const PDF_DIR = () => dirname(require.resolve('pdfjs-dist/package.json'));

const MAX_PDF_PAGES = 400;
const MAX_OCR_PAGES = 30;

async function readPdf(data: Buffer): Promise<Extracted> {
  const lib = loadPdfJs();
  const task = lib.getDocument({
    data: new Uint8Array(data),
    disableFontFace: true,
    useSystemFonts: false,
    standardFontDataUrl: `${join(PDF_DIR(), 'standard_fonts')}/`,
    verbosity: 0,
  });
  const doc = await task.promise;
  try {
    const pages = Math.min(doc.numPages, MAX_PDF_PAGES);
    const texts: string[] = [];
    for (let i = 1; i <= pages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      let line = '';
      const lines: string[] = [];
      for (const item of content.items as { str?: string; hasEOL?: boolean }[]) {
        if (typeof item.str !== 'string') continue;
        line += item.str;
        if (item.hasEOL) {
          lines.push(line);
          line = '';
        }
      }
      if (line) lines.push(line);
      texts.push(joinWrapped(lines));
      page.cleanup();
    }
    const text = texts.join('\n\n');
    // Little text across many pages: a scan. Recognise the pictures of the pages instead.
    if (letters(text) < 40 * pages) {
      const images: Buffer[] = [];
      for (let i = 1; i <= Math.min(pages, MAX_OCR_PAGES); i++) images.push(...(await pageImages(lib, await doc.getPage(i))));
      if (images.length) {
        const r = await recognise(images);
        if (!r) return letters(text) >= 20 ? ready(text, 'DOCUMENT', pages, `Read ${pages} pages. Most pages are scans, and text recognition is not available on this server.`) : unreadable('This PDF is scanned pages, and text recognition is not available on this server. Upload a PDF with selectable text, or paste the content as a written lesson.');
        const merged = [text, r.text].filter((t) => letters(t) > 0).join('\n\n');
        if (letters(merged) >= 20) return ready(merged, 'OCR', pages, `This PDF is scanned. Recognised the text of ${Math.min(pages, MAX_OCR_PAGES)} pages (${Math.round(r.confidence)}% confidence). Check drafted questions carefully.`);
      }
      if (letters(text) < 20) return unreadable('This PDF has no selectable text and no page images SampForce could read. Upload a PDF with selectable text, or paste the content as a written lesson.');
    }
    return ready(text, 'DOCUMENT', pages, doc.numPages > pages ? `Read the first ${pages} of ${doc.numPages} pages.` : `Read all ${pages} ${pages === 1 ? 'page' : 'pages'}.`);
  } finally {
    await task.destroy();
  }
}

/** Joins lines of a page into paragraphs: a line ending without punctuation continues on the next one. */
function joinWrapped(lines: string[]): string {
  const out: string[] = [];
  let para = '';
  for (const raw of lines) {
    const l = raw.trim();
    if (!l) {
      if (para) out.push(para);
      para = '';
      continue;
    }
    if (!para) para = l;
    else if (/[.!?:;]$/.test(para) || /^[•\-–*\d]+[.)]?\s/.test(l)) {
      out.push(para);
      para = l;
    } else para = `${para.replace(/-$/, '')}${para.endsWith('-') ? '' : ' '}${l}`;
  }
  if (para) out.push(para);
  return out.join('\n');
}

/** The pictures drawn on a PDF page (a scanned page is one), as PNG files for recognition. */
async function pageImages(lib: PdfJs, page: Awaited<ReturnType<Awaited<ReturnType<PdfJs['getDocument']>['promise']>['getPage']>>): Promise<Buffer[]> {
  const ops = await page.getOperatorList();
  const out: Buffer[] = [];
  const names = new Set<string>();
  ops.fnArray.forEach((fn, i) => {
    if (fn === lib.OPS.paintImageXObject || fn === lib.OPS.paintImageXObjectRepeat) {
      const name = ops.argsArray[i]?.[0];
      if (typeof name === 'string') names.add(name);
    }
  });
  for (const name of names) {
    const img = await new Promise<{ width: number; height: number; kind?: number; data?: Uint8Array | Uint8ClampedArray } | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), 5000);
      try {
        const objs = name.startsWith('g_') ? page.commonObjs : page.objs;
        objs.get(name, (v: unknown) => {
          clearTimeout(timer);
          resolve(v as never);
        });
      } catch {
        clearTimeout(timer);
        resolve(null);
      }
    });
    if (!img?.data || img.width < 200 || img.height < 100) continue;
    const png = toPng(img.width, img.height, img.kind ?? 2, img.data);
    if (png) out.push(png);
  }
  return out;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** Encodes a pdf.js image (1-bit grey, RGB or RGBA) as a greyscale PNG, which is all recognition needs. */
export function toPng(width: number, height: number, kind: number, data: Uint8Array | Uint8ClampedArray): Buffer | null {
  const rows = Buffer.alloc((width + 1) * height);
  const rowBytes1 = Math.ceil(width / 8);
  for (let y = 0; y < height; y++) {
    rows[y * (width + 1)] = 0;
    for (let x = 0; x < width; x++) {
      let v: number;
      if (kind === 1) v = (data[y * rowBytes1 + (x >> 3)]! >> (7 - (x & 7))) & 1 ? 255 : 0;
      else if (kind === 3) {
        const i = (y * width + x) * 4;
        v = (data[i]! * 299 + data[i + 1]! * 587 + data[i + 2]! * 114) / 1000;
      } else {
        const i = (y * width + x) * 3;
        if (i + 2 >= data.length) return null;
        v = (data[i]! * 299 + data[i + 1]! * 587 + data[i + 2]! * 114) / 1000;
      }
      rows[y * (width + 1) + 1 + x] = v;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

// ─── Office Open XML ───

const MAX_UNZIPPED = 120 * 1024 * 1024;

async function openZip(data: Buffer): Promise<JSZip> {
  const zip = await JSZip.loadAsync(data);
  let total = 0;
  zip.forEach((_, f) => {
    total += (f as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0;
  });
  // A zip bomb: far more inside than any document holds.
  if (total > MAX_UNZIPPED) throw new Error('too big');
  return zip;
}

const textRuns = (xml: string, tag: string) => [...xml.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([^<]*)</${tag}>`, 'g'))].map((m) => decodeXml(m[1]!)).join('');

async function readDocx(data: Buffer): Promise<Extracted> {
  const zip = await openZip(data);
  const xml = await zip.file('word/document.xml')?.async('string');
  if (!xml) return unreadable('This Word file has no document text.');
  const body = xml.replace(/<w:tab\/>/g, '<w:t> </w:t>').replace(/<w:br[^>]*\/>/g, '<w:t>\n</w:t>');
  const out: string[] = [];
  // Tables: each row on one line, cells separated by " | ".
  const parts = body.split(/(<w:tbl>[\s\S]*?<\/w:tbl>)/);
  for (const part of parts) {
    if (part.startsWith('<w:tbl>')) {
      for (const row of part.match(/<w:tr[\s>][\s\S]*?<\/w:tr>/g) ?? []) {
        const cells = (row.match(/<w:tc>[\s\S]*?<\/w:tc>/g) ?? []).map((c) => textRuns(c, 'w:t').trim()).filter(Boolean);
        if (cells.length) out.push(cells.join(' | '));
      }
      out.push('');
      continue;
    }
    for (const p of part.match(/<w:p[\s>][\s\S]*?<\/w:p>/g) ?? []) {
      const text = textRuns(p, 'w:t').trim();
      if (!text) continue;
      const style = /<w:pStyle w:val="([^"]+)"/.exec(p)?.[1] ?? '';
      if (/^(Heading|Title|Subtitle)/i.test(style) || /^Kop|^Titre|^berschrift/i.test(style)) out.push('', `# ${text}`);
      else if (/<w:numPr>/.test(p) || /List/i.test(style)) out.push(`- ${text}`);
      else out.push(text, '');
    }
  }
  return ready(out.join('\n'), 'DOCUMENT', null, 'Read the Word document.');
}

async function readPptx(data: Buffer): Promise<Extracted> {
  const zip = await openZip(data);
  const slides = Object.keys(zip.files)
    .map((n) => /^ppt\/slides\/slide(\d+)\.xml$/.exec(n))
    .filter((m): m is RegExpExecArray => !!m)
    .sort((a, b) => Number(a[1]) - Number(b[1]));
  if (!slides.length) return unreadable('This PowerPoint file has no slides.');
  const out: string[] = [];
  for (const m of slides) {
    const xml = (await zip.file(m[0])!.async('string')) ?? '';
    const shapes = xml.match(/<p:sp>[\s\S]*?<\/p:sp>/g) ?? [];
    let title = '';
    const lines: string[] = [];
    for (const sp of shapes) {
      const isTitle = /<p:ph[^>]*type="(title|ctrTitle)"/.test(sp);
      const paras = (sp.match(/<a:p>[\s\S]*?<\/a:p>/g) ?? []).map((p) => textRuns(p, 'a:t').trim()).filter(Boolean);
      if (isTitle && !title) title = paras.join(' ');
      else lines.push(...paras.map((p) => (paras.length > 1 ? `- ${p}` : p)));
    }
    const notesXml = await zip.file(`ppt/notesSlides/notesSlide${m[1]}.xml`)?.async('string');
    const notes = notesXml ? (notesXml.match(/<a:p>[\s\S]*?<\/a:p>/g) ?? []).map((p) => textRuns(p, 'a:t').trim()).filter((t) => t && !/^\d+$/.test(t)) : [];
    out.push(`# ${title || `Slide ${m[1]}`}`, ...lines, ...(notes.length ? ['', ...notes] : []), '');
  }
  return ready(out.join('\n'), 'DOCUMENT', slides.length, `Read ${slides.length} ${slides.length === 1 ? 'slide' : 'slides'} and their speaker notes.`);
}

const MAX_SHEET_ROWS = 2000;

async function readXlsx(data: Buffer): Promise<Extracted> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data as unknown as ArrayBuffer);
  const out: string[] = [];
  let sheets = 0;
  wb.eachSheet((ws) => {
    const rows: string[][] = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      if (rows.length >= MAX_SHEET_ROWS) return;
      const values = (row.values as unknown[]).slice(1).map(cellText);
      if (values.some(Boolean)) rows.push(values);
    });
    if (!rows.length) return;
    sheets++;
    out.push(`# ${ws.name}`, ...tableLines(rows), '');
  });
  if (!sheets) return unreadable('This workbook has no filled cells.');
  return ready(out.join('\n'), 'DOCUMENT', sheets, `Read ${sheets} ${sheets === 1 ? 'sheet' : 'sheets'}.`);
}

function cellText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    const o = v as { text?: unknown; result?: unknown; richText?: { text: string }[]; hyperlink?: string };
    if (o.richText) return o.richText.map((r) => r.text).join('').trim();
    if (o.text !== undefined) return String(o.text).trim();
    if (o.result !== undefined) return cellText(o.result);
    return '';
  }
  return String(v).trim();
}

/**
 * A table as sentences: with a header row, each row reads "Header: value; Header: value", so facts like "Region:
 * North; Target: 120" can become questions. Without one, the cells are joined.
 */
function tableLines(rows: string[][]): string[] {
  const [head, ...rest] = rows;
  const headerLike = head && rest.length > 0 && head.filter(Boolean).length >= 2 && head.every((h) => !h || !/^-?[\d.,%]+$/.test(h));
  if (!headerLike) return rows.map((r) => r.filter(Boolean).join(' | '));
  return rest.map((r) => {
    const cells = head!.map((h, i) => (r[i] ? `${h || `Column ${i + 1}`}: ${r[i]}` : '')).filter(Boolean);
    return `${cells.join('; ')}.`;
  });
}

function readCsv(text: string): Extracted {
  const rows: string[][] = [];
  for (const line of text.replace(/\r\n?/g, '\n').split('\n').slice(0, MAX_SHEET_ROWS + 1)) {
    if (!line.trim()) continue;
    const cells: string[] = [];
    let cur = '';
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]!;
      if (quoted) {
        if (ch === '"' && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else if (ch === '"') quoted = false;
        else cur += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ',' || ch === ';' || ch === '\t') {
        cells.push(cur.trim());
        cur = '';
      } else cur += ch;
    }
    cells.push(cur.trim());
    rows.push(cells);
  }
  if (!rows.length) return unreadable('This file has no rows.');
  return ready(tableLines(rows).join('\n'), 'DOCUMENT', 1, `Read ${rows.length} rows.`);
}

async function readOdf(data: Buffer): Promise<Extracted> {
  const zip = await openZip(data);
  const xml = await zip.file('content.xml')?.async('string');
  if (!xml) return unreadable('This OpenDocument file has no content.');
  const out: string[] = [];
  for (const m of xml.matchAll(/<text:(h|p)\b[^>]*>([\s\S]*?)<\/text:\1>/g)) {
    const text = decodeXml(m[2]!.replace(/<text:s\/>/g, ' ').replace(/<text:tab\/>/g, ' ').replace(/<[^>]+>/g, '')).trim();
    if (!text) continue;
    out.push(m[1] === 'h' ? `\n# ${text}` : text);
  }
  return ready(out.join('\n'), 'DOCUMENT', null, 'Read the OpenDocument file.');
}

/**
 * Old binary Word, PowerPoint and Excel files (.doc, .ppt, .xls). Their text is stored as runs of characters inside the
 * file, so SampForce reads the runs that look like words. It says so, because formatting and order may be off.
 */
function readLegacy(data: Buffer, name: string): Extracted {
  const runs: string[] = [];
  const utf16 = data.toString('utf16le');
  for (const m of utf16.matchAll(/[\p{L}\p{N}\p{P}\p{Zs}]{20,}/gu)) runs.push(m[0]);
  const latin = data.toString('latin1');
  for (const m of latin.matchAll(/[A-Za-z0-9 ,.;:'"!?()\-–%]{30,}/g)) runs.push(m[0]);
  const words = (s: string) => s.split(/\s+/).filter((w) => /^\p{L}{2,}/u.test(w)).length;
  const kept = [...new Set(runs.map((r) => r.trim()).filter((r) => words(r) >= 4 && letters(r) / r.length > 0.6))];
  const text = kept.join('\n');
  const ext = EXT(name) || 'file';
  if (letters(text) < 80) return unreadable(`SampForce could not read this older .${ext} file. Save it as .${ext}x (or PDF) and upload it again.`);
  return ready(text, 'DOCUMENT', null, `Read the text of this older .${ext} file. Order and formatting may be off; saving it as .${ext}x gives the best result.`);
}

// ─── Text formats ───

export function htmlText(html: string): string {
  return decodeXml(
    html
      .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, '')
      .replace(/<h[1-6][^>]*>/gi, '\n# ')
      .replace(/<\/(p|div|h[1-6]|li|tr|section|article)>/gi, '\n')
      .replace(/<li[^>]*>/gi, '- ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  );
}

function rtfText(rtf: string): string {
  return rtf
    .replace(/\\par[d]?/g, '\n')
    .replace(/\{\\\*[^{}]*\}/g, '')
    .replace(/\\'([0-9a-f]{2})/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\u(-?\d+)\??/g, (_, d: string) => String.fromCharCode(Number(d) < 0 ? Number(d) + 65536 : Number(d)))
    .replace(/\\[a-z]+-?\d* ?/gi, '')
    .replace(/[{}]/g, '');
}

/**
 * The words of a WebVTT or SRT captions file, joined into paragraphs. Auto-generated captions repeat each line as it
 * rolls up; repeats are dropped.
 */
export function captionsText(raw: string): string {
  const lines = raw.replace(/\r\n?/g, '\n').split('\n');
  const words: string[] = [];
  let last = '';
  for (const l of lines) {
    const t = l.trim();
    if (!t || t === 'WEBVTT' || /^(NOTE|STYLE|REGION|Kind:|Language:)/.test(t) || /^\d+$/.test(t) || /-->/.test(t)) continue;
    const clean = t.replace(/<[^>]+>/g, '').replace(/\[(music|applause|laughter)\]/gi, '').trim();
    if (!clean || clean === last) continue;
    // A rolling caption starts with the previous one: keep only the new words.
    words.push(last && clean.startsWith(last) ? clean.slice(last.length).trim() : clean);
    last = clean;
  }
  return sentencesToParagraphs(words.join(' '));
}

/** Breaks a long run of spoken words into paragraphs of about five sentences. */
export function sentencesToParagraphs(text: string): string {
  const sentences = text.replace(/\s+/g, ' ').match(/[^.!?]+[.!?]+["')\]]*|[^.!?]+$/g) ?? [];
  const out: string[] = [];
  for (let i = 0; i < sentences.length; i += 5) out.push(sentences.slice(i, i + 5).join(' ').trim());
  return out.join('\n\n');
}
