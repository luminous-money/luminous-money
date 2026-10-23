/**
 * The app service's HTTP surface: the PWA under /ui and the app API under /api/app/v1. Traefik
 * routes both prefixes here without stripping them.
 */
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";

import { health } from "@luminous-money/db";

import { createApi, type SimplefinServices } from "./api.js";
import type { AppDb } from "./db.js";
import type { Categorizer } from "./categorize/types.js";
import type { LedgerPort } from "./ledger.js";
import type { AiPort } from "./ai.js";
import { stackHealth, type Peers } from "./health.js";

export function createApp(
  webRoot: string,
  services: {
    db: AppDb;
    ledgerFor: (userId: string) => LedgerPort;
    categorizers?: Categorizer[];
    simplefin?: SimplefinServices;
    aiFor?: (userId: string) => AiPort;
    /** The other services, for the stack's public health (`/api/health`). */
    peers?: Peers;
  }
) {
  const app = new Hono();

  // Its own health (not routed outside), and the stack's (public, for uptime monitors).
  app.get("/health", (c) => c.json(health("app", services.db.db)));
  const { peers } = services;
  if (peers)
    app.get("/api/health", async (c) => {
      const stack = await stackHealth(peers);
      c.header("Cache-Control", "no-store");
      return c.json(stack, stack.status === "down" ? 503 : 200);
    });

  app.route("/", createApi(services));

  app.get("/ui", (c) => c.redirect("/ui/"));

  // Content-hashed build assets never change; everything else (index.html, the service worker,
  // the manifest) must be revalidated so a new release is picked up.
  app.use("/ui/*", async (c, next) => {
    await next();
    const immutable = c.req.path.startsWith("/ui/assets/");
    c.header("Cache-Control", immutable ? "public, max-age=31536000, immutable" : "no-cache");
  });

  app.use(
    "/ui/*",
    serveStatic({ root: webRoot, rewriteRequestPath: (path) => path.replace(/^\/ui/, "") })
  );

  // Client-side routes: any other page under /ui gets the app shell. Missing assets stay 404s.
  app.get("/ui/*", async (c, next) => {
    if (/\.[a-z0-9]+$/i.test(c.req.path)) return c.notFound();
    return serveStatic({ root: webRoot, path: "index.html" })(c, next);
  });

  return app;
}
