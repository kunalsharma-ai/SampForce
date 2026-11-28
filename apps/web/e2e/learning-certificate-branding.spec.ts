import { readFileSync, writeFileSync } from 'node:fs';
import { join as joinPath } from 'node:path';
import { type APIRequestContext, type Browser, expect, type Page, test } from '@playwright/test';
import { signUp } from './helpers';

/*
 * Branded learning certificates (ADR 0103), for two organisations with their own name, tagline, logo and brand
 * colours in My Organization. Each one's executive passes a module and gets a certificate drawn in that
 * organisation's branding: on screen, in the PDF and on the public check page. Neither borrows the other's.
 */

const ORIGIN = { origin: 'http://localhost:3000' };
const PREVIEW_DIR = process.env.PREVIEW_DIR;
const LESSON = readFileSync(joinPath(__dirname, '../../api/src/learning/fixtures/sales-communication.txt'), 'utf8');

test.use({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 }, deviceScaleFactor: PREVIEW_DIR ? 2 : 1 });

async function call<T = Record<string, unknown>>(req: APIRequestContext, method: 'get' | 'post' | 'put' | 'patch', path: string, data?: object): Promise<T> {
  const res = method === 'get' ? await req.get(`/api/v1${path}`) : await req[method](`/api/v1${path}`, { data: data ?? {}, headers: ORIGIN });
  expect(res.ok(), await res.text()).toBe(true);
  return res.json() as Promise<T>;
}

async function shot(page: Page, name: string, target?: string) {
  if (!PREVIEW_DIR) return;
  await page.waitForTimeout(600);
  if (target) await page.locator(target).first().screenshot({ path: `${PREVIEW_DIR}/${name}.png` });
  else await page.screenshot({ path: `${PREVIEW_DIR}/${name}.png` });
}

async function join(browser: Browser, inviteUrl: string, name: string): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: PREVIEW_DIR ? 2 : 1, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  const token = inviteUrl.split('/invite/')[1]!;
  const res = await page.request.post('/api/v1/auth/invitations/accept', { data: { token, name, password: 'a-long-password-1' }, headers: ORIGIN });
  expect(res.ok(), await res.text()).toBe(true);
  await page.goto('/app');
  return page;
}

interface Org {
  name: string;
  tagline: string;
  colors: [string, string];
  logo: string;
  template: 'CLASSIC' | 'MODERN' | 'EXECUTIVE';
  signatory: [string, string];
  learner: string;
  module: string;
}

const ORGS: Org[] = [
  {
    name: 'Frequent Research',
    tagline: 'Fieldwork you can trust, worldwide',
    colors: ['#0f766e', '#f59e0b'],
    template: 'CLASSIC',
    signatory: ['Kunal Sharma', 'Head of Learning & Development'],
    learner: 'Ravi Patel',
    module: 'Consultative selling for research buyers',
    logo: `<svg xmlns="http://www.w3.org/2000/svg" width="520" height="140" viewBox="0 0 520 140">
      <rect x="6" y="10" width="120" height="120" rx="28" fill="#0f766e"/>
      <path d="M40 100 V40 H92 M40 70 H80" stroke="#ffffff" stroke-width="14" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="98" cy="98" r="12" fill="#f59e0b"/>
      <text x="150" y="78" font-family="DejaVu Sans, sans-serif" font-size="46" font-weight="700" fill="#0f172a">Frequent</text>
      <text x="152" y="116" font-family="DejaVu Sans, sans-serif" font-size="27" letter-spacing="7" fill="#0f766e">RESEARCH</text>
    </svg>`,
  },
  {
    name: 'Northwind Insights',
    tagline: 'Data-driven growth for modern teams',
    colors: ['#4338ca', '#db2777'],
    template: 'MODERN',
    signatory: ['Elena Fischer', 'Chief People Officer'],
    learner: 'Aisha Khan',
    module: 'Negotiation fundamentals for account managers',
    logo: `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="140" viewBox="0 0 480 140">
      <polygon points="70,8 132,70 70,132 8,70" fill="#4338ca"/>
      <polygon points="70,36 104,70 70,104 36,70" fill="#db2777"/>
      <text x="150" y="86" font-family="DejaVu Sans, sans-serif" font-size="44" font-weight="700" fill="#1e1b4b">northwind</text>
      <text x="152" y="118" font-family="DejaVu Sans, sans-serif" font-size="20" letter-spacing="9" fill="#db2777">INSIGHTS</text>
    </svg>`,
  },
];

interface KeyQuestion {
  id: string;
  type: string;
  correctOptionIds: string[];
  correctBoolean: boolean | null;
  blanks: string[][];
  pairs: { id: string; right: string }[];
  acceptedAnswers: string[];
}

/** Sets up one organisation's branding and takes its executive through a module to a certificate. */
async function certifiedLearner(page: Page, browser: Browser, org: Org, stamp: number) {
  await signUp(page, org.name);
  await page.evaluate(() => localStorage.setItem('dealflow:preferences', JSON.stringify({ state: { theme: 'light', motion: 'off' }, version: 0 })));
  await call(page.request, 'put', '/organization/profile', { brandName: org.name, tagline: org.tagline, brandColors: org.colors });
  const logo = await page.request.put('/api/v1/organization/logo', { data: Buffer.from(org.logo), headers: { ...ORIGIN, 'content-type': 'image/svg+xml' } });
  expect(logo.ok(), await logo.text()).toBe(true);
  await call(page.request, 'put', '/learning/settings', { template: org.template, signatoryName: org.signatory[0], signatoryTitle: org.signatory[1] });

  const ew = await call<{ inviteUrl: string }>(page.request, 'post', '/workspaces', { level: 'EXECUTIVE', name: `${org.learner.split(' ')[0]} desk`, designation: 'Account Executive', person: { inviteEmail: `learner.${stamp}.${org.template.toLowerCase()}@example.com` } });
  const exec = await join(browser, ew.inviteUrl, org.learner);

  const m = await call<{ id: string }>(page.request, 'post', '/learning/modules', { title: org.module, passingScore: 70, maxAttempts: 2 });
  await call(page.request, 'post', `/learning/modules/${m.id}/lessons`, { title: 'Read: the essentials', kind: 'TEXT', body: LESSON });
  const gen = await call<{ created: { id: string }[] }>(page.request, 'post', `/learning/modules/${m.id}/generate`, { types: ['MCQ', 'TRUE_FALSE', 'FILL_BLANK'], count: 5 });
  await call(page.request, 'post', `/learning/modules/${m.id}/questions/review`, { ids: gen.created.map((q) => q.id), approve: true });
  await call(page.request, 'post', `/learning/modules/${m.id}/publish`);
  const people = await call<{ id: string; name: string }[]>(page.request, 'get', '/learning/assignees');
  await call(page.request, 'post', `/learning/modules/${m.id}/assign`, { userIds: [people.find((p) => p.name === org.learner)!.id] });

  const player = await call<{ lessons: { id: string }[] }>(exec.request, 'get', `/learning/modules/${m.id}/player`);
  for (const l of player.lessons) await call(exec.request, 'put', `/learning/modules/${m.id}/lessons/${l.id}/progress`, { done: true, seconds: 300 });
  const key = (await call<{ questionList: KeyQuestion[] }>(page.request, 'get', `/learning/modules/${m.id}`)).questionList;
  const attempt = await call<{ id: string; questions: { id: string }[] }>(exec.request, 'post', `/learning/modules/${m.id}/attempts`);
  const answers: Record<string, object> = {};
  for (const q of attempt.questions) {
    const k = key.find((x) => x.id === q.id)!;
    if (k.type === 'MCQ' || k.type === 'MULTI') answers[q.id] = { optionIds: k.correctOptionIds };
    else if (k.type === 'TRUE_FALSE') answers[q.id] = { value: k.correctBoolean };
    else if (k.type === 'FILL_BLANK') answers[q.id] = { blanks: k.blanks.map((b) => b[0]!) };
    else answers[q.id] = { text: k.acceptedAnswers[0] ?? 'answer' };
  }
  const done = await call<{ passed: boolean }>(exec.request, 'post', `/learning/attempts/${attempt.id}/submit`, { answers });
  expect(done.passed).toBe(true);
  const cert = (await call<{ certificate: { id: string; code: string } }>(exec.request, 'get', `/learning/modules/${m.id}/player`)).certificate;
  return { exec, cert };
}

test('two organisations each get certificates in their own logo, name and colours', async ({ page, browser }) => {
  test.setTimeout(240_000);
  const stamp = Date.now();
  const seen: { org: Org; code: string; logoUrl: string }[] = [];

  for (const [i, org] of ORGS.entries()) {
    const ownerPage = i === 0 ? page : await (await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: PREVIEW_DIR ? 2 : 1, reducedMotion: 'reduce' })).newPage();
    const { exec, cert } = await certifiedLearner(ownerPage, browser, org, stamp);
    const slug = org.template === 'CLASSIC' ? 'a' : 'b';

    // On screen: the certificate is drawn in this organisation's branding.
    await exec.goto(`/app/learning/certificates?open=${cert.id}`);
    const art = exec.locator('[data-certificate-art]');
    await expect(art).toBeVisible();
    await expect(art).toHaveAttribute('data-certificate-art', org.template);
    await expect(art).toHaveAttribute('aria-label', new RegExp(`^${org.name}: certificate`));
    await expect(art.locator('text', { hasText: org.name.toUpperCase() })).toBeVisible();
    await expect(art.locator('text', { hasText: org.tagline })).toBeVisible();
    await expect(art.locator('text', { hasText: org.learner })).toBeVisible();
    await expect(art.locator('text', { hasText: org.signatory[1] })).toBeVisible();
    const logo = art.locator('image').first();
    await expect(logo).toHaveAttribute('href', /\/api\/v1\/learning\/brand\/logo\?v=/);
    expect(await art.locator(`[fill="${org.colors[0]}"]`).count()).toBeGreaterThan(0);
    // Wait for the web fonts and images before the picture.
    await exec.evaluate(() => document.fonts.ready);
    await expect.poll(() => art.locator('image').evaluateAll((els) => els.length)).toBeGreaterThan(1);
    await shot(exec, `org-${slug}-1-certificate-on-screen`, '[data-certificate-art]');
    await shot(exec, `org-${slug}-2-certificate-dialog`);

    // The PDF: the same design with the logo embedded.
    const pdf = await exec.request.get(`/api/v1/learning/certificates/${cert.id}/pdf`);
    expect(pdf.headers()['content-type']).toContain('application/pdf');
    const body = await pdf.body();
    expect((body.toString('latin1').match(/\/Subtype \/Image/g) ?? []).length).toBeGreaterThan(1);
    if (PREVIEW_DIR) writeFileSync(`${PREVIEW_DIR}/org-${slug}-certificate.pdf`, body);

    // Settings: where the branding comes from, with a live preview.
    await ownerPage.goto('/app/learning/settings');
    await expect(ownerPage.locator('[data-brand-panel]')).toContainText('Branding from My Organization');
    await expect(ownerPage.locator('[data-use-brand-colors]')).toBeChecked();
    await ownerPage.locator('[data-brand-panel]').scrollIntoViewIfNeeded();
    await ownerPage.evaluate(() => document.fonts.ready);
    await shot(ownerPage, `org-${slug}-3-settings`);

    const v = await call<{ brand: { name: string; logoUrl: string } }>(exec.request, 'get', `/learning/verify/${cert.code}`);
    expect(v.brand.name).toBe(org.name);
    seen.push({ org, code: cert.code, logoUrl: v.brand.logoUrl });
  }

  // The public check page, signed out, shows each issuer's own logo and name.
  const visitor = await browser.newPage({ viewport: { width: 1100, height: 760 }, deviceScaleFactor: PREVIEW_DIR ? 2 : 1 });
  for (const s of seen) {
    await visitor.goto(`/verify/certificate/${s.code}`);
    const brand = visitor.locator('[data-verify-brand]');
    await expect(brand).toContainText(s.org.name);
    await expect(brand).toContainText(s.org.tagline);
    await expect(brand.locator('img')).toHaveAttribute('src', s.logoUrl);
    await expect.poll(() => brand.locator('img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
    await shot(visitor, `org-${s.org.template === 'CLASSIC' ? 'a' : 'b'}-4-public-check`);
  }
  // Neither organisation's certificates use the other's logo.
  expect(seen[0]!.logoUrl).not.toBe(seen[1]!.logoUrl);
});

