import { createHmac } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { signUp } from './helpers';

const ORIGIN = { origin: 'http://localhost:3000' };
const ZOOM = 'http://127.0.0.1:4700';

async function apiPost(page: Page, path: string, data: object) {
  const res = await page.request.post(`/api/v1${path}`, { data, headers: ORIGIN });
  expect(res.ok(), `${path} → ${res.status()}`).toBe(true);
  return res.json();
}

/** Sends a signed Zoom event the way Zoom would (the secret is the stand-in's, set in playwright.config). */
async function zoomEvent(page: Page, body: object) {
  const raw = JSON.stringify(body);
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = `v0=${createHmac('sha256', 'zoom-webhook-secret').update(`v0:${ts}:${raw}`).digest('hex')}`;
  const res = await page.request.post('/api/v1/apps/zoom/events', { data: raw, headers: { 'content-type': 'application/json', 'x-zm-request-timestamp': ts, 'x-zm-signature': sig } });
  expect(res.status()).toBe(200);
}

test('connects Zoom, schedules a recorded meeting from a lead and imports its transcript into meeting notes (Zoom stand-in)', async ({ page }) => {
  await signUp(page, 'Zoom Flow');
  await page.goto('/app/integrations');
  const card = page.getByRole('region', { name: /^Zoom/ });
  await expect(card.getByText('Not connected')).toBeVisible();
  await card.getByRole('button', { name: 'Connect Zoom' }).click();
  await expect(page).toHaveURL(/app=zoom&app_connected=1/);
  await expect(card.getByText('Connected', { exact: true })).toBeVisible();
  await expect(card.getByText('Zoom account of owner@zoom.test')).toBeVisible();

  const lead = (await apiPost(page, '/leads', { fullName: 'Priya Raman', companyName: 'Kestrel Analytics' })).lead;
  await page.goto(`/app/leads/${lead.id}`);
  const zoom = page.getByRole('region', { name: 'Zoom meetings' });
  await zoom.getByRole('button', { name: 'Schedule' }).click();
  await zoom.getByLabel('Topic').fill('Pricing call');
  await zoom.getByLabel('Length').selectOption('45');
  await zoom.getByLabel(/Record to the Zoom cloud/).check();
  await expect(zoom.getByRole('button', { name: 'Schedule Zoom meeting' })).toBeDisabled();
  await zoom.getByLabel(/Everyone in the meeting has agreed/).check();
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(results.violations.map((v) => v.id)).toEqual([]);
  await zoom.getByRole('button', { name: 'Schedule Zoom meeting' }).click();
  const list = zoom.getByRole('list', { name: 'Zoom meetings' });
  await expect(list).toContainText('Pricing call');
  await expect(list).toContainText('Recording: transcript after the meeting');
  await expect(list.getByRole('link', { name: 'Join link' })).toHaveAttribute('href', /^https:\/\/zoom\.test\/j\/\d+$/);

  // After the meeting Zoom sends the transcript event; the worker imports it.
  const [m] = await (await page.request.get(`/api/v1/apps/zoom/meetings?leadId=${lead.id}`)).json();
  await zoomEvent(page, {
    event: 'recording.transcript_completed',
    download_token: 'dl-token',
    payload: { account_id: 'ZACCT123', object: { id: Number(m.zoomMeetingId), recording_files: [{ file_type: 'TRANSCRIPT', status: 'completed', download_url: `${ZOOM}/rec/download/f1` }] } },
  });
  await expect(async () => {
    await page.reload();
    await expect(page.getByRole('region', { name: 'Zoom meetings' })).toContainText('Transcript in meeting notes', { timeout: 2_000 });
  }).toPass({ timeout: 25_000 });
  await page.getByRole('link', { name: 'Open meeting notes' }).click();
  await expect(page.getByRole('heading', { name: 'Pricing call', level: 1 })).toBeVisible();
  await expect(page.getByText(/We need SSO and an answer by Friday/)).toBeVisible();
});
