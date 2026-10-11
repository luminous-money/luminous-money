Plan
==================================================================================================

The roadmap, as milestones. The reasoning behind each piece lives in
[docs/design.md](docs/design.md); where work stands right now lives in [RESUME.md](RESUME.md).

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

- [ ] **M1: One bank account end-to-end.**
  - the "brand new empty user" homepage
  - the add-an-account flow
  - the homepage with accounts
  - the simple account-anchored ledger view (click to see/edit details)
  - the "add transaction" flow
  - the import CSV flow (with transaction matching but not categorization yet, so an abridged
    version of the processing pipeline)
  - CSV profiling (storing the structure of each account's CSV file)
- [ ] **M2: Credit card account.** Much of the same as M1, plus some minor display decisions,
      and testing matching with two accounts that reflect two sides of the same transaction.
- [ ] **M3: Scheduled transactions.** The editor, storage, generator logic (when and how real
      transactions are created from a schedule template), and display considerations.
- [ ] **M4: Categorization.** The categorization engine.
- [ ] **M5: Investment accounts.** Lean on what Beancount already provides. The main
      deliverable: storing non-currency holdings, with a currency representation of their value.
- [ ] **M6: Auth.** Account creation, log in, log out, book ownership and permissions.
- [ ] **M7: Multiple books per account.**
  - managing multiple books per account, and their visibility (e.g. see only my accounts, only
    our shared accounts, or both together)
  - each account clearly belongs to exactly one book
- [ ] **M8: Sharing books with other users.** Any user can be added to a book with read, write
      or manage permissions. Every book has an owner.
- [ ] **M9: Cross-book transactions.** A single transaction that straddles more than one book,
      such as a salary that flows into a personal and a shared bank account.
- [ ] **M10: Reports.** From basic to more complex.
- [ ] **M11: Budgets.**
- [ ] **M12: SimpleFIN.** Bank feeds.

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
    running balance, and pending (`!`) transactions count.
  - **A read-only view:** a prettier, one-line format for reading. Tapping a transaction opens
    it for editing, including complex splits.
- **Money accounts** (M1, M2, M5): accounts linked to a real institution that actually hold
  money, such as bank accounts, credit cards, brokerage accounts, other asset accounts and
  loans. The home screen lists them with their balances. Other places likely to treat them
  specially: the anchor side of imports, CSV and bank-feed imports, reconciliation and balance
  assertions, and net worth.
- **Chart of accounts:**
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
- **Cross-book transactions** (M9):
  - account pairs, mirroring, and pair-balance assertions
  - a group editor that edits every leg at once and saves only when all of them balance
  - multi-book schedule templates (salary)
  - matching imports to scheduled legs
- **Reports** (M10):
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
  - each target can roll over from period to period, or not
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

- **Marking money accounts:** is it an explicit property of the account (metadata on its `open`
  directive, such as the institution's name), or derived from where it sits (leaves under
  `Assets` and `Liabilities`)? Derived is simpler, but not every asset leaf is held at an
  institution, and some may never be (a car, say).
- **Resolver contract:**
  - What does confidence mean, and is it comparable across resolvers?
  - Can a resolver return a partial answer (e.g. a match with a suggested split)?
  - Should high-confidence matches ever auto-confirm, or does everything go through review?
- **Budget display across periods** (to revisit): budgets can have any period. How does a view
  show accounts whose budgets have different periods side by side?
- **Cutover:** deferred until hydration.
