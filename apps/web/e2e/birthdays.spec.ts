import { execFileSync } from 'node:child_process';
import AxeBuilder from '@axe-core/playwright';
import { type Browser, expect, type Page, test } from '@playwright/test';
import { approveMobile, E2E_DATABASE_URL, signUp } from './helpers';

/**
 * Birthdays (ADR 0087): a person adds their date of birth on My profile, keeps or shares the year, and on the day
 * everyone in the organisation sees a celebration on their dashboard, can send wishes in team chat, and the Console
 * and the phone app celebrate too.
 */
const ORIGIN = { origin: 'http://localhost:3000' };
const APP = 'http://localhost:8090';
const API = 'http://localhost:4000';
/** Set PREVIEW_DIR to save screenshots of each screen (used for previews). */
const PREVIEW_DIR = process.env.PREVIEW_DIR;

test.use({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 }, deviceScaleFactor: PREVIEW_DIR ? 2 : 1 });

async function shot(page: Page, name: string, clip?: { x: number; y: number; width: number; height: number }) {
  if (!PREVIEW_DIR) return;
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${PREVIEW_DIR}/${name}.png`, clip });
}

async function axe(page: Page) {
  const r = await new AxeBuilder({ page }).include('[data-birthdays]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(r.violations.map((v) => `${v.id} ${v.nodes[0]?.target} ${v.nodes[0]?.failureSummary}`)).toEqual([]);
}

/** A teammate in the signed-in workspace; returns their browser context and user id. */
async function teammate(browser: Browser, page: Page, name: string) {
  const inv = await (await page.request.post('/api/v1/tenants/current/invitations', { headers: ORIGIN, data: { email: `${name.split(' ')[0]!.toLowerCase()}-${Date.now()}@example.com`, roleKey: 'member' } })).json();
  const ctx = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 }, deviceScaleFactor: PREVIEW_DIR ? 2 : 1 });
  const res = await ctx.request.post('/api/v1/auth/invitations/accept', { headers: ORIGIN, data: { token: inv.inviteUrl.split('/invite/')[1], name, password: 'a-long-password-1' } });
  expect(res.ok(), await res.text()).toBe(true);
  const me = await (await ctx.request.get('/api/v1/auth/me')).json();
  return { ctx, id: me.user.id as string };
}

/** A small round picture drawn in the browser, so the celebration shows a photo. */
async function photo(page: Page, colour: string): Promise<Buffer> {
  return Buffer.from(
    await page.evaluate(async (c) => {
      const el = document.createElement('canvas');
      el.width = el.height = 256;
      const g = el.getContext('2d')!;
      g.fillStyle = c;
      g.fillRect(0, 0, 256, 256);
      g.fillStyle = '#f1c7a3';
      g.beginPath();
      g.arc(128, 110, 52, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#1f2937';
      g.beginPath();
      g.ellipse(128, 260, 100, 80, 0, 0, Math.PI * 2);
      g.fill();
      const blob = await new Promise<Blob>((r) => el.toBlob((b) => r(b!), 'image/jpeg', 0.9));
      return [...new Uint8Array(await blob.arrayBuffer())];
    }, colour),
  );
}

test('a birthday is celebrated on every dashboard, with wishes, in the Console and on the phone', async ({ page, browser }) => {
  test.setTimeout(180_000);
  const now = new Date();
  const day = now.getDate();
  const month = now.getMonth() + 1;
  const owner = await signUp(page, `Birthday Org ${Date.now().toString(36)}`);
  await approveMobile(page);

  // Priya shares her birthday (today) and her age; Arjun has no birthday today.
  const priya = await teammate(browser, page, 'Priya Nair');
  const arjun = await teammate(browser, page, 'Arjun Mehta');
  const pp = await priya.ctx.newPage();
  await pp.goto('/app');
  expect((await priya.ctx.request.put('/api/v1/me/photo', { headers: { ...ORIGIN, 'content-type': 'image/jpeg' }, data: await photo(pp, '#ec4899') })).ok()).toBe(true);
  expect((await priya.ctx.request.put('/api/v1/me/profile', { headers: ORIGIN, data: { birthday: { day, month, year: 1994 }, birthYearVisible: true } })).ok()).toBe(true);

  // The owner adds their own date of birth on My profile, keeping the year private.
  await page.goto('/app/profile');
  const card = page.locator('[data-profile-birthday]');
  await card.scrollIntoViewIfNeeded();
  await card.getByLabel('Month', { exact: true }).selectOption(String(month));
  await card.getByLabel('Day', { exact: true }).selectOption(String(day));
  await card.getByLabel('Year (optional)').fill('1990');
  await expect(card.getByLabel('Show my birth year and age')).not.toBeChecked();
  await expect(card.getByLabel('Celebrate my birthday with my team')).toBeChecked();
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.getByRole('button', { name: 'Save profile' })).toBeDisabled();
  await shot(page, '01-my-profile-birthday', { x: 0, y: 0, width: 1440, height: 900 });
  const mine = await (await page.request.get('/api/v1/me/profile')).json();
  expect(mine).toMatchObject({ birthday: { day, month, year: 1990 }, birthYearVisible: false, celebrateBirthday: true });

  // On the owner's dashboard: their own celebration first, with Priya too.
  await page.goto('/app');
  const party = page.locator('[data-birthdays]');
  await expect(party).toHaveAttribute('data-birthday-self', 'yes');
  await expect(party.locator('[data-birthday-title]')).toHaveText('Happy birthday, Test!');
  await expect(party.locator('[data-birthday-line]')).toContainText('You turn');
  await expect(party.locator('[data-birthday-also]')).toHaveText('Also celebrating today: Priya Nair');
  await axe(page);
  await shot(page, '02-workspace-your-birthday', { x: 0, y: 0, width: 1440, height: 760 });

  // Arjun's dashboard: two birthdays, the owner's age kept private, and wishes sent to Priya in team chat.
  const ap = await arjun.ctx.newPage();
  await ap.goto('/app');
  const theirs = ap.locator('[data-birthdays]');
  await expect(theirs).toHaveAttribute('data-birthday-self', 'no');
  await expect(theirs.locator('[data-birthday-title]')).toHaveText('2 birthdays today!');
  await expect(theirs.locator('[data-birthday-line]')).toContainText('Priya Nair');
  await expect(theirs.locator('[data-birthday-line]')).not.toContainText('36');
  await theirs.getByRole('button', { name: 'Wish Priya' }).click();
  await expect(theirs.locator(`[data-wishes-sent="${priya.id}"]`)).toHaveText('Wishes sent to Priya');
  await axe(ap);
  await shot(ap, '03-workspace-teammates-birthdays', { x: 0, y: 0, width: 1440, height: 760 });
  // Priya gets the wishes in her chat.
  const convs = await (await priya.ctx.request.get('/api/v1/chat/conversations')).json();
  const dm = (convs.items ?? convs).find((c: { kind: string; title: string }) => c.kind === 'DIRECT' && c.title === 'Arjun Mehta');
  expect(dm).toBeTruthy();
  const msgs = await (await priya.ctx.request.get(`/api/v1/chat/conversations/${dm.id}/messages`)).json();
  expect(JSON.stringify(msgs)).toContain('Happy birthday, Priya!');
  // The wishes stay sent after a reload.
  await ap.reload();
  await expect(ap.locator(`[data-wishes-sent="${priya.id}"]`)).toBeVisible();

  // The Console: the operator with the owner's email sees their own birthday on the Overview.
  execFileSync('node', ['-r', '@swc-node/register', 'scripts/create-operator.ts'], {
    cwd: '../api',
    env: { ...process.env, DATABASE_URL: E2E_DATABASE_URL, OPERATOR_EMAIL: owner.email, OPERATOR_PASSWORD: 'operator-password-1', OPERATOR_NAME: 'Test Person', OPERATOR_ROLE: 'ADMIN' },
  });
  const ops = await (await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 }, deviceScaleFactor: PREVIEW_DIR ? 2 : 1 })).newPage();
  await ops.goto('/operator/login');
  await ops.getByLabel('Email').fill(owner.email);
  await ops.getByLabel('Password').fill('operator-password-1');
  await ops.getByRole('button', { name: 'Sign in' }).click();
  await expect(ops.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible({ timeout: 15_000 });
  const consoleParty = ops.locator('[data-birthdays]');
  await expect(consoleParty.locator('[data-birthday-title]')).toHaveText('Happy birthday, Test!');
  await expect(consoleParty.getByRole('button', { name: /^Wish / })).toHaveCount(0);
  await shot(ops, '04-console-birthday', { x: 0, y: 0, width: 1440, height: 760 });

  // The phone app's home screen.
  const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: PREVIEW_DIR ? 3 : 1, reducedMotion: 'reduce', locale: 'en-GB' })).newPage();
  await phone.goto(APP);
  await phone.getByLabel('Email').fill(owner.email);
  await phone.getByLabel('Password').fill(owner.password);
  await phone.getByRole('button', { name: 'Use another server' }).click();
  await phone.getByLabel('Server address').fill(API);
  await phone.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(phone.getByText('🎉 Happy birthday, Test!')).toBeVisible({ timeout: 15_000 });
  await expect(phone.getByText('Also celebrating today: Priya Nair')).toBeVisible();
  await shot(phone, '05-phone-birthday');

  // Turning the celebration off keeps the birthday private: teammates no longer see it.
  expect((await page.request.put('/api/v1/me/profile', { headers: ORIGIN, data: { celebrateBirthday: false } })).ok()).toBe(true);
  await ap.reload();
  await expect(ap.locator('[data-birthday-title]')).toHaveText("It's Priya Nair's birthday today!");
  await expect(ap.locator('[data-birthday-line]')).toHaveText('Priya turns 32 today. Send your wishes and make the day special.'.replace('32', String(now.getFullYear() - 1994)));
});
