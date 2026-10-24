Where We Left Off
==================================================================================================

_Updated 2026-10-24._ Keep this current: every finalized change set updates it (see
[CLAUDE.md](CLAUDE.md)).

## State

**This is Luminous Money** (renamed from fava-beans on 2026-10-23, when it became the Luminous
Money product). The original Luminous Money attempt (`luminous-money/system` and its service
repositories) is archived on GitHub and kept locally in `../.archive/system`. Everything says
`luminous-money` now: packages (`@luminous-money/*`), images, the `luminous-money` command,
`LUMINOUS_MONEY_*` settings, the `lm_` token and cookie prefix, and the tombstone type
(`custom "luminous-money" "deleted"`). The dev databases were wiped for the rename. License:
GPL-2.0-or-later (Beancount is GPL-2.0-only). It wears the original app's look: its palette
(light gray and blue; deep blue and cyan in dark mode) and its Lu logo (design.md, "Its look").

**M1 through M16 are built** (M7, cross-book transactions, was dropped: books are independent).
M2 (credit cards, really "any account, and matching"), M3 (scheduled transactions), M4
(categorization), M5 (investments), M6 (multiple books), M8 (auth), M9 (SimpleFIN), M10 (chart of
accounts), M11 (budgets), M12 (reports), M13 (sharing books), M14 (reconciliation), M15 (divided
accounts) and M16 (receipt capture) are described in their plans. The milestones ahead
(M17–M20, then Polish) are in [docs/PLAN.md](docs/PLAN.md).

What an operator can do now (production readiness, phase 1; [docs/deploying.md](docs/deploying.md)):
`luminous-money install` sets a deployment up (a laptop, or a public server with built-in HTTPS),
then `status`, `upgrade` (backing up first), `backup` / `restore` (every database, the
attachments and the keys, online), `logs`, `report` (for bug reports, secrets hidden) and
`config`, and `auto-upgrade on|off` (a crontab line). Every service has `/health` and an image
healthcheck; `/api/health` is public for uptime monitors (with a domain, the certificate too).
Admins (`LUMINOUS_MONEY_ADMINS`, once their email is confirmed) see **System** in the menu:
versions, health, data, the last backup, and whether a newer release is out. Nothing is
published yet: there's no GitHub repository or release.

What a user can do now:
- **Receipts (M16):** Menu → AI turns a book's AI on (Claude, with an API key kept encrypted;
  itemize by default; whether the AI may open accounts, how eagerly, with what guidance). Once
  it's ready, the masthead's **camera** opens Capture receipt: the live camera (or Upload
  instead), the account it was paid from (the page you came from), Itemize?, and anything you
  know (total, date, payee, note). **Create transaction** reads it (what it says, then where its
  splits belong: rules, history, items bought before, then the AI) and lands on it in review;
  itemized, each line is a split with its own account to pick. Confirming or skipping goes back
  to where you were. The account that paid is the one holding the receipt's **card** (an asset
  or liability's editor lists its **Payment cards**: brand and last four), else the page you
  came from, else `Assets:Unknown`, which review asks to replace ("Paid from"). If it can't be
  read (AI off, down, or it failed), the transaction is made from what you typed, saying why.
  **Attachments:** any transaction's page has them (Open camera, or Upload; 5 MB each), new
  transactions too.
- **Split flags (M16):** what's proposed and not yet confirmed is marked on the split (`!` on
  the posting): imports stage their categorized side that way, choosing an account yourself or
  confirming clears it, and Suggest categories and rules act on what's still flagged.
- **Divided accounts (M15):** an asset or liability account's editor has **Divide…**: name the
  main part (where new money lands, and what's left) and the others with what they start with;
  the account keeps its name, bank link, statements and history (now its main part's). Its page
  shows the **Parts** (balances, shares, any below zero, **Move money**), its ledger says which
  part each transaction touched ("General → Padding" for a move), and its home card shows the
  parts as a stacked line. Bank feeds and files land in the main part (a rule's **Lands in** can
  send what it matches to another), matching looks across all the parts, and the whole still
  reconciles with the bank. "Paid from: General ▾" in review and on a transaction's page moves
  it to another part.
- **Reconciliation (M14):** an asset or liability account's page has **Reconcile**: the
  statement's date and ending balance (prefilled from the bank, or the last imported file's
  balance column), its unreconciled transactions to tick (imported ones and the opening balance
  start ticked), and the difference pinned below. **Finish** once it's zero (ticked unconfirmed
  ones are confirmed; nothing's date changes, and what isn't ticked stays outstanding); **Save for later** keeps it for
  any device; past statements with **Undo** on the latest. Ledgers mark reconciled transactions
  ✓ and say "Reconciled through …" or "Off by … since …"; every ledger (and Transactions) has a
  **filter** (Reconciliation: all, reconciled, not), and Select mode's **Select all** takes
  what's shown. Editing a reconciled transaction asks first. A **divided account** (the editor:
  an asset or liability node that's one real account its sub-accounts divide) reconciles as one.
  Bank-fed accounts say "Matches the bank ✓" or "Off from the bank by … since …", and reconcile
  themselves after a sync once everything's confirmed and agrees. An imported file with a
  balance column says whether the books agree with it.
- **Sharing (M13):** Manage books → Share: invite someone by link (can view, edit or manage;
  copy or share it), see who has the book, change roles, remove people, withdraw invitations.
  Whoever opens the link and accepts gets the book (a shared one says "Shared with you · Can
  edit"); anyone can Leave. A book you can only view says so, and its editing is hidden.
- **Reports (M12):** home's "Spent this month" (the month's spending by day against the budget,
  and what 85% of months stay under), then recent transactions (every account's), whose title
  opens **Transactions** (the whole journal, paged, "Go to date"). **Reports** (menu): cash flow,
  a breakdown to drill into, this month's largest, net worth. An expense or income account's
  page shows what its weeks, months and years typically come to.
- **Budgets (M11):** Menu → Budgets: one card by type, each budgeted account (and those above
  it) with a filled line, "$88 left · 12 days left", and what's unconfirmed; a budgeted node
  with budgets under it shows its Other. Tap a row to set or change its budget (amount, period:
  weekly to yearly or every N of a unit, applies from); "+ Add" for any account; "Per month"
  restates them all. The account's ledger shows its budget line; its editor has a Budget card;
  home shows this month against the top-level expense budgets. "Exclude from budget" on a
  transaction (review, or its page) keeps it out of budgets only. Manage books sets the day
  weeks start.
- **Transfers in review:** money out of one account and the same into another within 7 days,
  both imported, are paired into one transfer (after every import or sync), shown with what it
  was made of; "Reject" brings the two back and they're not paired again.
- **Accounts (M10):** Menu → Accounts: one card, the tree by type, tap a node to open or close
  it, balances rolled up (one figure each), Find, "Show archived". A node's › opens its editor
  (with "Add an account under it"); a leaf opens its ledger, whose Edit opens the same editor:
  names (display and full: rename or move), an asset's settings (lots, revaluing), archive (with an optional closing
  transfer), delete or merge into another account, or delete it with all its transactions (a red
  notice first lists every other account that changes). System accounts are protected.
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
- **Menu:** the book's Home, Review, Accounts, Budgets, Reports, Schedules, Rules,
  Commodities, Bank connections and AI; Manage books; Your account; Log out.
- **Schedules:** a transaction plus a rule (every N days/weeks/months/years, days of the month,
  weekends moved or kept, an optional end), made new or with "Repeat…" on any transaction.
  - Due occurrences are staged (at startup, after saves, and daily after midnight in the book's
    time zone) as unconfirmed transactions, or confirmed if the schedule confirms automatically;
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
- **Review:** unconfirmed transactions (skip, categorize, confirm, swipe, create accounts) and
  proposed matches: confirm, "Match with this instead", "Swap" (with the row holding a
  candidate), or "Not a match" (stages the row on its own).
- **Categorization (M4):** imported rows are staged with a proposed category and clean payee:
  from the user's **rules** (Rules page; can confirm automatically), from **history** (what the
  same payee was confirmed as), or from **external providers** (`CATEGORIZERS`, speaking
  [our API](docs/categorizer-api.md)). Review shows where each came from; "Suggest categories",
  "Also categorize N similar", "Remember as a rule…" and Select mode speed it up. Acceptance
  per categorizer shows on the Rules page.
- **Select mode** (review, account ledgers and Transactions): a sticky bar with **Actions ▾**
  (Confirm, Categorize as…, Suggest categories: rules, history and the book's AI), Select all
  and Done; tap anywhere on a card or row to select. Review and ledgers also have "Suggest
  categories" for everything unconfirmed.
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
- **`services/ai`** (TypeScript, M16): each book's AI settings and sealed credential
  (`ai.sqlite`), the providers (`src/providers`: `claude`, and `fake` for test stacks, chosen
  by `AI_PROVIDERS`), and two operations: `receipts/extract` (a receipt's facts; Claude Sonnet
  5) and `categorize` (where splits belong; Claude Opus 5). It answers; `app` composes and stages
  (`src/server/receipts.ts`, the chain in `src/server/categorize`, its AI step `ai.ts`), and the
  ledger keeps the files (attachments, migration 10). Their shared types are `packages/ai-api`.
- **Deploying:** `deploy/gateway` (the gateway image: Traefik pinned, the routes, its static
  config written at start by `entrypoint.sh`), `deploy/env.example`, `scripts/luminous-money` (the
  operator's command; its test is `scripts/cli-test.sh`), `ledger.snapshot` (whole-system
  backup and restore), and `.github/workflows` (CI; a release on a `v*` tag).
- **`packages/db`** (TypeScript migrations and timestamps, the sealer, `health`, with a lint check) and
  **`packages/csv-import`** (parsing, guessing profiles, reading rows; shared by the browser and
  the server).
- **Tests, all passing:**
  - `pnpm test`:
    - ledger: 185 tests, including the table lint
    - auth: 20; app: 189; ai: 9; db: 10; csv-import: 22
    - plus the client drift check, typechecks and Prettier
  - `pnpm e2e`: 90 API tests and 96 browser tests (with Mailpit, a fake SimpleFIN server and
    the fake AI provider), then the `luminous-money` command's test (`pnpm test:cli` alone)
- **The local dev stack** (`docker compose up -d`) runs on `http://localhost:8080`, without
  mail. Kael's account claimed the old stub user, so it owns the "Demo"
  book (checking, card and ETrade brokerage starred) and "Demo Household" (joint checking).

## Next steps

1. **The first live deployment** (Kael, after a last local pass over linking, matching,
   receipts and reconciling): publish first (create `luminous-money/luminous-money` on GitHub,
   push, tag `v0.1.0`, make the ghcr.io images public), then `luminous-money install` where it'll
   run (docs/deploying.md).
2. **M17 (transaction tagging):** see [its plan](docs/milestones/m17-transaction-tagging/PLAN.md).
3. Later, not pressing: [PLAN.md's "Later"](docs/PLAN.md#later-noted-not-pressing) (email,
   ownership transfer, the rest of M8's auth questions).

## The ledger-graphs libraries

- **The app depends on them from npm** (`@luminous-money/ledger-graphs-api` and `-ui`, `^0.1.1`).
  Their home is [luminous-money/ledger-graphs](https://github.com/luminous-money/ledger-graphs)
  (public, ISC; `libs/api`, `libs/ui`; CI on every push). Local clone:
  `~/Repos/luminous-money/ledger-graphs`.
- **Changing them:** change and test them there, then `pnpm release <version>` there. The `v*`
  tag runs its Publish workflow, which publishes by npm's trusted publishing (OIDC: no token,
  with provenance). Then bump the version here.
- **`minimumReleaseAgeExclude: '@luminous-money/*'`** (pnpm-workspace.yaml) lets a fresh
  release install here at once.

## Gotchas

- **Reconciliation's marks belong to reconciling:** the ledger keeps a posting's `reconciled:`
  through JSON edits and strips it from new transactions (`service._marked`). Write marks only
  through `reconcile.py`.
- **Statements hold by marks, not dates:** a statement is a `custom "statement"` directive, not
  a `balance` assertion, so Beancount doesn't check it; `reconcile._history` does (what's
  reconciled with it and before). Don't turn statements back into `balance` directives: a
  transfer two banks date apart can't satisfy both sides by date.
- **Loans and withheld taxes:** how to record them is in [docs/loans-and-taxes.md](docs/loans-and-taxes.md).
- **The first browser tests of a cold e2e stack** can time out waiting for review to load (seen
  once, 2026-10-17: three of accounts.spec, passing on a rerun). m1.spec's "a file in another
  layout" failed now and then (no import results) until 2026-10-23: a file chosen before the
  account's CSV layouts had loaded was profiled as if it had none. Import now offers the file
  picker only once they have. m3.spec's time zone raced
  the PWA giving a new book the browser's zone in the background; the test now waits for it.

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
- **The dev stack needs `SIMPLEFIN_ENCRYPTION_KEY` and `AI_ENCRYPTION_KEY`** (app and ai won't
  start without them): they're in the repo root's `.env` (gitignored), which Compose reads. Keep
  them: stored SimpleFIN connections and AI keys can't be opened without them.
- **A form waits for the data its pickers need** (Import's file picker for the account's CSV
  layouts, the transaction editor for the chart): offered too early, a file is profiled as if the
  account had none, and a typed account name finds nothing, so Enter offers to create it. Both
  were the e2e suite's occasional failures under load.
- **`pnpm e2e` keeps the browser failures' traces and page snapshots** in `tests/ui/test-results`
  (`pnpm exec playwright show-trace <trace.zip>` there).
- **Colors are variables** (`--accent`, `--accent-soft`, `--on-accent`, `--paper`, `--card`,
  `--ink`, `--muted`, `--line`, `--good`, `--bad` in `styles.css`, light and dark): use them, not
  hex values, and put text on the accent in `--on-accent` (it's dark on the dark mode's cyan).
- **The PNG icons come from `services/app/public/icon.svg`:** after changing it, `pnpm icons`.
- **The gateway's routes are inside its image** (`deploy/gateway/routes.yml`): after changing
  them, `docker buildx bake gateway` (or `pnpm build`) and `docker compose up -d`. Its static
  config is written at start from the environment, so edit `entrypoint.sh`, not a YAML file.
- **The HTTPS port is random without a domain** (`LUMINOUS_MONEY_HTTPS_PORT` unset): nothing
  listens on it then, and two stacks on one machine don't collide.
- **A confirmed transaction has no split flags:** the ledger drops them on any `*` write
  (`engine.confirmed`), and `FakeLedger` does the same, so tests see what production does.
  Don't confirm by editing text if the flags matter: text keeps what it says.
- **The AI never breaks a flow; it says why it didn't help.** A failed call (no credit, a bad
  key, an unknown model) becomes the reason in a receipt's note (shown on its review card and its transaction page,
  `ReceiptNote`) or Suggest categories' note, and
  a line in `docker compose logs ai`. Real Claude calls haven't been exercised in tests (no key
  in the repo): the first real ones are Kael's.
- **Claude's models are set per operation:** `AI_CLAUDE_EXTRACT_MODEL` (default
  `claude-sonnet-5`) and `AI_CLAUDE_CATEGORIZE_MODEL` (default `claude-opus-5`); the old
  `AI_CLAUDE_MODEL` is gone. The server-side refusal fallback is only sent for Opus 5 and Fable
  5 models.
- **Receipts need the `ai` service:** without it (or a book that isn't ready) the camera isn't
  offered, and `app`'s receipt route still makes the transaction from the hints. Test stacks
  offer the `fake` provider (`AI_PROVIDERS=claude,fake`); production only `claude`.
- **`auth` and `app` read settings through `@wymp/config-simple`** (`src/config.ts`, plus
  `.env/<APP_ENV>` files in each service). Its `configValue` reads a third argument that's an
  array as validators, not a default: give list defaults as a string and split them.
- **Auth keeps its signing keys in `auth.sqlite`;** `AUTH_JWT_SECRET` is gone (auth warns if
  it's still set). Wiping the volume logs everyone out, as well as deleting them.
- **`LUMINOUS_MONEY_PUBLIC_URL` must be the address users reach,** when set: `auth` refuses writes
  from any other origin (so a LAN IP and a hostname can't both be used).
- **The host's Node may be older than the images' (24).** `auth`'s unit tests need Node 24
  (built-in Argon2id); `pnpm test` runs them in Docker, or run
  `docker run --rm -v "$PWD":"$PWD" -w "$PWD/services/auth" node:24-slim npx vitest run`.
- **The dev stack has no test logins:** compose doesn't pass `AUTH_TEST_USERS` through, and
  only `APP_ENV=test` turns it on. To poke at the UI (or take screenshots) without touching the
  dev stack's data, start the e2e stack under its own project, `docker compose -p
  luminous-money-e2e -f compose.yaml -f compose.e2e.yaml up -d traefik auth ledger app ai mailpit
  simplefin-fake`, and run Playwright (the `mcr.microsoft.com/playwright:v1.63.0-noble` image)
  on its network, `luminous-money-e2e_default`, at `http://traefik`. `pnpm e2e` tears it down.
- **A mutation's per-call `onSuccess` doesn't run if its component unmounted first,** and a
  hook-level `onSuccess` that returns an invalidation is awaited before it: a form keyed on
  what that refetch changes is gone by then. Await `mutateAsync` instead (Reconcile's Finish,
  the account editor's names).
- **The PWA's URLs keep account names' colons** (`/accounts/Assets:Bank:Checking`): browser
  tests compare decoded paths, not `encodeURIComponent`'s.
- **An effect must return a function or nothing:** `useEffect(() => cond && set(x))` returns
  `false`, which React later calls as a cleanup ("l is not a function" in production).
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
pnpm e2e                  # whole stack, end to end (API, browser, the luminous-money command)
docker compose up -d      # then open http://localhost:8080/ and log in
```
