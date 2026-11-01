import AxeBuilder from '@axe-core/playwright';
import { expect, type Locator, type Page, test } from '@playwright/test';
import { signUp } from './helpers';

const ORIGIN = { origin: 'http://localhost:3000' };

test.use({ reducedMotion: 'reduce' });

async function apiCall(page: Page, method: 'post' | 'put', path: string, data: object) {
  const res = await page.request[method](`/api/v1${path}`, { data, headers: ORIGIN });
  expect(res.ok(), `${method} ${path} → ${res.status()} ${await res.text()}`).toBe(true);
  return res.json();
}

/** Checks the page around the email. The email previews are sandboxed frames with no scripts, so axe cannot enter them. */
async function axe(page: Page) {
  const r = await new AxeBuilder({ page })
    .options({ iframes: false, runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] } })
    .setLegacyMode(true)
    .analyze();
  expect(r.violations.map((v) => `${v.id} ${v.nodes[0]?.target} ${v.nodes[0]?.failureSummary}`)).toEqual([]);
}

/** Drags with the mouse in small steps, as a person would, so the drag library sees a real pointer drag. */
async function drag(page: Page, from: Locator, to: Locator) {
  await to.scrollIntoViewIfNeeded();
  await from.scrollIntoViewIfNeeded();
  const a = (await from.boundingBox())!;
  const b = (await to.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 10, a.y + a.height / 2 + 10, { steps: 4 });
  await page.mouse.move(b.x + 40, b.y + 6, { steps: 12 });
  await page.mouse.up();
}

test('designs an email from blocks, previews it at both widths and for a lead, and saves it', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await signUp(page, 'Designer Co');
  await apiCall(page, 'post', '/leads', { fullName: 'Ana Buyer', email: 'ana@buyer.test', companyName: 'Buyer & Co' });
  await apiCall(page, 'put', '/email-variables', { key: 'booking_link', label: 'Booking link', value: 'https://cal.example.com/ana' });

  await page.goto('/app/sequences');
  await page.getByRole('tab', { name: 'Templates' }).click();
  await page.getByRole('button', { name: 'New template' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Panel offer');
  await page.getByLabel('Subject').fill('A panel for {{company}}');
  await page.getByLabel('Email', { exact: true }).fill('Thanks for the call today.');

  // Switching to Designed starts from what was written, plus a button and a signature.
  await page.getByRole('button', { name: 'Designed', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Designed', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const outline = page.getByRole('list', { name: 'Email blocks' });
  const rows = outline.getByRole('listitem');
  await expect(rows).toHaveCount(4); // three blocks and the drop zone at the end
  await expect(outline.getByRole('button', { name: /^Text Thanks for the call today\./ })).toBeVisible();

  // Click to add a header after the selected text block, then move it to the top with the keyboard-friendly buttons.
  await page.getByRole('list', { name: 'Blocks you can add' }).getByRole('button', { name: 'Header (add)' }).click();
  await outline.getByRole('button', { name: 'Move Header block 2 up' }).click();
  await expect(outline.getByRole('button', { name: 'Drag Header block 1' })).toBeVisible();
  await page.getByLabel('Title', { exact: true }).fill('Northwind Research');

  // Drag a pricing table from the palette to just before the signature.
  await drag(page, page.getByRole('button', { name: 'Drag a pricing table block into the email' }), outline.getByRole('listitem').filter({ hasText: 'Signature' }));
  await expect(outline.getByRole('button', { name: /^Drag / })).toHaveCount(5);
  await expect(outline.getByRole('button', { name: 'Drag Pricing table block 4' })).toBeVisible();
  await page.getByLabel('Row 1 item').fill('Starter');
  await page.getByLabel('Row 1 price').fill('$2,000');
  await page.getByRole('button', { name: 'Add a row' }).click();
  await page.getByLabel('Row 2 item').fill('Pro');
  await page.getByLabel('Row 2 price').fill('$6,000');

  // Reorder an existing block by dragging: the button goes above the text.
  await drag(page, outline.getByRole('button', { name: 'Drag Button block 3' }), outline.getByRole('listitem').filter({ hasText: 'Thanks for the call' }));
  await expect(outline.getByRole('button', { name: 'Drag Button block 2' })).toBeVisible();
  await outline.getByRole('button', { name: 'Move Button block 2 down' }).click();
  await expect(outline.getByRole('button', { name: 'Drag Button block 3' })).toBeVisible();

  // Merge fields go into the text box last used.
  await outline.getByRole('button', { name: /^Text / }).click();
  const text = page.getByLabel('Text', { exact: true });
  await text.click();
  await text.press('End');
  await text.pressSequentially(' Hello ');
  await page.getByRole('button', { name: 'First name', exact: true }).click();
  await expect(text).toHaveValue('Thanks for the call today. Hello {{first_name|there}}');

  // A link that is not a web address is refused before saving, naming the block.
  await outline.getByRole('button', { name: /^Button / }).click();
  await page.getByLabel('Link', { exact: true }).fill('javascript:alert(1)');
  await page.getByRole('button', { name: 'Save template' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toHaveText('Button block 3: Use a full link starting with https://, or a merge field.');
  await page.getByLabel('Link', { exact: true }).fill('{{var.booking_link}}');
  await page.getByLabel('Accent (header, buttons, links) #2563eb').fill('#0f766e');

  // The live preview is the email itself, at desktop and phone width.
  const desktop = page.frameLocator('iframe[title="Email preview at desktop width"]');
  await expect(desktop.getByText('Northwind Research')).toBeVisible();
  await expect(desktop.getByText('$6,000', { exact: true })).toBeVisible();
  await expect(desktop.getByRole('link', { name: 'Book a call' })).toBeVisible();
  await page.getByRole('button', { name: 'Phone' }).click();
  const phone = page.locator('iframe[title="Email preview at phone width"]');
  await expect(phone).toHaveJSProperty('offsetWidth', 375);
  await expect(page.frameLocator('iframe[title="Email preview at phone width"]').getByText('Pro')).toBeVisible();
  await axe(page);

  // Previewing for a real lead fills in the fields, escaped, with the booking link from the workspace variable.
  await page.getByLabel('Preview for a lead').fill('Ana');
  await page.getByRole('option', { name: /Ana Buyer/ }).click();
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  const forAna = page.frameLocator('iframe[title="Email preview for Ana Buyer"]');
  await expect(forAna.getByText('Thanks for the call today. Hello Ana')).toBeVisible();
  await expect(forAna.getByRole('link', { name: 'Book a call' })).toHaveAttribute('href', 'https://cal.example.com/ana');
  await expect(page.getByText('A panel for Buyer & Co')).toBeVisible();

  await page.getByRole('button', { name: 'Save template' }).click();
  const card = page.getByRole('heading', { name: /Panel offer/ });
  await expect(card).toBeVisible();
  await expect(card.getByText('Designed')).toBeVisible();

  // The design is stored: after a reload, editing shows the same blocks in the same order.
  await page.reload();
  await page.getByRole('tab', { name: 'Templates' }).click();
  await page.getByRole('button', { name: 'Edit Panel offer' }).click();
  await expect(page.getByRole('button', { name: 'Designed', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const handles = page.getByRole('list', { name: 'Email blocks' }).getByRole('button', { name: /^Drag / });
  await expect(handles).toHaveCount(5);
  expect(await handles.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))).toEqual([
    'Drag Header block 1',
    'Drag Text block 2',
    'Drag Button block 3',
    'Drag Pricing table block 4',
    'Drag Signature block 5',
  ]);
  await expect(page.getByText('#0f766e')).toBeVisible();
  await axe(page);
});
