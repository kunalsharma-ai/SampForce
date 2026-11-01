import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';

test.use({ reducedMotion: 'reduce' });

interface IndexEntry {
  id: string;
  type: 'story' | 'docs';
  title: string;
  name: string;
}

/** Each story in the default theme dark and light, and in Arabic (right to left). */
const VARIANTS = [
  { name: 'dark', globals: 'mode:dark;language:en', dir: 'ltr' },
  { name: 'light', globals: 'mode:light;language:en', dir: 'ltr' },
  { name: 'arabic', globals: 'mode:dark;language:ar', dir: 'rtl' },
];

/**
 * Storybook's accessibility addon runs axe itself after each render. On a busy machine our run can start while the
 * addon's is still going ("Axe is already running"), so wait for it and try again rather than fail on the overlap.
 */
async function analyze(page: Page) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await new AxeBuilder({ page }).include('#storybook-root').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    } catch (e) {
      if (attempt >= 5 || !String(e).includes('Axe is already running')) throw e;
      await page.waitForTimeout(400 * attempt);
    }
  }
}

test('every story renders without errors and passes axe, in dark, light and right to left', async ({ page, request }) => {
  const index = (await (await request.get('/index.json')).json()) as { entries: Record<string, IndexEntry> };
  const stories = Object.values(index.entries).filter((e) => e.type === 'story');
  expect(stories.length).toBeGreaterThanOrEqual(20);

  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && problems.push(`console: ${m.text()}`));

  for (const story of stories) {
    for (const v of VARIANTS) {
      const label = `${story.title} / ${story.name} (${v.name})`;
      const before = problems.length;
      await page.goto(`/iframe.html?id=${story.id}&viewMode=story&globals=${v.globals}`);
      const root = page.locator('#storybook-root');
      await expect(root.locator(':scope > *').first(), label).toBeVisible();
      await expect(page.locator('html'), label).toHaveAttribute('dir', v.dir);
      const r = await analyze(page);
      for (const x of r.violations) problems.push(`${label}: ${x.id} ${x.nodes[0]?.target} ${x.nodes[0]?.failureSummary}`);
      for (const p of problems.slice(before)) if (!p.startsWith(story.title)) problems[problems.indexOf(p)] = `${label}: ${p}`;
    }
  }
  expect(problems).toEqual([]);
});
