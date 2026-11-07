/**
 * Funds on screen. `useFundRows` and `FundsFieldset` are a transaction's Funds section (its page,
 * New transaction, a schedule's template), as `useSplits` and `SplitsFieldset` are its splits;
 * `FundChips` shows lines on rows and cards; `FundChoice` is a review card's choice;
 * `MoveMoneyDialog` and `NewFundDialog` move money (and shares) and set a fund up from anywhere.
 *
 * Funds read a transaction per commodity (Funds B): one commodity reads as in Funds A; a trade
 * (one out, another in) has From fund and To fund, To following From; anything else, a group per
 * commodity. Nothing done here may leave a fund short of a share.
 */
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type SyntheticEvent,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { createPortal } from "react-dom";
import { Link } from "wouter";

import {
  fundName,
  isTrade,
  linesProblem,
  shapesOf,
  UNALLOCATED,
  wholeLines,
  type FundLine,
  type FundShape,
} from "../../shared/funds.js";
import {
  add,
  formatMoney,
  isDecimal,
  isMoney,
  isNegative,
  isZero,
  negate,
} from "../lib/decimal.js";
import { today } from "../lib/format.js";
import {
  amountsOf,
  belowZero,
  blankRow,
  effects,
  effectsInWords,
  fixed,
  holdingsOf,
  linesOf,
  mainSide,
  rowsFrom,
  rowsIn,
  rowsProblem,
  sameLines,
  sideOf,
  signedMoney,
  suggestedFund,
  verb,
  wholeFund,
  wholeSide,
  written,
  type FundRow,
  type Side,
} from "../lib/funds.js";
import type { Fund, Funds } from "../lib/ledger.js";
import { withBack } from "../lib/navigation.js";
import {
  explain,
  useCanManage,
  useCreateFund,
  useDeleteMove,
  useFunds,
  useMoveFunds,
  useMoveFundsBatch,
  usePatchMove,
  usePrices,
  useSetFundStar,
  useStarredFunds,
} from "../lib/queries.js";
import { BudgetBar, leftWords } from "./Budget.js";

type PostingLike = Parameters<typeof shapesOf>[0][number];

/** A transaction's shapes for funds (one per commodity), or null if its amounts don't read. */
export function shapesFor(
  postings: PostingLike[] | null,
  currency: string | undefined
): FundShape[] | null {
  if (!postings || !currency) return null;
  try {
    return shapesOf(postings, currency);
  } catch {
    return null; // an amount being typed that isn't one yet
  }
}

const unknownShape = (currency: string): FundShape => ({ kind: null, size: "0", currency });

const capitalized = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const money = (a: { number: string; currency: string }) => formatMoney(a.number, a.currency);

/** Rows that give one fund the whole of every commodity. */
const wholeRows = (shapes: FundShape[], fund: string): FundRow[] =>
  shapes.map((s) => ({ ...blankRow(mainSide(s), s.currency), fund }));

/**
 * A transaction's fund lines being edited. Starts from `saved` (read against `savedPostings`, so
 * a line that was all of its commodity keeps following it), and starts over when they change, as
 * the splits do. `postings` is the transaction as it stands (null while its splits don't read).
 * A sale that takes shares Unallocated doesn't have starts with the only fund that could have
 * made it (`suggested`), written only when it's saved.
 */
export function useFundRows(
  book: string,
  saved: FundLine[] | null | undefined,
  savedPostings: PostingLike[],
  postings: PostingLike[] | null,
  { date, isNew = false }: { date: string; isNew?: boolean }
) {
  const listing = useFunds(book).data;
  const currency = listing?.currency;
  const operating = currency ?? "USD";
  const savedShapes = useMemo(
    () => shapesFor(savedPostings, currency) ?? [],
    [savedPostings, currency]
  );
  const [rows, setRows] = useState(() => rowsFrom(saved, savedShapes, operating));
  useEffect(() => setRows(rowsFrom(saved, savedShapes, operating)), [saved, savedShapes]); // eslint-disable-line react-hooks/exhaustive-deps
  const shapes = shapesFor(postings, currency);
  const shapeIn = (c: string) => shapes?.find((s) => s.currency === c) ?? unknownShape(c);
  // Each commodity always has a row to choose a fund in: a transfer's lines may all be taken.
  const missing = (shapes ?? []).filter(
    (s) => s.kind && !rows.some((r) => r.currency === s.currency && sideOf(s, r) === mainSide(s))
  );
  const missingKey = missing.map((s) => s.currency).join(" ");
  useEffect(() => {
    if (missing.length)
      setRows((all) => [...missing.map((s) => blankRow(mainSide(s), s.currency)), ...all]);
  }, [missingKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const currencies = [
    ...new Set([...(shapes ?? []).map((s) => s.currency), ...rows.map((r) => r.currency)]),
  ];
  const lines = currencies.flatMap((c) => linesOf(rowsIn(rows, c), shapeIn(c)));
  const known = !!shapes && shapes.every((s) => s.kind);
  const rowsWrong = known
    ? (currencies.map((c) => rowsProblem(rowsIn(rows, c), shapeIn(c))).find(Boolean) ?? null)
    : null;
  const wrong = known ? (rowsWrong ?? linesProblem(shapes, lines, formatMoney)) : null;

  // What it does to each fund, and any it would take below zero.
  const defaults = listing?.defaults ?? [];
  const now = known && postings ? effects(postings, lines, defaults, date) : null;
  const before = useMemo(
    () => (isNew ? null : effects(savedPostings, saved ?? [], defaults, date)),
    [isNew, savedPostings, saved, defaults, date]
  );
  const holdings = useMemo(() => (listing ? holdingsOf(listing) : new Map()), [listing]);
  const below = listing && !wrong ? belowZero(now, before, holdings) : [];
  const shortOf = below.filter((b) => !isMoney(b.currency));
  const active = listing?.funds.filter((f) => !f.archived).map((f) => f.name) ?? [];
  const suggested = shortOf.length ? suggestedFund(shortOf, holdings, active) : null;
  // The suggestion is put in once, as if chosen: Save writes it.
  const suggestedOnce = useRef(false);
  useEffect(() => {
    if (!suggested || suggestedOnce.current || lines.length || !shapes) return;
    suggestedOnce.current = true;
    setRows(wholeRows(shapes, suggested));
  }, [suggested]); // eslint-disable-line react-hooks/exhaustive-deps
  const shareProblem = shortOf.length
    ? `${shortOf[0]!.fund} has ${formatMoney(shortOf[0]!.had, shortOf[0]!.currency)}, not ${formatMoney(shortOf[0]!.takes, shortOf[0]!.currency)}` +
      (shortOf[0]!.fund === UNALLOCATED ? ": say which fund's shares they are" : "")
    : null;
  const problem = wrong ?? shareProblem;
  return {
    rows,
    setRows,
    shapes,
    saved,
    lines,
    operating,
    /** What it does to each fund, Unallocated last (null until it reads). */
    effects: now,
    /** Funds it would take below zero: shares are a problem, money a note. */
    below,
    /** The only fund that could have made it, when it takes shares Unallocated doesn't have. */
    suggested,
    /** What's wrong with them, in a sentence. */
    problem: problem && capitalized(problem),
    /** Whether it takes a share a fund doesn't have: nothing by hand may (not Save, not Confirm). */
    short: shortOf.length > 0,
    /** Whether they differ from the saved ones (only then does the ledger check them). */
    changed: !sameLines(lines, saved),
    /** Whether the book's funds have loaded (the section waits for them). */
    ready: !!currency,
  };
}

export type FundRows = ReturnType<typeof useFundRows>;

/** Whether a transaction's Funds section is worth showing: the book has a fund to choose, or the
 * transaction has lines. */
export const fundsShown = (listing: Funds | undefined, saved: FundLine[] | null | undefined) =>
  !!saved?.length || !!listing?.funds.some((f) => !f.archived);

const NEW = "\u0000new";

/** A shape's sentence: "$1,000.00 coming in." */
function shapeWords(shape: FundShape, alone: boolean): ReactNode {
  const size = formatMoney(shape.size, shape.currency);
  if (shape.kind === "in")
    return alone ? (
      <>
        <strong>{size} coming in.</strong> Without a fund, it's Unallocated.
      </>
    ) : (
      <strong>{size} coming in.</strong>
    );
  if (shape.kind === "out")
    return alone ? (
      <>
        <strong>{size} going out.</strong> Without a fund, it comes from Unallocated.
      </>
    ) : (
      <strong>{size} going out.</strong>
    );
  return alone ? (
    <>
      <strong>{size} moving between accounts.</strong> No fund changes unless you set it aside.
    </>
  ) : (
    <strong>{size} moving between accounts.</strong>
  );
}

/**
 * The Funds section: one sentence about what the transaction does (money in, out, or moved), a
 * line per fund (To / From / For, a fund, its amount), "+ Another fund", and on a transfer "More
 * options" for funds it takes from. A trade has From fund and To fund instead (Split it for
 * parts); anything else in several commodities, a group per commodity. Below, always, what it
 * does to each fund, Unallocated included, or what's wrong, in red; and any fund it takes below
 * zero.
 */
export function FundsFieldset({
  book,
  funds,
  balanced,
  readOnly = false,
}: {
  book: string;
  funds: FundRows;
  /** Whether the splits balance (until they do, funds wait). */
  balanced: boolean;
  /** Read-only members see the lines without the controls. */
  readOnly?: boolean;
}) {
  const listing = useFunds(book).data;
  const canManage = useCanManage(book);
  const [creating, setCreating] = useState<{ key: number } | { side: "from" | "to" } | null>(null);
  const [split, setSplit] = useState(false);
  const { rows, setRows, shapes, lines, problem } = funds;
  if (!listing) return null;

  const active = listing.funds.filter((f) => !f.archived);
  const known = balanced && !!shapes && shapes.every((s) => s.kind);
  const moving = (shapes ?? []).filter((s) => !isZero(s.size));
  const editable = known && !readOnly && moving.length > 0;
  const trade = isTrade(shapes);
  const out = trade ? shapes!.find((s) => s.kind === "out")! : null;
  const into = trade ? shapes!.find((s) => s.kind === "in")! : null;
  const fromFund = out ? wholeSide(lines, out) : null;
  const toFund = into ? wholeSide(lines, into) : null;
  // A trade shows From and To while its lines are whole sides; else (or asked), its groups.
  const grouped = trade && (split || fromFund === null || toFund === null);

  const update = (key: number, change: Partial<FundRow>) =>
    setRows((all) => all.map((r) => (r.key === key ? { ...r, ...change } : r)));

  const lead = !balanced ? (
    "Choose funds once the splits balance."
  ) : !shapes ? (
    "Funds can't follow this one: its amounts don't read."
  ) : !moving.length ? (
    "Nothing comes in or goes out, so no fund changes."
  ) : trade && out && into ? (
    <>
      <strong>
        {out.currency === listing.currency
          ? `Bought ${formatMoney(into.size, into.currency)} for ${formatMoney(out.size, out.currency)}.`
          : `Sold ${formatMoney(out.size, out.currency)} for ${formatMoney(into.size, into.currency)}.`}
      </strong>{" "}
      Without a fund, it's Unallocated's: it gave the{" "}
      {out.currency === listing.currency ? "cash" : "shares"}, and it gets the{" "}
      {into.currency === listing.currency ? "cash" : "shares"}.
    </>
  ) : moving.length === 1 ? (
    shapeWords(moving[0]!, true)
  ) : (
    "It moves more than one thing: each has its own funds."
  );

  // A trade's From and To: each writes the whole of its side; To follows From until changed.
  const setSide = (shape: FundShape, fund: string) =>
    setRows((all) => [
      ...all.filter((r) => r.currency !== shape.currency),
      { ...blankRow(mainSide(shape), shape.currency), fund },
    ]);
  const chooseFrom = (fund: string) => {
    if (fund === NEW) return setCreating({ side: "from" });
    setSide(out!, fund);
    if (toFund === fromFund) setSide(into!, fund);
  };
  const chooseTo = (fund: string) => {
    if (fund === NEW) return setCreating({ side: "to" });
    setSide(into!, fund);
  };
  const fundOptions = (keep: string | null, empty: string) => (
    <>
      <option value="">{empty}</option>
      {active.map((f) => (
        <option key={f.name} value={f.name}>
          {f.name} · {money(f.value)}
        </option>
      ))}
      {keep && !active.some((f) => f.name === keep) && (
        <option value={keep}>
          {keep}
          {listing.funds.some((f) => f.name === keep) ? " (archived)" : ""}
        </option>
      )}
      {canManage && <option value={NEW}>New fund…</option>}
    </>
  );

  return (
    <fieldset className="postings funds-field">
      <legend>Funds</legend>
      <p className="funds-lead">{lead}</p>

      {editable && trade && !grouped && (
        <>
          <div className="fund-lines">
            <div className="fund-line">
              <span className="fund-verb">From</span>
              <select
                aria-label="From fund"
                value={fromFund ?? ""}
                onChange={(e) => chooseFrom(e.target.value)}
              >
                {fundOptions(fromFund, UNALLOCATED)}
              </select>
              <span className="small muted fund-gives">
                gives {formatMoney(out!.size, out!.currency)}
              </span>
            </div>
            <div className="fund-line">
              <span className="fund-verb">To</span>
              <select
                aria-label="To fund"
                value={toFund ?? ""}
                onChange={(e) => chooseTo(e.target.value)}
              >
                {fundOptions(toFund, UNALLOCATED)}
              </select>
              <span className="small muted fund-gives">
                gets {formatMoney(into!.size, into!.currency)}
              </span>
            </div>
          </div>
          {funds.suggested && fromFund === funds.suggested && !funds.saved?.length && (
            <p className="small muted">
              {funds.suggested} is the only fund with the shares it sells.
            </p>
          )}
          <button type="button" className="plain small fund-more" onClick={() => setSplit(true)}>
            Split it
          </button>
        </>
      )}

      {editable &&
        (!trade || grouped) &&
        moving.map((shape) => (
          <CommodityLines
            key={shape.currency}
            shape={shape}
            alone={moving.length === 1}
            rows={rows}
            setRows={setRows}
            update={update}
            active={active}
            listing={listing}
            canManage={canManage}
            onNew={(key) => setCreating({ key })}
          />
        ))}

      {!editable && lines.length > 0 && (
        <ul className="fund-read">
          {lines.map((l) => {
            const shape = shapes?.find((s) => s.currency === l.amount.currency);
            return (
              <li key={`${l.fund} ${l.amount.currency}`}>
                <span>
                  {shape
                    ? verb(shape, isNegative(l.amount.number) ? "from" : "into")
                    : isNegative(l.amount.number)
                      ? "From"
                      : "To"}{" "}
                  {l.fund}
                </span>
                <span className="num">{signedMoney(l.amount.number, l.amount.currency)}</span>
              </li>
            );
          })}
        </ul>
      )}

      {known && (
        <p className={`funds-summary small${problem ? " error" : ""}`} aria-live="polite">
          {!problem
            ? effectsInWords(funds.effects, listing.currency)
            : funds.changed || funds.short
              ? problem
              : // Saved before the transaction changed (lines are checked only when they do).
                `As saved, its funds don't fit: ${problem.charAt(0).toLowerCase()}${problem.slice(1)}. Change them, or save the rest as it is.`}
        </p>
      )}
      {known &&
        !problem &&
        funds.below
          .filter((b) => isMoney(b.currency))
          .map((b) => (
            <p key={`${b.fund} ${b.currency}`} className="small warning">
              {b.fund} will be at {formatMoney(b.number, b.currency)}.
            </p>
          ))}

      {creating !== null && (
        <NewFundDialog
          book={book}
          listing={listing}
          onCreated={(fund) => {
            const at = creating;
            setCreating(null);
            if ("key" in at) update(at.key, { fund: fund.name });
            else if (at.side === "from") chooseFrom(fund.name);
            else chooseTo(fund.name);
          }}
          onCancel={() => setCreating(null)}
        />
      )}
    </fieldset>
  );
}

/** One commodity's lines, as Funds A has them: a line per fund, "+ Another fund", and on a
 * transfer "More options" for funds it takes from. */
function CommodityLines({
  shape,
  alone,
  rows: all,
  setRows,
  update,
  active,
  listing,
  canManage,
  onNew,
}: {
  shape: FundShape;
  /** The only commodity it moves (no heading of its own). */
  alone: boolean;
  rows: FundRow[];
  setRows: FundRows["setRows"];
  update: (key: number, change: Partial<FundRow>) => void;
  active: Funds["funds"];
  listing: Funds;
  canManage: boolean;
  onNew: (key: number) => void;
}) {
  const rows = rowsIn(all, shape.currency);
  const amounts = amountsOf(rows, shape);
  const main = mainSide(shape);
  const mainRows = rows.filter((r) => sideOf(shape, r) === main);
  const takeRows = shape.kind === "transfer" ? rows.filter((r) => r.side === "from") : [];
  const placeholder = isMoney(shape.currency) ? "0.00" : "0";

  const remove = (row: FundRow) =>
    setRows((everything) => {
      const left = everything.filter((r) => r.key !== row.key);
      // The main list keeps a row to choose in.
      return left.some((r) => r.currency === shape.currency && sideOf(shape, r) === main)
        ? left
        : [blankRow(main, shape.currency), ...left];
    });
  const choose = (row: FundRow, fund: string) => {
    if (fund === NEW) return onNew(row.key);
    // The first line with a fund on its side follows the transaction until an amount's typed.
    const side = sideOf(shape, row);
    const leader = !rows.some((r) => r !== row && r.fund && sideOf(shape, r) === side && r.follows);
    update(row.key, { fund, follows: row.follows || (leader && !row.amount.trim()) });
  };
  const another = (side: Side) => {
    const mine = rows.filter((r) => sideOf(shape, r) === side);
    const taken = mine.reduce((sum, r) => {
      const a = amounts.get(r.key) ?? "";
      return r.fund && isDecimal(a) ? add(sum, a) : sum;
    }, "0");
    const left = add(shape.size, negate(taken));
    setRows((everything) => [
      ...everything,
      {
        ...blankRow(side, shape.currency, false),
        amount: isNegative(left) || isZero(left) ? "" : written(left, shape.currency),
      },
    ]);
  };

  const line = (row: FundRow, side: Side, only: boolean) => {
    const label = verb(shape, side);
    const own = row.fund && !active.some((f) => f.name === row.fund);
    const used = new Set(rows.filter((r) => r !== row && r.fund).map((r) => r.fund));
    const shown = row.follows && row.fund ? (amounts.get(row.key) ?? "") : row.amount;
    // The row to choose a first fund in has nothing to remove or type until it has one.
    const bare = !row.fund && row.follows && only;
    return (
      <div className={`fund-line${isMoney(shape.currency) ? "" : " shares"}`} key={row.key}>
        <span className="fund-verb">{label}</span>
        <select
          aria-label={`${label} fund${alone ? "" : ` (${shape.currency})`}`}
          value={row.fund}
          onChange={(e) => choose(row, e.target.value)}
        >
          <option value="">
            {side === "from" && shape.kind === "transfer"
              ? "Choose a fund"
              : shape.kind === "transfer"
                ? "No fund"
                : UNALLOCATED}
          </option>
          {active.map((f) => (
            <option key={f.name} value={f.name} disabled={used.has(f.name)}>
              {f.name} · {money(f.value)}
            </option>
          ))}
          {own && (
            <option value={row.fund}>
              {row.fund}
              {/* (One just made isn't listed until the funds are fetched again.) */}
              {listing.funds.some((f) => f.name === row.fund) ? " (archived)" : ""}
            </option>
          )}
          {canManage && <option value={NEW}>New fund…</option>}
        </select>
        {!bare && (
          <>
            <input
              aria-label={`Amount ${label.toLowerCase()} ${row.fund || "the fund"}`}
              inputMode="decimal"
              placeholder={placeholder}
              title={
                row.follows && row.fund
                  ? "Follows the transaction until you type an amount"
                  : undefined
              }
              value={shown}
              onChange={(e) => update(row.key, { amount: e.target.value, follows: false })}
            />
            {!isMoney(shape.currency) && <span className="small muted">{shape.currency}</span>}
            <button
              type="button"
              className="icon"
              aria-label={`Remove ${row.fund || "this line"}`}
              onClick={() => remove(row)}
            >
              ×
            </button>
          </>
        )}
      </div>
    );
  };

  const canAdd = (list: FundRow[]) =>
    list.every((r) => r.fund) && active.some((f) => !rows.some((r) => r.fund === f.name));

  return (
    <div className="fund-commodity" role="group" aria-label={alone ? undefined : shape.currency}>
      {!alone && <p className="small">{shapeWords(shape, false)}</p>}
      <div className="fund-lines">{mainRows.map((r) => line(r, main, mainRows.length === 1))}</div>
      {canAdd(mainRows) && (
        <button type="button" className="plain fund-add" onClick={() => another(main)}>
          + Another fund
        </button>
      )}
      {shape.kind === "transfer" &&
        (takeRows.length ? (
          <div className="fund-take" role="group" aria-label="Take from">
            <p className="small muted">
              <strong>Take from</strong> a fund too: what it gives goes to the funds above, or back
              to Unallocated.
            </p>
            <div className="fund-lines">{takeRows.map((r) => line(r, "from", false))}</div>
            {canAdd(takeRows) && (
              <button type="button" className="plain fund-add" onClick={() => another("from")}>
                + Another fund
              </button>
            )}
          </div>
        ) : (
          <button
            type="button"
            className="plain small fund-more"
            onClick={() =>
              setRows((everything) => [...everything, blankRow("from", shape.currency)])
            }
          >
            More options
          </button>
        ))}
    </div>
  );
}

/** A transaction's lines as chips, one per fund: "to Emergency", "from Wedding" (long names cut
 * short), or just "Emergency" for a fund on both sides of a trade; the lines in the title. */
export function FundChips({ lines }: { lines?: FundLine[] | null }) {
  if (!lines?.length) return null;
  const funds = [...new Set(lines.map((l) => l.fund))];
  return (
    <span className="tags fund-chips" aria-label="Funds">
      {funds.map((fund) => {
        const mine = lines.filter((l) => l.fund === fund);
        const outs = mine.some((l) => isNegative(l.amount.number));
        const ins = mine.some((l) => !isNegative(l.amount.number));
        const way = outs && ins ? "" : outs ? "from" : "to";
        return (
          <span
            key={fund}
            className={`tag fund-chip ${way === "from" ? "out" : way === "to" ? "in" : "both"}`}
            title={`${fund} ${mine.map((l) => signedMoney(l.amount.number, l.amount.currency)).join(" and ")}`}
            aria-label={way ? `${way} ${fund}` : fund}
          >
            {way && `${way} `}
            <span className="fund-chip-name">{fund}</span>
          </span>
        );
      })}
    </span>
  );
}

/**
 * A review card's fund: "From fund / To fund / For fund" (by its kind) and a select, or for a
 * trade From fund and To fund (To following From). Choosing one puts all of it there; Unallocated
 * clears it. Lines that are split, partial, or taken from on a transfer show as chips with Edit…
 * (its page). Only when the book has funds. `suggested` (a sale that takes shares Unallocated
 * doesn't have) is shown as chosen until something is.
 */
export function FundChoice({
  book,
  transaction: t,
  here,
  disabled,
  suggested,
  onChange,
}: {
  book: string;
  transaction: { id: string; postings: PostingLike[]; funds?: FundLine[] | null };
  /** Where Edit… comes back to. */
  here: string;
  disabled?: boolean;
  suggested?: string | null;
  onChange: (lines: FundLine[]) => void;
}) {
  const listing = useFunds(book).data;
  if (!listing) return null;
  const active = listing.funds.filter((f) => !f.archived);
  const shapes = shapesFor(t.postings, listing.currency);
  const lines = t.funds ?? [];
  const chips = (
    <p className="fund-choice small">
      <FundChips lines={lines} />{" "}
      <Link href={withBack(`/books/${book}/transactions/${t.id}`, here)}>Edit…</Link>
    </p>
  );
  const moving = (shapes ?? []).filter((s) => !isZero(s.size));
  if (!active.length || !shapes || !moving.length || shapes.some((s) => !s.kind))
    return lines.length ? chips : null;
  const options = (value: string, empty: string) => (
    <>
      <option value="">{empty}</option>
      {active.map((f) => (
        <option key={f.name} value={f.name}>
          {f.name}
          {!lines.length && f.name === suggested ? " (suggested)" : ""}
        </option>
      ))}
      {value && !active.some((f) => f.name === value) && (
        <option value={value}>{value} (archived)</option>
      )}
    </>
  );

  if (isTrade(shapes)) {
    const out = shapes.find((s) => s.kind === "out")!;
    const into = shapes.find((s) => s.kind === "in")!;
    const from = wholeSide(lines, out);
    const to = wholeSide(lines, into);
    if (from === null || to === null) return chips;
    const shownFrom = from || (!lines.length && suggested) || "";
    const shownTo = to || (!lines.length && suggested) || "";
    const write = (fromFund: string, toFund: string) =>
      onChange([
        ...(fromFund ? wholeLines([out], fromFund) : []),
        ...(toFund ? wholeLines([into], toFund) : []),
      ]);
    return (
      <span className="fund-choice small fund-trade">
        <label>
          From fund{" "}
          <select
            aria-label="From fund"
            value={shownFrom}
            disabled={disabled}
            onChange={(e) => write(e.target.value, to === from || !to ? e.target.value : to)}
          >
            {options(shownFrom, UNALLOCATED)}
          </select>
        </label>{" "}
        <label>
          To fund{" "}
          <select
            aria-label="To fund"
            value={shownTo}
            disabled={disabled}
            onChange={(e) => write(from || "", e.target.value)}
          >
            {options(shownTo, UNALLOCATED)}
          </select>
        </label>
      </span>
    );
  }

  const whole = wholeFund(lines, shapes);
  if (whole === null) return chips;
  const shape = moving[0]!;
  const shown = whole || (!lines.length && suggested) || "";
  const label =
    moving.length > 1
      ? "Fund"
      : shape.kind === "in"
        ? "To fund"
        : shape.kind === "out"
          ? "From fund"
          : "For fund";
  return (
    <label className="fund-choice small">
      {label}{" "}
      <select
        aria-label={label}
        value={shown}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value ? wholeLines(shapes, e.target.value) : [])}
      >
        {options(shown, shape.kind === "transfer" && moving.length === 1 ? "No fund" : UNALLOCATED)}
      </select>
    </label>
  );
}

/** Events inside a dialog don't reach what it was opened from (a portal still bubbles through
 * React's tree): a tap here isn't a swipe, and its form isn't the page's. */
const contain = (e: SyntheticEvent) => e.stopPropagation();

/** A dialog over everything: full screen on phones, centered on anything wider. */
export function Dialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const titleId = useId();
  return createPortal(
    <div
      className="dialog-backdrop"
      onPointerDown={contain}
      onPointerMove={contain}
      onPointerUp={contain}
      onClick={contain}
      onKeyDown={(e) => {
        contain(e);
        if (e.key === "Escape") onClose();
      }}
    >
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <h2 id={titleId}>{title}</h2>
        {children}
      </div>
    </div>,
    document.body
  );
}

/** A form in a dialog: submitting it never submits the page's form around the dialog's opener. */
export function DialogForm({
  onSubmit,
  children,
  label,
}: {
  onSubmit: () => void;
  children: ReactNode;
  label?: string;
}) {
  return (
    <form
      className="editor"
      aria-label={label}
      onSubmit={(e) => {
        e.preventDefault();
        // React carries a portal's events up its own tree: without this, the form the dialog
        // was opened from (a transaction's editor) would be submitted too.
        e.stopPropagation();
        onSubmit();
      }}
    >
      {children}
    </form>
  );
}

/** An amount as typed ("$2,500"), as a number the ledger takes, or null if it isn't a positive
 * one. Money is written with its cents; shares as typed. */
export function typedAmount(text: string, currency = "USD"): string | null {
  const clean = text.replace(/[$,\s]/g, "");
  return isDecimal(clean) && !isNegative(clean) && !isZero(clean) ? written(clean, currency) : null;
}

/** A fund's name and balance, as pickers show them: "Emergency · $12,000.00". */
const withBalance = (name: string, value: { number: string; currency: string }) =>
  `${name} · ${money(value)}`;

/** A day as the dialogs show it: "Nov 3". */
const shortDay = (date: string) =>
  new Date(`${date}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });

type AmountRow = { key: number; amount: string; currency: string; inDollars: boolean };
let nextAmount = 0;
const amountRow = (currency: string): AmountRow => ({
  key: nextAmount++,
  amount: "",
  currency,
  inDollars: false,
});

/** What a fund (or Unallocated) holds, by commodity, from the funds list. */
const heldBy = (listing: Funds | undefined, name: string) =>
  name === UNALLOCATED
    ? (listing?.unallocated_holdings ?? [])
    : (listing?.funds.find((f) => f.name === name)?.holdings ?? []);

/** One of Move money's amounts: what it moves, in shares (its value beside) or in dollars (what
 * that comes to in shares, at the price on the move's date). */
function MoveAmount({
  book,
  row,
  date,
  operating,
  commodities,
  places,
  removable,
  onChange,
  onRemove,
}: {
  book: string;
  row: AmountRow;
  date: string;
  operating: string;
  commodities: string[];
  places: number;
  removable: boolean;
  onChange: (change: Partial<AmountRow>) => void;
  onRemove: () => void;
}) {
  const share = row.currency !== operating;
  const prices = usePrices(book, share ? row.currency : "", share);
  const price = prices.data?.find((p) => p.date <= date && p.price.currency === operating);
  const typed = row.amount.replace(/[$,\s]/g, "");
  const number = isDecimal(typed) ? Number(typed) : NaN;
  const hint =
    !share || !price || !Number.isFinite(number) || !number
      ? null
      : row.inDollars
        ? `${formatMoney(fixed(typed), operating)} is ${(number / Number(price.price.number)).toFixed(places).replace(/\.?0+$/, "")} ${row.currency} at ${formatMoney(price.price.number, operating)} (${shortDay(price.date)})`
        : `about ${formatMoney((number * Number(price.price.number)).toFixed(2), operating)} at ${formatMoney(price.price.number, operating)} (${shortDay(price.date)})`;
  return (
    <div className="move-amount">
      <div className="move-top">
        <input
          aria-label={`Amount${commodities.length > 1 ? ` of ${share ? row.currency : "Cash"}` : ""}`}
          inputMode="decimal"
          value={row.amount}
          placeholder={!share || row.inDollars ? "0.00" : "0"}
          autoFocus={row.key === 0}
          onChange={(e) => onChange({ amount: e.target.value })}
        />
        {commodities.length > 1 && (
          <select
            aria-label="Of"
            value={row.currency}
            onChange={(e) => onChange({ currency: e.target.value, inDollars: false })}
          >
            {commodities.map((c) => (
              <option key={c} value={c}>
                {c === operating ? "Cash" : c}
              </option>
            ))}
          </select>
        )}
        {removable && (
          <button type="button" className="icon" aria-label="Remove this amount" onClick={onRemove}>
            ×
          </button>
        )}
      </div>
      {share && (
        <span className="segmented" role="group" aria-label={`${row.currency} in`}>
          <button
            type="button"
            aria-pressed={!row.inDollars}
            onClick={() => onChange({ inDollars: false })}
          >
            Shares
          </button>
          <button
            type="button"
            aria-pressed={row.inDollars}
            disabled={!price}
            title={price ? undefined : `${row.currency} has no price on or before ${date}`}
            onClick={() => onChange({ inDollars: true })}
          >
            Dollars
          </button>
        </span>
      )}
      {hint && <p className="small muted">{hint}</p>}
    </div>
  );
}

/** A row's amount in the commodity's own units, as the ledger takes it (null: not one yet). */
function unitsOf(
  row: AmountRow,
  operating: string,
  places: number,
  price: string | undefined
): string | null {
  const typed = typedAmount(row.amount, row.currency === operating ? operating : "USD");
  if (!typed) return null;
  if (row.currency === operating) return typed;
  if (!row.inDollars) return typedAmount(row.amount, row.currency);
  if (!price) return null;
  const shares = (Number(typed) / Number(price)).toFixed(places).replace(/\.?0+$/, "");
  return shares && Number(shares) > 0 ? shares : null;
}

/**
 * Move money (or shares) between funds (either can be Unallocated): from, to, one or more
 * amounts (each of a commodity: in shares or in dollars), date (today) and a note, with what it
 * does spelled out. A share can't be moved from a fund that doesn't have it. Editing a move
 * changes its one amount, and offers Delete.
 */
export function MoveMoneyDialog({
  book,
  start = {},
  move,
  onClose,
}: {
  book: string;
  /** Where it starts from, or goes to. */
  start?: { from?: string; to?: string };
  /** A move to change. */
  move?: {
    id: string;
    from_fund: string;
    to_fund: string;
    amount: { number: string; currency: string };
    date: string;
    note?: string | null;
    updated_at: string;
  };
  onClose: () => void;
}) {
  const listing = useFunds(book).data;
  const create = useMoveFunds(book);
  const createMany = useMoveFundsBatch(book);
  const patch = usePatchMove(book);
  const remove = useDeleteMove(book);
  const active = listing?.funds.filter((f) => !f.archived) ?? [];
  const operating = listing?.currency ?? move?.amount.currency ?? "USD";
  const first = (not: string) =>
    [UNALLOCATED, ...active.map((f) => f.name)].find((n) => n !== not) ?? "";
  const initialFrom = move?.from_fund ?? start.from ?? UNALLOCATED;
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(move?.to_fund ?? start.to ?? first(initialFrom));
  const [rows, setRows] = useState<AmountRow[]>(() => [
    move
      ? { ...amountRow(move.amount.currency), amount: move.amount.number }
      : { ...amountRow(operating), key: 0 },
  ]);
  const [date, setDate] = useState(move?.date ?? today());
  const [note, setNote] = useState(move?.note ?? "");
  const [error, setError] = useState<string | null>(null);
  const busy = create.isPending || createMany.isPending || patch.isPending || remove.isPending;
  // Prices for dollars typed in, on the move's date (the latest on or before it).
  const client = useQueryClient();
  const priceOf = (c: string) =>
    client
      .getQueryData<{ date: string; price: { number: string; currency: string } }[]>([
        "book",
        book,
        "prices",
        c,
      ])
      ?.find((p) => p.date <= date && p.price.currency === operating)?.price.number;

  // What the From side holds: its shares can be moved; and what's been chosen already.
  const fromHolds = heldBy(listing, from);
  const commodities = [
    ...new Set([
      operating,
      ...fromHolds
        .filter((h) => h.amount.currency !== operating && !isNegative(h.amount.number))
        .map((h) => h.amount.currency)
        .sort(),
      ...rows.map((r) => r.currency),
    ]),
  ];
  // Dollars become shares rounded to the places the book writes them in (at least three).
  const placesOf = (c: string) =>
    Math.min(
      6,
      Math.max(
        3,
        ...(listing
          ? [...listing.funds.flatMap((f) => f.holdings), ...(listing.unallocated_holdings ?? [])]
          : []
        )
          .filter((h) => h.amount.currency === c)
          .map((h) => h.amount.number.split(".")[1]?.length ?? 0)
      )
    );
  const amounts = rows.map((r) => ({
    row: r,
    units: unitsOf(r, operating, placesOf(r.currency), priceOf(r.currency)),
  }));

  const balanceOf = (name: string) =>
    name === UNALLOCATED
      ? listing?.unallocated
      : listing?.funds.find((f) => f.name === name)?.value;
  const options = (keep: string) => {
    const names = [UNALLOCATED, ...active.map((f) => f.name)];
    if (keep && !names.includes(keep)) names.push(keep);
    return names.map((n) => {
      const value = balanceOf(n);
      return (
        <option key={n} value={n}>
          {value ? withBalance(n, value) : n}
          {n !== UNALLOCATED && !active.some((f) => f.name === n) ? " (archived)" : ""}
        </option>
      );
    });
  };
  // A share From doesn't have enough of (counting what this move took, when changing one).
  const short = amounts.find(({ row, units }) => {
    if (!units || row.currency === operating) return false;
    const holds = fromHolds.find((h) => h.amount.currency === row.currency)?.amount.number ?? "0";
    const back =
      move && move.from_fund === from && move.amount.currency === row.currency
        ? move.amount.number
        : "0";
    return isNegative(add(add(holds, back), negate(units)));
  });
  const typedSome = rows.some((r) => r.amount.trim());
  const problem =
    from === to
      ? "Choose two different funds"
      : typedSome && amounts.some(({ row, units }) => row.amount.trim() && !units)
        ? "An amount is a number more than 0, like 2500.00"
        : short
          ? `${from} has ${formatMoney(
              add(
                fromHolds.find((h) => h.amount.currency === short.row.currency)?.amount.number ??
                  "0",
                move && move.from_fund === from && move.amount.currency === short.row.currency
                  ? move.amount.number
                  : "0"
              ),
              short.row.currency
            )}`
          : new Set(rows.map((r) => r.currency)).size !== rows.length
            ? "Each amount is of something different"
            : null;
  const ready = amounts.filter((a) => a.units);
  const effect = ready.length
    ? `${from} ${ready.map((a) => signedMoney(negate(a.units!), a.row.currency)).join(" and ")} → ${to} ${ready.map((a) => signedMoney(a.units!, a.row.currency)).join(" and ")}`
    : null;

  const submit = async () => {
    if (!ready.length || ready.length !== rows.length || problem || busy) return;
    setError(null);
    const body = (a: (typeof ready)[number]) => ({
      date,
      from_fund: from,
      to_fund: to,
      amount: { number: a.units!, currency: a.row.currency },
      note: note.trim() || null,
    });
    try {
      if (move)
        await patch.mutateAsync({
          id: move.id,
          patch: { ...body(ready[0]!), updated_at: move.updated_at },
        });
      else if (ready.length === 1) await create.mutateAsync(body(ready[0]!));
      else await createMany.mutateAsync(ready.map(body));
      onClose();
    } catch (e) {
      setError(explain(e));
    }
  };

  const left = commodities.filter((c) => !rows.some((r) => r.currency === c));
  return (
    <Dialog title={move ? "Change the move" : "Move money"} onClose={onClose}>
      <DialogForm onSubmit={() => void submit()} label="Move money">
        <label>
          From
          <select value={from} onChange={(e) => setFrom(e.target.value)}>
            {options(from)}
          </select>
        </label>
        <label>
          To
          <select value={to} onChange={(e) => setTo(e.target.value)}>
            {options(to)}
          </select>
        </label>
        <fieldset className="move-amounts">
          <legend>Amount</legend>
          {rows.map((r) => (
            <MoveAmount
              key={r.key}
              book={book}
              row={r}
              date={date}
              operating={operating}
              commodities={move ? [r.currency] : commodities}
              places={placesOf(r.currency)}
              removable={rows.length > 1}
              onChange={(change) =>
                setRows((all) => all.map((x) => (x.key === r.key ? { ...x, ...change } : x)))
              }
              onRemove={() => setRows((all) => all.filter((x) => x.key !== r.key))}
            />
          ))}
          {!move && left.length > 0 && (
            <button
              type="button"
              className="plain fund-add"
              onClick={() => setRows((all) => [...all, amountRow(left[0]!)])}
            >
              + Another amount
            </button>
          )}
        </fieldset>
        <label>
          Date
          <input type="date" value={date} required onChange={(e) => setDate(e.target.value)} />
        </label>
        <label>
          <span>
            Note <span className="muted small">(optional)</span>
          </span>
          <input value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />
        </label>
        <p className={`small${problem ? " error" : " muted"}`} aria-live="polite">
          {problem ?? effect ?? "No account changes: only what the money is for."}
        </p>
        {error && <p className="error">{error}</p>}
        <div className="actions">
          {move && (
            <button
              type="button"
              className="danger"
              disabled={busy}
              onClick={async () => {
                if (!window.confirm("Delete this move?")) return;
                try {
                  await remove.mutateAsync({ id: move.id, updated_at: move.updated_at });
                  onClose();
                } catch (e) {
                  setError(explain(e));
                }
              }}
            >
              Delete
            </button>
          )}
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="primary"
            disabled={!ready.length || ready.length !== rows.length || !!problem || busy}
          >
            {move ? "Save" : "Move"}
          </button>
        </div>
      </DialogForm>
    </Dialog>
  );
}

/** What's wrong with a fund's name, given the book's funds (`keep`: its own, when renaming). */
export function nameProblem(
  name: string,
  listing: Funds | undefined,
  keep?: string
): string | null {
  const checked = fundName(name);
  if ("problem" in checked) return capitalized(checked.problem);
  const taken = listing?.funds.find(
    (f) => f.name.toLowerCase() === checked.name.toLowerCase() && f.name !== keep
  );
  return taken ? `There's a fund called ${taken.name} already` : null;
}

/** What's wrong with a target as typed (blank is none). */
export const targetProblem = (target: string) =>
  target.trim() && !typedAmount(target) ? "A target is an amount more than 0, like 20000.00" : null;

/** A new fund: its name, and optionally a description and a target. It's starred for whoever
 * made it (on their home page), as an account added is. */
export function NewFundDialog({
  book,
  listing,
  onCreated,
  onCancel,
}: {
  book: string;
  listing: Funds | undefined;
  onCreated: (fund: Fund) => void;
  onCancel: () => void;
}) {
  const create = useCreateFund(book);
  const star = useSetFundStar(book);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [target, setTarget] = useState("");
  const [error, setError] = useState<string | null>(null);
  const problem = (name.trim() && nameProblem(name, listing)) || targetProblem(target);
  const ready = !!name.trim() && !problem;

  const submit = async () => {
    if (!ready || create.isPending) return;
    setError(null);
    const number = typedAmount(target);
    try {
      const created = await create.mutateAsync({
        name,
        description: description.trim() || null,
        target: number ? { number, currency: listing?.currency ?? "USD" } : null,
      });
      await star.mutateAsync({ fund: created.name, starred: true }).catch(() => undefined);
      onCreated(created);
    } catch (e) {
      setError(explain(e));
    }
  };

  return (
    <Dialog title="New fund" onClose={onCancel}>
      <DialogForm onSubmit={() => void submit()} label="New fund">
        <label>
          Name
          <input
            value={name}
            maxLength={60}
            autoFocus
            placeholder="e.g. Emergency"
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label>
          <span>
            Description <span className="muted small">(optional)</span>
          </span>
          <input
            value={description}
            maxLength={200}
            placeholder="e.g. Three months of expenses"
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <label>
          <span>
            Target <span className="muted small">(optional: shown as progress)</span>
          </span>
          <input
            inputMode="decimal"
            value={target}
            placeholder="0.00"
            onChange={(e) => setTarget(e.target.value)}
          />
        </label>
        {problem && <p className="small error">{problem}</p>}
        {error && <p className="error">{error}</p>}
        <div className="actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={!ready || create.isPending}>
            Create
          </button>
        </div>
      </DialogForm>
    </Dialog>
  );
}

/** What a fund (or Unallocated) holds, when that's more than money: "$4,000.00 · 100 FXAIX".
 * A holding below zero is red. */
export function HoldingsLine({
  holdings,
  currency,
}: {
  holdings?: { amount: { number: string; currency: string } }[];
  currency: string;
}) {
  if (!holdings?.some((h) => h.amount.currency !== currency)) return null;
  return (
    <p className="small muted fund-holdings">
      {holdings.map((h, i) => (
        <span key={h.amount.currency}>
          {i > 0 && " · "}
          <span className={isNegative(h.amount.number) ? "negative" : undefined}>
            {money(h.amount)}
          </span>
        </span>
      ))}
    </p>
  );
}

/** A fund's progress toward its target: the filled line, and what's to go (display only:
 * nothing fills a fund by itself). */
export function TargetProgress({ fund }: { fund: Fund }) {
  if (!fund.target) return null;
  const left = { ...fund.target, number: add(fund.target.number, negate(fund.value.number)) };
  return (
    <div className="fund-target">
      <BudgetBar
        kind="goal"
        budget={fund.target}
        spent={fund.value}
        label={`${fund.name}'s target`}
      />
      <span className="small muted">
        {leftWords("goal", left)} · target {money(fund.target)}
      </span>
    </div>
  );
}

/** Home's Funds card: the funds the user starred (only when there are any), each with its
 * balance (and progress, with a target), and All funds ›. */
export function FundsCard({ book }: { book: string }) {
  const { funds } = useStarredFunds(book);
  if (!funds?.length) return null;
  const all = `/books/${book}/funds`;
  return (
    <section className="card funds-home" aria-label="Funds">
      <h2 className="section-title">Funds</h2>
      <ul className="fund-list">
        {funds.map((f) => (
          <li key={f.name}>
            <Link href={`${all}/${encodeURIComponent(f.name)}`} className="fund-row">
              <span className="fund-row-top">
                <span className="fund-name">{f.name}</span>
                <span className={`num${isNegative(f.value.number) ? " negative" : ""}`}>
                  {money(f.value)}
                </span>
              </span>
              {f.target && (
                <BudgetBar
                  kind="goal"
                  budget={f.target}
                  spent={f.value}
                  label={`${f.name}'s target`}
                />
              )}
            </Link>
          </li>
        ))}
      </ul>
      <p className="small fund-all">
        <Link href={all}>All funds ›</Link>
      </p>
    </section>
  );
}
