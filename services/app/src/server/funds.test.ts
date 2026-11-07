import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { AppDb } from "./db.js";

const fresh = () => new AppDb(join(mkdtempSync(join(tmpdir(), "app-")), "app.sqlite"));

describe("starred funds", () => {
  it("are each user's own, in the order they were starred, once each", () => {
    const db = fresh();
    db.starFund("u", "b", "Wedding");
    db.starFund("u", "b", "Emergency");
    db.starFund("u", "b", "Wedding");
    db.starFund("v", "b", "Roof");
    db.starFund("u", "other", "Roof");

    expect(db.fundStars("u", "b")).toEqual(["Wedding", "Emergency"]);
    expect(db.fundStars("v", "b")).toEqual(["Roof"]);

    db.unstarFund("u", "b", "Wedding");
    expect(db.fundStars("u", "b")).toEqual(["Emergency"]);
  });
});

describe("renaming a fund (Funds A)", () => {
  it("follows into the rules, schedules and stars that name it", () => {
    const db = fresh();
    const rule = db.addRule("b", {
      name: "Kroger",
      conditions: { account: null, key: null, contains: "kroger", min: null, max: null },
      account: "Expenses:Groceries",
      payee: null,
      fund: "Household",
      auto_confirm: false,
    });
    const schedule = db.addSchedule({
      user_id: "u",
      book_id: "b",
      name: "Savings",
      rule: {
        every: 1,
        unit: "month",
        days: [],
        start: "2026-01-01",
        until: null,
        weekend: "keep",
      },
      template: {
        payee: null,
        narration: "To savings",
        tags: [],
        links: [],
        meta: {},
        funds: [{ fund: "Household", amount: { number: "200.00", currency: "USD" } }],
        postings: [
          { account: "Assets:PNC", units: { number: "-200.00", currency: "USD" } },
          { account: "Assets:Savings", units: null },
        ],
      },
      paused: false,
      auto_confirm: false,
    });

    db.starFund("u", "b", "Household");
    db.starFund("u", "b", "Emergency");

    db.renameFund("b", "Household", "Home and Family");

    expect(db.fundStars("u", "b")).toEqual(["Home and Family", "Emergency"]);
    expect(db.rule("b", rule)!.fund).toBe("Home and Family");
    expect(db.schedule("b", schedule)!.template.funds).toEqual([
      { fund: "Home and Family", amount: { number: "200.00", currency: "USD" } },
    ]);
  });
});
