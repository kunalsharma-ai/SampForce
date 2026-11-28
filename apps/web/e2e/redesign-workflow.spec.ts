import AxeBuilder from '@axe-core/playwright';
import { type APIRequestContext, type Browser, expect, type Locator, type Page, test } from '@playwright/test';
import { signUp } from './helpers';

/*
 * The whole sales workflow of the redesign (R10, ADR 0094), start to end, as two people in their own browsers: a
 * manager adds a company and its employee, marks the initial email sent, does a follow-up, gets a reply, receives an
 * RFQ, wins it and marks the company won, which makes the won deal. The Super Workspace then marks another of the
 * manager's deals lost, and the manager hears about it in the bell. Last, the sound settings for notifications and
 * team chat.
 */

const ORIGIN = { origin: 'http://localhost:3000' };
const PREVIEW_DIR = process.env.PREVIEW_DIR;

test.use({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 }, deviceScaleFactor: PREVIEW_DIR ? 2 : 1 });

async function axe(page: Page, include?: string) {
  let b = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']);
  if (include) b = b.include(include);
  const r = await b.analyze();
  expect(r.violations.map((v) => `${v.id} ${v.nodes[0]?.target} ${v.nodes[0]?.failureSummary}`)).toEqual([]);
}

async function call(req: APIRequestContext, method: 'get' | 'post' | 'patch', path: string, data?: object) {
  const res = method === 'get' ? await req.get(`/api/v1${path}`) : await req[method](`/api/v1${path}`, { data: data ?? {}, headers: ORIGIN });
  expect(res.ok(), await res.text()).toBe(true);
  return res.json();
}

async function shot(page: Page, name: string) {
  if (!PREVIEW_DIR) return;
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${PREVIEW_DIR}/${name}.png` });
}

async function join(browser: Browser, inviteUrl: string, name: string): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: PREVIEW_DIR ? 2 : 1, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  const token = inviteUrl.split('/invite/')[1]!;
  const res = await page.request.post('/api/v1/auth/invitations/accept', { data: { token, name, password: 'a-long-password-1' }, headers: ORIGIN });
  expect(res.ok(), await res.text()).toBe(true);
  await page.goto('/app');
  await page.evaluate(() => {
    localStorage.setItem('dealflow:preferences', JSON.stringify({ state: { theme: 'light', motion: 'off' }, version: 0 }));
    localStorage.setItem('sf.companyMore', 'open');
  });
  return page;
}

const row = (section: Locator, name: string) => section.getByRole('row').filter({ has: section.page().getByRole('link', { name, exact: true }) });

test('a company goes from new lead to won deal, a lost deal reaches its owner, and the sounds can be set', async ({ page, browser }) => {
  test.setTimeout(240_000);
  const stamp = Date.now();
  await signUp(page, 'Frequent Research Workflow');
  await page.evaluate(() => localStorage.setItem('dealflow:preferences', JSON.stringify({ state: { theme: 'light', motion: 'off' }, version: 0 })));
  const m = await call(page.request, 'post', '/workspaces', { level: 'MANAGER', name: 'UK Sales', designation: 'Sales Manager', person: { inviteEmail: `rahul.${stamp}@example.com` } });
  const manager = await join(browser, m.inviteUrl, 'Rahul Sharma');

  // 1. The manager adds the company with its employee. The employee starts in Fresh Email Pending.
  const lead = await call(manager.request, 'post', '/company-leads', {
    company: { name: 'Northwind Panels Ltd', country: 'GB', city: 'London', website: 'https://northwind.example' },
    employees: [{ firstName: 'Priya', lastName: 'Nair', jobTitle: 'Head of Insights', emails: [{ value: 'priya@northwind.example' }] }],
  });
  const companyId = lead.company.id as string;
  const priya = lead.employeeIds[0] as string;
  await manager.goto(`/app/companies/${companyId}`);
  const section = manager.locator('#employee-activity');
  await expect(row(section, 'Priya Nair')).toContainText('Fresh Email Pending');

  // 2. The initial email went out eight days ago with no answer: the 7-day follow-up period has passed, so follow-up 1
  //    is created at once (ADR 0096).
  await call(manager.request, 'post', `/contacts/${priya}/initial-email`, { sentAt: new Date(Date.now() - 8 * 86_400_000).toISOString() });
  await manager.reload();
  await expect(row(section, 'Priya Nair')).toContainText('Initial Email Sent');
  await expect(row(section, 'Priya Nair')).toContainText(/Follow-up 1 of \d+, due/);
  await shot(manager, '01-initial-email-sent');

  // 3. Follow-up 1 is done, and follow-up 2 is planned.
  const cadence = await call(manager.request, 'get', `/contacts/${priya}/cadence`);
  await call(manager.request, 'post', `/follow-ups/${cadence.next.taskId}/complete`, { outcome: 'Sent the reminder' });
  await manager.reload();
  await expect(row(section, 'Priya Nair')).toContainText(/Follow-up 2 of \d+, due/);

  // 4. Priya replies: the cadence stops and the discussion is in progress.
  await call(manager.request, 'post', '/interactions', { companyId, contactId: priya, kind: 'EMAIL_RECEIVED', subject: 'Re: Introduction' });
  await manager.goto(`/app/contacts/${priya}`);
  const stage = manager.locator('#communication-stage');
  await expect(stage).toContainText('Cadence stopped: the contact replied');
  await expect(stage).toContainText('Discussion in Progress');
  await shot(manager, '02-reply-discussion');

  // 5. An RFQ arrives from her, and it is won.
  const rfq = await call(manager.request, 'post', '/rfqs', { companyId, contactId: priya, projectName: 'UK drivers survey', sampleSize: 400, cpi: 12.5, currency: 'GBP' });
  await call(manager.request, 'patch', `/rfqs/${rfq.id}`, { status: 'WON', actualRevenue: 5400 });

  // 6. Mark the company won: the won deal is made from the won RFQ.
  await manager.goto(`/app/companies/${companyId}`);
  await manager.getByRole('button', { name: 'Mark as won' }).click();
  const dialog = manager.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Mark as won' }).click();
  await expect(dialog.getByRole('status')).toContainText(/Deal DEAL-\d+ was made and marked won\./);
  await dialog.getByRole('link', { name: 'Open the deal' }).click();
  await expect(manager.getByRole('heading', { level: 1 })).toContainText('Northwind Panels Ltd: UK drivers survey');
  await expect(manager.locator('main')).toContainText('Won');
  await expect(manager.locator('main')).toContainText('5,400');
  await shot(manager, '03-won-deal');
  await manager.goto(`/app/companies/${companyId}`);
  await expect(manager.locator('main')).toContainText('Existing Client');

  // 7. Another of the manager's deals: the Super Workspace marks it lost on the deal page.
  const pipeline = ((await call(page.request, 'get', '/pipelines')) as { isDefault: boolean; stages: { id: string; category: string }[] }[]).find((p) => p.isDefault)!;
  const open = pipeline.stages.find((s) => s.category === 'OPEN')!.id;
  const other = await call(manager.request, 'post', '/company-leads', { company: { name: 'Contoso Fieldwork', country: 'GB' }, employees: [] });
  const deal = await call(manager.request, 'post', '/deals', { name: 'Contoso tracker', amount: 9000, currency: 'GBP', companyId: other.company.id, stageId: open, customFields: {} });
  await manager.goto('/app');
  const bell = manager.locator('[data-notification-bell]');
  await expect(bell).toBeVisible();

  await page.goto(`/app/deals/${deal.id}`);
  await page.getByRole('list', { name: 'Pipeline stages' }).getByRole('button', { name: /Closed Lost/ }).click();
  const lost = page.getByRole('dialog');
  await lost.getByLabel('Chose a competitor').check();
  await lost.getByRole('button', { name: 'Mark as lost' }).click();
  await expect(page.getByRole('list', { name: 'Pipeline stages' }).getByRole('button', { name: /Closed Lost/ })).toHaveAttribute('aria-current', 'step');

  // 8. The manager, with SampForce open, sees it arrive in the bell; the Super Workspace, who did it, does not.
  await bell.click();
  const panel = manager.getByRole('dialog', { name: 'Notifications' });
  await expect(panel.locator('[data-notification="deal.lost"]')).toContainText('Deal lost: Contoso tracker', { timeout: 20_000 });
  await axe(manager, '[role="dialog"]');
  await shot(manager, '04-deal-lost-notification');
  await manager.keyboard.press('Escape');
  const superNotes = await call(page.request, 'get', '/notifications?limit=100');
  expect((superNotes.items as { type: string }[]).some((n) => n.type === 'deal.lost')).toBe(false);

  // 9. Sound settings: every category, the new ones included, and the team chat chime, which stays off once switched off.
  await manager.goto('/app/notifications#preferences');
  for (const key of ['deal_lost', 'deal_won', 'task_updates', 'team_status']) await expect(manager.locator(`[data-sound-category="${key}"]`)).toBeVisible();
  const chat = manager.locator('[data-chat-sound-setting] input');
  await expect(chat).toBeChecked();
  await chat.uncheck();
  await manager.reload();
  await expect(manager.locator('[data-chat-sound-setting] input')).not.toBeChecked();
  await axe(manager);
  if (PREVIEW_DIR) {
    await manager.locator('[data-chat-sound-setting]').evaluate((n) => n.scrollIntoView({ block: 'center' }));
    await shot(manager, '05-sound-settings');
  }
});
