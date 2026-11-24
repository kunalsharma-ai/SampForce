import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { approveMobile, signUp } from './helpers';

/** Set PREVIEW_DIR to save screenshots of the app at phone size (used for previews). */
const PREVIEW_DIR = process.env.PREVIEW_DIR;
const APP = 'http://localhost:8090';
const API = 'http://localhost:4000';
const ORIGIN = 'http://localhost:3000';

const shot = async (page: Page, name: string) => {
  if (PREVIEW_DIR) await page.screenshot({ path: `${PREVIEW_DIR}/${name}.png` });
};

async function expectNoA11yViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

/**
 * The phone's Notification Center and sign-in (ADR 0075, part 4), from the app's web export against the real API:
 * the Executive scene greets and names the workspace in bold, the eye shows the password, a wrong password draws the
 * red cross, the right one the green tick and the welcome; then the bell, the tab badge, the home card and the banner
 * that slides down when something new arrives.
 */
test('the phone signs in on its animated scene and shows notifications in the bell, the tabs, the home screen and a banner', async ({ page, browser }) => {
  test.setTimeout(150_000);
  await signUp(page, `Phone Bell ${Date.now().toString(36)}`);
  await approveMobile(page);
  const ws = await page.request.post('/api/v1/workspaces', { data: { level: 'EXECUTIVE', name: 'Field Desk', person: { inviteEmail: `bell.${Date.now().toString(36)}@client.test` } }, headers: { origin: ORIGIN } });
  const desk = (await ws.json()) as { id: string; inviteUrl: string };
  const token = desk.inviteUrl.split('/invite/')[1]!;
  const guest = await browser.newContext();
  expect((await guest.request.post(`${API}/api/v1/auth/invitations/accept`, { data: { token, name: 'Priya Shah', password: 'a-long-password-1' }, headers: { origin: ORIGIN } })).status()).toBe(200);
  const me = (await (await guest.request.get(`${API}/api/v1/auth/me`)).json()) as { user: { id: string; email: string } };
  // Two tasks for Priya before she opens the app: the Tasks tab and the bell count them.
  for (const title of ['Call the five new research leads', 'Read the onboarding pack'])
    expect((await page.request.post('/api/v1/assigned-tasks', { data: { title, workspaceId: desk.id }, headers: { origin: ORIGIN } })).ok()).toBe(true);

  const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: PREVIEW_DIR ? 3 : 1, locale: 'en-GB' })).newPage();
  await phone.goto(APP);
  // The scene: greeting with the workspace in bold, and the badge on the sign-in box.
  await expect(phone.getByTestId('scene-greeting-executive')).toContainText(/Good (morning|afternoon|evening)! Welcome to Executive Workspace/);
  await expect(phone.getByTestId('workspace-badge-executive')).toContainText('You’re signing in toExecutive WorkspaceFor sales executives');
  await expect(phone.getByTestId('scene-stage-executive')).toHaveCount(1);
  await phone.getByLabel('Email').fill('not-an-email');
  await phone.getByLabel('Password').focus();
  await expect(phone.getByText('Enter a valid email address.')).toBeVisible();
  await phone.getByLabel('Email').fill(me.user.email);
  await phone.getByLabel('Password').fill('the-wrong-password');
  await phone.getByRole('button', { name: 'Show characters' }).click();
  await expect(phone.getByLabel('Password')).not.toHaveAttribute('type', 'password');
  await phone.getByRole('button', { name: 'Hide characters' }).click();
  await expect(phone.getByLabel('Password')).toHaveAttribute('type', 'password');
  await expect(phone.getByRole('link', { name: 'Forgot your password?' })).toBeVisible();
  await phone.getByRole('button', { name: 'Use another server' }).click();
  await phone.getByLabel('Server address').fill(API);
  await shot(phone, '40-app-sign-in-scene');
  await expectNoA11yViolations(phone);
  await phone.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(phone.getByTestId('sign-in-cross')).toBeVisible();
  await shot(phone, '41-app-sign-in-wrong');
  await phone.getByLabel('Password').fill('a-long-password-1');
  await expect(phone.getByTestId('sign-in-cross')).toHaveCount(0);
  await phone.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(phone.getByTestId('sign-in-success')).toContainText('Signed in');
  const welcome = phone.getByTestId('welcome-executive');
  await expect(welcome).toContainText('Welcome back, Priya');
  await expect(welcome).toContainText('Welcome to Executive Workspace');
  await phone.waitForTimeout(900);
  await shot(phone, '42-app-welcome');
  await expect(welcome).toHaveCount(0, { timeout: 6000 });

  // Home: the bell with its count, the Tasks badge, and the newest unread on the home card.
  const bell = phone.getByRole('button', { name: 'Notifications, 2 unread' }).first();
  await expect(bell).toBeVisible();
  const card = phone.getByTestId('home-notifications');
  await expect(phone.getByText('2 new')).toBeVisible();
  await expect(phone.getByRole('button', { name: /Read the onboarding pack, unread/ }).first()).toBeVisible();
  await expect(card).toBeVisible();
  await shot(phone, '43-app-home-notifications');
  await expectNoA11yViolations(phone);

  // Something new while the app is open slides down as a banner, and the count follows.
  expect((await page.request.post('/api/v1/announcements', { data: { title: 'Office closed on Friday', body: 'Calls go to the duty phone.' }, headers: { origin: ORIGIN } })).ok()).toBe(true);
  const banner = phone.getByRole('button', { name: 'New notification: Office closed on Friday' });
  await expect(banner).toBeVisible({ timeout: 30_000 });
  await expect(phone.getByRole('button', { name: 'Notifications, 3 unread' }).first()).toBeVisible();
  await shot(phone, '44-app-banner');
  // The banner sits over the header for six seconds; close it before using the bell and tabs.
  await phone.getByRole('button', { name: 'Dismiss' }).click();
  await expect(phone.getByTestId('notification-banner')).toHaveCount(0);

  // Opening Tasks reads its two (ADR 0075): its badge goes and the bell counts only the announcement.
  await phone.getByRole('tab', { name: /Tasks/ }).click();
  await expect(phone.getByRole('button', { name: 'Notifications, 1 unread' }).first()).toBeVisible();
  await expect.poll(async () => ((await (await guest.request.get(`${API}/api/v1/notifications/summary`)).json()) as { bySection: { tasks?: number } }).bySection.tasks ?? 0).toBe(0);

  // The bell opens the list (the Tasks header is the top one of the stacked screens): All, Unread, Action required.
  await phone.getByRole('button', { name: 'Notifications, 1 unread' }).last().click();
  await expect(phone.getByRole('radiogroup', { name: 'Show' })).toBeVisible();
  await phone.getByRole('radio', { name: 'Unread' }).click();
  await expect(phone.getByRole('button', { name: 'Office closed on Friday, unread' })).toBeVisible();
  await shot(phone, '45-app-notification-list');
  await expectNoA11yViolations(phone);
  await phone.getByRole('button', { name: 'Mark all as read' }).click();
  await expect(phone.getByRole('button', { name: 'Notifications', exact: true }).first()).toBeVisible();
  await expect.poll(async () => ((await (await guest.request.get(`${API}/api/v1/notifications/summary`)).json()) as { unread: number }).unread).toBe(0);
});
