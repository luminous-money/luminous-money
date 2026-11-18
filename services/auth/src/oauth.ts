/**
 * OAuth 2.1 for MCP clients (the MCP server milestone): Claude and the like sign in to the
 * `mcp` service as a user, with the user's consent.
 *
 * - **Clients register themselves** (RFC 7591): public clients only, no secret, so every
 *   authorization needs PKCE (S256). A redirect URI is `https`, or a loopback address (a client
 *   on the user's own machine), whose port may change from one sign-in to the next (RFC 8252).
 * - **An authorization code** is single use and lives five minutes; only its hash is kept. One
 *   used twice ends the session it was traded for (RFC 6749 §4.1.2).
 * - **What it's traded for is a session** like a browser's (sessions.ts), with the client and
 *   the resource its access tokens are for on it.
 */
import { createHash } from "node:crypto";

import { after, now, transaction, type DatabaseSync } from "@luminous-money/db";

import { hashSecret, later, newId, newSecret } from "./secrets.js";

export const CODE_TTL_MS = 5 * 60_000;

export type OAuthClient = { id: string; name: string; redirect_uris: string[] };

export type CodeGrant = {
  client_id: string;
  user_id: string;
  redirect_uri: string;
  challenge: string;
  resource: string;
};

type ClientRow = { id: string; name: string; redirect_uris: string };
type CodeRow = CodeGrant & {
  expires_at: string;
  used_at: string | null;
  session_id: string | null;
};

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Why a redirect URI can't be registered, or null if it can. */
export function redirectProblem(uri: unknown): string | null {
  if (typeof uri !== "string") return "a redirect URI is a string";
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return `${uri} isn't a URL`;
  }
  if (url.hash) return "a redirect URI has no fragment";
  if (url.protocol === "https:") return null;
  if (url.protocol === "http:" && LOOPBACK.has(url.hostname)) return null;
  return "a redirect URI is https, or http on localhost";
}

/** Whether `uri` is one of the client's: exactly, or a loopback one on any port. */
export function redirectAllowed(client: OAuthClient, uri: string): boolean {
  if (client.redirect_uris.includes(uri)) return true;
  let asked: URL;
  try {
    asked = new URL(uri);
  } catch {
    return false;
  }
  if (asked.protocol !== "http:" || !LOOPBACK.has(asked.hostname)) return false;
  return client.redirect_uris.some((registered) => {
    const url = new URL(registered);
    url.port = asked.port;
    return url.href === asked.href;
  });
}

/** PKCE's check: the verifier hashes (S256) to the challenge. */
export function pkceMatches(verifier: string, challenge: string): boolean {
  return createHash("sha256").update(verifier).digest("base64url") === challenge;
}

export class OAuth {
  constructor(private readonly db: DatabaseSync) {}

  register(name: string, redirectUris: string[]): OAuthClient {
    const id = `lmc_${newId()}`;
    const stamp = after(null);
    this.db
      .prepare(
        "INSERT INTO oauth_client (id, name, redirect_uris, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
      )
      .run(id, name, JSON.stringify(redirectUris), stamp, stamp);
    return this.client(id)!;
  }

  client(id: string): OAuthClient | undefined {
    const row = this.db.prepare("SELECT * FROM oauth_client WHERE id = ?").get(id) as
      ClientRow | undefined;
    return row && { id: row.id, name: row.name, redirect_uris: JSON.parse(row.redirect_uris) };
  }

  /** A new authorization code for the grant. */
  code(grant: CodeGrant): string {
    const code = newSecret();
    const stamp = now();
    this.db
      .prepare(
        `INSERT INTO oauth_code (hash, client_id, user_id, redirect_uri, challenge, resource,
           expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        hashSecret(code),
        grant.client_id,
        grant.user_id,
        grant.redirect_uri,
        grant.challenge,
        grant.resource,
        later(CODE_TTL_MS),
        stamp,
        stamp
      );
    return code;
  }

  /**
   * Use a code: its grant, once, while it's fresh. A code used before answers `reused` with the
   * session it was traded for, which the caller ends; an unknown or expired one, undefined.
   */
  use(code: string, at = Date.now()): CodeGrant | { reused: string | null } | undefined {
    return transaction(this.db, () => {
      const hash = hashSecret(code);
      const row = this.db.prepare("SELECT * FROM oauth_code WHERE hash = ?").get(hash) as
        CodeRow | undefined;
      if (!row) return undefined;
      if (row.used_at) return { reused: row.session_id };
      if (Date.parse(row.expires_at) <= at) return undefined;
      const stamp = now();
      this.db
        .prepare("UPDATE oauth_code SET used_at = ?, updated_at = ? WHERE hash = ?")
        .run(stamp, stamp, hash);
      // Codes long past aren't kept.
      this.db.prepare("DELETE FROM oauth_code WHERE expires_at < ?").run(later(-CODE_TTL_MS, at));
      const { client_id, user_id, redirect_uri, challenge, resource } = row;
      return { client_id, user_id, redirect_uri, challenge, resource };
    });
  }

  /** Note the session a code was traded for, so a second use can end it. */
  traded(code: string, sessionId: string): void {
    this.db
      .prepare("UPDATE oauth_code SET session_id = ?, updated_at = ? WHERE hash = ?")
      .run(sessionId, now(), hashSecret(code));
  }
}
