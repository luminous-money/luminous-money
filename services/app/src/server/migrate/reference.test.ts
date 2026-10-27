import { describe, expect, it } from "vitest";

import type { CategoryRule } from "../../shared/rules.js";
import type { Incoming } from "../categorize/types.js";
import { buildReference, entriesFor, suggestRules, type Seen } from "./reference.js";

const TODAY = "2026-07-01";
const spend = (date: string, description: string, account: string, amount: string): Seen => ({
  date,
  description,
  postings: [
    { account: "Assets:Checking", amount: `-${amount}` },
    { account, amount },
  ],
});
const options = {
  today: TODAY,
  balanceSheet: (a: string) => /^(Assets|Liabilities):/.test(a),
  usable: (a: string) => a !== "Expenses:Gone" && a !== "Expenses:Uncategorized",
};

const SEEN: Seen[] = [
  spend("2026-06-01", "KROGER #123 CINCINNATI OH", "Expenses:Groceries", "80.00"),
  spend("2026-05-01", "KROGER #456 CINCINNATI OH", "Expenses:Groceries", "40.00"),
  spend("2026-04-01", "KROGER #123 CINCINNATI OH", "Expenses:Groceries", "120.00"),
  // A year back, and in an account that's gone: it counts for less, and not toward that account.
  spend("2025-07-01", "KROGER #789 CINCINNATI OH", "Expenses:Household", "30.00"),
  spend("2025-07-02", "KROGER #789 CINCINNATI OH", "Expenses:Gone", "30.00"),
  spend("2026-06-15", "Corner Cafe", "Expenses:Dining", "4.50"),
  // A transfer is no payee's category.
  {
    date: "2026-06-20",
    description: "Payment Thank You",
    postings: [
      { account: "Assets:Checking", amount: "-500.00" },
      { account: "Liabilities:Visa", amount: "500.00" },
    ],
  },
];

describe("the reference", () => {
  it("sums up where each payee went, recent transactions weighing more", () => {
    const [kroger, cafe, ...rest] = buildReference(SEEN, options);

    expect(rest).toEqual([]);
    expect(kroger).toMatchObject({
      key: "kroger cincinnati",
      payee: "KROGER #123 CINCINNATI OH",
      seen: 4,
      last: "2026-06-01",
    });
    expect(kroger!.accounts).toEqual([
      {
        account: "Expenses:Groceries",
        share: 0.91, // 3 of 4 by count, but the fourth is a year old
        seen: 3,
        typical: "80.00",
        low: "40.00",
        high: "120.00",
      },
      {
        account: "Expenses:Household",
        share: 0.09,
        seen: 1,
        typical: "30.00",
        low: "30.00",
        high: "30.00",
      },
    ]);
    expect(cafe).toMatchObject({ key: "corner cafe", seen: 1 });
  });

  it("finds the entries for payees like a batch's, whatever the bank calls them", () => {
    const reference = buildReference(SEEN, options);

    expect(entriesFor(reference, ["KROGER #999 CINCINNATI OH"]).map((e) => e.key)).toEqual([
      "kroger cincinnati",
    ]);
    // The old books' "Corner Cafe" is the bank's "SQ *CORNER CAFE CHICAGO".
    expect(entriesFor(reference, ["SQ *CORNER CAFE CHICAGO IL"]).map((e) => e.key)).toEqual([
      "corner cafe",
    ]);
    expect(entriesFor(reference, ["SHELL OIL 12345"])).toEqual([]);
  });

  it("suggests rules for payees nearly always one account, saying how many are waiting", () => {
    const steady = [
      ...SEEN,
      spend("2026-06-16", "Corner Cafe", "Expenses:Dining", "5.00"),
      spend("2026-06-17", "Corner Cafe", "Expenses:Dining", "3.50"),
    ];
    const waiting = [{ description: "CORNER CAFE" }, { description: "corner cafe" }] as Incoming[];

    const suggested = suggestRules(buildReference(steady, options), [], waiting);

    // Kroger is 3 of 4 to groceries: not consistent enough.
    expect(suggested).toEqual([
      {
        key: "corner cafe",
        match: "key",
        payee: "Corner Cafe",
        account: "Expenses:Dining",
        seen: 3,
        matched: 3,
        waiting: 2,
      },
    ]);
    const ruled = [{ conditions: { key: "corner cafe" } }] as CategoryRule[];
    expect(suggestRules(buildReference(steady, options), ruled, waiting)).toEqual([]);

    // The bank's text for it has more in its key (the city): the rule goes by "contains".
    const bank = [{ description: "SQ *CORNER CAFE #12 CHICAGO IL" }] as Incoming[];
    expect(suggestRules(buildReference(steady, options), [], bank)[0]).toMatchObject({
      match: "contains",
      waiting: 1,
    });
  });
});
