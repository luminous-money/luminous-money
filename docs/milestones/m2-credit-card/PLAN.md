M2: Credit card account: plan
==================================================================================================

> **Status: planned (2026-10-12), not started.** There's no separate spec: the milestone's one
> line in [the plan](../../PLAN.md) and M1's notes on matching are the brief. Everything marked
> **Proposed** is open to change; the [questions](#questions) are where input is wanted.

## Why M2 is still needed

The credit card itself is small, since M1 built nearly everything a money account needs. The
real work is the other half of the milestone's line: **two accounts that reflect two sides of
the same transaction.** Paying the card from checking shows up in both banks' CSVs. Today each
import stages its own transaction against an uncategorized account, so every card payment (and
every transfer between your own accounts) is counted twice. Fixing that means matching has to
**act** for the first time, which M1 deliberately left out.

So M2 is three things:
1. **Credit cards as money accounts:** a liability, with its signs shown the way people think of
   a card.
2. **Matches that act:** an imported row that's the other side of an existing transaction joins
   it instead of becoming a new one.
3. **Reviewing matches:** the review queue shows what was matched, the alternatives, and a way
   to undo it.

## Approach

- **Same as M1: vertical slices,** each ending with `pnpm test` and `pnpm e2e` green, the docs,
  `docs/PLAN.md` and `RESUME.md` updated.
- **Generalize rather than special-case.** A credit card is a money account with a kind. A card
  payment is a transfer between two money accounts. Transfers between two bank accounts
  (checking to savings) get the same treatment for free, and are tested too.
- **Matching stays a resolver** in the existing chain, so M4's categorizers slot in after it
  unchanged. M2 makes its resolutions final when it's sure.

## Decisions this plan makes

### Credit cards

- **A money account kind:** `money: "credit-card"`, alongside `"bank"`. **Proposed:** its
  default path is `Liabilities:CreditCard:<Name>`, editable like a bank account's.
- **The add-account form asks which kind** (Bank account / Credit card) first. The kind sets the
  default path and how the balance is asked for.
- **Signs, the way people think of a card** (**Proposed**):
  - The form asks for **the amount owed**, a positive number. It's stored as Beancount needs:
    negative on a liability.
  - **The home card and the ledger show what's owed as positive,** labeled "owed". In the
    ledger, charges show as increases and payments as decreases. Only the display flips; the
    stored amounts don't.
  - The same flip applies to any liability money account later (loans, M5).
- **CSV signs:** card issuers disagree on whether a charge is positive or negative. The profile
  already has a "negate amounts" switch. **Proposed:** for a card, the guess turns it on when
  most amounts in the file are positive (charges outnumber payments), and the profile editor's
  preview says "charges should increase what's owed" instead of "money out negative".

### Matches that act

- **What can match an incoming row** (**Proposed**), within ±5 days, same amount:
  - **The other side of a transfer:** a transaction in another money account whose
    *uncategorized* leg has exactly this row's change. Example: checking's staged
    "PAYMENT TO CHASE" has `Expenses:Uncategorized +500.00`; the card's "PAYMENT THANK YOU" row
    changes the card by `+500.00`. They're the same event.
  - **The same event already in this account,** as M1 matches today: an existing transaction
    with the same amount that no import has claimed yet (typically one entered by hand).
- **The context grows to cover that:** the account's own transactions (as now), plus the book's
  transactions in the window that have an uncategorized leg. One more ledger query by account
  and date range, which the transaction list already supports.
- **Acting on a match** (from M1's notes: the strongest candidate wins, ties broken arbitrarily,
  and a matched row falls out of the import):
  - **A transfer** merges: the uncategorized leg is replaced by this account, so the existing
    transaction becomes `Checking -500 / Card +500`. No new transaction is created.
  - **The same event** claims the existing transaction: it gets the row's `import-id`, so later
    imports see the row as a duplicate. Nothing else changes.
  - **Either way, the row's outcome is `matched`,** shown in the import results with what it
    matched.
- **Atomic:** **Proposed:** the ledger's batch endpoint takes updates (versioned) alongside
  creates, so an import's new transactions and its merges are one write.
- **Clear winners and alternatives** (**Proposed**, from M1's notes):
  - With one candidate, or a top candidate clearly ahead (at least 2 days closer than the
    next), the match is made and no options are shown.
  - Otherwise the strongest still wins, but the others are kept on the transaction as
    alternatives, and it stays pending so it shows up in review.
  - Alternatives are cleared when the transaction is confirmed.
- **Undoing a match:** the merged transaction remembers the row it absorbed (date, amount,
  description, fingerprint) in metadata. "Not a match" splits it back: the leg returns to
  uncategorized, and the row becomes its own staged transaction.

### Reviewing matches

- **A matched transaction's review card** says "Matched with <account> · <date>". Each
  alternative is offered as "Match with this instead", next to "Not a match".
- **Confirming** works as today, and clears the alternatives.

### Demo data

- **The demo book gains a credit card** with monthly payments from checking, and the e2e tests
  import both sides in either order.

## Work, in order

1. **Credit card accounts:**
   - the `credit-card` kind, its default path, and the owed-amount opening balance
   - the add-account form's kind choice
   - the display flip on home cards and in the ledger
2. **Card CSVs:** the negate guess for cards, and the editor's wording.
3. **Matching context:** the uncategorized legs of other money accounts' transactions, and the
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

## Questions

1. **Rename M2 "Credit cards and transfers"?** That's what it mostly is.
2. **Signs:** show a card's balance as a positive "owed" amount (proposed), or as Beancount
   stores it (negative)?
3. **Clear winners:** is "only candidate, or 2+ days closer than the next" the right line for
   matching without asking? Or should every merge wait in review until confirmed?
4. **Merged transfers' flag:** a transfer merged into a confirmed transaction stays confirmed;
   one merged into a pending one stays pending. Or should a merge always need review?
