import { expect, type Page, test } from '@playwright/test';
import { signUp } from './helpers';

/** Set PREVIEW_DIR to save screenshots of each screen (used for previews). */
const PREVIEW_DIR = process.env.PREVIEW_DIR;
test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: PREVIEW_DIR ? 2 : 1, reducedMotion: 'reduce' });

async function shot(page: Page, name: string, fullPage = false) {
  if (!PREVIEW_DIR) return;
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${PREVIEW_DIR}/${name}.png`, fullPage });
}

/** "Lead" in English, and as the loan word the other languages used to keep ("los leads", "die Leads"). */
const LEAD = /\bleads?\b/i;

/** Whole page text, including the sidebar, headings and hidden-until-hover labels. */
async function leadWords(page: Page) {
  await page.waitForLoadState('networkidle');
  const text = await page.locator('body').evaluate((b) => `${(b as HTMLElement).innerText}\n${[...b.querySelectorAll('[aria-label],[title],[placeholder]')].map((e) => `${e.getAttribute('aria-label') ?? ''} ${e.getAttribute('title') ?? ''} ${e.getAttribute('placeholder') ?? ''}`).join('\n')}`);
  return text.split('\n').filter((line) => LEAD.test(line));
}

const PAGES = ['/app', '/app/companies', '/app/companies/new', '/app/leads', '/app/follow-ups', '/app/pipelines', '/app/reports', '/app/settings/crm', '/app/settings'];

/** ADR 0096: the word "Lead" never appears on screen; companies, inbound contacts and deals are named for what they are. */
test('no "Lead" anywhere on the main screens, in English, Spanish and Arabic', async ({ page }) => {
  test.setTimeout(240_000);
  await signUp(page, 'Wording Works');

  await page.goto('/app/companies');
  await expect(page.getByRole('link', { name: /Create new company/i }).first()).toBeVisible();
  await shot(page, '01-companies-create-new-company');

  await page.goto('/app/companies/new');
  await expect(page.getByLabel('Company name *')).toBeVisible();
  await shot(page, '02-new-company-form');

  await page.goto('/app/leads');
  await expect(page.getByRole('heading', { name: 'Inbound contacts', level: 1 })).toBeVisible();
  await shot(page, '03-inbound-contacts');

  await page.goto('/app/settings/crm');
  await shot(page, '04-crm-configuration-company-numbers');
  await page.getByText('Company statuses', { exact: true }).click();
  await expect(page.getByText('New Company').first()).toBeVisible();
  await shot(page, '04b-crm-configuration-new-company-status', true);

  await page.goto('/app');
  await shot(page, '05-dashboard');

  for (const path of PAGES) {
    await page.goto(path);
    expect(await leadWords(page), path).toEqual([]);
  }

  for (const [lang, inbound] of [['es', 'Contactos entrantes'], ['ar', 'جهات الاتصال الواردة']] as const) {
    await page.goto('/app/settings');
    await page.getByTestId('regional-settings').getByLabel(/Language|Idioma/).selectOption(lang);
    await page.getByTestId('regional-settings').getByRole('button', { name: /Save|Guardar/ }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', lang);
    await page.goto('/app/leads');
    await expect(page.getByRole('heading', { level: 1 })).toContainText(inbound);
    await shot(page, `06-inbound-contacts-${lang}`);
    await page.goto('/app/companies');
    await shot(page, `07-companies-${lang}`);
    for (const path of PAGES) {
      await page.goto(path);
      expect(await leadWords(page), `${lang} ${path}`).toEqual([]);
    }
    // Back to English for the next language's labels.
    await page.goto('/app/settings');
    await page.getByTestId('regional-settings').getByLabel(/Idioma|اللغة/).selectOption('en');
    await page.getByTestId('regional-settings').getByRole('button').filter({ hasText: /Guardar|حفظ/ }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  }
});
