M9: SimpleFIN: plan
==================================================================================================

> **Status: building,** with [the answers](#answers-2026-10-15) (the questions below are
> answered too). Real connections can run on the dev stack: its data is disposable, and a wipe
> only means pasting the connection back in.

## Answers (2026-10-15)

1. **Pending transactions are skipped** until they post.
2. **Dates are when it happened** (`transacted_at`), falling back to when it posted.
3. **Connections are the user's,** and their accounts link into any of your books.
4. **The encryption key is SimpleFIN's own variable, `SIMPLEFIN_ENCRYPTION_KEY`, and `app` won't
   start without it.**
   - All the TypeScript services move to `@wymp/config-simple`, with environment-specific files
     as its README sets out (see [Configuration](#configuration)).
5. **Linking an existing account asks how to start, every time,** including wiping it clean.
   The default **reconciles with the bank as the source of truth** (see [Linking](#linking)).
6. **Syncing:** once each morning, plus "Sync now", at most 20 requests a day.
7. **The balance an account shows is the books'.** A synced account adds a smaller line under
   it with the bank's: "Reported today 6:00 am: $13,234.56".
8. **Brokerages link too, anchored on Fidelity** (see [Brokerages](#brokerages)).

And to the questions below:

1. **Start over** may delete transfers' other sides: it's the user's choice, and not the default.
2. **"Not at the bank"** transactions stay pending.
3. **Brokerage lots:** one estimated lot per symbol is fine.
4. **The ledger's configuration** stays as it is (its two variables); only the TypeScript
   services move to `@wymp/config-simple`.

## What M9 is

- **Connect** a [SimpleFIN](https://www.simplefin.org/protocol.html) source (the SimpleFIN Bridge,
  or any SimpleFIN server) by pasting a setup token.
- **Link** its accounts to accounts in your books: bank accounts, cards and loans, and
  brokerages with their holdings.
- **Linking an account that already has history reconciles it with the bank.**
- **From then on, new transactions arrive every morning,** through the pipeline CSV imports use:
  duplicates skipped, matches found, categories proposed, then review.
- **Each synced account shows what the bank reports,** and any connection errors.

## SimpleFIN, briefly

- **A setup token** is the base64 of a **claim URL**. POSTing to it once returns an **access URL**
  (`https://user:pass@host/path`); a 403 means it was already claimed.
- **`GET <access URL>/accounts`** (`start-date`, `end-date`, `pending`, `account`,
  `balances-only`) returns each account with:
  - `id`, `name`, `currency`, `balance`, `available-balance`, `balance-date`, and its
    institution
  - **transactions:** `id`, `posted` (0 if pending), `amount` (positive is money in),
    `description`, `transacted_at`, `pending`
- **What the Bridge also sends, beyond the published spec,** seen in its demo data
  (2026-10-15):
  - **Transactions:** `payee` (a clean name), `memo` (the bank's raw text) and `mcc`.
  - **Accounts:** `holdings`, each with `id`, `symbol`, `shares`, `cost_basis`, `market_value`,
    `purchase_price`, `currency`, `description`, `created`.
  - **The older shape:** `org` on each account and `errors` as plain strings, where the current
    draft has `connections` and a coded `errlist` (`gen.auth`, `con.auth`, `act.*`). The client
    reads both.
- **The Bridge's rules for apps** ([developer guide](https://beta-bridge.simplefin.org/info/developers)):
  - at most **24 requests a day** per access URL, or it warns and then disables the token
  - **90 days per request**
  - updates are daily
  - randomize fetch times
  - overlap windows by about **5 days**
  - **always show its errors to the user**
- **A demo setup token** gives made-up accounts (checking, savings with an AAPL holding, an
  empty one), for trying it on the dev stack.

## Decisions this plan makes

### Connections and links

- **A connection is the user's.** Its access URL usually covers every institution connected at
  the Bridge, so it's stored once and fetched once, wherever its accounts are linked.
- **A link** ties one SimpleFIN account to one account in one of your books (a leaf, or a
  brokerage). Each side is linked at most once.
- **Bank connections page** (`/books/:book/connections`, in the menu; the selected book is the
  context):
  - **Connections:** your connections, with institution, last sync and errors.
  - **Their accounts:** the bank's name, institution and balance. Each is linked **here** (open
    it, Unlink), linked **in another book** (named), or offers **"Link…"**.
- **Currencies must match:** the ledger account's currency is the bank's ISO code. SimpleFIN's
  custom (URL) currencies aren't supported.
- **Unlinking** stops syncing. Everything brought in stays.
- **Deleting a connection** removes its credential and links. To revoke it at the source too,
  revoke it at the Bridge; the page says so.

### Linking

The bank is the source of truth for what happened in the account. Linking an account always asks
how to start.

- **A new account** (made with the account picker) gets everything the bank has.
  - **History:** 90-day windows back until two in a row come back empty. Windows the budget can't
    cover today come over the next days.
  - **Opening balance:** the day before the earliest bank transaction. It's the reported balance
    minus the sum of every synced transaction, so the books agree with the bank from the start.
- **An existing account** offers three choices:
  1. **Reconcile with the bank** (the default):
     1. Fetch the bank's full history, as for a new account. Call its earliest date S.
     2. **Mark every existing transaction from S on as pending (`!`).** Transactions before S are
        left alone: the bank knows nothing about them.
     3. **Match** the bank's transactions against those, with the usual matcher and assignment
        (best pairs first; amounts within any schedule tolerance).
     4. **Confirm every match** (`*`). The transaction keeps your date, payee, categories and
        splits; the bank's row claims it.
     5. **Stage the bank's unmatched transactions** as new (`!`, categorized), for review.
     6. **Set the opening balance** so the account's balance at the end of S − 1 equals the bank's
        then (the reported balance minus the sum of the synced transactions).
        - The account's existing opening-balance transaction is changed if it's dated before S;
          otherwise one is created on S − 1.
        - With nothing before S, this is just "reported minus synced".

     **What's left over:** your transactions from S on that the bank doesn't know stay pending,
     marked **"Not at the bank"** in review, to keep or delete. Your work is kept wherever the
     bank agrees with it, and the account's balance is the bank's.
  2. **Start over:**
     - Delete every transaction that posts to the account, then link as a new account.
     - It's behind a typed confirmation, which also says how many of those transactions post to
       other accounts too; those accounts lose their side.
  3. **Only what's new:** sync from a date you choose (default: the day after the account's last
     import), with no reconciling. The fingerprints and the matcher catch overlap.
- **One atomic ledger write** does each reconcile or start-over, so it can't half-happen. The
  ledger's `/transactions/changes` gains **versioned updates** (flags, and the opening balance)
  next to its creates and deletes.
- **A preview comes first:** before anything is written, a summary like "312 at the bank; 287
  match yours; 25 new; 9 of yours not at the bank; opening balance $1,204.33 on 2025-07-17
  (was $1,250.00)".

### Syncing

- **Daily:** a random minute between 06:00 and 08:00 in the time zone of the connection's first
  linked book, kept per connection, through M3's daily jobs. Also **"Sync now"**, and a sync
  right after linking.
- **Budget:** each connection counts today's requests, and stops at **20**. Backfill windows
  count too.
- **Windows:** `start-date` is the newest posted date synced so far, minus 5 days. Transactions
  the overlap sends again are duplicates by fingerprint.
- **One request covers the whole connection.** Only linked accounts import; the rest just
  refresh what the page shows.
- **Each linked account's transactions become an import batch,** recorded as a CSV import is
  (source `simplefin`, the institution's name) and shown in its import history.
- **Rows:**
  - **date:** `transacted_at`, else `posted`, as a date in the book's time zone
  - **amount:** as given
  - **narration:** `memo` (the bank's own text, like a CSV's), else `description`
  - **payee:** the Bridge's `payee` when given, offered to the categorizers like a CSV's payee
    column
  - **fingerprint:** `id:sfin:<transaction id>`
- **Pending transactions are skipped** (SimpleFIN's default).
- **Cross-source matching:** a SimpleFIN row may claim a transaction that a CSV row already
  holds, and the other way round. The rule against claiming a held transaction exists for rows of
  the same stream; another stream seeing the same event isn't a conflict.

### What a synced account shows

- **Its balance, from the books, as everywhere.**
- **Underneath, smaller:** "Reported today 6:00 am: $13,234.56" (or "yesterday …", or a date):
  the bank's balance at its `balance-date`, in the book's time zone.
  - It's on the account's page and its home card.
  - For a brokerage, it's the reported total, holdings included.
- **The last sync and any errors**, in plain words, with the code kept:
  - "Your bank wants you to log in again at SimpleFIN Bridge" (with a link)
  - "SimpleFIN no longer accepts this connection: connect it again"
- **"Sync now".**
- Reconciling the two balances (assertions, statements) is M13.

### Brokerages

Anchored on Fidelity: the first build slice looks at what the Bridge actually sends for a
Fidelity account, locally (amounts redacted, nothing committed), and this section is adjusted
to it.

- **A brokerage links to a brokerage in the books:** an account with children, as in M5
  (`<account>:Cash`, and `<account>:<SYMBOL>` per holding).
- **Cash transactions sync like a bank account's into `<account>:Cash`:** deposits,
  withdrawals, dividends, fees, and the cash side of buys and sells.
- **Holdings are a daily snapshot.** The Bridge sends shares, cost basis and market value per
  symbol, not lots or trades. Each sync compares the snapshot with the books' units per symbol.
  - **Equal:** nothing to do. The snapshot's price (market value / shares) is recorded as that
    day's price (source `simplefin`), alongside beanprice's.
  - **Different:** a **position change** is staged for review, as a trade through M5's
    machinery:
    - **More shares:** a buy at the cost-basis increase.
    - **Fewer:** a sale booked by the account's sale method (FIFO by default, as the 1099-B
      does), with proceeds from the matching cash transaction if one is found (same day ± a few,
      description naming the symbol), else at market value.
    - The cash side pairs with that cash transaction when found.
- **Linking a brokerage:**
  - **Cash** reconciles (or starts over) as above.
  - **Holdings** start as one **estimated** lot per symbol at the snapshot's cost basis, dated
    the holding's `created` if given (else the link date). That's editable, and it's the best
    SimpleFIN can say, since it doesn't send lots.
  - **Proposed:** an existing brokerage with lots already recorded keeps them, and any
    difference becomes a position change for review.
- **Reinvested dividends** show up as a cash dividend plus a position change, which review can
  turn into M5's "reinvested" dividend.

### Credentials

- **The access URL is a password to your financial data.**
  - It's encrypted at rest (AES-256-GCM) with `SIMPLEFIN_ENCRYPTION_KEY`, which must be 32 bytes,
    base64. **Without it, `app` doesn't start.**
  - Each value gets its own nonce, and records which key encrypted it, so the key can be rotated
    later.
- **It never reaches the browser.** The page shows the host and when it was connected. The setup
  token is used once, then dropped.
- **No fetching arbitrary URLs from what may be a public server:**
  - claim and access URLs must be `https`
  - to a host on `SIMPLEFIN_HOSTS` (default: the SimpleFIN Bridge's)
  - and not resolve to a private address
  - Test stacks allow the fake server's plain HTTP (`SIMPLEFIN_ALLOW_HTTP`).
- **Deleting your account** (M8) deletes your connections too: `auth` calls a new `app` route
  for your user-level data, after deleting your books.

### Configuration

- **`auth` and `app` read their settings through `@wymp/config-simple`,** set up as its README
  describes:
  - **One `src/config.ts` per service:** every setting with `configValue`, `REQUIRED` where
    there's no production-safe default, validated (and so failing) at boot.
  - **Per-environment files:** `APP_ENV` (`production`, `development` or `test`) picks
    `.env/<APP_ENV>`, and `.env/local` (gitignored) overrides it. Real environment variables
    win over both.
- **Which file each stack uses:**
  - **`.env/test`** has the e2e stack's settings, including a fixed SimpleFIN key for its fake
    data. `compose.e2e.yaml` then sets `APP_ENV=test` and little else.
  - **`.env/development`** is for running services on the host.
  - **`.env/production`** holds only production-safe values; secrets come from the environment.
- **`SIMPLEFIN_ENCRYPTION_KEY` is `REQUIRED` in production and development,** so the dev stack
  needs one of its own in Compose's own `.env` (gitignored):
  `SIMPLEFIN_ENCRYPTION_KEY=$(openssl rand -base64 32)`.
- **The ledger (Python) keeps its two environment variables** as they are (answer 4).

### Test infrastructure

- **A fake SimpleFIN server,** `tests/simplefin-fake`. It's a small Node service in the e2e stack,
  as Mailpit is for mail, and follows the Bridge's actual shapes (including `payee`, `memo`,
  `holdings`, and both error forms).
  - It implements claim (one use, then 403) and `/accounts` with Basic auth, dates, `pending`
    and `account`.
  - Tests script it: add accounts, transactions and holdings; set balances; inject errors; count
    requests.
- **Unit tests in `app`:**
  - windows and overlap, the budget
  - reconcile end to end against fakes: pending marking, matching, confirming, staging, the
    opening-balance arithmetic, what's left over
  - start-over
  - position changes
  - cross-source matching, time-zone dates
  - error mapping, encryption round trips, the URL checks, config validation
- **e2e:**
  - claim, link a new account, sync, re-sync with overlap (no duplicates)
  - reconcile an account that has CSV history
  - start over
  - a brokerage's snapshot and a position change
  - errors, unlink, the budget, the SSRF refusals
  - `app` refusing to start without its key
- **Browser tests:**
  - connect with a token, link
  - the reconcile preview, and confirming it
  - "Not at the bank" in review
  - the "Reported …" line, Sync now, errors
- **By hand on the dev stack:** the demo token, then your banks and Fidelity.

## How it gets built

1. **Configuration:** `@wymp/config-simple` in `auth` and `app` (`src/config.ts`, `.env/` files,
   `APP_ENV` in Compose).
2. **Look at Fidelity:** a throwaway local script dumps the shape of a real Fidelity account
   (redacted, never committed). The brokerage section is adjusted to it.
3. **Storage:**
   - `app` migration 10:
     - `simplefin_connection`: user, encrypted access URL, host, sync minute, today's request
       count, last sync, errors
     - `simplefin_account`: the last snapshot of each account, holdings included
     - `simplefin_link`
     - `import_batch.source`
   - encryption
4. **The client:** tokens, claiming, `/accounts` in both shapes, the URL checks, errors.
5. **Ledger:** versioned updates in `/transactions/changes`, and setting an account's opening
   balance within it.
6. **The pipeline:**
   - `importFile` split into the CSV front end and a source-agnostic `importRows`
   - cross-source matching
   - SimpleFIN batches
7. **Linking:** new-account history, reconcile (preview, then one write), start over, only
   what's new.
8. **Syncing:** daily job, Sync now, budget, windows.
9. **Brokerages:** the snapshot, prices, position changes, estimated opening lots.
10. **PWA:**
    - Bank connections page, link dialog with the three choices and preview
    - the "Reported …" line, errors, "Not at the bank" in review
11. **Fake server, tests, docs:**
    - design.md ("Bank feeds", "Configuration")
    - operating.md (`SIMPLEFIN_ENCRYPTION_KEY`, `SIMPLEFIN_HOSTS`, `APP_ENV`)
    - PLAN.md, RESUME.md

## Follow-ups (from trying it, 2026-10-16)

Chase and a Fidelity card linked; PNC checking and the Fidelity investment accounts didn't
(the preview timed out).

- **Link in the background.** Record the link attempt (which bank account, the account to
  create or link to, the mode) as soon as it's chosen, and fetch the history in the
  background. The preview fills in when the history is in, so you can leave the page while it
  works and come back to confirm. Today the preview fetches everything inside one request: up
  to two minutes per Bridge request for PNC and Fidelity, several in a row.
- **45-day windows.** The Bridge now says "Requested date range exceeds recommended range of 45
  days. In the future, this may be capped." (2026-10-16), against its developer guide's 90.
  Use 45, which means more requests per backfill against the daily budget. Spreading a long
  backfill over days matters more.
- **Treat Bridge notices as notices.** That message came in `errors` and was shown as an error.
  Tell warnings apart from failures (by wording, or `x-api-message`), and don't count them as
  sync problems.
- **The Fidelity look** (build step 2) is still to do, now that Fidelity is connected.

## Out of scope

- Pending transactions.
- Balance assertions and reconciling statements (M13).
- Other aggregators (Plaid, GoCardless, ...). The pipeline stays source-agnostic, so each is a
  client and a page.
- Sharing a connection with other users (M12).
- Rotating the encryption key (the stored format allows it later).

## Questions

1. **Start over and transfers:** wiping an account deletes whole transactions, so a transfer to
   another account disappears from that account too (the confirmation counts them). Fine, or
   should Start over keep transactions that also post to another *linked* account?
2. **"Not at the bank":** your transactions from S on that the bank doesn't know stay pending for
   you to keep or delete (proposed). Or delete them as part of reconciling?
3. **Brokerage lots:** SimpleFIN sends per-symbol totals, not lots, so a new brokerage link
   starts with one estimated lot per symbol (proposed). That's right for value and unrealized
   gain, but sales' short- and long-term split stays approximate until you enter real lots. OK?
4. **The ledger's configuration:** the same shape in Python (`config.py`, `.env/` files;
   proposed), or leave the ledger's two variables as they are?
