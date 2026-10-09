Where We Left Off
==================================================================================================

_Updated 2026-10-09._ Keep this current: every finalized change set updates it (see
[CLAUDE.md](CLAUDE.md)).

## State

Phase 1 (foundations) is mostly done. See [PLAN.md](PLAN.md) for the checklist.

- **`services/ledger`** (Python) is the system of record.
  - **Storage:** each Beancount directive is a database row holding its canonical text.
  - **Engine:** Beancount's public loader runs over rows rendered back to text.
  - **Writes:** transactions as JSON (`/transactions`, what the app uses) or any directive as
    Beancount text (`/directives`, `/import`). Every endpoint has a typed response, so
    `@fava-beans/ledger-client` exports real types (`Transaction`, `TransactionIn`, ...).
  - **Versioned, partial edits:** every edit sends the `updated_at` it read, and a stale one gets
    409. `PATCH /transactions/{id}` changes only the given fields. JSON is snake_case.
  - **Accounts:** leaves hold transactions and nodes hold sub-accounts. Top-level accounts and
    unopened parents are implicit nodes. `POST /accounts` takes a fully qualified name whose
    nearest existing ancestor must be a node; levels on the way that don't exist are opened as
    nodes in the same write. Postings to nodes are refused.
  - **Migrations:** `migrations.py`, with every table created through `create_table` (non-null
    `created_at`/`updated_at`), enforced by a lint test.
  - **Proven:** round trips are exact, validation problems map to the directive that caused them,
    BQL works, and incremental backups are made of Beancount chunks.
  - **Concurrency:** one SQLite connection per thread (the end-to-end suite caught a shared-
    connection bug).
  - **Benchmarks** are recorded in [docs/design.md](docs/design.md#performance-over-decades-of-data).
- **`services/app`** (TypeScript) serves the PWA at `/ui/`: React + Vite + `vite-plugin-pwa`,
  served by Hono, which also serves `/api/app/v1`.
  - **Home:** books with their queue sizes.
  - **Review queue:** skip, categorize with a searchable picker, edit the description, confirm.
    Swipe right to confirm and left to skip; cards that aren't ready spring back, and the
    stack slides up after each one. "Create account" is the last option in every
    posting-account picker; it takes a fully qualified name, prefilled from the search, with
    Tab/tap autofill through node accounts. It always creates a leaf.
  - **Data layer:** TanStack Query over the generated client. Edits to one transaction run in
    order, each with the latest version.
  - **Detail view:** a full split editor with a live, exact balance check.
  - The rules are in [docs/design.md](docs/design.md#how-the-review-queue-works). The pure logic
    (`src/web/lib`) has Vitest unit tests.
- **`ledger`** also serves the chart of accounts (`/accounts`) for the picker.
- **Stack:** Traefik routes by top-level prefix (`/api`, `/ui`) from its file provider. Fava was
  dropped; reports will be our own (PLAN.md, Phase 4).
  - `/api/ledger/v1` → `ledger`
  - `/api/app/v1` and `/ui` → `app`
  - `/` → redirects to `/ui/`
- **Tests, all passing:**
  - `pnpm test`: 79 ledger tests (including the table lint), 36 app unit tests, the client
    drift check, typechecks and Prettier
  - `pnpm e2e`: 25 API tests and 27 browser tests (Playwright, phone-sized Chromium, including
    real touch swipes via the DevTools protocol) through Traefik, against a throwaway stack
- **Demo data:** `pnpm seed [book]` imports a 2-year `bean-example` history whose last 45 days of
  card and checking purchases are staged for review: flagged `!`, with `source: "demo-import"`
  metadata, and roughly half (chosen by a hash of the ID) moved to `Expenses:Uncategorized`.
- **The local dev stack** (`docker compose up -d`) is running on `http://localhost:8080`
  (listening on all interfaces), with a seeded `demo` book: 24 staged transactions, 8 of them
  uncategorized. Its 2 validation problems are `bean-example`'s own 401(k) balance assertions,
  which is handy for building the problems UI.

## Next steps

The roadmap now continues past the review app with the chart of accounts and general ledger
(Phase 3), reports (Phase 4) and budgeting (Phase 5); see [PLAN.md](PLAN.md). Their open questions
are listed there and are worth settling before starting each phase.

1. **Use the review queue for real on a phone** (`http://<laptop-ip>:8080/ui/`) and collect
   friction. Likely candidates: suggested categories from payee history (the `rules` resolver),
   bulk categorization, and showing validation problems in the UI.
2. **Asynchronous, debounced validation in `ledger`.** Today `problems` validates on demand,
   synchronously.
3. **`auth` service + forwardAuth,** before the stack is exposed beyond localhost.

## Gotchas

- **`pnpm seed` refuses to seed a book that already exists,** because the demo gets new IDs on
  every run and importing twice would duplicate everything. To start over, run
  `docker compose down -v && docker compose up -d && pnpm seed` (this wipes the dev stack's data).
- **`pnpm e2e:local` leaves test books in the dev stack** (`ui-…`, `review-…` and so on). To
  clean up, run `docker compose down -v && docker compose up -d && pnpm seed`.
- **Playwright is pinned to 1.63.0** in `tests/ui/package.json` and in `node.Dockerfile`'s `ui`
  stage. They must match, because the image's preinstalled browsers belong to that version. Bump
  both together.
- **The UI calls the ledger API directly** through Traefik. Nothing proxies through `app` yet;
  that changes once auth exists.
- **Databases from before the migration framework are refused** with a message to recreate them
  (`docker compose down -v`). No real data exists yet, so there's no backfill.
- **Beancount 3.2's `extra_validations` leaks:** each load appends them to a global list. Run
  extra checks after loading instead (see `engine.load`).
- **`openapi-typescript` treats fields with defaults as required,** so the generated request
  types ask for `flag` and `narration` even though the API defaults them.
- **TypeScript is pinned to 5.x.** `openapi-typescript` needs the TypeScript 5 compiler API, and
  pnpm will offer TypeScript 7, which breaks generation.
- **pnpm 11 checks the lockfile against a supply-chain policy, which needs registry access.**
  That's why `node.Dockerfile` installs with `--prefer-offline`, not `--offline`.
- **Swarm hasn't been exercised for real.** `docker stack config -c compose.yaml` accepts the
  file, but `docker swarm init` wasn't run on the dev machine.
- **Text endpoints need `beancount()` with openapi-fetch.** It assumes JSON bodies; the helper in
  `tests/e2e/src/support.ts` sends text unchanged. The app should prefer the JSON endpoints.
- **Exports use Beancount's printer alignment,** which pads some `open` and `price` lines widely.
  It's cosmetic.

## Verify

```sh
pnpm test                 # unit tests, contract drift, typechecks, formatting
pnpm e2e                  # whole stack, end to end
docker compose up -d      # then open http://localhost:8080/
```
