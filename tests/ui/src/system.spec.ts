/** Production readiness: the system page, an admin's alone (named in the config, and confirmed). */
import { expect, test } from "@playwright/test";

import { linkMailedTo, setUpUser } from "./support.js";

test.use({ storageState: { cookies: [], origins: [] } });

// Named in services/app/.env/test's LUMINOUS_MONEY_ADMINS (the API suite has its own).
const ADMIN = "ui-admin@test.local";

test("an admin finds System in the menu: what's running, and whether it's healthy", async ({
  page,
}) => {
  await page.request.post("/api/auth/v1/signup", {
    data: { name: "Admin", email: ADMIN, password: "a long enough admin passphrase" },
  });
  // A book first: without one, every page is setting one up.
  await page.request.post("/api/ledger/v1/books", { data: { name: "Ours" } });
  await page.goto(await linkMailedTo(ADMIN, "verify"));
  await expect(page.getByText("Your email address is confirmed.")).toBeVisible();

  await page.goto("/ui/");
  await page.getByRole("button", { name: "Menu" }).click();
  await page.getByRole("link", { name: "System" }).click();

  await expect(page.getByRole("heading", { name: "System" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Release" })).toContainText("Running dev");
  await expect(page.getByRole("region", { name: "Release" })).toContainText(
    "Update checks are off"
  );
  const services = page.getByRole("region", { name: "Services" });
  await expect(services.getByRole("listitem")).toHaveCount(4);
  await expect(services).not.toContainText("down");
  await expect(page.getByRole("region", { name: "Data" })).toContainText("ledger.sqlite");
});

test("no one else sees it", async ({ page }) => {
  const { book } = await setUpUser(page);
  await page.goto(`/ui/books/${book.id}`);
  await page.getByRole("button", { name: "Menu" }).click();
  await expect(page.getByRole("link", { name: "Your account" })).toBeVisible();
  await expect(page.getByRole("link", { name: "System" })).toHaveCount(0);

  await page.goto("/ui/system");
  await expect(page.getByText(/not found/i)).toBeVisible();
});
