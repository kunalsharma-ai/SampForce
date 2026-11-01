import { createHmac } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { signUp } from './helpers';

const ORIGIN = { origin: 'http://localhost:3000' };
// Values the Twilio stand-in (test/fixtures/twilio-fixture.ts, port 4960) accepts. Not real Twilio credentials.
const TW = { sid: `AC${'0123456789abcdef'.repeat(2)}`, token: 'abcdef0123456789abcdef0123456789', number: '+447700900100' };

async function apiPost(page: Page, path: string, data: object) {
  const res = await page.request.post(`/api/v1${path}`, { data, headers: ORIGIN });
  expect(res.ok(), `${path} → ${res.status()}`).toBe(true);
  return res.json();
}

/** What Twilio sends: form-encoded fields signed with HMAC-SHA1 over the URL and the sorted fields. */
async function twilioPost(page: Page, url: string, params: Record<string, string>) {
  const data = Object.keys(params).sort().reduce((acc, k) => acc + k + params[k], url);
  const sig = createHmac('sha1', TW.token).update(data).digest('base64');
  return page.request.post(new URL(url).pathname, { form: params, headers: { 'x-twilio-signature': sig } });
}

test('connects Twilio, records SMS consent, sends a text, sees the reply, and a STOP reply opts them out (Twilio stand-in)', async ({ page }) => {
  await signUp(page, 'SMS Flow');
  await page.goto('/app/integrations');
  const card = page.getByRole('region', { name: /^SMS \(Twilio\)/ });
  await expect(card.getByText('Not connected')).toBeVisible();
  await card.getByLabel('Account SID').fill(TW.sid);
  await card.getByLabel('Auth Token').fill('0'.repeat(32));
  await card.getByLabel('Twilio number').fill(TW.number);
  await card.getByRole('button', { name: 'Check and save' }).click();
  await expect(card.getByRole('alert')).toContainText('Twilio refused the Account SID and Auth Token');
  await card.getByLabel('Auth Token').fill(TW.token);
  await card.getByRole('button', { name: 'Check and save' }).click();
  await expect(card.getByText('Globex Sales')).toBeVisible();
  await expect(card.getByText(/Pending Configuration until Twilio sends the first signed request/)).toBeVisible();
  const inboundUrl = await card.getByLabel('Inbound message URL').inputValue();
  expect(inboundUrl).toMatch(/\/api\/v1\/apps\/twilio\/webhooks\/[a-f0-9]{24}\/inbound$/);
  // Twilio is no longer listed as planned; only voice is.
  await expect(page.getByRole('region', { name: 'Planned integrations' }).or(page.locator('section[aria-labelledby="planned-heading"]')).getByText('Twilio voice calls')).toBeVisible();

  const contact = await apiPost(page, '/contacts', { firstName: 'Gia', lastName: 'Buyer', phone: '+44 7700 900456' });
  await page.goto(`/app/contacts/${contact.id}`);
  const panel = page.getByRole('region', { name: 'SMS' });
  await expect(panel.getByText(/No SMS consent recorded/)).toBeVisible();
  await expect(panel.getByLabel('Text message', { exact: true })).toHaveCount(0);
  await panel.getByLabel('How they agreed to texts').fill('Ticked SMS updates on the demo form');
  await expect(panel.getByRole('button', { name: 'Record SMS consent' })).toBeDisabled();
  await panel.getByLabel('This person agreed to receive text messages from us.').check();
  await panel.getByRole('button', { name: 'Record SMS consent' }).click();
  await expect(panel.getByText('Consent recorded')).toBeVisible();

  await panel.getByLabel('Text message', { exact: true }).fill('Hi Gia, your proposal Q-0007 is ready.');
  await expect(panel.getByText(/38 characters · 1 segment \(GSM-7\)/)).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Send text' })).toBeDisabled();
  await panel.getByLabel('Send this text to +447700900456 now.').check();
  const results = await new AxeBuilder({ page }).include('[aria-labelledby^="sms-"]').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(results.violations.map((v) => v.id)).toEqual([]);
  await panel.getByRole('button', { name: 'Send text' }).click();
  const list = panel.getByRole('list', { name: 'Text messages' });
  await expect(list).toContainText('Hi Gia, your proposal Q-0007 is ready.');
  await expect(list).toContainText('Accepted by Twilio');

  // Gia texts back, then replies STOP; Twilio posts both, signed with the Auth Token.
  expect((await twilioPost(page, inboundUrl, { MessageSid: `SM${'b'.repeat(32)}`, AccountSid: TW.sid, From: '+447700900456', To: TW.number, Body: 'Friday works.', NumSegments: '1' })).status()).toBe(200);
  await page.reload();
  await expect(page.getByRole('region', { name: 'SMS' }).getByRole('list', { name: 'Text messages' })).toContainText('Friday works.');
  expect((await twilioPost(page, inboundUrl, { MessageSid: `SM${'c'.repeat(32)}`, AccountSid: TW.sid, From: '+447700900456', To: TW.number, Body: 'STOP', OptOutType: 'STOP', NumSegments: '1' })).status()).toBe(200);
  await page.reload();
  const after = page.getByRole('region', { name: 'SMS' });
  await expect(after.getByText('Opted out')).toBeVisible();
  await expect(after.getByLabel('Text message', { exact: true })).toHaveCount(0);
  await expect(after.getByLabel('How they agreed to texts')).toHaveCount(0);
});
