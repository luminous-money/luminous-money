/** The MCP server's sign-in: connecting an app (OAuth's consent, at /ui/authorize), and the
 * Account page's Connected apps. */
import { createHash, randomBytes } from "node:crypto";

import { expect, type Page } from "@playwright/test";

import { test } from "./fixtures.js";

test.use({ storageState: { cookies: [], origins: [] } });

const CALLBACK = "http://localhost:43123/callback";
const VERIFIER = randomBytes(32).toString("base64url");

/** An app registered as Claude registers itself, and the address it sends the user to. */
async function appRequest(page: Page, state = "s1") {
  const registered = await page.request.post("/api/auth/v1/oauth/register", {
    data: { client_name: "Claude", redirect_uris: [CALLBACK] },
  });
  expect(registered.status()).toBe(201);
  const { client_id } = (await registered.json()) as { client_id: string };
  const query = new URLSearchParams({
    client_id,
    redirect_uri: CALLBACK,
    response_type: "code",
    code_challenge: createHash("sha256").update(VERIFIER).digest("base64url"),
    code_challenge_method: "S256",
    state,
  });
  // The app's own page, where the browser lands back: nothing runs there in the test.
  await page.route(`${CALLBACK}**`, (route) => route.fulfill({ body: "back in the app" }));
  return { client_id, url: `/ui/authorize?${query}` };
}

test("connecting Claude: log in on the way, allow it, see it connected, and disconnect it", async ({
  page,
}) => {
  const { client_id, url } = await appRequest(page);

  // Logged out, the consent asks you to log in (here, to make an account) first.
  await page.goto(url);
  await page.getByRole("button", { name: "Create an account" }).click();
  const form = page.getByRole("form", { name: "Create an account" });
  await form.getByRole("textbox", { name: "Your name" }).fill("Kael");
  await form
    .getByRole("textbox", { name: "Email" })
    .fill(`mcp-${randomBytes(4).toString("hex")}@test.local`);
  await form.getByLabel("Password", { exact: true }).fill("correct horse battery staple");
  await form.getByRole("button", { name: "Create account" }).click();

  const consent = page.getByRole("region", { name: "Connect an app" });
  await expect(consent).toContainText("Claude wants to use Luminous Money as you.");
  await expect(consent).toContainText("Allowing returns you to localhost:43123.");
  await consent.getByRole("button", { name: "Allow" }).click();

  await page.waitForURL(`${CALLBACK}**`);
  const back = new URL(page.url());
  expect(back.searchParams.get("state")).toBe("s1");
  const traded = await page.request.post("/api/auth/v1/oauth/token", {
    form: {
      grant_type: "authorization_code",
      code: back.searchParams.get("code")!,
      code_verifier: VERIFIER,
      redirect_uri: CALLBACK,
      client_id,
    },
  });
  expect(traded.status()).toBe(200);

  // A new account sets up its books before anything else (the consent alone came first).
  await page.goto("/ui/");
  await page.getByRole("textbox", { name: "Name your books" }).fill("Personal");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("combobox", { name: "Account" }).fill("Assets:Bank:Checking");
  await page.getByRole("button", { name: "Finish setup" }).click();
  await expect(page.getByRole("heading", { name: "Personal" })).toBeVisible();

  await page.goto("/ui/account");
  const apps = page.getByRole("region", { name: "Connected apps" });
  await expect(apps).toContainText("Claude");
  await expect(page.getByRole("region", { name: "Devices" })).not.toContainText("Claude");
  await apps.getByRole("button", { name: "Disconnect Claude" }).click();
  await expect(apps).toContainText("None.");
});

test("denying sends the app away with nothing, and a stranger's redirect is refused", async ({
  page,
}) => {
  const { url } = await appRequest(page, "s2");
  await page.goto("/ui/");
  await page.getByRole("button", { name: "Create an account" }).click();
  const form = page.getByRole("form", { name: "Create an account" });
  await form.getByRole("textbox", { name: "Your name" }).fill("Kael");
  await form
    .getByRole("textbox", { name: "Email" })
    .fill(`mcp-${randomBytes(4).toString("hex")}@test.local`);
  await form.getByLabel("Password", { exact: true }).fill("correct horse battery staple");
  await form.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Let's set up your books" })).toBeVisible();

  await page.goto(
    url.replace(encodeURIComponent(CALLBACK), encodeURIComponent("https://evil.example/cb"))
  );
  await expect(page.getByRole("region", { name: "Connect an app" })).toContainText(
    "This app asked to return somewhere it didn't register."
  );

  await page.goto(url);
  await page
    .getByRole("region", { name: "Connect an app" })
    .getByRole("button", { name: "Deny" })
    .click();
  await page.waitForURL(`${CALLBACK}**`);
  const back = new URL(page.url());
  expect(back.searchParams.get("error")).toBe("access_denied");
  expect(back.searchParams.get("code")).toBeNull();
});
