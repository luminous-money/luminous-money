M1: One bank account, end to end: plan
==================================================================================================

How [SPEC.md](SPEC.md) gets built. The spec is still being written, so parts of this plan are
placeholders, marked _(spec pending)_. Where the spec leaves a gap, this plan proposes something,
marked **Proposed**; the choices that are really the user's call are collected under
[Questions](#questions) at the end.

## Approach

- **Build in vertical slices.** Each slice works end to end (API, UI, tests) before the next
  starts, and ends with `pnpm test` and `pnpm e2e` green.
- **Final structure, stubbed behavior.** Auth, users and book ownership take their real shape
  now (a separate `auth` service, JWTs, Traefik forwardAuth, owners on books). Only the behavior
  is stubbed: there's one user, and logging in always returns that user's token. M6 then fills
  in behavior without moving anything.
- **Reuse what exists:** the transaction detail editor, the account picker, and the review
  queue (which is where imported transactions land for now).

## Decisions this plan makes

### Users, sessions and the `auth` service

- **A new `auth` service (TypeScript)** at `/api/auth/v1`, owning its own SQLite database (see
  "TypeScript databases" below), as the design already calls for.
  - A `user` table, created by a migration, holding **one stub user**.
  - `POST /login` returns the stub user's JWT, whatever is sent. M6 replaces this with real
    credentials.
  - `POST /logout`, `GET /me`, and `GET /verify` (for Traefik).
- **JWTs are signed with HS256,** using a secret from the environment (`AUTH_JWT_SECRET`, with a
  generated development default in the Compose file). **Proposed:** a 30-day lifetime, and no
  refresh until M6.
- **The session lives in an `HttpOnly`, `SameSite=Strict` cookie** set by `/login`, so the PWA
  never handles the token. **Proposed:** `Authorization: Bearer` is also accepted, for tests and
  non-browser clients.
- **Traefik's forwardAuth guards every API route** except `/api/auth/v1/login`.
  - On success, it passes the user's ID to services as `X-User-Id`.
  - Services trust that header because they're only reachable through Traefik, on the internal
    network.
  - The PWA's static files under `/ui` stay public, so the login screen can load.

### TypeScript databases: a shared `packages/db`

`auth` now, and `app` for import profiles and batches, need SQLite. The same rules apply as in
`ledger`:

- **`node:sqlite`, built into Node 22,** so there are no native modules to build for ARM. It
  prints an "experimental" warning, which we accept.
- **Migrations are numbered and append-only,** tracked by `user_version`.
- **A `createTable` helper** adds non-null `created_at`/`updated_at`, with the same timestamp
  format and strictly increasing versions as `ledger`'s.
- **A lint check** fails on any `CREATE TABLE` outside the helper, run by `pnpm test` (checked
  in the TypeScript syntax tree, like the Python one).

### Books belong to users

- **A ledger migration gives `book` a display `name` and an `owner_id`.**
- **Book IDs become generated,** separate from names, so a book can be renamed.
- **Book endpoints are scoped to the caller:**
  - `GET /books` lists the caller's books
  - `POST /books {name}` creates one
  - `PATCH /books/{id} {name, updated_at}` renames one, versioned like other edits

  Any book endpoint for a book the caller doesn't own answers 404.
- **Setup's only job is to make the first book** (and the account). "Manage books" lists the
  caller's books and renames them; creating more books waits for M7.

### Money accounts

The open question in [the global plan](../../PLAN.md#open-questions) gets answered for M1.

- **Proposed: money accounts are marked explicitly,** with metadata on their `open` directive:
  - `money: "bank"`: the kind of money account. Others come later: `credit-card` in M2,
    `brokerage` in M5.
  - `display-name: "PNC Checking"`: a human name, spaces and all, since account names can't
    have spaces.
  - `institution: "PNC"`, optionally.

  The `Account` API model gains `money`, `display_name` and `institution`.
- **Active accounts** are money accounts that aren't closed.
- **The add-account flow** asks for:
  - **the name** (e.g. "PNC Checking")
  - **the type** (only "Bank account" in M1)
  - **the current balance and its as-of date** (decided)

  It creates `Assets:Bank:PNC-Checking`, deriving the path from the name and showing it. It also
  records an opening-balance transaction against `Equity:Opening-Balances` on the as-of date, so
  the balance is right from the start.

### Balances and "last updated"

- **Balances come from SQL,** not a Beancount load, so the home page stays fast at any book size.
  - A ledger migration adds an `amount` column to `posting`, filled at write time.
  - For plain currency postings it's the posting's amount. For the elided posting it's what
    balancing fills in (minus the sum of the others), when that's unambiguous: a single currency,
    no costs or prices.
  - Otherwise it stays NULL, and that account's balance falls back to Beancount. That's rare for
    bank accounts, and it's when background validation would become relevant.
- **Pending (`!`) transactions count** toward balances (decided).
- **"Last updated at" is the account's last import** (decided; later, its last SimpleFIN sync).
  `app` owns imports, so it reports each account's last import time (the latest `import_batch`
  for the account). The home page shows it next to the ledger's balance, or "No imports yet".

### The account ledger API

- `GET /books/{book}/accounts/{account}/ledger?cursor=…&limit=200` returns transactions newest
  first. Each row has:
  - `id`, `date`, `flag`, `payee`, `narration`, `updated_at`
  - `amount`: the account's net change in that transaction
  - `balance`: the account's running balance after it, pending included
  - `counterpart`: the other split's account for a two-split transaction, or `null` for
    multi-split ones, which the UI shows as `<multiple>`
- **Keyset pagination** on (date, ordinal), with an opaque `cursor`, so pages stay stable as
  transactions are added.
- **Running balances** come from a SQL window function over the account's postings. That's fast
  enough per account at decades of data; the benchmark will confirm.

### Importing CSVs (in `app`)

- **The app database holds:**
  - `csv_profile`: per account, the mapping from CSV columns to our fields, plus parsing details
  - `import_batch`: one per uploaded file
  - `import_row`: one per CSV row, with the raw row, its normalized fields, its outcome, and its
    match candidates
- **Parsing:** **proposed:** use `papaparse` (small, well tested, works in the browser and on the
  server). The server parses with the saved profile; the browser only previews while profiling.
- **Profiling a new account's CSV:** the console shows the file's columns with sample rows and
  guesses the mapping from header names and values:
  - the **date**, and its format
  - the **amount**: either one signed column, or separate debit and credit columns
  - the **description**
  - **proposed, optional:** a bank transaction ID and a running balance

  You confirm or correct it, and it's saved to the account. **Proposed:** a saved profile can be
  edited later from the import console.
- **Re-importing the same rows can't duplicate them.** Each row gets a fingerprint (date, amount,
  description, and its position among identical rows in the file), stored as `import-id`
  metadata on the transaction it becomes. A row whose fingerprint already exists is skipped and
  reported as such.

### The processing pipeline (identifying and ranking matches only)

- **The resolver interface is the one in the design,** so M4 can add resolvers without
  restructuring: a batch plus context in, resolutions out, with resolvers chained. M1's chain is
  just the **matcher**.
- **The context** is the account's existing transactions around the batch's dates.
- **The matcher** compares each row with existing transactions in the account. It ranks
  candidates with the **same amount** by **closeness in date**, within a window
  (**proposed:** ±5 days), and returns a ranked array per row (decided: amount and date only).
- **M1 builds only the mechanics of identifying and ranking matches** (decided). Acting on
  matches comes later: a clear winner taking over, ranked options in the review queue, matches
  cleared on confirm, matched rows falling out of the import. The notes are in the spec.
- **So for now, every new row becomes a staged (`!`) transaction** anchored on the account. Its
  other side is `Expenses:Uncategorized` (money out) or `Income:Uncategorized` (money in), since
  categorization is M4. The row's ranked candidates are stored with it (on `import_row`) and
  listed on the import results screen. Nothing acts on them yet.

### The PWA

- **Routes** (under `/ui`):
  - `login` and `setup`
  - `/`: home
  - `books`: manage books
  - `accounts/:book/:account`: an account's ledger
  - `import`: the import console
  - `books/:book/transactions/:id`: the existing transaction detail editor
  - `books/:book/review`: the existing review queue
- **The app decides where you land:**
  - not logged in: the login screen
  - logged in with no books: setup
  - otherwise: home
- **A hamburger menu** with **Home**, **Manage books** and **Review** (decided), plus **Log out**.

## Work, in order

Each slice ends with its tests (unit, API end-to-end and browser end-to-end) passing, and with
the docs, `docs/PLAN.md` and `RESUME.md` updated.

1. **`packages/db`** (the TypeScript migration framework): `node:sqlite` wrapper, numbered
   migrations, `createTable`, timestamps, and the lint check. Unit tests.
2. **Users and sessions:**
   - the `auth` service with its stub user, plus login, logout, me and verify
   - forwardAuth on every API route, and `X-User-Id` reaching the services
   - the login screen (with "Create account" disabled), and logging out
   - tests proving that every API route rejects a request without a session
3. **Books belong to users:**
   - the ledger migration, scoped book endpoints, and generated IDs
   - the setup page's book step, the hamburger menu, and Manage books (list, rename)
   - `pnpm seed` gives the demo book to the stub user
4. **Money accounts:**
   - the metadata and the `Account` model's new fields
   - the add-account flow, with the opening balance, used from setup
   - posting amounts (migration plus backfill on write), balances from SQL, and "last updated"
   - the home page's account cards
5. **The account ledger:**
   - the ledger API (keyset pages, running balances, counterpart or `<multiple>`)
   - the ledger view with infinite scroll, and clicks opening the detail editor
   - a performance check against the decades-scale benchmark book
6. **Add a transaction:** a persistent line at the bottom of the account ledger opens an empty
   transaction editor (decided). **Proposed:** it's empty apart from a split on this account and
   today's date, since that's the one thing known. Saving adds the transaction to the ledger.
7. **CSV import:**
   - the app database tables
   - the import console (account drop-down, file button and drop zone)
   - profiling and saving a profile, parsing with it, fingerprints and duplicate skipping
   - batch and row storage
8. **The pipeline:**
   - the resolver interface and chain, the context builder, and the matcher with ranked
     candidates (identifying and ranking only)
   - staging rows, and the import results screen listing each row's candidates
9. **M1 wrap-up:**
   - one browser test walking the whole path: log in, set up, add the account, import, see it
     in the ledger
   - updated demo data, and the docs

## Out of scope for M1

- **Real accounts, credentials and permissions:** M6.
- **More than one book in the UI:** M7. A user has exactly one book in M1.
- **Credit cards** and matching across two accounts: M2.
- **Categorization:** M4. Imported transactions are uncategorized.
- **Investment accounts:** M5.
- **Bank feeds:** M12.

## Questions

**Answered:**
- **Opening balance:** yes.
- **"Last updated at":** the last import (later, the last SimpleFIN sync).
- **Review:** yes, in the menu.
- **Match candidates:** M1 builds only identifying and ranking. The notes for later are in the
  spec.
- **Add transaction:** a persistent line at the bottom of the account ledger, opening an empty
  transaction editor.

**Still open.** The proposals stand as defaults unless changed:

1. **Marking money accounts:** explicit metadata (`money`, `display-name`, `institution`;
   proposed), or derived from where the account sits?
2. **Account names:** is the derived path (`Assets:Bank:PNC-Checking`) right, and should it be
   editable in the add-account flow, or hidden behind the display name?
3. **Manage books in M1:** just list and rename (proposed), or also create and delete?
4. **Matching window:** ±5 days (proposed)?
5. **CSV fields:** besides date, amount (signed, or debit/credit) and description, should profiles
   capture a bank transaction ID and a running balance? A running balance could feed balance
   checks.
6. **Duplicate rows:** skip rows whose fingerprint was already imported (proposed), or show them
   as duplicates for confirmation?
7. **Sessions:** a 30-day JWT with no refresh until M6 (proposed)?
