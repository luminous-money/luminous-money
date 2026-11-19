/// <reference lib="dom" />
/** A new version: the banner's Reload takes it in, whether or not a service worker controls the
 * page. The "old" version is the same worker with a byte appended (served once, when it's first
 * registered); asking for an update then finds the real one. */
import { expect, type Page } from "@playwright/test";

import { test } from "./fixtures.js";

// The suite's stack is plain http on a name other than localhost, where a browser has no
// service workers unless told that origin is safe (which only full Chromium hears, not the
// headless shell).
const origin = new URL(process.env.LUMINOUS_MONEY_URL ?? "http://localhost:8080").origin;
test.use({
  storageState: { cookies: [], origins: [] },
  launchOptions: {
    channel: "chromium",
    args: [`--unsafely-treat-insecure-origin-as-secure=${origin}`],
  },
});

/** Open the app with the old version installed; `controlled`: reload once so it serves the page
 * (a first visit isn't controlled until then). */
async function openOldVersion(page: Page, controlled: boolean) {
  // Served once, and the route left in place: taking it away while the app's first requests
  // are on their way can leave one hanging.
  let served = false;
  await page.context().route("**/ui/sw.js", async (route) => {
    if (served) return route.continue();
    served = true;
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\n// the old version\n` });
  });
  await page.goto("/ui/");
  await page.evaluate(() => navigator.serviceWorker.ready);
  if (controlled) await page.reload();
  expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(controlled);
  // Something typed, so the app doesn't reload into the new version by itself.
  await page.getByLabel("Email").fill("someone@example.com");
}

async function newVersionReloads(page: Page) {
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    await registration?.update();
  });
  const banner = page.locator(".banner-update");
  await expect(banner).toContainText("A new version is ready");

  await page.evaluate(() => ((window as { before?: boolean }).before = true));
  await banner.getByRole("button", { name: "Reload" }).click();
  await page.waitForFunction(() => !(window as { before?: boolean }).before);
  await expect(page.getByRole("form", { name: "Log in" })).toBeVisible();
  await expect(banner).toHaveCount(0);
  expect(
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      return { waiting: !!registration?.waiting, controlled: !!navigator.serviceWorker.controller };
    })
  ).toEqual({ waiting: false, controlled: true });
}

test("Reload takes a new version in", async ({ page }) => {
  await openOldVersion(page, true);
  await newVersionReloads(page);
});

test("Reload takes a new version in on a page no service worker controls", async ({ page }) => {
  await openOldVersion(page, false);
  await newVersionReloads(page);
});
