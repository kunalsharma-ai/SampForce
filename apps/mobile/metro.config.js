// Metro config for the SampForce app (issue #94).
//
// @dealflow/types is a workspace package whose package.json "main" points at its
// compiled dist/ folder, which the API and web app use. A fresh checkout (EAS
// Build, a new clone) has no dist/, so Metro could not resolve the package and
// the Android/iOS bundle failed. Metro compiles TypeScript itself, so the app
// reads the package's source directly: no build step, and the app can never run
// against a stale dist/.
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

const SOURCE_PACKAGES = {
  '@dealflow/types': path.resolve(__dirname, '../../packages/types/src/index.ts'),
};

const upstreamResolve = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const source = SOURCE_PACKAGES[moduleName];
  if (source) return { type: 'sourceFile', filePath: source };
  return (upstreamResolve ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;
module.exports.SOURCE_PACKAGES = SOURCE_PACKAGES;
