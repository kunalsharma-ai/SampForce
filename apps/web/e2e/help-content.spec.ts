import { execFileSync } from 'node:child_process';
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { E2E_DATABASE_URL, signUp } from './helpers';

/** Set PREVIEW_DIR to save screenshots of each screen (sampforce/previews/help-center). */
const PREVIEW_DIR = process.env.PREVIEW_DIR;
const VIEW = {
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: PREVIEW_DIR ? 2 : 1,
  reducedMotion: 'reduce' as const,
};

test.use(VIEW);

async function shot(page: Page, name: string, fullPage = false) {
  if (!PREVIEW_DIR) return;
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${PREVIEW_DIR}/${name}.png`, fullPage });
}

async function axe(page: Page) {
  const r = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(
    r.violations.map((v) => `${v.id} ${v.nodes[0]?.target} ${v.nodes[0]?.failureSummary}`),
  ).toEqual([]);
}

/**
 * Help written in the Console reaches readers (ADR 0073): an administrator adds a topic and a picture, writes,
 * previews, publishes and restores a guide, posts an announcement and edits a built-in answer; a workspace reader
 * finds them, sees when they were updated, says whether they helped, and the Console reads and reviews that.
 */
test('Console help content, from writing to reader feedback', async ({ page, browser }) => {
  test.setTimeout(240_000);
  const stamp = Date.now();
  const topicId = `first-week-${stamp.toString(36)}`;
  const pic = `deals-board-${stamp}.png`;
  const guideTitle = `Your first week in SampForce ${stamp}`;

  // A reader's workspace, and a real picture of it for the guide.
  await signUp(page, `Help Content ${stamp}`);
  await page.goto('/app/deals');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  const picture = await page.screenshot({
    type: 'png',
    clip: { x: 0, y: 0, width: 1200, height: 640 },
  });

  // ── The Console administrator ──
  const email = `ops-content-${stamp}@platform.test`;
  execFileSync('node', ['-r', '@swc-node/register', 'scripts/create-operator.ts'], {
    cwd: '../api',
    env: {
      ...process.env,
      DATABASE_URL: E2E_DATABASE_URL,
      OPERATOR_EMAIL: email,
      OPERATOR_PASSWORD: 'operator-password-1',
      OPERATOR_NAME: 'Asha Admin',
      OPERATOR_ROLE: 'ADMIN',
    },
  });
  const opsCtx = await browser.newContext(VIEW);
  const ops = await opsCtx.newPage();
  await ops.goto('/operator/login');
  await ops.getByLabel('Email').fill(email);
  await ops.getByLabel('Password').fill('operator-password-1');
  await ops.getByRole('button', { name: 'Sign in' }).click();
  await ops.getByRole('link', { name: 'Help', exact: true }).click();
  await ops.locator('[data-manage-help]').click();
  await expect(ops.getByRole('heading', { level: 1, name: 'Manage Help' })).toBeVisible();

  // A topic of its own, under Getting started.
  await ops.locator('[data-manage-tab="topics"]').click();
  const topicForm = ops.locator('[data-topic-form]');
  await topicForm
    .getByLabel('Short name (letters, numbers, dashes)', { exact: true })
    .fill(topicId);
  await topicForm.getByLabel('Title', { exact: true }).fill('Your first week');
  await topicForm
    .getByLabel('Description', { exact: true })
    .fill('Day-by-day steps for new teams.');
  await topicForm
    .getByLabel('Under topic (makes it a subtopic)', { exact: true })
    .selectOption('start');
  await topicForm.getByLabel('Icon', { exact: true }).selectOption('rocket');
  await topicForm.locator('[data-save-topic]').click();
  await expect(ops.locator(`[data-topic-row="${topicId}"]`)).toContainText('Your first week');

  // A picture.
  await ops.locator('[data-manage-tab="files"]').click();
  await ops
    .locator('[data-help-media-input]')
    .setInputFiles({ name: pic, mimeType: 'image/png', buffer: picture });
  await expect(ops.locator(`[data-help-media="${pic}"]`)).toContainText(`![${pic}](media:`);
  await shot(ops, '20-console-help-files');
  // Something that only claims to be a picture is refused.
  await ops.locator('[data-help-media-input]').setInputFiles({
    name: 'fake.png',
    mimeType: 'image/png',
    buffer: Buffer.from('<html>not a picture</html>'),
  });
  await expect(ops.getByText('Use a PNG, JPEG, GIF or WebP picture')).toBeVisible();

  // A guide: write, preview, save, publish.
  await ops.locator('[data-manage-tab="articles"]').click();
  await ops.locator('[data-new-article]').click();
  const editor = ops.locator('[data-article-editor]');
  await editor.getByLabel('Type', { exact: true }).selectOption('GUIDE');
  await editor.getByLabel('Topic', { exact: true }).selectOption(topicId);
  await editor.getByLabel('Title', { exact: true }).fill(guideTitle);
  await editor
    .getByLabel('Summary', { exact: true })
    .fill('What to set up on each of your first five days, in order.');
  await editor
    .getByLabel('Full text (optional)', { exact: true })
    .fill(
      '## Day one\n1. Invite your team from Members.\n2. Import your companies and contacts.\n> Tip: import a small file first to check the columns.\n',
    );
  await ops.locator(`[data-insert-media="${pic}"]`).click();
  await expect(editor.getByLabel('Full text (optional)', { exact: true })).toHaveValue(
    new RegExp(`!\\[${pic.replace('.', '\\.')}\\]\\(media:`),
  );
  await editor.locator('[data-lang-tab="es"]').click();
  await editor.getByLabel('Title', { exact: true }).fill('Tu primera semana en SampForce');
  await editor.locator('[data-lang-tab="en"]').click();
  await ops.locator('[data-preview-toggle]').click();
  const preview = ops.locator('[data-article-preview]');
  await expect(preview).toContainText(guideTitle);
  await expect(preview.locator('[data-help-article-body] ol li')).toHaveCount(2);
  await expect(preview.locator(`img[alt="${pic}"]`)).toBeVisible();
  await editor
    .getByLabel('What changed (kept with the version)', { exact: true })
    .fill('First draft for new clients');
  await ops.locator('[data-save-article]').click();
  await expect(ops.locator('[data-article-saved]')).toHaveText('Draft saved.');
  await expect(ops.locator('[data-editor-status="DRAFT"]')).toBeVisible();
  await shot(ops, '21-console-help-editor', true);
  await ops.locator('[data-publish-article]').click();
  await expect(ops.locator('[data-editor-status="PUBLISHED"]')).toBeVisible();

  // A change, and putting the first version back.
  await editor
    .getByLabel('Summary', { exact: true })
    .fill('A wrong summary that gets rolled back.');
  await editor
    .getByLabel('What changed (kept with the version)', { exact: true })
    .fill('Shorter summary');
  await ops.locator('[data-save-article]').click();
  await expect(ops.locator('[data-article-saved]')).toHaveText('Saved as version 2.');
  await ops.locator('[data-restore-version="1"]').click();
  await expect(ops.locator('[data-article-saved]')).toHaveText('Restored version 1 as version 3.');
  await expect(editor.getByLabel('Summary', { exact: true })).toHaveValue(
    'What to set up on each of your first five days, in order.',
  );
  await expect(ops.locator('[data-article-versions] [data-version]')).toHaveCount(3);

  // An announcement for every workspace.
  await ops.getByRole('button', { name: 'All articles' }).click();
  await ops.locator('[data-new-article]').click();
  await editor.getByLabel('Type', { exact: true }).selectOption('ANNOUNCEMENT');
  await editor.getByLabel('Topic', { exact: true }).selectOption('start');
  await editor.getByLabel('Title', { exact: true }).fill(`New in Help ${stamp}`);
  await editor
    .getByLabel('Summary', { exact: true })
    .fill('Guides now show when they were last updated, and you can tell us if they helped.');
  await ops.locator('[data-save-article]').click();
  await ops.locator('[data-publish-article]').click();
  await expect(ops.locator('[data-editor-status="PUBLISHED"]')).toBeVisible();

  // A built-in answer, edited.
  await ops.getByRole('button', { name: 'All articles' }).click();
  await ops.getByLabel('Edit or hide a built-in answer, guide or feature brief').selectOption('faq:deals.move');
  await ops.locator('[data-edit-builtin]').click();
  await expect(editor.getByLabel('Question', { exact: true })).toHaveValue(/move a deal/i);
  await editor
    .getByLabel('Short answer', { exact: true })
    .fill(
      `Open Deals and drag the card to the next column. Updated by support ${stamp}: you can also change the stage on the deal page.`,
    );
  await ops.locator('[data-save-article]').click();
  await expect(ops.locator('[data-article-saved]')).toBeVisible();
  // An earlier run may have published it already; then saving is enough.
  if (await ops.locator('[data-publish-article]').isVisible())
    await ops.locator('[data-publish-article]').click();
  await expect(ops.locator('[data-editor-status="PUBLISHED"]')).toBeVisible();
  await ops.getByRole('button', { name: 'All articles' }).click();
  await expect(ops.locator(`[data-article-row="${guideTitle}"]`)).toContainText('Published');
  await axe(ops);
  await shot(ops, '22-console-help-articles');

  // ── The reader ──
  await page.goto('/app/help');
  const center = page.locator('[data-help-center="workspace"]');
  await expect(center.locator('[data-help-announcements]')).toContainText(`New in Help ${stamp}`);
  await expect(center.locator(`[data-help-category="start"]`)).toContainText('Your first week');
  await expect(center.locator('[data-help-recent]')).toContainText(guideTitle);
  // The edited built-in answer replaces the shipped one.
  await center.locator('[data-help-category="deals"]').click();
  const move = center.locator('[data-faq="deals.move"]');
  await move.locator('summary').click();
  await expect(move).toContainText(`Updated by support ${stamp}`);
  await move.getByRole('button', { name: 'No' }).click();
  await move
    .getByLabel('What was missing or unclear? (optional)')
    .fill(`A short video would help ${stamp}.`);
  await move.getByRole('button', { name: 'Send feedback' }).click();
  await expect(move.getByRole('status')).toContainText('Thanks');
  await center.getByRole('button', { name: 'Show all topics' }).click();

  // Search while typing, part of a word is enough.
  await page.getByRole('searchbox', { name: 'Search help' }).fill('first wee');
  const results = page.locator('[data-help-results]');
  await expect(results.locator('[data-help-result-group]').first()).toBeVisible();
  await results.getByRole('button', { name: new RegExp(guideTitle) }).click();
  const dialog = page.getByRole('dialog', { name: guideTitle });
  await expect(dialog.locator('[data-help-article-body] ol li')).toHaveCount(2);
  await expect(dialog.locator(`img[alt="${pic}"]`)).toBeVisible();
  await expect(dialog.locator('[data-help-updated]')).toBeVisible();
  await dialog.getByRole('button', { name: 'Yes' }).click();
  await expect(dialog.getByRole('button', { name: 'Yes' })).toHaveAttribute('aria-pressed', 'true');
  await axe(page);
  await shot(page, '23-help-article-dialog');
  await page.keyboard.press('Escape');

  // Nothing found: guides to try and the way to support.
  await page.getByRole('searchbox', { name: 'Search help' }).fill('zzqx nothing');
  await expect(page.locator('[data-help-no-results]')).toBeVisible();
  await expect(page.locator('[data-help-no-results] [data-help-suggestion]').first()).toBeVisible();
  await page.getByRole('button', { name: 'Clear search' }).click();

  // Reads count toward Popular.
  await page.reload();
  await expect(
    center.locator('[data-help-popular] [data-help-popular-item]').first(),
  ).toBeVisible();
  await shot(page, '24-help-center-with-console-content', true);

  // ── The Console reads the feedback ──
  await ops.locator('[data-manage-tab="feedback"]').click();
  const row = ops
    .locator('[data-feedback-row="faq:deals.move"]')
    .filter({ hasText: `A short video would help ${stamp}.` });
  await expect(row).toContainText('Not helpful');
  await expect(row).toContainText(`Help Content ${stamp}`);
  await shot(ops, '25-console-help-feedback');
  await row.locator('[data-review-feedback]').click();
  await expect(row).toHaveCount(0);
  await ops.locator('[data-feedback-filter="all"]').click();
  await expect(
    ops
      .locator('[data-feedback-row="faq:deals.move"]')
      .filter({ hasText: `A short video would help ${stamp}.` }),
  ).toContainText('reviewed');

  // Archiving hides it from readers straight away.
  await ops.locator('[data-manage-tab="articles"]').click();
  await ops.locator(`[data-article-row="${guideTitle}"]`).click();
  await ops.locator('[data-archive-article]').click();
  await expect(ops.locator('[data-editor-status="ARCHIVED"]')).toBeVisible();
  await page.reload();
  await expect(center.getByRole('heading', { level: 1, name: 'How can we help?' })).toBeVisible();
  await expect(center.getByText(guideTitle)).toHaveCount(0);
  await opsCtx.close();
});

/**
 * Help settings (ADR 0073): the Super Workspace hides the Help icon and leaves a note, people learn why features are
 * missing, and the Console can switch Help off for a client, while raising a query always stays possible.
 */
test('Help settings: hidden menu, missing features explained, Help switched off by the Console', async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000);
  const org = `Help Settings ${Date.now()}`;
  await signUp(page, org, { plan: 'free' });
  await page.goto('/app/help');
  const center = page.locator('[data-help-center="workspace"]');
  await expect(center.getByRole('heading', { level: 1, name: 'How can we help?' })).toBeVisible();

  // On the free plan, missing features are explained rather than offered.
  const restricted = center.locator('[data-help-restricted]');
  await restricted.locator('summary').click();
  await expect(restricted.locator('[data-restricted="page.sequences"]')).toHaveAttribute(
    'data-reason',
    'feature',
  );
  await expect(restricted.locator('[data-restricted="page.sequences"]')).toContainText(
    'Super Workspace administrator',
  );
  await expect(center.locator('[data-help-guide="page.sequences"]')).toHaveCount(0);

  // The Super Workspace's administrator hides the Help icon and leaves a note.
  await center.locator('[data-help-settings]').click();
  const dialog = page.locator('[data-help-settings-dialog]');
  await dialog.locator('[data-setting="menuVisible"]').uncheck();
  await dialog
    .getByLabel('Note for everyone in Help (optional)')
    .fill('For password resets, ask Priya in IT first.');
  await shot(page, '27-help-settings');
  await dialog.locator('[data-save-help-settings]').click();
  await expect(dialog).toBeHidden();
  await expect(center.locator('[data-help-support-note]')).toContainText('ask Priya in IT first');
  await expect(page.locator('[data-help-menu]')).toHaveCount(0);
  // Support stays reachable from the account menu.
  await page.getByRole('button', { name: 'Account menu' }).click();
  await expect(page.locator('[data-account-help]')).toBeVisible();
  await page.keyboard.press('Escape');
  await axe(page);
  await shot(page, '28-help-restricted-and-note', true);

  // The Console switches Help off for this client.
  const email = `ops-settings-${Date.now()}@platform.test`;
  execFileSync('node', ['-r', '@swc-node/register', 'scripts/create-operator.ts'], {
    cwd: '../api',
    env: {
      ...process.env,
      DATABASE_URL: E2E_DATABASE_URL,
      OPERATOR_EMAIL: email,
      OPERATOR_PASSWORD: 'operator-password-1',
      OPERATOR_NAME: 'Asha Admin',
      OPERATOR_ROLE: 'ADMIN',
    },
  });
  const opsCtx = await browser.newContext(VIEW);
  const ops = await opsCtx.newPage();
  await ops.goto('/operator/login');
  await ops.getByLabel('Email').fill(email);
  await ops.getByLabel('Password').fill('operator-password-1');
  await ops.getByRole('button', { name: 'Sign in' }).click();
  await ops.getByRole('link', { name: 'Clients', exact: true }).click();
  await ops.getByLabel('Search clients').fill(org);
  await ops.locator('[data-console-clients]').getByRole('link', { name: org }).click();
  const helpCard = ops.locator('[data-client-help]');
  await expect(helpCard).toContainText('Help icon hidden');
  await helpCard.locator('[data-client-help-enabled]').click(); // saved straight away, then shown
  await expect(helpCard.locator('[data-client-help-enabled]')).not.toBeChecked();
  await shot(ops, '29-console-client-help');

  await page.reload();
  const off = page.locator('[data-help-off]');
  await expect(off.getByRole('heading', { level: 1, name: 'Help & support' })).toBeVisible();
  await expect(off.locator('[data-faq]')).toHaveCount(0);
  await expect(off.locator('[data-help-support-note]')).toBeVisible();
  await off.locator('[data-raise-query]').click();
  await expect(page.locator('[data-raise-query-dialog]')).toBeVisible();
  await page.keyboard.press('Escape');
  await shot(page, '30-help-switched-off');

  await helpCard.locator('[data-client-help-enabled]').click();
  await expect(helpCard.locator('[data-client-help-enabled]')).toBeChecked();
  await page.reload();
  await expect(center.getByRole('heading', { level: 1, name: 'How can we help?' })).toBeVisible();
  await opsCtx.close();
});

/**
 * Guides for every module (ADR 0073): a start-here path for the reader's role, who can use each page and what to do
 * when something fails, and the full guide one click away from every page's i button.
 */
test('role start-here guides, requirements, troubleshooting and the full guide from a page', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signUp(page, `Help Guides ${Date.now()}`);
  await page.goto('/app/help');
  const role = page.locator('[data-help-role="superAdmin"]');
  await expect(role).toContainText('Start here: Super Admin');
  await role.locator('[data-help-role-step="page.team"]').click();
  const dialog = page.locator('[data-help-guide-dialog="page.team"]');
  await expect(dialog.locator('[data-help-requirements]')).toContainText('members:read');
  await expect(dialog.locator('[data-help-troubleshooting] li')).toHaveCount(4);
  await axe(page);
  await shot(page, '31-guide-requirements-troubleshooting');
  await dialog.locator('[data-raise-about-page]').click();
  const form = page.locator('[data-raise-query-dialog]');
  await expect(form.getByText('Sent with the page you came from: /app/team')).toBeVisible();
  await page.keyboard.press('Escape');
  await shot(page, '32-help-role-start-here');

  // From a module's own i button to its full guide.
  await page.goto('/app/deals');
  await page.locator('[data-help-topic="page.deals"]').first().click();
  await page.locator('[data-full-guide="page.deals"]').click();
  await expect(page).toHaveURL(/\/app\/help/);
  await expect(page.locator('[data-help-guide-dialog="page.deals"]')).toBeVisible();
});
