import type { Transaction } from "@fava-beans/ledger-client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";

import { AccountName, AccountPicker, type AccountCreation } from "../components/AccountPicker.js";
import { Swipeable, type SwipeHandle } from "../components/Swipeable.js";
import { postable, preferredRoots, shortName } from "../lib/accounts.js";
import { formatMoney, isNegative } from "../lib/decimal.js";
import {
  explain,
  readSkipped,
  useAccountCreation,
  useAccounts,
  useEditTransaction,
  useQueue,
  writeSkipped,
} from "../lib/queries.js";
import { simple, UNCATEGORIZED, withCounterpart } from "../lib/split.js";

export function Review({ book }: { book: string }) {
  const queue = useQueue(book);
  const accounts = useAccounts(book);
  const create = useAccountCreation(book);
  const [skipped, setSkipped] = useState(() => readSkipped(book));
  useEffect(() => writeSkipped(book, skipped), [book, skipped]);

  // Oldest first; skipped items go to the end, most recently skipped last.
  const items = queue.data ?? [];
  const ordered = [
    ...items.filter((t) => !skipped.includes(t.id)),
    ...skipped.flatMap((id) => items.filter((t) => t.id === id)),
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
          {queue.data && ` · ${ordered.length} left`}
        </p>
      </header>

      {queue.isPending && <p className="muted">Loading…</p>}
      {queue.error && <p className="card error">{explain(queue.error)}</p>}
      {queue.data && ordered.length === 0 && (
        <p className="card done">All caught up. Nothing is waiting for review.</p>
      )}

      <ol className="queue">
        {ordered.map((t) => (
          <li key={t.id}>
            <QueueItem
              book={book}
              transaction={t}
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
  accounts: string[];
  create?: AccountCreation;
  onSkip: () => void;
};

function QueueItem({ book, transaction: t, accounts, create, onSkip }: ItemProps) {
  const edit = useEditTransaction(book, t.id);
  const swipe = useRef<SwipeHandle>(null);
  const [error, setError] = useState<string | null>(null);
  const [narration, setNarration] = useState(t.narration);
  const [nudge, setNudge] = useState(0);
  useEffect(() => setNarration(t.narration), [t.narration]);

  const view = useMemo(() => simple(t), [t]);
  const detail = `/books/${book}/transactions/${t.id}`;
  const busy = edit.isPending;
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
  // Confirming carries the description too, in case it was edited without leaving the field.
  const confirm = () => save({ flag: "*", narration });

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
