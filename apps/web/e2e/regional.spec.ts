import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { signUp } from './helpers';

test.use({ reducedMotion: 'reduce' });

async function axe(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(r.violations.map((v) => `${v.id} ${v.nodes[0]?.target} ${v.nodes[0]?.failureSummary}`)).toEqual([]);
}

test('choosing German translates the shell, formats dates and numbers the German way, and follows the account', async ({ page, browser }) => {
  const { email, password } = await signUp(page, 'Sprache GmbH');
  await page.goto('/app/settings');
  const card = page.getByTestId('regional-settings');
  await expect(card.getByRole('heading', { name: 'Language & region' })).toBeVisible();
  await card.getByLabel('Language').selectOption('de');
  // The preview updates before saving.
  await expect(card.locator('[data-preview="number"]')).toHaveText('1.234.567,891');
  await expect(card.locator('[data-preview="relative"]')).toHaveText('vor 3 Tagen');
  await card.getByRole('button', { name: 'Save' }).click();

  // Saved: the page re-renders in German, and <html lang> follows.
  const saved = page.getByTestId('regional-settings');
  await expect(saved.getByRole('heading', { name: 'Sprache & Region' })).toBeVisible();
  await expect(saved.getByTestId('regional-status')).toHaveText('In Ihrem Konto gespeichert.');
  await expect(page.locator('html')).toHaveAttribute('lang', 'de');
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  await expect(page.getByRole('navigation', { name: 'Hauptmenü' }).getByRole('link', { name: 'Verkaufschancen' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Kontomenü' })).toBeVisible();

  // Formats: English text with UK dates.
  await saved.getByLabel('Sprache').selectOption('en');
  await saved.getByLabel('Formate').selectOption('en-GB');
  await expect(saved.locator('[data-preview="date"]')).toHaveText(/^Sunday,? 1 November 2026/);
  await saved.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByTestId('regional-settings').getByRole('heading', { name: 'Language & region' })).toBeVisible();

  // The setting is on the account: a fresh browser (no local cache) signs in and gets English with UK formats.
  const other = await browser.newContext();
  const p2 = await other.newPage();
  await p2.goto('/login');
  await p2.getByLabel('Work email').fill(email);
  await p2.getByLabel('Password', { exact: true }).fill(password);
  await p2.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(p2).toHaveURL(/\/app/);
  await p2.goto('/app/settings');
  await expect(p2.getByTestId('regional-settings').getByLabel('Formats')).toHaveValue('en-GB');
  await other.close();

  // Use defaults forgets the account setting.
  await page.getByTestId('regional-settings').getByRole('button', { name: 'Use defaults' }).click();
  await expect(page.getByTestId('regional-settings').getByLabel('Formats')).toHaveValue('');
});

test('Arabic mirrors the layout right to left and stays accessible', async ({ page }) => {
  await signUp(page, 'Arabic Layout');
  await page.goto('/app/settings');
  await page.getByTestId('regional-settings').getByLabel('Language').selectOption('ar');
  await expect(page.getByText('This language reads right to left, so the layout is mirrored.')).toBeVisible();
  await page.getByTestId('regional-settings').getByRole('button', { name: 'Save' }).click();

  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  await expect(page.getByTestId('regional-settings').getByRole('heading', { name: 'اللغة والمنطقة' })).toBeVisible();

  // The sidebar sits on the right edge in RTL.
  const sidebar = page.locator('[data-shell="sidebar"]');
  const box = await sidebar.boundingBox();
  const width = page.viewportSize()!.width;
  expect(box!.x + box!.width).toBeGreaterThan(width - 4);
  await expect(page.getByRole('navigation', { name: 'القائمة الرئيسية' }).getByRole('link', { name: 'الصفقات' })).toBeVisible();

  // A reload starts mirrored straight away (set before first paint from the device cache).
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await axe(page);
});

test('Spanish translates the Command Center and the lead workflow end to end', async ({ page }) => {
  await signUp(page, 'Ventas Iberia');
  await page.goto('/app/settings');
  await page.getByTestId('regional-settings').getByLabel('Language').selectOption('es');
  await page.getByTestId('regional-settings').getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'es');

  // Command Center: chrome, KPI names from the API and the onboarding checklist.
  await page.goto('/app');
  const main = page.getByRole('main');
  await expect(main.getByRole('button', { name: 'Personalizar diseño' })).toBeVisible();
  await expect(main.getByText('Leads totales')).toBeVisible();
  await expect(main.getByText('Prepara tu espacio de trabajo')).toBeVisible();

  // Leads list: header, column names and filters.
  await page.goto('/app/leads');
  await expect(main.getByRole('heading', { name: 'Leads', level: 1 })).toBeVisible();
  await expect(main.getByRole('columnheader', { name: 'Nombre' })).toBeVisible();
  await expect(main.getByLabel('Filtrar por estado')).toBeVisible();

  // Create a lead through the translated form; it is saved and opens in Spanish.
  await main.getByRole('button', { name: 'Nuevo lead' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Los campos marcados con * son obligatorios.')).toBeVisible();
  await dialog.getByLabel('Nombre completo *').fill('Lucía Fernández');
  await dialog.getByLabel('Empresa', { exact: true }).fill('Iberia Logística');
  await dialog.getByRole('button', { name: 'Crear lead' }).click();
  await expect(page).toHaveURL(/\/app\/leads\/[\w-]+$/);
  await expect(main.getByRole('heading', { name: 'Lucía Fernández' })).toBeVisible();
  await expect(main.getByText('Nuevo', { exact: true })).toBeVisible();
  await expect(main.getByRole('heading', { name: 'Detalles' })).toBeVisible();
  await expect(main.getByRole('button', { name: 'Convertir' })).toBeVisible();
  await axe(page);

  // Back on the list the new row shows its translated status, and the pager is in Spanish.
  await page.goto('/app/leads');
  await expect(main.getByRole('link', { name: 'Lucía Fernández' })).toBeVisible();
  await expect(main.getByText('1–1 de 1')).toBeVisible();
});

test('Arabic deals board stays accessible right to left', async ({ page }) => {
  await signUp(page, 'Arabic Deals');
  await page.goto('/app/settings');
  await page.getByTestId('regional-settings').getByLabel('Language').selectOption('ar');
  await page.getByTestId('regional-settings').getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await page.goto('/app/deals');
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { name: 'الصفقات', level: 1 })).toBeVisible();
  await expect(main.getByRole('group', { name: 'العرض' }).getByRole('button', { name: 'اللوحة' })).toBeVisible();
  await expect(main.getByRole('link', { name: 'صحة الصفقات' })).toBeVisible();
  await axe(page);
});

test('a language picked on the sign-up page carries over to the new account', async ({ page, browser }) => {
  await page.goto('/signup');
  await page.getByLabel('Language').selectOption('es');
  await expect(page.locator('html')).toHaveAttribute('lang', 'es');
  await expect(page.getByRole('heading', { name: 'Crea tu espacio de trabajo' })).toBeVisible();

  // Validation messages from the shared schema are translated too.
  await page.getByRole('button', { name: 'Empieza gratis' }).click();
  await expect(page.getByText('Introduce tu nombre')).toBeVisible();

  const email = `e2e-${Math.random().toString(36).slice(2, 10)}@example.com`;
  await page.getByLabel('Tu nombre').fill('Test Person');
  await page.getByLabel('Correo del trabajo').fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill('correcthorse1');
  await page.getByLabel('Nombre de la organización').fill('Idioma SL');
  await page.getByRole('button', { name: 'Empieza gratis' }).click();
  await expect(page).toHaveURL(/\/app/);
  await expect(page.getByRole('heading', { name: 'Hola, Test' })).toBeVisible();

  // The choice was saved to the account, so settings show it and the translated settings page passes axe.
  await page.goto('/app/settings');
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { name: 'Ajustes', level: 1 })).toBeVisible();
  await expect(main.getByText('Espacio de trabajo', { exact: true })).toBeVisible();
  await expect(main.getByRole('group', { name: 'Densidad de la interfaz' })).toBeVisible();
  await axe(page);

  // Activities in Spanish: add a task and complete it.
  await page.goto('/app/activities');
  await expect(main.getByRole('heading', { name: 'Actividades de venta', level: 1 })).toBeVisible();
  await main.getByLabel('Nueva tarea', { exact: true }).fill('Llamar a Lucía');
  await main.getByRole('button', { name: 'Añadir tarea' }).click();
  await main.getByRole('checkbox', { name: 'Completar Llamar a Lucía' }).click();
  // A completed task leaves the open list and shows under Done.
  await expect(main.getByRole('checkbox', { name: 'Completar Llamar a Lucía' })).toHaveCount(0);
  await main.getByLabel('Estado').selectOption('DONE');
  await expect(main.getByRole('checkbox', { name: 'Reabrir Llamar a Lucía' })).toBeChecked();
  await axe(page);

  // A fresh browser has no device cache: signing in brings the account's Spanish back.
  const other = await browser.newContext();
  const p2 = await other.newPage();
  await p2.goto('/login');
  await expect(p2.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await p2.getByLabel('Work email').fill(email);
  await p2.getByLabel('Password', { exact: true }).fill('correcthorse1');
  await p2.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(p2).toHaveURL(/\/app/);
  await expect(p2.locator('html')).toHaveAttribute('lang', 'es');
  await other.close();
});

test('the sign-in page in Arabic reads right to left and stays accessible', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Language').selectOption('ar');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('heading', { name: 'تسجيل الدخول' })).toBeVisible();
  await expect(page.getByLabel('البريد الإلكتروني للعمل')).toBeVisible();
  await axe(page);
});
