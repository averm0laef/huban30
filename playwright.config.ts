import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  testIgnore: "mobile-reliability.spec.ts",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], channel: "chrome" },
    },
  ],
  webServer: {
    command: "pnpm --filter @an30/web dev",
    // These approvals describe synthetic local test fixtures only.
    env: {
      APP_BASE_URL: "http://localhost:3000",
      ENABLE_PUBLIC_CHECKOUT: "true",
      LEGAL_DOCUMENTS_APPROVED: "true",
    },
    url: "http://127.0.0.1:3000/api/health/live",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
