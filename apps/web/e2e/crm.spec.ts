import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { signUp } from './helpers';

async function createViaDialog(page: Page, button: string, fields: Record<string, string>) {
  await page.getByRole('button', { name: button }).click();
  const dialog = page.getByRole('dialog');
  for (const [label, value] of Object.entries(fields)) await dialog.getByLabel(label, { exact: true }).fill(value);
  await dialog.getByRole('button', { name: /^Create / }).click();
  await expect(dialog).toBeHidden();
}

test('creates a company and a linked contact', async ({ page }) => {
  await signUp(page, 'CRM Flow');
  await page.goto('/app/companies');
  await expect(page.getByText('No companies yet.')).toBeVisible();
  await createViaDialog(page, 'New company', { 'Company name *': 'Initech', Domain: 'initech.test' });
  await expect(page.getByRole('heading', { level: 1, name: 'Initech' })).toBeVisible();

  await page.goto('/app/contacts');
  await page.getByRole('button', { name: 'New contact' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('First name *').fill('Peter');
  await dialog.getByLabel('Last name').fill('Gibbons');
  await dialog.getByLabel('Email').fill('not-an-email');
  await dialog.getByRole('button', { name: 'Create contact' }).click();
  await expect(dialog.getByText('Enter a valid email')).toBeVisible();
  await dialog.getByLabel('Email').fill('peter@initech.test');
  await dialog.getByRole('combobox', { name: 'Company' }).fill('Init');
  await dialog.getByRole('option', { name: /Initech/ }).click();
  await dialog.getByRole('button', { name: 'Create contact' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Peter Gibbons' })).toBeVisible();
  await page.waitForLoadState('networkidle');
  await page.getByRole('main').getByRole('link', { name: 'Initech', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/companies\//);
  await expect(page.getByRole('link', { name: 'Peter Gibbons' })).toBeVisible();
});

test('works a lead from capture to a won deal', async ({ page }) => {
  await signUp(page, 'Lead Flow');
  await page.goto('/app/leads');
  await createViaDialog(page, 'New lead', { 'Full name *': 'Joan Clarke', Email: 'joan@hut8.test', Company: 'Hut Eight', 'Estimated value': '24000' });
  await expect(page.getByRole('heading', { level: 1, name: /Joan Clarke/ })).toBeVisible();

  await page.getByLabel('Subject').fill('Intro call');
  await page.getByRole('button', { name: 'Log note' }).click();
  await expect(page.getByText('Intro call')).toBeVisible();
  await page.getByLabel('New task').fill('Send pricing');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByText('Send pricing')).toBeVisible();
  await page.getByLabel('Budget').check();
  await expect(page.getByText('1 of 4 criteria confirmed')).toBeVisible();

  await page.getByRole('button', { name: 'Convert' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Convert lead' }).click();
  await expect(page).toHaveURL(/\/app\/deals\//);
  await expect(page.getByRole('heading', { level: 1, name: /Hut Eight deal/ })).toBeVisible();
  await expect(page.getByText('$24,000').first()).toBeVisible();
  await expect(page.getByText('Intro call')).toBeVisible();

  const stages = page.getByRole('list', { name: 'Pipeline stages' });
  await stages.getByRole('button', { name: /Discovery/ }).click();
  await expect(stages.getByRole('button', { name: /Discovery/ })).toHaveAttribute('aria-current', 'step');
  await stages.getByRole('button', { name: /Closed Lost/ }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Chose a competitor').check();
  await dialog.getByRole('button', { name: 'Mark as lost' }).click();
  await expect(page.getByText('Chose a competitor')).toBeVisible();
  await stages.getByRole('button', { name: /Closed Won/ }).click();
  await expect(page.getByRole('heading', { level: 1 }).getByText('Won')).toBeVisible();

  await page.goto('/app/accounts');
  await expect(page.getByRole('link', { name: 'Hut Eight' })).toBeVisible();
});

test('moves a deal on the board with the keyboard', async ({ page }) => {
  await signUp(page, 'Board Flow');
  await page.goto('/app/deals');
  await createViaDialog(page, 'New deal', { 'Deal name *': 'Keyboard deal', Amount: '1500' });
  await page.goto('/app/deals');
  const firstCol = page.getByRole('list', { name: 'Deals in Qualification' });
  await expect(firstCol.getByRole('link', { name: 'Keyboard deal' })).toBeVisible();

  await page.getByRole('button', { name: 'Move Keyboard deal', exact: true }).focus();
  // Each step is confirmed through the screen-reader announcements.
  await page.keyboard.press('Space');
  await expect(page.getByText('Keyboard deal is over Qualification.')).toBeAttached();
  // dnd-kit binds its keyboard listeners a frame after activation; retry the move until it registers.
  await expect(async () => {
    await page.keyboard.press('ArrowRight');
    await expect(page.getByText('Keyboard deal is over Discovery.')).toBeAttached({ timeout: 1000 });
  }).toPass({ timeout: 8000 });
  await page.keyboard.press('Space');
  const second = page.getByRole('list', { name: 'Deals in Discovery' });
  await expect(second.getByRole('link', { name: 'Keyboard deal' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('list', { name: 'Deals in Discovery' }).getByRole('link', { name: 'Keyboard deal' })).toBeVisible();

  // The Move menu is the non-drag alternative.
  await page.getByRole('button', { name: 'Move Keyboard deal to another stage' }).click();
  await page.getByRole('menuitem', { name: 'Proposal' }).click();
  await expect(page.getByRole('list', { name: 'Deals in Proposal' }).getByRole('link', { name: 'Keyboard deal' })).toBeVisible();

  await page.getByRole('button', { name: 'List', exact: true }).click();
  await expect(page.getByRole('cell', { name: 'Proposal' })).toBeVisible();
});

test('detects and merges duplicate leads', async ({ page }) => {
  await signUp(page, 'Dupes');
  await page.goto('/app/leads');
  await createViaDialog(page, 'New lead', { 'Full name *': 'Ada King', Email: 'ada@engine.test' });
  await page.goto('/app/leads');
  await createViaDialog(page, 'New lead', { 'Full name *': 'Ada Lovelace', Email: 'ADA@engine.test', Phone: '+44 20 7946 0000' });
  await expect(page.getByText('Possible duplicates')).toBeVisible();
  await page.getByRole('button', { name: 'Merge into this lead' }).click();
  await expect(page.getByText('Possible duplicates')).toBeHidden();
  await page.goto('/app/leads');
  await expect(page.getByText('1–1 of 1')).toBeVisible();
});

test('imports leads from CSV after a check, and finds them in search', async ({ page }) => {
  await signUp(page, 'Importer');
  await page.goto('/app/settings/import?entity=leads');
  const csv = 'Name,Email,Company\nMargaret Hamilton,margaret@apollo.test,MIT\nBad Row,not-email,X\n';
  await page.getByLabel('CSV file').setInputFiles({ name: 'leads.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await expect(page.getByLabel('Field for column Name')).toHaveValue('fullName');
  await expect(page.getByLabel('Field for column Company')).toHaveValue('companyName');
  await page.getByRole('button', { name: 'Check file' }).click();
  await expect(page.getByText('1 ready to import')).toBeVisible();
  await expect(page.getByRole('cell', { name: 'email: Enter a valid email' })).toBeVisible();
  await page.getByRole('button', { name: 'Import 1 rows' }).click();
  await expect(page.getByText('Import complete')).toBeVisible();

  await page.keyboard.press('Control+k');
  await page.getByPlaceholder('Search leads, contacts, companies, deals or modules…').fill('hamilton');
  await page.getByRole('option', { name: /Margaret Hamilton/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: /Margaret Hamilton/ })).toBeVisible();
});

test('adds a custom field that appears on the lead form', async ({ page }) => {
  await signUp(page, 'Fields');
  await page.goto('/app/settings/custom-fields');
  await page.getByLabel('Label').fill('Region');
  await page.getByLabel('Type', { exact: true }).selectOption('SELECT');
  await page.getByLabel('Options').fill('EMEA, Americas, APAC');
  await page.getByRole('button', { name: 'Add field' }).click();
  await expect(page.getByText('region', { exact: true })).toBeVisible();
  await page.goto('/app/leads');
  await page.getByRole('button', { name: 'New lead' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Full name *').fill('Field Test');
  await dialog.getByLabel('Region').selectOption('APAC');
  await dialog.getByRole('button', { name: 'Create lead' }).click();
  await expect(page.getByText('APAC')).toBeVisible();
});

test('invites a teammate who joins with the link', async ({ page, browser }) => {
  await signUp(page, 'Team Flow');
  await page.goto('/app/team');
  const email = `newhire-${Date.now()}@example.com`;
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Create invitation' }).click();
  const link = await page.getByLabel('Invitation link').inputValue();
  expect(link).toMatch(/\/invite\//);

  const other = await browser.newContext();
  const invitee = await other.newPage();
  await invitee.goto(link.replace(/^https?:\/\/[^/]+/, ''));
  await expect(invitee.getByRole('heading', { name: 'Join Team Flow' })).toBeVisible();
  await invitee.getByLabel('Your name').fill('New Hire');
  await invitee.getByLabel('Choose a password').fill('a-long-password-1');
  await invitee.getByRole('button', { name: 'Join Team Flow' }).click();
  await expect(invitee).toHaveURL(/\/app/);
  await expect(invitee.getByRole('heading', { name: 'Welcome, New' })).toBeVisible();
  await other.close();

  await page.reload();
  await expect(page.getByRole('cell', { name: email }).first()).toBeVisible();
  await expect(page.getByText('Accepted')).toBeVisible();
});

test('record pages have no WCAG 2.2 A/AA violations', async ({ page }) => {
  await page.goto('/login');
  await page.evaluate(() => localStorage.setItem('dealflow:preferences', JSON.stringify({ state: { theme: 'light', motion: 'off' }, version: 0 })));
  await signUp(page, 'A11y CRM');
  await page.goto('/app/leads');
  await createViaDialog(page, 'New lead', { 'Full name *': 'Axe Lead', Company: 'Axe Co' });
  await page.waitForLoadState('networkidle');
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(r.violations, r.violations.map((v) => `${v.id} ${v.nodes[0]?.target}`).join(', ')).toEqual([]);
  await page.getByRole('button', { name: 'Convert' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Convert lead' }).click();
  await expect(page).toHaveURL(/\/app\/deals\//);
  await page.waitForLoadState('networkidle');
  const r2 = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(r2.violations, r2.violations.map((v) => `${v.id} ${v.nodes[0]?.target}`).join(', ')).toEqual([]);
  await page.goto('/app/deals');
  await page.waitForLoadState('networkidle');
  const r3 = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(r3.violations, r3.violations.map((v) => `${v.id} ${v.nodes[0]?.target}`).join(', ')).toEqual([]);
});
