import { expect, it } from "vitest";

import type { UpcomingOccurrence } from "./appApi.js";
import { upcomingFor } from "./upcoming.js";

const usd = (number: string) => ({ number, currency: "USD" });
const occurrence = (date: string, postings: UpcomingOccurrence["template"]["postings"]) =>
  ({
    nominal: date,
    date,
    schedule_id: "s",
    name: "Rent",
    template: { payee: "Landlord", narration: "", tags: [], links: [], meta: {}, postings },
  }) as UpcomingOccurrence;

it("projects the balance through each occurrence touching the account, newest first", () => {
  const rows = upcomingFor(
    [
      occurrence("2024-04-01", [
        { account: "Assets:Checking", units: usd("-1500.00") },
        { account: "Expenses:Rent", units: null },
      ]),
      occurrence("2024-04-05", [{ account: "Expenses:Other", units: usd("1") }]), // not here
      occurrence("2024-04-15", [
        { account: "Income:Salary", units: usd("-2000.00") },
        { account: "Assets:Checking", units: null }, // the blank split: what balances the rest
      ]),
    ],
    "Assets:Checking",
    [usd("1000.00")]
  );

  expect(rows.map((r) => [r.date, r.amount?.number, r.balance?.number])).toEqual([
    ["2024-04-15", "2000.00", "1500.00"],
    ["2024-04-01", "-1500.00", "-500.00"],
  ]);
});

it("leaves the balance out when it can't be told", () => {
  const rows = upcomingFor(
    [
      occurrence("2024-04-01", [
        { account: "A", units: usd("1") },
        { account: "B", units: null },
      ]),
    ],
    "A",
    [usd("1"), { number: "1", currency: "EUR" }]
  );

  expect(rows[0]!.balance).toBeNull();
});
