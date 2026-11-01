import type { INestApplication } from '@nestjs/common';
import type { PublicProposal, QuoteRow } from '@dealflow/types';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { renderQuotePdf } from '../src/commercial/quote-pdf';
import { api, registerUser, startApp, type TestUser } from './helpers';
import { bidStyle } from '@dealflow/types';

/** Design spec Part 6: bid template looks stored on quotes and applied to the online proposal and PDF. */
describe('bid templates', () => {
  let app: INestApplication;
  let owner: TestUser;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    app = await startApp();
    owner = await registerUser(app, 'Bid Look Co');
    const o = api(owner);
    ids.product = (await o.post('/catalog/products', { name: 'Survey fieldwork', unit: 'complete' }).expect(201)).body.id;
    const currency = (await o.get('/tenants/current').expect(200)).body.defaultCurrency ?? 'USD';
    ids.book = (await o.post('/catalog/price-books', { name: 'Standard', currency, isDefault: true }).expect(201)).body.id;
    await o.put(`/catalog/price-books/${ids.book}/prices/${ids.product}`, { unitPrice: 12 }).expect(204);
    ids.company = (await o.post('/companies', { name: 'Initech' }).expect(201)).body.id;
    ids.deal = (await o.post('/deals', { name: 'Initech brand study', amount: 6000, companyId: ids.company }).expect(201)).body.id;
  });
  afterAll(async () => {
    await app.close();
  });

  it('stores a template and accent, validates them, and can clear them', async () => {
    const o = api(owner);
    await o.post('/quotes', { opportunityId: ids.deal, templateKey: 'not-a-template' }).expect(400);
    await o.post('/quotes', { opportunityId: ids.deal, templateKey: 'dark-luxury', accentColor: 'gold' }).expect(400);
    const q = (await o.post('/quotes', { opportunityId: ids.deal, templateKey: 'market-research-bid', accentColor: '#0055aa', lines: [{ productId: ids.product, quantity: 500 }] }).expect(201)).body as QuoteRow;
    expect(q).toMatchObject({ templateKey: 'market-research-bid', accentColor: '#0055aa', total: 6000 });
    const changed = (await o.patch(`/quotes/${q.id}`, { templateKey: 'dark-luxury', accentColor: null }).expect(200)).body as QuoteRow;
    expect(changed).toMatchObject({ templateKey: 'dark-luxury', accentColor: null });
    await o.patch(`/quotes/${q.id}`, { accentColor: '#12345' }).expect(400);
    const plain = (await o.patch(`/quotes/${q.id}`, { templateKey: null }).expect(200)).body as QuoteRow;
    expect(plain.templateKey).toBeNull();
    await o.patch(`/quotes/${q.id}`, { templateKey: 'consulting-proposal', accentColor: '#225533' }).expect(200);
    ids.quote = q.id;
  });

  it('keeps the look on a revision and shows it on the online proposal', async () => {
    const o = api(owner);
    await o.post(`/quotes/${ids.quote}/transition`, { action: 'submit' }).expect(200);
    const v2 = (await o.post(`/quotes/${ids.quote}/transition`, { action: 'revise' }).expect(200)).body as QuoteRow;
    expect(v2.version).toBe(2);
    expect(v2).toMatchObject({ templateKey: 'consulting-proposal', accentColor: '#225533' });

    await o.post(`/quotes/${v2.id}/transition`, { action: 'submit' }).expect(200);
    await o.post(`/quotes/${v2.id}/share`, { enabled: true }).expect(200);
    const url = (await o.get(`/quotes/${v2.id}/share`).expect(200)).body.url as string;
    const token = url.split('/p/')[1]!;
    const p = (await request(app.getHttpServer()).get(`/api/v1/proposals/view/${token}?preview=1`).expect(200)).body as PublicProposal;
    expect(p.style).toEqual({ templateKey: 'consulting-proposal', accent: '#225533', font: 'serif', cover: 'minimal' });

    const pdf = await request(app.getHttpServer()).get(`/api/v1/proposals/view/${token}/pdf`).expect(200);
    expect(pdf.body.slice(0, 4).toString()).toBe('%PDF');
    expect(pdf.body.toString('latin1')).toContain('Times-Bold');
    const own = await o.get(`/quotes/${v2.id}/pdf`).expect(200);
    expect(own.headers['content-type']).toBe('application/pdf');
  });

  it('draws each cover style with the template typeface', async () => {
    const q = {
      reference: 'Q-0001', title: 'Study', currency: 'USD', createdAt: new Date().toISOString(), validUntil: null, subtotal: 10, discountTotal: 0, taxTotal: 0, total: 10, notes: null, terms: null,
      deal: { companyName: 'Initech' }, lines: [{ name: 'Item', description: null, quantity: 1, unitPrice: 10, discountPercent: 0, netTotal: 10 }], sections: [{ heading: 'Objectives', body: 'Learn things.' }],
    };
    for (const key of ['corporate-executive', 'minimal-premium', 'modern-blue', 'dark-luxury', null]) {
      const pdf = await renderQuotePdf(q, { name: 'Bid Look Co', style: bidStyle(key, null) });
      const text = pdf.toString('latin1');
      expect(text.startsWith('%PDF')).toBe(true);
      expect(text).toContain(bidStyle(key, null).font === 'serif' ? 'Times-Bold' : 'Helvetica-Bold');
    }
  });
});
