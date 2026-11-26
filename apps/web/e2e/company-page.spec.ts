import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { signUp } from './helpers';

/*
 * The redesigned company page: every panel sits in a colour of its own with an icon medallion on its top edge,
 * readable in light and dark and on a phone, and the panels keep working as before.
 */

const ORIGIN = { origin: 'http://localhost:3000' };
const PREVIEW_DIR = process.env.PREVIEW_DIR;

test.use({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 }, deviceScaleFactor: PREVIEW_DIR ? 2 : 1 });

async function post(page: Page, path: string, data: object) {
  const res = await page.request.post(`/api/v1${path}`, { data, headers: ORIGIN });
  expect(res.ok(), await res.text()).toBe(true);
  return res.json();
}

const setTheme = (page: Page, theme: 'light' | 'dark') =>
  page.evaluate((th) => localStorage.setItem('dealflow:preferences', JSON.stringify({ state: { theme: th, motion: 'off' }, version: 0 })), theme);

async function shoot(page: Page, tone: string, file: string) {
  if (!PREVIEW_DIR) return;
  await page.locator(`[data-tone="${tone}"]`).evaluate((el) => { el.scrollIntoView({ block: 'start' }); window.scrollBy(0, -90); document.querySelector('main')?.scrollBy(0, -90); });
  await page.screenshot({ path: `${PREVIEW_DIR}/${file}` });
}

test('every panel of the company page has its own colour and icon, in light, dark and on a phone', async ({ page }) => {
  test.setTimeout(180_000);
  await signUp(page, 'Tone Fieldwork');
  await setTheme(page, 'light');
  const lead = await post(page, '/company-leads', {
    company: { name: 'Northwind Panels Ltd', country: 'GB', city: 'London', primaryEmail: 'hello@northwind.example' },
    employees: [{ firstName: 'Priya', lastName: 'Nair', jobTitle: 'Research Director', emails: [{ value: 'priya@northwind.example' }] }],
  });
  await post(page, '/rfqs', { companyId: lead.company.id, contactId: lead.employeeIds[0], projectName: 'UK drivers survey', currency: 'GBP' });

  await page.goto(`/app/companies/${lead.company.id}`);
  await expect(page.getByRole('heading', { name: /RFQs/ }).first()).toBeVisible();
  await expect(page.locator('[data-tone="voice-notes"] .df-card').first()).toBeVisible();

  // Every visible panel is toned, each wrapper holds its card, and the colours differ from panel to panel.
  const tones = await page.locator('[data-tone]:visible').evaluateAll((els) =>
    els.map((e) => ({ name: e.getAttribute('data-tone'), dot: getComputedStyle(e).getPropertyValue('--st-dot').trim(), card: !!e.querySelector(':scope > .df-card, :scope > section, :scope > div:not(.sf-tone-medal)') })),
  );
  const names = tones.map((t) => t.name);
  for (const n of ['business-information', 'business-overview', 'employees', 'interactions', 'rfqs', 'deals', 'branches', 'commercial', 'portal', 'voice-notes', 'lead', 'follow-ups', 'ownership', 'concerns', 'files', 'intelligence'])
    expect(names, n).toContain(n);
  expect(tones.every((t) => t.card && t.dot)).toBe(true);
  for (const col of [['business-overview', 'employees', 'interactions', 'rfqs', 'deals'], ['lead', 'follow-ups', 'ownership', 'concerns', 'files']]) {
    const dots = col.map((n) => tones.find((t) => t.name === n)!.dot);
    expect(new Set(dots).size).toBe(dots.length);
  }

  // The panels still work: an RFQ added earlier is listed in its toned panel.
  await expect(page.locator('[data-tone="rfqs"]').getByText('UK drivers survey')).toBeVisible();

  const a11y = await new AxeBuilder({ page }).include('[data-tone]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(a11y.violations.map((v) => `${v.id} ${v.nodes[0]?.target} ${v.nodes[0]?.failureSummary}`)).toEqual([]);

  await shoot(page, 'business-information', '01-top-light.png');
  await shoot(page, 'business-overview', '02-overview-employees-interactions-light.png');
  await shoot(page, 'rfqs', '03-rfqs-deals-branches-light.png');
  await shoot(page, 'commercial', '04-contracts-portal-voice-light.png');

  await setTheme(page, 'dark');
  await page.reload();
  await expect(page.locator('[data-tone="rfqs"]').getByText('UK drivers survey')).toBeVisible();
  await shoot(page, 'business-information', '05-top-dark.png');
  await shoot(page, 'business-overview', '06-overview-dark.png');
  await shoot(page, 'rfqs', '07-rfqs-deals-dark.png');

  await setTheme(page, 'light');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.locator('[data-tone="rfqs"]').getByText('UK drivers survey')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await shoot(page, 'business-overview', '08-phone.png');
});
