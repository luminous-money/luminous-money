M11: Budgets: plan
==================================================================================================

> **Status: built (2026-10-17),** with ledger, unit, API and browser tests, following [the
> answers](#answers-2026-10-17) and [the answers to the questions](#answers-to-the-questions-2026-10-17),
> which override anything below that disagrees. Differences from the plan:
> - **Status is computed in the ledger** (`GET /budgets/status`), not in `app`: exact Decimal
>   restating, one home for period math, and "today" passed by the caller. So there's no
>   `accounts/flows` endpoint yet (reports can add one) and no `DELETE /budgets` (ending a
>   budget with nothing before it removes it).
> - **"Other" is "Other".**
> - **Archiving rests an account's budgets** rather than writing an end to them, so unarchiving
>   brings them back.
> - **Added: "Exclude from budget"** on a transaction (`budget: FALSE`), in review and the
>   transaction's page.
>
> The brief, from the planning notes in [the plan](../../PLAN.md):
> - a target budget on **any account**, for **any period**
> - no account may have a higher **base** budget than an account above it
> - ~~each target can roll over from period to period, or not~~: dropped (answer 8)

## Answers (2026-10-17)

1. **A budget is how much you're allowed to spend** in a category: a target, not envelopes.
   **A node's budget can be split across the accounts under it, all of it or some of it; the
   rest is that node's "Other".** For example, Expenses at $10,500 a month and
   Expenses:Housing at $5,000 leave $5,500 in Expenses' Other. This works at every level.
2. **Every type can have one,** measuring the account's flow in the period as it reads: spent
   (expenses), earned (income), put in (an asset such as savings), paid down (a liability).
3. **One set of budgets per book.**
4. **The accounts under a node may add up to more than its budget,** with a warning.
5. **Budgets with different periods compare per year** for the rule: a weekly $150 under a
   monthly $600 is refused (about $7,800 a year against $7,200).
6. **Periods use the schedules' rule** (M3): every N days, weeks, months or years from a start.
7. **Each budget shows its own current period,** with a "per month" view that restates them all
   on one basis.
8. **No rollover,** for now.
9. *(Rollover's cap: moot.)*
10. **A change takes effect from a period on,** so earlier periods keep the budget they had.
11. **Budgets live in the ledger as `custom "budget"` directives.**
12. **Unconfirmed transactions count,** shown apart; refunds reduce spending; transfers inside
    a budgeted subtree cancel out. **`!` is called "unconfirmed" everywhere** (done
    2026-10-17, across the UI, code and docs; "pending" is only the bank's word now).
13. **The operating currency only;** anything else is a note.
14. **Where budgets show:**
    - a **Budgets page**, laid out like the chart of accounts
    - a **budget line on an account's ledger page,** with a filled line (a bar)
    - **set** from the account editor and from the Budgets page
    - past periods: **left for reports** (M12)
15. **Home: a filled line** of how you're doing against the sum of your highest-level budgets.
    A budget widget comes with reports (M12).
16. **No alerts.**

## What M11 is

- **Set a budget on any account:** an amount, a period, and when it starts.
- **See how each is going** this period: what's gone against it (unconfirmed shown apart), what's
  left, and the days left, as a filled line.
- **Split a node's budget** across the accounts under it, the rest shown as its Other.
- **The rule:** no account's budget is higher than an account's above it.

## What exists today

- **Custom directives:** the ledger stores `custom` directives like any other, writes them in
  exports, and M10's rename and merge rewrite their account values. Nothing reads a budget yet.
- **The tree endpoint** (M10) rolls balances up the tree, but **nothing sums an account's flow
  between two dates.**
- **The schedules' rule** (`src/shared/schedule.ts`): every N days, weeks, months or years from
  a start, shared by `app` and the PWA.
- **The chart of accounts page and the account editor** (M10): one card by type, full-width
  rows; the editor's cards and folded rows.

## Decisions this plan makes

### What a budget is

- **An amount per period on one account,** effective from a date. A node's budget covers its
  whole subtree.
- **Expenses' budgets are limits** (going over is bad). **Income, asset and liability budgets
  are goals** (reaching them is good). See [question 1](#questions).
- **What goes against it** is the account's flow over the period, its subtree included,
  unconfirmed included:
  - expenses: spent (positive postings), refunds taking it back
  - income: earned (shown inverted, as everywhere)
  - an asset: net put in
  - a liability: net paid down (a card's balance moving toward zero)

### Periods

- **The schedules' rule:** every N days, weeks, months or years, counted from the budget's
  start. One module (`src/shared/schedule.ts`) computes periods for budgets and occurrences for
  schedules; budgets need no weekend handling or listed days.
- **The choices offered:** weekly, every 2 weeks, monthly, quarterly, yearly, or every N of a
  unit.
- **Where periods start:** the start date you choose. By default, the start of the current
  calendar period: the 1st of the month, the first of the quarter, January 1, or this week's
  Monday ([question 5](#questions)). A pay cycle starting on the 15th starts on a 15th.
- **Per year, for comparing:** a day is 1/365.25 of a year, a week 7/365.25, a month 1/12. The
  rule and the per-month view use it.

### The rule, and Other

- **Base amounts, per year:** a budget can't be higher than the budget of any account above it.
  It's checked on every write, against every version in force from its start on, and refused
  (422) naming the account it would exceed.
- **Other:** a node with a budget, and budgets on accounts under it (the nearest ones down
  each branch), gets an **Other** row:
  - its budget: the node's, less theirs (restated in the node's period)
  - what's gone against it: the node's flow, less theirs, over the node's period
  - when theirs add up to more than the node's, Other is negative and marked
    "over-allocated" (answer 4)
- **Moving an account** (M10's rename) can break the rule; it's allowed, and the Budgets page
  flags the account ([question 4](#questions)).

### Over time

- **Each budget is a series of versions,** each effective from a period's start. Earlier
  periods keep the version they had (for reports, M12).
- **Saving a change** writes a version starting at the current period's start (or a date you
  choose). Saving again in the same period replaces that version.
- **Removing a budget** writes a version of 0 from the current period's start: it no longer
  shows, but earlier periods keep theirs.
- **Deleting or merging an account** (M10) drops its budget versions rather than moving them to
  the substitute ([question 3](#questions)). **Archiving** ends its budget on the archive date.

### Storage

- **`custom "budget"` directives,** Fava's format:

  ```beancount
  2026-10-01 custom "budget" Expenses:Food "monthly" 600.00 USD
  2026-10-01 custom "budget" Expenses:Fun "weekly" 50.00 USD
    every: 2
  ```

  - the date: the version's start, and where its periods count from
  - the period word: `daily`, `weekly`, `monthly`, `quarterly` (3 months) or `yearly`, with
    `every` metadata for more than 1 (Fava reads those as every 1)
  - the amount in the operating currency; 0 ends the budget
- **Versioned like every directive** (`updated_at`, 409 when stale). Exports and backups carry
  them.

### The ledger API

- **`GET /books/{b}/budgets`:** every version, by account and start.
- **`PUT /books/{b}/budgets/{account}`** `{start, amount, every, unit, updated_at?}`: writes the
  version starting `start` (a new one, or the one already there). Refused (422) if it breaks the
  rule.
- **`DELETE /books/{b}/budgets/{account}?start=&updated_at=`:** removes one version (undoing a
  change made this period).
- **`GET /books/{b}/accounts/flows?range=<account>,<from>,<to>&range=…`:** each account's
  subtree flow over each half-open date range, confirmed and unconfirmed apart, in the operating
  currency, and other currencies listed. Plain SQL over postings, as the tree is. Reports (M12)
  will use it too.

### `app`: one status for every screen

- **`GET /books/{b}/budgets/status?basis=period|month`** in `app`: the ledger's budgets, their
  current periods (from the shared module), and one `flows` call. For each budgeted account:
  - its budget in force, its period's dates and the days left
  - spent (confirmed and unconfirmed), left, over
  - limit or goal
  - its Other, if it has one
  - problems: higher than an account above it (after a move), over-allocated
- **With `basis=month`,** every amount is restated per month and measured over this calendar
  month.
- **And a summary for home:** the highest-level budgets (no budgeted account above them, expense
  only; see [question 2](#questions)), per month, against this month's spending under them.

### Screens

- **A filled line:** one bar component for every screen. Filled to the share used; a limit's
  bar turns amber past 90% and red when over (overflow marked), a goal's turns green when
  reached.
- **Budgets page** (Menu → Budgets, `/books/:book/budgets`):
  - one card, a section per type (Expenses first), like the chart of accounts
  - only budgeted accounts and the accounts above them, as a tree; Other as a row under
    its node
  - a budgeted row: its name, "$312 of $400", the bar, and "$88 left · 12 days"; unconfirmed
    as "incl. $40 unconfirmed"
  - **tapping a row** opens its budget in place (amount, period, start; Save, Remove); its ›
    opens the account
  - **"Each its own period / Per month"** at the top
  - **"+ Add a budget":** pick any account (nodes included), then the same fields
- **The account's ledger page:** under the balance, when it has a budget: "$312 of $400 this
  month · $88 left", and the bar.
- **The account editor:** a **Budget** card (amount, period, start; Save; Remove), top-level
  accounts included (their editor gets this card and nothing else).
- **Home:** one bar: "October: $6,210 of $10,500 budgeted", linking to Budgets. Nothing when
  there are no budgets.

## How it gets built

1. **Ledger:**
   - budget directives: parse, list, write and remove versions (versioned)
   - the rule, per year, on every write
   - `accounts/flows`: one SQL sum per range, rolled up through the subtree
   - deleting or merging an account drops its budgets; archiving ends them
   - tests
2. **Shared:** periods from the schedules' rule (the current period on a date), and per-year
   factors.
3. **`app`:** `budgets/status`, with Other, problems, the per-month basis and the home
   summary; the fake ledger gets budgets and flows; tests.
4. **PWA:**
   - the bar component
   - the Budgets page, its in-place editor and "+ Add a budget", and the menu item
   - the ledger page's budget line, the editor's Budget card, home's bar
5. **Tests:**
   - **ledger:** versions, the rule across periods, flows with refunds, transfers and
     unconfirmed
   - **app:** status, Other, per month, problems
   - **API e2e:** set budgets on a node and a child, see Other; a refused child; a merge
     drops budgets
   - **browser:** add a budget, see the bar move with a transaction, Other, per month,
     the ledger line, home's bar
6. **Docs:** design.md ("Budgets"), PLAN.md, RESUME.md.

## Out of scope

- Rollover (answer 8).
- Past periods and budget charts: reports (M12).
- Alerts.
- Filtering budgets by tag (tags are M18).
- More than one set of budgets per book.

## Answers to the questions (2026-10-17)

0. **"Unallocated" is called "Other"**, which is clearer.
1. **Limits and goals:** yes, since it's simple.
2. **Home's bar:** expense budgets only.
3. **Deleting or merging a budgeted account:** drop its budgets.
4. **A move that breaks the rule:** allow it, and flag it.
5. **Weekly budgets' default start:** a book setting.
6. **Added: "Exclude from budget"** on transactions, in review and the transaction's page: a
   once-in-decades expense (a roof) is categorized and counts in reports, but not against the
   month's budget.

## Questions

1. **Limits and goals:** expenses' budgets are limits, and income, asset and liability budgets
   are goals, so their bars go green when reached (proposed)? Or are all budgets limits?
2. **Home's bar:** expense budgets only (proposed)? Income budgets would mean adding what's
   earned to what's spent.
3. **Deleting or merging a budgeted account:**
   - drop its budgets (proposed)?
   - or move them to the substitute when it has none?
4. **A move that breaks the rule** (Groceries moved under a node with a smaller budget):
   - allow it and flag it on the Budgets page (proposed)?
   - or refuse the move?
5. **Weekly budgets' default start:** Monday (proposed), Sunday, or a book setting?
