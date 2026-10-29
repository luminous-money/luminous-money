import type { Breakdown } from "@luminous-money/ledger-graphs-api";
import { useState } from "react";
import { Link, useLocation } from "wouter";

import { BreakdownChart, CashFlowChart, NetWorthChart } from "../components/Charts.js";
import { tagList, TagInput } from "../components/Tags.js";
import { shortName } from "../lib/accounts.js";
import type { BreakdownOptions } from "../lib/appApi.js";
import { useChartTheme } from "../lib/chartTheme.js";
import { formatAmount } from "../lib/format.js";
import { useParams, withBack } from "../lib/navigation.js";
import {
  explain,
  useBreakdownReport,
  useCashFlowReport,
  useLargestReport,
  useNetWorthReport,
  useTags,
} from "../lib/queries.js";

// The same order as the charts' palette (lib/chartTheme.ts), so a row's dot matches its slice.
const PALETTE = [
  "#3c9a4a",
  "#2f6fd6",
  "#d9a441",
  "#8e5bc9",
  "#d0603f",
  "#2aa3a3",
  "#c94f8a",
  "#7a8c3b",
];

/**
 * Reports: cash flow over 6 months, where the money goes (or comes from) as a donut you can
 * drill into, this month's largest expenses, and net worth over 24 months. Each counts
 * unconfirmed transactions and those kept out of budgets.
 *
 * Filtered by tags (M17, `?tag=`, repeated): cash flow, the breakdown and the largest count only
 * the transactions with every one; the breakdown starts on All time and the largest covers all
 * time (a tag is usually a trip or a project, not this month's); net worth, which is balances,
 * is set aside.
 */
export function Reports({ book }: { book: string }) {
  const [, navigate] = useLocation();
  const tags = useParams("tag").filter(Boolean);
  const bookTags = useTags(book);
  const base = `/books/${book}/reports`;
  const query = (chosen: string[]) =>
    chosen.map((tag) => `tag=${encodeURIComponent(tag)}`).join("&");
  return (
    <main>
      <header className="page-head">
        <h1>Reports</h1>
        <p className="muted">Unconfirmed transactions count.</p>
      </header>
      <div className="stack">
        <section className="card report-filter" aria-label="Filter by tag">
          <TagInput
            label="Filter by tag"
            value={tags}
            choices={bookTags.data ?? []}
            allowNew={false}
            placeholder={bookTags.data?.length ? "Filter by tag" : "No tags yet"}
            onChange={(chosen) =>
              navigate(chosen.length ? `${base}?${query(chosen)}` : base, { replace: true })
            }
          />
          {tags.length > 0 && (
            <p className="small muted">
              Only transactions tagged {tagList(tags)}.{" "}
              <Link
                href={withBack(
                  `/books/${book}/transactions?${query(tags)}`,
                  `${base}?${query(tags)}`
                )}
              >
                See them
              </Link>
            </p>
          )}
        </section>
        <CashFlowCard book={book} tags={tags} />
        <BreakdownCard key={tags.join(" ")} book={book} tags={tags} />
        <LargestCard book={book} tags={tags} />
        {tags.length ? (
          <p className="card small muted">Net worth isn't filtered by tag: it's balances.</p>
        ) : (
          <NetWorthCard book={book} />
        )}
      </div>
    </main>
  );
}

function Pending({ error, height }: { error: unknown; height: number }) {
  return error ? (
    <p className="error">{explain(error)}</p>
  ) : (
    <div className="chart-placeholder" style={{ height }} aria-busy="true" />
  );
}

function CashFlowCard({ book, tags }: { book: string; tags: string[] }) {
  const report = useCashFlowReport(book, tags);
  const theme = useChartTheme();
  const d = report.data;
  const money = (n: number) => formatAmount(n, d!.currency);
  return (
    <section className="card report" aria-label="Cash flow">
      <h2 className="section-title">Cash flow</h2>
      {!d ? (
        <Pending error={report.error} height={300} />
      ) : (
        <>
          <p className="small muted">The last {d.months.length} months, this one so far</p>
          <CashFlowChart data={d} theme={theme} />
          <dl className="report-totals">
            <div>
              <dt>Income</dt>
              <dd className="num">{money(d.totals.income)}</dd>
            </div>
            <div>
              <dt>Expenses</dt>
              <dd className="num">{money(d.totals.expenses)}</dd>
            </div>
            <div>
              <dt>Net cash flow</dt>
              <dd className="num">{money(d.totals.net)}</dd>
            </div>
            <div>
              <dt>Average a month</dt>
              <dd className="num">{money(d.totals.average_net)}</dd>
            </div>
          </dl>
        </>
      )}
    </section>
  );
}

// What each window covers, as the chart's caption and the empty card say it.
const WINDOWS = {
  average: { caption: "a month, on average", nothing: "in the last 6 months" },
  month: { caption: "this month", nothing: "this month" },
  total: { caption: "in all", nothing: "with these tags" },
} as const;

function BreakdownCard({ book, tags }: { book: string; tags: string[] }) {
  const [side, setSide] = useState<BreakdownOptions["side"]>("expenses");
  const [depth, setDepth] = useState(1);
  const [window, setWindow] = useState<BreakdownOptions["window"]>(
    tags.length ? "total" : "average"
  );
  // Drilled into: each level's account, outermost first.
  const [path, setPath] = useState<string[]>([]);
  const report = useBreakdownReport(book, { side, depth, window, of: path.at(-1), tags });
  const theme = useChartTheme();
  const d = report.data;
  const drill = (account: string) => setPath((p) => [...p, account]);
  const { caption } = WINDOWS[window];

  return (
    <section className="card report" aria-label="Breakdown">
      <h2 className="section-title">Breakdown</h2>
      <div className="segmented" role="radiogroup" aria-label="Breakdown of">
        {(["expenses", "income"] as const).map((s) => (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={side === s}
            className={side === s ? "on" : ""}
            onClick={() => (setSide(s), setPath([]))}
          >
            {s === "expenses" ? "Expenses" : "Income"}
          </button>
        ))}
      </div>
      <div className="report-controls">
        <label className="small">
          Show
          <select
            aria-label="Show"
            value={window}
            onChange={(e) => setWindow(e.target.value as BreakdownOptions["window"])}
          >
            {tags.length > 0 && <option value="total">All time</option>}
            <option value="average">The 6-month average</option>
            <option value="month">This month</option>
          </select>
        </label>
        {path.length === 0 && (
          <label className="small">
            Level
            <select
              aria-label="Level"
              value={depth}
              onChange={(e) => setDepth(Number(e.target.value))}
            >
              {[1, 2, 3, 4].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {path.length > 0 && (
        <nav className="small breadcrumb" aria-label="Drilled into">
          <button type="button" className="plain" onClick={() => setPath([])}>
            {side === "expenses" ? "Expenses" : "Income"}
          </button>
          {path.map((account, i) => (
            <span key={account}>
              {" › "}
              {i === path.length - 1 ? (
                <span>{account.split(":").at(-1)}</span>
              ) : (
                <button
                  type="button"
                  className="plain"
                  onClick={() => setPath(path.slice(0, i + 1))}
                >
                  {account.split(":").at(-1)}
                </button>
              )}
            </span>
          ))}
        </nav>
      )}
      {!d ? (
        <Pending error={report.error} height={420} />
      ) : d.slices.length === 0 ? (
        <p className="muted">Nothing {WINDOWS[window].nothing}.</p>
      ) : (
        <>
          <BreakdownChart data={d} caption={caption} theme={theme} onSelect={drill} />
          <BreakdownList data={d} onSelect={drill} />
        </>
      )}
    </section>
  );
}

function BreakdownList({
  data,
  onSelect,
}: {
  data: Breakdown;
  onSelect: (account: string) => void;
}) {
  const money = (n: number) => formatAmount(n, data.currency);
  const row = (label: string, amount: number, share: number, color: string) => (
    <>
      <span className="dot" style={{ background: color }} aria-hidden />
      <span className="breakdown-label">{label}</span>
      <span className="muted small">{Math.round(share * 100)}%</span>
      <span className="num">{money(amount)}</span>
    </>
  );
  return (
    <ul className="breakdown-list" aria-label="Categories">
      {data.slices.map((s, i) => (
        <li key={s.account}>
          {s.more ? (
            <button type="button" className="breakdown-row" onClick={() => onSelect(s.account)}>
              {row(s.label, s.amount, s.share, PALETTE[i % PALETTE.length]!)}
              <span className="chart-open" aria-hidden>
                ›
              </span>
            </button>
          ) : (
            <div className="breakdown-row">
              {row(s.label, s.amount, s.share, PALETTE[i % PALETTE.length]!)}
              <span className="chart-open" aria-hidden />
            </div>
          )}
        </li>
      ))}
      {data.other && (
        <li>
          <div className="breakdown-row" title={data.other.accounts.map(shortName).join(", ")}>
            {row(
              `Other (${data.other.accounts.length})`,
              data.other.amount,
              data.other.share,
              "var(--muted)"
            )}
            <span className="chart-open" aria-hidden />
          </div>
        </li>
      )}
    </ul>
  );
}

function LargestCard({ book, tags }: { book: string; tags: string[] }) {
  const report = useLargestReport(book, tags);
  const here = `/books/${book}/reports`;
  return (
    <section className="card report" aria-label="Largest transactions">
      <h2 className="section-title">
        {tags.length ? "Largest tagged transactions" : "Largest transactions this month"}
      </h2>
      {!report.data ? (
        <Pending error={report.error} height={240} />
      ) : report.data.transactions.length === 0 ? (
        <p className="muted">
          {tags.length ? "No spending with these tags." : "No spending yet this month."}
        </p>
      ) : (
        <ol className="largest-list">
          {report.data.transactions.map((t) => (
            <li key={t.transaction}>
              <Link
                href={withBack(`/books/${book}/transactions/${t.transaction}`, here)}
                className="largest-row"
              >
                <span>
                  <span className="largest-name">
                    {t.payee ?? t.narration ?? "(no description)"}
                  </span>
                  <span className="small muted">
                    {t.date} · {shortName(t.account)}
                  </span>
                </span>
                <span className="num">{formatAmount(t.amount, report.data!.currency, true)}</span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function NetWorthCard({ book }: { book: string }) {
  const report = useNetWorthReport(book);
  const theme = useChartTheme();
  const d = report.data;
  const last = d?.months.at(-1);
  const first = d?.months[0];
  return (
    <section className="card report" aria-label="Net worth">
      <h2 className="section-title">Net worth</h2>
      {!d || !last || !first ? (
        <Pending error={report.error} height={280} />
      ) : (
        <>
          <p className="spending-figure num">{formatAmount(last.net, d.currency)}</p>
          <p className="small muted">
            {last.net >= first.net ? "Up" : "Down"}{" "}
            {formatAmount(Math.abs(last.net - first.net), d.currency)} over {d.months.length} months
          </p>
          <NetWorthChart data={d} theme={theme} />
          {d.unpriced.length > 0 && (
            <p className="small muted">Not counted, with no price: {d.unpriced.join(", ")}.</p>
          )}
        </>
      )}
    </section>
  );
}
