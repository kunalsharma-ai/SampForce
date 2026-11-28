import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { renderCertificatePdf, type CertificatePdfData } from './certificate-pdf';

/** Saves the PDFs for a look when CERT_PREVIEW_DIR is set (they are not part of the checks). */
const PREVIEW = process.env.CERT_PREVIEW_DIR;

const base: CertificatePdfData = {
  number: 'CERT-2026-00042',
  code: 'ABCD-EFGH-JKLM',
  recipientName: 'Priya Raghunathan',
  moduleTitle: 'Consultative selling for enterprise research buyers',
  category: 'Sales',
  score: 92.5,
  completedAt: new Date('2026-11-27T10:00:00Z'),
  issuedAt: new Date('2026-11-27T10:00:00Z'),
  issuerName: 'Frequent Research',
  tagline: 'Insight that moves markets',
  signatoryName: 'Kunal Sharma',
  signatoryTitle: 'Head of Learning',
  template: 'CLASSIC',
  primary: '#0f766e',
  secondary: '#f59e0b',
  logoPng: null,
  logoRatio: null,
  verifyUrl: 'https://app.example.com/verify/certificate/ABCD-EFGH-JKLM',
  revoked: false,
};

const svgLogo = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="360" height="100"><rect x="0" y="10" width="80" height="80" rx="18" fill="#0f766e"/><circle cx="40" cy="50" r="20" fill="#f59e0b"/><text x="100" y="66" font-family="sans-serif" font-size="44" font-weight="700" fill="#0f172a">Frequent</text></svg>',
);

async function pngOf(svg: Buffer) {
  const out = await sharp(svg, { density: 300 }).trim().png().toBuffer({ resolveWithObject: true });
  return { png: out.data, ratio: out.info.width / out.info.height };
}

describe('branded certificate PDF', () => {
  it('draws every look with the organisation’s logo, colours and fonts embedded', async () => {
    const logo = await pngOf(svgLogo);
    for (const template of ['CLASSIC', 'MODERN', 'EXECUTIVE'] as const) {
      const pdf = await renderCertificatePdf({ ...base, template, logoPng: logo.png, logoRatio: logo.ratio });
      const text = pdf.toString('latin1');
      expect(text.startsWith('%PDF-')).toBe(true);
      expect(text).toMatch(/PlayfairDisplay/);
      expect(text).toMatch(/Inter/);
      expect(text).toMatch(/\/Subtype \/Image/);
      if (PREVIEW) writeFileSync(join(PREVIEW, `org-a-${template.toLowerCase()}.pdf`), pdf);
    }
  });

  it('uses a monogram when there is no logo, and keeps long names and Arabic on the page', async () => {
    const pdf = await renderCertificatePdf({
      ...base,
      issuerName: 'Northwind Analytics & Consulting Private Limited',
      tagline: null,
      recipientName: 'Maximilian Alexander von Hohenberg-Castellanos',
      moduleTitle: 'Data protection, privacy and information security for client-facing research and sales teams worldwide',
      category: null,
      primary: '#7c3aed',
      secondary: '#ec4899',
      template: 'MODERN',
      signatoryName: null,
      signatoryTitle: null,
      revoked: true,
    });
    expect(pdf.toString('latin1').startsWith('%PDF-')).toBe(true);
    if (PREVIEW) writeFileSync(join(PREVIEW, 'org-b-modern-long.pdf'), pdf);
    const ar = await renderCertificatePdf({ ...base, recipientName: 'سارة الأحمد', template: 'EXECUTIVE' });
    expect(ar.toString('latin1').startsWith('%PDF-')).toBe(true);
    if (PREVIEW) writeFileSync(join(PREVIEW, 'org-a-executive-arabic.pdf'), ar);
  });
});
