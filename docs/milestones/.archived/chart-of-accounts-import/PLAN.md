Chart of accounts import: plan
==================================================================================================

> **Status: built (2026-10-26).** Slipped in before M17. The brief, from Kael: under Accounts,
> upload a chart of accounts: a CSV with the fully qualified account and any of the optional
> fields we support for creating accounts (an opening balance with its as-of date, a
> description, and so on), every name run through our standard normalization, so names are
> title-cased and spaces become dashes.

## What it is

**Accounts → Import** (`/books/:book/accounts/import`): choose a CSV, see what it would do, then
**Add N accounts**. Nothing is written until then, and then everything is written at once.

### The file

A header row, then one account a row. Headers are matched loosely (case, spaces, dashes and
underscores ignored), in any order:

| Column | Also read as | What it is |
| --- | --- | --- |
| **Account** (required) | Full name, Full_name, Name | The full name: `Expenses:Dining Out`. |
| Display name | | On cards and in lists. |
| Description | Notes | What the account is for (new on accounts: below). |
| Opening balance | Balance | Its balance on the as-of date, as a statement shows it (a card's: what's owed). |
| As of | Balance as of, Balance date, Date | The opening balance's date (needed with one). |
| Currency | Commodity | The balance's currency; default: the book's. |
| Opened | Open date, Opens | When it opens; default: as adding one by hand. |
| Booking | | How sales pick lots: FIFO, LIFO, HIFO, STRICT or NONE. |
| Revalue every | | A revalued asset (a house, a car): days its value stays current. |

A file with no recognizable header whose first cell is a full name (`Assets:…`) is read as names
alone, one a row. Other columns are ignored, and the preview names them. Holdings and payment
cards aren't columns: add them in the account's editor.

### Names

Every name goes through the one normalizer the app uses for a typed account name's parts
(`toSegment`), which now **title-cases**: each word starts with a capital (the rest is kept, so
`PNC` and `401k` stay), small joining words in the middle stay lowercase, and spaces (and
underscores) become dashes: `expenses:dining out` is `Expenses:Dining-Out`, `assets:bank:PNC
checking` is `Assets:Bank:PNC-Checking` (a lowercase `pnc` would be `Pnc`), `expenses:gifts and giving` is
`Expenses:Gifts-and-Giving`. The root is matched to the book's top-level accounts ignoring
case, and singulars count (`Expense:…`). The preview shows each name as it will be, and what it
was if that's different.

### What each row becomes

- **A new account,** a leaf unless another row (or an account already in the book) goes under
  it: then a node. Levels in between that no row names are opened as nodes on the way, as when
  adding one by hand.
- **Already here:** a name the book has is left as it is (its settings are the editor's).
- **Can't be added,** with why: a part that can't make a name, an unknown root, a name listed
  twice, an account under a leaf or an archived account, a balance on a node or without its date,
  an amount, date, currency, booking or period that doesn't read.

The rows that can be added are added (the others are listed, not fatal), in one atomic write:
the ledger's new `POST /books/{book}/accounts/batch` opens them in order (nodes and plain
accounts first, then those with balances, so a file that names `Equity:Opening-Balances` works),
checking each against what's before it, and writes all or none. Imported accounts aren't starred
(a chart can hold hundreds).

### Accounts get a description

`description` metadata on the account's `open` (one line, at most 500 characters), set when it's
created (the batch, and the ledger's `POST /accounts`) or in the editor's Name card, beside the
display name, and shown under the name at the editor's top. A divided account keeps it on the
whole. The ledger's `AccountIn` also takes `display_name` now, so a new account is one write.

## Tests

- **ledger:** the batch (order, nodes, opening balances, all-or-none with the failing account
  named), descriptions and display names on create and patch, kept by dividing.
- **app (unit):** `toSegment`'s title case; the planner (headers, names, kinds, existing,
  problems, signs, dates, defaults).
- **browser:** Accounts → Import a file with lowercase, spaced names, a node, a balance and a
  bad row; the preview, Add, then the chart and the account's editor (its description) and
  balance.
