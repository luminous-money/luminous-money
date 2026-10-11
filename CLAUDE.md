# fava-beans: working agreements

- **Read [RESUME.md](RESUME.md) first.** It says where work stands and what's next.
  [docs/PLAN.md](docs/PLAN.md) is the roadmap; [docs/design.md](docs/design.md) holds the decisions and
  their reasons.
- **Every finalized change set updates RESUME.md** (state, next steps, anything a newcomer needs
  to pick up the work), and checks off or adds items in docs/PLAN.md. A change set isn't done until
  both are current.
- **Design decisions go in docs/design.md, with their reasons.** Undecided questions go in
  docs/PLAN.md's open questions.
- **Before calling a change done, run `pnpm test`, plus `pnpm e2e` if it touches the API, the
  stack, routing or the UI.** UI behavior gets a browser test in `tests/ui`. If the ledger's API
  changed, run `pnpm generate` and commit the result; the check fails otherwise.
- **Every table is created through the migration helper:** `migrations.create_table` in the
  ledger (Python), `createTable` from `@fava-beans/db` in the TypeScript services. Both add
  `created_at` and `updated_at`, and lint checks in `pnpm test` enforce it. Schema changes are new migrations,
  never edits to shipped ones.
- **Every edit is versioned:** the client sends the `updated_at` it read, and the server refuses a
  stale one with 409. Prefer PATCH, so an edit only touches its own fields.
- **No real financial data** goes anywhere in this repo or its test fixtures.
