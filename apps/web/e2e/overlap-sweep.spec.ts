import { expect, test } from '@playwright/test';
import { signUp } from './helpers';
import { expectCleanLayout, LAYOUT_SIZES, setMode } from './layout-check';

/*
 * The platform-wide overlap sweep (Kunal's spec section 14: no overlapping text, no overlapping buttons, no broken
 * layouts, good on phones). Every section of the workspace app, with some data in it, at computer, tablet and phone
 * widths, in light and dark: no text drawn over other text, no text cut off without an ellipsis, and no sideways
 * scrolling. Plus the dialogs people asked about (Add my dialer).
 */

const ORIGIN = { origin: 'http://localhost:3000' };
const PAGES = [
  '/app',
  '/app/companies',
  '/app/contacts',
  '/app/deals',
  '/app/pipelines',
  '/app/follow-ups',
  '/app/calls',
  '/app/tasks',
  '/app/targets',
  '/app/rfqs',
  '/app/achievements',
  '/app/team-status',
  '/app/activities',
  '/app/communication',
  '/app/sequences',
  '/app/quotes',
  '/app/contracts',
  '/app/reports',
  '/app/team',
  '/app/integrations',
  '/app/notifications',
  '/app/approvals',
  '/app/settings',
  '/app/forecasting',
  '/app/gamification',
  '/app/meetings',
  '/app/automation',
  '/app/billing',
  '/app/profile',
] as const;

test.use({ reducedMotion: 'reduce' });

test('every section is free of overlapping text and sideways scrolling, at every size, in light and dark', async ({ page }) => {
  test.setTimeout(900_000);
  await signUp(page, 'Overlap Sweep Research');
  const company = await (await page.request.post('/api/v1/companies', { data: { name: 'Kantar Worldpanel India Private Limited' }, headers: ORIGIN })).json();
  await page.request.post('/api/v1/contacts', { data: { firstName: 'Anushka', lastName: 'Raghavendran-Subramaniam', email: 'anushka@kantar-sweep.test', companyId: company.id }, headers: ORIGIN });
  await page.request.post('/api/v1/deals', { data: { name: 'Nationwide consumer panel wave 14 with boosted rural sample', amount: 125000, currency: 'USD', companyId: company.id, customFields: {} }, headers: ORIGIN });

  const failures: string[] = [];
  for (const mode of ['light', 'dark'] as const) {
    await setMode(page, mode);
    for (const size of LAYOUT_SIZES) {
      await page.setViewportSize({ width: size.width, height: size.height });
      for (const path of PAGES) {
        await page.goto(path);
        await expect(page.locator('main#main')).toBeVisible();
        // Let the page's data arrive (no loader left, no skeleton busy).
        await expect(page.locator('[data-load-card], [data-page-loading]')).toHaveCount(0, { timeout: 20_000 });
        await page.waitForLoadState('networkidle').catch(() => undefined);
        await page.waitForTimeout(800);
        try {
          // The page and the header. Not the phone's bottom bar: the page scrolls under it on purpose (its padding keeps
          // the last row clear), so text passing behind it is not an overlap.
          await expectCleanLayout(page, 'main#main');
          await expectCleanLayout(page, 'header');
        } catch (err) {
          // One short line per problem, so a failing run lists every page at once.
          const found = /(\[[\s\S]*?\n\])/.exec(String((err as Error).message))?.[1] ?? String(err);
          let list: { kind: string; a: string; b?: string }[] = [];
          try {
            list = JSON.parse(found);
          } catch {
            // Not the layout check's own message: keep it as it is.
          }
          // For sideways scrolling, name what sticks out.
          // (The outermost elements past the window's edge; something positioned can escape a scrolling box.)
          const wide = await page.evaluate(() => {
            const past = Array.from(document.querySelectorAll('body *')).filter((el) => el.getBoundingClientRect().right > innerWidth + 1);
            return past
              .filter((el) => !past.some((o) => o !== el && o.contains(el)))
              .slice(0, 3)
              .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 80)}`);
          });
          for (const p of list.length ? list : [{ kind: 'error', a: found.slice(0, 200) }])
            failures.push(`${mode} ${size.name} ${path}: ${p.kind} ${p.a}${p.b ? ` / ${p.b}` : ''}${p.kind === 'page-wider-than-window' ? ` (${wide.join(', ')})` : ''}`);
        }
      }
    }
  }
  expect(failures, failures.join('\n\n')).toEqual([]);
});

test('the Add a dialer window keeps its title clear of the close button and fits on screen', async ({ page }) => {
  test.setTimeout(120_000);
  await signUp(page, 'Dialer Layout Research');
  for (const size of LAYOUT_SIZES) {
    await page.setViewportSize({ width: size.width, height: size.height });
    // Dialers are added on the Dialer settings tab of Calls (ADR 0101).
    await page.goto('/app/calls?tab=settings');
    await page.getByRole('button', { name: /Add (a |my )?dialer/ }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    // The longest set-up form: a custom cloud dialer, with its address, keys and request.
    await dialog.getByRole('button', { name: /^Any cloud dialer \(API\)/ }).click();
    const box = (await dialog.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(size.height + 1);
    // The title's text starts inside the padding and never runs under the close button.
    const title = await dialog.getByRole('heading').first().evaluate((h) => {
      const r = document.createRange();
      r.selectNodeContents(h);
      const b = r.getBoundingClientRect();
      return { left: b.left, right: b.right };
    });
    const close = (await dialog.getByRole('button', { name: 'Close' }).last().boundingBox())!;
    expect(title.left - box.x).toBeGreaterThanOrEqual(16);
    expect(title.right).toBeLessThanOrEqual(close.x + 1);
    await expectCleanLayout(page, '[role="dialog"]');
    await page.keyboard.press('Escape');
  }
});
