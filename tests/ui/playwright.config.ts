import { defineConfig, devices } from "@playwright/test";

// Phone-sized Chromium against a running stack (FAVA_BEANS_URL, default http://localhost:8080).
export default defineConfig({
  testDir: "src",
  fullyParallel: true,
  reporter: [["list"]],
  use: {
    baseURL: process.env.FAVA_BEANS_URL ?? "http://localhost:8080",
    ...devices["Pixel 7"],
    trace: "retain-on-failure",
  },
});
