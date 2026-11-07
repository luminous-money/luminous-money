Loans: plan
==================================================================================================

> **Status (2026-11-06): steps 1 and 2 built; step 1 released as `v0.1.16`, step 2 as
> `v0.1.17`; the decisions reviewed with Kael (one changed) in `v0.1.18`. Step 3 (setting a
> loan up as a questionnaire) is planned with Kael and released as `v0.1.19`: [Step 3](#step-3-setting-a-loan-up-a-questionnaire).**
> Kael's brief is below, then the model. Kael's answers are under [Decided with Kael](#decided-with-kael); the calls made without asking go
> under [Decisions to review](#decisions-to-review). Loans come in steps: **step 1 is
> loans** (the amortization table, dated changes, the payment schedule, history, escrow),
> **step 2 is outflows** (a loan's payments counted as spending in budgets and charts), and
> **step 3 replaces New loan with a questionnaire**.

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
  +interest, each other +its amount. The paying split carries the match tolerance; escrow
  takes up any difference (Kael, reviewing decision 6: a bill that differs is most often an
  escrow change not recorded yet), and principal does for a loan without escrow.
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
  the ai service (reading a schedule), `tests/e2e/src/loans.test.ts` (5, with a matched payment's difference) and
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

### Step 2: as built (2026-11-05)

- **In the books:** `outflow: "Expenses:…"` on an asset or liability's `open` (and so its
  subtree), set with `PATCH /accounts/{account}` (`outflow`; `""` clears it), shown on
  `Account.outflow`; a rename of the expense account follows. Exports carry it.
- **The lens is the ledger's** (`services/ledger/src/ledger/outflows.py`):
  `GET /transactions/compact?lens=outflows` adds a split for what's paid into a counting account
  (as its expense account, marked `outflow_of`) and masks expenses paid out of one; budget
  status reads flows through it whenever any account counts. One implementation for budgets and
  reports.
- **`app`'s reports** (`server/reports.ts`) read spending as outflows unless `?lens=expenses`;
  home's "Spent this month" always as outflows; net worth and an account's Typically as booked.
- **The PWA:** Reports' **Outflows | Expenses** switch (`?lens=expenses` in the address), the
  account editor's **Counts as spending** card (`components/Outflow.tsx`), the loan page's
  **As spending** card ("Count the payments as spending"), and New loan's **Count the whole
  payment as monthly spending** (checked), which opens `<interest's parent>:<Loan>-Principal`
  and `-Escrow` and counts the liability and escrow as them.
- **Tests:** the ledger (8, `tests/test_outflows.py`), `app`'s reports asking for the right lens,
  an API test (the cash flow and a budget, booked and as outflows) and a browser test (New loan
  through Reports' switch).

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

Made without asking. **Reviewed with Kael on 2026-11-05:** all 21 kept as built but number 6,
now escrow (`v0.1.18`).

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
6. **Changed by Kael: escrow takes up the bank's different amount.** A staged payment with a
   match tolerance (and the bank's copy filled in) leaves escrow blank, so on confirming the
   difference goes to escrow (as M3's blank split does); without escrow, principal is left blank.
   Otherwise every split has its amount. (First built with principal taking it up.)
7. **Changed by Kael (2026-11-06): payments due before the paying account's books begin** (its
   open date) come from Opening Balances, since the money left before that account's history
   (its opening balance already counts it), **and are the whole payment, escrow and the rest
   included.** (First built as principal and interest only, since what the lender did with
   escrow then isn't known; but escrow's bills were backfilled, so escrow came out short.)
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
    yet in the chart are opened when the loan is saved. (Step 3: `Assets:Escrow:<what it's
    for>`, opened by Confirm's one request.)
15. **"Paid from escrow"** is every other schedule whose template posts to one of the loan's
    others' asset accounts, each a link to its own editor; "+ A payment from escrow" opens New
    schedule paid out of it, yearly.
16. **The schedule's template is the next payment,** refreshed when the loan changes and after
    payments are staged, so the Schedules page and upcoming rows show it.

Step 2's:

17. **Counting as spending is a setting on the account's `open`** (the ledger's), so budgets
    (which the ledger works out) read it, exports carry it, and a renamed expense account is
    followed. It covers the account's subtree.
18. **What it counts as must be an open expense leaf.** New loan offers it checked, opening
    `<interest's parent>:<Loan>-Principal` and `-<the other's name>` (`Mortgage-Escrow`).
    (Step 3: opt-in, on the last page, suggesting `Expenses:Financing:Principal:<what it's
    for>` and `…:Escrow:…`; Kael.)
19. **What comes out of a counting account masks the transaction's expenses first,** then what it
    pays into another counting account (escrow's surplus applied to principal), each in
    proportion, in cents. Borrowing, a refund out of it to the bank, and anything else aren't
    spending, and don't reduce it either.
20. **Budgets always count outflows** when any account counts as spending, with no switch of
    their own; home's "Spent this month" too. Only the operating currency is counted.
21. **Reports' switch is in the address** (`?lens=expenses`), so it survives a reload and a
    tag filter; net worth and an account's Typically read the books as booked. The cash flow's
    total keeps its "Expenses" label, as the chart's legend does.

## Step 3: setting a loan up (a questionnaire)

### Kael's brief (2026-11-06)

Trying New loan, Kael found it hard to follow:

- The accounts asked for up front are confusing: it isn't clear what each is for.
- What the loan bought can't be a new account.
- Importing a lender's table (CSV, or a PDF read by the AI) isn't likely to be useful: working
  it out from the terms is easy and should be close to bullet-proof. Take the import off the UI
  and keep its code, in case it comes back.
- A first payment on the 1st of a month showed in the table as the month before.
- The history choices are confusing: simplify and explain them, and perhaps drop "already in
  the books" from the UI (keeping its code).

Instead, a questionnaire (Typeform-like) that builds up what's to be made and creates nothing
until the end:

1. **What is this loan for?** "Be specific. Something like '123 Main St' for a home or '2023
   Chevy Spark' for a car."
2. **Terms:** the loan's figures, and the table they make, to confirm.
3. **Extras:** escrow, PMI and the like, their accounts defaulting to
   `Assets:Escrow:123-Main-St`, `Expenses:Insurance:PMI:123-Main-St`.
4. **History.**
5. **Payment options.**
6. **Confirmation:** where all the money will flow (new accounts included), what Confirm does,
   what happens when payments come in, and what to do on an extra payment, an escrow change,
   or a tax or insurance bill paid from escrow. Adjust anything, then Confirm creates the
   accounts, schedules and the rest.

Default accounts are named from the answer to question 1: what's owed
`Liabilities:Loans:Mortgages:123-Main-St`, interest `Expenses:Financing:Interest:123-Main-St`,
what it bought `Assets:Property:123-Main-St`, and paid from the first starred bank account, else
the first bank account, else blank.

### What was wrong before

- **The month a payment was due was shown a month early** in the Americas: the tables showed a
  due date as its month, formatted at UTC midnight in the browser's time zone, so the 1st was
  the last day of the month before. The payments themselves were right (due on the 1st). The
  loan page's tables and its "Paid off …" had the same bug.
- **"What it bought" was the one picker without "Create account".**
- **Accounts typed into New loan were opened as soon as they were named,** and the loan, then
  counting it as spending, were separate requests after: a failure part way left accounts behind.

### What it looks like

A made-up home: "123 Main St", $300,000 borrowed on 2024-07-19 at 6.5% for 30 years, first
payment 2024-09-01, bought for $375,000, escrow $450.00 a month, PMI $125.00.

1. **What is this loan for?** A home, a car, or something else; then "123 Main St" (the help
   text above). One screen.
2. **Terms:** borrowed, rate, monthly payments, first payment, borrowed on (a month before the
   first payment until changed), what it cost (a home or a car; optional), and the payment if the
   lender's differs by a cent. The table below, with full due dates: "Does this match your
   paperwork?"
3. **Extras** (a home): escrow (a month's amount, what's in it now from the lender's statement,
   and, optionally, the property tax and homeowner's insurance it pays: amount, how often, next
   due), PMI, and anything else (a name and an amount). A car or something else: anything else.
   Each says where it will go ("to Assets:Escrow:123-Main-St; you can change it at the end").
4. **History**, only when payments are already due: "26 payments were due from Sep 1, 2024 to
   Oct 1, 2026. How should they go into your books?" **Record each payment** (the borrowing,
   then each payment split into principal, interest and escrow; payments the bank already sent
   are split, not added twice; the whole interest history, for taxes) or **Start from what I
   owe now** (one entry for what's owed today, from the table, corrected from a statement;
   payments from the next one).
5. **Payment:** paid from (the default above), the lender (the payments' payee), the match
   tolerance, and confirming payments automatically.
6. **Confirmation:** each month's payment and where each part goes, the escrow bills, every
   account (marked new or existing, each changeable: rename a new one or pick another), what
   Confirm writes, "Count principal and escrow as spending" (off; its accounts chosen there
   when on), and what to do later. Each step has a Change link back to it. **Confirm** sends it
   all in one request, and opens the loan's page.

Back and Next on every step, and a progress bar. The answers are kept in the browser's session,
so a reload doesn't lose them.

### Decided with Kael (2026-11-06)

1. **The kind of loan is asked with question 1:** a home (mortgage), a car, or something else.
   It picks the default names and which extras are offered (escrow and PMI for a home).
2. **History is two choices,** Record each payment or Start from what I owe now, with no
   "Against" and no "Confirm them" (always Opening Balances; recorded payments confirmed).
   A loan account that already says what's owed is noticed, and nothing is written for it
   ("already in the books", no longer a choice). The step is skipped when nothing is due yet.
3. **A new asset account asks what it cost** (optional), dated when it was borrowed, so net
   worth reads its value less what's owed. An existing one gets nothing written.
4. **Counting principal and escrow as spending is opt-in,** on the confirmation page, its
   accounts chosen there.
5. **Escrow asks what's in it now** (optional, from the lender's statement), and the books'
   escrow is set to it.
6. **The tax and insurance bills paid from escrow can be set up here,** optionally; if they're
   left for later, the confirmation page says how (the loan's page, "+ A payment from escrow").
7. **Paid from defaults to a bank-linked account:** the first starred asset account linked to a
   bank feed (home's order), else the first linked one A–Z; with none linked, the same for
   accounts under `Assets:Bank`; else blank.
8. **The loan's page is only aligned:** no CSV or PDF for a new table either, the dates fixed,
   and the confirmation page's "what to do when" wording.
9. **One step per screen,** not one question per screen.

### Calls made without asking (to review)

1. **The loan's name** is "123 Main St mortgage" (a home), "2023 Chevy Spark loan" (a car or
   something else), changeable on the confirmation page. The kind isn't kept on the loan.
2. **Default names by kind:**

   | | A home | A car | Something else |
   |---|---|---|---|
   | What's owed | `Liabilities:Loans:Mortgages:X` | `Liabilities:Loans:Auto:X` | `Liabilities:Loans:X` |
   | What it bought | `Assets:Property:X` | `Assets:Vehicles:X` | none (one can be added) |

   Always: interest `Expenses:Financing:Interest:X`; escrow `Assets:Escrow:X`; PMI
   `Expenses:Insurance:PMI:X`; anything else `Expenses:Financing:<its name>:X`; the property tax
   `Expenses:Taxes:Property:X`, homeowner's insurance `Expenses:Insurance:Homeowners:X`. X is the
   answer to question 1 as an account part ("123 Main St" is `123-Main-St`).
3. **A new asset is a revalued asset** (a new value asked for yearly, as Add account's are),
   opened with what it cost on the borrowing date, against Opening Balances. The borrowing is
   against Opening Balances too, so the asset holds the price and the loan what's owed. When
   the paying account's books cover the borrowing date, the confirmation page says that a down
   payment among the bank's transactions goes to Opening Balances, or the house is counted
   twice.
4. **"Borrowed on" is asked in Terms** (it dates the borrowing and what it cost), a month before
   the first payment until changed.
5. **Escrow's balance now** has its date (today until changed): after the payments are staged,
   the difference between it and what the books say escrow holds then is written against
   Opening Balances. Blank writes nothing.
6. **The escrow bills** are the property tax (yearly, twice a year or quarterly) and homeowner's
   insurance (yearly), each an amount and its next due date: schedules paid from escrow, not
   confirmed automatically (a tax bill changes from year to year, and review is where it's
   corrected).
7. **Confirm is one request:** `POST loans` takes a `setup` (accounts to open, with the
   asset's opening and revaluing; escrow's balance; the bills; what counts as spending), all
   checked before anything is written. The accounts open first in one all-or-none write.
8. **"Count as spending" suggests** `Expenses:Financing:Principal:X` and
   `Expenses:Financing:Escrow:X` when it's turned on. The loan page's As spending card suggests
   the same (X from each account's last part), with pickers rather than one press.
9. **The answers are kept per book in `sessionStorage`,** cleared by Confirm or "Start over".
10. **The CSV and PDF code stays:** the table's source component offers only "work it out"
    unless told otherwise, so its choice is hidden; `loans/read`, the CSV reader and the `ai`
    service's operation are untouched.
11. **A loan account chosen at the end that already says what's owed** makes the history
    "already in the books" (the server's `books`), and the confirmation page says so. It's
    noticed there, since that's where accounts are chosen.

### Step 3: as built (2026-11-06)

Built as planned above.

- **Where things are:**
  - `services/app/src/web/lib/loan-setup.ts`: the questionnaire without its screens: the
    draft, the default accounts, the steps and what each still needs, the paid-from default, and
    `requestOf` (what Confirm sends). `loan-setup.test.ts` covers it.
  - `web/pages/LoanSetup.tsx` (the page: steps, progress, Back and Next, the session's copy),
    `web/components/LoanSetupSteps.tsx` (the five questions) and `LoanConfirm.tsx` (the last
    page, and `LoanHowTo`, the "what to do when" list the loan's page shows too).
    `pages/LoanEditor.tsx` (the old form) is gone.
  - `server/loans.ts`: `createLoan` takes `setup` (`LoanSetup` in `shared/loans.ts`), checks it
    with the loan (`setupProblem`, against the chart as it will be), then opens its accounts
    (`createAccounts`), sets what counts as spending, declares the loan, creates the bills
    (`createSchedule`), then sets escrow's balance (bills first since 2026-11-06, so a bill
    already paid counts).
  - `components/AccountPicker.tsx` gained `suggest` ("Create account"'s name when nothing's
    typed: renaming one not made yet); `components/Loans.tsx` has `planned` (a "Create account"
    that only names one) and `inChart`. `LoanTableSource` offers only "work it out" unless given
    `sources`.
  - The loan's page: the dates, a "What to do when…" card, "Create account" for what it bought
    in Settings, and As spending suggesting `Expenses:Financing:<part>:<the account's last part>`
    with pickers.
- **Tests:** `loan-setup.test.ts` (8), `format.test.ts` (the dates in Chicago's zone), the server
  (3 more in `server/loans.test.ts`: the setup made, escrow's figure after a backfill, and nothing
  written when any of it is wrong), an API test (`tests/e2e/src/loans.test.ts`, the setup in one
  request) and `tests/ui/src/loans.spec.ts`, rewritten in Chicago's zone (a home step by step to
  its page; a car's with no history step, a reload, an account already owing, and spending).
