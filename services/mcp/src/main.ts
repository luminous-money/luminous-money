import { serve } from "@hono/node-server";
import { Hono } from "hono";

import { createApp } from "./app.js";
import { config } from "./config.js";
import { TOOLS } from "./tools/index.js";

const { app, sessions } = createApp({
  tools: TOOLS,
  ledgerUrl: config.ledgerUrl,
  appUrl: config.appUrl,
  idleMs: config.idleHours * 3_600_000,
});

// Its health, beside the API (not routed outside): for the stack's healthchecks and app's summary.
const root = new Hono();
root.get("/health", (c) =>
  c.json({
    status: "ok",
    service: "mcp",
    version: process.env.LUMINOUS_MONEY_VERSION ?? "dev",
    sessions: sessions.size,
  })
);
root.route("/", app);

serve({ fetch: root.fetch, port: config.port }, (info) =>
  console.log(`mcp listening on :${info.port} (${config.env}), ${TOOLS.length} tools`)
);
