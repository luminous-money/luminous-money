import type { Transaction, TransactionIn } from "@fava-beans/ledger-client";
import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";

import { AccountName, AccountPicker } from "../components/AccountPicker.js";
import { Swipeable } from "../components/Swipeable.js";
import { openOn, preferredRoots, shortName } from "../lib/accounts.js";
import { formatMoney, isNegative } from "../lib/decimal.js";
import { useAccounts, useQueue } from "../lib/hooks.js";
import { simple, toInput, UNCATEGORIZED, withCounterpart } from "../lib/split.js";

export function Review({ book }: { book: string }) {
  const queue = useQueue(book);
  const accounts = useAccounts(book);

  return (
    <main>
      <header className="page-head">
        <Link href="/" className="back">
          ‹ Books
        </Link>
        <h1>Review</h1>
        <p className="muted">
          {book}
          {queue.loaded.state === "ready" && ` · ${queue.items.length} left`}
        </p>
      </header>

      {queue.loaded.state === "loading" && <p className="muted">Loading…</p>}
      {queue.loaded.state === "failed" && <p className="card error">{queue.loaded.error}</p>}
      {queue.loaded.state === "ready" && queue.items.length === 0 && (
        <p className="card done">All caught up. Nothing is waiting for review.</p>
      )}

      <ol className="queue">
        {queue.items.map((t) => (
          <li key={t.id}>
            <QueueItem
              book={book}
              transaction={t}
              accounts={accounts.state === "ready" ? openOn(accounts.value, t.date) : []}
              onSave={(input) => queue.save(t.id, input)}
              onConfirm={(input) => queue.confirm(t.id, input)}
              onSkip={() => queue.skip(t.id)}
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
  onSave: (input: TransactionIn) => Promise<unknown>;
  onConfirm: (input: TransactionIn) => Promise<unknown>;
  onSkip: () => void;
};

function QueueItem({ book, transaction: t, accounts, onSave, onConfirm, onSkip }: ItemProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [narration, setNarration] = useState(t.narration);
  const [nudge, setNudge] = useState(0);
  useEffect(() => setNarration(t.narration), [t.narration]);

  const view = useMemo(() => simple(t), [t]);
  const input = toInput(t);
  const detail = `/books/${book}/transactions/${t.id}`;

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const saveNarration = () => {
    if (narration !== t.narration) void run(() => onSave({ ...input, narration }));
  };

  const uncategorized = t.postings.some((p) => p.account === UNCATEGORIZED);
  const confirm = () => run(() => onConfirm({ ...input, narration }));

  return (
    <Swipeable
      onConfirm={confirm}
      onSkip={onSkip}
      canConfirm={!busy && !uncategorized}
      onBlocked={() => setNudge((n) => n + 1)}
      disabled={busy}
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
          disabled={busy}
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
              disabled={busy}
              onChange={(account) =>
                void run(() => onSave(withCounterpart({ ...input, narration }, account)))
              }
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
          <button type="button" onClick={onSkip} disabled={busy}>
            Skip
          </button>
          <Link href={detail} className="button">
            {view ? "Split…" : "Open"}
          </Link>
          <button
            type="button"
            className="primary"
            disabled={busy || uncategorized}
            title={uncategorized ? "Choose a category first" : undefined}
            onClick={() => void confirm()}
          >
            Confirm
          </button>
        </div>
      </article>
    </Swipeable>
  );
}
