/**
 * Typed client for the ledger service (`/api/ledger/v1`).
 *
 * `schema.ts` is generated from `openapi.json`, which is the ledger's own schema exported by
 * `pnpm generate`. Both are committed; `pnpm test` fails if they drift from the service.
 */
import createClient, { type ClientOptions } from "openapi-fetch";

import type { paths } from "./schema.js";

export type { components, operations, paths } from "./schema.js";

export function createLedgerClient(options: ClientOptions) {
  return createClient<paths>(options);
}

export type LedgerClient = ReturnType<typeof createLedgerClient>;
