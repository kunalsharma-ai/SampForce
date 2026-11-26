import { execFileSync } from 'node:child_process';
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { E2E_DATABASE_URL, signUp, openCopilot } from './helpers';

/** Set PREVIEW_DIR to save screenshots of the new screens (used for previews). */
const PREVIEW_DIR = process.env.PREVIEW_DIR;
test.use({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 }, deviceScaleFactor: PREVIEW_DIR ? 2 : 1 });

async function expectNoA11yViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

const shot = async (page: Page, name: string, fullPage = false) => {
  if (PREVIEW_DIR) await page.screenshot({ path: `${PREVIEW_DIR}/${name}.png`, fullPage });
};

/**
 * ADR 0067: free AI keys (Groq, Gemini) are added in the operator console, stored in the database, put first in the
 * fallback order, and a workspace's Copilot answers through them. Their endpoints point at a local stand-in.
 */
test('operator adds free AI keys, sets the fallback order, and Copilot answers through the first one', async ({ browser, page }) => {
  const email = `ops-ai-${Date.now()}@platform.test`;
  execFileSync('node', ['-r', '@swc-node/register', 'scripts/create-operator.ts'], {
    cwd: '../api',
    env: { ...process.env, DATABASE_URL: E2E_DATABASE_URL, OPERATOR_EMAIL: email, OPERATOR_PASSWORD: 'operator-password-1', OPERATOR_NAME: 'E2E AI', OPERATOR_ROLE: 'ADMIN' },
  });
  const ops = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: PREVIEW_DIR ? 2 : 1, reducedMotion: 'reduce' })).newPage();
  await ops.goto('/operator/login');
  await ops.getByLabel('Email').fill(email);
  await ops.getByLabel('Password').fill('operator-password-1');
  await ops.getByRole('button', { name: 'Sign in' }).click();
  await ops.getByRole('navigation', { name: 'Operator' }).getByRole('link', { name: 'Providers' }).click();
  await expect(ops.getByRole('heading', { level: 2, name: 'AI providers', exact: true })).toBeVisible();

  const routing = ops.getByRole('region', { name: 'AI providers and fallback order' });
  await expect(routing.getByRole('status')).toContainText('Anthropic Claude answers every AI request, with no fallback');

  // Add a free Groq key: it is saved encrypted in the database and tested with a call that uses no tokens.
  const groq = ops.getByRole('region', { name: 'Groq' });
  await groq.getByRole('button', { name: 'Add keys' }).click();
  await groq.getByRole('form', { name: 'Edit Groq keys' }).getByLabel('API key GROQ_API_KEY').fill('gsk_e2e_free_groq_key_7k7k');
  await groq.getByRole('button', { name: 'Save keys' }).click();
  await expect(groq.getByRole('list', { name: 'Groq keys' })).toContainText('GROQ_API_KEYSaved here · ends in 7k7k');
  await expect(ops.locator('body')).not.toContainText('gsk_e2e_free_groq_key');
  await groq.getByRole('button', { name: 'Test connection' }).click();
  await expect(groq.getByText('Connection test passed')).toBeVisible();
  await expect(groq.getByText(/llama-3.3-70b-versatile is available/)).toBeVisible();

  // And a free Gemini key as a second fallback.
  const gemini = ops.getByRole('region', { name: 'Google Gemini' });
  await gemini.getByRole('button', { name: 'Add keys' }).click();
  await gemini.getByRole('form', { name: 'Edit Google Gemini keys' }).getByLabel('API key GEMINI_API_KEY').fill('AIza-e2e-free-gemini-key-3m3m');
  await gemini.getByRole('button', { name: 'Save keys' }).click();
  await expect(gemini.getByRole('list', { name: 'Google Gemini keys' })).toContainText('ends in 3m3m');
  await expect(routing.getByRole('status')).toContainText('Anthropic Claude answers first, then Google Gemini, then Groq');

  // Put Groq first and save the order.
  const order = routing.getByRole('list', { name: 'AI provider order' });
  for (let i = 0; i < 3; i++) await routing.getByRole('button', { name: 'Move Groq up' }).click();
  await expect(order.getByRole('listitem').first()).toContainText('Groq');
  await routing.getByRole('button', { name: 'Save order' }).click();
  await expect(ops.getByRole('region', { name: 'AI providers and fallback order' }).getByRole('status')).toContainText('Groq answers first, then Anthropic Claude, then Google Gemini');
  await expect(groq.getByText('Answers AI requests first')).toBeVisible();
  await expectNoA11yViolations(ops);
  await routing.scrollIntoViewIfNeeded();
  await ops.getByRole('heading', { level: 2, name: 'AI providers', exact: true }).scrollIntoViewIfNeeded();
  await shot(ops, '01-ai-providers-fallback-order');
  await groq.scrollIntoViewIfNeeded();
  await shot(ops, '02-groq-key-tested');

  try {
    // A workspace sees which provider answers and its fallbacks, and Copilot answers through Groq.
    await signUp(page, 'Free AI Keys Ltd');
    await page.goto('/app/agents');
    await expect(page.getByText('Groq', { exact: true })).toBeVisible();
    await expect(page.getByText(/Falls back to: Anthropic Claude \(claude-opus-5-5\), Google Gemini \(gemini-2.5-flash\)/)).toBeVisible();
    await shot(page, '03-workspace-ai-provider');
    await openCopilot(page);
    const panel = page.getByRole('dialog', { name: 'SampForce Copilot' });
    await panel.getByRole('button', { name: 'Summarise my open pipeline.' }).click();
    await expect(panel.getByText(/This is a rule-based projection/)).toBeVisible();
    await shot(page, '04-copilot-answer-through-groq');
  } finally {
    // Leave the deployment as other specs expect it: built-in order, no Groq or Gemini key.
    await ops.reload();
    const r = ops.getByRole('region', { name: 'AI providers and fallback order' });
    await r.getByRole('button', { name: 'Use the built-in order' }).click();
    await expect(r.getByRole('status')).toContainText('Anthropic Claude answers first');
    for (const [name, key] of [['Groq', 'API key GROQ_API_KEY'], ['Google Gemini', 'API key GEMINI_API_KEY']] as const) {
      const card = ops.getByRole('region', { name });
      await card.getByRole('button', { name: 'Update keys' }).click();
      await card.getByRole('form', { name: `Edit ${name} keys` }).getByLabel(/Remove the saved value/).check();
      await card.getByRole('button', { name: 'Save keys' }).click();
      await expect(card.getByRole('list', { name: `${name} keys` })).toContainText(key.split(' ').pop() + 'Missing');
    }
  }
});
