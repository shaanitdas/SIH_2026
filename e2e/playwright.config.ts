import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: __dirname,
  testMatch: "**/*.spec.ts",
  timeout: 120_000,
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      command: "node serve-test-page.mjs",
      port: 3020,
      reuseExistingServer: !process.env.CI,
      timeout: 15_000,
    },
    {
      command: "node ../apps/server/dist/index.js",
      url: "http://127.0.0.1:8080/health",
      reuseExistingServer: !process.env.CI,
      timeout: 15_000,
      env: {
        NODE_ENV: "test",
      },
    },
  ],
});