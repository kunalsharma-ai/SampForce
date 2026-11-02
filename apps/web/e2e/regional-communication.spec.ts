import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { seedInboundEmail, seedMeeting, signUp } from './helpers';

const ORIGIN = { origin: 'http://localhost:3000' };
const post = async (page: Page, path: string, data: object) => (await page.request.post(`/api/v1${path}`, { data, headers: ORIGIN })).json();

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

test('German translates the team inbox and saves its changes', async ({ page }) => {
  test.setTimeout(90_000);
  await signUp(page, 'Posteingang Süd');
  const contact = await post(page, '/contacts', { firstName: 'Una', lastName: 'Brella', email: 'una@umbrella.test' });
  await seedInboundEmail(page, { from: 'una@umbrella.test', subject: 'Verlängerung', body: 'Können wir die Verlängerung auf März verschieben?', contactId: contact.id });
  await chooseLanguage(page, 'de');

  await page.goto('/app/communication');
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { name: 'E-Mail & Kommunikation', level: 1 })).toBeVisible();
  const list = main.getByRole('list', { name: 'Unterhaltungen' });
  await list.getByRole('button', { name: /Verlängerung/ }).click();
  await expect(main.getByRole('list', { name: 'Nachrichten' }).getByText('Können wir die Verlängerung')).toBeVisible();

  // Category, owner and a note save, and the list shows them in German.
  await main.getByLabel('Kategorie der Unterhaltung').selectOption('sales');
  await expect(list.getByText('Vertrieb')).toBeVisible();
  await main.getByLabel('Unterhaltung zuweisen an').selectOption({ label: 'Test Person (ich)' });
  await main.getByLabel('Neue interne Notiz').fill('Finanzen sind mit März einverstanden.');
  await main.getByRole('button', { name: 'Notiz hinzufügen' }).click();
  await expect(main.getByText('Finanzen sind mit März einverstanden.')).toBeVisible();
  await expect(list.getByText('1 Notiz')).toBeVisible();
  await axe(page);

  // The filters and the compose dialog are in German, including the shared schema's checks.
  await main.getByRole('search').getByLabel('Zugewiesen an').selectOption('me');
  await expect(list.getByRole('button')).toHaveCount(1);
  await main.getByRole('button', { name: 'Synchronisierungsprotokoll' }).click();
  await expect(page.getByRole('dialog', { name: 'Synchronisierungsprotokoll des Postfachs' })).toBeVisible();
});

test('German translates meeting notes, their review and the tasks they create', async ({ page }) => {
  test.setTimeout(90_000);
  await signUp(page, 'Meetings Nord');
  const contact = await post(page, '/contacts', { firstName: 'Tom', lastName: 'Ops', email: 'tom@pilot.test' });
  await seedMeeting(page, { title: 'Pilot-Start', hoursFromNow: -3, contactId: contact.id, attendee: 'tom@pilot.test', joinUrl: 'https://meet.google.com/abc-defg-hij' });
  await chooseLanguage(page, 'de');

  await page.goto('/app/meetings');
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { name: 'Meetings', level: 1 })).toBeVisible();
  await expect(main.getByText('Letzte 30 Tage')).toBeVisible();
  await main.getByRole('button', { name: 'Notizen hinzufügen' }).click();

  await expect(page.getByRole('heading', { name: 'Pilot-Start', level: 1 })).toBeVisible();
  await expect(page.getByLabel('Status der Aufnahme-Transkription').getByText('Einrichtung ausstehend')).toBeVisible();
  await page.getByLabel('Notizen oder Transkript').fill("Speaker 0: I'll send the security questionnaire by Friday.\nSpeaker 1: We need single sign-on.");
  await page.getByLabel('Dieser Text ist').selectOption('transcript');
  await page.getByRole('button', { name: 'Notizen speichern' }).click();
  await page.getByRole('button', { name: 'Mit KI analysieren' }).click();
  await expect(page.getByText('KI-Entwurf: prüfen, bearbeiten und speichern Sie ihn vor der Verwendung')).toBeVisible();
  await expect(page.getByLabel('Anforderungen')).toHaveValue(/single sign-on/);
  await axe(page);

  // An empty summary is refused with the shared schema's message in German.
  await page.getByLabel('Zusammenfassung', { exact: true }).fill('');
  await page.getByRole('button', { name: 'Geprüfte Fassung speichern' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Schreiben Sie eine Zusammenfassung' })).toBeVisible();
  await page.getByLabel('Zusammenfassung', { exact: true }).fill('Start des Piloten.');
  await page.getByRole('button', { name: 'Geprüfte Fassung speichern' }).click();
  await expect(page.getByText(/^Geprüft von /)).toBeVisible();

  await page.getByRole('button', { name: '1 Aufgabe erstellen' }).click();
  await expect(page.getByText('1 Aufgabe aus diesem Meeting erstellt.')).toBeVisible();
  await expect(page.getByText('Aufgabe erstellt', { exact: true })).toBeVisible();
});

test('Arabic shows the meetings page right to left and passes the accessibility check', async ({ page }) => {
  await signUp(page, 'اجتماعات');
  const contact = await post(page, '/contacts', { firstName: 'Sara', lastName: 'Ali', email: 'sara@client.test' });
  await seedMeeting(page, { title: 'Kick-off', hoursFromNow: 24, contactId: contact.id, attendee: 'sara@client.test', joinUrl: 'https://acme.zoom.us/j/123456789' });
  await chooseLanguage(page, 'ar');

  await page.goto('/app/meetings');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { name: 'الاجتماعات', level: 1 })).toBeVisible();
  await expect(main.getByRole('heading', { name: 'القادمة' })).toBeVisible();
  await expect(main.getByRole('link', { name: /انضمام/ })).toHaveAttribute('href', 'https://acme.zoom.us/j/123456789');
  await axe(page);
});
