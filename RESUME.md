Where We Left Off
==================================================================================================

_Updated 2026-10-15._ Keep this current: every finalized change set updates it (see
[CLAUDE.md](CLAUDE.md)).

## State

**M1 through M10 are built** (M7, cross-book transactions, was dropped: books are independent).
M2 (credit cards, really "any account, and matching"), M3 (scheduled transactions), M4
(categorization), M5 (investments), M6 (multiple books), M8 (auth), M9 (SimpleFIN) and M10 (chart of
accounts) are described in their plans. The milestones ahead (M11–M19, then Polish) are in [docs/PLAN.md](docs/PLAN.md).

What a user can do now:
- **Accounts (M10):** Menu → Accounts: one card, the tree by type, tap a node to open or close
  it, balances rolled up (one figure each), Find, "Show archived". A node's › opens its editor
  (with "Add an account under it"); a leaf opens its ledger, whose Edit opens the same editor:
  names (display and full: rename or move), an asset's settings (lots, revaluing), archive (with an optional closing
  transfer), delete or merge into another account. System accounts are protected.
- **Bank feeds (M9):** Menu → Bank connections: paste a SimpleFIN Bridge setup token, then link
  each bank account (new, or an existing one reconciled with the bank as the source of truth;
  also "start over" and "from a date"). The history comes in the background; confirm from the
  preview. New transactions arrive each morning (or "Sync now") into review. Synced accounts
  show "Reported today 6:00am: $…"; yours the bank doesn't have are "Not at the bank" in
  review. Brokerages (Fidelity) bring holdings, prices and position changes.
- **Accounts (M8):** anyone creates one (name, email, a 15+ character password not known from
  breaches) and logs in on any number of devices; "Forgot password?" emails a reset link when
  the server has mail. **Your account:** name and email (confirmed by emailed link), password,
  devices (log any out, or everywhere else), API tokens for scripts, and deleting it all.
- **Set up:** name a book, then add an account by its full name (autofill, Tab to complete),
  optionally with its balance on a date from a statement.
- **Home** shows the user's **starred** accounts as cards: balance (a card's shown as what's
  owed) and when each was last updated by an import, plus "Import transactions" and "Add an
  account" (added accounts are starred).
- **Books (M6):** the selected book is the context for everything, and it's in the URL
  (`/books/:book/…`); `/` opens the last book used on this device.
  - The masthead's **book switcher** lists your books and Manage books.
  - **Manage books:** create a book (empty, or from a Beancount file such as an export), open,
    rename, export, set the time zone, and delete (type the name; Export offered). Names are
    unique per user.
- **Menu:** the book's Home, Review, Schedules, Rules and Commodities; Manage books; Log out.
- **Schedules:** a transaction plus a rule (every N days/weeks/months/years, days of the month,
  weekends moved or kept, an optional end), made new or with "Repeat…" on any transaction.
  - Due occurrences are staged (at startup, after saves, and daily after midnight in the book's
    time zone) as pending transactions, or confirmed if the schedule confirms automatically;
    marked ↻ in ledgers, and matched by imports like any transaction.
  - Each split can have a match tolerance: the bank's amount within it matches, and wins on
    confirm.
  - "Not this time" in review drops an occurrence for good; editing a schedule restages its
    unconfirmed occurrences from today.
  - The Schedules page lists them and what's coming in 16 days; ledgers show what's coming as
    grayed rows with a projected balance.
- **Manage books** also sets each book's time zone (new books take the browser's).
- **An account's ledger:**
  - newest first, 200 a page, with infinite scroll; "Go to date" for a partial view from that
    date back, with "Load more" above for newer pages; running balances, and the other account or
    `<multiple>`; liabilities and income shown inverted, colored by their effect on net worth
  - a star toggle (home page), "Import transactions", and the add line above the transactions
  - tapping a transaction opens the editor, whose Back and Save stay pinned on screen
- **Import a CSV** into any open leaf account (starred listed first):
  - the first file is profiled (columns mapped, guessed and confirmed), and later files just
    import; a file that fits none of the saved formats asks first, then replaces them or adds one
  - duplicates, rows up to the opening balance's date, and unreadable rows are skipped
  - **rows that are the same event as a transaction already in the account match it** (same
    amount, ±5 days, not already held by this account's imports): nothing is added. So a
    payment categorized to the card on checking's import is recognized by the card's import, and
    hand-entered transactions are reconciled
  - the rest are staged for review, uncategorized
- **Review:** pending transactions (skip, categorize, confirm, swipe, create accounts) and
  proposed matches: confirm, "Match with this instead", "Swap" (with the row holding a
  candidate), or "Not a match" (stages the row on its own).
- **Categorization (M4):** imported rows are staged with a proposed category and clean payee:
  from the user's **rules** (Rules page; can confirm automatically), from **history** (what the
  same payee was confirmed as), or from **external providers** (`CATEGORIZERS`, speaking
  [our API](docs/categorizer-api.md)). Review shows where each came from; "Suggest categories",
  "Also categorize N similar", "Remember as a rule…" and Select mode speed it up. Acceptance
  per categorizer shows on the Rules page.
- **Select mode** (review and account ledgers): a sticky bar (Categorize as…, Confirm, Done);
  tap anywhere on a card or row to select. Ledgers also have "Suggest categories".
- **Investments (M5):** starred brokerages and holdings show **value, unrealized gain** and how
  fresh their prices are; account pages list **holdings** (lots, Update price) and **Trade**
  (buy, sell with a lot preview and short/long-term gains, dividends); houses and cars are
  **revalued** (Update value, every 350 days); **Commodities** shows prices and their sources.
  Prices are fetched each morning (beanprice). Accounts can open with holdings.

How it's put together:
- **`services/auth`** (TypeScript): users and identities (passwords now, OIDC later), Argon2id,
  10-minute Ed25519 access tokens with rotating refresh tokens (HttpOnly cookies in the browser),
  API tokens, email links, the operator's CLI (`dist/cli.js`), and `/verify` for Traefik's
  forwardAuth, which guards every other API and sets `X-User-Id`.
- **`services/ledger`** (Python): the system of record.
  - Books are owned by users and named by their `option "title"`.
  - Accounts with optional opening balances and holdings; summaries (balances, `as_of`,
    value, gain) and account ledgers computed with SQL; subtrees for brokerages.
  - Investments (`investments.py`): prices, valuation, account-scoped booking for cost basis,
    holdings, trades, revaluation, beanprice fetching.
  - Versioned PATCH edits, batch writes, atomic create-and-delete (`/transactions/changes`),
    migrations, backups and export.
- **`services/app`** (TypeScript): the PWA, plus stars, CSV profiles, imports, the pipeline
  (`src/server/pipeline`: matcher, then assignment), match review (`src/server/matches.ts`) and
  schedules (`src/shared/schedule.ts` for rules, `src/server/schedules.ts` for the generator), and
  categorization (`src/server/categorize`: the chain, context, `rules`, `history`, external
  providers; the external API's types in `src/shared/categorizer-api.ts`), in `app.sqlite`.
- **`packages/db`** (TypeScript migrations and timestamps, with a lint check) and
  **`packages/csv-import`** (parsing, guessing profiles, reading rows; shared by the browser and
  the server).
- **Tests, all passing:**
  - `pnpm test`:
    - ledger: 143 tests, including the table lint
    - auth: 20; app: 139; db: 10; csv-import: 22
    - plus the client drift check, typechecks and Prettier
  - `pnpm e2e`: 68 API tests and 75 browser tests (with Mailpit and a fake SimpleFIN server)
- **The local dev stack** (`docker compose up -d`) runs on `http://localhost:8080`, without
  mail. Kael's account claimed the old stub user, so it owns the "Demo"
  book (checking, card and ETrade brokerage starred) and "Demo Household" (joint checking).

## Next steps

1. Say `elaborate plan for M11` (budgets).
2. Answer the open questions in [the M8 plan](docs/milestones/m8-auth/PLAN.md#questions).

## Gotchas

- **Fetching prices needs the network** (beanprice's sources: Yahoo and friends, which change
  now and then). A commodity's source is its `commodity` directive's `price:` metadata;
  `ledger.price_sources.fixed` is a no-network source for tests and demos.
- **The morning price run only covers books with a time zone,** since that records who it acts
  as. Every book gets one: on creation, by `pnpm seed`, or (older books) the browser's the first
  time the PWA loads them.

- **`pnpm up` is pnpm's own `update` command,** not the `up` script: it bumps dependencies. Use
  `pnpm run up` (foreground), or `docker buildx bake && docker compose up -d`.
- **Account names are what `app` keys its data by.** Rename, archive and delete accounts through
  `app` (`/api/app/v1/books/:book/accounts/:account/...`), not the ledger directly, or stars,
  profiles, rules, schedules and bank links are left pointing at the old name.
- **SimpleFIN's budget:** about 24 requests a day per connection at the Bridge; the app stops at
  20 (UTC days). Linking a long history takes several; "Sync now" takes one or two.
- **The dev stack needs `SIMPLEFIN_ENCRYPTION_KEY`** (app won't start without it): it's in the
  repo root's `.env` (gitignored), which Compose reads. Keep it: stored SimpleFIN connections
  can't be opened without it.
- **`auth` and `app` read settings through `@wymp/config-simple`** (`src/config.ts`, plus
  `.env/<APP_ENV>` files in each service). Its `configValue` reads a third argument that's an
  array as validators, not a default: give list defaults as a string and split them.
- **Auth keeps its signing keys in `auth.sqlite`;** `AUTH_JWT_SECRET` is gone (auth warns if
  it's still set). Wiping the volume logs everyone out, as well as deleting them.
- **`FAVA_BEANS_PUBLIC_URL` must be the address users reach,** when set: `auth` refuses writes
  from any other origin (so a LAN IP and a hostname can't both be used).
- **The host's Node may be older than the images' (24).** `auth`'s unit tests need Node 24
  (built-in Argon2id); `pnpm test` runs them in Docker, or run
  `docker run --rm -v "$PWD":"$PWD" -w "$PWD/services/auth" node:24-slim npx vitest run`.
- **`pnpm e2e:local` needs `AUTH_TEST_USERS=true`** on the running stack, so each test can log in
  a user of its own: `AUTH_TEST_USERS=true docker compose up -d`. (`pnpm e2e` sets it for its
  throwaway stack.) It also leaves test users and books behind; to clean up, run
  `docker compose down -v && docker compose up -d`, sign up again, and `pnpm seed` with a new
  API token.
- **`pnpm seed` skips a book that already exists,** because the demo gets new IDs on every run
  and importing twice would duplicate everything. Pass another book ID for a fresh one.
- **Databases from before a service's migrations are refused** with a message to recreate them
  (`docker compose down -v`). No real data exists yet, so there's no backfill.
- **All services share the data volume as UID 1000.** A volume created by an older, root-owned
  image needs `docker compose down -v` once.
- **Playwright is pinned to 1.63.0** in `tests/ui/package.json` and in `node.Dockerfile`'s `ui`
  stage. They must match, because the image's preinstalled browsers belong to that version.
- **Beancount 3.2's `extra_validations` leaks:** each load appends them to a global list. Run
  extra checks after loading instead (see `engine.load`).
- **`openapi-typescript` treats fields with defaults as required,** so the generated request
  types ask for `flag` and `narration` even though the API defaults them.
- **TypeScript is pinned to 5.x.** `openapi-typescript` needs the TypeScript 5 compiler API.
- **`node:sqlite` is still experimental in Node 24;** its warning is silenced in the service images.
- **pnpm 11 checks the lockfile against a supply-chain policy, which needs registry access.**
  That's why `node.Dockerfile` installs with `--prefer-offline`, not `--offline`.
- **Swarm hasn't been exercised for real.** `docker stack config -c compose.yaml` accepts the
  file.
- **Text endpoints need `beancount()` with openapi-fetch.** The app should prefer the JSON
  endpoints.

## Verify

```sh
pnpm test                 # unit tests, contract drift, typechecks, formatting, lint
pnpm e2e                  # whole stack, end to end (API and browser)
docker compose up -d      # then open http://localhost:8080/ and log in
```
