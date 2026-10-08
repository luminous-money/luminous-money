Plan
==================================================================================================

The roadmap, in order. The reasoning behind each piece lives in [docs/design.md](docs/design.md);
where work stands right now lives in [RESUME.md](RESUME.md).

The overall order is fixed by one decision: **build and polish the UI against test data first,
and only then hydrate with real finances**, because importing real transactions commits us to
the system.

## Phase 1: Foundations

- [x] Engine spike: database as the system of record, Beancount as the engine, round-trip
      fidelity, incremental backups (`services/ledger`)
- [x] Decades-scale benchmark harness (`services/ledger/bench`)
- [x] Monorepo tooling: bake, pnpm workspace, generated `ledger-client` with a drift check
- [x] Compose stack and routing shell: Traefik, `ledger`, `app`, Fava; `/api/*`, `/ui/*`, `/fava/*`
- [x] End-to-end test harness against a throwaway stack (`pnpm e2e`, `tests/e2e`)
- [ ] Deploy with `docker stack deploy` on a real Swarm. `docker stack config` already accepts
      the file; the Pi is the natural place to do this.
- [ ] Asynchronous, debounced validation in `ledger`; writes do structural checks only
- [x] Structured (JSON) writes in `ledger`, so Beancount syntax stays in one service; typed
      responses throughout the API
- [ ] `auth` service: users, login, JWT issuance, the forwardAuth verify endpoint; attach
      forwardAuth to every route
- [ ] Fava picks up newly created books

## Phase 2: The review app

- [x] `app` service skeleton: PWA shell (React + Vite + `vite-plugin-pwa`) with a landing page at
      `/ui`, Hono serving `/api/app/v1`
- [ ] Review queue: list staged entries, confirm with one tap, edit
- [ ] Bulk categorization
- [ ] CSV import as a participant
- [ ] Context builder (14-month window) and the resolver chain: `matcher`, then `rules`, with
      `external` as a configurable slot
- [ ] Synthetic data generator for demos and UI work

## Phase 3: Many books

- [ ] Cross-book groups: account pairs, mirroring, pair-balance assertions
- [ ] Group editor: edit every leg at once; save only when all of them balance
- [ ] Scheduled templates, including multi-book templates (salary)
- [ ] Matching imports to scheduled legs

## Phase 4: Feeds and prices

- [ ] SimpleFIN importer
- [ ] `bean-price` on a schedule; manual price entry for illiquid assets

## Phase 5: Deploy to the Pi

- [ ] Run `bench.py` on the Pi 3 and revisit the performance assumptions
- [ ] Publish multi-arch release images; operator docs for standing up the stack
- [ ] Optional: a Pi image that wraps the Compose file

## Phase 6: Hydration

- [ ] Choose the cutover date and the source of opening balances
- [ ] Open real accounts, connect live feeds, retire GnuCash to read-only

## Deferred

- Cati as an `external` resolver
- Per-book permissions
- Archiving closed periods (only if the Pi benchmark calls for it)
- A native mobile app

## Open questions

- **Asynchronous validation:** how do the app and the user see that a book is being re-validated
  and that its problem list is stale?
- **Fava and new books:** Fava gets its list of ledgers at startup. When a book is created, does
  the Fava container restart, or does it watch a directory?
- **Resolver contract:**
  - What does confidence mean, and is it comparable across resolvers?
  - Can a resolver return a partial answer (e.g. a match with a suggested split)?
  - Should high-confidence matches ever auto-confirm, or does everything go through review?
- **Cutover:** deferred until hydration.
