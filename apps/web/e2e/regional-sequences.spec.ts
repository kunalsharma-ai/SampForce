import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { signUp } from './helpers';

const ORIGIN = { origin: 'http://localhost:3000' };

test.use({ reducedMotion: 'reduce' });

/** The email previews are sandboxed frames with no scripts, so axe checks the page around them. */
async function axe(page: Page) {
  const r = await new AxeBuilder({ page })
    .options({ iframes: false, runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] } })
    .setLegacyMode(true)
    .analyze();
  expect(r.violations.map((v) => `${v.id} ${v.nodes[0]?.target} ${v.nodes[0]?.failureSummary}`)).toEqual([]);
}

async function chooseLanguage(page: Page, code: string) {
  await page.goto('/app/settings');
  await page.getByTestId('regional-settings').getByLabel('Language').selectOption(code);
  await page.getByTestId('regional-settings').getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', code);
}

test('German translates email sequences, templates and the template designer, and saves a designed template', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await signUp(page, 'Vertrieb Nord');
  const lead = await page.request.post('/api/v1/leads', { data: { fullName: 'Jonas Becker', email: 'jonas@kunde.test' }, headers: ORIGIN });
  expect(lead.ok()).toBe(true);
  await chooseLanguage(page, 'de');

  await page.goto('/app/sequences');
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { name: 'E-Mail-Sequenzen', level: 1 })).toBeVisible();
  await expect(main.getByText('Noch keine Sequenzen.', { exact: false })).toBeVisible();

  // Templates: the form and the designer are in German, including the block names and their buttons.
  await main.getByRole('tab', { name: 'Vorlagen' }).click();
  await main.getByRole('button', { name: 'Neue Vorlage' }).click();
  await main.getByLabel('Name', { exact: true }).fill('Angebot');
  await main.getByLabel('Betreff').fill('Ein Angebot für {{company}}');
  await main.getByLabel('E-Mail', { exact: true }).fill('Danke für das Gespräch.');
  await main.getByRole('button', { name: 'Gestaltet', exact: true }).click();
  const outline = main.getByRole('list', { name: 'E-Mail-Blöcke' });
  await expect(outline.getByRole('button', { name: 'Ziehen: Block Text 1' })).toBeVisible();
  await expect(outline.getByRole('button', { name: 'Ziehen: Block Schaltfläche 2' })).toBeVisible();
  await main.getByRole('list', { name: 'Blöcke, die Sie hinzufügen können' }).getByRole('button', { name: 'Kopfzeile (hinzufügen)' }).click();
  await outline.getByRole('button', { name: 'Nach oben: Block Kopfzeile 2' }).click();
  await expect(outline.getByRole('button', { name: 'Ziehen: Block Kopfzeile 1' })).toBeVisible();
  await expect(main.getByRole('heading', { name: 'Einstellungen: Kopfzeile' })).toBeVisible();
  await expect(main.getByRole('button', { name: 'Block (Preistabelle) in die E-Mail ziehen' })).toBeVisible();

  // The shared schema's check is shown in German, naming the block.
  await outline.getByRole('button', { name: /^Schaltfläche / }).click();
  await main.getByRole('button', { name: 'Vorlage speichern' }).click();
  await expect(main.getByRole('alert')).toHaveText('Block Schaltfläche 3: Verwenden Sie einen vollständigen Link, der mit https:// beginnt, oder einen Platzhalter.');
  await main.getByLabel('Link', { exact: true }).fill('https://kalender.example.com/jonas');
  await main.getByRole('button', { name: 'Telefon' }).click();
  await expect(main.locator('iframe[title="E-Mail-Vorschau in Smartphone-Breite"]')).toHaveJSProperty('offsetWidth', 375);
  await axe(page);

  // Preview for a lead and save: the stored template shows as designed.
  await main.getByLabel('Vorschau für einen Lead').fill('Jonas');
  await page.getByRole('option', { name: /Jonas Becker/ }).click();
  await main.getByRole('button', { name: 'Vorschau', exact: true }).click();
  await expect(main.locator('iframe[title="E-Mail-Vorschau für Jonas Becker"]')).toBeVisible();
  await main.getByRole('button', { name: 'Vorlage speichern' }).click();
  const card = main.getByRole('heading', { name: /Angebot/ });
  await expect(card.getByText('Gestaltet')).toBeVisible();
  await expect(main.getByRole('button', { name: 'Angebot bearbeiten' })).toBeVisible();

  // A new sequence opens in the editor: tabs, rules and the send window, with weekday names from the locale.
  await main.getByRole('tab', { name: 'Sequenzen' }).click();
  await main.getByRole('button', { name: 'Neue Sequenz' }).click();
  await expect(main.getByRole('heading', { name: /Neue Sequenz/, level: 1 })).toBeVisible();
  await expect(main.getByRole('tab', { name: 'Schritte (2)' })).toBeVisible();
  await expect(main.getByText('Tag 3')).toBeVisible();
  await main.getByRole('tab', { name: 'Wenn sie reagieren' }).click();
  await expect(main.getByText('Wenn eine E-Mail unzustellbar ist')).toBeVisible();
  await expect(main.getByLabel('Sequenz für die Person stoppen').first()).toBeVisible();
  await main.getByRole('tab', { name: 'Versand' }).click();
  await expect(main.getByRole('group', { name: 'Senden am' }).getByLabel('Mo')).toBeChecked();
  await expect(main.getByRole('group', { name: 'Senden am' }).getByLabel('So')).not.toBeChecked();
  await axe(page);

  // Results across sequences.
  await page.goto('/app/sequences');
  await main.getByRole('tab', { name: 'Ergebnisse' }).click();
  await expect(main.getByText('Gesendete E-Mails')).toBeVisible();
  await expect(main.getByRole('heading', { name: 'Tipps' })).toBeVisible();
});

test('Arabic email designer reads right to left and stays accessible', async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await signUp(page, 'Arabic Designer');
  await chooseLanguage(page, 'ar');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await page.goto('/app/sequences');
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { name: 'سلاسل البريد الإلكتروني', level: 1 })).toBeVisible();
  await main.getByRole('tab', { name: 'القوالب' }).click();
  await main.getByRole('button', { name: 'قالب جديد' }).click();
  await main.getByRole('button', { name: 'مصمَّم', exact: true }).click();
  await expect(main.getByRole('list', { name: 'كتل الرسالة' })).toBeVisible();
  await expect(main.getByRole('heading', { name: 'إضافة كتلة' })).toBeVisible();
  await axe(page);
});
