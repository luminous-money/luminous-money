/**
 * The session, with the auth service. The token lives in an HttpOnly cookie the browser sends by
 * itself, so all the app does is ask who's logged in, log in, and log out.
 */
import { ApiError } from "./ledger.js";

export type User = { id: string; name: string; email: string };

/** Who's logged in, or null for nobody. */
export async function me(): Promise<User | null> {
  const response = await fetch("/api/auth/v1/me");
  if (response.status === 401) return null;
  if (!response.ok) throw new ApiError(response.status, "couldn't check the session");
  return (await response.json()) as User;
}

/** Log in. For now this always logs in the one stub user (see M8 for real accounts). */
export async function logIn(): Promise<User> {
  const response = await fetch("/api/auth/v1/login", { method: "POST" });
  if (!response.ok) throw new ApiError(response.status, "couldn't log in");
  return ((await response.json()) as { user: User }).user;
}

export async function logOut(): Promise<void> {
  await fetch("/api/auth/v1/logout", { method: "POST" });
}
