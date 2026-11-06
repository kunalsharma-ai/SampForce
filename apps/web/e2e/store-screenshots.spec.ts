import { type BrowserContext, chromium, expect, type Page, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';

/**
 * Retakes the Chrome Web Store and Edge Add-ons screenshots in apps/extension/store/. Not part of the normal run:
 *
 *   STORE_SCREENSHOTS=1 pnpm --filter @dealflow/web exec playwright test store-screenshots
 *   python3 apps/extension/store/compose-screenshots.py
 *
 * The first command saves the company site and the side panel separately to apps/extension/store/raw/; the second
 * puts them side by side at the 1280 x 800 the stores ask for. Everything shown is made up: the Kestrel Analytics
 * site is served here, and the email finder reads the stand-in in apps/api/test/fixtures/finder-fixture.ts.
 */
test.skip(!process.env.STORE_SCREENSHOTS, 'Set STORE_SCREENSHOTS=1 to retake the store screenshots.');

const EXT_DIR = join(__dirname, '../../extension/dist-test');
const RAW = join(__dirname, '../../extension/store/raw');
const SITE_SIZE = { width: 922, height: 764 };
const PANEL_SIZE = { width: 356, height: 764 };

const shell = (title: string, body: string) => `<!doctype html><html lang="en"><head><title>${title}</title>
<meta property="og:site_name" content="Kestrel Analytics">
<style>
  body{margin:0;background:#15181d;color:#e7e3da;font-family:Georgia,'Times New Roman',serif}
  header{display:flex;justify-content:space-between;align-items:center;padding:22px 42px;border-bottom:1px solid #2b2f36}
  header b{font-size:20px} nav a{color:#c9c4b8;margin-left:20px;text-decoration:none;font-size:15px}
  main{padding:40px 42px;min-height:560px} h1{font-size:40px;line-height:1.45;margin:0 0 18px;max-width:420px}
  p{font-size:15px;line-height:1.5;max-width:420px} main a{color:#e7d3a8} a.cta{display:inline-block;margin-top:22px;padding:12px 18px;border:1px solid #c9a96b;border-radius:6px;color:#e7d3a8;text-decoration:none}
  footer{border-top:1px solid #2b2f36;padding:22px 42px;font-size:13px;color:#b9b4a8}
</style></head><body>
<header><b>Kestrel Analytics</b><nav><a href="/">Home</a><a href="/our-people">Our people</a><a href="/careers">Careers</a><a href="/contact">Contact</a></nav></header>
<main>${body}</main>
<footer>A made-up company used to demonstrate SampForce. Nobody here is real.</footer></body></html>`;

const PAGES: Record<string, string> = {
  '/': shell(
    'Kestrel Analytics | Research consultancy',
    `<h1>Research that moves decisions.</h1>
     <p>Kestrel Analytics runs market and customer research for product teams across Europe and Asia.</p>
     <p>Start a project: projects@kestrel-analytics.com</p><a class="cta" href="/contact">Talk to us</a>`,
  ),
  '/careers': shell(
    'Careers | Kestrel Analytics',
    `<h1>Join the team</h1>
     <p>We are hiring research analysts in London and Bengaluru.</p>
     <p>Questions about a role? Ask Lena Fischer, People Partner: <a href="mailto:lena.fischer@kestrel-analytics.com">Lena Fischer</a>.</p>
     <p>Applications are handled by our hiring partner, jobs@talentbridge.example.org.</p>`,
  ),
};

let site: Server;
let port: number;
let context: BrowserContext;
let extensionId: string;

test.beforeAll(async () => {
  mkdirSync(RAW, { recursive: true });
  execFileSync('node', [join(__dirname, '../../extension/build.mjs'), '--test']);
  site = createServer((req, res) => {
    const body = PAGES[req.url ?? ''];
    res.writeHead(body ? 200 : 404, { 'content-type': 'text/html; charset=utf-8' });
    res.end(body ?? 'Not found');
  });
  await new Promise<void>((r) => site.listen(0, '127.0.0.1', r));
  port = (site.address() as AddressInfo).port;
  context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    baseURL: 'http://localhost:3000',
    colorScheme: 'dark',
    args: [`--disable-extensions-except=${EXT_DIR}`, `--load-extension=${EXT_DIR}`, '--host-resolver-rules=MAP kestrel-analytics.com 127.0.0.1'],
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  extensionId = new URL(worker.url()).host;
});

test.afterAll(async () => {
  await context?.close();
  await new Promise((r) => site?.close(r));
});

async function tabIdFor(url: string): Promise<number> {
  const worker = context.serviceWorkers()[0]!;
  type Tabs = { tabs: { query(q: object): Promise<{ id?: number; url?: string }[]> } };
  return worker.evaluate(async (u) => {
    const { chrome } = globalThis as unknown as { chrome: Tabs };
    return (await chrome.tabs.query({})).find((t) => t.url === u)!.id!;
  }, url);
}

async function openSite(path: string): Promise<{ page: Page; url: string }> {
  const page = await context.newPage();
  await page.setViewportSize(SITE_SIZE);
  const url = `http://kestrel-analytics.com:${port}${path}`;
  await page.goto(url);
  return { page, url };
}

async function openPanel(url: string): Promise<Page> {
  const panel = await context.newPage();
  await panel.setViewportSize(PANEL_SIZE);
  await panel.goto(`chrome-extension://${extensionId}/panel.html?tab=${await tabIdFor(url)}`);
  return panel;
}

async function shoot(name: string, sitePage: Page, panel: Page) {
  await sitePage.screenshot({ path: join(RAW, `${name}-site.png`) });
  await panel.screenshot({ path: join(RAW, `${name}-panel.png`) });
}

test('store screenshots', async () => {
  test.setTimeout(180_000);
  const app = await context.newPage();
  await app.setViewportSize({ width: 1280, height: 800 });
  await app.goto('/signup');
  await app.getByLabel('Your name').fill('Priya Shah');
  await app.getByLabel('Work email').fill(`priya.shah.${Date.now()}@northwind.example`);
  await app.getByLabel('Password', { exact: true }).fill('correcthorse1');
  await app.getByLabel('Organization name').fill('Northwind Research');
  await app.getByRole('button', { name: 'Start free' }).click();
  await expect(app).toHaveURL(/\/app/);

  await app.goto('/app/integrations');
  await app.getByLabel('Name this connection').fill('Chrome');
  await app.getByRole('button', { name: 'Create connection code' }).click();
  const code = (await app.getByTestId('extension-code').textContent())!.trim();

  // 1. The panel beside a company's home page, one address found.
  const home = await openSite('/');
  const panel = await openPanel(home.url);
  await panel.getByLabel('Your SampForce address').fill('http://localhost:3000');
  await panel.getByLabel('Connection code').fill(code);
  await panel.getByRole('button', { name: 'Connect' }).click();
  await expect(panel.getByText('1 address found.')).toBeVisible();
  await expect(panel.getByLabel('Company')).toHaveValue('Kestrel Analytics');
  await shoot('screenshot-1-scan', home.page, panel);

  // 2. "Find more people" reads the company's public site through the email finder.
  await panel.getByRole('button', { name: 'Find more people at kestrel-analytics.com' }).click();
  await expect(panel.getByText('4 addresses found.')).toBeVisible();
  await panel.getByLabel('Name for projects@kestrel-analytics.com').fill('Projects');
  await panel.getByLabel('Name for projects@kestrel-analytics.com').blur();
  await shoot('screenshot-2-find-more', home.page, panel);

  // 3. Saved as leads.
  await panel.getByRole('button', { name: 'Save 4 as leads' }).click();
  await expect(panel.getByRole('status').filter({ hasText: 'Saved 4 new leads.' })).toBeVisible();
  // Scroll past the panel header so the list starts at the top and the confirmation shows at the bottom.
  await panel.evaluate(() => window.scrollTo(0, document.querySelector('header')?.getBoundingClientRect().bottom ?? 0));
  await shoot('screenshot-3-saved', home.page, panel);

  // 4. Automatic capture while browsing: only the company's own people.
  await panel.getByLabel(/Save new people automatically/).check();
  await expect(panel.getByText(/saved today/)).toBeVisible();
  const careers = await openSite('/careers');
  await expect
    .poll(async () => (await (await app.request.get('/api/v1/leads?q=lena.fischer')).json()).total, { timeout: 15_000 })
    .toBe(1);
  await panel.close();
  const panel2 = await openPanel(careers.url);
  await expect(panel2.getByText('Lena Fischer · Kestrel Analytics')).toBeVisible();
  await expect(panel2.getByRole('link', { name: 'Open Lena Fischer in SampForce' })).toBeVisible();
  await expect(panel2.getByText('Recently saved automatically')).toBeVisible();
  await panel2.waitForTimeout(500); // the panel re-renders as the capture list loads
  await panel2.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await shoot('screenshot-4-auto-capture', careers.page, panel2);

  // 5. The email finder in the app.
  await app.goto('/app/finder');
  await app.getByLabel('Company name or website').fill('Kestrel Analytics');
  await app.getByRole('button', { name: 'Find emails' }).click();
  await expect(app.getByText('owen.price@kestrel-analytics.com').or(app.getByText('priya.raman@kestrel-analytics.com')).first()).toBeVisible();
  await app.getByLabel('First name').fill('Owen');
  await app.getByLabel('Last name').fill('Price');
  await app.getByRole('button', { name: 'Find emails' }).click();
  await expect(app.getByText('owen.price@kestrel-analytics.com').first()).toBeVisible();
  await app.mouse.move(0, 0);
  await app.screenshot({ path: join(RAW, 'screenshot-5-email-finder.png') });
});
