import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { signUp } from './helpers';

/**
 * AI screens against the local Claude fixture (see playwright.config.ts). These prove the screens,
 * permission checks and confirm-before-change flow work; they say nothing about real model answers.
 */
const ORIGIN = { origin: 'http://localhost:3000' };

async function apiPost(page: Page, path: string, data: object) {
  const res = await page.request.post(`/api/v1${path}`, { data, headers: ORIGIN });
  expect(res.ok(), `${path} → ${res.status()}`).toBe(true);
  return res.json();
}

async function expectNoA11yViolations(page: Page) {
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(300);
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

test('Copilot answers from CRM data and only changes things after confirmation', async ({ page }) => {
  await signUp(page, 'Copilot Co');
  const lead = (await apiPost(page, '/leads', { fullName: 'Ada Lovelace', email: 'ada@example.com' })).lead;

  await page.getByRole('button', { name: 'Copilot', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'SampForce Copilot' });
  await expect(panel).toBeVisible();
  await panel.getByRole('button', { name: 'Summarise my open pipeline.' }).click();
  await expect(panel.getByText(/This is a rule-based projection/)).toBeVisible();
  await expectNoA11yViolations(page);

  await panel.getByLabel('Ask Copilot').fill('Create a task to call Ada Lovelace tomorrow');
  await panel.getByRole('button', { name: 'Ask' }).click();
  await expect(panel.getByText('Proposed change')).toBeVisible();
  await expect(panel.getByText(/waiting for your confirmation/)).toBeVisible();

  // Nothing exists until the person confirms.
  const before = await (await page.request.get(`/api/v1/tasks?scope=all&leadId=${lead.id}`)).json();
  expect(before).toHaveLength(0);
  await panel.getByRole('button', { name: 'Confirm' }).click();
  await expect(panel.getByText('Done.')).toBeVisible();
  const after = await (await page.request.get(`/api/v1/tasks?scope=all&leadId=${lead.id}`)).json();
  expect(after.map((t: { title: string }) => t.title)).toEqual(['Call Ada Lovelace']);
});

test('AI Agents page shows status and lets an owner switch AI off', async ({ page }) => {
  await signUp(page, 'Agents Co');
  await page.goto('/app/agents');
  await expect(page.getByRole('heading', { level: 1, name: 'AI Agents' })).toBeVisible();
  await expect(page.getByText('API key set')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Lead Qualification' })).toBeVisible();
  await expectNoA11yViolations(page);

  await page.getByRole('button', { name: 'Turn off all AI' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'AI is switched off for this workspace.' })).toBeVisible();
  await page.getByRole('button', { name: 'Copilot', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'SampForce Copilot' }).getByLabel('Ask Copilot')).toBeDisabled();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Turn AI back on' }).click();
  await expect(page.getByRole('button', { name: 'Turn off all AI' })).toBeVisible();
});

test('lead scoring, deal health and meeting notes on record pages', async ({ page }) => {
  await signUp(page, 'Records AI');
  const lead = (await apiPost(page, '/leads', { fullName: 'Grace Hopper', email: 'grace@navy.example', phone: '+1 555 0100', companyName: 'Navy', jobTitle: 'Director', estimatedValue: 80000 })).lead;
  await page.goto(`/app/leads/${lead.id}`);
  await page.getByRole('button', { name: 'Score lead' }).click();
  await expect(page.getByText(/^Grade [ABCD]$/)).toBeVisible();
  await expect(page.getByText('Call this week to confirm budget and timing.')).toBeVisible();
  await expectNoA11yViolations(page);

  const pipelines = await (await page.request.get('/api/v1/pipelines')).json();
  const stage = pipelines[0].stages.find((s: { category: string }) => s.category === 'OPEN');
  const deal = await apiPost(page, '/deals', { name: 'Navy rollout', amount: 50000, stageId: stage.id });
  await page.goto(`/app/deals/${deal.id}`);
  await page.getByRole('button', { name: 'Check health' }).click();
  await expect(page.getByText(/^(Low|Medium|High) risk$/)).toBeVisible();
  await page.getByRole('button', { name: /Create task \(due in/ }).click();
  await expect(page.getByText('Task created.')).toBeVisible();

  await page.getByRole('button', { name: 'Meeting notes' }).click();
  await expect(page.getByRole('heading', { name: 'Meeting notes', level: 1 })).toBeVisible();
  await page.getByLabel('Notes or transcript').fill("Speaker 0: Hi, I'm Priya.\nSpeaker 1: I'm Tom. We need SSO before rollout.\nSpeaker 0: I'll send the security questionnaire by Friday.\nSpeaker 0: We'll book a demo for the ops team.");
  await page.getByRole('button', { name: 'Save notes' }).click();
  await page.getByRole('button', { name: 'Analyse with AI' }).click();
  await expect(page.getByLabel('Action 1', { exact: true })).toHaveValue(/send the security questionnaire/);
  await page.getByRole('button', { name: 'Save reviewed version' }).click();
  await page.getByRole('button', { name: 'Create 2 tasks' }).click();
  await expect(page.getByText('2 tasks created from this meeting.')).toBeVisible();
  await expectNoA11yViolations(page);
});

test('forecast, snapshots and the AI workflow draft', async ({ page }) => {
  await signUp(page, 'Forecast UI');
  const pipelines = await (await page.request.get('/api/v1/pipelines')).json();
  const stage = pipelines[0].stages.find((s: { category: string }) => s.category === 'OPEN');
  const today = new Date().toISOString().slice(0, 10);
  await apiPost(page, '/deals', { name: 'Big commit', amount: 20000, probability: 80, stageId: stage.id, expectedCloseDate: today });
  await apiPost(page, '/deals', { name: 'Maybe deal', amount: 10000, probability: 50, stageId: stage.id, expectedCloseDate: today });

  await page.goto('/app/forecasting');
  await expect(page.getByRole('heading', { level: 1, name: 'Forecasting' })).toBeVisible();
  await expect(page.getByText('$21,000').first()).toBeVisible(); // weighted and base = 16,000 + 5,000
  await page.getByRole('button', { name: 'Take snapshot' }).click();
  await expect(page.getByText('Base $21,000', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Recompute' }).click();
  await expect(page.getByText('Totals match')).toBeVisible();
  await expectNoA11yViolations(page);

  await page.goto('/app/automation');
  await page.getByLabel('Describe the workflow').fill('When a new lead comes in, create a call task for the owner.');
  await page.getByRole('button', { name: 'Draft workflow' }).click();
  await expect(page).toHaveURL(/\/app\/automation\/new\?draft=ai/);
  await expect(page.getByText('Drafted by AI from your description.')).toBeVisible();
  await expect(page.getByLabel('Name')).toHaveValue('Call new leads');
  await expect(page.getByLabel('Task title')).toHaveValue('Call {{record.fullName}}');
});
