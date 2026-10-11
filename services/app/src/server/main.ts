import { serve } from "@hono/node-server";
import { fileURLToPath } from "node:url";

import { join } from "node:path";

import { createApp } from "./app.js";
import { AppDb } from "./db.js";
import { httpLedger } from "./ledger.js";

const port = Number(process.env.PORT ?? 3000);
const webRoot = process.env.WEB_ROOT ?? fileURLToPath(new URL("../web", import.meta.url));
const db = new AppDb(join(process.env.APP_DATA_DIR ?? "/data", "app.sqlite"));
const ledgerUrl = process.env.LEDGER_URL ?? "http://ledger:8000";

serve(
  {
    fetch: createApp(webRoot, { db, ledgerFor: (user) => httpLedger(ledgerUrl, user) }).fetch,
    port,
  },
  (info) => {
    console.log(`app listening on :${info.port}, serving the PWA from ${webRoot}`);
  }
);
