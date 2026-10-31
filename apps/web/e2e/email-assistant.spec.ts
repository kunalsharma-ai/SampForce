import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { seedInboundEmail, signUp } from './helpers';

const ORIGIN = { origin: 'http://localhost:3000' };

async function expectNoA11yViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(
    results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
  ).toEqual([]);
}

test('drafts a template with AI, improves it and picks a subject, all as suggestions until used', async ({
  page,
}) => {
  await signUp(page, 'AI Writer');
  await page.goto('/app/sequences');
  await page.getByRole('tab', { name: 'Templates' }).click();
  await page.getByRole('button', { name: 'New template' }).click();
  await page.getByRole('button', { name: 'Write with AI' }).click();
  await page.getByLabel('What should the email achieve?').fill('our new reporting add-on');
  await page.getByRole('button', { name: 'Draft email' }).click();
  const suggestion = page.getByLabel('AI suggestion');
  await expect(suggestion.getByText('A quick idea for {{company}}')).toBeVisible();
  // Nothing changes in the editor until the person chooses to use it.
  await expect(page.getByLabel('Subject', { exact: true })).toHaveValue('');
  await expectNoA11yViolations(page);
  await page.getByRole('button', { name: 'Use this' }).click();
  await expect(page.getByLabel('Subject', { exact: true })).toHaveValue(
    'A quick idea for {{company}}',
  );
  await expect(page.getByLabel('Email', { exact: true })).toHaveValue(
    /Hi \{\{first_name\|there\}\},/,
  );

  await page
    .getByLabel('Email', { exact: true })
    .fill('Hi {{first_name|there}}, i dont want to waste your time.');
  await page.getByRole('button', { name: 'Improve writing' }).click();
  await expect(
    suggestion.getByText("Hi {{first_name|there}}, I don't want to waste your time."),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Use this' }).click();
  await expect(page.getByLabel('Email', { exact: true })).toHaveValue(
    "Hi {{first_name|there}}, I don't want to waste your time.",
  );

  await page.getByRole('button', { name: 'Suggest subject lines' }).click();
  await page.getByRole('button', { name: 'Use subject: Quick question' }).click();
  await expect(page.getByLabel('Subject', { exact: true })).toHaveValue('Quick question');
  await page.getByLabel('Name', { exact: true }).fill('AI opener');
  await page.getByRole('button', { name: 'Save template' }).click();
  await expect(page.getByRole('heading', { name: /AI opener/ })).toBeVisible();
});

test('reads a received email for intent and drafts a reply the person reviews before sending', async ({
  page,
}) => {
  await signUp(page, 'AI Reader');
  const contact = await (
    await page.request.post('/api/v1/contacts', {
      data: { firstName: 'Ivy', lastName: 'Buyer', email: 'ivy@buyer.test' },
      headers: ORIGIN,
    })
  ).json();
  await seedInboundEmail(page, {
    from: 'ivy@buyer.test',
    subject: 'Pricing',
    body: 'Honestly this is too expensive for us. Is there a smaller plan?',
    contactId: contact.id,
  });

  await page.goto('/app/communication');
  await page.getByRole('button', { name: /Pricing/ }).click();
  await page.getByRole('button', { name: 'Read with AI' }).click();
  const reading = page.getByLabel('AI reading of this email');
  await expect(reading.getByText('Raised an objection')).toBeVisible();
  await expect(reading.getByText('Objections: Price is too high')).toBeVisible();
  await expect(reading.getByText(/not a confirmed fact/)).toBeVisible();
  await expectNoA11yViolations(page);

  await page.getByRole('button', { name: 'Reply with this draft' }).click();
  await expect(page.getByRole('heading', { name: 'New email' })).toBeVisible();
  await expect(page.getByLabel('To', { exact: true })).toHaveValue('ivy@buyer.test');
  await expect(page.getByLabel('Subject', { exact: true })).toHaveValue('Re: Pricing');
  await expect(page.getByRole('textbox', { name: 'Message' })).toHaveValue(/\[answer\]/);
  await page.getByRole('button', { name: 'Cancel' }).click();

  // The list shows the AI's reading, labelled as such.
  await page.reload();
  await expect(page.getByText('AI: Raised an objection')).toBeVisible();
});
