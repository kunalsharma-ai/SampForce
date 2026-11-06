'use strict';
const { api } = require('./lib');

/** A SampForce workspace API key, created by an admin under Integrations, API keys. */
module.exports = {
  type: 'custom',
  fields: [
    { key: 'baseUrl', label: 'SampForce address', required: true, type: 'string', helpText: 'The address you open SampForce at, for example https://crm.example.com.' },
    { key: 'apiKey', label: 'API key', required: true, type: 'password', helpText: 'Create one in SampForce under Integrations, API keys. It starts with dfk_ and is shown once.' },
  ],
  test: async (z, bundle) => {
    const r = await z.request({ url: api(bundle, '/zapier/me') });
    return r.data;
  },
  connectionLabel: '{{workspace}} ({{keyName}})',
};
