import { serve } from "@hono/node-server";

import { join } from "node:path";

import { createApp } from "./app.js";
import { config } from "./config.js";
import { AppDb } from "./db.js";
import { httpLedger } from "./ledger.js";
import { httpAi } from "./ai.js";
import { external, providersFrom } from "./categorize/external.js";
import { history } from "./categorize/history.js";
import { rules } from "./categorize/rules.js";
import { startDaily } from "./daily.js";
import { pricesJob } from "./prices.js";
import { schedulesJob } from "./schedules.js";
import { Sealer } from "./simplefin/crypto.js";
import { SimplefinStore } from "./simplefin/store.js";
import { simplefinJob } from "./simplefin/sync.js";

const { port, webRoot } = config;
const db = new AppDb(join(config.dataDir, "app.sqlite"));
const ledgerFor = (user: string) => httpLedger(config.ledgerUrl, user);
// The categorization chain: the user's rules, then history, then any configured providers.
const categorizers = [
  rules((book) => db.rules(book)),
  history,
  ...providersFrom(config.categorizers).map((p) => external(p)),
];

// Bank feeds: credentials sealed with SIMPLEFIN_ENCRYPTION_KEY (required: config.ts).
const simplefin = {
  store: new SimplefinStore(db.db),
  sealer: new Sealer(config.simplefin.encryptionKey, "SIMPLEFIN_ENCRYPTION_KEY"),
  policy: { hosts: config.simplefin.hosts, allowInsecure: config.simplefin.allowInsecure },
};
if (simplefin.policy.allowInsecure)
  console.warn(
    "SIMPLEFIN_ALLOW_INSECURE is on: plain-HTTP SimpleFIN servers allowed. Test stacks only."
  );

serve(
  {
    fetch: createApp(webRoot, {
      db,
      ledgerFor,
      categorizers,
      simplefin,
      aiFor: (user) => httpAi(config.aiUrl, user),
    }).fetch,
    port,
  },
  (info) => {
    console.log(`app listening on :${info.port} (${config.env}), serving the PWA from ${webRoot}`);
    startDaily([
      schedulesJob(db, ledgerFor),
      pricesJob(db, ledgerFor),
      simplefinJob({ ...simplefin, db, ledgerFor, categorizers }),
    ]);
  }
);
