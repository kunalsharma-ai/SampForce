'use strict';

/** The SampForce address the person entered, without a trailing slash. */
const base = (bundle) => String(bundle.authData.baseUrl || '').replace(/\/+$/, '');
const api = (bundle, path) => `${base(bundle)}/api/v1${path}`;

/** Sends the API key on every request. SampForce keys start with dfk_. */
function addApiKey(request, z, bundle) {
  if (bundle.authData && bundle.authData.apiKey) {
    request.headers = Object.assign({}, request.headers, { Authorization: `Bearer ${bundle.authData.apiKey}` });
  }
  return request;
}

/** SampForce answers errors as { error: { code, message } }; show that message in Zapier. */
function checkError(response, z) {
  if (response.status >= 400) {
    let message = `SampForce answered HTTP ${response.status}.`;
    try {
      const body = typeof response.data === 'object' && response.data ? response.data : JSON.parse(response.content);
      if (body && body.error && body.error.message) message = body.error.message;
    } catch (e) {
      // keep the generic message
    }
    throw new z.errors.Error(message, response.status === 401 ? 'AuthenticationError' : 'SampForceError', response.status);
  }
  return response;
}

/** One event as Zapier shows it: the event fields plus the record's fields, flattened one level as record__*. */
function flatten(ev) {
  const out = { id: ev.id, event: ev.event, occurred_at: ev.occurredAt, entity_type: ev.entityType, entity_id: ev.entityId };
  const rec = ev.record && typeof ev.record === 'object' ? ev.record : {};
  for (const [k, v] of Object.entries(rec)) {
    if (v === null || ['string', 'number', 'boolean'].includes(typeof v)) out[`record__${k}`] = v;
    else if (typeof v === 'object' && !Array.isArray(v)) {
      for (const [k2, v2] of Object.entries(v)) if (v2 === null || ['string', 'number', 'boolean'].includes(typeof v2)) out[`record__${k}__${k2}`] = v2;
    }
  }
  return out;
}

module.exports = { base, api, addApiKey, checkError, flatten };
