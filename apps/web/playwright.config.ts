import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end suite. Runs the production builds of the API and web app (run `pnpm build`
 * first). E2E_DATABASE_URL must point at a migrated database using the dealflow_app role.
 */
const databaseUrl =
  process.env.E2E_DATABASE_URL ?? 'postgresql://dealflow_app:dealflow_app_dev@localhost:5432/dealflow';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] }, testIgnore: /mobile\.spec\.ts/ },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /mobile\.spec\.ts/ },
  ],
  webServer: [
    {
      // Local stand-in for the Claude Messages API, so AI screens run end to end without a real key.
      command: 'npx tsx test/fixtures/ai-fixture-server.ts',
      cwd: '../api',
      url: 'http://127.0.0.1:4100/health',
      reuseExistingServer: !process.env.CI,
      env: { AI_FIXTURE_PORT: '4100' },
    },
    {
      command: 'node dist/main.js',
      cwd: '../api',
      url: 'http://localhost:4000/api/v1/health/ready',
      reuseExistingServer: !process.env.CI,
      env: {
        NODE_ENV: 'test',
        DATABASE_URL: databaseUrl,
        JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET ?? 'e2e-secret-that-is-at-least-32-characters',
        WEB_ORIGINS: 'http://localhost:3000',
        LOG_LEVEL: 'warn',
        AUTH_RATE_LIMIT_PER_MINUTE: '1000',
        // The worker runs inside the API for e2e so workflows, webhooks and notifications progress.
        RUN_WORKER_IN_PROCESS: 'true',
        WORKER_POLL_MS: '500',
        ALLOW_PRIVATE_NETWORK_TARGETS: 'true',
        // Not a real key: requests go to the fixture above, never to Anthropic.
        ANTHROPIC_API_KEY: 'test-key-not-real',
        AI_API_BASE_URL: 'http://127.0.0.1:4100',
        // Enables the operator console; e2e creates its own operator account.
        OPERATOR_JWT_SECRET: 'e2e-operator-secret-at-least-32-characters',
      },
    },
    {
      command: 'pnpm start',
      url: 'http://localhost:3000/login',
      reuseExistingServer: !process.env.CI,
    },
  ],
});
