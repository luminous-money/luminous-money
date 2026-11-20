/**
 * Shops' charges read into the book (Amazon orders, step 2), as receipts are (receipts.ts; Kael,
 * 2026-11-07: "look at these Amazon charges as simple receipts"). A shop's reader (the `shops`
 * service, after each sync) sends the book's charges, each with its lines
 * (`POST /books/:book/orders`, shared/orders.ts), and each is:
 *
 * 1. **Paid from** the account holding its card (`paidWith`: the last four). None, and it waits
 *    (shown on its shop's page): it's likely a card that isn't this book's.
 * 2. **Itemized, always:** its lines are the other side, each a split with its `memo:` (the item),
 *    placed by the categorize chain: rules, history, item history (an item bought before goes
 *    where it went), then the book's AI for what nothing else places. A line with its own account
 *    (a gift card, rewards points) is put there, opened if it isn't yet.
 * 3. **Read into the bank's copy** if it's here: that account's, exactly its amount, within the
 *    matcher's window, nothing read into it yet, a clear match only (`matching`). It keeps its
 *    date, payee and paying side; its other side becomes the lines, even if it was categorized.
 *    Else it's **made, as a receipt is** (`source: "order"`), and the bank's copy is matched to it
 *    when it comes in.
 * 4. **It goes to review** (`!`), its order noted (`order:`, `order-url:`, `order-read:`).
 *
 * A line the shop marks HSA or FSA eligible (Amazon's mark) tags its split `hsa-fsa-eligible`,
 * outright (HSA tracking; Kael, 2026-11-19), and the proposal record says it came from the
 * shop. One already read whose lines come again newly marked gets the tag then (`retag`).
 */
import type { Account, Transaction, TransactionIn } from "@luminous-money/ledger-client";
import { addCost, NO_COST, type AiCost } from "@luminous-money/ai-api";

import { isUncategorized, UNCATEGORIZED, UNKNOWN } from "../../shared/accounts.js";
import { isNegative, negate } from "../../shared/decimal.js";
import { landsIn } from "../../shared/divided.js";
import type { OrderCharge, OrderState, StoredCharge } from "../../shared/orders.js";
import { adding, HSA_FSA_ELIGIBLE, inheriting, type TagSource } from "../../shared/tags.js";
import type { AiPort } from "../ai.js";
import { aiCategorizer } from "../categorize/ai.js";
import { categorize, placed, representative } from "../categorize/chain.js";
import { buildRequest } from "../categorize/context.js";
import { proposalRecord } from "../categorize/service.js";
import type { Categorizer, Incoming } from "../categorize/types.js";
import type { AppDb } from "../db.js";
import { STAGING, type LedgerPort } from "../ledger.js";
import type { Seen } from "../migrate/reference.js";
import { sameNumber } from "../pipeline/matcher.js";
import { matching, paidWith } from "../receipts.js";
import { bookToday } from "../schedules.js";
import type { OrdersStore } from "./store.js";

export type OrderDeps = {
  db: AppDb;
  orders: OrdersStore;
  ledgerFor: (user: string) => LedgerPort;
  aiFor?: (user: string) => AiPort;
  /** The chain before the AI: rules, history, item history. */
  categorizers: Categorizer[];
  /** The book's imported history, for the AI's reference, if its migration turned it on. */
  reference?: (book: string) => Seen[] | undefined;
};

/** Something the person can fix (assigning by hand). */
export class OrderProblem extends Error {
  constructor(
    readonly status: 404 | 409 | 422,
    message: string
  ) {
    super(message);
  }
}

const SHOPS: Record<string, string> = { amazon: "Amazon" };
const shopName = (shop: string) => SHOPS[shop] ?? shop;
const ACCOUNTS_OF_MONEY = new Set(["asset", "liability"]);

type Outcome = { state: OrderState; detail: string | null; transaction_id: string | null };

/** The postings a charge's lines make, the paying side first, and what's left to categorize. */
export function chargePostings(
  charge: OrderCharge,
  account: string,
  currency: string
): { postings: TransactionIn["postings"]; incoming: Incoming } {
  const units = (number: string) => ({ number, currency });
  // A purchase's lines are spent (an expense's increase); a refund's come back.
  const other = isNegative(charge.amount) ? UNCATEGORIZED.out : UNCATEGORIZED.in;
  const lines = charge.lines.length
    ? charge.lines
    : [{ text: shopName(charge.shop), amount: negate(charge.amount) }];
  const splits = lines.map((l) => ({
    account: l.account || other,
    units: units(l.amount),
    flag: "!" as const,
    ...(l.hsa_fsa_eligible ? { tags: [HSA_FSA_ELIGIBLE] } : {}),
    meta: { memo: l.text },
  }));
  return {
    postings: [{ account, units: units(charge.amount) }, ...splits],
    incoming: {
      id: charge.id,
      date: charge.date,
      account,
      amount: units(charge.amount),
      description: shopName(charge.shop),
      payee: null,
      splits: lines.flatMap((l, i) =>
        l.account
          ? []
          : [{ index: i + 1, amount: units(l.amount), memo: l.text, description: null }]
      ),
    },
  };
}

/** The tags a charge's shop put on its lines' splits (by index among the postings, the paying
 * side first). */
export const shopTags = (charge: OrderCharge): TagSource[] =>
  charge.lines.flatMap((l, i) =>
    l.hsa_fsa_eligible ? [{ index: i + 1, tag: HSA_FSA_ELIGIBLE, by: charge.shop }] : []
  );

/** The chain for a user's book: the built-in categorizers, then the book's AI if it's ready. */
async function chainFor(deps: OrderDeps, user: string, book: string, currency: string) {
  const ai = deps.aiFor?.(user);
  const settings = ai ? await ai.settings(book).catch(() => null) : null;
  const notes: string[] = [];
  let spent: AiCost | null = null;
  const chain = [
    ...deps.categorizers,
    ...(ai && settings?.ready
      ? [
          aiCategorizer(ai, book, {
            currency,
            opens: !!settings.create_accounts,
            onFailure: (reason) => notes.push(`The AI couldn't categorize it: ${reason}.`),
            onCost: (cost) => (spent = addCost(spent ?? NO_COST, cost)),
            imported: deps.reference?.(book),
          }),
        ]
      : []),
  ];
  return { chain, notes, spent: () => spent };
}

/** Read one charge into its transaction (the bank's copy, or `given`, by hand), or make it. */
export async function readCharge(
  deps: OrderDeps,
  book: string,
  charge: StoredCharge & { user_id: string },
  given?: string
): Promise<Outcome> {
  const ledger = deps.ledgerFor(charge.user_id);
  const [info, accounts] = await Promise.all([ledger.book(book), ledger.accounts(book)]);
  if (!info) throw new OrderProblem(404, "there's no such book");
  const currency = info.currency ?? "USD";
  const today = bookToday(deps.db, book);

  let target: Transaction | null;
  let account: string;
  if (given) {
    target = await ledger.transaction(book, given);
    const own = payingSide(target, accounts, charge.amount);
    if (!own)
      throw new OrderProblem(
        422,
        `none of that transaction's accounts of money has ${charge.amount} in it`
      );
    if (deps.orders.readInto(book, target.id))
      throw new OrderProblem(409, "another charge was read into that transaction already");
    account = own.account;
  } else {
    if (!charge.card) return waiting("Paid without a card, so there's no account it came from.");
    const card = paidWith(accounts, {
      method: "card",
      brand: null,
      last_four: charge.card.last_four,
    });
    if (!card)
      return waiting(
        `No account in this book holds the card ending ${charge.card.last_four}: add it to the account it's paid from, or leave it out in the shop's settings.`
      );
    // A divided account's charges land in its main part, as its bank rows do (M15).
    account = landsIn(accounts, card) ?? card;
    target = await matching(
      ledger,
      book,
      accounts,
      chargePostings(charge, account, currency).incoming
    );
  }

  const { postings, incoming } = chargePostings(charge, account, currency);
  const { chain, notes, spent } = await chainFor(deps, charge.user_id, book, currency);
  const request = await buildRequest(ledger, { id: book, name: info.name }, [incoming]);
  const decision = chain.length ? ((await categorize(chain, request)).get(incoming.id) ?? {}) : {};
  const staged = placed(postings, incoming, decision);
  // Read into a transaction, its paying side stays as it is (its part, its reconciliation), and
  // the items take the tags of the splits they replace.
  const own = target?.postings.find(
    (p) => p.account === account && !!p.units && sameNumber(p.units.number, charge.amount)
  );
  const replaced = target?.postings.filter((p) => p !== own) ?? [];
  const final = [own ?? staged[0]!, ...inheriting(staged.slice(1), replaced)];

  // Open what it posts to that isn't there yet: the placeholders, a line's own account (a gift
  // card's, as the shop's settings name it), and (with account creation on) what the AI proposed.
  const proposed = new Set(
    [decision.category, ...(decision.splits?.values() ?? [])].flatMap((c) => c?.opens ?? [])
  );
  const named = new Set(charge.lines.flatMap((l) => (l.account ? [l.account] : [])));
  const existing = new Set(accounts.filter((a) => !a.implicit).map((a) => a.name));
  for (const name of new Set(final.map((p) => p.account)))
    if (
      !existing.has(name) &&
      (name === UNKNOWN || isUncategorized(name) || proposed.has(name) || named.has(name))
    )
      await ledger.createAccount(book, name);

  const cost = (spent() as AiCost | null)?.usd;
  const note = [charge.note, ...notes].filter(Boolean).join(" ");
  const marks = {
    "order-read": today,
    order: `${shopName(charge.shop)} ${charge.orders.map((o) => o.number).join(" ")}`.trim(),
    ...(charge.orders[0]?.url ? { "order-url": charge.orders[0].url } : {}),
    ...(note ? { "order-note": note } : {}),
  };
  let id: string;
  if (target) {
    const { "order-note": _old, ...meta } = target.meta ?? {};
    await ledger.patch(
      book,
      target.id,
      {
        postings: final as TransactionIn["postings"],
        payee: target.payee || decision.payee?.payee || shopName(charge.shop),
        flag: "!",
        meta: { ...meta, ...marks },
      },
      target.updated_at,
      STAGING
    );
    id = target.id;
  } else {
    const [made] = await ledger.createTransactions(
      book,
      [
        {
          date: charge.date,
          flag: "!",
          payee: decision.payee?.payee ?? shopName(charge.shop),
          narration: "",
          links: [],
          meta: { source: "order", ...marks },
          postings: final as TransactionIn["postings"],
        },
      ],
      STAGING
    );
    id = made!.id;
  }
  const lead = representative(decision, final, incoming);
  const tags = [
    ...shopTags(charge),
    ...(decision.tags ?? []).filter(
      (t) => !(t.tag === HSA_FSA_ELIGIBLE && charge.lines[t.index - 1]?.hsa_fsa_eligible)
    ),
  ];
  if (lead || decision.payee || tags.length)
    deps.db.saveProposals([
      proposalRecord(
        { transaction: id, book, request: request.request_id, incoming: incoming.id },
        lead,
        decision.payee,
        tags
      ),
    ]);
  const how = target
    ? "Read into its transaction from the bank."
    : "Made as its own transaction; the bank's copy is matched to it when it comes in.";
  return {
    state: "read",
    detail: cost ? `${how} The AI's part cost about $${cost.toFixed(2)}.` : how,
    transaction_id: id,
  };
}

const waiting = (detail: string): Outcome => ({ state: "waiting", detail, transaction_id: null });

/**
 * Tag the splits of a charge already read that its shop now marks HSA or FSA eligible (HSA
 * tracking: Amazon's orders read again for the mark): each newly marked line's split, found by
 * its memo and amount, gains the tag. Only adds: the transaction stays where it is (confirmed
 * stays confirmed), and a split the person has changed since isn't found and is left. Returns how
 * many splits were tagged.
 */
export async function retag(
  deps: OrderDeps,
  book: string,
  charge: StoredCharge & { user_id: string },
  marked: OrderCharge["lines"]
): Promise<number> {
  if (!charge.transaction_id || !marked.length) return 0;
  const ledger = deps.ledgerFor(charge.user_id);
  const t = await ledger.transaction(book, charge.transaction_id);
  const tagged: TagSource[] = [];
  const postings = t.postings.map((p, i) => {
    const line = marked.find(
      (l) => p.meta?.["memo"] === l.text && !!p.units && sameNumber(p.units.number, l.amount)
    );
    if (!line || p.tags?.includes(HSA_FSA_ELIGIBLE)) return p;
    tagged.push({ index: i, tag: HSA_FSA_ELIGIBLE, by: charge.shop });
    return adding(p, [HSA_FSA_ELIGIBLE]);
  });
  if (!tagged.length) return 0;
  await ledger.patch(
    book,
    t.id,
    { postings: postings as TransactionIn["postings"] },
    t.updated_at,
    STAGING
  );
  deps.db.addProposalTags(book, t.id, tagged);
  return tagged.length;
}

/** The side of a transaction that paid `amount`: on an account of money, exactly it. */
function payingSide(t: Transaction, accounts: Account[], amount: string) {
  const types = new Map(accounts.map((a) => [a.name, a.type]));
  return t.postings.find(
    (p) =>
      ACCOUNTS_OF_MONEY.has(types.get(p.account) ?? "") &&
      !!p.units &&
      sameNumber(p.units.number, amount)
  );
}

// One reading of a book's waiting charges at a time; one asked for meanwhile runs after it.
const running = new Map<string, Promise<ReadCounts>>();
const again = new Set<string>();

export type ReadCounts = { read: number; waiting: number; failed: number };

/** Read a book's waiting charges, oldest first. A failure is kept as its detail and the rest go
 * on. */
export function readWaiting(deps: OrderDeps, book: string): Promise<ReadCounts> {
  const current = running.get(book);
  if (current) {
    again.add(book);
    return current;
  }
  const run = (async () => {
    const counts: ReadCounts = { read: 0, waiting: 0, failed: 0 };
    do {
      again.delete(book);
      for (const charge of deps.orders.waiting(book)) {
        try {
          const outcome = await readCharge(deps, book, charge);
          deps.orders.settle(
            book,
            charge.shop,
            charge.id,
            outcome.state,
            outcome.detail,
            outcome.transaction_id
          );
          counts[outcome.state]++;
        } catch (error) {
          const why = error instanceof Error ? error.message : String(error);
          deps.orders.settle(
            book,
            charge.shop,
            charge.id,
            "waiting",
            `Couldn't be read: ${why}`,
            null
          );
          counts.failed++;
        }
      }
    } while (again.has(book));
    return counts;
  })().finally(() => running.delete(book));
  running.set(book, run);
  return run;
}

/** Every book's waiting charges (after a bank feed sync). */
export async function readAllWaiting(deps: OrderDeps): Promise<string | void> {
  const done: string[] = [];
  for (const book of deps.orders.booksWaiting()) {
    const counts = await readWaiting(deps, book);
    if (counts.read) done.push(`${book}: ${counts.read} read`);
  }
  return done.length ? `orders: ${done.join("; ")}` : undefined;
}
