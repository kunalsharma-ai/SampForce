import { ApiError, call, connection, normaliseBase } from './lib/api.js';

const app = document.getElementById('app');
const who = document.getElementById('who');
const ALL_SITES = { origins: ['https://*/*', 'http://*/*'] };
/** Set when the panel is opened in a tab of its own instead of the side panel (used by the tests). */
const pinnedTab = Number(new URLSearchParams(location.search).get('tab')) || null;

/** Tiny element builder: h('p', { class: 'muted' }, 'text', child). */
function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

function alertBox(kind, text) {
  return h('p', { class: `alert ${kind}`, role: kind === 'error' ? 'alert' : 'status' }, text);
}

function message(e) {
  return e instanceof ApiError ? e.message : 'Something went wrong. Try again.';
}

let state = { conn: null, page: null, lookup: null, error: null, result: null, busy: false };

async function start() {
  state.conn = await connection();
  if (!state.conn) return renderConnect();
  try {
    const me = await call('/extension/me');
    await chrome.storage.local.set({ me });
    state.conn.me = me;
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      await chrome.storage.local.remove(['token', 'me']);
      return renderConnect(e.message);
    }
    state.error = message(e);
  }
  renderMain();
  scan();
}

// ───── Connect ─────

async function renderConnect(error) {
  who.textContent = '';
  const { baseUrl = '' } = await chrome.storage.local.get('baseUrl');
  const addr = h('input', { id: 'base', type: 'url', value: baseUrl, placeholder: 'app.yourcompany.com', autocomplete: 'url', required: true });
  const code = h('input', { id: 'code', type: 'password', placeholder: 'dfx_…', autocomplete: 'off', required: true });
  const status = h('div');
  if (error) status.append(alertBox('error', error));
  const form = h(
    'form',
    {
      onsubmit: async (ev) => {
        ev.preventDefault();
        status.replaceChildren();
        const base = normaliseBase(addr.value);
        const token = code.value.trim();
        if (!base) return status.append(alertBox('error', 'Enter your DealFlow address, for example app.yourcompany.com. It must use https.'));
        if (!token.startsWith('dfx_')) return status.append(alertBox('error', 'Paste the connection code from DealFlow. It starts with dfx_.'));
        // The browser asks the person to allow the extension to talk to this DealFlow address.
        const granted = await chrome.permissions.request({ origins: [`${base}/*`] });
        if (!granted) return status.append(alertBox('error', 'The extension needs permission to reach your DealFlow address.'));
        try {
          const me = await call('/extension/me', { baseUrl: base, token });
          await chrome.storage.local.set({ baseUrl: base, token, me });
          start();
        } catch (e) {
          status.append(alertBox('error', message(e)));
        }
      },
    },
    h('label', { for: 'base' }, 'Your DealFlow address'),
    addr,
    h('label', { for: 'code' }, 'Connection code'),
    code,
    h('p', { class: 'muted small' }, 'In DealFlow, open Integrations, then Browser extension, and create a connection code. It is shown once.'),
    status,
    h('div', { class: 'row end' }, h('button', { class: 'primary', type: 'submit' }, 'Connect')),
  );
  app.replaceChildren(h('section', {}, h('h2', {}, 'Connect to DealFlow'), form));
}

// ───── Main ─────

async function targetTab() {
  if (pinnedTab) return chrome.tabs.get(pinnedTab).catch(() => null);
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab ?? null;
}

async function scan() {
  state.page = null;
  state.lookup = null;
  state.result = null;
  state.pageError = null;
  if (!(await chrome.permissions.contains(ALL_SITES))) {
    state.pageError = 'access';
    return renderMain();
  }
  const tab = await targetTab();
  if (!tab?.id || !tab.url || !/^https?:/.test(tab.url) || tab.url.startsWith(state.conn.baseUrl)) {
    state.pageError = 'unreadable';
    return renderMain();
  }
  renderMain(true);
  try {
    const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['lib/page.js'] });
    state.page = res?.result ?? null;
  } catch {
    state.pageError = 'unreadable';
    return renderMain();
  }
  if (!state.page) {
    state.pageError = 'unreadable';
    return renderMain();
  }
  try {
    state.lookup = await call('/extension/lookup', { method: 'POST', body: { emails: state.page.people.slice(0, 50).map((p) => p.email), website: state.page.url } });
  } catch (e) {
    state.error = message(e);
  }
  renderMain();
}

function statusChip(info) {
  if (info?.match) return h('span', { class: 'chip ok' }, info.match.entity === 'contact' ? 'Contact' : 'Lead');
  if (info?.suppressed) return h('span', { class: 'chip bad' }, 'Do not email');
  if (info?.personal) return h('span', { class: 'chip warn' }, 'Personal');
  return h('span', { class: 'chip' }, 'New');
}

function renderMain(scanning = false) {
  const { conn } = state;
  const me = conn.me;
  who.textContent = me ? `${me.user.name} · ${me.workspace.name}` : '';
  const parts = [];
  if (state.error) parts.push(alertBox('error', state.error));
  parts.push(pageSection(scanning));
  parts.push(autoSection());
  parts.push(
    h('div', { class: 'row end' },
      h('a', { href: `${conn.baseUrl}/app/leads`, target: '_blank', rel: 'noopener' }, 'Open DealFlow'),
      h('button', { type: 'button', onclick: disconnect }, 'Disconnect'),
    ),
  );
  app.replaceChildren(...parts);
}

function pageSection(scanning) {
  const me = state.conn.me;
  const sec = h('section', { 'aria-labelledby': 'page-h' }, h('h2', { id: 'page-h' }, 'This page'));
  if (state.pageError === 'access') {
    sec.append(
      h('p', {}, 'To find addresses, DealFlow needs to read the page you are on. It reads a page only when you open this panel, or on every page if you turn on automatic capture below.'),
      h('button', { class: 'primary', type: 'button', onclick: async () => (await chrome.permissions.request(ALL_SITES)) && scan() }, 'Allow page access'),
    );
    return sec;
  }
  if (state.pageError === 'unreadable') {
    sec.append(h('p', { class: 'muted' }, 'DealFlow cannot read this page. Open a company website and try again.'), h('button', { type: 'button', onclick: scan }, 'Scan again'));
    return sec;
  }
  if (scanning || !state.page) {
    sec.append(h('p', { class: 'muted' }, 'Reading the page…'));
    return sec;
  }

  const page = state.page;
  const info = new Map((state.lookup?.people ?? []).map((p) => [p.email, p]));
  const company = h('input', { id: 'company', type: 'text', value: state.lookup?.company?.name ?? page.company ?? '' });
  sec.append(h('p', { class: 'muted small' }, page.domain), h('label', { for: 'company' }, 'Company'), company);
  if (state.lookup?.company) sec.append(h('p', { class: 'small muted' }, 'Already in DealFlow as a company.'));

  if (!page.people.length) {
    sec.append(h('p', { class: 'muted' }, 'No email addresses on this page. Try the team, contact or about page.'), h('button', { type: 'button', onclick: scan }, 'Scan again'));
    return sec;
  }

  const rows = page.people.slice(0, 50).map((p, i) => {
    const known = info.get(p.email);
    const box = h('input', { type: 'checkbox', id: `p${i}`, checked: !known?.match && !known?.suppressed && !p.personal, disabled: !!known?.match || !me?.canSave });
    const name = h('input', { type: 'text', value: p.name, placeholder: 'Name', 'aria-label': `Name for ${p.email}` });
    return {
      p, box, name, known,
      el: h('li', {},
        box,
        h('label', { for: `p${i}`, class: 'addr', style: 'margin:0;font-size:13px' }, p.email, statusChip(known)),
        h('div', { class: 'name' },
          known?.match
            ? h('a', { href: `${state.conn.baseUrl}/app/${known.match.entity === 'contact' ? 'contacts' : 'leads'}/${known.match.id}`, target: '_blank', rel: 'noopener', class: 'small' }, `Open ${known.match.label} in DealFlow`)
            : name,
        ),
      ),
    };
  });
  sec.append(h('p', { class: 'small' }, `${page.people.length} address${page.people.length === 1 ? '' : 'es'} found.`), h('ul', { class: 'people' }, rows.map((r) => r.el)));

  if (!me?.canSave) {
    sec.append(h('p', { class: 'muted small' }, 'Your role in this workspace can look people up but not save leads.'));
    return sec;
  }

  let sequence = null;
  if (me.canEnroll && me.sequences.length) {
    sequence = h('select', { id: 'seq' }, h('option', { value: '' }, 'Do not enrol'), me.sequences.map((s) => h('option', { value: s.id }, s.name)));
    sec.append(h('label', { for: 'seq' }, 'Also enrol in a sequence'), sequence);
    if (!me.mailboxConnected) sec.append(h('p', { class: 'small muted' }, 'Enrolling needs your Google or Microsoft mailbox connected in DealFlow.'));
  }

  const out = h('div');
  const save = h('button', { class: 'primary', type: 'button' }, 'Save as leads');
  const update = () => {
    const n = rows.filter((r) => r.box.checked && !r.box.disabled).length;
    save.textContent = n ? `Save ${n} as lead${n === 1 ? '' : 's'}${sequence?.value ? ' and enrol' : ''}` : 'Choose people to save';
    save.disabled = !n || state.busy;
  };
  rows.forEach((r) => r.box.addEventListener('change', update));
  sequence?.addEventListener('change', update);
  update();
  save.addEventListener('click', async () => {
    const chosen = rows.filter((r) => r.box.checked && !r.box.disabled);
    state.busy = true;
    update();
    out.replaceChildren();
    try {
      const res = await call('/extension/capture', {
        method: 'POST',
        body: {
          people: chosen.slice(0, 25).map((r) => ({ email: r.p.email, ...(r.name.value.trim() ? { fullName: r.name.value.trim() } : {}) })),
          companyName: company.value.trim() || undefined,
          website: page.domain,
          sourceUrl: page.url,
          ...(sequence?.value ? { sequenceId: sequence.value } : {}),
        },
      });
      const created = res.results.filter((r) => r.outcome === 'created').length;
      const existing = res.results.filter((r) => r.outcome === 'existing').length;
      const lines = [`Saved ${created} new lead${created === 1 ? '' : 's'}.`];
      if (existing) lines.push(`${existing} already in DealFlow.`);
      if (res.enrollment) lines.push(`Enrolled ${res.enrollment.enrolled}${res.enrollment.skipped.length ? `, skipped ${res.enrollment.skipped.length}` : ''}.`);
      state.busy = false;
      await scan();
      app.querySelector('#page-h')?.parentElement?.append(alertBox('success', lines.join(' ')));
      return;
    } catch (e) {
      out.append(alertBox('error', message(e)));
    }
    state.busy = false;
    update();
  });
  sec.append(out, h('div', { class: 'row end' }, h('button', { type: 'button', onclick: scan }, 'Scan again'), save));
  return sec;
}

function autoSection() {
  const sec = h('section', { 'aria-labelledby': 'auto-h' }, h('h2', { id: 'auto-h' }, 'Automatic capture'));
  const box = h('input', { type: 'checkbox', id: 'auto' });
  const log = h('div');
  chrome.storage.local.get(['autoCapture', 'autoLog', 'autoCount']).then(({ autoCapture, autoLog = [], autoCount }) => {
    box.checked = !!autoCapture;
    const todayCount = autoCount?.day === new Date().toISOString().slice(0, 10) ? autoCount.count : 0;
    if (autoCapture) log.append(h('p', { class: 'small muted' }, `${todayCount} saved today (at most 100 a day).`));
    const recent = autoLog.filter((l) => l.created.length).slice(0, 5);
    if (recent.length) {
      log.append(h('p', { class: 'small', style: 'margin-top:8px' }, 'Recently saved automatically:'), h('ol', { class: 'log' }, recent.map((l) => h('li', {}, `${l.created.map((c) => c.label).join(', ')} · ${l.company || new URL(l.url).hostname}`))));
    }
  });
  box.addEventListener('change', async () => {
    if (box.checked && !(await chrome.permissions.request(ALL_SITES))) {
      box.checked = false;
      return;
    }
    await chrome.storage.local.set({ autoCapture: box.checked });
    renderMain();
  });
  sec.append(
    h('label', { class: 'switch', for: 'auto' }, box,
      h('span', {}, 'Save new people automatically as I browse. Only addresses at the website’s own domain are saved, never personal mailboxes such as Gmail, and never anyone already in DealFlow or on the do-not-email list.'),
    ),
    log,
  );
  if (!state.conn.me?.canSave) box.disabled = true;
  return sec;
}

async function disconnect() {
  // End the connection in DealFlow too; if DealFlow cannot be reached, it still lapses on its own.
  await call('/extension/disconnect', { method: 'POST' }).catch(() => {});
  await chrome.storage.local.remove(['token', 'me', 'autoCapture']);
  state = { conn: null, page: null, lookup: null, error: null, result: null, busy: false };
  renderConnect();
}

// Follow the person between tabs.
chrome.tabs.onActivated.addListener(() => state.conn?.me && !pinnedTab && scan());
chrome.tabs.onUpdated.addListener((id, change, tab) => {
  if (change.status === 'complete' && state.conn?.me && (pinnedTab ? id === pinnedTab : tab.active)) scan();
});

start();
