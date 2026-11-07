import type { Transaction } from "@luminous-money/ledger-client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";

import { AccountName, AccountPicker, type AccountCreation } from "../components/AccountPicker.js";
import { SelectBar } from "../components/SelectBar.js";
import { ReceiptNote } from "../components/ReceiptNote.js";
import { TagInput } from "../components/Tags.js";
import {
  filteredLabel,
  LedgerFilter,
  SearchBox,
  useLedgerView,
} from "../components/LedgerFilter.js";
import { useBulkActions } from "../lib/bulk.js";
import { ExcludeFromBudget } from "../components/ExcludeFromBudget.js";
import { FundChoice, shapesFor } from "../components/Funds.js";
import { PairedTransfer } from "../components/PairedTransfer.js";
import { BaseChoice } from "../components/BaseChoice.js";
import { PartChoice } from "../components/PartChoice.js";
import { Swipeable, type SwipeHandle } from "../components/Swipeable.js";
import { postable, preferredRoots, shortName } from "../lib/accounts.js";
import { add, formatMoney, isNegative, isZero, negate } from "../lib/decimal.js";
import { appApi, type ProposalSummary, type ProposedMatch } from "../lib/appApi.js";
import { bookHome } from "../lib/books.js";
import { today } from "../lib/format.js";
import { filtering, kept } from "../lib/filters.js";
import { useBack, useParam, withBack } from "../lib/navigation.js";
import { rememberPlace, useReturnToPlace } from "../lib/place.js";
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
  useFunds,
  useProposals,
  useScheduled,
  useBankStatus,
  useReviewQueue,
  useShort,
  useTags,
  writeSkipped,
} from "../lib/queries.js";
import { chosen, simple, UNCATEGORIZED, unresolved, withCounterpart } from "../lib/split.js";
import { aiCostSentence } from "../lib/ai.js";
import { holdingsOf, suggestedFund } from "../lib/funds.js";
import { wholeLines } from "../../shared/funds.js";
import type { ShortTransaction } from "../lib/ledger.js";

/**
 * The review queue: unconfirmed transactions to categorize and confirm, and imported rows matched
 * to transactions already in the account, whose matches are confirmed here too (or moved,
 * swapped, or undone). Categories proposed on import say where they came from. Select mode
 * acts on many at once: confirms them, categorizes them, or suggests their categories (rules,
 * history and the book's AI). A search (`?q=`) and a filter (`?account=`, any of them; `?tag=`,
 * every one) narrow what's shown. Back from a transaction opened here comes back to it.
 */
/** The single transactions (`?only=`) seen in review this session: once one has been, its being
 * gone means it was confirmed or skipped (here, or on its page and back), so review goes back. */
const seenOnly = new Set<string>();

export function Review({ book }: { book: string }) {
  const [, navigate] = useLocation();
  // Just one transaction (a receipt just captured, M16): confirming or skipping it goes `back`.
  const only = useParam("only");
  // What reading it cost the AI, if it was read (an estimate, from the ai service).
  const aiCost = useParam("ai_cost");
  const back = useBack(`/books/${book}/review`);
  const view = useLedgerView(`/books/${book}/review`);
  const search = useSearch();
  // Where links from a card come back to: here, as filtered (or the one transaction).
  const here = only ? `/books/${book}/review?${search}` : view.here;
  const queue = useReviewQueue(book);
  const accounts = useAccounts(book);
  const create = useAccountCreation(book);
  const scheduled = useScheduled(book);
  const bank = useBankStatus(book);
  const notAtBank = new Set(Object.values(bank.data ?? {}).flatMap((s) => s.not_at_bank));
  const proposals = useProposals(book);
  const bulk = useBulkEdit(book);
  const selection = useSelection();
  const [skipped, setSkipped] = useState(() => readSkipped(book));
  useEffect(() => writeSkipped(book, skipped), [book, skipped]);

  // Oldest first; skipped items go to the end, most recently skipped last.
  const items = (queue.items ?? []).filter((i) => !only || i.transaction.id === only);
  useEffect(() => {
    if (!only || !queue.items) return;
    if (items.length) seenOnly.add(only);
    else if (seenOnly.has(only)) navigate(back);
  }, [only, queue.items, items.length, back, navigate]);
  // A sale that takes shares no fund has comes first (Funds B): it can't be confirmed until
  // it's given one.
  const shortList = useShort(book).data ?? [];
  const short = new Map(shortList.map((s) => [s.id, s]));
  const waiting = items.filter((i) => !skipped.includes(i.transaction.id));
  const ordered = [
    ...waiting.filter((i) => short.has(i.transaction.id)),
    ...waiting.filter((i) => !short.has(i.transaction.id)),
    ...skipped.flatMap((id) => items.filter((i) => i.transaction.id === id)),
  ];
  const filtered = !only && filtering(view.filter);
  const shown = filtered ? ordered.filter((i) => kept(i.transaction, view.filter)) : ordered;
  const shownIds = queue.items ? shown.map((i) => i.transaction.id) : undefined;
  useReturnToPlace(`review:${book}`, shownIds);
  const queued = items.map((i) => i.transaction);
  const chosen = shown.filter((i) => selection.has(i.transaction.id));
  const bulkActions = useBulkActions({
    book,
    chosen: chosen.map((i) => i.transaction),
    accounts: accounts.data ? postable(accounts.data, today()) : [],
    create,
    categorize: (t, account) =>
      simple(t) ? { postings: withCounterpart(t, account).postings } : null,
    confirmBlocked:
      chosen.some((i) => i.transaction.postings.some((p) => unresolved(p.account))) &&
      "choose their accounts first",
    afterConfirm: async () => {
      for (const m of chosen.flatMap((i) => i.matches)) await appApi.confirmMatch(book, m);
    },
    onConfirmed: selection.clear,
  });

  return (
    <main>
      <header className="page-head">
        <Link href={only ? back : bookHome(book)} className="back">
          {only ? "‹ Back" : "‹ Books"}
        </Link>
        <h1>Review</h1>
        <p className="muted">
          {book}
          {queue.items &&
            (filtered
              ? ` · ${shown.length} of ${ordered.length} left`
              : ` · ${ordered.length} left`)}
        </p>
        {only && aiCost && Number.isFinite(Number(aiCost)) && (
          <p className="small muted" role="status">
            {aiCostSentence(Number(aiCost))}
          </p>
        )}
        <div className="actions">
          {!selection.selecting && (
            <button type="button" onClick={selection.start}>
              Select
            </button>
          )}
        </div>
      </header>

      {!only && (
        <div className="ledger-tools review-tools">
          <SearchBox
            value={view.q}
            onChange={(q) => navigate(view.href({ ...view.filter, q }), { replace: true })}
          />
          <LedgerFilter
            book={book}
            filter={view.filter}
            reconciliation={false}
            byAccount
            onChange={(filter) => navigate(view.href(filter))}
          />
        </div>
      )}

      {selection.selecting && (
        <SelectBar
          count={chosen.length}
          shown={shown.length}
          onSelectAll={() => selection.selectAll(shown.map((i) => i.transaction.id))}
          actions={bulkActions.actions}
          busy={bulkActions.busy}
          note={bulkActions.note}
          onDone={selection.stop}
        />
      )}

      {!queue.items && !queue.error && <p className="muted">Loading…</p>}
      {queue.error && <p className="card error">{explain(queue.error)}</p>}
      {queue.items && ordered.length === 0 && (
        <p className="card done">All caught up. Nothing is waiting for review.</p>
      )}
      {queue.items && ordered.length > 0 && shown.length === 0 && (
        <p className="card muted">No {filteredLabel(view.filter)} waiting for review.</p>
      )}

      <ol className="queue">
        {shown.map(({ transaction: t, matches }, index) => (
          <li
            key={t.id}
            data-place={t.id}
            // Opening anything from the card (its page, a rule, a fund) comes back to it.
            onClickCapture={(e) => {
              if (!(e.target as Element).closest("a[href]")) return;
              const ids = shown.map((i) => i.transaction.id);
              rememberPlace(
                `review:${book}`,
                t.id,
                ids.slice(index + 1),
                ids.slice(0, index).reverse()
              );
            }}
          >
            <QueueItem
              book={book}
              here={here}
              transaction={t}
              matches={matches}
              scheduled={!!scheduled.data?.[t.id]}
              notAtBank={notAtBank.has(t.id)}
              short={short.get(t.id)}
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
              onSkip={() =>
                only ? navigate(back) : setSkipped((s) => [...s.filter((x) => x !== t.id), t.id])
              }
            />
          </li>
        ))}
      </ol>
    </main>
  );
}

type ItemProps = {
  book: string;
  /** Where links from the card come back to. */
  here: string;
  transaction: Transaction;
  /** Import rows proposed as this transaction, if any. */
  matches: ProposedMatch[];
  /** Whether a schedule staged it (so it can be dropped: "Not this time"). */
  scheduled: boolean;
  /** Whether it's in a bank-linked account, in the bank's time, but the bank doesn't have it. */
  notAtBank: boolean;
  /** What it takes from a fund that doesn't have it (Funds B), if it does. */
  short?: ShortTransaction;
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

/** A split's `memo:`, what it is (a receipt's line). */
const memoOf = (p: { meta?: Record<string, unknown> | null }) =>
  typeof p.meta?.["memo"] === "string" ? (p.meta["memo"] as string) : null;

function QueueItem({
  book,
  here,
  transaction: t,
  matches,
  scheduled,
  notAtBank,
  short,
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
  const [tags, setTags] = useState(t.tags ?? []);
  useEffect(() => setTags(t.tags ?? []), [t.tags]);
  const bookTags = useTags(book);

  const view = useMemo(() => simple(t), [t]);
  const detail = withBack(`/books/${book}/transactions/${t.id}`, here);
  const busy = edit.isPending || confirmMatch.isPending;
  const blocked = t.postings.some((p) => unresolved(p.account));

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
  // A sale that takes shares no fund has: the only fund that could have made it is suggested, and
  // confirming writes it; with none, confirming waits for a fund.
  const listing = useFunds(book).data;
  const suggested =
    short && listing && !t.funds?.length
      ? suggestedFund(
          short.takes.map((s) => ({
            fund: s.fund,
            currency: s.amount.currency,
            takes: s.amount.number,
          })),
          holdingsOf(listing),
          listing.funds.filter((f) => !f.archived).map((f) => f.name)
        )
      : null;
  const needsFund = !!short && !suggested;
  const confirm = async () => {
    if (needsFund) {
      setError("Say which fund's shares it sells first.");
      return false;
    }
    const lines = suggested ? wholeLines(shapesFor(t.postings, listing?.currency), suggested) : [];
    if (
      t.flag === "!" &&
      !(await save({ flag: "*", narration, ...(lines.length ? { funds: lines } : {}) }))
    )
      return false;
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
      canConfirm={!blocked && !needsFund}
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
          {short && (
            <p className="small">
              <span className="pill stale">Needs a fund</span>{" "}
              <span className="muted">
                It takes{" "}
                {short.takes
                  .map((s) => `${formatMoney(s.amount.number, s.amount.currency)} from ${s.fund}`)
                  .join(" and ")}
                , which doesn't have {short.takes.length === 1 ? "it" : "them"}.
              </span>
            </p>
          )}
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

          <ReceiptNote meta={t.meta} />

          <BaseChoice
            book={book}
            postings={t.postings}
            onChange={(postings) => void save({ postings })}
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
                  href={withBack(`/books/${book}/rules/new?from=${t.id}`, here)}
                >
                  Remember as a rule…
                </Link>
              )}
            </div>
          ) : (
            <ul className="splits">
              {t.postings.map((p, i) =>
                // A split still to place (M16): what it is, its amount, and its account to pick.
                i > 0 && (p.flag === "!" || unresolved(p.account)) ? (
                  <li key={i} className={`open-split${unresolved(p.account) ? " needs" : ""}`}>
                    <span className="split-memo small muted">{memoOf(p) ?? "The rest"}</span>
                    <AccountPicker
                      label={memoOf(p) ?? `Split ${i}`}
                      accounts={accounts}
                      value={unresolved(p.account) ? "" : p.account}
                      prefer={preferredRoots(!p.units || !isNegative(p.units.number))}
                      create={create}
                      onChange={(account) =>
                        void save({
                          postings: t.postings.map((q, j) => (j === i ? chosen(q, account) : q)),
                        })
                      }
                    />
                    <span>{p.units ? formatMoney(p.units.number, p.units.currency) : "auto"}</span>
                  </li>
                ) : (
                  <li key={i}>
                    <AccountName name={p.account} />
                    <span>{p.units ? formatMoney(p.units.number, p.units.currency) : "auto"}</span>
                  </li>
                )
              )}
            </ul>
          )}

          <PairedTransfer book={book} transaction={t} />

          <PartChoice
            book={book}
            postings={t.postings}
            disabled={busy}
            onChange={(postings) => void save({ postings })}
          />

          <FundChoice
            book={book}
            transaction={t}
            here={here}
            disabled={busy}
            suggested={suggested}
            onChange={(funds) => void save({ funds })}
          />

          <div className="review-tags">
            <TagInput
              label="Tags"
              value={tags}
              choices={bookTags.data ?? []}
              onChange={(changed) => (setTags(changed), void save({ tags: changed }))}
            />
          </div>

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
              disabled={blocked || needsFund}
              title={
                blocked
                  ? "Choose its accounts first"
                  : needsFund
                    ? "Say which fund's shares it sells first"
                    : undefined
              }
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
