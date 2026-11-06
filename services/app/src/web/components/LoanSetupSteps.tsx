import { useId } from "react";

import { cents, money, paymentFor, tableStarts } from "../../shared/loans.js";
import { formatFullDay, today } from "../lib/format.js";
import {
  accountsOf,
  borrowedOn,
  dueBy,
  monthBefore,
  otherAccount,
  owedByTable,
  payingOf,
  tableOf,
  type Context,
  type EscrowBill,
  type LoanDraft,
  type LoanKind,
} from "../lib/loan-setup.js";
import { inChart, leavesUnder, PickerField, planned, RowsTable, usd } from "./Loans.js";

/** What every step gets: the answers so far, and a way to change them. */
export type StepProps = {
  draft: LoanDraft;
  set: (patch: Partial<LoanDraft>) => void;
  ctx: Context;
};

const KINDS: [LoanKind, string][] = [
  ["home", "A home"],
  ["car", "A car"],
  ["other", "Something else"],
];

/** Step 1: what the loan is for. Its answer names the loan's accounts. */
export function ForStep({ draft, set }: StepProps) {
  const help = useId();
  return (
    <>
      <h2 className="setup-question">What is this loan for?</h2>
      <div className="segmented" role="radiogroup" aria-label="What kind of loan">
        {KINDS.map(([kind, label]) => (
          <button
            key={kind}
            type="button"
            role="radio"
            aria-checked={draft.kind === kind}
            className={draft.kind === kind ? "on" : ""}
            onClick={() => set({ kind })}
          >
            {label}
          </button>
        ))}
      </div>
      <input
        className="setup-answer"
        aria-label="What is this loan for?"
        aria-describedby={help}
        value={draft.purpose}
        onChange={(e) => set({ purpose: e.target.value })}
        placeholder={draft.kind === "car" ? "2023 Chevy Spark" : "123 Main St"}
      />
      <p id={help} className="small muted">
        Be specific. Something like &ldquo;123 Main St&rdquo; for a home or &ldquo;2023 Chevy
        Spark&rdquo; for a car.
      </p>
    </>
  );
}

/** Step 2: the terms, and the table they make, to check against the paperwork. */
export function TermsStep({ draft, set, ctx }: StepProps) {
  const { table } = tableOf(draft);
  const cost = draft.kind === "home" || draft.kind === "car";
  const worked =
    draft.amount && draft.rate && Number(draft.payments) > 0
      ? paymentFor(
          draft.amount.replace(/[$,\s]/g, ""),
          draft.rate.replace(/%/g, "").trim(),
          Number(draft.payments)
        )
      : null;
  return (
    <>
      <h2 className="setup-question">Its terms</h2>
      <p className="small muted">
        From the loan&apos;s paperwork{draft.kind === "home" ? " (the closing disclosure)" : ""}.
      </p>
      <div className="pair">
        <label>
          Borrowed
          <input
            inputMode="decimal"
            value={draft.amount}
            onChange={(e) => set({ amount: e.target.value })}
            placeholder="300000.00"
          />
        </label>
        <label>
          Rate (% a year)
          <input
            inputMode="decimal"
            value={draft.rate}
            onChange={(e) => set({ rate: e.target.value })}
            placeholder="6.5"
          />
        </label>
      </div>
      <div className="pair">
        <label>
          Monthly payments
          <input
            inputMode="numeric"
            value={draft.payments}
            onChange={(e) => set({ payments: e.target.value })}
          />
          <span className="small muted">30 years is 360; 15 is 180</span>
        </label>
        <label>
          First payment
          <input type="date" value={draft.first} onChange={(e) => set({ first: e.target.value })} />
          <span className="small muted">The day it&apos;s due</span>
        </label>
      </div>
      <div className="pair">
        <label>
          Borrowed on
          <input
            type="date"
            value={draft.borrowed || (draft.first ? monthBefore(draft.first) : "")}
            onChange={(e) => set({ borrowed: e.target.value })}
          />
          <span className="small muted">
            {draft.kind === "home" ? "Closing day" : "The loan's date"}
          </span>
        </label>
        {cost && (
          <label>
            What it cost
            <input
              inputMode="decimal"
              value={draft.price}
              onChange={(e) => set({ price: e.target.value })}
              placeholder="375000.00"
            />
            <span className="small muted">Optional: so net worth counts it</span>
          </label>
        )}
      </div>
      <label>
        Principal and interest each month <span className="muted">(optional)</span>
        <input
          inputMode="decimal"
          value={draft.payment}
          onChange={(e) => set({ payment: e.target.value })}
          placeholder={worked ?? "Worked out"}
        />
        <span className="small muted">If the lender&apos;s differs by a cent, type theirs.</span>
      </label>
      {table && (
        <div className="loan-preview" aria-live="polite">
          <p>
            <strong>Does this match your paperwork?</strong>
          </p>
          <p className="small">
            {table.rows.length} payments of {usd(table.payment, ctx.currency)} at {table.rate}%,
            from {formatFullDay(table.rows[0]!.date)} to {formatFullDay(table.rows.at(-1)!.date)}.
            Borrowed {usd(tableStarts(table), ctx.currency)}; interest in all{" "}
            {usd(money(table.rows.reduce((sum, r) => sum + cents(r.interest), 0n)), ctx.currency)}.
          </p>
          <RowsTable rows={table.rows} currency={ctx.currency} />
        </div>
      )}
    </>
  );
}

const goesTo = (account: string) => (
  <span className="small muted">Goes to {account}. You can change it at the end.</span>
);

const newBill = (every: number): EscrowBill => ({ amount: "", every, next: "" });

/** A bill escrow pays: an amount, how often, and when it's next due. */
function BillFields({
  label,
  value,
  onChange,
  every,
  account,
}: {
  label: string;
  value: EscrowBill | null;
  onChange: (bill: EscrowBill | null) => void;
  every: [number, string][];
  account: string;
}) {
  return (
    <div className="setup-bill">
      <label className="check">
        <input
          type="checkbox"
          checked={!!value}
          onChange={(e) => onChange(e.target.checked ? newBill(every[0]![0]) : null)}
        />
        {label}
      </label>
      {value && (
        <>
          <div className="pair">
            <label>
              {label}: amount
              <input
                inputMode="decimal"
                value={value.amount}
                onChange={(e) => onChange({ ...value, amount: e.target.value })}
              />
            </label>
            <label>
              How often
              <select
                value={value.every}
                onChange={(e) => onChange({ ...value, every: Number(e.target.value) })}
              >
                {every.map(([months, name]) => (
                  <option key={months} value={months}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label>
            {label}: next due
            <input
              type="date"
              value={value.next}
              onChange={(e) => onChange({ ...value, next: e.target.value })}
            />
          </label>
          {goesTo(account)}
        </>
      )}
    </div>
  );
}

/** Step 3: what's paid with it beyond principal and interest. */
export function ExtrasStep({ draft, set }: StepProps) {
  const accounts = accountsOf(draft);
  const home = draft.kind === "home";
  const escrow = draft.escrow;
  const setEscrow = (patch: Partial<NonNullable<LoanDraft["escrow"]>>) =>
    escrow && set({ escrow: { ...escrow, ...patch } });
  const setOther = (i: number, patch: Partial<LoanDraft["others"][number]>) =>
    set({ others: draft.others.map((o, j) => (j === i ? { ...o, ...patch } : o)) });
  return (
    <>
      <h2 className="setup-question">Anything else paid with it?</h2>
      <p className="small muted">
        {home
          ? "Beyond principal and interest, a mortgage payment often carries escrow (the property tax and insurance the lender pays for you) and PMI."
          : "Beyond principal and interest: insurance, say, or a fee."}{" "}
        Leave this empty if there&apos;s nothing.
      </p>

      {home && (
        <fieldset className="setup-extra">
          <legend>Escrow</legend>
          <label className="check">
            <input
              type="checkbox"
              checked={!!escrow}
              onChange={(e) =>
                set({
                  escrow: e.target.checked
                    ? { amount: "", held: "", heldOn: "", tax: null, insurance: null }
                    : null,
                })
              }
            />
            Part of each payment goes to escrow
          </label>
          {escrow && (
            <>
              <label>
                Escrow each month
                <input
                  inputMode="decimal"
                  value={escrow.amount}
                  onChange={(e) => setEscrow({ amount: e.target.value })}
                  placeholder="450.00"
                />
                {goesTo(accounts.escrow)}
              </label>
              <div className="pair">
                <label>
                  What&apos;s in it now
                  <input
                    inputMode="decimal"
                    value={escrow.held}
                    onChange={(e) => setEscrow({ held: e.target.value })}
                  />
                </label>
                <label>
                  On
                  <input
                    type="date"
                    value={escrow.heldOn || today()}
                    onChange={(e) => setEscrow({ heldOn: e.target.value })}
                  />
                </label>
              </div>
              <p className="small muted">
                Optional: from the lender&apos;s latest statement, so the books&apos; escrow starts
                where the lender&apos;s is.
              </p>
              <p className="small">
                <strong>The bills it pays</strong>{" "}
                <span className="muted">
                  (optional: set them up now, or later from the loan&apos;s page)
                </span>
              </p>
              <BillFields
                label="Property tax"
                value={escrow.tax}
                onChange={(tax) => setEscrow({ tax })}
                every={[
                  [12, "Yearly"],
                  [6, "Twice a year"],
                  [3, "Quarterly"],
                ]}
                account={accounts.tax}
              />
              <BillFields
                label="Homeowner's insurance"
                value={escrow.insurance}
                onChange={(insurance) => setEscrow({ insurance })}
                every={[
                  [12, "Yearly"],
                  [6, "Twice a year"],
                ]}
                account={accounts.insurance}
              />
            </>
          )}
        </fieldset>
      )}

      {home && (
        <fieldset className="setup-extra">
          <legend>PMI</legend>
          <label className="check">
            <input
              type="checkbox"
              checked={draft.pmi !== null}
              onChange={(e) => set({ pmi: e.target.checked ? "" : null })}
            />
            It pays private mortgage insurance
          </label>
          {draft.pmi !== null && (
            <label>
              PMI each month
              <input
                inputMode="decimal"
                value={draft.pmi}
                onChange={(e) => set({ pmi: e.target.value })}
                placeholder="125.00"
              />
              {goesTo(accounts.pmi)}
            </label>
          )}
        </fieldset>
      )}

      <fieldset className="setup-extra">
        <legend>{home ? "Anything else" : "Paid with it"}</legend>
        {draft.others.map((o, i) => (
          <div className="loan-other" key={i}>
            <div className="pair">
              <label>
                Name
                <input value={o.name} onChange={(e) => setOther(i, { name: e.target.value })} />
              </label>
              <label>
                Each month
                <input
                  inputMode="decimal"
                  value={o.amount}
                  onChange={(e) => setOther(i, { amount: e.target.value })}
                />
              </label>
            </div>
            {o.name.trim() && goesTo(o.account || otherAccount(o.name, draft.purpose))}
            <button
              type="button"
              className="link-button"
              onClick={() => set({ others: draft.others.filter((_, j) => j !== i) })}
            >
              Remove {o.name.trim() || "it"}
            </button>
          </div>
        ))}
        <div>
          <button
            type="button"
            onClick={() =>
              set({ others: [...draft.others, { name: "", amount: "", account: "" }] })
            }
          >
            + {draft.others.length ? "Something more" : "Something else"}
          </button>
        </div>
      </fieldset>
    </>
  );
}

/** Step 4 (when payments are already due): how they come into the books. */
export function HistoryStep({ draft, set, ctx }: StepProps) {
  const { table } = tableOf(draft);
  if (!table) return null;
  const due = dueBy(table, ctx.today);
  const on = draft.owedOn || ctx.today;
  const fromTable = owedByTable(table, on);
  const span =
    due.length === 1
      ? `1 payment was due, on ${formatFullDay(due[0]!.date)}`
      : `${due.length} payments were due, from ${formatFullDay(due[0]!.date)} to ${formatFullDay(due.at(-1)!.date)}`;
  return (
    <>
      <h2 className="setup-question">Payments so far</h2>
      <p>{span}. How should they go into your books?</p>
      <div className="setup-options" role="radiogroup" aria-label="Payments so far">
        <label className={`setup-option${draft.history === "each" ? " on" : ""}`}>
          <input
            type="radio"
            checked={draft.history === "each"}
            onChange={() => set({ history: "each" })}
          />
          <span>
            <strong>Record each payment</strong>
            <span className="small muted">
              The loan from {formatFullDay(borrowedOn(draft))}, then every payment split into
              principal, interest and anything paid with it. Payments your bank already sent in are
              split up, not added twice. You get the whole interest history, which helps at tax
              time.
            </span>
          </span>
        </label>
        <label className={`setup-option${draft.history === "now" ? " on" : ""}`}>
          <input
            type="radio"
            checked={draft.history === "now"}
            onChange={() => set({ history: "now" })}
          />
          <span>
            <strong>Start from what I owe now</strong>
            <span className="small muted">
              One entry for what&apos;s owed, then each payment from the next one. Quicker, but the
              books won&apos;t have the interest paid so far.
            </span>
          </span>
        </label>
      </div>
      {draft.history === "now" && (
        <>
          <div className="pair">
            <label>
              Owed
              <input
                inputMode="decimal"
                value={draft.owed}
                onChange={(e) => set({ owed: e.target.value })}
                placeholder={fromTable}
              />
            </label>
            <label>
              On
              <input type="date" value={on} onChange={(e) => set({ owedOn: e.target.value })} />
            </label>
          </div>
          <p className="small muted">
            {draft.owed.trim()
              ? "What the lender's statement says."
              : `${usd(fromTable, ctx.currency)} is what the table says. If your latest statement differs, type its figure.`}
          </p>
        </>
      )}
    </>
  );
}

/** Step 5: what pays it, the lender, matching the bank's row, confirming. */
export function PaymentStep({ draft, set, ctx }: StepProps) {
  const paying = payingOf(draft, ctx.paying);
  const choices = leavesUnder(ctx.chart, ["Assets", "Liabilities"]);
  const fresh = !!paying && !inChart(ctx.chart, paying);
  return (
    <>
      <h2 className="setup-question">How is it paid?</h2>
      <PickerField
        label="Paid from"
        accounts={fresh ? [...choices, paying] : choices}
        value={paying}
        onChange={(account) => set({ paying: account })}
        prefer={["Assets", "Liabilities"]}
        create={planned(ctx.chart)}
        {...(fresh ? { suggest: paying } : {})}
      />
      <p className="small muted">The account the payments come out of: your autopay&apos;s.</p>
      <label>
        Lender <span className="muted">(optional)</span>
        <input
          value={draft.lender}
          onChange={(e) => set({ lender: e.target.value })}
          placeholder="Who you pay"
        />
        <span className="small muted">The payee on its payments.</span>
      </label>
      <label>
        Match tolerance <span className="muted">(optional)</span>
        <input
          inputMode="decimal"
          value={draft.tolerance}
          onChange={(e) => set({ tolerance: e.target.value })}
          placeholder="0.00"
        />
        <span className="small muted">
          How far the bank&apos;s amount may be from the payment and still be it. The difference
          goes to {draft.kind === "home" && draft.escrow ? "escrow" : "principal"}.
          {draft.kind === "home" && draft.escrow
            ? " Escrow changes once a year or so, so a little room helps."
            : ""}
        </span>
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={draft.autoConfirm}
          onChange={(e) => set({ autoConfirm: e.target.checked })}
        />
        Confirm payments automatically (no review needed)
      </label>
    </>
  );
}
