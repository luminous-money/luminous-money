import { describe, expect, it } from "vitest";

import { readGnucashHistory } from "./gnucash.js";

const ROOTS = ["Assets", "Liabilities", "Equity", "Income", "Expenses"];
const HEADER =
  '"Date","Transaction ID","Number","Description","Notes","Commodity/Currency","Void Reason","Action","Memo","Full Account Name","Account Name","Amount With Sym","Amount Num.","Value With Sym","Value Num.","Reconcile","Reconcile Date","Rate/Price"';

/** A split's line, as GnuCash 5 writes it: the transaction's fields on every line. */
const line = (
  t: { date: string; id: string; description: string; void?: string },
  account: string,
  amount: string,
  value = amount,
  memo = ""
) =>
  [
    t.date,
    t.id,
    "",
    t.description,
    "",
    "CURRENCY::USD",
    t.void ?? "",
    "",
    memo,
    account,
    account.split(":").at(-1)!,
    `$${amount}`,
    amount,
    `$${value}`,
    value,
    "n",
    "",
    "1",
  ]
    .map((cell) => `"${cell}"`)
    .join(",");

const CHECKING = "Assets:Current Assets:Checking Account";
const grocer = { date: "01/05/2026", id: "a1", description: "Fake Grocer" };
const cafe = { date: "01/12/2026", id: "a2", description: "Corner Cafe" };
const pay = { date: "01/15/2026", id: "a3", description: "Paycheck" };
const voided = { date: "01/20/2026", id: "a4", description: "Oops", void: "Entered twice" };
const shares = { date: "01/22/2026", id: "a5", description: "Buy VTI" };
const euros = { date: "01/23/2026", id: "a6", description: "Hotel in Lyon" };
const bad = { date: "31/31/2026", id: "a7", description: "Bad date" };

const EXPORT = [
  HEADER,
  line(grocer, CHECKING, "-42.10"),
  line(grocer, "Expenses:Groceries", "42.10", "42.10", "Weekly shop"),
  line(cafe, CHECKING, "-4.50"),
  line(cafe, "Imbalance-USD", "4.50"),
  line(pay, CHECKING, "2,000.00"),
  line(pay, "Income:Salary", "-2,400.00"),
  line(pay, "Expenses:Taxes:Federal", "400.00"),
  line(voided, CHECKING, "0.00"),
  line(voided, "Expenses:Dining", "0.00"),
  line(shares, "Assets:Brokerage:Cash", "-1000.00"),
  line(shares, "Assets:Brokerage:VTI", "4", "1000.00"),
  line(euros, "Liabilities:Visa", "-120.00"),
  line(euros, "Expenses:Travel", "120.00"),
  line(euros, "Trading:CURRENCY:EUR", "-110.00"),
  line(bad, CHECKING, "-1.00"),
  line(bad, "Expenses:Dining", "1.00"),
].join("\n");

describe("GnuCash's transactions export", () => {
  it("is read a transaction to each ID, its splits' accounts mapped", () => {
    const read = readGnucashHistory(EXPORT, {
      mapping: { [CHECKING]: "Assets:Bank:Checking" },
      roots: ROOTS,
    });

    expect(read.error).toBeNull();
    expect(read.voided).toBe(1);
    expect(read.problems).toEqual([{ line: 16, problem: '"31/31/2026" isn\'t a date' }]);
    expect(read.transactions.map((t) => [t.source_id, t.date, t.description])).toEqual([
      ["a1", "2026-01-05", "Fake Grocer"],
      ["a2", "2026-01-12", "Corner Cafe"],
      ["a3", "2026-01-15", "Paycheck"],
      ["a5", "2026-01-22", "Buy VTI"],
      ["a6", "2026-01-23", "Hotel in Lyon"],
    ]);
    const [groceries, coffee, paycheck, vti, hotel] = read.transactions;
    expect(groceries!.postings).toEqual([
      { account: "Assets:Bank:Checking", amount: "-42.10", currency: "USD", memo: null },
      { account: "Expenses:Groceries", amount: "42.10", currency: "USD", memo: "Weekly shop" },
    ]);
    // GnuCash's own account for what it couldn't place is uncategorized here.
    expect(coffee!.postings[1]!.account).toBe("Expenses:Uncategorized");
    expect(paycheck!.postings.map((p) => [p.account, p.amount])).toEqual([
      ["Assets:Bank:Checking", "2000.00"],
      ["Income:Salary", "-2400.00"],
      ["Expenses:Taxes:Federal", "400.00"],
    ]);
    // Shares count by their value in the transaction's currency.
    expect(vti!.postings[1]).toMatchObject({ account: "Assets:Brokerage:VTI", amount: "1000.00" });
    // Trading splits are GnuCash's bookkeeping: dropped.
    expect(hotel!.postings.map((p) => p.account)).toEqual(["Liabilities:Visa", "Expenses:Travel"]);
    expect(read.unmapped).toMatchObject({
      "Expenses:Groceries": "Expenses:Groceries",
      "Expenses:Taxes:Federal": "Expenses:Taxes:Federal",
    });
    expect(read.unmapped).not.toHaveProperty(CHECKING);
  });

  it("carries a transaction on over lines without an ID or date (older exports)", () => {
    const old = [
      '"Date","Description","Full Account Name","Value Num."',
      '"2026-02-01","Fake Grocer","Assets:Checking","-10.00"',
      '"","","Expenses:Groceries","10.00"',
      '"2026-02-02","Corner Cafe","Assets:Checking","-3.00"',
      '"","","Expenses:Dining Out","3.00"',
    ].join("\n");

    const read = readGnucashHistory(old, { mapping: {}, roots: ROOTS });

    expect(read.transactions.map((t) => t.postings.map((p) => p.account))).toEqual([
      ["Assets:Checking", "Expenses:Groceries"],
      ["Assets:Checking", "Expenses:Dining-Out"],
    ]);
  });

  it("says what's wrong with a file it can't read", () => {
    expect(
      readGnucashHistory('"Date","Account Name","Number","Description","Full Category Path"\n', {
        mapping: {},
        roots: ROOTS,
      }).error
    ).toMatch(/Simple layout/);
    expect(
      readGnucashHistory("Date,Amount\n2026-01-01,5\n", { mapping: {}, roots: ROOTS }).error
    ).toMatch(/isn't GnuCash's transactions export/);
    expect(readGnucashHistory("", { mapping: {}, roots: ROOTS }).error).toBe("The file is empty.");
  });
});
