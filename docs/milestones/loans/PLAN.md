Loans: plan
==================================================================================================

> **Status (2026-11-05): planned with Kael, being built.** Kael's brief is below, then the
> model. Kael's answers are under [Decided with Kael](#decided-with-kael); the calls made without asking go
> under [Decisions to review](#decisions-to-review). Loans come in two steps: **step 1 is
> loans** (the amortization table, dated changes, the payment schedule, history, escrow), and
> **step 2 is outflows** (a loan's payments counted as spending in budgets and charts).

## The brief (Kael, 2026-11-05)

- **A loan's payment is always principal, then interest, then optionally other things** like
  taxes, insurance or escrow. Be flexible about the others.
- **Managing a loan is always based on an amortization schedule,** either generated or
  imported: from a CSV, or from a PDF read by the AI.
- **Changes to the loan take effect on specific dates.** For example, "my mortgage company said
  my escrow payment is changing on XYZ date": record it, and the system honors it from that
  date.
- **Escrow dovetails with scheduled payments** that stand for the actual dispatch of the tax and
  homeowner's insurance payments. Those aren't managed in the loan, but the loan links out to
  manage them easily.
- **Declaring a loan that has already started** offers how to handle its history. Ten years into
  a 30-year mortgage: either **backfill** every payment granularly (auto-confirmed or not), or a
  single **now-dated declaration** of the principal still owed, "against the asset", letting the
  expenses and payable accrue from there.
- **Bonus: payments as monthly spending.** A loan often pays for one up-front purchase (a house,
  a car), but its payment acts like an expense in daily life, so it should show in monthly
  budgets and charts. One thought: build charts and graphs from **outflows** rather than
  accounts. Any split to an expense account is an outflow, and some assets and liabilities can
  be defined as outflows too: what's paid into them counts, and the expenses paid out of them
  are **masked** (the account is a proxy for them). That covers escrow, where the real expense
  is registered in bulk two or three times a year, but is seen as the monthly escrow payment.
  Then a separate way is needed to see traditional P&L reports against the expenses directly.

What's already here: [loans-and-taxes.md](../../loans-and-taxes.md) shows how a payment is
recorded today (one transaction, a split each for principal, interest, escrow), and sketches
both halves of this ("Budgets and the principal"). Funds B's design record leaves big loans "a
special case" (its open question 4): within funds, a loan is grouped with its asset, which is
the rest of Funds B, not this.

## What it looks like

A made-up mortgage: $300,000 borrowed on 2016-06-15 at 3.75% for 30 years, first payment
2016-08-01, principal and interest $1,389.35 a month, plus escrow of $450.00.

1. **Menu → Loans → New loan.** Name it ("Mortgage"), choose or create its accounts: what's owed
   (`Liabilities:Loans:Mortgage`), what pays it (`Assets:Bank:Checking`), where interest goes
   (`Expenses:Housing:Mortgage-Interest`), and, optionally, what it bought (`Assets:Home`).
2. **The table.** One of:
   - **Work it out:** amount borrowed, rate, term, first payment date. The payment is worked out
     (or typed, if the lender's differs by a cent).
   - **Import a CSV:** its columns mapped as an import's are (payment number, date, payment,
     principal, interest, balance, and any other columns as the others), checked row by row.
   - **Read a PDF or image:** the AI reads the lender's schedule into rows (in the background:
     it can take a minute or two), checked the same way.
   The table is shown with each row's principal, interest and balance, any row that doesn't add
   up marked.
3. **The others:** "+ Escrow" (to `Assets:Escrow:Mortgage`, $450.00), "+ PMI", "+ Other" (any
   name and account, an amount). Each has a "from" date; changing one later is a dated change.
4. **History** (shown when the first payment is before today):
   - **From the start:** the borrowing on the loan's date, then every payment due through today
     (confirmed, or unconfirmed for review). A payment already in the paying account (the bank
     feed's, say: the same total within 5 days) is filled in with the row's splits, not added a
     second time.
   - **From today:** one transaction today saying what's still owed (from the table: $232,357.56
     after payment 123; editable), and payments from the next one on.
   - **Already in the books:** the liability already says what's owed (migrated, or a bank
     feed), so nothing is written; payments from the next one on.
5. **Save.** The loan's page: what's owed (the books' balance), the next payment and its parts,
   what's left of the loan worked out from there (when it ends, the interest still to pay), the
   payments made, the changes, **Extra payment**, and Escrow.
6. **A change, later:** "Escrow becomes $482.17 from 2026-01-01." Payments staged from that date
   use it; the table shows it; nothing before changes.
7. **Escrow:** the escrow account's balance, the schedules that pay out of it ("Property tax,
   twice a year", "Homeowner's insurance, yearly"), each a link to its own editor, and "+ A
   payment from escrow", which opens New schedule from the escrow account.

## The model

- **A loan is accounts, a table, others and changes.** Its accounts: the liability, the paying
  account, the interest account, optionally the asset. Its **table** is either worked out from
  terms (borrowed, rate, term, first payment, the payment) or imported rows (number, due date,
  principal, interest, balance). Its **others** (escrow, PMI, fees) are each an account and an
  amount from a date. Its **changes** are dated.
- **The payment is the M3 schedule we have,** driven by the loan: a schedule whose rule is the
  loan's due dates and whose split amounts come from the loan's row for each date. So review,
  matching the bank's row, auto-confirm, "Not this time", upcoming rows and projected balances
  all work as they do for any schedule. Its editor says it follows the loan, and links there.
- **The payment's splits:** paying account −(the total), liability +principal, interest
  +interest, each other +its amount. The paying split carries the match tolerance; the
  principal takes up any difference, as a lender applies an overpayment to principal.
- **Changes** (each from a date):
  - **an other's amount** (escrow, PMI; 0 ends one), or a new other;
  - **extra principal** with every payment from a date (a one-off extra payment is just a
    transaction: **Extra payment** on the loan's page);
  - **what's owed** on a date (the lender's statement): the difference is written as an
    adjustment, so the books say what the lender does;
  - **a new table from a date** (the lender's new schedule, imported or worked out): its rate and
    payment from then on. An adjustable rate's reset comes this way.
- **The books win; the table is where they start** (Kael). Each payment is the table's row while
  the books agree with the table (what's owed before it is the row before's balance, to the
  cent), so an imported table is honored to the cent, lender's rounding included. From the first
  payment where they don't (an extra payment, a re-base), it's worked out from the books:
  interest is the rate on what the books say is owed the day before it's due, and principal is
  the rest of the payment, which stays the same, so the loan ends sooner. The loan's page shows
  what's left, worked out from the books' balance today.
- **History** as above (step 4).
- **Escrow is an account** the lender holds for you (`Assets:Escrow:…`), filled by the payment
  and drawn on by ordinary schedules (tax, insurance) that the loan's page lists and links to.

## Step 1: as built (2026-11-05)

Built as planned, with the departures noted under [Decisions to review](#decisions-to-review).

- **Where things are:**
  - `services/app/src/shared/loans.ts`: the types and the engine, shared by the server and the
    PWA (amortizing, imported rows' rate and payment, row checks, `paymentOn` (the table's row
    while the books agree, else worked out), `project`, a payment's splits, `loanProblem`).
    `shared/loan-csv.ts` reads a lender's CSV (columns guessed from the headers).
  - `services/app/src/server/loans.ts`: declaring (the three histories), `editLoan`,
    `rebaseLoan`, `extraPayment`, `loanView` (the status the page shows).
    `server/loan-payments.ts`: staging a loan's payments for its schedule (what the books say is
    owed, Opening Balances before the paying account's books begin, the bank's copy filled in)
    and filling unconfirmed ones in again after a change. `server/loan-read.ts`: a schedule read
    by the AI. `server/schedules.ts` hands a loan's occurrences to the loan.
  - `app.sqlite` migration 20: `loan` (accounts and the rest as JSON, its `schedule_id`).
  - The `ai` service's third operation, `loans/extract` (`loan-table` in usage): Claude's
    `LOAN_TABLE_SYSTEM` and schema in `services/ai/src/providers`, the fake's twelve payments.
  - The PWA: `pages/Loans.tsx`, `LoanEditor.tsx` (New loan), `LoanPage.tsx`;
    `components/Loans.tsx` (tables, the others' fieldset, the labeled picker) and
    `LoanTableSource.tsx` (work it out / CSV / PDF, used by New loan and by a new table).
- **The API** (`/api/app/v1/books/:book/`): `GET`/`POST loans`, `GET`/`PATCH`/`DELETE
  loans/:id`, `POST loans/:id/rebase`, `POST loans/:id/extra`, `POST loans/read` (multipart
  `file`, a job with `Prefer: respond-async`). A terms table's rows are worked out by the server
  when they aren't sent, so a script can send only terms. A loan's schedule refuses `PATCH` and
  `DELETE` (422: change the loan).
- **Tests:** the engine (15) and the CSV (4) in `shared/`, the server (10, `server/loans.test.ts`),
  the ai service (reading a schedule), `tests/e2e/src/loans.test.ts` (4) and
  `tests/ui/src/loans.spec.ts` (2). Screens looked at on a phone and a desktop, light and dark;
  wide tables scroll inside their card.

## Step 2: outflows

- **An asset or liability can count as spending** (its editor; the loan's setup offers it for
  its liability and escrow account): what's paid into it counts as spending, **as** an expense
  account chosen for it (`Expenses:Housing:Mortgage-Principal`, `Expenses:Housing:Escrow`), so
  budgets and breakdowns place it.
- **A transaction's outflows** are its expense splits, plus what it pays into an account that
  counts as spending (shown as that account's expense), less the expenses it pays *from* one
  (masked: the account already counted them as they went in). So the monthly payment above is
  $1,839.35 of spending (principal, interest and escrow), and the county's $5,100 tax bill paid
  from escrow is none. Borrowing (the liability going the other way) is never spending.
- **Where it counts:** budgets, home's "Spent this month", and Reports' spending (cash flow, the
  breakdown, the largest). Reports gets a switch: **Outflows** (the default) or **Expenses**,
  the traditional P&L view, against the expense accounts directly.

## Decided with Kael

Asked and answered on 2026-11-05:

1. **The books win; the table is a starting point.** Kael: "It should be simple and easy to make
   an extra payment against your principal, and as far as I know, that actually invalidates the
   amortization table." That's right for an amortized loan: interest is charged on what's still
   owed, so an extra payment lowers every later month's interest; the payment stays the same and
   the loan ends sooner (only a recast changes the payment). Claude's refinement, so a lender's
   rounding doesn't make the books drift a cent at a time: the table's rows are used while the
   books agree with them, and worked out from the books from the first payment where they don't.
2. **The opening's other side is `Equity:Opening-Balances`,** with the linked asset offered
   instead (for an asset that isn't in the books yet, or a backfill's original purchase). Posting
   the loan against a house already at its value would add the loan to it.
3. **The dated changes in step 1:** an other's amount (always), extra principal, a re-base on a
   balance, and a new table from a date. Not rate changes on their own: an adjustable rate's
   reset comes as a new table.
4. **Outflows are built now,** as step 2: budgets, home's "Spent this month" and Reports use
   them, and Reports has a switch to Expenses, the traditional P&L view.

## Decisions to review

Made without asking; each is easy to change.

1. **Loans live in `app`, beside schedules,** not in the ledger: the loan drives a schedule, which
   is `app`'s, and a table is hundreds of rows. So a book's Beancount export doesn't carry a loan
   (nor a schedule); whole-system backups do. Its effects (every payment) are in the books.
2. **The payment is an M3 schedule the loan keeps** (rule, name and template), so review,
   matching, auto-confirm, "Not this time" and upcoming rows come free. The Schedules page marks
   it "A loan's payments" and opens the loan; its editor says to change the loan.
3. **Monthly only,** on the first table's first payment's day; an imported row is matched to a
   due date by month. A new table that moves the due day isn't followed.
4. **Interest is on what the books say is owed the day before a payment is due,** unconfirmed
   transactions included. So an extra payment lowers the very next payment's interest; some
   servicers wait a month. The lender's statement and a re-base settle any difference.
5. **An imported table's rate** is the median of its first 24 rows' interest on what was owed
   (three places), and its **payment** the most common principal and interest, so an odd first or
   last payment doesn't count.
6. **Principal is left blank in a staged payment only when it has a match tolerance,** so the
   bank's different amount goes to principal on confirming (as M3's blank split does); otherwise
   every split has its amount.
7. **Payments due before the paying account's books begin** (its open date) come from Opening
   Balances and are principal and interest only: the money left before that account's history
   (its opening balance already counts it), and what the lender did with escrow then isn't known.
8. **A payment already in the paying account** (the same total within the tolerance, five days
   either side, not staged by a schedule) becomes the payment rather than a second one, every
   time payments are staged, not only in a backfill. One that already pays down the loan is taken
   as it is; otherwise its splits are filled in (the bank's amount kept) and it goes back to
   review, unless payments confirm automatically (or the backfill's Confirm).
9. **"From today"'s transaction is confirmed;** "from the start"'s borrowing follows the
   backfill's Confirm. Both refuse a liability that already says something's owed ("Already in
   the books" is for that).
10. **A re-base's difference goes to the interest account** by default (usually it's rounding),
    any account allowed.
11. **A change fills in again the unconfirmed payments from the earliest date it touches;**
    confirmed ones stay as they are, and one the bank's row matched keeps the bank's amount.
12. **An extra payment is a transaction of its own** (from the paying account, on its date), not
    added to the next payment; the unconfirmed payments after it are filled in again.
13. **Reading a schedule:** the book's extract model (Sonnet 5) at medium effort, with room for
    64,000 tokens (a 30-year schedule is 360 rows), a 15-minute wait in `app` and 20 in the PWA,
    since `app` checks the rows add up rather than trusting them. A PDF is at most 5 MB.
14. **Escrow's account defaults to `Assets:Escrow:<the loan's name>`,** and accounts named but not
    yet in the chart are opened when the loan is saved.
15. **"Paid from escrow"** is every other schedule whose template posts to one of the loan's
    others' asset accounts, each a link to its own editor; "+ A payment from escrow" opens New
    schedule paid out of it, yearly.
16. **The schedule's template is the next payment,** refreshed when the loan changes and after
    payments are staged, so the Schedules page and upcoming rows show it.
