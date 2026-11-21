import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { AiSettings, CategorizeIn, CategorizeOut } from "@luminous-money/ai-api";

import type { OrderCharge } from "../../shared/orders.js";
import type { AiPort } from "../ai.js";
import { AppDb } from "../db.js";
import { FakeLedger } from "../testing.js";
import { readCharge, readWaiting, refresh, retag, type OrderDeps } from "./read.js";
import { chargeProblem } from "./routes.js";
import { shopNotifications, type ShopConnection, type ShopsPort } from "../shops.js";
import { OrdersStore } from "./store.js";
import { shopsJob } from "./sync.js";

// Made-up charges: no real orders here.
const CARD = "Liabilities:Example-Visa";

function setUp() {
  const ledger = new FakeLedger();
  ledger.addBook("b");
  ledger.addAccount(CARD, {
    type: "liability",
    currencies: ["USD"],
    cards: [{ brand: "visa", last_four: "4242" }],
  });
  ledger.addAccount("Assets:Bank:Checking", { currencies: ["USD"] });
  ledger.addAccount("Expenses:Household", { type: "expense" });
  ledger.addAccount("Expenses:Groceries", { type: "expense" });
  const db = new AppDb(join(mkdtempSync(join(tmpdir(), "app-")), "app.sqlite"));
  const orders = new OrdersStore(db.db);
  // The AI places paper towels in Household, anything else in Groceries.
  const asked: CategorizeIn[] = [];
  const port: AiPort = {
    settings: async () => ({ ready: true, create_accounts: false }) as AiSettings,
    extract: async () => ({ failed: "not in these tests" }),
    categorize: async (_book, input): Promise<{ ok: CategorizeOut }> => {
      asked.push(input);
      const t = input.transactions[0]!;
      return {
        ok: {
          proposals: [
            {
              id: t.id,
              splits: t.splits.map((s) => ({
                index: s.index,
                account: /towels/i.test(s.memo ?? "") ? "Expenses:Household" : "Expenses:Groceries",
              })),
              fallback: null,
              confidence: 0.8,
              reason: "made up",
            },
          ],
          new_accounts: [],
        },
      };
    },
    loanTable: async () => ({ failed: "not in these tests" }),
    forgetBook: async () => undefined,
  };
  const deps: OrderDeps = {
    db,
    orders,
    ledgerFor: () => ledger,
    aiFor: () => port,
    categorizers: [],
  };
  return { ledger, db, orders, deps, asked };
}

const charge = (c: Partial<OrderCharge> = {}): OrderCharge => ({
  id: "c1",
  shop: "amazon",
  date: "2026-03-10",
  amount: "-30.00",
  card: { last_four: "4242" },
  orders: [
    {
      number: "111-0000000-0000001",
      url: "https://www.amazon.com/gp/your-account/order-details?orderID=111-0000000-0000001",
    },
  ],
  lines: [
    { text: "Paper towels, 12 rolls", amount: "20.00" },
    { text: "Coffee beans", amount: "12.00" },
    { text: "Tax", amount: "3.00" },
    { text: "Gift card", amount: "-5.00", account: "Income:Gifts" },
  ],
  note: null,
  ...c,
});

function bankCopy(
  ledger: FakeLedger,
  { date = "2026-03-11", amount = "-30.00", flag = "!", other = "Expenses:Uncategorized" } = {}
) {
  return ledger.addTransaction({
    date,
    flag,
    payee: "AMAZON MKTPL",
    narration: "",
    meta: { source: "simplefin" },
    postings: [
      { account: CARD, units: { number: amount, currency: "USD" }, meta: { reconciled: "s1" } },
      { account: other, flag: flag === "!" ? "!" : null },
    ],
  } as never);
}

const accountsOf = (postings: { account: string; units?: { number: string } | null }[]) =>
  postings.map((p) => [p.account, p.units?.number]);

describe("a shop's charge, as a receipt", () => {
  it("is itemized into the bank's copy, even one already categorized, and goes back to review", async () => {
    const { ledger, orders, deps } = setUp();
    const bank = bankCopy(ledger, { flag: "*", other: "Expenses:Household" });
    ledger.transactions.find((t) => t.id === bank.id)!.postings[1]!.tags = ["work"];
    orders.receive("b", "u", [charge()]);

    expect(await readWaiting(deps, "b")).toEqual({ read: 1, waiting: 0, failed: 0 });

    expect(ledger.transactions).toHaveLength(1); // nothing new
    const t = await ledger.transaction("b", bank.id);
    expect([t.flag, t.date, t.payee]).toEqual(["!", "2026-03-11", "AMAZON MKTPL"]);
    expect(t.postings[0]!.meta).toEqual({ reconciled: "s1" }); // its paying side, as it was
    expect(accountsOf(t.postings)).toEqual([
      [CARD, "-30.00"],
      ["Expenses:Household", "20.00"],
      ["Expenses:Groceries", "12.00"],
      ["Expenses:Groceries", "3.00"],
      ["Income:Gifts", "-5.00"], // from its own account, not categorized
    ]);
    expect(t.postings.slice(1).map((p) => p.meta?.["memo"])).toEqual([
      "Paper towels, 12 rolls",
      "Coffee beans",
      "Tax",
      "Gift card",
    ]);
    // The items take the tags of the split they replace; the paying side keeps its own (none).
    expect(t.postings.map((p) => p.tags ?? [])).toEqual([
      [],
      ["work"],
      ["work"],
      ["work"],
      ["work"],
    ]);
    expect(t.meta).toMatchObject({
      "order-read": expect.any(String),
      order: "Amazon 111-0000000-0000001",
      "order-url": expect.stringContaining("111-0000000-0000001"),
    });
    expect(ledger.created).toContain("Income:Gifts"); // opened
    expect(orders.charge("b", "amazon", "c1")).toMatchObject({
      state: "read",
      transaction_id: bank.id,
      detail: "Read into its transaction from the bank.",
    });
  });

  it("is made as its own when the bank's copy isn't here, and another like it isn't read into that", async () => {
    const { ledger, orders, deps } = setUp();
    orders.receive("b", "u", [charge(), charge({ id: "c2", date: "2026-03-12" })]);

    expect(await readWaiting(deps, "b")).toEqual({ read: 2, waiting: 0, failed: 0 });

    // Two of the same amount, days apart: two transactions, not one read twice.
    expect(ledger.transactions).toHaveLength(2);
    const [first, second] = ledger.transactions;
    expect(first!.meta).toMatchObject({ source: "order", order: "Amazon 111-0000000-0000001" });
    expect([first!.flag, first!.date, first!.payee]).toEqual(["!", "2026-03-10", "Amazon"]);
    expect(accountsOf(first!.postings)[0]).toEqual([CARD, "-30.00"]);
    expect(second!.date).toBe("2026-03-12");
    expect(orders.charge("b", "amazon", "c1")?.detail).toBe(
      "Made as its own transaction; the bank's copy is matched to it when it comes in."
    );
  });

  it("waits for an account holding its card, and is read once one does", async () => {
    const { ledger, orders, deps } = setUp();
    orders.receive("b", "u", [
      charge({ card: { last_four: "1881" } }),
      charge({ id: "c3", card: null }),
    ]);

    expect(await readWaiting(deps, "b")).toEqual({ read: 0, waiting: 2, failed: 0 });
    expect(orders.charge("b", "amazon", "c1")?.detail).toMatch(
      /No account in this book holds the card ending 1881/
    );
    expect(orders.charge("b", "amazon", "c3")?.detail).toMatch(/Paid without a card/);
    expect(ledger.transactions).toHaveLength(0);

    ledger.addAccount("Liabilities:Other-Card", {
      type: "liability",
      currencies: ["USD"],
      cards: [{ brand: "visa", last_four: "1881" }],
    });
    expect(await readWaiting(deps, "b")).toEqual({ read: 1, waiting: 1, failed: 0 });
    expect(accountsOf(ledger.transactions[0]!.postings)[0]).toEqual([
      "Liabilities:Other-Card",
      "-30.00",
    ]);
  });

  it("changes nothing when sent again once read; one still waiting takes what's new", async () => {
    const { orders } = setUp();
    expect(orders.receive("b", "u", [charge()]).added).toBe(1);
    orders.settle("b", "amazon", "c1", "read", null, "t1");
    expect(
      orders.receive("b", "u", [charge({ lines: [{ text: "Other", amount: "30.00" }] })])
    ).toEqual({ added: 0, marked: [], forgotten: 0 });
    expect(orders.charge("b", "amazon", "c1")?.lines).toHaveLength(4);

    orders.receive("b", "u", [charge({ id: "c2", card: null })]);
    orders.receive("b", "u", [charge({ id: "c2", card: null, note: "better now" })]);
    expect(orders.charge("b", "amazon", "c2")?.note).toBe("better now");
  });

  it("sent as all of a shop's, forgets that shop's others kept, and leaves their transactions", async () => {
    const { ledger, orders, deps } = setUp();
    orders.receive("b", "u", [charge(), charge({ id: "c2", date: "2026-03-12" })]);
    await readWaiting(deps, "b");
    const made = orders.charge("b", "amazon", "c2")!.transaction_id!;
    orders.receive("b", "u", [charge({ id: "elsewhere", shop: "other-shop" })]);

    expect(orders.receive("b", "u", [charge()], "amazon")).toMatchObject({ forgotten: 1 });
    expect(orders.charges("b").map((c) => c.id)).toEqual(["c1", "elsewhere"]);
    expect((await ledger.transaction("b", made)).id).toBe(made);
  });

  it("can be read into a transaction by hand, if one of its accounts paid exactly that", async () => {
    const { ledger, orders, deps } = setUp();
    const other = ledger.addTransaction({
      date: "2026-03-20",
      flag: "!",
      payee: "CARD 1881",
      narration: "",
      meta: {},
      postings: [
        { account: "Assets:Bank:Checking", units: { number: "-30.00", currency: "USD" } },
        { account: "Expenses:Uncategorized", flag: "!" },
      ],
    } as never);
    orders.receive("b", "u", [charge({ card: { last_four: "1881" } })]);
    const waiting = orders.charge("b", "amazon", "c1")!;

    const outcome = await readCharge(deps, "b", waiting, other.id);
    expect(outcome).toMatchObject({ state: "read", transaction_id: other.id });
    expect(accountsOf((await ledger.transaction("b", other.id)).postings)[0]).toEqual([
      "Assets:Bank:Checking",
      "-30.00",
    ]);
    await expect(readCharge(deps, "b", { ...waiting, amount: "-31.00" }, other.id)).rejects.toThrow(
      /none of that transaction's accounts of money has -31.00/
    );
  });
});

describe("what a reader may send", () => {
  it("needs lines that come to what the card paid", () => {
    expect(chargeProblem(charge())).toBeNull();
    expect(chargeProblem(charge({ lines: [{ text: "Coffee", amount: "12.00" }] }))).toBe(
      "c1: its lines come to 12.00, not 30.00"
    );
    expect(chargeProblem(charge({ date: "March 10" }))).toMatch(/YYYY-MM-DD/);
    expect(chargeProblem(charge({ card: { last_four: "x" } }))).toMatch(/last_four/);
    expect(chargeProblem(charge({ lines: [] }))).toBeNull(); // one line of the whole, then
  });
});

describe("the morning's shop sync, and Amazon wanting a person", () => {
  const shops = (connection: Partial<ShopConnection> | null) => {
    const synced: string[] = [];
    const port: ShopsPort = {
      amazon: async () =>
        connection && {
          has_password: true,
          status: "ok",
          status_detail: null,
          last_sync_at: null,
          updated_at: "2026-03-01T00:00:00.000000Z",
          ...connection,
        },
      sync: async (book) => void synced.push(book),
      invoice: async () => null,
    };
    return { port, synced };
  };

  it("syncs a book that's read its Amazon before, once a local day from 09:00, as its sender", async () => {
    const { db, orders } = setUp();
    db.setTimeZone("b", "America/Chicago", "u");
    orders.receive("b", "kael", [charge()]);
    const asked: string[] = [];
    let clock = new Date("2026-03-10T13:00:00Z"); // 08:00 in Chicago (daylight time)
    const { port, synced } = shops({ last_sync_at: "2026-03-09T15:00:00Z" });
    const job = shopsJob({ db, orders, shopsFor: (user) => (asked.push(user), port) }, () => clock);

    expect(job.zones()).toEqual(["America/Chicago"]);
    await job.run();
    expect(synced).toEqual([]); // not before 09:00
    clock = new Date("2026-03-10T14:30:00Z"); // 09:30
    await job.run();
    expect([synced, asked]).toEqual([["b"], ["kael"]]);

    const today = shops({ last_sync_at: "2026-03-10T15:31:00Z" });
    await shopsJob({ db, orders, shopsFor: () => today.port }, () => clock).run();
    expect(today.synced).toEqual([]); // once a day is enough
    const login = shops({ status: "login" });
    await shopsJob({ db, orders, shopsFor: () => login.port }, () => clock).run();
    expect(login.synced).toEqual([]); // not while Amazon wants a person
  });

  it("says in Notifications when Amazon wants a person, linking to its page", async () => {
    expect(await shopNotifications(shops({ status: "ok" }).port, "b")).toEqual([]);
    expect(await shopNotifications(shops(null).port, "b")).toEqual([]);
    const [n] = await shopNotifications(
      shops({
        status: "login",
        status_detail: "Amazon asked for a picture puzzle (a captcha): Sign in",
      }).port,
      "b"
    );
    expect(n).toMatchObject({
      id: "shop-login:amazon",
      kind: "shop-login",
      dismissable: false,
      title: "Amazon wants you to log in again",
      href: "/books/b/amazon",
    });
    expect(n!.detail).toMatch(/picture puzzle/);
  });
});

describe("HSA tracking: a line the shop marks HSA or FSA eligible", () => {
  const marked = (c: Partial<OrderCharge> = {}) =>
    charge({
      lines: [
        { text: "Digital thermometer", amount: "20.00", hsa_fsa_eligible: true },
        { text: "Coffee beans", amount: "12.00" },
        { text: "Tax", amount: "3.00" },
        { text: "Gift card", amount: "-5.00", account: "Income:Gifts" },
      ],
      ...c,
    });

  it("tags its split outright, and the record says the shop said so", async () => {
    const { ledger, db, orders, deps } = setUp();
    orders.receive("b", "u", [marked()]);
    await readWaiting(deps, "b");

    const [t] = ledger.transactions;
    expect(t!.postings.map((p) => [p.meta?.["memo"], p.tags ?? []])).toEqual([
      [undefined, []],
      ["Digital thermometer", ["hsa-fsa-eligible"]],
      ["Coffee beans", []],
      ["Tax", []],
      ["Gift card", []],
    ]);
    expect(db.proposal("b", t!.id)?.tags).toEqual([
      { index: 1, tag: "hsa-fsa-eligible", by: "amazon" },
    ]);
    expect(db.proposalOf(t!.id)?.tags).toEqual([
      { index: 1, tag: "hsa-fsa-eligible", by: "amazon" },
    ]);
  });

  it("tags one already read when its lines come again newly marked, leaving it confirmed", async () => {
    const { ledger, db, orders, deps } = setUp();
    orders.receive("b", "u", [charge()]);
    await readWaiting(deps, "b");
    const [t] = ledger.transactions;
    t!.flag = "*";

    const sent = charge({
      lines: charge().lines.map((l) =>
        l.text.startsWith("Paper towels") ? { ...l, hsa_fsa_eligible: true } : l
      ),
    });
    const { added, marked: again } = orders.receive("b", "u", [sent]);
    expect(added).toBe(0);
    expect(again.map((m) => m.lines.map((l) => l.text))).toEqual([["Paper towels, 12 rolls"]]);
    expect(await retag(deps, "b", again[0]!.charge, again[0]!.lines)).toBe(1);

    const after = await ledger.transaction("b", t!.id);
    expect(after.flag).toBe("*");
    expect(after.postings[1]!.tags).toEqual(["hsa-fsa-eligible"]);
    expect(after.postings.slice(2).every((p) => !p.tags?.length)).toBe(true);
    expect(db.proposal("b", t!.id)?.tags).toEqual([
      { index: 1, tag: "hsa-fsa-eligible", by: "amazon" },
    ]);
    // Sent again as it is now, nothing more to do.
    expect(orders.receive("b", "u", [sent]).marked).toEqual([]);
  });

  it("leaves a split the person changed since", async () => {
    const { ledger, orders, deps } = setUp();
    orders.receive("b", "u", [charge()]);
    await readWaiting(deps, "b");
    const [t] = ledger.transactions;
    t!.postings[1]!.units = { number: "19.00", currency: "USD" };
    t!.postings[2]!.units = { number: "13.00", currency: "USD" };
    const sent = charge({
      lines: charge().lines.map((l, i) => (i === 0 ? { ...l, hsa_fsa_eligible: true } : l)),
    });
    const { marked: again } = orders.receive("b", "u", [sent]);
    expect(await retag(deps, "b", again[0]!.charge, again[0]!.lines)).toBe(0);
  });

  it("the AI is offered the tag; what it proposes lands, recorded as the AI's", async () => {
    const { ledger, db, orders, deps, asked } = setUp();
    const port = deps.aiFor!("u");
    deps.aiFor = () => ({
      ...port,
      categorize: async (book, input) => {
        const out = await port.categorize(book, input);
        if ("ok" in out)
          out.ok.proposals[0]!.splits[1]!.tags = ["hsa-fsa-eligible", "never-offered"];
        return out;
      },
    });
    orders.receive("b", "u", [charge()]);
    await readWaiting(deps, "b");

    expect(asked[0]!.tags?.map((t) => t.name)).toEqual(["hsa-fsa-eligible"]);
    const [t] = ledger.transactions;
    expect(t!.postings.map((p) => p.tags ?? [])).toEqual([[], [], ["hsa-fsa-eligible"], [], []]);
    expect(db.proposal("b", t!.id)?.tags).toEqual([
      { index: 2, tag: "hsa-fsa-eligible", by: "ai" },
    ]);
  });

  describe("its order's invoice (documentation)", () => {
    const PDF = new TextEncoder().encode("%PDF-1.4 made up");
    const withShops = (deps: OrderDeps, kept: Set<string>) => {
      const asked: string[] = [];
      deps.shopsFor = () => ({
        amazon: async () => null,
        sync: async () => undefined,
        invoice: async (_book, _shop, order) => {
          asked.push(order);
          return kept.has(order)
            ? { name: `Amazon order ${order}.pdf`, type: "application/pdf", bytes: PDF }
            : null;
        },
      });
      return asked;
    };
    const invoiced = (c: OrderCharge): OrderCharge => ({
      ...c,
      orders: c.orders.map((o) => ({ ...o, invoice: true })),
    });

    it("is attached to an eligible charge's transaction, once", async () => {
      const { ledger, orders, deps } = setUp();
      withShops(deps, new Set(["111-0000000-0000001"]));
      orders.receive("b", "u", [invoiced(marked())]);
      await readWaiting(deps, "b");

      const [t] = ledger.transactions;
      expect(ledger.attachments).toEqual([
        {
          transaction: t!.id,
          name: "Amazon order 111-0000000-0000001.pdf",
          type: "application/pdf",
          size: PDF.length,
        },
      ]);
      expect(t!.attachments).toBe(1);
    });

    it("isn't, for a charge with nothing eligible, or a transaction already holding a file", async () => {
      const { ledger, orders, deps } = setUp();
      const asked = withShops(deps, new Set(["111-0000000-0000001"]));
      orders.receive("b", "u", [invoiced(charge())]);
      await readWaiting(deps, "b");
      expect([asked, ledger.attachments]).toEqual([[], []]);

      const bank = bankCopy(ledger, { amount: "-30.00" });
      ledger.transactions.find((t) => t.id === bank.id)!.attachments = 1;
      orders.receive("b", "u", [invoiced(marked({ id: "c2" }))]);
      await readWaiting(deps, "b");
      expect(ledger.attachments).toEqual([]);
    });

    it("is attached to one already read once its shop's reader keeps it", async () => {
      const { ledger, orders, deps } = setUp();
      withShops(deps, new Set(["111-0000000-0000001"]));
      orders.receive("b", "u", [marked()]);
      await readWaiting(deps, "b");
      expect(ledger.attachments).toEqual([]);

      const { marked: again } = orders.receive("b", "u", [invoiced(marked())]);
      expect(again.map((m) => [m.lines.length, m.invoices])).toEqual([
        [0, ["111-0000000-0000001"]],
      ]);
      await refresh(deps, "b", again[0]!);
      expect(ledger.attachments.map((a) => a.name)).toEqual([
        "Amazon order 111-0000000-0000001.pdf",
      ]);
    });
  });

  it("must be true or false", () => {
    const bad = charge({
      lines: [{ text: "Thermometer", amount: "30.00", hsa_fsa_eligible: "yes" as never }],
    });
    expect(chargeProblem(bad)).toMatch(/hsa_fsa_eligible/);
  });
});
