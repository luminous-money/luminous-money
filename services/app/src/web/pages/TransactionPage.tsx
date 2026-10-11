import type { Posting, Transaction } from "@fava-beans/ledger-client";
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";

import { AccountPicker } from "../components/AccountPicker.js";
import { postable } from "../lib/accounts.js";
import { formatMoney, isDecimal } from "../lib/decimal.js";
import { today } from "../lib/format.js";
import {
  explain,
  useAccountCreation,
  useAccounts,
  useCreateTransaction,
  useEditTransaction,
  useTransaction,
} from "../lib/queries.js";
import { checkBalance, simple, UNCATEGORIZED } from "../lib/split.js";

/** A posting being edited. The amount stays a raw string until it's valid; anything the form
 * doesn't edit (cost, price, flag, metadata) rides along untouched in `original`. */
type Row = {
  key: number;
  account: string;
  number: string;
  currency: string;
  original: Partial<Posting>;
};

let nextKey = 0;

/** Blank amounts get the transaction's currency, so typing a number into one just works. */
function toRows(postings: Posting[], currency: string): Row[] {
  return postings.map((p) => ({
    key: nextKey++,
    account: p.account,
    number: p.units?.number ?? "",
    currency: p.units?.currency ?? currency,
    original: p,
  }));
}

function currencyOf(t: Transaction): string {
  return simple(t)?.currency ?? t.postings.find((p) => p.units)?.units?.currency ?? "USD";
}

function toPostings(rows: Row[]): Posting[] {
  return rows.map((r) => ({
    ...r.original,
    account: r.account,
    units: r.number.trim() ? { number: r.number.trim(), currency: r.currency.trim() } : null,
  }));
}

/** Where to go back to: the page that opened this one (`?back=`), else the review queue. */
function useBack(book: string): string {
  const back = new URLSearchParams(useSearch()).get("back");
  return back && back.startsWith("/") ? back : `/books/${book}/review`;
}

export function TransactionPage({ book, id }: { book: string; id: string }) {
  const loaded = useTransaction(book, id);
  const back = useBack(book);

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
  const account = new URLSearchParams(useSearch()).get("account") ?? "";
  const back = useBack(book);
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
  const fallbackCurrency = useMemo(() => currencyOf(t), [t]);
  const [rows, setRows] = useState(() => toRows(t.postings, fallbackCurrency));
  const busy = edit.isPending || add.isPending;
  const [message, setMessage] = useState<{ kind: "error" | "ok"; text: string } | null>(null);
  useEffect(() => setRows(toRows(t.postings, fallbackCurrency)), [t, fallbackCurrency]);
  const names = accounts.data ? postable(accounts.data, date) : [];
  const badAmount = rows.some(
    (r) => r.number.trim() && (!isDecimal(r.number.trim()) || !r.currency.trim())
  );
  const postings = toPostings(rows);
  const balance = badAmount
    ? ({
        state: "invalid",
        message: "Amounts must be numbers like 12.50, with a currency",
      } as const)
    : checkBalance(postings);
  const uncategorized = rows.some((r) => r.account === UNCATEGORIZED);
  const staged = t.flag === "!";

  const update = (key: number, change: Partial<Row>) =>
    setRows((all) => all.map((r) => (r.key === key ? { ...r, ...change } : r)));

  const submit = async (flag: string, then?: string) => {
    setMessage(null);
    try {
      const changes = { date, flag, payee: payee.trim() || null, narration, postings };
      if (isNew) {
        await add.mutateAsync({ ...changes, tags: [], links: [], meta: {} });
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
        <p>
          <span className={`pill ${staged ? "staged" : "confirmed"}`}>
            {staged ? "Staged" : "Confirmed"}
          </span>
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

      <fieldset className="postings">
        <legend>Splits</legend>
        {rows.map((r) => (
          <div className="posting" key={r.key}>
            <AccountPicker
              label="Account"
              accounts={names}
              value={r.account === UNCATEGORIZED ? "" : r.account}
              create={create}
              onChange={(account) => update(r.key, { account })}
            />
            <div className="posting-amount">
              <input
                aria-label="Amount"
                inputMode="decimal"
                placeholder="auto"
                value={r.number}
                onChange={(e) => update(r.key, { number: e.target.value })}
              />
              <input
                aria-label="Currency"
                className="currency"
                value={r.currency}
                placeholder={fallbackCurrency}
                onChange={(e) => update(r.key, { currency: e.target.value.toUpperCase() })}
              />
              <button
                type="button"
                aria-label="Remove split"
                className="icon"
                disabled={rows.length <= 1}
                onClick={() => setRows((all) => all.filter((x) => x.key !== r.key))}
              >
                ×
              </button>
            </div>
            {(r.original.cost || r.original.price) && (
              <p className="muted small">
                Has a {r.original.cost ? "cost basis" : "price"}; kept as is.
              </p>
            )}
          </div>
        ))}
        <button
          type="button"
          onClick={() =>
            setRows((all) => [
              ...all,
              { key: nextKey++, account: "", number: "", currency: fallbackCurrency, original: {} },
            ])
          }
        >
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
        <p className="muted small">Leave one amount blank to balance automatically.</p>
      </fieldset>

      {message && <p className={message.kind === "error" ? "error" : "ok"}>{message.text}</p>}

      <div className="actions">
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
