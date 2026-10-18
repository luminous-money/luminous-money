M14: Reconciliation: plan
==================================================================================================

> **Status: built (2026-10-17),** with ledger, unit, API and browser tests, on the answers
> (including [the second round](#answers-to-the-questions-2026-10-17)). The
> brief, from [the plan](../../PLAN.md): reconciliation (added 2026-10-12, "as another milestone
> at the end").

## Answers (2026-10-17)

1. **A difference that won't come to zero:** Finish is refused until it balances; "Save for
   later" keeps the work.
2. **Reconciled transactions:** warn before editing one, and allow it.
3. **Bank-fed accounts reconcile automatically** after each sync, when everything the bank sent
   is confirmed and the balances agree.
4. **Which accounts:** assets and liabilities.
5. **Cadence:** whenever you like, no nudges.
6. **Ticking an unconfirmed transaction** confirms it when the reconciliation finishes.
7. **What's ticked so far** is kept on the server, so reconciling can move between devices.

### Answers to the questions (2026-10-17)

1. **Moving dates on Finish:** fine, so long as two banks dating a transfer differently, with
   statements that don't line up, is handled. It wasn't (one side's reconciliation could never
   finish, or a move could break the other's), and splitting such a transfer through an
   in-transit account was turned down. **So reconciliation now goes by marks, not dates:** a
   statement holds when the postings reconciled with it (and before) add up to its balance, as
   GnuCash and QuickBooks do it. Nothing's date moves; one not on the statement stays
   outstanding; each side of a transfer reconciles with its own bank's statement. The statement
   is a `custom "statement"` directive rather than a `balance` assertion (which checks by date).
2. **14 days after the statement:** fine.
3. **Automatic reconciliation's date:** the day before the bank's balance date, the safer one.

Also asked for:

- **Reconciliations are kept as Beancount,** so they're part of an export.
- **Imported transactions start ticked** (from a file or the bank), but nothing's reconciled until
  Finish.
- **"Reconcile includes sub-accounts":** an account setting. With it, the account and everything
  under it reconcile as one account; its sub-accounts can't be reconciled (or take the setting)
  themselves. Transfers between its sub-accounts aren't money moving, so they reconcile
  themselves. **Refined** (thinking of M15) into an account mode, a **divided account**: a node
  that's one real account (at a bank, say), the accounts under it dividing what's in it. It's
  reconciled and linked as one; its sub-accounts can't be reconciled, linked to a bank, or
  divided themselves.
- **A filter on every ledger,** its first option "Reconciliation: reconciled or not". Select
  all selects only what the filter shows.

## What reconciliation is

Agreeing an account with the bank's own record of it: "on September 30 the bank says this account
held $4,212.18, and these are the transactions that made it so." Once agreed, those transactions
are settled history: the next statement starts from that balance, and changing one of them
later is a visible break, not a silent drift.

Matching (M2) already agrees transactions one at a time as files come in; reconciliation agrees
the *balance*, which is what catches a missed, doubled or mistyped transaction that matching
can't see.

## Decisions

### Kept in the books

- **A reconciliation** is an account, a statement date, the statement's ending balance, and the
  postings it covers, written as Beancount (exports carry it):
  - **the statement:** `2026-09-30 custom "statement" Assets:Bank:Checking 4212.18 USD`
    (`source: "bank"` on an automatic one)
  - **`reconciled: 2026-09-30`** metadata on each posting it covers (on the posting, not the
    transaction: a transfer's two sides reconcile with two different statements).
- **It holds by marks, not dates:** the postings reconciled with a statement, and with those
  before it, add up to its balance. (A `balance` assertion would check everything *dated* up to
  it, which a transfer two banks date apart can't satisfy on both sides.) The ledger checks it;
  Beancount carries it without checking it. Balance assertions from imported books are still
  checked by date.
- **A divided account:** `divided: TRUE` on the node's `open` directive. Only an asset or
  liability node is divided, and not one with a divided account above or below it (an account
  is part of one real account at most), nor one with a bank link under it.
- **Marks belong to reconciliations.** Editing a transaction keeps its postings' marks (a posting
  keeps its mark while it stays in the same account); only reconciling and undoing change them.
  New transactions arrive unreconciled. (Text imports and restores keep what the text says.)
- **The starting balance** is what's reconciled so far: the sum of the scope's reconciled
  postings. Normally that's the last statement's balance; after an edit breaks one, the two
  differ, and the account says by how much.
- **Undoing** the latest reconciliation removes its statement and its marks, in one write.
  (What finishing confirmed stays.)

### Dates stay as they are

- The list shows the account's unreconciled transactions up to the statement date, and those of
  the **14 days after it** ("Dated after the statement"), any of which may have cleared in time
  (a check written on the 2nd your bank dated the 31st).
- **Nothing moves on Finish.** An unticked transaction dated before the statement stays
  outstanding for a later one (the Finish line says how many), and a ticked one dated after it
  keeps its date.

### Reconciling an account

**Reconcile** is on an asset or liability account's page: a leaf, or a divided account. A
sub-account of a divided account says "Part of PNC, a divided account", linking there.

1. **The statement:** its date and ending balance, as the account reads (a card's balance is
   what's owed). Prefilled from the bank feed's balance (a linked account) or the last imported
   file's last balance (a balance column), else blank.
2. **The transactions:** every unreconciled transaction in it, oldest first, each to tick off as
   it appears on the statement. **Imported ones start ticked** (from a file or the bank), and so
   does the opening balance (it came from a statement). Transfers within a divided account
   aren't listed: a line says how many reconcile themselves.
3. **The arithmetic,** pinned on screen: starting balance, plus what's ticked, against the
   statement; the difference.
4. **Finish** is enabled once the difference is zero: one atomic write. Ticked unconfirmed
   transactions are confirmed with it.
5. **Save for later** keeps the statement and what's ticked, on the server (one draft per
   account, shared by the book's members; versioned). Opening Reconcile again picks it up;
   **Discard** drops it.

### Afterwards

- **Ledgers** mark reconciled transactions ✓. The account's page says "Reconciled through
  September 30". The Reconcile page lists past statements (date, balance, how many transactions)
  with **Undo** on the latest.
- **Editing a reconciled transaction** says so up front ("Reconciled with Checking's September
  30 statement"), and saving a change to its splits asks "Save anyway?" (its date can change
  freely).
- **Broken statements show:** every statement on the account is compared with what's reconciled
  with it, and any balance assertion from an imported book with the books by date; one that
  doesn't hold shows on the account's page: "Off by $12.40 since September 30's statement".

### The filter

- A **filter button** (a funnel) beside "Go to date" on every ledger (an account's, and
  Transactions). Its first option is **Reconciliation: All · Reconciled · Not reconciled**; the
  button shows when one is on, and the choice is in the URL (`?reconciled=yes|no`), so Back keeps it.
- Filtering is the server's, so pages stay full and running balances stay true (they're the
  account's, not the filtered rows').
- In Transactions, a transaction is reconciled when its asset and liability postings all are,
  and not reconciled when any of them isn't (one with none is neither).
- **Select all** (Select mode, here and in review) selects what's shown: the filtered rows loaded
  so far. Transactions gains Select mode (Confirm) for it.

### Bank-fed accounts

- **Compared every day:** a linked account's page compares the bank's balance with the books' on
  the bank's balance date: "Matches the bank ✓", or "Off by $12.40 since September 12". Where it
  went off comes from the bank's day-end balances, backed out from its reported balance and the
  mirrored transactions (dated as imports date them), against the books' day by day.
- **Reconciled automatically** after each sync, through the day before the bank's balance date,
  to the bank's day-end balance then, when: the account is linked itself (not a brokerage), every unreconciled transaction through
  that day is confirmed, none of its imported rows has a match waiting in review, no draft is in
  progress, and the books agree with the bank. Otherwise it waits for the next sync.

### Imported files with a balance column

- The results say whether the books agree with the file's last balance: "The file ends at
  $4,212.18 on October 3: the books agree" (or "say $4,199.78"). The batch keeps that last balance
  and date, for Reconcile's prefill.

### The API

- **Ledger:**
  - `PATCH /books/{b}/accounts/{a}` takes `divided`; `Account` says it.
  - `GET /books/{b}/accounts/{a}/reconciliation?through=`: what reconciling needs (scope,
    currency, the reconciled balance, the last statement, the unreconciled transactions to 14
    days past `through`).
  - `POST /books/{b}/accounts/{a}/reconciliations` `{statement_date, balance, transactions}`: one
    atomic write; 422 unless it balances.
  - `GET /books/{b}/accounts/{a}/reconciliations` (history, and broken balance checks), and
    `DELETE …/reconciliations/{statement_date}` (the latest).
  - `GET /books/{b}/accounts/{a}/balances?from=&to=`: day-end balances, for the bank comparison
    and the import check.
  - `reconciled=true|false` on the account ledger and the journal; each row says whether it's
    reconciled.
- **`app`:** `POST /books/:book/accounts/:account/divided` (refused with a bank link under it;
  linking refuses a part of a divided account); `GET|PUT|DELETE /books/:book/reconcile/:account[/draft]` (the screen's view, with
  prefill, what starts ticked and the draft; saving and dropping the draft) and `POST
  /books/:book/reconcile/:account` (finish); the bank comparison in bank status; automatic
  reconciliation after syncs; the import balance check.

## How it gets built

1. **Ledger:** divided accounts, the posting column (migration 9), reconciling, history, undo,
   balance checks, day-end balances, the filters, marks kept through edits; tests.
2. **`app`:** drafts and batches' last balances (migration 16), the reconcile view and finish,
   the bank comparison, automatic reconciliation, the import balance check; tests.
3. **PWA:** the Reconcile page, the account page's status and Reconcile, ✓ in ledgers, the
   filter, Select all, "Divided account" in the editor, the warning before editing.
4. **Tests:** ledger (reconcile, refuse, outstanding, a transfer two banks date apart, undo, a
   divided account, marks kept, a broken statement, imported assertions, filters), API e2e (reconcile a CSV-fed account, a bank-fed one automatically),
   browser (tick off a statement, save for later, finish; the filter).
5. **Docs:** design.md ("Reconciliation"), PLAN.md, RESUME.md.

## Out of scope

- Investment accounts' holdings (M9's position changes keep them in step); their cash reconciles
  like any account.
- Statements as documents (attaching the PDF).
- Reconciling several accounts at once.

## Questions

None open: [answered](#answers-to-the-questions-2026-10-17).
