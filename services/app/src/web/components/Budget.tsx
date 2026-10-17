import { useState } from "react";

import {
  daysLeft,
  defaultStart,
  per,
  PERIODS,
  standing,
  thisPeriod,
  UNITS,
  type Period,
} from "../lib/budgets.js";
import { formatMoney, isDecimal, isNegative, isZero, negate } from "../lib/decimal.js";
import { today } from "../lib/format.js";
import type { BudgetLine } from "../lib/ledger.js";
import { explain, useBookSettings, useSetBudget } from "../lib/queries.js";

type Amount = { number: string; currency: string };
const money = (a: Amount) => formatMoney(a.number, a.currency);

/** The filled line: how much of a budget has gone (a limit) or come in (a goal). */
export function BudgetBar({
  kind,
  budget,
  spent,
  label,
}: {
  kind: BudgetLine["kind"];
  budget: Amount;
  spent: Amount;
  label: string;
}) {
  const { share, standing: state } = standing(kind, budget.number, spent.number);
  return (
    <span
      className={`budget-bar ${kind} ${state}`}
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={Math.max(Number(budget.number), 0)}
      aria-valuenow={Math.max(Number(spent.number), 0)}
      aria-valuetext={`${money(spent)} of ${money(budget)}`}
    >
      <span style={{ width: `${Math.min(share, 1) * 100}%` }} />
    </span>
  );
}

/** What's left in words: "$88 left · 17 days left", "Over by $12", "$1,000 to go", "Reached";
 * with the unconfirmed part, if any. */
export function leftWords(
  kind: BudgetLine["kind"],
  left: Amount,
  options: { days?: number; unconfirmed?: Amount } = {}
): string {
  const parts = [
    kind === "goal"
      ? isNegative(left.number) || isZero(left.number)
        ? "Reached"
        : `${money(left)} to go`
      : isNegative(left.number)
        ? `Over by ${money({ ...left, number: negate(left.number) })}`
        : `${money(left)} left`,
  ];
  if (options.days !== undefined)
    parts.push(`${options.days} day${options.days === 1 ? "" : "s"} left`);
  if (options.unconfirmed && !isZero(options.unconfirmed.number))
    parts.push(`incl. ${money(options.unconfirmed)} unconfirmed`);
  return parts.join(" · ");
}

/** One budget at a glance: "$312 of $400 this month", the bar, and what's left. */
export function BudgetGlance({ line, name }: { line: BudgetLine; name: string }) {
  return (
    <div className="budget-glance">
      <p className="small">
        <span className="num">
          {money(line.spent)} of {money(line.budget)}
        </span>{" "}
        {thisPeriod(line.version)}
      </p>
      <BudgetBar
        kind={line.kind}
        budget={line.budget}
        spent={line.spent}
        label={`${name}'s budget`}
      />
      <p className="small muted">
        {leftWords(line.kind, line.left, {
          days: daysLeft(line, today()),
          unconfirmed: line.unconfirmed,
        })}
      </p>
    </div>
  );
}

/**
 * Set an account's budget: an amount per period, applying from a day (by default, the start of
 * the period today is in: of the budget's own periods if it keeps them, else of the calendar's,
 * with weeks starting on the book's day). Saving in the same period replaces that change.
 * Remove ends it from this period; earlier periods keep theirs. `line` is the budget in force,
 * measured over its own period.
 */
export function BudgetForm({
  book,
  account,
  line,
  onDone,
}: {
  book: string;
  account: string;
  line?: BudgetLine;
  onDone?: () => void;
}) {
  const settings = useBookSettings(book);
  const set = useSetBudget(book, account);
  const version = line?.version;
  const [amount, setAmount] = useState(version?.amount.number ?? "");
  const [period, setPeriod] = useState<Period>(
    version ? { every: version.every, unit: version.unit } : { every: 1, unit: "month" }
  );
  const named = PERIODS.findIndex((p) => p.every === period.every && p.unit === period.unit);
  const [custom, setCustom] = useState(named < 0);
  const [start, setStart] = useState<string | null>(null); // null: the suggestion
  const keeps = version && version.every === period.every && version.unit === period.unit;
  const suggested =
    keeps && line
      ? line.period_start
      : defaultStart(period, today(), settings.data?.week_start ?? 1);
  const from = start ?? suggested;
  const valid =
    isDecimal(amount) &&
    !isNegative(amount) &&
    !isZero(amount) &&
    Number.isInteger(period.every) &&
    period.every >= 1;
  const write = (body: { start: string; amount: string } & Period) =>
    set
      .mutateAsync({
        ...body,
        updated_at: version?.start === body.start ? version.updated_at : null,
      })
      .then(() => onDone?.())
      .catch(() => undefined); // shown from set.error

  return (
    <form
      className="editor budget-form"
      aria-label={`Budget for ${account}`}
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) void write({ start: from, amount, ...period });
      }}
    >
      <label>
        Amount {per(period)}
        <input
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value.trim())}
          aria-label="Amount"
          placeholder="0.00"
        />
      </label>
      <label>
        Period
        <select
          aria-label="Period"
          value={custom ? "custom" : String(named)}
          onChange={(e) => {
            const chosen = PERIODS[Number(e.target.value)];
            setCustom(!chosen);
            if (chosen) setPeriod({ every: chosen.every, unit: chosen.unit });
            setStart(null);
          }}
        >
          {PERIODS.map((p, i) => (
            <option key={p.label} value={i}>
              {p.label}
            </option>
          ))}
          <option value="custom">Custom…</option>
        </select>
      </label>
      {custom && (
        <div className="budget-custom">
          <label>
            Every
            <input
              inputMode="numeric"
              value={String(period.every)}
              onChange={(e) => (
                setPeriod({ ...period, every: Number(e.target.value) }),
                setStart(null)
              )}
              aria-label="Every"
            />
          </label>
          <label>
            Unit
            <select
              aria-label="Unit"
              value={period.unit}
              onChange={(e) => (
                setPeriod({ ...period, unit: e.target.value as Period["unit"] }),
                setStart(null)
              )}
            >
              {UNITS.map((u) => (
                <option key={u} value={u}>
                  {u}s
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      <label>
        Applies from
        <input type="date" value={from} onChange={(e) => setStart(e.target.value || null)} />
        <span className="small muted">Its periods count from this day.</span>
      </label>
      {set.error && <p className="error">{explain(set.error)}</p>}
      <div className="actions">
        {version && line && (
          <button
            type="button"
            className="danger"
            disabled={set.isPending}
            onClick={() =>
              void write({
                start: line.period_start,
                amount: "0",
                every: version.every,
                unit: version.unit,
              })
            }
          >
            Remove
          </button>
        )}
        <button type="submit" className="primary" disabled={!valid || set.isPending}>
          {set.isPending ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}
