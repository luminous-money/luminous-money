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

## Work, in order

1. **Starred accounts:**
   - stars in `app` (migration, API), the accounts summary in the ledger
   - the home page from stars; star/unstar in the ledger header
   - adding an account by full name with an optional opening balance (setup and home)
   - the import drop-down (starred first), the cutoff without kinds, and retiring `money`
2. **Display signs:** the shared helper, home cards, account ledgers, the profile preview.
3. **Matching context:** the uncategorized legs of other accounts' transactions, and the
   transfer candidate rule.
4. **Acting on matches:**
   - the ledger batch with updates
   - merging transfers, claiming same-account events, and the `matched` outcome in results
   - clear winners and stored alternatives
5. **Reviewing matches:** the review card's matched line, switching to an alternative, and "Not
   a match".
6. **Wrap-up:** demo data, a browser test importing a checking file and a card file that share
   a payment (both orders), and the docs.

## Out of scope for M2

- **Statements, due dates, credit limits and reconciling against a statement:** M13.
- **Categorizing the merchant side of charges:** M4. Charges land uncategorized, as in M1.
- **Scheduled card payments:** M3.
- **Matching by description or fuzzy amounts** (fees, currency conversion): later, if needed.
- **Type-aware wording** when creating accounts: Polish.

## Questions

None blocking. The two **Proposed** calls worth a glance: stars per user in `app` (rather than
in the book), and importing into any leaf account with starred ones listed first.
