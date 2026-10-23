/**
 * Users, and the identities they log in with. A user is a name and an email (unique, compared
 * case-insensitively); an identity is one way to prove you're them: a password now, OIDC
 * providers later. Nobody is special: there are no roles.
 */
import { createHash } from "node:crypto";

import { after, migrate, now, transaction, type DatabaseSync } from "@luminous-money/db";

import { MIGRATIONS } from "./schema.js";
import { newId } from "./secrets.js";

export type User = {
  id: string;
  name: string;
  email: string;
  email_verified_at: string | null;
  disabled_at: string | null;
  created_at: string;
  updated_at: string;
};

/** What the API shows of a user. */
export const publicUser = (u: User) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  email_verified: !!u.email_verified_at,
  updated_at: u.updated_at,
});

/** Before M8, every stack had this one user, logged in without a password. A stack that still
 * has its data hands it to a real account with `cli.js claim-stub`. */
export const STUB_USER_ID = "5ab0c1d2e3f4405a8b6c7d8e9f001122";

export const PASSWORD = "password";

export class EmailTaken extends Error {
  constructor() {
    super("an account with this email already exists");
  }
}

export class StaleVersion extends Error {
  constructor(readonly current: string) {
    super("this changed somewhere else");
  }
}

export const normalizeEmail = (email: string) => email.trim();

/** A plausible email address: something@something.something, no spaces. */
export const isEmail = (email: unknown): email is string =>
  typeof email === "string" && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

export class Users {
  constructor(private readonly db: DatabaseSync) {
    migrate(db, MIGRATIONS);
  }

  get(id: string): User | undefined {
    return this.db.prepare("SELECT * FROM user WHERE id = ?").get(id) as User | undefined;
  }

  byEmail(email: string): User | undefined {
    return this.db.prepare("SELECT * FROM user WHERE lower(email) = lower(?)").get(email.trim()) as
      User | undefined;
  }

  private emailFree(email: string, except?: string): boolean {
    const other = this.byEmail(email);
    return !other || other.id === except;
  }

  /** A new user who logs in with a password. */
  create(name: string, email: string, passwordHash: string): User {
    return transaction(this.db, () => {
      if (!this.emailFree(email)) throw new EmailTaken();
      const id = newId();
      const stamp = after(null);
      this.db
        .prepare(
          "INSERT INTO user (id, name, email, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
        )
        .run(id, name, normalizeEmail(email), stamp, stamp);
      this.setPassword(id, passwordHash);
      return this.get(id)!;
    });
  }

  /** The user's password hash, if they have a password. */
  passwordHash(userId: string): string | undefined {
    const row = this.db
      .prepare("SELECT secret FROM identity WHERE method = ? AND user_id = ?")
      .get(PASSWORD, userId) as { secret: string } | undefined;
    return row?.secret;
  }

  setPassword(userId: string, hash: string): void {
    const stamp = now();
    this.db
      .prepare(
        `INSERT INTO identity (id, user_id, method, subject, secret, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (method, subject) DO UPDATE SET secret = excluded.secret, updated_at = excluded.updated_at`
      )
      .run(newId(), userId, PASSWORD, userId, hash, stamp, stamp);
  }

  /** Change the name or email, against the version read. A new email isn't verified yet. */
  update(userId: string, changes: { name?: string; email?: string }, expected: string): User {
    return transaction(this.db, () => {
      const user = this.get(userId)!;
      if (user.updated_at !== expected) throw new StaleVersion(user.updated_at);
      const email = changes.email === undefined ? user.email : normalizeEmail(changes.email);
      if (!this.emailFree(email, userId)) throw new EmailTaken();
      const verified =
        email.toLowerCase() === user.email.toLowerCase() ? user.email_verified_at : null;
      this.db
        .prepare(
          "UPDATE user SET name = ?, email = ?, email_verified_at = ?, updated_at = ? WHERE id = ?"
        )
        .run(changes.name ?? user.name, email, verified, after(user.updated_at), userId);
      return this.get(userId)!;
    });
  }

  /** Mark `email` verified, if it's still the user's email. */
  verify(userId: string, email: string): boolean {
    const user = this.get(userId);
    if (!user || user.email.toLowerCase() !== email.toLowerCase()) return false;
    if (!user.email_verified_at)
      this.db
        .prepare("UPDATE user SET email_verified_at = ?, updated_at = ? WHERE id = ?")
        .run(now(), after(user.updated_at), userId);
    return true;
  }

  setDisabled(userId: string, disabled: boolean): void {
    const user = this.get(userId)!;
    this.db
      .prepare("UPDATE user SET disabled_at = ?, updated_at = ? WHERE id = ?")
      .run(disabled ? now() : null, after(user.updated_at), userId);
  }

  /** Delete the user and, with them, their identities, sessions, tokens and links. */
  delete(userId: string): void {
    this.db.prepare("DELETE FROM user WHERE id = ?").run(userId);
  }

  /** The user with `email`, created if new, with no password. Only for test stacks
   * (AUTH_TEST_USERS): it lets each test have a user of its own. */
  ensureTestUser(email: string): User {
    const existing = this.byEmail(email);
    if (existing) return existing;
    const id = createHash("sha256").update(email).digest("hex").slice(0, 32);
    const stamp = now();
    this.db
      .prepare("INSERT INTO user (id, name, email, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .run(id, email, email, stamp, stamp);
    return this.get(id)!;
  }

  /** Turn the pre-M8 stub user (and so its books) into a real account. */
  claimStub(name: string, email: string, passwordHash: string): User {
    return transaction(this.db, () => {
      const stub = this.get(STUB_USER_ID);
      if (!stub) throw new Error("there's no stub user here");
      if (this.passwordHash(STUB_USER_ID)) throw new Error("the stub has already been claimed");
      if (!this.emailFree(email, STUB_USER_ID)) throw new EmailTaken();
      this.db
        .prepare("UPDATE user SET name = ?, email = ?, updated_at = ? WHERE id = ?")
        .run(name, normalizeEmail(email), after(stub.updated_at), STUB_USER_ID);
      this.setPassword(STUB_USER_ID, passwordHash);
      return this.get(STUB_USER_ID)!;
    });
  }
}
