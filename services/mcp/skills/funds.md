# Luminous Money: funds

Funds say what money is **for**, beside the accounts that say where it is: Emergency, Travel,
a Wedding. **Unallocated** is net worth less every fund: worked out, never written.

- **Money reaches or leaves a fund only when something says so:** a transaction's fund lines,
  a move between funds, or an account's default fund.
- **Fund lines** are on the transaction (`funds`: `[{"fund": "Emergency", "amount": {"number":
  "-200.00", "currency": "USD"}}]`): positive into the fund, negative out of it. What a
  transaction is to funds comes from its change in net worth: money in goes to funds, money out
  comes from them, a transfer between the user's accounts (or paying a card) puts money toward
  them. Lines add up to no more than the transaction, each way.
- **Moves** (`write_move_funds`) shift money between funds, or to and from Unallocated, on a
  date.
- **Default funds** (`write_add_fund_default`): from a date, what changes in an account (and
  under it) with no line saying otherwise is that fund's (an IRA's is Retirement).
  `read_fund_default_preview` says what setting one would do first.
- **Shares:** a fund can hold shares (`Retirement +10 VTI`) as well as dollars; a fund appears
  once per commodity. No fund may go below zero in a share by hand; what came in by itself and
  took a share a fund didn't have is **short** (`read_short_transactions`) until it's fixed.
  Dollars may go below zero.
- **Archiving** a fund moves what it holds to another fund (or Unallocated). Deleting is only for
  a fund never used. Renaming carries rules and schedules naming it.
