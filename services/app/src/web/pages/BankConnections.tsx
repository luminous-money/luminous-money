import { useState } from "react";
import { Link } from "wouter";

import { AccountPicker } from "../components/AccountPicker.js";
import { NewAccountField } from "../components/NewAccountField.js";
import { displayName } from "../lib/accounts.js";
import type {
  BankAccount,
  BankConnection,
  LinkAttempt,
  LinkMode,
  LinkPreview,
  LinkRequest,
} from "../lib/appApi.js";
import { formatMoney } from "../lib/decimal.js";
import { formatReported, formatWhen, today } from "../lib/format.js";
import {
  explain,
  useAccounts,
  useBankConnections,
  useConnectBank,
  useDisconnectBank,
  useAttemptLink,
  useBankAttempts,
  useCancelLink,
  useConfirmLink,
  useSyncBank,
  useUnlinkBank,
} from "../lib/queries.js";

/**
 * Bank connections (SimpleFIN): connect with a setup token from SimpleFIN Bridge, then link each
 * bank account to an account in this book. Connections are yours, across books; this page links
 * into the book you're in. New transactions arrive every morning, or with "Sync now".
 */
export function BankConnections({ book }: { book: string }) {
  const connections = useBankConnections();
  const attempts = useBankAttempts(book);
  return (
    <main className="stack">
      <header className="page-head">
        <h1>Bank connections</h1>
        <p className="muted">
          Bank accounts, cards and brokerages, kept up to date through{" "}
          <a href="https://bridge.simplefin.org/" target="_blank" rel="noreferrer">
            SimpleFIN Bridge
          </a>
          . Transactions arrive every morning and go through review, like an import.
        </p>
      </header>
      {connections.isPending && <p className="muted">Loading…</p>}
      {connections.error && <p className="card error">{explain(connections.error)}</p>}
      {connections.data?.map((c) => (
        <ConnectionCard
          key={c.id}
          book={book}
          connection={c}
          attempts={(attempts.data ?? []).filter((a) => a.connection_id === c.id)}
        />
      ))}
      <Connect />
    </main>
  );
}

function Connect() {
  const connect = useConnectBank();
  const [token, setToken] = useState("");
  return (
    <form
      className="card editor"
      aria-label="Connect a bank"
      onSubmit={(e) => {
        e.preventDefault();
        connect.mutate(token.trim(), { onSuccess: () => setToken("") });
      }}
    >
      <h2 className="section-title">Connect</h2>
      <p className="small muted">
        At SimpleFIN Bridge, connect your banks, then make a setup token for fava-beans and paste it
        here. It works once.
      </p>
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
}: {
  book: string;
  connection: BankConnection;
  attempts: LinkAttempt[];
}) {
  const sync = useSyncBank();
  const disconnect = useDisconnectBank();
  const [linking, setLinking] = useState<string | null>(null);
  const institutions = [...new Set(connection.accounts.map((a) => a.institution))].join(", ");
  return (
    <section className="card" aria-label={`Connection to ${connection.host}`}>
      <div className="row-between">
        <h2 className="section-title">{institutions || connection.host}</h2>
        <span className="small muted">{connection.host}</span>
      </div>
      <p className="small muted">
        {connection.last_sync_at
          ? `Last synced ${formatWhen(connection.last_sync_at)}`
          : "Not synced yet"}
        {" · "}
        {connection.requests_left} of {connection.requests_per_day} requests left today
      </p>
      {connection.errors.map((e, i) => (
        <p key={i} className={`small ${e.notice ? "muted" : "error"}`} title={e.code}>
          {e.explained}
        </p>
      ))}
      {sync.data && (
        <p className="small ok" role="status">
          Synced: {sync.data.staged} new, {sync.data.matched} matched.
        </p>
      )}
      {sync.error && <p className="small error">{explain(sync.error)}</p>}
      <ul className="plain-list" aria-label="Bank accounts">
        {connection.accounts.map((a) => (
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
      <div className="actions">
        <button type="button" disabled={sync.isPending} onClick={() => sync.mutate(connection.id)}>
          {sync.isPending ? "Syncing…" : "Sync now"}
        </button>
        <button
          type="button"
          className="danger"
          disabled={disconnect.isPending}
          onClick={() => {
            if (
              window.confirm(
                "Disconnect? Its links stop syncing; everything brought in stays. To revoke access entirely, also remove fava-beans at SimpleFIN Bridge."
              )
            )
              disconnect.mutate(connection.id);
          }}
        >
          Disconnect
        </button>
      </div>
    </section>
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
      <div className="row-between">
        <span>
          {account.name}
          {account.kind === "brokerage" && <span className="pill"> brokerage</span>}
          <span className="muted small block">
            {account.institution} · {formatMoney(account.balance, account.currency)}, reported{" "}
            {formatReported(account.balance_date)}
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
      {attempt && !link && <AttemptPanel book={book} attempt={attempt} />}
      {linking && !attempt && (
        <LinkForm book={book} connection={connection} account={account} onDone={onDone} />
      )}
    </>
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
        {preview.kind === "brokerage" && preview.mode === "new" && (
          <li>Each holding opens as one lot at its cost basis (an estimate: edit lots any time)</li>
        )}
      </ul>
    </section>
  );
}
