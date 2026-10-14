M6: Multiple books: plan
==================================================================================================

> **Status: plan, waiting on [the questions](#questions).** The brief is the milestone's line in
> [the plan](../../PLAN.md): managing several books per user, and which of them you see ("only
> my accounts, only our shared accounts, or both together"), with every account clearly
> belonging to exactly one book. Calls marked **Proposed** are open.

## What M6 is

One user, several books, used side by side: create and delete books, choose which ones the app
shows, and see accounts from several books together without ever wondering which book one is in.

Auth (M10) and sharing (M12) come later, so M6 runs as the stub user. Sharing will add books
other people own to the same list, and the view built here becomes the brief's "mine, ours,
or both" without changes.

Not in M6: a transaction or schedule spanning books (M7), moving an account between books, and
anything per-user beyond the view.

## What exists today

- **The ledger already has many books per owner.**
  - `POST /books` creates a named book.
  - `GET /books` lists the caller's books.
  - Rename, export, and import of Beancount text into a book all work.
  - Every other endpoint is scoped to a book its caller owns.
  - **There's no way to delete a book.**
- **`app` keys everything by book:**
  - stars (per user), CSV profiles, import batches, schedules, rules, proposals
  - `book_setting` (time zone and owner) and `price_fetch`
- **The PWA assumes one book.**
  - `useCurrentBook()` is the first book.
  - `/`, `/import` and `/accounts/new` use that book, and so do the menu's Review, Schedules,
    Rules and Commodities links.
  - Every other page is already under `/books/:book/…`.
  - Manage books lists, renames, sets the time zone and exports. It can't create books.
- **Daily jobs** (schedules, prices) loop over `book_setting`. A book without a row gets no
  price run, which is why the demo book doesn't.

## Decisions this plan makes

### The view: which books you see

- **Proposed: the masthead gets a book switcher.** It shows the current view's name; tapping it
  lists each book and, once there are two or more, **All books**.
  - **Proposed: a view is one book or all of them.** With two books that's exactly "mine, ours,
    or both". Any subset is the alternative ([question 1](#questions)).
  - New books join All books automatically.
- **Proposed: the view is a per-user setting in `app`** (a new `user_setting` table), so your
  phone and laptop agree. After logging in you land in your last view.
- **One book in view:** the app looks exactly as it does today.

### Accounts from several books, together

- **Home groups starred accounts by book,** one heading per book, in book creation order. Each
  group keeps its own star order.
- **The book is named wherever accounts or transactions from several books mix:**
  - home group headings
  - a small book label on review cards and on matches
  - optgroups in the Import account picker
  - the subtitle of an account or transaction page, once you have more than one book
- **The same account name can exist in two books,** such as `Assets:Bank:Checking` in each. The
  label tells them apart, and every URL already carries the book.
- **Account pickers inside a transaction stay in that transaction's book.** Mixing books in one
  transaction is M7.

### Book-scoped pages in All books

- **Review merges the visible books' queues,** ordered by date as it is today. Each card carries
  its book, so swipes, edits and matches go to the right ledger.
  - "Suggest categories" runs per book, over each visible one.
  - **Bulk confirm** works across books.
  - **Bulk categorize** needs one book's accounts. If a selection spans books, "Categorize as…" is
    disabled and says why.
- **Schedules, Rules and Commodities** list their items in sections, one per book. "New
  schedule" and "New rule" ask for the book first when more than one is in view.
- **Import** offers the accounts of every visible book. The chosen account decides the book.
- **Add an account** gets a Book field when more than one book is in view. It defaults to the
  book you came from.
- **Deep links** keep working: `/import?book=…&account=…` and `/accounts/new?book=…`, so the
  account page's Import link doesn't depend on the view.

### Managing books

- **Create a book:** name, time zone (the browser's) and operating currency (USD; [question
  6](#questions)). It goes through a new `app` route that creates the ledger book and its
  `book_setting` row together. Today the PWA makes two calls, and a book can end up without a
  time zone.
  - Names are unique per owner, case-insensitively, since the switcher shows names alone.
- **Proposed: create a book from a Beancount file.** Upload an export (or any Beancount ledger)
  and it becomes a new book. This closes the loop with Export, so the user-facing backup also
  restores. Errors are shown as Beancount reports them, and nothing is created if there are any.
- **Delete a book** ([question 3](#questions)):
  - **Proposed:** a permanent delete behind a confirmation where you type the book's name, with
    "Export first" offered right there.
  - **Ledger:** a new versioned `DELETE /books/{id}` tombstones every directive, so incremental
    backups carry the deletion, then removes the book.
  - **`app`:** a new `DELETE /api/app/v1/books/:book` calls the ledger first, then removes the
    book's own rows in one transaction. An `app` failure afterwards leaves only orphans nobody
    can reach (the book 404s); they're cleaned up the next time the book list loads.
  - Deleting your last book takes you back to Setup.
- **Every book gets a time zone.** The book list now returns each book's zone. If a book has none
  (older books, like the demo), the PWA sets it to the browser's once, just as at signup. This
  fixes the M5 gotcha where the demo book got no morning price run.
- **Rename, time zone and export** stay as they are.

### Demo data

`pnpm seed` adds a second synthetic book, "Demo Household", with a joint checking account, a
few months of made-up transactions and one schedule. It's starred, so All books has something
to group.

## How it gets built

1. **Ledger:**
   - `DELETE /books/{id}` (versioned, with tombstones in the change log)
   - operating currency on create
   - unique names per owner
   - tests, then `pnpm generate`
2. **`app` server:**
   - migration 10: `user_setting` (the view)
   - book routes: create with settings, delete with cleanup, and the list with time zones
   - an orphan sweep
   - unit tests
3. **PWA plumbing:**
   - `useView()` replaces `useCurrentBook()`
   - the masthead switcher
   - menu links that follow the view
   - book labels, and `?book=` on Import and Add an account
4. **Pages:**
   - Home grouped by book
   - merged Review (book on each card; bulk rules across books)
   - Schedules, Rules and Commodities in sections
   - Import optgroups
   - the Book field on Add an account
5. **Manage books:** create, create from a file, delete, and time zone backfill.
6. **Seed, tests and docs:**
   - **API e2e:** create and delete (the app's rows go too, backups show tombstones), the view
     setting, duplicate names refused, another user's book still 404s.
   - **Browser tests:**
     - the switcher
     - All books home
     - importing into the second book from All books
     - merged review with labels
     - Add an account into a chosen book
     - deleting a book with the typed confirmation
     - restoring an export as a new book
   - **Docs:** design.md gets "Books and the view"; PLAN.md and RESUME.md are updated.

## Out of scope for M6

- **Transactions, schedules and matches across books** (M7).
- **Moving an account from one book to another:** possible later as an export, edit and import
  of its history, but not a button.
- **Combined totals across books** (net worth over all books): reports, M8.
- **Archiving a book** (read-only and hidden) as an alternative to deleting it, unless question 3
  says otherwise.

## Questions

1. **View granularity:** one book or All books (proposed), or any subset of books (checkboxes
   in the switcher)? Subsets matter once you have three or more books, for instance mine, ours,
   and a business.
2. **Where the view is remembered:** per user, the same on every device (proposed), or per
   device (your phone on Household, your laptop on All)?
3. **Deleting books:**
   - permanent delete with typed confirmation (proposed), archive (hidden and read-only,
     restorable), or both?
   - Either way, should deleting require exporting first, or just offer it?
4. **Telling books apart at a glance:** text labels only (proposed), or also a color per book
   (auto-assigned, changeable in Manage books) shown as a dot on cards and rows?
5. **Review in All books:** one merged queue (proposed), or Review always per book with a
   per-book count in the switcher?
6. **Operating currency at creation:** ask for it (default USD, proposed), or always USD until
   someone needs otherwise? It's hard to change once a book has transactions.
