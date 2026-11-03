import { execFileSync } from 'node:child_process';
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { signUp } from './helpers';

const databaseUrl = process.env.E2E_DATABASE_URL ?? 'postgresql://dealflow_app:dealflow_app_dev@localhost:5432/dealflow';

async function expectNoA11yViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

test('public landing and pricing pages are honest about the launch preview', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL('http://localhost:3000/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Close smarter');
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Pricing' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Pricing' })).toBeVisible();
  await expect(page.getByText('Launch pricing preview.')).toBeVisible();
  const growth = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: 'Growth' }) });
  await expect(growth.getByText('$12')).toBeVisible();
  await page.getByRole('radio', { name: 'Monthly' }).click();
  await expect(growth.getByText('$15')).toBeVisible();
  await expect(page.getByText('Quoted individually')).toBeVisible();
  await expectNoA11yViolations(page);
});

test('billing page, trial, onboarding checklist and a custom role', async ({ page }) => {
  await signUp(page, 'Billing Flow');
  const checklist = page.getByRole('heading', { name: 'Get your workspace ready' });
  await expect(checklist).toBeVisible();
  await expect(page.getByText('Create your first deal')).toBeVisible();

  await page.goto('/app/billing');
  await expect(page.getByRole('heading', { level: 1, name: 'Billing' })).toBeVisible();
  await expect(page.getByText('Plans are paid by bank transfer.')).toBeVisible();
  await expect(page.getByText('Proposed launch pricing')).toBeVisible();
  await expect(page.getByRole('progressbar', { name: 'Seats in use' })).toBeVisible();
  await expectNoA11yViolations(page);

  const pro = page.getByRole('listitem').filter({ hasText: 'Professional' });
  await pro.getByRole('button', { name: /Try free for 14 days/ }).click();
  await expect(page.getByText(/You are trying DealFlow Professional until/)).toBeVisible();
  await expect(page.getByRole('button', { name: /Try free/ })).toHaveCount(0);

  await page.goto('/app/team');
  await page.getByRole('button', { name: 'New custom role' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Deal desk');
  await page.getByRole('group', { name: 'Permissions' }).locator('label', { hasText: /^read$/ }).first().check();
  await page.getByRole('button', { name: 'Create role' }).click();
  await expect(page.getByRole('button', { name: 'Edit Deal desk' })).toBeVisible();
  await expectNoA11yViolations(page);

  await page.goto('/app');
  await page.getByRole('button', { name: 'Hide checklist' }).click();
  await expect(checklist).toHaveCount(0);
});

test('operator console: sign-in, workspace list, support access and an audited override', async ({ page, browser }) => {
  const email = `ops-${Date.now()}@platform.test`;
  execFileSync('node', ['-r', '@swc-node/register', 'scripts/create-operator.ts'], {
    cwd: '../api',
    env: { ...process.env, DATABASE_URL: databaseUrl, OPERATOR_EMAIL: email, OPERATOR_PASSWORD: 'operator-password-1', OPERATOR_NAME: 'E2E Operator', OPERATOR_ROLE: 'ADMIN' },
  });

  await signUp(page, 'Operated Workspace');
  await page.goto('/app/administration');
  await page.getByLabel('Reason').fill('Investigating an import problem');
  await page.getByRole('button', { name: 'Grant access' }).click();
  await expect(page.getByText(/On until/)).toBeVisible();

  const ops = await (await browser.newContext()).newPage();
  await ops.goto('/operator');
  await expect(ops).toHaveURL(/\/operator\/login/);
  await ops.getByLabel('Email').fill(email);
  await ops.getByLabel('Password').fill('operator-password-1');
  await ops.getByRole('button', { name: 'Sign in' }).click();
  await expect(ops.getByRole('heading', { level: 1, name: 'Workspaces' })).toBeVisible();
  await ops.getByLabel('Search workspaces').fill('Operated Workspace');
  await ops.getByRole('link', { name: 'Operated Workspace' }).first().click();
  await expect(ops.getByText('Granted by the workspace until')).toBeVisible();
  await expect(ops.getByText('Investigating an import problem').or(ops.getByText('support_access.granted'))).toBeVisible();
  await expectNoA11yViolations(ops);

  await ops.getByLabel('Plan').selectOption('business');
  await ops.getByLabel('Seats').fill('12');
  await ops.getByLabel('Reason (recorded in both audit logs)').fill('Annual order form signed');
  await ops.getByRole('button', { name: 'Apply' }).click();
  await expect(ops.getByText(/business · 12 seats · managed manually/)).toBeVisible();

  await ops.getByRole('link', { name: 'Operator log' }).click();
  await expect(ops.getByText('tenant.plan_overridden').first()).toBeVisible();

  await page.goto('/app/billing');
  await expect(page.getByText(/managed by the DealFlow team/).first()).toBeVisible();
});

test('pay by invoice: the workspace requests an invoice and the plan starts when an operator records the payment', async ({ page, browser }) => {
  test.setTimeout(60_000);
  const email = `ops-pay-${Date.now()}@platform.test`;
  const account = `Account: ${Date.now()}`;
  execFileSync('node', ['-r', '@swc-node/register', 'scripts/create-operator.ts'], {
    cwd: '../api',
    env: { ...process.env, DATABASE_URL: databaseUrl, OPERATOR_EMAIL: email, OPERATOR_PASSWORD: 'operator-password-1', OPERATOR_NAME: 'E2E Payments', OPERATOR_ROLE: 'ADMIN' },
  });
  const ops = await (await browser.newContext()).newPage();
  await ops.goto('/operator/login');
  await ops.getByLabel('Email').fill(email);
  await ops.getByLabel('Password').fill('operator-password-1');
  await ops.getByRole('button', { name: 'Sign in' }).click();
  await ops.getByRole('navigation', { name: 'Operator' }).getByRole('link', { name: 'Settings' }).click();
  await ops.getByLabel('Payment instructions').fill(`Bank: E2E Sample Bank\n${account}`);
  await ops.getByRole('button', { name: 'Save' }).click();
  await expect(ops.getByText('Saved. Open invoices now show this.')).toBeVisible();
  await expectNoA11yViolations(ops);

  const workspace = `Invoice Buyer ${Date.now()}`;
  await signUp(page, workspace);
  await page.goto('/app/billing');
  await page.getByRole('radio', { name: 'Monthly' }).click();
  await page.getByLabel('Seats', { exact: true }).fill('2');
  await page.getByRole('button', { name: 'Request invoice for Growth, $30.00' }).click();
  const invoice = page.locator('[aria-labelledby="open-invoice-heading"]');
  await expect(invoice.getByText('$30.00')).toBeVisible();
  await expect(invoice.getByText('Waiting for payment')).toBeVisible();
  await expect(invoice.getByText(account)).toBeVisible();
  const number = (await page.locator('#open-invoice-heading').textContent())!.match(/DF-\d{6}/)![0];
  await expectNoA11yViolations(page);

  await ops.getByRole('navigation', { name: 'Operator' }).getByRole('link', { name: 'Workspaces' }).click();
  await expect(ops.getByRole('heading', { name: /Waiting for payment/ })).toBeVisible();
  await ops.getByRole('listitem').filter({ hasText: number }).getByRole('link', { name: workspace }).click();
  await ops.getByLabel('Bank or transfer reference').fill('UTR-E2E-1');
  await ops.getByRole('button', { name: 'Mark paid' }).click();
  await expect(ops.getByText(/growth · 2 seats · paid by invoice/)).toBeVisible();
  await expect(ops.getByText('ref UTR-E2E-1')).toBeVisible();
  await expectNoA11yViolations(ops);

  await page.reload();
  await expect(page.getByText('Paid by invoice', { exact: true })).toBeVisible();
  await expect(page.getByText(/2 seats · monthly · paid until/)).toBeVisible();
  await expect(page.locator('#open-invoice-heading')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Request invoice for Growth/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Renew Growth, $30.00' })).toBeVisible();

  // Leave the shared development database as it was.
  await ops.getByRole('navigation', { name: 'Operator' }).getByRole('link', { name: 'Settings' }).click();
  await ops.getByLabel('Payment instructions').fill('');
  await ops.getByRole('button', { name: 'Save' }).click();
  await expect(ops.getByText(/Not set\. Open invoices say/)).toBeVisible();
});

test('operator providers page: masked keys, saving a key applies it without a restart, and connection tests', async ({ browser }) => {
  const email = `ops-prov-${Date.now()}@platform.test`;
  execFileSync('node', ['-r', '@swc-node/register', 'scripts/create-operator.ts'], {
    cwd: '../api',
    env: { ...process.env, DATABASE_URL: databaseUrl, OPERATOR_EMAIL: email, OPERATOR_PASSWORD: 'operator-password-1', OPERATOR_NAME: 'E2E Providers', OPERATOR_ROLE: 'ADMIN' },
  });
  const ops = await (await browser.newContext()).newPage();
  await ops.goto('/operator/login');
  await ops.getByLabel('Email').fill(email);
  await ops.getByLabel('Password').fill('operator-password-1');
  await ops.getByRole('button', { name: 'Sign in' }).click();
  await ops.getByRole('navigation', { name: 'Operator' }).getByRole('link', { name: 'Providers' }).click();
  await expect(ops.getByRole('heading', { level: 1, name: 'Providers' })).toBeVisible();
  // The e2e deployment has no Apollo key, so the card says so and the test cannot run.
  const apollo = ops.getByRole('region', { name: 'Apollo.io' });
  await expect(apollo.getByText('Not configured')).toBeVisible();
  await expect(apollo.getByRole('list', { name: 'Apollo.io keys' })).toContainText('APOLLO_API_KEYMissing');
  await expect(apollo.getByText('Mock Mode: labelled sample people')).toBeVisible();
  await expect(apollo.getByRole('button', { name: 'Test connection' })).toBeDisabled();
  // Anthropic points at a local stand-in here; the page shows where the key comes from and its last four characters only.
  const anthropic = ops.getByRole('region', { name: 'Anthropic (Claude)' });
  await expect(anthropic.getByRole('list')).toContainText('ANTHROPIC_API_KEYFrom deployment secrets · ends in real');
  await expect(ops.locator('body')).not.toContainText('test-key-not-real');
  await expectNoA11yViolations(ops);

  // Slack's keys come from the deployment. Replace the secret with a wrong one here: it is used at once.
  const slack = ops.getByRole('region', { name: 'Slack' });
  await expect(slack.getByRole('list', { name: 'Slack keys' })).toContainText('SLACK_CLIENT_SECRETFrom deployment secrets · ends in cret');
  await slack.getByRole('button', { name: 'Update keys' }).click();
  const form = slack.getByRole('form', { name: 'Edit Slack keys' });
  await form.getByLabel('Client secret SLACK_CLIENT_SECRET').fill('a-wrong-slack-secret-9z9z');
  await expectNoA11yViolations(ops);
  await form.getByRole('button', { name: 'Save keys' }).click();
  await expect(slack.getByText('Saved. The API and worker use the new keys within seconds, without a restart.')).toBeVisible();
  await expect(slack.getByRole('list', { name: 'Slack keys' })).toContainText(`SLACK_CLIENT_SECRETSaved here · ends in 9z9z`);
  await expect(slack.getByRole('list', { name: 'Slack keys' })).toContainText(`by ${email}`);
  await expect(ops.locator('body')).not.toContainText('a-wrong-slack-secret');
  await slack.getByRole('button', { name: 'Test connection' }).click();
  await expect(slack.getByText('Connection test failed')).toBeVisible();
  await expect(slack.getByText(/Slack refused the client ID or secret \(invalid_client_id\)/)).toBeVisible();

  // Remove the saved value: Slack falls back to the deployment's secret, and the test passes again.
  await slack.getByRole('button', { name: 'Update keys' }).click();
  await form.getByLabel(/Remove the saved value/).check();
  await form.getByRole('button', { name: 'Save keys' }).click();
  await expect(slack.getByRole('list', { name: 'Slack keys' })).toContainText('SLACK_CLIENT_SECRETFrom deployment secrets · ends in cret');
  await slack.getByRole('button', { name: 'Test connection' }).click();
  await expect(slack.getByText('Connection test passed')).toBeVisible();
  await expect(slack.getByText(/Slack accepted the client ID and secret/)).toBeVisible();

  // Every change is in the operator log, by fingerprint and last four characters only.
  await ops.getByRole('navigation', { name: 'Operator' }).getByRole('link', { name: 'Operator log' }).click();
  await expect(ops.getByText('provider_key.set').first()).toBeVisible();
  await expect(ops.getByText('provider_key.cleared').first()).toBeVisible();
  await expect(ops.locator('body')).not.toContainText('a-wrong-slack-secret');
});

test('operator console: setup guides with URLs to paste, checkout switches, and what stays on the server', async ({ browser }) => {
  const email = `ops-setup-${Date.now()}@platform.test`;
  execFileSync('node', ['-r', '@swc-node/register', 'scripts/create-operator.ts'], {
    cwd: '../api',
    env: { ...process.env, DATABASE_URL: databaseUrl, OPERATOR_EMAIL: email, OPERATOR_PASSWORD: 'operator-password-1', OPERATOR_NAME: 'E2E Setup', OPERATOR_ROLE: 'ADMIN' },
  });
  const ctx = await browser.newContext();
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  const ops = await ctx.newPage();
  await ops.goto('/operator/login');
  await ops.getByLabel('Email').fill(email);
  await ops.getByLabel('Password').fill('operator-password-1');
  await ops.getByRole('button', { name: 'Sign in' }).click();
  await ops.getByRole('navigation', { name: 'Operator' }).getByRole('link', { name: 'Providers' }).click();
  await expect(ops.getByRole('heading', { level: 1, name: 'Providers' })).toBeVisible();

  // The Slack guide: steps, a link to Slack's console, and the redirect URL to paste there, with a copy button.
  const slack = ops.getByRole('region', { name: 'Slack' });
  await slack.getByText('How to set up Slack').click();
  await expect(slack.getByRole('link', { name: 'Open Slack apps' })).toHaveAttribute('href', 'https://api.slack.com/apps');
  await expect(slack.getByText(/Bot Token Scopes: add chat:write/)).toBeVisible();
  const urls = slack.getByRole('list', { name: 'URLs to paste into Slack' });
  await expect(urls).toContainText('http://localhost:3000/api/v1/apps/slack/callback');
  await urls.getByRole('button', { name: 'Copy Redirect URL' }).click();
  await expect(urls.getByRole('button', { name: 'Copy Redirect URL' })).toHaveText('Copied');
  expect(await ops.evaluate(() => navigator.clipboard.readText())).toBe('http://localhost:3000/api/v1/apps/slack/callback');

  // Stripe sends signed webhooks: the card says none has arrived yet, and its guide has the endpoint URL.
  const stripe = ops.getByRole('region', { name: 'Stripe (subscription billing)' });
  await expect(stripe.getByLabel('Webhook status')).toContainText('No signed event received yet');
  await stripe.getByText('How to set up Stripe (subscription billing)').click();
  await expect(stripe.getByRole('list', { name: /URLs to paste/ })).toContainText('http://localhost:3000/api/v1/billing/webhooks/stripe');

  // The settings that used to need the server's environment: switched on and off here.
  const checkout = ops.getByRole('region', { name: 'Plans and online checkout' });
  await expect(checkout.getByText('Settings', { exact: true })).toBeVisible();
  await expect(checkout.getByRole('list', { name: 'Plans and online checkout keys' })).toContainText('ONLINE_PAYMENTS_ENABLEDDefault · Off');
  await expect(checkout.getByRole('button', { name: 'Test connection' })).toHaveCount(0);
  await checkout.getByRole('button', { name: 'Change settings' }).click();
  const form = checkout.getByRole('form', { name: 'Edit Plans and online checkout keys' });
  await form.getByLabel('Sales contact email SALES_CONTACT_EMAIL').fill('not-an-email');
  await form.getByLabel('Pricing published PRICING_PUBLISHED').selectOption('true');
  await form.getByRole('button', { name: 'Save settings' }).click();
  await expect(form.getByText(/Invalid email/i)).toBeVisible();
  await form.getByLabel('Sales contact email SALES_CONTACT_EMAIL').fill('');
  await expectNoA11yViolations(ops);
  await form.getByRole('button', { name: 'Save settings' }).click();
  await expect(checkout.getByText('Saved. The API and worker use the new settings within seconds, without a restart.')).toBeVisible();
  await expect(checkout.getByRole('list', { name: 'Plans and online checkout keys' })).toContainText('PRICING_PUBLISHEDSaved here · On');
  const pricing = await ops.request.get('/api/v1/public/pricing');
  expect((await pricing.json()).published).toBe(true);

  // What stays on the server, and why; secrets are never shown.
  const server = ops.getByRole('region', { name: 'Set once on the server' });
  await expect(server.getByRole('list', { name: 'Server settings' })).toContainText('PUBLIC_WEB_URLSet · http://localhost:3000');
  await expect(server).toContainText('Encrypts the keys saved in this console');
  await expect(ops.locator('body')).not.toContainText('dealflow_app_dev');
  await expectNoA11yViolations(ops);

  // Leave the shared development database as it was.
  await checkout.getByRole('button', { name: 'Change settings' }).click();
  await form.getByLabel(/Remove the saved value/).check();
  await form.getByRole('button', { name: 'Save settings' }).click();
  await expect(checkout.getByRole('list', { name: 'Plans and online checkout keys' })).toContainText('PRICING_PUBLISHEDDefault · Off');
});
