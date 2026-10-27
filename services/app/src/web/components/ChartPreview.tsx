import type { ReactNode } from "react";

import type { ChartChoice, ChartPlan } from "../../shared/chart.js";
import { formatMoney } from "../lib/decimal.js";
import { formatDay } from "../lib/format.js";

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const isBalanceSheet = (name: string | null) => !!name && /^(Assets|Liabilities):/.test(name);

/**
 * What a chart of accounts would do, before it's added: the accounts it adds (each as it will be
 * named, with what it starts with), then the rows that can't be added and why, what's already
 * here, and what's left out. `action` goes under the list (the Add button).
 *
 * With `choices`, a file's bank and card accounts the book doesn't have can each be added, be
 * the same as one it has, or be left out; with `hidden`, accounts the file marks hidden can be
 * added too.
 */
export function ChartPreview({
  plan,
  action,
  choices,
  hidden,
}: {
  plan: ChartPlan;
  action: ReactNode;
  choices?: {
    /** The book's open asset and liability accounts. */
    accounts: string[];
    value: Record<string, ChartChoice>;
    onChange: (value: Record<string, ChartChoice>) => void;
  };
  hidden?: { include: boolean; onChange: (include: boolean) => void };
}) {
  if (plan.error)
    return (
      <section className="stack" aria-label="What it adds">
        <p className="card error">{plan.error}</p>
      </section>
    );
  // The file's bank and card accounts new to the book, however they're chosen now.
  const choosable = choices?.accounts.length
    ? [
        ...plan.add.map((p) => ({ line: p.line, written: p.written, name: p.account.name })),
        ...plan.existing.filter((e) => e.as !== e.name),
        ...plan.left.filter((l) => l.why === "Left out"),
      ]
        .filter((r): r is { line: number; written: string; name: string } => isBalanceSheet(r.name))
        .sort((a, b) => a.line - b.line)
    : [];
  const choiceOf = (name: string) => {
    const c = choices?.value[name];
    return c === "leave" ? "leave" : c ? `same:${c.same_as}` : "add";
  };
  const choose = (name: string, picked: string) => {
    const next = { ...choices!.value };
    if (picked === "add") delete next[name];
    else next[name] = picked === "leave" ? "leave" : { same_as: picked.slice("same:".length) };
    choices!.onChange(next);
  };
  const hiddenRows = plan.left.filter((l) => l.why === "Hidden");
  const otherLeft = plan.left.filter((l) => l.why !== "Hidden" && l.why !== "Left out");

  return (
    <section className="stack" aria-label="What it adds">
      {choosable.length > 0 && (
        <section className="card" aria-label="Bank and card accounts">
          <h2 className="section-title">Bank and card accounts</h2>
          <p className="small muted">
            Is any of these one you have here already (linked to your bank, say)? Its history goes
            with that one instead.
          </p>
          <ul className="chart-plan">
            {choosable.map((r) => (
              <li key={r.line} className="chart-choice">
                <strong className="chart-plan-name">{r.name}</strong>
                <select
                  aria-label={`What ${r.name} is`}
                  value={choiceOf(r.name)}
                  onChange={(e) => choose(r.name, e.target.value)}
                >
                  <option value="add">Add it</option>
                  {choices!.accounts.map((a) => (
                    <option key={a} value={`same:${a}`}>
                      Same as {a}
                    </option>
                  ))}
                  <option value="leave">Leave it out</option>
                </select>
              </li>
            ))}
          </ul>
        </section>
      )}
      <div className="card">
        <h2 className="section-title">
          {plan.add.length ? `${plural(plan.add.length, "account")} to add` : "Nothing to add"}
        </h2>
        <ul className="chart-plan">
          {plan.add.map(({ line, written, account, balance }) => (
            <li key={line}>
              <strong className="chart-plan-name">{account.name}</strong>
              {written !== account.name && <span className="muted small"> from “{written}”</span>}
              <span className="small muted chart-plan-details">
                {[
                  account.kind === "node" && "holds the accounts under it",
                  account.display_name && `shown as ${account.display_name}`,
                  account.description,
                  account.opening_balance &&
                    balance !== null &&
                    `${formatMoney(balance, account.opening_balance.currency)} on ${formatDay(account.opening_balance.date)}`,
                  account.open && `opens ${formatDay(account.open)}`,
                  account.booking && `sales by ${account.booking}`,
                  account.revalue_every && `revalued every ${account.revalue_every} days`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </li>
          ))}
        </ul>
        {plan.ignored.length > 0 && (
          <p className="small muted">Columns not read: {plan.ignored.join(", ")}.</p>
        )}
        {action}
      </div>
      {plan.problems.length > 0 && (
        <section className="card" aria-label="Can't be added">
          <h2 className="section-title">
            {plural(plan.problems.length, "row")} can&apos;t be added
          </h2>
          <ul className="chart-plan">
            {plan.problems.map(({ line, written, problem }) => (
              <li key={line}>
                <span className="muted small">Line {line}</span>{" "}
                {written && <strong className="chart-plan-name">{written}</strong>}
                <span className="small error chart-plan-details">{problem}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {plan.existing.length > 0 && (
        <section className="card" aria-label="Already here">
          <h2 className="section-title">{plural(plan.existing.length, "account")} already here</h2>
          <p className="small muted">
            {plan.existing
              .map((e) => (e.as === e.name ? e.name : `${e.name} (as ${e.as})`))
              .join(", ")}
          </p>
        </section>
      )}
      {(hiddenRows.length > 0 || otherLeft.length > 0 || (hidden?.include ?? false)) && (
        <section className="card" aria-label="Left out">
          <h2 className="section-title">Left out</h2>
          {hiddenRows.length > 0 && (
            <p className="small muted">
              Hidden in the other system: {hiddenRows.map((l) => l.name).join(", ")}.
            </p>
          )}
          {hidden && (
            <label className="check">
              <input
                type="checkbox"
                checked={hidden.include}
                onChange={(e) => hidden.onChange(e.target.checked)}
              />
              Add hidden accounts too
            </label>
          )}
          {otherLeft.length > 0 && (
            <ul className="chart-plan">
              {otherLeft.map((l) => (
                <li key={l.line}>
                  <strong className="chart-plan-name">{l.written}</strong>
                  <span className="small muted chart-plan-details">{l.why}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </section>
  );
}
