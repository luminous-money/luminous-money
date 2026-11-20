# Luminous Money: the base skill

Luminous Money is double-entry household accounting, with Beancount as its engine. You're
working as the user: what you can see and change is what they can in the app.

## Books

Everything happens in a **book** (a household's accounts). `read_books` lists those the user
can see, with their role: `owner` and `manage` set things up, `write` changes what's in it,
`read` only looks. Every other tool takes the book's `id`. If the user has one book, use it;
if several, ask which, unless they said.

## Accounts

- Five roots: `Assets`, `Liabilities`, `Equity`, `Income`, `Expenses`. Names are full paths
  (`Expenses:Food:Groceries`); each part starts with a capital letter or digit, then letters,
  digits and dashes (no spaces: `Coffee-Shops`).
- A **leaf** holds transactions; a **node** holds sub-accounts and never transactions.
- A **divided account** is one real account (one bank account) its sub-accounts divide (Savings
  into Emergency and Travel). What comes in lands in its main part.
- `read_accounts` gives the chart with balances: `balance` is the account's own, `total` its
  subtree's.

## Transactions

- A transaction has a `date`, a `payee`, a `narration` (what it was for), and **splits**
  (`postings`): each an `account` and `units` (`{"number": "-42.17", "currency": "USD"}`).
  Amounts are decimal strings. The splits add up to zero.
- **Signs:** money leaving an asset is negative there; spending is positive on the expense.
  Paying $42.17 for groceries by card: `Liabilities:Card -42.17`, `Expenses:Food:Groceries
  42.17`. A paycheck: `Assets:Checking 2000`, `Income:Salary -2000`. A liability's balance is
  negative while money is owed.
- One split may leave out `units`, to take whatever balances the rest.
- **Staged and confirmed:** `flag` `!` is staged, waiting in review (imports, bank feeds,
  schedules and receipts arrive staged); `*` is confirmed. Confirming is setting `*`.
- **Tags** are on splits (`tags` on a posting): a transaction's tags are its splits'.
  `hsa-fsa-eligible` marks a split an HSA or FSA can pay back (medical care as IRS Publication
  502 counts it); Amazon's marked items get it by themselves, and it goes on the item's split,
  not the whole purchase.
- **Fund lines** (`funds` on the transaction) say what money is for; the funds skill explains.
- `"meta": {"budget": false}` on a transaction keeps it out of budgets (a once-in-twenty-years
  roof), while it counts everywhere else.

## Changing things

- **Every edit is versioned.** Read the thing first; send its `updated_at` with the change. If
  someone (or something) changed it since, the edit is refused (409): read it again, check the
  change still makes sense, and retry with the new `updated_at`.
- Edits change only the fields sent. A transaction's `postings`, when sent, replace them all:
  send every split, not just the one that changed.
- Do what the user asks. When something's ambiguous (which account, which fund, whether to
  confirm or leave it for review), say what you'd do or ask; don't guess at money.

## Finding things

- `read_transactions` searches the whole book (words in payee, narration or memos; accounts;
  tags; a date to start from), newest first, a page at a time (`next_cursor`).
- `read_account_ledger` is one account's register with its running balance.
- `read_query` runs BQL (Beancount Query Language) for anything else, like totals by account
  over a period: `SELECT account, sum(position) WHERE account ~ '^Expenses' AND year = 2026
  GROUP BY account ORDER BY account`.

## The other skills

Every tool says its domain first (`[review] …`), and refuses until its skill is loaded:
`load_skill("<domain>")`.

- **review:** the review queue, categorizing and confirming, matches, transfers, rules,
  notifications.
- **accounts:** opening, editing, renaming, archiving, dividing and deleting accounts;
  commodities.
- **budgets:** budgets and how they're doing.
- **reports:** spending, cash flow, breakdowns, net worth.
- **funds:** what money is for: funds, moves, default funds.
- **investments:** brokerage holdings, trades, prices, revaluing a house or car.
- **loans:** a mortgage or car loan: its payments, escrow, extra payments.
- **schedules:** repeating transactions and what's coming up.
- **reconciling:** an account against its statement.
- **receipts:** attachments, reading an attached receipt, Amazon's orders.
- **imports:** what came in from files and bank feeds; syncing a bank now.
