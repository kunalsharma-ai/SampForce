import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { signUp } from './helpers';

const ORIGIN = { origin: 'http://localhost:3000' };

async function seedLeads(page: Page) {
  for (const [fullName, status, companyName] of [
    ['Ada Byron', 'QUALIFIED', 'Analytical Ltd'],
    ['Ben Okafor', 'NEW', 'Okafor Freight'],
    ['Cy Tanaka', 'QUALIFIED', 'Tanaka Robotics'],
    ['Di Marsh', 'NEW', 'Marsh Foods'],
  ]) {
    const res = await page.request.post('/api/v1/leads', { data: { fullName, status, companyName }, headers: ORIGIN });
    expect(res.ok()).toBe(true);
  }
}

const table = (page: Page) => page.getByRole('table', { name: 'Leads' });
const names = (page: Page) => table(page).locator('tbody tr td:nth-child(2) a').allTextContents();

test('sorts by several columns, hides and moves columns, and highlights search matches', async ({ page }) => {
  await signUp(page, 'Table Org');
  await seedLeads(page);
  await page.goto('/app/leads');
  await expect(table(page).getByRole('link', { name: 'Ada Byron' })).toBeVisible();

  // Status ascending, then Name descending with Shift.
  await table(page).getByRole('button', { name: 'Status' }).click();
  await table(page).getByRole('button', { name: 'Name' }).click({ modifiers: ['Shift'] });
  await table(page).getByRole('button', { name: /Name/ }).click({ modifiers: ['Shift'] });
  await expect.poll(() => names(page)).toEqual(['Di Marsh', 'Ben Okafor', 'Cy Tanaka', 'Ada Byron']);
  await expect(table(page).getByRole('columnheader', { name: /Status/ })).toHaveAttribute('aria-sort', 'ascending');

  // Hide Email, move Company first among the data columns.
  await page.getByRole('button', { name: 'Columns' }).click();
  const dialog = page.getByRole('dialog', { name: 'Columns' });
  await dialog.getByRole('checkbox', { name: 'Email' }).uncheck();
  await dialog.getByRole('button', { name: 'Move Company left' }).click();
  await expect(dialog.getByRole('status')).toHaveText('Company moved left.');
  await dialog.getByRole('checkbox', { name: 'Updated' }).check();
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(table(page).getByRole('columnheader', { name: 'Email' })).toHaveCount(0);
  await expect(table(page).getByRole('columnheader').nth(1)).toHaveText(/Company/);
  await expect(table(page).getByRole('columnheader', { name: 'Updated' })).toBeVisible();

  // Search narrows the rows and marks the match.
  await page.getByLabel('Search leads').fill('tanaka');
  await expect(table(page).locator('tbody tr')).toHaveCount(1);
  await expect(table(page).locator('mark').first()).toHaveText(/tanaka/i);

  // Column width by keyboard.
  await page.getByLabel('Search leads').fill('');
  const handle = table(page).getByRole('separator', { name: 'Resize Status column' });
  const before = Number(await handle.getAttribute('aria-valuenow'));
  await handle.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowRight');
  await expect(handle).toHaveAttribute('aria-valuenow', String(before + 64));

  const a11y = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(a11y.violations.map((v) => `${v.id} ${v.nodes[0]?.target}`)).toEqual([]);
});

test('saved views keep the layout, can be shared, and reopen next time', async ({ page, browser }) => {
  await signUp(page, 'Views Org');
  await seedLeads(page);
  await page.goto('/app/leads');
  await page.getByLabel('Filter by status').selectOption('QUALIFIED');
  await expect(table(page).locator('tbody tr')).toHaveCount(2);
  await page.getByRole('button', { name: /^Row density/ }).click();
  await page.getByRole('menuitemradio', { name: 'Compact', exact: true }).click();
  await expect(page.locator('.df-table')).toHaveAttribute('data-density', 'compact');
  await expect(page.getByRole('button', { name: 'View: Default view (changed)' })).toBeVisible();

  await page.getByRole('button', { name: /^View:/ }).click();
  await page.getByRole('menuitem', { name: 'Save as new view…' }).click();
  await page.getByLabel('View name').fill('Qualified leads');
  await page.getByLabel('Share with everyone in this workspace').check();
  await page.getByRole('button', { name: 'Save view' }).click();
  await expect(page.getByRole('button', { name: 'View: Qualified leads' })).toBeVisible();

  // Back to the default view, then reload: the last used view reopens.
  await page.getByRole('button', { name: /^View:/ }).click();
  await page.getByRole('menuitemradio', { name: 'Default view' }).click();
  await expect(table(page).locator('tbody tr')).toHaveCount(4);
  await page.getByRole('button', { name: /^View:/ }).click();
  await page.getByRole('menuitemradio', { name: /Qualified leads/ }).click();
  await expect(table(page).locator('tbody tr')).toHaveCount(2);
  await page.reload();
  await expect(page.getByRole('button', { name: 'View: Qualified leads' })).toBeVisible();
  await expect(table(page).locator('tbody tr')).toHaveCount(2);
  await expect(page.getByLabel('Filter by status')).toHaveValue('QUALIFIED');

  // Saving changes back to the view.
  await page.getByLabel('Filter by status').selectOption('NEW');
  await page.getByRole('button', { name: 'View: Qualified leads (changed)' }).click();
  await page.getByRole('menuitem', { name: 'Discard changes' }).click();
  await expect(page.getByLabel('Filter by status')).toHaveValue('QUALIFIED');

  // A teammate sees the shared view but cannot change it.
  const inv = await page.request.post('/api/v1/tenants/current/invitations', { data: { email: `mate-${Date.now()}@example.com`, roleKey: 'member' }, headers: ORIGIN });
  const url = (await inv.json()).inviteUrl as string;
  const ctx = await browser.newContext();
  const p2 = await ctx.newPage();
  await p2.goto(url.replace(/^https?:\/\/[^/]+/, ''));
  await p2.getByLabel('Your name').fill('Mate Person');
  await p2.getByLabel('Choose a password').fill('a-long-password-1');
  await p2.getByRole('button', { name: 'Join Views Org' }).click();
  await expect(p2).toHaveURL(/\/app/);
  await p2.goto('/app/leads');
  await p2.getByRole('button', { name: /^View:/ }).click();
  await expect(p2.getByRole('menuitemradio', { name: /Qualified leads/ })).toBeVisible();
  await p2.getByRole('menuitemradio', { name: /Qualified leads/ }).click();
  await expect(p2.getByRole('table', { name: 'Leads' }).locator('tbody tr')).toHaveCount(2);
  await p2.getByRole('button', { name: /^View:/ }).click();
  await expect(p2.getByRole('menuitem', { name: /Delete/ })).toHaveCount(0);
  await ctx.close();
});

test('bulk actions assign, change status and delete selected rows', async ({ page }) => {
  await signUp(page, 'Bulk Org');
  await seedLeads(page);
  await page.goto('/app/leads');
  await expect(table(page).locator('tbody tr')).toHaveCount(4);

  await table(page).getByRole('checkbox', { name: 'Select Ada Byron' }).check();
  await table(page).getByRole('checkbox', { name: 'Select Ben Okafor' }).check();
  const bar = page.getByRole('region', { name: 'Bulk actions' });
  await expect(bar).toContainText('2 leads selected');
  await bar.getByLabel('Set status of selected').selectOption('CONTACTED');
  await expect(bar).toBeHidden();
  await expect(table(page).getByRole('row', { name: /Ada Byron/ })).toContainText('Contacted');
  await expect(table(page).getByRole('row', { name: /Ben Okafor/ })).toContainText('Contacted');

  await table(page).getByRole('checkbox', { name: 'Select all rows on this page' }).check();
  await expect(bar).toContainText('4 leads selected');
  await bar.getByLabel('Assign selected to').selectOption({ label: 'Test Person' });
  await expect(bar).toBeHidden();
  await expect(table(page).locator('tbody tr').first()).toContainText('Test Person');

  await table(page).getByRole('checkbox', { name: 'Select Di Marsh' }).check();
  await bar.getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('dialog', { name: 'Delete 1 lead?' }).getByRole('button', { name: 'Delete 1 lead' }).click();
  await expect(table(page).locator('tbody tr')).toHaveCount(3);
  await expect(table(page).getByRole('link', { name: 'Di Marsh' })).toHaveCount(0);

  await page.goto('/app/administration');
  await expect(page.getByRole('cell', { name: 'lead.deleted' })).toBeVisible();
});
