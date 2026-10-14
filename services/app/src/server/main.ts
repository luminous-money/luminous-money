import { serve } from "@hono/node-server";
import { fileURLToPath } from "node:url";

import { join } from "node:path";

import { createApp } from "./app.js";
import { AppDb } from "./db.js";
import { httpLedger } from "./ledger.js";
import { external, providersFrom } from "./categorize/external.js";
import { history } from "./categorize/history.js";
import { rules } from "./categorize/rules.js";
import { startDaily } from "./daily.js";
import { pricesJob } from "./prices.js";
import { schedulesJob } from "./schedules.js";

const port = Number(process.env.PORT ?? 3000);
const webRoot = process.env.WEB_ROOT ?? fileURLToPath(new URL("../web", import.meta.url));
const db = new AppDb(join(process.env.APP_DATA_DIR ?? "/data", "app.sqlite"));
const ledgerUrl = process.env.LEDGER_URL ?? "http://ledger:8000";
const ledgerFor = (user: string) => httpLedger(ledgerUrl, user);
// The categorization chain: the user's rules, then history, then any configured providers.
const categorizers = [
  rules((book) => db.rules(book)),
  history,
  ...providersFrom(process.env.CATEGORIZERS).map((p) => external(p)),
];

serve({ fetch: createApp(webRoot, { db, ledgerFor, categorizers }).fetch, port }, (info) => {
  console.log(`app listening on :${info.port}, serving the PWA from ${webRoot}`);
  startDaily([schedulesJob(db, ledgerFor), pricesJob(db, ledgerFor)]);
});
