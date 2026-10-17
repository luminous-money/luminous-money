import { useState } from "react";
import { Link, useLocation } from "wouter";

import { displayName, shortName, shown } from "../lib/accounts.js";
import { formatMoney, isNegative } from "../lib/decimal.js";
import { bookHome } from "../lib/books.js";
import { useParam, withBack } from "../lib/navigation.js";
import { AccountValueNote, headline } from "../components/AccountValue.js";
import { BankErrors, ReportedLine } from "../components/BankStatus.js";
import { BudgetGlance } from "../components/Budget.js";
import { TypicalPeriods } from "../components/TypicalPeriods.js";
import { HoldingsPanel } from "../components/Holdings.js";
import { JumpToDate, MoreBelow, NewerRow, usePaging } from "../components/Paged.js";
import { SelectBar } from "../components/SelectBar.js";
import { postable } from "../lib/accounts.js";
import { today } from "../lib/format.js";
import { useSelection } from "../lib/selection.js";
import { UNCATEGORIZED, withOtherSide } from "../lib/split.js";
import {
  explain,
  useAccountCreation,
  useAccountLedger,
  useAccounts,
  useBulkEdit,
  useSuggest,
  useScheduled,
  useSetStar,
  useStars,
  useBankStatus,
  useBudgetStatus,
  useSyncBank,
  useSummary,
  useUpcoming,
} from "../lib/queries.js";
import { upcomingFor } from "../lib/upcoming.js";

/**
 * One account's ledger: every transaction, newest first, 200 at a time, more loading as you
 * scroll. "Go to date" opens a partial view instead (`?date=`): from that date back, with
 * "Load more" above for the newer page before it, so pages load either way until it's all
 * there (components/Paged). A simple transaction shows the account on its other side; one with
 * more splits shows <multiple>. Tapping one opens it; the line above them adds a new one. Its header stars the
 * account (putting it on the home page) and links to importing into it. Amounts and balances
 * are shown as the account reads (a card's balance is what's owed); colors follow the stored
 * sign, the effect on net worth. Transactions a schedule staged are marked ↻, and its
 * occurrences coming in the next UPCOMING_DAYS (16) days show above, grayed, with the projected balance.
 */
export function AccountLedger({ book, account }: { book: string; account: string }) {
  const [, navigate] = useLocation();
  const date = useParam("date")?.match(/^\d{4}-\d{2}-\d{2}$/)?.[0];
  const ledger = useAccountLedger(book, account, date);
  const summary = useSummary(book, [account]);
  const info = summary.data?.[0];
  const stars = useStars(book);
  const bank = useBankStatus(book);
  const syncBank = useSyncBank();
  // A brokerage's feed is linked to the brokerage; its cash shows it too.
  const linked = bank.data?.[account] ?? bank.data?.[account.replace(/:Cash$/, "")];
  const setStar = useSetStar(book);
  const scheduled = useScheduled(book);
  const suggest = useSuggest(book, account);
  const bulk = useBulkEdit(book);
  const accounts = useAccounts(book);
  const create = useAccountCreation(book);
  const selection = useSelection();
  const [note, setNote] = useState<string | null>(null);
  const upcoming = useUpcoming(book);
  const budget = useBudgetStatus(book).data?.lines.find((l) => l.account === account);
  const ahead = upcoming.data && info ? upcomingFor(upcoming.data, account, info.balance) : [];
  const starred = stars.data?.includes(account) ?? false;
  const type = info?.type;
  const { rows, list, end, loadNewer } = usePaging(ledger);
  const base = `/books/${book}/accounts/${encodeURIComponent(account)}`;
  const here = date ? `${base}?date=${date}` : base;

  const open = (id: string) => navigate(withBack(`/books/${book}/transactions/${id}`, here));
  const chosen = rows.filter((r) => selection.has(r.id));
  const categorizeChosen = (category: string) => {
    const simpleOnes = chosen.filter((r) => r.splits === 2);
    const skipped = chosen.length - simpleOnes.length;
    setNote(skipped ? `Skipped ${skipped} with more than two splits.` : null);
    bulk.mutate(
      {
        transactions: simpleOnes,
        change: (t) => {
          const moved = withOtherSide(t, account, category);
          return moved && { postings: moved.postings };
        },
      },
      { onError: (e) => setNote(explain(e)) }
    );
  };
  const confirmChosen = () => {
    setNote(null);
    bulk.mutate(
      { transactions: chosen.filter((r) => r.flag === "!"), change: () => ({ flag: "*" }) },
      { onSuccess: selection.clear, onError: (e) => setNote(explain(e)) }
    );
  };

  return (
    <main>
      <header className="page-head">
        <Link href={bookHome(book)} className="back">
          ‹ Home
        </Link>
        <div className="home-head">
          <div>
            <h1>
              {displayName(info ?? { name: account })}{" "}
              <button
                type="button"
                className={`star${starred ? " on" : ""}`}
                aria-pressed={starred}
                aria-label="Starred"
                title={starred ? "Starred: on the home page" : "Star: show on the home page"}
                disabled={!stars.data || setStar.isPending}
                onClick={() => setStar.mutate({ account, starred: !starred })}
              >
                {starred ? "★" : "☆"}
              </button>
            </h1>
            {info && <p className="muted">{headline(info)}</p>}
            {info && <AccountValueNote account={info} />}
            {linked && <ReportedLine status={linked} type={info?.type} />}
            {linked && <BankErrors status={linked} />}
          </div>
          {info?.kind === "leaf" && !info.implicit && !info.close && (
            <Link
              href={withBack(`/books/${book}/import?account=${encodeURIComponent(account)}`, here)}
              className="button"
            >
              Import transactions
            </Link>
          )}
        </div>
        {budget && (
          <Link href={`/books/${book}/budgets`} className="budget-link" aria-label="Budget">
            <BudgetGlance line={budget} name={displayName(info ?? { name: account })} />
          </Link>
        )}
        {!selection.selecting && (
          <div className="actions">
            <button type="button" disabled={suggest.isPending} onClick={() => suggest.mutate()}>
              {suggest.isPending ? "Suggesting…" : "Suggest categories"}
            </button>
            <button type="button" onClick={selection.start}>
              Select
            </button>
            <Link
              href={`/books/${book}/accounts/${encodeURIComponent(account)}/edit`}
              className="button"
            >
              Edit
            </Link>
            {linked && (
              <button
                type="button"
                disabled={syncBank.isPending}
                onClick={() => syncBank.mutate(linked.connection_id)}
              >
                {syncBank.isPending ? "Syncing…" : "Sync now"}
              </button>
            )}
          </div>
        )}
        {suggest.data && (
          <p className="muted small" aria-live="polite">
            {suggest.data.suggested
              ? `Suggested categories for ${suggest.data.suggested}.`
              : "Nothing new to suggest."}
          </p>
        )}
      </header>

      {info && !selection.selecting && (
        <HoldingsPanel book={book} account={account} summary={info} here={here} />
      )}
      {info && !selection.selecting && <TypicalPeriods book={book} account={info} />}

      {selection.selecting ? (
        <SelectBar
          count={chosen.length}
          accounts={accounts.data ? postable(accounts.data, today()) : []}
          create={create}
          onCategorize={categorizeChosen}
          onConfirm={confirmChosen}
          canConfirm={!chosen.some((r) => r.counterpart === UNCATEGORIZED)}
          busy={bulk.isPending}
          note={note}
          onDone={selection.stop}
        />
      ) : (
        <div className="ledger-add">
          <button
            type="button"
            className="primary"
            onClick={() =>
              navigate(
                withBack(
                  `/books/${book}/transactions/new?account=${encodeURIComponent(account)}`,
                  here
                )
              )
            }
          >
            + Add transaction
          </button>
        </div>
      )}

      <JumpToDate
        key={date ?? ""}
        date={date}
        onGo={(to) => navigate(to ? `${base}?date=${to}` : base)}
      />

      {ledger.isPending && <p className="muted">Loading…</p>}
      {ledger.error && <p className="card error">{explain(ledger.error)}</p>}
      {ledger.data && rows.length === 0 && (
        <p className="card muted">
          {date ? `Nothing on or before ${date}.` : "No transactions yet."}
        </p>
      )}

      {ahead.length > 0 && !selection.selecting && !ledger.hasPreviousPage && (
        <ol className="ledger upcoming-rows" aria-label="Upcoming">
          {ahead.map((row) => (
            <li key={row.key}>
              <button
                type="button"
                className="ledger-row"
                onClick={() =>
                  navigate(withBack(`/books/${book}/schedules/${row.schedule_id}`, here))
                }
              >
                <span className="ledger-date">{row.date}</span>
                <span className="ledger-what">
                  <span className="ledger-payee">{row.label}</span>
                  <span className="ledger-account muted">↻ upcoming</span>
                </span>
                <span className="ledger-numbers">
                  <span className="amount">
                    {row.amount
                      ? formatMoney(shown(row.amount.number, type), row.amount.currency)
                      : "?"}
                  </span>
                  <span className="muted small">
                    {row.balance
                      ? `projected ${formatMoney(shown(row.balance.number, type), row.balance.currency)}`
                      : ""}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}

      <ol className="ledger" aria-label="Transactions" ref={list}>
        <NewerRow pages={ledger} onLoad={loadNewer} />
        {rows.map((row) => (
          <li key={row.id} data-row={row.id}>
            <button
              type="button"
              className={`ledger-row${row.flag === "!" ? " unconfirmed" : ""}${selection.has(row.id) ? " selected" : ""}`}
              onClick={() => (selection.selecting ? selection.toggle(row.id) : open(row.id))}
              {...(selection.selecting
                ? { role: "checkbox", "aria-checked": selection.has(row.id) }
                : {})}
            >
              <span className="ledger-date">{row.date}</span>
              <span className="ledger-what">
                <span className="ledger-payee">
                  {scheduled.data?.[row.id] && (
                    <span
                      className="scheduled"
                      role="img"
                      aria-label="Scheduled"
                      title="From a schedule"
                    >
                      ↻{" "}
                    </span>
                  )}
                  {row.payee ?? row.narration ?? "(no description)"}
                </span>
                <span className="ledger-account muted">
                  {row.counterpart ? shortName(row.counterpart) : "<multiple>"}
                  {row.flag === "!" && " · unconfirmed"}
                </span>
              </span>
              <span className="ledger-numbers">
                <span
                  className={`amount ${row.amount && !isNegative(row.amount.number) ? "in" : "out"}`}
                >
                  {row.amount
                    ? formatMoney(shown(row.amount.number, type), row.amount.currency)
                    : row.amounts?.length
                      ? // Several (a buy: cash out, shares in): one per line.
                        row.amounts.map((a) => (
                          <span key={a.currency} className="block">
                            {formatMoney(shown(a.number, type), a.currency)}
                          </span>
                        ))
                      : "?"}
                </span>
                <span className="muted small">
                  {/* A running balance in several currencies is noise here: Holdings has it. */}
                  {row.balance
                    ? formatMoney(shown(row.balance.number, type), row.balance.currency)
                    : ""}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ol>
      <MoreBelow pages={ledger} end={end} />
    </main>
  );
}
