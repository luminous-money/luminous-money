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
} from "@luminous-money/ledger-client";

const BASE_URL = process.env.LUMINOUS_MONEY_URL ?? "http://localhost:8080";

export type Session = { email: string; token: string; ledger: LedgerClient };

/** The session the helpers below act as: the last one `logIn` started in this worker. */
let current: Session;

/** Log `page` in as a brand-new user, and act as them from here on. */
export async function logIn(page: Page): Promise<Session> {
  const email = `ui-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}@test.local`;
  // The page's session (cookies), and one for the helpers (tokens in the body, as a script).
  await page.request.post("/api/auth/v1/login", { data: { email } });
  const response = await page.request.post("/api/auth/v1/login", {
    data: { email, delivery: "body" },
  });
  const { access_token: token } = (await response.json()) as { access_token: string };
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

/** Call the app API as the current session's user. */
export function app(path: string, init: RequestInit = {}) {
  return fetch(`${BASE_URL}/api/app/v1${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${current.token}`,
      ...(init.headers as Record<string, string>),
    },
  });
}

/** Add a starred account to `book`, with an opening balance on 2024-01-01 if `balance` is given. */
export async function addAccount(book: string, account: string, balance: string | null) {
  await current.ledger.POST("/api/ledger/v1/books/{book_id}/accounts", {
    params: { path: { book_id: book } },
    body: {
      name: account,
      kind: "leaf",
      opening_balance:
        balance === null ? null : { amount: balance, currency: "USD", date: "2024-01-01" },
    },
  });
  await app(`/books/${book}/stars/${encodeURIComponent(account)}`, { method: "PUT" });
  return account;
}

/** A new user with a book and one starred bank account (opened 2024-01-01 at 1,000.00). */
export async function setUpUser(
  page: Page,
  { name = "Kael Personal", account = "Assets:Bank:PNC-Checking" } = {}
) {
  const session = await logIn(page);
  const { data: book } = await session.ledger.POST("/api/ledger/v1/books", { body: { name } });
  await addAccount(book!.id, account, "1000.00");
  return { session, book: book!, account };
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

/** Import Beancount text into `book` as the current user. */
export async function importText(book: string, text: string) {
  const response = await fetch(`${BASE_URL}/api/ledger/v1/books/${book}/import`, {
    method: "POST",
    headers: { authorization: `Bearer ${current.token}`, "content-type": "text/plain" },
    body: text,
  });
  if (!response.ok) throw new Error(`import failed: ${response.status} ${await response.text()}`);
}

/** Mailpit, the e2e stack's mail server: the link in the newest email to `to`. */
export async function linkMailedTo(to: string, kind: "reset" | "verify"): Promise<string> {
  const mailpit = process.env.MAILPIT_URL ?? "http://mailpit:8025";
  for (let i = 0; i < 40; i++) {
    const search = await fetch(
      `${mailpit}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`
    );
    const { messages } = (await search.json()) as { messages: { ID: string }[] };
    if (messages.length) {
      const { Text } = (await (
        await fetch(`${mailpit}/api/v1/message/${messages[0]!.ID}`)
      ).json()) as {
        Text: string;
      };
      const link = new RegExp(`/ui/${kind}/[\\w-]+`).exec(Text)?.[0];
      if (link) return link;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`no ${kind} email to ${to}`);
}
