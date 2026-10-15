/**
 * Shared setup for the end-to-end suite. Everything goes through Traefik at FAVA_BEANS_URL, the
 * same single entry point an operator exposes, using the generated ledger client.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

import { createLedgerClient, type TransactionIn } from "@fava-beans/ledger-client";

export const BASE_URL = process.env.FAVA_BEANS_URL ?? "http://localhost:8080";

/**
 * A session for the suite: logged in once, lazily, as a shared test user (the e2e stack runs
 * auth with AUTH_TEST_USERS). Every ledger call carries its access token as a Bearer token;
 * `authed` does the same for plain fetches. Access tokens last ten minutes, longer than a run.
 */
let session: Promise<string> | undefined;

export function token(): Promise<string> {
  session ??= logIn("e2e@test.local")
    .then(({ access_token }) => access_token)
    .catch((error: unknown) => {
      session = undefined;
      throw error;
    });
  return session;
}

export async function authed(url: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${await token()}`);
  return fetch(url, { ...init, headers });
}

export const ledger = createLedgerClient({ baseUrl: BASE_URL });
ledger.use({
  async onRequest({ request }) {
    request.headers.set("authorization", `Bearer ${await token()}`);
    return request;
  },
});

/**
 * Request options for the endpoints that take Beancount text (import, raw directives, BQL).
 * openapi-fetch serializes bodies as JSON by default; these pass the text through unchanged.
 */
export function beancount(text: string) {
  return {
    body: text,
    bodySerializer: (body: string) => body,
    headers: { "content-type": "text/plain" },
  };
}

/** A book ID no other test run will use, so the suite can run against a long-lived stack. */
export function uniqueBook(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
}

/** Retry an assertion until it passes or the timeout expires, then rethrow its last failure. */
export async function eventually<T>(
  check: () => Promise<T>,
  { timeoutMs = 30_000, intervalMs = 500 } = {}
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      return await check();
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }
}

/** Wait for the stack to answer through Traefik. Every test file calls this before running. */
export async function stackIsUp(): Promise<void> {
  await eventually(
    async () => {
      const response = await authed(`${BASE_URL}/api/ledger/v1/books`);
      assert.equal(response.status, 200);
    },
    { timeoutMs: 60_000 }
  );
}

/** A small book: two accounts, ready for staged transactions. */
export const OPENING = `\
option "operating_currency" "USD"
2024-01-01 open Assets:Bank:Checking USD
2024-01-01 open Expenses:Food
`;

/** A staged purchase, as the app would send it. */
export function purchase(narration: string, amount = "4.50"): TransactionIn {
  return {
    date: "2024-03-01",
    flag: "!",
    payee: "Corner Cafe",
    narration,
    postings: [
      { account: "Expenses:Food", units: { number: amount, currency: "USD" } },
      { account: "Assets:Bank:Checking" },
    ],
  };
}

/** The same purchase as Beancount text, for the text endpoints. */
export function stagedText(narration: string, amount = "4.50"): string {
  return `2024-03-01 ! "Corner Cafe" "${narration}"\n  Expenses:Food  ${amount} USD\n  Assets:Bank:Checking\n`;
}

/** Stage a purchase through the JSON API and return the stored transaction. */
export async function stage(book_id: string, narration: string, amount = "4.50") {
  const { data, response } = await ledger.POST("/api/ledger/v1/books/{book_id}/transactions", {
    params: { path: { book_id } },
    body: purchase(narration, amount),
  });
  assert.equal(response.status, 201);
  assert.ok(data);
  return data;
}

/** Create a book from OPENING and return its ID. */
export async function newBook(prefix: string): Promise<string> {
  const book_id = uniqueBook(prefix);
  const { response } = await ledger.POST("/api/ledger/v1/books/{book_id}/import", {
    params: { path: { book_id } },
    ...beancount(OPENING),
  });
  assert.equal(response.status, 200);
  return book_id;
}

/** A user of the suite's own (the e2e stack runs auth with AUTH_TEST_USERS). */
/** Log in a test user (made if new) with the tokens in the body, as a script would. */
export async function logIn(email: string) {
  const response = await fetch(`${BASE_URL}/api/auth/v1/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, delivery: "body" }),
  });
  assert.equal(response.status, 200);
  return (await response.json()) as {
    access_token: string;
    refresh_token: string;
    user: { id: string; email: string };
  };
}

export async function newUser() {
  const email = `e2e-${randomBytes(4).toString("hex")}@test.local`;
  const { access_token: token, user } = await logIn(email);
  const headers = { authorization: `Bearer ${token}` };
  return {
    id: user.id,
    email,
    token,
    ledger: createLedgerClient({ baseUrl: BASE_URL, headers }),
    app: (path: string, init: RequestInit = {}) =>
      fetch(`${BASE_URL}/api/app/v1${path}`, {
        ...init,
        headers: { ...headers, ...(init.headers as Record<string, string>) },
      }),
  };
}

/** Mailpit, the e2e stack's mail server: the link in the newest email to `to`. */
export async function linkMailedTo(to: string, kind: "reset" | "verify"): Promise<string> {
  const mailpit = process.env.MAILPIT_URL ?? "http://mailpit:8025";
  return eventually(async () => {
    const search = await fetch(
      `${mailpit}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`
    );
    const { messages } = (await search.json()) as { messages: { ID: string }[] };
    if (!messages.length) throw new Error(`no email to ${to} yet`);
    const message = await fetch(`${mailpit}/api/v1/message/${messages[0]!.ID}`);
    const { Text } = (await message.json()) as { Text: string };
    const token = new RegExp(`/ui/${kind}/([\\w-]+)`).exec(Text)?.[1];
    if (!token) throw new Error(`no ${kind} link in the newest email to ${to}`);
    return token;
  });
}
