import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./src/e2e",
  fullyParallel: true,
  retries: 0,
  reporter: "list",
  timeout: 60_000,
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "on-first-retry",
    permissions: ["clipboard-read", "clipboard-write"],
  },
  webServer: {
    command: "npm run dev -- --port 5173",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: true,
    timeout: 120_000
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1080 } }
    },
    {
      name: "mobile",
      use: { ...devices["Pixel 5"], viewport: { width: 390, height: 844 } }
    }
  ]
});

