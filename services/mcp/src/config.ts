/**
 * Every setting `mcp` reads, in one place (`@wymp/config-simple`), checked at boot: a missing or
 * malformed value stops the service with a list of what's wrong. `APP_ENV` picks `.env/<APP_ENV>`
 * (and `.env/local` overrides it); real environment variables override both.
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
  ledgerUrl: configValue("LEDGER_URL", "str", "http://ledger:8000"),
  appUrl: configValue("APP_URL", "str", "http://app:3000"),
  /** How long a session nobody uses is kept, in hours. */
  idleHours: configValue("MCP_SESSION_IDLE_HOURS", "num", 12),
};

export const config = validate(configDef);
export type Config = typeof config;
