import { defineConfig, devices } from '@playwright/test';
import path from 'path';

/**
 * Playwright config for Illuvrse Marketplace UI.
 *
 * - testDir points to ./tests/e2e (we created this in the plan).
 * - Launches the Next dev server for tests (webServer). CI should build & start a production
 *   server instead or adjust `webServer` accordingly.
 * - Uses a sensible timeout and retries for CI.
 *
 * Adjust `use.baseURL` if you prefer to run tests against a different host (staging).
 */

const PROJECT_ROOT = path.resolve(__dirname);
const defaultMockOidc = process.env.MOCK_OIDC ?? process.env.NEXT_PUBLIC_MOCK_OIDC ?? 'true';

const webServerEnv = {
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL || 'http://127.0.0.1:3000',
  NEXT_PUBLIC_MOCK_OIDC: defaultMockOidc,
  MOCK_OIDC: defaultMockOidc,
  DEV_SKIP_OIDC: process.env.DEV_SKIP_OIDC || (defaultMockOidc === 'true' ? 'true' : 'false'),
  NEXT_PUBLIC_DEV_SKIP_OIDC:
    process.env.NEXT_PUBLIC_DEV_SKIP_OIDC || process.env.DEV_SKIP_OIDC || (defaultMockOidc === 'true' ? 'true' : 'false'),
  MOCK_SIGNING_PROXY: process.env.MOCK_SIGNING_PROXY || 'true',
};

process.env.MOCK_OIDC ??= defaultMockOidc;
process.env.NEXT_PUBLIC_MOCK_OIDC ??= defaultMockOidc;

export default defineConfig({
  testDir: path.join(PROJECT_ROOT, 'tests', 'e2e'),
  timeout: 60_000, // per-test timeout
  expect: {
    timeout: 5_000,
  },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.PW_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || 'http://127.0.0.1:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 15_000,
    ignoreHTTPSErrors: true,
    headless: true,
    viewport: { width: 1280, height: 800 },
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
  ],

  // Start the dev server before running tests. CI can override by starting its own server.
  webServer: {
    command: './scripts/run-local.sh',
    cwd: path.join(PROJECT_ROOT),
    url: 'http://127.0.0.1:3000',
    timeout: 180_000,
    reuseExistingServer: true,
    env: webServerEnv,
  },
});
