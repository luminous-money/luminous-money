# Luminous Money: reports

`read_report` gives the Reports page's views; amounts are in the book's currency.

- `spending`: this month by day, against the budget and a typical month.
- `cash_flow`: income and expenses for each of the last `months`.
- `breakdown`: the largest categories (`side` expenses or income), at a `depth` of account
  levels, over a `window` (a 6-month average, this month, or all of it), or the accounts just
  under `of`.
- `largest`: this month's largest expenses (with tags, the largest of all time).
- `net_worth`: assets, liabilities and net worth at each month end.
- `typical`: what an expense or income account's week, month and year usually come to.

**Spending is read as money out** (`lens: "outflows"`, the default): a loan's principal and
escrow count as the expense accounts they're set to count as. `lens: "expenses"` reads the
expense accounts as booked. `budgeted: true` leaves out what's kept out of budgets. `tag` keeps
only splits with every tag given.

For anything else (a payee's total this year, spending by tag), `read_query` with BQL, or
`read_daily_balances` for an account's balance over time.
