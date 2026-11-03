/**
 * Funds (Funds A) on screen. `useFundRows` and `FundsFieldset` are a transaction's Funds section
 * (its page, New transaction, a schedule's template), as `useSplits` and `SplitsFieldset` are its
 * splits; `FundChips` shows lines on rows and cards; `FundChoice` is a review card's one select;
 * `MoveMoneyDialog` and `NewFundDialog` move money and set a fund up from anywhere.
 */
import { useEffect, useId, useMemo, useState, type ReactNode, type SyntheticEvent } from "react";
import { createPortal } from "react-dom";
import { Link } from "wouter";

import {
  fundName,
  linesProblem,
  shapeOf,
  UNALLOCATED,
  wholeLine,
  type FundLine,
  type FundShape,
} from "../../shared/funds.js";
import { add, formatMoney, isDecimal, isNegative, isZero, negate } from "../lib/decimal.js";
import { today } from "../lib/format.js";
import {
  amountsOf,
  belowZero,
  blankRow,
  effectsInWords,
  fixed,
  linesOf,
  mainSide,
  rowsFrom,
  rowsProblem,
  sameLines,
  sideOf,
  signedMoney,
  verb,
  wholeFund,
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
  usePatchMove,
} from "../lib/queries.js";
import { BudgetBar, leftWords } from "./Budget.js";

type PostingLike = Parameters<typeof shapeOf>[0][number];

/** A transaction's shape for funds, or not worked out (kind null) if its amounts don't read. */
export function shapeFor(postings: PostingLike[] | null, currency: string | undefined): FundShape {
  const unknown: FundShape = { kind: null, size: "0", currency: currency ?? "USD" };
  if (!postings || !currency) return unknown;
  try {
    return shapeOf(postings, currency);
  } catch {
    return unknown; // an amount being typed that isn't one yet
  }
}

const capitalized = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const money = (a: { number: string; currency: string }) => formatMoney(a.number, a.currency);

/**
 * A transaction's fund lines being edited. Starts from `saved` (read against `savedPostings`, so
 * a line that was all of it keeps following it), and starts over when they change, as the splits
 * do. `postings` is the transaction as it stands (null while its splits don't read).
 */
export function useFundRows(
  saved: FundLine[] | null | undefined,
  savedPostings: PostingLike[],
  postings: PostingLike[] | null,
  currency: string | undefined
) {
  const savedShape = useMemo(() => shapeFor(savedPostings, currency), [savedPostings, currency]);
  const [rows, setRows] = useState(() => rowsFrom(saved, savedShape));
  useEffect(() => setRows(rowsFrom(saved, savedShape)), [saved, savedShape]);
  const shape = shapeFor(postings, currency);
  // There's always a row to choose a fund in: a transfer's lines may all be taken from funds.
  const missing = !!shape.kind && !rows.some((r) => sideOf(shape, r) === mainSide(shape));
  useEffect(() => {
    if (missing) setRows((all) => [blankRow(mainSide(shape)), ...all]);
  }, [missing]); // eslint-disable-line react-hooks/exhaustive-deps
  const lines = linesOf(rows, shape);
  const wrong = shape.kind
    ? (rowsProblem(rows, shape) ?? linesProblem(shape, lines, formatMoney))
    : null;
  return {
    rows,
    setRows,
    shape,
    saved,
    lines,
    /** What's wrong with them, in a sentence. */
    problem: wrong && capitalized(wrong),
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

/**
 * The Funds section: one sentence about what the transaction does (money in, out, or moved), a
 * line per fund (To / From / For, a fund, its amount), "+ Another fund", and on a transfer "More
 * options" for funds it takes from. Below, always, what it does to each fund, Unallocated
 * included, or what's wrong, in red; and any fund it takes below zero.
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
  const [creating, setCreating] = useState<number | null>(null);
  const { rows, setRows, shape, lines, problem, saved } = funds;
  if (!listing) return null;

  const active = listing.funds.filter((f) => !f.archived);
  const balances = new Map(listing.funds.map((f) => [f.name, f.value.number]));
  const amounts = amountsOf(rows, shape);
  const size = formatMoney(shape.size, shape.currency);
  const known = balanced && !!shape.kind;
  const editable = known && !readOnly && !isZero(shape.size);
  const main = mainSide(shape);
  const mainRows = rows.filter((r) => sideOf(shape, r) === main);
  const takeRows = shape.kind === "transfer" ? rows.filter((r) => r.side === "from") : [];

  const update = (key: number, change: Partial<FundRow>) =>
    setRows((all) => all.map((r) => (r.key === key ? { ...r, ...change } : r)));
  const remove = (row: FundRow) =>
    setRows((all) => {
      const left = all.filter((r) => r.key !== row.key);
      // The main list keeps a row to choose in.
      return left.some((r) => sideOf(shape, r) === main) ? left : [blankRow(main), ...left];
    });
  const choose = (row: FundRow, fund: string) => {
    if (fund === NEW) return setCreating(row.key);
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
    setRows((all) => [
      ...all,
      { ...blankRow(side, false), amount: isNegative(left) || isZero(left) ? "" : left },
    ]);
  };

  const lead = !balanced ? (
    "Choose funds once the splits balance."
  ) : !shape.kind ? (
    `Funds can't follow this one: its amounts aren't all in ${shape.currency}.`
  ) : isZero(shape.size) ? (
    "Nothing comes in or goes out, so no fund changes."
  ) : shape.kind === "in" ? (
    <>
      <strong>{size} coming in.</strong> Without a fund, it's Unallocated.
    </>
  ) : shape.kind === "out" ? (
    <>
      <strong>{size} going out.</strong> Without a fund, it comes from Unallocated.
    </>
  ) : (
    <>
      <strong>{size} moving between accounts.</strong> No fund changes unless you set it aside.
    </>
  );

  const line = (row: FundRow, side: Side, only: boolean) => {
    const label = verb(shape, side);
    const own = row.fund && !active.some((f) => f.name === row.fund);
    const used = new Set(rows.filter((r) => r !== row && r.fund).map((r) => r.fund));
    const shown = row.follows && row.fund ? (amounts.get(row.key) ?? "") : row.amount;
    // The row to choose a first fund in has nothing to remove or type until it has one.
    const bare = !row.fund && row.follows && only;
    return (
      <div className="fund-line" key={row.key}>
        <span className="fund-verb">{label}</span>
        <select
          aria-label={`${label} fund`}
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
              placeholder="0.00"
              title={
                row.follows && row.fund
                  ? "Follows the transaction until you type an amount"
                  : undefined
              }
              value={shown}
              onChange={(e) => update(row.key, { amount: e.target.value, follows: false })}
            />
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
    <fieldset className="postings funds-field">
      <legend>Funds</legend>
      <p className="funds-lead">{lead}</p>

      {editable && (
        <>
          <div className="fund-lines">
            {mainRows.map((r) => line(r, main, mainRows.length === 1))}
          </div>
          {canAdd(mainRows) && (
            <button type="button" className="plain fund-add" onClick={() => another(main)}>
              + Another fund
            </button>
          )}
          {shape.kind === "transfer" &&
            (takeRows.length ? (
              <div className="fund-take" role="group" aria-label="Take from">
                <p className="small muted">
                  <strong>Take from</strong> a fund too: what it gives goes to the funds above, or
                  back to Unallocated.
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
                onClick={() => setRows((all) => [...all, blankRow("from")])}
              >
                More options
              </button>
            ))}
        </>
      )}

      {!editable && lines.length > 0 && (
        <ul className="fund-read">
          {lines.map((l) => (
            <li key={l.fund}>
              <span>
                {verb(shape, isNegative(l.amount.number) ? "from" : "into")} {l.fund}
              </span>
              <span className="num">{signedMoney(l.amount.number, l.amount.currency)}</span>
            </li>
          ))}
        </ul>
      )}

      {known && (
        <p className={`funds-summary small${problem ? " error" : ""}`} aria-live="polite">
          {!problem
            ? effectsInWords(shape, lines)
            : funds.changed
              ? problem
              : // Saved before the transaction changed (lines are checked only when they do).
                `As saved, its funds don't fit: ${problem.charAt(0).toLowerCase()}${problem.slice(1)}. Change them, or save the rest as it is.`}
        </p>
      )}
      {known &&
        !problem &&
        belowZero(lines, saved, balances).map((b) => (
          <p key={b.fund} className="small warning">
            {b.fund} will be at {formatMoney(b.number, shape.currency)}.
          </p>
        ))}

      {creating !== null && (
        <NewFundDialog
          book={book}
          listing={listing}
          onCreated={(fund) => {
            const row = rows.find((r) => r.key === creating);
            setCreating(null);
            if (row) choose(row, fund.name);
          }}
          onCancel={() => setCreating(null)}
        />
      )}
    </fieldset>
  );
}

/** A transaction's lines as chips: "to Emergency", "from Wedding" (long names cut short), the
 * whole line in the title. */
export function FundChips({ lines }: { lines?: FundLine[] | null }) {
  if (!lines?.length) return null;
  return (
    <span className="tags fund-chips" aria-label="Funds">
      {lines.map((l) => {
        const out = isNegative(l.amount.number);
        const whole = `${out ? "from" : "to"} ${l.fund}`;
        return (
          <span
            key={l.fund}
            className={`tag fund-chip ${out ? "out" : "in"}`}
            title={`${l.fund} ${signedMoney(l.amount.number, l.amount.currency)}`}
            aria-label={whole}
          >
            {out ? "from" : "to"} <span className="fund-chip-name">{l.fund}</span>
          </span>
        );
      })}
    </span>
  );
}

/**
 * A review card's fund: "From fund / To fund / For fund" (by its kind) and a select. Choosing one
 * puts all of it there; Unallocated clears it. Lines that are split, partial, or taken from on a
 * transfer show as chips with Edit… (its page). Only when the book has funds.
 */
export function FundChoice({
  book,
  transaction: t,
  here,
  disabled,
  onChange,
}: {
  book: string;
  transaction: { id: string; postings: PostingLike[]; funds?: FundLine[] | null };
  /** Where Edit… comes back to. */
  here: string;
  disabled?: boolean;
  onChange: (lines: FundLine[]) => void;
}) {
  const listing = useFunds(book).data;
  if (!listing) return null;
  const active = listing.funds.filter((f) => !f.archived);
  const shape = shapeFor(t.postings, listing.currency);
  const lines = t.funds ?? [];
  const whole = wholeFund(lines, shape);
  const chips = (
    <p className="fund-choice small">
      <FundChips lines={lines} />{" "}
      <Link href={withBack(`/books/${book}/transactions/${t.id}`, here)}>Edit…</Link>
    </p>
  );
  if (whole === null) return chips;
  if (!active.length || !shape.kind || isZero(shape.size)) return lines.length ? chips : null;
  const label = shape.kind === "in" ? "To fund" : shape.kind === "out" ? "From fund" : "For fund";
  return (
    <label className="fund-choice small">
      {label}{" "}
      <select
        aria-label={label}
        value={whole}
        disabled={disabled}
        onChange={(e) => {
          const line = e.target.value && wholeLine(shape, e.target.value);
          onChange(line ? [line] : []);
        }}
      >
        <option value="">{shape.kind === "transfer" ? "No fund" : UNALLOCATED}</option>
        {active.map((f) => (
          <option key={f.name} value={f.name}>
            {f.name}
          </option>
        ))}
        {whole && !active.some((f) => f.name === whole) && (
          <option value={whole}>{whole} (archived)</option>
        )}
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
 * one. */
export function typedAmount(text: string): string | null {
  const clean = text.replace(/[$,\s]/g, "");
  return isDecimal(clean) && !isNegative(clean) && !isZero(clean) ? fixed(clean) : null;
}

/** A fund's name and balance, as pickers show them: "Emergency · $12,000.00". */
const withBalance = (name: string, value: { number: string; currency: string }) =>
  `${name} · ${money(value)}`;

/**
 * Move money between funds (either can be Unallocated): from, to, amount, date (today) and a note,
 * with what it does spelled out. Editing a move offers Delete.
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
  const patch = usePatchMove(book);
  const remove = useDeleteMove(book);
  const active = listing?.funds.filter((f) => !f.archived) ?? [];
  const first = (not: string) =>
    [UNALLOCATED, ...active.map((f) => f.name)].find((n) => n !== not) ?? "";
  const initialFrom = move?.from_fund ?? start.from ?? UNALLOCATED;
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(move?.to_fund ?? start.to ?? first(initialFrom));
  const [amount, setAmount] = useState(move?.amount.number ?? "");
  const [date, setDate] = useState(move?.date ?? today());
  const [note, setNote] = useState(move?.note ?? "");
  const [error, setError] = useState<string | null>(null);
  const currency = listing?.currency ?? move?.amount.currency ?? "USD";
  const number = typedAmount(amount);
  const busy = create.isPending || patch.isPending || remove.isPending;

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
  const problem =
    from === to
      ? "Choose two different funds"
      : !amount.trim()
        ? null
        : !number
          ? "An amount is a number more than 0, like 2500.00"
          : null;

  const submit = async () => {
    if (!number || problem || busy) return;
    setError(null);
    const body = {
      date,
      from_fund: from,
      to_fund: to,
      amount: { number, currency },
      note: note.trim() || null,
    };
    try {
      if (move)
        await patch.mutateAsync({ id: move.id, patch: { ...body, updated_at: move.updated_at } });
      else await create.mutateAsync(body);
      onClose();
    } catch (e) {
      setError(explain(e));
    }
  };

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
        <div className="pair">
          <label>
            Amount
            <input
              inputMode="decimal"
              value={amount}
              placeholder="0.00"
              autoFocus
              onChange={(e) => setAmount(e.target.value)}
            />
          </label>
          <label>
            Date
            <input type="date" value={date} required onChange={(e) => setDate(e.target.value)} />
          </label>
        </div>
        <label>
          <span>
            Note <span className="muted small">(optional)</span>
          </span>
          <input value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />
        </label>
        <p className={`small${problem ? " error" : " muted"}`} aria-live="polite">
          {problem ??
            (number
              ? `${from} ${signedMoney(negate(number), currency)} → ${to} ${signedMoney(number, currency)}`
              : "No account changes: only what the money is for.")}
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
          <button type="submit" className="primary" disabled={!number || !!problem || busy}>
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

/** A new fund: its name, and optionally a description and a target. */
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
      onCreated(
        await create.mutateAsync({
          name,
          description: description.trim() || null,
          target: number ? { number, currency: listing?.currency ?? "USD" } : null,
        })
      );
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

/** Home's Funds card (when the book has a fund): each active fund's balance (and progress, with a
 * target), Unallocated, and All funds ›. */
export function FundsCard({ book }: { book: string }) {
  const listing = useFunds(book).data;
  const active = listing?.funds.filter((f) => !f.archived) ?? [];
  if (!listing || !active.length) return null;
  const all = `/books/${book}/funds`;
  return (
    <section className="funds-home" aria-label="Funds">
      <h2 className="section-title">
        <Link href={all}>Funds ›</Link>
      </h2>
      <div className="card">
        <ul className="fund-list">
          {active.map((f) => (
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
          <li>
            <span className="fund-row unallocated">
              <span className="fund-row-top">
                <span className="fund-name">{UNALLOCATED}</span>
                <span className={`num${isNegative(listing.unallocated.number) ? " negative" : ""}`}>
                  {money(listing.unallocated)}
                </span>
              </span>
            </span>
          </li>
        </ul>
        <p className="small fund-all">
          <Link href={all}>All funds ›</Link>
        </p>
      </div>
    </section>
  );
}
