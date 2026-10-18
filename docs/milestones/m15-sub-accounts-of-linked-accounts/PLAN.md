M15: Sub-accounts of linked accounts: plan
==================================================================================================

> **Status: built (2026-10-18),** with ledger, unit, API and browser tests, on the answers
> below. The brief, from [the plan](../../PLAN.md): split a
> bank-linked account's money into sub-accounts, e.g. the $10,000 in a PNC checking account as
> $5,000 of padding and $5,000 for general use, while the bank feed keeps it in step with the
> bank.

## Answers (2026-10-17)

1. **Home's headline:** the whole's balance, the parts beneath.
2. **Rules and parts:** parts are ordinary accounts, so a rule can already categorize into one
   (a Fidelity import's transfer, categorized as Padding). What a rule can't yet say is where
   the *bank's own side* of a transaction lands (always the main part): "Interest → Padding"
   needs that. Added, as a rule's optional **lands in** part.
3. **Targets for parts:** later.
4. **Start over** on a divided account keeps the moves between its parts.
5. **Undivide:** later.
6. **Splitting deposits by share:** later.
7. **Moves between parts** show in the whole's ledger, as "General → Padding".

## What M15 is

One real account, at the bank, held in the books as several: **PNC Checking** is $10,000 at
the bank and in the books, but the books know $5,000 of it is **Padding** and $5,000 is
**General**. The bank keeps the whole in step (its feed, its statements); you decide how the
whole is divided, and spend from, or move money between, the parts.

M14 laid the ground: a **divided account** is an asset or liability node that's one real account,
its sub-accounts (its **parts**) dividing what's in it. It already reconciles as one, transfers
between its parts reconcile themselves, and its parts can't be reconciled, linked to a bank, or
divided themselves. What's missing is everything that gets money into it and around it:

- **Where new money lands:** a bank feed or a file brings transactions for the whole account,
  not for a part. Each divided account has a **main part** they land in.
- **Getting there from today:** your PNC Checking is a leaf with years of history, linked to the
  bank. **Divide** turns it into a divided account without losing any of that.
- **Linking, importing and matching** treat the divided account as the account.
- **Seeing and moving the parts:** each part's balance, moving money between them, and choosing
  a transaction's part.

## What exists today

- **Divided accounts** (M14): `divided: TRUE` on a node's `open`; the editor's "Divided account"
  card turns it on for an asset or liability node; reconciling scopes to the whole; linking a
  part is refused, and so is dividing with a part already linked.
- **Bank links** (M9) go to a leaf (`simplefin_link.account`), or to a brokerage node whose cash
  lands in its `:Cash` child (`cashAccountOf`). Modes: new, reconcile, start over, from a date.
- **Imports** (M1/M2) go to an open leaf: duplicates by the batch's account, rows up to its
  opening balance's date skipped, the matcher's candidates from that account's ledger.
- **A node's ledger** already lists its subtree's transactions with the subtree's net change,
  so a transfer between parts nets to zero there.
- **Renaming** rewrites every directive naming the account; **deleting** moves postings to a
  substitute.

## Decisions this plan makes

### The main part

- **Every divided account has a main part:** where what the bank (or a file) brings in lands, and
  what's left once the other parts have theirs. Kept on the node's `open` as
  `main-part: "Assets:PNC:General"`, so an export carries it; renaming rewrites it, like any
  account name.
- **Set in the editor** (the Divided account card: "New money lands in"), defaulting to the
  first part. Linking or importing into a divided account needs one.
- **The main part can't be deleted** (choose another first), so there's always somewhere for the
  bank's transactions to go.

### Dividing an account you already have

**Divide…** on an asset or liability leaf (the Divided account card), in one ledger write
(`POST /books/{b}/accounts/{a}/divide`):

1. **You name the main part** (default "General") **and the others,** each with how much it
   starts with, as of a date (default today).
2. **The account becomes the divided account,** keeping its name: everything that was the
   account's (its transactions, their reconciliation marks, its opening balance) moves to the
   main part (`Assets:PNC` → `Assets:PNC:General`), and `Assets:PNC` is opened as a divided node
   with the main part set. Its display name stays with the whole; the part is named "General".
3. **Its statements stay with the whole:** they're the real account's, and the marks they
   count move with the postings, so its reconciliations hold as they were.
4. **Each other part is opened** (same currency) and given its amount by **one transfer** from
   the main part, dated as chosen: "Divided PNC Checking". A part that would leave the main part
   below zero is allowed, and flagged.

Because the account keeps its name, what `app` keeps by name mostly follows on its own: the
bank link, stars, CSV profiles, import batches (so duplicates are still caught), rules and
budgets stay on the whole, and so does a reconciliation in progress (the whole is what's
reconciled, before and after). **What can't stay on a node moves to the main part:** schedules'
templates, since a node can't take postings.

### Linking and importing a divided account

- **What comes in lands in the main part:** a bank link's cash account (`cashAccountOf`) is the
  main part for a divided account, as `:Cash` is for a brokerage; a CSV import into a divided
  account stages its rows in the main part.
- **The whole is the account** for everything else: the link and the batches belong to the divided
  account (duplicates by it), its main part's opening balance date is where imports start
  (`as_of`), and **the matcher looks across all its parts**: a bill you entered from Padding by
  hand is matched by the bank's row like any other.
- **Linking modes** (an existing divided account):
  - **reconcile** compares the whole with the bank's history; its opening balance adjustment
    goes to the main part.
  - **start over** deletes every transaction of the whole that came from outside it, and keeps
    the moves between its parts.
  - **from a date** and **new** (a new account is a leaf; divide it after) are as they are.
- **What's "Not at the bank"** is the whole's unconfirmed transactions no bank row holds, leaving
  out moves between parts.
- **Bank comparison and automatic reconciliation** (M14) already work on the whole: the link is
  the whole's.

### Seeing and moving the parts

- **The divided account's page** (its ledger, now reachable from the chart like a leaf's) has a
  **Parts** card: each part's balance, its share of the whole as a filled line, the main part
  marked ("new money lands here"), and **Move money**.
- **Move money:** from a part, to a part, how much, on a date (today): a confirmed transfer
  between them. From a part's own page it starts from that part.
- **A part below zero** says so on the Parts card ("General is $120 below zero"), with Move money
  ready to cover it from the part with the most.
- **Its ledger** lists every transaction of the whole, each with the part it touched ("General",
  "Padding"); a move between parts shows as "General → Padding", leaving the whole's running
  balance as it was.
- **A part's page** is an ordinary account ledger: its own transactions and running balance, and
  "Part of PNC Checking".
- **Home:** a starred divided account's card shows the whole's balance (the bank's figure), with
  the parts under it as a stacked line.
- **Choosing a transaction's part:** in review and on a transaction's page, a transaction in a
  divided account shows its part as a choice ("Paid from: General ▾"): moving it to another part
  is just changing that posting's account, so nothing else about it changes.

### Rules that choose a part

- **A rule's optional "lands in" part:** for a rule matching transactions imported into a
  divided account, the part their bank side goes to instead of the main part ("Interest, lands
  in Padding"). Its category still sets the other side, as now.
- **Applied when staged,** as categories are (the chain, M4), and by "Apply to existing" on
  unconfirmed ones; a rule's part must be one of the account's parts (the editor offers only
  those, once the rule names an account to match).
- **Categorizing into a part** (a transfer from another account straight into Padding) needs
  nothing new: a part is an account.

### The API

- **Ledger:**
  - `main_part` on `Account` and `AccountPatch` (a part of it; refused otherwise); deleting the
    main part refused.
  - `POST /books/{b}/accounts/{a}/divide` `{main, parts: [{name, amount}], date, updated_at}`:
    one write.
  - Renaming rewrites `main-part` values; the divided account's ledger rows say which part.
- **`app`:**
  - `cashAccountOf` and the import target look up a divided account's main part; the matcher's
    context reads the whole.
  - Rules gain `part` (`category_rule.part`, migration 17), applied by the chain when staging.
  - Dividing goes through `app` (`POST /books/:book/accounts/:account/divide`), so schedules
    follow, as renames do.
  - Not at the bank, start over, and the reconcile link mode work on the whole.

## How it gets built

1. **Ledger:** the main part (metadata, settings, renames, deletes), divide, the part on ledger
   rows; tests (divide a leaf with reconciled history, its statements holding; renames carry
   the main part).
2. **`app`:** cash account and import target for divided accounts, the matcher across parts,
   linking modes, not at the bank, divide with schedules following, rules' part; tests.
3. **PWA:** the Divided account card (divide, main part), the Parts card and Move money, part
   labels in ledgers, the part choice in review and the transaction page, rules' "lands in",
   home's card.
4. **Tests:** ledger and unit as above; API e2e (divide a bank-linked account, sync: the bank's
   transactions land in the main part, the whole still reconciles automatically); browser
   (divide PNC into General and Padding, move money, choose a transaction's part; a rule lands
   interest in Padding).
5. **Docs:** design.md ("Divided accounts", extending M14's), PLAN.md, RESUME.md.

## Out of scope

- **Undividing** (back to one account), **targets for parts** (a set amount, flagged or topped
  up), and **splitting deposits by share**: later (answers 3, 5, 6).
- **Brokerages:** their cash is already a part of the brokerage (`:Cash`); dividing that cash
  waits.
- **Parts across real accounts** (one "Emergency fund" spread over PNC and Fidelity): a part is
  in one account.
- **Budgets on parts** work as on any account (M11); nothing new for them here.

## Questions

None open: [answered](#answers-2026-10-17).
