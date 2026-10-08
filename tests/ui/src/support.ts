/** Seeds a fresh book per test through the ledger API, so tests never share state. */
import { randomBytes } from "node:crypto";

import {
  createLedgerClient,
  type Transaction,
  type TransactionIn,
} from "@fava-beans/ledger-client";

const ledger = createLedgerClient({
  baseUrl: process.env.FAVA_BEANS_URL ?? "http://localhost:8080",
});

const OPENING = `\
option "operating_currency" "USD"
2024-01-01 open Assets:Bank:Checking USD
2024-01-01 open Liabilities:Card USD
2024-01-01 open Expenses:Uncategorized
2024-01-01 open Expenses:Food:Groceries
2024-01-01 open Expenses:Food:Restaurant
2024-01-01 open Expenses:Home:Supplies
`;

const usd = (number: string) => ({ number, currency: "USD" });

/** What a bank feed would stage: one anchored amount, the other side to categorize. */
const STAGED: TransactionIn[] = [
  {
    date: "2024-03-01",
    flag: "!",
    payee: "Corner Cafe",
    narration: "Coffee",
    postings: [
      { account: "Liabilities:Card", units: usd("-4.50") },
      { account: "Expenses:Uncategorized" },
    ],
  },
  {
    date: "2024-03-02",
    flag: "!",
    payee: "Grocer",
    narration: "Weekly shop",
    postings: [
      { account: "Assets:Bank:Checking", units: usd("-82.10") },
      { account: "Expenses:Food:Groceries", units: usd("82.10") },
    ],
  },
  {
    date: "2024-03-03",
    flag: "!",
    payee: "Costco",
    narration: "Bulk run",
    postings: [
      { account: "Liabilities:Card", units: usd("-150.00") },
      { account: "Expenses:Uncategorized" },
    ],
  },
];

export type Seeded = { book: string; ids: Record<string, string> };

export async function seedBook(): Promise<Seeded> {
  const book = `ui-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
  await ledger.POST("/api/ledger/v1/books/{book_id}/import", {
    params: { path: { book_id: book } },
    body: OPENING,
    bodySerializer: (body: string) => body,
    headers: { "content-type": "text/plain" },
  });
  const ids: Record<string, string> = {};
  for (const body of STAGED) {
    const { data } = await ledger.POST("/api/ledger/v1/books/{book_id}/transactions", {
      params: { path: { book_id: book } },
      body,
    });
    ids[body.payee!] = data!.id;
  }
  return { book, ids };
}

export async function stored(book: string, id: string): Promise<Transaction> {
  const { data } = await ledger.GET("/api/ledger/v1/books/{book_id}/transactions/{directive_id}", {
    params: { path: { book_id: book, directive_id: id } },
  });
  return data!;
}

export async function problems(book: string) {
  const { data } = await ledger.GET("/api/ledger/v1/books/{book_id}/problems", {
    params: { path: { book_id: book } },
  });
  return data!;
}
