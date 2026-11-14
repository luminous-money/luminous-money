Plan
==================================================================================================

The roadmap, as milestones. The reasoning behind each piece lives in
[design.md](design.md); where work stands right now lives in [RESUME.md](../RESUME.md).

Two principles set the order:

- **Build and polish against test data first, and only then hydrate with real finances.**
  Importing real transactions commits us to the system.
- **Grow one real use case at a time, end to end.** Each milestone is elaborated when it starts,
  not before.

## How the docs are laid out

- **A milestone ahead** has its plan in `milestones/<milestone>/PLAN.md` next to this file,
  written in full when it starts (until then, its brief and what's been noted for it).
- **A milestone that's done** moves to `milestones/.archived/<milestone>/`, its plan kept as the
  record of what was built and why.
- **What's left over** (open questions, polish, follow-ups from done milestones, anything with no
  milestone of its own) is [M99: Follow-ups](milestones/m99-follow-ups/PLAN.md). Something that
  belongs to a milestone ahead goes in that milestone's plan instead.

## Ahead

Roughly in order; each is elaborated with Kael when it starts.

- [ ] **Funds B: Complex Fund Functionality** (next; Kael, 2026-11-02;
      [its plan](milestones/funds-b/PLAN.md)): everything else designed for funds, built in
      steps.
  - [x] **Step 1: shares in funds** (Kael, 2026-11-03; [built](milestones/funds-b/PLAN.md)
        2026-11-03, `v0.1.15`): a fund holds any commodity, so Kael's Fidelity accounts
        can be represented in funds. Funds read a transaction per commodity, moves take shares
        (typed in shares or dollars), the Funds pages list holdings, and an account can have a
        default fund (an IRA's is Retirement). A sale that says no fund is flagged: refused when
        typed by hand, queued in a new **Notifications** page (a bell beside the camera) when it
        came in by itself.
  - [ ] **The rest** ([what it takes in](milestones/funds-b/PLAN.md#the-rest-of-b)): spend and
        fill rules, groups (a house and its mortgage), loans in funds, budget funds for *why*
        money is spent, what becomes of divided accounts, and A's known gaps.
        [The design record](milestones/funds-b/design-record.md) holds the design so far, with
        an [example book](milestones/funds-b/example-book.md) and
        [71 scenarios](milestones/funds-b/scenarios.md) still to gut-check.
- [ ] **Tags, more** (after M17; Kael, 2026-10-29): tags everywhere M17 left them out. Rules
      that add tags, Capture receipt's Tags, the AI and history proposing the book's own tags.
      [Planned](milestones/tags-more/PLAN.md) 2026-10-29, not started; its decisions to review
      await Kael. Tags are splits' since 2026-11-12, so it's to be read through that first
      (schedules' Tags and transfers keeping their sides' tags came with split-level tags).
- [ ] **Split-level tags and funds** (Kael, 2026-11-07;
      [its plan](milestones/split-level-tags-and-funds/PLAN.md)): often only part of a
      transaction is a fund's (one item of a receipt from Emergency), and the same is true of tags
      (one item `#gift`).
  - [x] **Step 1, tags per split** (Kael, 2026-11-12: "moving tags from transaction level to
        split level"; the tags already used dropped, at his call). Built 2026-11-12: a split's
        `tags:` (`Posting.tags` in the ledger's API, ledger migration 14), Tags per split on the
        transaction page and schedules, a card's and Select mode's tags going on what the money
        was for, filters keeping a transaction with a split that has every tag, Reports counting
        only the tagged splits, and tags passed on when a split is itemized or a transfer
        paired. Eight calls to review in the plan. Released in `v0.1.27`.
  - [x] **The split editor** (Kael, 2026-11-12): with tags and memos, splits are shown as they
        are and edited one at a time in a dialog, several at once in Select mode (PLAN's Polish,
        "Kael's changes, 2026-11-12").
  - [ ] **Step 2, funds per split** (noted, not planned): fund lines are the transaction's
        (amounts, not tied to a split); until then a review card's fund choice is quieter, and
        the split editor has no fund (Kael asked for one there, 2026-11-12).
- [ ] **HSA tracking** (Kael, 2026-11-07; [noted](milestones/hsa-tracking/PLAN.md), not planned):
      the AI tags every split that appears to pay for something HSA-eligible. Amazon says so on
      its items, so its charges need no guess. Builds on Tags, more (the chain proposing tags) and
      split-level tags (built).
- [ ] **M18: Suggested recurring transactions and matching rules.** Bi-weekly or on-demand via
      a button in the schedules section (recurring transactions) or somewhere TBD for matching
      rules. Analyze each account's last 14 months of transactions and identify ones that look
      recurring and are not already captured by an existing recurring transaction, to suggest
      as schedules (M3) or for matching rules. Don't re-ask. (Moved after tagging, 2026-10-17;
      [its brief](milestones/m18-suggested-recurring-transactions/PLAN.md).)
- [ ] **M20: Design polish** ([noted](milestones/m20-design-polish/PLAN.md)): mobile usability
      across the app, so far.
- [ ] **M99: Follow-ups** ([the list](milestones/m99-follow-ups/PLAN.md)): open questions, polish,
      calls made without asking still to review, and what done milestones left over.

## Done

Each with its plan in [milestones/.archived](milestones/.archived/).

- [x] **Before the milestones:**
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
- [x] **M1: One bank account end-to-end.** Built 2026-10-11, with [decisions to
      review](milestones/.archived/m1-one-account-e2e/PLAN.md#decisions-to-review)
      ([spec](milestones/.archived/m1-one-account-e2e/SPEC.md),
      [plan](milestones/.archived/m1-one-account-e2e/PLAN.md)).
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
- [x] **M2: Credit card account.** Much of the same as M1, plus some minor display decisions, and
      testing matching with two accounts that reflect two sides of the same transaction. Built
      2026-10-13 ([plan](milestones/.archived/m2-credit-card/PLAN.md)): starred accounts replace
      "money accounts" (no account kinds), liabilities and income display inverted, and imports that
      match transactions already in the account, every match reviewed (move, swap, undo).
- [x] **M3: Scheduled transactions.** The editor, storage, generator logic (when and how real
      transactions are created from a schedule template), and display considerations. Built
      2026-10-13 ([plan](milestones/.archived/m3-scheduled-transactions/PLAN.md)), with the answers
      to its questions: daily runs, per-split match tolerances, upcoming rows with projected
      balances, auto-confirm, book time zones, and "Not this time".
- [x] **M4: Categorization.** The categorization engine. Built 2026-10-13
      ([plan](milestones/.archived/m4-categorization/PLAN.md)): rules and history categorizers,
      external providers over our [categorizer API](categorizer-api.md), proposals in review with
      acceptance tracking, "Suggest categories", similar, "Remember", and Select mode.
- [x] **M5: Investment accounts.** Lean on what Beancount already provides. The main deliverable:
      storing non-currency holdings, with a currency representation of their value. Built 2026-10-14
      ([plan](milestones/.archived/m5-investment-accounts/PLAN.md)): holdings with cost basis and
      gains (account-scoped booking), values and staleness everywhere, prices fetched each morning
      (beanprice), trades with tax-aligned booking and split gains, revalued assets.
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
      account's ledger and home, as filled lines. [Built](milestones/.archived/m11-budgets/PLAN.md)
      2026-10-17, with "Exclude from budget" on transactions and the book's week start.
- [x] **M12: Reports.** From basic to more complex: home's "Spent this month" (against the budget
      and a simulated month), cash flow, expense and income breakdowns, largest transactions, net
      worth, and account statistics, on our own `ledger-graphs` libraries with ECharts.
      [Built](milestones/.archived/m12-reports/PLAN.md) 2026-10-17, with home's recent transactions
      and a Transactions page (every account's). Statements (P&L, balance sheet) later. The
      libraries moved to
      [luminous-money/ledger-graphs](https://github.com/luminous-money/ledger-graphs) (2026-10-17),
      and the app depends on them from npm.
- [x] **M13: Sharing books with other users.** Any user can be added to a book with read, write or
      manage permissions. Every book has an owner.
      [Built](milestones/.archived/m13-sharing-books/PLAN.md) 2026-10-17: invitations by link, roles
      enforced by the ledger and `app`, leaving and removing, read-only in the PWA.
- [x] **M14: Reconciliation.** Agree an account with the bank's statement (or feed): tick off its
      transactions to the statement's balance, then keep it as a balance assertion and marks on the
      postings; bank-fed accounts checked daily, with where they went off.
      [Built](milestones/.archived/m14-reconciliation/PLAN.md) 2026-10-17: Reconcile (save for
      later, Finish once it balances, Undo), ✓ in ledgers and their filter (with Select all),
      divided accounts, bank-fed accounts reconciled automatically, imported files' balances
      checked.
- [x] **M15: Sub-accounts of linked accounts.** Split a bank-linked account's money into
      sub-accounts, e.g. the $10,000 in a PNC checking account as $5,000 of padding and $5,000 for
      general use, while the bank feed keeps it in step with the bank. Builds on M14's **divided
      accounts** (a node that's one real account, its sub-accounts dividing it): linking one to a
      bank, and where the feed's transactions land among its parts.
      [Built](milestones/.archived/m15-sub-accounts-of-linked-accounts/PLAN.md) 2026-10-18: a main
      part new money lands in, Divide for an account you already have (its link, statements and
      history kept), the parts on screen with Move money, choosing a transaction's part, and rules
      that land what they match in a part.
- [x] **M16: Receipt capture.** Take a picture of a receipt, and AI makes a transaction from it.
      [Built](milestones/.archived/m16-receipt-capture/PLAN.md) 2026-10-18: the `ai` service
      (per-book AI settings and a sealed key; Claude, and a fake for tests), Capture receipt (camera
      or upload, hints, itemizing) into review and back, attachments on any transaction, and a
      capture that always makes a transaction, read or not. Its second pass (2026-10-19): reading in
      two narrow steps (extract with Sonnet 5, categorize with Opus 5), payment cards on accounts
      naming the paying account, and categorizing by **split**: posting flags mark what's
      unconfirmed, fallbacks and item history in the chain, and review's split pickers.
- [x] **Production readiness** (before M17; Kael, 2026-10-19): ready for production, and simple to
      deploy from GitHub to a laptop or a public server: upgrades and migrations, whole-system
      backups, logs, health; releases on GitHub; admins (by email, in config) with a system page,
      and upgrades on the admin's terms. [Its
      plan](milestones/.archived/production-readiness/PLAN.md). Phase 1 built 2026-10-21: versions
      and health everywhere, the gateway image (with optional HTTPS), whole-system backups, the
      `luminous-money` command, the release workflow, [docs/deploying.md](deploying.md). Questions
      answered 2026-10-23 (host-only upgrades, GitHub as luminous-money/luminous-money,
      GPL-2.0-or-later, HTTPS kept with its certificate watched, open sign-ups). Phase 2 built
      2026-10-23: admins by email (once confirmed), the system page, update checks, `auto-upgrade`.
      Upgrades made safe to stop (2026-11-05, `v0.1.18`, after Emmer's hung): images pulled one at a
      time and before anything changes, and `upgrade` finishing one stopped after pinning.
- [x] **Chart of accounts import** (before M17; Kael, 2026-10-26): Accounts → Import, a CSV of full
      names and the fields an account can start with, every name title-cased by the one normalizer.
      [Built](milestones/.archived/chart-of-accounts-import/PLAN.md) 2026-10-26: a preview of what's
      added, already here or refused (and why), then one atomic write (`POST /accounts/batch`);
      descriptions on accounts; typing and suggestions title-case too.
- [x] **Migrate from another system** (before M17; Kael, 2026-10-26): from the setup flow or
      Accounts, until it's been done once: another system's chart and history (GnuCash first), bank
      feeds and the AI if wanted, then a reference of the history by payee for the AI, rules from
      history, and suggestions for everything uncategorized.
      [Built](milestones/.archived/migrate-from-another-system/PLAN.md) 2026-10-26, with
      descriptions going to the AI and a fix: making an account in a transaction's picker no longer
      submits the transaction too.
- [x] **M17: Transaction tagging.** Tag transactions with one or more tags. Remove tags. Per-
      transaction or via bulk actions. Filter reports by one or more tags (AND for now).
      [Built](milestones/.archived/m17-transaction-tagging/PLAN.md) 2026-10-29: Beancount's `#tag`s,
      a Tags field on a transaction's page, Add tag… and Remove tag… in Select mode, tags on rows, a
      tag filter on ledgers, Transactions and Reports (whose breakdown gains All time). Tags
      moved to splits on 2026-11-12 (split-level tags, step 1).
- [x] **Funds A: Basic Funds** (Kael, 2026-11-02): what money is *for*, as a ledger of its
      own beside the accounts (where it is), with no rules: a fund fills or drains only when a
      transaction says so ("for Emergency", "from Emergency"), or by a move between funds.
      Funds hold dollars; Unallocated is net worth less every fund.
      [Built](milestones/.archived/funds-a/PLAN.md) 2026-11-02 (`v0.1.13`): a Funds section on a
      transaction's page, New transaction and schedules, a fund on review cards, Select mode's
      Fund…, a rule's fund, chips on rows, the Funds page, each fund's page, Move money and a
      home card.
- [x] **Loans** (Kael, 2026-10-30; planned with Kael and built 2026-11-05: [its
      plan](milestones/.archived/loans/PLAN.md)): big loans managed from an amortization table
      (worked out, a CSV, or a PDF read by the AI), with dated changes, history when one's already
      under way, and escrow dovetailing with schedules; and their payments seen as monthly spending.
      In funds, a loan is grouped (Funds B's open question 4), which is the rest of Funds B.
  - [x] **Step 1: loans** ([built](milestones/.archived/loans/PLAN.md#step-1-as-built-2026-11-05)
        2026-11-05): principal, interest and others (escrow, PMI) from dated versions; the books
        win and the table is where they start; the payment an M3 schedule the loan keeps; from
        the start (backfilled, Opening Balances before the paying account's books), from today,
        or already in the books; extra payments, the lender's statement, a new table; escrow's
        schedules linked from the loan.
  - [x] **Step 2: outflows** (Kael, 2026-11-05;
        [built](milestones/.archived/loans/PLAN.md#step-2-as-built-2026-11-05) 2026-11-05): an asset
        or liability can count as spending (what's paid into it, as an expense account), with the
        expenses paid out of it masked; budgets, home and Reports count outflows (the ledger's
        lens), and Reports switches to Expenses, the traditional P&L view.
  - [x] **Its decisions reviewed** (Kael, 2026-11-05; `v0.1.18`): all 21 kept but number 6, so
        a matched payment's different amount now goes to escrow (principal, without escrow).
  - [x] **Step 3: setting a loan up as a questionnaire** (Kael, 2026-11-06; [planned with
        Kael](milestones/.archived/loans/PLAN.md#step-3-setting-a-loan-up-a-questionnaire) and
        [built](milestones/.archived/loans/PLAN.md#step-3-as-built-2026-11-06) 2026-11-06, released
        as `v0.1.19`): New loan becomes a step-by-step questionnaire (what it's for, terms, extras,
        history, payment, then a confirmation page showing where the money flows) that creates
        nothing until Confirm. Default accounts are named from what the loan is for; the CSV and PDF
        imports and "already in the books" leave the UI; due dates no longer show a month early.
  - [x] **Backfilled payments carry escrow** (Kael, 2026-11-06): a payment due before the paying
        account's books begin is the whole payment (escrow, PMI and the rest), still from
        Opening Balances, rather than principal and interest only (the plan's decision 7, changed);
        and New loan stages escrow's bills before setting escrow's balance, so one already paid
        counts.
- [x] **Amazon orders** (Kael, 2026-11-06; [planned with
      Kael](milestones/.archived/amazon-orders/PLAN.md) and built 2026-11-06 to 2026-11-07,
      `v0.1.20` to `v0.1.24`): Amazon's charges pulled in with the items behind each, matched to the
      bank's and cards' rows by date and amount, and read into them as splits the categorize chain
      places (item history, then the AI). The server logs in to Amazon as Kael (his choice), through
      one shop-agnostic orders API in `app`.
  - [x] **Step 1: the spike** (2026-11-06, `v0.1.20`): the `shops` service logs in to Amazon
        and reads charges and their orders; the PWA's Amazon page sets it up, syncs, and shows
        what it read. Nothing written to the books. For Kael to try on Emmer. **`v0.1.21`**:
        a challenged home page is passed over (Kael's first sync timed out on it), and which
        charges are the book's is chosen by card. **`v0.1.22`: proven on Emmer**: the sign-in
        is done in a browser (and Amazon's "I am human" box ticked); a sync read 112 charges
        and their 92 orders.
  - [x] **Step 2: orders in `app`** (2026-11-07): each charge itemized into the book as a
        receipt (Kael): the card's account, the bank's copy or one made for it, back in review;
        tests for both services.
  - [x] **Step 3: the connection** (2026-11-07): the morning sync (09:00, after the bank
        feeds), and "Amazon wants you to log in again" in Notifications. **`v0.1.24`**
        (Kael): after the first, a sync reads back 15 days before the last; refunds name
        their items when the order says.
  - **Left over,** in [M99](milestones/m99-follow-ups/PLAN.md): an Assign button for a waiting
    charge; the book's own cards as the default; receipts by email, other shops, Jess's
    Amazon; its calls made without asking, to review.
- [x] **Brokerage activity** (Kael, 2026-11-07; [the
      plan](milestones/.archived/brokerage-activity/PLAN.md), `v0.1.26`): each brokerage row read by
      its description (Fidelity first): sweeps left out, dividends confirmed to a per-link income
      account, trades booked with their shares, transfers of assets as shares; the snapshot settles
      what's left; a linked history opens positions as they were; "Read again" is the cleanup, run
      on Kael's three Fidelity links on Emmer (2026-11-07): each matches the bank, in cash and in
      every position's shares.
- [x] **M19: AI categorization.** Users set up an AI provider (one of those supported, with
      their API key) and standing instructions for categorizing, e.g. "I like highly detailed,
      deeply nested expense accounts. Accounts should always say WHAT, not WHY (tags say why, if
      anything)". A new bulk action in review: "Categorize with AI". **Built within M16**
      (2026-10-18 and its second pass, 2026-10-19; found unchecked here 2026-10-26): the book's
      AI page (Claude, its key sealed, guidance, account creation and how eagerly), the AI
      categorizer at the end of the chain, and Select mode's Suggest categories asking it (the
      bulk action), live since the first release. The migration's reference (2026-10-26) gives
      it the book's history by payee. Still open: whether imports and bank feeds ask the AI by
      themselves (they don't; [M99](milestones/m99-follow-ups/PLAN.md#open-questions)'s open
      questions).

### Polish, built

Smaller improvements picked up between milestones. Those still open are in
[M99](milestones/m99-follow-ups/PLAN.md#polish).

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
- [x] **Bank feeds on demand** (2026-10-24): `LUMINOUS_MONEY_SIMPLEFIN_MODE=on-demand` stops the
      morning sync (only Sync now), for the dev stack.
- [x] **Review newest first** (2026-10-17), the latest entered of a day first too.
- [x] **Pair transfers in review** (2026-10-17): money out of one account and the same into
      another within 7 days, both imported, become one transfer, with "Reject" to restore the
      two.
- [x] **Delete a transaction from its page** (Kael, 2026-11-06), asking first.
- [x] **Kael's nits, 2026-11-07** (`v0.1.25`):
  - **Review:** Back or Confirm on a transaction opened from the queue comes back to the same
    place (it was the top, or with skipped ones the bottom); an account picker opens with the
    chosen account's name to edit into a new one (Tab fills in the highlighted one); the fund
    choice is quieter and as wide as the card; tags on each card; a search (payee,
    description, items) and a filter by accounts (any of them, and tags), which Back keeps.
  - **Transactions:** the same search, and a filter by accounts beside reconciliation and tags
    (the ledger's `/journal` takes `q` and `account`).
  - **Bank connections:** each connection is "SimpleFIN" and its id's first 8 characters, with
    a rule between its accounts.
  - **Home:** funds are starred (★ on a fund's page; a new fund is starred for whoever made
    it), and home's Funds card lists only those, its heading inside it, and only when there
    are any; "+ Add an account" is a short rule. The spending chart was checked against the
    live book: it reads real data (see RESUME).
- [x] **Go to a date in an account's ledger:** a partial view from that date back, loading
      newer pages above ("Load more") and older ones as you scroll.
- [x] **Kael's changes, 2026-11-12** (`v0.1.27`):
  - **The split editor:** a transaction's (and a schedule's) splits are shown as they are (memo
    and tags, then account and amount), each opened in a dialog with its memo (now editable),
    account, amount, tags and tolerance; "+ Add split" opens a blank one. A long press or a
    modifier click starts Select mode for splits (Add tag…, Delete). No fund per split yet
    (split-level tags and funds' step 2).
  - **Bank feed errors where they're about:** one bank's login showed on every linked account;
    now an account's page shows only an error naming it, and the rest (the Bridge's plain
    strings) are the connection's: on its card and in the bell, dismissable per person (the
    first notification that can be).
  - **Confirmed stays confirmed:** a bank row matched to a transaction already confirmed (a
    receipt, typed by hand) is final at once, out of review.
  - **Where a price came from:** a bank feed's prices said "entered by hand"; each price now
    keeps its source (bank, fetched, by hand) and Commodities says it.
- [x] **"Repeat…" doesn't copy where a transaction came from** (2026-11-13): a schedule made
      from a bank row carried its import ID into every occurrence; the template now keeps only
      the transaction's `budget` choice (`fromTransaction` in `ScheduleEditor.tsx`).
- [x] **Kael's changes, 2026-11-14:**
  - **An opening is never spending:** what escrow held when a loan came into the books counted
    as that month's spending under Outflows. Balances stated (opening balances, a loan's
    "Borrowed" or "What's owed", "What escrow holds") are marked `opening: TRUE`, and the lens
    leaves them be (ledger migration 15).
  - **"Counted as spending here":** an expense account that a loan or escrow counts as shows
    what's counted there (this month, the 6-month average) and links to it, rather than only
    its balance of $0.
  - **The breakdown's transactions:** Reports' breakdown lists every transaction under where
    it is, in a small scrolling window, as Transactions lists them; the drill is in the
    address.
  - **Leave out what's excluded from budgets** (Reports, `?budgeted=only`): cash flow, the
    breakdown and its transactions, and the largest without what `budget: FALSE` keeps out of
    budgets. Off by default.
  - **A tag filter lists its tags on focus,** narrows as you type, and says when nothing
    matches (Reports, ledgers).
