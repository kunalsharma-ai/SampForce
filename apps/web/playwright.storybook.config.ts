import { defineConfig, devices } from '@playwright/test';

/** Checks the built component catalogue (run `pnpm build-storybook` first): every story renders and passes axe. */
export default defineConfig({
  testDir: './e2e',
  testMatch: /\.storybook\.ts$/,
  // One test walks every story in three variants; it takes about a minute, so leave room on a busy machine.
  timeout: 180_000,
  reporter: process.env.CI ? [['github']] : 'list',
  use: { baseURL: 'http://127.0.0.1:6007', ...devices['Desktop Chrome'] },
  webServer: { command: 'node scripts/serve-static.mjs storybook-static 6007', url: 'http://127.0.0.1:6007/index.json', reuseExistingServer: !process.env.CI },
});
