Where We Left Off
==================================================================================================

_Updated 2026-10-12._ Keep this current: every finalized change set updates it (see
[CLAUDE.md](CLAUDE.md)).

## State

**M1 (one bank account, end to end) is built,** and its
[decisions](docs/milestones/m1-one-account-e2e/PLAN.md#decisions-to-review) are answered. The
milestones ahead (M2–M13, then Polish) are in [docs/PLAN.md](docs/PLAN.md).

What a user can do now:
- **Arrive and log in.** "Log in" logs in the stub user; "Create account" is disabled until M6.
- **Set up:** name a book, then add a bank account with its balance as of a date.
- **Home** shows the bank accounts as cards, with their balances and when each was last updated
  by an import, plus a link to import transactions.
- **Menu:** Home, Manage books (list, rename, export as a Beancount file), Review, Log out.
- **Adding a bank account:** where it's kept in the ledger follows its name
  (`Assets:Bank:<Name>`) until edited, then anything the account rules allow.
- **An account's ledger:**
  - newest first, 200 a page, with infinite scroll
  - running balances, and the other account or `<multiple>`
  - tapping a transaction opens the editor, whose Back and Save stay pinned on screen
  - the line above the transactions adds one; "Import transactions" imports into this account
- **Import a CSV:**
  - the first file is profiled (columns mapped, guessed and confirmed), and later files just
    import
  - a file that fits none of the account's saved formats asks first, then replaces them or adds
    another format
  - rows are staged for review, uncategorized; duplicates, rows up to the opening balance's date,
    and unreadable rows are skipped
  - moving the opening balance back moves that cutoff (and the account's `open`) with it
  - possible matches are ranked and shown, and nothing acts on them yet
- **The review queue,** from before: skip, categorize, confirm, swipe, create accounts.

How it's put together:
- **`services/auth`** (TypeScript): the stub user, JWT sessions in an HttpOnly cookie, and
  `/verify` for Traefik's forwardAuth, which guards every other API and sets `X-User-Id`.
- **`services/ledger`** (Python): the system of record.
  - Books are owned by users and named by their `option "title"`.
  - Money accounts, and balances and account ledgers computed with SQL.
  - Versioned PATCH edits, batch writes, migrations, backups.
- **`services/app`** (TypeScript): the PWA, plus CSV profiles, imports and the pipeline
  (`src/server/pipeline`), in `app.sqlite`.
- **`packages/db`** (TypeScript migrations and timestamps, with a lint check) and
  **`packages/csv-import`** (parsing, guessing profiles, reading rows; shared by the browser and
  the server).
- **Tests, all passing:**
  - `pnpm test`:
    - ledger: 105 tests, including the table lint
    - auth: 9; app: 54; db: 10; csv-import: 22
    - plus the client drift check, typechecks and Prettier
  - `pnpm e2e`: 33 API tests and 39 browser tests
- **The local dev stack** (`docker compose up -d`) runs on `http://localhost:8080`, with the demo
  seeded for the stub user: the "Demo" book with a BofA Checking card.

## Next steps

1. **Finish M2** ([plan](docs/milestones/m2-credit-card/PLAN.md)). Done: slices 1–4 (starred
   accounts; display signs; imports match transactions already in the account; `assign`
   (move, swap, not a match) and confirm in `app`, over the ledger's atomic
   `/transactions/changes`). Next: slice 5, reviewing matches in the review queue.

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
