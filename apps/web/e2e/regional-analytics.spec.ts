import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { signUp } from './helpers';

const ORIGIN = { origin: 'http://localhost:3000' };
const DAY = 86_400_000;
const ymd = (d: number) => new Date(Date.now() + d * DAY).toISOString().slice(0, 10);

test.use({ reducedMotion: 'reduce' });

async function apiCall(page: Page, method: 'post' | 'get', path: string, data?: object) {
  const res = await page.request[method](`/api/v1${path}`, { data, headers: ORIGIN });
  expect(res.ok(), `${method} ${path} → ${res.status()}`).toBe(true);
  return res.json();
}

async function axe(page: Page) {
  await page.waitForLoadState('networkidle');
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.getTiming().iterations === Infinity));
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(r.violations.map((v) => `${v.id} ${v.nodes[0]?.target} ${v.nodes[0]?.failureSummary}`)).toEqual([]);
}

async function chooseLanguage(page: Page, code: string) {
  await page.goto('/app/settings');
  await page.getByTestId('regional-settings').getByLabel('Language').selectOption(code);
  await page.getByTestId('regional-settings').getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', code);
}

async function seedPipeline(page: Page) {
  const stages = (await apiCall(page, 'get', '/pipelines'))[0].stages as { id: string; category: string }[];
  const open = stages.filter((s) => s.category === 'OPEN');
  const acme = await apiCall(page, 'post', '/companies', { name: 'Acme Forschung', country: 'DE' });
  const d1 = await apiCall(page, 'post', '/deals', { name: 'Markentracker', amount: 12000, companyId: acme.id, stageId: open[0]!.id, expectedCloseDate: ymd(20) });
  await apiCall(page, 'post', '/deals', { name: 'Panelpflege', amount: 3000, stageId: open[0]!.id });
  await apiCall(page, 'post', `/deals/${d1.id}/move`, { stageId: open[1]!.id });
}

test('German builds, filters and saves a report, pins it to a dashboard and reads the pipeline flow', async ({ page }) => {
  test.setTimeout(90_000);
  await signUp(page, 'Berichte Süd');
  await seedPipeline(page);
  await chooseLanguage(page, 'de');

  await page.goto('/app/reports');
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { name: 'Berichte & Analysen', level: 1 })).toBeVisible();
  await expect(main.getByText('Noch keine Berichte.')).toBeVisible();
  await axe(page);

  // A template opens in the editor with German options, a German chart description and a German match count.
  await main.getByRole('link', { name: 'Offene Pipeline nach Phase' }).click();
  await expect(main.getByLabel('Datensätze', { exact: true }).locator('option:checked')).toHaveText('Verkaufschancen');
  await expect(main.getByRole('img', { name: /^Balkendiagramm von .+ nach Phase, 2 Gruppen\./ })).toBeVisible();
  await expect(main.getByText('2 Verkaufschancen entsprechen')).toBeVisible();
  await main.getByRole('button', { name: 'Tabelle' }).click();
  await expect(main.getByRole('table').getByRole('row', { name: /Alle passenden Datensätze/ })).toBeVisible();
  await axe(page);

  await main.getByLabel('Wer es sehen kann').selectOption('WORKSPACE');
  await main.getByRole('button', { name: 'Bericht speichern' }).click();
  await expect(page).toHaveURL(/\/app\/reports\/[0-9a-f-]{36}$/);

  // A filter narrows the live preview; an empty value is refused in German.
  await main.getByRole('button', { name: 'Filter hinzufügen' }).click();
  await main.getByLabel('Feld von Filter 2').selectOption('name');
  await main.getByLabel('Bedingung von Filter 2').selectOption('contains');
  await expect(main.getByText('ist erforderlich').first()).toBeVisible();
  await main.getByLabel('Wert von Filter 2').fill('marken');
  await expect(main.getByText('1 Verkaufschance entspricht')).toBeVisible();

  // Dashboards: create one and add the saved report.
  await page.getByRole('navigation', { name: 'Berichte und Analysen' }).getByRole('link', { name: 'Dashboards' }).click();
  await main.getByLabel('Neues Dashboard').fill('Montagsrunde');
  await main.getByRole('button', { name: 'Erstellen', exact: true }).click();
  await expect(main.getByRole('heading', { name: 'Dashboard bearbeiten', level: 1 })).toBeVisible();
  await expect(main.getByText('Dieses Dashboard hat noch keine Widgets.')).toBeVisible();
  await axe(page);

  // The pipeline flow counts stage changes with German plurals.
  await page.goto('/app/reports/flow');
  await expect(main.getByText(/^1 Phasenwechsel in den letzten 90 Tagen\. Vorwärtsbewegungen/)).toBeVisible();
  await expect(main.getByRole('columnheader', { name: 'Median Tage' })).toBeVisible();
  await axe(page);
});

test('German shows the forecast with its target prompt and translated tiles', async ({ page }) => {
  await signUp(page, 'Prognose Nord');
  await seedPipeline(page);
  await chooseLanguage(page, 'de');

  await page.goto('/app/forecasting');
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { name: 'Prognosen', level: 1 })).toBeVisible();
  await expect(main.getByText(/^Kein Ziel für /)).toBeVisible();
  await axe(page);
});

test('Arabic filters customers by churn risk right to left and passes the accessibility check', async ({ page }) => {
  await signUp(page, 'نجاح');
  const customer = async (name: string, endInDays: number) => {
    const company = await apiCall(page, 'post', '/companies', { name });
    const contract = await apiCall(page, 'post', '/contracts', { name: `${name} plan`, companyId: company.id, value: 12000, startDate: ymd(-300), endDate: ymd(endInDays) });
    await apiCall(page, 'post', `/contracts/${contract.id}/sign`, { signedBy: 'X', signedAt: ymd(-300), method: 'wet_ink' });
    return company.id as string;
  };
  const risky = await customer('Globex', 20);
  await customer('Initrode', 300);
  await apiCall(page, 'post', '/success/escalations', { companyId: risky, title: 'Exports failing', severity: 'HIGH' });
  await chooseLanguage(page, 'ar');

  await page.goto('/app/customer-success');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { name: 'نجاح العملاء', level: 1 })).toBeVisible();
  await expect(main.getByRole('heading', { name: 'خطر الفقدان عبر الزمن' })).toBeVisible();
  await main.getByRole('group', { name: 'العملاء حسب خطر الفقدان' }).getByRole('button', { name: /خطر فقدان مرتفع/ }).click();
  await expect(main.getByText('عرض 1 من 2')).toBeVisible();
  const steps = main.getByRole('list', { name: 'خطوات الاحتفاظ المقترحة لـ Globex' });
  await expect(steps.getByText('الاتفاق على موعد لحل التصعيد المفتوح', { exact: false })).toBeVisible();
  await axe(page);
});
