import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { approveMobile, signUp } from './helpers';

/** Set PREVIEW_DIR to save screenshots of the app at phone size (used for previews). */
const PREVIEW_DIR = process.env.PREVIEW_DIR;
const APP = 'http://localhost:8090';
const API = 'http://localhost:4000';
const ORIGIN = 'http://localhost:3000';

const shot = async (page: Page, name: string) => {
  if (PREVIEW_DIR) await page.screenshot({ path: `${PREVIEW_DIR}/${name}.png` });
};

async function expectNoA11yViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

/**
 * The SampForce app itself (ADR 0072, M3), from its web export at phone size against the real API: sign-in, the
 * organisation's published branding and tabs, More with Help (no Recent list), a question to support, and sign-out.
 */
test('the app signs in, follows the published configuration, and raises a question from Help', async ({ page, browser }) => {
  test.setTimeout(120_000);
  const org = `Phone Org ${Date.now().toString(36)}`;
  const owner = await signUp(page, org);
  await approveMobile(page);

  // The Super Workspace names the app and colours it, and publishes (the screens are tested in mobile-config.spec.ts).
  const center = await (await page.request.get('/api/v1/mobile-config')).json();
  const draft = { ...center.draft, branding: { ...center.draft.branding, appName: 'Field Force', primaryColor: '#E11D48' } };
  expect((await page.request.put('/api/v1/mobile-config/draft', { data: draft, headers: { origin: ORIGIN } })).status()).toBe(200);
  expect((await page.request.post('/api/v1/mobile-config/publish', { data: { note: 'App test' }, headers: { origin: ORIGIN } })).status()).toBe(200);

  const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: PREVIEW_DIR ? 3 : 1, reducedMotion: 'reduce', locale: 'en-GB' })).newPage();
  await phone.goto(APP);
  await expect(phone.getByText('Sign in with your SampForce account.')).toBeVisible();
  await phone.getByLabel('Email').fill(owner.email);
  await phone.getByLabel('Password').fill(owner.password);
  await phone.getByRole('button', { name: 'Use another server' }).click();
  await phone.getByLabel('Server address').fill(API);
  await shot(phone, '10-app-sign-in');
  await expectNoA11yViolations(phone);
  await phone.getByRole('button', { name: 'Sign in', exact: true }).click();

  // Home: the published name and the owner's level, with the dashboard cards for it.
  await expect(phone.getByText(/^Good (morning|afternoon|evening), Test$/)).toBeVisible();
  await expect(phone.getByText('Field Force')).toBeVisible();
  await expect(phone.getByText(`${org} · Super Workspace`)).toBeVisible();
  await expect(phone.getByText('Organisation performance')).toBeVisible();
  await shot(phone, '11-app-home');
  await expectNoA11yViolations(phone);

  // More: the modules without a tab, then Help. There is no Recent list anywhere.
  await phone.getByRole('tab', { name: /More/ }).click();
  await expect(phone.getByRole('button', { name: /^Help/ })).toBeVisible();
  await expect(phone.getByText(/Recent/i)).toHaveCount(0);
  await shot(phone, '12-app-more');

  await phone.getByRole('button', { name: /^Help/ }).click();
  await expect(phone.getByLabel('Search help')).toBeVisible();
  await expect(phone.getByText('Questions', { exact: true })).toBeVisible();
  await shot(phone, '13-app-help');

  // A question to support, from the phone.
  await phone.getByRole('button', { name: 'Ask a question' }).click();
  await phone.getByLabel('Subject').fill('Logging a visit from the phone');
  await phone.getByLabel('Your question').fill('Where do I add notes after a client visit?');
  await phone.getByRole('button', { name: 'Send' }).click();
  await expect(phone.getByText('Where do I add notes after a client visit?')).toBeVisible();
  await expect(phone.getByText(/^#\d+ · Submitted/)).toBeVisible();
  await shot(phone, '14-app-question');
  // The web sees the same ticket, marked as raised from the phone.
  const tickets = (await (await page.request.get('/api/v1/support/tickets')).json()) as { subject: string; source: string }[];
  expect(tickets.find((x) => x.subject === 'Logging a visit from the phone')?.source).toBe('mobile');

  // The organisation sees the signed-in device; signing out ends its session on the server, not only on the phone.
  const devices = async () => JSON.stringify(await (await page.request.get('/api/v1/mobile-access/devices')).json());
  expect(await devices()).toContain('"WEB"');
  await phone.getByRole('tab', { name: /More/ }).click();
  await phone.getByRole('button', { name: 'Sign out' }).click();
  await expect(phone.getByLabel('Password')).toBeVisible();
  expect(await devices()).not.toContain('"WEB"');
});

/**
 * Records on the phone (ADR 0072, M4): a lead added, edited and given a contact and a follow-up from the phone, a task
 * added and finished, all through the real API, and the web sees the same records.
 */
test('the app adds and edits leads, contacts, follow-ups and tasks', async ({ page, browser }) => {
  test.setTimeout(150_000);
  const org = `Records Org ${Date.now().toString(36)}`;
  const owner = await signUp(page, org);
  await approveMobile(page);

  const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: PREVIEW_DIR ? 3 : 1, reducedMotion: 'reduce', locale: 'en-GB', timezoneId: 'Europe/London' })).newPage();
  await phone.goto(APP);
  await phone.getByLabel('Email').fill(owner.email);
  await phone.getByLabel('Password').fill(owner.password);
  await phone.getByRole('button', { name: 'Use another server' }).click();
  await phone.getByLabel('Server address').fill(API);
  await phone.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(phone.getByText('Organisation performance')).toBeVisible();

  // A new lead from the Leads tab.
  await phone.getByRole('tab', { name: /Leads and companies/ }).click();
  await expect(phone.getByText('Nothing here yet.')).toBeVisible();
  await phone.getByRole('button', { name: 'Add Lead' }).click();
  await phone.getByLabel('Company name *').fill('Harbour Labs');
  await phone.getByLabel('City').fill('Leeds');
  await phone.getByLabel('Phone number').fill('+44 113 496 0000');
  await phone.getByRole('radiogroup', { name: 'Lead status' }).getByRole('radio').first().click();
  await shot(phone, '15-app-lead-form');
  await expectNoA11yViolations(phone);
  await phone.getByRole('button', { name: 'Save', exact: true }).click();

  // Its page: the fields, a call button, and the lead's contacts.
  await expect(phone.getByText('Leeds')).toBeVisible();
  await expect(phone.getByRole('link', { name: 'Call' })).toBeVisible();
  await expect(phone.getByText('No contacts yet.')).toBeVisible();
  await shot(phone, '16-app-lead');
  await expectNoA11yViolations(phone);

  await phone.getByRole('button', { name: 'Edit', exact: true }).click();
  await phone.getByLabel('City').fill('York');
  await phone.getByRole('button', { name: 'Save changes' }).click();
  await expect(phone.getByText('York')).toBeVisible();

  // A contact added from the lead's page belongs to the lead.
  await phone.getByRole('button', { name: 'Add Contact' }).click();
  await expect(phone.getByRole('button', { name: 'Change Company' })).toBeVisible();
  await phone.getByLabel('First name *').fill('Priya');
  await phone.getByLabel('Last name').fill('Shah');
  await phone.getByLabel('Job title').fill('Head of buying');
  await phone.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(phone.getByText('Head of buying')).toBeVisible();

  // The web sees the same lead and contact.
  const leads = (await (await page.request.get('/api/v1/companies?q=Harbour')).json()) as { items: { id: string; city: string }[] };
  expect(leads.items[0]?.city).toBe('York');
  const contacts = (await (await page.request.get(`/api/v1/contacts?companyId=${leads.items[0]!.id}`)).json()) as { items: { firstName: string }[] };
  expect(contacts.items.map((c) => c.firstName)).toEqual(['Priya']);

  // A follow-up for the lead, planned for tomorrow, then done with its outcome.
  await phone.goto(`${APP}/companies/${leads.items[0]!.id}`);
  await phone.getByRole('button', { name: 'Plan a follow-up' }).click();
  await phone.getByLabel('Follow-up *').fill('Site visit');
  await phone.getByRole('radiogroup', { name: 'Type *' }).getByRole('radio').first().click();
  await phone.getByRole('button', { name: 'Tomorrow' }).click();
  await shot(phone, '17-app-follow-up-form');
  await expectNoA11yViolations(phone);
  await phone.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(phone.getByRole('button', { name: 'Mark done' })).toBeVisible();
  await phone.getByRole('button', { name: 'Mark done' }).click();
  await phone.getByLabel('Outcome').fill('Met the buyer, sending a quote');
  await phone.getByRole('button', { name: 'Mark done' }).click();
  await expect(phone.getByText('Met the buyer, sending a quote')).toBeVisible();
  await expect(phone.getByText('Done', { exact: true })).toBeVisible();

  // Tasks: added from More, listed as open, then finished.
  await phone.goto(`${APP}/tasks`);
  await phone.getByRole('button', { name: 'Add Task' }).click();
  await phone.getByLabel('Task *').fill('Send the brochure');
  await phone.getByRole('radiogroup', { name: 'Priority' }).getByRole('radio', { name: 'High' }).click();
  await phone.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(phone.getByRole('heading', { name: 'Send the brochure' })).toBeVisible();
  await phone.getByRole('button', { name: 'Mark done' }).click();
  await expect(phone.getByRole('button', { name: 'Reopen' })).toBeVisible();
  await phone.goto(`${APP}/tasks`);
  await expect(phone.getByText('Nothing here yet.')).toBeVisible();
  await phone.getByRole('radio', { name: 'Done' }).click();
  await expect(phone.getByRole('button', { name: /Send the brochure/ })).toBeVisible();
  await shot(phone, '18-app-tasks');
  await expectNoA11yViolations(phone);

  // The lead list finds it by name.
  await phone.goto(`${APP}/companies`);
  await phone.getByLabel('Search leads and companies').fill('Harb');
  await expect(phone.getByRole('button', { name: /Harbour Labs/ })).toBeVisible();
  await shot(phone, '19-app-leads');

  // Home: the cards now carry figures counted from the same records (one lead today, one deal in the pipeline).
  // A Manager Workspace with a monthly lead target, for the targets screen.
  const team = await page.request.post('/api/v1/workspaces', { data: { level: 'MANAGER', name: 'North Team', person: { inviteEmail: `north.${Date.now().toString(36)}@client.test` } }, headers: { origin: ORIGIN } });
  expect(team.status()).toBe(201);
  const today = new Date().toISOString().slice(0, 10);
  expect((await page.request.post('/api/v1/targets', { data: { workspaceId: ((await team.json()) as { id: string }).id, metric: 'LEADS', period: 'MONTHLY', startsOn: today.slice(0, 8) + '01', amount: 4 }, headers: { origin: ORIGIN } })).status()).toBe(201);
  await phone.getByRole('tab', { name: /Dashboard/ }).click();
  const leadsToday = phone.getByRole('button', { name: 'Leads today' });
  await expect(leadsToday).toContainText('1');
  await expect(phone.getByRole('button', { name: 'Targets and achievement' })).toContainText('0 / 4');
  await shot(phone, '20-app-home-figures');
  await expectNoA11yViolations(phone);
  // A tap opens the leads.
  await leadsToday.click();
  await expect(phone.getByRole('button', { name: /Harbour Labs/ })).toBeVisible();

  // Sales targets from More.
  await phone.goto(`${APP}/targets`);
  await expect(phone.getByText('Targets are set on the web.')).toBeVisible();
  await expect(phone.getByText('North Team · Monthly')).toBeVisible();
  await expect(phone.getByText(/0 \/ 4 · 0%/)).toBeVisible();
  await shot(phone, '21-app-targets');
  await expectNoA11yViolations(phone);
});

/**
 * Profile photos (ADR 0072, M6): one set on the web shows in the account menu and on the phone; the phone replaces it
 * with a picture chosen there, and the web shows the new one.
 */
test('profile photos are set on the web and the phone and shown on both', async ({ page, browser }) => {
  test.setTimeout(120_000);
  const owner = await signUp(page, `Photo Org ${Date.now().toString(36)}`);
  await approveMobile(page);
  const picture = readFileSync(join(__dirname, '../src/app/apple-icon.png'));

  // The web: Account security has the photo; the account menu shows it once set.
  await page.goto('/app/account/security');
  await expect(page.getByRole('img', { name: 'No photo yet' })).toBeVisible();
  await page.getByRole('button', { name: 'Add a photo' }).click();
  await page.getByLabel('Choose a photo').setInputFiles({ name: 'me.png', mimeType: 'image/png', buffer: picture });
  await page.getByRole('button', { name: 'Save photo' }).click();
  await expect(page.getByRole('img', { name: 'Your photo' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Account menu' }).locator('img')).toBeVisible();
  const first = ((await (await page.request.get('/api/v1/auth/me')).json()) as { user: { photoUrl: string } }).user.photoUrl;
  expect(first).toMatch(/\/people\/.+\/photo\?v=/);
  await shot(page, '22-web-profile-photo');

  // The phone shows it on the home screen and the profile, and can choose another.
  const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: PREVIEW_DIR ? 3 : 1, reducedMotion: 'reduce', locale: 'en-GB' })).newPage();
  await phone.goto(APP);
  await phone.getByLabel('Email').fill(owner.email);
  await phone.getByLabel('Password').fill(owner.password);
  await phone.getByRole('button', { name: 'Use another server' }).click();
  await phone.getByLabel('Server address').fill(API);
  await phone.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(phone.getByText(/^Good (morning|afternoon|evening), Test$/)).toBeVisible();
  await phone.getByRole('tab', { name: /Profile/ }).click();
  await expect(phone.getByRole('img', { name: 'Your photo' })).toBeVisible();
  const chooser = phone.waitForEvent('filechooser');
  await phone.getByRole('button', { name: 'Change photo' }).click();
  await (await chooser).setFiles({ name: 'phone.png', mimeType: 'image/png', buffer: picture });
  await expect.poll(async () => ((await (await page.request.get('/api/v1/auth/me')).json()) as { user: { photoUrl: string } }).user.photoUrl).not.toBe(first);
  await expect(phone.getByRole('img', { name: 'Your photo' })).toBeVisible();
  await shot(phone, '23-app-profile-photo');
  await expectNoA11yViolations(phone);

  // Removing it on the phone goes back to initials everywhere.
  await phone.getByRole('button', { name: 'Remove photo' }).click();
  await expect(phone.getByRole('img', { name: 'No photo yet' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('img', { name: 'No photo yet' })).toBeVisible();
});

test('chat on the phone: a new direct message, live replies and read marks', async ({ page, browser }) => {
  test.setTimeout(150_000);
  await signUp(page, `Chat Org ${Date.now().toString(36)}`);
  await approveMobile(page);

  // An Executive Workspace with a person who signs in on the phone.
  const ws = await page.request.post('/api/v1/workspaces', { data: { level: 'EXECUTIVE', name: 'Field Desk', person: { inviteEmail: `field.${Date.now().toString(36)}@client.test` } }, headers: { origin: ORIGIN } });
  expect(ws.status()).toBe(201);
  const token = ((await ws.json()) as { inviteUrl: string }).inviteUrl.split('/invite/')[1]!;
  const guest = await browser.newContext();
  const accepted = await guest.request.post(`${API}/api/v1/auth/invitations/accept`, { data: { token, name: 'Priya Shah', password: 'a-long-password-1' }, headers: { origin: ORIGIN } });
  expect(accepted.status()).toBe(200);
  const priya = ((await (await guest.request.get(`${API}/api/v1/auth/me`)).json()) as { user: { email: string } }).user.email;

  const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: PREVIEW_DIR ? 3 : 1, reducedMotion: 'reduce', locale: 'en-GB' })).newPage();
  await phone.goto(APP);
  await phone.getByLabel('Email').fill(priya);
  await phone.getByLabel('Password').fill('a-long-password-1');
  await phone.getByRole('button', { name: 'Use another server' }).click();
  await phone.getByLabel('Server address').fill(API);
  await phone.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(phone.getByText(/^Good (morning|afternoon|evening), Priya$/)).toBeVisible();

  // Chat lives under More for an Executive. Nothing yet; a new message lists who Priya may write to.
  await phone.getByRole('tab', { name: /More/ }).click();
  await phone.getByRole('button', { name: /^Internal chat/ }).click();
  await expect(phone.getByText('No conversations yet.')).toBeVisible();
  await phone.getByRole('button', { name: 'New message' }).click();
  await expect(phone.getByRole('button', { name: 'Write to Test Person' })).toBeVisible();
  await shot(phone, '24-app-chat-people');
  await expectNoA11yViolations(phone);
  await phone.getByRole('button', { name: 'Write to Test Person' }).click();
  await expect(phone.getByText('No messages yet. Say hello.')).toBeVisible();
  await phone.getByLabel('Write a message').fill('Reached the client site, starting the visit now.');
  await phone.getByRole('button', { name: 'Send' }).click();
  await expect(phone.getByText('Reached the client site, starting the visit now.')).toBeVisible();
  await expect(phone.getByText(/^(Sent|Delivered)$/)).toBeVisible();

  // The web has it; its reply reaches the phone without a refresh, and reading it there shows "Read" on the phone.
  const convs = (await (await page.request.get('/api/v1/chat/conversations')).json()) as { id: string; title: string; unread: number }[];
  const conv = convs.find((c) => c.title === 'Priya Shah')!;
  expect(conv.unread).toBe(1);
  const last = ((await (await page.request.get(`/api/v1/chat/conversations/${conv.id}/messages`)).json()) as { id: string; body: string; author: { id: string } }[]).at(-1)!;
  expect(last.body).toBe('Reached the client site, starting the visit now.');
  expect((await page.request.post(`/api/v1/chat/conversations/${conv.id}/read`, { data: { messageId: last.id }, headers: { origin: ORIGIN } })).status()).toBe(200);
  await expect(phone.getByText('Read', { exact: true })).toBeVisible({ timeout: 15_000 });
  const reply = await page.request.post(`/api/v1/chat/conversations/${conv.id}/messages`, { data: { clientId: crypto.randomUUID(), body: 'Great, send me the notes after.' }, headers: { origin: ORIGIN } });
  expect(reply.status()).toBe(201);
  await expect(phone.getByText('Great, send me the notes after.').last()).toBeVisible({ timeout: 15_000 });
  await shot(phone, '25-app-chat-conversation');
  await expectNoA11yViolations(phone);

  // Back to the list: the conversation with its last message.
  await phone.goto(`${APP}/chat`);
  // Nothing left unread: the phone read the reply as it arrived.
  await expect(phone.getByRole('button', { name: 'Test Person', exact: true })).toContainText('Great, send me the notes after.');
  await shot(phone, '26-app-chat-list');
  await expect.poll(async () => ((await (await guest.request.get(`${API}/api/v1/chat/conversations`)).json()) as { unread: number }[])[0]?.unread).toBe(0);
});

test('announcements are posted on the web and reach the phone’s home screen and notifications', async ({ page, browser }) => {
  test.setTimeout(150_000);
  await signUp(page, `Notice Org ${Date.now().toString(36)}`);
  await approveMobile(page);
  // The Executive home screen shows the announcements card.
  const center = await (await page.request.get('/api/v1/mobile-config')).json();
  const dashboard = { ...center.draft.dashboard, EXECUTIVE: [{ card: 'announcements', showChart: false }, ...center.draft.dashboard.EXECUTIVE.filter((c: { card: string }) => c.card !== 'announcements')] };
  expect((await page.request.put('/api/v1/mobile-config/draft', { data: { ...center.draft, dashboard }, headers: { origin: ORIGIN } })).status()).toBe(200);
  expect((await page.request.post('/api/v1/mobile-config/publish', { data: { note: 'Announcements card' }, headers: { origin: ORIGIN } })).status()).toBe(200);

  const ws = await page.request.post('/api/v1/workspaces', { data: { level: 'EXECUTIVE', name: 'Field Desk', person: { inviteEmail: `notice.${Date.now().toString(36)}@client.test` } }, headers: { origin: ORIGIN } });
  const token = ((await ws.json()) as { inviteUrl: string }).inviteUrl.split('/invite/')[1]!;
  const guest = await browser.newContext();
  expect((await guest.request.post(`${API}/api/v1/auth/invitations/accept`, { data: { token, name: 'Priya Shah', password: 'a-long-password-1' }, headers: { origin: ORIGIN } })).status()).toBe(200);
  const priya = ((await (await guest.request.get(`${API}/api/v1/auth/me`)).json()) as { user: { email: string } }).user.email;

  // The web: Settings links to Announcements, where an administrator posts one.
  await page.goto('/app/settings');
  await page.getByRole('link', { name: /Announcements/ }).click();
  await expect(page.getByRole('heading', { name: 'Announcements', level: 1 })).toBeVisible();
  await expect(page.getByText('No announcements yet.')).toBeVisible();
  await page.getByLabel('Title').fill('Office closed on Friday');
  await page.getByLabel('Message').fill('The office is closed for the holiday. Calls go to the duty phone.');
  await page.getByRole('button', { name: 'Post announcement' }).click();
  await expect(page.getByRole('heading', { name: 'Office closed on Friday' })).toBeVisible();
  await shot(page, '27-web-announcements');
  await expectNoA11yViolations(page);

  // The phone: the home screen card, the notification, and Profile explains notifications come in the native app.
  const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: PREVIEW_DIR ? 3 : 1, reducedMotion: 'reduce', locale: 'en-GB' })).newPage();
  await phone.goto(APP);
  await phone.getByLabel('Email').fill(priya);
  await phone.getByLabel('Password').fill('a-long-password-1');
  await phone.getByRole('button', { name: 'Use another server' }).click();
  await phone.getByLabel('Server address').fill(API);
  await phone.getByRole('button', { name: 'Sign in', exact: true }).click();
  const card = phone.getByRole('button', { name: 'Announcements' });
  await expect(card).toContainText('Office closed on Friday');
  await expect(card).toContainText('Calls go to the duty phone.');
  await shot(phone, '28-app-home-announcement');
  await card.click();
  const item = phone.getByRole('button', { name: 'Office closed on Friday, unread' });
  await expect(item).toBeVisible();
  await shot(phone, '29-app-notifications');
  await expectNoA11yViolations(phone);
  await phone.getByRole('button', { name: 'Mark all as read' }).click();
  await expect(phone.getByRole('button', { name: 'Office closed on Friday', exact: true })).toBeVisible();
  await expect.poll(async () => ((await (await guest.request.get(`${API}/api/v1/notifications`)).json()) as { unread: number }).unread).toBe(0);
  await phone.getByRole('tab', { name: /Profile/ }).click();
  await expect(phone.getByText('Notifications arrive in the iPhone and Android app.')).toBeVisible();
});
