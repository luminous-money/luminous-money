import { useState } from "react";
import { Link, useLocation } from "wouter";

import { AccountPicker } from "../components/AccountPicker.js";
import { AccountSettings } from "../components/AccountSettings.js";
import { NewAccountField } from "../components/NewAccountField.js";
import { displayName, shown } from "../lib/accounts.js";
import { formatMoney } from "../lib/decimal.js";
import { today } from "../lib/format.js";
import type { TreeAccount } from "../lib/ledger.js";
import {
  explain,
  useAccountCreation,
  useAccountTree,
  useArchiveAccount,
  useRemoveAccount,
  useRenameAccount,
  useSetAccount,
  useSummary,
  useUnarchiveAccount,
} from "../lib/queries.js";

const TYPE_NAMES: Record<string, string> = {
  asset: "an asset",
  liability: "a liability",
  equity: "an equity",
  income: "an income",
  expense: "an expense",
};

/**
 * Edit an account: its full name (rename or move: everything naming it is rewritten, history
 * included), its display name, its settings, archiving, and deleting or merging it into another
 * account (its splits move there). System and top-level accounts can't be renamed or deleted.
 */
export function AccountEditor({ book, account }: { book: string; account: string }) {
  const tree = useAccountTree(book);
  const found = tree.data?.find((a) => a.name === account);
  const ledgerHref = `/books/${book}/accounts/${encodeURIComponent(account)}`;
  if (tree.isPending) return <main className="muted">Loading…</main>;
  if (!found)
    return (
      <main>
        <p className="card">
          There's no {account} in this book.{" "}
          <Link href={`/books/${book}/accounts`}>All accounts</Link>
        </p>
      </main>
    );
  return (
    <main className="stack">
      <header className="page-head">
        <Link
          href={found.kind === "leaf" ? ledgerHref : `/books/${book}/accounts`}
          className="back"
        >
          ‹ Back
        </Link>
        <h1>{displayName(found)}</h1>
        <p className="muted">
          {found.name}
          {found.close && " · archived"}
        </p>
      </header>
      {found.protected ? (
        <p className="card small muted">
          {found.name.includes(":")
            ? "A system account (or part of a brokerage): the app relies on its name, so it can't be renamed or deleted."
            : "A top-level account: it can't be changed."}
        </p>
      ) : (
        <Rename book={book} account={found} accounts={tree.data!} />
      )}
      {!found.implicit && <DisplayName book={book} account={found} />}
      {found.kind === "leaf" && !found.implicit && <Settings book={book} account={account} />}
      {found.name.includes(":") && <Archive book={book} account={found} accounts={tree.data!} />}
      {!found.protected && <Remove book={book} account={found} accounts={tree.data!} />}
    </main>
  );
}

function Rename({
  book,
  account,
  accounts,
}: {
  book: string;
  account: TreeAccount;
  accounts: TreeAccount[];
}) {
  const [, navigate] = useLocation();
  const rename = useRenameAccount(book, account.name);
  const [name, setName] = useState(account.name);
  const exists = name !== account.name && accounts.some((a) => a.name === name);
  return (
    <form
      className="card editor"
      aria-label="Rename or move"
      // Awaited rather than `onSuccess`: the refetched chart no longer has the old name, so this
      // form unmounts before a mutation callback would run.
      onSubmit={async (e) => {
        e.preventDefault();
        await rename
          .mutateAsync({ to: name, updated_at: account.updated_at ?? undefined })
          .then(() => navigate(`/books/${book}/accounts/${encodeURIComponent(name)}/edit`))
          .catch(() => undefined); // shown from rename.error
      }}
    >
      <h2 className="section-title">Name</h2>
      <NewAccountField
        label="Full name"
        name={name}
        onName={setName}
        // Checked as a new name against everything but itself (its own name isn't "taken").
        accounts={accounts.filter(
          (a) => a.name !== account.name && !a.name.startsWith(`${account.name}:`)
        )}
      />
      <p className="small muted">
        Renaming or moving rewrites everything that names it
        {account.kind === "node" ? " or an account under it" : ""}, history included.
      </p>
      {exists && (
        <p className="small error">
          {name} already exists. To put everything of {displayName(account)} in it, merge them
          below.
        </p>
      )}
      {rename.error && <p className="error">{explain(rename.error)}</p>}
      <div className="actions">
        <button
          type="submit"
          className="primary"
          disabled={name === account.name || exists || rename.isPending}
        >
          {rename.isPending ? "Renaming…" : "Rename"}
        </button>
      </div>
    </form>
  );
}

function DisplayName({ book, account }: { book: string; account: TreeAccount }) {
  const set = useSetAccount(book, account.name);
  const [value, setValue] = useState(account.display_name ?? "");
  return (
    <form
      className="card editor"
      aria-label="Display name"
      onSubmit={(e) => {
        e.preventDefault();
        set.mutate({
          updated_at: account.updated_at!,
          display_name: value.trim() || null,
        } as never);
      }}
    >
      <label>
        Display name
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-label="Display name"
          placeholder={account.name.split(":").at(-1)!.replace(/-/g, " ")}
        />
      </label>
      <p className="small muted">
        How it's named on cards and in lists. Empty: the last part of its name.
      </p>
      {set.error && <p className="error">{explain(set.error)}</p>}
      <div className="actions">
        <button
          type="submit"
          disabled={(account.display_name ?? "") === value.trim() || set.isPending}
        >
          Save
        </button>
      </div>
    </form>
  );
}

function Settings({ book, account }: { book: string; account: string }) {
  const summary = useSummary(book, [account]);
  const info = summary.data?.[0];
  return info ? (
    <section className="card">
      <AccountSettings book={book} account={info} />
    </section>
  ) : null;
}

const leafNames = (accounts: TreeAccount[], except: string) =>
  accounts
    .filter(
      (a) =>
        a.kind === "leaf" &&
        !a.implicit &&
        !a.close &&
        a.name !== except &&
        !a.name.startsWith(`${except}:`)
    )
    .map((a) => a.name);

function Archive({
  book,
  account,
  accounts,
}: {
  book: string;
  account: TreeAccount;
  accounts: TreeAccount[];
}) {
  const archive = useArchiveAccount(book, account.name);
  const unarchive = useUnarchiveAccount(book, account.name);
  const [date, setDate] = useState(today());
  const [transfer, setTransfer] = useState("");
  const left = account.total.filter((a) => Number(a.number) !== 0);
  if (account.close)
    return (
      <section className="card" aria-label="Archive">
        <h2 className="section-title">Archived</h2>
        <p className="small muted">
          Since {account.close}. It's kept out of pickers, home and imports.
        </p>
        {unarchive.error && <p className="error">{explain(unarchive.error)}</p>}
        <button
          type="button"
          disabled={unarchive.isPending}
          onClick={() => unarchive.mutate(undefined)}
        >
          Unarchive
        </button>
      </section>
    );
  return (
    <form
      className="card editor"
      aria-label="Archive"
      onSubmit={(e) => {
        e.preventDefault();
        archive.mutate({
          date,
          transfer_to: transfer || undefined,
          updated_at: account.updated_at ?? undefined,
        });
      }}
    >
      <h2 className="section-title">Archive</h2>
      <p className="small muted">
        It keeps its history (and stays in reports), but leaves pickers, home and imports
        {account.kind === "node" ? ", with every account under it" : ""}. A bank feed into it stops.
      </p>
      {left.length > 0 && (
        <p className="small warning">
          {left.map((a) => formatMoney(shown(a.number, account.type), a.currency)).join(" · ")} is
          still in it.
        </p>
      )}
      <label>
        Archive on
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      {account.kind === "leaf" && left.length > 0 && (
        <div className="picker-field">
          <span className="small muted">Move what's left to (optional)</span>
          <AccountPicker
            label="Move what's left to (optional)"
            accounts={leafNames(accounts, account.name)}
            value={transfer}
            onChange={setTransfer}
          />
        </div>
      )}
      {archive.error && <p className="error">{explain(archive.error)}</p>}
      <div className="actions">
        <button type="submit" disabled={archive.isPending}>
          {transfer ? "Move it and archive" : "Archive"}
        </button>
      </div>
    </form>
  );
}

function Remove({
  book,
  account,
  accounts,
}: {
  book: string;
  account: TreeAccount;
  accounts: TreeAccount[];
}) {
  const [, navigate] = useLocation();
  const remove = useRemoveAccount(book, account.name);
  const create = useAccountCreation(book);
  const [substitute, setSubstitute] = useState("");
  const [typed, setTyped] = useState("");
  const target = accounts.find((a) => a.name === substitute);
  const otherType = target && target.type !== account.type;
  const needsSubstitute = account.splits > 0;
  const ready = (!needsSubstitute || !!substitute) && typed === account.name;
  return (
    <form
      className="card editor"
      aria-label="Delete or merge"
      onSubmit={async (e) => {
        e.preventDefault();
        await remove
          .mutateAsync(substitute || undefined)
          .then(() =>
            navigate(
              substitute
                ? `/books/${book}/accounts/${encodeURIComponent(substitute)}`
                : `/books/${book}/accounts`
            )
          )
          .catch(() => undefined); // shown from remove.error
      }}
    >
      <h2 className="section-title">Delete or merge</h2>
      {needsSubstitute ? (
        <p className="small">
          {account.kind === "node"
            ? `Deleting ${displayName(account)} deletes every account under it, and moves all ${account.splits} of their splits into one account. Or cancel, and delete the accounts under it one by one.`
            : `Its ${account.splits} split${account.splits === 1 ? "" : "s"} move to another account, so every other account's balance stays the same. That's also how to merge it into another account.`}
        </p>
      ) : (
        <p className="small">It has no transactions, so it simply goes.</p>
      )}
      {needsSubstitute && (
        <div className="picker-field">
          <span className="small muted">Move its splits to</span>
          <AccountPicker
            label="Move its splits to"
            accounts={leafNames(accounts, account.name)}
            value={substitute}
            onChange={setSubstitute}
            create={create}
          />
        </div>
      )}
      {otherType && (
        <p className="small warning">
          {substitute} is {TYPE_NAMES[target.type ?? ""] ?? "a different kind of"} account, and{" "}
          {account.name} is {TYPE_NAMES[account.type ?? ""] ?? "another kind"}: what these amounts
          mean changes.
        </p>
      )}
      <label>
        Type its full name ({account.name}) to delete it
        <input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          aria-label="Name of the account to delete"
          autoComplete="off"
        />
      </label>
      {remove.error && <p className="error">{explain(remove.error)}</p>}
      <div className="actions">
        <button type="submit" className="danger" disabled={!ready || remove.isPending}>
          {substitute ? `Merge into ${displayName({ name: substitute })}` : "Delete"}
        </button>
      </div>
    </form>
  );
}
