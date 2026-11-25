import { createHmac } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { setFeature, signUp } from './helpers';

const ORIGIN = { origin: 'http://localhost:3000' };
/** The SampBidx stand-in started by playwright.config.ts (apps/api/test/fixtures/sampbidx-fixture.ts). */
const SBX_URL = 'http://127.0.0.1:4970';
const SBX_KEY = 'sbx_test_key_0123456789';
const PREVIEW_DIR = process.env.PREVIEW_DIR;

test.use({ reducedMotion: 'reduce', viewport: { width: 1600, height: 960 }, deviceScaleFactor: PREVIEW_DIR ? 2 : 1 });

async function axe(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(r.violations.map((v) => `${v.id} ${v.nodes[0]?.target} ${v.nodes[0]?.failureSummary}`)).toEqual([]);
}

async function post(page: Page, path: string, data: object) {
  const res = await page.request.post(`/api/v1${path}`, { data, headers: ORIGIN });
  expect(res.ok(), await res.text()).toBe(true);
  return res.json();
}

async function shot(page: Page, name: string) {
  if (!PREVIEW_DIR) return;
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${PREVIEW_DIR}/${name}.png` });
}

test('chat with the SampBidx team: the general line and one chat per RFQ, both ways', async ({ page }) => {
  test.setTimeout(180_000);
  await signUp(page, 'Frequent Research Fieldwork Solutions');
  const main = page.getByRole('main');

  // SampBidx is connected; chat with its team is off until the Console Admin allows it.
  await post(page, '/apps/sampbidx/keys', { baseUrl: `${SBX_URL}/api`, apiKey: SBX_KEY });
  const { callbackUrl, secret } = await (await page.request.get('/api/v1/apps/sampbidx/callback-secret')).json();
  const hook = new URL(callbackUrl).pathname;
  const signed = async (path: string, body: object) => {
    const raw = JSON.stringify(body);
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = `sha256=${createHmac('sha256', secret).update(`${ts}.${raw}`).digest('hex')}`;
    const res = await page.request.post(path, { data: raw, headers: { 'content-type': 'application/json', 'x-sampbidx-timestamp': ts, 'x-sampbidx-signature': sig } });
    return { status: res.status(), body: await res.json() };
  };
  await page.goto('/app/chat');
  await expect(main.getByRole('region', { name: 'Chat with SampBidx team' })).toHaveCount(0);

  await setFeature(page, 'sampbidx_chat', true);
  const lead = await post(page, '/company-leads', { company: { name: 'Acme Panels', country: 'GB' }, employees: [{ firstName: 'Priya', lastName: 'Nair', emails: [{ value: 'priya@acmepanels.example' }] }] });
  const transfer = await post(page, '/apps/sampbidx/transfers/pasted-email', {
    companyId: lead.company.id,
    text: 'From: Priya Nair <priya@acmepanels.example>\nSubject: RFQ: UK B2C grocery shoppers, n=1,000\n\nPlease quote 1,000 UK grocery shoppers, LOI 12, IR 40%. Field next week.',
  });
  // The SampBidx team writes on the general line before anyone in SampForce opens chat.
  expect((await signed(`${hook}/messages`, { id: 'sbx-hello', author: { id: 'u-7', name: 'Meera Iyer', email: 'meera@sampbidx.example', role: 'Bid manager' }, text: 'Hi team, we have capacity for UK consumer work this week. Send anything urgent our way.' })).status).toBe(200);

  await page.reload();
  const section = main.getByRole('region', { name: 'Chat with SampBidx team' });
  await expect(section).toBeVisible();
  const lineRow = section.locator('[data-conversation="SampBidx team"]');
  await expect(lineRow).toContainText('Meera Iyer: Hi team');
  await lineRow.click();
  const thread = main.getByRole('region', { name: 'Conversation' });
  await expect(thread.getByRole('heading', { name: 'SampBidx team' })).toBeVisible();
  await expect(thread.locator('[data-message]').filter({ hasText: 'we have capacity' })).toContainText('SampBidx · Bid manager');

  // Answering goes to SampBidx, and says when SampBidx has it.
  const composer = thread.getByRole('textbox', { name: 'Message', exact: true });
  await expect(composer).toHaveAttribute('placeholder', 'Message the SampBidx team');
  await composer.fill('Great, thank you Meera. An RFQ for UK grocery shoppers is on its way.');
  await composer.press('Enter');
  await expect(thread.locator('[data-sampbidx-delivery="sent"]').last()).toHaveText('Delivered to SampBidx');
  const got = await (await page.request.get(`${SBX_URL}/__messages`)).json();
  expect(got.at(-1).json).toMatchObject({ conversation: { type: 'general' }, text: 'Great, thank you Meera. An RFQ for UK grocery shoppers is on its way.' });
  await axe(page);
  await shot(page, '01-sampbidx-team-line');

  // A chat about one RFQ sent to SampBidx.
  await section.getByRole('button', { name: 'RFQ chat' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Chat about an RFQ' })).toBeVisible();
  const option = dialog.locator(`[data-transfer="${transfer.title}"]`);
  await expect(option).toContainText('Acme Panels');
  await shot(page, '02-start-rfq-chat');
  await option.click();
  await expect(dialog).toHaveCount(0);
  await expect(thread.getByRole('heading', { name: transfer.title })).toBeVisible();
  await composer.fill('Hi SampBidx, can you confirm feasibility for n=1,000 at IR 40%? The client wants the quote by Thursday.');
  await composer.press('Enter');
  await expect(thread.locator('[data-sampbidx-delivery="sent"]').last()).toBeVisible();
  expect((await (await page.request.get(`${SBX_URL}/__messages`)).json()).at(-1).json).toMatchObject({ conversation: { type: 'rfq', transferId: transfer.id, sampbidxId: transfer.remoteId } });

  // SampBidx answers about that RFQ, with a file, and its status change shows in the chat.
  expect(
    (
      await signed(`${hook}/messages`, {
        id: 'sbx-rfq-1',
        sampbidxId: transfer.remoteId,
        author: { name: 'Arjun Rao', email: 'arjun@sampbidx.example', role: 'Senior bidder' },
        text: 'Feasible. We can deliver n=1,000 in 6 field days. Our feasibility note is attached.',
        attachments: [{ name: 'feasibility-uk-grocery.pdf', contentType: 'application/pdf', data: Buffer.from('%PDF-1.4 feasibility').toString('base64') }],
      })
    ).status,
  ).toBe(200);
  expect((await signed(hook, { sampbidxId: transfer.remoteId, status: 'quoted', note: 'USD 4.20 CPI, 6 field days' })).status).toBe(200);
  await expect(thread.locator('[data-message]').filter({ hasText: 'Feasible.' })).toContainText('SampBidx · Senior bidder');
  await expect(thread.getByRole('link', { name: /feasibility-uk-grocery\.pdf/ })).toBeVisible();
  await expect(thread.locator('[data-sampbidx-system]')).toContainText('USD 4.20 CPI');
  await expect(section.locator(`[data-conversation="${transfer.title}"]`)).toContainText('Quoted');
  await thread.getByRole('button', { name: 'Conversation details' }).click();
  const details = main.getByRole('complementary', { name: 'Conversation details' });
  await expect(details).toContainText('Arjun Rao');
  await axe(page);
  await shot(page, '03-rfq-chat-with-sampbidx');
  await details.getByRole('button', { name: 'Close' }).click();

  // SampBidx is briefly down: the message says so, and Try again gets it there.
  await page.request.post(`${SBX_URL}/__fail`, { data: { count: 1 } });
  await composer.fill('Thanks Arjun, approving the quote now.');
  await composer.press('Enter');
  const failed = thread.locator('[data-sampbidx-delivery="failed"]');
  await expect(failed).toContainText('Not delivered to SampBidx');
  await shot(page, '04-not-delivered-try-again');
  await failed.getByRole('button', { name: 'Try again' }).click();
  await expect(failed).toHaveCount(0);
  await expect(thread.locator('[data-sampbidx-delivery="sent"]').last()).toBeVisible();

  // On a phone.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/app/chat');
  await expect(main.getByRole('region', { name: 'Chat with SampBidx team' })).toBeVisible();
  await shot(page, '05-phone-chat-list');
  await main.getByRole('region', { name: 'Chat with SampBidx team' }).locator(`[data-conversation="${transfer.title}"]`).click();
  await expect(thread.getByRole('heading', { name: transfer.title })).toBeVisible();
  await shot(page, '06-phone-rfq-chat');

  // The Console Admin switches it off: the section goes away.
  await setFeature(page, 'sampbidx_chat', false);
  await page.setViewportSize({ width: 1600, height: 960 });
  await page.goto('/app/chat');
  await expect(main.getByRole('heading', { name: 'Team chat', level: 1 })).toBeVisible();
  await expect(main.getByRole('region', { name: 'Chat with SampBidx team' })).toHaveCount(0);
});
