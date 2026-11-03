import { describe, expect, it } from "vitest";

import { shapeOf, type FundLine } from "../../shared/funds.js";
import {
  amountsOf,
  belowZero,
  blankRow,
  effectsInWords,
  linesOf,
  rowsFrom,
  rowsProblem,
  sameLines,
  signedMoney,
  verb,
  wholeFund,
  type FundRow,
} from "./funds.js";

const usd = (number: string) => ({ number, currency: "USD" });
const line = (fund: string, number: string): FundLine => ({ fund, amount: usd(number) });

const paycheck = shapeOf(
  [
    { account: "Assets:Bank:PNC", units: usd("1000.00") },
    { account: "Income:Salary", units: usd("-1000.00") },
  ],
  "USD"
);
const repair = shapeOf(
  [
    { account: "Assets:Bank:PNC", units: usd("-500.00") },
    { account: "Expenses:Home:Maintenance", units: usd("500.00") },
  ],
  "USD"
);
const toBrokerage = shapeOf(
  [
    { account: "Assets:Bank:PNC", units: usd("-2000.00") },
    { account: "Assets:Fidelity:Cash", units: usd("2000.00") },
  ],
  "USD"
);

const row = (fund: string, amount: string, change: Partial<FundRow> = {}): FundRow => ({
  ...blankRow("into", false),
  fund,
  amount,
  ...change,
});

describe("Kael's examples", () => {
  it("a transfer for Emergency: the whole amount, by choosing the fund", () => {
    const rows = rowsFrom(null, toBrokerage);
    expect(rows).toHaveLength(1);
    const chosen = [{ ...rows[0]!, fund: "Emergency" }];
    expect(linesOf(chosen, toBrokerage)).toEqual([line("Emergency", "2000.00")]);
    expect(effectsInWords(toBrokerage, linesOf(chosen, toBrokerage))).toBe(
      "Emergency +$2,000.00 · Unallocated −$2,000.00"
    );
  });

  it("spending from Emergency: a line out of it", () => {
    const rows = rowsFrom(null, repair);
    const chosen = [{ ...rows[0]!, fund: "Emergency" }];
    expect(linesOf(chosen, repair)).toEqual([line("Emergency", "-500.00")]);
    expect(effectsInWords(repair, linesOf(chosen, repair))).toBe(
      "Emergency −$500.00 · Unallocated +$0.00"
    );
  });

  it("a paycheck split 500 and 500: typing into the second leaves the rest in the first", () => {
    const first = { ...rowsFrom(null, paycheck)[0]!, fund: "Emergency" };
    const second = row("Special Home Maintenance", "500");
    const lines = linesOf([first, second], paycheck);
    // Written with their cents, however they were typed.
    expect(lines).toEqual([
      line("Emergency", "500.00"),
      line("Special Home Maintenance", "500.00"),
    ]);
    expect(effectsInWords(paycheck, lines)).toBe(
      "Emergency +$500.00 · Special Home Maintenance +$500.00 · Unallocated +$0.00"
    );
  });
});

describe("rows", () => {
  it("a saved whole line follows the transaction; a partial one keeps its amount", () => {
    const [whole] = rowsFrom([line("Emergency", "1000.00")], paycheck);
    expect(whole).toMatchObject({ fund: "Emergency", amount: "1000.00", follows: true });
    const [part] = rowsFrom([line("Emergency", "400.00")], paycheck);
    expect(part).toMatchObject({ amount: "400.00", follows: false });
    const bigger = shapeOf(
      [
        { account: "Assets:Bank:PNC", units: usd("1200.00") },
        { account: "Income:Salary", units: null },
      ],
      "USD"
    );
    expect(linesOf([whole!], bigger)).toEqual([line("Emergency", "1200.00")]);
    expect(linesOf([part!], bigger)).toEqual([line("Emergency", "400.00")]);
  });

  it("reads saved lines out of a fund as rows on the from side", () => {
    const rows = rowsFrom(
      [line("Emergency", "-2000.00"), line("Vacation", "2000.00")],
      toBrokerage
    );
    expect(rows.map((r) => [r.fund, r.side, r.amount, r.follows])).toEqual([
      ["Emergency", "from", "2000.00", true],
      ["Vacation", "into", "2000.00", true],
    ]);
    expect(linesOf(rows, toBrokerage)).toEqual([
      line("Emergency", "-2000.00"),
      line("Vacation", "2000.00"),
    ]);
  });

  it("a following row never goes below zero, and isn't a line then", () => {
    const first = { ...blankRow("into"), fund: "Emergency" };
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
  it("signs money always", () => {
    expect(signedMoney("500", "USD")).toBe("+$500.00");
    expect(signedMoney("-300", "USD")).toBe("−$300.00");
    expect(signedMoney("0", "USD")).toBe("+$0.00");
  });

  it("reads a line's verb by the transaction's kind", () => {
    expect(verb(paycheck, "into")).toBe("To");
    expect(verb(repair, "from")).toBe("From");
    expect(verb(toBrokerage, "into")).toBe("For");
    expect(verb(toBrokerage, "from")).toBe("From");
  });
});

describe("checks", () => {
  it("says which funds would go below zero", () => {
    const balances = new Map([
      ["Emergency", "200.00"],
      ["Wedding", "50.00"],
    ]);
    expect(belowZero([line("Emergency", "-500.00")], null, balances)).toEqual([
      { fund: "Emergency", number: "-300.00" },
    ]);
    // Its own saved line is already in the balance.
    expect(
      belowZero([line("Emergency", "-500.00")], [line("Emergency", "-500.00")], balances)
    ).toEqual([]);
    expect(belowZero([line("Wedding", "100.00")], null, balances)).toEqual([]);
  });

  it("knows a whole line from a split or partial one", () => {
    expect(wholeFund(null, paycheck)).toBe("");
    expect(wholeFund([line("Emergency", "1000")], paycheck)).toBe("Emergency");
    expect(wholeFund([line("Emergency", "-500.00")], repair)).toBe("Emergency");
    expect(wholeFund([line("Emergency", "400")], paycheck)).toBeNull();
    expect(wholeFund([line("A", "500"), line("B", "500")], paycheck)).toBeNull();
    expect(wholeFund([line("Emergency", "-2000.00")], toBrokerage)).toBeNull();
  });

  it("compares lines in any order, however their numbers are written", () => {
    expect(
      sameLines([line("A", "5"), line("B", "1.50")], [line("B", "1.5"), line("A", "5.00")])
    ).toBe(true);
    expect(sameLines([line("A", "5")], [line("A", "-5")])).toBe(false);
    expect(sameLines(null, [])).toBe(true);
  });
});
