import type { AddressInfo } from "node:net";

import { serve, type ServerType } from "@hono/node-server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createApp, PATH } from "../src/app.js";
import { SKILLS } from "../src/skills.js";
import { DOMAINS } from "../src/tool.js";
import { TOOLS } from "../src/tools/index.js";

type Seen = { method: string; url: URL; headers: Record<string, string>; body: unknown };

/** The ledger and `app`, faked: what each request was, and canned answers by method and path. */
const seen: Seen[] = [];
let answers: Record<string, { status?: number; body: unknown }> = {};
const fakeFetch = async (input: string, init: RequestInit = {}) => {
  const url = new URL(input);
  const method = init.method ?? "GET";
  const raw = init.body;
  seen.push({
    method,
    url,
    headers: init.headers as Record<string, string>,
    body: typeof raw === "string" ? (raw.startsWith("{") ? JSON.parse(raw) : raw) : raw,
  });
  const answer = answers[`${method} ${url.pathname}`] ?? { body: {} };
  return new Response(JSON.stringify(answer.body), {
    status: answer.status ?? 200,
    headers: { "content-type": "application/json" },
  });
};

let server: ServerType;
let base: string;

beforeAll(async () => {
  const { app } = createApp({
    tools: TOOLS,
    ledgerUrl: "http://ledger",
    appUrl: "http://app",
    idleMs: 60_000,
    fetcher: fakeFetch,
  });
  await new Promise<void>((resolve) => {
    server = serve({ fetch: app.fetch, port: 0 }, () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}${PATH}`;
});
afterAll(() => server.close());
beforeEach(() => {
  seen.length = 0;
  answers = {};
});

/** A client as `user` (the headers Traefik would set). */
async function connect(user = "kael") {
  const client = new Client({ name: "test", version: "1" });
  const transport = new StreamableHTTPClientTransport(new URL(base), {
    requestInit: { headers: { "x-user-id": user, "x-user-name": "Kael" } },
  });
  await client.connect(transport);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = (await client.callTool({ name, arguments: args })) as {
      content: { text: string }[];
      isError?: boolean;
    };
    return { text: result.content[0]!.text, error: !!result.isError };
  };
  return { client, transport, call };
}

describe("the tools", () => {
  it("are named by what they do, once each, in a domain with a skill", () => {
    const names = TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const tool of TOOLS) expect(tool.name).toMatch(/^(read|write|delete)_[a-z_]+$/);
    for (const domain of DOMAINS) expect(SKILLS[domain]).toMatch(/^# Luminous Money/);
  });

  it("are all listed from the start, each with its domain and what its name says", async () => {
    const { client } = await connect();
    expect(client.getInstructions()).toMatch(/load_skill\("base"\)/);
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(TOOLS.length + 1);
    const by = new Map(tools.map((t) => [t.name, t]));
    expect(by.get("load_skill")!.annotations?.readOnlyHint).toBe(true);
    expect(by.get("read_loans")!.description).toMatch(/^\[loans\] /);
    expect(by.get("read_loans")!.annotations).toMatchObject({ readOnlyHint: true });
    expect(by.get("delete_loan")!.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
    });
    expect(by.get("write_add_transaction")!.annotations?.destructiveHint).toBe(false);
    expect(by.get("write_edit_transaction")!.annotations?.destructiveHint).toBe(true);
    // The ledger's schemas, resolved: a transaction's splits are described as the API does.
    const input = by.get("write_add_transaction")!.inputSchema as {
      properties: { transaction: { properties: { postings: { items: { properties: object } } } } };
    };
    expect(input.properties.transaction.properties.postings.items.properties).toHaveProperty(
      "units"
    );
  });
});

describe("skills", () => {
  it("are loaded before their tools: the base first, then the tool's domain", async () => {
    const { call } = await connect();
    const before = await call("read_books");
    expect(before).toMatchObject({ error: true });
    expect(before.text).toMatch(/load_skill\("base"\)/);
    expect(seen).toHaveLength(0);

    // A domain loaded first brings the base with it.
    const loans = await call("load_skill", { domain: "loans" });
    expect(loans.text).toContain(SKILLS.base);
    expect(loans.text).toContain(SKILLS.loans);
    expect((await call("read_loans", { book: "b1" })).error).toBe(false);

    const review = await call("read_review_queue", { book: "b1" });
    expect(review.text).toMatch(/load_skill\("review"\)/);
    expect((await call("load_skill", { domain: "review" })).text).toBe(SKILLS.review);
  });

  it("are the session's: another session starts over", async () => {
    const first = await connect();
    await first.call("load_skill", { domain: "base" });
    const second = await connect();
    expect((await second.call("read_books")).error).toBe(true);
  });
});

describe("calls", () => {
  it("go to the ledger and app as the user", async () => {
    const { call } = await connect("kael");
    await call("load_skill", { domain: "base" });
    answers["GET /api/app/v1/books"] = { body: [{ id: "b1", name: "Home", role: "owner" }] };
    expect(JSON.parse((await call("read_books")).text)).toEqual([
      { id: "b1", name: "Home", role: "owner" },
    ]);
    expect(seen[0]!.headers).toMatchObject({ "x-user-id": "kael", "x-user-name": "Kael" });

    const transaction = {
      date: "2026-11-18",
      flag: "*",
      payee: "Grocer",
      narration: "",
      postings: [
        { account: "Liabilities:Card", units: { number: "-42.17", currency: "USD" } },
        { account: "Expenses:Food:Groceries" },
      ],
    };
    await call("write_add_transaction", { book: "b1", transaction });
    expect(seen.at(-1)).toMatchObject({
      method: "POST",
      url: new URL("http://ledger/api/ledger/v1/books/b1/transactions"),
      body: transaction,
    });

    await call("read_account_ledger", {
      book: "b1",
      account: "Assets:Bank:Checking",
      tag: ["gift", "hsa"],
    });
    const ledger = seen.at(-1)!.url;
    expect(ledger.pathname).toBe(
      "/api/ledger/v1/books/b1/accounts/Assets%3ABank%3AChecking/ledger"
    );
    expect(ledger.searchParams.getAll("tag")).toEqual(["gift", "hsa"]);
    expect(ledger.searchParams.get("limit")).toBe("50");

    await call("read_query", { book: "b1", bql: "SELECT account" });
    expect(seen.at(-1)).toMatchObject({ body: "SELECT account" });
    expect(seen.at(-1)!.headers["content-type"]).toBe("text/plain");
  });

  it("say a stale edit is to be read again", async () => {
    const { call } = await connect();
    await call("load_skill", { domain: "base" });
    answers["GET /api/ledger/v1/books/b1/transactions/t1"] = { body: { id: "t1", flag: "*" } };
    answers["PATCH /api/ledger/v1/books/b1/transactions/t1"] = {
      status: 409,
      body: { detail: "it changed since you read it" },
    };
    const stale = await call("write_edit_transaction", {
      book: "b1",
      id: "t1",
      changes: { payee: "x", updated_at: "old" },
    });
    expect(stale.error).toBe(true);
    expect(stale.text).toMatch(/409.*it changed since you read it.*read it again.*updated_at/s);
  });

  it("confirming out of review settles the proposal", async () => {
    const { call } = await connect();
    await call("load_skill", { domain: "review" });
    let flag = "!";
    answers["GET /api/ledger/v1/books/b1/transactions/t1"] = {
      get body() {
        return { id: "t1", flag };
      },
    };
    answers["PATCH /api/ledger/v1/books/b1/transactions/t1"] = {
      get body() {
        flag = "*";
        return { id: "t1", flag };
      },
    };
    await call("write_edit_transaction", {
      book: "b1",
      id: "t1",
      changes: { flag: "*", updated_at: "v1" },
    });
    expect(seen.map((s) => `${s.method} ${s.url.pathname}`)).toEqual([
      "GET /api/ledger/v1/books/b1/transactions/t1",
      "PATCH /api/ledger/v1/books/b1/transactions/t1",
      "GET /api/ledger/v1/books/b1/transactions/t1",
      "POST /api/app/v1/books/b1/proposals/t1/settle",
    ]);

    // An edit to a confirmed one settles nothing.
    seen.length = 0;
    await call("write_edit_transaction", {
      book: "b1",
      id: "t1",
      changes: { payee: "y", updated_at: "v2" },
    });
    expect(seen.some((s) => s.url.pathname.endsWith("/settle"))).toBe(false);
  });

  it("the review queue carries each staged transaction's proposal", async () => {
    const { call } = await connect();
    await call("load_skill", { domain: "review" });
    answers["GET /api/ledger/v1/books/b1/transactions"] = {
      body: [{ id: "t1" }, { id: "t2" }],
    };
    answers["GET /api/app/v1/books/b1/proposals"] = {
      body: { t2: { categorizer: "rules", account: "Expenses:Fun" } },
    };
    const queue = JSON.parse((await call("read_review_queue", { book: "b1" })).text);
    expect(queue).toEqual([
      { id: "t1" },
      { id: "t2", proposal: { categorizer: "rules", account: "Expenses:Fun" } },
    ]);
    expect(seen[0]!.url.searchParams.get("flag")).toBe("!");
  });
});

describe("sessions", () => {
  it("need the user Traefik vouched for, and are theirs alone", async () => {
    const anonymous = await fetch(base, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    });
    expect(anonymous.status).toBe(401);

    const { transport } = await connect("kael");
    const stolen = await fetch(base, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "x-user-id": "mallory",
        "mcp-session-id": transport.sessionId!,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
    });
    expect(stolen.status).toBe(404);
  });
});

describe("request bodies (scale readiness, S4)", () => {
  it("refuses a message over 4 MB, as JSON-RPC's error", async () => {
    const response = await fetch(base, {
      method: "POST",
      headers: {
        "x-user-id": "kael",
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: "x".repeat(4 * 1024 * 1024 + 1),
    });
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({
      error: { message: "a message is at most 4 MB" },
    });
  });
});
