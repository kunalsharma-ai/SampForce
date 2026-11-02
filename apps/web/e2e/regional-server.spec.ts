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
