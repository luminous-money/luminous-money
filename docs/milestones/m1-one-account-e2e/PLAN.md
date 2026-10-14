M1: One bank account, end to end: plan
==================================================================================================

How [SPEC.md](SPEC.md) gets built. Where the spec left a gap, this plan proposed something,
marked **Proposed**.

> **Status: built (2026-10-11).** Every slice below is done, with its unit, API and browser
> tests. The open questions were answered with best guesses, and every guess and judgment call
> is listed under [Decisions to review](#decisions-to-review) for the user to weigh in on.

## Approach

- **Build in vertical slices.** Each slice works end to end (API, UI, tests) before the next
  starts, and ends with `pnpm test` and `pnpm e2e` green.
- **Final structure, stubbed behavior.** Auth, users and book ownership take their real shape
  now (a separate `auth` service, JWTs, Traefik forwardAuth, owners on books). Only the behavior
  is stubbed: there's one user, and logging in always returns that user's token. M10 then fills
  in behavior without moving anything.
- **Reuse what exists:** the transaction detail editor, the account picker, and the review
  queue (which is where imported transactions land for now).

## Decisions this plan makes

### Users, sessions and the `auth` service

- **A new `auth` service (TypeScript)** at `/api/auth/v1`, owning its own SQLite database (see
  "TypeScript databases" below), as the design already calls for.
  - A `user` table, created by a migration, holding **one stub user**.
  - `POST /login` returns the stub user's JWT, whatever is sent. M10 replaces this with real
    credentials.
  - `POST /logout`, `GET /me`, and `GET /verify` (for Traefik).
- **JWTs are signed with HS256,** using a secret from the environment (`AUTH_JWT_SECRET`, with a
  generated development default in the Compose file). **Proposed:** a 30-day lifetime, and no
  refresh until M10.
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
  caller's books and renames them; creating more books waits for M6.

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

- **Real accounts, credentials and permissions:** M10.
- **More than one book in the UI:** M6. A user has exactly one book in M1.
- **Credit cards** and matching across two accounts: M2.
- **Categorization:** M4. Imported transactions are uncategorized.
- **Investment accounts:** M5.
- **Bank feeds:** M11.

## Questions

**Answered by the user:**
- **Opening balance:** yes.
- **"Last updated at":** the last import (later, the last SimpleFIN sync).
- **Review:** yes, in the menu.
- **Match candidates:** M1 builds only identifying and ranking. The notes for later are in the
  spec.
- **Add transaction:** a persistent line at the top of the account ledger (first built at the
  bottom), opening an empty transaction editor.
- **After trying it (2026-10-11):**
  - Skipping rows before the opening balance is right, and moving the opening balance back must
    move the cutoff with it. Built: see decision 1.
  - An account's ledger links to importing into that account, and back.
  - The transaction editor's Back and Save stay pinned to the bottom of the screen until the page
    is scrolled past where they belong.

**Answered by best guess** (the proposals, as built): marking money accounts explicitly, a derived
account path, list-and-rename for Manage books, a ±5-day matching window, profiles that capture
the bank's transaction ID and running balance, skipping duplicate rows, and 30-day sessions. All
of them are in [Decisions to review](#decisions-to-review).

## Decisions to review

Guesses and judgment calls made while building M1, most consequential first. Each says where your
input is wanted.

### Accounts and balances

1. **Opening balances and the as-of date.**
   - The account opens on the as-of date, with an opening-balance transaction against
     `Equity:Opening-Balances`.
   - The balance means "at the end of that day", so **imported rows dated on or before the as-of
     date are skipped** as already counted ("before the opening balance").

   _Answered:_ yes. Older history imports by moving the opening balance back: the cutoff is the
   opening-balance transaction's date (`as_of` on money accounts), not the account's `open`, and
   the `open` moves back to meet any earlier posting. A zero balance still gets an opening-balance
   transaction, so every account has one to move.
2. **Money accounts are marked explicitly:** `money: "bank"`, `display-name` and `institution`
   metadata on the `open` directive.
   - **The path follows the name** (`Assets:Bank:PNC-Checking`) until it's edited.

   _Answered:_ don't constrain it. The path is editable, with the same autofill and checks as
   creating any account, and can be anything the account rules allow: under a top-level account,
   below a node, not already taken.
3. **New transactions from the ledger's "Add transaction" line are saved confirmed (`*`),**
   since they're written by hand. They start with a split on the account and today's date.
   _Answered:_ confirmed is fine.
4. **Balances and ledgers come from SQL, recomputed per request** from the account's whole history.
   - That's about 90 ms a page on the laptop for the busiest account of a decades-scale book,
     which is likely around a second on a Pi 3.
   - Fine for now. If it isn't on the Pi, cache running balances.

### Importing

5. **A file that fits none of an account's saved formats asks first.** "The uploaded file doesn't
   match the saved format for this account. Are you sure this file is for the account
   '<account name>'?", with:
   - **Yes, replace saved format:** profile the file, and keep only the new profile.
   - **Yes, this is an additional format for this account:** profile the file, and keep it
     alongside the others.
   - **Cancel.**

   An account can have several profiles; a file is read with the first one it fits. (Answered.
   Managing saved formats directly is a Polish task in the [plan](../../PLAN.md#polish).)
6. **Where CSV fields go:** the bank's description becomes the transaction's description
   (narration), editable in the review queue. A payee column, if mapped, becomes the payee.
   _Answered:_ fine as it is.
7. **Duplicates are skipped and counted, not shown for confirmation.**
   - A row is recognized by the bank's transaction ID if the profile maps one. Otherwise it's
     the date, amount and description, plus which occurrence of those it is in the file, so two
     identical coffees on one day both import.
   - If you delete a staged transaction, re-importing the same file won't bring it back.
8. **Guessing profiles:**
   - Dates are read month-first when a file is ambiguous (every day 12 or under).
   - Decimal commas ("1.234,56") aren't supported yet.
   - A stray bad row doesn't stop the guess; it's reported as unreadable on import.
9. **Uncategorized accounts:** `Expenses:Uncategorized` (money out) and `Income:Uncategorized`
   (money in) are created on the first import that needs them.
10. **Imports aren't one transaction across services.** The ledger write (staging) commits first,
    then `app` records the batch. If `app` failed in between, the staged transactions would exist
    unrecorded, and a re-import would duplicate them. That's rare, and acceptable until it isn't.
11. **Matching:** the same amount within ±5 days, scored linearly by days apart, with ties broken
    by ID. Candidates are stored on the import's rows and shown on the results screen. Nothing
    attaches them to transactions or the review queue yet (deliberately deferred).

### Users, sessions and books

12. **Sessions:**
    - a 30-day JWT (HS256) with no refresh
    - an `HttpOnly`, `SameSite=Strict` cookie, made `Secure` only behind HTTPS (when Traefik
      sees `X-Forwarded-Proto: https`)
    - Bearer tokens also accepted, for scripts and tests
    - logging out clears the cookie, but a stolen token stays valid until it expires (M10)
13. **The JWT secret:** Compose ships a development default, and the auth service warns when it's
    in use. Set `AUTH_JWT_SECRET` before the stack leaves your laptop. _Skipped for now:_ whether
    a missing secret should refuse to start.
14. **Test users (`AUTH_TEST_USERS`):** an opt-in auth mode, only for test stacks, where `login`
    takes an email and logs in a separate user for it. Each browser and API test gets a user of
    its own, so tests never share books. It's off unless set; `pnpm e2e` turns it on. Kept as is
    (no objection).
15. **Book names are the book's Beancount `option "title"`,** so exports and backups carry them.
    Book IDs are generated. Books from before ownership existed have no owner and are invisible.
16. **Setup appears only for a user with no books,** and stays up until the first account is
    added. A user with several books (only possible through the API in M1) sees the oldest.
17. **Backups are per user, through the API.** _Answered:_ any user can export their own data.
    - **Manage books → Export** downloads a book as one Beancount file (`<Book-Name>.beancount`,
      from `/books/{id}/export`), which `/books/{id}/import` restores.
    - **`/backup?since=`** gives each of the caller's books changed since a cursor, for scheduled
      backups.
    - There's no operator-wide backup; backing up the data volume covers everything.
    - CSV profiles and import history (in `app`) aren't part of the export.

### Infrastructure

18. **Every service shares the one data volume as UID 1000** (`ledger.sqlite`, `auth.sqlite`,
    `app.sqlite`), so backing up the volume backs up everything. The ledger image gained a
    `ledger` user for this.
19. **The TypeScript services use Node's built-in `node:sqlite`,** which Node 22 calls
    experimental; its warning is silenced. If it changes before going stable, the swap is
    contained to `packages/db`.
20. **Routing:** every API except auth's goes through Traefik's forwardAuth. A client-sent
    `X-User-Id` is ignored: without a session it gets 401, and with one Traefik overwrites the
    header.
