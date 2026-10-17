import { useState } from "react";
import { Link, useLocation } from "wouter";

import { AccountPicker } from "../components/AccountPicker.js";
import { AccountSettings } from "../components/AccountSettings.js";
import { NewAccountField } from "../components/NewAccountField.js";
import { displayName, shown, TYPE_LABELS } from "../lib/accounts.js";
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
 * Edit an account: its names (the display name, and the full name: renaming or moving rewrites
 * everything naming it, history included), its settings, and, tucked away below, archiving it
 * and deleting or merging it into another account (its splits move there). System and top-level
 * accounts can't be renamed or deleted.
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
  const isRoot = !found.name.includes(":");
  const settings = found.kind === "leaf" && !found.implicit;
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
          {found.type && ` · ${TYPE_LABELS[found.type]} account`}
          {found.close && " · archived"}
        </p>
      </header>
      {found.kind === "node" && !found.close && (
        <Link
          href={`/books/${book}/accounts/new?under=${encodeURIComponent(found.name)}`}
          className="button"
        >
          + Add an account under {displayName(found)}
        </Link>
      )}
      {isRoot ? (
        <p className="card small muted">A top-level account: it can't be changed.</p>
      ) : (
        <Names book={book} account={found} accounts={tree.data!} />
      )}
      {found.close && <Unarchive book={book} account={found} />}
      {!isRoot && (settings || !found.close || !found.protected) && (
        <div className="card disclosures">
          {settings && <Settings book={book} account={account} />}
          {!found.close && <Archive book={book} account={found} accounts={tree.data!} />}
          {!found.protected && <Remove book={book} account={found} accounts={tree.data!} />}
        </div>
      )}
    </main>
  );
}

/** Both names in one form: the display name is saved first, then the account is renamed. */
function Names({
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
  const set = useSetAccount(book, account.name);
  const [display, setDisplay] = useState(account.display_name ?? "");
  const [name, setName] = useState(account.name);
  const relabeled = !account.implicit && (account.display_name ?? "") !== display.trim();
  const renamed = name !== account.name;
  const exists = renamed && accounts.some((a) => a.name === name);
  const pending = rename.isPending || set.isPending;
  const error = set.error ?? rename.error;
  return (
    <form
      className="card editor"
      aria-label="Name"
      // Awaited rather than `onSuccess`: once renamed, the refetched chart no longer has the old
      // name, so this form unmounts before a mutation callback would run.
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          let updatedAt = account.updated_at ?? undefined;
          if (relabeled)
            updatedAt = (
              await set.mutateAsync({
                updated_at: account.updated_at!,
                display_name: display.trim() || null,
              } as never)
            ).updated_at!;
          if (renamed) {
            await rename.mutateAsync({ to: name, updated_at: updatedAt });
            navigate(`/books/${book}/accounts/${encodeURIComponent(name)}/edit`);
          }
        } catch {
          // shown from the mutations' errors
        }
      }}
    >
      <h2 className="section-title">Name</h2>
      {!account.implicit && (
        <label>
          Display name
          <input
            value={display}
            onChange={(e) => setDisplay(e.target.value)}
            aria-label="Display name"
            placeholder={account.name.split(":").at(-1)!.replace(/-/g, " ")}
          />
          <span className="small muted">
            On cards and in lists. Empty: the last part of its name.
          </span>
        </label>
      )}
      {account.protected ? (
        <p className="small muted">
          A system account (or part of a brokerage): the app relies on its full name, so it can't be
          renamed or deleted.
        </p>
      ) : (
        <>
          <NewAccountField
            label="Full name"
            name={name}
            onName={setName}
            current={account}
            // Checked as a new name against everything but itself and what's under it.
            accounts={accounts.filter(
              (a) => a.name !== account.name && !a.name.startsWith(`${account.name}:`)
            )}
          />
          <p className="small muted">
            Renaming or moving it rewrites everything that names it
            {account.kind === "node" ? " or an account under it" : ""}, history included.
          </p>
          {exists && (
            <p className="small error">
              {name} already exists. To put everything of {displayName(account)} in it, merge them
              below.
            </p>
          )}
        </>
      )}
      {error && <p className="error">{explain(error)}</p>}
      <div className="actions">
        <button
          type="submit"
          className="primary"
          disabled={(!relabeled && !renamed) || exists || pending}
        >
          {pending ? "Saving…" : renamed ? "Save and rename" : "Save"}
        </button>
      </div>
    </form>
  );
}

function Settings({ book, account }: { book: string; account: string }) {
  const summary = useSummary(book, [account]);
  const info = summary.data?.[0];
  return info ? <AccountSettings book={book} account={info} /> : null;
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

function Unarchive({ book, account }: { book: string; account: TreeAccount }) {
  const unarchive = useUnarchiveAccount(book, account.name);
  return (
    <section className="card editor" aria-label="Archived">
      <h2 className="section-title">Archived</h2>
      <p className="small muted">
        Since {account.close}. It's kept out of pickers, home and imports.
      </p>
      {unarchive.error && <p className="error">{explain(unarchive.error)}</p>}
      <div className="actions">
        <button
          type="button"
          className="primary"
          disabled={unarchive.isPending}
          onClick={() => unarchive.mutate(undefined)}
        >
          Unarchive
        </button>
      </div>
    </section>
  );
}

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
  const [date, setDate] = useState(today());
  const [transfer, setTransfer] = useState("");
  const left = account.total.filter((a) => Number(a.number) !== 0);
  return (
    <details>
      <summary>
        <span>Archive</span>
        <span className="small muted">Keep its history, but out of the way</span>
      </summary>
      <form
        className="editor"
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
        <p className="small muted">
          It stays in reports, but leaves pickers, home and imports
          {account.kind === "node" ? ", with every account under it" : ""}. A bank feed into it
          stops.
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
          <button type="submit" className="primary" disabled={archive.isPending}>
            {transfer ? "Move it and archive" : "Archive"}
          </button>
        </div>
      </form>
    </details>
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
    <details>
      <summary>
        <span>Delete or merge</span>
        <span className="small muted">
          {needsSubstitute
            ? `Its ${account.splits} split${account.splits === 1 ? "" : "s"} move elsewhere`
            : "It has no transactions"}
        </span>
      </summary>
      <form
        className="editor"
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
    </details>
  );
}
