/**
 * A fake SimpleFIN server, following what the SimpleFIN Bridge actually sends (its demo data,
 * 2026-10-15): accounts with `org`, transactions with `payee`, `memo` and `transacted_at`,
 * brokerages with `holdings`, and errors in either shape (the older plain `errors` strings, or
 * the current draft's coded `errlist`).
 *
 * The protocol side:
 *
 * - `POST /simplefin/claim/:token`: once, the access URL (`<origin>/simplefin` with Basic
 *   credentials in it); after that, 403.
 * - `GET /simplefin/accounts` (Basic auth): `start-date`, `end-date`, `pending`, `account`,
 *   `balances-only`, as the protocol says. Every request is counted.
 *
 * The control side, for tests (`/control`):
 *
 * - `POST /control/users` → `{ user, setup_token }`: a new user and a setup token for them.
 * - `PUT /control/users/:user/accounts/:id` (`{ name, institution, currency, balance, holdings }`)
 * - `POST /control/users/:user/accounts/:id/transactions` (a list, posted as Unix seconds)
 * - `PUT /control/users/:user/errors` (`{ errors, shape }`): what the next answers report
 * - `POST /control/users/:user/tokens` → another setup token for the same user
 * - `GET /control/users/:user` → `{ requests }`
 */
import { randomBytes } from "node:crypto";

import { Hono } from "hono";

export type FakeTransaction = {
  id: string;
  posted: number;
  amount: string;
  description: string;
  transacted_at?: number;
  payee?: string;
  memo?: string;
  pending?: boolean;
};

export type FakeHolding = {
  id: string;
  symbol: string;
  shares: string;
  cost_basis?: string;
  market_value: string;
  purchase_price?: string;
  currency?: string;
  description?: string;
  created?: number;
};

export type FakeAccount = {
  id: string;
  name: string;
  institution: string;
  currency: string;
  balance: string;
  balance_date: number;
  transactions: FakeTransaction[];
  holdings: FakeHolding[];
};

type FakeError = { code: string; msg: string; account_id?: string };

type FakeUser = {
  password: string;
  accounts: Map<string, FakeAccount>;
  errors: FakeError[];
  shape: "v1" | "v2";
  requests: number;
};

const secret = () => randomBytes(12).toString("hex");

export function createFakeSimplefin({ origin = "http://simplefin-fake:8080" } = {}) {
  const users = new Map<string, FakeUser>();
  const tokens = new Map<string, { user: string; claimed: boolean }>();
  const app = new Hono();
  const base = new URL(origin);

  const setupToken = (user: string) => {
    const token = secret();
    tokens.set(token, { user, claimed: false });
    return Buffer.from(`${origin}/simplefin/claim/${token}`).toString("base64");
  };

  app.post("/simplefin/claim/:token", (c) => {
    const found = tokens.get(c.req.param("token"));
    if (!found || found.claimed) return c.text("Forbidden", 403);
    found.claimed = true;
    const user = users.get(found.user)!;
    return c.text(`${base.protocol}//${found.user}:${user.password}@${base.host}/simplefin`);
  });

  app.get("/simplefin/accounts", (c) => {
    const auth = c.req.header("authorization")?.match(/^Basic (.+)$/)?.[1];
    const [name, password] = Buffer.from(auth ?? "", "base64")
      .toString()
      .split(":");
    const user = name ? users.get(name) : undefined;
    if (!user || user.password !== password) return c.text("Forbidden", 403);
    user.requests += 1;
    const q = (key: string) => c.req.query(key);
    const start = q("start-date") ? Number(q("start-date")) : -Infinity;
    const end = q("end-date") ? Number(q("end-date")) : Infinity;
    const wanted = c.req.queries("account");
    const accounts = [...user.accounts.values()]
      .filter((a) => !wanted?.length || wanted.includes(a.id))
      .map((a) => ({
        org: { domain: base.host, name: a.institution, "sfin-url": `${origin}/simplefin` },
        id: a.id,
        name: a.name,
        currency: a.currency,
        balance: a.balance,
        "available-balance": a.balance,
        "balance-date": a.balance_date,
        transactions:
          q("balances-only") === "1"
            ? []
            : a.transactions.filter(
                (t) =>
                  (t.pending ? q("pending") === "1" : true) &&
                  (t.pending || (t.posted >= start && t.posted < end))
              ),
        // As the Bridge does: holdings only come with transactions.
        holdings: q("balances-only") === "1" ? [] : a.holdings,
      }));
    return c.json(
      user.shape === "v2"
        ? { errlist: user.errors, accounts }
        : { errors: user.errors.map((e) => e.msg), accounts }
    );
  });

  // Control

  app.post("/control/users", (c) => {
    const user = `user${secret().slice(0, 8)}`;
    users.set(user, {
      password: secret(),
      accounts: new Map(),
      errors: [],
      shape: "v1",
      requests: 0,
    });
    return c.json({ user, setup_token: setupToken(user) }, 201);
  });

  const userOr404 = (name: string) => users.get(name);

  app.post("/control/users/:user/tokens", (c) =>
    userOr404(c.req.param("user"))
      ? c.json({ setup_token: setupToken(c.req.param("user")) }, 201)
      : c.json({ detail: "no such user" }, 404)
  );

  app.put("/control/users/:user/accounts/:id", async (c) => {
    const user = userOr404(c.req.param("user"));
    if (!user) return c.json({ detail: "no such user" }, 404);
    const id = c.req.param("id");
    const body = (await c.req.json()) as Partial<FakeAccount>;
    const current = user.accounts.get(id);
    user.accounts.set(id, {
      id,
      name: body.name ?? current?.name ?? id,
      institution: body.institution ?? current?.institution ?? "Fake Bank",
      currency: body.currency ?? current?.currency ?? "USD",
      balance: body.balance ?? current?.balance ?? "0.00",
      balance_date: body.balance_date ?? current?.balance_date ?? Math.floor(Date.now() / 1000),
      transactions: current?.transactions ?? [],
      holdings: body.holdings ?? current?.holdings ?? [],
    });
    return c.json(user.accounts.get(id));
  });

  app.post("/control/users/:user/accounts/:id/transactions", async (c) => {
    const account = userOr404(c.req.param("user"))?.accounts.get(c.req.param("id"));
    if (!account) return c.json({ detail: "no such account" }, 404);
    for (const t of (await c.req.json()) as FakeTransaction[]) {
      account.transactions = account.transactions.filter((x) => x.id !== t.id);
      account.transactions.push(t);
    }
    return c.json({ transactions: account.transactions.length });
  });

  app.put("/control/users/:user/errors", async (c) => {
    const user = userOr404(c.req.param("user"));
    if (!user) return c.json({ detail: "no such user" }, 404);
    const body = (await c.req.json()) as { errors: FakeError[]; shape?: "v1" | "v2" };
    user.errors = body.errors;
    if (body.shape) user.shape = body.shape;
    return c.json({ ok: true });
  });

  app.get("/control/users/:user", (c) => {
    const user = userOr404(c.req.param("user"));
    return user ? c.json({ requests: user.requests }) : c.json({ detail: "no such user" }, 404);
  });

  /** Call the fake in process, as `fetch` would over the network (credentials in the URL are
   * moved into the Authorization header, as a real client must). */
  const fetcher: typeof fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    return app.request(`${url.pathname}${url.search}`, {
      method: request.method,
      headers: request.headers,
      body: request.method === "GET" ? undefined : await request.text(),
    });
  };

  return { app, fetch: fetcher };
}
