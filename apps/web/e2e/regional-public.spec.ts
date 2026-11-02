import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { signUp } from './helpers';

test.use({ reducedMotion: 'reduce' });

const ORIGIN = { origin: 'http://localhost:3000' };
const post = async (page: Page, path: string, data: object) => (await page.request.post(`/api/v1${path}`, { data, headers: ORIGIN })).json();

async function axe(page: Page) {
  await page.waitForLoadState('networkidle');
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(r.violations.map((v) => `${v.id} ${v.nodes[0]?.target} ${v.nodes[0]?.failureSummary}`)).toEqual([]);
}

test('a German visitor sees the hosted lead form in German, from the browser language alone', async ({ page, browser }) => {
  test.setTimeout(90_000);
  await signUp(page, 'Formular Nord');
  await page.goto('/app/marketing');
  await page.getByRole('tab', { name: 'Lead forms' }).click();
  await page.getByRole('button', { name: 'New lead form' }).click();
  await page.getByLabel('Internal name').fill('Demo request');
  await page.getByLabel('Heading visitors see').fill('Demo buchen');
  await page.getByRole('button', { name: 'Create form' }).click();
  const href = (await page.getByRole('link', { name: 'Open form' }).getAttribute('href'))!;

  // A first visit from a German browser: nothing chosen, nothing stored.
  const ctx = await browser.newContext({ locale: 'de-DE', baseURL: 'http://localhost:3000' });
  const visitor = await ctx.newPage();
  await visitor.goto(href);
  await expect(visitor.locator('html')).toHaveAttribute('lang', 'de');
  await expect(visitor.getByRole('heading', { name: 'Demo buchen' })).toBeVisible();
  // Field labels still at their English defaults are shown in the visitor's language.
  await expect(visitor.getByLabel(/Vollständiger Name/)).toBeVisible();
  await expect(visitor.getByText('(optional)').first()).toBeVisible();
  await axe(visitor);

  // The API's validation message comes back in German too.
  await visitor.getByRole('button', { name: 'Absenden' }).click();
  await expect(visitor.locator('form').getByRole('alert')).toHaveText('Bitte prüfen Sie die markierten Felder.');
  await visitor.getByLabel(/Vollständiger Name/).fill('Vera Besucherin');
  await visitor.getByLabel(/Geschäftliche E-Mail/).fill('vera@besuch.test');
  await visitor.getByRole('button', { name: 'Absenden' }).click();
  await expect(visitor.getByRole('status')).toBeVisible();
  await ctx.close();
});

test('an Arabic customer opens the client portal right to left from their browser language', async ({ page, browser }) => {
  test.setTimeout(120_000);
  await signUp(page, 'Bawaba');
  const stage = (await (await page.request.get('/api/v1/pipelines')).json())[0].stages[0];
  const company = await post(page, '/companies', { name: 'Dune Logistics' });
  await post(page, '/contacts', { firstName: 'Layla', lastName: 'Haddad', email: 'layla@dune.test', companyId: company.id });
  await post(page, '/deals', { name: 'Dune rollout', amount: 5000, stageId: stage.id, companyId: company.id });
  const slug = `dune-${Math.random().toString(36).slice(2, 8)}`;

  await page.goto('/app/portal');
  await page.getByRole('button', { name: 'Set up the portal' }).click();
  await page.getByLabel('Portal is on').check();
  await page.getByLabel('Portal address').fill(slug);
  await page.getByLabel('Portal name').fill('Dune projects');
  await page.getByRole('button', { name: 'Save portal settings' }).click();
  await expect(page.getByText('Portal settings saved.')).toBeVisible();
  await page.goto(`/app/companies/${company.id}`);
  await page.getByRole('button', { name: 'Invite to portal' }).click();
  await page.getByLabel('Contact', { exact: true }).selectOption({ label: 'Layla Haddad (layla@dune.test)' });
  await page.getByRole('button', { name: 'Send invitation' }).click();
  const invite = await page.getByLabel('Invitation link').inputValue();

  const ctx = await browser.newContext({ locale: 'ar-SA', baseURL: 'http://localhost:3000' });
  const c = await ctx.newPage();
  await c.goto(invite);
  await expect(c.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(c.getByRole('heading', { name: 'اختر كلمة مرور لفتح بوابتك' })).toBeVisible();
  await axe(c);
  await c.getByLabel('كلمة المرور', { exact: true }).fill('dune-pass-1234');
  await c.getByLabel('تأكيد كلمة المرور').fill('dune-pass-1234');
  await c.getByRole('button', { name: 'فتح البوابة' }).click();
  await expect(c.getByText('Dune projects')).toBeVisible();
  await expect(c.getByRole('tab', { name: 'نظرة عامة' })).toBeVisible();
  await expect(c.getByRole('heading', { name: 'مشاريعك' })).toBeVisible();
  await expect(c.getByRole('progressbar', { name: 'تقدّم Dune rollout' })).toBeVisible();
  await axe(c);
  await ctx.close();
});

test('a French visitor reads the pricing page in French and can switch language', async ({ browser }) => {
  const ctx = await browser.newContext({ locale: 'fr-FR', baseURL: 'http://localhost:3000' });
  const page = await ctx.newPage();
  await page.goto('/pricing');
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
  await expect(page.getByRole('heading', { level: 1, name: 'Tarifs' })).toBeVisible();
  await expect(page.getByText(/^Prix en [A-Z]{3}, hors taxes\.$/)).toBeVisible();
  await axe(page);

  await page.getByRole('banner').getByRole('combobox').selectOption('de');
  await expect(page.locator('html')).toHaveAttribute('lang', 'de');
  await expect(page.getByRole('heading', { level: 1, name: 'Preise' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Fragen' })).toBeVisible();
  await ctx.close();
});
