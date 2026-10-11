/**
 * Each test logs in a user of its own (the e2e stack runs auth with AUTH_TEST_USERS), through the
 * browser, so the page has the session cookie, and seeds a fresh book as that user through the
 * ledger API. Tests never share state.
 */
import { randomBytes } from "node:crypto";

import type { Page } from "@playwright/test";
import {
  createLedgerClient,
  type LedgerClient,
  type Transaction,
  type TransactionIn,
} from "@fava-beans/ledger-client";

const BASE_URL = process.env.FAVA_BEANS_URL ?? "http://localhost:8080";

export type Session = { email: string; token: string; ledger: LedgerClient };

/** The session the helpers below act as: the last one `logIn` started in this worker. */
let current: Session;

/** Log `page` in as a brand-new user, and act as them from here on. */
export async function logIn(page: Page): Promise<Session> {
  const email = `ui-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}@test.local`;
  const response = await page.request.post("/api/auth/v1/login", { data: { email } });
  const { token } = (await response.json()) as { token: string };
  const ledger = createLedgerClient({
    baseUrl: BASE_URL,
    headers: { authorization: `Bearer ${token}` },
  });
  current = { email, token, ledger };
  return current;
}

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

/** Log in a new user and give them a book with three staged transactions. */
export async function seedBook(page: Page): Promise<Seeded> {
  const { ledger } = await logIn(page);
  const book = `ui-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
  await ledger.POST("/api/ledger/v1/books/{book_id}/import", {
    params: { path: { book_id: book } },
    body: OPENING,
    bodySerializer: (body: string) => body,
    headers: { "content-type": "text/plain" },
  });
  const ids: Record<string, string> = {};
  for (const body of STAGED) {
    const { data } = await current.ledger.POST("/api/ledger/v1/books/{book_id}/transactions", {
      params: { path: { book_id: book } },
      body,
    });
    ids[body.payee!] = data!.id;
  }
  return { book, ids };
}

export async function stored(book: string, id: string): Promise<Transaction> {
  const { data } = await current.ledger.GET(
    "/api/ledger/v1/books/{book_id}/transactions/{directive_id}",
    {
      params: { path: { book_id: book, directive_id: id } },
    }
  );
  return data!;
}

export async function accounts(book: string) {
  const { data } = await current.ledger.GET("/api/ledger/v1/books/{book_id}/accounts", {
    params: { path: { book_id: book } },
  });
  return data!;
}

export async function problems(book: string) {
  const { data } = await current.ledger.GET("/api/ledger/v1/books/{book_id}/problems", {
    params: { path: { book_id: book } },
  });
  return data!;
}

/** A new user with a book and one bank account (opened 2024-01-01 at 1,000.00), ready to use. */
export async function setUpUser(
  page: Page,
  { name = "Kael Personal", account = "PNC Checking" } = {}
) {
  const session = await logIn(page);
  const { data: book } = await session.ledger.POST("/api/ledger/v1/books", { body: { name } });
  const { data: money } = await session.ledger.POST(
    "/api/ledger/v1/books/{book_id}/money-accounts",
    {
      params: { path: { book_id: book!.id } },
      body: {
        display_name: account,
        money: "bank",
        currency: "USD",
        balance: "1000.00",
        as_of: "2024-01-01",
      },
    }
  );
  return { session, book: book!, account: money!.name };
}

/** Add transactions to an account in one write, `count` of them, a day apart from 2024-02-01. */
export async function addTransactions(book: string, account: string, count: number) {
  const body: TransactionIn[] = Array.from({ length: count }, (_, i) => ({
    date: new Date(Date.UTC(2024, 1, 1) + i * 864e5).toISOString().slice(0, 10),
    flag: "*",
    payee: `Shop ${i + 1}`,
    narration: "",
    postings: [{ account, units: usd("-1.00") }, { account: "Expenses:Food:Groceries" }],
  }));
  await current.ledger.POST("/api/ledger/v1/books/{book_id}/accounts", {
    params: { path: { book_id: book } },
    body: { name: "Expenses:Food:Groceries", kind: "leaf" },
  });
  await current.ledger.POST("/api/ledger/v1/books/{book_id}/transactions/batch", {
    params: { path: { book_id: book } },
    body,
  });
}
