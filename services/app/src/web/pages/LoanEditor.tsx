import { useState } from "react";
import { Link, useLocation } from "wouter";

import {
  cents,
  money,
  tableStarts,
  type LoanHistory,
  type LoanIn,
  type LoanOther,
  type LoanTable,
} from "../../shared/loans.js";
import {
  escrowAccount,
  leavesUnder,
  monthOf,
  OthersFieldset,
  PickerField,
  usd,
} from "../components/Loans.js";
import { LoanTableSource, type TableExtras } from "../components/LoanTableSource.js";
import { spendingAccount, useCountLoan } from "../components/Outflow.js";
import { api } from "../lib/ledger.js";
import { formatDay, today } from "../lib/format.js";
import { useBack } from "../lib/navigation.js";
import {
  explain,
  useAccountCreation,
  useAccounts,
  useBooks,
  useCreateAccount,
  useSaveLoan,
  useSummary,
} from "../lib/queries.js";

const OPENING = "Equity:Opening-Balances";

/** A month before a date: when a loan whose first payment is then was most likely made. */
function monthBefore(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 10);
}

/** New loan: its accounts, its table (worked out, a CSV, or read by the AI), what's paid with
 * it, and how its history comes into the books. */
export function LoanEditor({ book }: { book: string }) {
  const back = useBack(`/books/${book}/loans`);
  return (
    <main>
      <header className="page-head">
        <Link href={back} className="back">
          ‹ Back
        </Link>
        <h1>New loan</h1>
      </header>
      <Form book={book} back={back} />
    </main>
  );
}

function Form({ book, back }: { book: string; back: string }) {
  const [, navigate] = useLocation();
  const chart = useAccounts(book);
  const create = useAccountCreation(book);
  const createAccount = useCreateAccount(book);
  const save = useSaveLoan(book);
  const currency = useBooks().data?.find((b) => b.id === book)?.currency ?? "USD";
  const now = today();

  const [name, setName] = useState("");
  const [payee, setPayee] = useState("");
  const [liability, setLiability] = useState("");
  const [paying, setPaying] = useState("");
  const [interest, setInterest] = useState("");
  const [asset, setAsset] = useState("");

  const [table, setTable] = useState<LoanTable | null>(null);
  const [others, setOthers] = useState<LoanOther[]>([]);
  const [kind, setKind] = useState<LoanHistory["kind"]>("today");
  const [borrowed, setBorrowed] = useState("");
  const [against, setAgainst] = useState(OPENING);
  const [confirm, setConfirm] = useState(true);
  const [owed, setOwed] = useState("");
  const [owedOn, setOwedOn] = useState(now);
  const [tolerance, setTolerance] = useState("");
  const [autoConfirm, setAutoConfirm] = useState(false);
  const [asSpending, setAsSpending] = useState(true);
  const counting = useCountLoan(book);
  const [error, setError] = useState<string | null>(null);

  const start = table?.rows[0]?.date ?? "";
  const dueSoFar = table ? table.rows.filter((r) => r.date <= now) : [];
  const owedNow = dueSoFar.at(-1)?.balance ?? (table ? tableStarts(table) : "");
  const liabilityNow = useSummary(book, liability ? [liability] : []).data?.[0];
  const owesAlready = liabilityNow?.balance.some((b) => cents(b.number) !== 0n) ?? false;
  const payingOpens = chart.data?.find((a) => a.name === paying)?.open ?? null;
  const beforeBooks = payingOpens ? dueSoFar.filter((r) => r.date < payingOpens).length : 0;

  const history: LoanHistory | null = !table
    ? null
    : kind === "start"
      ? { kind, on: borrowed || monthBefore(start), against, confirm }
      : kind === "today"
        ? { kind, on: owedOn, owed: (owed || owedNow).replace(/[$,]/g, ""), against }
        : { kind: "books" };

  const valid =
    !!name.trim() &&
    !!liability &&
    !!paying &&
    !!interest &&
    !!table &&
    !!history &&
    !save.isPending;

  const extras = ({ lender, escrow, from }: TableExtras) => {
    if (lender && !payee) setPayee(lender);
    if (escrow) offerEscrow(escrow, from ?? undefined);
  };
  const offerEscrow = (amount: string, from?: string) =>
    setOthers((current) =>
      current.some((o) => /escrow/i.test(o.name))
        ? current
        : [
            ...current,
            {
              name: "Escrow",
              account: escrowAccount(name),
              amount,
              from: from ?? now,
            },
          ]
    );

  const submit = async () => {
    if (!table || !history) return;
    setError(null);
    try {
      // Accounts named but not in the chart yet (escrow's, say) are opened first.
      const known = new Set((chart.data ?? []).map((a) => a.name));
      for (const account of new Set([
        liability,
        paying,
        interest,
        asset,
        ...others.map((o) => o.account),
      ]))
        if (account && !known.has(account))
          await createAccount.mutateAsync({ name: account, kind: "leaf" });
      const input: LoanIn = {
        name: name.trim(),
        payee: payee.trim() || null,
        accounts: { liability, paying, interest, asset: asset || null },
        currency,
        table,
        others: others.map((o) => ({ ...o, from: o.from || start })),
        tolerance: tolerance.trim() || "0",
        auto_confirm: autoConfirm,
        history,
      };
      const made = await save.mutateAsync({ loan: input });
      if (asSpending) await counting.run(made, await api.accounts(book));
      navigate(`/books/${book}/loans/${made.id}`);
    } catch (e) {
      setError(explain(e));
    }
  };

  const liabilities = leavesUnder(chart.data, ["Liabilities"]);
  const payers = leavesUnder(chart.data, ["Assets", "Liabilities"]);
  const expenses = leavesUnder(chart.data, ["Expenses"]);
  const assets = leavesUnder(chart.data, ["Assets"]);
  const againstChoices = [OPENING, ...(asset ? [asset] : [])];

  return (
    <form
      className="editor loan-editor"
      onSubmit={(e) => (e.preventDefault(), valid && void submit())}
    >
      <label>
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Mortgage" />
      </label>
      <label>
        Lender <span className="muted">(optional: the payee on its payments)</span>
        <input value={payee} onChange={(e) => setPayee(e.target.value)} />
      </label>

      <fieldset>
        <legend>Accounts</legend>
        <PickerField
          label="What's owed"
          accounts={liabilities}
          value={liability}
          onChange={setLiability}
          prefer={["Liabilities"]}
          {...(create ? { create } : {})}
        />
        <PickerField
          label="Paid from"
          accounts={payers}
          value={paying}
          onChange={setPaying}
          prefer={["Assets", "Liabilities"]}
          {...(create ? { create } : {})}
        />
        <PickerField
          label="Interest goes to"
          accounts={expenses}
          value={interest}
          onChange={setInterest}
          prefer={["Expenses"]}
          {...(create ? { create } : {})}
        />
        <PickerField
          label="What it bought (optional)"
          accounts={assets}
          value={asset}
          onChange={setAsset}
          prefer={["Assets"]}
        />
      </fieldset>

      <fieldset>
        <legend>The amortization table</legend>
        <LoanTableSource book={book} currency={currency} onChange={setTable} onExtras={extras} />
      </fieldset>

      <OthersFieldset
        others={others}
        onChange={setOthers}
        accounts={chart.data}
        {...(create ? { create } : {})}
        from={start || now}
        loanName={name}
      />

      {table && (
        <fieldset>
          <legend>Its history</legend>
          <p className="muted small">
            {dueSoFar.length
              ? `${dueSoFar.length} payment${dueSoFar.length === 1 ? " was" : "s were"} due by today, ${formatDay(dueSoFar[0]!.date)}${dueSoFar.length > 1 ? ` to ${formatDay(dueSoFar.at(-1)!.date)}` : ""}.`
              : `Its first payment is ${formatDay(start)}.`}
          </p>
          <div className="loan-history" role="radiogroup" aria-label="Its history">
            <label className="check">
              <input type="radio" checked={kind === "start"} onChange={() => setKind("start")} />
              From the start: what was borrowed, then every payment
            </label>
            <label className="check">
              <input type="radio" checked={kind === "today"} onChange={() => setKind("today")} />
              From today: what&apos;s owed now, then payments from the next one
            </label>
            <label className="check">
              <input type="radio" checked={kind === "books"} onChange={() => setKind("books")} />
              Already in the books: payments from the next one
            </label>
          </div>
          {kind === "start" && (
            <>
              <div className="pair">
                <label>
                  Borrowed on
                  <input
                    type="date"
                    value={borrowed || monthBefore(start)}
                    onChange={(e) => setBorrowed(e.target.value)}
                  />
                </label>
                <Against value={against} onChange={setAgainst} choices={againstChoices} />
              </div>
              <label className="check">
                <input
                  type="checkbox"
                  checked={confirm}
                  onChange={(e) => setConfirm(e.target.checked)}
                />
                Confirm them (no review needed)
              </label>
              <p className="small muted">
                {usd(tableStarts(table), currency)} borrowed, then {dueSoFar.length} payment
                {dueSoFar.length === 1 ? "" : "s"}.
                {beforeBooks > 0 &&
                  ` The ${beforeBooks} before ${paying}'s books begin (${formatDay(payingOpens!)}) come from Opening Balances, principal and interest only, so its balance stays as it is.`}{" "}
                A payment already in {paying || "the paying account"} (the same amount, within 5
                days) is filled in rather than added again.
              </p>
            </>
          )}
          {kind === "today" && (
            <>
              <div className="pair">
                <label>
                  Owed
                  <input
                    inputMode="decimal"
                    value={owed}
                    onChange={(e) => setOwed(e.target.value)}
                    placeholder={owedNow}
                  />
                </label>
                <label>
                  On
                  <input type="date" value={owedOn} onChange={(e) => setOwedOn(e.target.value)} />
                </label>
              </div>
              <Against value={against} onChange={setAgainst} choices={againstChoices} />
              <p className="small muted">
                {owed
                  ? "What the lender's statement says."
                  : `From the table, after payment ${dueSoFar.at(-1)?.number ?? 0}: type the lender's figure if it differs.`}{" "}
                {against === OPENING
                  ? "Against Opening Balances, so what it bought keeps its own value."
                  : `Against ${against}, which goes up by what's owed.`}
              </p>
            </>
          )}
          {kind === "books" && (
            <p className="small muted">
              {liability
                ? owesAlready
                  ? `${liability} already says what's owed: ${usd(money(-cents(liabilityNow!.balance[0]!.number)), currency)}.`
                  : `${liability} doesn't say anything's owed yet.`
                : "Choose what's owed above."}{" "}
              Nothing is written; payments start{" "}
              {table.rows.find((r) => r.date > now)
                ? formatDay(table.rows.find((r) => r.date > now)!.date)
                : "never: the table has ended"}
              .
            </p>
          )}
          {owesAlready && kind !== "books" && (
            <p className="small warning">
              {liability} already says what&apos;s owed: choose &quot;Already in the books&quot;.
            </p>
          )}
        </fieldset>
      )}

      <fieldset>
        <legend>Payments</legend>
        <label>
          Match tolerance <span className="muted">(optional)</span>
          <input
            inputMode="decimal"
            value={tolerance}
            onChange={(e) => setTolerance(e.target.value)}
            placeholder="0.00"
          />
          <span className="small muted">
            A bank&apos;s amount within it matches the payment, and the difference goes to escrow
            (to principal, without escrow).
          </span>
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={autoConfirm}
            onChange={(e) => setAutoConfirm(e.target.checked)}
          />
          Confirm payments automatically (no review needed)
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={asSpending}
            onChange={(e) => setAsSpending(e.target.checked)}
          />
          Count the whole payment as monthly spending
        </label>
        {asSpending && interest && (
          <p className="small muted">
            Principal counts as {spendingAccount(name || "Loan", interest, "Principal")}
            {others.some((o) => o.account.startsWith("Assets:"))
              ? `, and escrow as ${spendingAccount(name || "Loan", interest, "Escrow")}, whose tax and insurance bills then aren't counted again`
              : ""}
            : in budgets, home and Reports&apos; outflows.
          </p>
        )}
        {table && (
          <p className="small muted">
            Payments are staged as they come due, monthly on the{" "}
            {new Date(`${start}T00:00:00Z`).getUTCDate()}
            {ordinalSuffix(new Date(`${start}T00:00:00Z`).getUTCDate())}, until{" "}
            {monthOf(table.rows.at(-1)!.date)} or it&apos;s paid off.
          </p>
        )}
      </fieldset>

      {error && <p className="error">{error}</p>}
      <div className="actions pinned">
        <Link href={back} className="button">
          Back
        </Link>
        <button type="submit" className="primary" disabled={!valid}>
          Save
        </button>
      </div>
    </form>
  );
}

function ordinalSuffix(n: number): string {
  const tens = n % 100;
  return tens >= 11 && tens <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
}

/** The other side of what's owed: Opening Balances, or what the loan bought. */
function Against({
  value,
  onChange,
  choices,
}: {
  value: string;
  onChange: (v: string) => void;
  choices: string[];
}) {
  return (
    <label>
      Against
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {choices.map((c) => (
          <option key={c} value={c}>
            {c === OPENING ? "Opening Balances" : c}
          </option>
        ))}
      </select>
    </label>
  );
}
