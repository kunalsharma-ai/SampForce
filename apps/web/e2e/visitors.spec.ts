import AxeBuilder from '@axe-core/playwright';
import { type BrowserContext, expect, type Page, test } from '@playwright/test';
import { signUp } from './helpers';

const SITE = 'http://shop.example.test';
/** SampForce as the visitor's browser sees it: a public host, forwarded to the local app. Chromium blocks pages on a
 * public origin from calling localhost (Private Network Access), which a real deployment never runs into. */
const SAMPFORCE = 'http://sampforce.example.test';

async function noAxeViolations(page: Page) {
  await page.waitForLoadState('networkidle');
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

/**
 * A stand-in for the customer's own website, served by Playwright, with the install snippet from SampForce.
 * `legacy` writes the snippet and form with the names used before the rename (window.dealflow, data-dealflow-*),
 * as on a site set up then, which must keep working.
 */
async function fakeSite(context: BrowserContext, snippet: string, legacy = false) {
  await context.route(`${SAMPFORCE}/**`, async (route) => {
    const response = await route.fetch({ url: route.request().url().replace(SAMPFORCE, 'http://localhost:3000') });
    await route.fulfill({ response });
  });
  snippet = snippet.replace('http://localhost:3000', SAMPFORCE);
  const attr = legacy ? 'data-dealflow' : 'data-sampforce';
  if (legacy) snippet = snippet.replaceAll('window.sampforce', 'window.dealflow').replaceAll('sampforce(', 'dealflow(');
  await context.route(`${SITE}/**`, (route) => {
    const path = new URL(route.request().url()).pathname;
    const title = path === '/' ? 'Home' : path.slice(1);
    return route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html><head><title>${title}</title>${snippet}</head><body>
<h1>${title}</h1>
<nav><a href="/pricing">Pricing</a> <a href="/demo">Demo</a></nav>
<form ${attr}-enquiry>
  <input name="fullName" aria-label="Your name"><input name="email" aria-label="Work email"><input name="companyName" aria-label="Company">
  <textarea name="message" aria-label="Message"></textarea>
  <label><input type="checkbox" name="consent"> <span ${attr}-consent-text></span></label>
  <p ${attr}-error></p><button>Send</button>
</form></body></html>`,
    });
  });
}

async function visitors(page: Page) {
  const res = await page.request.get('/api/v1/visitors');
  expect(res.ok()).toBe(true);
  return (await res.json()) as { label: string; pageViews: number }[];
}

test('admin installs tracking with consent; a consenting visitor is scored and becomes a lead when they enquire', async ({ page, browser }) => {
  // One long journey across three browsers (admin, visitor, visitor with Global Privacy Control) with four
  // accessibility scans: about 20 seconds on a quiet machine, so the default 30 seconds runs out when the machine is busy.
  test.setTimeout(60_000);
  await signUp(page, 'Tracked');
  await page.goto('/app/website-visitors');
  await expect(page.getByText('Website tracking is off.')).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Install and settings' })).toHaveAttribute('aria-selected', 'true');
  await noAxeViolations(page);

  // Turning tracking on without a website is refused.
  await page.getByLabel('Record website visits').check();
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByText('Add at least one website before turning tracking on.')).toBeVisible();

  await page.getByLabel('Websites allowed to send data').fill('shop.example.test');
  await expect(page.getByLabel('Ask first (recommended).', { exact: false })).toBeChecked();
  await page.getByLabel('Marketing consent text on enquiry forms').fill('Send me product news.');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();
  await expect(page.getByText('Website tracking is off.')).toBeHidden();
  await noAxeViolations(page);
  const snippet = (await page.getByLabel('Install snippet').textContent())!;
  expect(snippet).toContain('data-site="dfs_');

  // The visitor's browser: a separate context with no SampForce session.
  const visitorContext = await browser.newContext();
  await fakeSite(visitorContext, snippet);
  const site = await visitorContext.newPage();
  await site.goto(`${SITE}/`);
  await expect.poll(() => site.evaluate(() => typeof (window as unknown as { __sampforceLoaded?: boolean }).__sampforceLoaded)).toBe('boolean');
  await site.waitForTimeout(500);
  // Nothing is recorded before consent.
  expect((await visitors(page))).toHaveLength(0);

  await site.evaluate(() => (window as unknown as { sampforce: (c: string, a: boolean) => void }).sampforce('consent', true));
  await expect.poll(async () => (await visitors(page)).length).toBe(1);
  await site.getByRole('link', { name: 'Pricing' }).click();
  await expect(site.getByRole('heading', { name: 'pricing' })).toBeVisible();
  // The tracker records a page once it has fetched the site's settings, a moment after the page shows. Wait for
  // that, as a person reading the page would, before moving on: leaving sooner cancels the request.
  await expect.poll(async () => (await visitors(page))[0]?.pageViews).toBe(2);
  await site.getByRole('link', { name: 'Demo' }).click();
  await expect(site.getByRole('heading', { name: 'demo' })).toBeVisible();
  await expect.poll(async () => (await visitors(page))[0]?.pageViews).toBe(3);

  // The enquiry form shows the workspace's consent text and links the visit history to a new lead.
  await expect(site.getByText('Send me product news.')).toBeVisible();
  await site.getByLabel('Your name').fill('Priya Raman');
  await site.getByLabel('Work email').fill('priya@buyer.test');
  await site.getByLabel('Company').fill('Buyer Ltd');
  await site.getByRole('checkbox').check();
  await site.getByRole('button', { name: 'Send' }).click();
  await expect(site.getByRole('status')).toHaveText('Thank you. We will be in touch soon.');

  // A second browser with Global Privacy Control is never recorded, even after consent.
  const gpcContext = await browser.newContext();
  await gpcContext.addInitScript(() => Object.defineProperty(navigator, 'globalPrivacyControl', { get: () => true }));
  await fakeSite(gpcContext, snippet);
  const gpc = await gpcContext.newPage();
  await gpc.goto(`${SITE}/pricing`);
  await expect.poll(() => gpc.evaluate(() => typeof (window as unknown as { __sampforceLoaded?: boolean }).__sampforceLoaded)).toBe('boolean');
  await gpc.evaluate(() => (window as unknown as { sampforce: (c: string, a: boolean) => void }).sampforce('consent', true));
  await gpc.waitForTimeout(1000);
  expect((await visitors(page))).toHaveLength(1);

  // A site installed before the rename (window.dealflow, data-dealflow-*) is still recorded and its form still works.
  const legacyContext = await browser.newContext();
  await fakeSite(legacyContext, snippet, true);
  const legacy = await legacyContext.newPage();
  await legacy.goto(`${SITE}/`);
  await expect.poll(() => legacy.evaluate(() => typeof (window as unknown as { __sampforceLoaded?: boolean }).__sampforceLoaded)).toBe('boolean');
  await legacy.evaluate(() => (window as unknown as { dealflow: (c: string, a: boolean) => void }).dealflow('consent', true));
  await expect.poll(async () => (await visitors(page)).length).toBe(2);
  await expect(legacy.getByText('Send me product news.')).toBeVisible();
  await legacyContext.close();

  // Back in SampForce: the dashboard, the visitor list, the scored signals, and the lead's website activity.
  await page.reload();
  await expect(page.getByRole('tab', { name: 'Dashboard' })).toHaveAttribute('aria-selected', 'true');
  const high = page.getByRole('list', { name: 'High-intent visitors' });
  // Enquiry 30 + Book a demo 25 + Pricing 20 = 75, over the default threshold of 50.
  await expect(high.getByRole('listitem').filter({ hasText: 'Priya Raman' })).toContainText('75/100');
  await noAxeViolations(page);

  await page.getByRole('tab', { name: 'Visitors' }).click();
  await page.getByRole('button', { name: 'Priya Raman' }).click();
  const dialog = page.getByRole('dialog');
  const signals = dialog.getByRole('list', { name: 'Intent signals' });
  await expect(signals).toContainText('Sent an enquiry');
  await expect(signals).toContainText('Viewed Book a demo');
  await expect(signals).toContainText('Viewed Pricing');
  await noAxeViolations(page);
  await page.keyboard.press('Escape');

  await page.goto('/app/leads');
  await page.getByRole('link', { name: 'Priya Raman' }).click();
  await expect(page.getByText('Website activity')).toBeVisible();
  await expect(page.getByRole('list', { name: 'Website intent signals' })).toContainText('Sent an enquiry');

  await visitorContext.close();
  await gpcContext.close();
});
