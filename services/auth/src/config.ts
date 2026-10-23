/**
 * Every setting `auth` reads, in one place (`@wymp/config-simple`), checked at boot: a missing or
 * malformed value stops the service with a list of what's wrong.
 *
 * `APP_ENV` (production, development or test; default production) picks `.env/<APP_ENV>`, and
 * `.env/local` (not committed) overrides it; real environment variables override both. Only
 * production-safe values have defaults here; anything else comes from the environment's file or
 * the environment itself.
 */
import { existsSync } from "node:fs";

import { configValue, validate, Validators, type ConfigError } from "@wymp/config-simple";
import * as dotenv from "dotenv";

export const ENVS = ["production", "development", "test"] as const;
export type Env = (typeof ENVS)[number];

const env = configValue("APP_ENV", "production", Validators.oneOf([...ENVS])) as Env | ConfigError;
for (const file of [".env/local", `.env/${env}`])
  if (existsSync(file)) dotenv.config({ path: file, quiet: true });

const configDef = {
  env,
  port: configValue("PORT", "num", 3000),
  dataDir: configValue("AUTH_DATA_DIR", "str", "/data"),
  /** Deleting an account deletes its books, through these. */
  ledgerUrl: configValue("LEDGER_URL", "str", "http://ledger:8000"),
  appUrl: configValue("APP_URL", "str", "http://app:3000"),
  /** Email (optional): password resets and confirming addresses, with links to `publicUrl`. */
  mail: {
    smtpUrl: configValue("SMTP_URL", "str"),
    from: configValue("MAIL_FROM", "str"),
  },
  publicUrl: configValue("LUMINOUS_MONEY_PUBLIC_URL", "str"),
  breachedPasswords: configValue("AUTH_BREACHED_PASSWORDS", "bool", true),
  signupsPerHour: configValue("AUTH_SIGNUPS_PER_HOUR", "num", 20),
  /** Test stacks only: log in by email alone. */
  testUsers: configValue("AUTH_TEST_USERS", "bool", false),
};

export const config = validate(configDef);
export type Config = typeof config;
