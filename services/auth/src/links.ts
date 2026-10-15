/**
 * Single-use links, sent by email or printed by the operator's CLI: password resets (an hour,
 * or a day when the CLI makes one) and email verification (a week).
 */
import { now, type DatabaseSync } from "@fava-beans/db";

import { DAY, hashSecret, later, newSecret } from "./secrets.js";

export type Purpose = "reset" | "verify";

export const LIFETIME: Record<Purpose, number> = { reset: 60 * 60 * 1000, verify: 7 * DAY };

export class EmailLinks {
  constructor(private readonly db: DatabaseSync) {}

  /** A new link's secret. Earlier unused links for the same purpose stop working. */
  create(userId: string, purpose: Purpose, email: string, lifetime = LIFETIME[purpose]): string {
    const secret = newSecret();
    const stamp = now();
    this.db
      .prepare(
        "UPDATE email_link SET used_at = ?, updated_at = ? WHERE user_id = ? AND purpose = ? AND used_at IS NULL"
      )
      .run(stamp, stamp, userId, purpose);
    this.db
      .prepare(
        `INSERT INTO email_link (hash, user_id, purpose, email, expires_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(hashSecret(secret), userId, purpose, email, later(lifetime), stamp, stamp);
    return secret;
  }

  /** Who a valid link is for, without using it up. */
  peek(secret: string, purpose: Purpose): string | undefined {
    const row = this.db
      .prepare("SELECT * FROM email_link WHERE hash = ? AND purpose = ?")
      .get(hashSecret(secret), purpose) as
      { user_id: string; expires_at: string; used_at: string | null } | undefined;
    return row && !row.used_at && Date.parse(row.expires_at) > Date.now() ? row.user_id : undefined;
  }

  /** Use a link: who it's for (and which email), if it's valid. It can't be used again. */
  use(secret: string, purpose: Purpose): { user_id: string; email: string } | undefined {
    const row = this.db
      .prepare("SELECT * FROM email_link WHERE hash = ? AND purpose = ?")
      .get(hashSecret(secret), purpose) as
      { user_id: string; email: string; expires_at: string; used_at: string | null } | undefined;
    if (!row || row.used_at || Date.parse(row.expires_at) <= Date.now()) return undefined;
    const stamp = now();
    this.db
      .prepare("UPDATE email_link SET used_at = ?, updated_at = ? WHERE hash = ?")
      .run(stamp, stamp, hashSecret(secret));
    return { user_id: row.user_id, email: row.email };
  }
}
