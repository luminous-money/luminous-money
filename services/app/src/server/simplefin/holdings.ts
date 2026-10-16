/**
 * Brokerages over SimpleFIN. The Bridge sends each account's holdings as a daily snapshot
 * (symbol, shares, cost basis, market value), not trades or lots, so:
 *
 * - **Prices:** each snapshot records that day's price per symbol (market value / shares).
 * - **Positions:** when the bank's shares differ from the books' (pending included), the
 *   difference is staged for review as a **position change**, through M5's trade booking:
 *   - more shares: a buy at the cost-basis increase (or the market price, without one)
 *   - fewer shares: a sale booked by the account's sale method, with gains split by term
 *   - **the cash side** is the bank's matching cash transaction when there is one: a pending
 *     transaction in the brokerage's cash, within a few days, for about the amount, still
 *     uncategorized. It becomes the trade. Without one, the other side stays uncategorized.
 * - **Money-market core positions** (a price of 1, like Fidelity's SPAXX) count as cash, not as
 *   holdings: buys and sells move through them every day.
 */
import type { Holding, TransactionIn } from "@fava-beans/ledger-client";

import { add, isNegative, isZero, negate } from "../../shared/decimal.js";
import { ensureUncategorized, UNCATEGORIZED } from "../imports.js";
import type { LedgerPort } from "../ledger.js";
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

/** A money-market core position: priced at 1, so it's cash in all but name. */
export const isCashLike = (h: SfHolding) => {
  const price = priceOf(h);
  return price !== undefined && Math.abs(price - 1) < 1e-9;
};

/** The holdings that are positions (not cash), by commodity. */
export function positions(holdings: SfHolding[]): Map<string, SfHolding> {
  const found = new Map<string, SfHolding>();
  for (const h of holdings) {
    const commodity = commodityOf(h.symbol);
    if (commodity && !isCashLike(h)) found.set(commodity, h);
  }
  return found;
}

const fixed = (n: number, places: number) => n.toFixed(places).replace(/\.?0+$/, "") || "0";

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
    // Its total cost basis; without one, the ledger uses the price on the date.
    cost: Number.isFinite(num(h.cost_basis)) ? fixed(num(h.cost_basis), 2) : null,
  }));
}

/** A pending, still-uncategorized cash transaction near `date` for about `amount`: the cash side
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

/** Compare the snapshot with the books, record prices, and stage position changes. */
export async function holdingChanges(deps: SimplefinDeps, link: Link): Promise<number> {
  const snapshot = deps.store.account(link.connection_id, link.account_id);
  if (!snapshot) return 0;
  const ledger = deps.ledgerFor(link.user_id);
  const book = link.book_id;
  const zone = deps.db.timeZone(book);
  const today = localDate(snapshot.balance_date || Math.floor(Date.now() / 1000), zone);
  const currency = snapshot.currency;
  const books = await ledger.holdings(book, link.account);
  const held = new Map<string, Holding>(books.holdings.map((h) => [h.commodity, h]));
  const cash = cashAccountOf(link);
  let staged = 0;

  for (const [commodity, h] of positions(snapshot.holdings)) {
    const price = priceOf(h);
    if (price !== undefined)
      await ledger.addPrice(book, {
        date: today,
        commodity,
        price: { number: fixed(price, 6), currency },
      });
    const mine = held.get(commodity);
    const delta = add(h.shares, negate(mine?.units ?? "0"));
    if (isZero(delta) || Math.abs(Number(delta)) < 1e-6) continue;

    const units = isNegative(delta) ? negate(delta) : delta;
    const selling = isNegative(delta);
    const costDelta =
      !selling && Number.isFinite(num(h.cost_basis))
        ? num(h.cost_basis) - num(mine?.cost?.number ?? "0")
        : NaN;
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
      narration: `${selling ? "Sold" : "Bought"} ${units} ${commodity} (from the bank's holdings)`,
      cash_account: cash,
      holding_account: null,
    });
    for (const name of preview.opens) await ledger.createAccount(book, name).catch(() => undefined);
    const transaction: TransactionIn = { ...preview.transaction, flag: "!" };
    if (pair) {
      await ledger.applyChanges(book, {
        create: [],
        update: [{ id: pair.id, updated_at: pair.updated_at, postings: transaction.postings }],
        delete: [],
      });
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
      await ledger.createTransactions(book, [
        {
          ...transaction,
          postings: transaction.postings.map((p) =>
            p.account === cash ? { ...p, account: other } : p
          ),
        },
      ]);
    }
    staged += 1;
  }
  return staged;
}
