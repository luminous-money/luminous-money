import type { Transaction } from "@fava-beans/ledger-client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";

import { AccountName, AccountPicker, type AccountCreation } from "../components/AccountPicker.js";
import { Swipeable, type SwipeHandle } from "../components/Swipeable.js";
import { postable, preferredRoots, shortName } from "../lib/accounts.js";
import { add, formatMoney, isNegative, isZero, negate } from "../lib/decimal.js";
import type { ProposedMatch } from "../lib/appApi.js";
import {
  explain,
  readSkipped,
  useAccountCreation,
  useAccounts,
  useAssign,
  useConfirmMatch,
  useDropOccurrence,
  useEditTransaction,
  useScheduled,
  useReviewQueue,
  writeSkipped,
} from "../lib/queries.js";
import { simple, UNCATEGORIZED, withCounterpart } from "../lib/split.js";

/**
 * The review queue: pending transactions to categorize and confirm, and imported rows matched
 * to transactions already in the account, whose matches are confirmed here too (or moved,
 * swapped, or undone).
 */
export function Review({ book }: { book: string }) {
  const queue = useReviewQueue(book);
  const accounts = useAccounts(book);
  const create = useAccountCreation(book);
  const scheduled = useScheduled(book);
  const [skipped, setSkipped] = useState(() => readSkipped(book));
  useEffect(() => writeSkipped(book, skipped), [book, skipped]);

  // Oldest first; skipped items go to the end, most recently skipped last.
  const items = queue.items ?? [];
  const ordered = [
    ...items.filter((i) => !skipped.includes(i.transaction.id)),
    ...skipped.flatMap((id) => items.filter((i) => i.transaction.id === id)),
  ];

  return (
    <main>
      <header className="page-head">
        <Link href="/" className="back">
          ‹ Books
        </Link>
        <h1>Review</h1>
        <p className="muted">
          {book}
          {queue.items && ` · ${ordered.length} left`}
        </p>
      </header>

      {!queue.items && !queue.error && <p className="muted">Loading…</p>}
      {queue.error && <p className="card error">{explain(queue.error)}</p>}
      {queue.items && ordered.length === 0 && (
        <p className="card done">All caught up. Nothing is waiting for review.</p>
      )}

      <ol className="queue">
        {ordered.map(({ transaction: t, matches }) => (
          <li key={t.id}>
            <QueueItem
              book={book}
              transaction={t}
              matches={matches}
              scheduled={!!scheduled.data?.[t.id]}
              accounts={accounts.data ? postable(accounts.data, t.date) : []}
              create={create}
              onSkip={() => setSkipped((s) => [...s.filter((x) => x !== t.id), t.id])}
            />
          </li>
        ))}
      </ol>
    </main>
  );
}

type ItemProps = {
  book: string;
  transaction: Transaction;
  /** Import rows proposed as this transaction, if any. */
  matches: ProposedMatch[];
  /** Whether a schedule staged it (so it can be dropped: "Not this time"). */
  scheduled: boolean;
  accounts: string[];
  create?: AccountCreation;
  onSkip: () => void;
};

function QueueItem({
  book,
  transaction: t,
  matches,
  scheduled,
  accounts,
  create,
  onSkip,
}: ItemProps) {
  const edit = useEditTransaction(book, t.id);
  const drop = useDropOccurrence(book);
  const confirmMatch = useConfirmMatch(book);
  const swipe = useRef<SwipeHandle>(null);
  const [error, setError] = useState<string | null>(null);
  const [narration, setNarration] = useState(t.narration);
  const [nudge, setNudge] = useState(0);
  useEffect(() => setNarration(t.narration), [t.narration]);

  const view = useMemo(() => simple(t), [t]);
  const detail = `/books/${book}/transactions/${t.id}`;
  const busy = edit.isPending || confirmMatch.isPending;
  const uncategorized = t.postings.some((p) => p.account === UNCATEGORIZED);

  // Edits to this transaction queue up in order (see lib/queries), so these can fire freely.
  const save = (changes: Parameters<typeof edit.mutateAsync>[0]) => {
    setError(null);
    return edit.mutateAsync(changes).then(
      () => true,
      (e: unknown) => {
        setError(explain(e));
        return false;
      }
    );
  };
  const saveNarration = () => {
    if (narration !== t.narration) void save({ narration });
  };
  // Confirming carries the description too, in case it was edited without leaving the field;
  // it confirms the transaction if it's pending, and any matches proposed with it.
  const confirm = async () => {
    if (t.flag === "!" && !(await save({ flag: "*", narration }))) return false;
    try {
      for (const m of matches) await confirmMatch.mutateAsync(m);
      return true;
    } catch (e) {
      setError(explain(e));
      return false;
    }
  };

  return (
    <Swipeable
      handle={swipe}
      onConfirm={confirm}
      onSkip={onSkip}
      canConfirm={!uncategorized}
      onBlocked={() => setNudge((n) => n + 1)}
    >
      <article
        className={`card item${busy ? " busy" : ""}`}
        aria-label={`${t.payee ?? ""} ${t.narration}`}
      >
        <div className="item-top">
          <span className="muted">
            {t.date}
            {view && ` · ${shortName(view.anchor.account)}`}
          </span>
          {view && (
            <span className={`amount ${isNegative(view.amount) ? "out" : "in"}`}>
              {formatMoney(view.amount, view.currency)}
            </span>
          )}
        </div>
        {t.payee && <div className="payee">{t.payee}</div>}
        <input
          className="description"
          aria-label="Description"
          placeholder="Add a description"
          value={narration}
          onChange={(e) => setNarration(e.target.value)}
          onBlur={saveNarration}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        />

        {view ? (
          <div
            // Re-keyed on every blocked swipe so the nudge animation replays.
            key={nudge}
            className={`category${view.counterpart.account === UNCATEGORIZED ? " needs" : ""}${nudge ? " nudge" : ""}`}
          >
            <AccountPicker
              label="Category"
              accounts={accounts}
              value={view.counterpart.account === UNCATEGORIZED ? "" : view.counterpart.account}
              prefer={preferredRoots(isNegative(view.amount))}
              create={create}
              onChange={(account) => void save({ postings: withCounterpart(t, account).postings })}
            />
          </div>
        ) : (
          <ul className="splits">
            {t.postings.map((p, i) => (
              <li key={i}>
                <AccountName name={p.account} />
                <span>{p.units ? formatMoney(p.units.number, p.units.currency) : "auto"}</span>
              </li>
            ))}
          </ul>
        )}

        {scheduled && t.flag === "!" && (
          <p className="small scheduled-line">
            <span className="muted">↻ From a schedule</span>
            <button
              type="button"
              className="plain"
              disabled={drop.isPending}
              onClick={() => drop.mutate(t, { onError: (e) => setError(explain(e)) })}
            >
              Not this time
            </button>
          </p>
        )}

        {matches.map((m) => (
          <MatchPanel key={`${m.batch_id}:${m.line}`} book={book} row={m} />
        ))}

        {error && <p className="error">{error}</p>}

        <div className="actions">
          <button type="button" onClick={() => void swipe.current?.commit("skip")}>
            Skip
          </button>
          <Link href={detail} className="button">
            {view ? "Split…" : "Open"}
          </Link>
          <button
            type="button"
            className="primary"
            disabled={uncategorized}
            title={uncategorized ? "Choose a category first" : undefined}
            onClick={() => void swipe.current?.commit("confirm")}
          >
            Confirm
          </button>
        </div>
      </article>
    </Swipeable>
  );
}

const sameAmount = (a: string, b: string) => isZero(add(a, negate(b)));

const describe = (date: string | null, text: string | null) =>
  `${date ?? "?"} · ${text || "(no description)"}`;

/**
 * An imported row proposed as this transaction: the row, and its other candidates to move it to
 * (or swap with the row holding one), or "Not a match" to stage it on its own.
 */
function MatchPanel({ book, row }: { book: string; row: ProposedMatch }) {
  const assign = useAssign(book);
  const matched = row.outcome === "matched";
  const others = row.candidates.filter((c) => c.transaction_id !== row.transaction_id);
  const held = row.candidates.find((c) => c.transaction_id === row.transaction_id);
  const differs = matched && held && row.amount && !sameAmount(held.amount, row.amount);

  return (
    <section className="match" aria-label="Match">
      <p className="small">
        {matched ? "Matches" : "Imported as new"}: <strong>{row.description}</strong> · {row.date}{" "}
        <span className="muted">({row.filename})</span>
      </p>
      {differs && (
        <p className="small">
          Within the schedule&apos;s tolerance: confirming takes the bank&apos;s amount,{" "}
          {row.amount}, in place of {held.amount}.
        </p>
      )}
      {others.length > 0 && (
        <ul className="match-options">
          {others.map((c) => (
            <li key={c.transaction_id}>
              <span className="small">
                {describe(c.date, c.payee ?? c.narration)}
                {c.holder && (
                  <span className="muted">
                    {" "}
                    (matched to {describe(c.holder.date, c.holder.description)})
                  </span>
                )}
              </span>
              <button
                type="button"
                disabled={assign.isPending}
                onClick={() => assign.mutate({ row, to: c.transaction_id })}
              >
                {c.holder ? "Swap" : matched ? "Match with this instead" : "Match with this"}
              </button>
            </li>
          ))}
        </ul>
      )}
      {matched && (
        <button
          type="button"
          disabled={assign.isPending}
          onClick={() => assign.mutate({ row, to: null })}
        >
          Not a match
        </button>
      )}
      {assign.error && <p className="error">{explain(assign.error)}</p>}
    </section>
  );
}
