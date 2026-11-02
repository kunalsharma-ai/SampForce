import { expect, test } from '@playwright/test';
import { signUp } from './helpers';

test.use({ reducedMotion: 'reduce' });

/** ADR 0052: the API writes its messages in the interface language the web app sends with every request. */
test('the API’s own messages follow the language chosen on the sign-in page', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Language').selectOption('ar');
  await expect(page.getByRole('heading', { name: 'تسجيل الدخول' })).toBeVisible();
  await page.getByLabel('البريد الإلكتروني للعمل').fill('nobody-here@example.com');
  await page.getByLabel('كلمة المرور', { exact: true }).fill('not-a-real-password-1');
  await page.getByRole('button', { name: 'تسجيل الدخول', exact: true }).click();
  await expect(page.getByText('البريد الإلكتروني أو كلمة المرور غير صحيحة.')).toBeVisible();
});

test('a first visit in a French browser gets French messages from the API', async ({ browser }) => {
  const context = await browser.newContext({ locale: 'fr-FR' });
  const page = await context.newPage();
  await page.goto('/login');
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
  await page.getByLabel('E-mail professionnel').fill('nobody-here@example.com');
  await page.getByLabel('Mot de passe', { exact: true }).fill('not-a-real-password-1');
  await page.getByRole('button', { name: 'Se connecter', exact: true }).click();
  await expect(page.getByText('L’e-mail ou le mot de passe est incorrect.')).toBeVisible();
  await context.close();
});

test('a conflict reported by the API appears in German in a German workspace', async ({ page }) => {
  await signUp(page, 'Fehler GmbH');
  await page.goto('/app/settings');
  const card = page.getByTestId('regional-settings');
  await card.getByLabel('Language').selectOption('de');
  await card.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'de');

  // A new workspace is on the Free plan, which holds one pipeline: the API refuses a second one, in German.
  await page.goto('/app/pipelines');
  const main = page.getByRole('main');
  await main.getByRole('button', { name: 'Neue Pipeline' }).click();
  await main.getByPlaceholder('Pipeline-Name').last().fill('Zweite Pipeline');
  await main.getByRole('button', { name: 'Pipeline erstellen' }).click();
  await expect(main.getByText('Ihr Tarif erlaubt 1 Pipeline. Erweitern Sie ihn, um weitere hinzuzufügen.')).toBeVisible();
});

test('sentences the API writes and the notifications menu switch language with the person', async ({ page }) => {
  await signUp(page, 'Frases SL');
  await page.goto('/app');
  // The insights feed always counts new deals; in English first.
  await expect(page.getByText('0 new deals worth', { exact: false })).toBeVisible();

  await page.goto('/app/settings');
  const card = page.getByTestId('regional-settings');
  await card.getByLabel('Language').selectOption('es');
  await card.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'es');

  await page.goto('/app');
  // Written by the API in Spanish (ADR 0052), not translated by the page.
  await expect(page.getByText(/^0 oportunidades nuevas por /)).toBeVisible();
  await page.getByRole('button', { name: 'Notificaciones', exact: true }).click();
  await expect(page.getByText('Estás al día. Las asignaciones, aprobaciones y alertas de automatización aparecen aquí.')).toBeVisible();
});

test('tab titles and new email designs start in the person’s language', async ({ page }) => {
  await signUp(page, 'Diseño SL');
  await page.goto('/app/deals');
  await expect(page).toHaveTitle(/^Deals · /);

  await page.goto('/app/settings');
  const card = page.getByTestId('regional-settings');
  await card.getByLabel('Language').selectOption('es');
  await card.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'es');

  await page.goto('/app/deals');
  await expect(page).toHaveTitle(/^Oportunidades · /);

  // A new design starts with Spanish starter text; merge fields stay as they are.
  await page.goto('/app/sequences');
  await page.getByRole('tab', { name: 'Plantillas' }).click();
  await page.getByRole('button', { name: 'Nueva plantilla' }).click();
  await page.getByRole('button', { name: 'Diseñada', exact: true }).click();
  const outline = page.getByRole('list', { name: 'Bloques del correo' });
  await expect(outline).toContainText('Hola, {{first_name|equipo}}: Escribe tu mensaje aquí.');
  await expect(outline).toContainText('Reservar una llamada');
});
