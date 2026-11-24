import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { signUp } from './helpers';

const ORIGIN = { origin: 'http://localhost:3000' };
/** Set PREVIEW_DIR to save screenshots of each screen (used for previews). */
const PREVIEW_DIR = process.env.PREVIEW_DIR;

test.use({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 }, deviceScaleFactor: PREVIEW_DIR ? 2 : 1 });

async function shot(page: Page, name: string) {
  if (!PREVIEW_DIR) return;
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${PREVIEW_DIR}/${name}.png` });
}

async function axe(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(r.violations.map((v) => `${v.id} ${v.nodes[0]?.target} ${v.nodes[0]?.failureSummary}`)).toEqual([]);
}

/**
 * Workspace redesign W5: the 6-step wizard (type, workspace, person, permissions, review, create). The email is
 * checked while it is typed: one that already holds a role in the organisation is refused with a clear sentence.
 */
test('creates an Executive Workspace with the wizard, refusing an email that already has a role', async ({ page }) => {
  test.setTimeout(150_000);
  await signUp(page, 'Wizard Traders');
  const managerEmail = `rahul.${Date.now()}@example.com`;
  const north = await page.request.post('/api/v1/workspaces', { data: { level: 'MANAGER', name: 'North India', person: { inviteEmail: managerEmail, name: 'Rahul Sharma' } }, headers: ORIGIN });
  expect(north.ok(), await north.text()).toBe(true);

  await page.goto('/app/settings/workspaces');
  await page.getByRole('button', { name: 'New Executive Workspace' }).click();
  const wizard = page.getByRole('dialog', { name: 'Create a workspace' });
  // Step 1: the type. The Super Workspace is never offered.
  await wizard.getByRole('button', { name: 'Back' }).click();
  await expect(wizard.getByText('What type of workspace do you want to create?')).toBeVisible();
  await expect(wizard.getByRole('radio')).toHaveCount(2);
  await expect(wizard.getByText('Super Workspace', { exact: true })).toHaveCount(0);
  await wizard.getByText('Executive Workspace', { exact: true }).click();
  await shot(page, '14-wizard-type');
  await axe(page);
  await wizard.getByRole('button', { name: 'Next' }).click();

  // Step 2: the workspace.
  await wizard.getByLabel('Workspace name').fill('Asha Field');
  await wizard.getByLabel('Department or team').fill('Field Sales');
  await wizard.getByLabel('Designation').fill('Senior Sales Executive');
  await wizard.getByLabel('Description').fill('Delhi NCR accounts');
  await wizard.getByLabel('Reports to').selectOption({ label: 'North India' });
  await shot(page, '15-wizard-workspace');
  await wizard.getByRole('button', { name: 'Next' }).click();

  // Step 3: the person. The manager's email is refused while it is typed.
  await wizard.getByLabel('Full name').fill('Asha Verma');
  await wizard.getByLabel('Work phone').fill('+91 98100 22334');
  await wizard.getByLabel('Work email').fill(managerEmail);
  await expect(wizard.getByText('This email already has a pending invitation to North India. Withdraw that invitation first.')).toBeVisible();
  await expect(wizard.getByRole('button', { name: 'Next' })).toBeDisabled();
  await shot(page, '16-wizard-email-taken');
  await axe(page);
  const ashaEmail = `asha.${Date.now()}@example.com`;
  await wizard.getByLabel('Work email').fill(ashaEmail);
  await expect(wizard.getByText('This email is free to use.')).toBeVisible();
  await wizard.getByRole('button', { name: 'Next' }).click();

  // Step 4: permissions start from North India's, with Delete off.
  await expect(wizard.getByRole('checkbox', { name: 'Edit in CRM' })).toBeChecked();
  await expect(wizard.getByRole('checkbox', { name: 'Delete in CRM' })).toHaveCount(0);
  await wizard.getByRole('checkbox', { name: 'Use Intelligence' }).uncheck();
  await shot(page, '17-wizard-permissions');
  await wizard.getByRole('button', { name: 'Next' }).click();

  // Step 5: review everything.
  const review = wizard.locator('[data-wizard-review]');
  await expect(review).toContainText('Asha Field');
  await expect(review).toContainText(`Asha Verma · ${ashaEmail} · +91 98100 22334`);
  await expect(review).toContainText('Senior Sales Executive');
  await expect(review).toContainText('North India');
  await expect(review.locator('[data-review-permissions]')).not.toContainText('Intelligence');
  await shot(page, '18-wizard-review');
  await axe(page);
  await wizard.getByRole('button', { name: 'Continue' }).click();

  // Step 6: nothing exists until Create workspace.
  await expect(wizard.locator('[data-wizard-confirm]')).toContainText('Create the Executive Workspace Asha Field?');
  let tree = await (await page.request.get('/api/v1/workspaces')).json();
  expect(tree.workspaces.map((w: { name: string }) => w.name)).not.toContain('Asha Field');
  await wizard.getByRole('button', { name: 'Create workspace' }).click();
  const done = page.getByRole('dialog', { name: 'Workspace created' });
  await expect(done.getByLabel('Invitation link')).toHaveValue(/\/invite\//);
  await shot(page, '19-wizard-created');
  await done.getByRole('button', { name: 'Done' }).click();

  const row = page.locator('[data-workspace="Asha Field"]');
  await expect(row).toContainText('Senior Sales Executive');
  tree = await (await page.request.get('/api/v1/workspaces')).json();
  const asha = tree.workspaces.find((w: { name: string }) => w.name === 'Asha Field');
  expect(asha).toMatchObject({ department: 'Field Sales', description: 'Delhi NCR accounts', pendingInvites: [ashaEmail] });
  expect(asha.actions.CRM).not.toContain('delete');
  expect(asha.actions.Intelligence ?? []).toEqual([]);
});
