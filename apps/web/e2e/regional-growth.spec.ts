import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { signUp } from './helpers';

test.use({ reducedMotion: 'reduce' });

const ORIGIN = { origin: 'http://localhost:3000' };

async function axe(page: Page) {
  await page.waitForLoadState('networkidle');
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(r.violations.map((v) => `${v.id} ${v.nodes[0]?.target} ${v.nodes[0]?.failureSummary}`)).toEqual([]);
}

async function chooseLanguage(page: Page, code: string) {
  await page.goto('/app/settings');
  await page.getByTestId('regional-settings').getByLabel('Language').selectOption(code);
  await page.getByTestId('regional-settings').getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', code);
}

test('German turns on gamification and sees points, the breakdown and leaderboard periods in German', async ({ page }) => {
  test.setTimeout(90_000);
  await signUp(page, 'Punkte Nord');
  const company = await page.request.post('/api/v1/companies', { data: { name: 'Acme' }, headers: ORIGIN });
  expect(company.ok()).toBe(true);
  const { id: companyId } = await company.json();
  for (let i = 0; i < 3; i++) {
    const res = await page.request.post('/api/v1/activities', { data: { type: 'CALL', subject: `Anruf ${i}`, companyId }, headers: ORIGIN });
    expect(res.ok()).toBe(true);
  }
  await chooseLanguage(page, 'de');

  await page.goto('/app/gamification');
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { level: 1, name: 'Vertriebs-Gamification' })).toBeVisible();
  await expect(main.getByText('Gamification ist für diesen Arbeitsbereich ausgeschaltet.')).toBeVisible();
  await expect(main.getByRole('tab', { name: 'Regeln und Einstellungen' })).toHaveAttribute('aria-selected', 'true');
  await axe(page);

  await main.getByLabel('Tageslimit für Anruf erfasst').fill('2');
  await main.getByLabel('Punkte, Bestenlisten, Abzeichen und Wettbewerbe einschalten').check();
  await main.getByRole('button', { name: 'Regeln speichern' }).click();
  await main.getByRole('tab', { name: 'Meine Leistung' }).click();

  // Three calls, two counted under the daily limit, five points each.
  await expect(page.getByTestId('my-points')).toHaveText('10');
  const breakdown = main.getByRole('table', { name: 'Punkte nach Aktivität diesen Monat' });
  await expect(breakdown.getByRole('row', { name: /Anruf erfasst 3 2 10/ })).toBeVisible();
  await axe(page);

  await main.getByRole('tab', { name: 'Bestenlisten' }).click();
  await expect(main.getByLabel('Zeitraum').locator('option').first()).toHaveText(/^Dieser Monat \(/);
  await expect(main.getByRole('table', { name: /Personen nach Punkten/ })).toBeVisible();
  await axe(page);
});

test('German builds a prospect list from a CSV file, with German counts and Mock Mode notice', async ({ page }) => {
  test.setTimeout(90_000);
  await signUp(page, 'Liste Süd');
  await chooseLanguage(page, 'de');

  await page.goto('/app/prospects');
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { level: 1, name: 'Interessentenlisten' })).toBeVisible();
  await expect(main.getByText('Testmodus', { exact: true })).toBeVisible();
  await expect(main.getByText('Noch keine Interessentenlisten.', { exact: false })).toBeVisible();
  await axe(page);

  await main.getByRole('button', { name: 'Neue Liste' }).click();
  await page.getByLabel('Listenname').fill('Spediteure');
  await page.getByRole('button', { name: 'Liste erstellen' }).click();
  await main.getByRole('link', { name: 'Spediteure' }).click();
  await expect(main.getByText('Diese Liste ist leer.', { exact: false })).toBeVisible();

  await main.getByRole('button', { name: 'CSV oder Excel importieren' }).click();
  const imp = page.getByRole('dialog', { name: 'CSV oder Excel importieren' });
  const csv = 'Name,Email,Company\nBen Ode,ben@carrier-two.test,Carrier Two\nCara Diaz,cara@shipfast.test,ShipFast\n';
  await imp.getByLabel('Datei').setInputFiles({ name: 'spediteure.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await expect(imp.getByText('spediteure.csv: 2 Zeilen.')).toBeVisible();
  await axe(page);
  await imp.getByRole('button', { name: '2 Zeilen importieren' }).click();
  await expect(page.getByRole('status').filter({ hasText: '2 Interessenten hinzugefügt.' })).toBeVisible();

  const table = main.getByRole('table', { name: 'Interessenten in Spediteure' });
  await expect(table.getByRole('row')).toHaveCount(3);
  await axe(page);
});

test('Arabic sets up website tracking and a lead form, right to left', async ({ page }) => {
  test.setTimeout(90_000);
  await signUp(page, 'Zuwar');
  await chooseLanguage(page, 'ar');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');

  await page.goto('/app/website-visitors');
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { level: 1, name: 'زوار الموقع' })).toBeVisible();
  await expect(main.getByText('تتبّع الموقع متوقف.')).toBeVisible();
  await expect(main.getByRole('tab', { name: 'التثبيت والإعدادات' })).toHaveAttribute('aria-selected', 'true');
  await expect(main.getByLabel('السؤال أولًا (موصى به).', { exact: false })).toBeChecked();
  await axe(page);

  await main.getByLabel('المواقع المسموح لها بإرسال البيانات').fill('shop.example.test');
  await main.getByLabel('تسجيل زيارات الموقع').check();
  await main.getByRole('button', { name: 'حفظ الإعدادات' }).click();
  await expect(main.getByText('تم الحفظ.')).toBeVisible();
  await expect(main.getByText('تتبّع الموقع متوقف.')).toBeHidden();
  await axe(page);

  await page.goto('/app/marketing');
  await expect(main.getByRole('heading', { level: 1, name: 'التسويق' })).toBeVisible();
  await main.getByRole('tab', { name: 'نماذج العملاء المحتملين' }).click();
  await expect(main.getByText('لا توجد نماذج عملاء محتملين بعد.')).toBeVisible();
  await main.getByRole('button', { name: 'نموذج عملاء محتملين جديد' }).click();
  await page.getByLabel('الاسم الداخلي').fill('طلب عرض');
  await page.getByLabel('العنوان الذي يراه الزوار').fill('احجز عرضًا');
  await axe(page);
  await page.getByRole('button', { name: 'إنشاء النموذج' }).click();
  await expect(main.getByRole('link', { name: 'فتح النموذج' })).toBeVisible();
  await expect(main.getByText('يطلب موافقة تسويقية')).toBeVisible();
  await axe(page);
});
