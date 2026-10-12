/**
 * Importing a CSV file into a money account.
 *
 * 1. The file is read with the first of the account's CSV profiles whose layout it fits.
 * 2. Each readable row gets a fingerprint. A row whose fingerprint an earlier import already
 *    staged is a duplicate, and is skipped.
 * 3. Rows dated on or before the account's `as_of` (its opening balance's date) are skipped: the
 *    opening balance already includes them. Moving the opening balance moves the cutoff.
 * 4. The rest go through the pipeline (for now: the matcher, which ranks existing transactions
 *    that might be the same event, and acts on nothing).
 * 5. They're staged in one atomic ledger write as pending (`!`) transactions, uncategorized:
 *    `Expenses:Uncategorized` for money out, `Income:Uncategorized` for money in, until M4.
 * 6. The batch, each row's outcome and its candidates are recorded.
 */
import { createHash, randomUUID } from "node:crypto";

import { applyProfile, fits, type CsvProfile, type Row } from "@fava-beans/csv-import";
import { now } from "@fava-beans/db";
import type { TransactionIn } from "@fava-beans/ledger-client";

import type { ImportResult, ImportRow, Outcome } from "../shared/imports.js";
import type { AppDb } from "./db.js";
import type { LedgerPort } from "./ledger.js";
import { buildContext } from "./pipeline/context.js";
import { runChain } from "./pipeline/chain.js";
import { DEFAULT_WINDOW_DAYS, matcher } from "./pipeline/matcher.js";
import type { Incoming } from "./pipeline/types.js";

export const UNCATEGORIZED = { out: "Expenses:Uncategorized", in: "Income:Uncategorized" };

/** Something the user needs to fix before importing: no profile yet, or a file that doesn't fit. */
export class ImportProblem extends Error {
  constructor(
    readonly code: "no-profile" | "wrong-layout" | "not-a-money-account" | "no-such-book",
    message: string
  ) {
    super(message);
  }
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

export async function importFile({
  db,
  ledger,
  book,
  account,
  filename,
  text,
  userId,
  windowDays = DEFAULT_WINDOW_DAYS,
}: {
  db: AppDb;
  ledger: LedgerPort;
  book: string;
  account: string;
  filename: string;
  text: string;
  userId: string;
  windowDays?: number;
}): Promise<ImportResult> {
  if (!(await ledger.book(book)))
    throw new ImportProblem("no-such-book", `there's no book ${book}`);
  const [accounts, money] = await Promise.all([ledger.accounts(book), ledger.moneyAccounts(book)]);
  const target = money.find((a) => a.name === account);
  if (!target) throw new ImportProblem("not-a-money-account", `${account} isn't a money account`);
  const profiles = db.profiles(book, account);
  if (!profiles.length) throw new ImportProblem("no-profile", `${account} has no CSV profile yet`);
  const profile: CsvProfile | undefined = profiles.find((p) => fits(p, text));
  if (!profile) {
    throw new ImportProblem(
      "wrong-layout",
      `this file's columns don't match any of ${account}'s saved file formats`
    );
  }

  const currency = target.currencies?.[0] ?? "USD";
  const rows = applyProfile(text, profile);
  const prints = fingerprints(rows);
  const before = db.stagedBefore(
    book,
    account,
    prints.filter((p): p is string => p !== null)
  );

  const outcomes: Outcome[] = rows.map((row, i) => {
    if (row.error) return "unreadable";
    if (before.has(prints[i]!)) return "duplicate";
    if (row.date! <= target.as_of) return "before-opening";
    return "staged";
  });
  const stage = rows.filter((_, i) => outcomes[i] === "staged");

  // Match first, so the rows being staged can't match themselves.
  const incoming: Incoming[] = stage.map((row) => ({
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
      shift(dates.at(-1)!, windowDays)
    );
    for (const [line, found] of await runChain([matcher(windowDays)], incoming, context)) {
      resolutions.set(
        line,
        found.flatMap((r) => r.candidates)
      );
    }
  }

  const batchId = randomUUID().replace(/-/g, "");
  const ids = new Map<number, string>();
  if (stage.length) {
    const needed = new Set(
      stage.map((row) => (row.amount!.startsWith("-") ? UNCATEGORIZED.out : UNCATEGORIZED.in))
    );
    const existing = new Set(accounts.filter((a) => !a.implicit).map((a) => a.name));
    for (const name of needed) if (!existing.has(name)) await ledger.createAccount(book, name);

    const transactions: TransactionIn[] = stage.map((row) => ({
      date: row.date!,
      flag: "!",
      payee: row.payee,
      narration: row.description,
      tags: [],
      links: [],
      meta: { source: "csv", "import-batch": batchId, "import-id": prints[rows.indexOf(row)]! },
      postings: [
        { account, units: { number: row.amount!, currency } },
        { account: row.amount!.startsWith("-") ? UNCATEGORIZED.out : UNCATEGORIZED.in },
      ],
    }));
    const created = await ledger.createTransactions(book, transactions);
    stage.forEach((row, i) => ids.set(row.line, created[i]!.id));
  }

  const results: ImportRow[] = rows.map((row, i) => ({
    line: row.line,
    date: row.date,
    amount: row.amount,
    description: row.description,
    outcome: outcomes[i]!,
    error: row.error,
    transaction_id: ids.get(row.line) ?? null,
    candidates: resolutions.get(row.line) ?? [],
  }));
  const count = (outcome: Outcome) => outcomes.filter((o) => o === outcome).length;
  const batch = {
    id: batchId,
    account,
    filename,
    created_at: now(),
    rows: rows.length,
    staged: count("staged"),
    duplicates: count("duplicate"),
    skipped: count("before-opening"),
    unreadable: count("unreadable"),
  };
  db.saveImport(
    { ...batch, book_id: book, user_id: userId },
    results.map((r, i) => ({ ...r, fingerprint: prints[i] ?? null }))
  );
  return { batch, rows: results };
}
