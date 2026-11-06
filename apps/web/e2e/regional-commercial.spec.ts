import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { signUp } from './helpers';

const ORIGIN = { origin: 'http://localhost:3000' };

test.use({ reducedMotion: 'reduce' });

async function apiCall(page: Page, method: 'post' | 'put' | 'get', path: string, data?: object) {
  const res = await page.request[method](`/api/v1${path}`, { data, headers: ORIGIN });
  expect(res.ok(), `${method} ${path} → ${res.status()}`).toBe(true);
  return res.status() === 204 ? null : res.json();
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

test('German translates the catalogue, the bid templates and the Quick Bid Studio, and saves a draft bid', async ({ page }) => {
  test.setTimeout(90_000);
  await signUp(page, 'Angebote Ost');
  const currency = (await apiCall(page, 'get', '/tenants/current')).defaultCurrency as string;
  const product = await apiCall(page, 'post', '/catalog/products', { name: 'Feldarbeit' });
  const book = await apiCall(page, 'post', '/catalog/price-books', { name: 'Liste', currency, isDefault: true });
  await apiCall(page, 'put', `/catalog/price-books/${book.id}/prices/${product.id}`, { unitPrice: 8 });
  const company = await apiCall(page, 'post', '/companies', { name: 'Nordwind' });
  await apiCall(page, 'post', '/deals', { name: 'Nordwind Nutzungsstudie', amount: 10_000, companyId: company.id });
  await chooseLanguage(page, 'de');

  // The quote list and the catalogue, with the price field named in German.
  await page.goto('/app/quotes');
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { name: 'Angebote & Vorschläge', level: 1 })).toBeVisible();
  await main.getByRole('tab', { name: 'Katalog & Preise' }).click();
  await expect(main.getByLabel('Preis von Feldarbeit in Liste')).toHaveValue('8');

  // The template gallery: categories, names and the example preview are German.
  await main.getByRole('link', { name: 'Angebotsvorlagen' }).click();
  await expect(main.getByRole('heading', { name: 'Angebotsvorlagen', level: 1 })).toBeVisible();
  await main.getByRole('group', { name: 'Kategorie' }).getByRole('button', { name: 'Forschung' }).click();
  await expect(main.getByRole('list', { name: 'Angebotsvorlagen' }).getByRole('listitem')).toHaveCount(2);
  await main.getByRole('button', { name: /Marktforschungsangebot/ }).click();
  await expect(main.getByRole('region', { name: 'Beispielvorschau von Marktforschungsangebot' })).toBeVisible();
  await axe(page);
  await main.getByRole('link', { name: 'Vorlage verwenden' }).click();

  // Step 1 refuses an empty deal in German, then creates the draft with a German default title.
  await expect(page).toHaveURL(/\/app\/quotes\/quick\?template=market-research-bid/);
  await expect(main.getByRole('button', { name: /Schritt 1 von 4: Kunde/ })).toHaveAttribute('aria-current', 'step');
  await main.getByRole('button', { name: 'Entwurf erstellen und fortfahren' }).click();
  await expect(main.getByText('Wählen Sie den Deal für dieses Angebot.')).toBeVisible();
  await main.getByLabel('Verkaufschance', { exact: true }).fill('Nordwind');
  await page.getByRole('option', { name: /Nordwind Nutzungsstudie/ }).click();
  await expect(main.getByLabel('Titel', { exact: true })).toHaveValue('Vorschlag für Nordwind Nutzungsstudie');
  await expect(main.getByLabel('Preisliste')).not.toHaveValue('');
  await main.getByRole('button', { name: 'Entwurf erstellen und fortfahren' }).click();

  // Step 2: an empty section heading is refused in German; fixing it saves the draft.
  await expect(page).toHaveURL(/quote=[0-9a-f-]{36}/);
  await main.getByLabel('Überschrift von Abschnitt 2').fill('');
  await expect(main.getByText('Geben Sie dem Abschnitt eine Überschrift.')).toBeVisible();
  await main.getByLabel('Überschrift von Abschnitt 2').fill('Vorgehen');
  await expect(main.getByText(/^Gespeichert um /)).toBeVisible();
  await axe(page);
});

test('German records a contract signature and shows it with its translated method', async ({ page }) => {
  await signUp(page, 'Verträge West');
  const company = await apiCall(page, 'post', '/companies', { name: 'Initech' });
  const today = new Date().toISOString().slice(0, 10);
  const end = new Date(Date.now() + 200 * 86_400_000).toISOString().slice(0, 10);
  const contract = await apiCall(page, 'post', '/contracts', { name: 'Supportvertrag', companyId: company.id, value: 2000, startDate: today, endDate: end });
  await chooseLanguage(page, 'de');

  await page.goto('/app/contracts');
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { name: 'Verträge', level: 1 })).toBeVisible();
  await expect(main.getByRole('row', { name: /Supportvertrag Initech Entwurf .+ bis / })).toBeVisible();
  await axe(page);

  await page.goto(`/app/contracts/${contract.id}`);
  await expect(main.getByRole('link', { name: 'Alle Verträge' })).toBeVisible();
  await main.getByLabel('Unterschrieben von').fill('Bill Lumbergh');
  await main.getByLabel('Wie').selectOption('email_confirmation');
  await main.getByRole('button', { name: 'Als unterschrieben markieren' }).click();
  await expect(main.getByText(/Bill Lumbergh am .+ \(Per E-Mail bestätigt\)/)).toBeVisible();
  await expect(main.getByText('Aktiv', { exact: true }).first()).toBeVisible();
  await axe(page);
});

test('Arabic shows billing and approvals right to left, starts a trial and passes the accessibility check', async ({ page }) => {
  await signUp(page, 'فوترة');
  await chooseLanguage(page, 'ar');

  await page.goto('/app/billing');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { name: 'الفوترة', level: 1 })).toBeVisible();
  await expect(main.getByText(/تُدفع الخطط بالتحويل المصرفي/)).toBeVisible();
  await expect(main.getByRole('progressbar', { name: 'المقاعد المستخدمة' })).toBeVisible();
  await axe(page);
  const pro = main.getByRole('listitem').filter({ hasText: 'Professional' });
  await pro.getByRole('button', { name: /جرّبه مجانًا لمدة/ }).click();
  await expect(main.getByText(/أنت تجرّب SampForce Professional حتى/)).toBeVisible();
  await expect(main.getByRole('button', { name: /جرّبه مجانًا/ })).toHaveCount(0);
  await axe(page);

  await page.goto('/app/approvals');
  await expect(main.getByRole('heading', { name: 'الموافقات', level: 1 })).toBeVisible();
  await expect(main.getByRole('tablist', { name: 'حالة الموافقة' })).toBeVisible();
  await expect(main.getByText('لا شيء بانتظار الموافقة.')).toBeVisible();
  await axe(page);
});
