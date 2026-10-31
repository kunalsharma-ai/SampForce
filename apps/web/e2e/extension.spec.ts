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
  '/kestrel.html': `<!doctype html><html lang="en"><head><title>Kestrel Analytics</title><meta property="og:site_name" content="Kestrel Analytics"></head>
    <body><p>Start a project: projects@kestrel-analytics.com</p></body></html>`,
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
    args: [`--disable-extensions-except=${EXT_DIR}`, `--load-extension=${EXT_DIR}`, '--host-resolver-rules=MAP globex.test 127.0.0.1, MAP kestrel-analytics.com 127.0.0.1'],
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

test('finds more people at the company through the email finder', async () => {
  const app = await context.newPage();
  await signUp(app, 'Extension Finder');
  const code = await connect(app);
  const site = await context.newPage();
  const url = `http://kestrel-analytics.com:${port}/kestrel.html`;
  await site.goto(url);
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/panel.html?tab=${await tabIdFor(url)}`);
  if (await panel.getByLabel('Connection code').isVisible()) {
    await panel.getByLabel('Your DealFlow address').fill('http://localhost:3000');
    await panel.getByLabel('Connection code').fill(code);
    await panel.getByRole('button', { name: 'Connect' }).click();
  }
  await expect(panel.getByText('1 address found.')).toBeVisible();
  await panel.getByRole('button', { name: 'Find more people at kestrel-analytics.com' }).click();
  await expect(panel.getByRole('status').filter({ hasText: 'Found 3 more on kestrel-analytics.com' })).toBeVisible();
  await expect(panel.getByText('4 addresses found.')).toBeVisible();
  await expect(panel.getByLabel('Name for tomas.herrera@kestrel-analytics.com')).toHaveValue('Tomás Herrera');
  await expect(panel.getByRole('checkbox', { name: /priya.raman@kestrel-analytics.com.*On their site/ })).toBeChecked();
  await panel.getByRole('button', { name: 'Save 4 as leads' }).click();
  await expect(panel.getByRole('status').filter({ hasText: 'Saved 4 new leads.' })).toBeVisible();
  // The people found through the finder stay listed, now as leads.
  await expect(panel.getByRole('link', { name: 'Open Priya Raman in DealFlow' })).toBeVisible();
});

test('signs in with a password and imports prospects at the company on screen (Mock Mode)', async () => {
  const app = await context.newPage();
  const { email, password } = await signUp(app, 'Extension Prospects');
  const site = await context.newPage();
  const url = `http://globex.test:${port}/team.html`;
  await site.goto(url);
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/panel.html?tab=${await tabIdFor(url)}`);
  if (!(await panel.getByRole('heading', { name: 'Connect to DealFlow' }).isVisible())) {
    await panel.getByRole('button', { name: 'Disconnect' }).click();
  }
  await panel.getByLabel('Your DealFlow address').fill('http://localhost:3000');
  await panel.getByLabel('Work email').fill(email);
  await panel.getByLabel('Password').fill('wrong-password');
  await panel.getByRole('button', { name: 'Sign in' }).click();
  await expect(panel.getByRole('alert')).toBeVisible();
  await panel.getByLabel('Password').fill(password);
  await panel.getByRole('button', { name: 'Sign in' }).click();
  await expect(panel.getByText('Test Person · Extension Prospects')).toBeVisible();

  const prospects = panel.getByRole('region', { name: 'Prospects at globex.test' });
  await expect(prospects).toBeVisible();
  await prospects.getByLabel('Job titles (optional)').fill('Head of Research');
  await prospects.getByRole('button', { name: 'Find prospects at globex.test' }).click();
  await expect(prospects.getByRole('note')).toContainText('Mock Mode');
  const found = prospects.getByRole('list', { name: 'Prospects found' }).getByRole('listitem');
  await expect(found).toHaveCount(12);
  await expect(found.first()).toContainText('Sample');
  await expect(found.first()).toContainText('Head of Research · Globex (sample)');
  const axe = await new AxeBuilder({ page: panel }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(axe.violations.map((v) => v.id)).toEqual([]);

  // Keep three people and save them to a new prospect list.
  for (let i = 3; i < 12; i++) await found.nth(i).getByRole('checkbox').uncheck();
  await prospects.getByLabel('Import to').selectOption('new');
  await prospects.getByLabel('New list name').fill('Globex research team');
  await prospects.getByRole('button', { name: 'Import 3' }).click();
  await expect(prospects.getByRole('status').filter({ hasText: 'Added 3 to Globex research team.' })).toBeVisible();
  await expect(prospects.getByRole('link', { name: 'Open Globex research team in DealFlow' })).toBeVisible();
  await expect(prospects.getByText(/Provider calls in the last 24 hours: 4 of 100/)).toBeVisible();

  // Sample people are refused by the CRM.
  await prospects.getByLabel('Import to').selectOption('crm');
  await prospects.getByRole('button', { name: 'Import 3' }).click();
  await expect(prospects.getByRole('status').filter({ hasText: 'Added 0 to the CRM as leads. 3 skipped.' })).toBeVisible();
  await expect(prospects.getByRole('list', { name: 'Import notes' })).toContainText('Sample data from Mock Mode cannot be added to the CRM.');

  await app.goto('/app/prospects');
  await app.getByRole('link', { name: 'Globex research team' }).click();
  await expect(app.getByRole('table', { name: 'Prospects in Globex research team' }).getByRole('row')).toHaveCount(4);
  await app.goto('/app/integrations');
  await expect(app.getByRole('list', { name: 'Extension connections' })).toContainText('Browser extension (Chrome)');
});
