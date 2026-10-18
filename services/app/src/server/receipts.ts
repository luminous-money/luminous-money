/**
 * Receipts (M16): a photo (or a PDF) and whatever the person typed become an unconfirmed
 * transaction in review, the receipt attached. The ai service reads it, if the book has AI set
 * up; `app` checks the reading against the books and stages it, as it stages imports:
 *
 * - **the base account** is the reader's, else the hint's (a divided account's main part, as for
 *   imports), else, as the notes ask, the uncategorized account of the direction
 *   (`Expenses:Uncategorized` for money out, `Income:Uncategorized` for money in)
 * - **splits** are kept when they're all on accounts that exist (or that the reader proposed and
 *   the book lets it open) and sum to minus the total; otherwise one split of the total goes to
 *   the reader's category, else uncategorized
 * - **it always makes something:** with no reading (AI off, down, or it couldn't read it), the
 *   transaction is made from the hints (a zero total if none), and says why
 */
import type { ChartAccount, ReceiptHints, ReceiptReading } from "@fava-beans/ai-api";
import type { Account, TransactionIn } from "@fava-beans/ledger-client";

import { add, isNegative, isZero, negate } from "../shared/decimal.js";
import { landsIn } from "../shared/divided.js";
import type { AiPort } from "./ai.js";
import { UNCATEGORIZED } from "./imports.js";
import type { LedgerPort } from "./ledger.js";

export const RECEIPT_LIMIT = 5 * 1024 * 1024;

/** Something the person can fix: too big, not an image or PDF. */
export class ReceiptProblem extends Error {
  constructor(
    readonly status: 413 | 415 | 422,
    message: string
  ) {
    super(message);
  }
}

export type ReceiptFile = { name: string; type: string; bytes: Uint8Array };
export type Captured = {
  transaction_id: string;
  /** Whether the AI read it (else it was made from the hints). */
  read: boolean;
  /** What to tell the person: why it wasn't read, or the reader's own note. */
  note: string | null;
};

const ACCEPTED = /^(image\/(jpeg|png|gif|webp)|application\/pdf)$/;
const NAME = /^(Expenses|Income)(:[\p{Lu}\p{Nd}][\p{L}\p{Nd}-]*)+$/u;

/** Turn a reading (or none) and the hints into the transaction to stage, and the accounts it
 * needs opened. Pure, so it's tested on its own. */
export function receiptTransaction(
  reading: ReceiptReading | null,
  hints: ReceiptHints,
  accounts: Account[],
  { createAccounts, today, currency }: { createAccounts: boolean; today: string; currency: string }
): { transaction: TransactionIn; open: string[] } {
  const leaves = new Set(
    accounts.filter((a) => a.kind === "leaf" && !a.implicit && !a.close).map((a) => a.name)
  );
  // The base account is an asset or liability that takes postings: a leaf (a part, if named),
  // or a divided account's main part.
  const types = new Map(accounts.map((a) => [a.name, a.type]));
  const base = (name: string | null | undefined) => {
    if (!name || !["asset", "liability"].includes(types.get(name) ?? "")) return null;
    if (leaves.has(name)) return name;
    const into = landsIn(accounts, name);
    return into && leaves.has(into) ? into : null;
  };
  const total = reading?.total ?? hints.total ?? "0";
  const out = isNegative(total) || isZero(total);
  const fallback = out ? UNCATEGORIZED.out : UNCATEGORIZED.in;
  const account = base(reading?.account) ?? base(hints.account) ?? fallback;

  const creatable = new Set(
    createAccounts
      ? (reading?.new_accounts ?? []).filter((n) => NAME.test(n) && !leaves.has(n))
      : []
  );
  const usable = (name: string | null | undefined) =>
    !!name && name !== account && (leaves.has(name) || creatable.has(name));
  const category = usable(reading?.category) ? reading!.category! : fallback;
  const splits = reading?.splits ?? [];
  const sum = splits.reduce((n, s) => add(n, s.amount), "0");
  const itemized =
    splits.length > 0 && splits.every((s) => usable(s.account)) && isZero(add(sum, total));

  const units = (number: string) => ({ number, currency: reading?.currency ?? currency });
  const postings: TransactionIn["postings"] = [
    { account, units: units(total) },
    ...(itemized
      ? splits.map((s) => ({
          account: s.account,
          units: units(s.amount),
          ...(s.memo ? { meta: { memo: s.memo } } : {}),
        }))
      : [{ account: category, units: units(negate(total)) }]),
  ];
  const used = new Set(postings.map((p) => p.account));
  return {
    transaction: {
      date: reading?.date ?? hints.date ?? today,
      flag: "!",
      payee: reading?.payee ?? hints.payee ?? null,
      narration:
        reading?.narration ?? hints.note ?? (reading ? "Receipt" : "Receipt: couldn't read it"),
      tags: [],
      links: [],
      meta: { source: "receipt" },
      postings,
    },
    open: [...used].filter((n) => !leaves.has(n)),
  };
}

/** Capture a receipt: read it (if the book has AI), stage the transaction, attach the file. */
export async function captureReceipt({
  ledger,
  ai,
  book,
  file,
  hints,
  today,
}: {
  ledger: LedgerPort;
  ai?: AiPort;
  book: string;
  file: ReceiptFile;
  hints: ReceiptHints;
  today: string;
}): Promise<Captured> {
  if (file.bytes.length > RECEIPT_LIMIT) throw new ReceiptProblem(413, "a receipt is at most 5 MB");
  if (!ACCEPTED.test(file.type))
    throw new ReceiptProblem(415, "a receipt is a photo (JPEG, PNG, WebP, GIF) or a PDF");
  const [info, accounts] = await Promise.all([ledger.book(book), ledger.accounts(book)]);
  if (!info) throw new ReceiptProblem(422, "there's no such book");
  const settings = ai ? await ai.settings(book) : null;

  let reading: ReceiptReading | null = null;
  let note: string | null = null;
  if (!ai || !settings) note = "AI isn't available right now, so it wasn't read";
  else if (!settings.ready) note = "The book's AI isn't set up, so it wasn't read";
  else {
    const chart: ChartAccount[] = accounts
      .filter((a) => !a.close && ((a.kind === "leaf" && !a.implicit) || a.divided))
      .map((a) => ({ name: a.name, type: a.type, display_name: a.display_name ?? null }));
    const result = await ai.read(book, {
      file: {
        data: Buffer.from(file.bytes).toString("base64"),
        media_type: file.type,
        filename: file.name,
      },
      hints,
      accounts: chart,
      today,
      currency: info.currency,
    });
    if ("reading" in result) {
      reading = result.reading;
      note = result.reading.note;
    } else note = `It couldn't be read: ${result.failed}`;
  }

  const { transaction, open } = receiptTransaction(reading, hints, accounts, {
    createAccounts: !!settings?.create_accounts,
    today,
    currency: info.currency,
  });
  for (const name of open) await ledger.createAccount(book, name);
  const [created] = await ledger.createTransactions(book, [
    { ...transaction, meta: { ...transaction.meta, ...(note ? { "receipt-note": note } : {}) } },
  ]);
  await ledger.attach(book, created!.id, file);
  return { transaction_id: created!.id, read: !!reading, note };
}
