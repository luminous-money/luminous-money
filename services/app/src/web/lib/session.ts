/**
 * The session, with the auth service. Its tokens live in HttpOnly cookies the browser sends by
 * itself (a 10-minute access token, and a refresh token only `/token` ever sees), so the app
 * never handles them. It signs up, logs in and out, keeps the session fresh, and manages the
 * account.
 *
 * **Keeping fresh:** every API call goes through `apiFetch`. On a 401 it refreshes once and
 * retries; if refreshing fails, the session is over, and it says so (`LOGGED_OUT`) so the app
 * shows Log in, right where the user was. Refreshes run one at a time across tabs (a Web Lock),
 * since the refresh token rotates on every use. While the app is open it also refreshes ahead
 * of expiry (`keepFresh`), so plain links (exports) keep working.
 */
import { ApiError } from "./ledger.js";

export type User = {
  id: string;
  name: string;
  email: string;
  email_verified: boolean;
  updated_at: string;
};

export type AuthConfig = {
  mail: boolean;
  test_users: boolean;
  /** Who may sign up: anyone (public), or only the emails the server allows (private). */
  service_mode: "public" | "private";
  /** Whether anyone may still sign up: false once a private server's allowed emails all have
   * accounts. */
  signups_open: boolean;
  password: { min_length: number; max_length: number };
};

export type SessionInfo = {
  id: string;
  device: string;
  method: string;
  created_at: string;
  last_used_at: string;
  current: boolean;
};

export type ApiToken = {
  id: string;
  name: string;
  hint: string;
  created_at: string;
  expires_at: string | null;
  last_used_at: string | null;
};

const AUTH = "/api/auth/v1";

/** Fired when the session has ended and can't be refreshed. */
export const LOGGED_OUT = "luminous-money:logged-out";

let refreshing: Promise<boolean> | undefined;
let refreshedAt = Date.now();

/** Refresh the session's tokens: one refresh at a time in this tab, and across tabs. */
export function refresh(): Promise<boolean> {
  refreshing ??= (async () => {
    const run = async () => (await fetch(`${AUTH}/token`, { method: "POST" })).ok;
    try {
      const ok = navigator.locks
        ? await navigator.locks.request("luminous-money:refresh", run)
        : await run();
      if (ok) refreshedAt = Date.now();
      return ok;
    } catch {
      return false;
    } finally {
      refreshing = undefined;
    }
  })();
  return refreshing;
}

/** `fetch` for the APIs: on a 401, refresh once and retry; if that fails, the session is over. */
export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const retry = input instanceof Request ? input.clone() : input;
  const response = await fetch(input, init);
  if (response.status !== 401) return response;
  if (await refresh()) return fetch(retry, init);
  window.dispatchEvent(new Event(LOGGED_OUT));
  return response;
}

/** While the app is open, refresh before the access token runs out (it lasts ten minutes).
 * Returns the cleanup. */
export function keepFresh(): () => void {
  const due = () => Date.now() - refreshedAt > 8 * 60 * 1000;
  const tick = () => void (document.visibilityState === "visible" && due() && refresh());
  const timer = window.setInterval(tick, 60 * 1000);
  document.addEventListener("visibilitychange", tick);
  return () => {
    window.clearInterval(timer);
    document.removeEventListener("visibilitychange", tick);
  };
}

/** Call the auth API. `json` is the body; `own`: an account route, which refreshes like any API. */
async function call<T>(
  path: string,
  init: RequestInit & { json?: unknown; own?: boolean } = {}
): Promise<T> {
  const { json, own, ...rest } = init;
  const response = await (own ? apiFetch : fetch)(`${AUTH}${path}`, {
    ...rest,
    headers: json === undefined ? rest.headers : { "content-type": "application/json" },
    body: json === undefined ? rest.body : JSON.stringify(json),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { detail?: string };
    throw new ApiError(response.status, body.detail ?? `${response.status} ${response.statusText}`);
  }
  return (
    response.status === 204 || response.status === 202 ? undefined : await response.json()
  ) as T;
}

/** Who's logged in, or null for nobody. */
export async function me(): Promise<User | null> {
  const response = await apiFetch(`${AUTH}/me`);
  if (response.status === 401) return null;
  if (!response.ok) throw new ApiError(response.status, "couldn't check the session");
  return (await response.json()) as User;
}

export const authConfig = () => call<AuthConfig>("/config");

export async function signUp(input: {
  name: string;
  email: string;
  password: string;
}): Promise<User> {
  return (await call<{ user: User }>("/signup", { method: "POST", json: input })).user;
}

export async function logIn(input: { email: string; password: string }): Promise<User> {
  return (await call<{ user: User }>("/login", { method: "POST", json: input })).user;
}

export async function logOut(): Promise<void> {
  await fetch(`${AUTH}/token/revoke`, { method: "POST" });
}

export const forgotPassword = (email: string) =>
  call<void>("/password/forgot", { method: "POST", json: { email } });

export const resetPassword = (token: string, password: string) =>
  call<void>("/password/reset", { method: "POST", json: { token, password } });

export const verifyEmail = (token: string) =>
  call<void>("/email/verify", { method: "POST", json: { token } });

// Your account

export const account = {
  update: (changes: { name?: string; email?: string; password?: string; updated_at: string }) =>
    call<User>("/me", { method: "PATCH", json: changes, own: true }),
  changePassword: (current: string, password: string) =>
    call<void>("/me/password", { method: "POST", json: { current, password }, own: true }),
  resendVerification: () => call<void>("/me/verify-email", { method: "POST", own: true }),
  delete: (password: string) =>
    call<void>("/me", { method: "DELETE", json: { password }, own: true }),
  sessions: () => call<SessionInfo[]>("/sessions", { own: true }),
  endSession: (id: string) =>
    call<void>(`/sessions/${encodeURIComponent(id)}`, { method: "DELETE", own: true }),
  endOthers: () => call<void>("/sessions/end-others", { method: "POST", own: true }),
  tokens: () => call<ApiToken[]>("/tokens", { own: true }),
  createToken: (name: string, expiresInDays: number | null) =>
    call<{ token: ApiToken; secret: string }>("/tokens", {
      method: "POST",
      json: { name, expires_in_days: expiresInDays },
      own: true,
    }),
  revokeToken: (id: string) =>
    call<void>(`/tokens/${encodeURIComponent(id)}`, { method: "DELETE", own: true }),
};
