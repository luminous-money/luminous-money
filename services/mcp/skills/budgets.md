# Luminous Money: budgets

- A budget is how much an account may take in a period (a **limit**, on expenses) or should
  bring in (a **goal**, on income, savings, or a debt being paid down).
- Periods are every N days, weeks, months or years from the budget's start. A change is a new
  **version** from the period it starts in, so earlier periods keep the budget they had.
  `write_set_budget` with an amount of 0 ends one from that period.
- **No budget is higher per year than one on an account above it** (a weekly $150 under a
  monthly $600 is refused). A budgeted node with budgets under it keeps the rest as its
  "Other".
- **What counts** is the account's flow over the period, its subtree included; refunds take
  spending back. Staged (unconfirmed) transactions count, shown apart. Transactions marked
  `budget: FALSE` don't count. When an account counts as spending (a loan's principal or
  escrow), budgets read spending as money out ("outflows").
- `read_budget_status` measures every budget over its current period (or, with `basis:
  "month"`, all restated per month): spent, left, the days.
- Stars (`write_star` with `kind: "budget"`) put a budget on the user's home page.
