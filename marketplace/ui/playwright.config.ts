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
    command: 'npm run dev',
    cwd: path.join(PROJECT_ROOT),
    url: 'http://127.0.0.1:3000',
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
  },
});

