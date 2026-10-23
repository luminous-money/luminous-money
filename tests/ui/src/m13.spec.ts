/** M13: sharing a book by link with a second user, who accepts and sees it. */
import { devices, expect, test } from "@playwright/test";

import { logIn, setUpUser } from "./support.js";

test("a book is shared by link, and the person who accepts it can open it", async ({
  page,
  browser,
}) => {
  const { book } = await setUpUser(page, { name: "Our house" });
  const theirs = await browser.newContext({
    ...devices["Pixel 7"],
    baseURL: process.env.LUMINOUS_MONEY_URL ?? "http://localhost:8080",
  });
  const partner = await theirs.newPage();
  const { email } = await logIn(partner);

  await page.goto(`/ui/books/${book.id}/sharing`);
  const invite = page.getByRole("region", { name: "Invite someone" });
  await invite.getByRole("combobox", { name: "Their role" }).selectOption("write");
  await invite.getByRole("textbox", { name: "Their email" }).fill(email);
  await invite.getByRole("textbox", { name: "Their name" }).fill("Jess");
  await invite.getByRole("button", { name: "Make a link" }).click();
  const link = await invite.getByRole("textbox", { name: "Invitation link" }).inputValue();
  expect(link).toContain("/ui/invite/");

  await partner.goto(new URL(link).pathname);
  await expect(partner.getByRole("region", { name: "Invitation" })).toContainText("Our house");
  await partner.getByRole("button", { name: "Accept" }).click();
  await expect(partner).toHaveURL(new RegExp(`/books/${book.id}$`));
  await partner.goto("/ui/books");
  await expect(partner.getByRole("group", { name: "Our house" })).toContainText(
    "Shared with you · Can edit"
  );
  await theirs.close();

  await page.reload();
  const people = page.getByRole("region", { name: "People" });
  await expect(people.getByRole("listitem")).toHaveCount(2);
  await expect(people.getByRole("combobox", { name: /role/ })).toHaveValue("write");
});
