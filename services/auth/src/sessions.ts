/**
 * Sessions and the tokens that keep them going.
 *
 * - **A session is a login on one device:** a family of refresh tokens. It ends after 60 days
 *   unused or a year after login, whichever is first, or when it's ended (logging out, "log out
 *   everywhere else", a password change or reset, a refresh token used twice).
 * - **Refresh tokens rotate on every use.** One used again later than `GRACE_MS` after it was
 *   first used is a stolen copy (or the copy a thief already used), and ends the whole session.
 *   Within the grace, a second use gets a fresh token too, so two tabs refreshing at once don't
 *   log the user out.
 * - **API tokens** are long-lived bearer tokens for scripts, named, optionally expiring.
 */
import { after, now, transaction, type DatabaseSync } from "@luminous-money/db";

import { DAY, hashSecret, later, newId, newSecret } from "./secrets.js";

export const IDLE_MS = 60 * DAY;
export const MAX_AGE_MS = 365 * DAY;
export const GRACE_MS = 10_000;
export const API_TOKEN_PREFIX = "lm_";

export type Session = {
  id: string;
  user_id: string;
  method: string;
  device: string;
  created_at: string;
  last_used_at: string;
  expires_at: string;
  ended_at: string | null;
  end_reason: string | null;
  updated_at: string;
};

export type ApiToken = {
  id: string;
  name: string;
  hint: string;
  created_at: string;
  expires_at: string | null;
  last_used_at: string | null;
};

const ms = (stamp: string) => Date.parse(stamp);

/** A short description of the device a session is on, from its user agent. */
export function deviceLabel(userAgent: string | undefined): string {
  const ua = userAgent ?? "";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Firefox\//.test(ua)
      ? "Firefox"
      : /Chrome\//.test(ua)
        ? "Chrome"
        : /Safari\//.test(ua)
          ? "Safari"
          : undefined;
  const os = /iPhone|iPad/.test(ua)
    ? "iOS"
    : /Android/.test(ua)
      ? "Android"
      : /Mac OS X/.test(ua)
        ? "macOS"
        : /Windows/.test(ua)
          ? "Windows"
          : /Linux/.test(ua)
            ? "Linux"
            : undefined;
  if (browser && os) return `${browser} on ${os}`;
  return browser ?? os ?? (ua.split(/[ /]/)[0] || "Unknown device");
}

export class Sessions {
  constructor(private readonly db: DatabaseSync) {}

  /** Start a session; returns it and its first refresh token. */
  start(userId: string, method: string, device: string): { session: Session; refresh: string } {
    const id = newId();
    const stamp = after(null);
    return transaction(this.db, () => {
      this.db
        .prepare(
          `INSERT INTO session (id, user_id, method, device, last_used_at, expires_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(id, userId, method, device, stamp, later(MAX_AGE_MS), stamp, stamp);
      return { session: this.get(id)!, refresh: this.issue(id) };
    });
  }

  private issue(sessionId: string): string {
    const token = newSecret();
    const stamp = now();
    this.db
      .prepare(
        "INSERT INTO refresh_token (hash, session_id, created_at, updated_at) VALUES (?, ?, ?, ?)"
      )
      .run(hashSecret(token), sessionId, stamp, stamp);
    return token;
  }

  get(id: string): Session | undefined {
    return this.db.prepare("SELECT * FROM session WHERE id = ?").get(id) as Session | undefined;
  }

  /** Whether the session can still be used: not ended, not idle too long, not too old. */
  live(session: Session | undefined, at = Date.now()): session is Session {
    return (
      !!session &&
      !session.ended_at &&
      ms(session.expires_at) > at &&
      ms(session.last_used_at) + IDLE_MS > at
    );
  }

  /**
   * Trade a refresh token for its session and the next refresh token. Undefined if the token is
   * unknown or its session is over; a token reused after the grace ends its session.
   */
  refresh(token: string, at = Date.now()): { session: Session; refresh: string } | undefined {
    return transaction(this.db, () => {
      const row = this.db
        .prepare("SELECT * FROM refresh_token WHERE hash = ?")
        .get(hashSecret(token)) as { session_id: string; used_at: string | null } | undefined;
      if (!row) return undefined;
      const session = this.get(row.session_id);
      if (!this.live(session, at)) return undefined;
      if (row.used_at && ms(row.used_at) + GRACE_MS < at) {
        this.endOne(session.id, "refresh token reused");
        return undefined;
      }
      const stamp = now();
      if (!row.used_at)
        this.db
          .prepare("UPDATE refresh_token SET used_at = ?, updated_at = ? WHERE hash = ?")
          .run(stamp, stamp, hashSecret(token));
      this.db
        .prepare("UPDATE session SET last_used_at = ?, updated_at = ? WHERE id = ?")
        .run(stamp, after(session.updated_at), session.id);
      // Spent tokens are kept to catch reuse, but not forever: an older one is just unknown.
      this.db
        .prepare("DELETE FROM refresh_token WHERE session_id = ? AND used_at < ?")
        .run(session.id, later(-DAY, at));
      return { session: this.get(session.id)!, refresh: this.issue(session.id) };
    });
  }

  /** The session a refresh token belongs to, without using it. */
  ofRefreshToken(token: string): string | undefined {
    const row = this.db
      .prepare("SELECT session_id FROM refresh_token WHERE hash = ?")
      .get(hashSecret(token)) as { session_id: string } | undefined;
    return row?.session_id;
  }

  /** The user's sessions that are still live, most recently used first. */
  list(userId: string): Session[] {
    return (
      this.db
        .prepare(
          "SELECT * FROM session WHERE user_id = ? AND ended_at IS NULL ORDER BY last_used_at DESC"
        )
        .all(userId) as Session[]
    ).filter((s) => this.live(s));
  }

  private endOne(id: string, reason: string): void {
    const stamp = now();
    this.db
      .prepare(
        "UPDATE session SET ended_at = ?, end_reason = ?, updated_at = ? WHERE id = ? AND ended_at IS NULL"
      )
      .run(stamp, reason, stamp, id);
  }

  /** End one of the user's sessions. False if it isn't theirs. */
  end(userId: string, id: string, reason = "logged out"): boolean {
    if (this.get(id)?.user_id !== userId) return false;
    this.endOne(id, reason);
    return true;
  }

  /** End all the user's sessions, but `except`. */
  endAll(userId: string, reason: string, except?: string): void {
    const stamp = now();
    this.db
      .prepare(
        `UPDATE session SET ended_at = ?, end_reason = ?, updated_at = ?
         WHERE user_id = ? AND ended_at IS NULL AND id IS NOT ?`
      )
      .run(stamp, reason, stamp, userId, except ?? null);
  }
}

export class ApiTokens {
  constructor(private readonly db: DatabaseSync) {}

  /** A new token; its secret is returned only now. */
  create(
    userId: string,
    name: string,
    expiresAt: string | null
  ): { token: ApiToken; secret: string } {
    const secret = newSecret(API_TOKEN_PREFIX);
    const id = newId();
    const stamp = now();
    this.db
      .prepare(
        `INSERT INTO api_token (id, user_id, name, hash, hint, expires_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, userId, name, hashSecret(secret), secret.slice(-4), expiresAt, stamp, stamp);
    return { token: this.list(userId).find((t) => t.id === id)!, secret };
  }

  list(userId: string): ApiToken[] {
    return this.db
      .prepare(
        `SELECT id, name, hint, created_at, expires_at, last_used_at FROM api_token
         WHERE user_id = ? ORDER BY created_at`
      )
      .all(userId) as ApiToken[];
  }

  revoke(userId: string, id: string): boolean {
    return (
      this.db.prepare("DELETE FROM api_token WHERE id = ? AND user_id = ?").run(id, userId)
        .changes > 0
    );
  }

  /** The user a valid token belongs to. Records its use (at most once a minute). */
  check(secret: string): string | undefined {
    const row = this.db
      .prepare("SELECT id, user_id, expires_at, last_used_at FROM api_token WHERE hash = ?")
      .get(hashSecret(secret)) as
      | { id: string; user_id: string; expires_at: string | null; last_used_at: string | null }
      | undefined;
    if (!row || (row.expires_at && ms(row.expires_at) <= Date.now())) return undefined;
    if (!row.last_used_at || ms(row.last_used_at) + 60_000 < Date.now()) {
      const stamp = now();
      this.db
        .prepare("UPDATE api_token SET last_used_at = ?, updated_at = ? WHERE id = ?")
        .run(stamp, stamp, row.id);
    }
    return row.user_id;
  }
}
