/**
 * The app service's HTTP surface: the PWA under /ui and the app API under /api/app/v1. Traefik
 * routes both prefixes here without stripping them.
 */
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";

export function createApp(webRoot: string) {
  const app = new Hono();

  app.get("/api/app/v1/health", (c) => c.json({ status: "ok" }));

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
