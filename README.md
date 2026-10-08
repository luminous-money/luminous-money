fava-beans
==================================================================================================

A self-hostable, database-driven, double-entry accounting system. It uses
[Beancount](https://github.com/beancount/beancount) as its accounting engine and its import/export
format, has a mobile-first app built for fast review and categorization, and uses
[Fava](https://github.com/beancount/fava) for read-only reporting. One server hosts many books and
handles transactions that span several of them.

> **Status: early build.** The ledger service, the stack, routing and a PWA shell are running and
> tested. Nothing here touches real money yet: the plan is to build and polish the UI against test
> data first, and only then hydrate with real finances.

- **[RESUME.md](RESUME.md):** where work stands and what to do next. Start here.
- **[PLAN.md](PLAN.md):** the roadmap, deferred items and open questions.
- **[docs/design.md](docs/design.md):** the decisions behind the system and its architecture.

## Quick start

You need Docker with buildx, plus Node 22 and pnpm 11 (via corepack) for the TypeScript
workspace.

```sh
pnpm install         # TypeScript workspace, for editors and host-side scripts
pnpm build           # build every service image (docker buildx bake)
docker compose up -d # run the stack on http://localhost:8080 (FAVA_BEANS_PORT to change)
```

Then open `http://localhost:8080/`, which redirects to the app at `/ui/`.

| Path | What |
|---|---|
| `/ui/` | The PWA: books, then each book's review queue |
| `/fava/` | Fava, read-only, once a book exists |
| `/api/ledger/v1/docs` | The ledger API's interactive docs |
| `/api/app/v1/health` | The app API |

## Everyday commands

| Command | What it does |
|---|---|
| `pnpm build` | Build every service image for this machine |
| `pnpm test` | Every test suite and contract check, in Docker (`docker buildx bake test`) |
| `pnpm e2e` | Build everything and run the end-to-end suites (API and browser) against a throwaway stack |
| `pnpm e2e:local` | Run both end-to-end suites against an already-running stack |
| `pnpm test:unit` | The TypeScript unit tests on the host (no Docker) |
| `pnpm seed [book]` | Seed a demo book with recent purchases staged for review (default book: `demo`) |
| `pnpm generate` | Regenerate `packages/ledger-client` after changing the ledger's API |
| `pnpm release` | Build `linux/amd64` + `linux/arm64` images and push them (set `REGISTRY`, `VERSION`) |
| `pnpm --filter @fava-beans/app dev` | Vite dev server for the PWA, proxying `/api` to a running stack |

## Repository layout

One repository and one product. Each language keeps its own native tooling (pnpm for TypeScript,
uv for Python), and Docker is the common build and test interface.

```
compose.yaml          the product: the whole stack (works with compose and swarm)
compose.e2e.yaml      overlay that adds the end-to-end runner
docker-bake.hcl       every image, test target and release platform
node.Dockerfile       the shared TypeScript workspace stage, its checks, and the e2e image
deploy/
  traefik/            routing (file provider): /api/*, /ui/*, /fava/*
  fava/               Fava image, pinned to the ledger's Beancount version
services/
  ledger/             Python: system of record, Beancount engine      → /api/ledger/v1
  app/                TypeScript: PWA and app API                      → /ui, /api/app/v1
packages/
  ledger-client/      typed client generated from the ledger's OpenAPI schema
tests/
  e2e/                API end-to-end tests through Traefik
  ui/                 browser end-to-end tests (Playwright) through Traefik
scripts/              helper scripts behind the pnpm commands
docs/                 design
```
