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
  stack or routing.** If the ledger's API changed, run `pnpm generate` and commit the result; the
  check fails otherwise.
- **No real financial data** goes anywhere in this repo or its test fixtures.
