/**
 * `auth.sqlite`'s schema. Secrets (refresh tokens, API tokens, email links) are stored only as
 * SHA-256 hashes, so a copy of the database can't be used to log in; passwords as Argon2id
 * hashes. How someone proves who they are (`identity`) is kept apart from who they are
 * (`user`), so OIDC providers can be added as identities next to passwords.
 */
import { createTable, type Migration } from "@luminous-money/db";

export const MIGRATIONS: Migration[] = [
  // 1: users (M1: the stub, and test users).
  [
    createTable("user", [
      "id TEXT PRIMARY KEY",
      "name TEXT NOT NULL",
      "email TEXT NOT NULL UNIQUE",
    ]),
  ],
  // 2: real accounts (M8).
  [
    "ALTER TABLE user ADD COLUMN email_verified_at TEXT",
    "ALTER TABLE user ADD COLUMN disabled_at TEXT",
    "CREATE UNIQUE INDEX user_email ON user(lower(email))",
    // A way to log in: `password` (subject: the user's ID; secret: the Argon2id hash), and later
    // `oidc:<issuer>` (subject: the provider's `sub`).
    createTable(
      "identity",
      [
        "id TEXT PRIMARY KEY",
        "user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE",
        "method TEXT NOT NULL",
        "subject TEXT NOT NULL",
        "secret TEXT",
      ],
      ["UNIQUE (method, subject)"]
    ),
    "CREATE INDEX identity_user ON identity(user_id)",
    // A login on one device: a family of refresh tokens.
    createTable("session", [
      "id TEXT PRIMARY KEY",
      "user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE",
      "method TEXT NOT NULL",
      "device TEXT NOT NULL",
      "last_used_at TEXT NOT NULL",
      "expires_at TEXT NOT NULL", // the absolute limit; idle expiry is from last_used_at
      "ended_at TEXT",
      "end_reason TEXT",
    ]),
    "CREATE INDEX session_user ON session(user_id)",
    createTable("refresh_token", [
      "hash TEXT PRIMARY KEY",
      "session_id TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE",
      "used_at TEXT",
    ]),
    "CREATE INDEX refresh_token_session ON refresh_token(session_id)",
    createTable("api_token", [
      "id TEXT PRIMARY KEY",
      "user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE",
      "name TEXT NOT NULL",
      "hash TEXT NOT NULL UNIQUE",
      "hint TEXT NOT NULL", // the token's last characters, to tell tokens apart
      "expires_at TEXT",
      "last_used_at TEXT",
    ]),
    "CREATE INDEX api_token_user ON api_token(user_id)",
    // Ed25519 keys signing access tokens. The newest unretired one signs; retired ones still
    // verify until their tokens have expired.
    createTable("signing_key", [
      "kid TEXT PRIMARY KEY",
      "private_jwk TEXT NOT NULL",
      "public_jwk TEXT NOT NULL",
      "retired_at TEXT",
    ]),
    // Single-use links sent by email (or printed by the CLI): password resets, email checks.
    createTable("email_link", [
      "hash TEXT PRIMARY KEY",
      "user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE",
      "purpose TEXT NOT NULL", // 'reset' | 'verify'
      "email TEXT NOT NULL",
      "expires_at TEXT NOT NULL",
      "used_at TEXT",
    ]),
  ],
];
