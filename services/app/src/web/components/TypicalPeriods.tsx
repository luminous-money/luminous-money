import type { Account } from "@luminous-money/ledger-client";

import { formatAmount } from "../lib/format.js";
import { useTypicalReport } from "../lib/queries.js";

/**
 * What an expense or income account's week, month and year typically come to: the median of
 * its last 52 weeks, 12 months and up to 5 years, and what 85% of simulated ones stay under.
 */
export function TypicalPeriods({
  book,
  account,
}: {
  book: string;
  account: Pick<Account, "name" | "type">;
}) {
  const counted = account.type === "expense" || account.type === "income";
  const report = useTypicalReport(book, account.name, counted);
  const d = report.data;
  if (!counted || !d) return null;
  const money = (n: number) => formatAmount(n, d.currency);
  return (
    <section className="card typical" aria-label="Typically">
      <h2 className="section-title">Typically</h2>
      <table className="typical-table">
        <thead>
          <tr>
            <th />
            <th scope="col">Median</th>
            <th scope="col">85% stay under</th>
          </tr>
        </thead>
        <tbody>
          {(["week", "month", "year"] as const).map((period) => (
            <tr key={period}>
              <th scope="row">A {period}</th>
              <td className="num">{money(d[period].median)}</td>
              <td className="num">{money(d[period].high)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="small muted">
        From the last 52 weeks, 12 months and{" "}
        {d.year.periods > 1 ? `${d.year.periods} years` : "year"}.
      </p>
    </section>
  );
}
