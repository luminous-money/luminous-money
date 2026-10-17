Plan
==================================================================================================

The roadmap, as milestones. The reasoning behind each piece lives in
[design.md](design.md); where work stands right now lives in [RESUME.md](../RESUME.md).

Two principles set the order:

- **Build and polish against test data first, and only then hydrate with real finances.**
  Importing real transactions commits us to the system.
- **Grow one real use case at a time, end to end.** Each milestone is elaborated when it starts,
  not before.

## Done

- **Foundations.**
  - The `ledger` service: a database as the system of record, Beancount as the engine, exact
    round trips, and incremental backups. Also a decades-scale benchmark.
  - Monorepo tooling: bake, the pnpm workspace, and a generated `ledger-client` with a drift
    check.
  - The Compose stack, with Traefik routing `/api/*` and `/ui/*`.
  - API and browser end-to-end suites against a throwaway stack.
- **The ledger API:**
  - JSON writes for transactions and text writes for any directive
  - typed responses, versioned and partial edits (PATCH with `updated_at`, 409 on conflict)
  - snake_case JSON
- **Migrations:** every table goes through `create_table` (created/updated timestamps), with a
  lint check.
- **Accounts:**
  - Leaves hold transactions and nodes hold sub-accounts.
  - Create an account by its fully qualified name from any account picker, with autofill
    through node accounts; nodes on the way are created too.
- **The review queue** (done for now):
  - skip, categorize, edit descriptions, confirm
  - swipe right to confirm and left to skip, with the stack sliding up
  - a detail view with a full split editor and a live balance check
  - TanStack Query underneath
- **Demo data:** `pnpm seed`.
- **Fava dropped:** reports will be our own.

## Milestones

Each milestone's detailed plan lives in `milestones/<milestone>/PLAN.md` next to this file (e.g.
[milestones/m1-one-account-e2e](milestones/m1-one-account-e2e/PLAN.md)), written when the
milestone starts.

- [x] **M1: One bank account end-to-end.** Built 2026-10-11, with
      [decisions to review](milestones/m1-one-account-e2e/PLAN.md#decisions-to-review)
      ([spec](milestones/m1-one-account-e2e/SPEC.md), [plan](milestones/m1-one-account-e2e/PLAN.md)).
  - the "brand new empty user" homepage
  - the add-an-account flow
  - the homepage with accounts
  - the simple account-anchored ledger view (click to see/edit details)
  - the "add transaction" flow
  - the import CSV flow (with transaction matching but not categorization yet, so an abridged
    version of the processing pipeline)
  - CSV profiling (storing the structure of each account's CSV file)
  - first-use fixes (2026-10-11): the import cutoff follows the opening balance, importing from an
    account's ledger, the add line at the top, the editor's actions pinned
  - decisions answered (2026-10-12): several file formats per account (asked about on a
    mismatch), any ledger path for a bank account, and exporting a book
- [x] **M2: Credit card account.** Much of the same as M1, plus some minor display decisions,
      and testing matching with two accounts that reflect two sides of the same transaction.
      Built 2026-10-13 ([plan](milestones/m2-credit-card/PLAN.md)): starred accounts replace
      "money accounts" (no account kinds), liabilities and income display inverted, and imports
      that match transactions already in the account, every match reviewed (move, swap, undo).
- [x] **M3: Scheduled transactions.** The editor, storage, generator logic (when and how real
      transactions are created from a schedule template), and display considerations. Built
      2026-10-13 ([plan](milestones/m3-scheduled-transactions/PLAN.md)), with the answers to its
      questions: daily runs, per-split match tolerances, upcoming rows with projected balances,
      auto-confirm, book time zones, and "Not this time".
- [x] **M4: Categorization.** The categorization engine. Built 2026-10-13
      ([plan](milestones/m4-categorization/PLAN.md)): rules and history categorizers, external
      providers over our [categorizer API](categorizer-api.md), proposals in review with
      acceptance tracking, "Suggest categories", similar, "Remember", and Select mode.
- [x] **M5: Investment accounts.** Lean on what Beancount already provides. The main
      deliverable: storing non-currency holdings, with a currency representation of their value.
      Built 2026-10-14 ([plan](milestones/m5-investment-accounts/PLAN.md)): holdings with cost
      basis and gains (account-scoped booking), values and staleness everywhere, prices fetched
      each morning (beanprice), trades with tax-aligned booking and split gains, revalued assets.
- [x] **M6: Multiple books.** A book switcher and a books manager (create, delete). The selected
      book is the context for everything, like switching profiles; nothing spans books. Built
      2026-10-14: book-prefixed pages, the masthead switcher, creating books (also from an
      export), deleting them (with backups carrying it), unique names, a second demo book.
- ~~**M7: Cross-book transactions.**~~ Dropped (2026-10-14): books are independent, and each
  records its own side of an event that touches two (design.md, "Books are independent").
- [x] **M8: Auth.** Account creation, log in, log out, book ownership and permissions. Built
      2026-10-15: open sign-up with no special accounts, Argon2id and breached-password checks,
      10-minute access tokens with rotating refresh, API tokens, email links (optional SMTP),
      account deletion, the operator's CLI, identities ready for OIDC.
- [x] **M9: SimpleFIN.** Bank feeds. Built 2026-10-16: connections (sealed), linking in the
      background (new, reconcile with the bank as the source of truth, start over, from a
      date), the daily sync, brokerages from holdings snapshots, "Reported …" balances, and
      `@wymp/config-simple` in auth and app.
- [x] **M10: Chart of accounts.** The account tree with collapsible nodes and aggregate
      balances; add accounts; open one to edit it, including archiving it; delete accounts (which
      needs a substitute to move their transactions to). Built 2026-10-16: the tree (one read),
      rename and move, display names, archive with a closing transfer, delete or merge into a
      substitute, protected accounts, and `app`'s references following.
- [x] **M11: Budgets.** A budget on any account, for any period: how much you're allowed to
      spend (or aim to earn or save). A node's budget can be split across the accounts under it,
      the rest its "Other"; none is higher than one above it. Shown on a Budgets page, an
      account's ledger and home, as filled lines. [Built](milestones/m11-budgets/PLAN.md)
      2026-10-17, with "Exclude from budget" on transactions and the book's week start.
- [x] **M12: Reports.** From basic to more complex: home's "Spent this month" (against the budget
      and a simulated month), cash flow, expense and income breakdowns, largest transactions,
      net worth, and account statistics, on our own `ledger-graphs` libraries with ECharts.
      [Built](milestones/m12-reports/PLAN.md) 2026-10-17, with home's recent transactions and
      a Transactions page (every account's). Statements (P&L, balance sheet) later; moving the
      libraries to a public monorepo waits for a yes.
- [x] **M13: Sharing books with other users.** Any user can be added to a book with read, write
      or manage permissions. Every book has an owner. [Built](milestones/m13-sharing-books/PLAN.md)
      2026-10-17: invitations by link, roles enforced by the ledger and `app`, leaving and
      removing, read-only in the PWA.
- [ ] **M14: Reconciliation.** Agree an account with the bank's statement (or feed): tick off its
      transactions to the statement's balance, then keep it as a balance assertion and marks on
      the postings; bank-fed accounts checked daily, with where they went off.
      [Planned](milestones/m14-reconciliation/PLAN.md) 2026-10-17.
- [ ] **M15: Sub-accounts of linked accounts.** Split a bank-linked account's money into
      sub-accounts, e.g. the $10,000 in a PNC checking account as $5,000 of padding and $5,000
      for general use, while the bank feed keeps it in step with the bank.
- [ ] **M16: Suggested recurring transactions.** Nightly, analyze each account's last 14 months
      of transactions and identify ones that look recurring, to suggest as schedules (M3).
- [ ] **M17: Receipt capture.** Take a picture of a receipt, and AI makes a transaction from it.
- [ ] **M18: Transaction tagging.** Tag transactions (a bulk action too), and filter reports by
      tag.
- [ ] **M19: AI categorization.** Users set up an AI provider (one of those supported, with
      their API key) and standing instructions for categorizing, e.g. "I like highly detailed,
      deeply nested expense accounts. Accounts should always say WHAT, not WHY (tags say why, if
      anything)". A new bulk action in review: "Categorize with AI".
- [ ] **M20: Design polish.**

## Notes collected so far

Decisions and ideas recorded before the milestones existed, kept here so they aren't lost. Each
is tagged with the milestone it most likely feeds; the tag is a guess until that milestone is
elaborated.

- **Ledgers** (M1 starts this):
  - **General ledger:** every split in the book, in chronological transaction order.
    - The split is the primary unit; transactions are visually demarcated.
    - Reversed and paginated: the most recent at the bottom, with earlier pages loading
      automatically when scrolling up.
    - The bottom row is always an empty transaction. Entering one commits it in place and opens
      a new empty row.
    - Adding and removing splits is simple. A transaction won't save unless it balances, and
      each shows how much is left to distribute.
    - Confirmed or not is a transaction-level checkbox.
    - Any transaction's date can be set by hand, separately from `created_at`.
  - **Scoped to one account,** it's that account's ledger. Every line shows the account's
    running balance, and unconfirmed (`!`) transactions count.
  - **A read-only view:** a prettier, one-line format for reading. Tapping a transaction opens
    it for editing, including complex splits.
- **Money accounts** (M1, M2, M5): accounts linked to a real institution that actually hold
  money, such as bank accounts, credit cards, brokerage accounts, other asset accounts and
  loans. The home screen lists them with their balances. (M2 replaces the explicit kind with
  per-user **starred accounts**; there are no account kinds.) Other places likely to treat them
  specially: the anchor side of imports, CSV and bank-feed imports, reconciliation and balance
  assertions (M14), and net worth.
- **Chart of accounts** (M10):
  - view the tree
  - create, edit, rename and close accounts
  - move accounts between parents
  - open any account's ledger

  Renames and moves rewrite every directive that mentions the account, history included
  (decided: acceptable).
- **Categorization** (M4):
  - bulk categorization
  - the context builder (14-month window)
  - the resolver chain: `matcher`, then `rules`, with `external` as a configurable slot (Cati,
    eventually)
- **Prices** (M5): `bean-price` on a schedule, and manual price entries for illiquid assets.
- **Reports** (M12):
  - **Check what already exists before building anything.**
  - **If we build our own:** two independent libraries, `@luminous-money/ledger-graphs-api` (a
    plugin for a ledger's API that returns data sets) and `@luminous-money/ledger-graphs-ui` (a
    wrapper around a good graphing library). They'd be built and published from a small public
    monorepo in the luminous-money GitHub account, loosely based on the wymp monorepo proof of
    concept.
  - **At least:** expense and income pie charts with selectable account depth, number of slices,
    date bounds, and optional averaging per period.
- **Budgeting** (M11):
  - a target budget on any account, for any period
  - no descendant may have a higher base budget than its ancestor (base amounts, before
    rollover)
  - rollover: dropped (2026-10-17)
- **Infrastructure, when it's needed:**
  - **Background validation in `ledger`,** once a screen needs Beancount's full booking (lots,
    balance assertions, BQL) and it's too slow on the target hardware. Plain balances come from
    SQL and don't need it.
  - **Deploying to the Pi:** run `bench.py` on it, `docker stack deploy` on a real Swarm,
    multi-arch release images, and operator docs.
  - **Richer synthetic data** as milestones need it.
- **Hydration** (after the milestones that cover real use): choose the cutover date and the
  source of opening balances, open the real accounts, and retire GnuCash to read-only.

## Deferred

- Cati as an `external` resolver
- Archiving closed periods (only if the Pi benchmark calls for it)
- A native mobile app

## Open questions

- **Resolver contract:**
  - What does confidence mean, and is it comparable across resolvers?
  - Can a resolver return a partial answer (e.g. a match with a suggested split)?
  - Should high-confidence matches ever auto-confirm, or does everything go through review?
- **Cutover:** deferred until hydration.

## Later (noted, not pressing)

- **Email, once there's an email system:** invitations sent by email (M13), and accounts
  required to verify their email (M8's question 1).
- **Transferring a book's ownership** to a manager (M13).
- **Auth (M8's other questions):** session lifetime (proposed: 60 days unused, a year at most),
  passkeys and two-factor (a milestone of their own), and which OIDC providers first (Google,
  Apple, GitHub, or any OIDC issuer).

## Polish

Smaller improvements to pick up between milestones or at the end.

- [ ] **Type-aware wording when creating accounts** (e.g. "amount owed" for a liability).
- [ ] **Order-aware match assignment:** assign an import's rows to candidates over the whole
      network of matches, weighting order, so two identical coffees entered on the 5th and 7th
      pair with CSV rows on the 7th and 8th in order (M2 pairs by proximity, and review swaps).
- [ ] **Import file format management:** see, edit, rename and delete an account's saved CSV
      formats directly, rather than only replacing or adding to them when a file doesn't match.
- [ ] **Review shows the book's ID at the top,** where its name belongs.
- [ ] **Select all, and "select uncategorized",** in select mode.
- [x] **Review newest first** (2026-10-17), the latest entered of a day first too.
- [x] **Pair transfers in review** (2026-10-17): money out of one account and the same into
      another within 7 days, both imported, become one transfer, with "Reject" to restore the
      two.
- [ ] **Mobile usability,** across the app.
- [ ] **Tapping a report's bar or slice opens its transactions** (that month's, or that
      category's).
- [x] **Go to a date in an account's ledger:** a partial view from that date back, loading
      newer pages above ("Load more") and older ones as you scroll.
