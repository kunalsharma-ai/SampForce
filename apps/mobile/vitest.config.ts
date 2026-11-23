import { defineConfig } from 'vitest/config';

// Unit tests cover the app's plain TypeScript (API client, session and configuration handling). Screens are checked
// through the web export at phone size (see test/README in the mobile ADR section).
export default defineConfig({ test: { include: ['test/**/*.test.ts'], environment: 'node' } });
