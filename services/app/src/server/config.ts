/**
 * Every setting `app` reads, in one place (`@wymp/config-simple`), checked at boot: a missing or
 * malformed value stops the service with a list of what's wrong.
 *
 * `APP_ENV` (production, development or test; default production) picks `.env/<APP_ENV>`, and
 * `.env/local` (not committed) overrides it; real environment variables override both. Only
 * production-safe values have defaults here; anything else comes from the environment's file or
 * the environment itself.
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  configValue,
  REQUIRED,
  validate,
  Validators,
  type ConfigError,
} from "@wymp/config-simple";
import * as dotenv from "dotenv";

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

const configDef = {
  env,
  port: configValue("PORT", "num", 3000),
  dataDir: configValue("APP_DATA_DIR", "str", "/data"),
  webRoot: configValue("WEB_ROOT", "str", fileURLToPath(new URL("../web", import.meta.url))),
  ledgerUrl: configValue("LEDGER_URL", "str", "http://ledger:8000"),
  /** External categorization providers, a JSON list (docs/categorizer-api.md). */
  categorizers: configValue("CATEGORIZERS", "str"),
  simplefin: {
    /** Encrypts stored SimpleFIN access URLs. No default: `app` won't start without it. */
    encryptionKey: configValue("SIMPLEFIN_ENCRYPTION_KEY", "str", REQUIRED, key256),
    /** The only hosts a setup token or access URL may point to. */
    hosts: configValue("SIMPLEFIN_HOSTS", "str", "bridge.simplefin.org,beta-bridge.simplefin.org")
      .split(",")
      .map((h) => h.trim())
      .filter(Boolean),
    /** Test stacks only: allow plain HTTP and private addresses (the fake SimpleFIN server). */
    allowInsecure: configValue("SIMPLEFIN_ALLOW_INSECURE", "bool", false),
  },
};

export const config = validate(configDef);
export type Config = typeof config;
