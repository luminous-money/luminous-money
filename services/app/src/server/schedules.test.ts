import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { guessProfile } from "@luminous-money/csv-import";
import { beforeEach, describe, expect, it } from "vitest";

import type { ScheduleIn } from "../shared/schedule.js";
import { AppDb, StaleVersion } from "./db.js";
import { importFile } from "./imports.js";
import { confirmRow } from "./matches.js";
import {
  createSchedule,
  editSchedule,
  runSchedules,
  ScheduleProblem,
  upcomingOccurrences,
} from "./schedules.js";
import { untilLocal } from "./daily.js";
import { pricesJob } from "./prices.js";
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
  it("stages every due occurrence, unconfirmed and marked, once", async () => {
    const s = await create(rent(), "2024-03-15"); // a start in the past backfills

    expect(ledger.transactions.map((t) => [t.date, t.flag, t.payee])).toEqual([
      ["2024-01-01", "!", "Landlord"],
      ["2024-02-01", "!", "Landlord"],
      ["2024-03-01", "!", "Landlord"],
    ]);
    expect(ledger.transactions[0]!.meta).toEqual({ schedule: s.id, "schedule-date": "2024-01-01" });
    expect(s).toMatchObject({ last_applied: "2024-03-01", next: { date: "2024-04-01" } });
    expect(await runSchedules({ db, ledgerFor, on: "2024-03-31" })).toBe(0);
    expect(await runSchedules({ db, ledgerFor, on: "2024-04-01" })).toBe(1);
    expect(Object.keys(db.scheduledTransactions("b"))).toHaveLength(4);
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
    expect(db.schedule("b", ok.id)!.last_applied).toBe("2024-04-01");
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

describe("answers to M3's questions", () => {
  const edit = (id: string, updated_at: string, on: string, change: Partial<ScheduleIn>) =>
    editSchedule({ db, ledgerFor, user: "u", book: "b", id, on, patch: { updated_at, ...change } });

  it("editing resets to now: today's unconfirmed occurrence is staged again as edited", async () => {
    const s = await create(rent(), "2024-03-01"); // Jan, Feb and Mar 1, unconfirmed
    ledger.transactions[0]!.flag = "*"; // January's was confirmed

    await edit(s.id, s.updated_at, "2024-03-01", {
      template: { ...rent().template, payee: "New landlord" },
    });

    expect(ledger.transactions.map((t) => [t.date, t.flag, t.payee])).toEqual([
      ["2024-01-01", "*", "Landlord"],
      ["2024-02-01", "!", "Landlord"], // before today: kept as it was
      ["2024-03-01", "!", "New landlord"],
    ]);
    expect(db.schedule("b", s.id)!.last_applied).toBe("2024-03-01");
  });

  it("an edited rule never stages dates already past", async () => {
    const s = await create(rent({ start: "2024-04-01" }), "2024-03-10");

    const edited = await edit(s.id, s.updated_at, "2024-04-20", {
      rule: rent({ start: "2024-01-01", days: [15] }).rule,
    });

    expect(ledger.transactions).toHaveLength(0);
    expect(edited.next).toMatchObject({ date: "2024-05-15" });
  });

  it("a deleted occurrence (not this time) doesn't come back", async () => {
    await create(rent(), "2024-02-15");
    ledger.transactions.pop();

    await runSchedules({ db, ledgerFor, on: "2024-02-20" });

    expect(ledger.transactions.map((t) => t.date)).toEqual(["2024-01-01"]);
  });

  it("schedules can confirm their occurrences automatically", async () => {
    await create({ ...rent(), auto_confirm: true }, "2024-01-15");

    expect(ledger.transactions.map((t) => t.flag)).toEqual(["*"]);
  });

  it("a split's tolerance lets the bank's amount match, and the bank's amount wins on confirm", async () => {
    const tolerant = rent({ start: "2024-03-01" });
    tolerant.template.postings[0]!.tolerance = "25.00";
    await create(tolerant, "2024-03-01");
    const header = "Date,Description,Amount,Balance\n";
    db.replaceProfiles("b", CHECKING, [guessProfile(`${header}03/02/2024,X,-1.00,1\n`)!]);

    const imported = await importFile({
      db,
      ledger,
      book: "b",
      account: CHECKING,
      filename: "f.csv",
      text: `${header}03/02/2024,RENT,-1510.00,1\n03/03/2024,OTHER,-1530.00,1\n`,
      userId: "u",
    });

    expect(imported.rows.map((r) => r.outcome)).toEqual(["matched", "staged"]); // 1530 is too far
    await confirmRow(db, ledger, "b", { batch: imported.batch.id, line: 2 });
    const rentPaid = ledger.transactions.find((t) => t.payee === "Landlord")!;
    expect(rentPaid.postings.map((p) => p.units?.number ?? null)).toEqual(["-1510.00", null]);
  });

  it("refuses a tolerance with nowhere for the difference to go", async () => {
    const both = rent();
    both.template.postings[0]!.tolerance = "5";
    both.template.postings[1]!.units = { number: "1500.00", currency: "USD" };

    await expect(create(both, "2024-01-01")).rejects.toThrow(/absorb/);
  });

  it("runs just after the next midnight in a time zone", () => {
    const now = new Date("2024-03-10T05:00:00.000Z");
    expect(untilLocal(now, 0, "UTC")).toBe((19 * 3600 + 60) * 1000);
    expect(untilLocal(now, 0, "Asia/Tokyo")).toBe((10 * 3600 + 60) * 1000); // 14:00 there
    expect(untilLocal(now, 7 * 60, "UTC")).toBe((2 * 3600 + 60) * 1000); // 05:00: 07:00 is 2 h off
    expect(untilLocal(now, 7 * 60, "Asia/Tokyo")).toBe((17 * 3600 + 60) * 1000); // tomorrow's
  });
});

describe("the morning price run", () => {
  it("fetches once a local day, from 07:00, for books with a time zone and owner", async () => {
    db.setTimeZone("b", "UTC", "u");
    let clock = new Date("2024-03-10T06:30:00Z");
    const job = pricesJob(db, ledgerFor, () => clock);

    await job.run();
    expect(ledger.fetched).toBe(0); // before 07:00

    clock = new Date("2024-03-10T07:05:00Z");
    await job.run();
    await job.run();
    expect(ledger.fetched).toBe(1); // once that day
    expect(db.lastPriceFetch("b")).toMatchObject({ result: { fetched: [], errors: {} } });
    expect(job.zones()).toEqual(["UTC"]);
  });
});
