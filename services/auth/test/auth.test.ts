import { describe, expect, it } from "vitest";

import { open } from "@fava-beans/db";

import { COOKIE, createApp } from "../src/app.js";
import { Tokens } from "../src/tokens.js";
import { STUB_USER, Users } from "../src/users.js";

const SECRET = "a-test-secret-that-is-long-enough-123";

function setup() {
  const users = new Users(open(":memory:"));
  return { app: createApp({ users, tokens: new Tokens(SECRET) }), users };
}

const login = async (app: ReturnType<typeof setup>["app"]) => {
  const response = await app.request("/api/auth/v1/login", { method: "POST" });
  return { response, body: (await response.json()) as { token: string; user: { id: string } } };
};

describe("logging in", () => {
  it("returns the stub user's token and sets an HttpOnly session cookie", async () => {
    const { app } = setup();
    const { response, body } = await login(app);

    expect(body.user.id).toBe(STUB_USER.id);
    const cookie = response.headers.get("set-cookie")!;
    expect(cookie).toContain(`${COOKIE}=${body.token}`);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect(cookie).not.toMatch(/Secure/); // plain HTTP: a Secure cookie would be dropped
  });

  it("marks the cookie Secure behind HTTPS", async () => {
    const { app } = setup();
    const response = await app.request("/api/auth/v1/login", { method: "POST", headers: { "x-forwarded-proto": "https" } });

    expect(response.headers.get("set-cookie")).toMatch(/Secure/);
  });
});

describe("verifying a request (forwardAuth)", () => {
  it("accepts the session cookie or a bearer token, answering with the user's ID", async () => {
    const { app } = setup();
    const { body } = await login(app);

    for (const headers of [{ cookie: `${COOKIE}=${body.token}` }, { authorization: `Bearer ${body.token}` }]) {
      const response = await app.request("/api/auth/v1/verify", { headers });
      expect(response.status).toBe(200);
      expect(response.headers.get("x-user-id")).toBe(STUB_USER.id);
    }
  });

  it("refuses no token, a tampered token, and a token signed with another key", async () => {
    const { app } = setup();
    const { body } = await login(app);
    const foreign = await new Tokens("some-other-secret-that-is-long-enough").issue(STUB_USER.id);

    for (const token of [undefined, `${body.token}x`, foreign]) {
      const headers: Record<string, string> = token ? { authorization: `Bearer ${token}` } : {};
      expect((await app.request("/api/auth/v1/verify", { headers })).status).toBe(401);
    }
  });
});

it("says who's logged in, and logging out clears the cookie", async () => {
  const { app } = setup();
  const { body } = await login(app);

  const me = await app.request("/api/auth/v1/me", { headers: { authorization: `Bearer ${body.token}` } });
  const out = await app.request("/api/auth/v1/logout", { method: "POST" });

  expect(await me.json()).toMatchObject({ id: STUB_USER.id, name: STUB_USER.name });
  expect(out.status).toBe(204);
  expect(out.headers.get("set-cookie")).toMatch(new RegExp(`${COOKIE}=;.*Max-Age=0`));
});

it("creates the stub user once", () => {
  const { users } = setup();
  const first = users.ensureStub();
  const second = users.ensureStub();

  expect(second).toEqual(first);
});

it("refuses a short secret", () => {
  expect(() => new Tokens("short")).toThrow(/32 characters/);
});

describe("test users (test stacks only)", () => {
  const post = (app: ReturnType<typeof setup>["app"], email: string) =>
    app.request("/api/auth/v1/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    });

  it("are off by default: an email still logs in the stub user", async () => {
    const { app } = setup();
    const body = (await (await post(app, "a@test")).json()) as { user: { id: string } };

    expect(body.user.id).toBe(STUB_USER.id);
  });

  it("when on, give each email a user of its own, the same one each time", async () => {
    const users = new Users(open(":memory:"));
    const app = createApp({ users, tokens: new Tokens(SECRET), testUsers: true });

    const a = (await (await post(app, "a@test")).json()) as { user: { id: string } };
    const again = (await (await post(app, "a@test")).json()) as { user: { id: string } };
    const b = (await (await post(app, "b@test")).json()) as { user: { id: string } };

    expect(a.user.id).toBe(again.user.id);
    expect(a.user.id).not.toBe(b.user.id);
    expect(a.user.id).not.toBe(STUB_USER.id);
  });
});
