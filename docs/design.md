# Design

The durable decisions behind fava-beans and the architecture they add up to. What's being built
next lives in [PLAN.md](PLAN.md); where work stands right now lives in
[RESUME.md](../RESUME.md).

## Why this exists

GnuCash has worked for years, but it has three problems:

1. **Entering and categorizing transactions takes forever.** This is by far the biggest one.
2. **There's no usable mobile workflow.** The mobile app only creates log entries that get
   applied to the desktop file later.
3. **Asset values go stale,** so net worth is rarely current.

## Decisions

### Our own system, with Beancount as the engine

We considered patching GnuCash: adding a "staged" transaction state and bolting on an HTTP server.
We rejected it:

- GnuCash expects a single process to own the book. It locks the file, and the GUI doesn't notice
  changes made to the SQLite backend from outside, so a server and the desktop app would be two
  writers fighting over one book.
- Exposing engine functions as REST endpoints gives an RPC layer over internals, not a domain API.

We also considered keeping Beancount `.beancount` files as the system of record, and rejected
that too. It meant building database features on top of text files: stable IDs, splitting files by
month, a parse cache, a separate index, enforcing a single writer, and cursors on file changes.
Saving one cross-book edit to several files also couldn't be atomic.

So:

- **A database is the system of record.** Every Beancount directive (transactions, opens and
  closes, prices, balance assertions, commodities) is a row, with an ID, timestamps, author,
  status and cross-book group as ordinary columns.
- **Beancount is the accounting engine.** Booking (lots, cost basis, capital gains), multiple
  currencies and commodities, validation (balancing, balance assertions), plugins and BQL all run
  in Beancount over entries loaded from the database. Rebuilding that would turn months of work
  into years.
- **Beancount text is the interchange format.** It's used for imports, exports and backups.
  Exports carry each entry's ID in its metadata, so re-importing an export (e.g. a restore)
  updates entries instead of duplicating them.
- **Reports are our own, not Fava's.** Fava was the original plan for desktop reporting, run
  read-only over exports. It was dropped (2026-10-09) because it didn't look useful for our
  purposes; reports will be built on the generic ledger-graphs libraries (PLAN.md, M10).
  Bringing Fava back would only take an image, a route, and a loop writing exports for it.

**The engine spike is done and proved the approach** (see [`services/ledger`](services/ledger)):

- **Each directive is stored as its canonical Beancount text** plus derived columns for SQL.
- **The engine renders a book's rows to text and runs Beancount's public `loader.load_string`.**
  No internal APIs are needed. Parsing is only about a third of the load time, so caching parsed
  rows wasn't worth the complexity.
- **Round trips are exact.** A multi-year `bean-example` ledger and a feature fixture produce the
  same booked entries and errors after import → database → export. The fixture covers:
  - FIFO lots and `@@` conversions
  - `pad`, includes and plugins
  - posting flags and multi-line metadata
  - `custom`, `query`, `event`, `note` and `close` directives
- **Validation problems map back to the directive** that caused them, through its ID.
- **BQL runs over the in-memory booked book.**
- **Incremental backups restore to an identical book,** deletions included.
- **The image builds for `linux/arm64`,** and the tests pass on aarch64.

### Staging is a status, not a separate store

Every Beancount transaction carries a flag: `*` means confirmed and `!` means pending. Entries
the system creates for you (imports, mirrored entries, scheduled entries) arrive as `!` with a
proposed match or categorization. The **review queue is every `!` entry**, and confirming one
changes its flag to `*`. Staged entries are real entries from the moment they're created. In the
database, the flag is a status column on the entry, and an export writes it out as the flag.

### Writes: JSON for transactions, Beancount text for everything

The ledger API accepts writes in two forms, and both store the same canonical row:

- **Transactions as JSON** (`/api/ledger/v1/books/{book}/transactions`). This is what the app uses
  when it composes or edits a transaction from form fields. `ledger` renders the Beancount text
  itself, so Beancount syntax never leaves the one service that understands it.
- **Any directive as Beancount text** (`/directives`, `/import`). This covers raw editing, every
  directive type, bulk import and restore.

Anything written one way reads back the other way. The JSON is designed to lose nothing:

- **Numbers are decimal strings,** never JSON numbers, so amounts can't pick up floating-point
  error between a form field and the ledger.
- **Metadata values keep their Beancount type:** text, boolean, `{"number"}`, `{"date"}` or an
  amount. A read → edit → write cycle therefore changes nothing it didn't mean to.
- **Validation happens in two layers.**
  - The schema rejects malformed shapes: bad decimals, floats, unknown fields, empty postings.
  - Re-parsing the rendered text rejects anything Beancount wouldn't accept, such as account
    names, flags and metadata keys.
- **Incomplete amounts** (an elided number with an explicit currency) have no JSON form and read
  back as omitted. They're rare and still fully supported through the text endpoints.

Every endpoint has a typed response model, so the generated TypeScript client describes real
request and response bodies.

### Versioned, partial edits

Every directive's `updated_at` is its version.

- **Every write moves it forward,** to a timestamp strictly later than before, even when the
  clock hasn't moved or has gone backwards (a Pi has no hardware clock).
- **Every edit sends the version it read:** in the body for JSON, and as a query parameter for
  text edits and deletes. If the stored version has moved on, the edit is refused with
  **409 Conflict** (which includes the current version). The check runs inside the write's
  database transaction.
- **Edits are partial: `PATCH /transactions/{id}` changes only the fields it names.** Confirming
  is `PATCH {flag: "*"}`, and a description edit is `PATCH {narration}`. A late save can never
  overwrite fields it didn't touch. `PUT` remains for full replacement, and is versioned too.
- **Imports and restores apply Beancount text by ID** and aren't versioned: they're bulk
  operations with their own semantics.

The API's JSON is snake_case (`updated_at`, `created_at`, `directive_id`), like the database
and the Python behind it. One convention everywhere.

### Accounts: leaves hold transactions, nodes hold sub-accounts

Beancount has no notion of node accounts, so fava-beans layers one on, using only ordinary
Beancount:

- **A leaf** is a plain `open` directive. It holds transactions and can't have sub-accounts.
- **A node** is an `open` with `kind: "node"` metadata. It holds sub-accounts and can't hold
  transactions.
- **The five top-level accounts are built-in nodes in every book,** a new book included.
  Beancount can't `open` a bare root, so they exist without directives. Their names follow the
  book's `name_*` options.
- **A parent that was never opened but has accounts under it is an implicit node.** Beancount
  already refuses postings to it. Imported books get a sensible tree this way, and an implicit
  parent can be opened explicitly, but only as a node.
- **New accounts are named in full and always sit below a top-level account,** whose root sets
  the type (asset, liability, equity, income, expense). The nearest existing ancestor must be an
  open node. Levels in between that don't exist at all are opened as explicit nodes along the
  way, in the same write, so they persist on their own (and show up in the chart of accounts).
  Everything opens when the nearest opened ancestor did, else with the earliest account under
  it, else at the book's first entry, so it can take any of the book's transactions.
- **Names follow Beancount's account syntax:** each part starts with a capital letter or digit,
  then letters, digits and dashes. That's Beancount's rule, not ours: account names are bare
  tokens in its file format, so a space would end one. The UI turns spaces into dashes as you
  type.
- **Postings to node accounts are refused on write** (422). Imported data that does it is flagged
  as a validation problem. That check runs after Beancount's loader rather than through its
  `extra_validations` hook: Beancount 3.2 appends those to its global list of validations on
  every load, so they'd run once more each time.
- **Pickers offer only leaves open on the transaction's date** as posting targets, and only
  nodes as parents.

### Start fresh, no GnuCash conversion

The GnuCash book is too big to be worth converting. The new books start from opening balances on
a cutover date. GnuCash stays read-only as the archive for anything earlier. The cutover date and
where opening balances come from are **deferred** until hydration.

### Build the UI first, then hydrate

Importing real transactions commits us to the new system, since keeping the same transactions in
two places isn't workable. So the order is:

1. **Build the UI and tooling** against test data.
2. **Iterate until it's genuinely pleasant** to use day to day.
3. **Only then hydrate** with real accounts: opening balances, then live feeds.

GnuCash stays the system of record until step 3.

The test data has three layers:

- **Hand-written fixtures** for tests.
- **A synthetic data generator** for decades-scale benchmarks and demos.
- **The SimpleFIN demo connection** once bank feeds are in.

### Easy for anyone to stand up, not tied to any one host

The goal is for someone else to run it with very little effort. A **Compose file is the product**:

- The whole system is a set of images plus one data volume and one env file.
- `docker compose up` on any host runs it.
- The same file also deploys to a single-node Docker Swarm with `docker stack deploy`. So we stick
  to Compose-spec features that both support, and ship prebuilt images rather than `build:` keys,
  which `stack deploy` ignores.

**Our first deployment target is a spare Raspberry Pi 3 in the basement.** That target can't leak
into the code. Supporting it means:

- **Multi-arch images** (`linux/arm64` and `linux/amd64`), built in CI.
- **A 64-bit OS on the Pi.** Python wheels for 32-bit ARM are spotty.
- **Staying small:** the Pi 3 has 1 GB of RAM, so we use as few services as practical and avoid
  heavy runtimes.
- **No Pi-specific paths, devices or scripts in the app.** All host details come in through the
  env file and the volume mount.

A prebuilt Raspberry Pi image, or other packaging, can come later as a thin wrapper around the
Compose file (e.g. OS + Docker + Compose file + first-boot setup), not as a separate build.

**TLS, public hostnames and external reverse proxies are the operator's job.** The stack exposes
one HTTP port (Traefik) and nothing else.

### TypeScript where we write code, existing tools where they already exist

Code management should be simple, declarative and intuitive, and deployment self-contained. A
small set of services is fine, since performance isn't a concern on this workload.

- **New services are TypeScript.**
- **`ledger` is the one Python service,** because Beancount's engine only exists in Python.
- **Traefik is used as is.**

### One monorepo, native tooling per language

The stack mixes languages, but it ships as one unit and most features cut across services, so it
lives in **one repository with no submodules**. (Things with an independent life, like Cati, stay
separate repos and connect over HTTP.)

- **Each language uses its own native workspace:** pnpm for TypeScript (`packages/*`,
  `services/*`, `tests/*`), and uv for Python (`services/ledger`).
- **Docker is the common build and test interface.** Every service has a Dockerfile, and its
  `test` stage runs the suite at build time.
- **`docker buildx bake` declares every image, test target and release platform**
  (`docker-bake.hcl`), and `compose.yaml` declares how they run. The root `package.json` only
  holds aliases for these: `pnpm build`, `pnpm test`, `pnpm e2e`, `pnpm generate`,
  `pnpm release`.
- **Cross-language contracts are generated, committed and checked.**
  - `ledger` publishes its OpenAPI schema, and `packages/ledger-client` is generated from it.
  - `pnpm test` fails if the committed client has drifted from the service, so an API change
    breaks the TypeScript build rather than a running Pi.

### Front-end data: TanStack Query over a generated client

- **`openapi-fetch`** with the generated `@fava-beans/ledger-client` types is the transport.
- **TanStack Query** handles caching, refetching and mutations. Reads are queries, and edits are
  mutations that update every cached copy of what they change.
- **Edits to one transaction share a mutation scope,** so they run one at a time in order. Each
  reads the transaction's latest version from the cache when it runs, not when it was queued.
- **A 409 refetches the book's data** and says it changed elsewhere.

### Many books, one ledger database

- A book is a first-class record, and every ledger API is scoped to a book.
- **All books live in one ledger database.** That lets a cross-book group commit as a single
  database transaction.
- **Only `ledger` writes to the ledger database.** Every other service goes through its API.

### SQLite by default, one database per owning service

SQLite ships by default, on the data volume. Each database has exactly one owning service:

| Database | Owner | Holds |
|---|---|---|
| ledger | `ledger` | Books, directives, entry status, cross-book groups and account-pair config, the change log and backup cursors. |
| app | `app` | CSV profiles and import history (batches, rows, outcomes, candidates). Later: scheduled-transaction templates, categorizer config. |
| auth | `auth` | Users (and, from M6, credentials). |

All three live on the one data volume (`ledger.sqlite`, `app.sqlite`, `auth.sqlite`). Every
service runs as UID 1000, so they can share it. The TypeScript services use `packages/db`: the
same `createTable`, timestamp and migration rules as the ledger's, on Node's built-in
`node:sqlite`, with its own lint check.

Database access goes through a small interface in each service, so another database could be
swapped in later without touching callers.

**Every table has non-null `created_at` and `updated_at` columns.**

- Tables are only ever created through the migration framework's `create_table` helper, which
  adds both columns. A lint check in `pnpm test` fails on any other `CREATE TABLE`.
- The columns have no defaults, so a write that forgets them fails loudly.
- Timestamps are ISO 8601 UTC with microseconds and fixed width, so text order is time order.
- Migrations are numbered, append-only, and tracked by SQLite's `user_version`.
- Migration 1 is the baseline. A database from before migrations is refused with a message to
  recreate it, which is safe because no real data exists before hydration.

### Performance over decades of data

Benchmarked on an x86 desktop with synthetic books built from `bean-example`
(`services/ledger/bench`):

| Book | Directives | Full load (book + validate) | Single write | SQL reads | BQL | Steady memory |
|---|---|---|---|---|---|---|
| 20 years, 1 history | 7.5k txns, 6.3k prices | 0.7 s | 3–16 ms | 2–4 ms | 70–85 ms | ~66 MB |
| 20 years, 5 histories | 38k txns, 31k prices | 3.8 s | 8–20 ms | 7–20 ms | 210–360 ms | ~207 MB |

The Pi 3 hasn't been measured yet. Expect it to be roughly an order of magnitude slower;
`bench.py` runs there unchanged. What the numbers settle:

- **The app's reads are SQL,** and they're fast at any scale: the review queue, lists, search,
  and the 14-month resolver context. None of it goes through Beancount.
- **Writes don't wait for full validation.** A write does structural checks synchronously: the
  text is exactly one well-formed directive, and its ID is consistent. Full-book validation
  (balance assertions, booking, plugins) runs **asynchronously after writes, debounced**.
  `problems` reports the latest completed validation. On a Pi with decades of data, a full load
  could take most of a minute, and nobody should wait that long to confirm a coffee.
  (Today's spike still validates on demand; making it asynchronous is the next step for
  `ledger`.)
- **Memory is the binding constraint on a 1 GB Pi, not time.** `ledger` holds the booked book in
  memory: about 200 MB at decades scale. That's comfortable, and archiving closed periods is the
  lever if it ever isn't. (With Fava, a second copy of the book would have doubled that.)
- **Price directives are about 45% of the synthetic book.** Their count, not transactions, may
  dominate growth, so `bean-price` should record at a sensible frequency (e.g. weekly, not daily).

### Backups: incremental, cursor-based, and made of Beancount files

- **Every change to the ledger database appends to a change log** with a monotonic sequence number
  and a timestamp.
- **The cursor is the sequence number,** not the timestamp. The Pi 3 has no hardware clock, so its
  clock can jump at boot before network time sync. The timestamp is still recorded, so "since
  date X" can be resolved to a cursor.

A backup request says "since cursor *N*" and gets back:

- **A Beancount chunk:** the current version of every directive changed since *N*, each with its
  ID in metadata. Deletions appear as tombstones (`custom "fava-beans" "deleted" "<id>"`, which is
  valid Beancount syntax). Chunks stay readable without this application.
- **Non-ledger state:** a dump of the app and auth databases. They're small and rarely change, so
  dumping them whole is simpler than computing diffs.
- **A new cursor** to use next time.

**Restoring** means replaying the chunks in order (the latest version of each ID wins, and
tombstones delete), then loading the state dumps. A full export at any cursor is also available.

**Consistency:** `ledger` owns the cursor. It holds a brief write lock while it records the cursor;
the other services' dumps are taken right after. Their state changes rarely, so that short gap is
acceptable.

Backups are pulled over the API (`/api/ledger/v1/backup?since=<cursor>`), so external tools (a cron
job, Syncthing into the hierarchy, offsite storage) decide where they go.

### Routing and auth: Traefik + forwardAuth

Traefik is the only exposed port. One box serves the UI and the APIs, so routing is by
**top-level prefix: `/api` for every API and `/ui` for the PWA.** A future, separate UI would get
its own top-level prefix rather than sharing `/ui`, where the PWA's service worker would also have
to be told to leave it alone.

- **Each service serves under its full prefix,** so Traefik strips nothing.
- **Routes come from Traefik's file provider** (`deploy/traefik/routes.yml`), not Docker labels.
  The same config then works under Compose and Swarm, and Traefik needs no Docker socket.

| Route | Goes to | Notes |
|---|---|---|
| `/api/auth/v1` | `auth` | Login, logout, who's logged in, and the verify endpoint. The only API without the session check. |
| `/api/ledger/v1` | `ledger` | Books API: entries, staging, cross-book groups, BQL, import/export, backup. |
| `/api/app/v1` | `app` | Review queue, the resolver pipeline, schedules, import sources. |
| `/ui` | `app` | The review PWA. Unknown paths under `/ui` get the app shell, for client-side routing. |
| `/` | (redirect) | Redirects to `/ui/`. |


How auth works (built in M1, with a stub user; M6 adds real accounts without changing the
shape):

- **Every API route except auth's carries Traefik's forwardAuth check** (the `session`
  middleware).
  - Before forwarding a request, Traefik calls `auth`'s `GET /verify`. Without a valid session
    the answer is 401, and the request never reaches a service.
  - On success, `auth` answers with `X-User-Id`, and Traefik sets that header on the forwarded
    request, replacing anything the client sent.
- **There's no Traefik plugin.** The token logic lives in the `auth` service, in TypeScript.
- **Services trust `X-User-Id`,** since they're only reachable through Traefik on the internal
  network. `app` passes it on when it calls the ledger as that user.
- **Sessions are HS256 JWTs** (30 days, no refresh yet), signed with `AUTH_JWT_SECRET`.
  - The browser carries the token in an `HttpOnly`, `SameSite=Strict` cookie, `Secure` behind
    HTTPS. The PWA never touches the token.
  - Scripts and tests can send it as a Bearer token instead.
- **The stub:** one user, created on startup; `POST /login` always logs that user in.
  - For test stacks only, `AUTH_TEST_USERS=true` lets login take an email and log in a separate
    user for it, so tests don't share state. It's off by default, and `pnpm e2e` turns it on.
- **Books belong to users.** Every book has an owner, and a book endpoint answers only its owner:
  anyone else gets 404, as if the book didn't exist. Sharing and permissions come in M8.

### Books, money accounts and balances (M1)

- **A book's name is its Beancount `option "title"`,** so exports and backups carry it. Book IDs
  are generated, so books can be renamed (versioned, like any edit).
- **Money accounts:** accounts held at a real institution, marked with metadata on their `open`
  directive:
  - `money: "bank"` (later `credit-card`, `brokerage`)
  - `display-name`, a human name, spaces allowed
  - `institution`
- **Adding a bank account** opens `Assets:Bank:<Name>` on an as-of date, with an opening-balance
  transaction against `Equity:Opening-Balances`. The balance means "at the end of that day", so
  imported rows from that day or earlier are skipped as already counted.
- **Balances and account ledgers come from plain SQL, not a Beancount load.**
  - Each posting stores its change to its account, with an elided amount filled in when that's
    unambiguous (one currency, no lots or prices).
  - When it isn't, that account's balance falls back to Beancount.
  - Pending transactions count.
- **An account's ledger** is its transactions newest first, in keyset pages of 200. Each shows
  its running balance and the other account (or `<multiple>`).

### Importing CSVs (M1)

- **A CSV profile per account** says how its bank's export is laid out: the preamble, header,
  date column and format, signed or debit/credit amounts, description, and optionally payee,
  bank ID and running balance.
  - It's guessed from the first file (`packages/csv-import`, shared by the browser and the
    server), confirmed by the user, and stored in `app`'s database.
  - Later files must have the same columns.
- **An import** reads every row with the profile and fingerprints it:
  - **the fingerprint** is the bank's ID if mapped; otherwise the date, amount and description,
    plus the row's occurrence among identical ones in the file
  - **rows skipped:** duplicates of earlier imports, rows before the opening balance, and rows
    that can't be read
  - **the rest** go through the pipeline, then are staged in one atomic ledger batch as pending
    transactions against `Expenses:Uncategorized` or `Income:Uncategorized`
  - **recorded:** the batch and each row's outcome; the last batch's time is the account's
    "last updated"
- **The pipeline, as built:** a chain of resolvers over a batch and its context (the account's
  transactions around the batch's dates). M1's only resolver is the matcher: the same amount,
  within ±5 days, ranked by closeness in date. It identifies and ranks; nothing acts on matches
  yet.

### Cross-book transactions

Some financial events belong in more than one book. Examples:

- An expense paid from the shared book with Jess is an accounts receivable there and a matching
  accounts payable in Kael's personal book.
- Kael's salary lands partly in the personal book and partly in the shared book.

Both are the same concept: **a cross-book group is a set of legs, one per book.** Each leg is an
ordinary transaction that balances within its own book. All the legs share a group ID, which
exports as a Beancount link (`^xbook-<id>`).

**Account pairs** are declared in the ledger, e.g. `shared:Assets:Receivable:Kael` ↔
`kael:Liabilities:Payable:Shared`. Each pair's balances must stay equal and opposite, and drift is
flagged as a ledger error.

There are three ways to create a group:

- **Mirroring:** when a confirmed transaction touches one side of a pair, the system stages the
  opposite leg in the other book, as `!`.
- **Schedules:** a recurring template whose legs straddle several books (see below). Its legs are
  staged as `!`.
- **Manual entry:** composing a group directly in the app.

**A group is always edited as a whole.**

- Opening any leg opens the group.
- It can only be saved when every leg balances within its book and every paired account mirrors
  its counterpart.
- The save is one atomic write.
- Because the user is reconciling every side at once, a manual edit doesn't re-stage anything.

Staging only applies to legs the system creates. (Once per-book permissions exist, editing a group
that touches a book you can't write to will need a rule. That's deferred.)

### Scheduled transactions

The scheduler is a participant like the importers: when a template comes due, it stages `!`
entries.

- **A template can have legs in several books,** which makes it a scheduled cross-book group.
- **Salary is the motivating case.** One template, monthly, with legs like these:
  - personal book: gross pay, taxes and deductions, the net deposit to personal checking, and
    the transfer to shared
  - shared book: the matching contribution arriving in joint checking
- **Amounts can vary from one occurrence to the next,** so a template can mark amounts as
  estimates.
- **When the real deposit arrives through the bank feed, it gets matched, not duplicated.** See
  the resolver pipeline below.

### The resolver pipeline: matching and categorization

Matching an import to an existing entry and guessing its category are one job: deciding what each
incoming transaction is. The job runs on **batches**, because the context is large and should be
built once per batch, not once per transaction.

```
resolve(batch: IncomingTxn[], context: Context) -> Resolution[]   // a subset; the rest pass on

Resolution =
  | { kind: "match",    txn, existingId, confidence }   // same event as an existing entry
  | { kind: "proposal", txn, postings,   confidence }   // a guessed categorization / split
```

**Resolvers are chained.**

- The batch passes through an ordered list of resolvers.
- Each one resolves what it can and passes the remainder to the next.
- Anything left at the end is staged with no proposal.
- The chain is configured per installation.

The default chain:

1. **`matcher` (built in):** finds existing entries that represent the same event. These include
   staged scheduled legs, mirrored legs, manual entries, and overlapping imports from another
   source. The criteria:
   - same account
   - date within a few days
   - exact amount, unless the existing entry's amount is marked as an estimate

   If more than one entry matches, nothing merges automatically; the transaction is staged with
   the candidates so the user can pick. When a match merges, the bank's amount and date win.
2. **`rules` (built in):** proposes postings from payee and amount history.
3. **`external` (optional):** sends the remainder to a configured HTTP endpoint that implements the
   same contract. That's how an LLM categorizer such as Cati (`~/Repos/cati`) plugs in later. The
   Cati integration itself is out of scope for now.

Resolution only proposes. Everything still lands in the review queue as `!`, with the match or
proposal shown and confirmable with one tap.

#### Context

Building the context is its own module, shared by every resolver, so no resolver reimplements it.
The context is **every entry from the 14 months before the batch, plus anything dated after it**
(e.g. scheduled legs that haven't come due yet). It's taken from all of the book's accounts and
never sampled. The window is measured from the batch's earliest transaction, so backfilled
imports get their own history.

- **Matching** needs every entry near each transaction's date, which the full window guarantees.
- **Categorization** gets a full year of recurrences (monthly, quarterly, annual), plus a couple
  of months of overlap to see last year's equivalent period.

The window is large, but algorithmic matching handles it easily and current LLMs take datasets
this size. We tried to design a sampling scheme and couldn't find a way to narrow the window that
didn't lose signal.

The context also carries the chart of accounts and, later, **artifacts** such as Amazon invoices
and grocery receipts that let a resolver split a single charge into several categories.

## Architecture

The design separates four things:

- **Shared state:** the ledger database.
- **Participants:** anything that proposes entries.
  - importers: SimpleFIN, CSV upload, manual entry
  - the cross-book mirror
  - the scheduler

  Adding a source means adding a participant, not changing the pipeline.
- **Routines:** the resolver chain, the context builder, and price fetching.
- **Views:** the PWA: the review queue now, then the chart of accounts, the general ledger and
  reports.

```
                        ┌──────────── traefik (upstream) ────────────┐
  operator's proxy ───▶ │  path routing · forwardAuth ─▶ auth /verify │
                        └───┬──────────────┬───────────────┬─────────┘
              /api/auth/v1  │ /api/app/v1, │ /api/ledger/v1│
                            │ /ui          │               │
                            ▼              ▼               │
                     ┌──────────┐ ┌─────────────────────┐  │
                     │ auth (TS)│ │ app (TS)            │  │
                     │ users,JWT│ │ participants        │  │
                     └──────────┘ │ context + resolvers │  │
                                  │ PWA + API           │  │
                                  └──────────┬──────────┘  │
                                             ▼             ▼
                                  ┌─────────────────────────────────┐
                                  │ ledger (Python)                  │
                                  │ system of record (SQLite)        │
                                  │ Beancount engine: booking,       │
                                  │ validation, BQL                  │
                                  │ import/export · backup chunks    │
                                  └─────────────────────────────────┘
```

### Services (initial)

| Service | Language | Role |
|---|---|---|
| `traefik` | upstream | The only exposed port. Routes by path prefix; forwardAuth to `auth`. |
| `auth` | TypeScript | Login, logout, who's logged in, and the verify endpoint for forwardAuth. Owns users (a stub until M6). |
| `ledger` | Python | System of record for all books. Runs the Beancount engine (booking, validation, BQL). Owns cross-book groups and their invariants, Beancount import/export, the change log and backup chunks. |
| `app` | TypeScript | Serves the PWA (React + Vite + `vite-plugin-pwa`) and its API (Hono): CSV profiles and imports. Hosts the participants, the context builder and the resolver chain, and owns import history (later schedules too). Modules get split into their own services only when there's a reason. |

## The review app

The main custom build: a mobile-first PWA. Features, in priority order:

1. **Process staged entries:** confirm a match or proposal with one tap, or change it.
2. **Bulk categorization:** select many entries and assign them at once.
3. **CSV import:** upload a bank export from the phone.
4. **Scheduled transactions:** define templates, including multi-book ones, and see what's due.

It also needs a book switcher, and an editor for cross-book groups that shows every leg and won't
save until they all balance.

### How the review queue works

The queue is every staged (`!`) transaction in a book, oldest first. It's built for the common
case without hiding the general one.

- **Splits are fully supported.** A transaction has any number of postings, in any currencies,
  with lots and prices. The queue just doesn't make the common case pay for that.
- **The happy path is a two-posting transaction,** as a bank feed delivers it.
  - The **anchor** is the side on a bank or card account (`Assets:`/`Liabilities:`): where the
    import came from. Its amount is shown on the card.
  - The **counterpart** is the side being categorized, shown as a searchable account picker.
    Accounts are filtered to those open on the transaction's date. Expense accounts are listed
    first for money out, income first for money in.
  - When both sides or neither are on the balance sheet (a transfer, say), the first posting is
    the anchor.
- **Anything else** (three or more postings, lots, prices) shows as a split summary that opens
  the detail view.
- **Skip moves an item to the end of the queue** and changes no data. Skips last for the browser
  session.
- **Swipe right to confirm, left to skip.**
  - The card follows the finger. Releasing past about a third of its width, or flicking, commits
    the action; anything less springs back. A label underneath shows what releasing will do and
    emphasizes once committing (with a short vibration on Android).
  - A card that can't be confirmed yet drags stiffly and springs back on release, and its
    category field shakes to point at what's missing.
  - Swipes can start anywhere on the card, wherever a thumb lands: the description field,
    buttons and links included. A drag never counts as a tap, never focuses a field (so the
    keyboard doesn't open), and suspends text selection. Vertical drags still scroll.
  - The buttons stay, for keyboards, desktops and accessibility. Reduced-motion settings turn
    off the animations.
- **Confirming or skipping slides the stack up.** By swipe or by button, the card flies off and
  its space collapses, so the cards below slide up. A skipped card reappears at the end; a card
  whose save fails comes back in place with the error.
- **Edits to a card apply in order, and only to their own fields.** Each is a PATCH, queued per
  transaction and sent with the version current when it runs (see "Versioned, partial edits").
  A description saved on blur and a confirm a moment later can't undo each other.
- **"Create account" is always the last option** in a posting-account picker.
  - It opens a dialog (full screen on phones) with one field: the account's **fully qualified
    name**, prefilled from the search and freely editable. "Groceries" becomes
    `Expenses:Groceries`, under the root money flowed to (expenses for money out, income for
    money in). A typed root is kept ("assets:cash wallet" becomes `Assets:Cash-wallet`), a typed
    path keeps its colons ("Gifts and Giving:Friends" becomes
    `Expenses:Gifts-and-Giving:Friends`), and a
    typed path whose front names a node goes under it ("utilities:power" becomes
    `Expenses:Utilities:Power`).
  - Typing fixes the name up as you go: spaces become dashes, and each part starts with a
    capital, as Beancount requires.
  - **Autofill:** node accounts that continue what's typed (ignoring case) are listed under the
    field. Tab, or tapping one, fills in its next portion, through the next colon or to the end
    of its name. While more nodes still match, it fills the next portion again. The arrow keys
    choose which suggestion Tab uses. With nothing left to fill, Tab moves focus as usual, so it
    never traps the keyboard.
  - The dialog checks the name against the ledger's rules as you type, says why when it can't
    be created, and lists any levels on the way it will create as nodes.
  - **It always creates a leaf;** there's no leaf/node choice. The API can still create nodes,
    for the chart of accounts.
  - **Create** opens the account (and any nodes on the way) and picks it for the card.
  - **Cancel** returns to the dropdown exactly as it was, search included.
- **Edits save immediately and the item stays staged:** the description saves on blur or Enter,
  the category on pick. Nothing typed is lost to a skipped or abandoned review.
- **Confirm saves the current state with the `*` flag,** which takes the item out of the queue.
  It's disabled while the counterpart is `Expenses:Uncategorized`.
- **The detail view edits the whole transaction.**
  - Fields: date, payee, description, and every posting.
  - You can add and remove splits. One amount can be left blank, and Beancount balances it; the
    editor shows the value it will get.
  - A live balance check (exact decimal arithmetic, no floats) blocks saving while the
    transaction is off.
  - Lots and prices are preserved untouched and left to the ledger to check on save, since their
    weights depend on booking.

## Components

| Concern | Choice | Notes |
|---|---|---|
| System of record | SQLite, behind an interface | One ledger database for all books. |
| Accounting engine | Beancount v3 | Also the import/export and backup format. |
| Reports | Our own, on the ledger-graphs libraries | Planned (PLAN.md, M10). Fava was dropped. |
| Mobile UI | PWA: React + Vite + `vite-plugin-pwa` | Served by `app` under `/ui`. |
| App API server | Hono on Node | Small footprint for the Pi. |
| Routing | Traefik | forwardAuth to `auth`, no plugins. |
| Auth | JWT | Users, but no permissions yet. |
| Orchestration | Compose spec | `docker compose` or single-node Swarm (`docker stack deploy`) from the same file. |
| First host | Raspberry Pi 3, 64-bit OS | One deployment target among others, not a dependency. |
| Bank feeds | SimpleFIN Bridge | |
| Matching and categorization | Resolver chain: `matcher` → `rules` → optional `external` | Batch interface. Cati integration is deferred. |
| Prices / net worth | `bean-price` on a schedule | Covers market-priced holdings. Illiquid assets (house, car) get manual `price` entries now and then. Balance assertions from feeds catch drift. |
