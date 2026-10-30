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
      a Transactions page (every account's). Statements (P&L, balance sheet) later. The
      libraries moved to [luminous-money/ledger-graphs](https://github.com/luminous-money/ledger-graphs)
      (2026-10-17), and the app depends on them from npm.
- [x] **M13: Sharing books with other users.** Any user can be added to a book with read, write
      or manage permissions. Every book has an owner. [Built](milestones/m13-sharing-books/PLAN.md)
      2026-10-17: invitations by link, roles enforced by the ledger and `app`, leaving and
      removing, read-only in the PWA.
- [x] **M14: Reconciliation.** Agree an account with the bank's statement (or feed): tick off its
      transactions to the statement's balance, then keep it as a balance assertion and marks on
      the postings; bank-fed accounts checked daily, with where they went off.
      [Built](milestones/m14-reconciliation/PLAN.md) 2026-10-17: Reconcile (save for later,
      Finish once it balances, Undo), ✓ in ledgers and their filter (with Select all), divided
      accounts, bank-fed accounts reconciled automatically, imported files' balances checked.
- [x] **M15: Sub-accounts of linked accounts.** Split a bank-linked account's money into
      sub-accounts, e.g. the $10,000 in a PNC checking account as $5,000 of padding and $5,000
      for general use, while the bank feed keeps it in step with the bank. Builds on M14's
      **divided accounts** (a node that's one real account, its sub-accounts dividing it):
      linking one to a bank, and where the feed's transactions land among its parts.
      [Built](milestones/m15-sub-accounts-of-linked-accounts/PLAN.md) 2026-10-18: a main part
      new money lands in, Divide for an account you already have (its link, statements and
      history kept), the parts on screen with Move money, choosing a transaction's part, and
      rules that land what they match in a part.
- [x] **M16: Receipt capture.** Take a picture of a receipt, and AI makes a transaction from it.
      [Built](milestones/m16-receipt-capture/PLAN.md) 2026-10-18: the `ai` service (per-book AI
      settings and a sealed key; Claude, and a fake for tests), Capture receipt (camera or
      upload, hints, itemizing) into review and back, attachments on any transaction, and a
      capture that always makes a transaction, read or not.
      Its second pass (2026-10-19): reading in two narrow steps (extract with Sonnet 5,
      categorize with Opus 5), payment cards on accounts naming the paying account, and
      categorizing by **split**: posting flags mark what's unconfirmed, fallbacks and item
      history in the chain, and review's split pickers.
- [x] **Production readiness** (before M17; Kael, 2026-10-19): ready for production, and simple
      to deploy from GitHub to a laptop or a public server: upgrades and migrations, whole-system
      backups, logs, health; releases on GitHub; admins (by email, in config) with a system page,
      and upgrades on the admin's terms. [Its plan](milestones/production-readiness/PLAN.md).
      Phase 1 built 2026-10-21: versions and health everywhere, the gateway image (with optional
      HTTPS), whole-system backups, the `luminous-money` command, the release workflow,
      [docs/deploying.md](deploying.md). Questions answered 2026-10-23 (host-only upgrades,
      GitHub as luminous-money/luminous-money, GPL-2.0-or-later, HTTPS kept with its certificate
      watched, open sign-ups). Phase 2 built 2026-10-23: admins by email (once confirmed),
      the system page, update checks, `auto-upgrade`.
- [x] **Chart of accounts import** (before M17; Kael, 2026-10-26): Accounts → Import, a CSV of
      full names and the fields an account can start with, every name title-cased by the one
      normalizer. [Built](milestones/chart-of-accounts-import/PLAN.md) 2026-10-26: a preview of
      what's added, already here or refused (and why), then one atomic write
      (`POST /accounts/batch`); descriptions on accounts; typing and suggestions title-case too.
- [x] **Migrate from another system** (before M17; Kael, 2026-10-26): from the setup flow or
      Accounts, until it's been done once: another system's chart and history (GnuCash first),
      bank feeds and the AI if wanted, then a reference of the history by payee for the AI,
      rules from history, and suggestions for everything uncategorized.
      [Built](milestones/migrate-from-another-system/PLAN.md) 2026-10-26, with descriptions
      going to the AI and a fix: making an account in a transaction's picker no longer submits
      the transaction too.
- [x] **M17: Transaction tagging.** Tag transactions with one or more tags. Remove tags. Per-
      transaction or via bulk actions. Filter reports by one or more tags (AND for now).
      [Built](milestones/m17-transaction-tagging/PLAN.md) 2026-10-29: Beancount's `#tag`s, a
      Tags field on a transaction's page, Add tag… and Remove tag… in Select mode, tags on rows,
      a tag filter on ledgers, Transactions and Reports (whose breakdown gains All time).
- [ ] **Funds** (next, after M17; Kael, 2026-10-29): what money is *for*, as a ledger of its own
      beside the accounts (where it is). Every dollar of net worth (every asset, the house and
      retirement included) is in exactly one fund, Unallocated holding the rest; splits say
      which, by choice or by rules (defaults per account, a spend order, autofill to targets).
      It replaces divided accounts as the way to set money aside. **Being designed** with Kael:
      [its plan](milestones/funds/PLAN.md) holds the decisions so far and the open questions.
- [ ] **Tags, more** (after M17; Kael, 2026-10-29): tags everywhere M17 left them out. Rules
      that add tags, a Tags field on schedules (their templates carry tags already, unseen) and
      on Capture receipt, the AI and history proposing the book's own tags, and transfers
      keeping their sides' tags. [Planned](milestones/tags-more/PLAN.md) 2026-10-29, not
      started; its decisions to review await Kael.
- [ ] **M18: Suggested recurring transactions and matching rules.** Bi-weekly or on-demand via
      a button in the schedules section (recurring transactions) or somewhere TBD for matching
      rules. Analyze each account's last 14 months of transactions and identify ones
      that look recurring and are not already captured by an existing recurring transaction, to
      suggest as schedules (M3) or for matching rules. Don't re-ask. (Moved after tagging, 2026-10-17.)
- [x] **M19: AI categorization.** Users set up an AI provider (one of those supported, with
      their API key) and standing instructions for categorizing, e.g. "I like highly detailed,
      deeply nested expense accounts. Accounts should always say WHAT, not WHY (tags say why, if
      anything)". A new bulk action in review: "Categorize with AI". **Built within M16**
      (2026-10-18 and its second pass, 2026-10-19; found unchecked here 2026-10-26): the book's
      AI page (Claude, its key sealed, guidance, account creation and how eagerly), the AI
      categorizer at the end of the chain, and Select mode's Suggest categories asking it (the
      bulk action), live since the first release. The migration's reference (2026-10-26) gives
      it the book's history by payee. Still open: whether imports and bank feeds ask the AI by
      themselves (they don't; see the open questions).
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

- Archiving closed periods (only if the Pi benchmark calls for it)
- A native mobile app

## Open questions

- **Resolver contract:**
  - What does confidence mean, and is it comparable across resolvers?
  - Can a resolver return a partial answer (e.g. a match with a suggested split)?
  - Should high-confidence matches ever auto-confirm, or does everything go through review?
- **Cutover:** deferred until hydration.
- **Should imports and bank feeds ask the AI by themselves?** Today they run rules, history and
  item history; the AI is asked by receipts and by Suggest categories (a selection, or a
  migration's last step). Asking on every sync costs a call per batch, every morning.

## Later (noted, not pressing)

- **Tags, later still** (M17): renaming or merging a tag everywhere, OR filters ("any
  of"), tag-only rules, and tag-filtered budgets or "Spent this month". Tags in rules,
  schedules, receipts and the AI are the **Tags, more** milestone above.
- **Email, once there's an email system:** invitations sent by email (M13), and accounts
  required to verify their email (M8's question 1).
- **Transferring a book's ownership** to a manager (M13).
- **Attachments in exports and backups** (M16): they're Beancount text today, so receipts and
  other files stay behind.
- **Receipts, more** (M16): tuning the reading (prompts, evals), other providers, a cheaper
  model per book, several receipts at once, and receipts by email.
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
- [ ] **Select all, and "select uncategorized",** in select mode. (Select all is built.)
- [x] **Bulk actions** (2026-10-23): one Actions menu in Select mode everywhere (Confirm,
      Categorize as…, Suggest categories with the book's AI).
- [x] **Delete an account with its transactions** (2026-10-23), after a red notice of every
      other account that changes.
- [x] **Receipts meet the bank's copy** (2026-10-24): a capture reads itself into a clear
      match already in the paying account (5 days either side), and **Read receipt** on a
      transaction's page reads one it holds into it; either goes back to review.
- [x] **HEIC on the server** (2026-10-24): every image is kept as browsers show it (an
      iPhone's HEIC becomes a JPEG), for receipts and attachments alike.
- [x] **Suggest categories only in Select mode** (2026-10-24), where it asks the book's AI.
- [x] **A private instance** (2026-10-24): `LUMINOUS_MONEY_SERVICE_MODE=private` lets only
      `LUMINOUS_MONEY_ALLOWED_EMAILS` sign up, and the login page says it's private once they all
      have accounts.
- [x] **What the AI costs** (2026-10-26): every call logged with its estimated cost, each
      operation's shown after it runs (Suggest categories, a receipt, a migration's
      suggestions), and the month so far on the AI page.
- [x] **Bank feeds on demand** (2026-10-24): `LUMINOUS_MONEY_SIMPLEFIN_MODE=on-demand` stops the morning
      sync (only Sync now), for the dev stack.
- [x] **Review newest first** (2026-10-17), the latest entered of a day first too.
- [x] **Pair transfers in review** (2026-10-17): money out of one account and the same into
      another within 7 days, both imported, become one transfer, with "Reject" to restore the
      two.
- [ ] **Mobile usability,** across the app.
- [ ] **Tapping a report's bar or slice opens its transactions** (that month's, or that
      category's).
- [x] **Go to a date in an account's ledger:** a partial view from that date back, loading
      newer pages above ("Load more") and older ones as you scroll.
