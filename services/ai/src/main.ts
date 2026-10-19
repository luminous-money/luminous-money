import { join } from "node:path";

import { serve } from "@hono/node-server";

import { Sealer } from "@fava-beans/db";

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

serve({ fetch: api.fetch, port: config.port }, (info) =>
  console.log(
    `ai listening on :${info.port} (${config.env}), providers: ${config.providers.join(", ")}`
  )
);
