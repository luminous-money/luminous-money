M99: Follow-ups
==================================================================================================

> **What this is:** unfinished work and open questions that have no milestone of their own, or
> whose milestone is done and [archived](../.archived/). Gathered 2026-11-07 from docs/PLAN.md
> (its notes, Deferred, Open questions, Later and Polish) and from every archived plan (their
> "Out of scope", questions, follow-ups and calls made without asking). Each item links to where
> it came from.
>
> **Keeping it:** add an item when a milestone closes with something left, or when something
> comes up that no milestone holds; strike it when it's built or answered (say when). When an
> item grows into real work, it becomes a milestone of its own and moves there. What belongs to
> an active milestone lives in that milestone instead: [Funds B](../funds-b/PLAN.md), [Tags,
> more](../tags-more/PLAN.md), [split-level tags and
> funds](../split-level-tags-and-funds/PLAN.md), [HSA tracking](../hsa-tracking/PLAN.md),
> [M18](../m18-suggested-recurring-transactions/PLAN.md) and
> [M20](../m20-design-polish/PLAN.md).

## Open questions

1. **Should imports and bank feeds ask the AI by themselves?** Today they run rules, history
   and item history; the AI is asked by receipts and by Suggest categories (a selection, or a
   migration's last step). Asking on every sync costs a call per batch, every morning. (M19,
   [its note](../.archived/m19-ai-categorization/PLAN.md); design.md, "Split flags and
   categorizing splits (M16)".)
2. **Hydration** (deferred until the milestones that cover real use; Kael's live book on Emmer
   has been in use since 2026-10-27): the cutover date and the source of opening balances,
   running Migrate on the live book with GnuCash's two exports (RESUME's next steps), then
   retiring GnuCash to read-only.
3. **Loans' table imports:** a lender's CSV, a PDF read by the AI, and "already in the books"
   left the UI in step 3 with their code kept ([the loans
   plan](../.archived/loans/PLAN.md#calls-made-without-asking-to-review), call 10). Bring them
   back somewhere, or remove the code?

## Calls made without asking, still to review

Kael hasn't been recorded as going over these. Each is easy to change.

- **M17, tagging:** 5 ([its
  plan](../.archived/m17-transaction-tagging/PLAN.md#decisions-to-review)).
- **Loans, step 3 (the questionnaire):** 11
  ([its plan](../.archived/loans/PLAN.md#calls-made-without-asking-to-review)). Steps 1 and 2's
  21 were reviewed (2026-11-05).
- **Amazon orders:** 7 ([its
  plan](../.archived/amazon-orders/PLAN.md#steps-2-and-3-as-built-2026-11-07), "Calls made without
  asking").
- **Brokerage activity:** 5 ([its
  plan](../.archived/brokerage-activity/PLAN.md#as-built-2026-11-07-v0126), "Calls made without
  asking").
- **Kael's changes, 2026-11-12:** the split editor's 5 ([split-level tags and
  funds](../split-level-tags-and-funds/PLAN.md#the-split-editor-2026-11-12)); and, in design.md,
  a match with a confirmed transaction that can't take the bank's amount left proposed,
  dismissals each person's own, a revoked connection (`gen.auth`) shown on its card and in the
  bell rather than on every account, and a fetched price's source shown beside a price that
  came otherwise.

Funds A's and Funds B step 1's are in [Funds B](../funds-b/PLAN.md#the-rest-of-b); Tags, more's
are in [its plan](../tags-more/PLAN.md#decisions-to-review).

## Bugs

- **A lot of no shares crashes the book's engine** (found in a live book, 2026-11-06): a posting
  like `0.00 VTI {0 # 0 USD, 2026-01-02}` makes Beancount's booking divide 0 by 0, so the
  ledger's `/problems` and `/query` answer 500 for the whole book (the PWA uses neither today).
  The ledger should refuse or drop a zero-unit posting with a cost, and a book that fails to
  load should be a problem rather than a 500. What wrote it: likely the bug brokerage activity
  fixed (2026-11-07, `v0.1.26`), a linked brokerage opening a zero-share core position as a
  zero-share lot. Read again has reopened Kael's links since, so his book may no longer hold one
  (his to check: his books aren't read without asking). The guard is still wanted.

## Polish

Smaller improvements to pick up between milestones (docs/PLAN.md's Polish, the open ones).
Mobile usability is [M20](../m20-design-polish/PLAN.md)'s.

- [ ] **Type-aware wording when creating accounts** (e.g. "amount owed" for a liability).
- [ ] **Order-aware match assignment:** assign an import's rows to candidates over the whole
      network of matches, weighting order, so two identical coffees entered on the 5th and 7th
      pair with CSV rows on the 7th and 8th in order (M2 pairs by proximity, and review swaps).
- [ ] **Import file format management:** see, edit, rename and delete an account's saved CSV
      formats directly, rather than only replacing or adding to them when a file doesn't match.
- [ ] **Review shows the book's ID at the top,** where its name belongs.
- [ ] **"Select uncategorized"** in Select mode (Select all is built).
- [ ] **Tapping a report's bar or slice opens its transactions** (that month's, or that
      category's; M12's answer 10: polish, at the end).
- [ ] **Editing lots in the transaction editor** (M5, "Out of scope").
- [ ] **An Assign button for a waiting Amazon charge:** the route is there
      (`…/orders/{shop}/{id}/assign`), the Amazon page has no button
      ([Amazon orders](../.archived/amazon-orders/PLAN.md#still-open), still open 4).

## By area

### Review, imports and categorization

- **A by-payee view in review:** categorize a payee's group at once (from the migration's
  proposal, not built; [its plan](../.archived/migrate-from-another-system/PLAN.md)).
- **Matching by description or fuzzy amounts** (fees, currency conversion), if needed (M2,
  "Out of scope").
- **Decimal commas in CSVs** ("1.234,56") aren't read (M1's decision 8).
- **Imports aren't one transaction across services:** the ledger's staging commits first, then
  `app` records the batch; a failure between them would leave staged transactions unrecorded,
  and a re-import would duplicate them. Rare, and acceptable until it isn't (M1's decision 10).

### Receipts, shops and the AI

- **Receipts, more** (M16): tuning the reading (prompts, evals), other providers, a cheaper
  model per book, several receipts at once, receipts by email; OAuth for Claude when there is
  one for third-party apps.
- **Real Claude calls aren't exercised in tests** (no key in the repo); the only real ones are
  Kael's.
- **Amazon, more** ([its plan](../.archived/amazon-orders/PLAN.md#still-open)): the book's own
  payment cards as the default for which charges are the book's (still open 2); receipts by
  email, other shops, Jess's Amazon (more than one login per book); a browser test for the
  Amazon page, which needs a fake Amazon or a seeded `shops`.

### Bank feeds and investments

- **Brokerages other than Fidelity** are read as before (cash only); each needs a reader in
  `simplefin/activity.ts` ([brokerage activity](../.archived/brokerage-activity/PLAN.md)). Bank
  connections already invites an issue or a pull request.
- **Other aggregators** (Plaid, GoCardless, …): a client and a page each; the pipeline is
  source-agnostic (M9, "Out of scope").
- **Rotating the encryption key** for bank connections; the stored format allows it (M9).
- **SimpleFIN's protocol 2** (`version=2`): coded errors with a connection's id, and accounts
  naming their connection, would put a bank's error on its own accounts; today the Bridge's
  plain strings are the whole connection's (Kael, 2026-11-12: no string matching). Its accounts
  are shaped differently, so it wants trying against the real Bridge first.
- **Undoing a match with a confirmed transaction:** it's final at once (2026-11-12), so a
  wrong one has no "Not a match"; the row could be shown on the transaction's page with one.
- **Trades from brokerage CSVs:** cash rows import, trade rows don't (M5, "Out of scope").
- **Tax lots beyond the booking method** (specific identification, wash sales) and tax
  reporting (M5).
- **Performance reports:** time-weighted returns, allocation (M5; M12 built net worth).

### Tags, beyond Tags, more

- **Renaming or merging a tag everywhere, OR filters ("any of"), tag-only rules, and
  tag-filtered budgets or "Spent this month"** (M17's "Not in M17"; [Tags,
  more](../tags-more/PLAN.md) leaves them here, its decision 2 for tag-only rules).

### Reports and budgets

- **Statements:** an income statement and a balance sheet (M12's answer 7: not yet). Reports'
  Expenses switch shows expenses as booked, not a whole income statement.
- **Budgets:** alerts, more than one set of budgets per book, past periods (M11, "Out of
  scope").

### Accounts, books and reconciliation

- **Accounts:** reordering by hand (the tree is alphabetical), changing an account's type, notes
  and attachments per account (M10, "Out of scope"; accounts have descriptions since
  2026-10-26).
- **Books:** moving an account from one book to another, archiving a book (hidden, kept) (M6).
  Nothing spans books, by design.
- **Reconciliation:** a statement's PDF attached to it, and reconciling several accounts at once
  (M14, "Out of scope").

### Sharing, auth and email

- **Email, once there's an email system:** invitations sent by email (M13's answer 1), and
  accounts required to verify their email (M8's question 1).
- **Transferring a book's ownership** to a manager (M13's answer 3: not now).
- **Per-account permissions** (a role covers the whole book) and **activity history** (who
  changed what) (M13, "Out of scope").
- **Auth** (M8's other questions and "Out of scope"): session lifetime (proposed: 60 days
  unused, a year at most); passkeys and two-factor (a milestone of their own); which OIDC
  providers first (Google, Apple, GitHub, or any OIDC issuer); Luminous Money as an OIDC
  provider; scoped API tokens; CAPTCHA; terms and privacy pages for a public service.

### Operating it

- **Attachments in a book's export:** an export is Beancount text, so receipts and other files
  stay behind. Whole-system backups carry them (M16, "Out of scope").
- **Deploying to the Pi:** run `bench.py` on it, and `docker stack deploy` on a real Swarm
  (Swarm hasn't been exercised; `docker stack config` accepts the file).
- **Background validation in `ledger`,** once a screen needs Beancount's full booking (lots,
  balance assertions, BQL) and it's too slow on the target hardware; plain balances come from
  SQL. Likewise cached running balances, if a ledger page is slow on a Pi (M1's decision 4).
- **Jobs live in memory** (`server/jobs.ts`): a restart loses a receipt being read, and the PWA
  can only say the work may have finished.
- **Richer synthetic data** as milestones need it.

### Deferred

- **Archiving closed periods,** only if the Pi benchmark calls for it.
- **A native mobile app.**
- **Holiday calendars** for schedules (M3, "Out of scope"; M3 answered no new recurrence rules).

## Early notes not built as written

Recorded before the milestones existed (docs/PLAN.md's "Notes collected so far"); everything
else in those notes is built.

- **A general ledger of every split:** the split as the unit, transactions demarcated, the most
  recent at the bottom with earlier pages loading on scrolling up, and an empty transaction as
  the bottom row, committed in place. Transactions (M12) is every account's journal by
  transaction, newest first; the ledgers' add line is at the top.

## Settled in the sweep

Found answered or built while gathering this list (2026-11-07), so not carried over:

- **The resolver contract** (docs/PLAN.md's open question: what confidence means, partial
  answers, auto-confirm) was settled by [M4's answers](../.archived/m4-categorization/PLAN.md):
  confidence is the chance the user accepts unchanged, comparable across categorizers and
  measured per categorizer; partial answers merge field by field; only an explicit rule with
  "confirm automatically" confirms.
- **M9's follow-ups** (linking in the background, 45-day windows, Bridge notices as notices) are
  built (`simplefin/attempts.ts`, `simplefin/client.ts`).
- **M4's fallback for new payees** is the AI categorizer at the chain's end (M16, M19).
