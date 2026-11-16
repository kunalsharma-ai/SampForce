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
  await page.setViewportSize({ width: 1440, height: Math.min(Math.max(height, 900), 3200) });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${PREVIEW_DIR}/${name}.png` });
  await page.setViewportSize({ width: 1440, height: 900 });
}

async function post(req: APIRequestContext, path: string, data: object) {
  const res = await req.post(`/api/v1${path}`, { data, headers: ORIGIN });
  expect(res.ok(), await res.text()).toBe(true);
  return res.json();
}

test('an executive works from their dashboard, asks for a lead transfer, and their manager decides it', async ({ page, browser }) => {
  test.setTimeout(150_000);
  await signUp(page, 'Frequent Research Fieldwork Solutions');
  const main = page.getByRole('main');

  // Rahul is an executive reporting to the signed-in manager.
  const email = `rahul-${Date.now()}@example.com`;
  const inv = await post(page.request, '/tenants/current/invitations', { email, roleKey: 'member' });
  const rahulCtx = await browser.newContext({ baseURL: 'http://localhost:3000', viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce', deviceScaleFactor: PREVIEW_DIR ? 2 : 1 });
  await rahulCtx.request.post('/api/v1/auth/invitations/accept', { data: { token: inv.inviteUrl.split('/invite/')[1], name: 'Rahul Verma', password: 'a-long-password-1' }, headers: ORIGIN });
  const members = (await (await page.request.get('/api/v1/tenants/current/members')).json()) as Array<{ membershipId: string; userId: string; name: string }>;
  const designations = (await (await page.request.get('/api/v1/crm-config/designations')).json()) as Array<{ id: string; name: string }>;
  const d = (n: string) => designations.find((x) => x.name === n)!.id;
  const me = members.find((m) => m.name === 'Test Person')!;
  const rahul = members.find((m) => m.name === 'Rahul Verma')!;
  const patch = (m: { membershipId: string }, data: object) => page.request.patch(`/api/v1/tenants/current/members/${m.membershipId}/org`, { data, headers: ORIGIN });
  expect((await patch(me, { designationId: d('Business Development Manager') })).ok()).toBe(true);
  expect((await patch(rahul, { designationId: d('Business Development Executive'), reportingManagerId: me.userId })).ok()).toBe(true);

  // Rahul's real work: a company lead, interactions (one positive), a follow-up due today and a won deal.
  const r = rahulCtx.request;
  const lead = await post(r, '/company-leads', { company: { name: 'Acme Panels Pvt Ltd', country: 'IN', city: 'Pune' }, employees: [{ firstName: 'Priya', lastName: 'Nair', jobTitle: 'Procurement Lead' }] });
  const companyId = lead.company.id as string;
  const [priya] = lead.employeeIds as string[];
  await post(r, '/interactions', { companyId, contactId: priya, kind: 'EMAIL_SENT', subject: 'Capabilities deck' });
  await post(r, '/interactions', { companyId, contactId: priya, kind: 'EMAIL_RECEIVED', subject: 'Re: Capabilities deck', sentiment: 'POSITIVE' });
  const later = new Date(Date.now() + 60 * 60 * 1000);
  const today = new Date().getDate() === later.getDate() ? later : new Date();
  await post(r, '/follow-ups', { companyId, contactId: priya, type: 'CALL', title: 'Call Priya about the India B2B study', dueAt: today.toISOString() });
  const stages = (await (await r.get('/api/v1/pipelines')).json())[0].stages as { id: string; category: string }[];
  const deal = await post(r, '/deals', { name: 'India B2B study', amount: 12000, companyId, stageId: stages.find((s) => s.category === 'OPEN')!.id });
  await post(r, `/deals/${deal.id}/move`, { stageId: stages.find((s) => s.category === 'WON')!.id });

  // Rahul opens on the executive dashboard: every number comes from those records and opens them.
  const rp = await rahulCtx.newPage();
  const rmain = rp.getByRole('main');
  await rp.goto('/app');
  await expect(rmain.getByRole('heading', { name: 'Executive dashboard', level: 1 })).toBeVisible();
  await expect(rmain.getByRole('heading', { name: 'Rahul Verma' })).toBeVisible();
  await expect(rmain.getByRole('heading', { name: 'Welcome, Rahul' })).toHaveCount(0);
  const kpis = rmain.getByRole('list', { name: 'Key metrics' });
  await expect(kpis.getByRole('button', { name: 'Leads generated: 1. Show the records' })).toBeVisible();
  await expect(kpis.getByRole('button', { name: 'Positive responses: 1. Show the records' })).toBeVisible();
  await expect(kpis.getByRole('button', { name: 'Revenue generated: $12,000. Show the records' })).toBeVisible();
  await expect(rp.locator('[data-work="today"]')).toContainText('Call Priya about the India B2B study');
  await expect(rp.getByTestId('revenue-lines')).toContainText('Acme Panels Pvt Ltd');
  await axe(rp);
  await shot(rp, '01-executive-dashboard');

  await kpis.getByRole('button', { name: 'Leads generated: 1. Show the records' }).click();
  const drill = rp.getByRole('dialog');
  await expect(drill.getByRole('heading', { name: 'Leads generated' })).toBeVisible();
  await expect(drill.getByTestId('cc-drill-rows')).toContainText('Acme Panels Pvt Ltd');
  await shot(rp, '02-kpi-drill-down');
  await rp.keyboard.press('Escape');

  // The revenue record: who holds which share of the deal.
  await rp.getByTestId('revenue-lines').getByRole('button', { name: 'Acme Panels Pvt Ltd' }).click();
  await expect(drill.getByTestId('record-credits')).toContainText('Rahul Verma');
  await expect(drill.getByTestId('record-credits')).toContainText('100%');
  await shot(rp, '03-revenue-record');
  await rp.keyboard.press('Escape');

  // Customising hides a section for Rahul only.
  await rmain.getByRole('button', { name: 'Customise' }).click();
  await drill.getByRole('button', { name: 'Hide Business performance' }).click();
  await drill.getByLabel('Name').fill('LinkedIn follow-ups');
  await drill.getByLabel('Follow-up type').selectOption('LINKEDIN');
  await drill.getByRole('button', { name: 'Add category' }).click();
  await shot(rp, '04-customise');
  await drill.getByRole('button', { name: 'Save layout' }).click();
  await expect(rp.locator('[data-section="exec.performance"]')).toHaveCount(0);
  await expect(rp.locator('[data-work^="cat:"]')).toContainText('LinkedIn follow-ups');

  // Rahul asks for the lead to go to his manager, from the company page.
  await rp.goto(`/app/companies/${companyId}`);
  await rmain.getByRole('toolbar', { name: 'Quick actions' }).getByRole('button', { name: 'Request transfer' }).click();
  await drill.getByLabel('Reason').selectOption('HIGH_VALUE');
  await drill.getByLabel('Opportunity value').fill('50000');
  await drill.getByLabel('Remarks').fill('Needs a senior on the pricing call');
  await shot(rp, '05-request-transfer');
  await drill.getByRole('button', { name: 'Send request' }).click();
  await expect(drill).toHaveCount(0);
  await expect(rp.getByTestId('company-transfers')).toContainText('Waiting for a decision');
  await rp.goto('/app');
  await expect(rp.getByTestId('transfers-mine')).toContainText('Needs a senior on the pricing call');

  // The manager decides from their own executive dashboard, where the request waits.
  await page.goto('/app?view=executive');
  await expect(main.getByRole('heading', { name: 'Executive dashboard', level: 1 })).toBeVisible();
  const box = page.getByTestId('transfers-toDecide');
  await expect(box).toContainText('Acme Panels Pvt Ltd');
  await axe(page);
  await shot(page, '06-manager-transfer-waiting');
  await box.getByRole('button', { name: 'Decide' }).click();
  await page.getByRole('dialog').getByLabel('Instructions for the new owner').fill('I will take the pricing call on Thursday');
  await shot(page, '07-transfer-decision');
  await page.getByRole('dialog').getByRole('button', { name: 'Save decision' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // The lead moved; Rahul stays its creator and sees the approval.
  const company = await (await page.request.get(`/api/v1/companies/${companyId}`)).json();
  expect(company).toMatchObject({ ownerPerson: { id: me.userId }, createdBy: { id: rahul.userId } });
  await rp.reload();
  await expect(rp.getByTestId('transfers-mine')).toContainText('Approved');

  // The manager opens Rahul's dashboard and sets his target.
  await page.getByLabel('Whose dashboard').selectOption({ label: 'Rahul Verma' });
  await expect(main.getByRole('heading', { name: 'Rahul Verma' })).toBeVisible();
  await main.getByRole('button', { name: 'Set target' }).click();
  await page.getByRole('dialog').getByLabel('Amount').fill('20000');
  await page.getByRole('dialog').getByRole('button', { name: 'Save target' }).click();
  await expect(main.getByText('$12,000 of $20,000 (60%)')).toBeVisible();
  await shot(page, '08-manager-views-report');
  await rahulCtx.close();
});
