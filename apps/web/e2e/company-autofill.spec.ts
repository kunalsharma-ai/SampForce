import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { signUp } from './helpers';

/**
 * Company auto-fill (ADR 0076): a new company with only a name and website gets its empty details filled from its own
 * website by the worker; the company page says what was filled and where from, and each value can be undone. The
 * websites are made-up sites served by the stand-in (apps/api/test/fixtures/company-sites.ts).
 */
const ORIGIN = { origin: 'http://localhost:3000' };
/** Set PREVIEW_DIR to save screenshots of each screen (used for previews). */
const PREVIEW_DIR = process.env.PREVIEW_DIR;

test.use({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 }, deviceScaleFactor: PREVIEW_DIR ? 2 : 1 });

async function axe(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(r.violations.map((v) => `${v.id} ${v.nodes[0]?.target} ${v.nodes[0]?.failureSummary}`)).toEqual([]);
}

/** The whole of a tall element, from a full-page capture, without the sticky top bar over it. */
async function fullShot(page: Page, name: string, locator: ReturnType<Page['locator']>) {
  if (!PREVIEW_DIR) return;
  // At the top of the page the sticky top bar sits above the content, not over the element.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  const box = await locator.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.left + window.scrollX, y: r.top + window.scrollY, width: r.width, height: r.height };
  });
  await page.screenshot({ path: `${PREVIEW_DIR}/${name}.png`, fullPage: true, clip: box });
}

async function shot(page: Page, name: string, locator?: ReturnType<Page['locator']>) {
  if (!PREVIEW_DIR) return;
  await page.waitForTimeout(300);
  // A panel is shown in the middle of the page, as people see it (an element shot would sit under the sticky top bar).
  if (locator) await locator.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${PREVIEW_DIR}/${name}.png` });
}

test('a new company is filled from its website, with sources, and each value can be undone', async ({ page }) => {
  test.setTimeout(90_000);
  await signUp(page, 'Autofill Showcase Org');
  const res = await page.request.post('/api/v1/companies', { data: { name: 'Northwind Insights', website: 'northwind-insights.example' }, headers: ORIGIN });
  expect(res.ok(), await res.text()).toBe(true);
  const { id } = await res.json();

  await page.goto(`/app/companies/${id}`);
  const panel = page.locator('#company-autofill');
  // The worker (in the API for e2e) reads the site within a few seconds; the page reloads the company when it is done.
  await expect(panel.getByRole('status')).toContainText(/details added/, { timeout: 30_000 });
  const filled = panel.getByRole('list', { name: 'Details auto-fill added' });
  // The first few fields show; the rest open with "Show all".
  await expect(filled.locator(':scope > li')).toHaveCount(6);
  await panel.scrollIntoViewIfNeeded();
  await shot(page, '02-autofill-panel', panel);
  await panel.getByRole('button', { name: /^Show all/ }).click();
  await expect(filled.locator(':scope > li').filter({ hasText: 'Certifications' })).toContainText('ISO 27001');
  await expect(filled.locator(':scope > li').filter({ hasText: 'Founded' })).toContainText('2009');
  await expect(filled.locator(':scope > li').filter({ hasText: 'Founded' }).getByRole('link', { name: /Company website/ })).toHaveAttribute('href', 'https://www.northwind-insights.example/about-us');
  // A value guessed from weak signals says so.
  await expect(filled.locator(':scope > li').filter({ hasText: 'Industry' })).toContainText('Best guess');
  // The company itself now has the details: the business information card shows the filled description.
  await expect(page.getByText(/^Northwind Insights is a global market research company/).first()).toBeVisible();
  // The header shows where the company is, and a button for each profile found, opening it directly.
  const header = page.getByRole('region', { name: 'Northwind Insights' });
  await expect(header).toContainText('4th Floor, Meridian Tower, 12 Harbour Road, Pune, Maharashtra, 411001, India');
  const profiles = header.getByRole('list', { name: 'Online profiles' });
  await expect(profiles.getByRole('link', { name: 'Northwind Insights on LinkedIn' })).toHaveAttribute('href', 'https://www.linkedin.com/company/northwind-insights');
  await expect(profiles.getByRole('link')).toHaveCount(6);
  await expect(profiles.getByRole('link', { name: 'Northwind Insights on YouTube' })).toHaveAttribute('target', '_blank');
  await axe(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, '01-company-page-after-autofill');

  // Undo one value: it leaves the company and the list.
  await filled.getByRole('button', { name: 'Undo Founded' }).click();
  await expect(filled.locator(':scope > li').filter({ hasText: 'Founded' })).toHaveCount(0);
  const after = await (await page.request.get(`/api/v1/companies/${id}`)).json();
  expect(after.foundedYear).toBeNull();
  expect(after.fieldSources.foundedYear).toMatchObject({ source: 'USER' });

  // Looking it up again straight away, from the header's quick action, is refused with a plain reason.
  await page.getByRole('button', { name: 'Enrich', exact: true }).first().click();
  await expect(panel.getByRole('alert')).toContainText('This company was just looked up. Try again in a minute.');

  // Undo all removes everything the run added.
  await panel.getByRole('button', { name: 'Undo all' }).click();
  await expect(panel).toContainText('Everything the last look-up filled was undone or changed since.');
  const cleared = await (await page.request.get(`/api/v1/companies/${id}`)).json();
  expect(cleared.certifications).toEqual([]);
  expect(cleared.website).toBe('https://northwind-insights.example');
  await shot(page, '03-autofill-undone', panel);
});

test('a company saved without a website is looked up again when its website is added', async ({ page }) => {
  test.setTimeout(60_000);
  await signUp(page, 'Autofill Enrich Org');
  // Without a website there is nothing to read yet, and Wikidata knows no company called this.
  const res = await page.request.post('/api/v1/companies', { data: { name: 'Plainfield Works' }, headers: ORIGIN });
  const { id } = await res.json();
  await page.goto(`/app/companies/${id}`);
  const panel = page.locator('#company-autofill');
  await expect(panel.getByRole('status')).toContainText('No website, and Wikidata has no company with exactly this name.', { timeout: 30_000 });
  await shot(page, '04-autofill-nothing-found', panel);

  // Adding the website looks it up again by itself.
  const patch = await page.request.patch(`/api/v1/companies/${id}`, { data: { website: 'globex-analytics.example' }, headers: ORIGIN });
  expect(patch.ok(), await patch.text()).toBe(true);
  await page.reload();
  await expect(panel.getByRole('status')).toContainText(/details added/, { timeout: 30_000 });
  await expect(panel).toContainText('when the website changed');
});

test('Business Information holds every detail, tells auto-filled values apart, and edits in one place', async ({ page }) => {
  test.setTimeout(90_000);
  await signUp(page, 'Business Info Org');
  const res = await page.request.post('/api/v1/companies', { data: { name: 'Northwind Insights', website: 'northwind-insights.example', notes: 'Met at the Pune expo.' }, headers: ORIGIN });
  const { id } = await res.json();
  await page.goto(`/app/companies/${id}`);
  await expect(page.locator('#company-autofill').getByRole('status')).toContainText(/details added/, { timeout: 30_000 });

  const info = page.locator('#business-information');
  // Grouped sections, each value from auto-fill marked Auto with a link to its source; typed values carry no mark.
  for (const section of ['Overview', 'HQ & Locations', 'Contact', 'Digital presence', 'Certifications', 'More details']) {
    await expect(info.getByRole('region', { name: section })).toBeVisible();
  }
  const founded = info.getByRole('group', { name: 'Company facts' }).locator(':scope > div').filter({ hasText: /^Founded/ });
  await expect(founded.getByRole('link', { name: /Found by auto-fill: Company website/ })).toHaveAttribute('href', 'https://www.northwind-insights.example/about-us');
  await expect(founded).toContainText('2009');
  const remarks = info.locator('dl > div').filter({ has: page.locator('dt', { hasText: /^Remarks/ }) });
  await expect(remarks).toContainText('Met at the Pune expo.');
  await expect(remarks.getByText('Auto')).toHaveCount(0);
  await expect(info.getByRole('region', { name: 'HQ & Locations' })).toContainText('Pune');
  await expect(info.getByRole('region', { name: 'Certifications' })).toContainText('ISO 27001');
  // The AI summary is written on request from these details, and always labelled as AI.
  const summary = info.getByRole('region', { name: /AI summary/ });
  await summary.getByRole('button', { name: 'Write AI summary' }).click();
  await expect(summary).toContainText('Northwind Insights works in Market research, based in Pune, IN.');
  await expect(summary).toContainText(/Written by AI from the details below/);
  await expect(summary.getByRole('button', { name: 'Write again' })).toBeVisible();
  await axe(page);
  await shot(page, '05-business-information', info);
  await fullShot(page, '05b-business-information-full', info);

  // One Edit opens every field, grouped the same way.
  await info.getByRole('button', { name: 'Edit' }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit business information' });
  await expect(dialog.getByLabel('Founded')).toHaveValue('2009');
  await dialog.getByLabel('Founded').fill('2010');
  const services = dialog.getByLabel('Services');
  await services.fill((await services.inputValue()).replace('Panel Management\n', '').replace('\nPanel Management', ''));
  await dialog.getByLabel('Social profiles').fill('https://x.com/NorthwindIns\nhttps://www.tiktok.com/@northwind');
  await dialog.getByRole('button', { name: 'Add detail' }).click();
  await dialog.getByRole('textbox', { name: 'Detail 1' }).fill('Panel size');
  await dialog.getByRole('textbox', { name: 'Value 1' }).fill('2.1 million members');
  await axe(page);
  await shot(page, '06-edit-business-information', dialog);
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();

  // The edited value is now the team's own: no Auto mark, and auto-fill keeps off it.
  await expect(founded).toContainText('2010');
  await expect(founded.getByRole('link', { name: /Found by auto-fill/ })).toHaveCount(0);
  await expect(info.getByRole('region', { name: 'More details' })).toContainText('2.1 million members');
  await expect(info.getByRole('region', { name: 'Digital presence' }).getByRole('link', { name: /TikTok/ })).toHaveAttribute('href', 'https://www.tiktok.com/@northwind');
  const saved = await (await page.request.get(`/api/v1/companies/${id}`)).json();
  expect(saved.foundedYear).toBe(2010);
  expect(saved.fieldSources.foundedYear).toMatchObject({ source: 'USER' });
  expect(saved.services).not.toContain('Panel Management');
  expect(saved.moreDetails).toEqual([{ label: 'Panel size', value: '2.1 million members' }]);
  // Fields left alone keep their auto-fill source.
  expect(saved.fieldSources.employeeCount).toMatchObject({ source: 'WEBSITE' });
});

test('Create Company finds the details before saving; the person picks what to use', async ({ page }) => {
  test.setTimeout(120_000);
  await signUp(page, 'Create Autofill Org');
  const main = page.getByRole('main');
  await page.goto('/app/companies/new');
  await main.getByLabel('Company name *').fill('Northwind Insights');
  await main.getByLabel('Official website URL 1', { exact: true }).fill('https://northwind-insights.example');
  const finder = main.getByRole('region', { name: 'Fill in the rest automatically' });
  await finder.getByRole('button', { name: 'Find details' }).click();
  const found = finder.getByRole('group', { name: /Found for this form/ });
  await expect(found).toContainText('2009');
  await expect(found.getByRole('checkbox', { name: /Description/ })).toBeChecked();
  // Everything the form has no place for is shown too, ticked, and added after saving; unticked ones are left out.
  const later = finder.getByRole('group', { name: /Added when you save/ });
  await expect(later.getByRole('checkbox', { name: /Certifications/ })).toBeChecked();
  await expect(later).toContainText('ISO 27001');
  await later.getByRole('checkbox', { name: /Social profiles/ }).uncheck();
  // Leave the industry guess out.
  await found.getByRole('checkbox', { name: /Industry/ }).uncheck();
  await axe(page);
  await fullShot(page, '07-create-company-find-details', finder);
  await found.getByRole('button', { name: /^Use \d+ selected$/ }).click();
  await expect(finder.getByRole('status')).toContainText(/Added \d+ details to the form/);
  await expect(main.getByLabel('Company overview')).toHaveValue(/^Northwind Insights is a global market research company/);

  // Through the steps to save; the values are in the form to check on the way.
  for (let i = 0; i < 7; i++) await main.getByRole('button', { name: 'Next' }).click();
  await expect(main).toContainText('Pune');
  await main.getByRole('button', { name: 'Save lead' }).click();
  await expect(page).toHaveURL(/\/app\/companies\/[0-9a-f-]{36}$/);
  const id = page.url().split('/').pop()!;
  // After saving, auto-fill adds the rest, and the values taken from the look-up keep their source.
  await expect(page.locator('#company-autofill').getByRole('status')).toContainText(/details added/, { timeout: 30_000 });
  await expect
    .poll(async () => (await (await page.request.get(`/api/v1/companies/${id}`)).json()).fieldSources?.foundedYear?.url, { timeout: 15_000 })
    .toBe('https://www.northwind-insights.example/about-us');
  const saved = await (await page.request.get(`/api/v1/companies/${id}`)).json();
  expect(saved.certifications).toContain('ISO 27001');
  expect(saved.industry).toBe('Market research');
  // The unticked profiles were not added, and auto-fill will not add them later either.
  expect(saved.socialLinks ?? []).toEqual([]);
  expect(saved.fieldSources.socialLinks.source).toBe('USER');
});

test('the AI email assistant writes for your own organisation from its sales profile, editable before sending', async ({ page }) => {
  test.setTimeout(90_000);
  await signUp(page, 'Insight Panels Showcase');

  // The Super Workspace describes the organisation once, in Settings.
  await page.goto('/app/settings#sales-profile');
  const card = page.locator('#sales-profile');
  await expect(card.getByLabel('Services')).toBeEnabled();
  await card.getByLabel('Organisation name in emails').fill('Insight Panels');
  await card.getByLabel('Website').fill('https://insight-panels.example');
  await card.getByLabel('What your organisation does').fill('A market research company with its own online panels.');
  await card.getByLabel('Services').fill('Online surveys\nB2B panels\nConsumer trackers');
  await card.getByLabel('Industries you serve').fill('Food and drink\nRetail');
  await card.getByLabel('Value proposition').fill('Verified respondents in 40 countries, with first results within a week.');
  await card.getByLabel('What sets you apart').fill('Own panels, not resold\nISO 20252 certified');
  await card.getByLabel('Signature added to every email').fill('Book a call: https://insight-panels.example/meet');
  await card.getByRole('button', { name: 'Save sales profile' }).click();
  await expect(card.getByRole('status')).toHaveText('Saved.');
  await fullShot(page, '08-settings-sales-profile', card);

  const res = await page.request.post('/api/v1/company-leads', {
    data: {
      company: { name: 'Contoso Foods', industry: 'Food manufacturing', city: 'Lyon', country: 'FR', emails: [{ value: 'hello@contoso-foods.example' }] },
      employees: [{ firstName: 'Priya', lastName: 'Nair', jobTitle: 'Head of Insights', emails: [{ value: 'priya@contoso-foods.example' }] }],
    },
    headers: ORIGIN,
  });
  expect(res.ok(), await res.text()).toBe(true);
  const { company } = await res.json();
  await page.goto(`/app/companies/${company.id}`);

  // The quick action in the header leads to the assistant.
  await page.getByRole('button', { name: 'Write email with AI' }).click();
  const assistant = page.locator('#company-email-assistant');
  await expect(assistant).toContainText('Writing for Insight Panels');
  await assistant.getByText('Ask for a meeting').click();
  await assistant.getByLabel('Write to').selectOption({ label: 'Priya Nair · Head of Insights' });
  await assistant.getByLabel('Tone').selectOption('friendly');
  await assistant.getByRole('radiogroup', { name: 'Personalisation' }).getByRole('radio', { name: 'Deep' }).click();
  await assistant.getByRole('radiogroup', { name: 'Follow-ups' }).getByRole('radio', { name: '2' }).click();
  await assistant.getByLabel('Sales objective').fill('their 2027 consumer tracker');
  await assistant.getByRole('button', { name: 'Write email' }).click();

  const draft = assistant.getByRole('region', { name: 'Draft email' });
  await expect(draft.getByLabel('Subject')).toHaveValue('Insight Panels for Contoso Foods');
  const body = draft.getByRole('textbox', { name: 'Email', exact: true });
  await expect(body).toHaveValue(/^Hi Priya,/);
  await expect(body).toHaveValue(/Online surveys and B2B panels/);
  await expect(body).toHaveValue(/Book a call: https:\/\/insight-panels\.example\/meet$/);
  await expect(draft).toContainText('priya@contoso-foods.example');
  // What it could not know is left in brackets and listed for the person to fill in.
  await expect(draft.getByText('Check before sending')).toBeVisible();
  await expect(draft).toContainText('Fill in [proposed time]');
  await body.fill((await body.inputValue()).replace('[proposed time]', 'Tuesday at 10:00'));
  await expect(draft).not.toContainText('Fill in [proposed time]');
  await axe(page);
  await fullShot(page, '09-ai-email-assistant', assistant);

  // The follow-ups are their own emails, also editable.
  await draft.getByRole('tab', { name: /Follow-up 2/ }).click();
  await expect(draft.getByRole('textbox', { name: 'Email', exact: true })).toHaveValue(/A short follow-up 2/);
  await draft.getByRole('tab', { name: 'First email' }).click();
  await expect(draft.getByRole('textbox', { name: 'Email', exact: true })).toHaveValue(/Tuesday at 10:00/);

  // Nothing is sent from here: it opens in the normal email window, filled in.
  await draft.getByRole('button', { name: 'Open in email' }).click();
  const dialog = page.getByRole('dialog', { name: 'New email' });
  await expect(dialog.getByLabel('To')).toHaveValue('priya@contoso-foods.example');
  await expect(dialog.getByLabel('Subject')).toHaveValue('Insight Panels for Contoso Foods');
  await expect(dialog.getByLabel('Message')).toHaveValue(/Tuesday at 10:00/);
  await shot(page, '10-ai-email-open-in-email');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('Find people lists the people a company publishes and adds the ticked ones as employees', async ({ page }) => {
  test.setTimeout(90_000);
  await signUp(page, 'Autofill People Org');
  const res = await page.request.post('/api/v1/companies', { data: { name: 'Ashgrove Research', website: 'https://ashgrove-research.example' }, headers: ORIGIN });
  expect(res.ok(), await res.text()).toBe(true);
  const { id } = await res.json();

  await page.goto(`/app/companies/${id}`);
  const employees = page.locator('#company-employees');
  await employees.getByRole('button', { name: 'Find people' }).click();
  const dialog = page.getByRole('dialog', { name: 'Find people at Ashgrove Research' });
  const found = dialog.getByRole('group', { name: /People found/ });
  await expect(found).toBeVisible({ timeout: 30_000 });
  for (const name of ['Helen Marsh', 'Gareth Lowe', 'Priti Desai']) await expect(found.getByText(name, { exact: true })).toBeVisible();
  await expect(found.getByText('Tom Baker')).toHaveCount(0);
  await axe(page);
  await shot(page, '06-find-people', dialog);
  // Everyone is ticked; untick one and add the rest.
  await found.getByRole('checkbox').first().uncheck();
  const count = (await found.getByRole('checkbox').count()) - 1;
  await dialog.getByRole('button', { name: `Add ${count} as employees` }).click();
  await expect(dialog.getByRole('status')).toContainText(`Added ${count} people as employees.`);
  // The ones added are not offered again.
  await expect(found.getByRole('checkbox')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(employees.getByRole('row').filter({ hasText: /Marsh|Lowe|Desai/ })).toHaveCount(count);
  await shot(page, '07-employees-added', employees);
  const rows = (await (await page.request.get(`/api/v1/companies/${id}/employees`)).json()) as { remarks: string | null }[];
  expect(rows.length).toBe(count);
  for (const r of rows) expect(r.remarks).toMatch(/^Found by auto-fill on https:\/\/ashgrove-research\.example\//);
});
