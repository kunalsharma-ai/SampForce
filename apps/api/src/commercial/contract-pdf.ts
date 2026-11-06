import PDFDocument from 'pdfkit';
import type { ContractRow } from '@dealflow/types';
import { inLanguage, pdfMoney, requestLanguage, tr } from '../common/request-language';
import { hasArabic, latin1, PdfText } from './pdf-text';

/**
 * The contract as a PDF for e-signature: parties, dates, value and terms, then a signature block. The block carries
 * the anchors /sn1/ and /ds1/ in white text, where DocuSign places the signature and date fields.
 */
type PdfContract = Pick<ContractRow, 'reference' | 'name' | 'company' | 'value' | 'currency' | 'startDate' | 'endDate' | 'autoRenew' | 'terms'>;

/** Labels and amounts are written in the sender's language, right to left for Arabic (ADR 0054); the terms are kept as typed. */
export function renderContractPdf(c: PdfContract, seller: { name: string }, signerName: string): Promise<Buffer> {
  return inLanguage(requestLanguage(), () => drawContractPdf(c, seller, signerName));
}

function drawContractPdf(c: PdfContract, seller: { name: string }, signerName: string): Promise<Buffer> {
  const rtl = requestLanguage() === 'ar';
  const unicode = rtl || hasArabic(JSON.stringify([c, seller.name, signerName]));
  const title = `${c.reference} ${c.name}`;
  const doc = new PDFDocument({ size: 'A4', margin: 50, lang: requestLanguage(), info: { Title: unicode ? title : latin1(title), Author: unicode ? seller.name : latin1(seller.name), Creator: 'SampForce' } });
  const chunks: Buffer[] = [];
  doc.on('data', (b: Buffer) => chunks.push(b));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
  const money = pdfMoney(c.value, c.currency);
  const w = new PdfText(doc, { rtl, unicode, family: 'sans' });

  doc.fontSize(18).fillColor('#000');
  w.text(seller.name, undefined, undefined, { bold: true });
  doc.moveDown(0.3).fontSize(10).fillColor('#555');
  w.text(tr('Contract {reference}', { reference: c.reference }), undefined, undefined, { bold: false });
  doc.moveDown().fontSize(14).fillColor('#000');
  w.text(c.name, undefined, undefined, { bold: true });
  doc.moveDown(0.6).fontSize(10);
  w.font(false);
  if (c.company) w.text(tr('Customer: {company}', { company: c.company.name }));
  w.text(tr('Value: {value}', { value: money }));
  const dates = [tr('Starts: {date}', { date: c.startDate }), c.endDate ? tr('Ends: {date}', { date: c.endDate }) : tr('Open-ended'), ...(c.autoRenew ? [tr('Renews automatically')] : [])];
  w.text(dates.join('    '));
  doc.moveDown().fontSize(11);
  w.text(tr('Terms'), undefined, undefined, { bold: true });
  doc.moveDown(0.3).fontSize(9.5);
  w.text(c.terms?.trim() || tr('No additional terms.'), undefined, undefined, { bold: false, width: 495 });

  doc.moveDown(2);
  if (doc.y > 680) doc.addPage();
  doc.fontSize(11).fillColor('#000');
  w.text(tr('Signed for the customer'), 50, undefined, { bold: true });
  doc.moveDown(1.6);
  const y = doc.y;
  // DocuSign anchors, in white: the signature goes on the first line and the date on the second.
  doc.font('Helvetica').fontSize(9).fillColor('#fff').text('/sn1/', w.x(50, 240), y, { lineBreak: false });
  doc.fillColor('#fff').text('/ds1/', w.x(330, 165), y, { lineBreak: false });
  doc.moveTo(w.x(50), y + 14).lineTo(w.x(290), y + 14).strokeColor('#000').stroke();
  doc.moveTo(w.x(330), y + 14).lineTo(w.x(495), y + 14).stroke();
  doc.fillColor('#000');
  w.text(tr('Signature: {name}', { name: signerName }), 50, y + 18, { bold: false, width: 240 });
  w.text(tr('Date'), 330, y + 18, { width: 165 });
  w.end();
  return done;
}
