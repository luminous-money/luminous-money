import { createLedgerClient } from "@fava-beans/ledger-client";

/** The ledger API, reached through the same origin that served the app. */
export const ledger = createLedgerClient({ baseUrl: window.location.origin });
