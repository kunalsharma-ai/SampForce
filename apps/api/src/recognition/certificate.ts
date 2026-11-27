import PDFDocument from 'pdfkit';
import type { RecognitionAwardRow } from '@dealflow/types';
import { inLanguage, requestLanguage, requestLocale, tr } from '../common/request-language';
import { hasArabic, latin1, PdfText } from '../commercial/pdf-text';

/**
 * The Employee of the Month certificate (ADR 0102): a landscape A4 page with the organisation, the person, the month,
 * what they achieved and who selected them. Words are in the reader's language (right to left for Arabic, ADR 0054);
 * names are drawn as typed, Arabic included.
 */
export function renderCertificatePdf(award: RecognitionAwardRow, orgName: string): Promise<Buffer> {
  return inLanguage(requestLanguage(), () => draw(award, orgName));
}

function monthName(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return new Intl.DateTimeFormat(requestLocale(), { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, 1)));
}

function draw(a: RecognitionAwardRow, orgName: string): Promise<Buffer> {
  const rtl = requestLanguage() === 'ar';
  const unicode = rtl || hasArabic(JSON.stringify([a.person.name, orgName, a.team?.name, a.reward, a.selectedBy?.name]));
  const title = tr('Employee of the Month certificate');
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 0, lang: requestLanguage(), info: { Title: unicode ? title : latin1(title), Author: unicode ? orgName : latin1(orgName), Creator: 'SampForce' } });
  const chunks: Buffer[] = [];
  doc.on('data', (b: Buffer) => chunks.push(b));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
  const W = doc.page.width;
  const H = doc.page.height;
  const w = new PdfText(doc, { rtl, unicode, family: 'serif' });

  // Frame: a deep band, a gold rule and a thin inner line.
  doc.rect(0, 0, W, H).fill('#fffaf0');
  doc.rect(18, 18, W - 36, H - 36).lineWidth(6).stroke('#7f1d1d');
  doc.rect(32, 32, W - 64, H - 64).lineWidth(1.5).stroke('#d4a017');
  // A medal: two ribbons and a gold disc with a star.
  const cx = W / 2;
  doc.polygon([cx - 34, 92], [cx - 14, 92], [cx - 4, 150], [cx - 24, 142], [cx - 44, 152]).fill('#b91c1c');
  doc.polygon([cx + 14, 92], [cx + 34, 92], [cx + 44, 152], [cx + 24, 142], [cx + 4, 150]).fill('#1d4ed8');
  doc.circle(cx, 92, 34).fill('#f5c542');
  doc.circle(cx, 92, 26).lineWidth(2).stroke('#b7791f');
  const star = Array.from({ length: 10 }, (_, i) => {
    const r = i % 2 === 0 ? 16 : 7;
    const ang = -Math.PI / 2 + (i * Math.PI) / 5;
    return [cx + r * Math.cos(ang), 92 + r * Math.sin(ang)] as [number, number];
  });
  doc.polygon(...star).fill('#fffbea');

  const box = { x: 90, width: W - 180 };
  doc.fillColor('#7f1d1d').fontSize(13);
  w.text(orgName.toUpperCase(), box.x, 150, { bold: true, width: box.width, align: 'center' });
  doc.fillColor('#111827').fontSize(34);
  w.text(tr('Employee of the Month'), box.x, 176, { bold: true, width: box.width, align: 'center' });
  doc.fillColor('#92400e').fontSize(15);
  w.text(a.scope === 'TEAM' && a.team ? `${monthName(a.month)} · ${a.team.name}` : monthName(a.month), box.x, 222, { bold: false, width: box.width, align: 'center' });
  doc.fillColor('#4b5563').fontSize(12);
  w.text(tr('This certificate is presented to'), box.x, 262, { width: box.width, align: 'center' });
  doc.fillColor('#111827').fontSize(30);
  w.text(a.person.name, box.x, 284, { bold: true, width: box.width, align: 'center' });
  const role = [a.person.designation, a.person.department].filter(Boolean).join(' · ');
  if (role) {
    doc.fillColor('#4b5563').fontSize(12);
    w.text(role, box.x, 324, { bold: false, width: box.width, align: 'center' });
  }
  doc.fillColor('#374151').fontSize(12.5);
  w.text(tr('In recognition of outstanding performance: {achievement}% of the recognition goals and a performance score of {score}.', { achievement: Math.round(a.achievementPercent), score: Math.round(a.score) }), box.x + 40, 352, { bold: false, width: box.width - 80, align: 'center' });
  if (a.reward) {
    doc.fillColor('#92400e').fontSize(12);
    w.text(tr('Reward: {reward}', { reward: a.reward }), box.x, 396, { width: box.width, align: 'center' });
  }

  // Signature lines: who selected, and when.
  const y = H - 118;
  doc.moveTo(w.x(150), y).lineTo(w.x(360), y).lineWidth(0.8).strokeColor('#9ca3af').stroke();
  doc.moveTo(w.x(W - 360), y).lineTo(w.x(W - 150), y).stroke();
  doc.fillColor('#111827').fontSize(11);
  w.text(a.method === 'AUTOMATIC' ? tr('Selected automatically by ranking') : (a.selectedBy?.name ?? ''), 150, y + 8, { bold: true, width: 210, align: 'center' });
  w.text(new Intl.DateTimeFormat(requestLocale(), { dateStyle: 'long' }).format(new Date(a.awardedAt)), W - 360, y + 8, { width: 210, align: 'center' });
  doc.fillColor('#6b7280').fontSize(9.5);
  w.text(tr('Selected by'), 150, y + 24, { bold: false, width: 210, align: 'center' });
  w.text(tr('Date'), W - 360, y + 24, { width: 210, align: 'center' });
  doc.fillColor('#9ca3af').fontSize(8.5);
  w.text(tr('Issued with SampForce from the organisation’s recorded results. Reference {id}', { id: a.id.slice(0, 8).toUpperCase() }), box.x, H - 58, { width: box.width, align: 'center' });
  w.end();
  return done;
}
