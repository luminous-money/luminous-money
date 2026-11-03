import { describe, expect, it } from "vitest";

import {
  effectsOf,
  fundFor,
  fundName,
  isTrade,
  linesProblem,
  mergedLines,
  shapesOf,
  wholeLines,
  type FundLine,
} from "./funds.js";

const usd = (number: string) => ({ number, currency: "USD" });
const vti = (number: string) => ({ number, currency: "VTI" });
const line = (fund: string, number: string, currency = "USD"): FundLine => ({
  fund,
  amount: { number, currency },
});
const buy = [
  { account: "Assets:Brokerage:Cash", units: usd("-3000.00") },
  {
    account: "Assets:Brokerage:VTI",
    units: vti("10"),
    cost: { number: "300.00", currency: "USD" },
  },
];

describe("shapesOf", () => {
  it("reads money in, money out and transfers from the asset and liability splits", () => {
    expect(
      shapesOf(
        [{ account: "Assets:PNC", units: usd("1000.00") }, { account: "Income:Salary" }],
        "USD"
      )
    ).toEqual([{ kind: "in", size: "1000.00", currency: "USD" }]);
    expect(
      shapesOf(
        [{ account: "Liabilities:Visa", units: usd("-500.00") }, { account: "Expenses:Home" }],
        "USD"
      )
    ).toEqual([{ kind: "out", size: "500.00", currency: "USD" }]);
    expect(
      shapesOf(
        [{ account: "Assets:PNC", units: usd("-2000.00") }, { account: "Assets:Brokerage:Cash" }],
        "USD"
      )
    ).toEqual([{ kind: "transfer", size: "2000.00", currency: "USD" }]);
  });

  it("reads a trade one commodity at a time (Funds B), the operating currency first", () => {
    expect(shapesOf(buy, "USD")).toEqual([
      { kind: "out", size: "3000.00", currency: "USD" },
      { kind: "in", size: "10", currency: "VTI" },
    ]);
    expect(isTrade(shapesOf(buy, "USD"))).toBe(true);
    // A refund is money in.
    expect(
      shapesOf(
        [
          { account: "Assets:PNC", units: usd("40.00") },
          { account: "Expenses:Home", units: usd("-40.00") },
        ],
        "USD"
      )?.[0]?.kind
    ).toBe("in");
  });

  it("can't say until the splits read", () => {
    expect(shapesOf([{ account: "Assets:PNC" }, { account: "Expenses:Home" }], "USD")).toBeNull();
  });
});

describe("wholeLines", () => {
  it("puts all of it toward a fund, or takes all of it from one, each commodity", () => {
    expect(wholeLines(shapesOf(buy, "USD"), "Emergency")).toEqual([
      line("Emergency", "-3000.00"),
      line("Emergency", "10", "VTI"),
    ]);
    expect(wholeLines([{ kind: "transfer", size: "2000.00", currency: "USD" }], "E")).toEqual([
      line("E", "2000.00"),
    ]);
    expect(wholeLines(null, "Emergency")).toEqual([]);
  });
});

describe("linesProblem", () => {
  const paycheck = [{ kind: "in", size: "1000.00", currency: "USD" }] as const;
  const repair = [{ kind: "out", size: "500.00", currency: "USD" }] as const;
  const transfer = [{ kind: "transfer", size: "2000.00", currency: "USD" }] as const;
  const trade = shapesOf(buy, "USD");

  it("takes what fits", () => {
    expect(
      linesProblem(
        [...paycheck],
        [line("Emergency", "500.00"), line("Special Home Maintenance", "500.00")]
      )
    ).toBeNull();
    expect(linesProblem([...repair], [line("Emergency", "-500.00")])).toBeNull();
    expect(
      linesProblem([...transfer], [line("Emergency", "-2000.00"), line("Wedding", "2000.00")])
    ).toBeNull();
    expect(
      linesProblem(trade, [line("Emergency", "-3000.00"), line("Emergency", "10", "VTI")])
    ).toBeNull();
  });

  it("words what doesn't as the ledger does", () => {
    expect(linesProblem([...paycheck], [line("Emergency", "-1.00")])).toBe(
      "money coming in goes to funds, not from them (Emergency)"
    );
    expect(linesProblem([...repair], [line("Emergency", "1.00")])).toBe(
      "money going out comes from funds, not to them (Emergency)"
    );
    expect(linesProblem([...paycheck], [line("A", "600.00"), line("B", "600.00")])).toBe(
      "its funds get 1,200.00 USD, more than the 1,000.00 USD that came in"
    );
    expect(linesProblem([...transfer], [line("Emergency", "2500.00")])).toBe(
      "its funds get 2,500.00 USD, more than the 2,000.00 USD it moves"
    );
    expect(linesProblem(trade, [line("Emergency", "11", "VTI")])).toBe(
      "its funds get 11 VTI, more than the 10 VTI that came in"
    );
    expect(linesProblem(trade, [line("Emergency", "5", "FXAIX")])).toBe(
      "it moves no FXAIX (Emergency)"
    );
  });
});

describe("default funds", () => {
  const defaults = [
    { account: "Assets:Retirement:Roth-IRA", fund: "Retirement", date: "2026-01-01" },
    { account: "Assets:Retirement:Roth-IRA:Cash", fund: null, date: "2026-01-01" },
  ];

  it("come from the nearest account with one, by date", () => {
    expect(fundFor(defaults, "Assets:Retirement:Roth-IRA:FXAIX", "2026-06-01")).toBe("Retirement");
    // None of its own: the account above's.
    expect(fundFor(defaults, "Assets:Retirement:Roth-IRA:Cash", "2026-06-01")).toBe("Retirement");
    expect(fundFor(defaults, "Assets:Retirement:Roth-IRA", "2025-12-31")).toBe("Unallocated");
    expect(fundFor(defaults, "Assets:Bank:Checking", "2026-06-01")).toBe("Unallocated");
  });

  it("take what a line doesn't, side by side", () => {
    const contribution = [
      { account: "Assets:Bank:Checking", units: usd("-500.00") },
      { account: "Assets:Retirement:Roth-IRA:Cash", units: usd("500.00") },
    ];
    expect(effectsOf(contribution, [], defaults, "2026-11-06")).toEqual([
      { fund: "Retirement", currency: "USD", number: "500.00" },
      { fund: "Unallocated", currency: "USD", number: "-500.00" },
    ]);
    // From Emergency: the line takes over checking's side.
    expect(effectsOf(contribution, [line("Emergency", "-500.00")], defaults, "2026-11-06")).toEqual(
      [
        { fund: "Emergency", currency: "USD", number: "-500.00" },
        { fund: "Retirement", currency: "USD", number: "500.00" },
      ]
    );
  });

  it("leave Funds A as it was without any", () => {
    expect(
      effectsOf(
        [{ account: "Assets:PNC", units: usd("1000.00") }, { account: "Income:Salary" }],
        [line("Emergency", "400.00")],
        [],
        "2026-11-06"
      )
    ).toEqual([
      { fund: "Emergency", currency: "USD", number: "400.00" },
      { fund: "Unallocated", currency: "USD", number: "600.00" },
    ]);
  });
});

describe("mergedLines", () => {
  it("sums each fund's lines and drops what nets to nothing", () => {
    expect(
      mergedLines(
        [line("Emergency", "-100.00")],
        [line("Emergency", "100.00"), line("Wedding", "50.00")],
        null
      )
    ).toEqual([line("Wedding", "50.00")]);
  });
});

describe("fundName", () => {
  it("keeps names tidy and refuses what can't be one", () => {
    expect(fundName("  Special   Home Improvement ")).toEqual({ name: "Special Home Improvement" });
    expect(fundName("unallocated")).toEqual({
      problem: "Unallocated is what isn't in a fund: it can't be a fund's name",
    });
    expect(fundName("A; B")).toHaveProperty("problem");
    expect(fundName(" ")).toEqual({ problem: "a fund needs a name" });
  });
});
