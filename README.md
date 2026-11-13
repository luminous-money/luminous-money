Luminous Money
==================================================================================================

A self-hostable, database-driven, double-entry accounting system. It uses
[Beancount](https://github.com/beancount/beancount) as its accounting engine and its import/export
format, and has a mobile-first app built for fast review and categorization. One server hosts many
books, each independent: switching books is like switching profiles.

> **Status: early, and in daily use.** Releases are on
> [GitHub](https://github.com/luminous-money/luminous-money/releases), and the milestones built
> so far are in [docs/PLAN.md](docs/PLAN.md). Expect it to change quickly.

## What it does

- **Books:** any number per server, each independent, each shareable with other people who can
  view, edit or manage it. Every book exports to a Beancount file, and a new book can start from
  one.
- **Getting transactions in:**
  - CSV imports that learn each bank's file format
  - bank feeds through [SimpleFIN Bridge](https://bridge.simplefin.org/), synced every
    morning; brokerages bring their holdings, and Fidelity's activity is read into trades,
    dividends and transfers of shares
  - receipts photographed or uploaded and read by the AI, itemized into splits
  - Amazon orders, each charge itemized into the bank's or card's transaction (the server signs
    in to Amazon for you, its credentials sealed)
  - scheduled transactions, staged as they come due
  - all of it matched against what's already in the books, so nothing comes in twice, and
    transfers between your own accounts paired into one
- **Review:** a mobile-first queue to confirm, categorize (swipe right to confirm, left to skip),
  tag and assign to funds, with search and filters. Bulk actions in Select mode work on any
  ledger as well.
- **Categorization:** your rules, then what each payee and each item went to before, then
  optional external categorizers ([their API](docs/categorizer-api.md)), then the book's AI
  (Claude, with your own API key), split by split. What the AI costs is shown as it goes.
- **Accounts:** a chart of accounts with balances rolled up (rename, move, archive, merge,
  delete), imported from a CSV or migrated from GnuCash with its history, rules learned from that
  history, and suggestions for what's uncategorized. An account at a bank can be divided into
  parts (padding, general use) that the feed keeps in step with the bank.
- **Investments:** holdings with lots, cost basis and gains, prices fetched every morning, trades
  booked by tax-aligned rules, and revalued assets such as a house or a car.
- **Planning and tracking:**
  - budgets on any account, for any period
  - funds for what money is *for*, a ledger beside the accounts, holding dollars or shares
  - loans managed from their amortization table, with escrow and its bills, and their payments
    counted as spending if you like
  - tags on splits (a receipt's one item, say), counted in reports by what's tagged
  - reconciliation against a statement, and bank-fed accounts that reconcile themselves
- **Reports:** this month's spending against the budget and a projection, cash flow, breakdowns
  by account, the largest transactions, net worth, and what an account typically comes to.
- **Running it:** one command installs, upgrades (backing up first), backs up and restores
  everything, collects logs and reports health. Optional built-in HTTPS, private instances for a
  list of emails, and a System page for admins.

## Run it

On a laptop, a home server or a public server, with Docker:

```sh
curl -fsSL https://github.com/luminous-money/luminous-money/releases/latest/download/luminous-money -o luminous-money
bash luminous-money install
```

It asks a couple of questions (this machine, or a public server with a domain and HTTPS), starts
everything, and tells you where to open it; create your account there. Upgrading, backups, logs,
health, every setting, and running it behind a proxy you already have:
**[docs/deploying.md](docs/deploying.md)**.

## Work on it

- **[RESUME.md](RESUME.md):** where work stands and what to do next. Start here.
- **[docs/PLAN.md](docs/PLAN.md):** the roadmap: the milestones ahead and those done.
- **[docs/milestones/](docs/milestones/):** each milestone's plan. Done ones are in
  `docs/milestones/.archived/`; open questions, polish and loose ends are
  [M99: Follow-ups](docs/milestones/m99-follow-ups/PLAN.md).
- **[docs/design.md](docs/design.md):** the decisions behind the system and its architecture.

You need Docker with buildx, plus Node 24 and pnpm 11 (via corepack) for the TypeScript
workspace.

```sh
pnpm install         # TypeScript workspace, for editors and host-side scripts
pnpm build           # build every service image (docker buildx bake)
docker compose up -d # run the stack on http://localhost:8080 (LUMINOUS_MONEY_PORT to change)
```

Then open `http://localhost:8080/`, which redirects to the app at `/ui/`, and **create an
account** (anyone can). For demo data, make an API token on "Your account" and run
`LUMINOUS_MONEY_TOKEN=lm_… pnpm seed`, which gives your account two demo books.

| Path | What |
|---|---|
| `/ui/` | The PWA: books, then each book's review queue |
| `/api/auth/v1` | Sign up, log in, sessions and API tokens; every other API needs a session or token |
| `/api/ledger/v1/docs` | The ledger API's interactive docs |
| `/api/app/v1` | The PWA's API: imports, bank feeds, rules, schedules, funds, loans, orders |
| `/api/ai/v1` | Each book's AI settings, and reading receipts |
| `/api/shops/v1` | Reading shops' orders (Amazon) |
| `/api/health` | The stack's health, public (for uptime monitors) |

## Everyday commands

| Command | What it does |
|---|---|
| `pnpm build` | Build every service image for this machine |
| `pnpm test` | Every test suite and contract check, in Docker (`docker buildx bake test`) |
| `pnpm e2e` | Build everything and run the end-to-end suites (API, browser, and the `luminous-money` command) against throwaway stacks |
| `pnpm test:cli` | Just the `luminous-money` command's test (images built already) |
| `pnpm e2e:local` | Run both end-to-end suites against an already-running stack (start it with `AUTH_TEST_USERS=true`) |
| `pnpm test:unit` | The TypeScript unit tests on the host (no Docker) |
| `pnpm seed [book]` | Seed a demo book with recent purchases staged for review (default: `demo`, plus the small `demo-household`) |
| `pnpm generate` | Regenerate `packages/ledger-client` after changing the ledger's API |
| `pnpm icons` | Regenerate the PWA's PNG icons from `services/app/public/icon.svg` |
| `pnpm format` | Format the TypeScript and CSS with Prettier (`pnpm test` checks it) |
| `pnpm release` | Build `linux/amd64` + `linux/arm64` images and push them (set `REGISTRY`, `VERSION`). Releases normally come from a `v*` tag, through `.github/workflows/release.yml` |
| `pnpm --filter @luminous-money/app dev` | Vite dev server for the PWA, proxying `/api` to a running stack |

## Repository layout

One repository and one product. Each language keeps its own native tooling (pnpm for TypeScript,
uv for Python), and Docker is the common build and test interface.

```
compose.yaml          the product: the whole stack (works with compose and swarm)
compose.e2e.yaml      overlay that adds the end-to-end runner
docker-bake.hcl       every image, test target and release platform
node.Dockerfile       the shared TypeScript workspace stage, its checks, and the e2e image
.github/workflows/    CI on every push; a release (images and the bundle) on every v* tag
deploy/
  gateway/            the gateway image: Traefik, its routes (/api/*, /ui/*), optional HTTPS
  env.example         every setting a deployment has
services/
  auth/               TypeScript: accounts, sessions and tokens          → /api/auth/v1
  ledger/             Python: system of record, Beancount engine      → /api/ledger/v1
  app/                TypeScript: PWA, imports, the pipeline           → /ui, /api/app/v1
  ai/                 TypeScript: AI settings, reading receipts         → /api/ai/v1
  shops/              Python: shops' orders, Amazon first               → /api/shops/v1
packages/
  ledger-client/      typed client generated from the ledger's OpenAPI schema
  ai-api/             the ai service's types, shared with app and the PWA
  db/                 SQLite for the TypeScript services: migrations, timestamps, health, lint
  csv-import/         bank CSVs: parsing, guessing a profile, reading rows
tests/
  e2e/                API end-to-end tests through the gateway
  ui/                 browser end-to-end tests (Playwright) through the gateway
  simplefin-fake/     a stand-in SimpleFIN Bridge for the end-to-end stacks
scripts/              luminous-money (the deployment command), and the scripts behind pnpm's
docs/                 design, the roadmap, deploying
  milestones/         each milestone's plan (.archived/ once done; m99-follow-ups/ for loose ends)
```

## License

[GPL-2.0-or-later](LICENSE). The ledger uses [Beancount](https://github.com/beancount/beancount),
which is GPL-2.0-only, so this is the most recent GPL that can be combined with it; "or later"
leaves room for a newer GPL if Beancount ever allows one.
