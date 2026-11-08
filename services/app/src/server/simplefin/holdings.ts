/**
 * Brokerages over SimpleFIN. The Bridge sends each account's holdings as a daily snapshot
 * (symbol, shares, cost basis, market value), not trades or lots, so:
 *
 * - **Prices:** each snapshot records that day's price per symbol (market value / shares).
 * - **Cost:** the snapshot's cost basis when it gives one; Fidelity's is always `0.00`, but its
 *   `purchase_price` is the average cost per share, so that, times the shares. Neither: unknown
 *   (the ledger uses the day's price, marked estimated).
 * - **Positions:** a holding with shares, named by its symbol, or by its description when it has
 *   none (a unit investment trust); several holdings of one security are one position.
 * - **Position changes:** when the bank's shares differ from the books' (unconfirmed included),
 *   the difference is staged for review through M5's trade booking:
 *   - more shares: a buy at the cost increase (or the market price, without one)
 *   - fewer shares: a sale booked by the account's sale method, with gains split by term
 *   - **the cash side** is the bank's matching cash transaction when there is one: an unconfirmed
 *     transaction in the brokerage's cash, within a few days, for about the amount, still
 *     uncategorized. It becomes the trade. Without one, the other side stays uncategorized.
 *   A brokerage whose rows are read (activity.ts) settles its shares in brokerage.ts, and
 *   stages a change here only when its activity doesn't explain it.
 * - **Money-market core positions** (a price of 1, like Fidelity's SPAXX, or a known core fund
 *   with no shares) count as cash, not as holdings: buys and sells move through them every day.
 */
import type { Holding, TransactionIn } from "@luminous-money/ledger-client";

import { add, isNegative, isZero, negate } from "../../shared/decimal.js";
import { ensureUncategorized, UNCATEGORIZED } from "../imports.js";
import { STAGING, type LedgerPort } from "../ledger.js";
import { isCoreFund } from "./activity.js";
import type { SfHolding } from "./client.js";
import type { Link } from "./store.js";
import type { SimplefinDeps } from "./sync.js";
import { cashAccountOf, localDate } from "./sync.js";

/** A Beancount commodity name for a ticker, if it can be one. */
export function commodityOf(symbol: string | null): string | undefined {
  const name = symbol
    ?.trim()
    .toUpperCase()
    .replace(/[^A-Z0-9'._-]/g, "");
  return name && /^[A-Z][A-Z0-9'._-]{0,22}[A-Z0-9]$/.test(name) ? name : undefined;
}

const num = (s: string | null | undefined) => (s === null || s === undefined ? NaN : Number(s));

/** A holding's price per share, if the snapshot says. */
export function priceOf(h: SfHolding): number | undefined {
  const shares = num(h.shares);
  const value = num(h.market_value);
  return shares && Number.isFinite(value) ? value / shares : undefined;
}

/** A money-market core position: priced at 1 (or a known core fund), so it's cash in all but
 * name. */
export const isCashLike = (h: SfHolding) => {
  const price = priceOf(h);
  if (price !== undefined) return Math.abs(price - 1) < 1e-9;
  return !!h.symbol && isCoreFund(h.symbol);
};

/** A commodity name from a holding's description, for one without a symbol: its first words,
 * as many as fit ("XT UNIT 98765 EXAMPLE GROWTH PORT" is `XT-UNIT-98765-EXAMPLE`). */
export function describedAs(description: string | null): string | undefined {
  const words = (description ?? "")
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter(Boolean);
  let name = "";
  for (const w of words) {
    const next = name ? `${name}-${w}` : w;
    if (next.length > 24) break;
    name = next;
  }
  return commodityOf(name);
}

/** The commodity a holding is in the books: its symbol's, else its description's. */
export const holdingName = (h: SfHolding) => commodityOf(h.symbol) ?? describedAs(h.description);

/** A holding's total cost, if the snapshot says: its cost basis, else its average cost per share
 * (`purchase_price`) times its shares. Zero is unknown, not free. */
export function costOf(h: SfHolding): number | undefined {
  const basis = num(h.cost_basis);
  if (basis > 0) return basis;
  const each = num(h.purchase_price);
  const shares = num(h.shares);
  return each > 0 && shares > 0 ? each * shares : undefined;
}

/** The holdings that are positions (not cash, with shares), by commodity: several holdings of
 * one security added together. */
export function positions(holdings: SfHolding[]): Map<string, SfHolding> {
  const found = new Map<string, SfHolding>();
  for (const h of holdings) {
    const commodity = holdingName(h);
    if (!commodity || isCashLike(h) || !(Math.abs(num(h.shares)) > 0)) continue;
    const before = found.get(commodity);
    if (!before) {
      found.set(commodity, h);
      continue;
    }
    const both = [costOf(before), costOf(h)];
    found.set(commodity, {
      ...before,
      shares: add(before.shares, h.shares),
      market_value: String((num(before.market_value) || 0) + (num(h.market_value) || 0)),
      cost_basis: both.every((c) => c !== undefined) ? fixed(both[0]! + both[1]!, 2) : null,
      purchase_price: null,
    });
  }
  return found;
}

export const fixed = (n: number, places: number) => n.toFixed(places).replace(/\.?0+$/, "") || "0";

/** The brokerage's cash in the snapshot: its reported total less its positions' value. */
export function cashOf(balance: string, holdings: SfHolding[]): string {
  let total = Number(balance);
  for (const h of positions(holdings).values()) total -= num(h.market_value) || 0;
  return total.toFixed(2);
}

/** Opening holdings for a new brokerage link: one lot per position (an estimate: SimpleFIN
 * doesn't send lots), at its cost basis. */
export function openingHoldings(holdings: SfHolding[]) {
  return [...positions(holdings)].map(([commodity, h]) => ({
    commodity,
    units: h.shares,
    // Its total cost; without one, the ledger uses the price on the date.
    cost: costOf(h) !== undefined ? fixed(costOf(h)!, 2) : null,
  }));
}

/** An unconfirmed, still-uncategorized cash transaction near `date` for about `amount`: the cash side
 * of a trade the bank reported separately. */
async function cashSideOf(
  ledger: LedgerPort,
  book: string,
  cash: string,
  date: string,
  amount: number
): Promise<{ id: string; updated_at: string; amount: number } | undefined> {
  const page = await ledger.accountLedger(book, cash);
  const near = (d: string) => Math.abs(Date.parse(d) - Date.parse(date)) <= 5 * 864e5;
  const row = page.rows.find(
    (r) =>
      r.flag === "!" &&
      near(r.date) &&
      (r.counterpart === UNCATEGORIZED.out || r.counterpart === UNCATEGORIZED.in) &&
      r.amount !== null &&
      Math.abs(Number(r.amount.number) - amount) <= Math.max(1, Math.abs(amount) * 0.01)
  );
  return row && { id: row.id, updated_at: row.updated_at, amount: Number(row.amount!.number) };
}

/** The snapshot's day, in the book's time zone. */
export const snapshotDay = (deps: SimplefinDeps, link: Link, balanceDate: number) =>
  localDate(balanceDate || Math.floor(Date.now() / 1000), deps.db.timeZone(link.book_id));

/** Record the snapshot's price for each position, on its day. */
export async function recordPrices(deps: SimplefinDeps, link: Link): Promise<void> {
  const snapshot = deps.store.account(link.connection_id, link.account_id);
  if (!snapshot) return;
  const ledger = deps.ledgerFor(link.user_id);
  const today = snapshotDay(deps, link, snapshot.balance_date);
  for (const [commodity, h] of positions(snapshot.holdings)) {
    const price = priceOf(h);
    if (price !== undefined)
      await ledger.addPrice(link.book_id, {
        date: today,
        commodity,
        price: { number: fixed(price, 6), currency: snapshot.currency },
      });
  }
}

/** Stage the difference between the bank's shares of a commodity (none: it's all gone) and the
 * books' as a position change, paired with the bank's cash side if there's one. */
export async function stagePositionChange(
  deps: SimplefinDeps,
  link: Link,
  change: {
    commodity: string;
    bank: SfHolding | undefined;
    mine: Holding | undefined;
    day: string;
  },
  narration?: string
): Promise<boolean> {
  const { commodity, bank: h, mine, day: today } = change;
  const ledger = deps.ledgerFor(link.user_id);
  const book = link.book_id;
  const cash = cashAccountOf(link);
  const delta = add(h?.shares ?? "0", negate(mine?.units ?? "0"));
  if (isZero(delta) || Math.abs(Number(delta)) < 1e-6) return false;

  const units = isNegative(delta) ? negate(delta) : delta;
  const selling = isNegative(delta);
  const price = (h && priceOf(h)) ?? (mine?.price ? Number(mine.price.number) : undefined);
  const bankCost = h && costOf(h);
  const costDelta =
    !selling && bankCost !== undefined ? bankCost - num(mine?.cost?.number ?? "0") : NaN;
  const estimate =
    Number.isFinite(costDelta) && costDelta > 0 ? costDelta / Number(units) : (price ?? 0);
  // The bank's cash side, if it sent one, says what the trade really cost or brought in.
  const pair = await cashSideOf(
    ledger,
    book,
    cash,
    today,
    (selling ? 1 : -1) * estimate * Number(units)
  );
  const perUnit = pair ? Math.abs(pair.amount) / Number(units) : estimate;
  const preview = await ledger.previewTrade(book, link.account, {
    kind: selling ? "sell" : "buy",
    date: today,
    commodity,
    units,
    price: fixed(perUnit, 6),
    amount: null,
    fees: null,
    lots: null,
    narration:
      narration ??
      `${selling ? "Sold" : "Bought"} ${units} ${commodity} (from the bank's holdings)`,
    cash_account: cash,
    holding_account: null,
  });
  for (const name of preview.opens) await ledger.createAccount(book, name).catch(() => undefined);
  const transaction: TransactionIn = { ...preview.transaction, flag: "!" };
  if (pair) {
    await ledger.applyChanges(
      book,
      {
        create: [],
        update: [{ id: pair.id, updated_at: pair.updated_at, postings: transaction.postings }],
        delete: [],
      },
      STAGING
    );
  } else {
    // No cash side seen: leave the other side for review.
    const other = selling ? UNCATEGORIZED.in : UNCATEGORIZED.out;
    await ensureUncategorized(ledger, book, [
      {
        date: today,
        amount: selling ? "1" : "-1",
        description: "",
        payee: null,
        fingerprint: "",
      },
    ]);
    await ledger.createTransactions(
      book,
      [
        {
          ...transaction,
          postings: transaction.postings.map((p) =>
            p.account === cash ? { ...p, account: other } : p
          ),
        },
      ],
      STAGING
    );
  }
  return true;
}

/** Compare the snapshot with the books, record prices, and stage position changes (a brokerage
 * whose rows aren't read). */
export async function holdingChanges(deps: SimplefinDeps, link: Link): Promise<number> {
  const snapshot = deps.store.account(link.connection_id, link.account_id);
  if (!snapshot) return 0;
  const ledger = deps.ledgerFor(link.user_id);
  const day = snapshotDay(deps, link, snapshot.balance_date);
  await recordPrices(deps, link);
  const books = await ledger.holdings(link.book_id, link.account);
  const held = new Map<string, Holding>(books.holdings.map((h) => [h.commodity, h]));
  let staged = 0;
  for (const [commodity, h] of positions(snapshot.holdings))
    if (
      await stagePositionChange(deps, link, { commodity, bank: h, mine: held.get(commodity), day })
    )
      staged += 1;
  return staged;
}
