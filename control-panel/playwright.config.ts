import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.CONTROL_PANEL_BASE_URL ?? "http://127.0.0.1:4000";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 120_000,
  use: {
    baseURL,
    trace: "retry-with-trace",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
