/**
 * A brokerage's activity in the books (the brokerage activity plan), for a link whose
 * institution has a reader (activity.ts):
 *
 * - **Importing:** each new row is read first. A sweep is left out (its import row kept, so it
 *   never comes back). A dividend is confirmed to the link's dividend account. Cash from another
 *   broker goes to `Equity:Opening-Balances`, for review. A trade is booked by M5's trade
 *   booking, for review; shares received come in as a lot at the snapshot's average cost,
 *   against `Equity:Opening-Balances`. Everything else goes through the usual pipeline.
 * - **A trade's shares:** in a history, fitted (`fitHistory`); else the snapshot's change since
 *   the books when it accounts for the day's trades, else that day's price (marked estimated,
 *   for the snapshot to settle).
 * - **Settling** (`settle`), after each sync: the snapshot is the truth for shares. An estimated
 *   trade is booked again with the shares the snapshot shows; a difference nothing explains,
 *   seen on three days, is staged as a position change (holdings.ts). Cash isn't written: it's
 *   compared with the bank (reconcile.ts), since a pending row the bank already counts would
 *   otherwise be counted twice.
 * - **History** (`readHistory`, at linking and when read again): each position opens at
 *   today's shares less what the history's trades and transfers moved, and the trades take the
 *   shares fitted to today's.
 */
import { randomUUID } from "node:crypto";

import type { Row } from "@luminous-money/csv-import";
import { now } from "@luminous-money/db";
import type { Holding, TransactionIn } from "@luminous-money/ledger-client";

import type { ImportResult, ImportRow } from "../../shared/imports.js";
import { add, negate } from "../../shared/decimal.js";
import { importRows } from "../imports.js";
import { STAGING, type LedgerPort } from "../ledger.js";
import {
  cashLikeIn,
  readerFor,
  DIVIDENDS,
  isRetirement,
  RETIREMENT_DIVIDENDS,
  type Activity,
  type Reader,
} from "./activity.js";
import type { AccountSnapshot, Link } from "./store.js";
import {
  commodityOf,
  costOf,
  fixed,
  positions,
  priceOf,
  recordPrices,
  snapshotDay,
  stagePositionChange,
} from "./holdings.js";
import { cashAccountOf, rowsOf, type SimplefinDeps } from "./sync.js";

export const OPENING_BALANCES = "Equity:Opening-Balances";

/** A bank row as read: what it was, and the commodity it moved, if any. */
export type ReadRow = Row & {
  date: string;
  amount: string;
  fingerprint: string;
  activity: Activity;
  commodity: string | null;
};

/** What booking a trade needs of its row. */
type TradeRow = Pick<
  ReadRow,
  "date" | "amount" | "description" | "payee" | "fingerprint" | "commodity" | "activity"
>;

const TRADES = new Set(["buy", "sell", "shares-in"]);
export const isTrade = (r: ReadRow) => TRADES.has(r.activity.kind);

/** What a row does to the brokerage's cash: a sweep and shares received, nothing. */
export const cashEffect = (r: Pick<ReadRow, "activity" | "amount">) =>
  r.activity.kind === "sweep" || r.activity.kind === "shares-in" ? "0" : r.amount;

/** Read rows with a reader: each row's activity, and the commodity it names in the books (the
 * holding with its symbol; a ticker no longer held; or, for a CUSIP, the one position named
 * only by its description). A trade whose security can't be told is read as anything else. */
export function readRows(reader: Reader, rows: Row[], snapshot: AccountSnapshot): ReadRow[] {
  const cashLike = cashLikeIn(snapshot.holdings);
  const held = [...positions(snapshot.holdings)];
  const unnamed = held.filter(([, h]) => !commodityOf(h.symbol));
  return rows.map((row) => {
    const activity = reader.read(row.description, cashLike);
    const security = activity.security;
    let commodity: string | null = null;
    if (security) {
      const bySymbol = held.find(([, h]) => h.symbol?.trim().toUpperCase() === security);
      commodity =
        bySymbol?.[0] ??
        (/^[A-Z]/.test(security) ? commodityOf(security) : undefined) ??
        (unnamed.length === 1 ? unnamed[0]![0] : null);
    }
    const read: Activity =
      TRADES.has(activity.kind) && !commodity ? { kind: "other", security } : activity;
    return {
      ...row,
      date: row.date!,
      amount: row.amount!,
      fingerprint: `id:${row.id}`,
      activity: read,
      commodity,
    };
  });
}

/** The account a link's dividends go to: the one chosen, else by whether it's a retirement
 * account (its dividends aren't taxable, so they're kept apart from the 1099-DIV's). */
export const dividendsOf = (link: Link, snapshot?: AccountSnapshot) =>
  link.dividends ?? (isRetirement(link.account, snapshot?.name) ? RETIREMENT_DIVIDENDS : DIVIDENDS);

/** Units as text, to `places` decimals, without trailing zeros. */
const unitsText = (n: number, places = 6) => fixed(n, places);

/** Decimals a share count is given to (at least 3, so a fitted share is close enough). */
const placesOf = (shares: string | undefined) => Math.max(3, (shares?.split(".")[1] ?? "").length);

/** A commodity's price on each day: the book's or fetched (for a ticker), else the book's
 * nearest, else the snapshot's. */
async function pricesFor(
  ledger: LedgerPort,
  book: string,
  commodity: string,
  ticker: boolean,
  dates: string[],
  fallback: number | undefined
): Promise<Map<string, number>> {
  const found = new Map<string, number>();
  const asked = await ledger
    .pricesOn(book, { commodity, dates, symbol: ticker ? commodity : null })
    .catch(() => []);
  for (const p of asked) if (p.price) found.set(p.date, Number(p.price.number));
  const missing = dates.filter((d) => !found.has(d));
  if (missing.length) {
    const history = await ledger.priceHistory(book, commodity).catch(() => []);
    for (const d of missing) {
      const nearest = [...history].sort(
        (a, b) =>
          Math.abs(Date.parse(a.date) - Date.parse(d)) -
          Math.abs(Date.parse(b.date) - Date.parse(d))
      )[0];
      const price = nearest ? Number(nearest.price.number) : fallback;
      if (price) found.set(d, price);
    }
  }
  return found;
}

/** Shares a trade row moved, estimated from its day's price: signed (into the account +). */
type Estimate = { row: ReadRow; units: number; price: number };

async function estimates(
  deps: SimplefinDeps,
  link: Link,
  snapshot: AccountSnapshot,
  rows: ReadRow[]
): Promise<Estimate[]> {
  const ledger = deps.ledgerFor(link.user_id);
  const held = positions(snapshot.holdings);
  const out: Estimate[] = [];
  const byCommodity = new Map<string, ReadRow[]>();
  for (const r of rows.filter(isTrade))
    byCommodity.set(r.commodity!, [...(byCommodity.get(r.commodity!) ?? []), r]);
  for (const [commodity, trades] of byCommodity) {
    const h = held.get(commodity);
    // A ticker: the holding's own symbol, or the row's.
    const ticker = !!commodityOf(h?.symbol ?? trades[0]!.activity.security);
    const prices = await pricesFor(
      ledger,
      link.book_id,
      commodity,
      ticker,
      [...new Set(trades.map((t) => t.date))],
      h ? priceOf(h) : undefined
    );
    for (const row of trades) {
      const price = prices.get(row.date);
      if (!price) continue;
      const shares = Math.abs(Number(row.amount)) / price;
      out.push({ row, price, units: row.activity.kind === "sell" ? -shares : shares });
    }
  }
  return out;
}

/** What a history's trades did, fitted to today's shares. */
export type Fitted = {
  /** Each position's shares before the history (at its opening). */
  opening: Map<string, number>;
  /** Each trade's shares, signed, by fingerprint. */
  units: Map<string, number>;
};

/**
 * Fit a history's estimated trades to today's shares. Per commodity, what today's shares leave
 * after the trades is its opening. When that's near nothing (within 5% of the larger of today's
 * shares and what the trades moved) or below it, there was none: the estimates take up the
 * difference, each in proportion to its size, so the books end at today's shares exactly.
 * Units are rounded to `places` (by commodity), the rounding going to the largest trade.
 */
export function fitHistory(
  trades: { key: string; commodity: string; units: number }[],
  today: Map<string, number>,
  places: Map<string, number> = new Map()
): Fitted {
  const opening = new Map<string, number>();
  const units = new Map<string, number>();
  const commodities = new Set([...today.keys(), ...trades.map((t) => t.commodity)]);
  for (const commodity of commodities) {
    const mine = trades.filter((t) => t.commodity === commodity);
    const shares = today.get(commodity) ?? 0;
    const d = places.get(commodity) ?? 3;
    const round = (n: number) => Math.round(n * 10 ** d) / 10 ** d;
    const moved = mine.reduce((n, t) => n + t.units, 0);
    const size = mine.reduce((n, t) => n + Math.abs(t.units), 0);
    let left = shares - moved;
    const fitted = mine.map((t) => ({ ...t }));
    if (size > 0 && (left < 0 || Math.abs(left) <= 0.05 * Math.max(shares, size))) {
      for (const t of fitted) t.units += (left * Math.abs(t.units)) / size;
      left = 0;
    }
    for (const t of fitted) t.units = round(t.units);
    const open = round(Math.max(0, left));
    const residual = round(shares - open - fitted.reduce((n, t) => n + t.units, 0));
    if (residual && fitted.length) {
      const largest = fitted.reduce((a, b) => (Math.abs(b.units) > Math.abs(a.units) ? b : a));
      largest.units = round(largest.units + residual);
    }
    if (open > 0) opening.set(commodity, open);
    for (const t of fitted) units.set(t.key, t.units);
  }
  return { opening, units };
}

type TradeUnits = Map<string, { units: number; estimated: boolean }>;

/** A trade's transaction from a row: M5's booking with the row's own cash, for review. */
async function tradeOf(
  ledger: LedgerPort,
  link: Link,
  row: TradeRow,
  units: number,
  perShareCost: number | undefined,
  batchId: string,
  note: string | null
): Promise<TransactionIn | null> {
  if (!(Math.abs(units) > 0)) return null;
  const kind = row.activity.kind;
  const shares = Math.abs(units);
  const selling = units < 0;
  const price =
    kind === "shares-in" && perShareCost ? perShareCost : Math.abs(Number(row.amount)) / shares;
  const preview = await ledger.previewTrade(link.book_id, link.account, {
    kind: selling ? "sell" : "buy",
    date: row.date,
    commodity: row.commodity!,
    units: unitsText(shares),
    price: fixed(price, 8),
    amount: null,
    fees: null,
    lots: null,
    narration: row.description,
    cash_account: kind === "shares-in" ? OPENING_BALANCES : cashAccountOf(link),
    holding_account: null,
  });
  for (const name of preview.opens)
    await ledger.createAccount(link.book_id, name).catch(() => undefined);
  return {
    ...preview.transaction,
    flag: "!",
    payee: row.payee,
    narration: row.description,
    meta: {
      source: "simplefin",
      "import-batch": batchId,
      "import-id": row.fingerprint,
      "brokerage-trade": kind,
      ...(note ? { "brokerage-note": note } : {}),
      ...(note && kind !== "shares-in" ? { "brokerage-estimate": unitsText(units) } : {}),
    },
  };
}

const money = (n: number) => `$${n.toFixed(2)}`;

/**
 * Bring a brokerage's new rows in, read (see the top). `fitted` gives a history's trades their
 * shares; without it, they come from the snapshot or the day's price. Returns the usual
 * pipeline's result for the rows it took, if any.
 */
export async function importBrokerage(
  deps: SimplefinDeps,
  link: Link,
  reader: Reader,
  rows: Row[],
  fitted?: Fitted
): Promise<ImportResult | null> {
  const { db, store } = deps;
  const ledger = deps.ledgerFor(link.user_id);
  const book = link.book_id;
  const snapshot = store.account(link.connection_id, link.account_id)!;
  const currency = snapshot.currency;
  const cash = cashAccountOf(link);
  const read = readRows(reader, rows, snapshot);
  const others = read.filter((r) => r.activity.kind === "other");
  let result = others.length
    ? await importRows({
        db,
        ledger,
        book,
        account: cash,
        userId: link.user_id,
        source: "simplefin",
        label: snapshot.institution || "SimpleFIN",
        rows: others.map(({ activity: _a, commodity: _c, fingerprint: _f, ...r }, i) => ({
          ...r,
          line: i + 1,
        })),
        categorizers: deps.categorizers,
      })
    : null;
  // What the opening balance already includes isn't brought in (as imports skip it).
  const [target] = await ledger.summary(book, [cash]);
  const mine = read.filter(
    (r) => r.activity.kind !== "other" && !(target?.as_of && r.date <= target.as_of)
  );
  if (!mine.length) return result;

  // The trades' shares: fitted, else the snapshot's change since the books, else estimated.
  const units: TradeUnits = new Map();
  const guesses = await estimates(deps, link, snapshot, mine);
  const guessed = new Map(guesses.map((g) => [g.row.fingerprint, g]));
  if (fitted) {
    for (const r of mine.filter(isTrade)) {
      const u = fitted.units.get(r.fingerprint);
      if (u !== undefined) units.set(r.fingerprint, { units: u, estimated: true });
    }
  } else {
    const books = await ledger.holdings(book, link.account);
    const held = new Map(books.holdings.map((h) => [h.commodity, Number(h.units)]));
    const bank = positions(snapshot.holdings);
    const commodities = new Set(guesses.map((g) => g.row.commodity!));
    for (const commodity of commodities) {
      const mineOf = guesses.filter((g) => g.row.commodity === commodity);
      const net = mineOf.reduce((n, g) => n + g.units, 0);
      const delta = Number(bank.get(commodity)?.shares ?? 0) - (held.get(commodity) ?? 0);
      // The snapshot already shows these trades: its change is their shares, exactly.
      const shows =
        net !== 0 &&
        Math.sign(delta) === Math.sign(net) &&
        Math.abs(delta - net) <= 0.2 * Math.abs(net);
      const d = placesOf(bank.get(commodity)?.shares);
      for (const g of mineOf)
        units.set(g.row.fingerprint, {
          units: shows ? Number(fixed((g.units * delta) / net, d)) : Number(fixed(g.units, d)),
          estimated: !shows,
        });
    }
  }

  const batchId = randomUUID().replace(/-/g, "");
  const dividends = dividendsOf(link, snapshot);
  const accounts = new Set(
    (await ledger.accounts(book)).filter((a) => !a.implicit).map((a) => a.name)
  );
  const needed = new Map([
    [dividends, "dividend"],
    [OPENING_BALANCES, "cash-in"],
  ]);
  for (const [name, kind] of needed)
    if (!accounts.has(name) && mine.some((r) => r.activity.kind === kind))
      await ledger.createAccount(book, name);
  const plain = (row: ReadRow, account: string, flag: "*" | "!"): TransactionIn => ({
    date: row.date,
    flag,
    payee: row.payee,
    narration: row.description,
    links: [],
    meta: { source: "simplefin", "import-batch": batchId, "import-id": row.fingerprint },
    postings: [
      { account: cash, units: { number: row.amount, currency } },
      { account, units: null },
    ],
  });

  const held = positions(snapshot.holdings);
  const outcome = new Map<string, { id: string | null; outcome: ImportRow["outcome"] }>();
  const plainOnes: { row: ReadRow; t: TransactionIn }[] = [];
  for (const row of mine) {
    const kind = row.activity.kind;
    if (kind === "sweep") outcome.set(row.fingerprint, { id: null, outcome: "left-out" });
    else if (kind === "dividend") plainOnes.push({ row, t: plain(row, dividends, "*") });
    else if (kind === "cash-in") plainOnes.push({ row, t: plain(row, OPENING_BALANCES, "!") });
  }
  if (plainOnes.length) {
    const created = await ledger.createTransactions(
      book,
      plainOnes.map((p) => p.t),
      STAGING
    );
    plainOnes.forEach((p, i) =>
      outcome.set(p.row.fingerprint, { id: created[i]!.id, outcome: "staged" })
    );
  }
  // Trades one at a time, in order: a sale draws on the lots before it.
  const order = { "shares-in": 0, buy: 1, sell: 2 } as Record<string, number>;
  const trades = mine
    .filter(isTrade)
    .sort(
      (a, b) => a.date.localeCompare(b.date) || order[a.activity.kind]! - order[b.activity.kind]!
    );
  const unread: ReadRow[] = [];
  for (const row of trades) {
    const u = units.get(row.fingerprint);
    if (!u) {
      unread.push(row);
      continue;
    }
    const h = held.get(row.commodity!);
    const cost = h ? costOf(h) : undefined;
    const perShareCost = cost !== undefined && h ? cost / Number(h.shares) : undefined;
    const guess = guessed.get(row.fingerprint);
    const shares = unitsText(Math.abs(u.units));
    const note =
      row.activity.kind === "shares-in"
        ? `Shares received: ${shares} ${row.commodity}${fitted ? " (from today's, less the history's trades)" : ""}, at ${perShareCost ? `the bank's average cost, ${money(perShareCost)} each` : "the day's price"}. The lot's date and cost are estimates.`
        : u.estimated
          ? `Shares estimated: ${shares} ${row.commodity} at ${guess ? money(guess.price) : "the day's price"}${fitted ? ", fitted to today's shares" : ""}. The bank's holdings settle them.`
          : null;
    try {
      const t = await tradeOf(ledger, link, row, u.units, perShareCost, batchId, note);
      if (!t) {
        unread.push(row);
        continue;
      }
      const [made] = await ledger.createTransactions(book, [t], STAGING);
      outcome.set(row.fingerprint, { id: made!.id, outcome: "staged" });
    } catch {
      unread.push(row); // the ledger wouldn't book it (a sale of shares not held): as cash
    }
  }
  if (unread.length) {
    const rest = await importRows({
      db,
      ledger,
      book,
      account: cash,
      userId: link.user_id,
      source: "simplefin",
      label: snapshot.institution || "SimpleFIN",
      rows: unread.map(({ activity: _a, commodity: _c, fingerprint: _f, ...r }, i) => ({
        ...r,
        line: i + 1,
      })),
      categorizers: deps.categorizers,
    });
    result = result
      ? {
          ...result,
          batch: {
            ...result.batch,
            staged: result.batch.staged + rest.batch.staged,
            matched: result.batch.matched + rest.batch.matched,
          },
          rows: [...result.rows, ...rest.rows],
        }
      : rest;
  }

  const recorded = mine.filter((r) => !unread.includes(r));
  if (!recorded.length) return result;
  const count = (o: string) =>
    recorded.filter((r) => outcome.get(r.fingerprint)?.outcome === o).length;
  const batch = {
    id: batchId,
    account: cash,
    source: "simplefin" as const,
    filename: `${snapshot.institution || "SimpleFIN"} (activity)`,
    created_at: now(),
    rows: recorded.length,
    staged: count("staged"),
    matched: 0,
    duplicates: 0,
    skipped: count("left-out"),
    unreadable: 0,
  };
  const stored = recorded.map((r, i) => ({
    line: i + 1,
    date: r.date,
    amount: r.amount,
    description: r.description,
    payee: r.payee,
    outcome: outcome.get(r.fingerprint)!.outcome,
    error: null,
    transaction_id: outcome.get(r.fingerprint)!.id,
    candidates: [],
    match: null,
    proposal: null,
    fingerprint: r.fingerprint,
  }));
  db.saveImport({ ...batch, book_id: book, user_id: link.user_id }, stored);
  // What the sync says it brought: the usual pipeline's rows and these together.
  if (!result) return { batch, rows: stored, balance_check: null };
  return { ...result, batch: { ...result.batch, staged: result.batch.staged + batch.staged } };
}

const shift = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 864e5).toISOString().slice(0, 10);

/** A trade booked from a row whose shares were estimated, still unconfirmed: its shares. */
type Estimated = {
  id: string;
  updated_at: string;
  units: number;
  row: TradeRow;
  meta: Record<string, unknown>;
};

async function estimatedTrades(
  ledger: LedgerPort,
  link: Link,
  commodity: string,
  since: string
): Promise<Estimated[]> {
  const holding = `${link.account}:${commodity}`;
  const page = await ledger.accountLedger(link.book_id, holding).catch(() => null);
  const out: Estimated[] = [];
  for (const r of page?.rows ?? []) {
    if (r.flag !== "!" || r.date < since) continue;
    const t = await ledger.transaction(link.book_id, r.id);
    const meta = (t.meta ?? {}) as Record<string, unknown>;
    if (typeof meta["brokerage-estimate"] !== "string") continue;
    const cashSide = t.postings.find((p) => p.account === cashAccountOf(link));
    const kind = meta["brokerage-trade"] === "sell" ? "sell" : "buy";
    out.push({
      id: t.id,
      updated_at: t.updated_at,
      units: Number(meta["brokerage-estimate"]),
      meta,
      row: {
        date: t.date,
        amount: cashSide?.units?.number ?? "0",
        description: t.narration ?? "",
        payee: t.payee ?? null,
        fingerprint: String(meta["import-id"] ?? ""),
        commodity,
        activity: { kind, security: commodity },
      },
    });
  }
  return out;
}

/**
 * Settle a brokerage's shares with the snapshot (see the top): record its prices, true up
 * recent estimates it explains, and stage what nothing explains once it's been seen on three
 * days. Returns how many transactions it staged or booked again.
 */
export async function settle(deps: SimplefinDeps, link: Link): Promise<number> {
  const { db, store } = deps;
  const snapshot = store.account(link.connection_id, link.account_id);
  if (!snapshot) return 0;
  const ledger = deps.ledgerFor(link.user_id);
  const book = link.book_id;
  const day = snapshotDay(deps, link, snapshot.balance_date);
  await recordPrices(deps, link);
  const bank = positions(snapshot.holdings);
  const books = await ledger.holdings(book, link.account);
  const held = new Map<string, Holding>(
    books.holdings.filter((h) => h.commodity !== snapshot.currency).map((h) => [h.commodity, h])
  );
  const waits = store.waits(link.id);
  let changed = 0;
  for (const commodity of new Set([...bank.keys(), ...held.keys()])) {
    const h = bank.get(commodity);
    const mine = held.get(commodity);
    const d = placesOf(h?.shares);
    const off = Number(fixed(Number(h?.shares ?? 0) - Number(mine?.units ?? 0), d));
    if (Math.abs(off) < 1e-6) {
      if (waits.has(commodity)) store.setWait(link.id, null, commodity);
      continue;
    }
    // Recent estimates the snapshot now explains: booked again with its shares.
    const recent = await estimatedTrades(ledger, link, commodity, shift(day, -7));
    const size = recent.reduce((n, t) => n + Math.abs(t.units), 0);
    if (recent.length && Math.abs(off) <= 0.25 * size) {
      let left = off;
      for (const [i, t] of recent.entries()) {
        const share =
          i === recent.length - 1 ? left : Number(fixed((off * Math.abs(t.units)) / size, d));
        left = Number(fixed(left - share, d));
        const units = t.units + share;
        const { "brokerage-estimate": _e, "brokerage-note": _n, ...meta } = t.meta;
        const again = await tradeOf(
          ledger,
          link,
          t.row,
          units,
          undefined,
          String(meta["import-batch"] ?? ""),
          null
        );
        if (!again) continue;
        // Booked again: the old one goes first, so a sale draws on the same lots.
        await ledger.applyChanges(
          book,
          { create: [], delete: [{ id: t.id, updated_at: t.updated_at }] },
          STAGING
        );
        const [made] = await ledger.createTransactions(
          book,
          [
            {
              ...again,
              meta: {
                ...meta,
                "brokerage-note": `Shares from the bank's holdings: ${unitsText(Math.abs(units))} ${commodity}.`,
              },
            },
          ],
          STAGING
        );
        db.repointRows(book, t.id, made!.id);
        changed += 1;
      }
      store.setWait(link.id, null, commodity);
      continue;
    }
    const wait = waits.get(commodity);
    const units = String(off);
    if (!wait || wait.units !== units) {
      store.setWait(link.id, { commodity, units, since: day }, commodity);
      continue;
    }
    if (wait.since > shift(day, -2)) continue;
    if (
      await stagePositionChange(
        deps,
        link,
        { commodity, bank: h, mine, day },
        `${off < 0 ? "Sold" : "Bought"} ${unitsText(Math.abs(off))} ${commodity}: the bank's holdings say so, and its activity doesn't`
      )
    )
      changed += 1;
    store.setWait(link.id, null, commodity);
  }
  return changed;
}

/** The opening a history's positions need, and what its trades did: fitted to today's
 * shares. */
export async function fitLink(deps: SimplefinDeps, link: Link, read: ReadRow[]): Promise<Fitted> {
  const snapshot = deps.store.account(link.connection_id, link.account_id)!;
  const guesses = await estimates(deps, link, snapshot, read);
  const bank = positions(snapshot.holdings);
  return fitHistory(
    guesses.map((g) => ({ key: g.row.fingerprint, commodity: g.row.commodity!, units: g.units })),
    new Map([...bank].map(([c, h]) => [c, Number(h.shares)])),
    new Map([...bank].map(([c, h]) => [c, placesOf(h.shares)]))
  );
}

/**
 * Open a brokerage's positions as they were before its history (`opensOn`), from what's fitted:
 * one lot each (estimated), at a cost worked out from the bank's average cost less what the
 * history's buys paid. Makes the positions' accounts it needs.
 */
export async function openPositions(
  deps: SimplefinDeps,
  link: Link,
  read: ReadRow[],
  fitted: Fitted,
  opensOn: string
): Promise<TransactionIn[]> {
  const snapshot = deps.store.account(link.connection_id, link.account_id)!;
  const ledger = deps.ledgerFor(link.user_id);
  const bank = positions(snapshot.holdings);
  const names = new Set(
    (await ledger.accounts(link.book_id)).filter((a) => !a.implicit).map((a) => a.name)
  );
  const out: TransactionIn[] = [];
  for (const [commodity, units] of fitted.opening) {
    const h = bank.get(commodity);
    const account = `${link.account}:${commodity}`;
    if (!names.has(account)) await ledger.createAccount(link.book_id, account, { open: opensOn });
    // What today's shares cost, less the history's buys still held, is the opening shares'.
    const total = h ? costOf(h) : undefined;
    const buys = read.filter(
      (r) => r.commodity === commodity && r.activity.kind !== "sell" && isTrade(r)
    );
    const bought = buys.reduce((n, r) => n + Math.max(0, fitted.units.get(r.fingerprint) ?? 0), 0);
    const paid = buys.reduce((n, r) => n + Math.abs(Number(r.amount)), 0);
    const remaining = Number(h?.shares ?? 0) - bought;
    const each = total !== undefined ? total / Number(h!.shares) : undefined;
    let perShare = each;
    if (total !== undefined && remaining > 0 && total - paid > 0) {
      const worked = (total - paid) / remaining;
      if (each && worked > each / 5 && worked < each * 5) perShare = worked;
    }
    const cost = perShare ?? (h ? priceOf(h) : undefined);
    if (cost === undefined) continue;
    out.push({
      date: opensOn,
      flag: "*",
      payee: null,
      narration: "Opening balance",
      links: [],
      meta: { source: "simplefin" },
      postings: [
        {
          account,
          units: { number: unitsText(units), currency: commodity },
          cost: {
            number: "0",
            total: fixed(units * cost, 2),
            currency: snapshot.currency,
            date: opensOn,
            label: "estimated",
          },
        },
        { account: OPENING_BALANCES, units: null },
      ],
    } as TransactionIn);
  }
  return out;
}

/** The bank's cash before its history: its cash today less what the rows did to it. */
export const openingCash = (reported: string, read: Pick<ReadRow, "activity" | "amount">[]) =>
  read.reduce((n, r) => add(n, negate(cashEffect(r))), reported);

/** What a brokerage link's reading makes of the bank's rows since its start: shown beside the
 * link ("14 sweeps left out, 3 dividends confirmed"). Null when its rows aren't read. */
export function activityOf(deps: SimplefinDeps, link: Link) {
  const snapshot = deps.store.account(link.connection_id, link.account_id);
  const reader = readerFor(snapshot?.institution);
  if (!snapshot || !reader || link.kind !== "brokerage") return null;
  const rows = rowsOf(
    deps.store.transactions(link.connection_id, link.account_id),
    deps.db.timeZone(link.book_id)
  ).filter((r) => r.date! >= link.starts_on);
  const read = readRows(reader, rows, snapshot);
  const count = (...kinds: string[]) => read.filter((r) => kinds.includes(r.activity.kind)).length;
  return {
    sweeps: count("sweep"),
    dividends: count("dividend"),
    trades: count("buy", "sell"),
    transfers_in: count("shares-in", "cash-in"),
    other: count("other"),
  };
}

/** Rows as they move a link's cash in the books: a read brokerage's sweeps and shares received
 * move none (reconcile.ts compares its cash with the bank's). */
export function cashRowsOf(
  deps: Pick<SimplefinDeps, "store" | "db">,
  link: Link,
  rows: Row[]
): Row[] {
  const snapshot = deps.store.account(link.connection_id, link.account_id);
  const reader = link.kind === "brokerage" ? readerFor(snapshot?.institution) : undefined;
  if (!snapshot || !reader) return rows;
  const read = readRows(reader, rows, snapshot);
  return rows.map((r, i) => ({ ...r, amount: cashEffect(read[i]!) }));
}
