M6: Multiple books: plan
==================================================================================================

> **Status: built (2026-10-14),** with unit, API and browser tests. The
> [answers](#answers-2026-10-14) settle the questions. One change while building: the orphan
> sweep was dropped, since `app` forgets a deleted book in one local transaction right after the
> ledger deletes it; and a taken name is a 422, not a 409 (which the app reads as "changed
> elsewhere").

## Answers (2026-10-14)

1. **The last book is remembered per device.**
2. **Deleting is permanent,** behind typing the book's name, with Export offered (not required).
3. **Creating a book from a Beancount file is in M6.**

## What M6 is

A user can have several books, and **the selected book is the context for everything**, like
switching profiles. Everything built so far keeps working exactly as it does today, on the
selected book's data. There's no combined view across books, and no transactions across books:
cross-book transactions were dropped (2026-10-14; see [the plan](../../PLAN.md)). Books are
independent.

So M6 is a **book switcher**, a **books manager**, and making sure every page and call is
scoped to a book.

## What exists today

- **The APIs are already book-scoped.** Every `ledger` and `app` route is under
  `/books/{book}/…` (checked), except the ones that can't be:
  - the book list and book creation
  - backups, which span every book
  - health checks, and `auth`
- **The ledger has many books per owner:**
  - Create, list, rename, export, and import of Beancount text into a book all work.
  - **A book can't be deleted.**
- **The PWA assumes one book.** `useCurrentBook()` is the first book. Three routes and four menu
  links use it:
  - routes: `/` (home), `/import`, `/accounts/new`
  - menu links: Review, Schedules, Rules, Commodities

  Every other page is already under `/books/:book/…`.
- **Manage books** lists, renames, sets the time zone and exports. It can't create books.
- **Daily jobs** (schedules, prices) loop over `app`'s `book_setting`. A book without a row (the
  demo book) gets no morning price run.

## Decisions this plan makes

### The selected book lives in the URL

- **Every page moves under `/books/:book/…`:**
  - `/books/:book` is home
  - `/books/:book/import`
  - `/books/:book/accounts/new`

  The menu's links all point into the current book. Links and bookmarks always say which book
  they're for, and the back button never lands you in the wrong one.
- **`/` goes to the last book you used** (or the first), then Setup if you have none.
- **Proposed: "last used" is remembered per device,** in local storage, as profile pickers
  usually do ([question 1](#questions)).
- **A book ID in the URL that isn't yours** gets the same "Nothing here" as any unknown page.
- **`useCurrentBook()` goes away;** pages get the book from the route. TanStack Query keys are
  already per book, so switching never shows another book's cached data.

### The switcher

- **The masthead shows the current book's name.** Tapping it lists your books, plus "Manage
  books". Picking one goes to that book's home.
- **With only one book,** the name still shows but there's nothing to switch to, so the list just
  offers "Manage books".

### The books manager

- **Create a book:** a name and a time zone (the browser's).
  - It's one new `app` route that creates the ledger book and its `book_setting` row together.
    Today the PWA makes two calls, and a book can end up without a time zone.
  - The new book opens afterwards.
  - **Names are unique per user,** case-insensitively, since the switcher shows names alone.
- **Proposed: create a book from a Beancount file.** Upload an export and it becomes a new book.
  That closes the loop on the user-facing export, so it's also a restore. If Beancount reports
  errors, they're shown and nothing is created.
- **Delete a book** ([question 2](#questions)):
  - **Proposed:** permanent, behind a confirmation where you type the book's name, with "Export
    first" right there.
  - **Ledger:** a new versioned `DELETE /books/{id}` tombstones every directive (so incremental
    backups carry the deletion), then removes the book.
  - **`app`:** a new `DELETE /api/app/v1/books/:book` calls the ledger first, then removes the
    book's own rows in one transaction:
    - stars, CSV profiles, imports
    - schedules, rules, proposals
    - settings, price runs

    If the second step fails, the leftover rows belong to a book that no longer exists, and are
    swept on `app`'s next start.
  - Deleting your last book takes you to Setup.
- **Every book gets a time zone.** The book list returns each book's zone. If a book has none (the
  demo book), the PWA sets it to the browser's once, just as Setup does. That fixes the M5 gotcha
  where the demo book got no price run.
- **Rename, time zone and export** stay as they are.

### Demo data

`pnpm seed` adds a small second synthetic book, "Demo Household": one starred checking account
and a few months of made-up transactions. That gives the switcher something to switch to.

## How it gets built

1. **Ledger:**
   - `DELETE /books/{id}`
   - unique names on create and rename
   - tests, then `pnpm generate`
2. **`app` server:**
   - `POST /books` (the book plus its settings)
   - `DELETE /books/:book` (with cleanup)
   - time zones in the book list
   - the orphan sweep
   - unit tests
3. **PWA:**
   - book-prefixed routes, with `/` redirecting
   - the masthead switcher
   - the menu
   - the books manager: create, from a file, delete, and the time zone backfill
4. **Seed, tests and docs:**
   - **API e2e:**
     - create, then delete: the app's rows go too, and the backup shows tombstones
     - duplicate names are refused
     - another user's book still 404s
   - **Browser tests:**
     - switch books, and each book's home, review and import show only its own data
     - `/` returns to the last book
     - create a book
     - delete one with the typed confirmation
     - restore an export as a new book
   - **Existing browser tests** move to the new URLs.
   - **Docs:** design.md and PLAN.md lose cross-book transactions; RESUME.md is updated.

## Out of scope

- Anything that spans books: combined views, totals, transactions.
- Moving an account from one book to another.
- Archiving a book (hidden but kept), unless question 2 says otherwise.

## Questions

1. **Remembering the last book:** per device (proposed), or per user, so every device opens the
   same book?
2. **Deleting books:** permanent with a typed confirmation (proposed), archiving (hidden, can be
   restored), or both? And should an export be required first, or just offered?
3. **Create from a Beancount file:** in M6 (proposed; it's small), or later?
