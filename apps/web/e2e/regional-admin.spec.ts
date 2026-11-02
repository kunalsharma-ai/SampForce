import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { signUp } from './helpers';

test.use({ reducedMotion: 'reduce' });

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

test('German builds a workflow from a template in Automation Studio and sees its checks in German', async ({ page }) => {
  test.setTimeout(90_000);
  await signUp(page, 'Ablauf Nord');
  await chooseLanguage(page, 'de');

  await page.goto('/app/automation');
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { level: 1, name: 'Automatisierungsstudio' })).toBeVisible();
  await expect(main.getByText('Noch keine Workflows.', { exact: false })).toBeVisible();
  await axe(page);

  // A template opens with its German name, trigger and approval note.
  await main.getByRole('link', { name: 'Vorlage verwenden: Neue Kontakte begrüßen' }).click();
  await expect(main.getByLabel('Name', { exact: true })).toHaveValue('Neue Kontakte begrüßen');
  await expect(main.getByLabel('Auslöser').locator('option:checked')).toHaveText('Kontakt wird erstellt');
  await expect(main.getByText('Braucht bei jedem Lauf eine Genehmigung')).toBeVisible();
  await expect(main.getByRole('list', { name: 'Workflow-Schritte' })).toBeVisible();
  await axe(page);

  // Saving and activating show German statuses, and the list counts runs with a German plural.
  await main.getByRole('button', { name: 'Workflow erstellen' }).click();
  await expect(page).toHaveURL(/\/app\/automation\/[0-9a-f-]{36}$/);
  await expect(main.getByText('Entwurf', { exact: true })).toBeVisible();
  await main.getByRole('button', { name: 'Aktivieren' }).click();
  await expect(main.getByText('Aktiv', { exact: true })).toBeVisible();

  await page.goto('/app/automation');
  await expect(main.getByText(/0 Ausführungen in 30 Tagen/)).toBeVisible();
});

test('German team page shows roles, permissions and sales teams in German', async ({ page }) => {
  await signUp(page, 'Mannschaft');
  await chooseLanguage(page, 'de');
  await page.goto('/app/team');
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { level: 1, name: 'Teamverwaltung' })).toBeVisible();
  await expect(main.getByText('Vertriebsteams')).toBeVisible();
  await expect(main.getByText(/^1 Mitglied$/).first()).toBeVisible();
  await expect(main.getByText(/\d+ Berechtigungen/).first()).toBeVisible();
  await axe(page);

  await main.getByRole('button', { name: 'Neues Team' }).click();
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'Neues Team' })).toBeVisible();
  await axe(page);
});

test('Arabic creates an API key on the integrations page, right to left', async ({ page }) => {
  await signUp(page, 'Tikamul');
  await chooseLanguage(page, 'ar');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');

  await page.goto('/app/integrations');
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { level: 1, name: 'عمليات التكامل' })).toBeVisible();
  const keys = main.getByRole('region', { name: 'مفاتيح API' });
  await expect(keys.getByText('لا توجد مفاتيح API بعد.')).toBeVisible();
  await keys.getByLabel('اسم المفتاح').fill('مفتاح الاختبار');
  await keys.getByLabel('قراءة الصفقات').uncheck();
  await keys.getByRole('button', { name: 'إنشاء مفتاح' }).click();
  await expect(keys.getByLabel('مفتاحك الجديد. انسخه الآن: لن يُعرض مرة أخرى.')).toHaveValue(/^dfk_/);
  await expect(main.getByRole('heading', { name: 'عمليات التكامل المخططة' })).toBeVisible();
  await axe(page);

  await page.goto('/app/administration/security');
  await expect(main.getByRole('heading', { level: 1, name: 'أمان مساحة العمل' })).toBeVisible();
  await axe(page);
});
