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

async function shot(page: Page, name: string, full = true) {
  if (!PREVIEW_DIR) return;
  const height = full ? await page.evaluate(() => Math.max(document.documentElement.scrollHeight, document.querySelector('main')?.scrollHeight ?? 0)) : 900;
  await page.setViewportSize({ width: 1440, height: Math.min(Math.max(height, 900), 4200) });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${PREVIEW_DIR}/${name}.png` });
  await page.setViewportSize({ width: 1440, height: 900 });
}

async function post(req: APIRequestContext, path: string, data: object) {
  const res = await req.post(`/api/v1${path}`, { data, headers: ORIGIN });
  expect(res.ok(), await res.text()).toBe(true);
  return res.json();
}

test('senior management sees the organisation: departments, rankings, revenue down to the deal, and insights', async ({ page, browser }) => {
  test.setTimeout(180_000);
  await signUp(page, 'Frequent Research Fieldwork Solutions');
  const main = page.getByRole('main');

  // Neha manages Business Development (Rahul and Anita report to her); Omar sells on his own in Sales.
  const ctxs: Awaited<ReturnType<typeof browser.newContext>>[] = [];
  const req: Record<string, APIRequestContext> = {};
  for (const [key, name] of [['neha', 'Neha Kapoor'], ['rahul', 'Rahul Verma'], ['anita', 'Anita Desai'], ['omar', 'Omar Haddad']] as const) {
    const inv = await post(page.request, '/tenants/current/invitations', { email: `${key}-${Date.now()}@example.com`, roleKey: key === 'neha' ? 'manager' : 'member' });
    const ctx = await browser.newContext({ baseURL: 'http://localhost:3000' });
    await ctx.request.post('/api/v1/auth/invitations/accept', { data: { token: inv.inviteUrl.split('/invite/')[1], name, password: 'a-long-password-1' }, headers: ORIGIN });
    ctxs.push(ctx);
    req[key] = ctx.request;
  }
  const members = (await (await page.request.get('/api/v1/tenants/current/members')).json()) as Array<{ membershipId: string; userId: string; name: string }>;
  const designations = (await (await page.request.get('/api/v1/crm-config/designations')).json()) as Array<{ id: string; name: string }>;
  const departments = (await (await page.request.get('/api/v1/crm-config/departments')).json()) as Array<{ id: string; name: string }>;
  const des = (n: string) => designations.find((x) => x.name === n)!.id;
  const dep = (n: string) => departments.find((x) => x.name === n)!.id;
  const m = (n: string) => members.find((x) => x.name === n)!;
  const org = (name: string, data: object) => page.request.patch(`/api/v1/tenants/current/members/${m(name).membershipId}/org`, { data, headers: ORIGIN });
  expect((await org('Neha Kapoor', { designationId: des('Business Development Manager'), departmentId: dep('Business Development'), reportingManagerId: m('Test Person').userId })).ok()).toBe(true);
  for (const n of ['Rahul Verma', 'Anita Desai']) expect((await org(n, { designationId: des('Business Development Executive'), departmentId: dep('Business Development'), reportingManagerId: m('Neha Kapoor').userId })).ok()).toBe(true);
  expect((await org('Omar Haddad', { designationId: des('Business Development Executive'), departmentId: dep('Sales'), reportingManagerId: m('Test Person').userId })).ok()).toBe(true);

  // Their real work this month.
  const stages = (await (await page.request.get('/api/v1/pipelines')).json())[0].stages as { id: string; category: string }[];
  const open = stages.find((s) => s.category === 'OPEN')!.id;
  const won = stages.find((s) => s.category === 'WON')!.id;
  const win = async (r: APIRequestContext, name: string, amount: number, companyId: string) => {
    const deal = await post(r, '/deals', { name, amount, companyId, stageId: open });
    await post(r, `/deals/${deal.id}/move`, { stageId: won });
  };
  const acme = (await post(req.rahul!, '/company-leads', { company: { name: 'Acme Panels Pvt Ltd', country: 'IN', city: 'Pune', industry: 'Market research' } })).company.id;
  for (const n of ['Bolt Surveys', 'Cobalt Insights', 'Dune Analytics', 'Ember Data', 'Flint Research']) await post(req.rahul!, '/company-leads', { company: { name: n, country: 'IN' } });
  await win(req.rahul!, 'India B2B study', 12000, acme);
  for (const p of ['India B2B wave 2', 'India B2B wave 3']) await post(req.rahul!, '/rfqs', { companyId: acme, projectName: p, methodology: 'CATI', deadlineAt: new Date(Date.now() + 3 * 86_400_000).toISOString() });
  for (let i = 0; i < 5; i++) await post(req.rahul!, '/follow-ups', { companyId: acme, type: 'CALL', title: `Chase Acme ${i + 1}`, dueAt: new Date(Date.now() - (i + 2) * 3_600_000).toISOString() });
  const crest = (await post(req.anita!, '/company-leads', { company: { name: 'Crest Insights Ltd', country: 'GB', city: 'London', industry: 'Healthcare' } })).company.id;
  await win(req.anita!, 'UK tracker', 7000, crest);
  const helix = (await post(req.omar!, '/company-leads', { company: { name: 'Helix Data GmbH', country: 'DE', city: 'Berlin', industry: 'Automotive' } })).company.id;
  await win(req.omar!, 'Germany panel', 4000, helix);
  const month = new Date().toISOString().slice(0, 7);
  for (const [n, amount] of [['Rahul Verma', 20000], ['Anita Desai', 10000], ['Omar Haddad', 8000]] as const)
    expect((await page.request.put('/api/v1/command-center/targets', { data: { period: month, userId: m(n).userId, amount }, headers: ORIGIN })).ok()).toBe(true);
  expect((await page.request.put('/api/v1/command-center/targets', { data: { period: month, userId: null, amount: 50000 }, headers: ORIGIN })).ok()).toBe(true);

  // The owner opens on the senior management dashboard.
  await page.goto('/app?view=senior');
  await expect(main.getByRole('heading', { name: 'Senior management dashboard', level: 1 })).toBeVisible();
  await expect(page.getByTestId('org-target')).toContainText('$23,000 of $50,000');
  const kpis = main.getByRole('list', { name: 'Organisation metrics' });
  await expect(kpis.getByRole('button', { name: 'Leads generated: 8. Show the records' })).toBeVisible();
  await expect(kpis.getByRole('button', { name: 'Revenue generated: $23,000. Show the records' })).toBeVisible();
  await expect(kpis.getByRole('button', { name: /^Overall conversion rate: 37\.5%/ })).toBeVisible();
  const depts = page.getByTestId('org-departments');
  await expect(depts.locator(`[data-department="${dep('Business Development')}"]`)).toContainText('$19,000');
  await expect(depts.locator(`[data-manager="${m('Neha Kapoor').userId}"]`)).toContainText('$19,000');
  await expect(depts.locator(`[data-department="${dep('Sales')}"]`)).toContainText('$4,000');
  await expect(page.locator('[data-leader="revenue"]')).toContainText('Rahul Verma');
  await expect(page.locator('[data-insight="overdueFollowUps"]')).toContainText('Rahul Verma');
  await expect(page.locator('[data-insight="repeatRfqs"]')).toContainText('Acme Panels Pvt Ltd');
  await expect(page.locator('[data-insight="rfqDeadlines"]')).toContainText('India B2B wave 2');
  await axe(page);
  await shot(page, '15-senior-dashboard');

  // Rankings: the balanced score by default, or any single measure.
  await page.locator('[data-section="org.rankings"]').scrollIntoViewIfNeeded();
  await main.getByLabel('Rank by').selectOption({ label: 'Leads generated' });
  await expect(page.getByTestId('org-ranking').locator('tbody tr').first()).toContainText('Rahul Verma');
  await shot(page, '16-senior-rankings', false);

  // Revenue: break it down by country, then drill from a department to its deals.
  await page.locator('[data-section="org.revenue"]').scrollIntoViewIfNeeded();
  const breakdown = page.getByTestId('org-revenue-breakdown');
  await main.getByLabel('Break down by').selectOption({ label: 'Country' });
  await expect(breakdown.locator('tbody tr').first()).toContainText('India');
  await expect(breakdown.locator('tbody tr').first()).toContainText('$12,000');
  await shot(page, '17-senior-revenue', false);
  await main.getByLabel('Break down by').selectOption({ label: 'Department' });
  await breakdown.getByRole('button', { name: 'Business Development' }).click();
  const drill = page.getByRole('dialog');
  await expect(drill).toContainText('India B2B study');
  await expect(drill).toContainText('UK tracker');
  await expect(drill).not.toContainText('Germany panel');
  await shot(page, '18-senior-revenue-drill', false);
  await page.keyboard.press('Escape');

  // One department at a time.
  await main.getByLabel('Department', { exact: true }).selectOption({ label: 'Sales' });
  await expect(main.getByRole('heading', { name: 'Sales', level: 2 })).toBeVisible();
  await expect(kpis.getByRole('button', { name: 'Revenue generated: $4,000. Show the records' })).toBeVisible();
  await shot(page, '19-senior-one-department', false);

  // A manager's row opens that manager's team dashboard.
  await main.getByLabel('Department', { exact: true }).selectOption({ label: 'All departments' });
  await depts.getByRole('button', { name: 'Open the team dashboard of Neha Kapoor' }).click();
  await expect(main.getByRole('heading', { name: 'Manager dashboard', level: 1 })).toBeVisible();
  await expect(main.getByRole('heading', { name: 'Neha Kapoor' })).toBeVisible();
  await expect(page.getByTestId('team-table').locator(`[data-person="${m('Rahul Verma').userId}"]`)).toContainText('$12,000');
  for (const c of ctxs) await c.close();
});
