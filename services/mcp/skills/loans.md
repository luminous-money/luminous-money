# Luminous Money: loans

A loan (a mortgage, a car loan) is managed from its amortization table; its payments are a
schedule the loan keeps, staged with principal, interest and anything paid with them (escrow,
PMI) apart.

- **Accounts:** `liability` (what's owed: `Liabilities:Mortgage`), `paying` (what pays it:
  checking), `interest` (an expense), and optionally `asset` (what it bought: the house).
- **The table** is where it starts: worked out from `terms` (amount, yearly rate as a percent,
  number of payments, first due date) with `rows` empty, or the lender's rows. A later table
  takes over from its date (a new rate).
- **The books win:** a payment follows its table's row while the books agree with the table to
  the cent; after an extra payment or a re-base it's worked out from what's owed (the payment
  stays the same, so the loan ends sooner).
- **Others** are each a name, an account and an amount from a date: escrow
  (`Assets:Escrow:…`, an account the lender holds), PMI, fees. A new version of the same name
  changes it; 0 ends it. **Extras** add principal to every payment from a date.
- **History** when it's already under way: `start` (the borrowing, then every payment due),
  `today` (one transaction saying what's owed now), or `books` (the liability already says).
- `write_extra_loan_payment` records a one-off extra toward principal. `write_rebase_loan`
  records what the lender's statement says was owed on a date: the difference is written as an
  adjustment, so the books agree with the lender.
- Changes fill in again the unconfirmed payments from the earliest date they touch; confirmed
  ones stay. A loan's payment schedule can't be edited on its own: edit the loan.
- The bills paid from escrow (property tax, insurance) are ordinary schedules out of the escrow
  account (the schedules skill).
