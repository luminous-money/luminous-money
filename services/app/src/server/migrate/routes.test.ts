import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { NO_COST, type AiSettings, type CategorizeIn } from "@luminous-money/ai-api";
import { beforeEach, describe, expect, it } from "vitest";

import type { AiPort } from "../ai.js";
import { createApi } from "../api.js";
import { historyCategorizer } from "../categorize/history.js";
import { rules } from "../categorize/rules.js";
import { AppDb } from "../db.js";
import { FakeLedger } from "../testing.js";
import { historyFrom } from "./history.js";
import { MigrationStore, type Migration } from "./store.js";

const ROOTS = {
  Assets: "asset",
  Liabilities: "liability",
  Equity: "equity",
  Income: "income",
  Expenses: "expense",
} as const;

// GnuCash's exports, synthetic: an old checking account (the one linked here is another name),
// dining and groceries, and a history of both.
const TREE = [
  '"Type","Full Account Name","Account Name","Account Code","Description","Account Color","Notes","Symbol","Namespace","Hidden","Tax Info","Placeholder"',
  '"BANK","Assets:Current Assets:Checking Account","Checking Account","","","","","USD","CURRENCY","F","F","F"',
  '"EXPENSE","Expenses:Dining Out","Dining Out","","Restaurants and cafes","","","USD","CURRENCY","F","F","F"',
  '"EXPENSE","Expenses:Groceries","Groceries","","","","","USD","CURRENCY","F","F","F"',
].join("\n");
const CHECKING = "Assets:Current Assets:Checking Account";
const split = (date: string, id: string, description: string, account: string, value: string) =>
  `"${date}","${id}","","${description}","","CURRENCY::USD","","","","${account}","x","","${value}","","${value}","n","","1"`;
const HISTORY = [
  '"Date","Transaction ID","Number","Description","Notes","Commodity/Currency","Void Reason","Action","Memo","Full Account Name","Account Name","Amount With Sym","Amount Num.","Value With Sym","Value Num.","Reconcile","Reconcile Date","Rate/Price"',
  ...["01", "08", "15"].flatMap((day, i) => [
    split(`2026-06-${day}`, `c${i}`, "Corner Cafe", CHECKING, "-4.50"),
    split(`2026-06-${day}`, `c${i}`, "Corner Cafe", "Expenses:Dining Out", "4.50"),
    split(`2026-06-${day}`, `g${i}`, "Fake Grocer", CHECKING, "-60.00"),
    split(`2026-06-${day}`, `g${i}`, "Fake Grocer", "Expenses:Groceries", "60.00"),
  ]),
].join("\n");

let ledger: FakeLedger;
let db: AppDb;
let asked: CategorizeIn[];

/** The book's AI: ready, placing each transaction where the reference says its payee went. */
const ai: AiPort = {
  settings: async () => ({ ready: true, create_accounts: false }) as AiSettings,
  extract: async () => ({ failed: "not here" }),
  categorize: async (_book, input) => {
    asked.push(input);
    return {
      ok: {
        proposals: input.transactions.map((t) => {
          const known = input.reference?.find((r) =>
            (t.narration ?? "").toLowerCase().includes(r.payee.toLowerCase())
          );
          return {
            id: t.id,
            splits: [],
            fallback: known?.accounts[0]?.account ?? null,
            confidence: 0.85,
            reason: known ? "From the reference" : "No idea",
          };
        }),
        new_accounts: [],
        cost: { ...NO_COST, calls: 1, models: ["fake"], usd: 0.01 },
      },
    };
  },
  forgetBook: async () => {},
};

const waiting = (description: string, amount: string) =>
  ledger.addTransaction({
    date: "2026-07-02",
    flag: "!",
    payee: null,
    narration: description,
    tags: [],
    links: [],
    meta: {},
    postings: [
      { account: "Assets:Bank:Checking", units: { number: amount, currency: "USD" } },
      { account: "Expenses:Uncategorized", units: null },
    ],
  });

beforeEach(() => {
  asked = [];
  ledger = new FakeLedger();
  ledger.addBook("b");
  for (const [name, type] of Object.entries(ROOTS))
    ledger.addAccount(name, { type, kind: "node", implicit: true });
  ledger.addAccount("Assets:Bank:Checking", { type: "asset" });
  ledger.addAccount("Expenses:Uncategorized", { type: "expense" });
  db = new AppDb(join(mkdtempSync(join(tmpdir(), "app-")), "app.sqlite"));
});

function app() {
  const migrations = new MigrationStore(db.db);
  return createApi({
    db,
    ledgerFor: () => ledger,
    aiFor: () => ai,
    categorizers: [
      rules((book) => db.rules(book)),
      historyCategorizer((book) => historyFrom(migrations.history(book))),
    ],
  });
}

async function call<T = unknown>(path: string, method = "GET", body?: unknown) {
  const response = await app().request(`/api/app/v1/books/b/migration${path}`, {
    method,
    headers: { "x-user-id": "u", "content-type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, json: (await response.json()) as T };
}

describe("migrating from another system", () => {
  it("brings a chart and a history, then rules and suggestions from them", async () => {
    const cafe = waiting("SQ *CORNER CAFE #12 CHICAGO IL", "-5.25");
    const grocer = waiting("FAKE GROCER", "-71.10");
    expect((await call("")).json).toEqual({ migration: null });
    expect((await call("", "POST", { source: "gnucash" })).status).toBe(201);

    // The accounts: the old checking account is the one here.
    const choices = {
      "Assets:Current-Assets:Checking-Account": { same_as: "Assets:Bank:Checking" },
    };
    const preview = await call<{ add: { account: { name: string } }[] }>(
      "/accounts/preview",
      "POST",
      { text: TREE, choices }
    );
    expect(preview.json.add.map((p) => p.account.name)).toEqual([
      "Expenses:Dining-Out",
      "Expenses:Groceries",
    ]);
    const added = await call<{ migration: Migration }>("/accounts", "POST", {
      text: TREE,
      choices,
    });
    expect(added.json.migration).toMatchObject({
      step: "history",
      state: {
        accounts: { added: 2, existing: 1 },
        mapping: { [CHECKING]: "Assets:Bank:Checking" },
      },
    });
    expect(ledger.accountList.find((a) => a.name === "Expenses:Dining-Out")?.description).toBe(
      "Restaurants and cafes"
    );

    // The history, mapped and kept: already the history categorizer's.
    const history = await call<{ migration: Migration }>("/history", "POST", { text: HISTORY });
    expect(history.json.migration.state.history).toEqual({
      transactions: 6,
      from: "2026-06-01",
      to: "2026-06-15",
      problems: 0,
      voided: 0,
      unmapped: 0, // every account is the chart's
    });
    expect(new MigrationStore(db.db).history("b")[0]!.postings[0]!.account).toBe(
      "Assets:Bank:Checking"
    );

    // Bank feeds skipped, the AI set up, the reference shown and turned on.
    let m = history.json.migration;
    m = (await call<Migration>("", "PATCH", { updated_at: m.updated_at, bank: "skipped" })).json;
    expect(
      (await call("", "PATCH", { updated_at: history.json.migration.updated_at, ai: "done" }))
        .status
    ).toBe(409);
    m = (
      await call<Migration>("", "PATCH", {
        updated_at: m.updated_at,
        ai: "done",
        step: "reference",
      })
    ).json;
    const reference = await call<{ payees: number; top: { payee: string }[] }>("/reference");
    expect(reference.json).toMatchObject({
      payees: 2,
      top: [{ payee: "Corner Cafe" }, { payee: "Fake Grocer" }],
    });
    m = (await call<Migration>("", "PATCH", { updated_at: m.updated_at, reference: true })).json;
    expect(m.state.reference).toBe(true);

    // Rules: the bank's text has the city in it, so the café's rule goes by "contains".
    const suggested =
      await call<{ key: string; match: string; account: string; waiting: number }[]>("/rules");
    expect(suggested.json).toEqual([
      expect.objectContaining({
        key: "corner cafe",
        match: "contains",
        account: "Expenses:Dining-Out",
        waiting: 1,
      }),
      expect.objectContaining({
        key: "fake grocer",
        match: "key",
        account: "Expenses:Groceries",
        waiting: 1,
      }),
    ]);
    const made = await call<{ added: number }>("/rules", "POST", {
      rules: [{ ...suggested.json[0], payee: "Corner Cafe" }],
    });
    expect(made.json.added).toBe(1);
    expect(db.rules("b")[0]).toMatchObject({
      name: "Corner Cafe",
      conditions: { contains: "corner cafe", key: null },
      account: "Expenses:Dining-Out",
    });

    // Suggestions for everything uncategorized, in the background: the café by its new rule,
    // the grocer by imported history (or the AI's reference).
    expect((await call("/uncategorized")).json).toEqual({ count: 2 });
    expect((await call("/suggest", "POST")).status).toBe(202);
    let job: Migration["state"]["suggest"];
    for (let i = 0; i < 50; i++) {
      job = (await call<{ migration: Migration }>("")).json.migration.state.suggest;
      if (job !== "skipped" && job?.status !== "running") break;
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(job).toMatchObject({
      status: "done",
      total: 2,
      done: 2,
      suggested: 2,
      ai: true,
      ai_cost: 0.01, // one batch asked of it: the grocer (the café's rule settled it)
    });
    expect(cafe.postings[1]!.account).toBe("Expenses:Dining-Out");
    expect(grocer.postings[1]!.account).toBe("Expenses:Groceries");
    // The AI was asked with the reference for the grocer (the café's rule settled it first).
    expect(asked.flatMap((a) => a.reference ?? []).map((r) => r.payee)).toContain("Fake Grocer");

    m = (await call<{ migration: Migration }>("")).json.migration;
    m = (
      await call<Migration>("", "PATCH", { updated_at: m.updated_at, step: "finish", done: true })
    ).json;
    expect(m.done).toBe(true);
  });

  it("is a manager's", async () => {
    ledger.books.get("b")!.role = "write";
    expect((await call("", "POST", {})).status).toBe(403);
    ledger.books.get("b")!.role = "read";
    expect((await call("")).status).toBe(200);
  });

  it("follows the book's accounts: imported history is renamed with them", async () => {
    const store = new MigrationStore(db.db);
    store.start("b", "u", "gnucash");
    store.replaceHistory("b", [
      {
        source_id: "x",
        date: "2026-01-01",
        description: "Fake Grocer",
        postings: [
          { account: "Assets:Bank:Checking", amount: "-1.00", currency: "USD", memo: null },
          { account: "Expenses:Groceries", amount: "1.00", currency: "USD", memo: null },
        ],
      },
    ]);
    db.renameAccount("b", "Expenses:Groceries", "Expenses:Food:Groceries");
    expect(store.history("b")[0]!.postings[1]!.account).toBe("Expenses:Food:Groceries");
    db.forgetBook("b");
    expect(store.history("b")).toEqual([]);
    expect(store.migration("b")).toBeUndefined();
  });
});
