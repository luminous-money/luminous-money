M17: Transaction tagging: plan
==================================================================================================

> **Status: built (2026-10-29),** with ledger, unit, API and browser tests, as planned here. The
> brief, from [the plan](../../PLAN.md) (Kael, 2026-10-26): "Tag transactions with one or more
> tags. Remove tags. Per-transaction or via bulk actions. Filter reports by one or more tags
> (AND for now)." No question blocked it; the calls made without asking are under
> [Decisions to review](#decisions-to-review). Its reasons are in design.md ("Tags (M17)").

## What a tag is for

An account says **what** money was for (groceries, a flight); a tag says **why**, or **what it
was part of**: a trip (`#italy-2026`), a project (`#kitchen-remodel`), something to claim back
(`#reimbursable`) or to tell the accountant about (`#tax-deductible`). Tags cut across accounts:
a trip is flights, hotels, dining and fuel. M19's guidance example already leans on this:
"Accounts should always say WHAT, not WHY (tags say why, if anything)".

So the questions tags answer are "what did the trip cost, and on what?" and "which ones are
still to claim?", and the work is: put tags on transactions (one at a time, or many), take them
off, find what's tagged, and see reports of only that.

## Decisions

### Kept in the books, as Beancount's own tags

- **A tag is Beancount's `#tag`** on the transaction's line
  (`2026-04-03 * "Delta" "Flight to Rome" #italy-2026 #reimbursable`). Exports carry them, and a
  Beancount file brought in keeps its own (`pushtag`/`poptag` blocks included: Beancount applies
  them while parsing). The ledger's JSON already round-trips `tags` (`TransactionIn.tags`,
  `TransactionPatch.tags`); nothing has written them until now.
- **On transactions, not splits:** Beancount has no posting tags, and "part of the trip" is
  about the whole transaction. (A split that's the exception can be its own transaction.)
- **No registry:** a tag exists while some transaction has it. Removing its last use removes it.
  No colors, descriptions or tag hierarchy (Beancount allows `/` in a tag, and so do we, but
  nothing treats it as a tree).
- **Read with SQL:** a derived `transaction_tag` table (migration 12: book, transaction, tag;
  backfilled from the stored text), written with the postings on every write and cleared on
  delete, like `posting`. The text stays the source of truth.

### Names

- **What you type is made a tag** by one normalizer (`src/shared/tags.ts`), as account names are
  by `names.ts`: trimmed, a leading `#` dropped, lowercased, every run of anything but letters,
  digits, `-`, `_`, `/` and `.` made one dash, dashes trimmed from the ends. "Trip to Italy!"
  is `trip-to-italy`; "#Reimbursable" is `reimbursable`. Shown with its `#`.
- **Lowercase,** so `Vacation` and `vacation` can't become two tags, and dashes, Beancount's
  usual style. The ledger itself accepts any tag Beancount does (an imported book's
  `#Trip2019` stays as it is) and refuses anything else with a 422 that names it, rather than
  Beancount's parse error.

### The ledger's API

- **`GET /books/{b}/tags`:** the book's tags, alphabetically, each with how many transactions
  have it and the first and last dates it's on. Pickers suggest from it; filters list it.
- **A `tag` filter (repeatable, AND)** on `journal`, an account's `ledger` and
  `transactions/compact`: only transactions with every tag given. On an account's ledger it
  filters rows after the running balances are worked out, as `reconciled` does, so balances
  stay the account's.
- **`compact`'s `from` becomes optional** (every transaction when it's left out), for all-time
  reports of a tag. Categorizers still pass theirs.
- **Rows say their tags:** `LedgerRow.tags`, `JournalRow.tags` and `CompactTransaction.tags`
  (sorted). Transactions already have them.

### Tagging, one at a time and many

- **The transaction page** (and New transaction) gets a **Tags** field under Description: each
  tag a chip with ×, and an input that suggests the book's tags as you type (most used first,
  then alphabetical) and adds what you typed on Enter, Tab or a comma. It saves with the rest of
  the page (one versioned edit), so a reconciled transaction's tags change without the
  reconciliation warning (tags don't touch amounts).
- **Select mode's Actions** gain **Add tag…** and **Remove tag…** everywhere Select mode is
  (review, account ledgers, Transactions), built once in `lib/bulk.ts` like Categorize as…:
  - **Add tag…** opens a tag picker in the bar (the book's tags, or a new one), then adds it to
    each selected transaction that doesn't have it already.
  - **Remove tag…** offers only the tags the selection has, then removes it from each that has
    it. Disabled, saying so, when none of them has a tag.
  - Each is a versioned PATCH of `tags` per transaction (the latest version read first, as bulk
    edits are), and the bar's note says how many changed ("Tagged 12 #italy-2026; 3 had it
    already.").
- **The bar's picker** is generalized from accounts to either kind (`pick.accounts` or
  `pick.tags`).

### Seeing tags

- **Chips on rows:** ledger rows, journal rows (Transactions and home's recent transactions)
  and review cards show a transaction's tags after its description (small, muted, `#name`).
  Read-only there; tapping the row opens the transaction as now.

### Filtering by tag

- **Ledgers and Transactions:** the ledger filter (the funnel, M14) gets a **Tags** section
  under Reconciliation: pick one or more of the book's tags; a transaction shows only if it has
  all of them. In the URL (`?tag=italy-2026&tag=reimbursable`), so Back keeps it; the note under
  the funnel says what's on ("Tagged #italy-2026 and #reimbursable · Show all"). Select all then
  takes what's shown, so "everything still to claim → Remove tag… #reimbursable" works.
- **Reports:** a **Tags** filter at the top of Reports (also in the URL, `?tag=`), same AND
  rule. While it's on:
  - **Cash flow, the breakdown and the largest** count only transactions with every chosen tag.
  - **The breakdown** adds an **All time** window and starts on it (a tag usually marks a trip
    or project, not this month's spending); "Monthly average" and "This month" stay.
  - **The largest** covers all time, for the same reason ("Largest tagged #italy-2026").
  - **Net worth** is hidden, saying "Net worth isn't filtered by tag": it's balances, which a
    tag can't slice.
  - The page says what's filtered ("Only transactions tagged #italy-2026") with a link to them
    in Transactions, filtered the same.
- **The breakdown's All time** is a new window in `@luminous-money/ledger-graphs-api`
  (`window: "total"`, everything from `from`, summed, not averaged), released as 0.1.2 from its
  own repository and taken here. Cash flow keeps its 6 months (it's a trend), and home's "Spent
  this month" and an account's "Typically" aren't filtered (they're about budgets and habits).
- **`app` passes the tags to the ledger** (`compact`'s `tag`), so a filtered report reads only
  the tagged transactions, all-time ones included, rather than reading everything and filtering.

## Building it

1. **ledger:** `Directive.tags` from the parse; migration 12 (`transaction_tag`, its index and
   backfill); `store.put`/`delete` write and clear it; `store.tags`; the `tag` filters on
   journal, account ledger and compact (one SQL clause, `HAVING COUNT(DISTINCT tag) = n`);
   `compact`'s optional `from`; tags on rows; `GET /books/{b}/tags`; a tag check on
   `TransactionIn`/`TransactionPatch`. Tests in `services/ledger/tests`. Then `pnpm generate`.
2. **ledger-graphs (its own repository):** breakdown's `total` window, its test, `pnpm release
   0.1.2`; then bump `@luminous-money/ledger-graphs-api` here.
3. **app (server):** `shared/tags.ts` (normalizer, tests); `LedgerPort.compact` and `tags`;
   `FakeLedger` filtering by tags; reports taking `tags` (cash flow, breakdown with `total`,
   largest all-time when tagged); `/reports/*?tag=` routes; unit tests.
4. **PWA:** `TagPicker` (chips plus input with suggestions; used by the transaction page, the
   filters and the bar), `Tags` chips; the transaction page's field; `useTags`; bulk Add/Remove
   tag; `LedgerFilter`'s Tags and `useLedgerView`'s `tag`; journal and ledger queries keyed and
   filtered by tags; Reports' filter, All time and the hidden net worth.
5. **Tests:** API (`tests/api`: tagging by PATCH, the tags list, filters, a tagged report) and
   browser (`tests/ui/tests/m17.spec.ts`: tag on the page, bulk add and remove, filter a ledger,
   filter Reports).
6. **Docs:** design.md ("Tags (M17)"), PLAN.md (M17 checked, what's left in Later), RESUME.md.

## Decisions to review

Made without asking, since none blocked the work; each is easy to change.

1. **Tags are lowercased and dashed** when typed (`Trip to Italy` → `#trip-to-italy`). Imported
   tags keep their case.
2. **No tag registry** (no colors, descriptions or renaming a tag everywhere): a tag is just its
   uses. Renaming everywhere is Transactions filtered by the tag, Select all, Add the new one,
   Remove the old.
3. **With a tag filter, the breakdown starts on All time and the largest covers all time;** cash
   flow keeps 6 months; net worth is hidden.
4. **Ledgers and Transactions get the tag filter too,** beyond the brief's reports, since it's
   what makes bulk removal (and "show me the trip") work.
5. **Tags don't trigger the reconciliation warning** on a reconciled transaction.

## Not in M17

Noted in PLAN.md's Later: rules that add tags (a payee always `#business`), the AI suggesting
tags, renaming or merging a tag everywhere, OR filters (`any of`), tags on schedules' template
transactions, and tag-filtered budgets or "Spent this month".
