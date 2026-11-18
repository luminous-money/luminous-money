/**
 * The auth service's HTTP surface, at /api/auth/v1: the only API without Traefik's session check,
 * so every route here checks for itself.
 *
 * - **Accounts:** anyone can sign up (`/signup`) with an email and a password, on a public server;
 *   on a private one, only the allowed emails (`access`, access.ts). `/config` says whether
 *   sign-ups are open. Nobody is special.
 * - **Sessions:** logging in (`/login`) starts one, with a 10-minute access token (an Ed25519
 *   JWT) and a refresh token that rotates on every use (`/token`). `/token/revoke` logs out.
 * - **In the browser** both are HttpOnly cookies (the refresh token's scoped to `/token`), so the
 *   PWA never handles them. Other clients ask for them in the body (`"delivery": "body"`) and
 *   send `Authorization: Bearer`. API tokens (`lm_…`) work as Bearer tokens too.
 * - **`GET /verify`** is Traefik's forwardAuth check for every other API: 200 with `X-User-Id`
 *   (which Traefik copies onto the forwarded request, replacing anything a client sent), or 401.
 *   It checks the token's session in the database, so logging out takes effect at once.
 *
 * - **OAuth for MCP clients** (oauth.ts): the metadata at the root's `/.well-known/`, clients'
 *   registration, the consent's code (`/oauth/authorize`, from the PWA's `/ui/authorize`) and its
 *   tokens (`/oauth/token`). Their access tokens reach only the MCP server (`/verify` checks).
 *
 * With `testUsers` (AUTH_TEST_USERS=true, test stacks only), `/login` with just an email logs in
 * a user for it, made if new, with no password.
 */
import { Hono, type Context, type Next } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";

import { mayJoin, PRIVATE_INSTANCE, PUBLIC, signupsOpen, type Access } from "./access.js";
import { ACCESS_TTL_SECONDS, AUDIENCE, type SigningKeys } from "./keys.js";
import { Failures, Rate } from "./limits.js";
import type { EmailLinks } from "./links.js";
import { emails, type Mailer } from "./mail.js";
import { pkceMatches, redirectAllowed, redirectProblem, type OAuth } from "./oauth.js";
import {
  hashPassword,
  MAX_LENGTH,
  MIN_LENGTH,
  needsRehash,
  passwordProblem,
  verifyPassword,
  type BreachCheck,
} from "./passwords.js";
import { DAY } from "./secrets.js";
import {
  API_TOKEN_PREFIX,
  deviceLabel,
  IDLE_MS,
  type ApiTokens,
  type Session,
  type Sessions,
} from "./sessions.js";
import {
  EmailTaken,
  isEmail,
  PASSWORD,
  publicUser,
  StaleVersion,
  type User,
  type Users,
} from "./users.js";

const BASE = "/api/auth/v1";
const REFRESH_PATH = `${BASE}/token`;
/** The MCP server: the one resource OAuth clients get tokens for. */
export const MCP_PATH = "/api/mcp/v1";
/** Where OAuth clients register, trade codes and revoke: they send no cookies, and may be in a
 * browser on another site, so the Origin check doesn't apply. */
const OAUTH_OPEN = new Set([
  `${BASE}/oauth/register`,
  `${BASE}/oauth/token`,
  `${BASE}/oauth/revoke`,
]);

/** Delete every book the user owns (through `app`, so backups carry it). */
export type BookDeleter = (userId: string) => Promise<void>;

export type Services = {
  users: Users;
  sessions: Sessions;
  apiTokens: ApiTokens;
  keys: SigningKeys;
  links: EmailLinks;
  oauth: OAuth;
  /** Where the server is (LUMINOUS_MONEY_PUBLIC_URL), for OAuth's metadata; without it, from
   * the request's forwarded scheme and host. */
  publicUrl?: string;
  deleteBooks: BookDeleter;
  /** Checks new passwords against known breaches; null turns it off. */
  breached: BreachCheck | null;
  /** Sends email, with links to `publicUrl`; without it, nothing is sent. */
  mail?: { mailer: Mailer; publicUrl: string };
  testUsers?: boolean;
  /** Who may sign up (access.ts); public without it. */
  access?: Access;
  /** How many wrong passwords before waiting, per account and per client IP; sign-ups and
   * reset emails allowed per IP per hour. */
  limits?: { account: number; ip: number; signups: number; resets: number };
};

type Env = { Variables: { user: User; session: Session | undefined } };

const DEFAULT_LIMITS = { account: 5, ip: 20, signups: 20, resets: 5 };

export function createApp(services: Services) {
  const { users, sessions, apiTokens, keys, links, oauth, mail, breached } = services;
  const limits = { ...DEFAULT_LIMITS, ...services.limits };
  const access = services.access ?? PUBLIC;
  const accountFailures = new Failures(limits.account);
  const ipFailures = new Failures(limits.ip);
  const signups = new Rate(limits.signups);
  const resets = new Rate(limits.resets);
  const registrations = new Rate(limits.signups);
  // The root holds OAuth's metadata (/.well-known/…); everything else is under BASE.
  const root = new Hono<Env>();
  const app = root.basePath(BASE);

  // Behind a TLS-terminating proxy, cookies are Secure (and the access cookie gets the __Host-
  // prefix); on plain HTTP (a local network) they can't be, or the browser would drop them.
  const secure = (c: Context) => c.req.header("x-forwarded-proto") === "https";
  const ACCESS = { secure: "__Host-lm_access", plain: "lm_access" };
  const REFRESH = { secure: "__Secure-lm_refresh", plain: "lm_refresh" };
  const named = (c: Context, cookie: typeof ACCESS) => (secure(c) ? cookie.secure : cookie.plain);
  const accessCookie = (c: Context) => named(c, ACCESS);
  const refreshCookie = (c: Context) => named(c, REFRESH);
  // Read by either name: a request may not say it came over HTTPS though its cookie was set over
  // it (Traefik's forwardAuth asks /verify over the stack's plain HTTP). A prefixed cookie can
  // only have been set over HTTPS, so it comes first.
  const cookie = (c: Context, cookie: typeof ACCESS) =>
    getCookie(c, cookie.secure) ?? getCookie(c, cookie.plain);
  const clientIp = (c: Context) =>
    c.req.header("x-forwarded-for")?.split(",").at(-1)?.trim() || "local";
  const bearer = (c: Context) => c.req.header("authorization")?.match(/^Bearer (.+)$/i)?.[1];
  const body = async (c: Context) =>
    (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const problem = (c: Context, detail: string, status: 400 | 401 | 403 | 404 | 409 | 422 | 503) =>
    c.json({ detail }, status);

  // Browsers send Origin on every cross-site write; SameSite=Strict already keeps the cookies
  // off those, and this refuses them outright.
  app.use("*", async (c, next) => {
    const origin = c.req.header("origin");
    if (c.req.method === "GET" || !origin || OAUTH_OPEN.has(c.req.path)) return next();
    const host = c.req.header("x-forwarded-host") ?? c.req.header("host");
    const expected = mail?.publicUrl ? new URL(mail.publicUrl).host : host;
    if (new URL(origin).host !== expected) return problem(c, "cross-site request refused", 403);
    return next();
  });

  // Sessions

  /** Start a session for `user` and hand over its tokens: as cookies, or in the body. */
  const startSession = async (c: Context, user: User, method: string, delivery: unknown) => {
    const { session, refresh } = sessions.start(
      user.id,
      method,
      deviceLabel(c.req.header("user-agent"))
    );
    return deliver(c, user, session, refresh, delivery === "body");
  };

  const deliver = async (
    c: Context,
    user: User,
    session: Session,
    refresh: string,
    inBody: boolean,
    status: 200 | 201 = 200
  ) => {
    const access = await keys.sign({
      sub: user.id,
      sid: session.id,
      aud: session.audience ?? AUDIENCE,
    });
    if (inBody)
      return c.json(
        {
          user: publicUser(user),
          token_type: "Bearer",
          access_token: access,
          expires_in: ACCESS_TTL_SECONDS,
          refresh_token: refresh,
        },
        status
      );
    const common = { httpOnly: true, sameSite: "Strict", secure: secure(c) } as const;
    setCookie(c, accessCookie(c), access, { ...common, path: "/", maxAge: ACCESS_TTL_SECONDS });
    setCookie(c, refreshCookie(c), refresh, {
      ...common,
      path: REFRESH_PATH,
      maxAge: IDLE_MS / 1000,
    });
    return c.json({ user: publicUser(user), expires_in: ACCESS_TTL_SECONDS }, status);
  };

  const clearCookies = (c: Context) => {
    deleteCookie(c, accessCookie(c), { path: "/", secure: secure(c) });
    deleteCookie(c, refreshCookie(c), { path: REFRESH_PATH, secure: secure(c) });
  };

  /** Who's calling: from an access token (Bearer or cookie) whose session is live, or an API
   * token. Disabled users are nobody. A connected app's token (its audience the MCP server's)
   * counts only `forMcp`: a request on its way to the MCP server. */
  const caller = async (
    c: Context,
    { forMcp = false } = {}
  ): Promise<{ user: User; session?: Session } | undefined> => {
    const token = bearer(c) ?? cookie(c, ACCESS);
    if (!token) return undefined;
    if (token.startsWith(API_TOKEN_PREFIX)) {
      const id = apiTokens.check(token);
      const user = id ? users.get(id) : undefined;
      return user && !user.disabled_at ? { user } : undefined;
    }
    const claims = await keys.verify(token);
    if (!claims) return undefined;
    const session = sessions.get(claims.sid);
    const user = users.get(claims.sub);
    if (!sessions.live(session) || session.user_id !== claims.sub || !user || user.disabled_at)
      return undefined;
    if (claims.aud !== (session.audience ?? AUDIENCE)) return undefined;
    if (session.audience && !forMcp) return undefined;
    return { user, session };
  };

  /** Routes for anyone logged in (`session: true`: only with a login session, not an API
   * token: managing the account itself). */
  const loggedIn =
    ({ session = false } = {}) =>
    async (c: Context<Env>, next: Next) => {
      const found = await caller(c);
      if (!found) return problem(c, "not logged in", 401);
      if (session && !found.session) return problem(c, "log in to do this", 403);
      c.set("user", found.user);
      c.set("session", found.session);
      return next();
    };

  /** Check `password` against the user's, slowing down repeated failures. On success, a hash
   * made with older parameters is redone. A wrong password is a 401 when logging in, and a 403
   * when confirming a change while logged in (a 401 there would read as a lost session). */
  const checkPassword = async (
    c: Context,
    user: User | undefined,
    email: string,
    password: unknown,
    confirming = false
  ): Promise<"ok" | Response> => {
    const keys = [`account:${email.toLowerCase()}`, `ip:${clientIp(c)}`] as const;
    const wait = Math.max(accountFailures.wait(keys[0]), ipFailures.wait(keys[1]));
    if (wait > 0) {
      c.header("Retry-After", String(Math.ceil(wait / 1000)));
      return c.json(
        { detail: "too many tries: wait a little", retry_after: Math.ceil(wait / 1000) },
        429
      );
    }
    const stored = user && users.passwordHash(user.id);
    const ok =
      typeof password === "string" && (await verifyPassword(password, stored ?? (await decoy())));
    if (!ok || !stored) {
      accountFailures.fail(keys[0]);
      ipFailures.fail(keys[1]);
      return confirming
        ? problem(c, "wrong password", 403)
        : problem(c, "wrong email or password", 401);
    }
    accountFailures.succeed(keys[0]);
    if (needsRehash(stored)) users.setPassword(user.id, await hashPassword(password));
    return "ok";
  };

  // A hash to check against when there's no user, so a wrong email takes as long as a wrong
  // password.
  let decoyHash: Promise<string> | undefined;
  const decoy = () => (decoyHash ??= hashPassword(crypto.randomUUID()));

  const sendLink = async (user: User, purpose: "verify" | "reset", email = user.email) => {
    if (!mail) return;
    const secret = links.create(user.id, purpose, email);
    const link = `${mail.publicUrl.replace(/\/$/, "")}/ui/${purpose}/${secret}`;
    await mail.mailer
      .send({ to: email, ...emails[purpose](link) })
      .catch((error: unknown) => console.error(`couldn't send the ${purpose} email:`, error));
  };

  app.get("/config", (c) =>
    c.json({
      mail: !!mail,
      test_users: !!services.testUsers,
      service_mode: access.mode,
      signups_open: signupsOpen(access, users),
      password: { min_length: MIN_LENGTH, max_length: MAX_LENGTH },
    })
  );

  app.get("/.well-known/jwks.json", (c) => c.json(keys.jwks()));

  app.post("/signup", async (c) => {
    const { name, email, password, delivery } = await body(c);
    if (!signups.allow(clientIp(c)))
      return c.json({ detail: "too many sign-ups from here: try again later" }, 429);
    if (typeof name !== "string" || !name.trim() || name.trim().length > 100)
      return problem(c, "enter your name", 422);
    if (!isEmail(email)) return problem(c, "enter your email address", 422);
    if (!mayJoin(access, email)) return problem(c, PRIVATE_INSTANCE, 403);
    if (users.byEmail(email)) return problem(c, new EmailTaken().message, 422);
    const weak = await passwordProblem(password, email, breached);
    if (weak) return problem(c, weak, 422);
    let user: User;
    try {
      user = users.create(name.trim(), email, await hashPassword(password as string));
    } catch (error) {
      if (error instanceof EmailTaken) return problem(c, error.message, 422);
      throw error;
    }
    await sendLink(user, "verify");
    const { session, refresh } = sessions.start(
      user.id,
      PASSWORD,
      deviceLabel(c.req.header("user-agent"))
    );
    return deliver(c, user, session, refresh, delivery === "body", 201);
  });

  app.post("/login", async (c) => {
    const { email, password, delivery } = await body(c);
    if (services.testUsers && typeof email === "string" && email && password === undefined)
      return startSession(c, users.ensureTestUser(email), "test", delivery);
    if (typeof email !== "string" || !email) return problem(c, "enter your email address", 422);
    const user = users.byEmail(email);
    const checked = await checkPassword(c, user, email, password);
    if (checked !== "ok") return checked;
    if (user!.disabled_at) return problem(c, "this account has been disabled", 403);
    return startSession(c, user!, PASSWORD, delivery);
  });

  /** Trade a refresh token (the cookie, or `refresh_token` in the body) for new tokens. */
  app.post("/token", async (c) => {
    const fromBody = (await body(c)).refresh_token;
    const token = typeof fromBody === "string" ? fromBody : cookie(c, REFRESH);
    // A connected app's refresh token is traded at /oauth/token, for its own kind of token.
    const app = token ? sessions.get(sessions.ofRefreshToken(token) ?? "")?.client_id : undefined;
    const next = token && !app ? sessions.refresh(token) : undefined;
    const user = next && users.get(next.session.user_id);
    if (!next || !user || user.disabled_at) {
      clearCookies(c);
      return problem(c, "not logged in", 401);
    }
    return deliver(c, user, next.session, next.refresh, typeof fromBody === "string");
  });

  /** Log out: end the session the refresh token (or access token) belongs to. */
  app.post("/token/revoke", async (c) => {
    const fromBody = (await body(c)).refresh_token;
    const refresh = typeof fromBody === "string" ? fromBody : cookie(c, REFRESH);
    const sessionId =
      (refresh && sessions.ofRefreshToken(refresh)) ??
      (await keys.verify(bearer(c) ?? cookie(c, ACCESS), { ignoreExpiry: true }))?.sid;
    const session = sessionId ? sessions.get(sessionId) : undefined;
    if (session) sessions.end(session.user_id, session.id);
    clearCookies(c);
    return c.body(null, 204);
  });

  // Your account

  app.get("/me", loggedIn(), (c) => c.json(publicUser(c.get("user"))));

  app.patch("/me", loggedIn({ session: true }), async (c) => {
    const user = c.get("user");
    const { name, email, password, updated_at } = await body(c);
    if (typeof updated_at !== "string") return problem(c, "send the updated_at you read", 422);
    if (name !== undefined && (typeof name !== "string" || !name.trim() || name.length > 100))
      return problem(c, "enter your name", 422);
    const changingEmail =
      email !== undefined && String(email).trim().toLowerCase() !== user.email.toLowerCase();
    if (email !== undefined && !isEmail(email)) return problem(c, "enter an email address", 422);
    if (changingEmail) {
      const checked = await checkPassword(c, user, user.email, password, true);
      if (checked !== "ok") return checked;
    }
    try {
      const updated = users.update(
        user.id,
        {
          name: typeof name === "string" ? name.trim() : undefined,
          email: email as string | undefined,
        },
        updated_at
      );
      if (changingEmail) await sendLink(updated, "verify");
      return c.json(publicUser(updated));
    } catch (error) {
      if (error instanceof StaleVersion)
        return c.json({ detail: error.message, updated_at: error.current }, 409);
      if (error instanceof EmailTaken) return problem(c, error.message, 422);
      throw error;
    }
  });

  /** Change your password. Every other session ends. */
  app.post("/me/password", loggedIn({ session: true }), async (c) => {
    const user = c.get("user");
    const { current, password } = await body(c);
    const checked = await checkPassword(c, user, user.email, current, true);
    if (checked !== "ok") return checked;
    const weak = await passwordProblem(password, user.email, breached);
    if (weak) return problem(c, weak, 422);
    users.setPassword(user.id, await hashPassword(password as string));
    sessions.endAll(user.id, "password changed", c.get("session")!.id);
    return c.body(null, 204);
  });

  /** Delete your account, and every book you own. */
  app.delete("/me", loggedIn({ session: true }), async (c) => {
    const user = c.get("user");
    const checked = await checkPassword(c, user, user.email, (await body(c)).password, true);
    if (checked !== "ok") return checked;
    await services.deleteBooks(user.id);
    users.delete(user.id);
    clearCookies(c);
    return c.body(null, 204);
  });

  app.post("/me/verify-email", loggedIn({ session: true }), async (c) => {
    const user = c.get("user");
    if (!mail) return problem(c, "this server can't send email", 503);
    if (!user.email_verified_at) await sendLink(user, "verify");
    return c.body(null, 202);
  });

  app.get("/sessions", loggedIn({ session: true }), (c) =>
    c.json(
      sessions.list(c.get("user").id).map((s) => ({
        id: s.id,
        device: s.device,
        method: s.method,
        created_at: s.created_at,
        last_used_at: s.last_used_at,
        current: s.id === c.get("session")!.id,
        // A connected app's (OAuth): `device` is the app's name.
        app: s.client_id !== null,
      }))
    )
  );

  app.delete("/sessions/:id", loggedIn({ session: true }), (c) => {
    const id = c.req.param("id") ?? "";
    if (!sessions.end(c.get("user").id, id)) return problem(c, "not found", 404);
    if (id === c.get("session")!.id) clearCookies(c);
    return c.body(null, 204);
  });

  app.post("/sessions/end-others", loggedIn({ session: true }), (c) => {
    sessions.endAll(c.get("user").id, "logged out everywhere else", c.get("session")!.id);
    return c.body(null, 204);
  });

  app.get("/tokens", loggedIn({ session: true }), (c) => c.json(apiTokens.list(c.get("user").id)));

  app.post("/tokens", loggedIn({ session: true }), async (c) => {
    const { name, expires_in_days } = await body(c);
    if (typeof name !== "string" || !name.trim() || name.length > 100)
      return problem(c, "name the token", 422);
    if (
      expires_in_days !== undefined &&
      expires_in_days !== null &&
      !(Number.isInteger(expires_in_days) && (expires_in_days as number) > 0)
    )
      return problem(c, "expires_in_days is a whole number of days, or null", 422);
    const expires =
      typeof expires_in_days === "number"
        ? new Date(Date.now() + expires_in_days * DAY).toISOString()
        : null;
    return c.json(apiTokens.create(c.get("user").id, name.trim(), expires), 201);
  });

  app.delete("/tokens/:id", loggedIn({ session: true }), (c) =>
    apiTokens.revoke(c.get("user").id, c.req.param("id") ?? "")
      ? c.body(null, 204)
      : problem(c, "not found", 404)
  );

  // Forgotten passwords and email addresses

  /** Send a reset link, if the email has an account. The answer's the same either way. */
  app.post("/password/forgot", async (c) => {
    if (!mail)
      return problem(
        c,
        "this server can't send email: ask whoever runs it to make you a reset link",
        503
      );
    const { email } = await body(c);
    if (!isEmail(email)) return problem(c, "enter your email address", 422);
    if (!resets.allow(`ip:${clientIp(c)}`) || !resets.allow(`email:${email.toLowerCase()}`))
      return c.json({ detail: "too many requests: try again later" }, 429);
    const user = users.byEmail(email);
    if (user && !user.disabled_at) await sendLink(user, "reset");
    return c.body(null, 202);
  });

  /** Choose a new password with a reset link. Every session ends. */
  app.post("/password/reset", async (c) => {
    const { token, password } = await body(c);
    const userId = typeof token === "string" ? links.peek(token, "reset") : undefined;
    const user = userId ? users.get(userId) : undefined;
    if (!user) return problem(c, "this link has expired or was already used", 400);
    const weak = await passwordProblem(password, user.email, breached);
    if (weak) return problem(c, weak, 422);
    links.use(token as string, "reset");
    users.setPassword(user.id, await hashPassword(password as string));
    sessions.endAll(user.id, "password reset");
    return c.body(null, 204);
  });

  app.post("/email/verify", async (c) => {
    const { token } = await body(c);
    const used = typeof token === "string" ? links.use(token, "verify") : undefined;
    if (!used || !users.verify(used.user_id, used.email))
      return problem(c, "this link has expired or was already used", 400);
    return c.body(null, 204);
  });

  // OAuth for MCP clients (oauth.ts)

  /** Where the server is: the configured public URL, or what the request came in on. */
  const baseUrl = (c: Context) => {
    if (services.publicUrl) return services.publicUrl.replace(/\/$/, "");
    const proto = c.req.header("x-forwarded-proto") ?? new URL(c.req.url).protocol.slice(0, -1);
    const host = c.req.header("x-forwarded-host") ?? c.req.header("host");
    return `${proto}://${host}`;
  };
  const resourceOf = (c: Context) => `${baseUrl(c)}${MCP_PATH}`;
  const isMcp = (resource: string) => {
    try {
      return new URL(resource).pathname.replace(/\/$/, "") === MCP_PATH;
    } catch {
      return false;
    }
  };
  const resourceMetadata = (c: Context) =>
    `${baseUrl(c)}/.well-known/oauth-protected-resource${MCP_PATH}`;

  const protectedResource = (c: Context) =>
    c.json({
      resource: resourceOf(c),
      authorization_servers: [baseUrl(c)],
      bearer_methods_supported: ["header"],
      resource_name: "Luminous Money",
    });
  root.get(`/.well-known/oauth-protected-resource${MCP_PATH}`, protectedResource);
  root.get("/.well-known/oauth-protected-resource", protectedResource);
  root.get("/.well-known/oauth-authorization-server", (c) => {
    const base = baseUrl(c);
    return c.json({
      issuer: base,
      authorization_endpoint: `${base}/ui/authorize`,
      token_endpoint: `${base}${BASE}/oauth/token`,
      registration_endpoint: `${base}${BASE}/oauth/register`,
      revocation_endpoint: `${base}${BASE}/oauth/revoke`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      revocation_endpoint_auth_methods_supported: ["none"],
    });
  });

  /** An OAuth error (RFC 6749 §5.2), never cached. */
  const oauthError = (c: Context, error: string, description: string, status: 400 | 401 = 400) => {
    c.header("Cache-Control", "no-store");
    return c.json({ error, error_description: description }, status);
  };
  /** A form's fields, or JSON's: clients send either. */
  const fields = async (c: Context): Promise<Record<string, unknown>> => {
    if ((c.req.header("content-type") ?? "").includes("application/x-www-form-urlencoded"))
      return Object.fromEntries(new URLSearchParams(await c.req.text()));
    return body(c);
  };

  /** Dynamic client registration (RFC 7591): public clients, PKCE only. */
  app.post("/oauth/register", async (c) => {
    if (!registrations.allow(`register:${clientIp(c)}`))
      return oauthError(c, "invalid_client_metadata", "too many registrations from here");
    const meta = await body(c);
    const uris = meta.redirect_uris;
    if (!Array.isArray(uris) || !uris.length)
      return oauthError(c, "invalid_redirect_uri", "send at least one redirect URI");
    const bad = uris.map(redirectProblem).find((p) => p);
    if (bad) return oauthError(c, "invalid_redirect_uri", bad);
    const method = meta.token_endpoint_auth_method ?? "none";
    if (method !== "none")
      return oauthError(c, "invalid_client_metadata", "only public clients (PKCE, no secret)");
    const name =
      typeof meta.client_name === "string" && meta.client_name.trim()
        ? meta.client_name.trim().slice(0, 100)
        : new URL(uris[0] as string).host;
    const client = oauth.register(name, uris as string[]);
    return c.json(
      {
        client_id: client.id,
        client_name: client.name,
        redirect_uris: client.redirect_uris,
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
      },
      201
    );
  });

  /**
   * The consent (the PWA's /ui/authorize, as the logged-in user): without `decision`, checks the
   * request and says who's asking; with it, answers where to send the browser, with a code or
   * `access_denied`. A request whose client or redirect can't be trusted is a 400 to show, never
   * a redirect.
   */
  app.post("/oauth/authorize", loggedIn({ session: true }), async (c) => {
    const q = await body(c);
    const text = (key: string) => (typeof q[key] === "string" ? (q[key] as string) : "");
    const client = oauth.client(text("client_id"));
    if (!client) return problem(c, "this app isn't registered here: connect it again", 400);
    const redirect = text("redirect_uri");
    if (!redirectAllowed(client, redirect))
      return problem(c, "this app asked to return somewhere it didn't register", 400);
    const back = (params: Record<string, string>) => {
      const url = new URL(redirect);
      for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
      if (text("state")) url.searchParams.set("state", text("state"));
      url.searchParams.set("iss", baseUrl(c));
      return c.json({ redirect: url.href });
    };
    const refuse = (error: string, description: string) =>
      back({ error, error_description: description });
    if (text("response_type") !== "code")
      return refuse("unsupported_response_type", "only the code flow");
    if (text("code_challenge_method") !== "S256" || !/^[\w-]{43,128}$/.test(text("code_challenge")))
      return refuse("invalid_request", "PKCE with S256 is required");
    // The resource is the MCP server, as the client knows it: the address the user typed, which
    // a proxy in front may name differently from the request here (http behind https), so its
    // path is what's checked. Its tokens are bound to it either way.
    const resource = text("resource").replace(/\/$/, "") || resourceOf(c);
    if (!isMcp(resource)) return refuse("invalid_target", `the only resource here is ${MCP_PATH}`);
    if (q.decision === undefined)
      return c.json({ client_name: client.name, redirect_host: new URL(redirect).host });
    if (q.decision !== "allow") return refuse("access_denied", "the user said no");
    const code = oauth.code({
      client_id: client.id,
      user_id: c.get("user").id,
      redirect_uri: redirect,
      challenge: text("code_challenge"),
      resource,
    });
    return back({ code });
  });

  /** Codes and refresh tokens for tokens (RFC 6749 §3.2), form-encoded or JSON. */
  app.post("/oauth/token", async (c) => {
    const f = await fields(c);
    const text = (key: string) => (typeof f[key] === "string" ? (f[key] as string) : "");
    c.header("Cache-Control", "no-store");
    const answer = async (user: User, session: Session, refresh: string) =>
      c.json({
        access_token: await keys.sign({ sub: user.id, sid: session.id, aud: session.audience! }),
        token_type: "Bearer",
        expires_in: ACCESS_TTL_SECONDS,
        refresh_token: refresh,
      });

    if (text("grant_type") === "authorization_code") {
      const code = text("code");
      const grant = code ? oauth.use(code) : undefined;
      if (grant && "reused" in grant) {
        if (grant.reused) {
          const session = sessions.get(grant.reused);
          if (session) sessions.end(session.user_id, session.id, "authorization code reused");
        }
        return oauthError(c, "invalid_grant", "this code was already used");
      }
      if (!grant) return oauthError(c, "invalid_grant", "this code is unknown or expired");
      if (text("client_id") && text("client_id") !== grant.client_id)
        return oauthError(c, "invalid_grant", "this code is another client's");
      if (text("redirect_uri") !== grant.redirect_uri)
        return oauthError(c, "invalid_grant", "the redirect URI isn't the one authorized");
      if (!pkceMatches(text("code_verifier"), grant.challenge))
        return oauthError(c, "invalid_grant", "the code verifier doesn't match");
      if (text("resource") && text("resource").replace(/\/$/, "") !== grant.resource)
        return oauthError(c, "invalid_target", "the resource isn't the one authorized");
      const user = users.get(grant.user_id);
      const client = oauth.client(grant.client_id);
      if (!user || user.disabled_at || !client)
        return oauthError(c, "invalid_grant", "this account can't sign in");
      const { session, refresh } = sessions.start(user.id, "oauth", client.name, {
        clientId: client.id,
        audience: grant.resource,
      });
      oauth.traded(code, session.id);
      return answer(user, session, refresh);
    }

    if (text("grant_type") === "refresh_token") {
      const token = text("refresh_token");
      const owner = sessions.get(sessions.ofRefreshToken(token) ?? "");
      if (!owner?.client_id || (text("client_id") && text("client_id") !== owner.client_id))
        return oauthError(c, "invalid_grant", "this refresh token is unknown or another client's");
      const next = sessions.refresh(token);
      const user = next && users.get(next.session.user_id);
      if (!next || !user || user.disabled_at)
        return oauthError(c, "invalid_grant", "this refresh token has expired or was revoked");
      return answer(user, next.session, next.refresh);
    }

    return oauthError(c, "unsupported_grant_type", "authorization_code or refresh_token");
  });

  /** Revoke a token (RFC 7009): its session ends. The answer is the same for any token. */
  app.post("/oauth/revoke", async (c) => {
    const token = (await fields(c)).token;
    if (typeof token === "string") {
      const sessionId =
        sessions.ofRefreshToken(token) ?? (await keys.verify(token, { ignoreExpiry: true }))?.sid;
      const session = sessionId ? sessions.get(sessionId) : undefined;
      if (session?.client_id) sessions.end(session.user_id, session.id, "revoked by the app");
    }
    return c.body(null, 200);
  });

  // Traefik's check

  app.get("/verify", async (c) => {
    // On its way to the MCP server, a connected app's token counts, and a refusal says where to
    // sign in (MCP's authorization: RFC 9728's metadata).
    const forMcp = (c.req.header("x-forwarded-uri") ?? "").startsWith(`${MCP_PATH}`);
    const found = await caller(c, { forMcp });
    if (!found) {
      if (forMcp) c.header("WWW-Authenticate", `Bearer resource_metadata="${resourceMetadata(c)}"`);
      return problem(c, "not logged in", 401);
    }
    c.header("X-User-Id", found.user.id);
    // Who they are, for others sharing a book with them (M13); URI-encoded, as headers are ASCII.
    c.header("X-User-Name", encodeURIComponent(found.user.name));
    c.header("X-User-Email", encodeURIComponent(found.user.email));
    // Whether that email is confirmed: an admin is named by email, so only a confirmed one counts.
    c.header("X-User-Email-Verified", found.user.email_verified_at ? "true" : "false");
    return c.body(null, 200);
  });

  return root;
}
