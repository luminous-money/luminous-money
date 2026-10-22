import { join } from "node:path";

import { serve } from "@hono/node-server";
import { Hono } from "hono";

import { health, Sealer } from "@fava-beans/db";

import { createApi } from "./api.js";
import { config } from "./config.js";
import { AiDb } from "./db.js";
import { rolesFrom } from "./ledger.js";
import { claude } from "./providers/claude.js";
import { fake } from "./providers/fake.js";
import type { Provider } from "./providers/types.js";

const db = new AiDb(join(config.dataDir, "ai.sqlite"));
const providers: Provider[] = config.providers.map((name) =>
  name === "claude"
    ? claude({
        extractModel: config.claudeExtractModel,
        categorizeModel: config.claudeCategorizeModel,
      })
    : fake
);
if (config.providers.includes("fake"))
  console.warn("AI_PROVIDERS includes fake: receipts read without a model. Test stacks only.");

const api = createApi({
  db,
  sealer: new Sealer(config.encryptionKey, "AI_ENCRYPTION_KEY"),
  providers,
  roleOf: rolesFrom(config.ledgerUrl),
});

// Its health, beside the API (not routed outside): for the stack's healthchecks and app's summary.
const root = new Hono();
root.get("/health", (c) => c.json(health("ai", db.db)));
root.route("/", api);

serve({ fetch: root.fetch, port: config.port }, (info) =>
  console.log(
    `ai listening on :${info.port} (${config.env}), providers: ${config.providers.join(", ")}`
  )
);
