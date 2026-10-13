/**
 * Typed client for the ledger service (`/api/ledger/v1`).
 *
 * `schema.ts` is generated from `openapi.json`, which is the ledger's own schema exported by
 * `pnpm generate`. Both are committed; `pnpm test` fails if they drift from the service.
 */
import createClient, { type ClientOptions } from "openapi-fetch";

import type { components, paths } from "./schema.js";

export type { components, operations, paths } from "./schema.js";

type Schemas = components["schemas"];
export type Transaction = Schemas["Transaction"];
export type TransactionIn = Schemas["TransactionIn"];
export type Posting = Schemas["Posting"];
export type Amount = Schemas["Amount"];
export type Directive = Schemas["Directive"];
export type Problem = Schemas["Problem"];
export type Account = Schemas["Account"];
export type Cost = Schemas["Cost"];
export type Book = Schemas["Book"];
export type AccountSummary = Schemas["AccountSummary"];
export type OpeningBalance = Schemas["OpeningBalance"];
export type AccountIn = Schemas["AccountIn"];
export type LedgerPage = Schemas["LedgerPage"];
export type LedgerRow = Schemas["LedgerRow"];
export type Backup = Schemas["Backup"];

export function createLedgerClient(options: ClientOptions) {
  return createClient<paths>(options);
}

export type LedgerClient = ReturnType<typeof createLedgerClient>;
