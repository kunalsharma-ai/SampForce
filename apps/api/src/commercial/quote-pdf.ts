import PDFDocument from 'pdfkit';
import { bidStyle, textOn, type BidStyle, type ProposalSection, type QuoteRow } from '@dealflow/types';
import { inLanguage, pdfLanguage, pdfMoney, tr } from '../common/request-language';

/**
 * Renders a quote as a PDF with the built-in Helvetica (or Times, for serif bid templates) fonts. That font covers Latin-1 only, so other
 * characters are replaced rather than printed as gibberish; a Unicode font is a follow-up.
 */
const latin1 = (s: string) => s.replace(/[^\x20-\x7E\xA0-\xFF\n]/g, '?');

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

/** Labels, dates and amounts are written in the reader's language (English for Arabic, see `pdfLanguage`); what people typed is kept as typed. */
export function renderQuotePdf(q: PdfQuote, seller: PdfSeller): Promise<Buffer> {
  return inLanguage(pdfLanguage(), () => drawQuotePdf(q, seller));
}

function drawQuotePdf(q: PdfQuote, seller: PdfSeller): Promise<Buffer> {
  const money = (v: number) => pdfMoney(v, q.currency);
  const doc = new PDFDocument({ size: 'A4', margin: 50, info: { Title: latin1(`${q.reference} ${q.title}`), Author: latin1(seller.name), Creator: 'DealFlow' } });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  const style = seller.style ?? bidStyle(null, null);
  const accent = style.accent;
  const F = style.font === 'serif' ? { regular: 'Times-Roman', bold: 'Times-Bold' } : { regular: 'Helvetica', bold: 'Helvetica-Bold' };
  // Cover styles: an accent band, a dark band, an accent rule down the left edge, or a quiet rule under the title.
  const banded = style.cover === 'band' || style.cover === 'dark';
  if (banded) {
    doc.rect(0, 0, doc.page.width, 120).fill(style.cover === 'dark' ? '#111111' : accent);
    if (style.cover === 'dark') doc.rect(0, 120, doc.page.width, 4).fill(accent);
    doc.y = 40;
  }
  if (style.cover === 'split') doc.rect(0, 0, 12, doc.page.height).fill(accent);
  if (seller.logoDataUrl && !banded) {
    try {
      doc.image(Buffer.from(seller.logoDataUrl.split(',')[1] ?? '', 'base64'), 50, 40, { fit: [160, 50] });
      doc.y = 100;
    } catch {
      // A logo pdfkit cannot read is left out rather than failing the whole document.
    }
  }
  const onBand = banded ? (style.cover === 'dark' ? '#ffffff' : textOn(accent)) : '#000';
  doc.fontSize(18).font(F.bold).fillColor(onBand).text(latin1(seller.name), 50, doc.y, { width: 495 });
  if (seller.header) doc.moveDown(0.2).fontSize(9).font(F.regular).fillColor(banded ? onBand : '#555').text(latin1(seller.header), { width: 495 });
  if (banded) doc.y = Math.max(doc.y, 140);
  doc.moveDown(0.3).fontSize(10).font(F.regular).fillColor('#555').text(latin1(q.sections.length ? tr('Proposal {reference}', { reference: q.reference }) : tr('Quote {reference}', { reference: q.reference })), 50);
  const date = tr('Date: {date}', { date: q.createdAt.slice(0, 10) });
  doc.text(latin1(q.validUntil ? `${date}    ${tr('Valid until: {date}', { date: q.validUntil })}` : date));
  if (q.deal.companyName) doc.text(latin1(tr('Prepared for: {company}', { company: q.deal.companyName })));
  doc.moveDown().fillColor(accent).fontSize(16).font(F.bold).text(latin1(q.title));
  if (style.cover === 'minimal') doc.moveTo(50, doc.y + 4).lineTo(130, doc.y + 4).lineWidth(2).strokeColor(accent).stroke().lineWidth(1);
  doc.fillColor('#000');
  doc.moveDown(0.5);
  for (const s of q.sections) {
    doc.font(F.bold).fontSize(11.5).fillColor(accent).text(latin1(s.heading), 50, doc.y, { width: 495 });
    if (s.body) doc.moveDown(0.2).font(F.regular).fontSize(9.5).fillColor('#000').text(latin1(s.body), { width: 495 });
    doc.moveDown(0.8);
  }
  if (q.sections.length) doc.font(F.bold).fontSize(11.5).fillColor(accent).text(latin1(tr('Pricing')), 50).fillColor('#000').moveDown(0.4);

  const cols = [50, 260, 310, 390, 440, 545];
  const header = [tr('Item'), tr('Qty'), tr('Unit price'), tr('Disc.'), tr('Net')];
  const row = (cells: string[], bold = false) => {
    const y = doc.y;
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9);
    cells.forEach((c, i) => doc.text(latin1(c), cols[i]!, y, { width: cols[i + 1]! - cols[i]! - 6, align: i === 0 ? 'left' : 'right' }));
    doc.moveDown(0.4);
    doc.x = 50;
  };
  row(header, true);
  doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor(accent).stroke().moveDown(0.3);
  for (const l of q.lines) {
    row([l.name, String(l.quantity), money(l.unitPrice), l.discountPercent ? `${l.discountPercent}%` : '-', money(l.netTotal)]);
    if (l.description) doc.font('Helvetica').fontSize(8).fillColor('#666').text(latin1(l.description), 58, doc.y, { width: 200 }).fillColor('#000').moveDown(0.3);
    doc.x = 50;
  }
  doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#ccc').stroke().moveDown(0.5);
  const total = (label: string, v: string, bold = false) => {
    const y = doc.y;
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 11 : 9).text(latin1(label), 330, y, { width: 110, align: 'right' }).text(v, 440, y, { width: 105, align: 'right' });
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
    doc.moveDown().font('Helvetica-Bold').fontSize(10).text(latin1(label), 50).font('Helvetica').fontSize(9).text(latin1(body), { width: 495 });
  }
  if (seller.footer) doc.moveDown(1.5).font('Helvetica').fontSize(8).fillColor('#666').text(latin1(seller.footer), 50, doc.y, { width: 495, align: 'center' });
  doc.end();
  return done;
}
