import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { seedInboundEmail, signUp } from './helpers';

const ORIGIN = { origin: 'http://localhost:3000' };
const post = async (page: Page, path: string, data: object) =>
  (await page.request.post(`/api/v1${path}`, { data, headers: ORIGIN })).json();

async function expectNoA11yViolations(page: Page) {
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(300);
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(
    results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
  ).toEqual([]);
}

test('works a conversation in the team inbox: assign, categorise, note, link to a deal, then filter and search', async ({
  page,
}) => {
  await signUp(page, 'Inbox Team');
  const company = await post(page, '/companies', { name: 'Umbrella Ltd' });
  const contact = await post(page, '/contacts', {
    firstName: 'Una',
    lastName: 'Brella',
    email: 'una@umbrella.test',
    companyId: company.id,
  });
  const stage = (await (await page.request.get('/api/v1/pipelines')).json())[0].stages[0];
  await post(page, '/deals', {
    name: 'Umbrella renewal',
    amount: 9000,
    stageId: stage.id,
    companyId: company.id,
  });
  await seedInboundEmail(page, {
    from: 'una@umbrella.test',
    subject: 'Renewal terms',
    body: 'Can we move the renewal to March and keep the current price?',
    contactId: contact.id,
  });
  await seedInboundEmail(page, {
    from: 'una@umbrella.test',
    subject: 'Login trouble',
    body: 'Two of my team cannot sign in since Monday.',
    contactId: contact.id,
  });

  await page.goto('/app/communication');
  const list = page.getByRole('list', { name: 'Conversations' });
  await expect(list.getByRole('button', { name: /Renewal terms/ })).toBeVisible();
  await expect(list.getByRole('button', { name: /Login trouble/ })).toBeVisible();
  await expectNoA11yViolations(page);

  await list.getByRole('button', { name: /Renewal terms/ }).click();
  await expect(page).toHaveURL(/conversation=[0-9a-f-]{36}/);
  await expect(page.getByRole('heading', { level: 2, name: 'Renewal terms' })).toBeVisible();
  await expect(
    page.getByRole('list', { name: 'Messages' }).getByText('Can we move the renewal to March'),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Una Brella' })).toBeVisible();

  await page.getByLabel('Conversation category').selectOption('sales');
  await expect(list.getByText('Sales')).toBeVisible();
  await page.getByLabel('Assign conversation to').selectOption({ label: 'Test Person (me)' });
  await expect(list.getByText('Test Person')).toBeVisible();
  await page.getByLabel('Linked deal').fill('Umbrella');
  await page.getByRole('option', { name: /Umbrella renewal/ }).click();
  await expect(page.getByRole('link', { name: 'Deal: Umbrella renewal' })).toBeVisible();
  await page
    .getByLabel('New internal note')
    .fill('Finance agreed March is fine if they sign for two years.');
  await page.getByRole('button', { name: 'Add note' }).click();
  await expect(page.getByText('Finance agreed March is fine')).toBeVisible();
  await expect(list.getByText('1 note')).toBeVisible();
  await expectNoA11yViolations(page);

  // Filters and search.
  await page.getByRole('search').getByLabel('Assigned to').selectOption('me');
  await expect(list.getByRole('button')).toHaveCount(1);
  await page.getByRole('search').getByLabel('Assigned to').selectOption('');
  await page.getByLabel('Search conversations').fill('sign in');
  await expect(list.getByRole('button', { name: /Login trouble/ })).toBeVisible();
  await expect(list.getByRole('button', { name: /Renewal terms/ })).toHaveCount(0);
  await page.getByLabel('Search conversations').fill('');

  // Closing moves it out of the default view.
  await page.getByLabel('Conversation status').selectOption('CLOSED');
  await expect(list.getByRole('button', { name: /Renewal terms/ })).toHaveCount(0);
  await page.getByRole('search').getByLabel('Status').selectOption('CLOSED');
  await expect(list.getByRole('button', { name: /Renewal terms/ })).toBeVisible();

  // Sync log. (The worker may already have tried the seeded test mailbox, whose credentials are not real.)
  await page.getByRole('button', { name: 'Sync log' }).click();
  await expect(page.getByRole('dialog', { name: 'Mailbox sync log' })).toContainText(
    /No syncs recorded yet|Scheduled|Started by hand/,
  );
  await page.keyboard.press('Escape');

  // The deal shows its conversation and links back to the inbox.
  await page.getByRole('link', { name: 'Deal: Umbrella renewal' }).click();
  await expect(page.getByRole('heading', { name: 'Conversations' })).toBeVisible();
  await page.getByRole('link', { name: 'Renewal terms' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Renewal terms' })).toBeVisible();
});
