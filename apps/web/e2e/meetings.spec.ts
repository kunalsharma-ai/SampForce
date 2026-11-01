import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { seedMeeting, signUp } from './helpers';

const ORIGIN = { origin: 'http://localhost:3000' };
const post = async (page: Page, path: string, data: object) => (await page.request.post(`/api/v1${path}`, { data, headers: ORIGIN })).json();

async function expectNoA11yViolations(page: Page) {
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(300);
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

const TRANSCRIPT = [
  "Speaker 0: Thanks for joining, I'm Priya from the sales team.",
  "Speaker 1: I'm Tom. We need single sign-on and an audit log before we roll out.",
  'Speaker 1: Honestly the per-seat price feels expensive for the support team.',
  "Speaker 0: I'll send the security questionnaire by Friday.",
  "Speaker 1: I'll check the budget with finance.",
  'Speaker 1: We agree to run a two-week pilot with the ops team.',
].join('\n');

test('turns a calendar meeting into reviewed notes, tasks and a timeline summary', async ({ page }) => {
  await signUp(page, 'Meeting Intel');
  const contact = await post(page, '/contacts', { firstName: 'Tom', lastName: 'Ops', email: 'tom@pilot.test' });
  const stage = (await (await page.request.get('/api/v1/pipelines')).json())[0].stages[0];
  const deal = await post(page, '/deals', { name: 'Pilot rollout', amount: 12000, stageId: stage.id, contactId: contact.id });
  await seedMeeting(page, { title: 'Pilot kick-off', hoursFromNow: -3, contactId: contact.id, attendee: 'tom@pilot.test', joinUrl: 'https://meet.google.com/abc-defg-hij' });
  await seedMeeting(page, { title: 'Pilot check-in', hoursFromNow: 48, contactId: contact.id, attendee: 'tom@pilot.test', joinUrl: 'https://acme.zoom.us/j/123456789' });

  await page.goto('/app/meetings');
  await expect(page.getByText('Zoom')).toBeVisible();
  await expect(page.getByRole('link', { name: /Join\s+Pilot check-in/ })).toHaveAttribute('href', 'https://acme.zoom.us/j/123456789');
  await expect(page.getByText('Google Meet')).toBeVisible();
  await expectNoA11yViolations(page);
  await page.getByRole('button', { name: 'Add notes' }).click();

  await expect(page.getByRole('heading', { name: 'Pilot kick-off', level: 1 })).toBeVisible();
  // No transcription key in this environment, so recordings are honestly marked as not set up.
  const banner = page.getByLabel('Recording transcription status');
  await expect(banner.getByText('Pending Configuration')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Transcribe recording' })).toBeDisabled();
  await expect(page.getByLabel('Linked contact')).toHaveValue('Tom Ops');

  await page.getByLabel('Linked deal').fill('Pilot');
  await page.getByRole('option', { name: /Pilot rollout/ }).click();
  await page.getByLabel('Notes or transcript').fill(TRANSCRIPT);
  await page.getByLabel('This text is').selectOption('transcript');
  await page.getByRole('button', { name: 'Save notes' }).click();
  await page.getByRole('button', { name: 'Analyse with AI' }).click();

  await expect(page.getByText('AI draft: check it, edit it and save it before using it')).toBeVisible();
  await expect(page.getByLabel('Requirements')).toHaveValue(/single sign-on/);
  await expect(page.getByLabel('Objections and concerns')).toHaveValue(/expensive/);
  await expect(page.getByLabel('Decisions')).toHaveValue(/two-week pilot/);
  await expect(page.getByLabel('Participant 1 name')).toHaveValue('Priya');
  await expect(page.getByLabel('Participant 2 name')).toHaveValue('Tom');
  await expect(page.getByLabel('Action 1', { exact: true })).toHaveValue(/send the security questionnaire/);
  await expect(page.getByLabel('Who does action 2')).toHaveValue('customer');
  // Nothing reaches the CRM before review.
  await expect(page.getByText(/Save the reviewed version first/)).toBeVisible();
  await expectNoA11yViolations(page);

  await page.getByLabel('Action 1', { exact: true }).fill('Send the security questionnaire to Tom');
  await page.getByLabel('Summary').fill('Kick-off for the ops pilot. SSO and audit log are must-haves; price is the main concern.');
  await page.getByRole('button', { name: 'Save reviewed version' }).click();
  await expect(page.getByText(/^Reviewed by /)).toBeVisible();

  await page.getByRole('button', { name: 'Create 1 task' }).click();
  await expect(page.getByText('1 task created from this meeting.')).toBeVisible();
  await expect(page.getByText('Task created', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Add summary to deal Pilot rollout' }).click();
  await expect(page.getByText('Summary added to the timeline of deal Pilot rollout.')).toBeVisible();

  await page.getByRole('button', { name: 'Write follow-up email' }).click();
  const dialog = page.getByRole('dialog', { name: 'New email' });
  await expect(dialog.getByLabel('Subject')).toHaveValue('Follow-up: Pilot kick-off');
  await expect(dialog.getByRole('textbox', { name: 'Message' })).toHaveValue(/Next steps:\n- send the security questionnaire/);
  await dialog.getByRole('button', { name: 'Cancel' }).click();

  await page.goto(`/app/deals/${deal.id}`);
  await expect(page.getByRole('main').getByRole('link', { name: 'Pilot kick-off', exact: true })).toBeVisible();
  await expect(page.getByText('Reviewed', { exact: true })).toBeVisible();
  await expect(page.getByText('Kick-off for the ops pilot.').first()).toBeVisible();
  await expect(page.getByText('Send the security questionnaire to Tom').first()).toBeVisible();

  await page.goto('/app/meetings');
  await expect(page.getByRole('link', { name: /Open notes\s+for Pilot kick-off/ })).toBeVisible();
});

test('starts notes for a call outside the calendar and deletes them', async ({ page }) => {
  await signUp(page, 'Meeting Notes');
  await page.goto('/app/meetings');
  await page.getByLabel('New notes for a call not in your calendar').fill('Phone call with Initech');
  await page.getByRole('button', { name: 'New meeting notes' }).click();
  await expect(page.getByRole('heading', { name: 'Phone call with Initech', level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Analyse with AI' })).toBeDisabled();
  await expect(page.getByText('Add notes, a transcript or a recording first.')).toBeVisible();
  await page.getByLabel('Notes or transcript').fill("Called Initech. They need a CSV import.\nI'll send the import guide this week.");
  await page.getByRole('button', { name: 'Save notes' }).click();
  await page.getByRole('button', { name: 'Analyse with AI' }).click();
  await page.getByRole('button', { name: 'Save reviewed version' }).click();
  await expect(page.getByRole('button', { name: 'Add summary to a record' })).toBeDisabled();
  await expect(page.getByText('Link a deal, contact or lead above first.')).toBeVisible();
  await expectNoA11yViolations(page);
  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'Delete notes' }).click();
  await expect(page).toHaveURL(/\/app\/meetings$/);
  await expect(page.getByText('No meeting notes yet.')).toBeVisible();
});
