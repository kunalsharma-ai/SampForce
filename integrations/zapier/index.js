'use strict';
const authentication = require('./authentication');
const creates = require('./creates');
const { addApiKey, checkError } = require('./lib');
const triggers = require('./triggers');

const { EVENTS, ...hookTriggers } = triggers;

function platformVersion() {
  try {
    // eslint-disable-next-line global-require
    return require('zapier-platform-core').version;
  } catch (e) {
    return require('./package.json').dependencies['zapier-platform-core'];
  }
}

module.exports = {
  version: require('./package.json').version,
  platformVersion: platformVersion(),
  authentication,
  beforeRequest: [addApiKey],
  afterResponse: [checkError],
  triggers: Object.fromEntries(Object.values(hookTriggers).map((t) => [t.key, t])),
  creates: Object.fromEntries(Object.values(creates).map((c) => [c.key, c])),
};
