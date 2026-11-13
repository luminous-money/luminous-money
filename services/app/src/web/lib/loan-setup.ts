/**
 * New loan's questionnaire, without its screens: the answers so far (a draft, kept in the
 * browser's session, nothing made), the accounts named from what the loan is for, and what
 * Confirm sends (one request: the loan and everything made with it).
 */
import type { Account } from "@luminous-money/ledger-client";

import {
  cents,
  owedBefore,
  paymentOn,
  tableStarts,
  termsProblem,
  termsTable,
  type LoanHistory,
  type LoanIn,
  type LoanOther,
  type LoanSetupAccount,
  type LoanTable,
  type LoanTerms,
  type Payment,
} from "../../shared/loans.js";
import { toSegment } from "../../shared/names.js";
import type { ScheduleIn } from "../../shared/schedule.js";
import { checkNewAccount } from "./accounts.js";

export const OPENING = "Equity:Opening-Balances";

/** A new asset asks for a new value this often (days), as Add account's revalued ones do. */
export const REVALUE_EVERY = 350;

export type LoanKind = "home" | "car" | "other";

/** A bill paid from escrow: an amount every so many months, from its next due date. */
export type EscrowBill = { amount: string; every: number; next: string };

export type LoanDraft = {
  kind: LoanKind | null;
  /** What the loan is for: "123 Main St". Names its accounts. */
  purpose: string;

  // Terms
  amount: string;
  rate: string;
  payments: string;
  first: string;
  /** When it was borrowed; blank: a month before the first payment. */
  borrowed: string;
  /** What it bought cost, if said (a home, a car). */
  price: string;
  /** Principal and interest a month, if the lender's differs; blank: worked out. */
  payment: string;

  // Extras
  escrow: {
    amount: string;
    /** What the lender says it holds, on `heldOn` (blank: today). */
    held: string;
    heldOn: string;
    tax: EscrowBill | null;
    insurance: EscrowBill | null;
  } | null;
  /** PMI a month, or null for none. */
  pmi: string | null;
  /** Anything else paid with it; `account` blank for its default. */
  others: { name: string; amount: string; account: string }[];

  // History
  history: "each" | "now";
  /** What's owed on `owedOn` (blank: from the table, today). */
  owed: string;
  owedOn: string;

  // Payment
  /** What pays it; null until chosen, for the default. */
  paying: string | null;
  lender: string;
  tolerance: string;
  autoConfirm: boolean;

  // The confirmation page
  /** The loan's name; blank for its default. */
  name: string;
  /** Accounts chosen instead of the defaults. */
  accounts: Partial<Accounts>;
  /** Whether principal and escrow count as spending (opt-in). */
  spending: boolean;
};

export const emptyDraft = (): LoanDraft => ({
  kind: null,
  purpose: "",
  amount: "",
  rate: "",
  payments: "360",
  first: "",
  borrowed: "",
  price: "",
  payment: "",
  escrow: null,
  pmi: null,
  others: [],
  history: "each",
  owed: "",
  owedOn: "",
  paying: null,
  lender: "",
  tolerance: "",
  autoConfirm: false,
  name: "",
  accounts: {},
  spending: false,
});

/** The accounts a loan's setup names. `asset` is blank for none. */
export type Accounts = {
  liability: string;
  interest: string;
  asset: string;
  escrow: string;
  pmi: string;
  tax: string;
  insurance: string;
  /** What principal counts as, as spending. */
  principalAs: string;
  /** What escrow counts as, as spending. */
  escrowAs: string;
};

/** What the loan is for, as an account part: "123 Main St" is `123-Main-St`. */
export const part = (purpose: string) => toSegment(purpose) || "Loan";

/** The accounts named from what the loan is for (Kael's, and the plan's for a car or else). */
export function defaultAccounts(kind: LoanKind, purpose: string): Accounts {
  const x = part(purpose);
  return {
    liability: {
      home: `Liabilities:Loans:Mortgages:${x}`,
      car: `Liabilities:Loans:Auto:${x}`,
      other: `Liabilities:Loans:${x}`,
    }[kind],
    interest: `Expenses:Financing:Interest:${x}`,
    asset: { home: `Assets:Property:${x}`, car: `Assets:Vehicles:${x}`, other: "" }[kind],
    escrow: `Assets:Escrow:${x}`,
    pmi: `Expenses:Insurance:PMI:${x}`,
    tax: `Expenses:Taxes:Property:${x}`,
    insurance: `Expenses:Insurance:Homeowners:${x}`,
    principalAs: `Expenses:Financing:Principal:${x}`,
    escrowAs: `Expenses:Financing:Escrow:${x}`,
  };
}

/** Where anything else paid with it goes by default: `Expenses:Financing:<its name>:X`. */
export const otherAccount = (name: string, purpose: string) =>
  `Expenses:Financing:${toSegment(name) || "Other"}:${part(purpose)}`;

export const accountsOf = (d: LoanDraft): Accounts => ({
  ...defaultAccounts(d.kind ?? "other", d.purpose),
  ...d.accounts,
});

export const loanName = (d: LoanDraft) =>
  d.name.trim() || `${d.purpose.trim()} ${d.kind === "home" ? "mortgage" : "loan"}`;

/** An amount as typed, without `$`, commas or spaces. */
export const clean = (amount: string) => amount.replace(/[$,\s]/g, "");

const AMOUNT = /^\d+(\.\d{1,2})?$/;
const DATE = /^\d{4}-\d\d-\d\d$/;
const amountOk = (s: string) => AMOUNT.test(clean(s));

/** A month before a date: when a loan whose first payment is then was most likely made. */
export function monthBefore(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 10);
}

export const borrowedOn = (d: LoanDraft) => d.borrowed || (d.first ? monthBefore(d.first) : "");

export function termsOf(d: LoanDraft): LoanTerms {
  return {
    amount: clean(d.amount),
    rate: d.rate.replace(/%/g, "").trim(),
    payments: Number(d.payments),
    first: d.first,
    payment: d.payment.trim() ? clean(d.payment) : null,
  };
}

/** The table the terms make, or why they don't (nothing until they're filled in). */
export function tableOf(d: LoanDraft): { table: LoanTable | null; problem: string | null } {
  if (!d.amount || !d.rate || !d.first) return { table: null, problem: null };
  const terms = termsOf(d);
  const problem = termsProblem(terms);
  return problem ? { table: null, problem } : { table: termsTable(terms), problem: null };
}

/** The table's payments due by `on`. */
export const dueBy = (table: LoanTable, on: string) => table.rows.filter((r) => r.date <= on);

/** What the table says is owed at the end of `on`. */
export const owedByTable = (table: LoanTable, on: string) =>
  dueBy(table, on).at(-1)?.balance ?? tableStarts(table);

/** Escrow and PMI are a home's. */
const escrowOf = (d: LoanDraft) => (d.kind === "home" ? d.escrow : null);
const pmiOf = (d: LoanDraft) => (d.kind === "home" ? d.pmi : null);

/** What's paid with it beyond principal and interest, from its first payment. */
export function othersOf(d: LoanDraft, table: LoanTable): LoanOther[] {
  const accounts = accountsOf(d);
  const from = table.rows[0]?.date ?? d.first;
  const escrow = escrowOf(d);
  const pmi = pmiOf(d);
  return [
    ...(escrow
      ? [{ name: "Escrow", account: accounts.escrow, amount: clean(escrow.amount), from }]
      : []),
    ...(pmi !== null ? [{ name: "PMI", account: accounts.pmi, amount: clean(pmi), from }] : []),
    ...d.others.map((o) => ({
      name: o.name.trim(),
      account: o.account || otherAccount(o.name, d.purpose),
      amount: clean(o.amount),
      from,
    })),
  ];
}

/** How its history comes into the books: every payment (also when none is due yet), or what's
 * owed now; nothing when its account already says what's owed (Kael). */
export function historyOf(
  d: LoanDraft,
  table: LoanTable,
  today: string,
  owesAlready: boolean
): LoanHistory {
  if (owesAlready) return { kind: "books" };
  if (d.history === "each" || !dueBy(table, today).length)
    return { kind: "start", on: borrowedOn(d), against: OPENING, confirm: true };
  const on = d.owedOn || today;
  return { kind: "today", on, owed: clean(d.owed) || owedByTable(table, on), against: OPENING };
}

/** The first payment the loan will stage after it's declared, worked out. */
export function nextPayment(
  d: LoanDraft,
  table: LoanTable,
  history: LoanHistory,
  today: string
): Payment | null {
  const spec = { tables: [table], others: othersOf(d, table), extras: [] };
  const after = history.kind === "today" ? history.on : today;
  const row = table.rows.find((r) => r.date > after);
  if (!row) return null;
  const owed = history.kind === "today" ? cents(history.owed) : owedBefore(row);
  return paymentOn(spec, row.date, owed);
}

const bill = (
  d: LoanDraft,
  label: string,
  b: EscrowBill,
  from: string,
  to: string,
  currency: string
): ScheduleIn => {
  const amount = clean(b.amount);
  return {
    name: `${d.purpose.trim()} ${label.toLowerCase()}`,
    rule: { every: b.every, unit: "month", days: [], start: b.next, until: null, weekend: "keep" },
    template: {
      payee: null,
      narration: label,
      links: [],
      meta: {},
      postings: [
        { account: from, units: { number: `-${amount}`, currency } },
        { account: to, units: { number: amount, currency } },
      ],
    },
    auto_confirm: false,
  };
};

/** The bills paid from escrow, as schedules. */
export function billsOf(d: LoanDraft, currency: string): ScheduleIn[] {
  const escrow = escrowOf(d);
  if (!escrow) return [];
  const a = accountsOf(d);
  return [
    ...(escrow.tax ? [bill(d, "Property tax", escrow.tax, a.escrow, a.tax, currency)] : []),
    ...(escrow.insurance
      ? [bill(d, "Homeowner's insurance", escrow.insurance, a.escrow, a.insurance, currency)]
      : []),
  ];
}

/** What counts as spending, if it's opted into: principal, and escrow. */
export function outflowsOf(d: LoanDraft): { account: string; as: string }[] {
  if (!d.spending) return [];
  const a = accountsOf(d);
  return [
    { account: a.liability, as: a.principalAs },
    ...(escrowOf(d) ? [{ account: a.escrow, as: a.escrowAs }] : []),
  ];
}

/** What pays it: the draft's, else the default. */
export const payingOf = (d: LoanDraft, fallback: string) => d.paying ?? fallback;

/** Every account the loan and its setup use, in the order the confirmation page lists them. */
export function usedAccounts(d: LoanDraft, table: LoanTable, paying: string): string[] {
  const a = accountsOf(d);
  return [
    ...new Set(
      [
        paying,
        a.liability,
        a.interest,
        ...othersOf(d, table).map((o) => o.account),
        ...billsOf(d, "USD").map((b) => b.template.postings[1]!.account),
        a.asset,
        ...outflowsOf(d).map((o) => o.as),
      ].filter(Boolean)
    ),
  ];
}

export type Context = {
  chart: Account[];
  today: string;
  currency: string;
  /** What pays it when the draft hasn't said. */
  paying: string;
  /** Whether what's owed already says something's owed (its account exists, with a balance). */
  owesAlready: boolean;
};

const inChart = (chart: Account[], name: string) =>
  chart.some((a) => a.name === name && !a.implicit);

/** What Confirm sends: the loan, its history, and everything made with it. */
export function requestOf(d: LoanDraft, ctx: Context): LoanIn {
  const { table } = tableOf(d);
  if (!table) throw new Error("The terms don't make a table yet");
  const a = accountsOf(d);
  const paying = payingOf(d, ctx.paying);
  const history = historyOf(d, table, ctx.today, ctx.owesAlready);
  const escrow = escrowOf(d);
  const open: LoanSetupAccount[] = usedAccounts(d, table, paying)
    .filter((name) => !inChart(ctx.chart, name))
    .map((name) =>
      name !== a.asset
        ? { name }
        : {
            name,
            opening: clean(d.price) ? { amount: clean(d.price), date: borrowedOn(d) } : null,
            revalue_every: REVALUE_EVERY,
          }
    );
  return {
    name: loanName(d),
    payee: d.lender.trim() || null,
    accounts: { liability: a.liability, paying, interest: a.interest, asset: a.asset || null },
    currency: ctx.currency,
    table,
    others: othersOf(d, table),
    tolerance: clean(d.tolerance) || "0",
    auto_confirm: d.autoConfirm,
    history,
    setup: {
      open,
      escrow_balance:
        escrow && clean(escrow.held)
          ? { account: a.escrow, amount: clean(escrow.held), on: escrow.heldOn || ctx.today }
          : null,
      bills: billsOf(d, ctx.currency),
      outflows: outflowsOf(d).filter((o) => !ctx.chart.find((x) => x.name === o.account)?.outflow),
    },
  };
}

export type Step = "for" | "terms" | "extras" | "history" | "payment" | "confirm";

/** The questionnaire's steps: History only when a payment's already due (counted until the
 * terms say otherwise, so the count shrinks rather than grows). */
export function stepsOf(d: LoanDraft, today: string): Step[] {
  const { table } = tableOf(d);
  const due = table ? dueBy(table, today).length > 0 : true;
  return ["for", "terms", "extras", ...(due ? (["history"] as const) : []), "payment", "confirm"];
}

const billProblem = (label: string, b: EscrowBill | null) =>
  b && (!amountOk(b.amount) || !DATE.test(b.next))
    ? `${label} is an amount and its next due date`
    : null;

/** What a step still needs before Next, or null. */
export function stepProblem(step: Step, d: LoanDraft, ctx: Context): string | null {
  switch (step) {
    case "for":
      if (!d.kind) return "Say what kind of loan it is";
      if (!d.purpose.trim()) return "Say what the loan is for";
      if (!toSegment(d.purpose)) return "Use some letters or numbers";
      return null;
    case "terms": {
      const { table, problem } = tableOf(d);
      if (problem) return problem;
      if (!table) return "Fill in what was borrowed, the rate and the first payment";
      if (borrowedOn(d) > d.first) return "It was borrowed on or before the first payment";
      if (d.price.trim() && !amountOk(d.price)) return "What it cost is an amount, like 375000";
      return null;
    }
    case "extras": {
      const escrow = escrowOf(d);
      if (escrow) {
        if (!amountOk(escrow.amount)) return "Escrow is an amount a month, like 450.00";
        if (escrow.held.trim() && !/^-?\d+(\.\d{1,2})?$/.test(clean(escrow.held)))
          return "What escrow holds is an amount, like 2310.55";
        const p = billProblem("The property tax", escrow.tax);
        if (p) return p;
        const i = billProblem("Homeowner's insurance", escrow.insurance);
        if (i) return i;
      }
      const pmi = pmiOf(d);
      if (pmi !== null && !amountOk(pmi)) return "PMI is an amount a month, like 125.00";
      for (const o of d.others) {
        if (!o.name.trim()) return "Name each other part of the payment";
        if (!amountOk(o.amount)) return `${o.name.trim()} is an amount a month`;
      }
      const names = [
        ...(escrow ? ["escrow"] : []),
        ...(pmi !== null ? ["pmi"] : []),
        ...d.others.map((o) => o.name.trim().toLowerCase()),
      ];
      if (new Set(names).size < names.length) return "Give each part of the payment its own name";
      return null;
    }
    case "history":
      if (d.history === "now" && d.owed.trim() && !amountOk(d.owed))
        return "What's owed is an amount, like 291402.18";
      return null;
    case "payment":
      if (!payingOf(d, ctx.paying)) return "Choose what pays it";
      if (d.tolerance.trim() && !amountOk(d.tolerance))
        return "The match tolerance is an amount, like 25.00";
      return null;
    case "confirm":
      return confirmProblem(d, ctx);
  }
}

/** Why the accounts chosen can't be used, or null. */
function confirmProblem(d: LoanDraft, ctx: Context): string | null {
  const { table } = tableOf(d);
  if (!table) return "The terms don't make a table";
  if (!loanName(d)) return "Name the loan";
  const a = accountsOf(d);
  const paying = payingOf(d, ctx.paying);
  if (!a.liability.startsWith("Liabilities:")) return "What's owed is under Liabilities";
  if (!a.interest.startsWith("Expenses:")) return "Interest goes under Expenses";
  if (a.asset && !a.asset.startsWith("Assets:")) return "What it bought is under Assets";
  if (new Set([a.liability, paying, a.interest]).size < 3)
    return "What's owed, what pays it and interest are three different accounts";
  for (const o of outflowsOf(d))
    if (!o.as.startsWith("Expenses:")) return "Spending counts as an expense account";
  for (const name of usedAccounts(d, table, paying)) {
    const found = ctx.chart.find((x) => x.name === name);
    if (found && !found.implicit) {
      if (found.kind !== "leaf" || found.close)
        return `${name} isn't an open account that holds transactions`;
      continue;
    }
    const check = checkNewAccount(name, ctx.chart);
    if (!check.ok) return `${name}: ${check.message}`;
  }
  return null;
}

/** The first starred asset account linked to a bank feed (home's order), else the first linked
 * one A–Z; with none linked, the same under `Assets:Bank`; else blank (Kael). */
export function defaultPaying(chart: Account[], stars: string[], linked: Set<string>): string {
  const open = chart
    .filter((a) => a.kind === "leaf" && !a.implicit && !a.close && a.name.startsWith("Assets:"))
    .map((a) => a.name);
  const pick = (ok: (name: string) => boolean) =>
    stars.find((s) => open.includes(s) && ok(s)) ?? open.filter(ok).sort()[0];
  return pick((n) => linked.has(n)) ?? pick((n) => n.startsWith("Assets:Bank:")) ?? "";
}

const key = (book: string) => `luminous-money:new-loan:${book}`;

/** The answers so far, kept for the browser's session. */
export function readDraft(book: string): { draft: LoanDraft; step: Step } | null {
  try {
    const saved = JSON.parse(sessionStorage.getItem(key(book)) ?? "null") as {
      draft: LoanDraft;
      step: Step;
    } | null;
    return saved ? { draft: { ...emptyDraft(), ...saved.draft }, step: saved.step } : null;
  } catch {
    return null;
  }
}

export function keepDraft(book: string, draft: LoanDraft, step: Step) {
  try {
    sessionStorage.setItem(key(book), JSON.stringify({ draft, step }));
  } catch {
    // Private browsing, say: the answers just aren't kept.
  }
}

export const forgetDraft = (book: string) => {
  try {
    sessionStorage.removeItem(key(book));
  } catch {
    // As above.
  }
};
