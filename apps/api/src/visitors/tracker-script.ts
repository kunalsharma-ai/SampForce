/**
 * The website tracking script (served at /api/v1/public/track/script.js). Plain ES2017, no dependencies.
 *
 * - Does nothing when the browser sends Global Privacy Control or Do Not Track, or when the workspace has
 *   tracking off or the site is not on its allowed list (the config request then fails).
 * - In "opt_in" mode nothing is stored or sent until the site calls sampforce('consent', true) from its cookie
 *   banner. sampforce('consent', false) forgets the visitor id. In "notice" mode it records until declined.
 * - The visitor id is a random value in the site's own localStorage. No fingerprinting, no third-party cookie,
 *   no IP lookup. The query string is dropped except utm_ parameters; the referrer is reduced to its host.
 * - Forms marked data-sampforce-enquiry are sent as enquiries; sampforce('enquiry', {...}) does the same in code.
 * - Sites set up before the rename to SampForce keep working: window.dealflow and the data-dealflow-* attributes
 *   are still read, as aliases of the sampforce names (ADR 0055).
 */
export const TRACKER_SCRIPT = String.raw`(function () {
  'use strict';
  var script = document.currentScript;
  if (!script || window.__sampforceLoaded || window.__dealflowLoaded) return;
  window.__sampforceLoaded = true;
  var key = script.getAttribute('data-site');
  if (!key) return;
  var base = new URL(script.src).origin + '/api/v1/public/track/' + encodeURIComponent(key);
  var queue = ((window.sampforce && window.sampforce.q) || []).concat((window.dealflow && window.dealflow.q) || []);
  var config = null;
  var current = null;
  var visibleSince = null;
  var engaged = 0;

  function privacySignal() {
    return navigator.globalPrivacyControl === true || navigator.doNotTrack === '1' || window.doNotTrack === '1';
  }
  function read(store, k) { try { return window[store].getItem(k); } catch (e) { return null; } }
  function write(store, k, v) { try { if (v === null) window[store].removeItem(k); else window[store].setItem(k, v); } catch (e) {} }
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    var b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    var h = Array.prototype.map.call(b, function (x) { return (x + 256).toString(16).slice(1); }).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }
  function allowed() {
    if (!config || !config.enabled || privacySignal()) return false;
    var c = read('localStorage', 'df_consent');
    return config.consentMode === 'opt_in' ? c === 'granted' : c !== 'denied';
  }
  function ids() {
    var v = read('localStorage', 'df_vid');
    if (!v) { v = uuid(); write('localStorage', 'df_vid', v); }
    var now = Date.now();
    var s = read('sessionStorage', 'df_sid');
    var last = Number(read('sessionStorage', 'df_last') || 0);
    if (!s || now - last > 30 * 60 * 1000) s = uuid();
    write('sessionStorage', 'df_sid', s);
    write('sessionStorage', 'df_last', String(now));
    return { visitorId: v, sessionId: s };
  }
  function utm() {
    var out = {}; var p = new URLSearchParams(location.search); var any = false;
    ['source', 'medium', 'campaign', 'term', 'content'].forEach(function (k) {
      var v = p.get('utm_' + k); if (v) { out[k] = v.slice(0, 100); any = true; }
    });
    return any ? out : undefined;
  }
  function referrerHost() {
    try { var h = document.referrer ? new URL(document.referrer).hostname : ''; return h && h !== location.hostname ? h : undefined; } catch (e) { return undefined; }
  }
  function send(events, beacon) {
    if (!allowed()) return;
    var body = JSON.stringify(Object.assign(ids(), { events: events }));
    if (beacon && navigator.sendBeacon) { navigator.sendBeacon(base + '/collect', new Blob([body], { type: 'text/plain' })); return; }
    fetch(base + '/collect', { method: 'POST', mode: 'no-cors', keepalive: true, headers: { 'content-type': 'text/plain' }, body: body }).catch(function () {});
  }
  function flush() {
    if (visibleSince !== null) { engaged += Date.now() - visibleSince; visibleSince = null; }
    var secs = Math.round(engaged / 1000);
    if (current && secs > 0) send([{ type: 'engagement', path: current, engagedSeconds: Math.min(secs, 3600) }], true);
    engaged = 0;
  }
  function page() {
    if (!allowed()) return;
    var path = location.pathname.slice(0, 500) || '/';
    if (path === current) return;
    if (current) flush();
    current = path;
    visibleSince = document.visibilityState === 'visible' ? Date.now() : null;
    send([{ type: 'page', path: path, title: document.title.slice(0, 200), referrer: referrerHost(), utm: utm() }]);
  }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') flush();
    else if (current) visibleSince = Date.now();
  });
  window.addEventListener('pagehide', flush);
  ['pushState', 'replaceState'].forEach(function (m) {
    var orig = history[m];
    history[m] = function () { var r = orig.apply(this, arguments); setTimeout(page, 0); return r; };
  });
  window.addEventListener('popstate', page);

  function enquiry(data) {
    var payload = Object.assign({}, data, { path: location.pathname.slice(0, 500) || '/' });
    if (allowed()) payload.visitorId = ids().visitorId;
    return fetch(base + '/enquiry', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify(payload) })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw j; return j; }); });
  }
  function bindForms() {
    var forms = document.querySelectorAll('form[data-sampforce-enquiry], form[data-dealflow-enquiry]');
    Array.prototype.forEach.call(forms, function (form) {
      if (form.__sampforce) return; form.__sampforce = true;
      var consentBox = form.querySelector('[name="consent"]');
      if (consentBox && config && config.enquiryConsentText) {
        var label = form.querySelector('[data-sampforce-consent-text], [data-dealflow-consent-text]');
        if (label) label.textContent = config.enquiryConsentText;
      } else if (consentBox && consentBox.closest('label')) consentBox.closest('label').hidden = true;
      form.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var fd = new FormData(form); var data = {};
        ['fullName', 'email', 'companyName', 'phone', 'message', 'website'].forEach(function (k) { var v = fd.get(k); if (typeof v === 'string' && v) data[k] = v; });
        data.consent = !!(consentBox && consentBox.checked);
        var err = form.querySelector('[data-sampforce-error], [data-dealflow-error]');
        if (err) err.textContent = '';
        enquiry(data).then(function (res) {
          var done = document.createElement('p'); done.setAttribute('role', 'status'); done.textContent = res.message;
          form.replaceWith(done);
        }, function (e) {
          if (err) err.textContent = (e && e.message) || 'Something went wrong. Please try again.';
        });
      });
    });
  }

  function command(cmd, arg) {
    if (cmd === 'consent') {
      write('localStorage', 'df_consent', arg ? 'granted' : 'denied');
      if (!arg) { write('localStorage', 'df_vid', null); write('sessionStorage', 'df_sid', null); current = null; }
      else page();
    } else if (cmd === 'event' && typeof arg === 'string') {
      send([{ type: 'event', name: arg.slice(0, 60), path: location.pathname.slice(0, 500) || '/' }]);
    } else if (cmd === 'enquiry') {
      return enquiry(arg || {});
    } else if (cmd === 'forget') {
      write('localStorage', 'df_vid', null); write('sessionStorage', 'df_sid', null); current = null;
    }
  }
  window.sampforce = function (cmd, arg) {
    if (!config) { var p = new Promise(function (resolve) { queue.push([cmd, arg, resolve]); }); return p; }
    return command(cmd, arg);
  };
  window.dealflow = window.sampforce;

  fetch(base + '/config', { credentials: 'omit' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (c) {
      config = c || { enabled: false };
      queue.forEach(function (item) { var r = command(item[0], item[1]); if (item[2]) item[2](r); });
      queue = [];
      bindForms();
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { bindForms(); page(); });
      else page();
    })
    .catch(function () {});
})();
`;
