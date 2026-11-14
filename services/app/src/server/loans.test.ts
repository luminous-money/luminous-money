import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import { termsTable, type LoanIn } from "../shared/loans.js";
import { AppDb } from "./db.js";
import { createLoan, editLoan, extraPayment, LoanProblem, rebaseLoan } from "./loans.js";
import { editSchedule, runSchedules } from "./schedules.js";
import { FakeLedger } from "./testing.js";

const CHECKING = "Assets:Bank:Checking";
const MORTGAGE = "Liabilities:Loans:Mortgage";
const INTEREST = "Expenses:Housing:Mortgage-Interest";
const ESCROW = "Assets:Escrow:Mortgage";
const OPENING = "Equity:Opening-Balances";

// The plan's made-up mortgage: $300,000 at 3.75% for 30 years, first payment 2016-08-01.
const table = termsTable({
  amount: "300000.00",
  rate: "3.75",
  payments: 360,
  first: "2016-08-01",
  payment: null,
});
const ON = "2026-11-05";

let db: AppDb;
let ledger: FakeLedger;
const ledgerFor = () => ledger;

const loanIn = (over: Partial<LoanIn> = {}): LoanIn => ({
  name: "Mortgage",
  payee: "Big Bank Mortgage",
  accounts: { liability: MORTGAGE, paying: CHECKING, interest: INTEREST, asset: null },
  table,
  others: [{ name: "Escrow", account: ESCROW, amount: "450.00", from: "2016-08-01" }],
  history: { kind: "books" },
  ...over,
});

const create = (input: LoanIn, on = ON) =>
  createLoan({ db, ledgerFor, user: "u", book: "b", input, on });

const balance = (account: string) =>
  ledger.dayBalances("b", account, "2100-01-01", "2100-01-01").then((b) => b.before);

const posting = (id: string, account: string) =>
  ledger.transactions.find((t) => t.id === id)?.postings.find((p) => p.account === account);

beforeEach(() => {
  db = new AppDb(join(mkdtempSync(join(tmpdir(), "app-")), "app.sqlite"));
  ledger = new FakeLedger();
  ledger.addBook("b");
  ledger.addAccount(CHECKING, { open: "2026-10-01" });
  ledger.addAccount(MORTGAGE, { type: "liability" });
  ledger.addAccount(INTEREST, { type: "expense" });
  ledger.addAccount(ESCROW);
  ledger.addAccount("Expenses:Uncategorized", { type: "expense" });
});

describe("declaring a loan", () => {
  it("from the start: the borrowing, then every payment due, escrow and all, those before the books from Opening Balances", async () => {
    // The bank's copy of October's payment is already in checking, uncategorized.
    const bank = ledger.addTransaction({
      date: "2026-10-02",
      flag: "!",
      payee: "BIG BANK MTG",
      narration: "",
      links: [],
      meta: {},
      postings: [
        { account: CHECKING, units: { number: "-1839.35", currency: "USD" } },
        { account: "Expenses:Uncategorized", units: null },
      ],
    });
    const loan = await create(
      loanIn({ history: { kind: "start", on: "2016-06-15", against: OPENING, confirm: true } })
    );
    expect(ledger.created).toContain(OPENING);
    const paid = loan.status.paid;
    expect(paid).toHaveLength(124); // 2016-08-01 through 2026-11-01
    expect(await balance(MORTGAGE)).toBe(`-${table.rows[123]!.balance}`);

    // Before checking's books began: the whole payment, escrow included, from Opening Balances.
    const first = ledger.transactions.find((t) => t.id === paid[0]!.transaction_id)!;
    expect(first.postings.map((p) => [p.account, p.units?.number])).toEqual([
      [OPENING, "-1839.35"],
      [MORTGAGE, "451.85"],
      [INTEREST, "937.50"],
      [ESCROW, "450.00"],
    ]);
    // October's is the bank's, filled in; November's is new, with escrow.
    const october = paid.find((p) => p.nominal === "2026-10-01")!;
    expect(october.transaction_id).toBe(bank.id);
    // The bank's amount is kept; escrow, left blank, takes up any difference.
    expect(posting(bank.id, CHECKING)?.units?.number).toBe("-1839.35");
    expect(posting(bank.id, MORTGAGE)?.units?.number).toBe(table.rows[122]!.principal);
    expect(posting(bank.id, ESCROW)).toMatchObject({ units: null });
    expect(posting(bank.id, "Expenses:Uncategorized")).toBeUndefined();
    const november = ledger.transactions.find(
      (t) => t.id === paid.find((p) => p.nominal === "2026-11-01")!.transaction_id
    )!;
    expect(november.postings[0]).toMatchObject({
      account: CHECKING,
      units: { number: "-1839.35" },
    });
    expect(loan.status.next?.nominal).toBe("2026-12-01");
    expect(loan.status.next?.follows_table).toBe(true);
    expect(loan.status.ahead).toHaveLength(236);
  });

  it("from today: one transaction saying what's owed, payments from the next one", async () => {
    const owed = table.rows[123]!.balance; // after November 2026's
    const loan = await create(
      loanIn({ history: { kind: "today", on: ON, owed, against: OPENING } })
    );
    expect(await balance(MORTGAGE)).toBe(`-${owed}`);
    expect(loan.status.paid).toEqual([]);
    expect(loan.status.next).toMatchObject({
      nominal: "2026-12-01",
      number: 125,
      follows_table: true,
      total: "1839.35",
    });
    const schedule = db.schedule("b", loan.schedule_id)!;
    expect(schedule.last_applied).toBe("2026-11-01");
    expect(schedule.template.postings.map((p) => [p.account, p.units?.number])).toEqual([
      [CHECKING, "-1839.35"],
      [MORTGAGE, table.rows[124]!.principal],
      [INTEREST, table.rows[124]!.interest],
      [ESCROW, undefined], // takes up a matched amount's difference
    ]);
  });

  it("already in the books: nothing written, payments from the next one", async () => {
    const loan = await create(loanIn());
    expect(ledger.transactions).toEqual([]);
    expect(db.schedule("b", loan.schedule_id)!.last_applied).toBe("2026-11-01");
  });

  it("refuses what doesn't fit", async () => {
    await expect(create(loanIn({ name: "" }))).rejects.toThrow("Name the loan");
    await expect(
      create(loanIn({ accounts: { ...loanIn().accounts, interest: "Expenses:Nope" } }))
    ).rejects.toThrow(/isn't an open account/);
    await expect(
      create(
        loanIn({ history: { kind: "start", on: "2017-01-01", against: OPENING, confirm: true } })
      )
    ).rejects.toBeInstanceOf(LoanProblem);
  });
});

describe("made along with it (New loan's questionnaire)", () => {
  const HOME = "Liabilities:Loans:Mortgages:123-Main-St";
  const HOME_INTEREST = "Expenses:Financing:Interest:123-Main-St";
  const PROPERTY = "Assets:Property:123-Main-St";
  const HOME_ESCROW = "Assets:Escrow:123-Main-St";
  const TAX = "Expenses:Taxes:Property:123-Main-St";
  const PRINCIPAL = "Expenses:Financing:Principal:123-Main-St";

  const home = (over: Partial<LoanIn> = {}, setup: LoanIn["setup"] = {}): LoanIn =>
    loanIn({
      name: "123 Main St mortgage",
      accounts: { liability: HOME, paying: CHECKING, interest: HOME_INTEREST, asset: PROPERTY },
      others: [{ name: "Escrow", account: HOME_ESCROW, amount: "450.00", from: "2016-08-01" }],
      setup: {
        open: [
          { name: HOME },
          { name: HOME_INTEREST },
          {
            name: PROPERTY,
            opening: { amount: "375000.00", date: "2016-06-15" },
            revalue_every: 350,
          },
          { name: HOME_ESCROW },
          { name: TAX },
          { name: PRINCIPAL },
        ],
        ...setup,
      },
      ...over,
    });

  const taxBill = {
    name: "123 Main St property tax",
    rule: {
      every: 6,
      unit: "month" as const,
      days: [],
      start: "2027-03-01",
      until: null,
      weekend: "keep" as const,
    },
    template: {
      payee: "County Treasurer",
      narration: "Property tax",
      postings: [
        { account: HOME_ESCROW, units: { number: "-2550.00", currency: "USD" } },
        { account: TAX, units: { number: "2550.00", currency: "USD" } },
      ],
    },
  };

  it("opens its accounts, what it bought at its cost, escrow at the lender's figure, its bills and spending", async () => {
    const owed = table.rows[123]!.balance;
    const loan = await create(
      home(
        { history: { kind: "today", on: ON, owed, against: OPENING } },
        {
          escrow_balance: { account: HOME_ESCROW, amount: "2310.55", on: ON },
          bills: [taxBill],
          outflows: [{ account: HOME, as: PRINCIPAL }],
        }
      )
    );
    expect(ledger.created).toEqual(expect.arrayContaining([HOME, HOME_INTEREST, PROPERTY, TAX]));
    expect(ledger.accountList.find((a) => a.name === PROPERTY)?.revalue_every).toBe(350);
    expect(await balance(PROPERTY)).toBe("375000.00");
    expect(await balance(HOME)).toBe(`-${owed}`);
    expect(await balance(HOME_ESCROW)).toBe("2310.55");
    expect(ledger.accountList.find((a) => a.name === HOME)?.outflow).toBe(PRINCIPAL);
    const bills = db.schedules("b").filter((s) => s.id !== loan.schedule_id);
    expect(bills.map((s) => s.name)).toEqual(["123 Main St property tax"]);
    expect(loan.status.paid_from).toMatchObject([{ name: "123 Main St property tax" }]);
  });

  it("escrow's figure is what the books lack once every payment is recorded", async () => {
    await create(
      home(
        { history: { kind: "start", on: "2016-06-15", against: OPENING, confirm: true } },
        { escrow_balance: { account: HOME_ESCROW, amount: "1000.00", on: ON } }
      )
    );
    // Every payment since 2016 carried escrow (124 of 450.00), and none of what it paid out is in
    // the books: the figure takes that away.
    expect(await balance(HOME_ESCROW)).toBe("1000.00");
    const adjustment = ledger.transactions.find((t) => t.narration === "What escrow holds")!;
    expect(adjustment.postings.find((p) => p.account === HOME_ESCROW)?.units?.number).toBe(
      "-54800.00"
    );
    // Balances stated, not payments: outflows never count them as spending.
    expect(adjustment.meta).toEqual({ opening: true });
    expect(ledger.transactions.find((t) => t.narration === "Borrowed")?.meta).toEqual({
      opening: true,
    });
  });

  it("escrow's figure counts the bills it has already paid", async () => {
    const pastBill = { ...taxBill, rule: { ...taxBill.rule, start: "2026-03-01" } };
    await create(
      home(
        { history: { kind: "start", on: "2016-06-15", against: OPENING, confirm: true } },
        { escrow_balance: { account: HOME_ESCROW, amount: "1000.00", on: ON }, bills: [pastBill] }
      )
    );
    // March's and September's tax are staged, from escrow, before its figure is worked out.
    const taxes = ledger.transactions.filter((t) => t.narration === "Property tax");
    expect(taxes.map((t) => t.date)).toEqual(["2026-03-01", "2026-09-01"]);
    expect(await balance(HOME_ESCROW)).toBe("1000.00");
  });

  it("checks it all before writing anything", async () => {
    const refused = [
      home({}, { bills: [{ ...taxBill, template: { ...taxBill.template, postings: [] } }] }),
      home({}, { outflows: [{ account: HOME, as: "Expenses:Nope" }] }),
      home({}, { outflows: [{ account: HOME_INTEREST, as: PRINCIPAL }] }),
      home({}, { escrow_balance: { account: CHECKING, amount: "1.00", on: ON } }),
      home({}, { open: [...home().setup!.open!, { name: CHECKING }] }),
      home({ accounts: { ...home().accounts, paying: "Assets:Bank:Nope" } }),
    ];
    for (const input of refused) await expect(create(input)).rejects.toBeInstanceOf(LoanProblem);
    expect(ledger.created).toEqual([]);
    expect(ledger.transactions).toEqual([]);
    expect(db.loans("b")).toEqual([]);
    expect(db.schedules("b")).toEqual([]);
  });
});

describe("after it's declared", () => {
  const owed = table.rows[123]!.balance;
  const declared = () =>
    create(loanIn({ history: { kind: "today", on: ON, owed, against: OPENING } }));

  it("with a tolerance, escrow takes up the bank's different amount; without escrow, principal", async () => {
    const loan = await create(
      loanIn({ tolerance: "50.00", history: { kind: "today", on: ON, owed, against: OPENING } })
    );
    await runSchedules({ db, ledgerFor, on: "2026-12-01" });
    const december = ledger.transactions.at(-1)!;
    expect(posting(december.id, ESCROW)).toMatchObject({ units: null });
    expect(posting(december.id, MORTGAGE)?.units?.number).toBe(table.rows[124]!.principal);
    expect(db.schedule("b", loan.schedule_id)!.template.postings[0]).toMatchObject({
      tolerance: "50.00",
    });
  });

  it("stages each payment as it comes due, worked out by the loan", async () => {
    const loan = await declared();
    await runSchedules({ db, ledgerFor, on: "2026-12-01" });
    const december = ledger.transactions.at(-1)!;
    expect(december).toMatchObject({ date: "2026-12-01", flag: "!", payee: "Big Bank Mortgage" });
    expect(posting(december.id, MORTGAGE)?.units?.number).toBe(table.rows[124]!.principal);
    expect(db.occurrencesFrom(loan.schedule_id, "2026-12-01")).toHaveLength(1);
  });

  it("an extra payment lowers what's owed, and the next payment is worked out from the books", async () => {
    const loan = await declared();
    const after = await extraPayment({
      db,
      ledgerFor,
      user: "u",
      book: "b",
      id: loan.id,
      input: { date: "2026-11-10", amount: "10000.00" },
      on: "2026-11-10",
    });
    expect(after.status.owed).toBe((Number(owed) - 10000).toFixed(2));
    expect(after.status.next?.follows_table).toBe(false);
    expect(after.status.next?.total).toBe("1839.35");
    expect(Number(after.status.next!.interest)).toBeLessThan(Number(table.rows[124]!.interest));
    expect(after.status.ahead.length).toBeLessThan(loan.status.ahead.length);
  });

  it("an escrow change from a date fills in the unconfirmed payments from then", async () => {
    const loan = await declared();
    await runSchedules({ db, ledgerFor, on: "2026-12-01" });
    const december = ledger.transactions.at(-1)!.id;
    const changed = await editLoan({
      db,
      ledgerFor,
      user: "u",
      book: "b",
      id: loan.id,
      patch: {
        updated_at: loan.updated_at,
        others: [
          ...loan.others,
          { name: "Escrow", account: ESCROW, amount: "482.17", from: "2026-12-01" },
        ],
      },
      on: "2026-12-02",
    });
    expect(posting(december, ESCROW)?.units?.number).toBe("482.17");
    expect(posting(december, CHECKING)?.units?.number).toBe("-1871.52");
    expect(changed.status.next?.total).toBe("1871.52");
  });

  it("a re-base writes the difference, so the books say what the lender does", async () => {
    const loan = await declared();
    const lender = (Number(owed) + 12.4).toFixed(2);
    const after = await rebaseLoan({
      db,
      ledgerFor,
      user: "u",
      book: "b",
      id: loan.id,
      input: { updated_at: loan.updated_at, on: "2026-11-06", owed: lender, account: "" },
      on: "2026-11-06",
    });
    expect(after.status.owed).toBe(lender);
    expect(after.rebases).toMatchObject([{ difference: "12.40", account: INTEREST }]);
    expect(posting(after.rebases[0]!.transaction_id, INTEREST)?.units?.number).toBe("12.40");
  });

  it("its schedule follows the loan, so it isn't edited on its own", async () => {
    const loan = await declared();
    const schedule = db.schedule("b", loan.schedule_id)!;
    await expect(
      editSchedule({
        db,
        ledgerFor,
        user: "u",
        book: "b",
        id: schedule.id,
        patch: { updated_at: schedule.updated_at, name: "Other" },
      })
    ).rejects.toThrow(/follows a loan/);
  });

  it("a renamed account is followed", async () => {
    const loan = await declared();
    db.renameAccount("b", "Assets:Escrow", "Assets:Held");
    const renamed = db.loan("b", loan.id)!;
    expect(renamed.others[0]!.account).toBe("Assets:Held:Mortgage");
    db.renameAccount("b", "Liabilities:Loans", "Liabilities:Debts");
    expect(db.loan("b", loan.id)!.accounts.liability).toBe("Liabilities:Debts:Mortgage");
  });
});
