/**
 * Shared setup for the end-to-end suite. Everything goes through Traefik at FAVA_BEANS_URL, the
 * same single entry point an operator exposes, using the generated ledger client.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

import { createLedgerClient } from "@fava-beans/ledger-client";

export const BASE_URL = process.env.FAVA_BEANS_URL ?? "http://localhost:8080";

export const ledger = createLedgerClient({ baseUrl: BASE_URL });

/**
 * Request options for endpoints that take Beancount text. openapi-fetch serializes bodies as JSON
 * by default; these pass the text through unchanged.
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
      const response = await fetch(`${BASE_URL}/api/ledger/v1/books`);
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

export function staged(narration: string, amount = "4.50"): string {
  return `2024-03-01 ! "Corner Cafe" "${narration}"\n  Expenses:Food  ${amount} USD\n  Assets:Bank:Checking\n`;
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
