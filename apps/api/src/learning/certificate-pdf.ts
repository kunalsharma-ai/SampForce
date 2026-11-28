import { existsSync } from 'node:fs';
import { join } from 'node:path';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { type CertElement, type CertFont, CERT_H, CERT_W, type CertificateTemplate, certificateDesign } from '@dealflow/types';
import { hasArabic, latin1, PdfText } from '../commercial/pdf-text';

/*
 * The certificate of completion as a PDF (ADR 0097, branded in ADR 0103). The design itself is certificateDesign in
 * @dealflow/types, shared with the app's on-screen certificate; this draws its shapes with pdfkit, in Playfair Display
 * and Inter (SIL Open Font License, apps/api/assets/fonts/OFL-*.txt), embedded and subset. Text in Arabic goes through
 * the Arabic-aware writer of the other PDFs.
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
  tagline: string | null;
  signatoryName: string | null;
  signatoryTitle: string | null;
  template: CertificateTemplate;
  primary: string;
  secondary: string;
  /** The logo as PNG, or null. */
  logoPng: Buffer | null;
  logoRatio: number | null;
  verifyUrl: string;
  revoked: boolean;
}

const FONT_DIR = join(__dirname, '..', '..', 'assets', 'fonts');
const FONT_FILES: Record<CertFont, string> = {
  serif: 'PlayfairDisplay-Regular.ttf',
  serifBold: 'PlayfairDisplay-Bold.ttf',
  serifItalic: 'PlayfairDisplay-Italic.ttf',
  serifBoldItalic: 'PlayfairDisplay-BoldItalic.ttf',
  sans: 'Inter-Regular.ttf',
  sansSemi: 'Inter-SemiBold.ttf',
  sansBold: 'Inter-Bold.ttf',
};

function fontPath(f: CertFont): string {
  const path = join(FONT_DIR, FONT_FILES[f]);
  if (!existsSync(path)) throw new Error(`Certificate font missing: ${path}`);
  return path;
}

export async function renderCertificatePdf(c: CertificatePdfData): Promise<Buffer> {
  const elements = certificateDesign({
    template: c.template,
    primary: c.primary,
    secondary: c.secondary,
    organisation: c.issuerName,
    tagline: c.tagline,
    hasLogo: !!c.logoPng,
    logoRatio: c.logoRatio,
    recipientName: c.recipientName,
    moduleTitle: c.moduleTitle,
    category: c.category,
    score: c.score,
    completedAt: c.completedAt.toISOString(),
    issuedAt: c.issuedAt.toISOString(),
    number: c.number,
    code: c.code,
    signatoryName: c.signatoryName,
    signatoryTitle: c.signatoryTitle,
    verifyUrl: c.verifyUrl,
    revoked: c.revoked,
  });

  const unicode = hasArabic(JSON.stringify([c.recipientName, c.moduleTitle, c.issuerName, c.tagline, c.signatoryName, c.signatoryTitle, c.category]));
  const doc = new PDFDocument({
    size: [CERT_W, CERT_H],
    margin: 0,
    info: { Title: `Certificate ${c.number}`, Author: unicode ? c.issuerName : latin1(c.issuerName), Subject: c.moduleTitle, Creator: 'SampForce' },
  });
  const chunks: Buffer[] = [];
  doc.on('data', (b: Buffer) => chunks.push(b));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
  for (const f of Object.keys(FONT_FILES) as CertFont[]) doc.registerFont(f, fontPath(f));
  const arabic = unicode ? new PdfText(doc, { rtl: false, unicode: true, family: 'serif' }) : null;
  const qr = await QRCode.toBuffer(c.verifyUrl, { margin: 0, width: 360, errorCorrectionLevel: 'M', color: { dark: '#0f172a', light: '#ffffff' } });

  for (const el of elements) draw(doc, el, { logo: c.logoPng, qr, arabic });
  doc.end();
  return done;
}

function draw(doc: PDFKit.PDFDocument, el: CertElement, ctx: { logo: Buffer | null; qr: Buffer; arabic: PdfText | null }): void {
  doc.save();
  const op = el.opacity ?? 1;
  doc.fillOpacity(op).strokeOpacity(op);
  switch (el.kind) {
    case 'rect': {
      if (el.radius) doc.roundedRect(el.x, el.y, el.w, el.h, el.radius);
      else doc.rect(el.x, el.y, el.w, el.h);
      if (el.fill && el.stroke) doc.lineWidth(el.lw ?? 1).fillAndStroke(el.fill, el.stroke);
      else if (el.fill) doc.fill(el.fill);
      else if (el.stroke) doc.lineWidth(el.lw ?? 1).stroke(el.stroke);
      break;
    }
    case 'gradient': {
      const g = el.vertical ? doc.linearGradient(el.x, el.y, el.x, el.y + el.h) : doc.linearGradient(el.x, el.y, el.x + el.w, el.y);
      g.stop(0, el.from, op).stop(1, el.to, op);
      doc.rect(el.x, el.y, el.w, el.h).fill(g);
      break;
    }
    case 'line': {
      doc.moveTo(el.x1, el.y1).lineTo(el.x2, el.y2).lineWidth(el.lw);
      if (el.dash) doc.dash(el.dash, { space: el.dash });
      doc.stroke(el.stroke);
      break;
    }
    case 'circle': {
      doc.circle(el.cx, el.cy, el.r);
      if (el.dash) doc.dash(el.dash, { space: el.dash });
      if (el.fill && el.stroke) doc.lineWidth(el.lw ?? 1).fillAndStroke(el.fill, el.stroke);
      else if (el.fill) doc.fill(el.fill);
      else if (el.stroke) doc.lineWidth(el.lw ?? 1).stroke(el.stroke);
      break;
    }
    case 'poly': {
      doc.polygon(...el.points);
      if (el.fill && el.stroke) doc.lineWidth(el.lw ?? 1).fillAndStroke(el.fill, el.stroke);
      else if (el.fill) doc.fill(el.fill);
      else if (el.stroke) doc.lineWidth(el.lw ?? 1).stroke(el.stroke);
      break;
    }
    case 'path': {
      doc.path(el.d);
      if (el.fill) doc.fill(el.fill);
      else if (el.stroke) doc.lineWidth(el.lw ?? 1).stroke(el.stroke);
      break;
    }
    case 'image': {
      const img = el.image === 'logo' ? ctx.logo : ctx.qr;
      if (img) doc.image(img, el.x, el.y, { width: el.w, height: el.h });
      break;
    }
    case 'text': {
      if (ctx.arabic && hasArabic(el.text)) {
        doc.fillColor(el.color).fontSize(el.size);
        const left = el.align === 'center' ? el.x - el.maxWidth / 2 : el.align === 'right' ? el.x - el.maxWidth : el.x;
        ctx.arabic.text(el.text, left, el.y - el.size * 0.95, { width: el.maxWidth, align: el.align, bold: /Bold/.test(el.font) });
        break;
      }
      const spacing = el.spacing ?? 0;
      doc.font(el.font);
      let size = el.size;
      // The design estimates widths; the real glyphs decide.
      while (size > 5 && doc.fontSize(size).widthOfString(el.text, { characterSpacing: spacing }) - spacing > el.maxWidth) size -= 0.5;
      doc.fontSize(size);
      const width = doc.widthOfString(el.text, { characterSpacing: spacing }) - spacing;
      const left = el.align === 'center' ? el.x - width / 2 : el.align === 'right' ? el.x - width : el.x;
      doc.fillColor(el.color).text(el.text, left, el.y, { baseline: 'alphabetic', lineBreak: false, characterSpacing: spacing });
      break;
    }
  }
  doc.restore();
}
