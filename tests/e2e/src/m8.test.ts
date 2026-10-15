import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { before, describe, it } from "node:test";

import { BASE_URL, linkMailedTo, stackIsUp } from "./support.ts";

const PASSWORD = "correct horse battery staple";
const AUTH = `${BASE_URL}/api/auth/v1`;

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${AUTH}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

type Tokens = { access_token: string; refresh_token: string; user: { id: string } };

async function signUp(password = PASSWORD) {
  const email = `m8-${randomBytes(4).toString("hex")}@test.local`;
  const response = await post("/signup", { name: "Kael", email, password, delivery: "body" });
  assert.equal(response.status, 201);
  return { email, ...((await response.json()) as Tokens) };
}

const books = (token: string) =>
  fetch(`${BASE_URL}/api/ledger/v1/books`, { headers: bearer(token) });

describe("M8: auth", () => {
  before(stackIsUp);

  it("anyone signs up, and confirms their email from the link mailed to them", async () => {
    const user = await signUp();

    assert.equal((await books(user.access_token)).status, 200);
    const token = await linkMailedTo(user.email, "verify");
    assert.equal((await post("/email/verify", { token })).status, 204);
    const me = await fetch(`${AUTH}/me`, { headers: bearer(user.access_token) });
    assert.equal(((await me.json()) as { email_verified: boolean }).email_verified, true);
  });

  it("logs in with a password, refreshes, and logging out stops the access token at once", async () => {
    const user = await signUp();
    const login = await post("/login", { email: user.email, password: PASSWORD, delivery: "body" });
    const tokens = (await login.json()) as Tokens;

    const refreshed = await post("/token", { refresh_token: tokens.refresh_token });
    const next = (await refreshed.json()) as Tokens;
    assert.equal(refreshed.status, 200);
    assert.notEqual(next.refresh_token, tokens.refresh_token);
    assert.equal((await books(next.access_token)).status, 200);

    await post("/token/revoke", { refresh_token: next.refresh_token });
    assert.equal((await books(next.access_token)).status, 401);
    assert.equal((await books(user.access_token)).status, 200); // the sign-up's own session
  });

  it("resets a forgotten password by email, ending every session", async () => {
    const user = await signUp();

    assert.equal((await post("/password/forgot", { email: user.email })).status, 202);
    const token = await linkMailedTo(user.email, "reset");
    const reset = await post("/password/reset", { token, password: "a whole new passphrase here" });

    assert.equal(reset.status, 204);
    assert.equal((await books(user.access_token)).status, 401);
    const old = await post("/login", { email: user.email, password: PASSWORD });
    const fresh = await post("/login", {
      email: user.email,
      password: "a whole new passphrase here",
    });
    assert.deepEqual([old.status, fresh.status], [401, 200]);
  });

  it("API tokens reach the APIs until they're revoked", async () => {
    const user = await signUp();
    const created = await post("/tokens", { name: "backups" }, bearer(user.access_token));
    const { token, secret } = (await created.json()) as { token: { id: string }; secret: string };

    assert.equal((await books(secret)).status, 200);
    await fetch(`${AUTH}/tokens/${token.id}`, {
      method: "DELETE",
      headers: bearer(user.access_token),
    });
    assert.equal((await books(secret)).status, 401);
  });

  it("deleting an account deletes the books it owns", async () => {
    const user = await signUp();
    const book = await fetch(`${BASE_URL}/api/app/v1/books`, {
      method: "POST",
      headers: { "content-type": "application/json", ...bearer(user.access_token) },
      body: JSON.stringify({ name: "Doomed", time_zone: "America/Chicago" }),
    });
    assert.equal(book.status, 201);

    const deleted = await fetch(`${AUTH}/me`, {
      method: "DELETE",
      headers: { "content-type": "application/json", ...bearer(user.access_token) },
      body: JSON.stringify({ password: PASSWORD }),
    });

    assert.equal(deleted.status, 204);
    // Asked inside the stack, where services trust X-User-Id: the user owns no books now.
    const left = await fetch("http://ledger:8000/api/ledger/v1/books", {
      headers: { "x-user-id": user.user.id },
    });
    assert.deepEqual(await left.json(), []);
    assert.equal((await post("/login", { email: user.email, password: PASSWORD })).status, 401);
  });

  it("refuses cross-site writes, and slows down password guessing", async () => {
    const user = await signUp();

    const evil = await post(
      "/login",
      { email: user.email, password: PASSWORD },
      { origin: "https://evil.example" }
    );
    assert.equal(evil.status, 403);
    for (let i = 0; i < 5; i++)
      await post("/login", { email: user.email, password: "not the password at all" });
    const throttled = await post("/login", { email: user.email, password: PASSWORD });
    assert.equal(throttled.status, 429);
  });
});
