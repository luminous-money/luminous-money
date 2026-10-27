import { mkdtempSync } from "node:fs";
import { createServer, type IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { guessProfile } from "@luminous-money/csv-import";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { CategorizeRequest, HistoryTransaction } from "../../shared/categorizer-api.js";
import type { RuleConditions } from "../../shared/rules.js";
import { AppDb } from "../db.js";
import { importFile } from "../imports.js";
import { FakeLedger } from "../testing.js";
import { categorize, placed, SETTLE } from "./chain.js";
import { external, providersFrom } from "./external.js";
import { history, historyCategorizer } from "./history.js";
import { items } from "./items.js";
import { rules } from "./rules.js";
import { applyRule, coveredBy, settle, suggestUnconfirmed } from "./service.js";
import type { Categorizer, Incoming, Request } from "./types.js";

const CHECKING = "Assets:Bank:Checking";
const usd = (number: string) => ({ number, currency: "USD" });

const ACCOUNTS = [
  CHECKING,
  "Liabilities:Card",
  "Expenses:Food:Coffee",
  "Expenses:Food:Groceries",
  "Expenses:Uncategorized",
].map((name) => ({ name, type: null, kind: "leaf" as const, open: null, close: null }));

let next = 0;
const past = (
  narration: string,
  other: string,
  { account = CHECKING, flag = "*", payee = null as string | null, date = "2024-01-01" } = {}
): HistoryTransaction => ({
  id: `h${next++}`,
  date,
  flag,
  payee,
  narration,
  postings: [
    { account, amount: usd("-4.50") },
    { account: other, amount: usd("4.50") },
  ],
});

const row = (description: string, account = CHECKING): Incoming => ({
  id: `r${next++}`,
  date: "2024-03-01",
  account,
  amount: usd("-4.50"),
  description,
  payee: null,
  splits: [{ index: 1, amount: usd("4.50"), memo: null }],
});

const request = (rows: Incoming[], historyRows: HistoryTransaction[] = []): Request => ({
  api_version: "1",
  request_id: "q",
  book: { id: "b", name: "Book" },
  transactions: rows,
  context: { from: "2023-01-01", accounts: ACCOUNTS, history: historyRows },
});

const fixed = (name: string, proposals: (t: Incoming) => object[]): Categorizer => ({
  name,
  async categorize(r) {
    return { proposals: r.transactions.flatMap((t) => proposals(t)) as never };
  },
});

describe("the chain", () => {
  it("stops asking once a row is settled, and picks the most confident postings and payee", async () => {
    const coffee = row("CORNER CAFE");
    const tea = row("TEA HOUSE");
    const asked: string[][] = [];
    const sure = fixed("sure", (t) =>
      t.id === coffee.id
        ? [
            {
              id: t.id,
              postings: [{ account: "Expenses:Food:Coffee" }],
              confidence: SETTLE,
              reason: "sure",
            },
          ]
        : []
    );
    const later: Categorizer = {
      name: "later",
      async categorize(r) {
        asked.push(r.transactions.map((t) => t.id));
        return {
          proposals: r.transactions.flatMap((t) => [
            {
              id: t.id,
              postings: [{ account: "Expenses:Food:Groceries" }],
              confidence: 0.2,
              reason: "a guess",
            },
            { id: t.id, payee: "Tea House", confidence: 0.4, reason: "a name" },
          ]),
        };
      },
    };

    const decided = await categorize([sure, later], request([coffee, tea]));

    expect(asked).toEqual([[tea.id]]);
    expect(decided.get(coffee.id)!.category).toMatchObject({ categorizer: "sure" });
    expect(decided.get(tea.id)!.category).toMatchObject({ categorizer: "later", confidence: 0.2 }); // weak still fills
    expect(decided.get(tea.id)!.payee).toMatchObject({ payee: "Tea House" });
  });

  it("drops proposals it can't use, and carries on past a failing categorizer", async () => {
    const t = row("X");
    const logs: string[] = [];
    const broken: Categorizer = {
      name: "broken",
      async categorize() {
        throw new Error("down");
      },
    };
    const bad = fixed("bad", (x) => [
      { id: x.id, postings: [{ account: "Expenses:Nope" }], confidence: 1, reason: "" },
      {
        id: x.id,
        postings: [
          { account: "Expenses:Food:Coffee", amount: usd("1.00") },
          { account: "Expenses:Food:Groceries", amount: usd("1.00") },
        ],
        confidence: 1,
        reason: "",
      },
      { id: x.id, postings: [{ account: "Expenses:Food:Coffee" }], confidence: 2, reason: "" },
      { id: "nobody", postings: [{ account: "Expenses:Food:Coffee" }], confidence: 1, reason: "" },
    ]);

    const decided = await categorize([broken, bad], request([t]), (m) => logs.push(m));

    expect(decided.get(t.id)).toEqual({ category: undefined, payee: undefined });
    expect(logs).toHaveLength(5);
  });

  it("accepts a balanced split", async () => {
    const t = row("COSTCO");
    const split = fixed("split", (x) => [
      {
        id: x.id,
        postings: [
          { account: "Expenses:Food:Coffee", amount: usd("1.50") },
          { account: "Expenses:Food:Groceries", amount: usd("3.00") },
        ],
        confidence: 0.7,
        reason: "",
      },
    ]);

    const decided = await categorize([split], request([t]));

    expect(decided.get(t.id)!.category!.postings).toHaveLength(2);
  });
});

describe("history", () => {
  const propose = async (t: Incoming, h: HistoryTransaction[]) =>
    (await history.categorize(request([t], h))).proposals[0];

  it("learns from imported history after the book's own, less sure, toward open leaves", async () => {
    const imported = [
      past("Corner Cafe", "Expenses:Food:Coffee", { account: "Assets:Old-Bank:Checking" }),
      past("Corner Cafe", "Expenses:Food:Coffee", { account: "Assets:Old-Bank:Checking" }),
      past("Fake Grocer", "Expenses:Gone"), // not an account here: not learned
    ];
    const withImported = historyCategorizer(() => imported);
    const ask = async (t: Incoming, own: HistoryTransaction[] = []) =>
      (await withImported.categorize(request([t], own))).proposals[0];

    const cafe = await ask(row("CORNER CAFE"));
    expect(cafe).toMatchObject({ postings: [{ account: "Expenses:Food:Coffee" }] });
    // Another account's (the old checking), from imported history: 2/2 × 2/3 × 0.8 × 0.8.
    expect(cafe!.confidence).toBeCloseTo((2 / 3) * 0.8 * 0.8);
    expect(cafe!.reason).toBe('2 of 2 past (imported) "corner cafe" → Expenses:Food:Coffee');
    expect(await ask(row("FAKE GROCER"))).toBeUndefined();
    // The book's own history wins.
    const own = await ask(row("CORNER CAFE"), [past("CORNER CAFE", "Expenses:Food:Groceries")]);
    expect(own).toMatchObject({ postings: [{ account: "Expenses:Food:Groceries" }] });
  });

  it("proposes what the same payee was confirmed as, more sure with more agreement", async () => {
    const h = [
      ...Array.from({ length: 8 }, () =>
        past("POS DEBIT CORNER CAFE #42 CHICAGO IL", "Expenses:Food:Coffee")
      ),
      past("CORNER CAFE CHICAGO", "Expenses:Food:Groceries", {
        date: "2024-02-01",
        payee: "Corner Cafe",
      }),
      past("CORNER CAFE CHICAGO", "Expenses:Food:Coffee", { flag: "!" }), // unconfirmed: not learned
      past("CORNER CAFE CHICAGO", "Expenses:Uncategorized"), // uncategorized: not learned
    ];

    const p = await propose(row("CORNER CAFE #57 CHICAGO IL"), h);

    expect(p).toMatchObject({
      postings: [{ account: "Expenses:Food:Coffee" }],
      payee: "Corner Cafe",
    });
    expect(p!.confidence).toBeCloseTo((8 / 9) * (9 / 10));
    expect(p!.reason).toBe('8 of 9 past "corner cafe chicago" → Expenses:Food:Coffee');
  });

  it("is less sure from one example, a similar payee, or another account", async () => {
    const one = await propose(row("CORNER CAFE"), [past("CORNER CAFE", "Expenses:Food:Coffee")]);
    const similar = await propose(row("CORNER CAFE EVANSTON"), [
      past("CORNER CAFE NORTH EVANSTON", "Expenses:Food:Coffee"),
    ]);
    const elsewhere = await propose(row("CORNER CAFE"), [
      past("CORNER CAFE", "Expenses:Food:Coffee", { account: "Liabilities:Card" }),
    ]);

    expect(one!.confidence).toBe(0.5);
    expect(similar!.confidence).toBeCloseTo(0.5 * 0.8);
    expect(elsewhere!.confidence).toBeCloseTo(0.5 * 0.8);
    expect(
      await propose(row("SOMEWHERE NEW"), [past("CORNER CAFE", "Expenses:Food:Coffee")])
    ).toBeUndefined();
  });
});

describe("rules", () => {
  const rule = (id: string, conditions: Partial<RuleConditions>, account: string, extra = {}) => ({
    id,
    book_id: "b",
    name: id,
    conditions: { account: null, key: null, contains: null, min: null, max: null, ...conditions },
    account,
    payee: null,
    auto_confirm: false,
    applied: 0,
    created_at: id,
    updated_at: id,
    ...extra,
  });

  it("the most specific matching rule wins, settling with full confidence", async () => {
    const all = [
      rule("a", { contains: "cafe" }, "Expenses:Food:Groceries"),
      rule("b", { contains: "cafe", account: CHECKING, max: "-1" }, "Expenses:Food:Coffee", {
        payee: "Corner Cafe",
        auto_confirm: true,
      }),
      rule("c", { contains: "cafe", min: "0" }, "Expenses:Food:Groceries"), // money in only
    ];

    const [p] = (await rules(() => all).categorize(request([row("CORNER CAFE")]))).proposals;

    expect(p).toMatchObject({
      postings: [{ account: "Expenses:Food:Coffee" }],
      payee: "Corner Cafe",
      confidence: 1,
      auto_confirm: true,
      rule_id: "b",
      reason: 'Rule "b"',
    });
  });

  it("matches payee keys exactly", async () => {
    const all = [rule("k", { key: "corner cafe chicago" }, "Expenses:Food:Coffee")];
    const r = rules(() => all);

    expect(
      (await r.categorize(request([row("POS CORNER CAFE #1 CHICAGO IL")]))).proposals
    ).toHaveLength(1);
    expect((await r.categorize(request([row("CORNER CAFE EVANSTON")]))).proposals).toHaveLength(0);
  });
});

describe("external providers", () => {
  let server: ReturnType<typeof createServer>;
  let url: string;
  let received: { path: string; auth?: string; body: unknown }[];
  let answer: (body: CategorizeRequest) => unknown;
  let delay = 0;

  const read = async (req: IncomingMessage) => {
    let text = "";
    for await (const chunk of req) text += chunk;
    return JSON.parse(text);
  };

  beforeEach(async () => {
    received = [];
    delay = 0;
    server = createServer(async (req, res) => {
      const body = await read(req);
      received.push({ path: req.url!, auth: req.headers.authorization, body });
      await new Promise((r) => setTimeout(r, delay));
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(req.url === "/v1/categorize" ? answer(body) : {}));
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const address = server.address() as { port: number };
    url = `http://127.0.0.1:${address.port}`;
  });
  afterEach(() => server.close());

  it("posts the request, with the token, and can't auto-confirm", async () => {
    answer = (body) => ({
      proposals: body.transactions.map((t) => ({
        id: t.id,
        postings: [{ account: "Expenses:Food:Coffee" }],
        confidence: 0.8,
        reason: "coffee",
        auto_confirm: true,
      })),
    });
    const provider = external({ name: "llm", url: `${url}/`, token: "secret", feedback: true });
    const t = row("CORNER CAFE");

    const decided = await categorize([provider], request([t]));
    await provider.feedback!({ api_version: "1", book: { id: "b", name: "Book" }, outcomes: [] });

    expect(received.map((r) => [r.path, r.auth])).toEqual([
      ["/v1/categorize", "Bearer secret"],
      ["/v1/feedback", "Bearer secret"],
    ]);
    expect((received[0]!.body as CategorizeRequest).transactions[0]!.description).toBe(
      "CORNER CAFE"
    );
    // The API's own shape (v1): no splits.
    expect((received[0]!.body as CategorizeRequest).transactions[0]).not.toHaveProperty("splits");
    expect(decided.get(t.id)!.category).toMatchObject({ categorizer: "llm", confidence: 0.8 });
    expect(decided.get(t.id)!.category!.auto_confirm).toBeUndefined();
  });

  it("is skipped when it's too slow", async () => {
    delay = 300;
    answer = () => ({ proposals: [] });
    const logs: string[] = [];

    await categorize([external({ name: "slow", url, timeout_ms: 50 })], request([row("X")]), (m) =>
      logs.push(m)
    );

    expect(logs[0]).toMatch(/slow failed/);
  });

  it("are configured from CATEGORIZERS", () => {
    expect(providersFrom(undefined)).toEqual([]);
    expect(providersFrom('[{"name": "llm", "url": "http://llm:8080"}]')).toEqual([
      { name: "llm", url: "http://llm:8080" },
    ]);
    expect(() => providersFrom('[{"name": "history", "url": "http://x"}]')).toThrow(/taken/);
    expect(() => providersFrom('[{"name": "a"}]')).toThrow(/url/);
  });
});

describe("importing with categorization", () => {
  let db: AppDb;
  let ledger: FakeLedger;
  const FILE =
    "Date,Description,Amount,Balance\n03/05/2024,CORNER CAFE,-4.50,1\n03/06/2024,MYSTERY,-9.00,1\n";

  beforeEach(() => {
    db = new AppDb(join(mkdtempSync(join(tmpdir(), "app-")), "app.sqlite"));
    ledger = new FakeLedger();
    ledger.addBook("b");
    for (const a of [CHECKING, "Expenses:Food:Coffee"]) ledger.addAccount(a);
    db.replaceProfiles("b", CHECKING, [guessProfile(FILE)!]);
    ledger.addTransaction({
      date: "2024-02-01",
      flag: "*",
      payee: "Corner Cafe",
      narration: "CORNER CAFE",
      postings: [
        { account: CHECKING, units: usd("-3.00") },
        { account: "Expenses:Food:Coffee", units: usd("3.00") },
      ],
    });
  });

  const run = () =>
    importFile({
      db,
      ledger,
      book: "b",
      account: CHECKING,
      filename: "f.csv",
      text: FILE,
      userId: "u",
      categorizers: [rules((b) => db.rules(b)), history],
    });

  it("stages each row with the best proposal, recording it for review", async () => {
    const result = await run();

    const [coffee, mystery] = result.rows;
    expect(coffee!.proposal).toMatchObject({
      categorizer: "history",
      accounts: ["Expenses:Food:Coffee"],
      payee: "Corner Cafe",
    });
    expect(mystery!.proposal).toBeNull();
    const staged = ledger.transactions.find((t) => t.id === coffee!.transaction_id)!;
    expect([staged.flag, staged.payee, staged.postings[1]!.account]).toEqual([
      "!",
      "Corner Cafe",
      "Expenses:Food:Coffee",
    ]);
    // The side proposed is a split still to confirm; the bank's isn't (M16).
    expect(staged.postings.map((p) => p.flag ?? null)).toEqual([null, "!"]);
    expect(
      ledger.transactions.find((t) => t.id === mystery!.transaction_id)!.postings[1]!.account
    ).toBe("Expenses:Uncategorized");
    expect(db.openProposals("b").map((p) => p.categorizer)).toEqual(["history"]);
    expect(db.rows(result.batch.id)[0]!.proposal).toMatchObject({ categorizer: "history" });
  });

  it("a rule that confirms automatically stages the transaction confirmed, and counts its use", async () => {
    const id = db.addRule("b", {
      name: "Mystery",
      conditions: { account: null, key: null, contains: "mystery", min: null, max: null },
      account: "Expenses:Food:Coffee",
      payee: "Mystery Shop",
      auto_confirm: true,
    });

    const result = await run();

    const staged = ledger.transactions.find((t) => t.id === result.rows[1]!.transaction_id)!;
    expect([staged.flag, staged.payee]).toEqual(["*", "Mystery Shop"]);
    expect(staged.postings.some((p) => p.flag)).toBe(false); // confirmed: its splits too
    expect(db.rule("b", id)!.applied).toBe(1);
  });
});

describe("unconfirmed transactions", () => {
  let db: AppDb;
  let ledger: FakeLedger;
  const book = { id: "b", name: "Book" };
  const unconfirmed = (narration: string, other = "Expenses:Uncategorized") =>
    ledger.addTransaction({
      date: "2024-03-05",
      flag: "!",
      narration,
      postings: [{ account: CHECKING, units: usd("-4.50") }, { account: other }],
    });

  beforeEach(() => {
    db = new AppDb(join(mkdtempSync(join(tmpdir(), "app-")), "app.sqlite"));
    ledger = new FakeLedger();
    ledger.addBook("b");
    for (const a of [CHECKING, "Expenses:Food:Coffee", "Expenses:Food:Groceries"])
      ledger.addAccount(a);
    ledger.addTransaction({
      date: "2024-02-01",
      flag: "*",
      payee: "Corner Cafe",
      narration: "CORNER CAFE",
      postings: [
        { account: CHECKING, units: usd("-3.00") },
        { account: "Expenses:Food:Coffee", units: usd("3.00") },
      ],
    });
  });

  it("Suggest categories fills in the ones not yet categorized, leaving decided ones", async () => {
    const open = unconfirmed("CORNER CAFE");
    const decided = unconfirmed("CORNER CAFE", "Expenses:Food:Groceries"); // the user chose this

    const n = await suggestUnconfirmed({ db, ledger, book, categorizers: [history] });

    expect(n).toBe(1);
    expect([open.payee, open.postings[1]!.account]).toEqual([
      "Corner Cafe",
      "Expenses:Food:Coffee",
    ]);
    expect(decided.postings[1]!.account).toBe("Expenses:Food:Groceries");
  });

  it("Suggest categories asks again about a split still flagged, not one the user chose", async () => {
    const proposed = ledger.addTransaction({
      date: "2024-03-05",
      flag: "!",
      narration: "CORNER CAFE",
      postings: [
        { account: CHECKING, units: usd("-4.50") },
        { account: "Expenses:Food:Groceries", flag: "!" },
      ],
    });

    expect(await suggestUnconfirmed({ db, ledger, book, categorizers: [history] })).toBe(1);
    expect(proposed.postings[1]).toMatchObject({ account: "Expenses:Food:Coffee", flag: "!" });
  });

  it("Suggest categories for a selection asks about it alone, opening what a proposal needs", async () => {
    const picked = unconfirmed("CORNER CAFE");
    const other = unconfirmed("CORNER CAFE");
    const asked: string[][] = [];
    const ai: Categorizer = {
      name: "ai",
      async categorize(r) {
        asked.push(r.transactions.map((t) => t.id));
        return {
          proposals: r.transactions.map((t) => ({
            id: t.id,
            splits: [{ index: 1, account: "Expenses:Food:Cafes" }],
            opens: ["Expenses:Food:Cafes"],
            confidence: 0.8,
            reason: "a cafe",
          })),
        };
      },
    };

    expect(
      await suggestUnconfirmed({ db, ledger, book, categorizers: [ai], ids: [picked.id] })
    ).toBe(1);

    expect(asked).toEqual([[picked.id]]);
    expect(ledger.created).toContain("Expenses:Food:Cafes");
    expect(picked.postings[1]).toMatchObject({ account: "Expenses:Food:Cafes", flag: "!" });
    expect(other.postings[1]!.account).toBe("Expenses:Uncategorized");
  });

  it("a rule re-applies to what it covers that hasn't been touched, and counts", async () => {
    const open = unconfirmed("TEA HOUSE");
    const id = db.addRule("b", {
      name: "Tea",
      conditions: { account: null, key: null, contains: "tea", min: null, max: null },
      account: "Expenses:Food:Coffee",
      payee: "Tea House",
      auto_confirm: true,
    });

    expect(await coveredBy({ db, ledger, book }, db.rule("b", id)!)).toHaveLength(1);
    expect(await applyRule({ db, ledger, book }, db.rule("b", id)!)).toBe(1);
    expect([open.flag, open.payee, open.postings[1]!.account]).toEqual([
      "*",
      "Tea House",
      "Expenses:Food:Coffee",
    ]);
    expect(db.rule("b", id)!.applied).toBe(1);
  });

  it("settling records whether the proposal was kept, and gives feedback", async () => {
    const kept = unconfirmed("CORNER CAFE");
    const changed = unconfirmed("CORNER CAFE");
    const told: unknown[] = [];
    const provider: Categorizer = {
      name: "history",
      categorize: history.categorize,
      feedback: async (r) => void told.push(...r.outcomes),
    };
    await suggestUnconfirmed({ db, ledger, book, categorizers: [provider] });
    kept.flag = "*";
    changed.flag = "*";
    changed.postings[1]!.account = "Expenses:Food:Groceries";

    await settle({ db, ledger, book, categorizers: [provider], transaction: kept.id });
    await settle({ db, ledger, book, categorizers: [provider], transaction: changed.id });

    expect(db.acceptance("b")).toEqual([{ categorizer: "history", settled: 2, accepted: 1 }]);
    expect(told).toEqual([
      expect.objectContaining({ accepted: true, id: kept.id }),
      expect.objectContaining({
        accepted: false,
        final: expect.objectContaining({
          postings: [{ account: "Expenses:Food:Groceries", amount: null }],
        }),
      }),
    ]);
  });
});

describe("splits (M16)", () => {
  const receipt = (): Incoming => ({
    id: `r${next++}`,
    date: "2024-03-01",
    account: "Liabilities:Card",
    amount: usd("-23.50"),
    description: "Jewel-Osco",
    payee: "Jewel-Osco",
    splits: [
      { index: 1, amount: usd("9.99"), memo: "EGGS HPPY 18" },
      { index: 2, amount: usd("9.99"), memo: "MILK FRD ORG GAL" },
      { index: 3, amount: usd("3.52"), memo: "TAX" },
    ],
  });
  const postings = (t: Incoming) => [
    { account: t.account, units: t.amount },
    ...t.splits.map((s) => ({ account: "Expenses:Uncategorized", units: s.amount })),
  ];

  it("a fallback settles no split; each takes its own proposal, else the fallback", async () => {
    const t = receipt();
    const asked: number[][] = [];
    const watching = (name: string, propose: (t: Incoming) => object[]) => ({
      ...fixed(name, propose),
      async categorize(r: Request) {
        asked.push(r.transactions[0]!.splits.map((s) => s.index));
        return { proposals: r.transactions.flatMap((x) => propose(x)) as never };
      },
    });
    const chain = [
      watching("rules", (x) => [
        { id: x.id, postings: [{ account: "Expenses:Food:Groceries" }], confidence: 1, reason: "" },
      ]),
      watching("items", (x) => [
        {
          id: x.id,
          splits: [{ index: 1, account: "Expenses:Food:Coffee" }],
          confidence: 0.95,
          reason: "",
        },
      ]),
      watching("ai", (x) => [
        {
          id: x.id,
          splits: [{ index: 2, account: "Expenses:Food:Coffee" }],
          confidence: 0.6,
          reason: "",
        },
      ]),
    ];

    const decision = (await categorize(chain, request([t]))).get(t.id)!;

    // The rule's answer didn't stop the others; a confident split was settled.
    expect(asked).toEqual([
      [1, 2, 3],
      [1, 2, 3],
      [2, 3],
    ]);
    expect(placed(postings(t), t, decision).map((p) => [p.account, p.flag ?? null])).toEqual([
      ["Liabilities:Card", null],
      ["Expenses:Food:Coffee", "!"],
      ["Expenses:Food:Coffee", "!"],
      ["Expenses:Food:Groceries", "!"],
    ]);
  });

  it("a fallback fills what's uncategorized, never a split placed by name", () => {
    const t = receipt();
    const before = postings(t).map((p, i) =>
      i === 1 ? { ...p, account: "Expenses:Food:Coffee" } : p
    );
    const fallback = {
      id: t.id,
      postings: [{ account: "Expenses:Food:Groceries" }],
      confidence: 1,
      reason: "",
      categorizer: "rules",
    };

    expect(placed(before, t, { category: fallback }).map((p) => p.account)).toEqual([
      "Liabilities:Card",
      "Expenses:Food:Coffee",
      "Expenses:Food:Groceries",
      "Expenses:Food:Groceries",
    ]);
  });

  it("item history places an item as it was confirmed before, at the same payee first", async () => {
    const bought = (payee: string, account: string) => ({
      id: `h${next++}`,
      date: "2024-01-01",
      flag: "*",
      payee,
      narration: "",
      postings: [
        { account: "Liabilities:Card", amount: usd("-9.99") },
        { account, amount: usd("9.99"), memo: "Eggs Hppy 18" },
      ],
    });
    const t = receipt();
    const { proposals } = await items.categorize({
      ...request([t]),
      context: {
        from: "2023-01-01",
        accounts: ACCOUNTS,
        history: [
          bought("Jewel-Osco", "Expenses:Food:Groceries"),
          bought("Mariano's", "Expenses:Food:Coffee"),
        ],
      },
    });

    expect(proposals).toEqual([
      expect.objectContaining({
        splits: [{ index: 1, account: "Expenses:Food:Groceries" }],
        confidence: 0.5,
      }),
    ]);
  });
});
