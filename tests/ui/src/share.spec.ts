/// <reference lib="dom" />
/** A photo shared to the installed app (the manifest's share target): the service worker keeps
 * it, and Capture receipt opens with it, in the book chosen. */
import { expect } from "@playwright/test";

import { test } from "./fixtures.js";
import { JPEG, setUpUser } from "./support.js";

// The suite's stack is plain http on a name other than localhost: service workers need the
// origin treated as safe, which only full Chromium hears (as in updates.spec.ts).
const origin = new URL(process.env.LUMINOUS_MONEY_URL ?? "http://localhost:8080").origin;
test.use({
  launchOptions: {
    channel: "chromium",
    args: [`--unsafely-treat-insecure-origin-as-secure=${origin}`],
  },
});

test("a photo shared to the installed app opens Capture receipt with it, in the book chosen", async ({
  page,
}) => {
  const { session, book } = await setUpUser(page);
  const { data: other } = await session.ledger.POST("/api/ledger/v1/books", {
    body: { name: "Kael Shared" },
  });
  // The book you'd start in is the one last opened.
  await page.goto(`/ui/books/${book.id}`);
  await page.evaluate(() => navigator.serviceWorker.ready);
  if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) await page.reload();

  // As Android shares it: the file posted to the manifest's share target.
  await page.evaluate((bytes) => {
    const form = Object.assign(document.createElement("form"), {
      method: "POST",
      action: "/ui/share-receipt",
      enctype: "multipart/form-data",
    });
    const input = Object.assign(document.createElement("input"), { type: "file", name: "receipt" });
    const files = new DataTransfer();
    files.items.add(new File([new Uint8Array(bytes)], "shared.jpg", { type: "image/jpeg" }));
    input.files = files.files;
    form.append(input);
    document.body.append(form);
    form.submit();
  }, Array.from(JPEG));
  await expect(page).toHaveURL(
    (url) =>
      url.pathname === `/ui/books/${book.id}/receipt` && url.searchParams.get("shared") === "1"
  );
  await expect(page.getByRole("img", { name: "The receipt" })).toBeVisible();

  // Another book: the same file, kept until its transaction is made.
  await page.getByRole("combobox", { name: "Book" }).selectOption(other!.id);
  await expect(page).toHaveURL((url) => url.pathname === `/ui/books/${other!.id}/receipt`);
  await expect(page.getByRole("img", { name: "The receipt" })).toBeVisible();
  await page.getByText("Add what you know").click();
  await page.getByLabel("Payee").fill("Corner Shop");
  await page.getByRole("button", { name: "Create transaction" }).click();
  await expect(page).toHaveURL((url) => url.pathname === `/ui/books/${other!.id}/review`);
  await expect(page.getByRole("article").filter({ hasText: "Corner Shop" })).toBeVisible();
  expect(await page.evaluate(() => caches.has("shared-receipt"))).toBe(false);

  // A share with no service worker to take it reaches the server, which opens Capture receipt.
  const direct = await page.request.post("/ui/share-receipt", { maxRedirects: 0 });
  expect([direct.status(), direct.headers()["location"]]).toEqual([303, "/ui/receipt?shared=1"]);
  await page.goto("/ui/receipt?shared=1");
  await expect(page.getByRole("status").filter({ hasText: "didn't arrive" })).toHaveText(
    "The shared file didn't arrive: share it again, or upload it."
  );
});
