import { describe, expect, it } from "vitest";

import { fundName, linesProblem, mergedLines, shapeOf, wholeLine, type FundLine } from "./funds.js";

const usd = (number: string) => ({ number, currency: "USD" });
const line = (fund: string, number: string): FundLine => ({ fund, amount: usd(number) });

describe("shapeOf", () => {
  it("reads money in, money out and transfers from the asset and liability splits", () => {
    expect(
      shapeOf(
        [{ account: "Assets:PNC", units: usd("1000.00") }, { account: "Income:Salary" }],
        "USD"
      )
    ).toEqual({
      kind: "in",
      size: "1000.00",
      currency: "USD",
    });
    expect(
      shapeOf(
        [{ account: "Liabilities:Visa", units: usd("-500.00") }, { account: "Expenses:Home" }],
        "USD"
      )
    ).toEqual({
      kind: "out",
      size: "500.00",
      currency: "USD",
    });
    expect(
      shapeOf(
        [{ account: "Assets:PNC", units: usd("-2000.00") }, { account: "Assets:Brokerage:Cash" }],
        "USD"
      )
    ).toEqual({ kind: "transfer", size: "2000.00", currency: "USD" });
  });

  it("counts a refund as money in and a trade as a transfer", () => {
    expect(
      shapeOf(
        [
          { account: "Assets:PNC", units: usd("40.00") },
          { account: "Expenses:Home", units: usd("-40.00") },
        ],
        "USD"
      ).kind
    ).toBe("in");
    const trade = shapeOf(
      [
        { account: "Assets:Brokerage:Cash", units: usd("-3000.00") },
        {
          account: "Assets:Brokerage:VTI",
          units: { number: "10", currency: "VTI" },
          cost: { number: "300.00", currency: "USD" },
        },
      ],
      "USD"
    );
    expect(trade).toEqual({ kind: "transfer", size: "3000.00", currency: "USD" });
  });

  it("can't say until the splits balance, or for another currency", () => {
    expect(
      shapeOf([{ account: "Assets:PNC" }, { account: "Expenses:Home" }], "USD").kind
    ).toBeNull();
    expect(
      shapeOf(
        [
          { account: "Assets:Wallet", units: { number: "-20", currency: "EUR" } },
          { account: "Expenses:Food" },
        ],
        "USD"
      ).kind
    ).toBeNull();
  });
});

describe("wholeLine", () => {
  it("puts all of it toward a fund, or takes all of it from one", () => {
    expect(wholeLine({ kind: "in", size: "1000.00", currency: "USD" }, "Emergency")).toEqual(
      line("Emergency", "1000.00")
    );
    expect(wholeLine({ kind: "out", size: "500.00", currency: "USD" }, "Emergency")).toEqual(
      line("Emergency", "-500.00")
    );
    expect(wholeLine({ kind: "transfer", size: "2000.00", currency: "USD" }, "Emergency")).toEqual(
      line("Emergency", "2000.00")
    );
    expect(wholeLine({ kind: null, size: "0", currency: "USD" }, "Emergency")).toBeNull();
  });
});

describe("linesProblem", () => {
  const paycheck = { kind: "in", size: "1000.00", currency: "USD" } as const;
  const repair = { kind: "out", size: "500.00", currency: "USD" } as const;
  const transfer = { kind: "transfer", size: "2000.00", currency: "USD" } as const;

  it("takes what fits", () => {
    expect(
      linesProblem(paycheck, [
        line("Emergency", "500.00"),
        line("Special Home Maintenance", "500.00"),
      ])
    ).toBeNull();
    expect(linesProblem(repair, [line("Emergency", "-500.00")])).toBeNull();
    expect(
      linesProblem(transfer, [line("Emergency", "-2000.00"), line("Wedding", "2000.00")])
    ).toBeNull();
  });

  it("words what doesn't as the ledger does", () => {
    expect(linesProblem(paycheck, [line("Emergency", "-1.00")])).toBe(
      "money coming in goes to funds, not from them (Emergency)"
    );
    expect(linesProblem(repair, [line("Emergency", "1.00")])).toBe(
      "money going out comes from funds, not to them (Emergency)"
    );
    expect(linesProblem(paycheck, [line("A", "600.00"), line("B", "600.00")])).toBe(
      "its funds get 1,200.00 USD, more than the 1,000.00 USD that came in"
    );
    expect(linesProblem(repair, [line("Emergency", "-500.01")])).toBe(
      "its funds give 500.01 USD, more than the 500.00 USD that went out"
    );
    expect(linesProblem(transfer, [line("Emergency", "2500.00")])).toBe(
      "its funds get 2,500.00 USD, more than the 2,000.00 USD it moves"
    );
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
