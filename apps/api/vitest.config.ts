import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts', 'evals/**/*.test.ts'],
    globalSetup: ['test/global-setup.ts'],
    // Integration tests share one database; run files sequentially.
    fileParallelism: false,
    testTimeout: 20_000,
    env: {
      NODE_ENV: 'test',
      LOG_LEVEL: process.env.TEST_LOG_LEVEL ?? 'silent',
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'mongodb://localhost:27017/sampforce_test?replicaSet=rs0&directConnection=true',
      JWT_ACCESS_SECRET: 'test-secret-that-is-at-least-32-characters-long',
      WEB_ORIGINS: 'http://localhost:3000',
      AUTH_RATE_LIMIT_PER_MINUTE: '1000',
      // Webhook and adapter tests talk to local fixture servers.
      ALLOW_PRIVATE_NETWORK_TARGETS: 'true',
      WEBHOOK_DISABLE_AFTER_FAILURES: '3',
    },
    hookTimeout: 30_000,
  },
});
