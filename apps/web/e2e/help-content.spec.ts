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
  await ops
    .locator('[data-help-media-input]')
    .setInputFiles({
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
  await ops.getByLabel('Edit or hide a built-in answer or guide').selectOption('faq:deals.move');
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
