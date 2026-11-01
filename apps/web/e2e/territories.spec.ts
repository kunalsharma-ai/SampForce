import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { signUp } from './helpers';

const ORIGIN = { origin: 'http://localhost:3000' };

test.use({ reducedMotion: 'reduce' });

async function axe(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(r.violations.map((v) => `${v.id} ${v.nodes[0]?.target} ${v.nodes[0]?.failureSummary}`)).toEqual([]);
}

async function post(page: Page, path: string, data: object) {
  const res = await page.request.post(`/api/v1${path}`, { data, headers: ORIGIN });
  expect(res.ok(), await res.text()).toBe(true);
  return res.json();
}

/** Companies in three countries with one open deal each, plus a deal with no company. */
async function seed(page: Page) {
  for (const [company, country, deal, amount] of [
    ['Berlin GmbH', 'DE', 'Berlin expansion', 50_000],
    ['Wien AG', 'AT', 'Vienna rollout', 12_000],
    ['Tokyo KK', 'JP', 'Tokyo study', 7_000],
  ] as const) {
    const c = await post(page, '/companies', { name: company, country });
    await post(page, '/deals', { name: deal, amount, companyId: c.id });
  }
  await post(page, '/deals', { name: 'Loose deal', amount: 1_000 });
}

test('territories group countries, and the Territory view shows pipeline for each', async ({ page }) => {
  await signUp(page, 'Territory Co');
  await seed(page);

  // Before any territory exists, the view says so and points administrators to settings.
  await page.goto('/app/deals?view=territory');
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { name: 'Pipeline by territory' })).toBeVisible();
  await expect(main.getByText('No territories yet. Territories group countries so you can see pipeline by region.')).toBeVisible();
  await expect(main.getByRole('heading', { name: 'Not in a territory' })).toBeVisible();

  // Define DACH in settings by picking countries from the searchable list.
  await main.getByRole('link', { name: 'Manage territories' }).click();
  await expect(page).toHaveURL(/\/app\/settings\/territories$/);
  await expect(main.getByRole('heading', { name: 'Territories', level: 1 })).toBeVisible();
  await main.getByLabel('Name').fill('DACH');
  const countries = main.getByLabel('Countries', { exact: true });
  // Picks a country from the list, then closes the list (it stays open for adding more).
  const pick = async (name: string) => {
    await countries.fill(name);
    await page.getByRole('option', { name: new RegExp(`^${name}`) }).click();
    await countries.press('Escape');
  };
  for (const name of ['Germany', 'Austria', 'Switzerland']) await pick(name);
  await expect(main.getByRole('button', { name: 'Remove country Switzerland' })).toBeVisible();
  await main.getByLabel('Manager').selectOption({ label: 'Test Person' });
  await main.getByRole('button', { name: 'Add territory' }).click();
  await expect(main.getByRole('status')).toHaveText('Added DACH.');
  const list = main.getByRole('list', { name: 'Your territories' });
  await expect(list.getByText('Austria, Germany, Switzerland')).toBeVisible();
  await expect(list.getByText('3 countries')).toBeVisible();

  // A country can be in one territory only; the server says which territory has it.
  await main.getByLabel('Name').fill('Europe');
  await pick('Germany');
  await main.getByRole('button', { name: 'Add territory' }).click();
  await expect(main.getByRole('alert')).toHaveText('DE already belongs to DACH. A country can be in one territory only.');
  await main.getByRole('button', { name: 'Remove country Germany' }).click();
  await countries.press('Escape');
  await main.getByLabel('Name').fill('Asia Pacific');
  await pick('Japan');
  await main.getByRole('button', { name: 'Add territory' }).click();
  await expect(main.getByRole('status')).toHaveText('Added Asia Pacific.');
  await axe(page);

  // The Territory view: DACH holds the German and Austrian deals, Asia Pacific the Japanese one.
  await main.getByRole('link', { name: 'Open the Territory view' }).click();
  await expect(main.getByRole('button', { name: 'Territory', pressed: true })).toBeVisible();
  const dach = main.getByRole('region', { name: 'DACH' });
  await expect(dach.getByText('Managed by Test Person')).toBeVisible();
  await expect(dach.getByRole('definition').first()).toHaveText('2');
  await expect(dach.getByRole('list', { name: 'Largest open deals in DACH' }).getByRole('link')).toHaveText(['Berlin expansion', 'Vienna rollout']);
  await expect(dach.getByText('$62,000', { exact: true }).first()).toBeVisible();
  const apac = main.getByRole('region', { name: 'Asia Pacific' });
  await expect(apac.getByRole('link', { name: 'Tokyo study' })).toBeVisible();
  const none = main.getByRole('region', { name: 'Not in a territory' });
  await expect(none.getByText('1 with no company')).toBeVisible();
  await expect(none.getByRole('link', { name: 'Loose deal' })).toBeVisible();
  await axe(page);

  // Opening a deal from a territory card uses the same side panel as every other view.
  await dach.getByRole('link', { name: 'Berlin expansion' }).click();
  await expect(page).toHaveURL(/deal=/);
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'Berlin expansion' })).toBeVisible();
  await page.keyboard.press('Escape');

  // Editing the territory moves deals: drop Austria and the Vienna deal becomes uncovered.
  await page.goto('/app/settings/territories');
  await main.getByRole('button', { name: 'Edit DACH' }).click();
  await main.getByRole('button', { name: 'Remove country Austria' }).click();
  await countries.press('Escape');
  await main.getByRole('button', { name: 'Save changes' }).click();
  await expect(main.getByRole('status')).toHaveText('Saved DACH.');
  await page.goto('/app/deals?view=territory');
  await expect(main.getByRole('region', { name: 'Not in a territory' }).getByText('Countries no territory covers: Austria (1)')).toBeVisible();
  await expect(main.getByRole('region', { name: 'DACH' }).getByRole('link')).toHaveText(['Berlin expansion']);
});
