import { Link } from "wouter";

import { useChartTheme } from "../lib/chartTheme.js";
import { formatAmount } from "../lib/format.js";
import { explain, useSpendingReport } from "../lib/queries.js";
import { SpendingChart } from "./Charts.js";

/**
 * Home's chart: what's been spent this month, day by day, against the budget, and what 85% of
 * months stay under by each day (simulated from the last 12). Spending is what the highest-level
 * expense budgets cover (all expenses without budgets), as budgets count it.
 */
export function SpendingThisMonth({ book }: { book: string }) {
  const report = useSpendingReport(book);
  const theme = useChartTheme();
  const d = report.data;
  if (report.error) return <p className="card error">{explain(report.error)}</p>;
  if (!d)
    return <div className="card chart-placeholder" style={{ height: 300 }} aria-busy="true" />;
  const money = (n: number) => formatAmount(n, d.currency);
  const month = new Date(`${d.month}-01T00:00:00Z`).toLocaleDateString(undefined, {
    month: "long",
    timeZone: "UTC",
  });
  return (
    <section className="card spending-card" aria-label="Spent this month">
      <div className="spending-head">
        <div>
          <h2 className="section-title">Spent this month</h2>
          <p className="spending-figure num">{money(d.spent)}</p>
          <p className="small muted">
            {month}
            {d.budget !== null && ` · of ${money(d.budget)} budgeted`}
          </p>
        </div>
        <Link href={`/books/${book}/budgets`} className="small">
          Budgets ›
        </Link>
      </div>
      <SpendingChart data={d} theme={theme} height={180} />
      <p className="small muted chart-legend">
        <span className="legend-item">
          <span className="key solid" aria-hidden /> This month
        </span>
        {d.projected_end !== null && (
          <span className="legend-item">
            <span className="key dotted" aria-hidden /> 85% of months stay under:{" "}
            {money(d.projected_end)} by the end
          </span>
        )}
      </p>
    </section>
  );
}
