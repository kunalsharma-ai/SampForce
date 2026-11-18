import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { signUp } from './helpers';

/** Set PREVIEW_DIR to save screenshots of the new screens (used for previews). */
const PREVIEW_DIR = process.env.PREVIEW_DIR;
test.use({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 }, deviceScaleFactor: PREVIEW_DIR ? 2 : 1 });

const shot = async (page: Page, name: string) => {
  if (PREVIEW_DIR) await page.screenshot({ path: `${PREVIEW_DIR}/${name}.png` });
};

/**
 * ADR 0068: a workspace admin adds the workspace's own free AI key and its own email server under Integrations.
 * Copilot answers through the own key first, and portal email goes out from the workspace's own address.
 */
test('a workspace admin adds its own AI key and email server, and both are used first', async ({ page, request }) => {
  await signUp(page, 'Own Servers Ltd');
  await page.goto('/app/integrations');
  await expect(page.getByRole('heading', { level: 2, name: 'Your own servers' })).toBeVisible();

  const ai = page.getByRole('region', { name: 'Your own AI providers' });
  await expect(ai.getByText('Not set up')).toBeVisible();
  await ai.getByLabel('Add a provider').selectOption({ label: 'Groq' });
  await ai.getByRole('button', { name: 'Add', exact: true }).click();
  const groq = ai.getByRole('listitem', { name: 'Groq' });
  await groq.getByLabel('API key').fill('gsk_own_workspace_key_4f4f');
  await ai.getByRole('button', { name: 'Save AI providers' }).click();
  await expect(ai.getByText('In use')).toBeVisible();
  await expect(groq.getByLabel('API key')).toHaveAttribute('placeholder', 'Saved, ends in 4f4f');
  await expect(page.locator('body')).not.toContainText('gsk_own_workspace_key');
  await groq.getByRole('button', { name: 'Test Groq' }).click();
  await expect(groq.getByRole('status')).toContainText('Test passed: Groq answered with llama-3.3-70b-versatile');

  const mail = page.getByRole('region', { name: 'Your own email server' });
  await mail.getByLabel('SMTP server').fill('127.0.0.1');
  await mail.getByLabel('Encryption').selectOption('none');
  await mail.getByLabel('Port').fill('4400');
  await mail.getByLabel('From address').fill('sales@ownservers.test');
  await mail.getByLabel('From name (optional)').fill('Own Servers Sales');
  await mail.getByRole('button', { name: 'Check and save' }).click();
  await expect(mail.getByText('In use')).toBeVisible();
  await expect(mail.getByText('Own Servers Sales <sales@ownservers.test>')).toBeVisible();
  await request.delete('http://127.0.0.1:4401/messages');
  await mail.getByRole('button', { name: 'Send me a test email' }).click();
  await expect(mail.getByRole('status')).toContainText('Test passed: The server accepted a test email');
  const sent = (await (await request.get('http://127.0.0.1:4401/messages')).json()) as { from: string; subject: string }[];
  expect(sent.at(-1)).toMatchObject({ from: 'sales@ownservers.test', subject: 'SampForce test email' });

  const results = await new AxeBuilder({ page }).include('section[aria-labelledby="own-servers-heading"]').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(results.violations.map((v) => v.id)).toEqual([]);
  await page.getByRole('heading', { level: 2, name: 'Your own servers' }).scrollIntoViewIfNeeded();
  await shot(page, '01-own-ai-providers');
  await mail.scrollIntoViewIfNeeded();
  await shot(page, '02-own-email-server');

  // AI Agents shows the workspace's own provider first, with the shared one as its fallback, and Copilot answers.
  await page.goto('/app/agents');
  await expect(page.getByText('Groq (your workspace)', { exact: true })).toBeVisible();
  // The shared providers follow (other specs may change their order meanwhile).
  await expect(page.getByText(/Falls back to: .*Anthropic Claude/)).toBeVisible();
  await expect(page.getByText(/own AI providers answer first, at no cost in AI credits/)).toBeVisible();
  await shot(page, '03-agents-own-provider-first');
  await page.getByRole('button', { name: 'Copilot', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'SampForce Copilot' });
  await panel.getByRole('button', { name: 'Summarise my open pipeline.' }).click();
  await expect(panel.getByText(/This is a rule-based projection/)).toBeVisible();
  await shot(page, '04-copilot-through-own-key');
});
