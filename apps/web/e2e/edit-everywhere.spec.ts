import AxeBuilder from '@axe-core/playwright';
import { type APIRequestContext, expect, type Page, test } from '@playwright/test';
import { signUp } from './helpers';

const ORIGIN = { origin: 'http://localhost:3000' };
/** Set PREVIEW_DIR to save screenshots of each screen (used for phase previews). */
const PREVIEW_DIR = process.env.PREVIEW_DIR;

test.use({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 }, deviceScaleFactor: PREVIEW_DIR ? 2 : 1 });

async function axe(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(r.violations.map((v) => `${v.id} ${v.nodes[0]?.target} ${v.nodes[0]?.failureSummary}`)).toEqual([]);
}

async function shot(page: Page, name: string) {
  if (!PREVIEW_DIR) return;
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${PREVIEW_DIR}/${name}.png` });
}

async function post(req: APIRequestContext, path: string, data: object) {
  const res = await req.post(`/api/v1${path}`, { data, headers: ORIGIN });
  expect(res.ok(), await res.text()).toBe(true);
  return res.json();
}

/** Edit everywhere (ADR 0065): each record that used to be create-only can be edited, and the edit is saved. */
test('edits interactions, follow-ups, files, concerns, timeline activities and tasks, and they stay edited', async ({ page }) => {
  test.setTimeout(180_000);
  await signUp(page, 'Frequent Research Fieldwork Solutions');
  const main = page.getByRole('main');
  const dialog = page.getByRole('dialog');

  const lead = await post(page.request, '/company-leads', {
    company: { name: 'Acme Panels Pvt Ltd', country: 'IN', city: 'Pune' },
    employees: [{ firstName: 'Priya', lastName: 'Nair', jobTitle: 'Procurement Lead' }, { firstName: 'Ravi', lastName: 'Kumar', jobTitle: 'Research Director' }],
  });
  const companyId = lead.company.id as string;
  await post(page.request, '/interactions', { companyId, contactId: lead.employeeIds[0], kind: 'CALL_OUTGOING', subject: 'Intro call', outcome: 'No answer' });
  await post(page.request, '/follow-ups', { companyId, type: 'CALL', title: 'Call back Priya', dueAt: new Date(Date.now() + 2 * 86_400_000).toISOString() });
  await post(page.request, '/client-concerns', { companyId, category: 'PRICING', title: 'Price is above budget', severity: 'MEDIUM' });
  const up = await page.request.post(`/api/v1/companies/${companyId}/files?name=brief.pdf`, { data: Buffer.from('%PDF-1.4 brief'), headers: { ...ORIGIN, 'content-type': 'application/pdf' } });
  expect(up.ok()).toBe(true);

  // ─── Company page: interaction ───
  await page.goto(`/app/companies/${companyId}`);
  const interactions = page.locator('#company-interactions');
  await expect(interactions).toContainText('Intro call');
  await interactions.getByRole('button', { name: 'Edit “Intro call”' }).click();
  await expect(dialog.getByRole('heading', { name: 'Edit interaction' })).toBeVisible();
  await expect(dialog.getByLabel('Subject *')).toHaveValue('Intro call');
  await dialog.getByLabel('Interaction type').selectOption('MEETING');
  await dialog.getByLabel('Employee').selectOption({ label: 'Ravi Kumar' });
  await dialog.getByLabel('Subject *').fill('Capabilities meeting');
  await dialog.getByLabel('Outcome').fill('Wants a proposal by Friday');
  await expect(dialog.getByLabel('Follow-up date')).toHaveCount(0);
  await shot(page, '01-edit-interaction');
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(interactions).toContainText('Capabilities meeting');
  await expect(interactions).toContainText('Outcome: Wants a proposal by Friday');
  await expect(interactions).toContainText('Ravi Kumar');
  await expect(interactions).toContainText('(edited)');
  await expect(interactions).not.toContainText('Intro call');

  // ─── Company page: follow-up ───
  const followUps = page.locator('#company-follow-ups');
  await followUps.getByRole('button', { name: 'Edit “Call back Priya”' }).click();
  await expect(dialog.getByRole('heading', { name: 'Edit follow-up' })).toBeVisible();
  await expect(dialog.getByLabel('What is it about?')).toHaveValue('Call back Priya');
  await dialog.getByLabel('What is it about?').fill('Call Priya about the proposal');
  await dialog.getByLabel('Priority').selectOption('HIGH');
  await dialog.getByLabel('Required next action').fill('Confirm the sample size');
  await shot(page, '02-edit-follow-up');
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(followUps).toContainText('Call Priya about the proposal');
  await expect(followUps).toContainText('High priority');
  await expect(followUps).toContainText('Next action: Confirm the sample size');

  // ─── Company page: client concern ───
  const concerns = page.getByTestId('concerns-mine');
  await concerns.getByRole('button', { name: 'Edit “Price is above budget”' }).click();
  await expect(dialog.getByRole('heading', { name: 'Edit client concern' })).toBeVisible();
  await dialog.getByLabel('Title').fill('Quote is 15% above their budget');
  await dialog.getByLabel('Severity').selectOption('HIGH');
  await dialog.getByLabel('Employee (optional)').selectOption({ label: 'Priya Nair' });
  await shot(page, '03-edit-client-concern');
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(concerns).toContainText('Quote is 15% above their budget');
  await expect(concerns).toContainText('Priya Nair');

  // ─── Company page: rename a file ───
  const files = page.locator('#company-files');
  await files.getByRole('button', { name: 'Rename brief.pdf' }).click();
  await files.getByLabel('File name', { exact: true }).fill('Acme brief 2026.pdf');
  await shot(page, '04-rename-file');
  await files.getByRole('button', { name: 'Save file name' }).click();
  await expect(files.getByRole('link', { name: 'Acme brief 2026.pdf', exact: true })).toBeVisible();
  await axe(page);

  // Everything is saved: a reload shows the edits.
  await page.reload();
  await expect(interactions).toContainText('Capabilities meeting');
  await expect(followUps).toContainText('Call Priya about the proposal');
  await expect(concerns).toContainText('Quote is 15% above their budget');
  await expect(files.getByRole('link', { name: 'Acme brief 2026.pdf', exact: true })).toBeVisible();

  // ─── Lead timeline: a logged note ───
  const person = (await post(page.request, '/leads', { fullName: 'Lena Ortiz', email: `lena-${Date.now()}@example.com` })).lead;
  await post(page.request, '/activities', { type: 'NOTE', subject: 'First chat', body: 'Draft notes', leadId: person.id });
  await page.goto(`/app/leads/${person.id}`);
  await main.getByRole('button', { name: /^Edit “.*First chat.*”$/ }).click();
  await expect(dialog.getByRole('heading', { name: 'Edit activity' })).toBeVisible();
  await expect(dialog.getByLabel('Subject *')).toHaveValue('First chat');
  await dialog.getByLabel('Activity type').selectOption('CALL');
  await dialog.getByLabel('Subject *').fill('Discovery call');
  await dialog.getByLabel('Details').fill('Needs 400 completes in India');
  await shot(page, '05-edit-timeline-activity');
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(dialog).toHaveCount(0);
  const timeline = main.getByRole('list', { name: 'Timeline, newest first' });
  await expect(timeline).toContainText('Discovery call');
  await expect(timeline).toContainText('Needs 400 completes in India');
  await expect(timeline).not.toContainText('First chat');

  // ─── Activities page: a task and a recent activity ───
  await post(page.request, '/tasks', { title: 'Send deck', dueAt: new Date(Date.now() + 86_400_000).toISOString() });
  await page.goto('/app/activities');
  await main.getByRole('button', { name: 'Edit “Send deck”' }).click();
  await expect(dialog.getByRole('heading', { name: 'Edit task' })).toBeVisible();
  await dialog.getByLabel('Title *').fill('Send the India capabilities deck');
  await dialog.getByLabel('Priority').selectOption('HIGH');
  await dialog.getByLabel('Details').fill('Use the 2026 version');
  await shot(page, '06-edit-task');
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(main).toContainText('Send the India capabilities deck');
  await expect(main.getByText('High priority').first()).toBeVisible();
  await expect(main).toContainText('Discovery call');
  await expect(main).toContainText('(edited)');
  await axe(page);
  await shot(page, '07-activities-after-edit');
});

test('a manager edits a sent instruction and a requester edits a pending transfer request', async ({ page, browser }) => {
  test.setTimeout(180_000);
  await signUp(page, 'Frequent Research Fieldwork Solutions');
  const dialog = page.getByRole('dialog');

  // Rahul reports to the signed-in manager.
  const inv = await post(page.request, '/tenants/current/invitations', { email: `rahul-${Date.now()}@example.com`, roleKey: 'member' });
  const ctx = await browser.newContext({ baseURL: 'http://localhost:3000', viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce', deviceScaleFactor: PREVIEW_DIR ? 2 : 1 });
  await ctx.request.post('/api/v1/auth/invitations/accept', { data: { token: inv.inviteUrl.split('/invite/')[1], name: 'Rahul Verma', password: 'a-long-password-1' }, headers: ORIGIN });
  const members = (await (await page.request.get('/api/v1/tenants/current/members')).json()) as Array<{ membershipId: string; userId: string; name: string }>;
  const designations = (await (await page.request.get('/api/v1/crm-config/designations')).json()) as Array<{ id: string; name: string }>;
  const d = (n: string) => designations.find((x) => x.name === n)!.id;
  const me = members.find((m) => m.name === 'Test Person')!;
  const rahul = members.find((m) => m.name === 'Rahul Verma')!;
  const patch = (m: { membershipId: string }, data: object) => page.request.patch(`/api/v1/tenants/current/members/${m.membershipId}/org`, { data, headers: ORIGIN });
  expect((await patch(me, { designationId: d('Business Development Manager') })).ok()).toBe(true);
  expect((await patch(rahul, { designationId: d('Business Development Executive'), reportingManagerId: me.userId })).ok()).toBe(true);

  const lead = await post(page.request, '/company-leads', { company: { name: 'Crest Insights Ltd', country: 'GB', city: 'London' } });
  await post(page.request, '/instructions', { toUserId: rahul.userId, message: 'Call Crest today', companyId: lead.company.id, priority: 'NORMAL' });
  await post(page.request, '/lead-transfers', { companyId: lead.company.id, toUserId: rahul.userId, reason: 'HIGH_VALUE', remarks: 'Rahul knows the buyer' });

  await page.goto('/app?view=manager');
  await expect(page.getByRole('heading', { name: 'Manager dashboard', level: 1 })).toBeVisible();

  // ─── Instruction ───
  const sent = page.getByTestId('instructions-sent');
  await sent.getByRole('button', { name: 'Edit “Call Crest today”' }).click();
  await expect(dialog.getByRole('heading', { name: 'Edit instruction' })).toBeVisible();
  await expect(dialog.getByLabel('To')).toBeDisabled();
  await dialog.getByLabel('Message').fill('Call Crest before 3 pm and confirm the budget');
  await dialog.getByLabel('Priority').selectOption('URGENT');
  await shot(page, '08-edit-instruction');
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(sent).toContainText('Call Crest before 3 pm and confirm the budget');
  await expect(sent).toContainText('(edited)');

  // Rahul sees the new wording.
  const rp = await ctx.newPage();
  await rp.goto('/app');
  await expect(rp.getByTestId('instructions-received')).toContainText('Call Crest before 3 pm and confirm the budget');
  await expect(rp.getByTestId('instructions-received').getByRole('button', { name: /^Edit/ })).toHaveCount(0);

  // ─── Lead transfer request ───
  const mine = page.getByTestId('transfers-mine');
  await mine.getByRole('button', { name: 'Edit “Crest Insights Ltd”' }).click();
  await expect(dialog.getByRole('heading', { name: 'Edit transfer request' })).toBeVisible();
  await expect(dialog.getByLabel('Remarks')).toHaveValue('Rahul knows the buyer');
  await dialog.getByLabel('Reason').selectOption('TECHNICAL');
  await dialog.getByLabel('Opportunity value').fill('25000');
  await dialog.getByLabel('Remarks').fill('Rahul ran their last technical study');
  await shot(page, '09-edit-transfer-request');
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(mine).toContainText('Rahul ran their last technical study');
  await expect(mine).toContainText('(edited)');
  await axe(page);

  await page.reload();
  await expect(page.getByTestId('instructions-sent')).toContainText('Call Crest before 3 pm');
  await expect(page.getByTestId('transfers-mine')).toContainText('Rahul ran their last technical study');
  await ctx.close();
});
