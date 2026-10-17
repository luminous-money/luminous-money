M14: Reconciliation: plan
==================================================================================================

> **Status: planned (2026-10-17),** with [questions](#questions) at the end; proposals are marked
> where a question could change them. The brief, from [the plan](../../PLAN.md): reconciliation
> (added 2026-10-12, "as another milestone at the end").

## What reconciliation is

Agreeing an account with the bank's own record of it: "on September 30 the bank says this account
held $4,212.18, and these are the transactions that made it so." Once agreed, those transactions
are settled history: the next statement starts from that balance, and changing one of them
later is a visible break, not a silent drift.

Matching (M2) already agrees transactions one at a time as files come in; reconciliation agrees
the *balance*, which is what catches a missed, doubled or mistyped transaction that matching
can't see.

## What exists today

- **Matching** (M2): an imported row matches a transaction already in the books, or is staged
  as a new one; review confirms it.
- **Bank feeds** (M9): each linked account's reported balance and its date, a mirror of the
  bank's posted transactions, "Not at the bank" in review, and the bank as the source of truth
  when an account is first linked (reconcile mode).
- **CSV profiles** can read a balance column, but nothing uses it.
- **The ledger** stores `balance` directives (from imported books) and validates them with every
  load (`problems`), but nothing shows those problems.
- **Postings** can carry metadata and a flag (the API has both).

## Decisions this plan makes

### Kept in the books

- **A reconciliation** is an account, a statement date, the statement's ending balance, and the
  postings it covers. It's written as Beancount, so exports carry it and Beancount itself checks
  it from then on:
  - a **`balance` directive** dated the day after the statement (Beancount checks balances at
    the start of a day), with `statement: 2026-09-30` metadata
  - **`reconciled: 2026-09-30`** metadata on each posting it covers (on the posting, not the
    transaction: a transfer's two sides reconcile with two different statements)
- **The starting balance** is the last reconciliation's ending one, or zero before the first.
- **Undoing** the latest reconciliation removes its balance directive and its marks, in one write.

### Reconciling an account

From an account's page (an asset or liability), **Reconcile**:

1. **The statement:** its date and ending balance. Prefilled from the bank feed's reported balance
   and date when the account is linked, or from the last imported file's balance column; else
   blank.
2. **The transactions:** every unreconciled posting of the account dated up to the statement,
   oldest first, each to tick off as it appears on the statement. Those the bank sent (held by an
   import row) start ticked.
3. **The arithmetic,** always on screen: the starting balance, plus what's ticked, against the
   statement; the difference, and "Finish" once it's zero.
4. **Finishing** writes the reconciliation in one atomic write. A ticked transaction that was
   still unconfirmed is confirmed with it (the bank has it) ([question 6](#questions)).
5. **When it won't come to zero:** "Finish anyway" adds an adjustment transaction for the
   difference, to `Expenses:Reconciliation-Adjustments` (or Income for the other way)
   ([question 1](#questions)).

What's ticked so far is kept on the device until it's finished or cancelled
([question 7](#questions)).

### Afterwards

- **The ledger** marks reconciled transactions ✓, and the account's page says "Reconciled through
  September 30", with its history (each statement, its balance, how many transactions) and Undo
  for the latest.
- **Editing a reconciled transaction** warns first ("reconciled with September 30's statement:
  changing it breaks that"), but is allowed ([question 2](#questions)). If the change breaks the
  balance, the account says so (below).
- **Broken balances show:** the ledger's own validation of every balance assertion (from
  reconciliations, and from imported books) appears on the account's page: "Off by $12.40 since
  September 30's statement", with a link to the transactions around it.

### Bank-fed accounts: checked every day

- **In balance, or not:** a linked account's page (and Bank connections) compare the books'
  balance at the bank's balance date with what the bank reports: "Matches the bank ✓", or "Off by
  $12.40".
- **Where it went off:** the bank's day-end balances are backed out from its reported balance and
  the mirrored transactions; the first day the books' and the bank's differ is shown, with what's
  on only one side near it.
- **Reconciling to the bank:** one tap, prefilled with the reported balance and its date, and
  everything the bank sent ticked ([question 3](#questions): automatic instead?).

### Imported files with a balance column

- After importing, the results say whether the books agree with the file's last balance: "The
  file ends at $4,212.18 on October 3; the books say $4,199.78."

### The API

- **Ledger:**
  - `GET /books/{b}/accounts/{a}/reconciliation?through=`: what reconciling needs: the last
    reconciliation (date, balance), and the unreconciled postings up to the date
  - `POST /books/{b}/accounts/{a}/reconciliations`: `{statement_date, balance, postings,
    adjustment?}`, one atomic write; refused (422) if it doesn't come to the balance without an
    adjustment
  - `GET /books/{b}/accounts/{a}/reconciliations`: the history; `DELETE …/{statement_date}`: undo
    the latest
  - an account's balance on a date (`summary?on=`), and the book's balance problems by account
- **`app`:** the bank comparison (day-end balances from the mirror), the import's balance check,
  and the reconcile screen's prefill.

## How it gets built

1. **Ledger:** reconciliations (balance directive and posting marks), their history and undo,
   balance on a date, balance problems; tests.
2. **`app`:** the bank comparison and where it diverged; the import balance check; tests.
3. **PWA:** the Reconcile screen, the account page's status, history and problems, the ✓ in
   ledgers, the warning before editing a reconciled transaction.
4. **Tests:** ledger (reconcile, undo, a broken balance), API e2e (reconcile a CSV-fed account; a
   bank-fed one off by one transaction), browser (tick off a statement and finish).
5. **Docs:** design.md ("Reconciliation"), PLAN.md, RESUME.md.

## Out of scope

- Investment accounts' holdings (M9's position changes keep them in step); their cash reconciles
  like any account.
- Statements as documents (attaching the PDF).
- Reconciling several accounts at once.

## Questions

1. **When the difference won't come to zero:** allow "Finish anyway" with an adjustment
   transaction (proposed), or refuse until it balances?
2. **Reconciled transactions:** warn before editing one (proposed), or refuse edits until the
   reconciliation is undone?
3. **Bank-fed accounts:** reconcile to the bank by a tap (proposed), or automatically after each
   sync when everything the bank sent is confirmed and the balances agree?
4. **Which accounts:** assets and liabilities (proposed), or any account?
5. **Statements' cadence:** reconcile whenever you like (proposed), or nudge monthly ("October's
   statement isn't reconciled yet")?
6. **Ticking an unconfirmed transaction** confirms it when the reconciliation finishes (proposed),
   or should it have to be confirmed in review first?
7. **What's ticked so far** kept on the device until finished (proposed), or on the server, so
   reconciling can move between devices?
