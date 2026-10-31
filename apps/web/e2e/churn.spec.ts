import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { signUp } from './helpers';

const ORIGIN = { origin: 'http://localhost:3000' };
const DAY = 86_400_000;
const ymd = (d: number) => new Date(Date.now() + d * DAY).toISOString().slice(0, 10);

async function apiCall(page: Page, method: 'post' | 'get', path: string, data?: object) {
  const res = await page.request[method](`/api/v1${path}`, { data, headers: ORIGIN });
  expect(res.ok(), `${method} ${path} → ${res.status()}`).toBe(true);
  return res.json();
}

test('filters customers by churn risk, plans follow-ups and drafts an AI briefing', async ({ page }) => {
  await signUp(page, 'Churn Watch');
  const stages = (await apiCall(page, 'get', '/pipelines'))[0].stages as { id: string; category: string }[];
  const customer = async (name: string, endInDays: number) => {
    const company = await apiCall(page, 'post', '/companies', { name });
    const contract = await apiCall(page, 'post', '/contracts', { name: `${name} plan`, companyId: company.id, value: 12000, startDate: ymd(-300), endDate: ymd(endInDays) });
    await apiCall(page, 'post', `/contracts/${contract.id}/sign`, { signedBy: 'X', signedAt: ymd(-300), method: 'wet_ink' });
    return company.id as string;
  };
  const risky = await customer('Globex', 20);
  const steady = await customer('Initrode', 300);
  await apiCall(page, 'post', '/contacts', { firstName: 'Hank', lastName: 'Scorpio', companyId: risky });
  await apiCall(page, 'post', '/success/escalations', { companyId: risky, title: 'Exports failing', severity: 'HIGH' });
  const deal = await apiCall(page, 'post', '/deals', { name: 'Globex add-on', amount: 3000, stageId: stages[0]!.id, companyId: risky });
  await apiCall(page, 'post', `/deals/${deal.id}/move`, { stageId: stages.find((s) => s.category === 'LOST')!.id, lossReason: 'Budget' });
  await apiCall(page, 'post', '/activities', { type: 'CALL', subject: 'Quarterly review', companyId: steady });

  await page.goto('/app/customer-success');
  await expect(page.getByRole('heading', { name: 'Churn risk over time' })).toBeVisible();
  const counts = page.getByRole('group', { name: 'Customers by churn risk' });
  await counts.getByRole('button', { name: /High churn risk/ }).click();
  await expect(page.getByText('Showing 1 of 2')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Globex', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Initrode' })).toHaveCount(0);
  await expect(page.getByText('Recently lost a deal:')).toBeVisible();
  const steps = page.getByRole('list', { name: 'Suggested retention steps for Globex' });
  await expect(steps.getByText('Agree a fix date for the open escalation and tell the customer')).toBeVisible();
  await page.waitForLoadState('networkidle');
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);

  await page.getByLabel('Churn risk', { exact: true }).selectOption('');
  await expect(page.getByText('Showing 2 of 2')).toBeVisible();
  await page.getByLabel('Churn risk', { exact: true }).selectOption('healthy');
  await expect(page.getByRole('link', { name: 'Initrode' })).toBeVisible();
  await page.getByLabel('Churn risk', { exact: true }).selectOption('at_risk');

  await page.getByRole('button', { name: 'AI briefing' }).click();
  const brief = page.getByRole('region', { name: 'AI briefing' });
  await expect(brief.getByText(/^Globex has high churn risk/)).toBeVisible();
  await expect(brief.getByText('AI draft')).toBeVisible();

  await page.getByRole('button', { name: 'Plan follow-ups' }).click();
  const dialog = page.getByRole('dialog', { name: 'Follow-up schedule' });
  await dialog.getByLabel('Contact').selectOption({ label: 'Hank Scorpio' });
  const total = await dialog.getByRole('list', { name: 'Follow-ups to create' }).getByRole('listitem').count();
  expect(total).toBeGreaterThan(4);
  await dialog.getByLabel('Create follow-up 2').uncheck();
  await dialog.getByLabel('Follow-up 1 title').fill('Call Hank about the export fix');
  await dialog.getByRole('button', { name: `Create ${total - 1} tasks` }).click();
  await expect(dialog.getByText(`${total - 1} tasks created.`)).toBeVisible();

  const tasks = (await apiCall(page, 'get', '/tasks')) as { title: string; priority: string }[];
  expect(tasks.find((t) => t.title === 'Call Hank about the export fix')).toMatchObject({ priority: 'HIGH' });
  expect(tasks).toHaveLength(total - 1);
});
