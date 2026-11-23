import type { Breakdown } from "@luminous-money/ledger-graphs-api";
import { useState } from "react";
import { Link, useLocation } from "wouter";

import { hasTags } from "../../shared/tags.js";

import {
  BreakdownBarsChart,
  BreakdownChart,
  CashFlowChart,
  NetWorthChart,
} from "../components/Charts.js";
import { countingAs } from "../components/Outflow.js";
import { MoreBelow, usePaging } from "../components/Paged.js";
import { TagChips, tagList, TagInput } from "../components/Tags.js";
import { shortName } from "../lib/accounts.js";
import type { BreakdownOptions, ReportReading } from "../lib/appApi.js";
import { useChartTheme } from "../lib/chartTheme.js";
import type { JournalFilter } from "../lib/ledger.js";
import { formatMoney, negate } from "../lib/decimal.js";
import { formatAmount } from "../lib/format.js";
import { useParam, useParams, withBack } from "../lib/navigation.js";
import {
  explain,
  useAccounts,
  useBreakdownReport,
  useCashFlowReport,
  useJournal,
  useLargestReport,
  useNetWorthReport,
  useTags,
} from "../lib/queries.js";
import { Loading } from "../components/Loading.js";

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
 * unconfirmed transactions, and those kept out of budgets unless asked to leave them out
 * (`?budgeted=only`: a once-in-decades roof, say, as budgets leave it out).
 *
 * Filtered by tags (M17, `?tag=`, repeated): cash flow, the breakdown and the largest count only
 * the splits with every one (a receipt's tagged item, not the rest of it); the breakdown starts on All time and the largest covers all
 * time (a tag is usually a trip or a project, not this month's); net worth, which is balances,
 * is set aside.
 *
 * Spending is read as outflows (Loans step 2: what's paid into a loan or escrow that counts as
 * spending is spending, and what escrow pays for isn't counted again), or as the expense accounts
 * are booked (`?lens=expenses`), the traditional P&L view.
 *
 * Where the breakdown is (`?side=income`, `?of=` the account drilled into, `?period=` and
 * `?chart=bars`) is in the address, so coming back from one of its transactions finds it where
 * it was.
 */
export function Reports({ book }: { book: string }) {
  const [, navigate] = useLocation();
  const where: Where = {
    tags: useParams("tag").filter(Boolean),
    lens: useParam("lens") === "expenses" ? "expenses" : "outflows",
    budgeted: useParam("budgeted") === "only",
    side: useParam("side") === "income" ? "income" : "expenses",
    of: useParam("of") ?? undefined,
    period: periodOf(useParam("period")),
    chart: useParam("chart") === "bars" ? "bars" : "pie",
  };
  const { tags, lens, budgeted } = where;
  const reading = { tags, lens, budgeted };
  const bookTags = useTags(book);
  const base = `/books/${book}/reports`;
  const query = (change: Partial<Where> = {}) => {
    const at = { ...where, ...change };
    return [
      ...at.tags.map((tag) => `tag=${encodeURIComponent(tag)}`),
      ...(at.lens === "expenses" ? ["lens=expenses"] : []),
      ...(at.budgeted ? ["budgeted=only"] : []),
      ...(at.side === "income" ? ["side=income"] : []),
      ...(at.of ? [`of=${encodeURIComponent(at.of)}`] : []),
      ...(at.period ? [`period=${at.period}`] : []),
      ...(at.chart === "bars" ? ["chart=bars"] : []),
    ].join("&");
  };
  const go = (change: Partial<Where>) => {
    const q = query(change);
    navigate(q ? `${base}?${q}` : base, { replace: true });
  };
  const here = query() ? `${base}?${query()}` : base;
  return (
    <main>
      <header className="page-head">
        <h1>Reports</h1>
        <p className="muted">Unconfirmed transactions count.</p>
      </header>
      <div className="stack">
        <section className="card report-lens" aria-label="Spending as">
          <div className="segmented" role="radiogroup" aria-label="Spending as">
            {(
              [
                ["outflows", "Outflows"],
                ["expenses", "Expenses"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={lens === value}
                className={lens === value ? "on" : ""}
                onClick={() => go({ lens: value })}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="small muted">
            {lens === "outflows"
              ? "Spending as it leaves your hands: a loan's whole payment and escrow count each month (for accounts that count as spending), and what escrow pays isn't counted again."
              : "Spending as the books have it: only expense accounts, so a loan's principal and escrow aren't spending, and the tax bill is, when it's paid."}
          </p>
          <label className="check small">
            <input
              type="checkbox"
              checked={budgeted}
              onChange={(e) => go({ budgeted: e.target.checked })}
            />
            Leave out what's excluded from budgets
          </label>
        </section>
        <section className="card report-filter" aria-label="Filter by tag">
          <TagInput
            label="Filter by tag"
            value={tags}
            choices={bookTags.data ?? []}
            allowNew={false}
            placeholder={bookTags.data?.length ? "Filter by tag" : "No tags yet"}
            onChange={(chosen) => go({ tags: chosen, of: undefined, period: undefined })}
          />
          {tags.length > 0 && (
            <p className="small muted">
              Only splits tagged {tagList(tags)}.{" "}
              <Link
                href={withBack(
                  `/books/${book}/transactions?${query({ lens: "outflows", budgeted: false, side: "expenses", of: undefined, period: undefined, chart: "pie" })}`,
                  here
                )}
              >
                See them
              </Link>
            </p>
          )}
        </section>
        <CashFlowCard book={book} reading={reading} />
        <BreakdownCard
          book={book}
          reading={reading}
          view={where}
          onView={(at) => go(at)}
          here={here}
        />
        <LargestCard book={book} reading={reading} here={here} />
        {tags.length ? (
          <p className="card small muted">Net worth isn't filtered by tag: it's balances.</p>
        ) : (
          <NetWorthCard book={book} />
        )}
      </div>
    </main>
  );
}

/** Where Reports are: how they read the books, and where the breakdown is. */
type Where = Required<Pick<ReportReading, "tags" | "lens" | "budgeted">> & BreakdownView;

function Pending({ error, height }: { error: unknown; height: number }) {
  return error ? (
    <p className="error">{explain(error)}</p>
  ) : (
    <div className="chart-placeholder" style={{ height }} aria-busy="true" />
  );
}

function CashFlowCard({ book, reading }: { book: string; reading: ReportReading }) {
  const report = useCashFlowReport(book, reading);
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

/** How long the breakdown covers: this month, the last 3 to 12 complete months (the donut
 * their monthly average, the bars each month), or all time (offered with tags). */
type Period = "month" | 3 | 6 | 9 | 12 | "total";
const PERIODS = [3, 6, 9, 12] as const;

const periodOf = (param: string | null): Period | undefined =>
  param === "month" || param === "total" ? param : PERIODS.find((n) => String(n) === param);

/** Where the breakdown is: expenses or income, the account drilled into, if any, how long it
 * covers (by default, all time with tags, else 6 months), and as a donut or a bar a month. */
type BreakdownView = {
  side: BreakdownOptions["side"];
  of?: string | undefined;
  period?: Period | undefined;
  chart: "pie" | "bars";
};

/** What a period covers, as the chart's caption and the empty card say it. */
function covers(period: Period, chart: BreakdownView["chart"]) {
  if (period === "month") return { caption: "this month", nothing: "this month" };
  if (period === "total") return { caption: "in all", nothing: "with these tags" };
  return {
    caption: chart === "pie" ? "a month, on average" : `over the last ${period} months`,
    nothing: `in the last ${period} months`,
  };
}

/** A breakdown's slices and Other as each month's summed, not averaged: what the bars add up
 * to. */
function summed(data: Breakdown): Breakdown {
  const sum = (amount: (m: Breakdown["byMonth"][number]) => number) =>
    data.byMonth.reduce((n, m) => n + amount(m), 0);
  return {
    ...data,
    total: sum((m) => m.total),
    slices: data.slices.map((s, i) => ({ ...s, amount: sum((m) => m.amounts[i] ?? 0) })),
    other: data.other && { ...data.other, amount: sum((m) => m.other) },
  };
}

function BreakdownCard({
  book,
  reading,
  view,
  onView,
  here,
}: {
  book: string;
  reading: ReportReading;
  view: BreakdownView;
  onView: (view: BreakdownView) => void;
  here: string;
}) {
  const { side, of, chart } = view;
  const tags = reading.tags ?? [];
  const [depth, setDepth] = useState(1);
  const period: Period =
    view.period === "total" && !tags.length ? 6 : (view.period ?? (tags.length ? "total" : 6));
  const window = typeof period === "number" ? "average" : period;
  // Drilled into: each level's account under the root, outermost first.
  const parts = of?.split(":") ?? [];
  const path = parts.slice(1).map((_, i) => parts.slice(0, i + 2).join(":"));
  const setPath = (to: string[]) => onView({ ...view, of: to.at(-1) });
  const report = useBreakdownReport(book, {
    side,
    depth,
    window,
    ...(typeof period === "number" ? { months: period } : {}),
    of,
    ...reading,
  });
  const theme = useChartTheme();
  const d = report.data;
  const drill = (account: string) => onView({ ...view, of: account });
  const { caption, nothing } = covers(period, chart);
  // The bars, and the list under them, are each month's amounts as they were.
  const listed = d && chart === "bars" ? summed(d) : d;

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
            onClick={() => onView({ ...view, side: s, of: undefined })}
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
            value={period}
            onChange={(e) => onView({ ...view, period: periodOf(e.target.value) })}
          >
            {tags.length > 0 && <option value="total">All time</option>}
            <option value="month">This month</option>
            {PERIODS.map((n) => (
              <option key={n} value={n}>
                {n} months
              </option>
            ))}
          </select>
        </label>
        <div className="segmented chart-kind" role="radiogroup" aria-label="Chart">
          {(
            [
              ["pie", "Pie"],
              ["bars", "Bars"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={chart === value}
              className={chart === value ? "on" : ""}
              onClick={() => onView({ ...view, chart: value })}
            >
              {label}
            </button>
          ))}
        </div>
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
      {!d || !listed ? (
        <Pending error={report.error} height={420} />
      ) : d.slices.length === 0 ? (
        <p className="muted">Nothing {nothing}.</p>
      ) : chart === "bars" ? (
        <>
          <p className="small muted">
            <strong className="num">{formatAmount(listed.total, d.currency)}</strong> {caption}
            {period === "month" ? " so far" : ""}
          </p>
          <BreakdownBarsChart data={d} theme={theme} onSelect={drill} />
          <BreakdownList data={listed} onSelect={drill} />
        </>
      ) : (
        <>
          <BreakdownChart data={d} caption={caption} theme={theme} onSelect={drill} />
          <BreakdownList data={listed} onSelect={drill} />
        </>
      )}
      {d && (
        <BreakdownTransactions book={book} side={side} of={d.of} reading={reading} here={here} />
      )}
    </section>
  );
}

/**
 * Every split under what's broken down (the root, or the account drilled into), in a small
 * window at the bottom of the card: the book's journal as Transactions lists it (newest first,
 * older pages as it scrolls), each transaction's splits under that account, as the report reads
 * them: with only the tags chosen, and without what's kept out of budgets if it's left out. A
 * split, not the transaction: a receipt's groceries, not the whole receipt (Kael, 2026-11-23).
 * Read as outflows, the journal is lensed as the report is: what's paid into an account that
 * counts as spending here is a split here (Rent and mortgage shows the mortgage's payments), and
 * what escrow pays for isn't one again. Income reads as earned, positive.
 */
function BreakdownTransactions({
  book,
  side,
  of,
  reading,
  here,
}: {
  book: string;
  side: BreakdownOptions["side"];
  of: string;
  reading: ReportReading;
  here: string;
}) {
  const accounts = useAccounts(book);
  if (!accounts.data) return null;
  const outflows = reading.lens !== "expenses";
  const counted = outflows ? countingAs(accounts.data, of).map((a) => a.name) : [];
  return (
    <BreakdownJournal
      book={book}
      side={side}
      of={of}
      filter={{
        accounts: [of, ...counted],
        tags: reading.tags ?? [],
        ...(reading.budgeted ? { budgeted: true } : {}),
        ...(outflows ? { lens: "outflows" as const } : {}),
      }}
      here={here}
    />
  );
}

function BreakdownJournal({
  book,
  side,
  of,
  filter,
  here,
}: {
  book: string;
  side: BreakdownOptions["side"];
  of: string;
  filter: JournalFilter;
  here: string;
}) {
  const [, navigate] = useLocation();
  const pages = useJournal(book, undefined, filter);
  const { rows, list, end } = usePaging(pages);
  const name = of.split(":").at(-1)!;
  const splits = rows.flatMap((row) =>
    row.postings
      .filter(
        (p) =>
          (p.account === of || p.account.startsWith(`${of}:`)) && hasTags(p.tags, filter.tags ?? [])
      )
      .map((p, i) => ({ row, split: p, key: `${row.id}:${i}` }))
  );
  return (
    <section className="breakdown-transactions" aria-label={`Transactions under ${name}`}>
      <h3 className="small muted">Transactions under {name}</h3>
      <div className="breakdown-scroll">
        {pages.error ? (
          <p className="error small">{explain(pages.error)}</p>
        ) : !pages.data ? (
          <Loading />
        ) : splits.length === 0 && !pages.hasNextPage ? (
          <p className="muted small">None.</p>
        ) : (
          <ol className="ledger journal" aria-label={`Transactions under ${name}`} ref={list}>
            {splits.map(({ row, split, key }) => (
              <li key={key} data-row={row.id}>
                <button
                  type="button"
                  className={`ledger-row${row.flag === "!" || split.flag === "!" ? " unconfirmed" : ""}`}
                  onClick={() => navigate(withBack(`/books/${book}/transactions/${row.id}`, here))}
                >
                  <span className="ledger-date">{row.date}</span>
                  <span className="ledger-what">
                    <span className="ledger-payee">
                      {row.payee ?? row.narration ?? "(no description)"}
                      <TagChips tags={split.tags ?? []} />
                    </span>
                    <span className="ledger-account muted">
                      {split.account === of ? name : split.account.slice(of.length + 1)}
                      {split.memo && ` · ${split.memo}`}
                      {split.outflow_of && ` · paid into ${shortName(split.outflow_of)}`}
                      {row.flag === "!" && " · unconfirmed"}
                    </span>
                  </span>
                  <span className="ledger-numbers">
                    <span className="amount">
                      {split.amount
                        ? formatMoney(
                            side === "income" ? negate(split.amount.number) : split.amount.number,
                            split.amount.currency
                          )
                        : "?"}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ol>
        )}
        <MoreBelow pages={pages} end={end} />
      </div>
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
          {/* A leaf opens too (Kael, 2026-11-14): its own transactions, below. Not the one
              that's what's open now ("Groceries (itself)"). */}
          {s.account !== data.of ? (
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

function LargestCard({
  book,
  reading,
  here,
}: {
  book: string;
  reading: ReportReading;
  here: string;
}) {
  const tags = reading.tags ?? [];
  const report = useLargestReport(book, reading);
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
