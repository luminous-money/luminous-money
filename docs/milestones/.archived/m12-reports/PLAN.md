M12: Reports: plan
==================================================================================================

> **Status: built (2026-10-17),** with library, unit, API and browser tests, from [the
> answers](#answers-2026-10-17). The brief: reports, from basic to more complex. Mostly graphs,
> and *really nice* ones; statements (profit and loss, balance sheets) later. Added along the
> way: home's recent transactions (the journal's first page) and a Transactions page (every
> account's, paged as a ledger is). Not done: moving the libraries to their public monorepo,
> which waits for a yes.

## What exists elsewhere (2026-10-17)

No popular, generic "pick a report, feed it your ledger" library exists to adopt or send PRs to:

- **Engines with standard statements:** hledger (multi-period balance sheet, income statement,
  cash flow; JSON out), Beancount's BQL (our ledger has it).
- **Apps whose charts live inside them:** Fava, Paisa (Go and Svelte, AGPL), Actual Budget,
  Firefly III.
- **Closest in spirit:** fava-dashboards (MIT): BQL queries plus Apache ECharts options, but only
  inside Fava.

So we build the two libraries the planning notes describe, with the boundary a small data
contract rather than a ledger plugin.

## Answers (2026-10-17)

1. **The libraries start as packages in this repo** and move to a public `luminous-money`
   monorepo (and npm) at the end of M12, once the contract has settled. Publishing is confirmed
   first.
2. **Apache ECharts,** as long as it does everything needed (it does: see
   [ECharts](#echarts)).
3. **The projection** draws each day of the month from that same day in the last 12 months,
   2,000 times, and plots the 85th percentile of the running total. No median line.
4. **"Spent this month"'s line leaves out what's excluded from budgets,** as budgets do; the
   projection includes it.
5. **Breakdowns average** the last 6 complete months, per month (this month left out); depth 1
   and 6 slices by default, the rest as "Other".
6. **Account statistics** use the last 12 months for weeks and months, up to 5 years for years;
   expense and income accounts.
7. **Statements** (income statement, balance sheet): not yet.
8. **Net worth over time:** yes.
9. **Placement:** "Spent this month" tops home, replacing the budget bar (its budget line is the
   same figure); the rest on a Reports page; account statistics on account pages.
10. **Tapping a bar or slice opens its transactions:** polish, at the end of the project.

## What M12 is

- **Home's "Spent this month":** this month's spending by day, a running total (a strong line
  with a faded fill), against the month's budget (a line) and what a month usually comes to by
  each day (a dotted line: the 85th percentile of 2,000 simulated months).
- **A Reports page:**
  - **Cash flow,** the last 6 months: income up, expenses down, net as a point; totals (income,
    expenses, net, average net a month).
  - **Breakdown,** expenses or income: a donut of the largest categories at a depth, each a
    monthly average over 6 months (or this month), the rest as Other, with the list under it;
    tapping one drills into it.
  - **Largest transactions** this month.
  - **Net worth,** the last 24 months: assets, liabilities and net worth by month end, holdings
    at their prices then.
- **An account's statistics** (an expense or income account's page): what a week, a month and a
  year typically come to (the median), and what 85% of them stay under (simulated).

## Decisions this plan makes

### Two libraries

- **`@luminous-money/ledger-graphs-api`** (`packages/ledger-graphs-api`): plain TypeScript, no
  dependencies. Its input is the **posting stream**: `{ transaction, date, flag, budgeted,
  payee, narration, account, amount, currency }`, plus, where a report needs them, current
  balances and prices. Its output is a dataset per report: plain JSON, numbers in the currency's
  units (rounded to cents), documented.
  - Account roots are parameters (Beancount's names by default), so any ledger fits.
  - Sums run in integer cents; percentiles and averages round at the end.
  - Simulations take a seed, so they're testable and stable between refreshes.
- **`@luminous-money/ledger-graphs-ui`** (`packages/ledger-graphs-ui`): React components, one per
  dataset, drawn with ECharts (a peer dependency). Colors come from a theme the host passes (ours
  follows the app's light and dark palettes). Each chart is a `<figure>` with a caption and an
  ECharts `aria` description, so it can be read without seeing it.

### Where reports are computed

- **In `app`,** which reads the posting stream from the ledger (`transactions/compact`, which
  gains `budgeted`), runs the data library, and returns datasets (`/books/:book/reports/*`).
  The page passes "today", as budgets do.
- Each report reads only the window it needs: 13 months for "Spent this month", breakdowns and
  account statistics; 5 years for yearly statistics; 24 months for net worth, backed out from
  current balances (the tree's totals) and valued with each commodity's price history.

### "Spent this month"

- **What's spending:** expenses under the highest-level expense budgets (home's budget figure),
  or every expense when there are none. Unconfirmed transactions count.
- **The line:** each day's running total, to today; what's excluded from budgets is left out.
- **The budget:** the highest-level expense budgets restated per month (the ledger's budget
  summary), as a horizontal line; none without budgets.
- **The projection:** for each day of the month, a day drawn from the same day of one of the
  last 12 complete months (a short month has none of its 31st), its total included as is
  (exclusions too); the running totals of 2,000 such months, and their 85th percentile each day.
  Rent on the 1st and paydays stay where they fall.
- **The headline:** spent so far, "of $10,500", and where the projection says the month ends.

### Breakdown

- **Expenses or income,** a depth (1 to 4 levels under the root) and a number of slices (6),
  the smallest grouped as "Other".
- **Each category's figure:** its monthly average over the last 6 complete months (by default),
  or this month so far.
- **Drilling in:** tapping a category (a slice or its row) shows the accounts under it, a level
  deeper; a breadcrumb goes back.

### Account statistics

- **For an expense or income account** (its subtree), three rows: a week, a month, a year.
  - **Typical:** the median of its last 52 complete weeks, 12 complete months, or up to 5
    complete years (the trailing 12 months while there's less than a year).
  - **85% stay under:** simulated, as the projection is: weeks from the same weekday of the last
    52, months from the same day of the last 12, years from the same month of up to 5.

### Net worth

- **By month end, for 24 months:** assets, liabilities (as owed) and net worth, holdings valued
  at the latest price on or before each month end; what has no price isn't counted, and is named.

### ECharts

- **It does what these need:** gradient area fills, dotted and dashed lines, a mark line (the
  budget), stacked and negative bars (cash flow), donuts with rounded, padded slices and a center
  label, touch tooltips, animated changes between datasets (drilling in), SVG rendering (crisp
  on phones), themes, and `aria` descriptions.
- **Only what's used is bundled** (`echarts/core` with the line, bar and pie charts), and the
  charts load lazily, so the first screen isn't waiting on them.

## How it gets built

1. **Ledger:** `budgeted` in `transactions/compact`.
2. **`ledger-graphs-api`:** the stream's types, period helpers, statistics (median, percentile,
   a seeded generator), and the reports: spending this month, cash flow, breakdown, largest,
   net worth, account statistics. Unit tests for each.
3. **`ledger-graphs-ui`:** an ECharts wrapper (resizing, theme, SVG), and the charts: spending
   this month, cash flow, breakdown donut, net worth.
4. **`app`:** `/reports/*` routes reading the ledger and running the library; tests with the
   fake ledger.
5. **PWA:** home's chart (replacing the budget bar), the Reports page (menu), an account's
   statistics card.
6. **Tests:** API e2e for each report; browser tests for home's chart, the Reports page
   (drilling into a breakdown), and an account's statistics.
7. **Docs:** design.md ("Reports"), PLAN.md, RESUME.md.

## Out of scope

- Statements: income statement and balance sheet (answer 7).
- Tapping a bar or slice to open its transactions (answer 10: polish, at the end).
- Filtering by tag (tags are M18).
- Moving the libraries to their public monorepo and publishing them: at the end of M12, once
  confirmed.
