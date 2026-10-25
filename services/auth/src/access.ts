/**
 * Who may create an account (`LM_SERVICE_MODE`): on a `public` server, anyone; on a
 * `private` one, only the emails in `LM_ALLOWED_EMAILS` (comma-separated, in any
 * case). Once every allowed email has an account, sign-ups are closed, and the PWA says it's a
 * private instance instead of offering one. Accounts already made stay, whatever the list says.
 */
import type { Users } from "./users.js";

export const SERVICE_MODES = ["public", "private"] as const;
export type ServiceMode = (typeof SERVICE_MODES)[number];

export type Access = { mode: ServiceMode; allowed: string[] };

export const PUBLIC: Access = { mode: "public", allowed: [] };

/** What anyone else trying to sign up on a private server is told. */
export const PRIVATE_INSTANCE =
  "This is a private instance: request access from the server administrator.";

/** The allowlist as configured: each address trimmed and lowercased, once. */
export function allowList(text: string | undefined): string[] {
  const emails = (text ?? "").split(",").map((e) => e.trim().toLowerCase());
  return [...new Set(emails.filter(Boolean))];
}

/** Whether `email` may create an account here. */
export const mayJoin = (access: Access, email: string) =>
  access.mode === "public" || access.allowed.includes(email.trim().toLowerCase());

/** Whether sign-ups are open: always on a public server; on a private one, while an allowed
 * email has no account yet. */
export const signupsOpen = (access: Access, users: Users) =>
  access.mode === "public" || access.allowed.some((email) => !users.byEmail(email));
