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

So:

- **A database is the system of record.** Every Beancount directive (transactions, opens and
  closes, prices, balance assertions, commodities) is a row, with an ID, timestamps, author,
  status as ordinary columns.
- **Beancount is the accounting engine.** Booking (lots, cost basis, capital gains), multiple
  currencies and commodities, validation (balancing, balance assertions), plugins and BQL all run
  in Beancount over entries loaded from the database. Rebuilding that would turn months of work
  into years.
- **Beancount text is the interchange format.** It's used for imports, exports and backups.
  Exports carry each entry's ID in its metadata, so re-importing an export (e.g. a restore)
  updates entries instead of duplicating them.
- **Reports are our own, not Fava's.** Fava was the original plan for desktop reporting, run
  read-only over exports. It was dropped (2026-10-09) because it didn't look useful for our
  purposes; reports will be built on the generic ledger-graphs libraries (PLAN.md, M12).
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

Every Beancount transaction carries a flag: `*` means confirmed and `!` means unconfirmed. Entries
the system creates for you (imports, mirrored entries, scheduled entries) arrive as `!` with a
proposed match or categorization. The **review queue is every `!` entry**, and confirming one
changes its flag to `*`. Staged entries are real entries from the moment they're created. In the
database, the flag is a status column on the entry, and an export writes it out as the flag.

**`!` is "unconfirmed" everywhere,** in the UI, the code and these docs: it says what's true (you
haven't confirmed it yet). "Pending" is kept for the bank's own meaning, a transaction it hasn't
posted yet (SimpleFIN's `pending`).

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
- **All books live in one ledger database,** which keeps one change log and one backup cursor
  for everything.
- **Only `ledger` writes to the ledger database.** Every other service goes through its API.

### SQLite by default, one database per owning service

SQLite ships by default, on the data volume. Each database has exactly one owning service:

| Database | Owner | Holds |
|---|---|---|
| ledger | `ledger` | Books, directives, entry status, the change log and backup cursors. |
| app | `app` | CSV profiles and import history (batches, rows, outcomes, candidates). Later: scheduled-transaction templates, categorizer config. |
| auth | `auth` | Users (and, from M8, credentials). |

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
- **Books deleted since the cursor** (`deleted_books`). Their chunks hold every directive's
  tombstone.

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
| `/api/ledger/v1` | `ledger` | Books API: entries, staging, BQL, import/export, backup. |
| `/api/app/v1` | `app` | Review queue, the resolver pipeline, schedules, import sources. |
| `/ui` | `app` | The review PWA. Unknown paths under `/ui` get the app shell, for client-side routing. |
| `/` | (redirect) | Redirects to `/ui/`. |


How auth works (M8; the shape is M1's):

- **Every API route except auth's carries Traefik's forwardAuth check** (the `session`
  middleware).
  - Before forwarding a request, Traefik calls `auth`'s `GET /verify`. Without a valid session
    or API token the answer is 401, and the request never reaches a service.
  - On success, `auth` answers with `X-User-Id`, and Traefik sets that header on the forwarded
    request, replacing anything the client sent.
- **There's no Traefik plugin.** The token logic lives in the `auth` service, in TypeScript.
- **Services trust `X-User-Id`,** since they're only reachable through Traefik on the internal
  network. `app` passes it on when it calls the ledger as that user; `auth` does the same to
  delete an account's books.
- **No special accounts.** fava-beans may run as a public service, so anyone can sign up, and
  there's nothing global to administer: everyone is an ordinary user, including whoever runs the
  server. Operator tasks (reset links, disabling an account, key rotation) go through `auth`'s
  command line (`node dist/cli.js`), not an admin role.
- **Who you are is apart from how you prove it.** A user is a name and an email (unique,
  case-insensitive). An `identity` is a way to log in: a password now, and OIDC providers later
  as another kind, with nothing else moving. Sessions record which one started them.
- **Passwords** follow NIST SP 800-63B rev. 4 and OWASP:
  - 15 to 128 characters, NFKC-normalized, with no composition rules or forced rotation
  - checked against Have I Been Pwned's range API (k-anonymous; it passes if HIBP is down)
  - Argon2id (19 MiB, 2 passes) from Node's own `crypto` (Node 24), stored as PHC strings and
    redone at login when the parameters rise
  - guessing slows down per account and per client IP
- **Tokens are short-lived access with rotating refresh** (OAuth 2.1 / browser-apps BCP shape).
  - **Access tokens:** 10-minute Ed25519 JWTs (`sub`, `sid`). The key pair lives in `auth.sqlite`,
    and the public keys are published at `/.well-known/jwks.json`; `cli.js rotate-keys` adds one.
  - **Refresh tokens:** opaque, hashed, rotated on every use. A token used again after a
    10-second grace ends its whole session (theft); the grace covers two tabs at once.
  - **A session is a refresh-token family.** It ends after 60 days unused or a year at most, or
    when ended: logging out, ending it from another device, a password change (the others) or
    reset (all).
  - `/verify` checks each access token's session in the database (one indexed read), so ending a
    session stops its access token at once, even from the CLI's separate process.
- **In the browser, tokens never touch JavaScript.**
  - Both are `HttpOnly`, `SameSite=Strict` cookies, `Secure` (and `__Host-`/`__Secure-`
    prefixed) behind HTTPS. The refresh cookie's path is `/api/auth/v1/token`, so it goes
    nowhere else.
  - On a 401 the PWA refreshes once, under a Web Lock across tabs, and retries; while open, it
    refreshes ahead of expiry.
  - `auth` refuses writes whose `Origin` isn't its own.
- **Other clients** get tokens in the body (`"delivery": "body"`) and send `Authorization:
  Bearer`. **API tokens** (`fb_…`, hashed, optionally expiring) serve scripts and backups; they
  reach every API but can't manage the account.
- **Email is optional** (`SMTP_URL`): with it, verification and reset links (to
  `FAVA_BEANS_PUBLIC_URL`, never the request's Host). Without it, resets go through the CLI.
- **Deleting an account** deletes every book it owns, through `app`'s book deletion.
- **Test stacks** (`AUTH_TEST_USERS=true`) let login take an email alone, so tests don't share
  state. It's off by default, and `pnpm e2e` turns it on.
- **Books belong to users.** Every book has an owner, and a book endpoint answers only its owner:
  anyone else gets 404, as if the book didn't exist. Sharing and permissions come in M13.

### Books, starred accounts and balances (M1, M2)

- **A book's name is its Beancount `option "title"`,** so exports and backups carry it. Book IDs
  are generated, so books can be renamed (versioned, like any edit).
- **No account kinds** (M2 replaced M1's "money accounts"). Marking an account as a bank account
  or a credit card bought nothing a name and a star don't. Users create any account by its full
  name, anywhere the account rules allow; filing a card under assets is theirs to make.
- **Starred accounts are the home page.** Stars are per user, kept in `app` (user, book,
  account), since they're a preference rather than bookkeeping: shared books (M13) can show each
  user their own, and exports stay free of them. Renaming accounts will have to carry them along,
  as it will CSV profiles.
- **Display names:** `display-name` metadata if set, else the name's last segment with dashes as
  spaces.
- **Display signs:** liabilities and income are shown inverted wherever amounts are read (home
  cards, ledgers, previews; later reports), so a card shows what's owed and income is positive.
  Editors show stored signs, since splits sum to zero. Colors follow the stored sign, the effect
  on net worth. One helper (`shown`) decides, so every view agrees.
- **An opening balance** is just a number from a statement, with its date, for any leaf: an
  opening-balance transaction against `Equity:Opening-Balances` (written even for zero), and the
  account opens then.
  - The balance means "at the end of that day", so imported rows from that day or earlier are
    skipped as already counted. An account without one has no cutoff.
  - **The opening balance's date is the account's `as_of`,** wherever it's moved. Moving it back
    (with the balance as of the earlier date) lets older history import.
- **Accounts open by their first posting.** Open dates are incidental here, so a write that
  posts to an account before its `open` moves the `open` back to meet the account's earliest
  posting, instead of leaving the book invalid. That covers moving an opening balance back, and
  categorizing old imports into new accounts.
- **Balances and account ledgers come from plain SQL, not a Beancount load.**
  - Each posting stores its change to its account, with an elided amount filled in when that's
    unambiguous (one currency, no lots or prices).
  - When it isn't, that account's balance falls back to Beancount.
  - Unconfirmed transactions count.
- **An account's ledger** is its transactions newest first, in keyset pages of 200. Each shows
  its running balance and the other account (or `<multiple>`).
  - **The full view** starts at the newest and loads older pages as you scroll.
  - **A partial view** starts at a date (`?date=`, the newest 200 on or before it) and loads
    either way: older pages as you scroll, newer ones above with "Load more" (by hand, so
    landing mid-ledger doesn't pull in everything above). Every page names the cursors either
    side of it (`next_cursor`, older; `prev_cursor`, newer), so pages load outward from
    any one until the whole ledger is there. The date sits in the URL so Back from a
    transaction returns to the same view.

### Investments (M5)

- **No investment account kind.** Any account can hold any commodity. A **brokerage** is an
  account with accounts under it (imported books often open parents plainly, so "has accounts
  under it" decides, not `kind`); its balances, summary, ledger and holdings cover the subtree.
  A leaf holding several commodities works too.
- **Prices are the books' `price` directives,** read with SQL through a derived `price` table
  (ledger migration 4). Value is in the book's operating currency, through one other currency
  if need be.
- **Posting amounts are weighed as booking would:** a blank amount opposite lots at a known
  cost, or priced postings, is filled in (migration 5 recomputed old ones), so running balances
  survive buys. Only a reduction whose lot booking must pick (`{}`) is left to Beancount.
- **Cost basis without a full load: account-scoped booking.** Booking is per account, so the
  ledger books only an account's slice (every open, close and commodity, and the transactions
  touching the subtree), cached until the book changes: 222 ms cold and 72 ms cached for the
  decades-scale book's brokerage, against 4 s for a full load (x86).
- **Booking follows tax reporting:** per account, matching what the broker reports (1099-B);
  new books default to FIFO. FIFO, LIFO, HIFO and specific lots (STRICT) are Beancount's.
  **Average cost** isn't (Beancount 3 refuses `AVERAGE`), so such accounts use `NONE` booking
  and fava-beans reduces at the average cost (shown as one average lot).
- **Trades are built by the ledger** from a form's description: a buy is a lot at cost; a sale
  writes each lot it draws on explicitly (by the account's method), with the gain per lot
  split into `Income:Capital-Gains:Short-Term` and `:Long-Term` (held more than a year); a
  dividend can be reinvested. Previewed, then checked by account-scoped booking before writing.
  Trades are entered by hand (no brokerage CSV trades yet).
- **Revalued assets** (a house, a car) are plain currency balances whose `open` carries
  `revalue-every` (days, default 350). "Update value" writes the change against
  `Income:Unrealized-Gains`, so it falls in its period. Shares and funds keep prices: their
  gains are shown, not booked, until a sale.
- **Staleness is the asset's:** a commodity's `stale-after` (default 7 days), a revalued
  account's `revalue-every`.
- **Prices are fetched with beanprice** (its `price:` metadata on `commodity` directives, e.g.
  `USD:yahoo/VTI`), each morning at 07:00 in the book's time zone (after the previous close),
  as one of `app`'s daily jobs (alongside the schedule generator at midnight), for books with a
  time zone and owner. A price is recorded unless that date has one; failures are per
  commodity. `ledger.price_sources.fixed` is a no-network source for demos and tests.

### Importing CSVs (M1)

- **CSV profiles** say how a bank's export is laid out: the preamble, header, date column and
  format, signed or debit/credit amounts, description, and optionally payee, bank ID and running
  balance.
  - One is guessed from the first file (`packages/csv-import`, shared by the browser and the
    server), confirmed by the user, and stored in `app`'s database.
  - **An account can have several,** since banks export more than one layout. A file is read
    with the first that fits it.
  - **A file that fits none asks** whether it's really for this account. If it is, it's profiled,
    and the new profile either replaces the saved ones or is added to them.
- **An import** reads every row with the fitting profile and fingerprints it:
  - **the fingerprint** is the bank's ID if mapped; otherwise the date, amount and description,
    plus the row's occurrence among identical ones in the file
  - **rows skipped:** duplicates of earlier imports, rows before the opening balance, and rows
    that can't be read
  - **the rest** go through the pipeline, then are staged in one atomic ledger batch as unconfirmed
    transactions against `Expenses:Uncategorized` or `Income:Uncategorized`
  - **recorded:** the batch and each row's outcome; the last batch's time is the account's
    "last updated"
- **Exporting:** any user can download a book as one Beancount file (Manage books → Export),
  which the ledger's `/import` restores. `/backup?since=` serves scheduled backups of all of the
  caller's books. CSV profiles and import history aren't included.
- **The pipeline, as built:** a chain of resolvers over a batch and its context (the account's
  transactions around the batch's dates). M1's only resolver is the matcher: the same amount,
  within ±5 days, ranked by closeness in date. It identifies and ranks; nothing acts on matches
  yet.

### Chart of accounts (M10)

- **The tree is one read** (`GET /accounts/tree`): every live posting's change, summed per
  account as Decimals and rolled up through every ancestor, then valued in the operating
  currency at the latest prices. Plain SQL plus Python, no Beancount load: 46 ms on a five-year
  demo book. A node's figure is one number, its subtree's value (holdings at market).
- **Renaming is moving:** the full name changes, and every directive naming the account or one
  under it is rewritten in one atomic write (97 ms for an 882-split branch):
  - postings, opens and closes
  - balances, pads, notes, documents
  - custom directives' account values

  Renaming onto an existing account is refused, with merging offered instead. The top-level
  account can't change (that would change the account's type).
- **Deleting moves every split** of the account and its subtree to one substitute, so no other
  account's balance changes, and drops the accounts' opens, closes, balances, pads, notes and
  documents. Merging is the same operation. The substitute can be any type, with a warning when
  it differs. For a node, the other way is to delete what's under it one by one.
- **Archiving is Beancount's `close`,** on a date no earlier than the last transaction, with an
  optional closing transfer of what's left. An archived account leaves pickers, home and imports,
  and its bank feed stops. Unarchiving removes the close.
- **Protected:**
  - the top-level accounts
  - the system accounts the code relies on (uncategorized, opening balances, unrealized and
    capital gains, fees)
  - a brokerage's parts (`:Cash` and holdings), which follow the brokerage
- **The page is one card,** a section per type with its top-level row as the header, built for
  a thumb: every row is a full-width target at least 3rem tall. Tapping a node opens or closes
  it (remembered per device); its › opens its editor, where "Add an account under it" lives.
  Tapping a leaf opens its ledger. Amounts with no price mark the figure with `*`, named once
  under the card. In the editor, both names save as one form, and an asset's settings (which
  lots sales draw on, revaluing) are a card of their own; they live only there, not on the
  ledger. Archiving and deleting are folded rows below: rarely needed, and consequential.
- **`app` follows the ledger:** renames, merges and archives go through `app`, which changes the
  ledger first and then, in one transaction, everything it keeps by account name:
  - **renamed:** stars, CSV profiles, import batches, schedules, rules, proposals, bank links
    and attempts
  - **merged:** they move to the substitute; stars and links on the deleted account go


### Budgets (M11)

A budget is how much an account may take in a period (a **limit**, for expenses) or should
bring in (a **goal**, for income, assets such as savings, and liabilities being paid down).

- **Kept in the ledger as `custom "budget"` directives,** Fava's format, so exports, backups
  and M10's rename carry them:
  - each is a **version** from its date until the account's next one, and its periods count
    from that date; a change is a new version from the period it starts in, so earlier periods
    keep the budget they had
  - `every: N` metadata for periods of more than one unit; `quarterly` for three months
  - a top-level account is written as a string (`"Expenses"`): Beancount's account token needs
    two parts
  - 0 ends a budget; ending one with nothing before it removes it outright
- **Periods** are every N days, weeks, months or years from the start, as schedules' are (M3),
  months on the start's day clamped to short months.
- **The rule:** no budget is higher, per year, than one on an account above it (a weekly $150
  under a monthly $600 is about $7,826 a year against $7,200: refused). Every write is checked,
  both ways, on every day from its start on where a version changes. A move (M10) that breaks
  it is allowed, and the Budgets page flags it.
- **Other:** a budgeted node with budgets under it (the nearest down each branch) keeps the rest
  as its Other: its budget less theirs (restated in its period), and its flow less theirs over
  its period. When theirs add up to more, Other is negative and flagged.
- **What counts:** the account's flow over the period, its subtree included, read as the
  account reads (spent, earned, put in, paid down). Refunds take spending back; transfers inside
  the subtree cancel out. **Unconfirmed transactions count**, shown apart. Only the operating
  currency counts; other currencies are listed.
- **Excluded transactions:** `budget: FALSE` on a transaction (a roof, once in twenty years)
  keeps it out of budgets while it's categorized and counts everywhere else, reports included.
  The ledger derives a `budgeted` column from it, so budget sums stay one indexed query.
- **Status is the ledger's** (`GET /budgets/status?on=&basis=`), not `app`'s as first planned:
  restating budgets across periods (weekly as per month) is exact with Decimals there, the
  period math lives in one place, and the caller passes "today", so no time zone is needed.
  4 ms for 8 budgets on a five-year demo book (1,967 transactions).
- **Per month** restates every budget per month and measures this calendar month; home's one
  bar is the highest-level expense budgets (no budget above them) on that basis.
- **Archived accounts' budgets rest** (they're not shown while it's archived, and come back
  when it's unarchived). **Deleting or merging an account drops its budgets:** they're its own,
  so they don't move to the substitute.
- **A book's weeks start** on a day kept in `app`'s book settings (Monday unless set; a
  versioned `PATCH /settings`), where a new weekly budget starts by default.

### Transfers paired in review

A transfer between two of your accounts arrives twice: money out in one account's import, the
same money in through another's, a day or so later. Both would sit in review, uncategorized.

- **A pair** is two unconfirmed, still-uncategorized transactions staged by imports, in
  different asset or liability accounts (a card payment counts), one out and one in by the same
  amount, within 7 days. The closest dates pair first; each pairs once.
- **Pairing makes them one:** the transfer (out of one, into the other, on the earlier date,
  still unconfirmed) replaces the two in one atomic ledger write. `app` keeps the two as they
  were (`transfer_pair`), and the import rows that held them now hold the transfer, so
  duplicates, matching and "Not at the bank" carry on unchanged.
- **Reject** (in review, and on the transaction's page) restores the two, with their rows
  pointing back, and remembers the pair so it isn't made again. **Confirming** is just
  confirming; the kept originals are forgotten on the next pass.
- **When:** after every import (a file, a bank's sync even with nothing new, a new link), over
  the whole book's review, so the second side pairs whenever it arrives.

### Reports (M12)

- **Two libraries of our own,** since nothing generic exists to adopt (Fava's, Paisa's and
  Actual's charts live inside those apps; fava-dashboards only inside Fava):
  - **`@luminous-money/ledger-graphs-api`**: plain TypeScript, no
    dependencies. Reports over a **posting stream** (`{transaction, date, flag, budgeted, payee,
    narration, account, amount, currency}`, plus current balances and prices for net worth),
    returning plain JSON datasets. Roots are parameters; sums run in integer cents; simulations
    take a seed, so they're stable and testable.
  - **`@luminous-money/ledger-graphs-ui`**: React charts over those
    datasets, drawn with Apache ECharts (a peer dependency; only the line, bar and pie charts are
    bundled, SVG-rendered). The host passes a theme (ours reads the app's CSS variables, light
    or dark) and the charts describe themselves for screen readers.
  - Their home is the public [luminous-money/ledger-graphs](https://github.com/luminous-money/ledger-graphs)
    monorepo (ISC), published to npm by its CI with npm's trusted publishing; the app depends on
    the published versions.
- **`app` computes them** (`/books/:book/reports/*`): it reads the window each report needs from
  the ledger's `transactions/compact` (which says what's `budgeted`) and runs the library; the
  page passes "today". The PWA loads the charts lazily, so ECharts isn't in the first screen.
- **"Spent this month"** (home): expenses under the highest-level expense budgets (or all of
  them), what's excluded from budgets left out, against those budgets per month, and the 85th
  percentile of 2,000 simulated months, each day drawn from the same day of one of the last 12
  (so rent on the 1st stays on the 1st), exclusions included.
- **Reports page:** cash flow (6 months, this one so far), a breakdown of expenses or income
  (6-month averages or this month, at a depth, 6 slices and Other, drilling in), this month's
  largest expenses, and net worth (24 month ends backed out from today's balances, holdings at
  each month end's price; what has no price is named, not counted).
- **An account's "Typically"** (expense and income accounts): the median week, month and year
  (52 weeks, 12 months, up to 5 years) and what 85% of simulated ones stay under.
- **The journal** (`GET /books/{b}/journal`): every transaction, newest first, keyset-paged in
  SQL a page at a time (no running balance to accumulate), as account ledgers are. Home shows
  its first page in a window of its own; its title opens the Transactions page, paged and
  dated as an account's ledger is (one paging hook and its pieces, `components/Paged`).

### Sharing books (M13)

- **One owner, any number of members,** each with a role: **read** (sees everything), **write**
  (changes the contents), **manage** (and who has it, its name and settings); the owner alone
  deletes it. Members' stars stay their own.
- **Membership is the ledger's** (`book_member`), since it's where every read and write is
  checked: reading (GET) needs read, anything else write, members and the name manage, deleting
  the owner. A non-member gets 404 (as if there were no such book), a member without the role
  403. `Book` carries the caller's `role`, and the book list has shared books too. (A restored
  backup is the books' text, without members.)
- **`app` checks the same** before its own writes (one middleware: anything but a read needs
  write; members and invitations check their own), so its routes can't do what the ledger would
  refuse.
- **Invitations are links for one person** (`book_invite` in `app`: a token's hash, a role, who
  invited, the email it's for, an optional name, 3 days, used once, revocable). Only the account
  with that email can accept one (until emails are verified, the one it was made with). Accepting one adds the caller **acting as the
  inviter**, so the ledger checks the inviter still manages the book. No email is sent: the link
  is copied or shared (the phone's share sheet). An invitation opens even for someone with no
  book yet.
- **Names:** auth's forwardAuth check passes on `X-User-Name` and `X-User-Email` (URI-encoded)
  beside `X-User-Id`; `app` remembers each user's (`user_profile`) for members' lists.
- **Leaving or being removed:** what acted as them in the book (schedules, the price run) acts as
  the owner from then on, and their bank links into it (through their own SimpleFIN connection)
  go.
- **Read only in the PWA:** a notice under the masthead, and the main write entry points hidden
  (importing, adding transactions or accounts, the ledger's actions, budgets' editing); anything
  else is refused by the server, saying why.
### Reconciliation (M14)

- **Kept as Beancount,** so exports carry it and every load checks it: a `balance` directive
  dated the day after the statement (balances hold at the start of a day), with `statement:`
  metadata (and `source: "bank"` for an automatic one), and `reconciled: <statement date>` on
  each posting it covers. On the posting, not the transaction: a transfer's two sides reconcile
  with two different statements. `posting.reconciled` (ledger migration 9) is the mark's derived
  column, for SQL.
- **The starting balance is what's reconciled so far** (the sum of reconciled postings), not
  the last statement's figure: the two agree until an edit breaks one, and then the next
  reconciliation still starts from the truth while the account says it's off.
- **Finish only when it balances** (the ledger refuses anything else, 422); "Save for later"
  keeps a draft in `app` (`reconcile_draft`, one per account, shared by the book's members,
  versioned), since a draft isn't the books' business until it's finished.
- **Dates agree with the statement:** Beancount checks a balance against everything dated up to
  it, so finishing moves a ticked transaction dated after the statement onto its date, and an
  unticked one dated on or before it to the day after, refusing a move that would break the
  other side's reconciliation. Imported transactions carry the bank's dates, so it's mostly
  hand-entered ones that move.
- **Marks belong to reconciliations:** edits through the JSON API keep a posting's mark while it
  stays in the same account, and new transactions arrive without one; only reconciling and undo
  change them. (Text imports and restores keep what the text says.)
- **What starts ticked** is `app`'s to say: what was imported into the account (a file or the
  bank: import rows hold them) and the opening balance (it came from a statement). Reconciling
  confirms the unconfirmed ones ticked.
- **Divided accounts:** an asset or liability node can be one real account (`divided: TRUE` on
  its `open`), its sub-accounts dividing what's in it. It's reconciled as one (Beancount's
  balance on a node is its subtree's), transfers between its parts reconcile themselves, and
  its parts can't be reconciled, linked to a bank or divided themselves. Named for what it is,
  not for reconciling: M15 links one to a bank. `shared/divided.ts` says what follows, for the
  server and the PWA; the ledger enforces it.
- **Bank-fed accounts** are compared with the bank's day-end balance the day before its balance
  date (so a late posting that day can't break it), backed out from the reported balance and
  the mirror, with where they diverged. After each sync, one that agrees, with everything
  through then confirmed and nothing in progress, is reconciled automatically; an automatic
  reconciliation replaces the latest if that was automatic too and in the same month, so
  there's one a month rather than one a day.
- **Ledgers filter by reconciliation** on the server (`reconciled=`), so pages stay full and
  running balances stay the account's. In the journal a transaction is reconciled when its
  asset and liability postings all are. Select all selects what's shown.
- **Imported files with a balance column** keep their last balance (`import_batch.end_date`,
  `end_balance`), checked against the books at import and offered as Reconcile's prefill. The
  running balance says which way a file runs on a single day, and whether a card's balance is
  shown owed or as stored.

### Bank feeds: SimpleFIN (M9)

[SimpleFIN](https://www.simplefin.org/protocol.html), usually through the SimpleFIN Bridge, is the
bank feed. Its shapes are the Bridge's actual ones, which go beyond the spec: `payee`, `memo`
and `holdings`, and errors either as coded `errlist` or as the older plain `errors`.

- **Connections are the user's; links go into books.** One access URL usually covers every
  institution connected at the Bridge, so it's stored once and fetched once, wherever its
  accounts are linked. A link ties one bank account to one account in one book.
- **The access URL is a credential:**
  - it's sealed at rest (AES-256-GCM, `SIMPLEFIN_ENCRYPTION_KEY`, required at boot)
  - it never reaches the browser
  - it's only ever fetched over `https`, from allowlisted hosts (`SIMPLEFIN_HOSTS`), never a
    private address, never following a redirect, since this may be a public server and a setup
    token is a URL the user pastes
- **Fetching and importing are separate.**
  - Fetching is rationed. The Bridge allows about 24 requests a day; we stop at 20. It
    recommends 45-day windows (its notice, 2026-10-16) and a 5-day overlap.
  - What comes back fills a **mirror** of the bank's posted transactions (pending ones are
    skipped: they change, and get new IDs when they post).
  - Importing makes import batches from the mirror through the CSV pipeline (`importRows`),
    so fingerprints (`id:sfin:<id>`), matching, categorization and review are the same.
  - Rows are dated when the transaction happened (`transacted_at`, else posted), in the book's
    time zone. The narration is the bank's raw text (`memo`); the payee is the Bridge's.
- **Cross-source matching:** a transaction held by a CSV row may still be matched by a bank row
  (and the other way round). The rule against claiming a held transaction is for rows of the
  same stream.
- **Linking: the bank is the source of truth.** Every link fetches the bank's whole history
  first (as far as it goes: windows back until 180 days are empty). Call its first date S.
  - **New:** the account opens on S − 1 at the reported balance less everything synced, so the
    books agree with the bank from the start.
  - **Reconcile** (an existing account; the default):
    - Your transactions from S on are unconfirmed, except those matching the bank, which are
      confirmed (yours kept: date, payee, splits).
    - The opening balance becomes whatever makes the balance at S − 1 the bank's.
    - The bank's unmatched transactions import.
    - Yours the bank doesn't know stay unconfirmed, marked **Not at the bank** in review.
  - **Start over** deletes the account's transactions first (the user's choice, never the
    default). **From a date** reconciles nothing.
  - The reconcile is one atomic ledger write (`/transactions/changes` takes versioned updates
    too); the import after it is an ordinary batch.
- **Linking happens in the background.** Some banks answer slowly (minutes per request), and a
  long history is many windows.
  - The choice is recorded as an **attempt**, and its history is fetched in the background.
    Out of requests, it waits for the next morning.
  - Its preview fills in when the history is in, and the user confirms when they come back.
  - Attempts survive restarts.
- **Syncing:** once each morning, at a random minute between 06:00 and 08:00 in the first linked
  book's time zone (the Bridge asks apps to spread out), plus "Sync now".
- **Brokerages** (seen with Fidelity, 2026-10-16):
  - **Holdings come only with transactions,** not with balances-only requests.
  - **Each sync's holdings are a snapshot.** It records that day's price per symbol. Where the
    bank's shares differ from the books', it stages a buy or sale for review through M5's trade
    booking, paired with the bank's matching cash transaction when there is one.
  - **Money-market core positions** (priced at 1, like SPAXX) count as cash.
  - **A new brokerage opens with one estimated lot per position,** at its cost basis: SimpleFIN
    sends totals, not lots.
- **What an account shows:** its balance is the books', as everywhere. A synced account adds
  "Reported today 6:00am: $…", the bank's. The Bridge's errors are shown in plain words, and its
  notices (advice like the 45-day one) are told apart from failures.

### Configuration: `@wymp/config-simple`

`auth` and `app` read every setting in one `src/config.ts`, through `@wymp/config-simple`,
following its README:

- **Checked at boot:** a missing or malformed setting stops the service with a list of what's
  wrong.
- **Only production-safe defaults** are in code; anything without one is `REQUIRED`.
- **`APP_ENV`** (`production` by default, `development` or `test`) picks `.env/<APP_ENV>`, which
  ships in the image. `.env/local` (not committed) overrides it, and real environment variables
  override both.
- **The e2e stack** sets `APP_ENV=test` and little else: its settings (test users, Mailpit, the
  fake SimpleFIN server, a fixed key for its made-up data) live in `.env/test`.
- **The ledger** (Python) keeps its two environment variables as they are.

### Books are independent

A book is a self-contained set of accounts and transactions, and **the selected book is the
context for everything** in the app, like switching profiles. Nothing spans books: no combined
views, and no transactions across them.

**Cross-book transactions were dropped (2026-10-14).** The design used to have "cross-book
groups": one event (a salary split between a personal and a shared account, an expense paid from
the shared book on someone's behalf) recorded as legs in several books, kept in step by account
pairs and mirroring. Instead, each book records its own side of such an event, as an ordinary
transaction, from its own accounts' data: money leaving personal checking for joint checking is a
transfer out in one book and a deposit in the other.

As built in M6:

- **The selected book is in the URL.** Every page but Manage books is under `/books/:book/…`, so
  links and bookmarks say which book they mean, and TanStack Query's keys are already per book.
  `/` opens the last book used, remembered per device (and user) in local storage.
- **The masthead's book switcher** lists the user's books and Manage books.
- **Names are unique per owner,** ignoring case, since the switcher shows names alone. A taken
  name is the input's problem (422), not a version conflict (409).
- **Creating a book goes through `app`,** which creates the ledger's book and its settings (time
  zone, owner) together, so every book has a time zone. Books from before that get the browser's
  once, the first time the PWA sees them.
- **A book can start from Beancount text,** such as an export: a restore. It's a copy: every
  directive gets a new ID (IDs are unique across books), tombstones are dropped, and the text's
  title gives way to the new name. Text that doesn't parse creates nothing.
- **Deleting a book is for good,** behind typing its name, with Export offered alongside. The
  ledger tombstones every directive and marks the book deleted rather than dropping its row, so
  the next incremental backup carries the deletion (the chunk's tombstones, and the backup's
  `deleted_books`). `app` then forgets everything it kept about the book, in one transaction.

### Scheduled transactions

The scheduler is a participant like the importers: when a template comes due, it stages `!`
entries.

- **Salary is the motivating case:** one template, monthly, with gross pay, taxes and deductions,
  and the net deposit.
- **Amounts can vary from one occurrence to the next,** so each split of a template can carry
  a **match tolerance** (an amount either way, default 0). An import within it matches, and
  confirming the match takes the bank's amount; the blank split absorbs the difference.
- **When the real deposit arrives through the bank feed, it gets matched, not duplicated.** See
  the resolver pipeline below.

As built in M3:

- **Schedules live in `app`:** a rule plus a transaction template (no date or flag), owned by a
  user, versioned like every edit.
- **The rule is small, not RRULE:** every N days, weeks, months or years from a start, until an
  optional end; months on the start's day or listed days (or the last day), clamped to short
  months; weekends kept or moved to the Friday before or Monday after. One shared module
  (`src/shared/schedule.ts`) computes and describes it for both the server and the PWA.
- **The generator** runs in `app` at startup, after saves, and once a day just after midnight
  in each book's time zone (a book setting in `app`, defaulting to the browser's), acting as the
  owner. An occurrence is staged on its (weekend-adjusted) date as a transaction marked
  `schedule`/`schedule-date`: unconfirmed for review, or confirmed if the schedule confirms
  automatically. The bank's row matches it on import (M2).
- **Each occurrence is staged once.** A schedule's `last_applied` date is the last nominal date
  it ran for; the generator stages from after it (or from the start) through today. So "Not
  this time" (deleting an unconfirmed occurrence, distinct from review's "Skip") is for good. A new
  schedule starting in the past stages everything since its start.
- **Editing resets a schedule to now:** its unconfirmed occurrences from today on are deleted
  (not ones an import matched) and staged again as edited; dates already past are never staged
  by an edit.
- **Upcoming occurrences** (16 days) show in account ledgers as grayed rows with a projected
  balance, and on the Schedules page.
- **Failures are per schedule:** the error is kept and shown, and retried on the next run.

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

   As built in M2:
   - **Only transactions already in the imported account match.** Guessing transfers across
     accounts would match far too much. A transfer is recognized because the first import's
     side was categorized to this account; then it's simply a transaction here.
   - **Not ones this account's imports already hold** (staged or matched), so two identical
     coffees in two files stay two.
   - **Every candidate is linked to the row,** best first. Each transaction goes to one row: the
     best pairs are taken first, and a row whose candidates were all taken is staged, its
     candidates still linked.
   - **A matched row adds nothing:** it holds the existing transaction, and the books don't
     change.
   - **No match is final until it's confirmed in review,** where it can be moved to another
     candidate, swapped with the row holding one (one operation, since a held transaction can't
     be taken), or undone ("Not a match" stages the row on its own).
   - **Known miss:** pairing is by proximity, not order (two coffees entered on the 5th and 7th,
     imported on the 7th and 8th, pair crossed). Swapping fixes it; order-aware assignment is a
     Polish to-do.
2. **Categorizers** (built in M4), after matching and assignment, for the rows to be staged:
   - **`rules`:** the user's own rules (account, payee key, description text, amount range →
     category, optional payee, optionally confirm automatically). The most specific match wins.
   - **`history`:** what the same payee (by payee key, exact then similar; same account first)
     was confirmed as in the last 14 months, with a confidence from agreement and volume, and
     the payee the user last gave it.
   - **External providers,** configured per installation (`CATEGORIZERS`), speaking the
     [categorizer API](categorizer-api.md) we define as the system of record. Built-ins
     implement the same contract, so a provider is a peer. That's how an LLM categorizer such
     as Cati plugs in; the Cati integration itself is out of scope for now.

   Each is asked only about rows not yet settled (a proposal at 0.9 or more settles one). Then
   the most confident postings and payee are applied at **any** confidence: review is where
   weak ones get corrected. Only a user's rule can confirm automatically. Proposals are kept in
   `app`, shown in review with their source, and settled on confirm (accepted unchanged or
   not), which gives an acceptance rate per categorizer; providers can get that as feedback.

Resolution only proposes. Everything lands in the review queue (new transactions as `!`, matches
as proposed), with the match or proposal shown and confirmable with one tap, except what a
user's rule confirms automatically. Review also has "Suggest categories" (the chain over unconfirmed
uncategorized transactions), "Also categorize N similar" (same payee key, same account), "Remember
as a rule", and Select mode for categorizing or confirming many at once.

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
| `auth` | TypeScript | Sign-up, login, sessions and tokens, accounts, and the verify endpoint for forwardAuth. Owns users and their identities. |
| `ledger` | Python | System of record for all books. Runs the Beancount engine (booking, validation, BQL). Owns Beancount import/export, the change log and backup chunks. |
| `app` | TypeScript | Serves the PWA (React + Vite + `vite-plugin-pwa`) and its API (Hono): CSV profiles and imports. Hosts the participants, the context builder and the resolver chain, and owns import history (later schedules too). Modules get split into their own services only when there's a reason. |

## The review app

The main custom build: a mobile-first PWA. Features, in priority order:

1. **Process staged entries:** confirm a match or proposal with one tap, or change it.
2. **Bulk categorization:** select many entries and assign them at once.
3. **CSV import:** upload a bank export from the phone.
4. **Scheduled transactions:** define templates and see what's due.

It also needs a book switcher (M6).

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
| Reports | Our own, on the ledger-graphs libraries | Planned (PLAN.md, M12). Fava was dropped. |
| Mobile UI | PWA: React + Vite + `vite-plugin-pwa` | Served by `app` under `/ui`. |
| App API server | Hono on Node | Small footprint for the Pi. |
| Routing | Traefik | forwardAuth to `auth`, no plugins. |
| Auth | JWT | Users, but no permissions yet. |
| Orchestration | Compose spec | `docker compose` or single-node Swarm (`docker stack deploy`) from the same file. |
| First host | Raspberry Pi 3, 64-bit OS | One deployment target among others, not a dependency. |
| Bank feeds | SimpleFIN Bridge | |
| Matching and categorization | Resolver chain: `matcher` → `rules` → optional `external` | Batch interface. Cati integration is deferred. |
| Prices / net worth | `bean-price` on a schedule | Covers market-priced holdings. Illiquid assets (house, car) get manual `price` entries now and then. Balance assertions from feeds catch drift. |
