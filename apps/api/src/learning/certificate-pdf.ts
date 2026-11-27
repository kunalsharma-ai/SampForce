import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import type { CertificateTemplate } from '@dealflow/types';
import { hasArabic, latin1, PdfText } from '../commercial/pdf-text';

/*
 * The certificate of completion (ADR 0097): an A4 landscape page with the organisation's logo, the person's name, the
 * module, the score, the dates, the certificate ID and a QR code that opens its public verification page. Three
 * looks (Classic, Modern, Executive) in the organisation's accent colour.
 */

export interface CertificatePdfData {
  number: string;
  code: string;
  recipientName: string;
  moduleTitle: string;
  category: string | null;
  score: number;
  completedAt: Date;
  issuedAt: Date;
  issuerName: string;
  signatoryName: string | null;
  signatoryTitle: string | null;
  template: CertificateTemplate;
  accentColor: string;
  logoDataUrl: string | null;
  verifyUrl: string;
  revoked: boolean;
}

const dateText = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

function mix(hex: string, white: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.round(v + (255 - v) * white).toString(16).padStart(2, '0');
  return `#${ch((n >> 16) & 255)}${ch((n >> 8) & 255)}${ch(n & 255)}`;
}

export async function renderCertificatePdf(c: CertificatePdfData): Promise<Buffer> {
  const unicode = hasArabic(JSON.stringify([c.recipientName, c.moduleTitle, c.issuerName, c.signatoryName, c.category]));
  const title = `Certificate ${c.number}`;
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 0, info: { Title: title, Author: unicode ? c.issuerName : latin1(c.issuerName), Creator: 'SampForce' } });
  const chunks: Buffer[] = [];
  doc.on('data', (b: Buffer) => chunks.push(b));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
  const serif = c.template !== 'MODERN';
  const w = new PdfText(doc, { rtl: false, unicode, family: serif ? 'serif' : 'sans' });
  const W = doc.page.width;
  const H = doc.page.height;
  const accent = /^#[0-9a-f]{6}$/i.test(c.accentColor) ? c.accentColor : '#2563eb';
  const dark = c.template === 'EXECUTIVE';
  const ink = dark ? '#f8fafc' : '#0f172a';
  const soft = dark ? '#cbd5e1' : '#475569';
  const gold = '#c9a227';

  // Background and frame.
  doc.rect(0, 0, W, H).fill(dark ? '#0b1220' : '#ffffff');
  if (c.template === 'CLASSIC') {
    doc.rect(18, 18, W - 36, H - 36).lineWidth(3).stroke(accent);
    doc.rect(28, 28, W - 56, H - 56).lineWidth(0.8).stroke(gold);
    for (const [x, y] of [[28, 28], [W - 28, 28], [28, H - 28], [W - 28, H - 28]] as const) doc.circle(x, y, 6).fill(gold);
  } else if (c.template === 'MODERN') {
    doc.rect(0, 0, 18, H).fill(accent);
    doc.polygon([W, 0], [W - 260, 0], [W, 200]).fill(mix(accent, 0.85));
    doc.polygon([W, H], [W - 180, H], [W, H - 140]).fill(mix(accent, 0.7));
    doc.circle(W - 70, 70, 26).fill(mix(accent, 0.6));
  } else {
    doc.rect(24, 24, W - 48, H - 48).lineWidth(1.2).stroke(gold);
    doc.rect(0, 0, W, 8).fill(gold);
    doc.rect(0, H - 8, W, 8).fill(gold);
  }

  // Logo or the issuer's name at the top.
  let top = 58;
  if (c.logoDataUrl) {
    try {
      doc.image(Buffer.from(c.logoDataUrl.split(',')[1] ?? '', 'base64'), W / 2 - 80, top, { fit: [160, 48], align: 'center' });
      top += 58;
    } catch {
      // A logo pdfkit cannot read is left out rather than failing the certificate.
    }
  }
  doc.fillColor(soft).fontSize(11);
  w.text(c.issuerName.toUpperCase(), 60, top, { width: W - 120, align: 'center', bold: true });

  doc.fillColor(dark ? gold : accent).fontSize(34);
  w.text('Certificate of Completion', 60, top + 26, { width: W - 120, align: 'center', bold: true });
  doc.fillColor(soft).fontSize(13);
  w.text('This certifies that', 60, top + 82, { width: W - 120, align: 'center', bold: false });
  doc.fillColor(ink).fontSize(32);
  w.text(c.recipientName, 60, top + 106, { width: W - 120, align: 'center', bold: true });
  const lineY = top + 150;
  doc.moveTo(W / 2 - 170, lineY).lineTo(W / 2 + 170, lineY).lineWidth(1).stroke(dark ? gold : mix(accent, 0.4));
  doc.fillColor(soft).fontSize(13);
  w.text('has successfully completed the learning module', 60, lineY + 14, { width: W - 120, align: 'center', bold: false });
  doc.fillColor(ink).fontSize(21);
  w.text(c.moduleTitle, 80, lineY + 38, { width: W - 160, align: 'center', bold: true });
  doc.fillColor(soft).fontSize(12);
  const detail = [`Score ${Math.round(c.score * 10) / 10}%`, c.category ? `Category: ${c.category}` : null, `Completed ${dateText(c.completedAt)}`].filter(Boolean).join('   ·   ');
  w.text(detail, 60, lineY + 92, { width: W - 120, align: 'center', bold: false });

  // Seal with the score.
  const sealX = 120;
  const sealY = H - 120;
  doc.circle(sealX, sealY, 44).fill(dark ? gold : accent);
  doc.circle(sealX, sealY, 37).lineWidth(1.2).stroke('#ffffff');
  doc.fillColor('#ffffff').fontSize(18);
  w.text(`${Math.round(c.score)}%`, sealX - 40, sealY - 14, { width: 80, align: 'center', bold: true });
  doc.fontSize(7);
  w.text('PASSED', sealX - 40, sealY + 8, { width: 80, align: 'center', bold: true });

  // Signatory.
  const sigX = W / 2 - 110;
  const sigY = H - 108;
  doc.moveTo(sigX, sigY).lineTo(sigX + 220, sigY).lineWidth(0.8).stroke(soft);
  doc.fillColor(ink).fontSize(12);
  w.text(c.signatoryName ?? c.issuerName, sigX, sigY + 8, { width: 220, align: 'center', bold: true });
  doc.fillColor(soft).fontSize(10);
  w.text(c.signatoryName ? (c.signatoryTitle ?? 'Authorised signatory') : 'Issuing organisation', sigX, sigY + 24, { width: 220, align: 'center', bold: false });
  w.text(`Issued ${dateText(c.issuedAt)}`, sigX, sigY + 40, { width: 220, align: 'center', bold: false });

  // QR code and certificate ID.
  const qr = await QRCode.toBuffer(c.verifyUrl, { margin: 1, width: 240, color: { dark: '#0f172a', light: '#ffffff' } });
  const qrX = W - 168;
  const qrY = H - 172;
  doc.rect(qrX - 4, qrY - 4, 100, 100).fill('#ffffff');
  doc.image(qr, qrX, qrY, { width: 92 });
  doc.fillColor(soft).fontSize(8);
  w.text(`Certificate ID ${c.number}`, qrX - 50, qrY + 100, { width: 192, align: 'center', bold: true });
  w.text(`Verification code ${c.code}`, qrX - 50, qrY + 112, { width: 192, align: 'center', bold: false });
  w.text('Scan to verify', qrX - 50, qrY + 124, { width: 192, align: 'center', bold: false });

  doc.fillColor(dark ? '#64748b' : '#94a3b8').fontSize(8);
  w.text('Issued with SampForce Learning & Development', 60, H - 40, { width: W - 120, align: 'center', bold: false });

  if (c.revoked) {
    doc.save();
    doc.rotate(-20, { origin: [W / 2, H / 2] });
    doc.fillColor('#dc2626').opacity(0.25).fontSize(90);
    w.text('REVOKED', 0, H / 2 - 50, { width: W, align: 'center', bold: true });
    doc.restore();
  }
  doc.end();
  return done;
}
