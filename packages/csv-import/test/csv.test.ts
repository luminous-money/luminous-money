import { describe, expect, it } from "vitest";

import {
  applyProfile,
  detectDateFormat,
  fits,
  guessProfile,
  parseAmount,
  parseDate,
} from "../src/index.js";

const CHASE = `Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #
DEBIT,01/15/2024,"STARBUCKS STORE 123 SEATTLE WA",-4.50,DEBIT_CARD,"1,234.56",
CREDIT,01/14/2024,"ACME PAYROLL DIRECT DEP",2000.00,ACH_CREDIT,1239.06,
DEBIT,01/13/2024,"CHECK 1001",-150.00,CHECK_PAID,-760.94,1001
`;

const BOFA = `Description,,Summary Amt.
Beginning balance as of 01/01/2024,,"1,000.00"
Total credits,,"2,000.00"
Ending balance as of 01/31/2024,,"2,845.50"

Date,Description,Amount,Running Bal.
01/02/2024,"WHOLEFDS MKT 10234",-54.50,945.50
01/03/2024,"Online Banking transfer from SAV",100.00,1045.50
`;

const UK = `Date,Description,Money Out,Money In,Balance
25/01/2024,TESCO STORES,12.40,,987.60
26/01/2024,SALARY,,2500.00,3487.60
`;

const BARE = `2024-01-15,-4.50,STARBUCKS
2024-01-16,-12.00,LYFT RIDE
`;

describe("guessing a profile", () => {
  it("reads a typical export with a header", () => {
    const profile = guessProfile(CHASE)!;

    expect(profile).toMatchObject({
      skip: 0,
      header: true,
      date: { column: 1, format: "MM/DD/YYYY" },
      amount: { kind: "signed", column: 3, negate: false },
      description: 2,
      balance: 5,
      id: 6,
    });
    expect(profile.columns[2]).toBe("Description");
  });

  it("skips a summary preamble to find the real header", () => {
    const profile = guessProfile(BOFA)!;

    expect(profile).toMatchObject({
      skip: 4,
      header: true,
      date: { column: 0 },
      amount: { column: 2 },
      description: 1,
      balance: 3,
    }); // blank lines don't count
    expect(applyProfile(BOFA, profile).map((r) => [r.date, r.amount])).toEqual([
      ["2024-01-02", "-54.50"],
      ["2024-01-03", "100.00"],
    ]);
  });

  it("finds separate money-out and money-in columns, and day-first dates", () => {
    const profile = guessProfile(UK)!;

    expect(profile.amount).toEqual({ kind: "split", debit: 2, credit: 3 });
    expect(profile.date.format).toBe("DD/MM/YYYY");
    expect(applyProfile(UK, profile).map((r) => r.amount)).toEqual(["-12.40", "2500.00"]);
  });

  it("works without a header, naming the columns by position", () => {
    const profile = guessProfile(BARE)!;

    expect(profile).toMatchObject({
      header: false,
      skip: 0,
      date: { column: 0, format: "YYYY-MM-DD" },
      amount: { column: 1 },
      description: 2,
    });
    expect(profile.columns).toEqual(["Column 1", "Column 2", "Column 3"]);
  });

  it("gives up on something that isn't a table of transactions", () => {
    expect(guessProfile("hello\nworld\n")).toBeNull();
    expect(guessProfile("a,b\nc,d\n")).toBeNull();
  });
});

describe("applying a profile", () => {
  it("normalizes every row: ISO dates, signed decimal amounts, the description", () => {
    const rows = applyProfile(CHASE, guessProfile(CHASE)!);

    expect(
      rows.map(({ line, date, amount, description, id, balance, error }) => ({
        line,
        date,
        amount,
        description,
        id,
        balance,
        error,
      }))
    ).toEqual([
      {
        line: 2,
        date: "2024-01-15",
        amount: "-4.50",
        description: "STARBUCKS STORE 123 SEATTLE WA",
        id: null,
        balance: "1234.56",
        error: null,
      },
      {
        line: 3,
        date: "2024-01-14",
        amount: "2000.00",
        description: "ACME PAYROLL DIRECT DEP",
        id: null,
        balance: "1239.06",
        error: null,
      },
      {
        line: 4,
        date: "2024-01-13",
        amount: "-150.00",
        description: "CHECK 1001",
        id: "1001",
        balance: "-760.94",
        error: null,
      },
    ]);
  });

  it("can flip signs, for files where withdrawals are positive", () => {
    const profile = guessProfile(CHASE)!;
    const flipped = { ...profile, amount: { kind: "signed" as const, column: 3, negate: true } };

    expect(applyProfile(CHASE, flipped).map((r) => r.amount)).toEqual([
      "4.50",
      "-2000.00",
      "150.00",
    ]);
  });

  it("says why a row can't be read", () => {
    const profile = guessProfile(CHASE)!;
    const broken = `${CHASE}DEBIT,13/45/2024,BAD DATE,-1.00,X,1,\nDEBIT,01/16/2024,NO AMOUNT,,X,1,\nDEBIT,01/16/2024\n`;

    expect(
      applyProfile(broken, profile)
        .slice(3)
        .map((r) => r.error)
    ).toEqual([
      '"13/45/2024" isn\'t a MM/DD/YYYY date',
      "no amount",
      "expected 7 columns, found 2",
    ]);
  });

  it("checks a later file has the same layout", () => {
    const profile = guessProfile(CHASE)!;

    expect(fits(profile, CHASE.replace("STARBUCKS", "PEETS"))).toBe(true);
    expect(fits(profile, UK)).toBe(false);
    expect(fits(profile, CHASE.replace("Posting Date", "Date"))).toBe(false);
  });
});

it.each([
  ["-4.50", "-4.50"],
  ["$1,234.56", "1234.56"],
  ["(12.00)", "-12.00"],
  ["12.00-", "-12.00"],
  ["+3", "3"],
  [".5", "0.5"],
  ["-0.00", "0.00"],
  ["", null],
  ["abc", null],
  ["1.2.3", null],
])("reads the amount %j as %j", (cell, expected) => {
  expect(parseAmount(cell)).toBe(expected);
});

describe("dates", () => {
  it("parse only real dates in their format", () => {
    expect(parseDate("1/5/2024", "MM/DD/YYYY")).toBe("2024-01-05");
    expect(parseDate("02/30/2024", "MM/DD/YYYY")).toBeNull();
    expect(parseDate("2024-01-05 10:22:00", "YYYY-MM-DD")).toBe("2024-01-05");
    expect(parseDate("05.01.2024", "DD.MM.YYYY")).toBe("2024-01-05");
    expect(parseDate("01/05/24", "MM/DD/YY")).toBe("2024-01-05");
  });

  it("detect the one format every value fits, month-first when it's ambiguous", () => {
    expect(detectDateFormat(["01/05/2024", "02/06/2024"])).toBe("MM/DD/YYYY");
    expect(detectDateFormat(["13/05/2024", "02/06/2024"])).toBe("DD/MM/YYYY");
    expect(detectDateFormat(["20240105"])).toBe("YYYYMMDD");
    expect(detectDateFormat(["soon"])).toBeNull();
  });
});

it("isn't thrown by a stray bad row when guessing", () => {
  const file = `Date,Description,Amount\n03/01/2024,A,-1.00\n03/02/2024,B,-2.00\n03/03/2024,C,-3.00\n03/04/2024,D,-4.00\n03/05/2024,E,oops\n`;

  const profile = guessProfile(file)!;

  expect(profile.amount).toEqual({ kind: "signed", column: 2, negate: false });
  expect(applyProfile(file, profile).at(-1)!.error).toBe("no amount");
});
