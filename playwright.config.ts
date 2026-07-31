import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://127.0.0.1:8080",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], channel: "chrome" },
    },
  ],
  webServer: {
    command: "pnpm dev",
    url: "http://127.0.0.1:8080",
    env: {
      VITE_SUPABASE_PROJECT_ID: "local-placeholder",
      VITE_SUPABASE_PUBLISHABLE_KEY: "local-placeholder",
      VITE_SUPABASE_URL: "http://127.0.0.1:54321",
    },
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
