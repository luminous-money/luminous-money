import type { Transaction } from "@fava-beans/ledger-client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";

import { AccountName, AccountPicker, type AccountCreation } from "../components/AccountPicker.js";
import { SelectBar } from "../components/SelectBar.js";
import { ExcludeFromBudget } from "../components/ExcludeFromBudget.js";
import { Swipeable, type SwipeHandle } from "../components/Swipeable.js";
import { postable, preferredRoots, shortName } from "../lib/accounts.js";
import { add, formatMoney, isNegative, isZero, negate } from "../lib/decimal.js";
import { appApi, type ProposalSummary, type ProposedMatch } from "../lib/appApi.js";
import { bookHome } from "../lib/books.js";
import { today } from "../lib/format.js";
import { withBack } from "../lib/navigation.js";
import { useSelection } from "../lib/selection.js";
import { similarUnconfirmed } from "../lib/similar.js";
import {
  explain,
  readSkipped,
  useAccountCreation,
  useAccounts,
  useAssign,
  useBulkEdit,
  useConfirmMatch,
  useDropOccurrence,
  useEditTransaction,
  useProposals,
  useScheduled,
  useBankStatus,
  useReviewQueue,
  useSuggest,
  writeSkipped,
} from "../lib/queries.js";
import { simple, UNCATEGORIZED, withCounterpart } from "../lib/split.js";

/**
 * The review queue: unconfirmed transactions to categorize and confirm, and imported rows matched
 * to transactions already in the account, whose matches are confirmed here too (or moved,
 * swapped, or undone). Categories proposed on import say where they came from. "Suggest
 * categories" proposes for anything still uncategorized; Select mode categorizes or confirms
 * many at once.
 */
export function Review({ book }: { book: string }) {
  const queue = useReviewQueue(book);
  const accounts = useAccounts(book);
  const create = useAccountCreation(book);
  const scheduled = useScheduled(book);
  const bank = useBankStatus(book);
  const notAtBank = new Set(Object.values(bank.data ?? {}).flatMap((s) => s.not_at_bank));
  const proposals = useProposals(book);
  const suggest = useSuggest(book);
  const bulk = useBulkEdit(book);
  const selection = useSelection();
  const [note, setNote] = useState<string | null>(null);
  const [skipped, setSkipped] = useState(() => readSkipped(book));
  useEffect(() => writeSkipped(book, skipped), [book, skipped]);

  // Oldest first; skipped items go to the end, most recently skipped last.
  const items = queue.items ?? [];
  const ordered = [
    ...items.filter((i) => !skipped.includes(i.transaction.id)),
    ...skipped.flatMap((id) => items.filter((i) => i.transaction.id === id)),
  ];
  const queued = items.map((i) => i.transaction);
  const chosen = ordered.filter((i) => selection.has(i.transaction.id));
  const categorizeChosen = (account: string) => {
    const simpleOnes = chosen.map((i) => i.transaction).filter((t) => simple(t));
    const skipped = chosen.length - simpleOnes.length;
    setNote(skipped ? `Skipped ${skipped} with more than two splits.` : null);
    bulk.mutate(
      {
        transactions: simpleOnes,
        change: (t) => ({ postings: withCounterpart(t, account).postings }),
      },
      { onError: (e) => setNote(explain(e)) }
    );
  };
  const confirmChosen = async () => {
    setNote(null);
    try {
      await bulk.mutateAsync({
        transactions: chosen.map((i) => i.transaction).filter((t) => t.flag === "!"),
        change: () => ({ flag: "*" }),
      });
      for (const m of chosen.flatMap((i) => i.matches)) await appApi.confirmMatch(book, m);
      selection.clear();
    } catch (e) {
      setNote(explain(e));
    }
  };

  return (
    <main>
      <header className="page-head">
        <Link href={bookHome(book)} className="back">
          ‹ Books
        </Link>
        <h1>Review</h1>
        <p className="muted">
          {book}
          {queue.items && ` · ${ordered.length} left`}
        </p>
        <div className="actions">
          <button type="button" disabled={suggest.isPending} onClick={() => suggest.mutate()}>
            {suggest.isPending ? "Suggesting…" : "Suggest categories"}
          </button>
          {!selection.selecting && (
            <button type="button" onClick={selection.start}>
              Select
            </button>
          )}
        </div>
        {suggest.data && (
          <p className="muted small" aria-live="polite">
            {suggest.data.suggested
              ? `Suggested categories for ${suggest.data.suggested}.`
              : "Nothing new to suggest."}
          </p>
        )}
      </header>

      {selection.selecting && (
        <SelectBar
          count={chosen.length}
          accounts={accounts.data ? postable(accounts.data, today()) : []}
          create={create}
          onCategorize={categorizeChosen}
          onConfirm={() => void confirmChosen()}
          canConfirm={
            !chosen.some((i) => i.transaction.postings.some((p) => p.account === UNCATEGORIZED))
          }
          busy={bulk.isPending}
          note={note}
          onDone={selection.stop}
        />
      )}

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
              notAtBank={notAtBank.has(t.id)}
              proposal={proposals.data?.[t.id]}
              similar={(account) => ({
                account,
                others: similarUnconfirmed(t, queued, proposals.data),
              })}
              onCategorizeSimilar={(others, account) =>
                bulk.mutate({
                  transactions: others,
                  change: (o) => ({ postings: withCounterpart(o, account).postings }),
                })
              }
              selecting={selection.selecting}
              selected={selection.has(t.id)}
              onSelect={() => selection.toggle(t.id)}
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
  /** Whether it's in a bank-linked account, in the bank's time, but the bank doesn't have it. */
  notAtBank: boolean;
  /** What categorization proposed for it, if anything. */
  proposal: ProposalSummary | undefined;
  /** After picking `account` for it: the similar unconfirmed transactions to offer it to. */
  similar: (account: string) => { account: string; others: Transaction[] };
  onCategorizeSimilar: (others: Transaction[], account: string) => void;
  selecting: boolean;
  selected: boolean;
  onSelect: () => void;
  accounts: string[];
  create?: AccountCreation;
  onSkip: () => void;
};

function QueueItem({
  book,
  transaction: t,
  matches,
  scheduled,
  notAtBank,
  proposal,
  similar,
  onCategorizeSimilar,
  selecting,
  selected,
  onSelect,
  accounts,
  create,
  onSkip,
}: ItemProps) {
  const [offer, setOffer] = useState<{ account: string; others: Transaction[] } | null>(null);
  const edit = useEditTransaction(book, t.id);
  const drop = useDropOccurrence(book);
  const confirmMatch = useConfirmMatch(book);
  const swipe = useRef<SwipeHandle>(null);
  const [error, setError] = useState<string | null>(null);
  const [narration, setNarration] = useState(t.narration);
  const [nudge, setNudge] = useState(0);
  useEffect(() => setNarration(t.narration), [t.narration]);
  // Shown as changed right away, like the description, while the edit saves.
  const [meta, setMeta] = useState(t.meta);
  useEffect(() => setMeta(t.meta), [t.meta]);

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
  // it confirms the transaction if it's unconfirmed, and any matches proposed with it.
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
      disabled={selecting}
    >
      <article
        className={`card item${busy ? " busy" : ""}${selecting ? " selecting" : ""}${selected ? " selected" : ""}`}
        aria-label={`${t.payee ?? ""} ${t.narration}`}
      >
        {selecting && (
          // Tapping anywhere on the card selects it: this covers the card, so its own buttons,
          // links and fields can't be reached while selecting.
          <button
            type="button"
            role="checkbox"
            aria-checked={selected}
            aria-label="Select"
            className="select-overlay"
            onClick={onSelect}
          >
            <span className="select-mark" aria-hidden="true">
              {selected ? "✓" : ""}
            </span>
          </button>
        )}
        {/* While selecting, the card's own controls are inert (nor reachable by keyboard). */}
        <div inert={selecting}>
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
                onChange={(account) => {
                  void save({ postings: withCounterpart(t, account).postings });
                  const found = similar(account);
                  setOffer(found.others.length ? found : null);
                }}
              />
              {proposal?.categorizer && proposal.accounts[0] === view.counterpart.account && (
                <p className="small muted proposal">
                  Suggested by {proposal.categorizer}
                  {proposal.confidence !== null &&
                    ` (${Math.round(proposal.confidence * 100)}%)`}: {proposal.reason}
                </p>
              )}
              {offer && (
                <p className="small offer">
                  Also categorize {offer.others.length} similar as {shortName(offer.account)}?{" "}
                  <button
                    type="button"
                    className="plain"
                    onClick={() => (
                      onCategorizeSimilar(offer.others, offer.account),
                      setOffer(null)
                    )}
                  >
                    Yes
                  </button>{" "}
                  <button type="button" className="plain" onClick={() => setOffer(null)}>
                    No
                  </button>
                </p>
              )}
              {view.counterpart.account !== UNCATEGORIZED && (
                <Link
                  className="small remember"
                  href={withBack(`/books/${book}/rules/new?from=${t.id}`, `/books/${book}/review`)}
                >
                  Remember as a rule…
                </Link>
              )}
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

          <ExcludeFromBudget
            meta={meta}
            onChange={(changed) => (setMeta(changed), void save({ meta: changed }))}
          />

          {notAtBank && !scheduled && matches.length === 0 && (
            <p className="small">
              <span className="pill stale">Not at the bank</span>{" "}
              <span className="muted">Your bank doesn't have this one: keep it, or delete it.</span>
            </p>
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
