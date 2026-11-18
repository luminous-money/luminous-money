import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { after, before, describe, it } from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import { BASE_URL, OPENING, beancount, newUser, stackIsUp, uniqueBook } from "./support.ts";

const MCP = `${BASE_URL}/api/mcp/v1`;
const AUTH = `${BASE_URL}/api/auth/v1`;

/** Every client made, closed after the suite: an open stream would keep its process running. */
const clients: Client[] = [];

/** An MCP client signed in with `token` (an API token, or an OAuth access token). */
async function connect(token: string) {
  const client = new Client({ name: "e2e", version: "1" });
  clients.push(client);
  await client.connect(
    new StreamableHTTPClientTransport(new URL(MCP), {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
    })
  );
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = (await client.callTool({ name, arguments: args })) as {
      content: { text: string }[];
      isError?: boolean;
    };
    return { text: result.content[0]!.text, error: !!result.isError };
  };
  return { client, call };
}

/** A user of the suite's own, with a book of their own. */
async function userWithBook() {
  const user = await newUser();
  const book = uniqueBook("mcp");
  const { response } = await user.ledger.POST("/api/ledger/v1/books/{book_id}/import", {
    params: { path: { book_id: book } },
    ...beancount(OPENING),
  });
  assert.equal(response.status, 200);
  return { ...user, book };
}

describe("MCP server", () => {
  before(stackIsUp);
  after(() => Promise.all(clients.map((c) => c.close())));

  it("without a token, says where to sign in", async () => {
    const refused = await fetch(MCP, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    });
    assert.equal(refused.status, 401);
    const pointer = /resource_metadata="([^"]+)"/.exec(
      refused.headers.get("www-authenticate") ?? ""
    );
    assert.ok(pointer, "a resource_metadata pointer");
    const resource = (await (
      await fetch(pointer[1]!.replace(/^https?:\/\/[^/]+/, BASE_URL))
    ).json()) as {
      resource: string;
      authorization_servers: string[];
    };
    assert.match(resource.resource, /\/api\/mcp\/v1$/);
    const server = (await (
      await fetch(`${BASE_URL}/.well-known/oauth-authorization-server`)
    ).json()) as { authorization_endpoint: string; code_challenge_methods_supported: string[] };
    assert.match(server.authorization_endpoint, /\/ui\/authorize$/);
    assert.deepEqual(server.code_challenge_methods_supported, ["S256"]);
  });

  it("with an API token: skills first, then the book as the user, versioned", async () => {
    const user = await userWithBook();
    const made = await fetch(`${AUTH}/tokens`, {
      method: "POST",
      headers: { authorization: `Bearer ${user.token}`, "content-type": "application/json" },
      body: JSON.stringify({ name: "Claude Code" }),
    });
    const { secret } = (await made.json()) as { secret: string };
    const { client, call } = await connect(secret);

    assert.match(client.getInstructions() ?? "", /load_skill/);
    const { tools } = await client.listTools();
    assert.ok(tools.some((t) => t.name === "write_add_transaction"));

    assert.equal((await call("read_books")).error, true);
    assert.match((await call("load_skill", { domain: "base" })).text, /# Luminous Money/);
    const books = JSON.parse((await call("read_books")).text) as { id: string }[];
    assert.ok(books.some((b) => b.id === user.book));

    const added = await call("write_add_transaction", {
      book: user.book,
      transaction: {
        date: "2024-03-02",
        flag: "*",
        payee: "Corner Cafe",
        narration: "mcp latte",
        postings: [
          { account: "Expenses:Food", units: { number: "5.25", currency: "USD" } },
          { account: "Assets:Bank:Checking" },
        ],
      },
    });
    assert.equal(added.error, false, added.text);
    const { id, updated_at } = JSON.parse(added.text) as { id: string; updated_at: string };

    const found = JSON.parse(
      (await call("read_transactions", { book: user.book, q: "mcp latte" })).text
    ) as { rows: { id: string }[] };
    assert.deepEqual(
      found.rows.map((r) => r.id),
      [id]
    );

    const edited = await call("write_edit_transaction", {
      book: user.book,
      id,
      changes: { narration: "mcp flat white", updated_at },
    });
    assert.equal(edited.error, false, edited.text);
    const stale = await call("write_edit_transaction", {
      book: user.book,
      id,
      changes: { narration: "too late", updated_at },
    });
    assert.equal(stale.error, true);
    assert.match(stale.text, /409/);
  });

  it("through OAuth: consent, a code, tokens that reach the MCP server alone, and disconnecting", async () => {
    const user = await userWithBook();
    const redirect = "http://localhost:43123/callback";
    const registered = await fetch(`${AUTH}/oauth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_name: "Claude", redirect_uris: [redirect] }),
    });
    assert.equal(registered.status, 201);
    const { client_id } = (await registered.json()) as { client_id: string };

    const verifier = randomBytes(32).toString("base64url");
    const consent = await fetch(`${AUTH}/oauth/authorize`, {
      method: "POST",
      headers: { authorization: `Bearer ${user.token}`, "content-type": "application/json" },
      body: JSON.stringify({
        client_id,
        redirect_uri: redirect,
        response_type: "code",
        code_challenge: createHash("sha256").update(verifier).digest("base64url"),
        code_challenge_method: "S256",
        state: "s1",
        decision: "allow",
      }),
    });
    assert.equal(consent.status, 200);
    const back = new URL(((await consent.json()) as { redirect: string }).redirect);
    assert.equal(back.searchParams.get("state"), "s1");

    const token = await fetch(`${AUTH}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: back.searchParams.get("code")!,
        code_verifier: verifier,
        redirect_uri: redirect,
        client_id,
      }).toString(),
    });
    assert.equal(token.status, 200);
    const tokens = (await token.json()) as { access_token: string; refresh_token: string };

    const { call } = await connect(tokens.access_token);
    await call("load_skill", { domain: "base" });
    const books = JSON.parse((await call("read_books")).text) as { id: string }[];
    assert.ok(books.some((b) => b.id === user.book));
    // Its token is for the MCP server only.
    const elsewhere = await fetch(`${BASE_URL}/api/ledger/v1/books`, {
      headers: { authorization: `Bearer ${tokens.access_token}` },
    });
    assert.equal(elsewhere.status, 401);

    const refreshed = await fetch(`${AUTH}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: tokens.refresh_token,
        client_id,
      }).toString(),
    });
    assert.equal(refreshed.status, 200);

    // Disconnecting it (the Account page's Connected apps) stops it.
    const sessions = (await (
      await fetch(`${AUTH}/sessions`, { headers: { authorization: `Bearer ${user.token}` } })
    ).json()) as { id: string; app: boolean }[];
    const app = sessions.find((s) => s.app)!;
    await fetch(`${AUTH}/sessions/${app.id}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${user.token}` },
    });
    const disconnected = await fetch(MCP, {
      method: "POST",
      headers: {
        authorization: `Bearer ${tokens.access_token}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    });
    assert.equal(disconnected.status, 401);
  });
});
