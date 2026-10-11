/**
 * The auth service's HTTP surface, at /api/auth/v1.
 *
 * - `POST /login` starts a session. For M1 it always logs in the stub user.
 * - `POST /logout` ends it, `GET /me` says who's logged in.
 * - `GET /verify` is Traefik's forwardAuth check for every other API route. On success it answers
 *   200 with `X-User-Id`, which Traefik copies onto the request it forwards (replacing anything a
 *   client sent); on failure, 401, and the request never reaches a service.
 *
 * The session token travels in an HttpOnly, SameSite=Strict cookie, so the PWA never handles it.
 * `Authorization: Bearer` works too, for tests and non-browser clients.
 */
import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";

import { LIFETIME_SECONDS, type Tokens } from "./tokens.js";
import type { Users } from "./users.js";

export const COOKIE = "fava_beans_session";

/**
 * With `testUsers` (AUTH_TEST_USERS=true, for test stacks only), `POST /login` with
 * `{"email": ...}` logs in a separate user for that address, so tests don't share state. Without
 * it, as everywhere else, login always yields the stub user.
 */
export function createApp({
  users,
  tokens,
  testUsers = false,
}: {
  users: Users;
  tokens: Tokens;
  testUsers?: boolean;
}) {
  const app = new Hono().basePath("/api/auth/v1");

  const tokenFrom = (c: Context) => {
    const bearer = c.req.header("authorization")?.match(/^Bearer (.+)$/i)?.[1];
    return bearer ?? getCookie(c, COOKIE);
  };
  const userFrom = async (c: Context) => {
    const id = await tokens.verify(tokenFrom(c));
    return id ? users.get(id) : undefined;
  };
  // Behind a TLS-terminating proxy the cookie must be Secure; on plain HTTP (local network), it
  // can't be, or the browser would drop it.
  const secure = (c: Context) => c.req.header("x-forwarded-proto") === "https";

  app.post("/login", async (c) => {
    const email = testUsers
      ? ((await c.req.json().catch(() => ({}))) as { email?: unknown }).email
      : undefined;
    const user =
      typeof email === "string" && email ? users.ensureTestUser(email) : users.ensureStub();
    const token = await tokens.issue(user.id);
    setCookie(c, COOKIE, token, {
      httpOnly: true,
      sameSite: "Strict",
      path: "/",
      secure: secure(c),
      maxAge: LIFETIME_SECONDS,
    });
    return c.json({ user, token });
  });

  app.post("/logout", (c) => {
    deleteCookie(c, COOKIE, { path: "/", secure: secure(c) });
    return c.body(null, 204);
  });

  app.get("/me", async (c) => {
    const user = await userFrom(c);
    return user ? c.json(user) : c.json({ detail: "not logged in" }, 401);
  });

  app.get("/verify", async (c) => {
    const user = await userFrom(c);
    if (!user) return c.json({ detail: "not logged in" }, 401);
    c.header("X-User-Id", user.id);
    return c.body(null, 200);
  });

  return app;
}
