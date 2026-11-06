import AxeBuilder from '@axe-core/playwright';
import { expect, type Locator, type Page, test } from '@playwright/test';
import { signUp } from './helpers';

test.use({ reducedMotion: 'reduce' });

async function axe(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(r.violations.map((v) => `${v.id} ${v.nodes[0]?.target} ${v.nodes[0]?.failureSummary}`)).toEqual([]);
}

/** The "i" button for a help topic. Every button is named "What is this?" and described as "About <feature>". */
function infoButton(scope: Page | Locator, topic: string) {
  return scope.locator(`[data-help-topic="${topic}"]`);
}

test('every page title has an i button that explains the page, by mouse and by keyboard', async ({ page }) => {
  await signUp(page, 'Help Buttons');

  // Pages with a PageHeader and pages that draw their own title all get the button.
  for (const [path, topic, title] of [
    ['/app', 'page.commandCenter', 'Command Center'],
    ['/app/leads', 'page.leads', 'Leads'],
    ['/app/deals', 'page.deals', 'Deals'],
    ['/app/quotes', 'page.quotes', 'Quotes & Proposals'],
    ['/app/reports', 'page.reports', 'Reports & Analytics'],
    ['/app/settings', 'page.settings', 'Settings'],
    ['/app/marketplace', 'page.marketplace', 'Marketplace'],
  ] as const) {
    await page.goto(path);
    const button = infoButton(page.locator('main'), topic);
    await expect(button).toBeVisible();
    await expect(button).toHaveAccessibleName('What is this?');
    await expect(button).toHaveAccessibleDescription(`About ${title}`);
  }

  // Mouse: the popover says what the page is for, how to use it and where to use it.
  await page.goto('/app/deals');
  const main = page.locator('main');
  const button = infoButton(main, 'page.deals');
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  await button.click();
  const tip = page.getByRole('dialog', { name: 'Deals' });
  await expect(tip).toBeVisible();
  await expect(button).toHaveAttribute('aria-expanded', 'true');
  await expect(tip.getByText('What it is for')).toBeVisible();
  await expect(tip.getByText('How to use it')).toBeVisible();
  await expect(tip.getByText('Where to use it')).toBeVisible();
  await expect(tip).toContainText('Deals are sales opportunities with a value, a stage and a close date.');
  await axe(page);

  // Escape closes it and gives focus back to the button.
  await page.keyboard.press('Escape');
  await expect(tip).toBeHidden();
  await expect(button).toBeFocused();

  // Keyboard: Enter opens, focus moves into the popover, Escape returns.
  await page.keyboard.press('Enter');
  await expect(tip).toBeVisible();
  await expect(tip).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(button).toBeFocused();

  // A click outside closes it.
  await button.click();
  await expect(tip).toBeVisible();
  await page.mouse.click(5, 300);
  await expect(tip).toBeHidden();
});

test('section headings have their own i buttons, and a record page explains itself', async ({ page }) => {
  await signUp(page, 'Help Sections');
  await page.goto('/app/billing');
  await infoButton(page, 'billing.usage').click();
  await expect(page.getByRole('dialog', { name: 'Usage this month' })).toContainText('How much of each allowance you have used');
  await page.keyboard.press('Escape');

  // The heading's accessible name stays the heading text: the button sits next to it, not inside it.
  await expect(page.getByRole('heading', { name: 'Usage this month', exact: true })).toBeVisible();

  // A lead record: the page button picks the record topic from the route.
  await page.goto('/app/leads');
  await page.getByRole('button', { name: 'New lead' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Full name *', { exact: true }).fill('Ada Lovelace');
  await dialog.getByRole('button', { name: 'Create lead' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Ada Lovelace' })).toBeVisible();
  await infoButton(page.locator('main'), 'page.leadRecord').click();
  await expect(page.getByRole('dialog', { name: 'Lead' })).toContainText('One lead’s full record');
  await page.keyboard.press('Escape');
  await infoButton(page, 'lead.qualification').click();
  await expect(page.getByRole('dialog', { name: 'Qualification' })).toContainText('BANT or MEDDICC');
});

test('help text follows the language, including Arabic right to left', async ({ page }) => {
  await signUp(page, 'Help Languages');
  await page.goto('/app/settings');
  await page.getByTestId('regional-settings').getByLabel('Language').selectOption('es');
  await page.getByTestId('regional-settings').getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'es');

  await page.goto('/app/deals');
  const esButton = infoButton(page.locator('main'), 'page.deals');
  await expect(esButton).toHaveAccessibleName('¿Qué es esto?');
  await expect(esButton).toHaveAccessibleDescription('Acerca de Oportunidades');
  await esButton.click();
  const es = page.getByRole('dialog', { name: 'Oportunidades' });
  await expect(es.getByText('Para qué sirve')).toBeVisible();
  await expect(es).toContainText('Las oportunidades son ventas posibles con un valor, una etapa y una fecha de cierre.');
  await page.keyboard.press('Escape');

  await page.goto('/app/settings');
  await page.getByTestId('regional-settings').getByLabel('Idioma').selectOption('ar');
  await page.getByTestId('regional-settings').getByRole('button', { name: 'Guardar' }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await page.goto('/app/deals');
  await infoButton(page.locator('main'), 'page.deals').click();
  const ar = page.getByRole('dialog', { name: 'الصفقات' });
  await expect(ar.getByText('الغرض منه')).toBeVisible();
  await expect(ar).toContainText('الصفقات فرص بيع لها قيمة ومرحلة وتاريخ إغلاق.');
  await axe(page);
});

test('the Help center lists every feature and searches the same help text', async ({ page }) => {
  await signUp(page, 'Help Guide');
  await page.goto('/app/help');
  const guide = page.locator('#guide');
  await expect(guide.getByRole('heading', { name: 'Feature guide' })).toBeVisible();
  expect(await guide.locator('[data-help-guide]').count()).toBeGreaterThan(50);

  await guide.getByRole('searchbox', { name: 'Search features' }).fill('price books');
  await expect(guide.locator('[data-help-guide="page.quotes"]')).toBeVisible();
  await expect(guide.locator('[data-help-guide="page.deals"]')).toHaveCount(0);
  await expect(guide.locator('[data-help-guide="page.quotes"]').getByRole('heading', { name: 'Price books' })).toBeVisible();
  await guide.locator('[data-help-guide="page.quotes"]').getByRole('link', { name: 'Open page' }).click();
  await expect(page).toHaveURL(/\/app\/quotes$/);

  await page.goto('/app/help');
  await page.locator('#guide').getByRole('searchbox', { name: 'Search features' }).fill('zzzz-nothing');
  await expect(page.locator('#guide').getByText('No feature matches “zzzz-nothing”.').first()).toBeAttached();
  await axe(page);
});
