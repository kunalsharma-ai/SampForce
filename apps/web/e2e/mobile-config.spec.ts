import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { signUp } from './helpers';

/** Set PREVIEW_DIR to save screenshots of the new screens (used for previews). */
const PREVIEW_DIR = process.env.PREVIEW_DIR;
test.use({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 }, deviceScaleFactor: PREVIEW_DIR ? 2 : 1 });

const shot = async (page: Page, name: string) => {
  if (PREVIEW_DIR) await page.screenshot({ path: `${PREVIEW_DIR}/${name}.png`, fullPage: true });
};

async function expectNoA11yViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => `${n.target.join(' ')} ${n.failureSummary ?? ''}`).join(', ')}`)).toEqual([]);
}

/**
 * The Mobile Configuration Center (ADR 0072, M2), through the screens: the Super Workspace names the app, hides a
 * field from Executives, previews each level and publishes. What phones then receive is checked in the API tests.
 */
test('the Super Workspace configures the app, previews each level and publishes a version', async ({ page }) => {
  test.setTimeout(90_000);
  await signUp(page, `Config ${Date.now().toString(36)}`);
  await page.goto('/app/settings/mobile');
  await page.getByRole('link', { name: 'Open the Configuration Center' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Mobile configuration' })).toBeVisible();
  await expect(page.getByText('Not published yet: phones use the standard layout')).toBeVisible();

  // Step 1: name and colour, and switch off a module.
  await page.getByLabel('App name').fill('Field Force');
  await page.getByRole('textbox', { name: 'Main colour' }).fill('#E11D48');
  await page.getByRole('checkbox', { name: 'Sales reports' }).uncheck();
  await expect(page.getByText('Unsaved changes', { exact: true })).toBeVisible();
  await shot(page, '05-config-modules');
  await expectNoA11yViolations(page);

  // Step 2: Executives may not see a lead's website.
  await page.getByRole('button', { name: /Fields$/ }).click();
  await page.getByLabel('Module').selectOption('companies');
  await page.getByLabel('Workspace level').selectOption('EXECUTIVE');
  const website = page.getByRole('checkbox', { name: 'Website: View' });
  await expect(website).toBeChecked();
  await website.uncheck();
  await expect(page.getByRole('checkbox', { name: 'Website: Edit' })).not.toBeChecked();
  await shot(page, '06-config-fields');
  await expectNoA11yViolations(page);
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText('Saved, not published', { exact: true })).toBeVisible();

  // Steps 3 and 4 are there to change; the defaults stand.
  await page.getByRole('button', { name: /Workspace permissions$/ }).click();
  await expect(page.getByRole('table', { name: 'Workspace permissions' })).toBeVisible();
  await page.getByRole('button', { name: /Dashboard and navigation$/ }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard cards' })).toBeVisible();
  await shot(page, '07-config-dashboard');
  await expectNoA11yViolations(page);

  // Step 5: one phone per level, each with the new name.
  await page.getByRole('button', { name: /Preview$/ }).click();
  await expect(page.getByRole('figure')).toHaveCount(3);
  await expect(page.getByRole('figure').filter({ hasText: 'Executive Workspace' }).getByText('Field Force')).toBeVisible();
  await shot(page, '08-config-preview');
  await expectNoA11yViolations(page);

  // Step 6: publish with a note; the version list shows it as live.
  await page.getByRole('button', { name: /Publish$/ }).first().click();
  await page.getByLabel('What changed (optional)').fill('Website hidden from executives');
  await page.getByRole('button', { name: 'Publish to phones' }).click();
  await expect(page.getByText('Version 1 is live')).toBeVisible();
  await expect(page.getByRole('list', { name: 'Published versions' }).getByText('“Website hidden from executives”')).toBeVisible();
  await shot(page, '09-config-published');
  await expectNoA11yViolations(page);

  const center = await (await page.request.get('/api/v1/mobile-config')).json();
  expect(center.published.version).toBe(1);
  expect(center.draft.branding).toMatchObject({ appName: 'Field Force', primaryColor: '#E11D48' });
  expect(center.draft.modules.reports.enabled).toBe(false);
  expect(center.draft.fields.companies.website.EXECUTIVE).toEqual({ view: false, edit: false, create: false, delete: false });
});
