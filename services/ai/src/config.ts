/**
 * Every setting `ai` reads, in one place (`@wymp/config-simple`), checked at boot: a missing or
 * malformed value stops the service with a list of what's wrong. `APP_ENV` picks `.env/<APP_ENV>`
 * (and `.env/local` overrides it); real environment variables override both.
 */
import { existsSync } from "node:fs";

import { configValue, REQUIRED, validate, Validators, type ConfigError } from "@wymp/config-simple";
import * as dotenv from "dotenv";

import { PROVIDERS, type ProviderName } from "@fava-beans/ai-api";

export const ENVS = ["production", "development", "test"] as const;
export type Env = (typeof ENVS)[number];

const env = configValue("APP_ENV", "production", Validators.oneOf([...ENVS])) as Env | ConfigError;
for (const file of [".env/local", `.env/${env}`])
  if (existsSync(file)) dotenv.config({ path: file, quiet: true });

/** A 256-bit key, base64. */
const key256 = (value: string | undefined) =>
  value === undefined || Buffer.from(value, "base64").length === 32
    ? undefined
    : "must be 32 random bytes, base64 (e.g. `openssl rand -base64 32`)";

const providers = (value: string | undefined) =>
  (value ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)
    .every((p) => (PROVIDERS as readonly string[]).includes(p))
    ? undefined
    : `providers are a comma-separated list of ${PROVIDERS.join(", ")}`;

const configDef = {
  env,
  port: configValue("PORT", "num", 3000),
  dataDir: configValue("AI_DATA_DIR", "str", "/data"),
  ledgerUrl: configValue("LEDGER_URL", "str", "http://ledger:8000"),
  /** Encrypts each book's provider credential. No default: `ai` won't start without it. */
  encryptionKey: configValue("AI_ENCRYPTION_KEY", "str", REQUIRED, key256),
  /** The providers offered: `claude`, and `fake` (test stacks only). */
  providers: configValue("AI_PROVIDERS", "str", "claude", providers),
  /** Claude's model for reading receipts. */
  claudeModel: configValue("AI_CLAUDE_MODEL", "str", "claude-opus-5"),
};

const checked = validate(configDef);
export const config = {
  ...checked,
  providers: checked.providers
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean) as ProviderName[],
};
export type Config = typeof config;
