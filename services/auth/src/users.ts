/**
 * The user store. For M1 there's exactly one user, the stub, created on startup; logging in
 * always yields that user. M10 adds real accounts and credentials without moving anything.
 */
import { createHash } from "node:crypto";

import {
  after,
  createTable,
  migrate,
  now,
  type DatabaseSync,
  type Migration,
} from "@fava-beans/db";

export type User = {
  id: string;
  name: string;
  email: string;
  created_at: string;
  updated_at: string;
};

export const STUB_USER = {
  id: "5ab0c1d2e3f4405a8b6c7d8e9f001122",
  name: "You",
  email: "you@fava-beans.local",
};

export const MIGRATIONS: Migration[] = [
  [
    createTable("user", [
      "id TEXT PRIMARY KEY",
      "name TEXT NOT NULL",
      "email TEXT NOT NULL UNIQUE",
    ]),
  ],
];

export class Users {
  constructor(private readonly db: DatabaseSync) {
    migrate(db, MIGRATIONS);
  }

  /** Make sure the stub user exists. Idempotent. */
  ensureStub(): User {
    const existing = this.get(STUB_USER.id);
    if (existing) return existing;
    const stamp = now();
    this.db
      .prepare("INSERT INTO user (id, name, email, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .run(STUB_USER.id, STUB_USER.name, STUB_USER.email, stamp, after(null));
    return this.get(STUB_USER.id)!;
  }

  /** The user with `email`, created if new. Only for test stacks (AUTH_TEST_USERS): it lets
   * each test have a user of its own. */
  ensureTestUser(email: string): User {
    const existing = this.db.prepare("SELECT * FROM user WHERE email = ?").get(email) as
      User | undefined;
    if (existing) return existing;
    const id = createHash("sha256").update(email).digest("hex").slice(0, 32);
    const stamp = now();
    this.db
      .prepare("INSERT INTO user (id, name, email, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .run(id, email, email, stamp, stamp);
    return this.get(id)!;
  }

  get(id: string): User | undefined {
    return this.db.prepare("SELECT * FROM user WHERE id = ?").get(id) as User | undefined;
  }
}
