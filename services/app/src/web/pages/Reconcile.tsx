import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";

import { displayName, shortName, shown } from "../lib/accounts.js";
import type { ReconcileItem, ReconcileView } from "../lib/appApi.js";
import { add, formatMoney, isDecimal, isNegative, isZero, negate } from "../lib/decimal.js";
import { formatDay } from "../lib/format.js";
import { useBack } from "../lib/navigation.js";
import {
  explain,
  useAccounts,
  useCanWrite,
  useDiscardReconcileDraft,
  useFinishReconcile,
  useReconcileView,
  useReconciliations,
  useSaveReconcileDraft,
  useUndoReconciliation,
} from "../lib/queries.js";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Reconciling an account with a statement (M14): its date and ending balance (prefilled from
 * the bank or the last imported file), then each unreconciled transaction ticked off as it
 * appears on the statement (imported ones and the opening balance start ticked), with the
 * arithmetic pinned below: the starting balance plus what's ticked, against the statement.
 * Finish once the difference is zero; Save for later keeps it on the server for any device.
 * Past statements are listed after, with Undo on the latest.
 */
export function Reconcile({ book, account }: { book: string; account: string }) {
  const ledgerHref = `/books/${book}/accounts/${encodeURIComponent(account)}`;
  const back = useBack(ledgerHref);
  const accounts = useAccounts(book);
  const info = accounts.data?.find((a) => a.name === account);
  const [through, setThrough] = useState<string | undefined>();
  const view = useReconcileView(book, account, through);
  // Kept above the form, which starts over once finished (and on saving or dropping a draft).
  const [message, setMessage] = useState<Message | null>(null);
  const [round, setRound] = useState(0);

  return (
    <main className="stack">
      <header className="page-head">
        <Link href={back} className="back">
          ‹ Back
        </Link>
        <h1>Reconcile {displayName(info ?? { name: account })}</h1>
        <p className="muted">Tick off what's on the statement until the difference is zero.</p>
      </header>
      {view.isPending && <p className="muted">Loading…</p>}
      {view.error && <p className="card error">{explain(view.error)}</p>}
      {view.data && (
        <Statement
          key={`${round}-${view.data.draft ? "draft" : "new"}`}
          book={book}
          account={account}
          type={info?.type}
          view={view.data}
          onDate={(day) => {
            if (DAY.test(day)) setThrough(day);
          }}
          message={message}
          setMessage={setMessage}
          onFinished={() => (setThrough(undefined), setRound((r) => r + 1))}
        />
      )}
      <History book={book} account={account} type={info?.type} />
    </main>
  );
}

type Type = Parameters<typeof shown>[1];
type Message = { kind: "ok" | "error"; text: string };

function Statement({
  book,
  account,
  type,
  view,
  onDate,
  message,
  setMessage,
  onFinished,
}: {
  book: string;
  account: string;
  type: Type;
  view: ReconcileView;
  onDate: (day: string) => void;
  message: Message | null;
  setMessage: (message: Message | null) => void;
  onFinished: () => void;
}) {
  const canWrite = useCanWrite(book);
  const save = useSaveReconcileDraft(book, account);
  const discard = useDiscardReconcileDraft(book, account);
  const done = useFinishReconcile(book, account);
  const start = view.draft ?? view.prefill;
  const [date, setDate] = useState(start?.statement_date ?? "");
  const [balance, setBalance] = useState(start?.balance ? shown(start.balance, type) : "");
  // What you've ticked or unticked; the rest is as the server proposes.
  const [toggled, setToggled] = useState<Map<string, boolean>>(() => new Map());
  useEffect(() => {
    onDate(date);
  }, [date]); // eslint-disable-line react-hooks/exhaustive-deps

  const { state } = view;
  const proposed = useMemo(() => new Set(view.ticked), [view.ticked]);
  const isTicked = (id: string) => toggled.get(id) ?? proposed.has(id);
  const ticked = state.transactions.filter((t) => isTicked(t.id));
  const reached = ticked.reduce(
    (total, t) => add(total, t.amount.number),
    state.reconciled_balance.number
  );
  const typed = balance.replace(/[$,\s]/g, "");
  const statement = isDecimal(typed) ? shown(typed, type) : null;
  const difference = statement !== null ? add(statement, negate(reached)) : null;
  const valid = DAY.test(date) && !(state.last && date <= state.last);
  const balanced = valid && difference !== null && isZero(difference);
  const moving = valid
    ? state.transactions.filter((t) => (isTicked(t.id) ? t.date > date : t.date <= date)).length
    : 0;
  const money = (n: string) => formatMoney(shown(n, type), state.currency);
  const later = (t: ReconcileItem) => valid && t.date > date;
  const busy = save.isPending || discard.isPending || done.isPending;

  const tick = (id: string) => setToggled((m) => new Map(m).set(id, !isTicked(id)));
  // Awaited rather than `onSuccess`: finishing refetches the view, which can start this form
  // over (its draft gone) before a mutation callback would run. The message is the page's.
  const onFinish = async () => {
    setMessage(null);
    try {
      const r = await done.mutateAsync({
        statement_date: date,
        balance: statement!,
        transactions: ticked.map((t) => t.id),
      });
      setMessage({
        kind: "ok",
        text: `Reconciled ${r.reconciliation.transactions} through ${formatDay(date)}.${r.moved.length ? ` Moved ${r.moved.length} to agree with the statement.` : ""}`,
      });
      onFinished();
    } catch (e) {
      setMessage({ kind: "error", text: explain(e) });
    }
  };
  const onSave = () => {
    setMessage(null);
    save.mutate(
      {
        statement_date: DAY.test(date) ? date : null,
        balance: statement,
        ticked: ticked.map((t) => t.id),
        updated_at: view.draft?.updated_at ?? null,
      },
      {
        onSuccess: () => setMessage({ kind: "ok", text: "Saved: pick it up here any time." }),
        onError: (e) => setMessage({ kind: "error", text: explain(e) }),
      }
    );
  };

  return (
    <>
      <section className="card editor" aria-label="Statement">
        <h2 className="section-title">Statement</h2>
        {view.prefill && !view.draft && (
          <p className="small muted">
            {view.prefill.source === "bank"
              ? `From the bank: its balance at the end of ${formatDay(view.prefill.statement_date)}.`
              : `From the last file imported, which ends ${formatDay(view.prefill.statement_date)}.`}
          </p>
        )}
        {view.draft && <p className="small muted">Picked up where it was saved for later.</p>}
        <label>
          Statement date
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </label>
        {state.last && date && date <= state.last && (
          <p className="small error">
            It's reconciled through {formatDay(state.last)}: the next statement is later.
          </p>
        )}
        <label>
          Ending balance{type === "liability" ? " (owed)" : ""}
          <input
            inputMode="decimal"
            value={balance}
            onChange={(e) => setBalance(e.target.value)}
            placeholder="0.00"
          />
        </label>
      </section>

      <ol className="ledger reconcile-list" aria-label="Transactions">
        {state.transactions.length === 0 && (
          <li className="ledger-more" role="none">
            <span className="muted small">Nothing unreconciled.</span>
          </li>
        )}
        {state.transactions.map((t, i) => (
          <li key={t.id}>
            {later(t) && (i === 0 || !later(state.transactions[i - 1]!)) && (
              <p className="reconcile-group small muted">Dated after the statement</p>
            )}
            <button
              type="button"
              role="checkbox"
              aria-checked={isTicked(t.id)}
              className={`ledger-row reconcile-row${isTicked(t.id) ? " selected" : ""}`}
              disabled={!canWrite}
              onClick={() => tick(t.id)}
            >
              <span className="tick" aria-hidden="true">
                {isTicked(t.id) ? "✓" : ""}
              </span>
              <span className="ledger-date">{t.date}</span>
              <span className="ledger-what">
                <span className="ledger-payee">{t.payee ?? t.narration ?? "(no description)"}</span>
                <span className="ledger-account muted">
                  {t.opening
                    ? "Opening balance"
                    : t.counterpart
                      ? shortName(t.counterpart)
                      : "<multiple>"}
                  {t.flag === "!" && " · unconfirmed"}
                </span>
              </span>
              <span className="ledger-numbers">
                <span className={`amount ${isNegative(t.amount.number) ? "out" : "in"}`}>
                  {money(t.amount.number)}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ol>
      {state.internal > 0 && (
        <p className="small muted">
          {state.internal === 1
            ? "1 transfer between its accounts reconciles itself."
            : `${state.internal} transfers between its accounts reconcile themselves.`}
        </p>
      )}

      <div className="reconcile-sum actions pinned" role="region" aria-label="Difference">
        <dl className="reconcile-figures">
          <div>
            <dt>Starting</dt>
            <dd>{money(state.reconciled_balance.number)}</dd>
          </div>
          <div>
            <dt>Ticked ({ticked.length})</dt>
            <dd>{money(add(reached, negate(state.reconciled_balance.number)))}</dd>
          </div>
          <div>
            <dt>Statement</dt>
            <dd>{statement !== null ? money(statement) : "—"}</dd>
          </div>
          <div className={balanced ? "ok" : "error"}>
            <dt>Difference</dt>
            <dd aria-live="polite">{difference !== null ? money(difference) : "—"}</dd>
          </div>
        </dl>
        {balanced && moving > 0 && (
          <p className="small muted">
            Finishing moves{" "}
            {moving === 1 ? "1 transaction's date" : `${moving} transactions' dates`} to agree with
            the statement.
          </p>
        )}
        {message && <p className={`small ${message.kind}`}>{message.text}</p>}
        <div className="actions">
          {view.draft && (
            <button
              type="button"
              disabled={busy || !canWrite}
              onClick={() => (setMessage(null), discard.mutate())}
            >
              Discard
            </button>
          )}
          <button type="button" disabled={busy || !canWrite} onClick={onSave}>
            Save for later
          </button>
          <button
            type="button"
            className="primary"
            disabled={busy || !canWrite || !balanced}
            title={balanced ? undefined : "The difference has to be zero"}
            onClick={() => void onFinish()}
          >
            Finish
          </button>
        </div>
      </div>
    </>
  );
}

/** Past statements, newest first, each against the books; Undo takes the latest off. */
function History({ book, account, type }: { book: string; account: string; type: Type }) {
  const history = useReconciliations(book, account);
  const undo = useUndoReconciliation(book, account);
  const canWrite = useCanWrite(book);
  const items = history.data?.reconciliations ?? [];
  if (!items.length) return null;
  const latest = items.find((r) => r.statement);
  return (
    <section className="card" aria-label="Past statements">
      <h2 className="section-title">Past statements</h2>
      <ul className="plain-list">
        {items.map((r) => (
          <li key={r.id} className="statement-row">
            <span>
              {formatDay(r.statement_date)}
              <span className="muted small">
                {" "}
                · {formatMoney(shown(r.balance.number, type), r.balance.currency)}
                {r.statement
                  ? ` · ${r.transactions} transaction${r.transactions === 1 ? "" : "s"}${r.automatic ? " · with the bank" : ""}`
                  : " · a balance check"}
              </span>
              {r.off_by && (
                <span className="block small error">
                  Off by{" "}
                  {formatMoney(
                    isNegative(r.off_by.number) ? negate(r.off_by.number) : r.off_by.number,
                    r.off_by.currency
                  )}
                </span>
              )}
            </span>
            {r === latest && canWrite && (
              <button
                type="button"
                className="plain"
                disabled={undo.isPending}
                onClick={() => undo.mutate(r.statement_date)}
              >
                Undo
              </button>
            )}
          </li>
        ))}
      </ul>
      {undo.error && <p className="error">{explain(undo.error)}</p>}
    </section>
  );
}
