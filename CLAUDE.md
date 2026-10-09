# fava-beans: working agreements

- **Read [RESUME.md](RESUME.md) first.** It says where work stands and what's next.
  [PLAN.md](PLAN.md) is the roadmap; [docs/design.md](docs/design.md) holds the decisions and
  their reasons.
- **Every finalized change set updates RESUME.md** (state, next steps, anything a newcomer needs
  to pick up the work), and checks off or adds items in PLAN.md. A change set isn't done until
  both are current.
- **Design decisions go in docs/design.md, with their reasons.** Undecided questions go in
  PLAN.md's open questions.
- **Before calling a change done, run `pnpm test`, plus `pnpm e2e` if it touches the API, the
  stack, routing or the UI.** UI behavior gets a browser test in `tests/ui`. If the ledger's API
  changed, run `pnpm generate` and commit the result; the check fails otherwise.
- **Every table is created through `migrations.create_table`** (it adds `created_at` and
  `updated_at`). A lint check in `pnpm test` enforces it. Schema changes are new migrations,
  never edits to shipped ones.
- **Every edit is versioned:** the client sends the `updated_at` it read, and the server refuses a
  stale one with 409. Prefer PATCH, so an edit only touches its own fields.
- **No real financial data** goes anywhere in this repo or its test fixtures.
