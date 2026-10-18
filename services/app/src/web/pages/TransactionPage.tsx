import type { Transaction } from "@fava-beans/ledger-client";
import { useMemo, useState } from "react";
import { Link, useLocation } from "wouter";

import { ExcludeFromBudget } from "../components/ExcludeFromBudget.js";
import { PairedTransfer } from "../components/PairedTransfer.js";
import { SplitsFieldset, useSplits } from "../components/Splits.js";
import { displayName, postable } from "../lib/accounts.js";
import { formatDay, today } from "../lib/format.js";
import { useBack, useParam, withBack } from "../lib/navigation.js";
import {
  explain,
  useAccountCreation,
  useAccounts,
  useCreateTransaction,
  useEditTransaction,
  useTransaction,
} from "../lib/queries.js";
import { simple } from "../lib/split.js";

/** Its postings' reconciliations (M14): which account's statement, of which day. */
function reconciliations(t: Transaction): { account: string; date: string }[] {
  return t.postings.flatMap((p) => {
    const mark = p.meta?.reconciled;
    return mark && typeof mark === "object" && "date" in mark
      ? [{ account: p.account, date: mark.date }]
      : [];
  });
}

/** What a split amounts to, to tell whether an edit changes any. */
const gist = (postings: Transaction["postings"]) =>
  JSON.stringify(
    postings.map((p) => [p.account, p.units?.number ?? null, p.units?.currency ?? null])
  );

function currencyOf(t: Transaction): string {
  return simple(t)?.currency ?? t.postings.find((p) => p.units)?.units?.currency ?? "USD";
}

export function TransactionPage({ book, id }: { book: string; id: string }) {
  const loaded = useTransaction(book, id);
  const back = useBack(`/books/${book}/review`);

  return (
    <main>
      <header className="page-head">
        <Link href={back} className="back">
          ‹ Back
        </Link>
        <h1>Transaction</h1>
      </header>
      {loaded.isPending && <p className="muted">Loading…</p>}
      {loaded.error && <p className="card error">{explain(loaded.error)}</p>}
      {loaded.data && <Editor book={book} transaction={loaded.data} back={back} />}
    </main>
  );
}

/** A new transaction, started from an account's ledger: empty but for a split on that account
 * and today's date. It's saved confirmed, since it's written by hand. */
export function NewTransactionPage({ book }: { book: string }) {
  const account = useParam("account") ?? "";
  const back = useBack(`/books/${book}/review`);
  const draft: Transaction = {
    id: "",
    created_at: "",
    updated_at: "",
    date: today(),
    flag: "*",
    payee: null,
    narration: "",
    tags: [],
    links: [],
    meta: {},
    postings: [{ account }, { account: "" }],
  };

  return (
    <main>
      <header className="page-head">
        <Link href={back} className="back">
          ‹ Back
        </Link>
        <h1>New transaction</h1>
      </header>
      <Editor book={book} transaction={draft} back={back} isNew />
    </main>
  );
}

function Editor({
  book,
  transaction: t,
  back,
  isNew = false,
}: {
  book: string;
  transaction: Transaction;
  back: string;
  isNew?: boolean;
}) {
  const [, navigate] = useLocation();
  const accounts = useAccounts(book);
  const create = useAccountCreation(book);
  const edit = useEditTransaction(book, t.id);
  const add = useCreateTransaction(book);
  const [date, setDate] = useState(t.date);
  const [payee, setPayee] = useState(t.payee ?? "");
  const [narration, setNarration] = useState(t.narration);
  const [meta, setMeta] = useState(t.meta);
  const fallbackCurrency = useMemo(() => currencyOf(t), [t]);
  const splits = useSplits(t.postings, fallbackCurrency);
  const { postings, balance, uncategorized } = splits;
  const busy = edit.isPending || add.isPending;
  const [message, setMessage] = useState<{ kind: "error" | "ok"; text: string } | null>(null);
  const names = accounts.data ? postable(accounts.data, date) : [];
  const staged = t.flag === "!";
  // Reconciled: saving a change to its splits asks first (it can break the statement). Its
  // date can change freely: statements hold by what's reconciled with them, not by dates.
  const reconciled = isNew ? [] : reconciliations(t);
  const [confirming, setConfirming] = useState(false);
  const changesReconciled = reconciled.length > 0 && gist(postings) !== gist(t.postings);

  const submit = async (flag: string, then?: string) => {
    setMessage(null);
    if (changesReconciled && !confirming) return setConfirming(true);
    setConfirming(false);
    try {
      const changes = { date, flag, payee: payee.trim() || null, narration, postings, meta };
      if (isNew) {
        await add.mutateAsync({ ...changes, tags: [], links: [] });
        return navigate(back);
      }
      await edit.mutateAsync(changes);
      if (then) navigate(then);
      else setMessage({ kind: "ok", text: "Saved" });
    } catch (e) {
      setMessage({ kind: "error", text: explain(e) });
    }
  };

  return (
    <form className="editor" onSubmit={(e) => (e.preventDefault(), void submit(t.flag))}>
      {!isNew && (
        <p className="status-line">
          <span className={`pill ${staged ? "staged" : "confirmed"}`}>
            {staged ? "Unconfirmed" : "Confirmed"}
          </span>
          <Link
            href={withBack(
              `/books/${book}/schedules/new?from=${t.id}`,
              `/books/${book}/transactions/${t.id}`
            )}
          >
            Repeat…
          </Link>
        </p>
      )}

      {!isNew && <PairedTransfer book={book} transaction={t} onRejected={() => navigate(back)} />}

      {reconciled.length > 0 && (
        <p className="card small reconciled-note">
          <span className="reconciled-mark" aria-hidden="true">
            ✓
          </span>{" "}
          Reconciled with{" "}
          {reconciled
            .map((r) => {
              const found = accounts.data?.find((a) => a.name === r.account);
              return `${displayName(found ?? { name: r.account })}'s ${formatDay(r.date)} statement`;
            })
            .join(" and ")}
          : changing its amounts or accounts can put that out of balance.
        </p>
      )}

      <label>
        Date
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
      </label>
      <label>
        Payee
        <input value={payee} onChange={(e) => setPayee(e.target.value)} placeholder="Optional" />
      </label>
      <label>
        Description
        <input value={narration} onChange={(e) => setNarration(e.target.value)} />
      </label>

      <SplitsFieldset splits={splits} accounts={names} create={create} />
      <ExcludeFromBudget meta={meta} onChange={setMeta} />

      {message && <p className={message.kind === "error" ? "error" : "ok"}>{message.text}</p>}
      {confirming && (
        <div className="card confirm-row" role="alertdialog" aria-label="Reconciled">
          <p className="small">
            It's reconciled: this change can put the statement out of balance. Save anyway?
          </p>
          <div className="actions">
            <button type="button" onClick={() => setConfirming(false)}>
              Cancel
            </button>
            <button type="button" className="primary" onClick={() => void submit(t.flag)}>
              Save anyway
            </button>
          </div>
        </div>
      )}

      <div className="actions pinned">
        <Link href={back} className="button">
          Back
        </Link>
        <button type="submit" disabled={busy || balance.state === "invalid"}>
          Save
        </button>
        {staged && (
          <button
            type="button"
            className="primary"
            disabled={busy || balance.state === "invalid" || uncategorized}
            title={uncategorized ? "Choose a category first" : undefined}
            onClick={() => void submit("*", back)}
          >
            Confirm
          </button>
        )}
      </div>
    </form>
  );
}
