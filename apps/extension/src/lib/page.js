/*
 * Reads the page the person is looking at: email addresses (from mailto links and the visible text),
 * names next to them, and the company the site belongs to. Runs as a content script injected on demand
 * (chrome.scripting.executeScript); the value of the last expression is returned to the extension.
 * It changes nothing on the page and sends nothing anywhere itself.
 */
(() => {
  const EMAIL = /[a-z0-9][a-z0-9._%+-]{0,63}@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}/gi;
  const NOT_A_TLD = /\.(png|jpe?g|gif|svg|webp|avif|ico|css|js|json|mp4|webm|woff2?)$/i;
  const JUNK_DOMAINS = /(^|\.)(example\.(com|org|net)|sentry\.io|sentry-next\.wixpress\.com|wixpress\.com|domain\.com|email\.com|yourcompany\.com|company\.com|test\.com)$/i;
  const PERSONAL = new Set([
    'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.in', 'yahoo.co.uk', 'ymail.com', 'rocketmail.com',
    'outlook.com', 'hotmail.com', 'hotmail.co.uk', 'live.com', 'msn.com', 'icloud.com', 'me.com', 'mac.com',
    'aol.com', 'proton.me', 'protonmail.com', 'pm.me', 'gmx.com', 'gmx.de', 'gmx.net', 'web.de', 'mail.com',
    'yandex.com', 'yandex.ru', 'mail.ru', 'qq.com', '163.com', '126.com', 'rediffmail.com', 'zohomail.com',
    'fastmail.com', 'tutanota.com', 'hey.com', 'naver.com', 'orange.fr', 'free.fr', 'libero.it', 't-online.de',
  ]);
  const ROLE = new Set(['info', 'sales', 'contact', 'hello', 'support', 'admin', 'office', 'team', 'enquiries', 'inquiries', 'marketing', 'press', 'media', 'careers', 'jobs', 'hr', 'billing', 'help', 'service', 'privacy', 'legal', 'noreply', 'no-reply']);
  const MAX = 100;

  /** Lower-cases an address and drops what only looks like one (image names, tracking ids, sample addresses). */
  function cleanEmail(raw) {
    let e = String(raw).trim().toLowerCase().replace(/^mailto:/, '').replace(/[.,;:]+$/, '');
    e = e.replace(/^u003e/, '').replace(/^%20/, '');
    const at = e.lastIndexOf('@');
    if (at < 1) return null;
    const local = e.slice(0, at);
    const domain = e.slice(at + 1);
    if (NOT_A_TLD.test(e) || JUNK_DOMAINS.test(domain)) return null;
    if (/^[0-9a-f]{20,}$/.test(local)) return null; // hashes used by error trackers
    if (/@\d+x\./.test(e)) return null; // logo@2x.png style asset names
    return e;
  }

  /** Addresses written out in text, including "name [at] company [dot] com". */
  function findEmails(text) {
    const plain = String(text)
      .replace(/\s*[[(]\s*at\s*[\])]\s*/gi, '@')
      .replace(/\s*[[(]\s*dot\s*[\])]\s*/gi, '.');
    const out = new Set();
    for (const m of plain.matchAll(EMAIL)) {
      const e = cleanEmail(m[0]);
      if (e) out.add(e);
      if (out.size >= MAX) break;
    }
    return [...out];
  }

  function domainOf(email) {
    return email.slice(email.lastIndexOf('@') + 1);
  }

  function isPersonal(email) {
    return PERSONAL.has(domainOf(email));
  }

  /** The site's own domain, or one of its subdomains: "jane@acme.com" belongs to "www.acme.com" and "careers.acme.com". */
  function belongsTo(email, site) {
    const d = domainOf(email);
    const s = String(site).replace(/^www\./, '');
    return d === s || d.endsWith(`.${s}`) || s.endsWith(`.${d}`);
  }

  function nameFromEmail(email) {
    const local = email.slice(0, email.indexOf('@'));
    const parts = local.split(/[._-]+/).filter((p) => /^[a-z]{2,}$/i.test(p));
    if (!parts.length || ROLE.has(local)) return '';
    return parts.map((p) => p[0].toUpperCase() + p.slice(1)).join(' ');
  }

  /** Link text such as "Jane Doe" is a name; "Email us" or the address itself is not. */
  function looksLikeName(text) {
    const t = String(text).replace(/\s+/g, ' ').trim();
    return /^[\p{Lu}][\p{L}'’-]+(?: [\p{Lu}][\p{L}'’.-]*){1,3}$/u.test(t) && !/^(Email|Contact|Write|Send|Mail)\b/i.test(t);
  }

  function companyName(doc, host) {
    const meta = (sel) => doc.querySelector(sel)?.getAttribute('content')?.trim();
    const fromMeta = meta('meta[property="og:site_name"]') || meta('meta[name="application-name"]');
    if (fromMeta) return fromMeta.slice(0, 200);
    for (const s of doc.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const data = JSON.parse(s.textContent || '');
        for (const item of [data, ...(Array.isArray(data) ? data : []), ...(data['@graph'] || [])]) {
          if (item && /Organization|Corporation|LocalBusiness/.test(String(item['@type'])) && typeof item.name === 'string') return item.name.slice(0, 200);
        }
      } catch {
        // Not valid JSON-LD: ignore it.
      }
    }
    const title = (doc.title || '').split(/\s[|–—-]\s/).map((p) => p.trim()).filter(Boolean);
    if (title.length > 1) return title[title.length - 1].slice(0, 200);
    const base = host.replace(/^www\./, '').split('.')[0] || host;
    return base.charAt(0).toUpperCase() + base.slice(1);
  }

  function extract(doc, loc) {
    const people = new Map();
    for (const a of doc.querySelectorAll('a[href^="mailto:" i]')) {
      const addr = decodeURIComponent(a.getAttribute('href').slice(7).split('?')[0]).split(',')[0];
      const e = cleanEmail(addr);
      if (!e) continue;
      const text = a.textContent || '';
      const name = looksLikeName(text) ? text.replace(/\s+/g, ' ').trim() : a.getAttribute('title') && looksLikeName(a.getAttribute('title')) ? a.getAttribute('title').trim() : '';
      if (!people.has(e) || (!people.get(e).name && name)) people.set(e, { email: e, name });
      if (people.size >= MAX) break;
    }
    const text = (doc.body?.innerText || '').slice(0, 500_000);
    for (const e of findEmails(text)) {
      if (people.size >= MAX) break;
      if (!people.has(e)) people.set(e, { email: e, name: '' });
    }
    const host = loc.hostname.toLowerCase();
    const domain = host.replace(/^www\./, '');
    return {
      url: loc.href,
      title: (doc.title || '').slice(0, 300),
      domain,
      company: companyName(doc, host),
      people: [...people.values()].map((p) => ({ ...p, name: p.name || nameFromEmail(p.email), personal: isPersonal(p.email), ownDomain: belongsTo(p.email, domain) })),
    };
  }

  globalThis.DealFlowPage = { cleanEmail, findEmails, isPersonal, belongsTo, nameFromEmail, looksLikeName, extract };
  return typeof document !== 'undefined' && typeof location !== 'undefined' ? extract(document, location) : null;
})();
