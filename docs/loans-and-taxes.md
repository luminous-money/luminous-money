Loans and taxes in the books
==================================================================================================

How to record payments that are more than one thing: a mortgage or auto loan payment (debt paid
down, interest, escrowed taxes and insurance), and a paycheck with taxes withheld (some of which
may come back as a refund). The numbers here are made up.

## A mortgage payment

One payment out of checking is four (or five) different things, so it's one transaction with a
split for each:

```beancount
2026-10-01 * "Mortgage payment"
  Assets:Bank:Checking              -2500.00 USD
  Liabilities:Mortgage               1100.00 USD   ; principal: you owe less
  Expenses:Housing:Mortgage-Interest  900.00 USD
  Expenses:Housing:Property-Tax       350.00 USD   ; escrowed: see below
  Expenses:Housing:Insurance          150.00 USD
```

- **The debt** is a liability, `Liabilities:Mortgage`, opened at what was borrowed. Each payment's
  principal brings it toward zero.
- **The house** is an asset, `Assets:Home`, at what it cost, kept current with "Revalued
  periodically" (M5): each revaluation moves the difference through unrealized gains.
- **Equity in the house isn't an account.** It's the house's value less what's still owed, and
  net worth (M12) already shows it: paying principal moves money from checking into equity, the
  way a transfer to savings does.
- **Escrow,** more precisely: the lender holds the tax and insurance money until the bills come.
  To follow that, post those splits to `Assets:Escrow` instead, and when the county's bill is
  paid from it, move it on: `Assets:Escrow` to `Expenses:Housing:Property-Tax`. Posting them
  straight to the expenses, as above, is simpler and usually close enough.

### An auto loan

The same, with `Liabilities:Auto-Loan`, `Expenses:Auto:Loan-Interest`, and `Assets:Vehicle` for the
car. Revaluing the car records its depreciation.

### Budgets and the principal

In double-entry, principal isn't spending: it's debt paid down. So budgets (M11) count only the
interest, taxes and insurance ($1,400 above), not the $2,500 that left checking. Thinking of the
whole payment as the month's housing cost is natural, though. Two ways to close that gap, neither
built yet:

1. **"Count payments as spending"** on a liability account: budgets and "Spent this month" would
   include its paydown, while the books stay correct.
2. **Amortization in schedules** (M3): each month's principal and interest computed from the rate,
   term and balance, so a scheduled payment's splits are right every month. Today a schedule's
   split amounts are fixed (each with a match tolerance).

## A paycheck with taxes withheld

Record the paycheck at its gross, with what's withheld as expenses, and the net into checking:

```beancount
2026-10-15 * "Paycheck"
  Income:Salary            -5000.00 USD
  Expenses:Taxes:Federal     700.00 USD
  Expenses:Taxes:State       200.00 USD
  Expenses:Taxes:FICA        380.00 USD
  Assets:Bank:Checking      3720.00 USD
```

- **A schedule** (M3) makes this one template, every pay date: salary is the case schedules were
  built for, with a match tolerance on the net deposit so the bank's amount matches it.
- **A refund** at tax time goes back to the same expense:

  ```beancount
  2027-04-02 * "Federal tax refund"
    Assets:Bank:Checking      1200.00 USD
    Expenses:Taxes:Federal   -1200.00 USD
  ```

  The year's tax expense then comes out as what was actually owed. A balance due is the same
  thing the other way.
- **More precisely,** withholding is a prepayment: post it to `Assets:Prepaid-Taxes`, and when the
  return is filed, move the year's actual tax to `Expenses:Taxes` and the refund (or what's due)
  through checking. It's more bookkeeping for the same totals.

### Budgets and reports

- **Taxes are real expenses,** so cash flow and breakdowns (M12) count them (and income is
  gross).
- **"Spent this month"** covers the highest-level expense budgets. Budget Housing, Food and so on
  but not Taxes, and taxes stay out of that chart; a budget on the whole Expenses account brings
  them in.
