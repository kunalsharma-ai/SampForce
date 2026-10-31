import AxeBuilder from '@axe-core/playwright';
import { type BrowserContext, chromium, expect, type Page, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { signUp } from './helpers';

/**
 * The browser extension, loaded into Chromium, against a stand-in company website. The test build asks
 * for site access at install, because an automated browser cannot click the permission prompt.
 */
const EXT_DIR = join(__dirname, '../../extension/dist-test');

const PAGES: Record<string, string> = {
  '/team.html': `<!doctype html><html lang="en"><head><title>Our team | Globex Research</title><meta property="og:site_name" content="Globex Research"></head>
    <body><h1>Team</h1>
      <p><a href="mailto:jane.doe@globex.test">Jane Doe</a>, Head of Research</p>
      <p>Raj leads partnerships: raj@globex.test</p>
      <p>Sales: sales [at] globex [dot] test</p>
      <p>Our founder's personal address: founder.private@gmail.com</p>
      <img src="logo@2x.png" alt="">
    </body></html>`,
  '/about.html': `<!doctype html><html lang="en"><head><title>About | Globex Research</title><meta property="og:site_name" content="Globex Research"></head>
    <body><p>Press: lee.wong@globex.test. Our agency: hello@agency.test. Fan mail: fan@gmail.com</p></body></html>`,
};

let site: Server;
let port: number;
let context: BrowserContext;
let extensionId: string;

test.beforeAll(async () => {
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
    args: [`--disable-extensions-except=${EXT_DIR}`, `--load-extension=${EXT_DIR}`, '--host-resolver-rules=MAP globex.test 127.0.0.1'],
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

async function connect(app: Page): Promise<string> {
  await app.goto('/app/integrations');
  await app.getByLabel('Name this connection').fill('Chrome test');
  await app.getByRole('button', { name: 'Create connection code' }).click();
  const code = (await app.getByTestId('extension-code').textContent())!.trim();
  expect(code).toMatch(/^dfx_/);
  await expect(app.getByRole('list', { name: 'Extension connections' })).toContainText('Chrome test');
  return code;
}

test('saves people found on a company page as leads, without duplicates', async () => {
  const app = await context.newPage();
  await signUp(app, 'Extension Flow');
  const res = await app.request.post('/api/v1/leads', { data: { fullName: 'Raj Patel', email: 'raj@globex.test' }, headers: { origin: 'http://localhost:3000' } });
  expect(res.ok()).toBe(true);
  const code = await connect(app);

  const team = await context.newPage();
  const teamUrl = `http://globex.test:${port}/team.html`;
  await team.goto(teamUrl);
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/panel.html?tab=${await tabIdFor(teamUrl)}`);

  await panel.getByLabel('Your DealFlow address').fill('http://localhost:3000');
  await panel.getByLabel('Connection code').fill('dfx_wrong');
  await panel.getByRole('button', { name: 'Connect' }).click();
  await expect(panel.getByRole('alert')).toContainText('connection has ended');
  await panel.getByLabel('Connection code').fill(code);
  await panel.getByRole('button', { name: 'Connect' }).click();

  await expect(panel.getByText('Test Person · Extension Flow')).toBeVisible();
  await expect(panel.getByText('4 addresses found.')).toBeVisible();
  await expect(panel.getByLabel('Company')).toHaveValue('Globex Research');
  // Already a lead: shown with a link and not selectable. Personal: left unticked.
  await expect(panel.getByRole('link', { name: 'Open Raj Patel in DealFlow' })).toBeVisible();
  await expect(panel.getByRole('checkbox', { name: /raj@globex.test/ })).toBeDisabled();
  await expect(panel.getByRole('checkbox', { name: /founder.private@gmail.com/ })).not.toBeChecked();
  await expect(panel.getByLabel('Name for jane.doe@globex.test')).toHaveValue('Jane Doe');
  await panel.getByLabel('Name for sales@globex.test').fill('Globex sales desk');
  const axe = await new AxeBuilder({ page: panel }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(axe.violations.map((v) => v.id)).toEqual([]);

  await panel.getByRole('button', { name: 'Save 2 as leads' }).click();
  await expect(panel.getByRole('status').filter({ hasText: 'Saved 2 new leads.' })).toBeVisible();
  await expect(panel.getByRole('link', { name: 'Open Jane Doe in DealFlow' })).toBeVisible();

  const leads = await (await app.request.get('/api/v1/leads?q=globex')).json();
  expect(leads.items.map((l: { fullName: string }) => l.fullName).sort()).toEqual(['Globex sales desk', 'Jane Doe', 'Raj Patel']);
  expect(leads.items.find((l: { fullName: string }) => l.fullName === 'Jane Doe')).toMatchObject({ companyName: 'Globex Research', source: 'Browser extension' });

  // Automatic capture: only the site's own people, never personal mailboxes or other companies.
  await panel.getByLabel(/Save new people automatically/).check();
  await expect(panel.getByText(/saved today/)).toBeVisible();
  const about = await context.newPage();
  await about.goto(`http://globex.test:${port}/about.html`);
  await expect
    .poll(async () => (await (await app.request.get('/api/v1/leads?q=lee.wong')).json()).items.map((l: { fullName: string; tags: string[] }) => [l.fullName, l.tags]), { timeout: 10_000 })
    .toEqual([['Lee Wong', ['browser-extension', 'auto-captured']]]);
  expect((await (await app.request.get('/api/v1/leads?q=agency')).json()).total).toBe(0);
  expect((await (await app.request.get('/api/v1/leads?q=fan%40gmail')).json()).total).toBe(0);

  // Disconnecting ends the connection in DealFlow too.
  await panel.getByRole('button', { name: 'Disconnect' }).click();
  await expect(panel.getByRole('heading', { name: 'Connect to DealFlow' })).toBeVisible();
  await app.reload();
  await expect(app.getByRole('list', { name: 'Extension connections' })).toHaveCount(0);
});
