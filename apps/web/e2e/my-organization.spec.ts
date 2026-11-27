import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { signUp } from './helpers';

/*
 * My Organization (ADR 0100): the Super Workspace sets up the organisation's profile, uploads documents with their
 * expiry dates and approves some for clients, keeps a portal login sealed, shares a link with a client, and the
 * client opens the link without signing in. Every step lands in the activity history.
 */

const ORIGIN = { origin: 'http://localhost:3000' };
const PREVIEW_DIR = process.env.PREVIEW_DIR;

test.use({ reducedMotion: 'reduce', viewport: { width: 1440, height: 1000 }, deviceScaleFactor: PREVIEW_DIR ? 2 : 1 });

async function shot(page: Page, name: string, fullPage = false) {
  if (PREVIEW_DIR) await page.screenshot({ path: `${PREVIEW_DIR}/${name}.png`, fullPage });
}

async function axe(page: Page) {
  const r = await new AxeBuilder({ page }).include('main').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(r.violations.map((v) => `${v.id} ${v.nodes[0]?.target} ${v.nodes[0]?.failureSummary}`)).toEqual([]);
}

/** A real one-page PDF with a line of text, so the preview has something to show. */
function pdf(text: string): Buffer {
  const content = `BT /F1 28 Tf 72 700 Td (${text}) Tj ET\nBT /F1 14 Tf 72 660 Td (Issued to Northwind Fieldwork Pvt. Ltd.) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((n) => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

const LOGO = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0f766e"/><stop offset="1" stop-color="#1d4ed8"/></linearGradient></defs><rect width="120" height="120" rx="28" fill="url(#g)"/><path d="M30 86V34h12l26 34V34h12v52H68L42 52v34z" fill="#fff"/></svg>',
);

async function uploadDoc(page: Page, file: { name: string; type: string; body: Buffer }, meta: Record<string, unknown>) {
  const res = await page.request.post(`/api/v1/organization/documents?${new URLSearchParams({ name: file.name, meta: JSON.stringify(meta) })}`, {
    data: file.body,
    headers: { ...ORIGIN, 'content-type': file.type },
  });
  expect(res.ok(), await res.text()).toBe(true);
  return res.json();
}

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

test('sets up My Organization, keeps documents and credentials, and shares approved items with a client', async ({ page, browser }) => {
  test.setTimeout(240_000);
  const { password } = await signUp(page, 'Northwind Fieldwork');

  // It sits in the Organization menu, and starts with an invitation to set it up.
  await page.getByRole('link', { name: 'My Organization' }).first().click();
  await expect(page).toHaveURL(/\/app\/my-organization$/);
  await expect(page.getByText('Set up your organization once, for every workspace')).toBeVisible();
  await shot(page, '01-empty-hub');

  // The profile form: identity first.
  await page.getByRole('button', { name: 'Set up profile' }).first().click();
  await page.getByLabel('Company name').fill('Northwind Fieldwork');
  await page.getByLabel('Legal name').fill('Northwind Fieldwork Pvt. Ltd.');
  await page.getByLabel('Tagline').fill('Fieldwork you can trust, in 40 countries');
  await page.getByLabel('Founded in').fill('2014');
  await page.getByLabel('Number of employees').fill('180');
  await page.getByLabel('Company description').fill('Market research data collection: online panels, CATI, face-to-face and qualitative fieldwork across Asia, Europe and the Middle East.');
  await page.getByLabel('Registration number').fill('U74999MH2014PTC255001');
  await page.getByRole('textbox', { name: 'Website', exact: true }).fill('https://northwind-fieldwork.example');
  await shot(page, '02-profile-form');
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.getByRole('heading', { name: 'Northwind Fieldwork', level: 1 })).toBeVisible();

  // The rest of the profile goes in through the same API the form uses, to keep the test short.
  const saved = await page.request.put('/api/v1/organization/profile', {
    headers: ORIGIN,
    data: {
      services: ['Online surveys', 'CATI', 'Face-to-face', 'Qualitative research', 'Panel management'],
      industriesServed: ['Healthcare', 'Technology', 'FMCG'],
      certifications: ['ISO 20252', 'ISO 27001'],
      businessActivities: 'Survey programming, sample, fieldwork management and data processing.',
      companyType: 'Private Limited',
      registrationAuthority: 'Registrar of Companies, Mumbai',
      incorporationDate: '2014-06-12',
      incorporationCountry: 'IN',
      taxIds: [
        { label: 'GSTIN', value: '27AABCN1234A1Z5' },
        { label: 'PAN', value: 'AABCN1234A' },
      ],
      registeredAddress: { country: 'IN', state: 'Maharashtra', city: 'Mumbai', address: '5th floor, Andheri Kurla Road, Andheri East', postalCode: '400069' },
      offices: [
        { label: 'Delhi office', country: 'IN', city: 'New Delhi', address: 'Connaught Place' },
        { label: 'London office', country: 'GB', city: 'London', address: '20 Farringdon Road' },
      ],
      phones: [{ value: '+91 22 4000 1000', label: 'Main' }],
      emails: [
        { value: 'hello@northwind-fieldwork.example', label: 'Sales' },
        { value: 'bids@northwind-fieldwork.example', label: 'Bids' },
      ],
      websiteLinks: [
        { label: 'Case studies', url: 'https://northwind-fieldwork.example/case-studies' },
        { label: 'Panel book', url: 'https://northwind-fieldwork.example/panel-book' },
      ],
      socialLinks: [{ platform: 'linkedin', url: 'https://www.linkedin.com/company/northwind-fieldwork' }],
      keyContacts: [{ name: 'Anita Rao', designation: 'Head of Bids', email: 'anita@northwind-fieldwork.example', phone: '+91 98200 11111' }],
      brandColors: ['#0f766e'],
      sharedSections: ['overview', 'services', 'contact', 'addresses', 'links', 'registration', 'key_contacts'],
    },
  });
  expect(saved.ok(), await saved.text()).toBe(true);
  const logo = await page.request.put('/api/v1/organization/logo', { data: LOGO, headers: { ...ORIGIN, 'content-type': 'image/svg+xml' } });
  expect(logo.ok(), await logo.text()).toBe(true);

  // A few documents: one expired, one expiring soon, one approved for clients.
  await uploadDoc(page, { name: 'certificate-of-incorporation.pdf', type: 'application/pdf', body: pdf('Certificate of Incorporation') }, { title: 'Certificate of incorporation', category: 'registration', issuer: 'Registrar of Companies, Mumbai', issueDate: '2014-06-12', clientShareable: true });
  await uploadDoc(page, { name: 'gst-registration.pdf', type: 'application/pdf', body: pdf('GST Registration') }, { title: 'GST registration certificate', category: 'tax', referenceNumber: '27AABCN1234A1Z5', clientShareable: true });
  await uploadDoc(page, { name: 'esomar-membership.pdf', type: 'application/pdf', body: pdf('ESOMAR Corporate Member') }, { title: 'ESOMAR corporate membership', category: 'membership', expiryDate: day(18), clientShareable: true });
  await uploadDoc(page, { name: 'capabilities-2025.pdf', type: 'application/pdf', body: pdf('Capabilities deck 2025') }, { title: 'Capabilities presentation 2025', category: 'presentation', expiryDate: day(-5) });
  await uploadDoc(page, { name: 'bank-letter.pdf', type: 'application/pdf', body: pdf('Bank reference letter') }, { title: 'Bank reference letter', category: 'financial', visibility: 'MANAGERS' });

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Northwind Fieldwork', level: 1 })).toBeVisible();
  await expect(page.getByText('Needs renewal')).toBeVisible();
  await shot(page, '03-overview', true);
  await axe(page);

  // Upload a document from the page: the ISO certificate, approved for clients, with an expiry date.
  await page.getByRole('button', { name: 'Upload document' }).first().click();
  const up = page.getByRole('dialog', { name: 'Upload a document' });
  await up.locator('input[type=file]').setInputFiles({ name: 'iso-20252-certificate.pdf', mimeType: 'application/pdf', buffer: pdf('ISO 20252:2019 Certificate') });
  await expect(up.getByLabel('Title *')).toHaveValue('Iso 20252 certificate');
  await up.getByLabel('Title *').fill('ISO 20252 certificate');
  await up.getByLabel('Category').selectOption('certification');
  await up.getByLabel('Issued by').fill('Bureau Veritas');
  await up.getByLabel('Issue date').fill('2024-03-01');
  await up.getByLabel('Expiry date').fill(day(420));
  await up.getByLabel('Approved for clients').check();
  await shot(page, '04-upload-dialog');
  await up.getByRole('button', { name: 'Upload', exact: true }).click();

  // It opens straight away, with the PDF shown in the page.
  const detail = page.getByRole('dialog', { name: 'ISO 20252 certificate' });
  await expect(detail).toBeVisible();
  await expect(detail.locator('iframe[title="Preview of ISO 20252 certificate"]')).toBeVisible();
  await expect(detail.getByText('Approved for clients')).toBeVisible();
  await page.waitForTimeout(800);
  await shot(page, '05-document-preview');

  // Replace it with a renewed file: the first version stays in the history.
  await detail.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Replace file' }).click();
  await detail.getByLabel('New file').setInputFiles({ name: 'iso-20252-certificate-2027.pdf', mimeType: 'application/pdf', buffer: pdf('ISO 20252:2019 Certificate (renewed)') });
  await detail.getByLabel('What changed (optional)').fill('Renewed for 2027');
  await detail.getByRole('button', { name: 'Replace file' }).click();
  await expect(detail.getByText('“Renewed for 2027”')).toBeVisible();
  await expect(detail.getByText('iso-20252-certificate.pdf')).toBeVisible();
  await page.keyboard.press('Escape');

  // The library: search, filters and cards.
  await page.getByRole('tab', { name: 'Documents' }).click();
  await expect(page.locator('[data-document]')).toHaveCount(6);
  await shot(page, '06-documents', true);
  await page.getByRole('button', { name: 'Tax documents' }).click();
  await expect(page.locator('[data-document]')).toHaveCount(1);
  await page.getByRole('button', { name: 'All categories' }).click();
  await page.getByLabel('Search documents').fill('esomar');
  await expect(page.locator('[data-document]')).toHaveCount(1);
  await expect(page.locator('[data-document="ESOMAR corporate membership"]').getByText('Expires in 18 days')).toBeVisible();
  await page.getByLabel('Search documents').fill('');
  await page.getByLabel('Expiry', { exact: true }).selectOption('expired');
  await expect(page.locator('[data-document]')).toHaveCount(1);
  await expect(page.locator('[data-document="Capabilities presentation 2025"]')).toBeVisible();
  await page.getByLabel('Expiry', { exact: true }).selectOption('');
  await axe(page);

  // Credentials: sealed, revealed only after the password, and the reveal is logged.
  await page.getByRole('tab', { name: 'Credentials' }).click();
  await page.getByRole('button', { name: 'Add credential' }).first().click();
  const cred = page.getByRole('dialog', { name: 'Add a credential' });
  await cred.getByLabel('Name *').fill('GST portal');
  await cred.getByLabel('Kind').selectOption('tax_portal');
  await cred.getByRole('textbox', { name: 'Website', exact: true }).fill('https://gst.example.gov');
  await cred.getByLabel('Username or ID').fill('27AABCN1234A1Z5');
  await cred.getByLabel('Password or secret', { exact: true }).fill('S3cret-Portal-Pass');
  await cred.getByLabel('Notes').fill('OTP goes to the finance phone.');
  await cred.getByRole('button', { name: 'Add credential' }).click();
  const card = page.locator('[data-credential="GST portal"]');
  await expect(card).toBeVisible();
  await expect(card.getByText('S3cret-Portal-Pass')).toHaveCount(0);
  await card.getByRole('button', { name: 'Reveal' }).click();
  const ask = page.getByRole('dialog', { name: 'Reveal this credential?' });
  await ask.getByLabel('Password', { exact: true }).fill(password);
  await ask.getByRole('button', { name: 'Reveal' }).click();
  await expect(card.getByText('S3cret-Portal-Pass')).toBeVisible();
  await expect(card.getByText('OTP goes to the finance phone.')).toBeVisible();
  await shot(page, '07-credentials');
  await card.getByRole('button', { name: /^Hide/ }).click();
  await expect(card.getByText('S3cret-Portal-Pass')).toHaveCount(0);

  // Share with a client: the profile and two approved documents.
  await page.getByRole('button', { name: 'Share with a client' }).first().click();
  const share = page.getByRole('dialog', { name: 'Share with a client' });
  await expect(share.getByText('Capabilities presentation 2025')).toHaveCount(0); // not approved for clients
  await expect(share.getByText('Bank reference letter')).toHaveCount(0); // internal
  await share.getByText('ISO 20252 certificate').click();
  await share.getByText('Certificate of incorporation').click();
  await share.getByLabel('Client name').fill('Priya at Acme Insights');
  await share.getByLabel('Client email').fill('priya@acme-insights.example');
  await share.getByLabel('Note on the page (optional)').fill('Hi Priya, here are our company details and certificates for the vendor registration.');
  await share.getByLabel('Link works for').selectOption('14');
  await shot(page, '08-share-dialog');
  await share.getByRole('button', { name: 'Make the link' }).click();
  const ready = page.getByRole('dialog', { name: 'The link is ready' });
  await expect(ready).toBeVisible();
  const url = await ready.getByLabel('Client link').inputValue();
  expect(url).toMatch(/\/shared\/organization\//);
  await shot(page, '09-share-ready');
  await ready.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('tab', { name: 'Client shares', selected: true })).toBeVisible();
  await expect(page.locator('[data-share="Priya at Acme Insights"]')).toContainText('Not opened yet');

  // The client opens it without signing in: only what was chosen.
  const client = await browser.newContext({ viewport: { width: 1280, height: 1000 }, deviceScaleFactor: PREVIEW_DIR ? 2 : 1, reducedMotion: 'reduce' });
  const visitor = await client.newPage();
  await visitor.goto(new URL(url).pathname);
  await expect(visitor.getByRole('heading', { name: 'Northwind Fieldwork', level: 1 })).toBeVisible();
  await expect(visitor.getByText('Hi Priya, here are our company details')).toBeVisible();
  await expect(visitor.locator('[data-shared-document]')).toHaveCount(2);
  await expect(visitor.getByText('Bank reference letter')).toHaveCount(0);
  await expect(visitor.getByText('GST portal')).toHaveCount(0);
  await expect(visitor.getByText('27AABCN1234A1Z5')).toHaveCount(0); // tax IDs were not shared
  await expect(visitor.getByText('U74999MH2014PTC255001')).toBeVisible();
  const href = await visitor.locator('[data-shared-document="ISO 20252 certificate"]').getByRole('link', { name: 'Download' }).getAttribute('href');
  const file = await visitor.request.get(href!);
  expect(file.ok()).toBe(true);
  expect(file.headers()['content-type']).toContain('application/pdf');
  await visitor.waitForTimeout(500);
  await shot(visitor, '10-client-view', true);
  await client.close();

  // The share shows it was opened, and it can be stopped.
  await page.reload();
  const row = page.locator('[data-share="Priya at Acme Insights"]');
  await expect(row).toContainText('Opened 1 times');
  await shot(page, '11-client-shares');
  await row.getByRole('button', { name: 'Stop link' }).click();
  await row.getByRole('button', { name: 'Stop link' }).click();
  await expect(row).toContainText('Stopped');
  const gone = await page.request.get(new URL(url).pathname.replace('/shared/organization/', '/api/v1/organization-shares/'));
  expect(gone.status()).toBe(404);

  // Delete a document: it asks first, says what is at stake, and needs the password.
  await page.getByRole('tab', { name: 'Documents' }).click();
  await page.locator('[data-document="Capabilities presentation 2025"]').getByRole('button', { name: 'Open Capabilities presentation 2025' }).click();
  const doc = page.getByRole('dialog', { name: 'Capabilities presentation 2025' });
  await doc.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Delete document' }).click();
  const confirm = page.getByRole('dialog', { name: 'Delete this document?' });
  await expect(confirm).toContainText('will be deleted for every workspace');
  await confirm.getByLabel('Password', { exact: true }).fill(password);
  await confirm.getByRole('button', { name: 'Confirm delete' }).click();
  await expect(page.locator('[data-document="Capabilities presentation 2025"]')).toHaveCount(0);

  // Everything is in the activity history.
  await page.getByRole('tab', { name: 'Activity history' }).click();
  for (const line of ['Created the organization profile', 'Uploaded a new logo', 'Replaced a document with a new version', 'Revealed a credential', 'Shared with a client', 'A client opened a share', 'Stopped a client share', 'Deleted a document']) {
    await expect(page.getByText(line).first()).toBeVisible();
  }
  await shot(page, '12-activity', true);
  await axe(page);
});
