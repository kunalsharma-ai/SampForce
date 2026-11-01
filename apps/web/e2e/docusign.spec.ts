import { createHmac } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { signUp } from './helpers';

const ORIGIN = { origin: 'http://localhost:3000' };

async function apiPost(page: Page, path: string, data: object) {
  const res = await page.request.post(`/api/v1${path}`, { data, headers: ORIGIN });
  expect(res.ok(), `${path} → ${res.status()}`).toBe(true);
  return res.json();
}

/** A DocuSign Connect message signed with the stand-in's HMAC key (set in playwright.config). */
async function connectEvent(page: Page, envelopeId: string, event: string, signer: { name: string; email: string }) {
  const raw = JSON.stringify({ event, apiVersion: 'v2.1', data: { accountId: 'ds-acct-1', envelopeId, envelopeSummary: { status: event.replace('envelope-', ''), completedDateTime: new Date().toISOString(), recipients: { signers: [signer] } } } });
  const sig = createHmac('sha256', 'ds-connect-hmac-key').update(raw).digest('base64');
  const res = await page.request.post('/api/v1/apps/docusign/events', { data: raw, headers: { 'content-type': 'application/json', 'x-docusign-signature-1': sig } });
  expect(res.status()).toBe(200);
}

test('connects DocuSign, sends a draft contract for signature after confirming, and marks it signed (DocuSign stand-in)', async ({ page }) => {
  await signUp(page, 'Sign Flow');
  await page.goto('/app/integrations');
  const card = page.getByRole('region', { name: /^DocuSign/ });
  await card.getByRole('button', { name: 'Connect DocuSign' }).click();
  await expect(page).toHaveURL(/app=docusign&app_connected=1/);
  await expect(card.getByText('Acme Legal')).toBeVisible();

  const start = new Date().toISOString().slice(0, 10);
  const contract = await apiPost(page, '/contracts', { name: 'Globex annual', value: 12000, startDate: start, terms: 'Annual subscription.' });
  await page.goto(`/app/contracts/${contract.id}`);
  const esign = page.getByRole('region', { name: 'E-signature (DocuSign)' });
  await esign.getByLabel('Signer’s name').fill('Grace Hopper');
  await esign.getByLabel('Signer’s email').fill('grace@customer.test');
  await expect(esign.getByRole('button', { name: 'Send for signature' })).toBeDisabled();
  await esign.getByLabel(/Email this contract to grace@customer.test/).check();
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(results.violations.map((v) => v.id)).toEqual([]);
  await esign.getByRole('button', { name: 'Send for signature' }).click();
  const list = esign.getByRole('list', { name: 'Signature envelopes' });
  await expect(list).toContainText('Sent, waiting for signature');

  const [env] = await (await page.request.get(`/api/v1/apps/docusign/envelopes?contractId=${contract.id}`)).json();
  await connectEvent(page, env.envelopeId, 'envelope-completed', { name: 'Grace Hopper', email: 'grace@customer.test' });
  await page.reload();
  await expect(page.getByRole('region', { name: 'E-signature (DocuSign)' }).getByRole('list', { name: 'Signature envelopes' })).toContainText('Signed');
  await expect(page.getByText(/Grace Hopper on .* \(Signed with DocuSign\)/)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Download signed PDF' })).toBeVisible();
});
