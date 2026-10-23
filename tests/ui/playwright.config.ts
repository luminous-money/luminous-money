import { defineConfig, devices } from "@playwright/test";

// Phone-sized Chromium against a running stack (LUMINOUS_MONEY_URL, default http://localhost:8080).
export default defineConfig({
  testDir: "src",
  globalSetup: "./src/setup.ts",
  fullyParallel: true,
  reporter: [["list"]],
  use: {
    baseURL: process.env.LUMINOUS_MONEY_URL ?? "http://localhost:8080",
    ...devices["Pixel 7"],
    trace: "retain-on-failure",
    storageState: "test-results/.session.json",
  },
});
