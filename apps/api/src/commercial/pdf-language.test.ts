import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { inLanguage, pdfMoney } from '../common/request-language';
import { renderContractPdf } from './contract-pdf';
import { renderQuotePdf, type PdfQuote } from './quote-pdf';

/** The text drawn in a pdfkit PDF: page streams are inflated and the hex strings decoded as Latin-1. */
function pdfText(pdf: Buffer): string {
  const raw = pdf.toString('latin1');
  const out: string[] = [];
  for (const m of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    let body: string;
    try {
      body = inflateSync(Buffer.from(m[1]!, 'latin1')).toString('latin1');
    } catch {
      continue;
    }
    for (const t of body.matchAll(/<([0-9a-fA-F]+)>/g)) out.push(Buffer.from(t[1]!, 'hex').toString('latin1'));
    out.push('\n');
  }
  return out.join('');
}

const quote: PdfQuote = {
  reference: 'Q-0001',
  title: 'Onboarding',
  currency: 'EUR',
  createdAt: '2026-11-02T10:00:00.000Z',
  validUntil: '2026-12-01',
  subtotal: 5000,
  discountTotal: 0,
  taxTotal: 950,
  total: 5950,
  notes: null,
  terms: 'Net 30',
  deal: { companyName: 'Acme GmbH' },
  lines: [{ name: 'Seats', description: null, quantity: 10, unitPrice: 500, discountPercent: 0, netTotal: 5000 }],
  sections: [],
};
const contract = { reference: 'C-0007', name: 'Acme MSA', company: { id: 'c1', name: 'Acme GmbH' }, value: 12000, currency: 'EUR', startDate: '2026-11-01', endDate: null, autoRenew: true, terms: null };

describe('PDFs in the reader’s language', () => {
  it('writes quote labels and amounts in German, keeping what people typed', async () => {
    const text = pdfText(await inLanguage('de', () => renderQuotePdf(quote, { name: 'Seller Co' })));
    for (const s of ['Kostenvoranschlag Q-0001', 'Datum: 2026-11-02', 'Gültig bis: 2026-12-01', 'Erstellt für: Acme GmbH', 'Einzelpreis', 'Zwischensumme', 'Gesamt', 'EUR 5.950,00', 'Bedingungen', 'Net 30']) {
      expect(text.replace(/\n/g, '')).toContain(s);
    }
  });

  it('writes contract labels in French', async () => {
    const fr = pdfText(await inLanguage('fr', () => renderContractPdf(contract as never, { name: 'Seller Co' }, 'Ivy Buyer'))).replace(/\n/g, '');
    for (const s of ['Contrat C-0007', 'Client : Acme GmbH', 'Sans date de fin', 'Renouvellement automatique', 'Aucune condition supplémentaire.', 'Signature : Ivy Buyer']) expect(fr).toContain(s);
  });

  it('writes amounts with Latin-1 safe spaces', () => {
    expect(inLanguage('fr', () => pdfMoney(5950, 'EUR'))).toBe('EUR 5 950,00');
    expect(inLanguage('en', () => pdfMoney(5950, 'USD'))).toBe('USD 5,950.00');
  });
});
