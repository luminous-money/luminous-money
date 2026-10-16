M9: SimpleFIN: plan
==================================================================================================

> **Status: plan, waiting on [the questions](#questions).** Calls marked **Proposed** are open.
> The brief is the milestone's line in [the plan](../../PLAN.md) ("bank feeds") and the goal of
> syncing one or two real bank accounts. Real connections can run on the dev stack: its data is
> disposable, and a wipe only means pasting the connection back in (see
> [Credentials](#credentials)).

## What M9 is

- **Connect** a [SimpleFIN](https://www.simplefin.org/protocol.html) source (the SimpleFIN
  Bridge, or any SimpleFIN server) by pasting a setup token.
- **Link** its bank accounts to accounts in your books.
- **Bring in new transactions every day**, through the same pipeline CSV imports use: skip
  duplicates, match what's already in the books, categorize, stage for review.
- **Show the bank's own balance and any errors** next to each linked account.

Reconciliation against those balances (balance assertions, statements) is M13.

## SimpleFIN, briefly

- **Setup token:** the user gets one from the Bridge. It's the base64 of a **claim URL**.
- **Claiming:** POSTing to the claim URL once returns an **access URL**:
  `https://user:pass@host/path`. A 403 means the token was already claimed, possibly by
  someone else, so tell the user.
- **`GET <access URL>/accounts`** returns, for every account the user connected at the Bridge:
  - **Fields:** `id`, `name`, `currency`, `balance`, `available-balance`, `balance-date`, and
    the connection (`conn_id`, institution `name`).
  - **Transactions:** `id` (unique within the account), `posted` (Unix time, 0 if pending),
    `amount` (a decimal string; positive is money in), `description`, and optionally
    `transacted_at` and `pending`.
  - **Parameters:** `start-date`, `end-date`, `pending=1`, `account=`, `balances-only=1`.
  - **`errlist`:** errors with codes:
    - `gen.auth`: the access URL no longer works
    - `con.auth`: the bank wants the user to log in again at the Bridge
    - `act.*`: one account failed or is missing data
- **The Bridge's rules for apps** ([developer guide](https://beta-bridge.simplefin.org/info/developers)):
  - at most **24 requests a day** per access URL, or it warns and then disables the token
  - **90 days per request**
  - updates are daily
  - randomize fetch times
  - overlap windows by about **5 days**
  - **always show the errors to the user**
- **Demo data:** the Bridge publishes a **demo setup token** with made-up accounts, for trying it
  on the dev stack.

## Decisions this plan makes

### Connections belong to you; links go into books

- **Proposed: a connection is the user's.** One access URL usually covers every bank you connected
  at the Bridge, so it's stored once and fetched once, even when its accounts go into different
  books (personal checking into one book, joint checking into the household book).
  - It has to be fetched once to stay within 24 requests a day ([question 3](#questions)).
- **A link** ties one SimpleFIN account to one leaf account in one of your books. Each side is
  linked at most once.
- **Bank connections page** (`/books/:book/connections`, in the menu), following M6's rule that
  the selected book is the context:
  - **Connections:** your connections, with institution, last sync, and errors.
  - **Their accounts:** the bank's name, institution, balance and currency, and for each:
    - linked to an account **in this book** (open it, or Unlink)
    - linked in **another book** (named, not editable here)
    - or **"Link…"**
- **Linking** picks an existing account, or creates one with the account picker (full name,
  autofill, as anywhere else).
  - **Currencies must match.** The ledger account's currency has to be the bank's ISO code;
    SimpleFIN's custom currencies (URLs) aren't supported.
  - **Proposed: cash-like accounts only** (checking, savings, cards, loans). A brokerage's
    transactions don't carry lots or prices, so linking one waits ([question 8](#questions)).
- **Unlinking** stops syncing. Everything already brought in stays.
- **Deleting a connection** removes its credential and links. To revoke it at the source too,
  revoke it at the Bridge; the page says so.

### Where a link starts

- **For an existing account,** proposed: sync from **the day after the account's last imported
  row** (CSV or earlier sync), or from its opening balance's date if it has never imported. The
  start can be changed when linking ([question 5](#questions)).
- **For a new account,** choose "Start from" (default: 90 days ago; as far back as the bank
  gives).
  - The account opens with an **opening balance the day before**: the bank's balance minus the
    posted transactions since then, so the books agree with the bank from the first sync.
- **Backfill** fetches 90-day windows back to the start, at most four (a year) on the first day.
  - If the start is further back, the rest comes over the next days, within the daily budget.
- **Proposed: cross-source matching.** A transaction already brought in by a CSV row can still
  be matched by a SimpleFIN row (and the other way round) as the same event.
  - Today a transaction held by one import row can't be claimed by another; that rule exists to
    stop two rows of the *same* stream claiming one transaction.
  - So a link whose start overlaps old CSV imports finds them, instead of duplicating them.

### Syncing

- **Proposed: once a day, in the morning.**
  - A random minute between 06:00 and 08:00 in the time zone of the connection's first linked
    book, kept per connection, so the Bridge doesn't see everyone at once.
  - Through M3's daily jobs.
- **Also on demand:**
  - **"Sync now"** on the connections page and on a linked account's page
  - a sync right after linking
- **Budget:** each connection keeps a count of today's requests and stops at **20** (under the
  Bridge's 24). Backfill chunks count too.
- **Windows:** each sync asks for `start-date` = the newest posted date synced so far minus 5
  days, up to now.
  - The overlap re-sends transactions already brought in; their fingerprints make them
    duplicates.
- **One request covers the whole connection** (all its linked accounts). Only accounts with a
  link are imported; the rest just refresh their balances on the page.
- **Each linked account's transactions** become one import batch, recorded like a CSV import:
  - source `simplefin` and the institution's name
  - each row's outcome: staged, matched, duplicate, before-opening
  - the same results view, under the account's import history
- **Rows:**
  - **Date, proposed:** `transacted_at` when given, else `posted`, as a date in the book's time
    zone ([question 2](#questions)). It's nearer what a hand-entered transaction would say, and
    the matcher's ±5 days absorbs the rest.
  - **Amount** as given. SimpleFIN signs are already "change to the account", like ours.
  - **Description** as given; the categorizers propose payees, as for CSV.
  - **Fingerprint** `id:sfin:<transaction id>`, so a transaction comes in once per account,
    whatever its date or description does later.
- **Proposed: posted transactions only** (SimpleFIN's default) ([question 1](#questions)).
  - Pending transactions often change amount, or get a new ID when they post, so they'd make
    duplicates to clean up.
  - Waiting a day or two for them to post is the trade.

### What the account shows

- **The bank's balance** ("Bank: $1,234.56, as of Oct 15"), next to the books' balance. When
  they differ, the difference is shown (pending transactions and timing explain most of it).
  - Kept from each sync. Balance assertions and reconciling are M13.
- **The last sync and any error** for the account or its connection.
  - Errors use plain words: "Your bank wants you to log in again at SimpleFIN Bridge", with a
    link to the Bridge. The code is kept for the record.
- **"Sync now".**

### Credentials

- **The access URL is a password to your bank data.** It's kept encrypted at rest (AES-256-GCM)
  in `app.sqlite`.
  - It's never sent to the browser. The page shows the host, and when it was connected.
- **The key, proposed:** `FAVA_BEANS_SECRET_KEY` (32 bytes, base64) when set, which keeps it out
  of the data volume. If it isn't set, `app` makes `/data/app.key` on first use and warns that a
  copy of the volume holds both lock and key ([question 4](#questions)).
- **The setup token is used once** to claim, then dropped.
- **No fetching arbitrary URLs from a server that may be public:**
  - A claim or access URL must be `https`, to a host on `SIMPLEFIN_HOSTS` (default: the
    SimpleFIN Bridge's hosts).
  - It must not resolve to a private address.
  - Test stacks allow the fake server's plain HTTP with `SIMPLEFIN_ALLOW_HTTP=true`.
- **Deleting your account** (M8) also deletes your connections. `auth` calls a new `app` route
  for your user-level data, after your books.

### Test infrastructure

- **A fake SimpleFIN server,** `tests/simplefin-fake`. It's a small Node service in the e2e stack,
  as Mailpit is for mail.
  - It implements claim (one use, then 403) and `/accounts` with Basic auth, dates, `pending`
    and `account`.
  - Tests script it: add accounts and transactions, set balances, inject `errlist` errors, read
    how many requests it got.
- **Unit tests in `app`** run the sync against a fake source:
  - windows and overlap
  - fingerprints across overlapping windows
  - the request budget
  - cross-source matching
  - the opening-balance arithmetic
  - time-zone dates
  - error mapping
  - encryption round trips
  - the URL checks
- **e2e:**
  - claim, link, sync, re-sync with overlap (no duplicates), an error shown, unlink
  - the budget, and the SSRF refusals
- **Browser tests:** connect with a token, link to a new account (opening balance right), Sync
  now, see the bank balance and an error, unlink.
- **By hand on the dev stack:** the Bridge's demo token, then your own.

## How it gets built

1. **`app` storage:**
   - migration 10:
     - `simplefin_connection`: user, encrypted access URL, host, the sync time, today's request
       count, the last sync and errors
     - `simplefin_account`: the last-seen name, institution, currency, balances
     - `simplefin_link`: connection and account to book and account; start, and synced
       through
     - `import_batch.source`
   - the secret key and encryption
2. **The client:**
   - token decoding, claiming, fetching `/accounts`
   - the URL checks
   - parsing to rows, error mapping
3. **The pipeline:**
   - `importFile` split into the CSV front end and a source-agnostic `importRows`
   - cross-source matching
   - SimpleFIN batches
4. **Sync:**
   - windows, backfill, the budget
   - the daily job at each connection's minute, Sync now
   - opening balances for new accounts
5. **API routes:** connections (create from a token, list, delete, sync), links (create, delete),
   and a linked account's bank status.
6. **PWA:**
   - the Bank connections page, linking with the account picker
   - the bank balance and errors on the account page
   - batches from SimpleFIN in import history
7. **The fake server, tests, docs:**
   - `tests/simplefin-fake` and its image
   - unit, e2e and browser tests
   - design.md ("Bank feeds"), operating.md (`FAVA_BEANS_SECRET_KEY`, `SIMPLEFIN_HOSTS`)
   - PLAN.md, RESUME.md

## Out of scope

- Brokerage and investment accounts over SimpleFIN (holdings, lots).
- Pending transactions (unless [question 1](#questions) says otherwise).
- Balance assertions and reconciliation (M13).
- Other aggregators (Plaid, GoCardless, ...). The pipeline stays source-agnostic, so each would
  be a client and a page.
- Sharing a connection with other users (M12 will decide how shared books link).

## Questions

1. **Pending transactions:** skip them until they post (proposed), or bring them in and
   reconcile them when they post (new IDs and changed amounts make that guesswork)?
2. **Which date:** when it happened (`transacted_at`, falling back to `posted`; proposed), or
   always when it posted? Posted dates match statements; transaction dates match what you'd
   enter by hand.
3. **Connections:** yours, linkable into any of your books (proposed), or one connection per
   book (simpler, but the same Bridge in two books would double the requests)?
4. **The encryption key:** from `FAVA_BEANS_SECRET_KEY` with a generated key file as the
   fallback (proposed), or require the variable (no SimpleFIN without it)?
5. **Where an existing account's sync starts:** the day after its last import (proposed), with
   cross-source matching catching any overlap, or ask every time?
6. **When it syncs:** once each morning plus Sync now, capped at 20 requests a day (proposed),
   or more often (up to the Bridge's 24, which it says it only refreshes daily anyway)?
7. **The bank's balance on the account page,** with the difference from the books (proposed now;
   reconciling in M13): useful, or noise until M13?
8. **Brokerages:** leave them unlinkable for now (proposed), or link them for their cash and
   balance only?
