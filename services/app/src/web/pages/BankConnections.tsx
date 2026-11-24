import { AlertTriangle, Building2, Plus, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";

import { AccountPicker } from "../components/AccountPicker.js";
import { DefaultFundCard } from "../components/DefaultFund.js";
import { Info } from "../components/Info.js";
import { NewAccountField } from "../components/NewAccountField.js";
import { displayName } from "../lib/accounts.js";
import type {
  BankAccount,
  BankConnection,
  BankStatus,
  LinkAttempt,
  LinkMode,
  LinkPreview,
  LinkRequest,
  RereadPreview,
} from "../lib/appApi.js";
import { formatMoney } from "../lib/decimal.js";
import { formatReported, formatWhen, today } from "../lib/format.js";
import { useParam } from "../lib/navigation.js";
import {
  explain,
  useAccountCreation,
  useAccounts,
  useBankConnections,
  useBankStatus,
  useReread,
  useRereadPreview,
  useSetDividends,
  useConnectBank,
  useDisconnectBank,
  useAttemptLink,
  useBankAttempts,
  useCancelLink,
  useConfirmLink,
  useShareBank,
  useSyncBank,
  useUnlinkBank,
  useUnshareBank,
  useFunds,
} from "../lib/queries.js";
import { Loading } from "../components/Loading.js";

/**
 * Bank connections (SimpleFIN): connect with a setup token from SimpleFIN Bridge, share it with
 * this book (all its accounts, new ones too, or those chosen), then link each shared bank
 * account to an account in this book. Connections are yours, across books; this page shares and
 * links into the book you're in, where its other writers see what you shared, link it and sync
 * it. New transactions arrive every morning, or with "Sync now".
 */
export function BankConnections({ book }: { book: string }) {
  return (
    <main className="stack">
      <header className="page-head">
        <h1 className="with-info">
          Bank connections
          <Info label="About bank connections">
            <p>
              Bank accounts, cards and brokerages, kept up to date through{" "}
              <a href="https://bridge.simplefin.org/" target="_blank" rel="noreferrer">
                SimpleFIN Bridge
              </a>
              . Transactions arrive every morning and go through review, like an import.
            </p>
            <p>
              Connections are yours, across your books. You share each with a book (all its
              accounts, or the ones you choose), and the book&apos;s other members see only what you
              share. Links are the book&apos;s.
            </p>
          </Info>
        </h1>
      </header>
      <BankConnectionsPanel book={book} />
    </main>
  );
}

/** The page's connections and Connect, also a migration's bank feeds step. `?connection=<id>`
 * (the bell's link to a connection's problem) scrolls to that one. */
export function BankConnectionsPanel({ book }: { book: string }) {
  const connections = useBankConnections(book);
  const attempts = useBankAttempts(book);
  const shown = useParam("connection");
  // One just connected asks what to share with this book.
  const [fresh, setFresh] = useState<string | null>(null);
  return (
    <>
      {connections.isPending && <Loading />}
      {connections.error && <p className="card error">{explain(connections.error)}</p>}
      {connections.data?.map((c) => (
        <ConnectionCard
          key={c.id}
          book={book}
          connection={c}
          attempts={(attempts.data ?? []).filter((a) => a.connection_id === c.id)}
          shown={c.id === shown}
          fresh={c.id === fresh}
          onShared={() => setFresh(null)}
        />
      ))}
      {connections.data && <Connect folded={connections.data.length > 0} onConnected={setFresh} />}
    </>
  );
}

/** Connect: open for the first connection; then a button that opens it, for another. */
function Connect({ folded, onConnected }: { folded: boolean; onConnected: (id: string) => void }) {
  const connect = useConnectBank();
  const [token, setToken] = useState("");
  const [open, setOpen] = useState(!folded);
  if (!open)
    return (
      <div>
        <button type="button" onClick={() => setOpen(true)}>
          <Plus aria-hidden="true" className="button-icon" /> Connect another bank
        </button>
      </div>
    );
  return (
    <form
      className="card editor"
      aria-label="Connect a bank"
      onSubmit={(e) => {
        e.preventDefault();
        connect.mutate(token.trim(), {
          onSuccess: (connection) => {
            setToken("");
            onConnected(connection.id);
          },
        });
      }}
    >
      <h2 className="section-title with-info">
        Connect a bank
        <Info label="How to connect">
          At SimpleFIN Bridge, connect your banks, then make a setup token for luminous-money and
          paste it here. It works once.
        </Info>
      </h2>
      <label>
        Setup token
        <textarea
          value={token}
          onChange={(e) => setToken(e.target.value)}
          aria-label="Setup token"
          rows={3}
          autoComplete="off"
          spellCheck={false}
        />
      </label>
      {connect.error && <p className="error">{explain(connect.error)}</p>}
      <div className="actions">
        <button type="submit" className="primary" disabled={!token.trim() || connect.isPending}>
          {connect.isPending ? "Connecting…" : "Connect"}
        </button>
      </div>
    </form>
  );
}

function ConnectionCard({
  book,
  connection,
  attempts,
  shown,
  fresh,
  onShared,
}: {
  book: string;
  connection: BankConnection;
  attempts: LinkAttempt[];
  /** The one a link asked for: scrolled to. */
  shown: boolean;
  /** Just connected: what to share with the book is asked at once. */
  fresh: boolean;
  onShared: () => void;
}) {
  const sync = useSyncBank(book);
  const disconnect = useDisconnectBank();
  const [linking, setLinking] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const card = useRef<HTMLElement>(null);
  useEffect(() => {
    if (shown || fresh) card.current?.scrollIntoView({ block: "start" });
  }, [shown, fresh]);
  // The owner's own lists every account (to share); the book links only what's shared.
  const shared = connection.accounts.filter((a) => a.shared !== false);
  return (
    <section ref={card} className="card connection" aria-label={`Connection to ${connection.host}`}>
      <div className="connection-head">
        <div>
          {/* Named by its id: its banks are its accounts', and a connection can hold many. */}
          <h2 className="connection-name">SimpleFIN {connection.id.slice(0, 8)}</h2>
          {!connection.mine && (
            <p className="small muted">
              {connection.owner ? `${possessive(connection.owner)} connection` : "Shared with you"},
              shared with this book
            </p>
          )}
          <p className="small muted">
            {connection.last_sync_at
              ? `Synced ${formatWhen(connection.last_sync_at)}`
              : "Not synced yet"}
            <Info label="About this connection">
              <p>
                Through {connection.host}. {connection.requests_left} of{" "}
                {connection.requests_per_day} requests left today (SimpleFIN's limit; linking a long
                history takes several, Sync now one or two).
              </p>
            </Info>
          </p>
        </div>
        <button type="button" disabled={sync.isPending} onClick={() => sync.mutate(connection.id)}>
          <RefreshCw
            aria-hidden="true"
            className={`button-icon${sync.isPending ? " spinning" : ""}`}
          />
          {sync.isPending ? "Syncing…" : "Sync now"}
        </button>
      </div>
      {/* The Bridge's errors are plain strings about the connection as a whole: they say which
          bank in words, not in a field to file them under. */}
      {connection.errors.map((e, i) => (
        <p key={i} className={`connection-note small${e.notice ? "" : " problem"}`} title={e.code}>
          {e.notice ? (
            <Info label="Notice">{e.explained}</Info>
          ) : (
            <AlertTriangle aria-hidden="true" />
          )}
          {e.notice ? <span className="muted">A notice from SimpleFIN</span> : e.explained}
        </p>
      ))}
      {sync.data && (
        <p className="small ok" role="status">
          Synced: {sync.data.staged} new, {sync.data.matched} matched.
        </p>
      )}
      {sync.error && <p className="small error">{explain(sync.error)}</p>}
      {connection.mine &&
        (sharing || fresh ? (
          <ShareEditor
            book={book}
            connection={connection}
            fresh={fresh}
            onDone={() => {
              setSharing(false);
              onShared();
            }}
          />
        ) : (
          <ShareSummary connection={connection} onChange={() => setSharing(true)} />
        ))}
      {institutions(shared).map(([institution, accounts]) => (
        <section key={institution} className="institution" aria-label={institution || "Accounts"}>
          <InstitutionHead institution={institution} accounts={accounts} />
          <ul className="plain-list bank-accounts" aria-label="Bank accounts">
            {accounts.map((a) => (
              <li key={a.account_id}>
                <BankAccountRow
                  book={book}
                  connection={connection}
                  account={a}
                  attempt={attempts.find((x) => x.account_id === a.account_id)}
                  linking={linking === a.account_id}
                  onLink={() => setLinking(linking === a.account_id ? null : a.account_id)}
                  onDone={() => setLinking(null)}
                />
              </li>
            ))}
          </ul>
        </section>
      ))}
      {connection.mine && (
        <div className="connection-foot">
          <button
            type="button"
            className="plain danger"
            disabled={disconnect.isPending}
            onClick={() => {
              if (
                window.confirm(
                  "Disconnect? Its links stop syncing in every book it's shared with; everything brought in stays. To revoke access entirely, also remove luminous-money at SimpleFIN Bridge."
                )
              )
                disconnect.mutate(connection.id);
            }}
          >
            Disconnect
          </button>
        </div>
      )}
    </section>
  );
}

/** What the owner's connection shares with this book, in a line, and Change. */
function ShareSummary({
  connection,
  onChange,
}: {
  connection: BankConnection;
  onChange: () => void;
}) {
  const share = connection.share;
  const count = share ? connection.accounts.filter((a) => a.shared).length : 0;
  return (
    <p className="small share-summary">
      <span className={share ? "" : "muted"}>
        {!share
          ? "Not shared with this book."
          : share.all
            ? "Shared with this book: all its accounts, new ones too."
            : `Shared with this book: ${count} of its ${connection.accounts.length} ${connection.accounts.length === 1 ? "account" : "accounts"}.`}
      </span>{" "}
      <button type="button" className="plain" onClick={onChange}>
        {share ? "Change…" : "Share…"}
      </button>
    </p>
  );
}

/** Which of the owner's connection's accounts this book sees: all (new ones too, the choice to
 * start with), or those ticked. One linked here stays ticked: unlink it first. */
function ShareEditor({
  book,
  connection,
  fresh,
  onDone,
}: {
  book: string;
  connection: BankConnection;
  fresh: boolean;
  onDone: () => void;
}) {
  const share = useShareBank(book);
  const unshare = useUnshareBank(book);
  const current = connection.share;
  const [all, setAll] = useState(current ? current.all : true);
  // What's shared now; not shared yet, every account, to untick what isn't the book's.
  const [chosen, setChosen] = useState(
    () => new Set(connection.accounts.filter((a) => !current || a.shared).map((a) => a.account_id))
  );
  const linkedHere = (a: BankAccount) => a.link?.book_id === book;
  const linked = connection.accounts.filter(linkedHere);
  const toggle = (id: string) =>
    setChosen((was) => {
      const next = new Set(was);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const error = share.error ?? unshare.error;
  return (
    <form
      className="share-editor"
      aria-label="Shared with this book"
      onSubmit={(e) => {
        e.preventDefault();
        share.mutate(
          {
            id: connection.id,
            all,
            accounts: all ? [] : [...chosen],
            updated_at: current?.updated_at ?? null,
          },
          { onSuccess: onDone }
        );
      }}
    >
      <h3 className="section-title">
        {fresh ? "Which of its accounts should this book see?" : "Shared with this book"}
      </h3>
      <p className="small muted">
        Everyone in the book sees what you share, can link it and sync it. Only you change what it
        shares.
      </p>
      <label className="check">
        <input type="radio" name="share" checked={all} onChange={() => setAll(true)} />
        All its accounts, including new ones
      </label>
      <label className="check">
        <input type="radio" name="share" checked={!all} onChange={() => setAll(false)} />
        Only these:
      </label>
      {!all && (
        <ul className="plain-list share-accounts" aria-label="Accounts to share">
          {connection.accounts.map((a) => (
            <li key={a.account_id}>
              <label className="check">
                <input
                  type="checkbox"
                  checked={chosen.has(a.account_id) || linkedHere(a)}
                  disabled={linkedHere(a)}
                  onChange={() => toggle(a.account_id)}
                />
                <span>
                  {a.name}
                  <span className="small muted">
                    {" "}
                    {[a.institution, linkedHere(a) && "linked here"].filter(Boolean).join(" · ")}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="small error">{explain(error)}</p>}
      <div className="actions">
        {current && !linked.length && (
          <button
            type="button"
            className="plain"
            disabled={unshare.isPending}
            onClick={() =>
              unshare.mutate(
                { id: connection.id, updated_at: current.updated_at },
                { onSuccess: onDone }
              )
            }
          >
            Stop sharing
          </button>
        )}
        <button type="button" onClick={onDone}>
          {fresh ? "Not now" : "Cancel"}
        </button>
        <button
          type="submit"
          className="primary"
          disabled={share.isPending || (!all && chosen.size === 0 && !linked.length)}
        >
          {current ? "Save" : "Share"}
        </button>
      </div>
    </form>
  );
}

/** "Fidelity's", "Elsewhere Securities'". */
const possessive = (name: string) => (name.endsWith("s") ? `${name}'` : `${name}'s`);

/** A connection's accounts by the bank they're at, in the order the bank feed lists them. */
function institutions(accounts: BankAccount[]): [string, BankAccount[]][] {
  const by = new Map<string, BankAccount[]>();
  for (const a of accounts) by.set(a.institution, [...(by.get(a.institution) ?? []), a]);
  return [...by];
}

/** A bank's name over its accounts, and what's true of all of them: whether its brokerage
 * activity can be read (said once here, not on every account). */
function InstitutionHead({
  institution,
  accounts,
}: {
  institution: string;
  accounts: BankAccount[];
}) {
  const brokerages = accounts.filter((a) => a.kind === "brokerage");
  const read = brokerages.find((a) => a.reader);
  const unread = brokerages.find((a) => !a.reader);
  return (
    <>
      <h3 className="institution-name with-info">
        <Building2 aria-hidden="true" className="institution-icon" />
        {institution || "Other accounts"}
        {read && (
          <Info label={`How ${possessive(institution)} activity is read`}>
            <ReaderNote account={read} />
          </Info>
        )}
      </h3>
      {unread && (
        <p className="connection-note small">
          <AlertTriangle aria-hidden="true" />
          <span>
            Can&apos;t read {possessive(institution || "this brokerage")} activity yet: its rows
            come in as cash, for review.
            <Info label="Getting it read">
              <ReaderNote account={unread} />
            </Info>
          </span>
        </p>
      )}
    </>
  );
}

function BankAccountRow({
  book,
  connection,
  account,
  attempt,
  linking,
  onLink,
  onDone,
}: {
  book: string;
  connection: BankConnection;
  account: BankAccount;
  attempt: LinkAttempt | undefined;
  linking: boolean;
  onLink: () => void;
  onDone: () => void;
}) {
  const unlink = useUnlinkBank(book);
  const link = account.link;
  return (
    <>
      <div className="row-between bank-account">
        <span>
          {account.name}
          <span className="muted small block">
            {formatMoney(account.balance, account.currency)} · reported{" "}
            {formatReported(account.balance_date)}
            {account.kind === "brokerage" && " · brokerage"}
          </span>
          {link && link.book_id === book && (
            <span className="small block">
              Linked to{" "}
              <Link href={`/books/${book}/accounts/${encodeURIComponent(link.account)}`}>
                {displayName({ name: link.account })}
              </Link>
            </span>
          )}
          {link && link.book_id !== book && (
            <span className="small muted block">Linked in {link.book_name ?? "another book"}</span>
          )}
        </span>
        {!link && !attempt && (
          <button type="button" aria-expanded={linking} onClick={onLink}>
            Link…
          </button>
        )}
        {link && link.book_id === book && (
          <button
            type="button"
            disabled={unlink.isPending}
            onClick={() => unlink.mutate(link.id)}
            aria-label={`Unlink ${account.name}`}
          >
            Unlink
          </button>
        )}
      </div>
      {link && link.book_id === book && account.kind === "brokerage" && (
        <BrokerageLink book={book} account={account} linkId={link.id} name={link.account} />
      )}
      {link && link.book_id === book && <LinkedDefault book={book} account={link.account} />}
      {attempt && !link && <AttemptPanel book={book} attempt={attempt} />}
      {linking && !attempt && (
        <LinkForm book={book} connection={connection} account={account} onDone={onDone} />
      )}
    </>
  );
}

const REPO = "https://github.com/luminous-money/luminous-money";

/** Whether a brokerage's activity can be read: Fidelity's can; another's comes in as cash rows,
 * and how to get it read. */
function ReaderNote({ account }: { account: Pick<BankAccount, "reader" | "institution"> }) {
  if (account.reader)
    return (
      <p>
        {account.reader}'s activity is read: sweeps into and out of its core money market are left
        out, dividends are confirmed by themselves, and trades come in with their shares.
      </p>
    );
  const title = encodeURIComponent(`Read ${account.institution || "a brokerage"}'s activity`);
  return (
    <p>
      Luminous Money can't read {account.institution || "this brokerage"}'s activity yet: its rows
      come in as cash, for review.{" "}
      <a href={`${REPO}/issues/new?title=${title}`} target="_blank" rel="noreferrer">
        Open an issue
      </a>{" "}
      or{" "}
      <a
        href={`${REPO}/blob/main/services/app/src/server/simplefin/activity.ts`}
        target="_blank"
        rel="noreferrer"
      >
        send a pull request
      </a>{" "}
      with a reader for it.
    </p>
  );
}

/** A linked brokerage: what reading its rows did, where its dividends go, and Read again. */
function BrokerageLink({
  book,
  account,
  linkId,
  name,
}: {
  book: string;
  account: BankAccount;
  linkId: string;
  name: string;
}) {
  const status = useBankStatus(book).data?.[name];
  // Whether it's read at all is said once, over its bank's accounts.
  if (!status?.reader) return null;
  const a = status.activity;
  const parts = a
    ? [
        count(a.sweeps, "sweep", "sweeps", "left out"),
        count(a.dividends, "dividend", "dividends", "confirmed"),
        count(a.trades, "trade", "trades", "booked with their shares"),
        count(a.transfers_in, "transfer in", "transfers in", "from another broker"),
      ].filter(Boolean)
    : [];
  return (
    <div className="small">
      {parts.length > 0 && <p className="muted">From the bank's rows: {parts.join(", ")}.</p>}
      <DividendsChoice book={book} linkId={linkId} status={status} />
      <Reread book={book} linkId={linkId} />
    </div>
  );
}

/** Where a brokerage's dividends go: one income account, by default the one useful for taxes. */
function DividendsChoice({
  book,
  linkId,
  status,
}: {
  book: string;
  linkId: string;
  status: BankStatus;
}) {
  const accounts = useAccounts(book).data ?? [];
  const create = useAccountCreation(book);
  const set = useSetDividends(book);
  const income = accounts
    .filter((a) => a.kind === "leaf" && !a.implicit && !a.close && a.name.startsWith("Income:"))
    .map((a) => a.name);
  const choose = (dividends: string | null) =>
    set.mutate({ id: linkId, dividends, updated_at: status.updated_at });
  return (
    <details className="linked-default">
      <summary>Dividends go to {status.dividends}</summary>
      <p className="muted with-info">
        One income account for this brokerage&apos;s dividends.
        <Info label="Which account">
          By default, <code>Income:Dividends</code> for a taxable account (the year&apos;s is the
          1099-DIV&apos;s), and <code>Income:Retirement:Dividends</code> for a retirement account,
          whose dividends aren&apos;t taxed.
        </Info>
      </p>
      <AccountPicker
        label="Dividends account"
        accounts={income}
        value={status.dividends ?? ""}
        onChange={(a) => a && a !== status.dividends && choose(a)}
        create={create}
      />
      {status.dividends_chosen && (
        <button type="button" disabled={set.isPending} onClick={() => choose(null)}>
          Use the default
        </button>
      )}
      {set.error && <p className="error">{explain(set.error)}</p>}
    </details>
  );
}

/** "3 sweeps left out", or nothing for none. */
const count = (n: number, one: string, many: string, what: string) =>
  n ? `${n} ${n === 1 ? one : many} ${what}` : "";

/** Read a brokerage link again from what's already fetched: previewed, then confirmed. */
function Reread({ book, linkId }: { book: string; linkId: string }) {
  const preview = useRereadPreview(book);
  const reread = useReread(book);
  const shown: RereadPreview | undefined = preview.data;
  if (reread.data)
    return (
      <p className="ok" role="status">
        Read again: {reread.data.deleted} transactions replaced, {reread.data.kept} kept.
      </p>
    );
  return (
    <div className="reread">
      {!shown && (
        <button type="button" disabled={preview.isPending} onClick={() => preview.mutate(linkId)}>
          {preview.isPending ? "Working it out…" : "Read again…"}
        </button>
      )}
      {preview.error && <p className="error">{explain(preview.error)}</p>}
      {shown && (
        <section className="card small" aria-label="What reading it again will do">
          <p>
            Read again from the bank's rows already here (no SimpleFIN requests): what the bank
            brought into {displayName({ name: shown.account })} is replaced by what its rows say.
          </p>
          <ul className="plain-list">
            <li>
              {shown.rows} rows:{" "}
              {[
                count(shown.read.sweep, "sweep", "sweeps", "left out"),
                count(
                  shown.read.dividend,
                  "dividend",
                  "dividends",
                  `confirmed to ${shown.dividends}`
                ),
                count(shown.read.buy + shown.read.sell, "trade", "trades", "booked"),
                count(shown.read["shares-in"], "transfer of shares", "transfers of shares", "in"),
                count(
                  shown.read["cash-in"],
                  "cash transfer",
                  "cash transfers",
                  "from another broker"
                ),
                count(shown.read.other, "row", "rows", "as usual"),
              ]
                .filter(Boolean)
                .join(", ")}
            </li>
            <li>
              {shown.deleted} transactions deleted
              {shown.deleted_yours > 0 &&
                ` (${shown.deleted_yours} of them not from the bank)`}; {shown.kept} kept (transfers
              with other accounts, and what you made of the rest)
            </li>
            <li>
              Cash opens at {formatMoney(shown.opening.cash, shown.currency)} on{" "}
              {shown.opening.date}; {count(shown.positions, "position opens", "positions open", "")}
              {shown.positions > 0 && "at what the history leaves of today's shares"}
            </li>
          </ul>
          {reread.error && <p className="error">{explain(reread.error)}</p>}
          <div className="actions">
            <button type="button" onClick={() => preview.reset()}>
              Cancel
            </button>
            <button
              type="button"
              className="primary"
              disabled={reread.isPending}
              onClick={() => reread.mutate(linkId)}
            >
              {reread.isPending ? "Reading…" : "Read again"}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

/** A linked account's default fund (Funds B), folded away: "Default fund: Retirement". So a newly
 * linked IRA or HSA can be its fund's from the start. Only when the book has funds. */
function LinkedDefault({ book, account }: { book: string; account: string }) {
  const listing = useFunds(book).data;
  if (!listing || !listing.funds.some((f) => !f.archived)) return null;
  const current = (listing.defaults ?? [])
    .filter((d) => d.account === account && d.date <= today())
    .sort((a, b) => a.date.localeCompare(b.date))
    .at(-1);
  return (
    <details className="small linked-default">
      <summary>Default fund: {current?.fund ?? "none"}</summary>
      <DefaultFundCard book={book} account={account} bare />
    </details>
  );
}

/** A link being made: the bank's history coming in (you can leave the page), then what linking
 * will do, to confirm. */
function AttemptPanel({ book, attempt }: { book: string; attempt: LinkAttempt }) {
  const confirm = useConfirmLink(book);
  const cancel = useCancelLink(book);
  const target = displayName({ name: attempt.account });
  return (
    <div className="link-form" aria-label={`Linking to ${target}`} role="group">
      {attempt.state === "fetching" && (
        <p className="small" role="status">
          Getting the bank's history for {target}… This can take a few minutes: you can leave this
          page and come back.
        </p>
      )}
      {attempt.state === "waiting" && (
        <p className="small" role="status">
          Today's SimpleFIN requests ran out partway through the history. It carries on tomorrow
          morning; come back then to confirm.
        </p>
      )}
      {attempt.state === "failed" && <p className="small error">{attempt.error}</p>}
      {attempt.state === "ready" && attempt.preview && (
        <>
          <p className="small">Ready to link to {target}:</p>
          <PreviewSummary preview={attempt.preview} />
        </>
      )}
      {confirm.error && <p className="error">{explain(confirm.error)}</p>}
      <div className="actions">
        <button type="button" disabled={cancel.isPending} onClick={() => cancel.mutate(attempt.id)}>
          Cancel
        </button>
        {attempt.state === "ready" && (
          <button
            type="button"
            className="primary"
            disabled={confirm.isPending}
            onClick={() => confirm.mutate(attempt.id)}
          >
            {confirm.isPending ? "Linking…" : "Link"}
          </button>
        )}
      </div>
    </div>
  );
}

/** A name to suggest for a new account: assets, a card, or a brokerage. */
function suggestedName(account: BankAccount): string {
  const name = `${account.institution} ${account.name}`
    .replace(/[^A-Za-z0-9 ]/g, " ")
    .trim()
    .split(/\s+/)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join("-");
  if (account.kind === "brokerage") return `Assets:Investments:${name}`;
  return account.balance.startsWith("-")
    ? `Liabilities:Credit-Cards:${name}`
    : `Assets:Bank:${name}`;
}

const MODE_LABELS: Record<Exclude<LinkMode, "new">, [string, string]> = {
  reconcile: [
    "Reconcile with the bank (recommended)",
    "The bank's history is the source of truth: your transactions that match it are confirmed, the rest of yours from its first date wait in review, its new ones come in, and the opening balance is set so the books agree with the bank.",
  ],
  "from-date": [
    "Only what's new",
    "Bring in the bank's transactions from a date, reconciling nothing.",
  ],
  "start-over": [
    "Start over",
    "Delete every transaction in this account and bring in the bank's history fresh.",
  ],
};

function LinkForm({
  book,
  connection,
  account,
  onDone,
}: {
  book: string;
  connection: BankConnection;
  account: BankAccount;
  onDone: () => void;
}) {
  const accounts = useAccounts(book);
  const attempt = useAttemptLink(book);
  const [target, setTarget] = useState<"new" | "existing">("new");
  const [name, setName] = useState(suggestedName(account));
  const [existing, setExisting] = useState("");
  const [mode, setMode] = useState<Exclude<LinkMode, "new">>("reconcile");
  const [from, setFrom] = useState(today());
  const [typed, setTyped] = useState("");

  const leaves = (accounts.data ?? []).filter((a) => a.kind === "leaf" && !a.implicit && !a.close);
  const chosenAccount =
    target === "new"
      ? name
      : account.kind === "brokerage"
        ? existing.replace(/:Cash$/, "")
        : existing;
  const request: LinkRequest = {
    connection_id: connection.id,
    account_id: account.account_id,
    account: chosenAccount,
    mode: target === "new" ? "new" : mode,
    ...(target === "existing" && mode === "from-date" ? { from } : {}),
  };
  const ready =
    !!chosenAccount && (target === "new" || mode !== "start-over" || typed === existing);
  const reset = () => attempt.reset();

  return (
    <form
      className="editor link-form"
      aria-label={`Link ${account.name}`}
      onSubmit={(e) => {
        e.preventDefault();
        // Recorded now, fetched in the background: the preview shows up here when it's ready.
        attempt.mutate(request, { onSuccess: onDone });
      }}
    >
      <div className="segmented" role="radiogroup" aria-label="Link to">
        {(["new", "existing"] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={target === t}
            className={target === t ? "on" : ""}
            onClick={() => (setTarget(t), reset())}
          >
            {t === "new" ? "A new account" : "An account in this book"}
          </button>
        ))}
      </div>
      {target === "new" ? (
        <NewAccountField
          label="New account"
          name={name}
          onName={(n) => (setName(n), reset())}
          accounts={accounts.data ?? []}
        />
      ) : (
        <>
          <AccountPicker
            label="Account"
            accounts={leaves.map((a) => a.name)}
            value={existing}
            onChange={(a) => (setExisting(a), reset())}
          />
          <fieldset className="rule" onChange={reset}>
            <legend>How to start</legend>
            {(Object.keys(MODE_LABELS) as (keyof typeof MODE_LABELS)[]).map((m) => (
              <label key={m} className="check">
                <input type="radio" name="mode" checked={mode === m} onChange={() => setMode(m)} />
                <span>
                  {MODE_LABELS[m][0]}
                  <span className="muted small block">{MODE_LABELS[m][1]}</span>
                </span>
              </label>
            ))}
          </fieldset>
          {mode === "from-date" && (
            <label>
              From
              <input
                type="date"
                value={from}
                onChange={(e) => (setFrom(e.target.value), reset())}
              />
            </label>
          )}
          {mode === "start-over" && existing && (
            <label>
              Type the account's name ({existing}) to delete its transactions
              <input
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                aria-label="Name of the account to start over"
                autoComplete="off"
              />
            </label>
          )}
        </>
      )}
      {attempt.error && <p className="error">{explain(attempt.error)}</p>}
      <div className="actions">
        <button type="button" onClick={onDone}>
          Cancel
        </button>
        <button type="submit" className="primary" disabled={!ready || attempt.isPending}>
          Preview
        </button>
      </div>
    </form>
  );
}

function PreviewSummary({ preview }: { preview: LinkPreview }) {
  const money = (n: string) => formatMoney(n, preview.bank.currency);
  return (
    <section className="card done" aria-label="What linking will do">
      {!preview.history_complete && (
        <p className="error">
          The bank's history isn't all here yet (today's requests ran out). Try again tomorrow.
        </p>
      )}
      <ul className="plain-list small">
        <li>
          {preview.bank.transactions} transactions at the bank
          {preview.bank.from && `, from ${preview.bank.from}`}
        </li>
        {preview.mode === "reconcile" && (
          <>
            <li>{preview.matched} match yours, and are confirmed</li>
            <li>{preview.added} are new, for review</li>
            <li>{preview.not_at_bank} of yours aren't at the bank: they wait in review</li>
          </>
        )}
        {preview.mode === "start-over" && (
          <li>
            {preview.deleted} deleted
            {preview.deleted_elsewhere > 0 &&
              ` (${preview.deleted_elsewhere} also post to another account, which loses its side)`}
            ; {preview.added} come in for review
          </li>
        )}
        {(preview.mode === "new" || preview.mode === "from-date") && (
          <li>{preview.added} come in, for review</li>
        )}
        {preview.opening && (
          <li>
            Opening balance {money(preview.opening.amount)} on {preview.opening.date}
            {preview.opening.was !== null && ` (was ${money(preview.opening.was)})`}
          </li>
        )}
        {preview.kind === "brokerage" && preview.reader && (
          <li>
            {preview.reader}'s activity is read: sweeps left out, dividends confirmed, trades and
            transfers of shares booked with their shares; each holding opens at what its history
            leaves of today's shares, one estimated lot
          </li>
        )}
        {preview.kind === "brokerage" && !preview.reader && (
          <li>
            Its activity can't be read yet: its rows come in as cash
            {preview.mode === "new" &&
              "; each holding opens as one lot at its cost basis (an estimate: edit lots any time)"}
          </li>
        )}
      </ul>
    </section>
  );
}
