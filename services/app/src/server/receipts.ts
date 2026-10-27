/**
 * Receipts (M16): a photo (or a PDF) and whatever the person typed become an unconfirmed
 * transaction in review, the receipt attached, staged the way an import is:
 *
 * 1. **Keep** it as images are kept (`normalized`: an iPhone's HEIC becomes a JPEG).
 * 2. **Extract** what the receipt says (the ai service, if the book's AI is ready).
 * 3. **Build** the transaction. The paying account is the one holding the receipt's card, else
 *    the hint (the page it was captured from; a divided account's main part, as for imports),
 *    else `Assets:Unknown`, chosen in review. What was typed wins over what was read, the total
 *    above all. Itemized, each line is a split to place (its `memo:` the line as printed), with
 *    one more for any difference from the total; else one split of the whole.
 * 4. **Match** it: if the bank's copy is already here (`matching`), the receipt is read into
 *    that instead of making another.
 * 5. **Categorize** the splits through the chain (rules, history, item history, then the book's
 *    AI). Every split is staged flagged `!`, still to confirm.
 * 6. **Stage** it, opening the accounts the AI proposed (with the book's account creation on),
 *    and attach the receipt. It never confirms itself; one read into a confirmed transaction
 *    sends it back to review.
 *
 * Reading a receipt into a transaction (`readReceipt`, from its page) is the same with the
 * transaction given: its amount is the total, its account the one that paid.
 *
 * It always makes something: with no reading (AI off, down, or it couldn't), it's made from the
 * hints (a zero total if none), and says why.
 */
import {
  addCost,
  NO_COST,
  type AiCost,
  type ReceiptFacts,
  type ReceiptHints,
} from "@luminous-money/ai-api";
import type { Account, Transaction, TransactionIn } from "@luminous-money/ledger-client";

import { isUncategorized, UNCATEGORIZED, UNKNOWN } from "../shared/accounts.js";
import { add, isNegative, isZero, negate } from "../shared/decimal.js";
import { hasReceipt } from "../shared/receipts.js";
import { landsIn } from "../shared/divided.js";
import { addDays } from "../shared/schedule.js";
import type { AiPort } from "./ai.js";
import { aiCategorizer } from "./categorize/ai.js";
import type { Seen } from "./migrate/reference.js";
import { categorize, placed, representative } from "./categorize/chain.js";
import { buildRequest } from "./categorize/context.js";
import { proposalRecord } from "./categorize/service.js";
import type { Categorizer, Incoming } from "./categorize/types.js";
import type { AppDb } from "./db.js";
import { KEPT_LIMIT, normalized, UPLOAD_LIMIT, type FileIn } from "./images.js";
import type { LedgerPort } from "./ledger.js";
import { buildContext } from "./pipeline/context.js";
import { DEFAULT_WINDOW_DAYS, matcher, sameNumber } from "./pipeline/matcher.js";

/** Something the person can fix: too big, not an image or PDF. */
export class ReceiptProblem extends Error {
  constructor(
    readonly status: 413 | 415 | 422,
    message: string
  ) {
    super(message);
  }
}

export type ReceiptFile = FileIn;
export type Captured = {
  transaction_id: string;
  /** Whether the AI read it (else it was made from the hints). */
  read: boolean;
  /** Whether it was read into a transaction already here (the bank's copy, or the one given). */
  matched: boolean;
  /** What to tell the person: why it wasn't read, or what the reading said. */
  note: string | null;
  /** What the AI's part cost (reading, then categorizing): USD, estimated; null if it wasn't
   * asked or a model's prices aren't known. */
  ai_cost: number | null;
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
  {
    itemize,
    today,
    currency,
    kept = false,
  }: {
    itemize: boolean;
    today: string;
    currency: string;
    /** Whether the total is a transaction's own amount, not one typed. */
    kept?: boolean;
  }
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
    notes.push(
      `The receipt says ${facts!.total}; ${kept ? "the transaction's amount was kept" : "the total you gave was used"}.`
    );
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

const ACCOUNTS_OF_MONEY = new Set(["asset", "liability"]);

/** Notes as one line of sentences (a reader's own note may end without a period). */
const sentences = (notes: string[]) =>
  notes.map((n) => n.trim().replace(/(?<![.!?])$/, ".")).join(" ");

/** The bank's copy of a receipt, if it's already here: one of the paying account's transactions
 * within the matcher's window of the receipt's date (as the matcher finds them), for exactly its
 * amount, a purchase or a refund (no other account of money in it) that no receipt was read into
 * yet. Only a clear match: the one candidate, or the one closest in date. */
export async function matching(
  ledger: LedgerPort,
  book: string,
  accounts: Account[],
  incoming: Incoming
): Promise<Transaction | null> {
  const { account, date, amount } = incoming;
  if (account === UNKNOWN || isZero(amount.number)) return null;
  const context = await buildContext(
    ledger,
    book,
    account,
    addDays(date, -DEFAULT_WINDOW_DAYS),
    addDays(date, DEFAULT_WINDOW_DAYS)
  );
  const [found] = await matcher().resolve(
    [{ line: 0, date, amount, description: incoming.description, payee: incoming.payee }],
    context
  );
  const types = new Map(accounts.map((a) => [a.name, a.type]));
  const fits: { score: number; t: Transaction }[] = [];
  for (const c of found?.candidates ?? []) {
    if (!sameNumber(c.amount, amount.number)) continue;
    const t = await ledger.transaction(book, c.transaction_id);
    const others = t.postings.filter((p) => p.account !== account);
    if (
      hasReceipt(t.meta) ||
      others.some((p) => ACCOUNTS_OF_MONEY.has(types.get(p.account) ?? "") || p.cost || p.price)
    )
      continue;
    fits.push({ score: c.score, t });
  }
  if (!fits.length || (fits.length > 1 && fits[0]!.score === fits[1]!.score)) return null;
  return fits[0]!.t;
}

/** Which of a transaction's postings paid: on the receipt's card's account if it has one, else
 * its first on an asset or liability. */
function payingIndex(t: Transaction, accounts: Account[], card: string | null): number {
  const types = new Map(accounts.map((a) => [a.name, a.type]));
  const paying = t.postings.flatMap((p, i) =>
    p.units && ACCOUNTS_OF_MONEY.has(types.get(p.account) ?? "") ? [i] : []
  );
  return paying.find((i) => t.postings[i]!.account === card) ?? paying[0] ?? -1;
}

type Reading = {
  ledger: LedgerPort;
  ai?: AiPort;
  /** Where proposals are recorded (for review and acceptance), if anywhere. */
  db?: AppDb;
  /** The chain before the AI: rules, history, item history. */
  categorizers?: Categorizer[];
  /** The book's imported history, for the AI's reference, if its migration turned it on. */
  reference?: Seen[];
  book: string;
  file: ReceiptFile;
  today: string;
};

/** The file as it's kept, if it's one a receipt can be. */
async function receiptFile(file: ReceiptFile): Promise<ReceiptFile> {
  if (file.bytes.length > UPLOAD_LIMIT) throw new ReceiptProblem(413, "a receipt is at most 25 MB");
  const kept = await normalized(file);
  if (!ACCEPTED.test(kept.type))
    throw new ReceiptProblem(415, "a receipt is a photo or a PDF (this one couldn't be read)");
  if (kept.bytes.length > KEPT_LIMIT) throw new ReceiptProblem(413, "a receipt is at most 5 MB");
  return kept;
}

/** Capture a receipt: read it (if the book has AI), build it, and read it into the bank's copy
 * if that's here already, else stage a new one; attach the file. */
export async function captureReceipt(
  options: Reading & { hints: ReceiptHints }
): Promise<Captured> {
  return read({ ...options, file: await receiptFile(options.file) });
}

/** Read a receipt into a transaction (its page's "Read receipt"): a new file, attached too, or
 * one it holds already (`attached`). */
export async function readReceipt(
  options: Reading & {
    transaction: string;
    attached?: boolean;
    /** Null or absent: as the book's AI is set to. */
    itemize?: boolean | null;
  }
): Promise<Captured> {
  const file = options.attached ? options.file : await receiptFile(options.file);
  if (!ACCEPTED.test(file.type))
    throw new ReceiptProblem(415, "only a photo or a PDF can be read as a receipt");
  const target = await options.ledger.transaction(options.book, options.transaction);
  const hints = { itemize: options.itemize ?? null };
  return read({ ...options, file, hints, target, attach: !options.attached });
}

async function read({
  ledger,
  ai,
  db,
  categorizers = [],
  reference,
  book,
  file,
  hints,
  today,
  target: given,
  attach = true,
}: Reading & { hints: ReceiptHints; target?: Transaction; attach?: boolean }): Promise<Captured> {
  const [info, accounts] = await Promise.all([ledger.book(book), ledger.accounts(book)]);
  if (!info) throw new ReceiptProblem(422, "there's no such book");
  const currency = info.currency ?? "USD";
  const settings = ai ? await ai.settings(book) : null;
  const ready = !!(ai && settings?.ready);

  const notes: string[] = [];
  let facts: ReceiptFacts | null = null;
  let spent: AiCost | null = null;
  const spend = (cost: AiCost | undefined) => {
    if (cost) spent = addCost(spent ?? NO_COST, cost);
  };
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
    spend("ok" in answer ? answer.ok.cost : answer.cost);
    if ("ok" in answer) {
      const { cost: _c, ...read } = answer.ok;
      facts = read;
    } else notes.push(`It couldn't be read: ${answer.failed}.`);
  }

  // Read into a transaction given, its paying side the total; else built from the hints, and
  // read into the bank's copy if that's here.
  const card = paidWith(accounts, facts?.payment);
  const paying = given ? payingIndex(given, accounts, card) : -1;
  if (given && paying < 0)
    throw new ReceiptProblem(422, "a receipt is read into a transaction paid from an account");
  const own = given?.postings[paying];
  const itemize = hints.itemize ?? settings?.itemize ?? false;
  const built = receiptTransaction(
    facts,
    own ? { account: own.account, total: own.units!.number, date: given!.date } : hints,
    accounts,
    { itemize, today, currency, kept: !!own }
  );
  notes.push(...built.notes);
  const incoming: Incoming = own
    ? { ...built.incoming, account: own.account, amount: own.units!, payee: built.incoming.payee }
    : built.incoming;
  const target = given ?? (await matching(ledger, book, accounts, incoming));
  if (target && !given)
    notes.unshift(
      `It was read into the transaction already here from ${target.date}${target.flag === "*" ? ", which is back in review" : ""}.`
    );
  const ownPosting =
    target?.postings[
      given ? paying : target.postings.findIndex((p) => p.account === incoming.account)
    ];

  // A transaction already categorized keeps its categories unless it's itemized.
  const others = target?.postings.filter((p) => p !== ownPosting) ?? [];
  const keeps =
    !!target &&
    !itemize &&
    others.every((p) => !isUncategorized(p.account) && p.account !== UNKNOWN);

  // Categorize its splits: the chain, then the book's AI.
  const chain = [
    ...categorizers,
    ...(ready
      ? [
          aiCategorizer(ai!, book, {
            currency,
            opens: !!settings!.create_accounts,
            onFailure: (reason) => notes.push(`The AI couldn't categorize it: ${reason}.`),
            onCost: spend,
            imported: reference,
          }),
        ]
      : []),
  ];
  const request = keeps
    ? null
    : await buildRequest(ledger, { id: book, name: info.name }, [incoming]);
  const decision =
    request && chain.length ? ((await categorize(chain, request)).get(incoming.id) ?? {}) : {};
  const staged = placed(built.transaction.postings, incoming, decision);
  // Read into a transaction, its paying side stays as it is (its part, its reconciliation).
  const postings = keeps
    ? target!.postings
    : ownPosting
      ? [ownPosting, ...staged.slice(1)]
      : staged;

  // Open what it posts to that isn't there yet: the placeholders, and (with account creation
  // on) the accounts the AI proposed.
  const proposed = new Set(
    [decision.category, ...(decision.splits?.values() ?? [])].flatMap((c) => c?.opens ?? [])
  );
  const existing = new Set(accounts.filter((a) => !a.implicit).map((a) => a.name));
  for (const name of new Set(postings.map((p) => p.account)))
    if (!existing.has(name) && (name === UNKNOWN || isUncategorized(name) || proposed.has(name)))
      await ledger.createAccount(book, name);

  const payee = decision.payee?.payee ?? built.transaction.payee;
  let id: string;
  if (target) {
    const { "receipt-note": _old, ...meta } = target.meta ?? {};
    await ledger.patch(
      book,
      target.id,
      {
        postings: postings as TransactionIn["postings"],
        // What was typed wins; else the bank's payee, which its rules have learned.
        payee: hints.payee ?? (target.payee || payee),
        ...(hints.note ? { narration: hints.note } : {}),
        flag: "!",
        meta: {
          ...meta,
          "receipt-read": today,
          ...(notes.length ? { "receipt-note": sentences(notes) } : {}),
        },
      },
      target.updated_at
    );
    id = target.id;
  } else {
    const [created] = await ledger.createTransactions(book, [
      {
        ...built.transaction,
        payee,
        postings: postings as TransactionIn["postings"],
        meta: {
          ...built.transaction.meta,
          "receipt-read": today,
          ...(notes.length ? { "receipt-note": sentences(notes) } : {}),
        },
      },
    ]);
    id = created!.id;
  }
  if (attach) await ledger.attach(book, id, file);
  const lead = keeps ? undefined : representative(decision, postings, incoming);
  if (db && request && (lead || decision.payee))
    db.saveProposals([
      proposalRecord(
        { transaction: id, book, request: request.request_id, incoming: incoming.id },
        lead,
        decision.payee
      ),
    ]);
  return {
    transaction_id: id,
    read: !!facts,
    matched: !!target,
    note: sentences(notes) || null,
    ai_cost: (spent as AiCost | null)?.usd ?? null,
  };
}
