/** M8: accounts anyone can create, sessions that stay fresh, and your account page. */
import { randomBytes } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

const PASSWORD = "correct horse battery staple";

test.use({ storageState: { cookies: [], origins: [] } });

const newEmail = () => `m8-${randomBytes(4).toString("hex")}@test.local`;

/** Mailpit, the e2e stack's mail server: the link in the newest email to `to`. */
async function linkMailedTo(to: string, kind: "reset" | "verify"): Promise<string> {
  const mailpit = process.env.MAILPIT_URL ?? "http://mailpit:8025";
  for (let i = 0; i < 40; i++) {
    const search = await fetch(
      `${mailpit}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`
    );
    const { messages } = (await search.json()) as { messages: { ID: string }[] };
    if (messages.length) {
      const { Text } = (await (
        await fetch(`${mailpit}/api/v1/message/${messages[0]!.ID}`)
      ).json()) as {
        Text: string;
      };
      const link = new RegExp(`/ui/${kind}/[\\w-]+`).exec(Text)?.[0];
      if (link) return link;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`no ${kind} email to ${to}`);
}

async function signUp(page: Page, email = newEmail()) {
  await page.goto("/ui/");
  await page.getByRole("button", { name: "Create an account" }).click();
  const form = page.getByRole("form", { name: "Create an account" });
  await form.getByRole("textbox", { name: "Your name" }).fill("Kael");
  await form.getByRole("textbox", { name: "Email" }).fill(email);
  await form.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await form.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Let's set up your books" })).toBeVisible();
  return email;
}

const menu = async (page: Page, item: string) => {
  await page.getByRole("button", { name: "Menu" }).click();
  await page
    .getByRole("navigation", { name: "Main" })
    .getByRole(item === "Log out" ? "button" : "link", { name: item })
    .click();
};

/** Finish Setup with a book, so the masthead (and its menu) shows. */
async function addBook(page: Page) {
  await page.getByRole("textbox", { name: "Name your books" }).fill("Personal");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("combobox", { name: "Account" }).fill("Assets:Bank:Checking");
  await page.getByRole("button", { name: "Finish setup" }).click();
  await expect(page.getByRole("heading", { name: "Personal" })).toBeVisible();
}

test("anyone signs up, logs out, and logs back in with their password", async ({ page }) => {
  const email = await signUp(page);
  await addBook(page);

  await menu(page, "Log out");
  const login = page.getByRole("form", { name: "Log in" });
  await login.getByRole("textbox", { name: "Email" }).fill(email);
  await login.getByLabel("Password", { exact: true }).fill("not the password at all");
  await login.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByText("wrong email or password")).toBeVisible();

  await login.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await login.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("heading", { name: "Personal" })).toBeVisible();
});

test("a short password is refused before anything is created", async ({ page }) => {
  await page.goto("/ui/");
  await page.getByRole("button", { name: "Create an account" }).click();
  const form = page.getByRole("form", { name: "Create an account" });
  await form.getByRole("textbox", { name: "Your name" }).fill("Kael");
  await form.getByRole("textbox", { name: "Email" }).fill(newEmail());
  await form.getByLabel("Password", { exact: true }).fill("too short");
  await form.getByRole("button", { name: "Create account" }).click();

  await expect(form.getByText("use at least 15 characters")).toBeVisible();
});

test("the session refreshes itself when the access token is gone", async ({ page, context }) => {
  await signUp(page);
  await addBook(page);

  await context.clearCookies({ name: "lm_access" });
  await page.reload();

  await expect(page.getByRole("heading", { name: "Personal" })).toBeVisible();
  expect((await context.cookies()).some((c) => c.name === "lm_access")).toBe(true);
});

test("a forgotten password is reset from the emailed link", async ({ page }) => {
  const email = await signUp(page);
  await addBook(page);
  await menu(page, "Log out");

  await page.getByRole("button", { name: "Forgot password?" }).click();
  await page
    .getByRole("form", { name: "Forgot password" })
    .getByRole("textbox", { name: "Email" })
    .fill(email);
  await page.getByRole("button", { name: "Send a reset link" }).click();
  await expect(page.getByText("a link to choose a new password is on its way")).toBeVisible();

  await page.goto(await linkMailedTo(email, "reset"));
  await page.getByLabel("New password", { exact: true }).fill("a whole new passphrase here");
  await page.getByRole("button", { name: "Set password" }).click();
  await expect(page.getByText("Your password has been changed")).toBeVisible();

  await page.getByRole("link", { name: "Log in" }).click();
  const login = page.getByRole("form", { name: "Log in" });
  await login.getByRole("textbox", { name: "Email" }).fill(email);
  await login.getByLabel("Password", { exact: true }).fill("a whole new passphrase here");
  await login.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("heading", { name: "Personal" })).toBeVisible();
});

test("your account: confirm the email, see devices, make an API token, delete it all", async ({
  page,
}) => {
  const email = await signUp(page);
  await addBook(page);

  await page.goto(await linkMailedTo(email, "verify"));
  await expect(page.getByText("Your email address is confirmed.")).toBeVisible();

  await page.goto("/ui/account");
  await expect(page.getByRole("textbox", { name: "Email" })).toHaveValue(email);
  await expect(page.getByText("Not confirmed yet")).toBeHidden();
  await expect(page.getByRole("region", { name: "Devices" })).toContainText("this device");

  const tokens = page.getByRole("region", { name: "API tokens" });
  await tokens.getByRole("textbox", { name: "Token name" }).fill("backups");
  await tokens.getByRole("button", { name: "Create token" }).click();
  await expect(tokens.getByRole("status")).toContainText(/lm_[\w-]{20,}/);
  await expect(tokens.getByRole("listitem")).toContainText("backups");

  await page.getByRole("button", { name: "Delete account…" }).click();
  await page.getByLabel("Your password, to confirm", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Delete everything" }).click();
  await expect(page.getByRole("form", { name: "Log in" })).toBeVisible();
});
