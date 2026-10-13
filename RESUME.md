Where We Left Off
==================================================================================================

_Updated 2026-10-13._ Keep this current: every finalized change set updates it (see
[CLAUDE.md](CLAUDE.md)).

## State

**M1 through M4 are built.** M2 (credit cards, really "any account, and matching"), M3
(scheduled transactions) and M4 (categorization) are described in their plans. The milestones
ahead (M5–M14, then Polish) are in [docs/PLAN.md](docs/PLAN.md).

What a user can do now:
- **Arrive and log in.** "Log in" logs in the stub user; "Create account" is disabled until M6.
- **Set up:** name a book, then add an account by its full name (autofill, Tab to complete),
  optionally with its balance on a date from a statement.
- **Home** shows the user's **starred** accounts as cards: balance (a card's shown as what's
  owed) and when each was last updated by an import, plus "Import transactions" and "Add an
  account" (added accounts are starred).
- **Menu:** Home, Manage books (list, rename, export as a Beancount file), Review, Schedules,
  Log out.
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
  - newest first, 200 a page, with infinite scroll; running balances, and the other account or
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

How it's put together:
- **`services/auth`** (TypeScript): the stub user, JWT sessions in an HttpOnly cookie, and
  `/verify` for Traefik's forwardAuth, which guards every other API and sets `X-User-Id`.
- **`services/ledger`** (Python): the system of record.
  - Books are owned by users and named by their `option "title"`.
  - Accounts with optional opening balances; summaries (balances, `as_of`) and account ledgers
    computed with SQL.
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
    - ledger: 107 tests, including the table lint
    - auth: 9; app: 114; db: 10; csv-import: 22
    - plus the client drift check, typechecks and Prettier
  - `pnpm e2e`: 47 API tests and 50 browser tests
- **The local dev stack** (`docker compose up -d`) runs on `http://localhost:8080`, with the demo
  seeded for the stub user: the "Demo" book, its checking account and card starred.

## Next steps

1. Say `elaborate plan for M5` (investment accounts).

## Gotchas

- **`pnpm up` is pnpm's own `update` command,** not the `up` script: it bumps dependencies. Use
  `pnpm run up` (foreground), or `docker buildx bake && docker compose up -d`.
- **The JWT secret:** Compose ships a development default for `AUTH_JWT_SECRET`, and auth warns
  about it. Set a real one before the stack leaves your machine.
- **`pnpm e2e:local` needs `AUTH_TEST_USERS=true`** on the running stack, so each test can log in
  a user of its own: `AUTH_TEST_USERS=true docker compose up -d`. (`pnpm e2e` sets it for its
  throwaway stack.) It also leaves test users and books behind; to clean up, run
  `docker compose down -v && docker compose up -d && pnpm seed`.
- **`pnpm seed` refuses to seed a book that already exists,** because the demo gets new IDs on
  every run and importing twice would duplicate everything.
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
- **`node:sqlite` is experimental in Node 22;** its warning is silenced in the service images.
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
