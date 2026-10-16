M10: Chart of accounts: plan
==================================================================================================

> **Status: built (2026-10-16),** with ledger, unit, API and browser tests, following
> [the answers](#answers-2026-10-16), which override anything below that disagrees. Timing on a
> five-year demo book: the tree in 46 ms, renaming an 882-split branch in 97 ms. One change: a
> leaf's row opens its ledger, and an editor is one tap away from there ("Edit"); a node's name
> opens its editor.
> The brief is the milestone's line in [the plan](../../PLAN.md):
> - **the account tree,** with collapsible nodes and aggregate balances
> - **add** accounts
> - **open one to edit it,** including archiving it
> - **delete** accounts, which needs a substitute to move their transactions to

The plan's older notes add moving accounts between parents and renaming. Renames and moves
rewrite every directive that mentions the account, history included; that was decided as
acceptable.

## Answers (2026-10-16)

1. **Archiving with money left in it** is allowed, with an optional closing transfer.
2. **Deleting a node** offers two ways: move every split in its subtree to one replacement
   account (an existing one, or a new one made there), or cancel and delete the accounts under
   it one by one.
3. **Substitutes can be any account type,** with a warning when the type differs.
4. **Renaming onto an existing account is refused,** with "Merge into…" offered instead.
5. **System accounts are protected.**
6. **Node balances are one figure** in the operating currency, holdings at market value.

## What M10 is

A **Chart of accounts** page per book:
- every account in a tree, by type, with balances rolled up through nodes
- **Add** an account
- each account **opens to an editor** where you can:
  - **rename** it or **move** it (one operation: its full name changes)
  - set its **display name**
  - change its settings (M5's sale method and revaluing)
  - **archive** or unarchive it
  - **delete** it, moving its transactions to a substitute

## What exists today

- **Accounts in the ledger:**
  - leaves (they hold transactions) and nodes (they hold accounts)
  - implicit nodes (never opened; there because accounts exist under them)
  - `open` and `close` directives, `display-name` metadata, a currency constraint
  - `PATCH /accounts/{a}` changes settings (sale method, revaluing) against the open directive's
    version
- **Balances:** `accounts/summary` covers a list of accounts, a node's being its subtree's, with
  value and gain for holdings. **There's nothing for the whole tree at once.**
- **Creating:** an account is created by its full name from any picker or Add an account, and
  nodes on the way are made too.
- **The account page:** the ledger, a star, Import, and Account settings (sale method,
  revaluing).
- **What `app` keeps by account name:**
  - stars, CSV profiles, import batches (their account is how duplicates are found)
  - schedules (templates' postings)
  - category rules (their conditions and postings), proposals
  - SimpleFIN links and link attempts
- **Names the code relies on:** `Expenses:Uncategorized`, `Income:Uncategorized`,
  `Equity:Opening-Balances`, `Income:Unrealized-Gains`, `Income:Capital-Gains:Short-Term` and
  `…:Long-Term`, and `Expenses:Financial:Fees`, plus a brokerage's `:Cash` and `:<COMMODITY>`
  children.

## Decisions this plan makes

### The page

- **Accounts** in the menu: `/books/:book/accounts`. The home page stays the starred accounts.
- **Five sections:** Assets, Liabilities, Equity, Income, Expenses. Each is a tree whose nodes
  collapse and expand.
  - Collapsed state is remembered per device.
  - **Proposed:** top levels open, deeper nodes closed.
- **Each row shows** the display name (the full name on hover or long-press), its balance, a star
  if it's starred, and badges:
  - **linked** (a bank feed)
  - **archived**
  - **system** (see [Protected accounts](#protected-accounts))
- **Balances as everywhere:** liabilities and income shown inverted. A node's is its whole
  subtree's.
  - **Proposed:** in the operating currency, holdings at their latest prices (a brokerage node
    shows its value), with other currencies listed after.
  - Pending transactions count, as in ledgers.
- **Tapping a leaf** opens its ledger, as from home. **A node** toggles open; its name opens its
  editor.
- **Find:** a filter box narrows the tree to matching accounts and the nodes above them.
- **Archived accounts** are hidden behind "Show archived".
- **"Add an account"** opens the existing form, starting under whichever node you came from.

### One request for the whole tree

- **New `GET /books/{b}/accounts/tree`:** every account (opened, implicit and closed), each with
  its own balance and its subtree's, in one read.
  - **Plain SQL:** one `GROUP BY account, currency` over postings, rolled up through the tree in
    Python, and values from the latest prices (the `price` table, one hop, as M5 does).
  - **No full Beancount load:** amounts only booking could say (a sale's elided cash) are
    already filled in by the derived columns, as the ledgers use.
- **The account page and the editor keep using `summary`** for one account (gain, staleness,
  lots).

### Editing an account

The account page gets an **Edit** button (and the chart's node names lead there too).

- **Full name:** rename or move, with the same field as creating (autofill through nodes, the
  checks as you type).
  - Changing the root (Assets to Expenses) isn't allowed: it would change the account's type
    and every balance's meaning.
- **Display name:** free text; empty means the name's last part.
- **Settings:** sale method and revaluing (M5), as now.
- **Archive / Unarchive.**
- **Delete…**
- **Each edit is versioned** against the open directive's `updated_at`, as settings are.

### Renaming and moving

- **The ledger rewrites, in one atomic write, every directive that names the account or any
  account under it:**
  - postings, `open` and `close`
  - `balance`, `pad`, `note`, `document`
  - `custom` directives' account arguments
  - Implicit nodes follow by themselves.
- **One endpoint:** `POST /books/{b}/accounts/{a}/rename {to, updated_at}`.
  - Refused if `to` exists, unless it's an archived account (see [question
    4](#questions)), or if it would put a leaf under a leaf.
- **`app` follows in the same request:** its route renames in the ledger, then rewrites its own
  references in one transaction:
  - stars, CSV profiles, import batches
  - schedules' templates, rules' conditions and postings
  - SimpleFIN links and attempts
  - proposals' postings

  It's the same shape as book deletion (M6): the ledger first, then `app`.
- **Backups** carry the rewritten directives as ordinary changes.
- **Big books:** a rename touching tens of thousands of transactions is one write. The
  decades-scale benchmark gets a rename case to make sure it's seconds, not minutes.

### Archiving

- **Archive** is Beancount's `close` directive, dated today by default (or a date you choose, no
  earlier than the account's last transaction).
  - An archived account drops out of pickers, home, imports and review's choices.
  - It keeps its history, and stays in reports and the chart (under "Show archived").
- **Unarchive** removes the `close`.
- **A node** archives with everything under it.
- **Proposed: a balance left in it is allowed, with a warning** ("$12.40 is still in it"), and
  the archive can carry a closing transfer to another account to zero it first
  ([question 1](#questions)).
- **Archiving a bank-linked account** unlinks it, after confirming.
- **Stars** on an archived account are kept but not shown.

### Deleting

- **Deleting needs a substitute when the account has any transactions.** Every posting moves to
  the substitute, so nothing anywhere loses a split and every balance elsewhere stays the same.
  - An account with no transactions deletes outright.
  - **The substitute** must be an open leaf of the same type.
    - **Proposed:** same root (an expense into an expense, an asset into an asset), since a
      cross-type move changes what those amounts mean ([question 3](#questions)).
  - **The confirmation** names how many transactions move.
- **A node** deletes with its subtree: every account under it moves into the one substitute
  ([question 2](#questions)).
- **The ledger:** `DELETE /books/{b}/accounts/{a}?substitute=…&updated_at=…`.
  - In one write, it rewrites the postings, then removes the account's `open` and `close`.
  - Balance assertions and `pad`s on the deleted account go: they described an account that's
    gone.
- **`app` follows:**
  - its references move to the substitute: import batches (so duplicates are still caught),
    CSV profiles (if the substitute has none), schedules, rules
  - stars on the deleted account go
  - a bank link goes, after confirming
- **Merging is the same thing.** "Move everything into another account" is a delete with that
  substitute. The editor names it **Merge into…** next to Delete.

### Protected accounts

- **Proposed: system accounts can't be renamed, moved or deleted** ([question 5](#questions)).
  The code relies on their names:
  - `Expenses:Uncategorized`, `Income:Uncategorized`, `Equity:Opening-Balances`
  - `Income:Unrealized-Gains`, the two capital-gains accounts, `Expenses:Financial:Fees`

  They can still be archived, and they get a display name like any other. The chart marks them
  "system".
- **Brokerage children follow their brokerage.** `:Cash` and the `:<COMMODITY>` holdings can't
  be renamed apart from it; renaming the brokerage renames them.
- **Top-level accounts** (Assets, Liabilities, Equity, Income, Expenses) are fixed, as decided
  in M1.

### Adding

- **"Add an account"** on the chart, and "Add under …" on any node, open the existing form,
  prefilled with that node's name and a colon.
- **Nothing new in creating itself.** M1's rules and M5's options (opening balance, holdings,
  revaluing) stay as they are.

## How it gets built

1. **Ledger:**
   - the tree endpoint (SQL roll-up, values from latest prices)
   - rename, with the directive rewrite for every kind and the atomic write
   - archive and unarchive
   - delete with a substitute (and merge)
   - display name in `PATCH`
   - protected names
   - tests, and the benchmark's rename case
2. **`app`:**
   - routes for rename, archive and delete, ledger first, then its references in one
     transaction
   - unlinking bank feeds where needed
3. **PWA:**
   - the Chart of accounts page: tree, collapse, roll-up balances, filter, show archived, add
     under a node
   - the account editor: name, display name, settings, archive, delete or merge, with
     confirmations that count
   - the menu item
4. **Tests:**
   - **ledger:** the rewrite for every directive kind; rename, archive and delete, all-or-nothing
   - **app:** references follow
   - **API e2e:** a rename carries stars, profiles, rules, schedules and links; a delete moves
     transactions and keeps other accounts' balances
   - **browser:** the tree and its balances, collapsing, filtering, rename, archive, delete
     with a substitute
5. **Docs:** design.md ("Chart of accounts"), PLAN.md, RESUME.md.

## Out of scope

- Reordering accounts by hand (the tree is alphabetical by full name).
- Account notes and per-account attachments.
- Changing an account's type (its root).
- Budgets on accounts (M11) and reports (M12), though the tree endpoint is meant to serve
  both.

## Questions

1. **Archiving with money left in it:**
   - allow with a warning, plus an optional closing transfer (proposed)?
   - or require a zero balance first?
2. **Deleting a node:**
   - its whole subtree into one substitute (proposed)?
   - or only empty nodes, so you move or delete what's under it first?
3. **Substitutes across types:**
   - same root only (proposed)?
   - or any open leaf, for "this expense was really a transfer to savings"?
4. **Renaming onto an existing account:**
   - refuse, and offer "Merge into…" instead (proposed)?
   - or treat the rename as a merge?
5. **System accounts:** protected from renaming and deleting (proposed), or renamable, with
   their roles kept in book settings ("this book's uncategorized expenses go to …")?
6. **Node balances:** one figure in the operating currency, holdings at market value
   (proposed), or every currency held, listed?
