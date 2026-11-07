import { cents, money, tableStarts } from "../../shared/loans.js";
import { formatFullDay, formatMonth } from "../lib/format.js";
import {
  accountsOf,
  billsOf,
  borrowedOn,
  clean,
  dueBy,
  historyOf,
  loanName,
  nextPayment,
  outflowsOf,
  payingOf,
  tableOf,
  usedAccounts,
  type Accounts,
  type Step,
} from "../lib/loan-setup.js";
import { AccountPicker } from "./AccountPicker.js";
import type { StepProps } from "./LoanSetupSteps.js";
import { inChart, leavesUnder, planned, usd } from "./Loans.js";

const EVERY: Record<number, string> = {
  12: "yearly",
  6: "twice a year",
  3: "quarterly",
  1: "monthly",
};

/** One of the setup's accounts: a picker (pick another, or "Create account" to name a new
 * one), marked new or already in the books. */
function Slot({
  label,
  value,
  onChange,
  roots,
  ctx,
}: {
  label: string;
  value: string;
  onChange: (account: string) => void;
  roots: string[];
  ctx: StepProps["ctx"];
}) {
  const fresh = !!value && !inChart(ctx.chart, value);
  const choices = leavesUnder(ctx.chart, roots);
  return (
    <div className="setup-slot">
      <AccountPicker
        label={label}
        accounts={fresh ? [...choices, value] : choices}
        value={value}
        onChange={onChange}
        prefer={roots}
        create={planned(ctx.chart)}
        {...(fresh ? { suggest: value } : {})}
      />
      {value && (
        <span className={`pill ${fresh ? "staged" : "confirmed"}`}>
          {fresh ? "New" : "In the books"}
        </span>
      )}
    </div>
  );
}

/** A card's heading, with a way back to the step its answers came from. */
function Heading({ title, step, go }: { title: string; step?: Step; go: (s: Step) => void }) {
  return (
    <div className="setup-heading">
      <h3>{title}</h3>
      {step && (
        <button type="button" className="link-button" onClick={() => go(step)}>
          Change
        </button>
      )}
    </div>
  );
}

/**
 * The questionnaire's last page: where the money will flow (each account changeable, new ones
 * marked), what Confirm writes, what happens as payments come in, and what to do later. Counting
 * principal and escrow as spending is offered here, off until chosen (Kael).
 */
export function LoanConfirm({
  draft,
  set,
  ctx,
  go,
  owed,
}: StepProps & {
  go: (step: Step) => void;
  /** What the books say is owed already, when the loan's account says so. */
  owed: string | null;
}) {
  const { table } = tableOf(draft);
  if (!table) return null;
  const a = accountsOf(draft);
  const paying = payingOf(draft, ctx.paying);
  const history = historyOf(draft, table, ctx.today, ctx.owesAlready);
  const next = nextPayment(draft, table, history, ctx.today);
  const bills = billsOf(draft, ctx.currency);
  const fresh = usedAccounts(draft, table, paying).filter((n) => !inChart(ctx.chart, n));
  const escrow = draft.kind === "home" && draft.escrow;
  const due = dueBy(table, ctx.today);
  const payingOpens = ctx.chart.find((x) => x.name === paying && !x.implicit)?.open ?? null;
  const beforeBooks = payingOpens ? due.filter((r) => r.date < payingOpens).length : 0;
  const cur = ctx.currency;
  const choose = (role: keyof Accounts) => (account: string) =>
    set({ accounts: { ...draft.accounts, [role]: account } });

  // Each part of the next payment, and the account it goes to.
  const parts = next
    ? [
        {
          name: "Principal",
          amount: money(cents(next.principal) + cents(next.extra)),
          slot: (
            <Slot
              label="Principal goes to"
              value={a.liability}
              onChange={choose("liability")}
              roots={["Liabilities"]}
              ctx={ctx}
            />
          ),
        },
        {
          name: "Interest",
          amount: next.interest,
          slot: (
            <Slot
              label="Interest goes to"
              value={a.interest}
              onChange={choose("interest")}
              roots={["Expenses"]}
              ctx={ctx}
            />
          ),
        },
        ...next.others.map((o) => {
          const i = draft.others.findIndex((x) => x.name.trim() === o.name);
          const onChange =
            i >= 0
              ? (account: string) =>
                  set({
                    others: draft.others.map((x, j) => (j === i ? { ...x, account } : x)),
                  })
              : choose(o.name === "Escrow" ? "escrow" : "pmi");
          return {
            name: o.name,
            amount: o.amount,
            slot: (
              <Slot
                label={`${o.name} goes to`}
                value={o.account}
                onChange={onChange}
                roots={o.name === "Escrow" ? ["Assets"] : ["Expenses", "Assets", "Liabilities"]}
                ctx={ctx}
              />
            ),
          };
        }),
      ]
    : [];

  return (
    <>
      <h2 className="setup-question">Check it over</h2>
      <p className="small muted">
        Nothing&apos;s been made yet. Change anything below, then Confirm.
      </p>

      <section className="card setup-card" aria-label="Each payment">
        <Heading title="Each payment" step="terms" go={go} />
        {next ? (
          <>
            <p>
              <strong>
                {usd(next.total, cur)} on {formatFullDay(next.nominal)}
              </strong>
              , then monthly on the {ordinal(Number(next.nominal.slice(8)))} until{" "}
              {formatMonth(table.rows.at(-1)!.date)} or it&apos;s paid off, from
            </p>
            <Slot
              label="Paid from"
              value={paying}
              onChange={(account) => set({ paying: account })}
              roots={["Assets", "Liabilities"]}
              ctx={ctx}
            />
            <ul className="setup-flow">
              {parts.map((p) => (
                <li key={p.name}>
                  <span className="setup-part">
                    {p.name} <span className="setup-amount">{usd(p.amount, cur)}</span>
                  </span>
                  {p.slot}
                </li>
              ))}
            </ul>
            <p className="small muted">
              Those are the next payment&apos;s parts: each month a little more goes to principal
              and a little less to interest.
            </p>
          </>
        ) : (
          <p className="muted">Its table has ended: there&apos;s nothing more to pay.</p>
        )}
      </section>

      {escrow && (
        <section className="card setup-card" aria-label="Paid from escrow">
          <Heading title="Paid from escrow" step="extras" go={go} />
          {bills.length ? (
            <ul className="setup-flow">
              {bills.map((b, i) => {
                const role = b.template.narration === "Property tax" ? "tax" : "insurance";
                return (
                  <li key={i}>
                    <span className="setup-part">
                      {b.template.narration}{" "}
                      <span className="setup-amount">
                        {usd(b.template.postings[1]!.units!.number, cur)}{" "}
                        {EVERY[b.rule.every] ?? `every ${b.rule.every} months`}, from{" "}
                        {formatFullDay(b.rule.start)}
                      </span>
                    </span>
                    <Slot
                      label={`${b.template.narration} goes to`}
                      value={a[role]}
                      onChange={choose(role)}
                      roots={["Expenses"]}
                      ctx={ctx}
                    />
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="small">
              No bills set up yet. Add the property tax and insurance later from the loan&apos;s
              page: Escrow, then &ldquo;+ A payment from escrow&rdquo;. Until then the books&apos;
              escrow only grows.
            </p>
          )}
        </section>
      )}

      <section className="card setup-card" aria-label="The loan">
        <Heading title="The loan" go={go} />
        <label>
          Its name
          <input
            value={draft.name}
            onChange={(e) => set({ name: e.target.value })}
            placeholder={loanName({ ...draft, name: "" })}
          />
        </label>
        <div className="picker-field">
          <span className="small muted">What it bought</span>
          {a.asset ? (
            <>
              <Slot
                label="What it bought"
                value={a.asset}
                onChange={choose("asset")}
                roots={["Assets"]}
                ctx={ctx}
              />
              <button type="button" className="link-button" onClick={() => choose("asset")("")}>
                It didn&apos;t buy anything to keep track of
              </button>
            </>
          ) : (
            <Slot
              label="What it bought"
              value=""
              onChange={choose("asset")}
              roots={["Assets"]}
              ctx={ctx}
            />
          )}
        </div>
      </section>

      <section className="card setup-card" aria-label="As spending">
        <Heading title="As spending" go={go} />
        <label className="check">
          <input
            type="checkbox"
            checked={draft.spending}
            onChange={(e) => set({ spending: e.target.checked })}
          />
          Count principal{escrow ? " and escrow" : ""} as monthly spending
        </label>
        <p className="small muted">
          Principal{escrow ? " and escrow" : ""} aren&apos;t expenses in the books (they pay down a
          debt{escrow ? ", and fill an account the lender holds" : ""}). Counted as spending, the
          whole payment shows in budgets, home and Reports each month
          {escrow ? ", and what escrow pays isn't counted again" : ""}.
        </p>
        {draft.spending && (
          <>
            <div className="picker-field">
              <span className="small muted">Principal counts as</span>
              <Slot
                label="Principal counts as"
                value={a.principalAs}
                onChange={choose("principalAs")}
                roots={["Expenses"]}
                ctx={ctx}
              />
            </div>
            {escrow && (
              <div className="picker-field">
                <span className="small muted">Escrow counts as</span>
                <Slot
                  label="Escrow counts as"
                  value={a.escrowAs}
                  onChange={choose("escrowAs")}
                  roots={["Expenses"]}
                  ctx={ctx}
                />
              </div>
            )}
          </>
        )}
      </section>

      <section className="card setup-card" aria-label="When you confirm">
        <Heading title="When you confirm" go={go} />
        <ul className="setup-list">
          {fresh.length > 0 && (
            <li>
              Opens {fresh.length === 1 ? "an account" : `${fresh.length} accounts`}:{" "}
              {fresh.join(", ")}.
            </li>
          )}
          {a.asset && !inChart(ctx.chart, a.asset) && (
            <li>
              {clean(draft.price)
                ? `${a.asset} starts at ${usd(clean(draft.price), cur)} on ${formatFullDay(borrowedOn(draft))} (against Opening Balances), and asks for a new value each year.`
                : `${a.asset} starts at nothing: give it a value from its page (Update value).`}
              {clean(draft.price) &&
                payingOpens &&
                payingOpens <= borrowedOn(draft) &&
                ` ${paying}'s records go back to then: if the down payment is among them, categorize it to Opening Balances, or it's counted twice.`}
            </li>
          )}
          {history.kind === "start" && (
            <li>
              Records the loan: {usd(tableStarts(table), cur)} owed from {formatFullDay(history.on)}{" "}
              (against Opening Balances)
              {due.length
                ? `, then the ${due.length === 1 ? "payment" : `${due.length} payments`} due through today, confirmed, each split into its parts. A payment already in ${paying} (the same amount, within 5 days) is split up rather than added again.`
                : "."}
              {beforeBooks > 0 &&
                ` The ${beforeBooks} due before ${paying}'s records begin (${formatFullDay(payingOpens!)}) come from Opening Balances (escrow and the rest included), so ${paying}'s balance stays as it is.`}
            </li>
          )}
          {history.kind === "today" && (
            <li>
              Records that {usd(history.owed, cur)} is owed on {formatFullDay(history.on)} (against
              Opening Balances).
            </li>
          )}
          {history.kind === "books" && (
            <li>
              {a.liability} already says {owed ? usd(owed, cur) : "something"} is owed, so nothing
              is written for it.
            </li>
          )}
          {escrow && clean(escrow.held) && (
            <li>
              Sets {a.escrow} to {usd(clean(escrow.held), cur)} on{" "}
              {formatFullDay(escrow.heldOn || ctx.today)}: whatever the books lack goes against
              Opening Balances.
            </li>
          )}
          {next && (
            <li>
              Schedules the payment: each one is written on its due date, from{" "}
              {formatFullDay(next.nominal)}.
            </li>
          )}
          {bills.length > 0 && (
            <li>
              Schedules {bills.map((b) => b.template.narration.toLowerCase()).join(" and ")}, paid
              from {a.escrow}, each written on its due date for you to confirm.
            </li>
          )}
          {outflowsOf(draft).map((o) => (
            <li key={o.account}>
              Counts what&apos;s paid into {o.account} as {o.as}.
            </li>
          ))}
        </ul>
      </section>

      <section className="card setup-card" aria-label="When a payment comes in">
        <Heading title="When a payment comes in" step="payment" go={go} />
        <p className="small">
          On each due date the payment is written into your books, split into its parts,{" "}
          {draft.autoConfirm ? "and confirmed" : "for you to confirm in Review"}. When{" "}
          {paying || "the paying account"}&apos;s bank feed brings in the payment, it&apos;s matched
          to that one rather than added twice
          {cents(clean(draft.tolerance) || "0") > 0n
            ? `: an amount within ${usd(clean(draft.tolerance), cur)} still matches, and the difference goes to ${escrow ? "escrow" : "principal"}.`
            : ": the amounts have to be the same. If the bank's can differ (escrow changes), set a match tolerance."}
        </p>
      </section>

      <section className="card setup-card" aria-label="Later">
        <Heading title="Later" go={go} />
        <LoanHowTo escrow={!!escrow} bills={bills.length > 0} where="setup" />
      </section>
    </>
  );
}

/**
 * What to do when the loan changes: an extra payment, escrow changing, a bill paid from escrow,
 * the lender's figure. The same words on the confirmation page and the loan's page.
 */
export function LoanHowTo({
  escrow,
  bills,
  where,
}: {
  escrow: boolean;
  bills: boolean;
  where: "setup" | "page";
}) {
  const on = (card: string) =>
    where === "setup" ? `${card} on the loan's page` : `${card}, above`;
  return (
    <ul className="setup-list">
      <li>
        <strong>You pay extra:</strong> use {on("Extra payment")}. Interest is worked out from
        what&apos;s owed, so later payments put more toward principal and the loan ends sooner; the
        payment stays the same.
      </li>
      {escrow && (
        <li>
          <strong>Escrow changes:</strong> when the lender says so, add it in {on("Changes")}:
          escrow&apos;s new amount from its date. Payments from then use it.
        </li>
      )}
      {escrow && (
        <li>
          <strong>Taxes or insurance are paid from escrow:</strong>{" "}
          {bills
            ? "they're schedules paid from escrow, written on their due dates for you to confirm. When a bill comes to a different amount, correct it in Review, or change its schedule for the years after."
            : `add each as a schedule paid from escrow: ${on("Escrow")}, "+ A payment from escrow". Each is then written on its due date for you to confirm.`}
        </li>
      )}
      <li>
        <strong>The lender&apos;s statement differs:</strong> enter what it says is owed in{" "}
        {on("Lender's statement")}. The difference is written as an adjustment, so the books agree
        with the lender.
      </li>
    </ul>
  );
}

function ordinal(n: number): string {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${suffix}`;
}
