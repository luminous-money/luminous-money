Plan
==================================================================================================

The roadmap, in order. The reasoning behind each piece lives in [docs/design.md](docs/design.md);
where work stands right now lives in [RESUME.md](RESUME.md).

The overall order is fixed by one decision: **build and polish the UI against test data first,
and only then hydrate with real finances**, because importing real transactions commits us to
the system.

## Phase 1: Foundations

- [x] Engine spike: database as the system of record, Beancount as the engine, round-trip
      fidelity, incremental backups (`services/ledger`)
- [x] Decades-scale benchmark harness (`services/ledger/bench`)
- [x] Monorepo tooling: bake, pnpm workspace, generated `ledger-client` with a drift check
- [x] Compose stack and routing shell: Traefik, `ledger`, `app`; `/api/*` and `/ui/*`
- [x] End-to-end test harness against a throwaway stack (`pnpm e2e`, `tests/e2e`)
- [ ] Deploy with `docker stack deploy` on a real Swarm. `docker stack config` already accepts
      the file; the Pi is the natural place to do this.
- [ ] Asynchronous, debounced validation in `ledger`; writes do structural checks only
- [x] Structured (JSON) writes in `ledger`, so Beancount syntax stays in one service; typed
      responses throughout the API
- [ ] `auth` service: users, login, JWT issuance, the forwardAuth verify endpoint; attach
      forwardAuth to every route

## Phase 2: The review app

- [x] `app` service skeleton: PWA shell (React + Vite + `vite-plugin-pwa`) with a landing page at
      `/ui`, Hono serving `/api/app/v1`
- [x] Review queue: list staged entries, skip, categorize, edit descriptions, confirm with one
      tap; detail view with a full split editor and a live balance check
- [x] Swipe right to confirm, left to skip; cards that aren't ready spring back; the stack slides
      up after a confirm or skip
- [x] Leaf and node accounts; "Create account" from any posting-account picker
- [x] Versioned, partial edits (PATCH with `updated_at`, 409 on conflict); TanStack Query
- [x] Create accounts by fully qualified name, prefilled from the search
- [x] snake_case everywhere, the API's JSON included
- [x] Migration framework: every table through `create_table` (created/updated timestamps), with
      a lint check
- [x] Browser end-to-end tests (Playwright) as part of `pnpm e2e`
- [ ] Bulk categorization
- [ ] CSV import as a participant
- [ ] Context builder (14-month window) and the resolver chain: `matcher`, then `rules`, with
      `external` as a configurable slot
- [x] Demo books for UI work: `pnpm seed` stages recent purchases of a `bean-example` history
- [ ] Richer synthetic data: denser purchase history, more payees, several books with cross-book
      pairs (needed by Phase 6)

## Phase 3: Chart of accounts and the general ledger

- [ ] **Chart of accounts:** a UI for viewing and managing a book's accounts.
  - [ ] View the tree: nodes and leaves, types, open and close dates.
  - [ ] Create accounts (reusing the create-account dialog).
  - [ ] Edit accounts: rename, change leaf/node where the rules allow, close.
  - [ ] Move accounts between parents, carrying their history. Renames and moves rewrite every
        directive that mentions the account, history included (decided: acceptable).
  - [ ] Open any account's ledger from the tree.
- [ ] **General ledger:** every split in the book, in chronological transaction order.
  - [ ] The split is the primary unit of the list. Transactions are visually demarcated.
  - [ ] Reversed and paginated: the most recent transactions at the bottom, and earlier pages
        load automatically when scrolling toward the top.
  - [ ] The bottom row is always an empty transaction. Entering one commits it in place and
        opens a new empty row below.
  - [ ] A simple, intuitive way to add and remove splits. A transaction won't save unless its
        splits balance.
  - [ ] Each transaction shows how much is left to distribute across its splits.
  - [ ] Confirmed or not is a transaction-level checkbox.
  - [ ] Any transaction's date can be set by hand. That's the transaction's date, separate from
        `created_at`.
  - [ ] Scopable to a single account, so the same component is each account's ledger. Scoped to
        an account, every line shows that account's running balance, and pending (`!`)
        transactions count toward it.

## Phase 4: Reports

- [x] Drop Fava; reports are our own (2026-10-09). It can come back easily if it's ever wanted.
- [ ] **Check what already exists before building anything:** libraries that generalize reports
      and graphs over ledgers, and graphing libraries to wrap.
- [ ] **Two separate, independent libraries,** because ledgers are a generic class of object
      worth generalizing over. If we build them, they're built and published from a small public
      monorepo in the luminous-money GitHub account, loosely based on the wymp monorepo proof of
      concept:
  - [ ] `@luminous-money/ledger-graphs-api`: a plugin for a ledger's API. It returns data sets
        for the requested graph and parameters.
  - [ ] `@luminous-money/ledger-graphs-ui`: a wrapper around a good graphing library that renders
        those data sets.
- [ ] **Expense pie chart:** selectable account depth, number of slices, date bounds, and optional
      averaging per period.
- [ ] **Income pie chart:** the same options.
- [ ] More reports to come (details to follow).

## Phase 5: Budgeting

- [ ] A target budget on any account, for any period (monthly, quarterly, yearly, ...).
- [ ] Validation: no descendant account may have a higher base budget than its ancestor (base
      amounts, before any rollover).
- [ ] Each budget target can roll over from period to period, or not.

## Phase 6: Many books

- [ ] Cross-book groups: account pairs, mirroring, pair-balance assertions
- [ ] Group editor: edit every leg at once; save only when all of them balance
- [ ] Scheduled templates, including multi-book templates (salary)
- [ ] Matching imports to scheduled legs

## Phase 7: Feeds and prices

- [ ] SimpleFIN importer
- [ ] `bean-price` on a schedule; manual price entry for illiquid assets

## Phase 8: Deploy to the Pi

- [ ] Run `bench.py` on the Pi 3 and revisit the performance assumptions
- [ ] Publish multi-arch release images; operator docs for standing up the stack
- [ ] Optional: a Pi image that wraps the Compose file

## Phase 9: Hydration

- [ ] Choose the cutover date and the source of opening balances
- [ ] Open real accounts, connect live feeds, retire GnuCash to read-only

## Deferred

- Cati as an `external` resolver
- Per-book permissions
- Archiving closed periods (only if the Pi benchmark calls for it)
- A native mobile app

## Open questions

- **Asynchronous validation:** how do the app and the user see that a book is being re-validated
  and that its problem list is stale?
- **Resolver contract:**
  - What does confidence mean, and is it comparable across resolvers?
  - Can a resolver return a partial answer (e.g. a match with a suggested split)?
  - Should high-confidence matches ever auto-confirm, or does everything go through review?
- **Budget display across periods** (to revisit): budgets can have any period. How does a view
  show accounts whose budgets have different periods side by side (normalize to a common period,
  show each in its own period, or something else)?
- **Cutover:** deferred until hydration.
