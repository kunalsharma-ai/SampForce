import { createHmac } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { signUp } from './helpers';

const ORIGIN = { origin: 'http://localhost:3000' };
// Values the WhatsApp stand-in (test/fixtures/whatsapp-fixture.ts, port 4950) accepts. Not real Meta credentials.
const WA = { phoneNumberId: '1000000001', wabaId: '2000000001', token: 'EAAgoodFixtureToken0123456789abcdef', appSecret: '0123456789abcdef0123456789abcdef' };

async function apiPost(page: Page, path: string, data: object) {
  const res = await page.request.post(`/api/v1${path}`, { data, headers: ORIGIN });
  expect(res.ok(), `${path} → ${res.status()}`).toBe(true);
  return res.json();
}

test('connects WhatsApp, records consent, sends a template and replies inside the 24-hour window (WhatsApp stand-in)', async ({ page }) => {
  await signUp(page, 'WA Flow');
  await page.goto('/app/integrations');
  const card = page.getByRole('region', { name: /^WhatsApp Business/ });
  await card.getByLabel('Phone number id').fill(WA.phoneNumberId);
  await card.getByLabel('WhatsApp Business Account id').fill(WA.wabaId);
  await card.getByLabel('Access token').fill(WA.token);
  await card.getByLabel('App Secret').fill(WA.appSecret);
  await card.getByRole('button', { name: 'Check and save' }).click();
  await expect(card.getByText('Globex Sales')).toBeVisible();
  await expect(card.getByText(/Pending Configuration until Meta sends the first signed webhook/)).toBeVisible();
  const callback = await card.getByLabel('Callback URL').inputValue();
  const verifyToken = await card.getByLabel('Verify token').inputValue();
  // What Meta does when the admin saves the callback in the Meta app.
  const check = await page.request.get(`${new URL(callback).pathname}?hub.mode=subscribe&hub.verify_token=${verifyToken}&hub.challenge=4242`);
  expect(await check.text()).toBe('4242');

  const contact = await apiPost(page, '/contacts', { firstName: 'Gia', lastName: 'Buyer', phone: '+44 7700 900456' });
  await page.goto(`/app/contacts/${contact.id}`);
  const panel = page.getByRole('region', { name: 'WhatsApp' });
  await expect(panel.getByText(/No WhatsApp consent recorded/)).toBeVisible();
  await expect(panel.getByLabel('Approved template')).toHaveCount(0);
  await panel.getByLabel('How they agreed').fill('Ticked the WhatsApp box on the demo form');
  await expect(panel.getByRole('button', { name: 'Record consent' })).toBeDisabled();
  await panel.getByLabel('This person agreed to receive WhatsApp messages from us.').check();
  await panel.getByRole('button', { name: 'Record consent' }).click();
  await expect(panel.getByText('Consent recorded')).toBeVisible();

  await panel.getByLabel('Approved template').selectOption({ label: 'proposal_ready (en)' });
  await panel.getByLabel('Value for {{1}}').fill('Gia');
  await panel.getByLabel('Value for {{2}}').fill('Q-0007');
  await expect(panel.getByLabel('Message preview')).toHaveText('Hi Gia, your proposal Q-0007 is ready. Reply here with any questions.');
  await expect(panel.getByRole('button', { name: 'Send template' })).toBeDisabled();
  await panel.getByLabel('Send this WhatsApp message to +447700900456 now.').check();
  const results = await new AxeBuilder({ page }).include('[aria-labelledby^="wa-"]').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(results.violations.map((v) => v.id)).toEqual([]);
  await panel.getByRole('button', { name: 'Send template' }).click();
  const list = panel.getByRole('list', { name: 'WhatsApp messages' });
  await expect(list).toContainText('Hi Gia, your proposal Q-0007 is ready.');
  await expect(list).toContainText('Accepted by WhatsApp');
  await expect(panel.getByLabel('Reply')).toHaveCount(0);

  // Gia answers on WhatsApp; Meta delivers it signed with the App Secret.
  const body = JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [{ id: WA.wabaId, changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { phone_number_id: WA.phoneNumberId }, contacts: [{ wa_id: '447700900456', profile: { name: 'Gia' } }], messages: [{ from: '447700900456', id: 'wamid.browser1', timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: 'Can we talk on Friday?' } }] } }] }],
  });
  const sig = `sha256=${createHmac('sha256', WA.appSecret).update(body).digest('hex')}`;
  expect((await page.request.post(new URL(callback).pathname, { data: body, headers: { 'content-type': 'application/json', 'x-hub-signature-256': sig } })).status()).toBe(200);

  await page.reload();
  const panel2 = page.getByRole('region', { name: 'WhatsApp' });
  await expect(panel2.getByRole('list', { name: 'WhatsApp messages' })).toContainText('Can we talk on Friday?');
  await panel2.getByLabel('Reply').fill('Friday at 10 works.');
  await panel2.getByRole('button', { name: 'Send reply' }).click();
  await expect(panel2.getByRole('list', { name: 'WhatsApp messages' })).toContainText('Friday at 10 works.');
  await expect(panel2.getByText(/Free-form replies are open until/)).toBeVisible();
});
