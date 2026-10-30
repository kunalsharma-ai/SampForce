import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { signUp } from './helpers';

async function expectNoA11yViolations(page: Page) {
  await page.waitForLoadState('networkidle');
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

/** Creates records through the API with the signed-in session (same cookies, same CSRF origin check). */
async function seed(page: Page) {
  const post = async (path: string, data: object) => {
    const r = await page.request.post(`/api/v1${path}`, { data, headers: { origin: 'http://localhost:3000' } });
    expect(r.ok(), `${path}: ${await r.text()}`).toBe(true);
    return r.json();
  };
  const stages = (await (await page.request.get('/api/v1/pipelines')).json())[0].stages as { id: string; category: string }[];
  const open = stages.filter((s) => s.category === 'OPEN');
  const acme = await post('/companies', { name: 'Acme Research', country: 'DE' });
  await post('/contacts', { firstName: 'Ada', lastName: 'Lovelace', companyId: acme.id });
  const d1 = await post('/deals', { name: 'Brand tracker', amount: 12000, companyId: acme.id, stageId: open[0]!.id });
  await post('/deals', { name: 'Panel refresh', amount: 3000, stageId: open[0]!.id });
  await post(`/deals/${d1.id}/move`, { stageId: open[1]!.id });
}

async function setPreferences(page: Page, prefs: object) {
  await page.evaluate((p) => localStorage.setItem('dealflow:preferences', JSON.stringify({ state: { theme: 'dark', motion: 'off', ...p }, version: 0 })), prefs);
}

test('build a report from a template, save it and pin it to a dashboard', async ({ page }) => {
  await signUp(page, 'Reports Flow');
  await seed(page);
  await page.goto('/app/reports');
  await expect(page.getByRole('heading', { level: 1, name: 'Reports & Analytics' })).toBeVisible();
  await expect(page.getByText('No reports yet.')).toBeVisible();
  await expectNoA11yViolations(page);

  await page.getByRole('link', { name: 'Open pipeline by stage' }).click();
  await expect(page.getByRole('img', { name: /Bar chart of total amount by stage/ })).toBeVisible();
  await expect(page.getByText('2 deals match')).toBeVisible();
  await page.getByRole('button', { name: 'Table' }).click();
  const table = page.getByRole('table');
  await expect(table.getByRole('row', { name: /All matching records/ })).toContainText('$15,000');
  await expectNoA11yViolations(page);

  await page.getByLabel('Who can see it').selectOption('WORKSPACE');
  await page.getByRole('button', { name: 'Save report' }).click();
  await expect(page).toHaveURL(/\/app\/reports\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Open pipeline by stage' })).toBeVisible();

  // A filter narrows the live preview.
  await page.getByRole('button', { name: 'Add filter' }).click();
  await page.getByLabel('Filter 2 field').selectOption('name');
  await page.getByLabel('Filter 2 condition').selectOption('contains');
  await page.getByLabel('Filter 2 value').fill('brand');
  await expect(page.getByText('1 deal matches')).toBeVisible();

  await page.getByRole('navigation', { name: 'Reports and analytics' }).getByRole('link', { name: 'Dashboards' }).click();
  await page.getByLabel('New dashboard').fill('Monday review');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Edit dashboard' })).toBeVisible();
  await page.getByLabel('Add a saved report').selectOption({ label: 'Open pipeline by stage' });
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('button', { name: 'Save dashboard' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Monday review' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open pipeline by stage' })).toBeVisible();
  await expect(page.getByRole('img', { name: /Bar chart/ })).toBeVisible();
  await expectNoA11yViolations(page);
});

test('immersive views fall back to accessible 2D in low-power mode', async ({ page }) => {
  await signUp(page, 'Immersive Flow');
  await seed(page);
  await setPreferences(page, { lowPower: true });

  await page.goto('/app/reports/galaxy');
  await expect(page.getByText(/Low-power mode is on/)).toBeVisible();
  await expect(page.locator('canvas')).toHaveCount(0);
  await page.getByRole('button', { name: 'Acme Research' }).click();
  await expect(page.getByText('Connected (2)')).toBeVisible();
  await page.getByLabel('Search the galaxy').fill('nothing like this');
  await expect(page.getByText(/Nothing matches/)).toBeVisible();
  await expectNoA11yViolations(page);

  await page.goto('/app/reports/globe');
  await expect(page.getByText(/Low-power mode is on/)).toBeVisible();
  await expect(page.getByRole('row', { name: /Germany/ })).toContainText('$12,000');
  await expect(page.getByText(/Not on the map: 0 companies without a country and 1 open deal/)).toBeVisible();
  await expectNoA11yViolations(page);

  await page.goto('/app/reports/flow');
  await expect(page.getByRole('img', { name: /Pipeline flow diagram/ })).toBeVisible();
  await expect(page.getByText('1 stage change in the last 90 days.', { exact: false })).toBeVisible();
  await expectNoA11yViolations(page);

  await page.goto('/app/reports/replay');
  const slider = page.getByLabel('Replay date');
  await slider.focus();
  await page.keyboard.press('End');
  await expect(page.getByText(/2 open deals worth \$15,000/)).toBeVisible();
  await page.keyboard.press('Home');
  await expect(page.getByText(/0 open deals/)).toBeVisible();
  await expectNoA11yViolations(page);
});

test('3D views render a canvas where WebGL exists, and switch to 2D on request', async ({ page }) => {
  await signUp(page, 'Galaxy 3D');
  await seed(page);
  await setPreferences(page, { lowPower: false });
  await page.goto('/app/reports/galaxy');
  const noWebgl = page.getByText(/cannot draw 3D graphics/);
  const canvas = page.locator('canvas');
  await expect(noWebgl.or(canvas)).toBeVisible();
  if (await canvas.isVisible()) {
    await expect(page.getByRole('img', { name: /^Relationship Galaxy: 1 company with/ })).toBeVisible();
    await page.getByRole('radio', { name: '2D' }).click();
    await expect(canvas).toHaveCount(0);
    await expect(page.getByText(/graphics context was lost/)).toHaveCount(0);
  }
  await expect(page.getByRole('img', { name: /Relationship network in 2D/ })).toBeVisible();
});
