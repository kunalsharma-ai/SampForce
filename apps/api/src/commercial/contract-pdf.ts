import PDFDocument from 'pdfkit';
import type { ContractRow } from '@dealflow/types';
import { inLanguage, pdfLanguage, pdfMoney, tr } from '../common/request-language';

const latin1 = (s: string) => s.replace(/[^\x20-\x7E\xA0-\xFF\n]/g, '?');

/**
 * The contract as a PDF for e-signature: parties, dates, value and terms, then a signature block. The block carries
 * the anchors /sn1/ and /ds1/ in white text, where DocuSign places the signature and date fields.
 */
type PdfContract = Pick<ContractRow, 'reference' | 'name' | 'company' | 'value' | 'currency' | 'startDate' | 'endDate' | 'autoRenew' | 'terms'>;

/** Labels and amounts are written in the sender's language (English for Arabic, see `pdfLanguage`); the terms are kept as typed. */
export function renderContractPdf(c: PdfContract, seller: { name: string }, signerName: string): Promise<Buffer> {
  return inLanguage(pdfLanguage(), () => drawContractPdf(c, seller, signerName));
}

function drawContractPdf(c: PdfContract, seller: { name: string }, signerName: string): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 50, info: { Title: latin1(`${c.reference} ${c.name}`), Author: latin1(seller.name), Creator: 'DealFlow' } });
  const chunks: Buffer[] = [];
  doc.on('data', (b: Buffer) => chunks.push(b));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
  const money = pdfMoney(c.value, c.currency);

  doc.fontSize(18).font('Helvetica-Bold').fillColor('#000').text(latin1(seller.name));
  doc.moveDown(0.3).fontSize(10).font('Helvetica').fillColor('#555').text(latin1(tr('Contract {reference}', { reference: c.reference })));
  doc.moveDown().fontSize(14).font('Helvetica-Bold').fillColor('#000').text(latin1(c.name));
  doc.moveDown(0.6).fontSize(10).font('Helvetica');
  if (c.company) doc.text(latin1(tr('Customer: {company}', { company: c.company.name })));
  doc.text(latin1(tr('Value: {value}', { value: money })));
  const dates = [tr('Starts: {date}', { date: c.startDate }), c.endDate ? tr('Ends: {date}', { date: c.endDate }) : tr('Open-ended'), ...(c.autoRenew ? [tr('Renews automatically')] : [])];
  doc.text(latin1(dates.join('    ')));
  doc.moveDown();
  doc.font('Helvetica-Bold').fontSize(11).text(latin1(tr('Terms')));
  doc.moveDown(0.3).font('Helvetica').fontSize(9.5).text(latin1(c.terms?.trim() || tr('No additional terms.')), { width: 495 });

  doc.moveDown(2);
  if (doc.y > 680) doc.addPage();
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#000').text(latin1(tr('Signed for the customer')));
  doc.moveDown(1.6);
  const y = doc.y;
  doc.font('Helvetica').fontSize(9).fillColor('#fff').text('/sn1/', 50, y);
  doc.fillColor('#fff').text('/ds1/', 330, y);
  doc.moveTo(50, y + 14).lineTo(290, y + 14).strokeColor('#000').stroke();
  doc.moveTo(330, y + 14).lineTo(495, y + 14).stroke();
  doc.fillColor('#000').text(latin1(tr('Signature: {name}', { name: signerName })), 50, y + 18);
  doc.text(latin1(tr('Date')), 330, y + 18);
  doc.end();
  return done;
}
