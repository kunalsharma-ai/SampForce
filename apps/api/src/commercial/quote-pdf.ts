import PDFDocument from 'pdfkit';
import type { QuoteRow } from '@dealflow/types';

/**
 * Renders a quote as a PDF with the built-in Helvetica font. That font covers Latin-1 only, so other
 * characters are replaced rather than printed as gibberish; a Unicode font is a follow-up.
 */
const latin1 = (s: string) => s.replace(/[^\x20-\x7E\xA0-\xFF\n]/g, '?');

export function renderQuotePdf(q: QuoteRow, seller: { name: string }): Promise<Buffer> {
  const money = (v: number) => `${q.currency} ${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const doc = new PDFDocument({ size: 'A4', margin: 50, info: { Title: latin1(`${q.reference} ${q.title}`), Author: latin1(seller.name), Creator: 'DealFlow' } });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  doc.fontSize(18).font('Helvetica-Bold').text(latin1(seller.name));
  doc.moveDown(0.3).fontSize(10).font('Helvetica').fillColor('#555').text(`Quote ${q.reference}`);
  doc.text(`Date: ${q.createdAt.slice(0, 10)}${q.validUntil ? `    Valid until: ${q.validUntil}` : ''}`);
  if (q.deal.companyName) doc.text(latin1(`Prepared for: ${q.deal.companyName}`));
  doc.moveDown().fillColor('#000').fontSize(14).font('Helvetica-Bold').text(latin1(q.title));
  doc.moveDown(0.5);

  const cols = [50, 260, 310, 390, 440, 545];
  const header = ['Item', 'Qty', 'Unit price', 'Disc.', 'Net'];
  const row = (cells: string[], bold = false) => {
    const y = doc.y;
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9);
    cells.forEach((c, i) => doc.text(latin1(c), cols[i]!, y, { width: cols[i + 1]! - cols[i]! - 6, align: i === 0 ? 'left' : 'right' }));
    doc.moveDown(0.4);
    doc.x = 50;
  };
  row(header, true);
  doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#ccc').stroke().moveDown(0.3);
  for (const l of q.lines) {
    row([l.name, String(l.quantity), money(l.unitPrice), l.discountPercent ? `${l.discountPercent}%` : '-', money(l.netTotal)]);
    if (l.description) doc.font('Helvetica').fontSize(8).fillColor('#666').text(latin1(l.description), 58, doc.y, { width: 200 }).fillColor('#000').moveDown(0.3);
    doc.x = 50;
  }
  doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#ccc').stroke().moveDown(0.5);
  const total = (label: string, v: string, bold = false) => {
    const y = doc.y;
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 11 : 9).text(label, 330, y, { width: 110, align: 'right' }).text(v, 440, y, { width: 105, align: 'right' });
    doc.moveDown(0.3);
  };
  total('Subtotal', money(q.subtotal));
  if (q.discountTotal) total('Discount', `- ${money(q.discountTotal)}`);
  if (q.taxTotal) total('Tax', money(q.taxTotal));
  total('Total', money(q.total), true);

  doc.x = 50;
  for (const [label, body] of [['Notes', q.notes], ['Terms', q.terms]] as const) {
    if (!body) continue;
    doc.moveDown().font('Helvetica-Bold').fontSize(10).text(label, 50).font('Helvetica').fontSize(9).text(latin1(body), { width: 495 });
  }
  doc.end();
  return done;
}
