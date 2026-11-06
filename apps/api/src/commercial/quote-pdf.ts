import PDFDocument from 'pdfkit';
import { bidStyle, textOn, type BidStyle, type ProposalSection, type QuoteRow } from '@dealflow/types';
import { inLanguage, pdfMoney, requestLanguage, tr } from '../common/request-language';
import { hasArabic, latin1, PdfText } from './pdf-text';

/** What the PDF prints: a quote, or the public view of one. */
export type PdfQuote = Pick<QuoteRow, 'reference' | 'title' | 'currency' | 'createdAt' | 'validUntil' | 'subtotal' | 'discountTotal' | 'taxTotal' | 'total' | 'notes' | 'terms'> & {
  deal: { companyName: string | null };
  lines: Pick<QuoteRow['lines'][number], 'name' | 'description' | 'quantity' | 'unitPrice' | 'discountPercent' | 'netTotal'>[];
  sections: ProposalSection[];
};
export interface PdfSeller {
  name: string;
  logoDataUrl?: string | null;
  header?: string | null;
  footer?: string | null;
  /** Bid template look; the plain default when left out. */
  style?: BidStyle;
}

/**
 * Renders a quote as a PDF. Labels, dates and amounts are written in the reader's language, right to left for Arabic
 * (ADR 0054); what people typed is kept as typed, Arabic included.
 */
export function renderQuotePdf(q: PdfQuote, seller: PdfSeller): Promise<Buffer> {
  return inLanguage(requestLanguage(), () => drawQuotePdf(q, seller));
}

function drawQuotePdf(q: PdfQuote, seller: PdfSeller): Promise<Buffer> {
  const money = (v: number) => pdfMoney(v, q.currency);
  const rtl = requestLanguage() === 'ar';
  const unicode = rtl || hasArabic(JSON.stringify([q, seller.name, seller.header, seller.footer]));
  const title = `${q.reference} ${q.title}`;
  const doc = new PDFDocument({ size: 'A4', margin: 50, lang: requestLanguage(), info: { Title: unicode ? title : latin1(title), Author: unicode ? seller.name : latin1(seller.name), Creator: 'SampForce' } });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  const style = seller.style ?? bidStyle(null, null);
  const accent = style.accent;
  const w = new PdfText(doc, { rtl, unicode, family: style.font === 'serif' ? 'serif' : 'sans' });
  // Cover styles: an accent band, a dark band, an accent rule down the left edge (the right edge in Arabic), or a quiet rule under the title.
  const banded = style.cover === 'band' || style.cover === 'dark';
  if (banded) {
    doc.rect(0, 0, doc.page.width, 120).fill(style.cover === 'dark' ? '#111111' : accent);
    if (style.cover === 'dark') doc.rect(0, 120, doc.page.width, 4).fill(accent);
    doc.y = 40;
  }
  if (style.cover === 'split') doc.rect(w.x(0, 12), 0, 12, doc.page.height).fill(accent);
  if (seller.logoDataUrl && !banded) {
    try {
      doc.image(Buffer.from(seller.logoDataUrl.split(',')[1] ?? '', 'base64'), w.x(50, 160), 40, { fit: [160, 50], ...(rtl && { align: 'right' as const }) });
      doc.y = 100;
    } catch {
      // A logo pdfkit cannot read is left out rather than failing the whole document.
    }
  }
  const onBand = banded ? (style.cover === 'dark' ? '#ffffff' : textOn(accent)) : '#000';
  doc.fontSize(18).fillColor(onBand);
  w.text(seller.name, 50, doc.y, { bold: true, width: 495 });
  if (seller.header) {
    doc.moveDown(0.2).fontSize(9).fillColor(banded ? onBand : '#555');
    w.text(seller.header, undefined, undefined, { bold: false, width: 495 });
  }
  if (banded) doc.y = Math.max(doc.y, 140);
  doc.moveDown(0.3).fontSize(10).fillColor('#555');
  w.text(q.sections.length ? tr('Proposal {reference}', { reference: q.reference }) : tr('Quote {reference}', { reference: q.reference }), 50, undefined, { bold: false });
  const date = tr('Date: {date}', { date: q.createdAt.slice(0, 10) });
  w.text(q.validUntil ? `${date}    ${tr('Valid until: {date}', { date: q.validUntil })}` : date);
  if (q.deal.companyName) w.text(tr('Prepared for: {company}', { company: q.deal.companyName }));
  doc.moveDown().fillColor(accent).fontSize(16);
  w.text(q.title, undefined, undefined, { bold: true });
  if (style.cover === 'minimal') doc.moveTo(w.x(50), doc.y + 4).lineTo(w.x(130), doc.y + 4).lineWidth(2).strokeColor(accent).stroke().lineWidth(1);
  doc.fillColor('#000');
  doc.moveDown(0.5);
  for (const s of q.sections) {
    doc.fontSize(11.5).fillColor(accent);
    w.text(s.heading, 50, doc.y, { bold: true, width: 495 });
    if (s.body) {
      doc.moveDown(0.2).fontSize(9.5).fillColor('#000');
      w.text(s.body, undefined, undefined, { bold: false, width: 495 });
    }
    doc.moveDown(0.8);
  }
  if (q.sections.length) {
    doc.fontSize(11.5).fillColor(accent);
    w.text(tr('Pricing'), 50, undefined, { bold: true });
    doc.fillColor('#000').moveDown(0.4);
  }

  const cols = [50, 260, 310, 390, 440, 545];
  const header = [tr('Item'), tr('Qty'), tr('Unit price'), tr('Disc.'), tr('Net')];
  const row = (cells: string[], bold = false) => {
    const y = doc.y;
    let bottom = y;
    doc.fontSize(9);
    cells.forEach((c, i) => {
      w.text(c, cols[i]!, y, { bold, width: cols[i + 1]! - cols[i]! - 6, align: i === 0 ? 'left' : 'right' });
      bottom = Math.max(bottom, doc.y);
    });
    doc.y = bottom;
    doc.moveDown(0.4);
    doc.x = 50;
  };
  row(header, true);
  doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor(accent).stroke().moveDown(0.3);
  for (const l of q.lines) {
    row([l.name, String(l.quantity), money(l.unitPrice), l.discountPercent ? `${l.discountPercent}%` : '-', money(l.netTotal)]);
    if (l.description) {
      doc.fontSize(8).fillColor('#666');
      w.text(l.description, 58, doc.y, { bold: false, width: 200 });
      doc.fillColor('#000').moveDown(0.3);
    }
    doc.x = 50;
  }
  doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#ccc').stroke().moveDown(0.5);
  const total = (label: string, v: string, bold = false) => {
    const y = doc.y;
    doc.fontSize(bold ? 11 : 9);
    w.text(label, 330, y, { bold, width: 110, align: 'right' });
    w.text(v, 440, y, { width: 105, align: 'right' });
    doc.moveDown(0.3);
  };
  total(tr('Subtotal'), money(q.subtotal));
  if (q.discountTotal) total(tr('Discount'), `- ${money(q.discountTotal)}`);
  if (q.taxTotal) total(tr('Tax'), money(q.taxTotal));
  doc.fillColor(accent);
  total(tr('Total'), money(q.total), true);
  doc.fillColor('#000');

  doc.x = 50;
  for (const [label, body] of [[tr('Notes'), q.notes], [tr('Terms'), q.terms]] as const) {
    if (!body) continue;
    doc.moveDown().fontSize(10);
    w.text(label, 50, undefined, { bold: true });
    doc.fontSize(9);
    w.text(body, undefined, undefined, { bold: false, width: 495 });
  }
  if (seller.footer) {
    doc.moveDown(1.5).fontSize(8).fillColor('#666');
    w.text(seller.footer, 50, doc.y, { bold: false, width: 495, align: 'center' });
  }
  w.end();
  return done;
}
