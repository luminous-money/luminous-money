import type { Posting } from "@luminous-money/ledger-client";
import { useEffect, useId, useRef, useState, type SyntheticEvent } from "react";
import { createPortal } from "react-dom";

import { formatMoney, isDecimal } from "../lib/decimal.js";
import { useLongPress, useSelection } from "../lib/selection.js";
import { checkBalance, memoOf, unresolved } from "../lib/split.js";
import { AccountPicker, type AccountCreation } from "./AccountPicker.js";
import { SelectBar, type BulkAction } from "./SelectBar.js";
import { TagChips, TagInput, tagList, type TagChoice } from "./Tags.js";

/** A posting being edited. The amount stays a raw string until it's valid; anything the form
 * doesn't edit (cost, price, flag, other metadata) rides along untouched in `original`, except
 * that a split whose account you change is yours: its flag (`!`, still to confirm) goes. */
type Row = {
  key: number;
  /** What it is (a receipt's line): its `memo:`. */
  memo: string;
  account: string;
  number: string;
  currency: string;
  /** A schedule's match tolerance for the split (see `SplitsFieldset`'s `tolerances`). */
  tolerance: string;
  /** Its tags: a split's own. */
  tags: string[];
  original: Partial<Posting>;
};

/** A posting, with a schedule's match tolerance if it has one. */
type Split = Posting & { tolerance?: string | null };

let nextKey = 0;

/** Blank amounts get the transaction's currency, so typing a number into one just works. */
function toRows(postings: Split[], currency: string): Row[] {
  return postings.map(({ tolerance, ...p }) => ({
    key: nextKey++,
    memo: memoOf(p) ?? "",
    account: p.account,
    number: p.units?.number ?? "",
    currency: p.units?.currency ?? currency,
    tolerance: tolerance ?? "",
    tags: p.tags ?? [],
    original: p,
  }));
}

/** A split's metadata with its memo set, or gone when it's blank. */
function withMemo(meta: Posting["meta"], memo: string): Posting["meta"] {
  const { memo: _memo, ...rest } = meta ?? {};
  return memo.trim() ? { ...rest, memo: memo.trim() } : rest;
}

function toPostings(rows: Row[]): Split[] {
  return rows.map(({ original: { flag, ...original }, ...r }) => ({
    ...original,
    ...(flag && r.account === original.account ? { flag } : {}),
    ...(original.meta || r.memo.trim() ? { meta: withMemo(original.meta, r.memo) } : {}),
    account: r.account,
    units: r.number.trim() ? { number: r.number.trim(), currency: r.currency.trim() } : null,
    tags: r.tags,
    ...(r.tolerance.trim() ? { tolerance: r.tolerance.trim() } : {}),
  }));
}

/** A transaction's splits being edited: the rows, the postings they make, and whether they
 * balance. Reset whenever `postings` changes (a saved or refreshed transaction). */
export function useSplits(postings: Split[], currency: string) {
  const [rows, setRows] = useState(() => toRows(postings, currency));
  useEffect(() => setRows(toRows(postings, currency)), [postings, currency]);
  const badAmount = rows.some(
    (r) => r.number.trim() && (!isDecimal(r.number.trim()) || !r.currency.trim())
  );
  const badTolerance = rows.some(
    (r) => r.tolerance.trim() && !/^\d+(\.\d+)?$/.test(r.tolerance.trim())
  );
  const edited = toPostings(rows);
  const balance = badAmount
    ? ({
        state: "invalid",
        message: "Amounts must be numbers like 12.50, with a currency",
      } as const)
    : badTolerance
      ? ({ state: "invalid", message: "A match tolerance is an amount, like 25.00" } as const)
      : checkBalance(edited);
  return {
    rows,
    setRows,
    currency,
    postings: edited,
    balance,
    unresolved: rows.some((r) => unresolved(r.account)),
  };
}

export type Splits = ReturnType<typeof useSplits>;

const blankRow = (currency: string): Row => ({
  key: nextKey++,
  memo: "",
  account: "",
  number: "",
  currency,
  tolerance: "",
  tags: [],
  original: {},
});

/** Events inside the editor must not reach what it was opened from (a portal still bubbles
 * through React's tree). */
const contain = (e: SyntheticEvent) => e.stopPropagation();

/**
 * A transaction's splits: each shown as it is (its memo, or a faint placeholder, and its tags,
 * then its account and amount), opened in the split editor to change it; "+ Add split" opens a
 * blank one. Saving there changes the transaction being edited; it's saved with the transaction.
 * A long press, or a click with Shift, Ctrl, ⌘ or Option, starts Select mode, to tag or delete
 * several at once.
 */
export function SplitsFieldset({
  splits,
  accounts,
  create,
  tags,
  disabled,
  tolerances = false,
}: {
  splits: Splits;
  /** Accounts the splits can use. */
  accounts: string[];
  create?: AccountCreation;
  /** The tags to suggest (the book's). */
  tags: readonly TagChoice[];
  /** Tags can't be changed, nor several splits at once (a reader's view). */
  disabled?: boolean;
  /** Edit each split's match tolerance (schedules): how far a bank's amount may be from it, either
   * way, and still match. */
  tolerances?: boolean;
}) {
  const { rows, setRows, currency, balance } = splits;
  // The split being edited: one of the rows, or a new one ("+ Add split").
  const [editing, setEditing] = useState<{ row: Row; isNew: boolean } | null>(null);
  const selection = useSelection();
  const [note, setNote] = useState<string | null>(null);
  const select = (key: string) => {
    if (disabled) return;
    if (!selection.selecting) selection.start();
    selection.toggle(key);
    setNote(null);
  };
  const press = useLongPress(select);
  // The blank amount's, when it balances: what it'll be.
  const auto = balance.state === "balanced" && balance.auto.length === 1 ? balance.auto[0] : null;

  const chosen = rows.filter((r) => selection.has(String(r.key)));
  const actions: BulkAction[] = [
    {
      label: "Add tag…",
      pickTag: { choices: [...tags], allowNew: true },
      run: (tag) => {
        setRows((all) =>
          all.map((r) =>
            selection.has(String(r.key)) && !r.tags.includes(tag)
              ? { ...r, tags: [...r.tags, tag].sort() }
              : r
          )
        );
        setNote(
          `Tagged ${chosen.length === 1 ? "1 split" : `${chosen.length} splits`} ${tagList([tag])}.`
        );
      },
    },
    {
      label: "Delete",
      disabled: chosen.length >= rows.length && "a transaction needs a split",
      run: () => {
        setRows((all) => all.filter((r) => !selection.has(String(r.key))));
        selection.stop();
        setNote(null);
      },
    },
  ];

  return (
    <fieldset className="postings">
      <legend>Splits</legend>
      {selection.selecting && (
        <SelectBar
          count={chosen.length}
          shown={rows.length}
          onSelectAll={() => selection.selectAll(rows.map((r) => String(r.key)))}
          actions={actions}
          busy={false}
          note={note}
          onDone={() => (selection.stop(), setNote(null))}
        />
      )}
      <ul className="split-list" aria-label="Splits">
        {rows.map((r) => {
          const key = String(r.key);
          const selected = selection.has(key);
          return (
            <li key={r.key}>
              <button
                type="button"
                className={`split-row${selected ? " selected" : ""}${unresolved(r.account) || !r.account ? " needs" : ""}`}
                {...press.handlers(key)}
                onClick={(e) => {
                  if (press.consumed()) return;
                  if (selection.selecting) selection.toggle(key);
                  else if (e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) select(key);
                  else setEditing({ row: r, isNew: false });
                }}
                {...(selection.selecting ? { role: "checkbox", "aria-checked": selected } : {})}
                aria-label={`Split: ${[r.memo.trim(), r.account || "no account", amountOf(r, auto), ...r.tags.map((t) => `#${t}`)].filter(Boolean).join(", ")}`}
              >
                {/* Every split has the memo's line, a faint "Memo" without one, so they're
                    spaced alike. */}
                <span className="split-top">
                  {r.memo.trim() ? (
                    <span className="split-memo">{r.memo.trim()}</span>
                  ) : (
                    <span className="split-memo placeholder" aria-hidden="true">
                      Memo
                    </span>
                  )}
                  <TagChips tags={r.tags} />
                </span>
                <span className="split-bottom">
                  {/* Long names lose their start, not their leaf: "…nses:Home:Supplies". */}
                  <span className="split-account">
                    <bdi>{r.account || "No account yet"}</bdi>
                  </span>
                  <span className="amount">
                    {amountOf(r, auto)}
                    {tolerances && r.tolerance.trim() && (
                      <span className="muted small"> ±{r.tolerance.trim()}</span>
                    )}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <button type="button" onClick={() => setEditing({ row: blankRow(currency), isNew: true })}>
        + Add split
      </button>
      <p className={`balance ${balance.state}`} aria-live="polite">
        {balance.state === "invalid" && balance.message}
        {balance.state === "deferred" && "Lots and prices are checked by the ledger on save."}
        {balance.state === "balanced" &&
          (balance.auto.length
            ? `Balanced. The blank amount will be ${balance.auto.map((a) => formatMoney(a.number, a.currency)).join(", ")}.`
            : "Balanced.")}
      </p>
      <p className="muted small">
        Leave one amount blank to balance automatically. Hold one, or Shift-click it, to select
        several.
      </p>
      {editing && (
        <SplitEditor
          row={editing.row}
          isNew={editing.isNew}
          currency={currency}
          accounts={accounts}
          create={create}
          tags={tags}
          disabled={disabled}
          tolerances={tolerances}
          canDelete={rows.length > 1}
          onSave={(row) => {
            setRows((all) =>
              editing.isNew ? [...all, row] : all.map((r) => (r.key === row.key ? row : r))
            );
            setEditing(null);
          }}
          onDelete={() => {
            setRows((all) => all.filter((r) => r.key !== editing.row.key));
            setEditing(null);
          }}
          onCancel={() => setEditing(null)}
        />
      )}
    </fieldset>
  );
}

/** A split's amount as shown: its own, or the blank one's when it balances ("$50.00 auto"). */
function amountOf(r: Row, auto: { number: string; currency: string } | null | undefined) {
  const number = r.number.trim();
  if (!number) return auto ? `${formatMoney(auto.number, auto.currency)} auto` : "auto";
  return isDecimal(number)
    ? formatMoney(number, r.currency.trim() || "")
    : `${number} ${r.currency}`;
}

/**
 * One split, everything about it: what it is (its memo), its account, its amount, its tags, and a
 * schedule's match tolerance. Save (or Enter) puts it back in the transaction being edited;
 * Cancel (or Escape) leaves it as it was. Full screen on phones.
 */
function SplitEditor({
  row,
  isNew,
  currency,
  accounts,
  create,
  tags,
  disabled,
  tolerances,
  canDelete,
  onSave,
  onDelete,
  onCancel,
}: {
  row: Row;
  isNew: boolean;
  currency: string;
  accounts: string[];
  create?: AccountCreation;
  tags: readonly TagChoice[];
  disabled?: boolean;
  tolerances: boolean;
  /** Whether it can be deleted (not a transaction's only split). */
  canDelete: boolean;
  onSave: (row: Row) => void;
  onDelete: () => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(row);
  const [error, setError] = useState<string | null>(null);
  const titleId = useId();
  const dialog = useRef<HTMLDivElement>(null);
  const amount = useRef<HTMLInputElement>(null);
  const change = (c: Partial<Row>) => setDraft((d) => ({ ...d, ...c }));
  // Opened on a split, Enter saves it as it is; a new one starts at its account.
  useEffect(() => {
    if (!isNew) dialog.current?.focus();
  }, [isNew]);

  const save = () => {
    const number = draft.number.trim();
    if (!draft.account) return setError("Choose an account");
    if (number && (!isDecimal(number) || !draft.currency.trim()))
      return setError("An amount is a number like 12.50, with a currency");
    if (draft.tolerance.trim() && !/^\d+(\.\d+)?$/.test(draft.tolerance.trim()))
      return setError("A match tolerance is an amount, like 25.00");
    onSave(draft);
  };

  return createPortal(
    <div
      className="dialog-backdrop"
      onPointerDown={contain}
      onPointerMove={contain}
      onPointerUp={contain}
      onClick={contain}
      onKeyDown={(e) => {
        contain(e);
        // A picker's own Escape closes the picker, not the editor.
        if (e.key === "Escape" && !e.defaultPrevented) onCancel();
      }}
    >
      <div
        className="dialog split-editor"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        ref={dialog}
        onKeyDown={(e) => {
          if (e.key === "Enter" && e.target === dialog.current) {
            e.preventDefault();
            save();
          }
        }}
      >
        <h2 id={titleId}>{isNew ? "New split" : "Split"}</h2>
        <form
          className="editor"
          onSubmit={(e) => {
            e.preventDefault();
            // React carries a portal's events up its own tree: without this, the transaction's
            // form around the splits would be submitted too.
            e.stopPropagation();
            save();
          }}
        >
          <label>
            Memo
            <input
              value={draft.memo}
              placeholder="What it's for (optional)"
              onChange={(e) => change({ memo: e.target.value })}
            />
          </label>
          <div className="field">
            <span>Account</span>
            <AccountPicker
              label="Account"
              accounts={accounts}
              value={unresolved(draft.account) ? "" : draft.account}
              create={create}
              initiallyOpen={isNew}
              onChange={(account) => {
                change({ account });
                setError(null);
                // On to the amount, so Enter still saves (the picker's input is gone).
                setTimeout(() => amount.current?.focus());
              }}
            />
          </div>
          <div className="split-amount">
            <label>
              Amount
              <input
                ref={amount}
                inputMode="decimal"
                placeholder="auto"
                value={draft.number}
                onChange={(e) => change({ number: e.target.value })}
              />
            </label>
            <label>
              Currency
              <input
                className="currency"
                value={draft.currency}
                placeholder={currency}
                onChange={(e) => change({ currency: e.target.value.toUpperCase() })}
              />
            </label>
          </div>
          <p className="muted small">Leave the amount blank to balance the rest.</p>
          {tolerances && draft.number.trim() && (
            <label className="tolerance small">
              Match within ±
              <input
                aria-label="Match tolerance"
                inputMode="decimal"
                placeholder="0.00"
                value={draft.tolerance}
                onChange={(e) => change({ tolerance: e.target.value })}
              />
            </label>
          )}
          {(draft.original.cost || draft.original.price) && (
            <p className="muted small">
              Has a {draft.original.cost ? "cost basis" : "price"}; kept as is.
            </p>
          )}
          <div className="field">
            <span>Tags</span>
            <TagInput
              label="Tags"
              value={draft.tags}
              choices={tags}
              disabled={disabled}
              onChange={(changed) => change({ tags: changed })}
            />
          </div>

          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}

          <div className="actions">
            <button type="button" onClick={onCancel}>
              Cancel
            </button>
            {!isNew && (
              <button
                type="button"
                disabled={!canDelete}
                title={canDelete ? undefined : "A transaction needs a split"}
                onClick={onDelete}
              >
                Delete
              </button>
            )}
            <button type="submit" className="primary">
              Save
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
