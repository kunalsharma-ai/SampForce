import AxeBuilder from '@axe-core/playwright';
import { type APIRequestContext, expect, type Page, test } from '@playwright/test';
import { signUp } from './helpers';

const ORIGIN = { origin: 'http://localhost:3000' };
/** Set PREVIEW_DIR to save full-page screenshots of each screen (used for phase previews). */
const PREVIEW_DIR = process.env.PREVIEW_DIR;

test.use({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 }, deviceScaleFactor: PREVIEW_DIR ? 2 : 1 });

async function axe(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(r.violations.map((v) => `${v.id} ${v.nodes[0]?.target} ${v.nodes[0]?.failureSummary}`)).toEqual([]);
}

async function shot(page: Page, name: string) {
  if (!PREVIEW_DIR) return;
  const height = await page.evaluate(() => Math.max(document.documentElement.scrollHeight, document.querySelector('main')?.scrollHeight ?? 0));
  await page.setViewportSize({ width: 1440, height: Math.min(Math.max(height, 900), 3600) });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${PREVIEW_DIR}/${name}.png` });
  await page.setViewportSize({ width: 1440, height: 900 });
}

async function post(req: APIRequestContext, path: string, data: object) {
  const res = await req.post(`/api/v1${path}`, { data, headers: ORIGIN });
  expect(res.ok(), await res.text()).toBe(true);
  return res.json();
}

test('a manager runs their team from the manager dashboard: instructions, follow-ups and client concerns', async ({ page, browser }) => {
  test.setTimeout(180_000);
  await signUp(page, 'Frequent Research Fieldwork Solutions');
  const main = page.getByRole('main');

  // Rahul and Anita are executives reporting to the signed-in manager.
  const people: Record<string, { ctx: Awaited<ReturnType<typeof browser.newContext>>; userId?: string }> = {};
  for (const [key, name] of [['rahul', 'Rahul Verma'], ['anita', 'Anita Desai']] as const) {
    const inv = await post(page.request, '/tenants/current/invitations', { email: `${key}-${Date.now()}@example.com`, roleKey: 'member' });
    const ctx = await browser.newContext({ baseURL: 'http://localhost:3000', viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce', deviceScaleFactor: PREVIEW_DIR ? 2 : 1 });
    await ctx.request.post('/api/v1/auth/invitations/accept', { data: { token: inv.inviteUrl.split('/invite/')[1], name, password: 'a-long-password-1' }, headers: ORIGIN });
    people[key] = { ctx };
  }
  const members = (await (await page.request.get('/api/v1/tenants/current/members')).json()) as Array<{ membershipId: string; userId: string; name: string }>;
  const designations = (await (await page.request.get('/api/v1/crm-config/designations')).json()) as Array<{ id: string; name: string }>;
  const d = (n: string) => designations.find((x) => x.name === n)!.id;
  const me = members.find((m) => m.name === 'Test Person')!;
  const patch = (m: { membershipId: string }, data: object) => page.request.patch(`/api/v1/tenants/current/members/${m.membershipId}/org`, { data, headers: ORIGIN });
  expect((await patch(me, { designationId: d('Business Development Manager') })).ok()).toBe(true);
  for (const name of ['Rahul Verma', 'Anita Desai']) {
    const m = members.find((x) => x.name === name)!;
    expect((await patch(m, { designationId: d('Business Development Executive'), reportingManagerId: me.userId })).ok()).toBe(true);
  }
  const rahulId = members.find((m) => m.name === 'Rahul Verma')!.userId;

  // Their real work: leads, an email waiting for a reply, an overdue follow-up and won deals.
  const r = people.rahul!.ctx.request;
  const a = people.anita!.ctx.request;
  const lead = await post(r, '/company-leads', { company: { name: 'Acme Panels Pvt Ltd', country: 'IN', city: 'Pune' }, employees: [{ firstName: 'Priya', lastName: 'Nair', jobTitle: 'Procurement Lead' }] });
  const companyId = lead.company.id as string;
  await post(r, '/interactions', { companyId, contactId: lead.employeeIds[0], kind: 'EMAIL_SENT', subject: 'India B2B proposal' });
  await post(r, '/follow-ups', { companyId, contactId: lead.employeeIds[0], type: 'CALL', title: 'Chase Priya on the proposal', dueAt: new Date(Date.now() - 2 * 3_600_000).toISOString() });
  const lead2 = await post(a, '/company-leads', { company: { name: 'Crest Insights Ltd', country: 'GB', city: 'London' } });
  await post(a, '/company-leads', { company: { name: 'Delta Fieldwork GmbH', country: 'DE', city: 'Berlin' } });
  const stages = (await (await r.get('/api/v1/pipelines')).json())[0].stages as { id: string; category: string }[];
  const open = stages.find((s) => s.category === 'OPEN')!.id;
  const won = stages.find((s) => s.category === 'WON')!.id;
  const deal = await post(r, '/deals', { name: 'India B2B study', amount: 12000, companyId, stageId: open });
  await post(r, `/deals/${deal.id}/move`, { stageId: won });
  const deal2 = await post(a, '/deals', { name: 'UK tracker', amount: 7000, companyId: lead2.company.id, stageId: open });
  await post(a, `/deals/${deal2.id}/move`, { stageId: won });
  const month = new Date().toISOString().slice(0, 7);
  for (const [userId, amount] of [[rahulId, 20000], [members.find((m) => m.name === 'Anita Desai')!.userId, 10000]] as const)
    expect((await page.request.put('/api/v1/command-center/targets', { data: { period: month, userId, amount }, headers: ORIGIN })).ok()).toBe(true);

  // The manager opens on the manager dashboard.
  await page.goto('/app?view=manager');
  await expect(main.getByRole('heading', { name: 'Manager dashboard', level: 1 })).toBeVisible();
  await expect(main.getByText('2 reporting employees', { exact: false })).toBeVisible();
  const kpis = main.getByRole('list', { name: 'Team metrics' });
  await expect(kpis.getByRole('button', { name: 'Leads generated: 3. Show the records' })).toBeVisible();
  await expect(kpis.getByRole('button', { name: 'Revenue generated: $19,000. Show the records' })).toBeVisible();
  await expect(page.getByTestId('team-target')).toContainText('$19,000 of $30,000');
  const table = page.getByTestId('team-table');
  await expect(table.locator(`[data-person="${rahulId}"]`)).toContainText('$12,000');
  await expect(page.locator('[data-monitor="teamOverdue"]')).toContainText('Chase Priya on the proposal');
  await expect(page.locator('[data-monitor="teamAwaiting"]')).toContainText('Priya Nair');
  await axe(page);
  await shot(page, '09-manager-dashboard');

  // Comparison by revenue contribution.
  await main.getByLabel('Compare by').selectOption({ label: 'Revenue contribution' });
  await expect(main.getByRole('heading', { name: 'Revenue contribution' })).toBeVisible();
  await page.locator('[data-section="team.compare"]').scrollIntoViewIfNeeded();
  await expect(page.getByTestId('team-revenue')).toContainText('Team total');

  // Raise the overdue follow-up's priority.
  await page.locator('[data-monitor="teamOverdue"]').getByRole('button', { name: 'Actions for Chase Priya on the proposal' }).click();
  await page.getByRole('menuitem', { name: 'Reassign or change priority' }).click();
  await page.getByRole('dialog').getByLabel('Priority').selectOption('HIGH');
  await shot(page, '10-manager-reassign-follow-up');
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // Send Rahul an instruction from the team table.
  await table.getByRole('button', { name: 'Send an instruction to Rahul Verma' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Message').fill('Call Priya today and confirm the sample size');
  await dialog.getByLabel('Priority').selectOption('HIGH');
  await shot(page, '11-manager-send-instruction');
  await dialog.getByRole('button', { name: 'Send' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId('instructions-sent')).toContainText('Call Priya today');

  // Rahul sees it on his dashboard and in the bell, acknowledges it and marks it done.
  const rp = await people.rahul!.ctx.newPage();
  // The company page's lower panels (client concerns) start open for this suite, as signUp does for the owner.
  await rp.addInitScript(() => localStorage.setItem('sf.companyMore', 'open'));
  await rp.goto('/app');
  const received = rp.getByTestId('instructions-received');
  await expect(received).toContainText('Call Priya today and confirm the sample size');
  await expect(received).toContainText('From Test Person');
  await received.getByRole('button', { name: 'Acknowledge' }).click();
  await expect(received).toContainText('Acknowledged');
  await shot(rp, '12-executive-instruction');
  await received.getByRole('button', { name: 'Mark done' }).click();
  await rp.getByRole('dialog').getByLabel('What was done (optional)').fill('Spoke to Priya, 400 completes agreed');
  await rp.getByRole('dialog').getByRole('button', { name: 'Mark done' }).click();
  await expect(rp.getByRole('dialog')).toHaveCount(0);

  // Rahul raises a pricing concern on the company and escalates it to his manager.
  await rp.goto(`/app/companies/${companyId}`);
  await rp.getByRole('main').getByRole('toolbar', { name: 'Quick actions' }).getByRole('button', { name: 'Raise concern' }).click();
  const cd = rp.getByRole('dialog');
  await cd.getByLabel('Concern category').selectOption('PRICING');
  await cd.getByLabel('Severity').selectOption('HIGH');
  await cd.getByLabel('Title').fill('Quote is 15% above their budget');
  await cd.getByLabel('Employee (optional)').selectOption({ label: 'Priya Nair' });
  await shot(rp, '13-raise-concern');
  await cd.getByRole('button', { name: 'Raise concern' }).click();
  await expect(cd).toHaveCount(0);
  const list = rp.getByTestId('concerns-mine');
  await expect(list).toContainText('Quote is 15% above their budget');
  await list.getByRole('button', { name: 'Escalate' }).click();
  await rp.getByRole('dialog').getByLabel('Note').fill('Needs a pricing decision from you');
  await rp.getByRole('dialog').getByRole('button', { name: 'Escalate' }).click();
  await expect(list).toContainText('Escalated to Test Person');

  // The manager sees the done instruction, and the concern waiting for them; they resolve it.
  await page.reload();
  await expect(page.locator('[data-monitor="intervention"]')).toContainText('Quote is 15% above their budget');
  const team = page.getByTestId('concerns-team');
  await expect(team).toContainText('Quote is 15% above their budget');
  await page.getByRole('button', { name: 'Show done too' }).first().click();
  await expect(page.getByTestId('instructions-sent')).toContainText('Spoke to Priya, 400 completes agreed');
  await axe(page);
  await shot(page, '14-manager-concerns-and-instructions');
  await team.getByRole('button', { name: 'Resolve' }).click();
  await page.getByRole('dialog').getByLabel('Final remarks').fill('Agreed a 5% discount for a two-wave study');
  await page.getByRole('dialog').getByRole('button', { name: 'Resolve' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(team).toHaveCount(0);

  // Selecting a name opens that person's own dashboard.
  await table.getByRole('button', { name: 'Open the dashboard of Rahul Verma' }).click();
  await expect(main.getByRole('heading', { name: 'Executive dashboard', level: 1 })).toBeVisible();
  await expect(main.getByRole('heading', { name: 'Rahul Verma' })).toBeVisible();
  await expect(main.getByText('$12,000 of $20,000 (60%)')).toBeVisible();
  for (const p of Object.values(people)) await p.ctx.close();
});
