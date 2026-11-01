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
      // Local stand-in for company websites and mail-server lookups, for the email finder.
      command: 'npx tsx test/fixtures/finder-fixture.ts',
      cwd: '../api',
      url: 'http://127.0.0.1:4300/health',
      reuseExistingServer: !process.env.CI,
      env: { FINDER_FIXTURE_PORT: '4300' },
    },
    {
      // Local stand-in for the Slack Web API and its consent screen, so the Slack app connects end to end.
      command: 'npx tsx test/fixtures/slack-fixture.ts',
      cwd: '../api',
      url: 'http://127.0.0.1:4500/health',
      reuseExistingServer: !process.env.CI,
      env: { SLACK_FIXTURE_PORT: '4500' },
    },
    {
      // Local stand-in for Teams Workflows webhook URLs.
      command: 'npx tsx test/fixtures/teams-fixture.ts',
      cwd: '../api',
      url: 'http://127.0.0.1:4600/health',
      reuseExistingServer: !process.env.CI,
      env: { TEAMS_FIXTURE_PORT: '4600' },
    },
    {
      // Local stand-in for Zoom OAuth, the meetings API and transcript downloads.
      command: 'npx tsx test/fixtures/zoom-fixture.ts',
      cwd: '../api',
      url: 'http://127.0.0.1:4700/health',
      reuseExistingServer: !process.env.CI,
      env: { ZOOM_FIXTURE_PORT: '4700' },
    },
    {
      // Local stand-in for DocuSign OAuth and the eSignature REST API.
      command: 'npx tsx test/fixtures/docusign-fixture.ts',
      cwd: '../api',
      url: 'http://127.0.0.1:4800/health',
      reuseExistingServer: !process.env.CI,
      env: { DOCUSIGN_FIXTURE_PORT: '4800' },
    },
    {
      // Local stand-in for a workspace's own Stripe or Razorpay account, with hosted pay pages.
      command: 'npx tsx test/fixtures/card-payments-fixture.ts',
      cwd: '../api',
      url: 'http://127.0.0.1:4900/health',
      reuseExistingServer: !process.env.CI,
      env: { CARD_PAYMENTS_FIXTURE_PORT: '4900' },
    },
    {
      // Local stand-in for Meta's WhatsApp Cloud API (Graph API).
      command: 'npx tsx test/fixtures/whatsapp-fixture.ts',
      cwd: '../api',
      url: 'http://127.0.0.1:4950/health',
      reuseExistingServer: !process.env.CI,
      env: { WHATSAPP_FIXTURE_PORT: '4950' },
    },
    {
      // Local stand-in for Twilio's REST API (SMS).
      command: 'npx tsx test/fixtures/twilio-fixture.ts',
      cwd: '../api',
      url: 'http://127.0.0.1:4960/health',
      reuseExistingServer: !process.env.CI,
      env: { TWILIO_FIXTURE_PORT: '4960' },
    },
    {
      // Local stand-in for an email service: catches password-reset emails so tests can read the link.
      command: 'npx tsx test/fixtures/smtp-fixture.ts',
      cwd: '../api',
      url: 'http://127.0.0.1:4401/health',
      reuseExistingServer: !process.env.CI,
      env: { SMTP_FIXTURE_PORT: '4400' },
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
        // The email finder reads made-up company sites from the stand-in above, never the internet.
        FINDER_FIXTURE_URL: 'http://127.0.0.1:4300',
        // Enables the operator console; e2e creates its own operator account.
        OPERATOR_JWT_SECRET: 'e2e-operator-secret-at-least-32-characters',
        // Email goes to the stand-in above, never to a real mail server.
        SMTP_URL: 'smtp://127.0.0.1:4400',
        MAIL_FROM: 'DealFlow <no-reply@dealflow.test>',
        PUBLIC_WEB_URL: 'http://localhost:3000',
        // Not real Slack credentials: Slack calls go to the stand-in above.
        SLACK_CLIENT_ID: 'slack-client-id',
        SLACK_CLIENT_SECRET: 'slack-client-secret',
        SLACK_AUTH_BASE_URL: 'http://127.0.0.1:4500',
        SLACK_API_BASE_URL: 'http://127.0.0.1:4500/api',
        // Not real Zoom credentials: Zoom calls go to the stand-in above.
        ZOOM_CLIENT_ID: 'zoom-client-id',
        ZOOM_CLIENT_SECRET: 'zoom-client-secret',
        ZOOM_WEBHOOK_SECRET_TOKEN: 'zoom-webhook-secret',
        ZOOM_AUTH_BASE_URL: 'http://127.0.0.1:4700',
        ZOOM_API_BASE_URL: 'http://127.0.0.1:4700/v2',
        // Not real DocuSign credentials: DocuSign calls go to the stand-in above.
        DOCUSIGN_INTEGRATION_KEY: 'ds-integration-key',
        DOCUSIGN_SECRET_KEY: 'ds-secret-key',
        DOCUSIGN_CONNECT_HMAC_KEY: 'ds-connect-hmac-key',
        DOCUSIGN_AUTH_BASE_URL: 'http://127.0.0.1:4800',
        // Card payments use each workspace's own keys; these send its Stripe and Razorpay calls to the stand-in above.
        STRIPE_API_BASE_URL: 'http://127.0.0.1:4900',
        RAZORPAY_API_BASE_URL: 'http://127.0.0.1:4900',
        // WhatsApp uses each workspace's own Meta credentials; this sends its Graph API calls to the stand-in above.
        WHATSAPP_API_BASE_URL: 'http://127.0.0.1:4950',
        // SMS uses each workspace's own Twilio credentials; this sends its REST calls to the stand-in above.
        TWILIO_API_BASE_URL: 'http://127.0.0.1:4960',
      },
    },
    {
      command: 'pnpm start',
      url: 'http://localhost:3000/login',
      reuseExistingServer: !process.env.CI,
    },
  ],
});
