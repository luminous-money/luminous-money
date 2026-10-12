M2: Credit card account: plan
==================================================================================================

> **Status: planned (2026-10-12), not started.** There's no separate spec: the milestone's one
> line in [the plan](../../PLAN.md), M1's notes on matching, and the user's answers below are
> the brief. Anything still marked **Proposed** is open to change.

## What M2 is

A credit card needs nothing a bank account doesn't, so M2 drops the idea of account kinds
altogether. The real work is the other half of the milestone's line: **two accounts that reflect
two sides of the same transaction.** Paying the card from checking shows up in both CSVs, and
today each import stages its own transaction, so every card payment (and every transfer between
your own accounts) is counted twice. Fixing that means matching has to **act** for the first
time.

So M2 is four things:
1. **Starred accounts replace "money accounts."** Any account can be starred; starred accounts
   are the home page. Accounts are created however the user likes, with an optional opening
   balance.
2. **Display signs:** liabilities and income show inverted, so a card shows what's owed and
   income shows as positive.
3. **Matches that act:** an imported row that's the other side of an existing transaction joins
   it instead of becoming a new one.
4. **Reviewing matches:** the review queue shows what was matched, the alternatives, and a way
   to undo it.

## Decided (2026-10-12)

- **No account kinds** (`money: "bank"`, a credit-card kind, default `Assets:Bank:` or
  `Liabilities:CreditCard:` parents). The user creates any account they like by its full name.
  Creating a card as an asset, or even an expense, is theirs to make. Wording that adapts to the
  account's type is Polish.
- **Starred accounts are what the home page shows,** replacing "money accounts".
- **An opening balance is just a number from a statement,** with its date, for any account.
- **Display signs are inverted for liabilities and income.**
- **Matching:** as proposed below (strongest wins; a clear winner is matched without asking; a
  merged transfer keeps the flag of the transaction it joined).
- **The milestone keeps its name.**

## Approach

- **Same as M1: vertical slices,** each ending with `pnpm test` and `pnpm e2e` green, the docs,
  `docs/PLAN.md` and `RESUME.md` updated.
- **Generalize rather than special-case.** A card payment is a transfer between two accounts;
  transfers between two bank accounts get the same treatment, and are tested too.
- **Matching stays a resolver** in the existing chain, so M4's categorizers slot in after it
  unchanged. M2 makes its resolutions final when it's sure.

## Decisions this plan makes

### Starred accounts

- **Stars are per user, kept in `app`'s database** (user, book, account), **Proposed**. They're a
  preference, not bookkeeping: once books are shared (M8), your home page and Jess's can differ,
  and exports stay free of them. Renaming accounts (the chart of accounts) will have to carry
  stars along, as it will CSV profiles.
- **Star and unstar** from an account's ledger (a star in its header). Accounts created from the
  home page's "Add account" are starred.
- **The home page** shows starred accounts as cards: name, balance, last import. Their balances
  and `as_of` come from the ledger, for the accounts asked for.
- **An account's display name** (**Proposed**): its last segment with dashes as spaces
  (`PNC-Shared-Checking` → "PNC Shared Checking"). The `display-name` metadata stays honored if
  present; there's no field for it.
- **Adding an account** (setup and home): its full name (the shared `NewAccountField`, with
  autofill), then an optional **opening balance and its date**. A nonzero balance or a date
  records the opening-balance transaction, as now. No kind, no bank field.
- **What can be imported into:** any open leaf account. The import page's drop-down lists
  starred accounts first, then the rest (**Proposed**).
- **The import cutoff** is the account's opening balance's date, as now. An account without one
  has no cutoff.
- **Retiring `money`:** the ledger's money-account endpoints become an accounts summary
  (balances, `as_of`, last-import time stays in `app`). Existing `money` metadata is ignored, and
  the demo seed stars its checking account. (The dev stack's data is disposable.)

### Display signs

- **Liabilities and income are shown inverted,** wherever amounts are read rather than edited:
  home cards, account ledgers (amounts and running balances), and later reports. A card shows
  what's owed as positive, with charges increasing it; income shows as positive.
- **The transaction editor shows stored signs,** since its splits have to sum to zero.
- **One shared helper** decides it from the account's type, so every view agrees.
- **CSV profiles stay in stored signs** (money into the account positive). The profile editor's
  preview shows each row's effect on the displayed balance, so a file with backwards signs is
  obvious, and "negate amounts" fixes it.

### Matches that act

- **What can match an incoming row,** within ±5 days, same amount:
  - **The other side of a transfer:** a transaction in another account whose *uncategorized*
    leg has exactly this row's change. Example: checking's staged "PAYMENT TO CHASE" has
    `Expenses:Uncategorized +500.00`; the card's "PAYMENT THANK YOU" row changes the card by
    `+500.00`. They're the same event.
  - **The same event already in this account,** as M1 matches today: an existing transaction
    with the same amount that no import has claimed yet (typically one entered by hand).
- **The context grows to cover that:** the account's own transactions (as now), plus the book's
  transactions in the window with an uncategorized leg. One more ledger query by account and
  date range, which the transaction list already supports.
- **Acting on a match** (from M1's notes: the strongest candidate wins, ties broken arbitrarily,
  and a matched row falls out of the import):
  - **A transfer** merges: the uncategorized leg is replaced by this account, so the existing
    transaction becomes `Checking -500 / Card +500`. No new transaction is created.
  - **The same event** claims the existing transaction: it gets the row's `import-id`, so later
    imports see the row as a duplicate. Nothing else changes.
  - **Either way, the row's outcome is `matched`,** shown in the import results with what it
    matched.
  - **The flag is unchanged** (decided): merged into a confirmed transaction, it stays
    confirmed; into a pending one, it stays pending.
- **Atomic:** the ledger's batch endpoint takes updates (versioned) alongside creates, so an
  import's new transactions and its merges are one write.
- **Clear winners and alternatives** (decided):
  - With one candidate, or a top candidate at least 2 days closer than the next, the match is
    made and no options are shown.
  - Otherwise the strongest still wins, but the others are kept on the transaction as
    alternatives, and it's made pending so it shows up in review.
  - Alternatives are cleared when the transaction is confirmed.
- **Undoing a match:** the merged transaction remembers the row it absorbed (date, amount,
  description, fingerprint) in metadata. "Not a match" splits it back: the leg returns to
  uncategorized, and the row becomes its own staged transaction.

### Reviewing matches

- **A matched transaction's review card** says "Matched with <account> · <date>". Each
  alternative is offered as "Match with this instead", next to "Not a match".
- **Confirming** works as today, and clears the alternatives.

### Demo data

- **The demo book gains a credit card** with monthly payments from checking, both starred, and
  the e2e tests import both sides in either order.

## How it gets built

Five slices, in order. Each ends with `pnpm test` and `pnpm e2e` green and the docs updated, and
is committed on its own.

### 1. Starred accounts (replacing money accounts)

- **Ledger:**
  - `POST /accounts` takes an optional **opening balance**: `{amount, currency, date}`. When
    given, the account opens on that date (unless `open` says otherwise), and the
    opening-balance transaction is written in the same write, as money accounts do today.
  - **`GET /accounts/summary?account=…&account=…`** returns, for the accounts asked for, each
    one's type, display name, balance (from SQL, as now) and `as_of` (its opening balance's
    date, or null without one).
  - **Removed:** `/money-accounts` (both routes), `MoneyAccount`, `MoneyAccountIn`, and the
    `money`/`institution` fields on `Account`. `display-name` metadata is still read if present.
- **App:**
  - migration 3: a **`star`** table (user, book, account)
  - `GET /books/:book/stars` (the caller's starred accounts), `PUT` and `DELETE
    /books/:book/stars/:account`
  - the importer takes its cutoff from the summary's `as_of` (none without one) and accepts any
    open leaf account
- **PWA:**
  - **Home:** the starred accounts' cards (stars from `app`, balances from the summary). With
    nothing starred: "Star accounts to see them here", plus "Add account".
  - **Add account** (setup and home): the shared `NewAccountField` for the full name, then an
    optional opening balance and its date. Accounts added here are starred.
  - **An account's ledger:** a star toggle in its header. "Import transactions" shows for any
    leaf account.
  - **Import:** the drop-down lists every open leaf account, starred first.
  - **Display names:** one helper: `display-name` metadata if set, else the last segment with
    dashes as spaces.
- **Seed:** the demo stars its checking account and its credit card (`bean-example` already
  generates a Chase card paid from checking).
- **Tests:** ledger (opening balance on create, summary), app (stars, import into any leaf, no
  cutoff without an opening balance), e2e and browser (setup with an arbitrary path; star and
  unstar changes the home page; import picks starred first).

### 2. Display signs

- **A shared helper** says whether an account's amounts display inverted: liabilities and
  income.
- **Applied to** home cards, account ledgers (amounts and running balances) and the profile
  editor's preview. The transaction editor and review cards keep stored signs.
- **Colors** follow the stored sign, i.e. the effect on net worth (**Proposed**): a card charge
  shows as `$50.00` more owed, in red; a payment shows as `−$500.00` owed, in green.
- **Tests:** unit tests for the helper; a browser test of a card's ledger.

### 3. Matching context and candidates

- **The context** is read with the transaction list (`/transactions?account=&from=&to=`), which
  carries postings and metadata, instead of paging the account's ledger:
  - this account's transactions in the window
  - and those with a leg in `Expenses:Uncategorized` or `Income:Uncategorized`
- **Candidates,** same amount within ±5 days, scored by days apart as now:
  - **transfer:** a transaction that doesn't post to this account, hasn't been matched before,
    and has an uncategorized leg whose amount (worked out if elided) is exactly this row's
    change
  - **same event:** a transaction in this account that no import has touched (no `import-id`
    or `matched-import-id`): one entered by hand
- **Within a batch,** a transaction is matched at most once: rows claim candidates best score
  first.
- **Tests:** unit tests for each rule, elided legs, the exclusions, and claiming within a batch.

### 4. Acting on matches

- **Ledger:** **`POST /transactions/changes`** takes `{create: [...], update: [{id, updated_at,
  transaction}]}` and applies all of it in one write, or none (409 if any version is stale).
- **The import:**
  - **a clear winner** (the only candidate, or 2+ days closer than the next) is matched
  - **otherwise the best is matched anyway,** the others stored as alternatives, and the
    transaction made pending
  - **a transfer** replaces the uncategorized leg with this account and the row's amount; **a
    same-event match** changes no postings
  - both record the row on the transaction as metadata: `matched-import-id` (its fingerprint),
    `matched-import-batch`, `matched-account`, `matched-date`, `matched-description`, and
    `match-alternatives` (transaction IDs) when there are any
  - the row's outcome is **`matched`**, with the transaction it joined. Matched rows count as
    already imported on later imports, just like staged ones.
  - new rows and merges go to the ledger as one `changes` write
- **Import results** list matched rows ("matched with <payee> · <date>").
- **Tests:** app unit tests for both kinds of match and for alternatives; e2e importing
  checking-then-card and card-then-checking, ending with one transaction either way, and
  re-importing either file changes nothing.

### 5. Reviewing matches

- **App:** two actions, each one ledger `changes` write:
  - **`POST /books/:book/matches/:transaction/undo`** ("Not a match"): puts the uncategorized
    leg back (for a transfer), removes the `matched-*` metadata, and stages the absorbed row as
    its own pending transaction from what was recorded
  - **`POST /books/:book/matches/:transaction/move`** `{to}` ("Match with this instead"): undo,
    then match the row to the alternative
- **The review card** of a matched transaction: "Matched with <account> · <date>", each
  alternative as "Match with this instead", and "Not a match".
- **Confirming** (button, swipe or editor) clears `match-alternatives` in the same write.
- **Tests:** browser tests for an ambiguous match (move it, then undo it) and for a clear
  transfer, which shows no alternatives.

### Wrap-up

- **Docs:** design.md (stars, display signs, matching that acts), M2's status, `docs/PLAN.md`
  and RESUME.md.
- **The dev stack:** your PNC account loses its card until you star it. Its data is disposable,
  so there's no migration for `money` metadata.

## Out of scope for M2

- **Statements, due dates, credit limits and reconciling against a statement:** M13.
- **Categorizing the merchant side of charges:** M4. Charges land uncategorized, as in M1.
- **Scheduled card payments:** M3.
- **Matching by description or fuzzy amounts** (fees, currency conversion): later, if needed.
- **Type-aware wording** when creating accounts: Polish.

## Questions

Before building, the **Proposed** calls worth a glance:
1. Stars per user in `app`, rather than in the book.
2. Importing into any open leaf account, starred ones listed first.
3. Colors follow the stored sign (effect on net worth), even where the displayed number is
   inverted.
4. An ambiguous match is still made (best candidate), and sent to review with its alternatives,
   rather than left unmatched until you choose.
