/**
 * The MCP endpoint, at /api/mcp/v1 (Streamable HTTP), behind Traefik's session check: every
 * request carries the user `auth` vouched for (X-User-Id and the rest).
 *
 * Sessions (`Mcp-Session-Id`) are kept in memory, each bound to the user who started it: what
 * they hold is which skills are loaded. One unused for `idleMs` ends, and a restart ends them all;
 * a client told its session is unknown (404) starts a new one, as MCP says it must.
 */
import { randomUUID } from "node:crypto";

import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { bodyLimit } from "hono/body-limit";
import { Hono, type Context as HonoContext } from "hono";

import { sessionServer } from "./server.js";
import type { Tool } from "./tool.js";
import { api, type Fetch, type User } from "./upstream.js";

export const PATH = "/api/mcp/v1";
const SWEEP_MS = 60_000;

type Session = {
  transport: WebStandardStreamableHTTPServerTransport;
  /** Who it's for: its calls act as them, with the headers of their latest request. */
  user: User;
  seen: number;
};

export type Options = {
  tools: Tool[];
  ledgerUrl: string;
  appUrl: string;
  idleMs: number;
  fetcher?: Fetch;
};

/** The user Traefik forwarded, or undefined if none (a request that didn't come through it). */
function userOf(c: HonoContext): User | undefined {
  const id = c.req.header("x-user-id");
  if (!id) return undefined;
  const headers: Record<string, string> = {};
  for (const name of ["x-user-name", "x-user-email", "x-user-email-verified"]) {
    const value = c.req.header(name);
    if (value) headers[name] = value;
  }
  return { id, headers };
}

const rpcError = (code: number, message: string) => ({
  jsonrpc: "2.0",
  error: { code, message },
  id: null,
});

export function createApp({ tools, ledgerUrl, appUrl, idleMs, fetcher }: Options) {
  const sessions = new Map<string, Session>();
  const app = new Hono();
  // JSON-RPC messages, no files (not yet): 4 MB is ample, and nothing reads more (scale
  // readiness, S4). The MCP SDK's transport sets no limit of its own.
  app.use(
    "*",
    bodyLimit({
      maxSize: 4 * 1024 * 1024,
      onError: (c) => c.json(rpcError(-32600, "a message is at most 4 MB"), 413),
    })
  );

  app.all(PATH, async (c) => {
    const user = userOf(c);
    if (!user) return c.json(rpcError(-32001, "not logged in"), 401);
    const id = c.req.header("mcp-session-id");
    let session = id ? sessions.get(id) : undefined;
    // Another user's session is as good as unknown to this one.
    if (id && (!session || session.user.id !== user.id))
      return c.json(rpcError(-32001, "Session not found"), 404);

    if (!session) {
      if (c.req.method !== "POST")
        return c.json(rpcError(-32000, "Start a session with an initialize request"), 400);
      const fresh: Session = {
        user,
        seen: Date.now(),
        transport: new WebStandardStreamableHTTPServerTransport({
          sessionIdGenerator: randomUUID,
          onsessioninitialized: (sid) => void sessions.set(sid, fresh),
          onsessionclosed: (sid) => void sessions.delete(sid),
        }),
      };
      const server = sessionServer(tools, () => ({
        ledger: api(`${ledgerUrl}/api/ledger/v1`, fresh.user, fetcher),
        app: api(`${appUrl}/api/app/v1`, fresh.user, fetcher),
      }));
      await server.connect(fresh.transport);
      session = fresh;
    }

    session.user = user;
    session.seen = Date.now();
    return session.transport.handleRequest(c.req.raw);
  });

  // Sessions nobody has used for a while go.
  setInterval(() => {
    const now = Date.now();
    for (const [sid, s] of sessions)
      if (now - s.seen > idleMs) {
        sessions.delete(sid);
        void s.transport.close();
      }
  }, SWEEP_MS).unref();

  return { app, sessions };
}
