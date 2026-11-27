import { createHmac } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { E2E_DATABASE_URL, signUp } from './helpers';

/** Set PREVIEW_DIR to save screenshots of the new screens (used for previews). */
const PREVIEW_DIR = process.env.PREVIEW_DIR;
test.use({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 }, deviceScaleFactor: PREVIEW_DIR ? 2 : 1 });

async function expectNoA11yViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

const shot = async (page: Page, name: string, fullPage = false) => {
  if (PREVIEW_DIR) await page.screenshot({ path: `${PREVIEW_DIR}/${name}.png`, fullPage });
};

/** The stand-in website (apps/api/test/fixtures/website-fixture.ts, started by playwright.config.ts). Not real values. */
const SITE = 'http://127.0.0.1:4980/api/v1/sampforce';
const KEY = 'sfk_test_Pu5oq3xxxxxxxxxxxxxxxxxxxxxxxxxxxx';
const SECRET = 'e2e-website-webhook-secret-0123456789';

/** A delivery signed the way the website signs it: HMAC-SHA256 of "t.body" with the shared secret. */
function signed(event: string, data: unknown) {
  const raw = JSON.stringify({ id: `evt_${Date.now().toString(16)}`, event, createdAt: new Date().toISOString(), attempt: 1, data });
  const t = Math.floor(Date.now() / 1000);
  const v1 = createHmac('sha256', SECRET).update(`${t}.${raw}`).digest('hex');
  return { data: raw, headers: { 'content-type': 'application/json', 'x-sampforce-event': event, 'x-sampforce-delivery': `d_${t}`, 'x-sampforce-signature': `t=${t},v1=${v1}` } };
}

/**
 * Website Enquiry (ADR 0095), end to end: the platform admin connects the website in the Console, the first pull brings
 * in its history, a new enquiry arrives by signed webhook and is highlighted, and a salesperson follows it up (the
 * status goes back to the website) and converts it into a company and employee. Website Visitors is gone.
 */
test('the website is connected in the Console, enquiries arrive, and one is followed up and converted', async ({ browser, page }) => {
  test.setTimeout(120_000);
  await signUp(page, 'Frequent Research');
  const me = (await (await page.request.get('/api/v1/auth/me')).json()) as { tenant: { slug: string } };

  // Website Visitors is gone.
  expect((await page.request.get('/api/v1/visitors/settings')).status()).toBe(404);
  await page.goto('/app/website-visitors');
  await expect(page.getByRole('heading', { level: 1, name: 'Website Visitors' })).toBeHidden();

  // The platform admin connects the website under Providers.
  const email = `ops-web-${Date.now()}@platform.test`;
  execFileSync('node', ['-r', '@swc-node/register', 'scripts/create-operator.ts'], {
    cwd: '../api',
    env: { ...process.env, DATABASE_URL: E2E_DATABASE_URL, OPERATOR_EMAIL: email, OPERATOR_PASSWORD: 'operator-password-1', OPERATOR_NAME: 'E2E Web', OPERATOR_ROLE: 'ADMIN' },
  });
  const ops = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: PREVIEW_DIR ? 2 : 1, reducedMotion: 'reduce' })).newPage();
  await ops.goto('/operator/login');
  await ops.getByLabel('Email').fill(email);
  await ops.getByLabel('Password').fill('operator-password-1');
  await ops.getByRole('button', { name: 'Sign in' }).click();
  await ops.getByRole('navigation', { name: 'Operator' }).getByRole('link', { name: 'Providers' }).click();
  const site = ops.getByRole('region', { name: 'Website enquiries (company website)' });
  await site.scrollIntoViewIfNeeded();
  await site.getByRole('button', { name: /Add keys|Update keys/ }).click();
  const form = site.getByRole('form', { name: 'Edit Website enquiries (company website) keys' });
  await form.getByLabel('API address WEBSITE_API_BASE_URL').fill(SITE);
  await form.getByLabel('API key (sfk_...) WEBSITE_API_KEY').fill(KEY);
  await form.getByLabel('Webhook signing secret WEBSITE_WEBHOOK_SECRET').fill(SECRET);
  await form.getByLabel('Receiving workspace (web address name) WEBSITE_ENQUIRY_WORKSPACE').fill(me.tenant.slug);
  await site.getByRole('button', { name: 'Save keys' }).click();
  await expect(site.getByRole('list', { name: 'Website enquiries (company website) keys' })).toContainText('WEBSITE_API_KEYSaved here');
  await expect(ops.locator('body')).not.toContainText(KEY);
  await site.getByRole('button', { name: 'Test connection' }).click();
  await expect(site.getByText('Connection test passed')).toBeVisible();
  await shot(ops, 'website-enquiry-console');

  // Saving the receiving workspace switched the section on for it; the first pull brings in the website's history.
  await page.goto('/app/website-enquiries');
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { level: 1, name: 'Website Enquiry' })).toBeVisible();
  await expect(main.getByText('Live from your website')).toBeVisible();
  await main.getByRole('button', { name: 'Sync now' }).click();
  await expect(main.getByRole('status').filter({ hasText: /new from the website|Up to date|already running/ })).toBeVisible();
  await expect(main.getByRole('list', { name: 'Website enquiries' }).getByRole('listitem')).toHaveCount(10, { timeout: 30_000 });

  // A new RFQ arrives by webhook within seconds, signed with the shared secret.
  const lead = {
    id: `l_e2e_${Date.now().toString(16)}`,
    object: 'lead',
    type: 'enquiry',
    category: 'rfq',
    status: 'new',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    form: { key: 'lets-talk', name: "Let's Talk" },
    contact: { name: 'Asha Rao', email: 'asha.rao@acme-pharma.test', phone: '9810000000', countryCode: '+91', country: 'India', company: 'Acme Pharma', designation: 'Insights Manager' },
    enquiry: { service: 'Market research: Online surveys', timeline: 'Within 1 month', message: 'We need 500 completes with doctors in India. Can you share a quote this week?' },
    page: 'https://www.frequentresearch.test/contact',
    consent: true,
    extraFields: { Budget: 'USD 5,000 - 10,000' },
  };
  // The website keeps the lead (so it can take the status later) and sends it to SampForce.
  await page.request.post('http://127.0.0.1:4980/__leads', { data: lead });
  const hook = signed('lead.created', lead);
  const res = await page.request.post('http://localhost:4000/api/v1/hooks/website-enquiries', hook);
  expect(res.status()).toBe(200);
  expect(await res.json()).toEqual({ ok: true, received: true });
  // A delivery with the wrong signature is refused.
  expect((await page.request.post('http://localhost:4000/api/v1/hooks/website-enquiries', { ...hook, headers: { ...hook.headers, 'x-sampforce-signature': 't=1,v1=00' } })).status()).toBe(401);

  await page.reload();
  const justIn = main.getByRole('heading', { name: 'Just in' }).locator('..');
  await expect(justIn.getByRole('button', { name: /Asha Rao/ })).toBeVisible();
  await expect(main.getByRole('list', { name: 'Website enquiries' }).getByRole('listitem')).toHaveCount(11);
  await expectNoA11yViolations(page);
  await shot(page, 'website-enquiry-overview', true);

  // Filter by type: the chat lead only.
  const chatTile = main.getByRole('button', { name: /^\d+ Live chat leads/ });
  await chatTile.click();
  await expect(chatTile).toHaveAttribute('aria-pressed', 'true');
  await expect(main.getByRole('list', { name: 'Website enquiries' }).getByRole('listitem')).toHaveCount(1);
  await expect(main.getByRole('list', { name: 'Website enquiries' })).toContainText('Lina Haddad');
  await main.getByRole('button', { name: 'Remove filter Live chat leads' }).click();
  await expect(main.getByRole('list', { name: 'Website enquiries' }).getByRole('listitem')).toHaveCount(11);

  // Open the new RFQ: every field the form asked, then follow it up.
  await justIn.getByRole('button', { name: /Asha Rao/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Asha Rao' });
  await expect(sheet.getByText('We need 500 completes with doctors in India.', { exact: false })).toBeVisible();
  await expect(sheet.getByText('USD 5,000 - 10,000')).toBeVisible();
  await expect(sheet.getByText('+91 9810000000')).toBeVisible();
  await expect(page).toHaveURL(/open=/);
  await expectNoA11yViolations(page);
  await shot(page, 'website-enquiry-detail');

  await sheet.getByRole('radio', { name: 'Contacted' }).click();
  await expect(sheet.getByRole('radio', { name: 'Contacted' })).toHaveAttribute('aria-checked', 'true');
  await sheet.getByLabel('Stage').fill('Quote being prepared');
  await sheet.getByLabel('Note').fill('Call booked for Monday');
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(sheet.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();
  // The website gets the new status, stage, note and a link back.
  await expect
    .poll(async () => {
      const sent = (await (await page.request.get('http://127.0.0.1:4980/__patches')).json()) as { id: string; body: Record<string, unknown> }[];
      return sent.filter((p) => p.id === lead.id).at(-1)?.body ?? null;
    })
    .toMatchObject({ status: 'contacted', stage: 'Quote being prepared', note: 'Call booked for Monday' });

  // Convert: a new company and employee.
  await expect(sheet.getByText('Creates the company Acme Pharma.')).toBeVisible();
  await sheet.getByRole('button', { name: 'Convert', exact: true }).click();
  await expect(sheet.getByRole('status').filter({ hasText: 'Converted. New records are in Companies and Employees.' })).toBeVisible();
  await expect(sheet.getByRole('link', { name: /Acme Pharma/ })).toBeVisible();
  await expect(sheet.getByRole('link', { name: /Asha Rao/ })).toBeVisible();
  await expectNoA11yViolations(page);
  await shot(page, 'website-enquiry-converted');
  await sheet.getByRole('link', { name: /Acme Pharma/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: /Acme Pharma/ })).toBeVisible();
});
