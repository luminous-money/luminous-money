import { useState } from "react";
import { Link, useLocation } from "wouter";

import { UNALLOCATED } from "../../shared/funds.js";
import {
  Dialog,
  DialogForm,
  MoveMoneyDialog,
  nameProblem,
  TargetProgress,
  targetProblem,
  typedAmount,
} from "../components/Funds.js";
import { formatMoney, isMoney, isNegative, negate } from "../lib/decimal.js";
import { formatDay, today } from "../lib/format.js";
import { signedMoney } from "../lib/funds.js";
import type { Fund, FundEntry, Funds } from "../lib/ledger.js";
import { withBack } from "../lib/navigation.js";
import {
  explain,
  useArchiveFund,
  useCanManage,
  useCanWrite,
  useDeleteFund,
  useFundHistory,
  useFunds,
  useFundStars,
  usePatchFund,
  useRenameFund,
  useSetFundStar,
  useUnarchiveFund,
} from "../lib/queries.js";
import { ApiError } from "../lib/ledger.js";

const money = (a: { number: string; currency: string }) => formatMoney(a.number, a.currency);

type Move = NonNullable<Parameters<typeof MoveMoneyDialog>[0]["move"]>;

/** A move in a fund's history, as the move it is (from, to, how much). */
function moveOf(fund: string, e: FundEntry): Move {
  const into = !isNegative(e.amount.number);
  return {
    id: e.id,
    from_fund: into ? (e.other ?? UNALLOCATED) : fund,
    to_fund: into ? fund : (e.other ?? UNALLOCATED),
    amount: into ? e.amount : { ...e.amount, number: negate(e.amount.number) },
    date: e.date,
    note: e.note,
    updated_at: e.updated_at,
  };
}

/** A fund's history with a transaction's lines together (a trade: what it gave and got). */
function grouped(entries: FundEntry[]): FundEntry[][] {
  const out: FundEntry[][] = [];
  for (const e of entries) {
    const last = out.at(-1);
    if (last && e.kind === "transaction" && last[0]!.kind === "transaction" && last[0]!.id === e.id)
      last.push(e);
    else out.push([e]);
  }
  return out;
}

/**
 * A fund's page: its balance, target and description; what it holds (each holding's price and
 * value) and the accounts it's the default fund of (Funds B); Move money (from or to it); for
 * managers Settings (name, description, target), Archive… (where what's left goes, and when) or
 * Unarchive, and Delete (only with no history); and its history, newest first, with a running
 * balance per commodity. A transaction opens its page; a move opens to change or delete it.
 */
export function FundPage({ book, name }: { book: string; name: string }) {
  const [, navigate] = useLocation();
  const history = useFundHistory(book, name);
  const listing = useFunds(book);
  const canWrite = useCanWrite(book);
  const canManage = useCanManage(book);
  const unarchive = useUnarchiveFund(book);
  const remove = useDeleteFund(book);
  const stars = useFundStars(book);
  const setStar = useSetFundStar(book);
  const [dialog, setDialog] = useState<
    { kind: "move"; move?: Move } | { kind: "settings" } | { kind: "archive" } | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const fund = history.data?.fund;
  const entries = history.data?.entries ?? [];
  const list = `/books/${book}/funds`;
  const here = `${list}/${encodeURIComponent(name)}`;
  const missing = history.error instanceof ApiError && history.error.status === 404;
  // A fund only used (an imported book's, with no declaration) has no settings to change.
  const declared = !!fund?.updated_at;

  const act = async (run: () => Promise<unknown>) => {
    setError(null);
    try {
      await run();
    } catch (e) {
      setError(explain(e));
    }
  };

  return (
    <main>
      <header className="page-head">
        <Link href={list} className="back">
          ‹ Funds
        </Link>
        <h1>
          {fund?.name ?? name}{" "}
          {fund && !fund.archived && (
            <StarButton
              starred={!!stars.data?.some((s) => s.toLowerCase() === fund.name.toLowerCase())}
              disabled={!stars.data || setStar.isPending}
              onToggle={(starred) => setStar.mutate({ fund: fund.name, starred })}
            />
          )}
        </h1>
        {fund?.description && <p className="muted">{fund.description}</p>}
      </header>

      {history.isPending && <p className="muted">Loading…</p>}
      {missing && (
        <p className="card">
          There&apos;s no fund called {name}. <Link href={list}>All funds</Link>
        </p>
      )}
      {history.error && !missing && <p className="card error">{explain(history.error)}</p>}

      {fund && (
        <section className="card fund-head" aria-label="Balance">
          <div className="account-card-top">
            <span className="muted small">
              {fund.archived ? `Archived ${formatDay(fund.archived)}` : "Balance"}
            </span>
            <span className={`balance${isNegative(fund.value.number) ? " negative" : ""}`}>
              {money(fund.value)}
            </span>
          </div>
          <TargetProgress fund={fund} />
          {fund.holdings.some((h) => h.amount.currency !== fund.value.currency) && (
            <table className="fund-holdings-table" aria-label="Holdings">
              <thead>
                <tr>
                  <th>Holds</th>
                  <th className="num">Price</th>
                  <th className="num">Value</th>
                </tr>
              </thead>
              <tbody>
                {fund.holdings.map((h) => (
                  <tr key={h.amount.currency}>
                    <td className={isNegative(h.amount.number) ? "negative" : undefined}>
                      {isMoney(h.amount.currency) && h.amount.currency === fund.value.currency
                        ? `Cash ${money(h.amount)}`
                        : money(h.amount)}
                    </td>
                    <td className="num muted small">
                      {h.price ? (
                        <>
                          {money(h.price)}
                          {h.price_date && <span> · {formatDay(h.price_date)}</span>}
                        </>
                      ) : (
                        ""
                      )}
                    </td>
                    <td className="num">{h.value ? money(h.value) : "no price"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {fund.accounts && fund.accounts.length > 0 && (
            <p className="small muted">
              The default fund of{" "}
              {fund.accounts.map((a, i) => (
                <span key={a}>
                  {i > 0 && ", "}
                  <Link href={withBack(`/books/${book}/accounts/${a}`, here)}>{a}</Link>
                </span>
              ))}
              : what changes there is {fund.name}&apos;s unless a transaction says otherwise.
            </p>
          )}
          {(canWrite || canManage) && (
            <div className="actions fund-actions">
              {canWrite && !fund.archived && (
                <button type="button" onClick={() => setDialog({ kind: "move" })}>
                  Move money
                </button>
              )}
              {canManage && declared && (
                <button type="button" onClick={() => setDialog({ kind: "settings" })}>
                  Settings
                </button>
              )}
              {canManage && declared && !fund.archived && (
                <button type="button" onClick={() => setDialog({ kind: "archive" })}>
                  Archive…
                </button>
              )}
              {canManage && declared && fund.archived && (
                <button
                  type="button"
                  disabled={unarchive.isPending}
                  onClick={() =>
                    void act(() =>
                      unarchive.mutateAsync({ name: fund.name, updated_at: fund.updated_at! })
                    )
                  }
                >
                  Unarchive
                </button>
              )}
              {canManage && declared && fund.entries === 0 && (
                <button
                  type="button"
                  className="danger"
                  disabled={remove.isPending}
                  onClick={() => {
                    if (!window.confirm(`Delete ${fund.name}? It has no history.`)) return;
                    void act(async () => {
                      await remove.mutateAsync({ name: fund.name, updated_at: fund.updated_at! });
                      navigate(list);
                    });
                  }}
                >
                  Delete
                </button>
              )}
            </div>
          )}
          {error && <p className="error">{error}</p>}
        </section>
      )}

      {fund && (
        <section className="fund-history" aria-label="History">
          <h2 className="section-title">History</h2>
          {entries.length === 0 ? (
            <p className="card done">
              Nothing yet. Move money into it, or choose it on a transaction: &ldquo;To&rdquo; on
              money coming in, &ldquo;From&rdquo; on spending, &ldquo;For&rdquo; on a transfer.
            </p>
          ) : (
            <ol className="ledger" aria-label="History">
              {grouped(entries).map((group) => {
                const e = group[0]!;
                const move = e.kind === "move";
                const into = !isNegative(e.amount.number);
                const title = move
                  ? `Moved ${into ? "from" : "to"} ${e.other ?? UNALLOCATED}`
                  : (e.payee ?? e.narration ?? "(no description)");
                const detail = move
                  ? (e.note ?? "")
                  : [e.payee && e.narration, e.flag === "!" && "unconfirmed"]
                      .filter(Boolean)
                      .join(" · ");
                return (
                  <li key={`${e.kind}:${e.id}`}>
                    <button
                      type="button"
                      className={`ledger-row${e.flag === "!" ? " unconfirmed" : ""}`}
                      disabled={move && !canWrite}
                      onClick={() =>
                        move
                          ? setDialog({ kind: "move", move: moveOf(fund.name, e) })
                          : navigate(withBack(`/books/${book}/transactions/${e.id}`, here))
                      }
                    >
                      <span className="ledger-date">{e.date}</span>
                      <span className="ledger-what">
                        <span className="ledger-payee">{title}</span>
                        <span className="ledger-account muted">
                          {detail || (move ? "Move" : "")}
                        </span>
                      </span>
                      <span className="ledger-numbers">
                        {group.map((g) => (
                          <span key={g.amount.currency} className="fund-entry-amount">
                            <span
                              className={`amount ${isNegative(g.amount.number) ? "out" : "in"}`}
                            >
                              {signedMoney(g.amount.number, g.amount.currency)}
                            </span>
                            <span className="muted small">{money(g.balance)}</span>
                          </span>
                        ))}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      )}

      {fund && dialog?.kind === "move" && (
        <MoveMoneyDialog
          book={book}
          start={{ to: fund.name }}
          move={dialog.move}
          onClose={() => setDialog(null)}
        />
      )}
      {fund && dialog?.kind === "settings" && (
        <FundSettings
          book={book}
          fund={fund}
          listing={listing.data}
          onDone={(saved) => {
            setDialog(null);
            if (saved && saved.name !== fund.name)
              navigate(`${list}/${encodeURIComponent(saved.name)}`, { replace: true });
          }}
        />
      )}
      {fund && dialog?.kind === "archive" && (
        <ArchiveFund
          book={book}
          fund={fund}
          listing={listing.data}
          last={entries[0]?.date}
          onDone={() => setDialog(null)}
        />
      )}
    </main>
  );
}

/** A fund's settings: its name (renamed everywhere: lines, moves, rules, schedules),
 * description and target. */
function FundSettings({
  book,
  fund,
  listing,
  onDone,
}: {
  book: string;
  fund: Fund;
  listing: Funds | undefined;
  onDone: (saved?: Fund) => void;
}) {
  const patch = usePatchFund(book);
  const rename = useRenameFund(book);
  const [name, setName] = useState(fund.name);
  const [description, setDescription] = useState(fund.description ?? "");
  const [target, setTarget] = useState(fund.target?.number ?? "");
  const [error, setError] = useState<string | null>(null);
  const renamed = name.split(/\s+/).filter(Boolean).join(" ") !== fund.name;
  const problem = (renamed && nameProblem(name, listing, fund.name)) || targetProblem(target);
  const busy = patch.isPending || rename.isPending;

  const submit = async () => {
    if (problem || busy) return;
    setError(null);
    const number = typedAmount(target);
    const described = (description.trim() || null) !== (fund.description ?? null);
    const targeted = (number ?? null) !== (fund.target?.number ?? null);
    try {
      let saved = fund;
      if (described || targeted)
        saved = await patch.mutateAsync({
          name: fund.name,
          patch: {
            updated_at: fund.updated_at!,
            ...(described ? { description: description.trim() || null } : {}),
            ...(targeted
              ? { target: number ? { number, currency: fund.value.currency } : null }
              : {}),
          },
        });
      if (renamed)
        saved = await rename.mutateAsync({
          name: fund.name,
          to: name,
          updated_at: saved.updated_at!,
        });
      onDone(saved);
    } catch (e) {
      setError(explain(e));
    }
  };

  return (
    <Dialog title="Fund settings" onClose={() => onDone()}>
      <DialogForm onSubmit={() => void submit()} label="Fund settings">
        <label>
          Name
          <input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
          {renamed && (
            <span className="small muted">
              Every transaction, move, rule and schedule that names it follows.
            </span>
          )}
        </label>
        <label>
          <span>
            Description <span className="muted small">(optional)</span>
          </span>
          <input
            value={description}
            maxLength={200}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <label>
          <span>
            Target <span className="muted small">(optional: shown as progress)</span>
          </span>
          <input
            inputMode="decimal"
            value={target}
            placeholder="0.00"
            onChange={(e) => setTarget(e.target.value)}
          />
        </label>
        {problem && <p className="small error">{problem}</p>}
        {error && <p className="error">{error}</p>}
        <div className="actions">
          <button type="button" onClick={() => onDone()}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={!!problem || busy || !name.trim()}>
            Save
          </button>
        </div>
      </DialogForm>
    </Dialog>
  );
}

/** Archive a fund: what's left in it goes to Unallocated or another fund, on a day no earlier
 * than its last entry; it leaves the pickers, and its history stays. */
function ArchiveFund({
  book,
  fund,
  listing,
  last,
  onDone,
}: {
  book: string;
  fund: Fund;
  listing: Funds | undefined;
  /** Its newest entry's date. */
  last?: string;
  onDone: () => void;
}) {
  const archive = useArchiveFund(book);
  const [to, setTo] = useState(UNALLOCATED);
  const [date, setDate] = useState(last && last > today() ? last : today());
  const [error, setError] = useState<string | null>(null);
  const others = listing?.funds.filter((f) => !f.archived && f.name !== fund.name) ?? [];
  const early = !!last && date < last;
  const left = fund.value;
  // What's left, when it's more than money: "$1,000.00, 100 FXAIX and 10 VTI, worth $25,000.00".
  const what =
    fund.holdings.length > 1 || fund.holdings.some((h) => h.amount.currency !== left.currency)
      ? `${fund.holdings
          .map((h) => money(h.amount))
          .join(", ")
          .replace(/, ([^,]*)$/, " and $1")}, worth ${money(left)}`
      : money(left);

  const submit = async () => {
    if (early || archive.isPending) return;
    setError(null);
    try {
      await archive.mutateAsync({ name: fund.name, updated_at: fund.updated_at!, date, to });
      onDone();
    } catch (e) {
      setError(explain(e));
    }
  };

  return (
    <Dialog title={`Archive ${fund.name}`} onClose={onDone}>
      <DialogForm onSubmit={() => void submit()} label="Archive">
        <p className="small">
          It leaves the pickers, and its history stays: you can unarchive it later.
        </p>
        <label>
          {isNegative(left.number)
            ? `What it's short (${what}) comes from`
            : `What's left (${what}) goes to`}
          <select value={to} onChange={(e) => setTo(e.target.value)}>
            <option value={UNALLOCATED}>{UNALLOCATED}</option>
            {others.map((f) => (
              <option key={f.name} value={f.name}>
                {f.name} · {money(f.value)}
              </option>
            ))}
          </select>
        </label>
        <label>
          On
          <input
            type="date"
            value={date}
            min={last}
            required
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        {early && (
          <p className="small error">
            It has entries up to {formatDay(last!)}: archive it then or later.
          </p>
        )}
        {error && <p className="error">{error}</p>}
        <div className="actions">
          <button type="button" onClick={onDone}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={early || archive.isPending}>
            Archive
          </button>
        </div>
      </DialogForm>
    </Dialog>
  );
}

/** A fund's star: starred funds are the ones home's Funds card shows. */
function StarButton({
  starred,
  disabled,
  onToggle,
}: {
  starred: boolean;
  disabled: boolean;
  onToggle: (starred: boolean) => void;
}) {
  return (
    <button
      type="button"
      className={`star${starred ? " on" : ""}`}
      aria-pressed={starred}
      aria-label="Starred"
      title={starred ? "Starred: on the home page" : "Star: show on the home page"}
      disabled={disabled}
      onClick={() => onToggle(!starred)}
    >
      {starred ? "★" : "☆"}
    </button>
  );
}
