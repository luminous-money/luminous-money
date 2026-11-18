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
import { OAuth } from "../src/oauth.js";
import { ApiTokens, GRACE_MS, Sessions } from "../src/sessions.js";
import { allowList } from "../src/access.js";
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
    oauth: new OAuth(db),
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

    // Traefik's forwardAuth asks /verify over the stack's plain HTTP: the cookies still count.
    const [access, refresh] = cookies.map((c) => c.split(";")[0]!);
    expect((await call("/verify", { headers: { cookie: access! } })).status).toBe(200);
    const renewed = await call("/token", { method: "POST", headers: { cookie: refresh! } });
    expect(renewed.status).toBe(200);
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

describe("a private instance", () => {
  it("reads its allowlist from the setting: trimmed, any case, once each", () => {
    expect(allowList(" Kael@Example.com, jess@example.com,,kael@example.com ")).toEqual([
      "kael@example.com",
      "jess@example.com",
    ]);
    expect(allowList(undefined)).toEqual([]);
  });

  const privately = (allowed: string[]) => setup({ access: { mode: "private", allowed } });
  const signups = async (call: Awaited<ReturnType<typeof setup>>["call"]) =>
    (await (await call("/config")).json()) as { service_mode: string; signups_open: boolean };

  it("lets only the allowed emails sign up (in any case), and says so to anyone else", async () => {
    const { call } = await privately(["kael@example.com", "jess@example.com"]);

    const stranger = await call("/signup", {
      method: "POST",
      json: { name: "X", email: "someone@example.com", password: PASSWORD },
    });
    expect(stranger.status).toBe(403);
    expect(await stranger.json()).toEqual({
      detail: "This is a private instance: request access from the server administrator.",
    });
    await signUp(call, "Kael@Example.com");
  });

  it("closes sign-ups once every allowed email has an account", async () => {
    const { call } = await privately(["kael@example.com", "jess@example.com"]);
    expect(await signups(call)).toMatchObject({ service_mode: "private", signups_open: true });

    await signUp(call, "kael@example.com");
    expect((await signups(call)).signups_open).toBe(true);
    await signUp(call, "JESS@example.com");
    expect((await signups(call)).signups_open).toBe(false);
  });

  it("is closed with no one allowed; a public server is always open", async () => {
    expect((await signups((await privately([])).call)).signups_open).toBe(false);
    const { call } = await setup();
    await signUp(call);
    expect(await signups(call)).toMatchObject({ service_mode: "public", signups_open: true });
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
    // Not confirmed yet: an admin named by this email wouldn't count.
    expect(ok.headers.get("x-user-email-verified")).toBe("false");

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

describe("OAuth for MCP clients", () => {
  const BASE = "https://books.example";
  const RESOURCE = `${BASE}/api/mcp/v1`;
  const CALLBACK = "https://claude.ai/api/mcp/auth_callback";
  const VERIFIER = "a-verifier-long-enough-to-be-a-real-pkce-code-verifier-0123456789";
  const CHALLENGE = createHash("sha256").update(VERIFIER).digest("base64url");

  async function connected() {
    const ctx = await setup({ publicUrl: BASE });
    const { call } = ctx;
    const me = await signUp(call);
    const registered = await call("/oauth/register", {
      method: "POST",
      json: { client_name: "Claude", redirect_uris: [CALLBACK, "http://localhost:3118/callback"] },
    });
    expect(registered.status).toBe(201);
    const client = (await registered.json()) as { client_id: string };
    /** The consent, as the logged-in user; the redirect it answers. */
    const authorize = async (extra: Record<string, unknown> = {}) => {
      const response = await call("/oauth/authorize", {
        method: "POST",
        headers: bearer(me.access_token),
        json: {
          client_id: client.client_id,
          redirect_uri: CALLBACK,
          response_type: "code",
          code_challenge: CHALLENGE,
          code_challenge_method: "S256",
          state: "xyz",
          resource: RESOURCE,
          decision: "allow",
          ...extra,
        },
      });
      return { response, json: (await response.json()) as Record<string, string> };
    };
    const codeOf = (redirect: string) => new URL(redirect).searchParams.get("code")!;
    const token = (form: Record<string, string>) =>
      call("/oauth/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(form).toString(),
      });
    const exchange = (code: string, verifier = VERIFIER) =>
      token({
        grant_type: "authorization_code",
        code,
        code_verifier: verifier,
        redirect_uri: CALLBACK,
        client_id: client.client_id,
        resource: RESOURCE,
      });
    const verify = (access: string, uri = "/api/mcp/v1") =>
      call("/verify", { headers: { ...bearer(access), "x-forwarded-uri": uri } });
    return { ...ctx, me, client, authorize, codeOf, token, exchange, verify };
  }

  it("publishes where to sign in, and says so when a request to the MCP server has no token", async () => {
    const { app, call } = await setup({ publicUrl: BASE });
    const resource = await (
      await app.request("/.well-known/oauth-protected-resource/api/mcp/v1")
    ).json();
    expect(resource).toMatchObject({ resource: RESOURCE, authorization_servers: [BASE] });
    const server = await (await app.request("/.well-known/oauth-authorization-server")).json();
    expect(server).toMatchObject({
      issuer: BASE,
      authorization_endpoint: `${BASE}/ui/authorize`,
      token_endpoint: `${BASE}/api/auth/v1/oauth/token`,
      registration_endpoint: `${BASE}/api/auth/v1/oauth/register`,
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
    });

    const refused = await call("/verify", { headers: { "x-forwarded-uri": "/api/mcp/v1" } });
    expect(refused.status).toBe(401);
    expect(refused.headers.get("www-authenticate")).toBe(
      `Bearer resource_metadata="${BASE}/.well-known/oauth-protected-resource/api/mcp/v1"`
    );
    const elsewhere = await call("/verify", {
      headers: { "x-forwarded-uri": "/api/ledger/v1/books" },
    });
    expect(elsewhere.headers.get("www-authenticate")).toBeNull();
  });

  it("takes https and loopback redirects only", async () => {
    const { call } = await setup();
    const register = (uris: string[]) =>
      call("/oauth/register", { method: "POST", json: { client_name: "x", redirect_uris: uris } });
    expect((await register(["http://evil.example/cb"])).status).toBe(400);
    expect((await register([])).status).toBe(400);
    expect((await register(["http://127.0.0.1:9000/cb"])).status).toBe(201);
  });

  it("trades a consent's code for tokens that reach the MCP server alone", async () => {
    const { authorize, codeOf, exchange, verify, call, token, client } = await connected();

    const check = await authorize({ decision: undefined });
    expect(check.json).toEqual({ client_name: "Claude", redirect_host: "claude.ai" });

    const { json } = await authorize();
    const redirect = new URL(json.redirect!);
    expect(redirect.origin + redirect.pathname).toBe(CALLBACK);
    expect(redirect.searchParams.get("state")).toBe("xyz");
    expect(redirect.searchParams.get("iss")).toBe(BASE);

    const traded = await exchange(codeOf(json.redirect!));
    expect(traded.status).toBe(200);
    const tokens = (await traded.json()) as { access_token: string; refresh_token: string };

    expect((await verify(tokens.access_token)).status).toBe(200);
    expect((await verify(tokens.access_token, "/api/ledger/v1/books")).status).toBe(401);
    expect((await call("/me", { headers: bearer(tokens.access_token) })).status).toBe(401);

    // Refreshing rotates, at the OAuth endpoint only.
    expect(
      (await call("/token", { method: "POST", json: { refresh_token: tokens.refresh_token } }))
        .status
    ).toBe(401);
    const refreshed = await token({
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
      client_id: client.client_id,
    });
    expect(refreshed.status).toBe(200);
    const next = (await refreshed.json()) as { access_token: string; refresh_token: string };
    expect(next.refresh_token).not.toBe(tokens.refresh_token);
    expect((await verify(next.access_token)).status).toBe(200);
  });

  it("refuses a wrong verifier, a redirect it didn't register, and a code used twice", async () => {
    const { authorize, codeOf, exchange, verify, call, me } = await connected();

    const wrong = await exchange(codeOf((await authorize()).json.redirect!), `${VERIFIER}x`);
    expect(wrong.status).toBe(400);
    expect(await wrong.json()).toMatchObject({ error: "invalid_grant" });

    const elsewhere = await authorize({ redirect_uri: "https://evil.example/cb" });
    expect(elsewhere.response.status).toBe(400);

    // The resource is checked by its path: a proxy may name the host differently.
    const proxied = await authorize({ resource: "http://books.internal/api/mcp/v1/" });
    expect(proxied.json.redirect).toMatch(/[?&]code=/);
    const other = await authorize({ resource: `${BASE}/api/ledger/v1` });
    expect(new URL(other.json.redirect!).searchParams.get("error")).toBe("invalid_target");

    // A loopback redirect may come back on another port.
    const loopback = await authorize({ redirect_uri: "http://localhost:51234/callback" });
    expect(loopback.json.redirect).toMatch(/^http:\/\/localhost:51234\/callback\?code=/);

    const code = codeOf((await authorize()).json.redirect!);
    const first = (await (await exchange(code)).json()) as { access_token: string };
    expect((await verify(first.access_token)).status).toBe(200);
    const again = await exchange(code);
    expect(await again.json()).toMatchObject({ error: "invalid_grant" });
    // The session the code was traded for ends.
    expect((await verify(first.access_token)).status).toBe(401);

    const denied = await authorize({ decision: "deny" });
    expect(new URL(denied.json.redirect!).searchParams.get("error")).toBe("access_denied");
    // Someone not logged in can't consent.
    expect((await call("/oauth/authorize", { method: "POST", json: {} })).status).toBe(401);
    void me;
  });

  it("lists a connected app, and disconnecting it stops its token", async () => {
    const { authorize, codeOf, exchange, verify, call, me } = await connected();
    const tokens = (await (await exchange(codeOf((await authorize()).json.redirect!))).json()) as {
      access_token: string;
    };
    const list = (await (await call("/sessions", { headers: bearer(me.access_token) })).json()) as {
      id: string;
      device: string;
      app: boolean;
    }[];
    const app = list.find((s) => s.app)!;
    expect(app.device).toBe("Claude");
    expect(list.filter((s) => !s.app)).toHaveLength(1);

    await call(`/sessions/${app.id}`, { method: "DELETE", headers: bearer(me.access_token) });
    expect((await verify(tokens.access_token)).status).toBe(401);
  });

  it("revokes a token's session", async () => {
    const { authorize, codeOf, exchange, verify, call } = await connected();
    const tokens = (await (await exchange(codeOf((await authorize()).json.redirect!))).json()) as {
      access_token: string;
      refresh_token: string;
    };
    const revoked = await call("/oauth/revoke", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        origin: "https://other.example",
      },
      body: new URLSearchParams({ token: tokens.refresh_token }).toString(),
    });
    expect(revoked.status).toBe(200);
    expect((await verify(tokens.access_token)).status).toBe(401);
  });
});
