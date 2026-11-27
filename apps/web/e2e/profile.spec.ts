import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { type Browser, expect, type Page, test } from '@playwright/test';
import { signUp } from './helpers';

/**
 * Personal profiles (ADR 0087): a person adds and crops a photo, writes a headline, quote and bio, adds contact
 * details and "ask me about" topics, picks a cover and sets a mood. Teammates see the photo and mood on avatars and
 * open the profile card from Team Management and team chat.
 */
const ORIGIN = { origin: 'http://localhost:3000' };
/** Set PREVIEW_DIR to save screenshots of each screen (used for previews). */
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

/** A teammate in the signed-in workspace, with their own profile and mood set through the API. */
async function teammate(browser: Browser, page: Page, name: string) {
  const inv = await (await page.request.post('/api/v1/tenants/current/invitations', { headers: ORIGIN, data: { email: `${name.split(' ')[0]!.toLowerCase()}-${Date.now()}@example.com`, roleKey: 'member' } })).json();
  const ctx = await browser.newContext();
  const res = await ctx.request.post('/api/v1/auth/invitations/accept', { headers: ORIGIN, data: { token: inv.inviteUrl.split('/invite/')[1], name, password: 'a-long-password-1' } });
  expect(res.ok(), await res.text()).toBe(true);
  return ctx;
}

const picture = readFileSync(join(__dirname, '../src/app/apple-icon.png'));

test('a person builds a profile with a cropped photo, quote, bio and mood, and teammates see it', async ({ page, browser }) => {
  test.setTimeout(120_000);
  await signUp(page, `Profile Org ${Date.now().toString(36)}`);
  const priya = await teammate(browser, page, 'Priya Nair');
  expect((await priya.request.put('/api/v1/me/profile', { headers: ORIGIN, data: { headline: 'Panel partnerships, APAC', quote: 'Listen more than you talk.', linkedinUrl: 'linkedin.com/in/priya-nair', cover: 'ocean', tags: ['Healthcare panels'] } })).ok()).toBe(true);
  expect((await priya.request.put('/api/v1/me/mood', { headers: ORIGIN, data: { emoji: '☕', text: 'Coffee break' } })).ok()).toBe(true);

  // The account menu leads to My profile.
  await page.goto('/app');
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'My profile' }).click();
  await expect(page).toHaveURL(/\/app\/profile$/);
  await expect(page.getByRole('heading', { name: 'Test Person', level: 1 })).toBeVisible();
  await expect(page.locator('[data-profile-completeness]')).toContainText('0%');
  await axe(page);
  await shot(page, '01-my-profile-empty');

  // A photo: chosen, moved and zoomed in the crop circle, then saved.
  await page.getByRole('button', { name: 'Add a photo' }).click();
  const editor = page.getByRole('dialog');
  await expect(editor.locator('[data-drop-zone]')).toBeVisible();
  await editor.getByLabel('Choose a photo').setInputFiles({ name: 'me.png', mimeType: 'image/png', buffer: picture });
  const crop = editor.locator('[data-crop-area]');
  await expect(crop).toBeVisible();
  await editor.getByRole('button', { name: 'Zoom in' }).click();
  const box = (await crop.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 30, box.y + box.height / 2 + 20, { steps: 4 });
  await page.mouse.up();
  await shot(page, '02-photo-crop');
  await editor.getByRole('button', { name: 'Save photo' }).click();
  await expect(editor).toBeHidden();
  await expect(page.locator('[data-profile-hero] img')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Account menu' }).locator('img')).toBeVisible();
  const photo = ((await (await page.request.get('/api/v1/auth/me')).json()) as { user: { photoUrl: string } }).user.photoUrl;
  expect(photo).toMatch(/\/people\/.+\/photo\?v=/);
  // Cropped in the browser: a square JPEG.
  expect((await page.request.get(photo)).headers()['content-type']).toBe('image/jpeg');

  // The rest of the profile, with a wrong LinkedIn address first.
  await page.getByLabel('Headline').fill('Head of growth, Gulf region');
  await page.getByRole('button', { name: 'Every no brings you closer to a yes.' }).click();
  await expect(page.getByLabel('Favourite quote')).toHaveValue('Every no brings you closer to a yes.');
  await page.getByLabel('Bio').fill('Ten years in market research sales. Weekend cricket captain.');
  await page.getByLabel('Phone').fill('+971 50 123 4567');
  await page.getByLabel('LinkedIn').fill('https://example.com/me');
  await page.getByLabel('Ask me about').fill('B2B panels');
  await page.keyboard.press('Enter');
  await page.getByLabel('Ask me about').fill('Healthcare');
  await page.keyboard.press('Enter');
  await page.getByRole('radio', { name: 'Sunset' }).click();
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.getByText('Enter a LinkedIn address, such as linkedin.com/in/your-name')).toBeVisible();
  await page.getByLabel('LinkedIn').fill('linkedin.com/in/test-person');
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.getByRole('status')).toHaveText('Profile saved');

  // The mood: a quick pick that clears itself tonight.
  await page.locator('[data-mood-button]').click();
  const mood = page.getByRole('dialog');
  await mood.getByRole('button', { name: /Celebrating a win/ }).click();
  await expect(mood.locator('[data-mood-preview]')).toHaveText('🎉');
  await mood.getByLabel('Clear after').selectOption('today');
  await shot(page, '03-mood-picker');
  await mood.getByRole('button', { name: 'Set mood' }).click();
  await expect(mood).toBeHidden();
  await expect(page.locator('[data-mood-button]')).toContainText('Celebrating a win');
  await expect(page.locator('[data-profile-completeness]')).toContainText('100%');
  await expect(page.locator('[data-profile-preview]')).toContainText('Every no brings you closer to a yes.');
  await expect(page.getByRole('button', { name: 'Account menu' }).locator('[data-mood]')).toHaveText('🎉');
  await axe(page);
  await shot(page, '04-my-profile-complete');

  // Everything is kept.
  await page.reload();
  await expect(page.getByLabel('Headline')).toHaveValue('Head of growth, Gulf region');
  await expect(page.getByLabel('LinkedIn')).toHaveValue('https://linkedin.com/in/test-person');
  await expect(page.getByRole('radio', { name: 'Sunset' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('form', { name: 'My profile' }).getByText('Healthcare', { exact: true })).toBeVisible();

  // The account menu shows the mood and changes it.
  await page.getByRole('button', { name: 'Account menu' }).click();
  await expect(page.locator('[data-account-profile]')).toContainText('🎉');
  await shot(page, '05-account-menu');
  await page.getByRole('menuitem', { name: 'Change your mood' }).click();
  await expect(page.getByRole('dialog', { name: 'How are you feeling?' })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Clear mood' }).click();
  await expect(page.locator('[data-mood-button]')).toContainText('Set your mood');

  // Teammates: Priya's avatar carries her mood, and her card opens from Team Management.
  await page.goto('/app/team');
  const row = page.getByRole('row', { name: /Priya Nair/ });
  await expect(row.locator('[data-mood]')).toHaveText('☕');
  await row.getByRole('button', { name: 'View the profile of Priya Nair' }).click();
  const card = page.locator('[data-person-card]');
  await expect(card).toContainText('Panel partnerships, APAC');
  await expect(card.locator('[data-person-mood]')).toContainText('Coffee break');
  await expect(card).toContainText('Listen more than you talk.');
  await expect(card.getByRole('link', { name: 'LinkedIn' })).toHaveAttribute('href', 'https://linkedin.com/in/priya-nair');
  await shot(page, '06-teammate-card');
  await page.keyboard.press('Escape');

  // And in team chat, the people picker shows her mood on her avatar.
  await page.goto('/app/chat');
  await page.getByRole('region', { name: 'Conversations' }).getByRole('button', { name: 'New message' }).click();
  await shot(page, '07-chat-people-with-moods');
  const picker = page.getByRole('dialog');
  await expect(picker.locator('[data-avatar] [data-mood]').first()).toHaveText('☕');
  await priya.close();
});
