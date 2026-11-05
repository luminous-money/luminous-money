import { describe as group, expect, it } from "vitest";

import {
  amortize,
  cents,
  dueDates,
  importedTable,
  interestOn,
  loanProblem,
  money,
  paymentFor,
  paymentOn,
  paymentPostings,
  project,
  rateOf,
  rowProblems,
  termsTable,
  type LoanTerms,
} from "./loans.js";

// The plan's made-up mortgage: $300,000 at 3.75% for 30 years, first payment 2016-08-01.
const terms: LoanTerms = {
  amount: "300000.00",
  rate: "3.75",
  payments: 360,
  first: "2016-08-01",
  payment: null,
};
const table = termsTable(terms);
const spec = { tables: [table], others: [], extras: [] };

group("cents", () => {
  it("reads and writes two places, rounding half away from zero past them", () => {
    expect(cents("12.5")).toBe(1250n);
    expect(cents("-0.015")).toBe(-2n);
    expect(cents("7.004")).toBe(700n);
    expect(money(-5n)).toBe("-0.05");
    expect(money(123456n)).toBe("1234.56");
  });

  it("charges a month's interest at a yearly rate", () => {
    expect(interestOn(cents("300000.00"), "3.75")).toBe(93750n);
    expect(interestOn(cents("1000.00"), "0")).toBe(0n);
  });
});

group("amortizing", () => {
  it("works out the payment and pays the loan off exactly", () => {
    expect(paymentFor("300000.00", "3.75", 360)).toBe("1389.35");
    const rows = amortize(terms);
    expect(rows).toHaveLength(360);
    expect(rows[0]).toEqual({
      number: 1,
      date: "2016-08-01",
      principal: "451.85",
      interest: "937.50",
      balance: "299548.15",
    });
    expect(rows.at(-1)!.balance).toBe("0.00");
    expect(rows.at(-1)!.date).toBe("2046-07-01");
    expect(rows[122]!.balance).toBe("232357.56");
  });

  it("keeps a short month's last day, then goes back to the day", () => {
    expect(dueDates("2024-01-31", 3)).toEqual(["2024-01-31", "2024-02-29", "2024-03-31"]);
  });

  it("pays a rate of 0 off in equal parts", () => {
    const rows = amortize({ ...terms, amount: "1200.00", rate: "0", payments: 12 });
    expect(rows.every((r) => r.interest === "0.00" && r.principal === "100.00")).toBe(true);
  });
});

group("imported tables", () => {
  const rows = amortize(terms).slice(0, 30);

  it("work out their rate and payment", () => {
    expect(rateOf(rows)).toBe("3.75");
    const t = importedTable(rows, "csv");
    expect(t.payment).toBe("1389.35");
    expect(t.from).toBe("2016-08-01");
  });

  it("say which rows don't add up", () => {
    const off = rows.map((r) => (r.number === 3 ? { ...r, balance: "1.00" } : r));
    expect(rowProblems(off).map((p) => p.number)).toEqual([3, 4]);
    expect(rowProblems(rows)).toEqual([]);
  });
});

group("payments", () => {
  it("are the table's row while the books agree with it", () => {
    const p = paymentOn(spec, "2016-09-01", cents("299548.15"))!;
    expect(p).toMatchObject({
      number: 2,
      interest: "936.09",
      principal: "453.26",
      total: "1389.35",
      follows_table: true,
    });
  });

  it("are worked out from the books once they don't, the payment the same", () => {
    // $10,000 extra paid down before payment 2.
    const p = paymentOn(spec, "2016-09-01", cents("289548.15"))!;
    expect(p.follows_table).toBe(false);
    expect(p.interest).toBe("904.84");
    expect(p.principal).toBe("484.51");
    expect(p.total).toBe("1389.35");
  });

  it("end sooner after an extra payment", () => {
    const ahead = project(spec, "2016-08-01", cents("289548.15"));
    expect(ahead.length).toBeLessThan(359);
    expect(ahead.at(-1)!.owed_after).toBe("0.00");
    expect(project(spec, "2016-08-01", cents("299548.15"))).toHaveLength(359);
  });

  it("carry the others in force on their date, and extra principal", () => {
    const withEscrow = {
      ...spec,
      others: [
        { name: "Escrow", account: "Assets:Escrow", amount: "450.00", from: "2016-08-01" },
        { name: "Escrow", account: "Assets:Escrow", amount: "482.17", from: "2017-01-01" },
        { name: "PMI", account: "Expenses:Pmi", amount: "100.00", from: "2016-08-01" },
        { name: "PMI", account: "Expenses:Pmi", amount: "0", from: "2016-10-01" },
      ],
      extras: [{ amount: "100.00", from: "2016-12-01" }],
    };
    const [aug, , , , , jan] = project(withEscrow, null, cents("300000.00"), 6);
    expect(aug!.others.map((o) => [o.name, o.amount])).toEqual([
      ["Escrow", "450.00"],
      ["PMI", "100.00"],
    ]);
    expect(aug!.total).toBe("1939.35");
    expect(jan!.others).toEqual([{ name: "Escrow", account: "Assets:Escrow", amount: "482.17" }]);
    expect(jan!.extra).toBe("100.00");
    expect(jan!.total).toBe(money(cents("1389.35") + cents("482.17") + cents("100.00")));
  });

  it("stop once nothing's owed, the last paying only what's left", () => {
    const last = paymentOn(spec, "2046-07-01", cents("50.00"))!;
    expect(last.principal).toBe("50.00");
    expect(last.owed_after).toBe("0.00");
    expect(paymentOn(spec, "2046-08-01", 0n)).toBeNull();
  });

  it("follow a new table from its date", () => {
    const reset = termsTable(
      { amount: "232357.56", rate: "5.5", payments: 237, first: "2026-11-01", payment: null },
      "2026-11-01"
    );
    const two = { ...spec, tables: [table, reset] };
    const p = paymentOn(two, "2026-11-01", cents("232357.56"))!;
    expect(p.follows_table).toBe(true);
    expect(p.total).toBe(reset.payment);
    expect(paymentOn(two, "2026-10-01", cents("232357.56"))!.total).toBe("1389.35");
  });

  it("are splits: paid from one account, principal, interest, the others", () => {
    const p = paymentOn(
      {
        ...spec,
        others: [
          { name: "Escrow", account: "Assets:Escrow", amount: "450.00", from: "2016-08-01" },
        ],
      },
      "2016-08-01",
      cents("300000.00")
    )!;
    const accounts = {
      liability: "Liabilities:Mortgage",
      paying: "Assets:Checking",
      interest: "Expenses:Interest",
    };
    expect(paymentPostings(accounts, p, "USD").map((s) => [s.account, s.units?.number])).toEqual([
      ["Assets:Checking", "-1839.35"],
      ["Liabilities:Mortgage", "451.85"],
      ["Expenses:Interest", "937.50"],
      ["Assets:Escrow", "450.00"],
    ]);
    expect(paymentPostings(accounts, p, "USD", { blankPrincipal: true })[1]!.units).toBeNull();
  });
});

group("a loan that can be saved", () => {
  const loan = {
    name: "Mortgage",
    accounts: {
      liability: "Liabilities:Mortgage",
      paying: "Assets:Checking",
      interest: "Expenses:Interest",
      asset: null,
    },
    tables: [table],
    others: [],
    extras: [],
    tolerance: "0",
  };

  it("has a name, three accounts and a table", () => {
    expect(loanProblem(loan)).toBeNull();
    expect(loanProblem({ ...loan, name: " " })).toBe("Name the loan");
    expect(loanProblem({ ...loan, accounts: { ...loan.accounts, liability: "Assets:X" } })).toBe(
      "What's owed is a liability account"
    );
    expect(
      loanProblem({
        ...loan,
        others: [{ name: "Escrow", account: "Assets:Checking", amount: "1", from: "2016-08-01" }],
      })
    ).toMatch(/account of its own/);
  });
});
