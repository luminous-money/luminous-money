import { createHash } from "node:crypto";

import { open } from "@luminous-money/db";
import { describe, expect, it } from "vitest";

import { createApp, type Services } from "../src/app.js";
import { SigningKeys } from "../src/keys.js";
import { EmailLinks } from "../src/links.js";
import type { Message } from "../src/mail.js";
import {
  hashPassword,
  needsRehash,
  passwordProblem,
  pwnedPasswords,
  verifyPassword,
} from "../src/passwords.js";
import { ApiTokens, GRACE_MS, Sessions } from "../src/sessions.js";
import { STUB_USER_ID, Users } from "../src/users.js";

const PASSWORD = "correct horse battery staple";
const BREACHED = "password1234567890";

async function setup(extra: Partial<Services> = {}) {
  const db = open(":memory:");
  const users = new Users(db);
  const keys = new SigningKeys(db);
  await keys.ensure();
  const sent: Message[] = [];
  const deleted: string[] = [];
  const services: Services = {
    users,
    sessions: new Sessions(db),
    apiTokens: new ApiTokens(db),
    keys,
    links: new EmailLinks(db),
    breached: async (p) => p === BREACHED,
    mail: { mailer: { send: async (m) => void sent.push(m) }, publicUrl: "https://books.example" },
    deleteBooks: async (id) => void deleted.push(id),
    ...extra,
  };
  const app = createApp(services);
  const call = (path: string, init: RequestInit & { json?: unknown } = {}) => {
    const { json, ...rest } = init;
    return app.request(`/api/auth/v1${path}`, {
      ...rest,
      headers: {
        ...(json === undefined ? {} : { "content-type": "application/json" }),
        ...(rest.headers as Record<string, string>),
      },
      body: json === undefined ? rest.body : JSON.stringify(json),
    });
  };
  return { app, call, services, users, keys, sent, deleted, db };
}

type Tokens = { access_token: string; refresh_token: string; user: { id: string; email: string } };

/** Sign up (tokens in the body) and return the tokens. */
async function signUp(call: Awaited<ReturnType<typeof setup>>["call"], email = "kael@example.com") {
  const response = await call("/signup", {
    method: "POST",
    json: { name: "Kael", email, password: PASSWORD, delivery: "body" },
  });
  expect(response.status).toBe(201);
  return (await response.json()) as Tokens;
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
const linkIn = (message: Message) => /\/ui\/(?:reset|verify)\/([\w-]+)/.exec(message.text)![1]!;

describe("passwords", () => {
  it("hash with Argon2id, verify after Unicode normalization, and know when they're behind", async () => {
    const stored = await hashPassword("ｃａｆé latte with oat milk");

    expect(stored).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(await verifyPassword("café latte with oat milk", stored)).toBe(true);
    expect(await verifyPassword("cafe latte with oat milk", stored)).toBe(false);
    expect(needsRehash(stored)).toBe(false);
    expect(needsRehash(stored.replace("m=19456", "m=4096"))).toBe(true);
  });

  it("need 15 characters, not the email, and not breached", async () => {
    const breached = async (p: string) => p === BREACHED;

    expect(await passwordProblem("short one", "a@b.co", breached)).toMatch(/at least 15/);
    expect(await passwordProblem("Kael@Example.com", "kael@example.com", breached)).toMatch(
      /email/
    );
    expect(await passwordProblem(BREACHED, "a@b.co", breached)).toMatch(/breach/);
    expect(await passwordProblem(PASSWORD, "a@b.co", breached)).toBeUndefined();
  });

  it("are checked against HIBP by hash prefix only, ignoring padding, and pass when it's down", async () => {
    const sha1 = createHash("sha1").update(BREACHED).digest("hex").toUpperCase();
    const asked: string[] = [];
    const hibp = pwnedPasswords(async (url) => {
      asked.push(String(url));
      return new Response(`${sha1.slice(5)}:42\nFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF:0\n`);
    });

    expect(await hibp(BREACHED)).toBe(true);
    expect(await hibp(PASSWORD)).toBe(false);
    expect(asked[0]).toBe(`https://api.pwnedpasswords.com/range/${sha1.slice(0, 5)}`);
    expect(await pwnedPasswords(async () => Promise.reject(new Error("down")))(BREACHED)).toBe(
      false
    );
  });
});

describe("signing up and logging in", () => {
  it("anyone can sign up; the browser gets HttpOnly cookies, the refresh one only for /token", async () => {
    const { call, sent } = await setup();

    const response = await call("/signup", {
      method: "POST",
      json: { name: "Kael", email: "Kael@Example.com", password: PASSWORD },
    });

    expect(response.status).toBe(201);
    const cookies = response.headers.getSetCookie();
    expect(cookies[0]).toMatch(/^lm_access=.+; Max-Age=600; Path=\/; HttpOnly; SameSite=Strict$/);
    expect(cookies[1]).toMatch(
      /^lm_refresh=.+; Path=\/api\/auth\/v1\/token; HttpOnly; SameSite=Strict/
    );
    expect(sent.map((m) => [m.to, m.subject])).toEqual([
      ["Kael@Example.com", "Confirm your email for Luminous Money"],
    ]);
    const access = cookies[0]!.split(";")[0]!;
    const me = await call("/me", { headers: { cookie: access } });
    expect(await me.json()).toMatchObject({ name: "Kael", email_verified: false });
  });

  it("uses __Host- and Secure cookies behind HTTPS", async () => {
    const { call } = await setup();
    const response = await call("/signup", {
      method: "POST",
      headers: { "x-forwarded-proto": "https" },
      json: { name: "Kael", email: "kael@example.com", password: PASSWORD },
    });

    const cookies = response.headers.getSetCookie();
    expect(cookies[0]).toMatch(/^__Host-lm_access=.*; Secure/);
    expect(cookies[1]).toMatch(/^__Secure-lm_refresh=.*; Secure/);
  });

  it("refuses a taken email (any case), a weak or breached password, and a bad email", async () => {
    const { call } = await setup();
    await signUp(call);
    const attempt = (json: object) =>
      call("/signup", { method: "POST", json: { name: "X", password: PASSWORD, ...json } });

    expect((await attempt({ email: "KAEL@example.com" })).status).toBe(422);
    expect((await attempt({ email: "jess@example.com", password: "too short" })).status).toBe(422);
    expect((await attempt({ email: "jess@example.com", password: BREACHED })).status).toBe(422);
    expect((await attempt({ email: "not an email" })).status).toBe(422);
  });

  it("says the same for an unknown email and a wrong password, and slows down guessing", async () => {
    const { call } = await setup();
    await signUp(call);
    const login = (email: string, password: string) =>
      call("/login", { method: "POST", json: { email, password } });

    const unknown = await login("nobody@example.com", PASSWORD);
    const wrong = await login("kael@example.com", "not the password at all");
    expect([unknown.status, wrong.status]).toEqual([401, 401]);
    expect(await unknown.json()).toEqual(await wrong.json());

    for (let i = 0; i < 4; i++) await login("kael@example.com", "not the password at all");
    const throttled = await login("kael@example.com", PASSWORD);
    expect(throttled.status).toBe(429);
    expect(Number(throttled.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("logs in test users by email alone, only on test stacks", async () => {
    const plain = await setup();
    const test = await setup({ testUsers: true });
    const login = (call: typeof plain.call) =>
      call("/login", { method: "POST", json: { email: "e2e@test.local", delivery: "body" } });

    expect((await login(plain.call)).status).toBe(401);
    expect((await login(test.call)).status).toBe(200);
  });
});

describe("tokens", () => {
  it("refresh rotates; a refresh token used again after the grace ends the session", async () => {
    const { call, services } = await setup();
    const first = await signUp(call);

    const refreshed = await call("/token", {
      method: "POST",
      json: { refresh_token: first.refresh_token },
    });
    const second = (await refreshed.json()) as Tokens;
    expect(refreshed.status).toBe(200);
    expect(second.refresh_token).not.toBe(first.refresh_token);

    // Within the grace (two tabs at once), the old one still works.
    expect(services.sessions.refresh(first.refresh_token, Date.now() + 1000)).toBeDefined();
    // Later, it's a stolen copy: the whole session ends.
    expect(
      services.sessions.refresh(first.refresh_token, Date.now() + GRACE_MS + 1000)
    ).toBeUndefined();
    const after = await call("/token", {
      method: "POST",
      json: { refresh_token: second.refresh_token },
    });
    expect(after.status).toBe(401);
    expect((await call("/verify", { headers: bearer(second.access_token) })).status).toBe(401);
  });

  it("verify answers with the user for a live session, and logging out stops it at once", async () => {
    const { call } = await setup();
    const tokens = await signUp(call);

    const ok = await call("/verify", { headers: bearer(tokens.access_token) });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("x-user-id")).toBe(tokens.user.id);

    await call("/token/revoke", { method: "POST", json: { refresh_token: tokens.refresh_token } });
    expect((await call("/verify", { headers: bearer(tokens.access_token) })).status).toBe(401);
    expect((await call("/verify", { headers: bearer("forged.token.here") })).status).toBe(401);
  });

  it("access tokens are EdDSA JWTs for ten minutes, still valid across a key rotation", async () => {
    const { call, keys } = await setup();
    const tokens = await signUp(call);
    const [header, payload] = tokens.access_token
      .split(".")
      .slice(0, 2)
      .map((part) => JSON.parse(Buffer.from(part, "base64url").toString()));

    expect(header).toMatchObject({ alg: "EdDSA", typ: "at+jwt" });
    expect(payload.exp - payload.iat).toBe(600);
    await keys.rotate();
    expect((await call("/verify", { headers: bearer(tokens.access_token) })).status).toBe(200);
    expect(
      ((await (await call("/.well-known/jwks.json")).json()) as { keys: unknown[] }).keys
    ).toHaveLength(2);
  });

  it("API tokens act as their user for the APIs, but can't manage the account", async () => {
    const { call } = await setup();
    const tokens = await signUp(call);
    const created = await call("/tokens", {
      method: "POST",
      headers: bearer(tokens.access_token),
      json: { name: "backups" },
    });
    const { token, secret } = (await created.json()) as {
      token: { id: string; hint: string };
      secret: string;
    };

    expect(secret).toMatch(/^lm_/);
    expect(token.hint).toBe(secret.slice(-4));
    const verified = await call("/verify", { headers: bearer(secret) });
    expect(verified.headers.get("x-user-id")).toBe(tokens.user.id);
    expect((await call("/sessions", { headers: bearer(secret) })).status).toBe(403);

    await call(`/tokens/${token.id}`, { method: "DELETE", headers: bearer(tokens.access_token) });
    expect((await call("/verify", { headers: bearer(secret) })).status).toBe(401);
  });
});

describe("your account", () => {
  it("lists sessions, ends others, and a password change ends every other one", async () => {
    const { call } = await setup();
    const phone = await signUp(call);
    const login = async () =>
      (await (
        await call("/login", {
          method: "POST",
          headers: {
            "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X) Chrome/140 Safari/537",
          },
          json: { email: "kael@example.com", password: PASSWORD, delivery: "body" },
        })
      ).json()) as Tokens;
    const laptop = await login();

    const listed = (await (
      await call("/sessions", { headers: bearer(laptop.access_token) })
    ).json()) as {
      device: string;
      current: boolean;
    }[];
    expect(listed.map((s) => [s.device, s.current])).toContainEqual(["Chrome on macOS", true]);
    expect(listed).toHaveLength(2);

    await call("/sessions/end-others", { method: "POST", headers: bearer(laptop.access_token) });
    expect((await call("/verify", { headers: bearer(phone.access_token) })).status).toBe(401);

    const other = await login();
    const changed = await call("/me/password", {
      method: "POST",
      headers: bearer(laptop.access_token),
      json: { current: PASSWORD, password: "a whole new passphrase here" },
    });
    expect(changed.status).toBe(204);
    expect((await call("/verify", { headers: bearer(other.access_token) })).status).toBe(401);
    expect((await call("/verify", { headers: bearer(laptop.access_token) })).status).toBe(200);
  });

  it("edits name and email against the version read; a new email needs the password and checking", async () => {
    const { call, sent } = await setup();
    const tokens = await signUp(call);
    const me = (await (await call("/me", { headers: bearer(tokens.access_token) })).json()) as {
      updated_at: string;
    };
    const patch = (json: object) =>
      call("/me", { method: "PATCH", headers: bearer(tokens.access_token), json });

    expect((await patch({ email: "new@example.com", updated_at: me.updated_at })).status).toBe(403);
    const renamed = await patch({
      name: "Kael L",
      email: "new@example.com",
      password: PASSWORD,
      updated_at: me.updated_at,
    });
    expect(await renamed.json()).toMatchObject({ name: "Kael L", email: "new@example.com" });
    expect((await patch({ name: "Stale", updated_at: me.updated_at })).status).toBe(409);

    const verifyLink = linkIn(sent.at(-1)!);
    expect(sent.at(-1)!.to).toBe("new@example.com");
    expect(
      (await call("/email/verify", { method: "POST", json: { token: verifyLink } })).status
    ).toBe(204);
    expect(
      (await call("/email/verify", { method: "POST", json: { token: verifyLink } })).status
    ).toBe(400);
    const after = await call("/me", { headers: bearer(tokens.access_token) });
    expect(await after.json()).toMatchObject({ email_verified: true });
  });

  it("forgot password emails a single-use link that resets it and ends every session", async () => {
    const { call, sent } = await setup();
    const tokens = await signUp(call);

    expect(
      (await call("/password/forgot", { method: "POST", json: { email: "nobody@example.com" } }))
        .status
    ).toBe(202);
    expect(sent).toHaveLength(1); // just the sign-up's verification
    await call("/password/forgot", { method: "POST", json: { email: "KAEL@example.com" } });
    const token = linkIn(sent.at(-1)!);
    expect(sent.at(-1)!.text).toContain("https://books.example/ui/reset/");

    const weak = await call("/password/reset", {
      method: "POST",
      json: { token, password: "short" },
    });
    expect(weak.status).toBe(422); // and the link still works
    const reset = await call("/password/reset", {
      method: "POST",
      json: { token, password: "a whole new passphrase here" },
    });
    expect(reset.status).toBe(204);
    expect((await call("/verify", { headers: bearer(tokens.access_token) })).status).toBe(401);
    expect(
      (
        await call("/password/reset", {
          method: "POST",
          json: { token, password: "another passphrase entirely" },
        })
      ).status
    ).toBe(400);
    const login = await call("/login", {
      method: "POST",
      json: { email: "kael@example.com", password: "a whole new passphrase here" },
    });
    expect(login.status).toBe(200);
  });

  it("without mail, forgot password says to ask whoever runs the server", async () => {
    const { call } = await setup({ mail: undefined });
    expect(
      (await call("/password/forgot", { method: "POST", json: { email: "a@b.co" } })).status
    ).toBe(503);
    expect(await (await call("/config")).json()).toMatchObject({ mail: false });
  });

  it("deleting the account needs the password and deletes its books", async () => {
    const { call, deleted, users } = await setup();
    const tokens = await signUp(call);
    const remove = (password: string) =>
      call("/me", { method: "DELETE", headers: bearer(tokens.access_token), json: { password } });

    expect((await remove("not the password at all")).status).toBe(403);
    expect((await remove(PASSWORD)).status).toBe(204);
    expect(deleted).toEqual([tokens.user.id]);
    expect(users.get(tokens.user.id)).toBeUndefined();
    expect((await call("/verify", { headers: bearer(tokens.access_token) })).status).toBe(401);
  });

  it("a disabled account can't log in, and its sessions stop", async () => {
    const { call, users, services } = await setup();
    const tokens = await signUp(call);

    users.setDisabled(tokens.user.id, true);
    services.sessions.endAll(tokens.user.id, "account disabled");

    expect((await call("/verify", { headers: bearer(tokens.access_token) })).status).toBe(401);
    const login = await call("/login", {
      method: "POST",
      json: { email: "kael@example.com", password: PASSWORD },
    });
    expect(login.status).toBe(403);
  });

  it("refuses writes from other sites", async () => {
    const { call } = await setup();
    const response = await call("/signup", {
      method: "POST",
      headers: { origin: "https://evil.example" },
      json: { name: "Kael", email: "kael@example.com", password: PASSWORD },
    });
    expect(response.status).toBe(403);
  });
});

describe("the pre-M8 stub", () => {
  it("is claimed by a real account, keeping its ID (and so its books)", async () => {
    const { call, users, db } = await setup();
    db.prepare(
      "INSERT INTO user (id, name, email, created_at, updated_at) VALUES (?, 'You', 'you@luminous-money.local', '2026-01-01T00:00:00.000000Z', '2026-01-01T00:00:00.000000Z')"
    ).run(STUB_USER_ID);

    users.claimStub("Kael", "kael@example.com", await hashPassword(PASSWORD));

    const login = await call("/login", {
      method: "POST",
      json: { email: "kael@example.com", password: PASSWORD, delivery: "body" },
    });
    expect(((await login.json()) as Tokens).user.id).toBe(STUB_USER_ID);
    expect(() => users.claimStub("Again", "x@example.com", "h")).toThrow(/already been claimed/);
  });
});
