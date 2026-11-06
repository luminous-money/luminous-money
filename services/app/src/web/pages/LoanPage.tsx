import { useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";

import {
  cents,
  othersOn,
  tableOn,
  tableStarts,
  type LoanOther,
  type LoanTable,
  type LoanView,
} from "../../shared/loans.js";
import {
  leavesUnder,
  monthOf,
  paymentParts,
  PaymentsTable,
  PickerField,
  usd,
} from "../components/Loans.js";
import { LoanHowTo } from "../components/LoanConfirm.js";
import { LoanTableSource } from "../components/LoanTableSource.js";
import { LoanSpending } from "../components/Outflow.js";
import { formatDay, today } from "../lib/format.js";
import { useBack, withBack } from "../lib/navigation.js";
import {
  explain,
  useAccountCreation,
  useAccounts,
  useDeleteLoan,
  useExtraPayment,
  useLoan,
  useRebaseLoan,
  useSaveLoan,
  useSummary,
} from "../lib/queries.js";

const accountPath = (book: string, account: string) => `/books/${book}/accounts/${account}`;

/** A loan's page: what's owed and the next payment, extra payments, the lender's figure, its
 * dated changes, escrow and what's paid from it, the payments ahead, and its settings. */
export function LoanPage({ book, id }: { book: string; id: string }) {
  const loan = useLoan(book, id);
  const back = useBack(`/books/${book}/loans`);
  const here = `/books/${book}/loans/${id}`;
  return (
    <main>
      <header className="page-head">
        <Link href={back} className="back">
          ‹ Back
        </Link>
        <h1>{loan.data?.name ?? "Loan"}</h1>
      </header>
      {loan.isPending && <p className="muted">Loading…</p>}
      {loan.error && <p className="card error">{explain(loan.error)}</p>}
      {loan.data && <Loan key={loan.data.updated_at} book={book} loan={loan.data} here={here} />}
    </main>
  );
}

function Loan({ book, loan, here }: { book: string; loan: LoanView; here: string }) {
  const { status, currency } = loan;
  const next = status.next;
  const last = status.ahead.at(-1);
  return (
    <div className="stack loan-page">
      <section className="card loan-summary" aria-label="What's owed">
        <div className="account-card-top">
          <span className="muted small">Owed today</span>
          <span className="balance">{usd(status.owed, currency)}</span>
        </div>
        <p className="small">
          <Link href={withBack(accountPath(book, loan.accounts.liability), here)}>
            {loan.accounts.liability}
          </Link>
          {loan.payee ? ` · ${loan.payee}` : ""}
          {loan.paused ? " · Paused" : ""}
        </p>
        {next ? (
          <>
            <p>
              <strong>
                Next payment {formatDay(next.nominal)}: {usd(next.total, currency)}
              </strong>
              <br />
              <span className="small muted">{paymentParts(next, currency)}</span>
            </p>
            <p className="small muted">
              {next.follows_table
                ? `Payment ${next.number} as the table has it.`
                : "Worked out from what the books say is owed (it's parted from the table)."}{" "}
              {last &&
                `Paid off ${monthOf(last.nominal)}, with ${usd(status.interest_ahead, currency)} of interest still to pay.`}
            </p>
          </>
        ) : (
          <p className="muted">Nothing more to pay: it&apos;s paid off.</p>
        )}
        <p className="small muted">
          {status.paid.length} payment{status.paid.length === 1 ? "" : "s"} staged so far.
        </p>
      </section>

      <ExtraPayment book={book} loan={loan} />
      <Rebase book={book} loan={loan} />
      <Changes book={book} loan={loan} />
      <Escrow book={book} loan={loan} here={here} />
      <LoanSpending book={book} loan={loan} />

      {status.ahead.length > 0 && (
        <section className="card" aria-label="Payments ahead">
          <h2 className="section-title">Payments ahead</h2>
          <p className="small muted">Worked out from what&apos;s owed today.</p>
          <PaymentsTable payments={status.ahead} currency={currency} />
        </section>
      )}

      <section className="card" aria-label="What to do when">
        <h2 className="section-title">What to do when…</h2>
        <LoanHowTo
          escrow={loan.others.some((o) => o.account.startsWith("Assets:"))}
          bills={status.paid_from.length > 0}
          where="page"
        />
      </section>

      <Settings book={book} loan={loan} />
    </div>
  );
}

/** A card that opens to a form. */
function Opening({
  title,
  button,
  summary,
  children,
  open,
  setOpen,
}: {
  title: string;
  button: string;
  /** Shown whether it's open or not. */
  summary?: ReactNode;
  children: ReactNode;
  open: boolean;
  setOpen: (open: boolean) => void;
}) {
  return (
    <section className="card" aria-label={title}>
      <div className="account-card-top">
        <h2 className="section-title">{title}</h2>
        {!open && (
          <button type="button" onClick={() => setOpen(true)}>
            {button}
          </button>
        )}
      </div>
      {summary}
      {open && children}
    </section>
  );
}

function ExtraPayment({ book, loan }: { book: string; loan: LoanView }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today());
  const [error, setError] = useState<string | null>(null);
  const pay = useExtraPayment(book);
  return (
    <Opening title="Extra payment" button="Pay extra…" open={open} setOpen={setOpen}>
      <form
        className="editor"
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          try {
            await pay.mutateAsync({ id: loan.id, payment: { amount, date } });
          } catch (err) {
            setError(explain(err));
          }
        }}
      >
        <p className="small muted">
          Toward principal, from {loan.accounts.paying}. Later payments stay the same, more of each
          goes to principal, and the loan ends sooner.
        </p>
        <div className="pair">
          <label>
            Amount
            <input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[$,]/g, ""))}
              placeholder="1000.00"
            />
          </label>
          <label>
            On
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
        </div>
        {error && <p className="error">{error}</p>}
        <div className="actions">
          <button type="button" onClick={() => setOpen(false)}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={!amount || pay.isPending}>
            Pay {amount ? usd(amount, loan.currency) : ""} extra
          </button>
        </div>
      </form>
    </Opening>
  );
}

/** What the lender says is owed: the difference from the books is written as an adjustment. */
function Rebase({ book, loan }: { book: string; loan: LoanView }) {
  const [open, setOpen] = useState(false);
  const [owed, setOwed] = useState("");
  const [on, setOn] = useState(today());
  const [account, setAccount] = useState(loan.accounts.interest);
  const [error, setError] = useState<string | null>(null);
  const rebase = useRebaseLoan(book);
  const chart = useAccounts(book);
  return (
    <Opening title="Lender's statement" button="Enter…" open={open} setOpen={setOpen}>
      <form
        className="editor"
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          try {
            await rebase.mutateAsync({
              id: loan.id,
              rebase: { updated_at: loan.updated_at, on, owed, account },
            });
          } catch (err) {
            setError(explain(err));
          }
        }}
      >
        <p className="small muted">
          From a statement: what was owed at the end of a day. The difference from the books is
          written then (usually interest the lender rounded differently), and the payments after it
          are worked out from there.
        </p>
        <div className="pair">
          <label>
            Owed
            <input
              inputMode="decimal"
              value={owed}
              onChange={(e) => setOwed(e.target.value.replace(/[$,]/g, ""))}
            />
          </label>
          <label>
            At the end of
            <input type="date" value={on} onChange={(e) => setOn(e.target.value)} />
          </label>
        </div>
        <PickerField
          label="The difference goes to"
          accounts={leavesUnder(chart.data, ["Expenses", "Income", "Equity", "Assets"])}
          value={account}
          onChange={setAccount}
          prefer={["Expenses"]}
        />
        {loan.rebases.length > 0 && (
          <ul className="small muted">
            {loan.rebases.map((r) => (
              <li key={r.transaction_id}>
                {formatDay(r.on)}: {usd(r.owed, loan.currency)} owed (
                {cents(r.difference) > 0n ? "+" : ""}
                {usd(r.difference, loan.currency)})
              </li>
            ))}
          </ul>
        )}
        {error && <p className="error">{error}</p>}
        <div className="actions">
          <button type="button" onClick={() => setOpen(false)}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={!owed || rebase.isPending}>
            Make the books agree
          </button>
        </div>
      </form>
    </Opening>
  );
}

type ChangeKind = "other" | "extra" | "table";

/** The loan's dated changes: others' amounts, extra principal, new tables; and adding one. */
function Changes({ book, loan }: { book: string; loan: LoanView }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<ChangeKind>("other");
  const names = [...new Set(loan.others.map((o) => o.name))];
  const [name, setName] = useState(names[0] ?? "Escrow");
  const [account, setAccount] = useState("");
  const [amount, setAmount] = useState("");
  const [from, setFrom] = useState(loan.status.next?.nominal ?? today());
  const [table, setTable] = useState<LoanTable | null>(null);
  const [error, setError] = useState<string | null>(null);
  const save = useSaveLoan(book);
  const chart = useAccounts(book);
  const create = useAccountCreation(book);

  const changes = [
    ...loan.others
      .filter((o, i) => loan.others.findIndex((x) => x.name === o.name) !== i)
      .map((o) => ({
        from: o.from,
        text:
          cents(o.amount) === 0n
            ? `${o.name} ends`
            : `${o.name} becomes ${usd(o.amount, loan.currency)}`,
      })),
    ...loan.extras.map((e) => ({
      from: e.from,
      text:
        cents(e.amount) === 0n
          ? "No more extra principal"
          : `${usd(e.amount, loan.currency)} extra principal with each payment`,
    })),
    ...[...loan.tables]
      .sort((a, b) => a.from.localeCompare(b.from))
      .slice(1)
      .map((t) => ({
        from: t.from,
        text: `A new table: ${usd(t.payment, loan.currency)} at ${t.rate}%`,
      })),
  ].sort((a, b) => a.from.localeCompare(b.from));

  const known = loan.others.find((o) => o.name === name);
  const draft = (): Partial<Pick<LoanView, "others" | "extras" | "tables">> | null => {
    if (kind === "other") {
      const to = known?.account ?? account;
      if (!name.trim() || !to || !/^\d+(\.\d{1,2})?$/.test(amount)) return null;
      const other: LoanOther = { name: name.trim(), account: to, amount, from };
      return { others: [...loan.others, other] };
    }
    if (kind === "extra") {
      if (!/^\d+(\.\d{1,2})?$/.test(amount)) return null;
      return { extras: [...loan.extras, { amount, from }] };
    }
    if (!table) return null;
    return { tables: [...loan.tables, { ...table, from: table.rows[0]!.date }] };
  };
  const ready = draft();

  return (
    <Opening
      title="Changes"
      button="A change…"
      open={open}
      setOpen={setOpen}
      summary={
        changes.length ? (
          <ul className="loan-changes">
            {changes.map((c, i) => (
              <li key={i}>
                <span className="muted">From {formatDay(c.from)}</span> {c.text}
              </li>
            ))}
          </ul>
        ) : (
          !open && (
            <p className="small muted">None yet: an escrow change, extra principal, a new table.</p>
          )
        )
      }
    >
      <form
        className="editor"
        onSubmit={async (e) => {
          e.preventDefault();
          const patch = draft();
          if (!patch) return;
          setError(null);
          try {
            await save.mutateAsync({
              id: loan.id,
              loan: { updated_at: loan.updated_at, ...patch },
            });
          } catch (err) {
            setError(explain(err));
          }
        }}
      >
        <label>
          What changes
          <select value={kind} onChange={(e) => setKind(e.target.value as ChangeKind)}>
            <option value="other">An amount paid with it (escrow, PMI…)</option>
            <option value="extra">Extra principal with each payment</option>
            <option value="table">A new table (the lender&apos;s new schedule)</option>
          </select>
        </label>
        {kind === "other" && (
          <>
            <div className="pair">
              <label>
                Which
                <select
                  value={names.includes(name) ? name : ""}
                  onChange={(e) => setName(e.target.value)}
                >
                  {names.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                  <option value="">Something new</option>
                </select>
              </label>
              <label>
                {names.includes(name) ? "New amount" : "Amount"}
                <input
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value.replace(/[$,]/g, ""))}
                  placeholder={
                    known
                      ? (othersOn(loan.others, from).find((o) => o.name === name)?.amount ?? "0.00")
                      : "0.00"
                  }
                />
                <span className="small muted">0 ends it</span>
              </label>
            </div>
            {!names.includes(name) && (
              <>
                <label>
                  Name
                  <input value={name} onChange={(e) => setName(e.target.value)} />
                </label>
                <PickerField
                  label="It goes to"
                  accounts={leavesUnder(chart.data, ["Assets", "Expenses", "Liabilities"])}
                  value={account}
                  onChange={setAccount}
                  prefer={["Assets", "Expenses"]}
                  {...(create ? { create } : {})}
                />
              </>
            )}
          </>
        )}
        {kind === "extra" && (
          <label>
            Extra principal each payment
            <input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[$,]/g, ""))}
              placeholder="100.00"
            />
            <span className="small muted">0 stops it. A one-time extra is Pay extra, above.</span>
          </label>
        )}
        {kind !== "table" ? (
          <label>
            From the payment due
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
        ) : (
          <LoanTableSource
            book={book}
            currency={loan.currency}
            onChange={setTable}
            starting={{
              amount: loan.status.owed,
              first: loan.status.next?.nominal ?? today(),
              rate: tableOn(loan, loan.status.next?.nominal ?? today()).rate,
            }}
          />
        )}
        <p className="small muted">
          Payments from then that aren&apos;t confirmed yet are worked out again; confirmed ones
          stay as they are.
        </p>
        {error && <p className="error">{error}</p>}
        <div className="actions">
          <button type="button" onClick={() => setOpen(false)}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={!ready || save.isPending}>
            Save the change
          </button>
        </div>
      </form>
    </Opening>
  );
}

/** Escrow: the account the lender holds for you, and the schedules that pay out of it (the
 * tax bill, the insurance), managed as schedules of their own. */
function Escrow({ book, loan, here }: { book: string; loan: LoanView; here: string }) {
  const held = [...new Set(loan.others.map((o) => o.account))].filter((a) =>
    a.startsWith("Assets:")
  );
  const balances = useSummary(book, held.length ? held : undefined);
  if (!held.length) return null;
  return (
    <section className="card" aria-label="Escrow">
      <h2 className="section-title">Escrow</h2>
      {held.map((account) => {
        const balance = balances.data?.find((s) => s.name === account)?.balance[0];
        const paid = loan.status.paid_from.filter((p) => p.account === account);
        return (
          <div key={account} className="loan-escrow">
            <div className="account-card-top">
              <Link href={withBack(accountPath(book, account), here)}>{account}</Link>
              <span className="balance">
                {balance ? usd(balance.number, balance.currency) : ""}
              </span>
            </div>
            {paid.length ? (
              <ul className="upcoming">
                {paid.map((p) => (
                  <li key={p.schedule_id}>
                    <span className="muted">{p.next ? formatDay(p.next) : "—"}</span>
                    <Link href={withBack(`/books/${book}/schedules/${p.schedule_id}`, here)}>
                      {p.name}
                    </Link>
                    <span />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="small muted">
                Nothing&apos;s paid from it yet: add the tax bill and the insurance as schedules
                paid from escrow, so its balance follows what the lender does.
              </p>
            )}
            <Link
              href={withBack(
                `/books/${book}/schedules/new?account=${encodeURIComponent(account)}`,
                here
              )}
              className="button"
            >
              + A payment from escrow
            </Link>
          </div>
        );
      })}
    </section>
  );
}

/** Name, lender, accounts, tolerance, auto-confirm, pause; and deleting the loan. */
function Settings({ book, loan }: { book: string; loan: LoanView }) {
  const [, navigate] = useLocation();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(loan.name);
  const [payee, setPayee] = useState(loan.payee ?? "");
  const [paying, setPaying] = useState(loan.accounts.paying);
  const [interest, setInterest] = useState(loan.accounts.interest);
  const [asset, setAsset] = useState(loan.accounts.asset ?? "");
  const [tolerance, setTolerance] = useState(cents(loan.tolerance) ? loan.tolerance : "");
  const [autoConfirm, setAutoConfirm] = useState(loan.auto_confirm);
  const [paused, setPaused] = useState(loan.paused);
  const [error, setError] = useState<string | null>(null);
  const save = useSaveLoan(book);
  const remove = useDeleteLoan(book);
  const chart = useAccounts(book);
  const create = useAccountCreation(book);
  const first = [...loan.tables].sort((a, b) => a.from.localeCompare(b.from))[0];
  return (
    <Opening title="Settings" button="Edit…" open={open} setOpen={setOpen}>
      <form
        className="editor"
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          try {
            await save.mutateAsync({
              id: loan.id,
              loan: {
                updated_at: loan.updated_at,
                name,
                payee: payee || null,
                accounts: { paying, interest, asset: asset || null },
                tolerance: tolerance || "0",
                auto_confirm: autoConfirm,
                paused,
              },
            });
          } catch (err) {
            setError(explain(err));
          }
        }}
      >
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          Lender
          <input value={payee} onChange={(e) => setPayee(e.target.value)} />
        </label>
        <p className="small muted">What&apos;s owed: {loan.accounts.liability}</p>
        <PickerField
          label="Paid from"
          accounts={leavesUnder(chart.data, ["Assets", "Liabilities"])}
          value={paying}
          onChange={setPaying}
          prefer={["Assets"]}
          {...(create ? { create } : {})}
        />
        <PickerField
          label="Interest goes to"
          accounts={leavesUnder(chart.data, ["Expenses"])}
          value={interest}
          onChange={setInterest}
          prefer={["Expenses"]}
          {...(create ? { create } : {})}
        />
        <PickerField
          label="What it bought (optional)"
          accounts={leavesUnder(chart.data, ["Assets"])}
          value={asset}
          onChange={setAsset}
          prefer={["Assets"]}
          {...(create ? { create } : {})}
        />
        <label>
          Match tolerance
          <input
            inputMode="decimal"
            value={tolerance}
            onChange={(e) => setTolerance(e.target.value)}
            placeholder="0.00"
          />
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={autoConfirm}
            onChange={(e) => setAutoConfirm(e.target.checked)}
          />
          Confirm payments automatically
        </label>
        <label className="check">
          <input type="checkbox" checked={paused} onChange={(e) => setPaused(e.target.checked)} />
          Paused
        </label>
        {first && (
          <p className="small muted">
            Its table: {first.rows.length} payments of {usd(first.payment, loan.currency)} at{" "}
            {first.rate}%, from {formatDay(first.rows[0]!.date)}, starting at{" "}
            {usd(tableStarts(first), loan.currency)} (
            {first.source === "terms"
              ? "worked out"
              : first.source === "csv"
                ? "from a CSV"
                : "read by the AI"}
            ).
          </p>
        )}
        {error && <p className="error">{error}</p>}
        <div className="actions">
          <button
            type="button"
            disabled={remove.isPending}
            onClick={async () => {
              if (
                !window.confirm(
                  `Delete "${loan.name}"? Its payments stop; what's already in the books stays.`
                )
              )
                return;
              try {
                await remove.mutateAsync(loan);
                navigate(`/books/${book}/loans`);
              } catch (err) {
                setError(explain(err));
              }
            }}
          >
            Delete
          </button>
          <button type="button" onClick={() => setOpen(false)}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={!name.trim() || save.isPending}>
            Save
          </button>
        </div>
      </form>
    </Opening>
  );
}
