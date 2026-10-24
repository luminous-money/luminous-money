/**
 * Receipts (M16): a photo (or a PDF) and whatever the person typed become an unconfirmed
 * transaction in review, the receipt attached, staged the way an import is:
 *
 * 1. **Extract** what the receipt says (the ai service, if the book's AI is ready).
 * 2. **Build** the transaction. The paying account is the one holding the receipt's card, else
 *    the hint (the page it was captured from; a divided account's main part, as for imports),
 *    else `Assets:Unknown`, chosen in review. What was typed wins over what was read, the total
 *    above all. Itemized, each line is a split to place (its `memo:` the line as printed), with
 *    one more for any difference from the total; else one split of the whole.
 * 3. **Categorize** the splits through the chain (rules, history, item history, then the book's
 *    AI). Every split is staged flagged `!`, still to confirm.
 * 4. **Stage** it, opening the accounts the AI proposed (with the book's account creation on),
 *    and attach the receipt. It never confirms itself.
 *
 * It always makes something: with no reading (AI off, down, or it couldn't), it's made from the
 * hints (a zero total if none), and says why.
 */
import type { ReceiptFacts, ReceiptHints } from "@luminous-money/ai-api";
import type { Account, TransactionIn } from "@luminous-money/ledger-client";

import { isUncategorized, UNCATEGORIZED, UNKNOWN } from "../shared/accounts.js";
import { add, isNegative, isZero, negate } from "../shared/decimal.js";
import { landsIn } from "../shared/divided.js";
import type { AiPort } from "./ai.js";
import { aiCategorizer } from "./categorize/ai.js";
import { categorize, placed, representative } from "./categorize/chain.js";
import { buildRequest } from "./categorize/context.js";
import { proposalRecord } from "./categorize/service.js";
import type { Categorizer, Incoming } from "./categorize/types.js";
import type { AppDb } from "./db.js";
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
  /** What to tell the person: why it wasn't read, or what the reading said. */
  note: string | null;
};

const ACCEPTED = /^(image\/(jpeg|png|gif|webp)|application\/pdf)$/;

/** The open account holding the card the receipt was paid with: the same last four, and the
 * same brand when both say one. Two accounts holding it is no answer. */
export function paidWith(
  accounts: Account[],
  payment: ReceiptFacts["payment"] | null | undefined
): string | null {
  if (!payment?.last_four) return null;
  const holders = accounts.filter(
    (a) =>
      !a.close &&
      (a.cards ?? []).some(
        (c) =>
          c.last_four === payment.last_four &&
          (!c.brand || !payment.brand || c.brand === payment.brand)
      )
  );
  return holders.length === 1 ? holders[0]!.name : null;
}

/** The transaction to stage from what was read (or nothing) and typed, its splits still to
 * place, and anything worth saying. Pure, so it's tested on its own. */
export function receiptTransaction(
  facts: ReceiptFacts | null,
  hints: ReceiptHints,
  accounts: Account[],
  { itemize, today, currency }: { itemize: boolean; today: string; currency: string }
): { transaction: TransactionIn; incoming: Incoming; notes: string[] } {
  const notes: string[] = [];
  const leaves = new Set(
    accounts.filter((a) => a.kind === "leaf" && !a.implicit && !a.close).map((a) => a.name)
  );
  // The paying account is an asset or liability that takes postings: a leaf (a part, if named),
  // or a divided account's main part. Never the placeholder: that's for when there's none.
  const types = new Map(accounts.map((a) => [a.name, a.type]));
  const base = (name: string | null | undefined) => {
    if (!name || name === UNKNOWN || !["asset", "liability"].includes(types.get(name) ?? ""))
      return null;
    if (leaves.has(name)) return name;
    const into = landsIn(accounts, name);
    return into && leaves.has(into) ? into : null;
  };
  const account = base(paidWith(accounts, facts?.payment)) ?? base(hints.account) ?? UNKNOWN;

  // As stored for the paying account: negative for a purchase, positive for a refund.
  const read = facts?.total ? (facts.refund ? facts.total : negate(facts.total)) : null;
  const total = hints.total ?? read ?? "0";
  if (hints.total && read && !isZero(add(hints.total, negate(read))))
    notes.push(`The receipt says ${facts!.total}; the total you gave was used.`);
  const out = isNegative(total) || isZero(total);
  const other = out ? UNCATEGORIZED.out : UNCATEGORIZED.in;
  // A line as printed is positive for what was paid for: spent, it's an expense's increase.
  const signed = (amount: string) => (out ? amount : negate(amount));
  const units = (number: string) => ({ number, currency: facts?.currency ?? currency });

  const lines = itemize ? (facts?.lines ?? []) : [];
  const splits: (TransactionIn["postings"][number] & { description?: string | null })[] = lines.map(
    (line) => ({
      account: other,
      units: units(signed(line.amount)),
      flag: "!",
      meta: { memo: line.text },
      description: line.description,
    })
  );
  const rest = splits.reduce((left, s) => add(left, negate(s.units!.number)), negate(total));
  if (!splits.length || !isZero(rest)) {
    splits.push({ account: other, units: units(rest), flag: "!", meta: {} });
    if (lines.length) notes.push(`The lines don't add up to the total: ${rest} is left over.`);
  }
  if (facts?.note) notes.push(facts.note);

  const payee = hints.payee ?? facts?.payee ?? null;
  const postings = [
    { account, units: units(total) },
    ...splits.map(({ description: _d, ...s }) => s),
  ];
  return {
    transaction: {
      date: hints.date ?? facts?.date ?? today,
      flag: "!",
      payee,
      // Not "Receipt" when there's a payee: history learns from the description first.
      narration: hints.note ?? (payee ? "" : facts ? "Receipt" : "Receipt: couldn't read it"),
      tags: [],
      links: [],
      meta: { source: "receipt" },
      postings,
    },
    incoming: {
      id: "receipt",
      date: hints.date ?? facts?.date ?? today,
      account,
      amount: units(total),
      description: payee ?? hints.note ?? "",
      payee,
      splits: splits.map((s, i) => ({
        index: i + 1,
        amount: s.units!,
        memo: typeof s.meta?.["memo"] === "string" ? (s.meta["memo"] as string) : null,
        description: s.description ?? null,
      })),
    },
    notes,
  };
}

/** Capture a receipt: read it (if the book has AI), build it, categorize it, stage it, attach
 * the file. */
export async function captureReceipt({
  ledger,
  ai,
  db,
  categorizers = [],
  book,
  file,
  hints,
  today,
}: {
  ledger: LedgerPort;
  ai?: AiPort;
  /** Where proposals are recorded (for review and acceptance), if anywhere. */
  db?: AppDb;
  /** The chain before the AI: rules, history, item history. */
  categorizers?: Categorizer[];
  book: string;
  file: ReceiptFile;
  hints: ReceiptHints;
  today: string;
}): Promise<Captured> {
  if (file.bytes.length > RECEIPT_LIMIT) throw new ReceiptProblem(413, "a receipt is at most 5 MB");
  if (!ACCEPTED.test(file.type))
    throw new ReceiptProblem(
      415,
      "a receipt is a photo (JPEG, PNG, WebP, GIF) or a PDF: an iPhone's HEIC photo needs saving as JPEG first"
    );
  const [info, accounts] = await Promise.all([ledger.book(book), ledger.accounts(book)]);
  if (!info) throw new ReceiptProblem(422, "there's no such book");
  const currency = info.currency ?? "USD";
  const settings = ai ? await ai.settings(book) : null;
  const ready = !!(ai && settings?.ready);

  const notes: string[] = [];
  let facts: ReceiptFacts | null = null;
  if (!ai || !settings) notes.push("AI isn't available right now, so it wasn't read.");
  else if (!settings.ready) notes.push("The book's AI isn't set up, so it wasn't read.");
  else {
    const answer = await ai.extract(book, {
      file: {
        data: Buffer.from(file.bytes).toString("base64"),
        media_type: file.type,
        filename: file.name,
      },
      today,
      currency,
    });
    if ("ok" in answer) facts = answer.ok;
    else notes.push(`It couldn't be read: ${answer.failed}.`);
  }

  const built = receiptTransaction(facts, hints, accounts, {
    itemize: hints.itemize ?? settings?.itemize ?? false,
    today,
    currency,
  });
  notes.push(...built.notes);
  const { incoming } = built;

  // Categorize its splits: the chain, then the book's AI.
  const chain = [
    ...categorizers,
    ...(ready
      ? [
          aiCategorizer(ai!, book, currency, !!settings!.create_accounts, (reason) =>
            notes.push(`The AI couldn't categorize it: ${reason}.`)
          ),
        ]
      : []),
  ];
  const request = await buildRequest(ledger, { id: book, name: info.name }, [incoming]);
  const decision = chain.length ? ((await categorize(chain, request)).get(incoming.id) ?? {}) : {};
  const postings = placed(built.transaction.postings, incoming, decision);

  // Open what it posts to that isn't there yet: the placeholders, and (with account creation
  // on) the accounts the AI proposed.
  const proposed = new Set(
    [decision.category, ...(decision.splits?.values() ?? [])].flatMap((c) => c?.opens ?? [])
  );
  const existing = new Set(accounts.filter((a) => !a.implicit).map((a) => a.name));
  for (const name of new Set(postings.map((p) => p.account)))
    if (!existing.has(name) && (name === UNKNOWN || isUncategorized(name) || proposed.has(name)))
      await ledger.createAccount(book, name);

  const [created] = await ledger.createTransactions(book, [
    {
      ...built.transaction,
      payee: decision.payee?.payee ?? built.transaction.payee,
      postings: postings as TransactionIn["postings"],
      meta: {
        ...built.transaction.meta,
        ...(notes.length ? { "receipt-note": notes.join(" ") } : {}),
      },
    },
  ]);
  const id = created!.id;
  await ledger.attach(book, id, file);
  const lead = representative(decision, postings, incoming);
  if (db && (lead || decision.payee))
    db.saveProposals([
      proposalRecord(
        { transaction: id, book, request: request.request_id, incoming: incoming.id },
        lead,
        decision.payee
      ),
    ]);
  return { transaction_id: id, read: !!facts, note: notes.join(" ") || null };
}
