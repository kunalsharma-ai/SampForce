import AxeBuilder from '@axe-core/playwright';
import { type Browser, expect, type Page, test } from '@playwright/test';
import { signUp } from './helpers';

const ORIGIN = { origin: 'http://localhost:3000' };
/** Set PREVIEW_DIR to save screenshots of each screen (used for previews). */
const PREVIEW_DIR = process.env.PREVIEW_DIR;
const CONTEXT = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: PREVIEW_DIR ? 2 : 1, reducedMotion: 'reduce' as const };

test.use(CONTEXT);

async function shot(page: Page, name: string) {
  if (!PREVIEW_DIR) return;
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${PREVIEW_DIR}/${name}.png` });
}

async function axe(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(r.violations.map((v) => `${v.id} ${v.nodes[0]?.target} ${v.nodes[0]?.failureSummary}`)).toEqual([]);
}

/** A workspace with a person who accepted the invitation, signed in on a page of their own. */
async function workspaceWithPerson(owner: Page, browser: Browser, input: { level: 'MANAGER' | 'EXECUTIVE'; name: string; parentId?: string }, person: string) {
  const ws = await (await owner.request.post('/api/v1/workspaces', { data: { ...input, person: { inviteEmail: `${person.split(' ')[0]!.toLowerCase()}.${Date.now()}@example.com` } }, headers: ORIGIN })).json();
  const page = await (await browser.newContext(CONTEXT)).newPage();
  const accepted = await page.request.post('/api/v1/auth/invitations/accept', { data: { token: (ws.inviteUrl as string).split('/invite/')[1], name: person, password: 'a-long-password-1' }, headers: ORIGIN });
  expect(accepted.ok(), await accepted.text()).toBe(true);
  return { id: ws.id as string, page };
}

/**
 * Workspace redesign W4: the Super Workspace deactivates a Manager Workspace (reason and password), its manager is
 * stopped until it is reactivated, then deletes it: the impact first, the receiving workspace, the typed name and
 * the password. Its records and its Executive Workspace go to the other team.
 */
test('deactivates, reactivates and deletes a Manager Workspace with a handover', async ({ page, browser }) => {
  test.setTimeout(180_000);
  await signUp(page, 'Lifecycle Traders', { autoConfirm: false });
  const north = await workspaceWithPerson(page, browser, { level: 'MANAGER', name: 'North Team' }, 'Rahul Sharma');
  const south = await workspaceWithPerson(page, browser, { level: 'MANAGER', name: 'South Team' }, 'Priya Nair');
  await workspaceWithPerson(page, browser, { level: 'EXECUTIVE', name: 'North Field One', parentId: north.id }, 'Asha Verma');
  for (const name of ['Ravi Menon', 'Meera Iyer']) await north.page.request.post('/api/v1/leads', { data: { fullName: name }, headers: ORIGIN });
  await north.page.request.post('/api/v1/companies', { data: { name: 'Coastal Foods Ltd' }, headers: ORIGIN });

  // Deactivate: a reason, then the password.
  await page.goto('/app/settings/workspaces');
  await page.getByRole('button', { name: 'Deactivate North Team' }).click();
  const form = page.getByRole('dialog', { name: 'Deactivate North Team' });
  await form.getByLabel('Reason').fill('Team on leave until March');
  await form.getByRole('button', { name: 'Continue' }).click();
  const confirm = page.getByRole('dialog', { name: 'Confirm deactivation' });
  await confirm.getByLabel('Password', { exact: true }).fill('correcthorse1');
  await confirm.getByRole('button', { name: 'Deactivate' }).click();
  const row = page.locator('[data-workspace="North Team"]');
  await expect(row.getByText('Deactivated', { exact: true })).toBeVisible();
  await expect(row.locator('[data-deactivation-reason]')).toHaveText('Deactivated: Team on leave until March');
  await shot(page, '09-workspace-deactivated');
  await axe(page);

  // The manager is stopped, with a reason they can act on.
  await north.page.goto('/app');
  await expect(north.page.getByText('Your workspace is deactivated')).toBeVisible();
  await shot(north.page, '10-manager-sees-deactivated');
  await page.getByRole('button', { name: 'Reactivate North Team' }).click();
  await expect(row.getByText('Deactivated', { exact: true })).toHaveCount(0);
  await north.page.reload();
  await expect(north.page.getByText('Your workspace is deactivated')).toHaveCount(0);

  // Delete: what it touches and who receives it, then the typed name and the password.
  await page.getByRole('button', { name: 'Delete North Team' }).click();
  const impact = page.getByRole('dialog', { name: 'Delete North Team' });
  await expect(impact.locator('[data-impact-people]')).toContainText('Rahul Sharma');
  await expect(impact.locator('[data-impact-records]')).toHaveText('1 companies, 0 contacts, 2 leads, 0 deals and 0 open tasks');
  await expect(impact.locator('[data-impact-below]')).toHaveText('North Field One');
  await impact.getByLabel('Who receives them').selectOption({ label: 'South Team · Manager Workspace · Priya Nair' });
  await expect(impact.getByText('Records go to Priya Nair.')).toBeVisible();
  await shot(page, '11-delete-workspace-impact');
  await axe(page);
  await impact.getByRole('button', { name: 'Continue' }).click();

  const typed = page.getByRole('dialog', { name: 'Confirm deletion' });
  await expect(typed).toContainText('North Team will be deleted and its records given to Priya Nair.');
  const submit = typed.getByRole('button', { name: 'Delete workspace' });
  await typed.getByLabel('Password', { exact: true }).fill('correcthorse1');
  await expect(submit).toBeDisabled();
  await typed.getByLabel('Type North Team to confirm').fill('North Team');
  await shot(page, '12-delete-workspace-typed-name');
  await submit.click();

  await expect(page.locator('[data-workspace-deleted]')).toHaveText('North Team was deleted. 3 records and 1 workspaces went to South Team.');
  await expect(page.locator('[data-workspace="North Team"]')).toHaveCount(0);
  // The executive now sits under South.
  await expect(page.locator('[data-workspace="South Team"] + ul [data-workspace="North Field One"]')).toBeVisible();
  await shot(page, '13-workspace-deleted-handover');

  // South's manager now has North's leads; North's manager is signed out of the organisation.
  const leads = await (await south.page.request.get('/api/v1/leads?q=Ravi')).json();
  expect(JSON.stringify(leads)).toContain('Ravi Menon');
  expect((await north.page.request.get('/api/v1/leads')).status()).toBe(401);
});
