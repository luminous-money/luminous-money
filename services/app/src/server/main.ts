import { join } from "node:path";

import { serve } from "@hono/node-server";

import { health } from "@luminous-money/db";

import { createApp } from "./app.js";
import { config } from "./config.js";
import { AppDb } from "./db.js";
import { httpLedger } from "./ledger.js";
import { httpAi } from "./ai.js";
import { external, providersFrom } from "./categorize/external.js";
import { history } from "./categorize/history.js";
import { items } from "./categorize/items.js";
import { rules } from "./categorize/rules.js";
import { startDaily } from "./daily.js";
import { createSystem } from "./system.js";
import { pricesJob } from "./prices.js";
import { schedulesJob } from "./schedules.js";
import { Sealer } from "./simplefin/crypto.js";
import { SimplefinStore } from "./simplefin/store.js";
import { simplefinJob } from "./simplefin/sync.js";

const { port, webRoot } = config;
const db = new AppDb(join(config.dataDir, "app.sqlite"));
const ledgerFor = (user: string) => httpLedger(config.ledgerUrl, user);
// The categorization chain: the user's rules, then history (payees, then items), then any
// configured providers. Receipts add the book's AI at the end (M16).
const categorizers = [
  rules((book) => db.rules(book)),
  history,
  items,
  ...providersFrom(config.categorizers).map((p) => external(p)),
];

// Bank feeds: credentials sealed with SIMPLEFIN_ENCRYPTION_KEY (required: config.ts).
const simplefin = {
  store: new SimplefinStore(db.db),
  sealer: new Sealer(config.simplefin.encryptionKey, "SIMPLEFIN_ENCRYPTION_KEY"),
  policy: { hosts: config.simplefin.hosts, allowInsecure: config.simplefin.allowInsecure },
};
if (config.simplefin.mode === "on-demand")
  console.log("LM_SIMPLEFIN_MODE is on-demand: bank feeds sync only when someone taps Sync now.");
if (simplefin.policy.allowInsecure)
  console.warn(
    "SIMPLEFIN_ALLOW_INSECURE is on: plain-HTTP SimpleFIN servers allowed. Test stacks only."
  );

const peers = {
  auth: config.authUrl,
  ledger: config.ledgerUrl,
  ai: config.aiUrl,
  gateway: config.gatewayUrl,
  domain: config.domain ?? null,
};
// The system page's facts, for the admins named in the config (and confirmed).
const system = createSystem({
  version: process.env["LUMINOUS_MONEY_VERSION"] ?? "dev",
  dataDir: config.dataDir,
  peers,
  policy: config.system.updates,
  upgradeAt: config.system.upgradeAt ?? null,
  repo: config.system.repo,
  schema: () => health("app", db.db).schema,
});
const admins = new Set(
  config.system.admins
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)
);
if (!admins.size) console.warn("LUMINOUS_MONEY_ADMINS isn't set: no one sees the system page.");

serve(
  {
    fetch: createApp(webRoot, {
      db,
      ledgerFor,
      categorizers,
      simplefin,
      aiFor: (user) => httpAi(config.aiUrl, user),
      peers,
      system: { facts: system, admins },
    }).fetch,
    port,
  },
  (info) => {
    console.log(`app listening on :${info.port} (${config.env}), serving the PWA from ${webRoot}`);
    startDaily([
      schedulesJob(db, ledgerFor),
      pricesJob(db, ledgerFor),
      ...(config.simplefin.mode === "daily"
        ? [simplefinJob({ ...simplefin, db, ledgerFor, categorizers })]
        : []),
      system.job,
    ]);
  }
);
