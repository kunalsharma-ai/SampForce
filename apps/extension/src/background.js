/*
 * Service worker: opens the side panel from the toolbar button or the page menu, and runs automatic
 * capture when the person has turned it on. Automatic capture is off until they turn it on, only reads
 * pages after the browser has granted site access, and only saves addresses at the site's own domain.
 */
import { call, connection } from './lib/api.js';

const AUTO_DAILY_MAX = 100;
const SEEN_HOURS = 24;

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  chrome.contextMenus.create({ id: 'dealflow-scan', title: 'Find emails on this page with SampForce', contexts: ['page'] });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'dealflow-scan' && tab?.windowId !== undefined) chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
});

chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (change.status === 'complete' && tab.url) autoCapture(tabId, tab.url).catch((e) => console.warn('SampForce automatic capture', e));
});

function today() {
  return new Date().toISOString().slice(0, 10);
}

async function autoCapture(tabId, url) {
  const { autoCapture: on } = await chrome.storage.local.get('autoCapture');
  if (!on) return;
  const conn = await connection();
  if (!conn?.me?.canSave) return;
  let page;
  try {
    page = new URL(url);
  } catch {
    return;
  }
  if (!/^https?:$/.test(page.protocol) || page.origin === conn.baseUrl) return;
  if (!(await chrome.permissions.contains({ origins: [`${page.origin}/*`] }))) return;

  const key = page.origin + page.pathname;
  const { seen = {}, autoCount = { day: today(), count: 0 } } = await chrome.storage.local.get(['seen', 'autoCount']);
  const now = Date.now();
  if (seen[key] && now - seen[key] < SEEN_HOURS * 3_600_000) return;
  const count = autoCount.day === today() ? autoCount.count : 0;
  if (count >= AUTO_DAILY_MAX) return;

  const [result] = await chrome.scripting.executeScript({ target: { tabId }, files: ['lib/page.js'] });
  const found = result?.result;
  // Only the company's own people: addresses at this site's domain, never personal mailboxes.
  const people = (found?.people ?? []).filter((p) => p.ownDomain && !p.personal).slice(0, Math.min(25, AUTO_DAILY_MAX - count));

  // Remember the page either way, and keep the list short.
  const fresh = Object.fromEntries(Object.entries(seen).filter(([, t]) => now - t < SEEN_HOURS * 3_600_000).slice(-500));
  fresh[key] = now;
  await chrome.storage.local.set({ seen: fresh });
  if (!people.length) return;

  const res = await call('/extension/capture', {
    method: 'POST',
    body: {
      people: people.map((p) => ({ email: p.email, ...(p.name ? { fullName: p.name } : {}) })),
      companyName: found.company || undefined,
      website: found.domain,
      sourceUrl: found.url,
      auto: true,
    },
  });
  const created = res.results.filter((r) => r.outcome === 'created');
  const { autoLog = [] } = await chrome.storage.local.get('autoLog');
  await chrome.storage.local.set({
    autoCount: { day: today(), count: count + created.length },
    autoLog: [{ at: new Date().toISOString(), url: found.url, company: found.company, created: created.map((r) => ({ id: r.match.id, label: r.match.label, email: r.email })), existing: res.results.length - created.length }, ...autoLog].slice(0, 30),
  });
  if (created.length) {
    chrome.action.setBadgeBackgroundColor({ color: '#00839A' });
    chrome.action.setBadgeText({ tabId, text: String(created.length) });
  }
}
