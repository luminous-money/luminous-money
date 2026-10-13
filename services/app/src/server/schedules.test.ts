import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import type { ScheduleIn } from "../shared/schedule.js";
import { AppDb, StaleVersion } from "./db.js";
import {
  createSchedule,
  editSchedule,
  runSchedules,
  ScheduleProblem,
  upcomingOccurrences,
} from "./schedules.js";
import { FakeLedger } from "./testing.js";

const CHECKING = "Assets:Bank:Checking";
const RENT = "Expenses:Home:Rent";

let db: AppDb;
let ledger: FakeLedger;
const ledgerFor = () => ledger;

const rent = (over: Partial<ScheduleIn["rule"]> = {}): ScheduleIn => ({
  name: "Rent",
  rule: {
    every: 1,
    unit: "month",
    days: [],
    start: "2024-01-01",
    until: null,
    weekend: "keep",
    ...over,
  },
  template: {
    payee: "Landlord",
    narration: "Rent",
    tags: [],
    links: [],
    meta: {},
    postings: [
      { account: CHECKING, units: { number: "-1500.00", currency: "USD" } },
      { account: RENT, units: null },
    ],
  },
});

const create = (input: ScheduleIn, on: string) =>
  createSchedule({ db, ledgerFor, user: "u", book: "b", input, on });

beforeEach(() => {
  db = new AppDb(join(mkdtempSync(join(tmpdir(), "app-")), "app.sqlite"));
  ledger = new FakeLedger();
  ledger.addBook("b");
  ledger.addAccount(CHECKING);
  ledger.addAccount(RENT, { type: "expense" });
});

describe("the generator", () => {
  it("stages every due occurrence, pending and marked, once", async () => {
    const s = await create(rent(), "2024-03-15"); // a start in the past backfills

    expect(ledger.transactions.map((t) => [t.date, t.flag, t.payee])).toEqual([
      ["2024-01-01", "!", "Landlord"],
      ["2024-02-01", "!", "Landlord"],
      ["2024-03-01", "!", "Landlord"],
    ]);
    expect(ledger.transactions[0]!.meta).toEqual({ schedule: s.id, "schedule-date": "2024-01-01" });
    expect(s).toMatchObject({ generated_through: "2024-03-01", next: { date: "2024-04-01" } });
    expect(await runSchedules({ db, ledgerFor, on: "2024-03-31" })).toBe(0);
    expect(await runSchedules({ db, ledgerFor, on: "2024-04-01" })).toBe(1);
    expect(Object.keys(db.scheduledTransactions("b"))).toHaveLength(4);
  });

  it("doesn't bring back an occurrence that was deleted (skipped)", async () => {
    await create(rent(), "2024-02-15");
    ledger.transactions.pop();

    await runSchedules({ db, ledgerFor, on: "2024-02-20" });

    expect(ledger.transactions.map((t) => t.date)).toEqual(["2024-01-01"]);
  });

  it("skips paused schedules, and keeps a failing schedule's error without stopping others", async () => {
    await create({ ...rent(), paused: true }, "2024-03-15");
    const failing = await create(
      { ...rent(), name: "Broken", rule: { ...rent().rule, start: "2024-04-01" } },
      "2024-03-15"
    );
    const ok = await create(
      { ...rent(), name: "Fine", rule: { ...rent().rule, start: "2024-04-01" } },
      "2024-03-15"
    );
    expect(ledger.transactions).toHaveLength(0);

    const real = ledger.createTransactions.bind(ledger);
    ledger.createTransactions = async (book, transactions) => {
      if (transactions[0]!.meta?.["schedule"] === failing.id) throw new Error("account closed");
      return real(book, transactions);
    };
    await runSchedules({ db, ledgerFor, on: "2024-04-01" });

    expect(db.schedule("b", failing.id)!.last_error).toBe("account closed");
    expect(db.schedule("b", ok.id)!.generated_through).toBe("2024-04-01");
    expect(ledger.transactions).toHaveLength(1);
  });
});

describe("saving schedules", () => {
  it("refuses one that can't be staged", async () => {
    const bad = (input: ScheduleIn) =>
      expect(create(input, "2024-01-01")).rejects.toThrow(ScheduleProblem);
    await bad({ ...rent(), name: " " });
    await bad({ ...rent(), rule: { ...rent().rule, every: 0 } });
    await bad({
      ...rent(),
      template: { ...rent().template, postings: [rent().template.postings[0]!] },
    });
    await bad({
      ...rent(),
      template: {
        ...rent().template,
        postings: [{ account: "Expenses:Nope", units: null }, ...rent().template.postings],
      },
    });
  });

  it("an edited rule applies from today, never staging dates already past", async () => {
    const s = await create(rent({ start: "2024-04-01" }), "2024-03-10");

    const edited = await editSchedule({
      db,
      ledgerFor,
      user: "u",
      book: "b",
      id: s.id,
      on: "2024-04-20",
      patch: { updated_at: s.updated_at, rule: rent({ start: "2024-01-01", days: [15] }).rule },
    });

    expect(ledger.transactions).toHaveLength(0); // not Jan 15 to Apr 15
    expect(edited.next).toMatchObject({ date: "2024-05-15" });
  });

  it("edits are versioned", async () => {
    const s = await create(rent({ start: "2025-01-01" }), "2024-03-10");
    const edit = (updated_at: string) =>
      editSchedule({
        db,
        ledgerFor,
        user: "u",
        book: "b",
        id: s.id,
        patch: { updated_at, name: "Flat" },
        on: "2024-03-10",
      });

    const renamed = await edit(s.updated_at);
    await expect(edit(s.updated_at)).rejects.toThrow(StaleVersion);
    expect(renamed.name).toBe("Flat");
  });
});

it("lists what's coming across schedules, not what's staged", async () => {
  await create(rent(), "2024-03-15");
  await create({ ...rent({ unit: "week", start: "2024-03-22" }), name: "Allowance" }, "2024-03-15");

  const coming = upcomingOccurrences(db, "b", "2024-03-15", 21);

  expect(coming.map((o) => [o.date, o.name])).toEqual([
    ["2024-03-22", "Allowance"],
    ["2024-03-29", "Allowance"],
    ["2024-04-01", "Rent"],
    ["2024-04-05", "Allowance"],
  ]);
});
