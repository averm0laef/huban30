import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "mobile-reliability.spec.ts",
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: "http://127.0.0.1:3301", trace: "retain-on-failure" },
  workers: 2,
  projects: [
    { name: "iphone-webkit", use: { ...devices["iPhone 13"], viewport: { height: 844, width: 390 } } },
    { name: "android-chromium", use: { ...devices["Pixel 7"], viewport: { height: 844, width: 390 } } },
  ],
  webServer: [
    { command: "node tests/e2e/fixtures/catalog-api.mjs", url: "http://127.0.0.1:3302/health" },
    {
      command: "pnpm --filter @an30/web dev --hostname 127.0.0.1 --port 3301",
      env: {
        APP_BASE_URL: "http://127.0.0.1:3301",
        ENABLE_PUBLIC_CHECKOUT: "true",
        INTERNAL_API_URL: "http://127.0.0.1:3302",
        LEGAL_DOCUMENTS_APPROVED: "true",
      },
      timeout: 120_000,
      url: "http://127.0.0.1:3301/api/health/live",
    },
  ],
});
