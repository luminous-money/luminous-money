M2: Credit card account: plan
==================================================================================================

> **Status: built (2026-10-13).** All five slices are done, with unit, API and browser tests.
> There's no separate spec: the milestone's one line in [the plan](../../PLAN.md), M1's notes on
> matching, and the user's answers below are the brief.

## What M2 is

A credit card needs nothing a bank account doesn't, so M2 drops the idea of account kinds
altogether. The real work is the other half of the milestone's line: **two accounts that reflect
two sides of the same transaction.** Paying the card from checking shows up in both CSVs. Once
the checking import's payment is categorized to the card, the card's import has to recognize it
rather than add it again. The same goes for a coffee entered by hand that later arrives in a
CSV. So matching has to **act** for the first time, and every match goes through review.

M2 is four things:
1. **Starred accounts replace "money accounts."** Any account can be starred; starred accounts
   are the home page. Accounts are created however the user likes, with an optional opening
   balance.
2. **Display signs:** liabilities and income show inverted, so a card shows what's owed and
   income shows as positive.
3. **Matches that act:** an imported row that's the same event as a transaction already in the
   account claims it, instead of becoming a new transaction.
4. **Reviewing matches:** every match is proposed, never final, until it's confirmed in review,
   where it can be moved to another candidate, swapped with another row's, or undone.

## Decided (2026-10-12)

- **No account kinds** (`money: "bank"`, a credit-card kind, default `Assets:Bank:` or
  `Liabilities:CreditCard:` parents). The user creates any account they like by its full name.
  Creating a card as an asset, or even an expense, is theirs to make. Wording that adapts to the
  account's type is Polish.
- **Starred accounts are what the home page shows,** replacing "money accounts". Stars are per
  user, kept in `app`.
- **An opening balance is just a number from a statement,** with its date, for any account.
- **Any open leaf account can be imported into,** starred ones listed first.
- **Display signs are inverted for liabilities and income.** Colors follow the stored sign (the
  effect on net worth).
- **Matching is only against transactions already in the imported account.** No guessing at
  transfers across accounts: that would match far too much. A transfer is recognized because the
  first import's side was categorized to this account (e.g. checking's "PAYMENT TO CHASE"
  categorized to the Chase card); it's then simply a transaction in the card's account.
- **Manually entered transactions are matched too.** Importing is effectively reconciliation: a
  coffee entered by hand every day should be matched by the CSV, and nothing added.
- **Every candidate is linked to the row, the best one the default.** There's no "clear winner"
  rule.
- **No match is final until it's confirmed in review.**
- **A transaction is consumed by one row.** If it's a candidate for several rows, only one can
  have it; the others can **swap** with that row in one operation.
- **Known miss, accepted for now:** two $5 coffees entered on the 5th and 7th, arriving in the
  CSV on the 7th and 8th. Proximity matches the 7th's row to the 7th's entry, leaving the 8th's
  row the 5th's entry; in truth they're paired in order. Swapping fixes it in review. A better
  algorithm (order-aware assignment over the whole network of candidates) is a
  [Polish](../../PLAN.md#polish) to-do.
- **The milestone keeps its name.**

## Approach

- **Same as M1: vertical slices,** each ending with `pnpm test` and `pnpm e2e` green, the docs,
  `docs/PLAN.md` and `RESUME.md` updated.
- **Matching stays a resolver** in the existing chain, so M4's categorizers slot in after it
  unchanged. Assigning candidates to rows (consumption) is a step after the chain.

## Decisions this plan makes

### Starred accounts

- **Stars are per user, kept in `app`'s database** (user, book, account). They're a preference,
  not bookkeeping: once books are shared (M13), your home page and Jess's can differ, and exports
  stay free of them. Renaming accounts (the chart of accounts) will have to carry stars along, as
  it will CSV profiles.
- **Star and unstar** from an account's ledger (a star in its header). Accounts created from the
  home page's "Add account" (and setup) are starred.
- **The home page** shows starred accounts as cards: name, balance, last import.
- **An account's display name:** its last segment with dashes as spaces (`PNC-Shared-Checking`
  → "PNC Shared Checking"). `display-name` metadata stays honored if present; there's no field
  for it.
- **Adding an account:** its full name (the shared `NewAccountField`, with autofill), then an
  optional **opening balance and its date**, recorded as the opening-balance transaction as now.
- **The import cutoff** is the account's opening balance's date, as now. An account without one
  has no cutoff.

### Display signs

- **Liabilities and income are shown inverted** wherever amounts are read rather than edited:
  home cards, account ledgers (amounts and running balances), the profile editor's preview, and
  later reports. A card shows what's owed as positive, with charges increasing it.
- **The transaction editor and review cards show stored signs,** since splits sum to zero.
- **Colors follow the stored sign:** a card charge shows as `$50.00` more owed, in red; a
  payment as `−$500.00` owed, in green.

### Matching (on import)

- **Candidates for a row:** transactions in the imported account, with the same amount, within
  ±5 days, that **no row of this account's imports has claimed** (as a staged transaction or a
  match). Scored by closeness in days, as in M1.
  - So a staged transaction from an earlier import of this account never matches (two coffees
    in two files stay two coffees).
  - A transaction claimed by another account's import is fair game: checking's staged payment,
    categorized to the card, is matched by the card's row.
- **Assignment (consumption):** across the batch, the best-scoring (row, candidate) pairs are
  taken first; each transaction goes to at most one row. Ties break by row, then transaction ID.
- **A row that gets a candidate is `matched`:** no new transaction; it claims the existing one.
  The transaction's postings and flag don't change.
- **A row that gets none is `staged`,** as in M1. If it had candidates (all taken by other rows),
  they stay linked, so review can swap.
- **Every candidate stays linked to its row,** best first. A row with candidates has a match
  **proposed** until it's confirmed in review; a row without candidates has nothing to review on
  the matching side.
- **Where it lives:** `app`'s import rows: the row's current transaction (new or matched), its
  outcome, its candidates, and whether its match is confirmed. The ledger isn't marked: a match
  changes nothing in the books, since the transaction was already there.
- **Matched rows count as already imported,** like staged ones, so re-importing a file changes
  nothing.

### Reviewing matches

- **The review queue** holds pending transactions (as now) and transactions with a proposed match.
  A card with a proposed match shows the row ("Matches <file row>: <date> · <description> ·
  <amount>") and its candidates.
- **One operation, `assign`,** sets a row's transaction, and covers every change:
  - **to another free candidate:** "Match with this instead"
  - **to a candidate another row holds:** "Swap with <that row>": the two rows exchange
    transactions, in one operation
  - **to a new transaction:** "Not a match": the row is staged as its own pending transaction
  - When a row moves off a transaction staged from it, that transaction is deleted; when a row
    becomes new, one is staged from its date, amount and description. The ledger changes are one
    atomic write; then `app` records the assignment.
- **Confirming** the card confirms the transaction (if pending) and the match. A confirmed
  match leaves the queue, and its row's transaction is final.

### Demo data

- **The demo stars its checking account and its credit card** (`bean-example` already generates
  a Chase card paid from checking).

## How it gets built

Five slices, in order, each committed on its own.

### 1. Starred accounts (replacing money accounts)

- **Ledger:**
  - `POST /accounts` takes an optional **opening balance** `{amount, currency, date}`. The account
    opens on that date (unless `open` says otherwise), and the opening-balance transaction is
    written in the same write.
  - **`GET /accounts/summary?account=…`** returns, for the accounts asked for, each one's
    account fields, balance (from SQL) and `as_of` (its opening balance's date, or null).
  - **Removed:** `/money-accounts`, `MoneyAccount`, `MoneyAccountIn`, and `money`/`institution`
    on `Account`.
- **App:** migration 3, a **`star`** table; `GET /books/:book/stars`, `PUT`/`DELETE
  /books/:book/stars/:account`; the importer's cutoff from the summary, into any open leaf.
- **PWA:** home from stars; add account (setup and home) by full name with an optional opening
  balance, starred; a star toggle and "Import transactions" on every leaf's ledger; the import
  drop-down (open leaves, starred first); one display-name helper.
- **Seed:** stars the demo's checking account and card.

### 2. Display signs

- A shared helper (inverted for liabilities and income), applied to home cards, account ledgers
  and the profile preview.

### 3. Matching and assignment

- **The context** adds which of the account's transactions are already claimed by its imports
  (from `app`'s rows).
- **The matcher** excludes claimed transactions; **assignment** runs after the chain.
- **Rows** gain the proposed/confirmed state, and `matched` joins the outcomes; duplicates
  count matched rows.
- **Import results** list matched rows ("matched with <payee> · <date>").

### 4. The `assign` operation

- **Ledger:** **`POST /transactions/changes`**: `{create, update, delete}`, with versions on
  updates and deletes, applied in one write or not at all (409 on a stale version).
- **App:** `POST /books/:book/imports/:batch/rows/:line/assign` `{transaction}` (an ID, or null
  for a new transaction): move, swap or undo, as above; and `.../confirm`.
- **App:** `GET /books/:book/matches`: rows with a proposed match, with each candidate's holder
  (if another row holds it).

### 5. Reviewing matches

- **The review queue** merges pending transactions with proposed matches; a matched card shows
  the row and its candidates, with "Match with this instead", "Swap with …" and "Not a match".
- **Confirming** (button or swipe) confirms the transaction if pending, and the match.

### Tests

- **Unit:** opening balances on create, the summary, stars, display signs, the matcher's
  exclusions, assignment (including the coffee example), `assign`'s ledger changes, and the
  `changes` endpoint's atomicity.
- **API (e2e):** importing into a non-starred leaf; a transfer categorized from checking, then
  matched by the card's import; re-importing changes nothing; assign (move, swap, undo).
- **Browser:** setup and add account by full name; star and unstar; a card's ledger shows
  what's owed; the coffee example: both rows matched, swapped in review, confirmed.

## Out of scope for M2

- **Statements, due dates, credit limits and reconciling against a statement:** M14.
- **Categorizing the merchant side of charges:** M4. Charges land uncategorized, as in M1.
- **Scheduled card payments:** M3.
- **Order-aware assignment** (the coffee miss above): Polish.
- **Matching by description or fuzzy amounts** (fees, currency conversion): later, if needed.
- **Type-aware wording** when creating accounts: Polish.

## Questions

None open.
