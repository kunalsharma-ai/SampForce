import PDFDocument from 'pdfkit';
import type { ContractRow } from '@dealflow/types';

const latin1 = (s: string) => s.replace(/[^\x20-\x7E\xA0-\xFF\n]/g, '?');

/**
 * The contract as a PDF for e-signature: parties, dates, value and terms, then a signature block. The block carries
 * the anchors /sn1/ and /ds1/ in white text, where DocuSign places the signature and date fields.
 */
export function renderContractPdf(c: Pick<ContractRow, 'reference' | 'name' | 'company' | 'value' | 'currency' | 'startDate' | 'endDate' | 'autoRenew' | 'terms'>, seller: { name: string }, signerName: string): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 50, info: { Title: latin1(`${c.reference} ${c.name}`), Author: latin1(seller.name), Creator: 'DealFlow' } });
  const chunks: Buffer[] = [];
  doc.on('data', (b: Buffer) => chunks.push(b));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
  const money = `${c.currency} ${c.value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  doc.fontSize(18).font('Helvetica-Bold').fillColor('#000').text(latin1(seller.name));
  doc.moveDown(0.3).fontSize(10).font('Helvetica').fillColor('#555').text(`Contract ${c.reference}`);
  doc.moveDown().fontSize(14).font('Helvetica-Bold').fillColor('#000').text(latin1(c.name));
  doc.moveDown(0.6).fontSize(10).font('Helvetica');
  if (c.company) doc.text(latin1(`Customer: ${c.company.name}`));
  doc.text(`Value: ${money}`);
  doc.text(`Starts: ${c.startDate}${c.endDate ? `    Ends: ${c.endDate}` : '    Open-ended'}${c.autoRenew ? '    Renews automatically' : ''}`);
  doc.moveDown();
  doc.font('Helvetica-Bold').fontSize(11).text('Terms');
  doc.moveDown(0.3).font('Helvetica').fontSize(9.5).text(latin1(c.terms?.trim() || 'No additional terms.'), { width: 495 });

  doc.moveDown(2);
  if (doc.y > 680) doc.addPage();
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#000').text('Signed for the customer');
  doc.moveDown(1.6);
  const y = doc.y;
  doc.font('Helvetica').fontSize(9).fillColor('#fff').text('/sn1/', 50, y);
  doc.fillColor('#fff').text('/ds1/', 330, y);
  doc.moveTo(50, y + 14).lineTo(290, y + 14).strokeColor('#000').stroke();
  doc.moveTo(330, y + 14).lineTo(495, y + 14).stroke();
  doc.fillColor('#000').text(latin1(`Signature: ${signerName}`), 50, y + 18);
  doc.text('Date', 330, y + 18);
  doc.end();
  return done;
}
