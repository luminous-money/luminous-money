import { describe, expect, it } from "vitest";

import { shapesOf, type FundLine, type FundShape } from "../../shared/funds.js";
import {
  amountsOf,
  belowZero,
  blankRow,
  effects,
  effectsInWords,
  linesOf,
  rowsFrom,
  rowsIn,
  rowsProblem,
  sameLines,
  signedMoney,
  suggestedFund,
  verb,
  wholeFund,
  wholeSide,
  type FundRow,
} from "./funds.js";

const usd = (number: string) => ({ number, currency: "USD" });
const line = (fund: string, number: string, currency = "USD"): FundLine => ({
  fund,
  amount: { number, currency },
});
const one = (postings: Parameters<typeof shapesOf>[0]) => shapesOf(postings, "USD")![0]!;

const paycheckPostings = [
  { account: "Assets:Bank:PNC", units: usd("1000.00") },
  { account: "Income:Salary", units: usd("-1000.00") },
];
const repairPostings = [
  { account: "Assets:Bank:PNC", units: usd("-500.00") },
  { account: "Expenses:Home:Maintenance", units: usd("500.00") },
];
const transferPostings = [
  { account: "Assets:Bank:PNC", units: usd("-2000.00") },
  { account: "Assets:Fidelity:Cash", units: usd("2000.00") },
];
const buyPostings = [
  { account: "Assets:Fidelity:Cash", units: usd("-3000.00") },
  {
    account: "Assets:Fidelity:VTI",
    units: { number: "10", currency: "VTI" },
    cost: { number: "300.00", currency: "USD" },
  },
];
const paycheck = one(paycheckPostings);
const repair = one(repairPostings);
const toBrokerage = one(transferPostings);
const said = (postings: Parameters<typeof shapesOf>[0], lines: FundLine[]) =>
  effectsInWords(effects(postings, lines, [], "2026-11-03"), "USD");

const row = (fund: string, amount: string, change: Partial<FundRow> = {}): FundRow => ({
  ...blankRow("into", "USD", false),
  fund,
  amount,
  ...change,
});

describe("Kael's examples", () => {
  it("a transfer for Emergency: the whole amount, by choosing the fund", () => {
    const rows = rowsFrom(null, [toBrokerage], "USD");
    expect(rows).toHaveLength(1);
    const chosen = [{ ...rows[0]!, fund: "Emergency" }];
    expect(linesOf(chosen, toBrokerage)).toEqual([line("Emergency", "2000.00")]);
    expect(said(transferPostings, linesOf(chosen, toBrokerage))).toBe(
      "Emergency +$2,000.00 · Unallocated −$2,000.00"
    );
  });

  it("spending from Emergency: a line out of it", () => {
    const chosen = [{ ...rowsFrom(null, [repair], "USD")[0]!, fund: "Emergency" }];
    expect(linesOf(chosen, repair)).toEqual([line("Emergency", "-500.00")]);
    expect(said(repairPostings, linesOf(chosen, repair))).toBe(
      "Emergency −$500.00 · Unallocated +$0.00"
    );
  });

  it("a paycheck split 500 and 500: typing into the second leaves the rest in the first", () => {
    const first = { ...rowsFrom(null, [paycheck], "USD")[0]!, fund: "Emergency" };
    const second = row("Special Home Maintenance", "500");
    const lines = linesOf([first, second], paycheck);
    // Written with their cents, however they were typed.
    expect(lines).toEqual([
      line("Emergency", "500.00"),
      line("Special Home Maintenance", "500.00"),
    ]);
    expect(said(paycheckPostings, lines)).toBe(
      "Emergency +$500.00 · Special Home Maintenance +$500.00 · Unallocated +$0.00"
    );
  });
});

describe("shares (Funds B)", () => {
  const shapes = shapesOf(buyPostings, "USD")!;
  const [cash, shares] = shapes as [FundShape, FundShape];

  it("has rows per commodity, shares written as typed", () => {
    const rows = rowsFrom(null, shapes, "USD");
    expect(rows.map((r) => [r.currency, r.side])).toEqual([
      ["USD", "from"],
      ["VTI", "into"],
    ]);
    const vti = [{ ...rowsIn(rows, "VTI")[0]!, fund: "Emergency" }];
    expect(amountsOf(vti, shares).get(vti[0]!.key)).toBe("10");
    expect(linesOf(vti, shares)).toEqual([line("Emergency", "10", "VTI")]);
    expect(rowsProblem([{ ...vti[0]!, amount: "x", follows: false }], shares)).toBe(
      "Amounts are numbers, like 10"
    );
  });

  it("knows a fund's whole trade, and each side's fund", () => {
    const lines = [line("Emergency", "-3000.00"), line("Emergency", "10", "VTI")];
    expect(wholeFund(lines, shapes)).toBe("Emergency");
    expect(wholeSide(lines, cash)).toBe("Emergency");
    expect(wholeSide([line("Wedding", "10", "VTI")], cash)).toBe("");
    expect(wholeSide([line("Wedding", "4", "VTI")], shares)).toBeNull();
    expect(said(buyPostings, lines)).toBe("Emergency −$3,000.00 and +10 VTI · Unallocated +$0.00");
    expect(said(buyPostings, [])).toBe("Unallocated −$3,000.00 and +10 VTI");
  });

  it("refuses to take a share a fund doesn't have, and notes money below zero", () => {
    const sale = [
      { account: "Assets:Fidelity:VTI", units: { number: "-20", currency: "VTI" } },
      { account: "Assets:Fidelity:Cash", units: usd("6100.00") },
      { account: "Income:Capital-Gains" },
    ];
    const holdings = new Map([
      ["Unallocated", new Map([["VTI", "0"]])],
      ["Wedding", new Map([["VTI", "30"]])],
      ["Emergency", new Map([["USD", "200.00"]])],
    ]);
    const unmarked = belowZero(effects(sale, [], [], "2026-11-04"), null, holdings);
    expect(unmarked).toEqual([
      { fund: "Unallocated", currency: "VTI", number: "-20", had: "0", takes: "20" },
    ]);
    expect(suggestedFund(unmarked, holdings, ["Wedding", "Emergency"])).toBe("Wedding");
    expect(suggestedFund(unmarked, holdings, ["Wedding", "Emergency", "Other"])).toBe("Wedding");
    const both = new Map([...holdings, ["Other", new Map([["VTI", "25"]])]]);
    expect(suggestedFund(unmarked, both, ["Wedding", "Other"])).toBeNull();
    // Money below zero is reported too (the section makes it a note).
    expect(
      belowZero(
        effects(repairPostings, [line("Emergency", "-500.00")], [], "2026-11-03"),
        null,
        holdings
      )
    ).toEqual([
      { fund: "Emergency", currency: "USD", number: "-300.00", had: "200.00", takes: "500.00" },
    ]);
  });
});

describe("rows", () => {
  it("a saved whole line follows the transaction; a partial one keeps its amount", () => {
    const [whole] = rowsFrom([line("Emergency", "1000.00")], [paycheck], "USD");
    expect(whole).toMatchObject({ fund: "Emergency", amount: "1000.00", follows: true });
    const [part] = rowsFrom([line("Emergency", "400.00")], [paycheck], "USD");
    expect(part).toMatchObject({ amount: "400.00", follows: false });
    const bigger = one([
      { account: "Assets:Bank:PNC", units: usd("1200.00") },
      { account: "Income:Salary", units: null },
    ]);
    expect(linesOf([whole!], bigger)).toEqual([line("Emergency", "1200.00")]);
    expect(linesOf([part!], bigger)).toEqual([line("Emergency", "400.00")]);
  });

  it("reads saved lines out of a fund as rows on the from side", () => {
    const rows = rowsFrom(
      [line("Emergency", "-2000.00"), line("Vacation", "2000.00")],
      [toBrokerage],
      "USD"
    );
    expect(rows.map((r) => [r.fund, r.side, r.amount, r.follows])).toEqual([
      ["Emergency", "from", "2000.00", true],
      ["Vacation", "into", "2000.00", true],
    ]);
  });

  it("a following row never goes below zero, and isn't a line then", () => {
    const first = { ...blankRow("into", "USD"), fund: "Emergency" };
    const rows = [first, row("Wedding", "1500")];
    expect(amountsOf(rows, paycheck).get(first.key)).toBe("0.00");
    expect(linesOf(rows, paycheck)).toEqual([line("Wedding", "1500.00")]);
    expect(rowsProblem(rows, paycheck)).toBe("Give Emergency an amount, or remove it");
  });

  it("takes what people type around an amount", () => {
    expect(linesOf([row("Emergency", "$1,000.00")], paycheck)).toEqual([
      line("Emergency", "1000.00"),
    ]);
    expect(rowsProblem([row("Emergency", "ten")], paycheck)).toBe(
      "Amounts are numbers, like 500.00"
    );
  });

  it("a row without a fund is no line (it stays Unallocated)", () => {
    expect(linesOf([row("", "300")], paycheck)).toEqual([]);
    expect(rowsProblem([row("", "300")], paycheck)).toBeNull();
  });
});

describe("in words", () => {
  it("signs amounts always", () => {
    expect(signedMoney("500", "USD")).toBe("+$500.00");
    expect(signedMoney("-300", "USD")).toBe("−$300.00");
    expect(signedMoney("0", "USD")).toBe("+$0.00");
    expect(signedMoney("10", "VTI")).toBe("+10 VTI");
  });

  it("reads a line's verb by the transaction's kind", () => {
    expect(verb(paycheck, "into")).toBe("To");
    expect(verb(repair, "from")).toBe("From");
    expect(verb(toBrokerage, "into")).toBe("For");
    expect(verb(toBrokerage, "from")).toBe("From");
  });
});

describe("checks", () => {
  it("knows a whole line from a split or partial one", () => {
    expect(wholeFund(null, [paycheck])).toBe("");
    expect(wholeFund([line("Emergency", "1000")], [paycheck])).toBe("Emergency");
    expect(wholeFund([line("Emergency", "-500.00")], [repair])).toBe("Emergency");
    expect(wholeFund([line("Emergency", "400")], [paycheck])).toBeNull();
    expect(wholeFund([line("A", "500"), line("B", "500")], [paycheck])).toBeNull();
    expect(wholeFund([line("Emergency", "-2000.00")], [toBrokerage])).toBeNull();
  });

  it("compares lines in any order, however their numbers are written", () => {
    expect(
      sameLines([line("A", "5"), line("B", "1.50")], [line("B", "1.5"), line("A", "5.00")])
    ).toBe(true);
    expect(sameLines([line("A", "5")], [line("A", "-5")])).toBe(false);
    expect(sameLines(null, [])).toBe(true);
  });
});
