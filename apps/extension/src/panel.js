import { ApiError, call, connection, normaliseBase, signIn } from './lib/api.js';

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

let state = { conn: null, page: null, lookup: null, error: null, result: null, busy: false, prospects: null };

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
  const top = h('div');
  if (error) top.append(alertBox('error', error));

  /** The address must be valid and the browser must let the extension reach it (the person is asked once). */
  async function reach(status) {
    const base = normaliseBase(addr.value);
    if (!base) {
      status.append(alertBox('error', 'Enter your SampForce address, for example app.yourcompany.com. It must use https.'));
      return null;
    }
    const granted = await chrome.permissions.request({ origins: [`${base}/*`] });
    if (!granted) {
      status.append(alertBox('error', 'The extension needs permission to reach your SampForce address.'));
      return null;
    }
    return base;
  }

  async function finish(base, token) {
    const me = await call('/extension/me', { baseUrl: base, token });
    await chrome.storage.local.set({ baseUrl: base, token, me });
    start();
  }

  // Sign in with a SampForce email and password (and a second-factor code when the account has one).
  const email = h('input', { id: 'email', type: 'email', autocomplete: 'username', required: true });
  const password = h('input', { id: 'password', type: 'password', autocomplete: 'current-password', required: true });
  const signInStatus = h('div');
  let challenge = null;
  const mfa = h('div');
  const signInForm = h(
    'form',
    {
      onsubmit: async (ev) => {
        ev.preventDefault();
        signInStatus.replaceChildren();
        top.replaceChildren();
        const base = await reach(signInStatus);
        if (!base) return;
        try {
          const name = `Browser extension (${globalThis.navigator.userAgent.includes('Edg/') ? 'Edge' : 'Chrome'})`;
          const res = challenge
            ? await signIn(base, '/extension/login/mfa', { challenge, code: mfa.querySelector('input').value.trim(), name })
            : await signIn(base, '/extension/login', { email: email.value.trim(), password: password.value, name });
          if (res.mfaRequired) {
            challenge = res.challenge;
            mfa.replaceChildren(
              h('label', { for: 'mfa' }, 'Code from your authenticator app'),
              h('input', { id: 'mfa', type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code', required: true }),
              h('p', { class: 'muted small' }, 'Or enter one of your recovery codes.'),
            );
            mfa.querySelector('input').focus();
            return;
          }
          password.value = '';
          await finish(base, res.token);
        } catch (e) {
          signInStatus.append(alertBox('error', message(e)));
          if (e instanceof ApiError && e.code === 'MFA_CHALLENGE_EXPIRED') {
            challenge = null;
            mfa.replaceChildren();
          }
        }
      },
    },
    h('h3', { id: 'signin-h' }, 'Sign in'),
    h('label', { for: 'email' }, 'Work email'),
    email,
    h('label', { for: 'password' }, 'Password'),
    password,
    mfa,
    signInStatus,
    h('p', { class: 'muted small' }, 'The extension keeps its own connection, which you can end any time in SampForce under Integrations. Your password is not stored.'),
    h('div', { class: 'row end' }, h('button', { class: 'primary', type: 'submit' }, 'Sign in')),
  );

  // Or a connection code made in SampForce (needed for workspaces that sign in with SSO).
  const code = h('input', { id: 'code', type: 'password', placeholder: 'dfx_…', autocomplete: 'off', required: true });
  const status = h('div');
  const codeForm = h(
    'form',
    {
      onsubmit: async (ev) => {
        ev.preventDefault();
        status.replaceChildren();
        top.replaceChildren();
        const token = code.value.trim();
        if (!token.startsWith('dfx_')) return status.append(alertBox('error', 'Paste the connection code from SampForce. It starts with dfx_.'));
        const base = await reach(status);
        if (!base) return;
        try {
          await finish(base, token);
        } catch (e) {
          status.append(alertBox('error', message(e)));
        }
      },
    },
    h('h3', { id: 'code-h' }, 'Or use a connection code'),
    h('label', { for: 'code' }, 'Connection code'),
    code,
    h('p', { class: 'muted small' }, 'In SampForce, open Integrations, then Browser extension, and create a connection code. It is shown once. Use this if your workspace signs in with single sign-on.'),
    status,
    h('div', { class: 'row end' }, h('button', { type: 'submit' }, 'Connect')),
  );
  app.replaceChildren(
    h('section', {}, h('h2', {}, 'Connect to SampForce'), h('label', { for: 'base' }, 'Your SampForce address'), addr, top),
    h('section', {}, signInForm),
    h('section', {}, codeForm),
  );
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
  state.findNote = null;
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

const FINDER_CHIP = { found: 'On their site', provider: 'Data provider', pattern: 'Pattern', guess: 'Guess' };

/** Re-checks the listed addresses against SampForce, keeping everything found so far. */
async function refreshLookup() {
  try {
    const fresh = await call('/extension/lookup', { method: 'POST', body: { emails: state.page.people.slice(0, 50).map((p) => p.email), website: state.page.url } });
    state.lookup = fresh;
  } catch (e) {
    state.error = message(e);
  }
  renderMain();
}

function statusChip(info, p) {
  if (p?.finder && !info?.match && !info?.suppressed) return h('span', { class: 'chip ok' }, FINDER_CHIP[p.finder] ?? 'Found');
  if (info?.match) return h('span', { class: 'chip ok' }, info.match.entity === 'contact' ? 'Contact' : 'Lead');
  if (info?.suppressed) return h('span', { class: 'chip bad' }, 'Do not email');
  if (info?.personal) return h('span', { class: 'chip warn' }, 'Personal');
  return h('span', { class: 'chip' }, 'New');
}

/** Asks SampForce's email finder for more people at this company, read from its public website. */
async function findMore() {
  const page = state.page;
  state.finding = true;
  state.findNote = null;
  renderMain();
  try {
    const r = await call('/extension/find', { method: 'POST', body: { domain: page.domain } });
    const known = new Set(page.people.map((p) => p.email));
    const lookup = state.lookup ?? { people: [], company: null };
    let added = 0;
    for (const e of r.emails) {
      if (known.has(e.email)) continue;
      page.people.push({ email: e.email, name: e.name ?? '', personal: false, ownDomain: true, finder: e.status });
      lookup.people.push({ email: e.email, match: e.match, suppressed: e.suppressed, personal: false });
      added++;
    }
    state.lookup = lookup;
    state.findNote = [`${added ? `Found ${added} more` : 'No more addresses'} on ${r.domain ?? page.domain} (${r.pagesRead} page${r.pagesRead === 1 ? '' : 's'} read).`, r.pattern ? `Their addresses look like ${r.pattern.replace(/[{}]/g, '')}@${r.domain}.` : '', ...r.notes].filter(Boolean).join(' ');
  } catch (e) {
    state.findNote = message(e);
  }
  state.finding = false;
  renderMain();
}

function findButton(domain) {
  return h('button', { type: 'button', onclick: findMore, disabled: state.finding }, state.finding ? 'Searching their website…' : `Find more people at ${domain}`);
}

function renderMain(scanning = false) {
  const { conn } = state;
  const me = conn.me;
  who.textContent = me ? `${me.user.name} · ${me.workspace.name}` : '';
  const parts = [];
  if (state.error) parts.push(alertBox('error', state.error));
  parts.push(pageSection(scanning));
  const prospects = prospectsSection();
  if (prospects) parts.push(prospects);
  parts.push(autoSection());
  parts.push(
    h('div', { class: 'row end' },
      h('a', { href: `${conn.baseUrl}/app/leads`, target: '_blank', rel: 'noopener' }, 'Open SampForce'),
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
      h('p', {}, 'To find addresses, SampForce needs to read the page you are on. It reads a page only when you open this panel, or on every page if you turn on automatic capture below.'),
      h('button', { class: 'primary', type: 'button', onclick: async () => (await chrome.permissions.request(ALL_SITES)) && scan() }, 'Allow page access'),
    );
    return sec;
  }
  if (state.pageError === 'unreadable') {
    sec.append(h('p', { class: 'muted' }, 'SampForce cannot read this page. Open a company website and try again.'), h('button', { type: 'button', onclick: scan }, 'Scan again'));
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
  if (state.lookup?.company) sec.append(h('p', { class: 'small muted' }, 'Already in SampForce as a company.'));

  const findRow = h('div', { class: 'row' }, findButton(page.domain));
  if (state.findNote) findRow.append(h('p', { class: 'small', role: 'status', style: 'margin:0' }, state.findNote));

  if (!page.people.length) {
    sec.append(h('p', { class: 'muted' }, 'No email addresses on this page.'), findRow, h('button', { type: 'button', onclick: scan, style: 'margin-top:8px' }, 'Scan again'));
    return sec;
  }

  const rows = page.people.slice(0, 50).map((p, i) => {
    const known = info.get(p.email);
    // Ticked by default: new people at the site's own domain. Other companies and personal mailboxes are left for the person to choose.
    const fresh = !known?.match && !known?.suppressed && !p.personal && p.ownDomain;
    const box = h('input', { type: 'checkbox', id: `p${i}`, checked: fresh, disabled: !!known?.match || !me?.canSave });
    const name = h('input', { type: 'text', value: p.name, placeholder: 'Name', 'aria-label': `Name for ${p.email}` });
    return {
      p, box, name, known,
      el: h('li', {},
        box,
        h('label', { for: `p${i}`, class: 'addr', style: 'margin:0;font-size:13px' }, p.email, statusChip(known, p)),
        h('div', { class: 'name' },
          known?.match
            ? h('a', { href: `${state.conn.baseUrl}/app/${known.match.entity === 'contact' ? 'contacts' : 'leads'}/${known.match.id}`, target: '_blank', rel: 'noopener', class: 'small' }, `Open ${known.match.label} in SampForce`)
            : name,
        ),
      ),
    };
  });
  sec.append(h('p', { class: 'small' }, `${page.people.length} address${page.people.length === 1 ? '' : 'es'} found.`), h('ul', { class: 'people' }, rows.map((r) => r.el)), findRow);

  if (!me?.canSave) {
    sec.append(h('p', { class: 'muted small' }, 'Your role in this workspace can look people up but not save leads.'));
    return sec;
  }

  let sequence = null;
  if (me.canEnroll && me.sequences.length) {
    sequence = h('select', { id: 'seq' }, h('option', { value: '' }, 'Do not enrol'), me.sequences.map((s) => h('option', { value: s.id }, s.name)));
    sec.append(h('label', { for: 'seq' }, 'Also enrol in a sequence'), sequence);
    if (!me.mailboxConnected) sec.append(h('p', { class: 'small muted' }, 'Enrolling needs your Google or Microsoft mailbox connected in SampForce.'));
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
      if (existing) lines.push(`${existing} already in SampForce.`);
      if (res.enrollment) lines.push(`Enrolled ${res.enrollment.enrolled}${res.enrollment.skipped.length ? `, skipped ${res.enrollment.skipped.length}` : ''}.`);
      state.busy = false;
      await refreshLookup();
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

// ───── Prospects at this company (Part 2: prospect discovery) ─────

const EMAIL_STATUS = { valid: 'Verified', risky: 'Risky', catch_all: 'Accept-all domain', invalid: 'Invalid', unknown: 'Not verified', bounced: 'Bounced', needs_verification: 'Needs verification' };
const STATUS_KIND = { valid: 'ok', invalid: 'bad', bounced: 'bad', risky: 'warn', catch_all: 'warn' };

/** Prospect state belongs to one company domain; moving to another site starts again. */
function prospectState(domain) {
  if (state.prospects?.domain !== domain) state.prospects = { domain, result: null, lists: null, usage: null, busy: false, error: null, outcome: null, titles: '', unticked: new Set(), dest: null, newName: `${domain} prospects`, sequenceId: '' };
  return state.prospects;
}

async function loadLists(ps) {
  try {
    const [lists, usage] = await Promise.all([call('/extension/prospect-lists'), call('/extension/prospects/usage')]);
    ps.lists = lists;
    ps.usage = usage;
  } catch (e) {
    ps.lists = [];
    ps.error = message(e);
  }
  renderMain();
}

async function discover(ps) {
  ps.busy = true;
  ps.error = null;
  ps.outcome = null;
  renderMain();
  try {
    ps.unticked = new Set();
    ps.result = await call('/extension/prospects/discover', { method: 'POST', body: { domain: ps.domain, titles: ps.titles.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 10) } });
    ps.usage = ps.result.usage;
  } catch (e) {
    ps.error = message(e);
  }
  ps.busy = false;
  renderMain();
}

function outcomeText(res) {
  const n = (o) => res.results.filter((r) => r.outcome === o).length;
  const where = res.destination.type === 'crm' ? 'the CRM as leads' : res.destination.name;
  const lines = [`Added ${n('added')} to ${where}.`];
  if (n('duplicate')) lines.push(`${n('duplicate')} already in that list.`);
  if (n('existing')) lines.push(`${n('existing')} already in SampForce.`);
  if (n('skipped')) lines.push(`${n('skipped')} skipped.`);
  if (res.enrollment) lines.push(`Enrolled ${res.enrollment.enrolled} in the sequence.`);
  return lines.join(' ');
}

function prospectsSection() {
  const me = state.conn.me;
  const domain = state.page?.domain;
  if (!domain || state.pageError || !me?.prospects?.canSearch) return null;
  const ps = prospectState(domain);
  if (ps.lists === null && me.prospects.canRead) {
    ps.lists = [];
    loadLists(ps);
  }
  const sec = h('section', { 'aria-labelledby': 'prospects-h' }, h('h2', { id: 'prospects-h' }, `Prospects at ${domain}`));
  sec.append(h('p', { class: 'muted small' }, 'People at this company from your data provider (Apollo.io). SampForce does not read them from this page.'));
  const titles = h('input', { id: 'titles', type: 'text', value: ps.titles, placeholder: 'Head of Operations, VP Sales' });
  titles.addEventListener('input', () => (ps.titles = titles.value));
  sec.append(
    h('label', { for: 'titles' }, 'Job titles (optional)'),
    titles,
    h('div', { class: 'row' }, h('button', { type: 'button', onclick: () => discover(ps), disabled: ps.busy }, ps.busy && !ps.result ? 'Searching…' : `Find prospects at ${domain}`)),
  );
  if (ps.usage) sec.append(h('p', { class: 'small muted' }, `Provider calls in the last 24 hours: ${ps.usage.used} of ${ps.usage.limit}.`));
  if (ps.error) sec.append(alertBox('error', ps.error));

  const r = ps.result;
  if (r) {
    if (r.mode === 'mock') sec.append(h('p', { class: 'alert warn', role: 'note' }, r.notice));
    else if (r.notice) sec.append(h('p', { class: 'small muted' }, r.notice));
    if (!r.people.length) sec.append(h('p', { class: 'muted' }, 'No people found at this company.'));
  }
  if (r?.people.length) {
    const rows = r.people.map((p, i) => {
      const box = h('input', { type: 'checkbox', id: `pr${i}`, checked: !ps.unticked.has(p.providerId) });
      box.addEventListener('change', () => (box.checked ? ps.unticked.delete(p.providerId) : ps.unticked.add(p.providerId)));
      const status = p.email ? (EMAIL_STATUS[p.emailStatus] ?? 'Not verified') : 'Email not revealed';
      return {
        p, box,
        el: h('li', {},
          box,
          h('label', { for: `pr${i}`, class: 'addr', style: 'margin:0;font-size:13px' },
            p.fullName,
            p.sample ? h('span', { class: 'chip warn' }, 'Sample') : null,
            h('span', { class: `chip ${p.email ? (STATUS_KIND[p.emailStatus] ?? '') : ''}` }, status),
          ),
          h('div', { class: 'name small muted' }, [p.title, p.companyName].filter(Boolean).join(' · ') + (p.email ? ` · ${p.email}` : '')),
        ),
      };
    });
    sec.append(h('ul', { class: 'people', 'aria-label': 'Prospects found' }, rows.map((x) => x.el)));

    const dest = h('select', { id: 'dest' });
    if (me.prospects.canSave) {
      for (const l of ps.lists ?? []) dest.append(h('option', { value: `list:${l.id}` }, `List: ${l.name}`));
      dest.append(h('option', { value: 'new' }, 'A new prospect list'));
    }
    if (me.canSave) dest.append(h('option', { value: 'crm' }, 'The CRM, as leads'));
    if (ps.dest && [...dest.options].some((o) => o.value === ps.dest)) dest.value = ps.dest;
    const newName = h('input', { id: 'newlist', type: 'text', value: ps.newName });
    newName.addEventListener('input', () => (ps.newName = newName.value));
    const newWrap = h('div', {}, h('label', { for: 'newlist' }, 'New list name'), newName);
    let sequence = null;
    const seqWrap = h('div');
    if (me.canEnroll && me.sequences.length) {
      sequence = h('select', { id: 'pseq' }, h('option', { value: '' }, 'Do not enrol'), me.sequences.map((s) => h('option', { value: s.id, selected: s.id === ps.sequenceId }, s.name)));
      sequence.addEventListener('change', () => (ps.sequenceId = sequence.value));
      seqWrap.append(h('label', { for: 'pseq' }, 'Also enrol in a sequence'), sequence);
    }
    const reveal = h('input', { type: 'checkbox', id: 'reveal', checked: true });
    const go = h('button', { class: 'primary', type: 'button' });
    const update = () => {
      ps.dest = dest.value;
      newWrap.hidden = dest.value !== 'new';
      seqWrap.hidden = dest.value !== 'crm';
      const n = rows.filter((x) => x.box.checked).length;
      go.textContent = n ? `Import ${n}` : 'Choose people to import';
      go.disabled = !n || ps.busy || !dest.value;
    };
    [dest, ...rows.map((x) => x.box)].forEach((el) => el.addEventListener('change', update));
    sec.append(
      h('label', { for: 'dest' }, 'Import to'),
      dest,
      newWrap,
      seqWrap,
      h('label', { class: 'switch', for: 'reveal' }, reveal, h('span', {}, 'Find their email addresses (one provider call each)')),
    );
    if (!dest.options.length) sec.append(h('p', { class: 'muted small' }, 'Your role can search but not save prospects or leads.'));
    const out = h('div');
    if (ps.outcome) {
      out.append(alertBox('success', outcomeText(ps.outcome)));
      const notes = ps.outcome.results.filter((x) => x.reason);
      if (notes.length) out.append(h('ul', { class: 'log small', 'aria-label': 'Import notes' }, notes.map((x) => h('li', {}, `${x.name}: ${x.reason}`))));
      if (ps.outcome.destination.type === 'list') {
        out.append(h('p', { class: 'small' }, h('a', { href: `${state.conn.baseUrl}/app/prospects/${ps.outcome.destination.id}`, target: '_blank', rel: 'noopener' }, `Open ${ps.outcome.destination.name} in SampForce`)));
      }
    }
    go.addEventListener('click', async () => {
      const chosen = rows.filter((x) => x.box.checked).map((x) => x.p).slice(0, 25);
      const destination = dest.value === 'crm'
        ? { type: 'crm', ...(sequence?.value ? { sequenceId: sequence.value } : {}) }
        : dest.value === 'new'
          ? { type: 'new_list', name: newName.value.trim() || `${domain} prospects` }
          : { type: 'list', listId: dest.value.slice(5) };
      ps.busy = true;
      ps.error = null;
      update();
      try {
        ps.outcome = await call('/extension/prospects/import', { method: 'POST', body: { people: chosen, revealEmails: reveal.checked, destination, sourceUrl: state.page.url } });
        ps.usage = ps.outcome.usage;
        if (ps.outcome.destination.type === 'list') ps.dest = `list:${ps.outcome.destination.id}`;
        ps.busy = false;
        await loadLists(ps);
        return;
      } catch (e) {
        ps.error = message(e);
      }
      ps.busy = false;
      renderMain();
    });
    update();
    sec.append(out, h('div', { class: 'row end' }, go));
  }

  if (ps.lists?.length) {
    sec.append(
      h('h3', { id: 'lists-h' }, 'Your prospect lists'),
      h('ul', { class: 'log', 'aria-labelledby': 'lists-h' }, ps.lists.slice(0, 5).map((l) => h('li', {}, h('a', { href: `${state.conn.baseUrl}/app/prospects/${l.id}`, target: '_blank', rel: 'noopener' }, l.name), ` · ${l.prospects} ${l.prospects === 1 ? 'person' : 'people'}`))),
    );
  }
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
      h('span', {}, 'Save new people automatically as I browse. Only addresses at the website’s own domain are saved, never personal mailboxes such as Gmail, and never anyone already in SampForce or on the do-not-email list.'),
    ),
    log,
  );
  if (!state.conn.me?.canSave) box.disabled = true;
  return sec;
}

async function disconnect() {
  // End the connection in SampForce too; if SampForce cannot be reached, it still lapses on its own.
  await call('/extension/disconnect', { method: 'POST' }).catch(() => {});
  await chrome.storage.local.remove(['token', 'me', 'autoCapture']);
  state = { conn: null, page: null, lookup: null, error: null, result: null, busy: false, prospects: null };
  renderConnect();
}

// Follow the person between tabs.
chrome.tabs.onActivated.addListener(() => state.conn?.me && !pinnedTab && scan());
chrome.tabs.onUpdated.addListener((id, change, tab) => {
  if (change.status === 'complete' && state.conn?.me && (pinnedTab ? id === pinnedTab : tab.active)) scan();
});

start();
