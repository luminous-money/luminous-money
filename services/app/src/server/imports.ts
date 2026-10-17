/**
 * Importing rows into an account (any open leaf): from a CSV file (`importFile`), or from a bank
 * feed (`importRows` directly, simplefin/).
 *
 * 1. A file is read with the first of the account's CSV profiles whose layout it fits.
 * 2. Each readable row gets a fingerprint. A row whose fingerprint an earlier import already
 *    brought in (staged or matched) is a duplicate, and is skipped.
 * 3. Rows dated on or before the account's `as_of` (its opening balance's date, if it has one)
 *    are skipped: the opening balance already includes them. Moving the opening balance moves the
 *    cutoff.
 * 4. The rest go through the pipeline: the matcher ranks the account's transactions that might
 *    be the same event (any not already held by a row of this account's imports), and
 *    assignment gives each row the best one no other row took.
 * 5. A row that got one is `matched`: it claims that transaction, and nothing is added. The rest
 *    are staged in one atomic ledger write as unconfirmed (`!`) transactions, uncategorized:
 *    `Expenses:Uncategorized` for money out, `Income:Uncategorized` for money in, until M4.
 * 6. The batch, each row's outcome, transaction and candidates are recorded. A row with
 *    candidates has its match proposed until it's confirmed in review.
 */
import { createHash, randomUUID } from "node:crypto";

import { applyProfile, fits, type CsvProfile, type Row } from "@fava-beans/csv-import";
import { now } from "@fava-beans/db";
import type { Account, TransactionIn } from "@fava-beans/ledger-client";

import type {
  ImportResult,
  ImportRow,
  ImportSource,
  Outcome,
  ProposalSummary,
} from "../shared/imports.js";
import { add, isZero, negate } from "../shared/decimal.js";
import { categorize, stagedPostings } from "./categorize/chain.js";
import { buildRequest } from "./categorize/context.js";
import type { Categorizer, Chosen, Decision } from "./categorize/types.js";
import type { AppDb } from "./db.js";
import type { LedgerPort } from "./ledger.js";
import { assign } from "./pipeline/assign.js";
import { buildContext } from "./pipeline/context.js";
import { runChain } from "./pipeline/chain.js";
import { DEFAULT_WINDOW_DAYS, matcher } from "./pipeline/matcher.js";
import type { Incoming } from "./pipeline/types.js";

export const UNCATEGORIZED = { out: "Expenses:Uncategorized", in: "Income:Uncategorized" };

/** Something the user needs to fix before importing: no profile yet, or a file that doesn't fit. */
export class ImportProblem extends Error {
  constructor(
    readonly code: "no-profile" | "wrong-layout" | "not-importable" | "no-such-book",
    message: string
  ) {
    super(message);
  }
}

/** What staging a row needs, so it can be staged again later (when a match is undone). */
export type Stageable = {
  date: string;
  amount: string;
  description: string;
  payee: string | null;
  fingerprint: string;
};

/** A row as a transaction in `account`: unconfirmed, with the category and payee the chain
 * decided (confirmed if a rule says so), or uncategorized on the other side. */
export function stagedTransaction(
  account: string,
  currency: string,
  batchId: string,
  row: Stageable,
  decision: Decision = {},
  source: ImportSource = "csv"
): TransactionIn {
  const amount = { number: row.amount, currency };
  const fallback = row.amount.startsWith("-") ? UNCATEGORIZED.out : UNCATEGORIZED.in;
  return {
    date: row.date,
    flag: decision.category?.auto_confirm ? "*" : "!",
    payee: decision.payee?.payee ?? row.payee,
    narration: row.description,
    tags: [],
    links: [],
    meta: { source, "import-batch": batchId, "import-id": row.fingerprint },
    postings: stagedPostings(account, amount, decision.category, fallback),
  };
}

type StageInput = {
  db: AppDb;
  ledger: LedgerPort;
  categorizers: Categorizer[];
  book: { id: string; name: string };
  account: string;
  currency: string;
  batchId: string;
  rows: Stageable[];
  accounts?: Account[];
  source?: ImportSource;
};

/** Rows staged, but not yet written: the transactions to create, and what to record once they
 * exist (their proposals, for review and acceptance tracking). */
export type PreparedStage = {
  transactions: TransactionIn[];
  proposals: (ProposalSummary | null)[];
  /** Record the proposals, given the created transactions' IDs (in order). */
  record(ids: string[]): void;
};

/**
 * Stage rows as transactions in `account`, categorized: the chain proposes a category and
 * payee for each (from the book's last 14 months), and what it proposed is recorded for review
 * and acceptance tracking. One atomic ledger write. Returns the created transactions' IDs, in
 * order, and each one's proposal.
 */
export async function stageCategorized(
  input: StageInput
): Promise<{ ids: string[]; proposals: (ProposalSummary | null)[] }> {
  const prepared = await prepareStage(input);
  const created = await input.ledger.createTransactions(input.book.id, prepared.transactions);
  const ids = created.map((t) => t.id);
  prepared.record(ids);
  return { ids, proposals: prepared.proposals };
}

/** Categorize rows and build their transactions, without writing them, so a caller can fold
 * them into a larger atomic write. Opens the uncategorized accounts they need. */
export async function prepareStage({
  db,
  ledger,
  categorizers,
  book,
  account,
  currency,
  batchId,
  rows,
  accounts,
  source = "csv",
}: StageInput): Promise<PreparedStage> {
  const incoming = rows.map((row, i) => ({
    id: `${batchId}:${i}`,
    date: row.date,
    account,
    amount: { number: row.amount, currency },
    description: row.description,
    payee: row.payee,
  }));
  const request = categorizers.length ? await buildRequest(ledger, book, incoming) : undefined;
  const decisions = request ? await categorize(categorizers, request) : new Map<string, Decision>();
  const decided = incoming.map((t) => decisions.get(t.id) ?? {});

  await ensureUncategorized(
    ledger,
    book.id,
    rows.filter((_, i) => !decided[i]!.category),
    accounts
  );
  const transactions = rows.map((row, i) =>
    stagedTransaction(account, currency, batchId, row, decided[i], source)
  );
  const record = (ids: string[]) => {
    const uses = new Map<string, number>();
    const stored = ids.flatMap((id, i) => {
      const { category, payee } = decided[i]!;
      if (category?.rule_id) uses.set(category.rule_id, (uses.get(category.rule_id) ?? 0) + 1);
      if (!category && !payee) return [];
      const {
        auto_confirm: _a,
        rule_id: _r,
        categorizer: _c,
        ...given
      } = category ?? ({} as Chosen);
      return [
        {
          transaction_id: id,
          book_id: book.id,
          request_id: request!.request_id,
          incoming_id: incoming[i]!.id,
          categorizer: category?.categorizer ?? null,
          confidence: category?.confidence ?? null,
          reason: category?.reason ?? payee?.reason ?? null,
          postings: category?.postings ?? null,
          payee: payee?.payee ?? null,
          payee_categorizer: payee?.categorizer ?? null,
          proposal: category ? given : null,
        },
      ];
    });
    db.saveProposals(stored);
    db.countRuleUses(uses);
  };
  return { transactions, proposals: decided.map((d) => summarize(d)), record };
}

/** What a decision amounts to, for import results and review. */
export function summarize({ category, payee }: Decision): ProposalSummary | null {
  if (!category && !payee) return null;
  return {
    categorizer: category?.categorizer ?? null,
    accounts: category?.postings?.map((p) => p.account) ?? [],
    payee: payee?.payee ?? null,
    confidence: category?.confidence ?? null,
    reason: category?.reason ?? payee?.reason ?? null,
  };
}

/** Open the uncategorized accounts staging `rows` needs, if they aren't already. */
export async function ensureUncategorized(
  ledger: LedgerPort,
  book: string,
  rows: Stageable[],
  accounts?: Account[]
): Promise<void> {
  const needed = new Set(
    rows.map((row) => (row.amount.startsWith("-") ? UNCATEGORIZED.out : UNCATEGORIZED.in))
  );
  const existing = new Set(
    (accounts ?? (await ledger.accounts(book))).filter((a) => !a.implicit).map((a) => a.name)
  );
  for (const name of needed) if (!existing.has(name)) await ledger.createAccount(book, name);
}

/**
 * How a row is recognized when it comes back in a later file. The bank's own transaction ID
 * when the file has one; otherwise the date, amount and description, plus which occurrence of
 * those it is in the file (so two identical coffees on the same day are both kept).
 */
export function fingerprints(rows: Row[]): (string | null)[] {
  const seen = new Map<string, number>();
  return rows.map((row) => {
    if (row.error) return null;
    if (row.id) return `id:${row.id}`;
    const base = createHash("sha256")
      .update(`${row.date}|${row.amount}|${row.description}`)
      .digest("hex")
      .slice(0, 32);
    const occurrence = seen.get(base) ?? 0;
    seen.set(base, occurrence + 1);
    return `${base}:${occurrence}`;
  });
}

type ImportInput = {
  db: AppDb;
  ledger: LedgerPort;
  book: string;
  account: string;
  userId: string;
  windowDays?: number;
  /** The categorization chain (none: rows are staged uncategorized). */
  categorizers?: Categorizer[];
};

/** The account rows are imported into, if it can take them: an open leaf. */
async function importTarget(ledger: LedgerPort, book: string, account: string) {
  const bookInfo = await ledger.book(book);
  if (!bookInfo) throw new ImportProblem("no-such-book", `there's no book ${book}`);
  const [accounts, [target]] = await Promise.all([
    ledger.accounts(book),
    ledger.summary(book, [account]),
  ]);
  if (!target || target.kind !== "leaf" || target.implicit || target.close)
    throw new ImportProblem(
      "not-importable",
      `${account} isn't an open account that holds transactions`
    );
  return { bookInfo, accounts, target };
}

/** Import a CSV file into an account, with the first of its profiles the file fits. */
export async function importFile({
  filename,
  text,
  ...input
}: ImportInput & { filename: string; text: string }): Promise<ImportResult> {
  const { db, ledger, book, account } = input;
  await importTarget(ledger, book, account);
  const profiles = db.profiles(book, account);
  if (!profiles.length) throw new ImportProblem("no-profile", `${account} has no CSV profile yet`);
  const profile: CsvProfile | undefined = profiles.find((p) => fits(p, text));
  if (!profile) {
    throw new ImportProblem(
      "wrong-layout",
      `this file's columns don't match any of ${account}'s saved file formats`
    );
  }

  return importRows({
    ...input,
    source: "csv",
    label: filename,
    rows: applyProfile(text, profile),
  });
}

/**
 * Import rows into an account, from any source: skip what's come in before (fingerprints) and
 * what the opening balance already includes, match what's already in the books, stage the rest
 * categorized, and record the batch.
 */
export async function importRows({
  db,
  ledger,
  book,
  account,
  userId,
  source,
  label,
  rows,
  windowDays = DEFAULT_WINDOW_DAYS,
  categorizers = [],
}: ImportInput & { source: ImportSource; label: string; rows: Row[] }): Promise<ImportResult> {
  const { bookInfo, accounts, target } = await importTarget(ledger, book, account);
  const currency = target.currencies?.[0] ?? "USD";
  const prints = fingerprints(rows);
  const before = db.importedBefore(
    book,
    account,
    prints.filter((p): p is string => p !== null)
  );

  const outcomes: Outcome[] = rows.map((row, i) => {
    if (row.error) return "unreadable";
    if (before.has(prints[i]!)) return "duplicate";
    if (target.as_of && row.date! <= target.as_of) return "before-opening";
    return "staged";
  });
  const fresh = rows.filter((_, i) => outcomes[i] === "staged");

  // Match first, so the rows being staged can't match themselves.
  const incoming: Incoming[] = fresh.map((row) => ({
    line: row.line,
    date: row.date!,
    amount: { number: row.amount!, currency },
    description: row.description,
    payee: row.payee,
  }));
  const resolutions = new Map<number, ImportRow["candidates"]>();
  if (incoming.length) {
    const dates = incoming.map((r) => r.date).sort();
    const shift = (date: string, days: number) =>
      new Date(Date.parse(`${date}T00:00:00Z`) + days * 864e5).toISOString().slice(0, 10);
    const context = await buildContext(
      ledger,
      book,
      account,
      shift(dates[0]!, -windowDays),
      shift(dates.at(-1)!, windowDays),
      (ids) => db.claimed(book, account, ids, source)
    );
    // Scheduled transactions may match within their split's tolerance.
    const schedules = db.schedulesOf(context.existing.map((t) => t.id));
    for (const t of context.existing) {
      const split = schedules.get(t.id)?.template.postings.find((p) => p.account === account);
      if (split?.tolerance) t.tolerance = split.tolerance;
    }
    for (const [line, found] of await runChain([matcher(windowDays)], incoming, context)) {
      resolutions.set(
        line,
        found.flatMap((r) => r.candidates)
      );
    }
  }

  const assigned = assign(resolutions);
  fresh.forEach((row) => {
    if (assigned.has(row.line)) outcomes[rows.indexOf(row)] = "matched";
  });
  const stage = fresh.filter((row) => !assigned.has(row.line));

  const batchId = randomUUID().replace(/-/g, "");
  const ids = new Map<number, string>(assigned);
  const proposals = new Map<number, ProposalSummary | null>();
  if (stage.length) {
    const staged = await stageCategorized({
      db,
      ledger,
      categorizers,
      book: { id: book, name: bookInfo.name },
      account,
      currency,
      batchId,
      accounts,
      source,
      rows: stage.map((row) => ({
        date: row.date!,
        amount: row.amount!,
        description: row.description,
        payee: row.payee,
        fingerprint: prints[rows.indexOf(row)]!,
      })),
    });
    stage.forEach((row, i) => {
      ids.set(row.line, staged.ids[i]!);
      proposals.set(row.line, staged.proposals[i]!);
    });
  }

  const results: ImportRow[] = rows.map((row, i) => ({
    line: row.line,
    payee: row.payee,
    date: row.date,
    amount: row.amount,
    description: row.description,
    outcome: outcomes[i]!,
    error: row.error,
    transaction_id: ids.get(row.line) ?? null,
    candidates: resolutions.get(row.line) ?? [],
    match: resolutions.get(row.line)?.length ? "proposed" : null,
    proposal: proposals.get(row.line) ?? null,
  }));
  const count = (outcome: Outcome) => outcomes.filter((o) => o === outcome).length;
  const end = lastBalance(rows, target.type === "liability");
  const batch = {
    id: batchId,
    account,
    source,
    filename: label,
    created_at: now(),
    rows: rows.length,
    staged: count("staged"),
    matched: count("matched"),
    duplicates: count("duplicate"),
    skipped: count("before-opening"),
    unreadable: count("unreadable"),
    end_date: end?.date ?? null,
    end_balance: end?.balance ?? null,
  };
  db.saveImport(
    { ...batch, book_id: book, user_id: userId },
    results.map((r, i) => ({ ...r, fingerprint: prints[i] ?? null }))
  );
  const balance_check = end
    ? await fileBalanceCheck(ledger, book, account, end, currency).catch(() => null)
    : null;
  return { batch, rows: results, balance_check };
}

/**
 * A file's last balance and its day (M14), from its balance column: the balance after the last
 * row of its latest day, as stored (negative on a liability). Files list newest or oldest
 * first (the dates say which, unless they're all one day), and show a card's balance as owed or
 * as stored: the running balance says which (each balance is the one before it, plus or minus
 * its amount). A file too short to say is taken in date order, a liability's as owed.
 */
export function lastBalance(
  rows: Row[],
  liability: boolean
): { date: string; balance: string } | null {
  const read = rows.filter((r) => !r.error && r.date && r.amount !== null && r.balance !== null);
  if (!read.length) return null;
  // newer - older - change: zero when the change is the row's
  const fits = (older: Row, newer: Row, inverted: boolean) =>
    isZero(
      add(
        add(newer.balance!, negate(older.balance!)),
        inverted ? newer.amount! : negate(newer.amount!)
      )
    );
  // Dates say which way a file runs, when they differ; else the running balance does.
  const byDate = read[0]!.date !== read.at(-1)!.date;
  let best = { newestFirst: read[0]!.date! > read.at(-1)!.date!, inverted: liability, fits: 0 };
  for (const newestFirst of byDate ? [best.newestFirst] : [false, true])
    for (const inverted of [false, true]) {
      let count = 0;
      for (let i = 1; i < read.length; i++) {
        const [older, newer] = newestFirst ? [read[i]!, read[i - 1]!] : [read[i - 1]!, read[i]!];
        if (fits(older, newer, inverted)) count++;
      }
      if (count > best.fits) best = { newestFirst, inverted, fits: count };
    }
  const final = best.newestFirst ? read[0]! : read.at(-1)!;
  return { date: final.date!, balance: best.inverted ? negate(final.balance!) : final.balance! };
}

/** Whether the books agree with a file's last balance, at the end of its day. */
async function fileBalanceCheck(
  ledger: LedgerPort,
  book: string,
  account: string,
  end: { date: string; balance: string },
  currency: string
) {
  const days = await ledger.dayBalances(book, account, end.date, end.date);
  return {
    date: end.date,
    file: end.balance,
    books: days.days.at(-1)?.balance ?? days.before,
    currency,
  };
}
