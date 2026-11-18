/**
 * A tool: what it's called, its domain (the skill to load first), what it takes, and what it
 * does with the ledger's and `app`'s APIs as the user.
 *
 * Names say what a tool does, so a client can grant by kind (`read_*`): `read_` changes nothing,
 * `write_` adds or changes, `delete_` removes. MCP's annotations say the same.
 */
import type { JsonSchema } from "./schemas.js";
import type { Api } from "./upstream.js";

export const DOMAINS = [
  "base",
  "review",
  "accounts",
  "budgets",
  "reports",
  "funds",
  "investments",
  "loans",
  "schedules",
  "reconciling",
  "receipts",
  "imports",
] as const;
export type Domain = (typeof DOMAINS)[number];

export type Context = { ledger: Api; app: Api };
export type Args = Record<string, unknown>;

export type Tool = {
  name: string;
  domain: Domain;
  description: string;
  /** Its arguments' properties (the schema's an object of them). */
  input: Record<string, JsonSchema>;
  required?: string[];
  /** A `write_` that only adds (a new transaction, a price), so it can't lose anything. */
  additive?: boolean;
  run: (ctx: Context, args: Args) => Promise<unknown>;
};

/** A path segment: an account's name has colons, a fund's may have spaces. */
export const seg = (value: unknown) => encodeURIComponent(String(value));

/** `args` without the given keys: what's left is the body. */
export function without(args: Args, ...keys: string[]): Args {
  const out = { ...args };
  for (const key of keys) delete out[key];
  return out;
}
