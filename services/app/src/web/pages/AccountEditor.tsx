import { useState } from "react";
import { Link, useLocation } from "wouter";

import { AccountPicker } from "../components/AccountPicker.js";
import { AccountSettings } from "../components/AccountSettings.js";
import { BudgetForm, BudgetGlance } from "../components/Budget.js";
import { NewAccountField } from "../components/NewAccountField.js";
import { partOf } from "../../shared/divided.js";
import { displayName, shown, toSegment, TYPE_LABELS } from "../lib/accounts.js";
import { formatMoney, isDecimal } from "../lib/decimal.js";
import { today } from "../lib/format.js";
import type { TreeAccount } from "../lib/ledger.js";
import {
  explain,
  useAccountCreation,
  useAccountTree,
  useArchiveAccount,
  useBudgetStatus,
  useRemoveAccount,
  useRenameAccount,
  useSetAccount,
  useDivide,
  useSetDivided,
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
  // What they set (lots sold, revaluing) only means something for what's owned.
  const settings = found.kind === "leaf" && !found.implicit && found.type === "asset";
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
        <p className="card small muted">A top-level account: its name can't be changed.</p>
      ) : (
        <Names book={book} account={found} accounts={tree.data!} />
      )}
      {settings && <Settings book={book} account={account} />}
      {!isRoot &&
        !found.close &&
        (found.type === "asset" || found.type === "liability") &&
        (found.kind === "node" ||
          partOf(tree.data!, found.name) ||
          (!found.protected && !found.revalue_every)) && (
          <Divided book={book} account={found} accounts={tree.data!} />
        )}
      {!found.close &&
        !found.protected &&
        (found.type === "asset" || found.type === "liability") &&
        ((found.kind === "leaf" && !found.implicit && !partOf(tree.data!, found.name)) ||
          found.divided) && <Cards book={book} account={found} />}
      {!found.close && found.type && <BudgetCard book={book} account={found} />}
      {found.close && <Unarchive book={book} account={found} />}
      {!isRoot && (!found.close || !found.protected) && (
        <div className="card disclosures">
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

/**
 * Whether an asset or liability node is a divided account (M14): one real account (at a bank,
 * say) that the accounts under it divide. It's reconciled and linked as one; they aren't on
 * their own. An account under one says so.
 */
const BRANDS: [CardBrand, string][] = [
  ["visa", "Visa"],
  ["mastercard", "Mastercard"],
  ["amex", "Amex"],
  ["discover", "Discover"],
  ["other", "Other"],
];
type CardBrand = "visa" | "mastercard" | "amex" | "discover" | "other";
type Card = { brand?: CardBrand | null; last_four: string };

/** The payment cards an asset or liability account is paid with (M16), so a receipt's card
 * names its account: a brand (optional) and the last four. A divided account's are the
 * whole's; a card is one account's. */
function Cards({ book, account }: { book: string; account: TreeAccount }) {
  const set = useSetAccount(book, account.name);
  const [brand, setBrand] = useState<CardBrand | "">("");
  const [last, setLast] = useState("");
  const cards: Card[] = account.cards ?? [];
  const valid = /^\d{4}$/.test(last);
  const save = (next: Card[]) =>
    set.mutateAsync({ updated_at: account.updated_at!, cards: next } as never);
  const label = (c: Card) =>
    `${BRANDS.find(([b]) => b === c.brand)?.[1] ?? "Card"} ending ${c.last_four}`;
  return (
    <section className="card editor" aria-label="Payment cards">
      <h2 className="section-title">Payment cards</h2>
      <p className="small muted">
        A receipt paid with one of these is this account&apos;s: a card held by two people has two.
      </p>
      {cards.length > 0 && (
        <ul className="card-list">
          {cards.map((c) => (
            <li key={`${c.brand}-${c.last_four}`}>
              <span>{label(c)}</span>
              <button
                type="button"
                className="plain small"
                aria-label={`Remove the ${label(c)}`}
                disabled={set.isPending}
                onClick={() => void save(cards.filter((x) => x !== c)).catch(() => undefined)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid) return;
          save([...cards, { brand: brand || null, last_four: last }]).then(
            () => (setLast(""), setBrand("")),
            () => undefined
          );
        }}
      >
        <label>
          Brand
          <select value={brand} onChange={(e) => setBrand(e.target.value as CardBrand | "")}>
            <option value="">Any</option>
            {BRANDS.map(([value, name]) => (
              <option key={value} value={value}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Last four
          <input
            inputMode="numeric"
            maxLength={4}
            value={last}
            onChange={(e) => setLast(e.target.value.replace(/\D/g, ""))}
            placeholder="0000"
          />
        </label>
        <button type="submit" disabled={!valid || set.isPending}>
          Add card
        </button>
      </form>
      {set.error && <p className="error small">{explain(set.error)}</p>}
    </section>
  );
}

function Divided({
  book,
  account,
  accounts,
}: {
  book: string;
  account: TreeAccount;
  accounts: TreeAccount[];
}) {
  const set = useSetDivided(book, account.name);
  const setMain = useSetAccount(book, account.name);
  // Shown as chosen at once, and put back if the ledger refuses it.
  const [divided, setDivided] = useState(account.divided);
  const whole = partOf(accounts, account.name);
  const below = accounts.find((a) => a.divided && a.name.startsWith(`${account.name}:`));
  const parts = accounts.filter(
    (a) => a.name.startsWith(`${account.name}:`) && a.kind === "leaf" && !a.implicit && !a.close
  );
  const href = (name: string) => `/books/${book}/accounts/${encodeURIComponent(name)}`;
  return (
    <section className="card editor" aria-label="Divided account">
      <h2 className="section-title">Divided account</h2>
      {account.kind === "leaf" && !whole ? (
        <DivideForm book={book} account={account} />
      ) : whole ? (
        <p className="small muted">
          Part of{" "}
          <Link href={`${href(whole)}/edit`}>
            {displayName(accounts.find((a) => a.name === whole) ?? { name: whole })}
          </Link>
          , a divided account: it's reconciled and linked to a bank with it, not on its own.
        </p>
      ) : (
        <>
          <label className="check">
            <input
              type="checkbox"
              checked={divided}
              disabled={set.isPending || !!below}
              onChange={(e) => {
                const to = e.target.checked;
                setDivided(to);
                set.mutate(
                  { divided: to, updated_at: account.updated_at ?? null },
                  { onError: () => setDivided(!to) }
                );
              }}
            />
            One real account, divided
          </label>
          <p className="small muted">
            For an account at a bank (say) that you divide into the accounts under it: it's
            reconciled and linked to the bank as one, and they aren't on their own.
          </p>
          {below && (
            <p className="small muted">{displayName(below)}, under it, is divided already.</p>
          )}
          {divided && account.divided && (
            <label>
              New money lands in
              <select
                aria-label="New money lands in"
                value={account.main_part ?? ""}
                disabled={setMain.isPending}
                onChange={(e) =>
                  setMain.mutate({
                    updated_at: account.updated_at!,
                    main_part: e.target.value,
                  } as never)
                }
              >
                {!account.main_part && <option value="">Choose a part</option>}
                {parts.map((p) => (
                  <option key={p.name} value={p.name}>
                    {displayName(p)}
                  </option>
                ))}
              </select>
              <span className="small muted">
                What the bank or a file brings in, and what's left once the others have theirs.
              </span>
            </label>
          )}
          {divided && (
            <div className="actions">
              <Link href={href(account.name)} className="button">
                Ledger
              </Link>
              <Link href={`${href(account.name)}/reconcile`} className="button">
                Reconcile
              </Link>
            </div>
          )}
        </>
      )}
      {(set.error ?? setMain.error) && (
        <p className="error">{explain(set.error ?? setMain.error)}</p>
      )}
    </section>
  );
}

/**
 * Dividing an account you have (M15): it becomes a divided account of the same name (its bank
 * link, statements and stars stay), everything that was its own goes to the main part, and
 * the other parts start with what's moved to them, on a date.
 */
function DivideForm({ book, account }: { book: string; account: TreeAccount }) {
  const [, navigate] = useLocation();
  const divide = useDivide(book, account.name);
  const [main, setMain] = useState("General");
  const [parts, setParts] = useState([{ name: "", amount: "" }]);
  const [date, setDate] = useState(today());
  const segment = (name: string) => toSegment(name.trim());
  const named = parts.filter((p) => p.name.trim());
  const valid =
    !!main.trim() &&
    named.length > 0 &&
    named.every((p) => !p.amount.trim() || isDecimal(p.amount.replace(/[$,]/g, "")));
  const change = (i: number, field: "name" | "amount", value: string) =>
    setParts((ps) => ps.map((p, j) => (j === i ? { ...p, [field]: value } : p)));
  return (
    <details className="divide">
      <summary>Divide {displayName(account)}…</summary>
      <form
        className="editor"
        aria-label="Divide"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await divide.mutateAsync({
              main: segment(main),
              parts: named.map((p) => ({
                name: segment(p.name),
                amount: shown(p.amount.replace(/[$,]/g, "") || "0", account.type),
              })),
              date,
              updated_at: account.updated_at!,
            });
            navigate(`/books/${book}/accounts/${encodeURIComponent(account.name)}`);
          } catch {
            // shown from the mutation's error
          }
        }}
      >
        <p className="small muted">
          One real account, held as parts: {displayName(account)} keeps its name, bank link and
          statements, its history goes to the main part, and the others start with what you move to
          them.
        </p>
        <label>
          Main part
          <input value={main} onChange={(e) => setMain(e.target.value)} aria-label="Main part" />
          <span className="small muted">Where new money lands, and what's left.</span>
        </label>
        {parts.map((p, i) => (
          <div key={i} className="divide-part">
            <label>
              Part
              <input
                value={p.name}
                onChange={(e) => change(i, "name", e.target.value)}
                placeholder="Padding"
                aria-label={`Part ${i + 1}`}
              />
            </label>
            <label>
              Starts with
              <input
                inputMode="decimal"
                value={p.amount}
                onChange={(e) => change(i, "amount", e.target.value)}
                placeholder="0.00"
                aria-label={`Part ${i + 1}'s amount`}
              />
            </label>
          </div>
        ))}
        <button
          type="button"
          className="plain"
          onClick={() => setParts((ps) => [...ps, { name: "", amount: "" }])}
        >
          + Another part
        </button>
        <label>
          As of
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        {divide.error && <p className="error">{explain(divide.error)}</p>}
        <div className="actions">
          <button type="submit" className="primary" disabled={!valid || divide.isPending}>
            {divide.isPending ? "Dividing…" : "Divide"}
          </button>
        </div>
      </form>
    </details>
  );
}

/** Its budget: how it's going this period, and setting it. */
function BudgetCard({ book, account }: { book: string; account: TreeAccount }) {
  const status = useBudgetStatus(book);
  const line = status.data?.lines.find((l) => l.account === account.name);
  return (
    <section className="card editor" aria-label="Budget">
      <h2 className="section-title">Budget</h2>
      {line && <BudgetGlance line={line} name={displayName(account)} />}
      {status.data && (
        <BudgetForm
          key={line?.version.updated_at ?? "none"}
          book={book}
          account={account.name}
          line={line}
        />
      )}
    </section>
  );
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
