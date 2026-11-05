import { describe, expect, it } from "vitest";

import { loanCsvRows, readLoanCsv, usual } from "./loan-csv.js";
import { rowProblems } from "./loans.js";

// A made-up lender's export: a title line, then the header, payments, and a totals line.
const CSV = `Amortization Schedule for Loan 0000
Pmt #,Due Date,Payment,Principal,Interest,Escrow,Remaining Balance
1,08/01/2016,"$1,839.35",$451.85,$937.50,$450.00,"$299,548.15"
2,09/01/2016,"$1,839.35",$453.26,$936.09,$450.00,"$299,094.89"
3,10/01/2016,"$1,839.35",$454.68,$934.67,$450.00,"$298,640.21"
Totals,,"$5,518.05","$1,359.79","$2,808.26","$1,350.00",
`;

describe("a lender's CSV schedule", () => {
  it("guesses its columns from the header, past a title line", () => {
    const { headers, mapping, data } = readLoanCsv(CSV);
    expect(headers[0]).toBe("Pmt #");
    expect(mapping).toEqual({
      number: 0,
      date: 1,
      principal: 3,
      interest: 4,
      escrow: 5,
      balance: 6,
    });
    expect(data).toHaveLength(4);
  });

  it("reads the payments, leaving out the totals, and their escrow", () => {
    const { data, mapping } = readLoanCsv(CSV);
    const { rows, escrow, problem } = loanCsvRows(data, mapping);
    expect(problem).toBeNull();
    expect(rows).toEqual([
      {
        number: 1,
        date: "2016-08-01",
        principal: "451.85",
        interest: "937.50",
        balance: "299548.15",
      },
      {
        number: 2,
        date: "2016-09-01",
        principal: "453.26",
        interest: "936.09",
        balance: "299094.89",
      },
      {
        number: 3,
        date: "2016-10-01",
        principal: "454.68",
        interest: "934.67",
        balance: "298640.21",
      },
    ]);
    expect(rowProblems(rows)).toEqual([]);
    expect(usual(escrow)).toBe("450.00");
  });

  it("reads a column of months on the payment day", () => {
    const text =
      "Month,Principal,Interest,Balance\n08/2016,1.00,2.00,99.00\n2016-09,1.00,1.98,98.00\n";
    const { data, mapping } = readLoanCsv(text);
    expect(loanCsvRows(data, mapping, 15).rows.map((r) => r.date)).toEqual([
      "2016-08-15",
      "2016-09-15",
    ]);
  });

  it("says what's missing", () => {
    const { data, mapping } = readLoanCsv("Date,Amount\n2024-01-01,5.00\n");
    expect(loanCsvRows(data, mapping).problem).toMatch(/principal, interest and balance/);
  });
});
