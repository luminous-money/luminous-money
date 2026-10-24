import { useState } from "react";
import { Link, useLocation } from "wouter";

import { displayName, shortName, shown } from "../lib/accounts.js";
import { formatMoney, isNegative } from "../lib/decimal.js";
import { bookHome } from "../lib/books.js";
import { withBack } from "../lib/navigation.js";
import { AccountValueNote, headline } from "../components/AccountValue.js";
import { BankErrors, ReportedLine } from "../components/BankStatus.js";
import { BudgetGlance } from "../components/Budget.js";
import { TypicalPeriods } from "../components/TypicalPeriods.js";
import { HoldingsPanel } from "../components/Holdings.js";
import { JumpToDate, MoreBelow, NewerRow, usePaging } from "../components/Paged.js";
import { LedgerFilter, useLedgerView } from "../components/LedgerFilter.js";
import { ReconcileStatus } from "../components/ReconcileStatus.js";
import { partOf, reconciledItself } from "../../shared/divided.js";
import { MoveMoney, PartsCard, partsOf } from "../components/Parts.js";
import { SelectBar } from "../components/SelectBar.js";
import { SuggestNote } from "../components/SuggestNote.js";
import { useBulkActions } from "../lib/bulk.js";
import { postable } from "../lib/accounts.js";
import { today } from "../lib/format.js";
import { useSelection } from "../lib/selection.js";
import { unresolved, withOtherSide } from "../lib/split.js";
import {
  explain,
  useAccountCreation,
  useAccountLedger,
  useAccounts,
  useAccountTree,
  useSuggest,
  useScheduled,
  useSetStar,
  useStars,
  useBankStatus,
  useBudgetStatus,
  useCanWrite,
  useSyncBank,
  useSummary,
  useUpcoming,
} from "../lib/queries.js";
import { upcomingFor } from "../lib/upcoming.js";
import type { LedgerRow } from "@luminous-money/ledger-client";

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
 * Reconciled ones are marked ✓ (M14); the filter beside "Go to date" shows only those, or only
 * the rest (`?reconciled=`), and Reconcile is in the header for an account reconciled itself.
 */
/**
 * A node's row (a divided account's, say: M15): which of its accounts it touched. A move between
 * them reads "General → Padding"; anything else, the part, then the other side.
 */
function partsLabel(row: LedgerRow, account: string): string | null {
  const parts = row.parts ?? [];
  if (!parts.length) return null;
  const name = (n: string) => n.slice(account.length + 1).replace(/-/g, " ");
  if (parts.length === row.splits && parts.length === 2) {
    const [a, b] = parts as [(typeof parts)[0], (typeof parts)[0]];
    const [from, to] = a.amount && isNegative(a.amount.number) ? [a, b] : [b, a];
    return `${name(from.account)} → ${name(to.account)}`;
  }
  const mine = [...new Set(parts.map((p) => name(p.account)))].join(", ");
  return `${mine} · ${row.counterpart ? shortName(row.counterpart) : "<multiple>"}`;
}

export function AccountLedger({ book, account }: { book: string; account: string }) {
  const [, navigate] = useLocation();
  const base = `/books/${book}/accounts/${encodeURIComponent(account)}`;
  const { date, reconciled, here, href } = useLedgerView(base);
  const ledger = useAccountLedger(book, account, date, reconciled);
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
  const accounts = useAccounts(book);
  const create = useAccountCreation(book);
  const selection = useSelection();
  const upcoming = useUpcoming(book);
  const canWrite = useCanWrite(book);
  const budget = useBudgetStatus(book).data?.lines.find((l) => l.account === account);
  const ahead = upcoming.data && info ? upcomingFor(upcoming.data, account, info.balance) : [];
  const starred = stars.data?.includes(account) ?? false;
  const type = info?.type;
  const { rows, list, end, loadNewer } = usePaging(ledger);
  const reconcilable = !!accounts.data && reconciledItself(accounts.data, account);
  // A divided account, or a part of one (M15): its parts, and moving money between them.
  const whole = info?.divided ? account : accounts.data && partOf(accounts.data, account);
  const tree = useAccountTree(book);
  const wholeInfo = whole ? tree.data?.find((a) => a.name === whole) : undefined;
  const [moving, setMoving] = useState(false);

  const open = (id: string) => navigate(withBack(`/books/${book}/transactions/${id}`, here));
  const chosen = rows.filter((r) => selection.has(r.id));
  const bulkActions = useBulkActions({
    book,
    chosen,
    accounts: accounts.data ? postable(accounts.data, today()) : [],
    create,
    categorize: (t, category) => {
      const moved = withOtherSide(t, account, category);
      return moved && { postings: moved.postings };
    },
    confirmBlocked:
      (unresolved(account) || chosen.some((r) => !!r.counterpart && unresolved(r.counterpart))) &&
      "choose their accounts first",
    onConfirmed: selection.clear,
  });

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
            {accounts.data && (
              <ReconcileStatus book={book} account={account} accounts={accounts.data} />
            )}
          </div>
          {canWrite &&
            (info?.kind === "leaf" || info?.divided) &&
            !info.implicit &&
            !info.close && (
              <Link
                href={withBack(
                  `/books/${book}/import?account=${encodeURIComponent(account)}`,
                  here
                )}
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
        {canWrite && !selection.selecting && (
          <div className="actions">
            <button type="button" disabled={suggest.isPending} onClick={() => suggest.mutate()}>
              {suggest.isPending ? "Suggesting…" : "Suggest categories"}
            </button>
            <button type="button" onClick={selection.start}>
              Select
            </button>
            {reconcilable && (
              <Link href={withBack(`${base}/reconcile`, here)} className="button">
                Reconcile
              </Link>
            )}
            {whole && whole !== account && (
              <button type="button" onClick={() => setMoving(!moving)} aria-expanded={moving}>
                Move money
              </button>
            )}
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
        {suggest.data && <SuggestNote book={book} suggested={suggest.data.suggested} />}
      </header>

      {info?.divided && wholeInfo && tree.data && !selection.selecting && (
        <PartsCard
          book={book}
          whole={wholeInfo}
          accounts={tree.data}
          currency={info.currencies?.[0] ?? info.balance[0]?.currency ?? "USD"}
        />
      )}
      {moving && wholeInfo && tree.data && info && (
        <MoveMoney
          book={book}
          parts={partsOf(tree.data, wholeInfo.name)}
          type={info.type}
          currency={info.currencies?.[0] ?? info.balance[0]?.currency ?? "USD"}
          start={{ from: account }}
          onDone={() => setMoving(false)}
        />
      )}
      {info && !selection.selecting && (
        <HoldingsPanel book={book} account={account} summary={info} here={here} />
      )}
      {info && !selection.selecting && <TypicalPeriods book={book} account={info} />}

      {selection.selecting ? (
        <SelectBar
          count={chosen.length}
          shown={rows.length}
          onSelectAll={() => selection.selectAll(rows.map((r) => r.id))}
          actions={bulkActions.actions}
          busy={bulkActions.busy}
          note={bulkActions.note}
          onDone={selection.stop}
        />
      ) : canWrite ? (
        <div className="ledger-add">
          <button
            type="button"
            className="primary"
            onClick={() =>
              navigate(
                withBack(
                  // A divided account's own postings are its parts': the main part, to start.
                  `/books/${book}/transactions/new?account=${encodeURIComponent(info?.divided && info.main_part ? info.main_part : account)}`,
                  here
                )
              )
            }
          >
            + Add transaction
          </button>
        </div>
      ) : null}

      <div className="ledger-tools">
        <JumpToDate
          key={date ?? ""}
          date={date}
          onGo={(to) => navigate(href({ date: to, reconciled }))}
        />
        <LedgerFilter
          reconciled={reconciled}
          onChange={(to) => navigate(href({ date, reconciled: to }))}
        />
      </div>

      {ledger.isPending && <p className="muted">Loading…</p>}
      {ledger.error && <p className="card error">{explain(ledger.error)}</p>}
      {ledger.data && rows.length === 0 && (
        <p className="card muted">
          {reconciled !== undefined
            ? `No ${reconciled ? "reconciled" : "unreconciled"} transactions${date ? ` on or before ${date}` : ""}.`
            : date
              ? `Nothing on or before ${date}.`
              : "No transactions yet."}
        </p>
      )}

      {ahead.length > 0 &&
        !selection.selecting &&
        !ledger.hasPreviousPage &&
        reconciled === undefined && (
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
                  {row.reconciled && (
                    <span
                      className="reconciled-mark"
                      role="img"
                      aria-label="Reconciled"
                      title={`Reconciled with the ${row.reconciled} statement`}
                    >
                      ✓{" "}
                    </span>
                  )}
                  {partsLabel(row, account) ??
                    (row.counterpart ? shortName(row.counterpart) : "<multiple>")}
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
