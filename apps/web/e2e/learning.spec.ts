import { readFileSync } from 'node:fs';
import { join as joinPath } from 'node:path';
import { type APIRequestContext, type Browser, expect, type Page, test } from '@playwright/test';
import { signUp } from './helpers';

/*
 * Learning & Development (ADR 0097) in the browser, as three people: the Super Workspace, a manager and the
 * manager's executive. The manager builds a module from a written lesson, drafts its questions without AI, approves
 * them, publishes it and assigns it with a deadline. The executive reads the lesson, fails the assessment, sees why,
 * tries again and passes, gets the celebration and the certificate, and the certificate verifies on its public page.
 * The manager and the Super Workspace then see the result in reports.
 */

const ORIGIN = { origin: 'http://localhost:3000' };
const PREVIEW_DIR = process.env.PREVIEW_DIR;
const LESSON = readFileSync(joinPath(__dirname, '../../api/src/learning/fixtures/sales-communication.txt'), 'utf8');

test.use({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 }, deviceScaleFactor: PREVIEW_DIR ? 2 : 1 });

async function call<T = Record<string, unknown>>(req: APIRequestContext, method: 'get' | 'post' | 'put' | 'patch', path: string, data?: object): Promise<T> {
  const res = method === 'get' ? await req.get(`/api/v1${path}`) : await req[method](`/api/v1${path}`, { data: data ?? {}, headers: ORIGIN });
  expect(res.ok(), await res.text()).toBe(true);
  return res.json() as Promise<T>;
}

async function shot(page: Page, name: string, fullPage = false) {
  if (!PREVIEW_DIR) return;
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${PREVIEW_DIR}/${name}.png`, fullPage });
}

async function join(browser: Browser, inviteUrl: string, name: string): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: PREVIEW_DIR ? 2 : 1, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  const token = inviteUrl.split('/invite/')[1]!;
  const res = await page.request.post('/api/v1/auth/invitations/accept', { data: { token, name, password: 'a-long-password-1' }, headers: ORIGIN });
  expect(res.ok(), await res.text()).toBe(true);
  await page.goto('/app');
  await page.evaluate(() => localStorage.setItem('dealflow:preferences', JSON.stringify({ state: { theme: 'light', motion: 'off' }, version: 0 })));
  return page;
}

interface KeyQuestion {
  id: string;
  type: string;
  options: { id: string; text: string }[];
  correctOptionIds: string[];
  correctBoolean: boolean | null;
  blanks: string[][];
  pairs: { id: string; right: string }[];
  acceptedAnswers: string[];
}
interface Attempt {
  id: string;
  questions: { id: string; right: { id: string; text: string }[] }[];
}

/** Answers for every question of an attempt, right or wrong, from the module's answer key. */
function answersFor(key: KeyQuestion[], attempt: Attempt, right: boolean): Record<string, object> {
  const out: Record<string, object> = {};
  for (const q of attempt.questions) {
    const k = key.find((x) => x.id === q.id)!;
    if (k.type === 'MCQ' || k.type === 'MULTI') out[q.id] = { optionIds: right ? k.correctOptionIds : [k.options.find((o) => !k.correctOptionIds.includes(o.id))!.id] };
    else if (k.type === 'TRUE_FALSE') out[q.id] = { value: right ? k.correctBoolean : !k.correctBoolean };
    else if (k.type === 'FILL_BLANK') out[q.id] = { blanks: k.blanks.map((b) => (right ? b[0]! : 'no idea')) };
    else if (k.type === 'MATCHING') out[q.id] = { pairs: Object.fromEntries(k.pairs.map((p, i) => [p.id, (right ? q.right.find((r) => r.text === p.right) : q.right[(i + 1) % q.right.length])!.id])) };
    else out[q.id] = { text: right ? (k.acceptedAnswers[0] ?? 'answer') : 'something else' };
  }
  return out;
}

test('a manager builds and assigns a module, the executive fails, retries, passes and gets a certificate', async ({ page, browser }) => {
  test.setTimeout(240_000);
  const stamp = Date.now();
  await signUp(page, 'Frequent Research Learning');
  await page.evaluate(() => localStorage.setItem('dealflow:preferences', JSON.stringify({ state: { theme: 'light', motion: 'off' }, version: 0 })));
  const mw = await call<{ id: string; inviteUrl: string }>(page.request, 'post', '/workspaces', { level: 'MANAGER', name: 'UK Sales', designation: 'Sales Manager', person: { inviteEmail: `meera.${stamp}@example.com` } });
  await call(page.request, 'put', `/workspaces/${mw.id}/permissions`, { canCreateExecutives: true });
  const manager = await join(browser, mw.inviteUrl, 'Meera Kapoor');
  const ew = await call<{ id: string; inviteUrl: string }>(manager.request, 'post', '/workspaces', { level: 'EXECUTIVE', name: 'London Desk', designation: 'Sales Executive', person: { inviteEmail: `ravi.${stamp}@example.com` } });
  const exec = await join(browser, ew.inviteUrl, 'Ravi Patel');

  // ── The manager builds a module ──
  await manager.goto('/app');
  await manager.getByRole('navigation').getByRole('link', { name: 'Learning & Development' }).first().click();
  await expect(manager).toHaveURL(/\/app\/learning/);
  await manager.goto('/app/learning/manage');
  await expect(manager.locator('[data-learning-manage]')).toBeVisible();
  await manager.locator('[data-new-module]').first().click();
  await manager.getByLabel('Title').fill('Sales communication essentials');
  await manager.getByRole('button', { name: 'Create module' }).click();
  await expect(manager).toHaveURL(/\/app\/learning\/manage\/[a-z0-9]+/);
  const moduleId = manager.url().split('/').pop()!;
  await expect(manager.locator('[data-module-status="DRAFT"]')).toBeVisible();

  await manager.locator('[data-add-lesson="text"]').click();
  await manager.getByLabel('Lesson title').fill('Read: running a good sales conversation');
  await manager.getByLabel('Lesson text').fill(LESSON);
  await manager.getByRole('button', { name: 'Add lesson' }).click();
  await expect(manager.locator('[data-lesson-row="Read: running a good sales conversation"]')).toBeVisible();
  await shot(manager, '03-module-builder-lessons');

  await manager.locator('[data-tab="questions"]').click();
  await manager.locator('[data-run-generate]').click();
  await expect(manager.locator('[data-generate-result]')).toBeVisible();
  await expect(manager.locator('[data-review-queue]')).toBeVisible();
  await shot(manager, '04-questions-drafted-for-review');
  await manager.locator('[data-approve-all]').click();
  await expect(manager.locator('[data-review-queue]')).toHaveCount(0);
  await expect(manager.locator('[data-question-row]').first()).toBeVisible();
  await shot(manager, '05-questions-approved');

  // Pass mark 80%, three attempts.
  await call(manager.request, 'patch', `/learning/modules/${moduleId}`, { passingScore: 80, maxAttempts: 3 });
  await manager.reload();
  await expect(manager.locator('[data-publish-problems]')).toHaveCount(0);
  await manager.locator('[data-publish]').click();
  await expect(manager.locator('[data-module-status="PUBLISHED"]')).toBeVisible();

  await manager.locator('[data-tab="assign"]').click();
  await manager.locator('[data-assignee="Ravi Patel"]').check();
  const due = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
  await manager.locator('#a-due').fill(due);
  await manager.locator('[data-assign]').click();
  await expect(manager.locator('[data-assignment-row="Ravi Patel"]')).toBeVisible();
  await shot(manager, '06-assigned-with-deadline');

  // ── The executive learns ──
  await exec.goto('/app/learning');
  await expect(exec.locator('[data-learning-home]')).toBeVisible();
  const card = exec.locator('[data-module-card]').first();
  await expect(card).toContainText('Sales communication essentials');
  await shot(exec, '01-learning-home');
  await card.getByRole('link').first().click();
  await expect(exec.locator('[data-learning-player]')).toBeVisible();
  await expect(exec.locator('[data-reader]')).toBeVisible();
  await shot(exec, '07-lesson-player');
  // A written lesson is done when it has been read to the end.
  await exec.locator('[data-reader]').evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
  await expect(exec.locator('[data-lesson-pane]').getByText('Done', { exact: true })).toBeVisible();
  await exec.locator('[data-start-assessment]').click();
  await expect(exec).toHaveURL(/\/attempts\//);
  await expect(exec.locator('[data-assessment]')).toBeVisible();
  await shot(exec, '08-assessment');

  // Attempt 1: wrong answers, saved as the app saves them, submitted in the browser. The server marks it.
  const key = (await call<{ questionList: KeyQuestion[] }>(manager.request, 'get', `/learning/modules/${moduleId}`)).questionList;
  const a1 = await call<Attempt>(exec.request, 'get', `/learning/attempts/${exec.url().split('/').pop()}`);
  await call(exec.request, 'put', `/learning/attempts/${a1.id}/answers`, { answers: answersFor(key, a1, false) });
  await exec.reload();
  await exec.locator('[data-submit-answers]').click();
  await exec.locator('[data-confirm-submit]').click();
  await expect(exec.locator('[data-result="failed"]')).toBeVisible();
  await expect(exec.locator('[data-celebration]')).toHaveCount(0);
  await shot(exec, '09-result-not-passed-with-retry');

  // Attempt 2: right answers. A real pass: the celebration, then the certificate.
  await exec.locator('[data-retry]').click();
  await expect(exec).not.toHaveURL(new RegExp(a1.id));
  await expect(exec.locator('[data-assessment]')).toBeVisible();
  const a2 = await call<Attempt>(exec.request, 'get', `/learning/attempts/${exec.url().split('/').pop()}`);
  await call(exec.request, 'put', `/learning/attempts/${a2.id}/answers`, { answers: answersFor(key, a2, true) });
  await exec.reload();
  await exec.locator('[data-submit-answers]').click();
  await exec.locator('[data-confirm-submit]').click();
  await expect(exec.locator('[data-celebration]')).toBeVisible();
  // Let the confetti settle before the picture.
  if (PREVIEW_DIR) await exec.waitForTimeout(2500);
  await shot(exec, '10-passed-celebration');
  await exec.keyboard.press('Escape');
  await expect(exec.locator('[data-result="passed"]')).toBeVisible();
  await shot(exec, '11-result-passed');

  await exec.goto('/app/learning/certificates');
  const cert = exec.locator('[data-certificate]').first();
  await expect(cert).toBeVisible();
  await shot(exec, '12-certificates');
  await cert.click();
  await expect(exec.locator('[data-download-certificate]')).toBeVisible();
  await shot(exec, '13-certificate');
  const certId = (await call<{ certificate: { id: string } | null }>(exec.request, 'get', `/learning/modules/${moduleId}/player`)).certificate!.id;
  const full = await call<{ verifyUrl: string; status: string }>(exec.request, 'get', `/learning/certificates/${certId}`);
  const pdf = await exec.request.get(`/api/v1/learning/certificates/${certId}/pdf`);
  expect(pdf.headers()['content-type']).toContain('application/pdf');

  // Anyone with the code can check it, signed in or not.
  const visitor = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: PREVIEW_DIR ? 2 : 1 });
  await visitor.goto(new URL(full.verifyUrl).pathname);
  await expect(visitor.getByText('Ravi Patel').first()).toBeVisible();
  await expect(visitor.getByText('Sales communication essentials').first()).toBeVisible();
  await shot(visitor, '14-public-verification');

  await exec.goto('/app/learning');
  await exec.getByRole('tab', { name: 'Achievement dashboard' }).click();
  await expect(exec.locator('[data-achievement-dashboard]')).toBeVisible();
  await expect(exec.locator('[data-badge][data-earned="true"]').first()).toBeVisible();
  await exec.locator('[data-achievement-dashboard]').scrollIntoViewIfNeeded();
  await exec.evaluate(() => window.scrollBy(0, -120));
  await shot(exec, '02-achievement-dashboard');

  // ── The manager and the Super Workspace see it ──
  await manager.goto('/app/learning/manage');
  await expect(manager.locator('[data-person-row="Ravi Patel"]').or(manager.locator('[data-module-row]').first())).toBeVisible();
  await shot(manager, '15-learning-management');
  await page.goto('/app/learning/manage');
  await page.getByRole('tab', { name: 'Reports' }).click();
  await expect(page.locator('[data-learning-reports]')).toContainText('Ravi Patel');
  await page.locator('[data-learning-reports] table').scrollIntoViewIfNeeded();
  await shot(page, '16-super-workspace-reports');
  const xlsx = await page.request.get('/api/v1/learning/reports/export');
  expect(xlsx.ok()).toBe(true);
  expect(xlsx.headers()['content-type']).toContain('spreadsheetml');
});
