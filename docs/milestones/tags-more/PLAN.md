Tags, more: tags in rules, schedules, receipts and the AI: plan
==================================================================================================

> **Status: planned (2026-10-29), not started.** Kael asked whether M17's tags reached matching
> rules, scheduled transactions, receipt processing and AI categorization. They didn't: M17
> left all four for later on purpose ([its plan](../m17-transaction-tagging/PLAN.md), "Not in
> M17"; [PLAN.md](../../PLAN.md)'s Later, "Tags, more"). This plan finds what each one lacks
> and how to add it. The calls it makes are under [Decisions to review](#decisions-to-review).
> Renaming or merging a tag, OR filters and tag-filtered budgets stay in Later.

## What's there now

Checked in the code on 2026-10-29.

| Where | Tags today | What's missing |
| --- | --- | --- |
| **Matching rules** | None. `CategoryRule` (`shared/rules.ts`, table `category_rule`) has conditions, a category, a payee, a part and auto-confirm. The `rules` categorizer proposes no tags, and staging (`imports.ts` `stagedTransaction`) always writes `tags: []`. | All of it: the field, its storage, the editor, the proposal, and applying it. |
| **Scheduled transactions** | **Half done.** `TransactionTemplate.tags` exists (`shared/schedule.ts`), it's stored in the template JSON, and `occurrenceTransaction` copies it onto every occurrence. "Repeat this" copies a transaction's tags into the new schedule (`ScheduleEditor.tsx` `fromTransaction`), and saving keeps them (`...initial.template`). | The editor has no Tags field and the list doesn't show them. So a schedule made from a tagged transaction tags every occurrence, and nothing shows that or lets you change it. Saving doesn't check the tags either, so a bad one only shows up when an occurrence fails to stage. |
| **Receipt processing** | Partly. Reading into a transaction already here (the bank's copy, or **Read receipt**) patches only postings, payee, narration, flag and meta, so the tags it had are kept. | A new receipt transaction always gets `tags: []` (`receiptTransaction`). Capture receipt's "anything you know" has no Tags. And once rules or the AI can propose tags, receipts don't use them. |
| **AI categorization** | None. The categorizer API (`shared/categorizer-api.ts`, `docs/categorizer-api.md`) has no tags in its request (history, context) or in its answer (`Proposal`). The AI service's `CategorizeIn`, `PROPOSALS_JSON_SCHEMA`, `checkedProposals` and `categorizeSystem` don't mention them. `Decision` and `apply()` (Suggest categories, re-applying a rule) don't either. | All of it: the book's tags and tagged history as context, tags in the answer, and applying them. |

Elsewhere, the same check turned up:

- **Pairing two staged sides into a transfer** (`transfers.ts` `transferOf`) writes `tags: []`,
  so a tag added in review to either side is lost when they pair. Undoing it restores both with
  their tags (`asInput`). This matters more once rules tag what they stage.
- **Matching** keeps your transaction when a bank row matches it, tags included. A schedule's
  occurrence that matches keeps the template's tags. No change needed.

## One addition: the chain proposes tags

Rules, receipts and the AI all go through the categorization chain, so they get tags the same
way:

- **`InternalProposal.tags?: string[]`** (and the external API's `Proposal.tags`, optional, so
  `api_version` stays `"1"`, as the categorizer API says for additions that don't change
  meaning).
- **`Decision.tags?: string[]`:** every tag proposed for the transaction by the categorizers
  whose answers were used, with duplicates removed. A tag doesn't compete the way a category
  does, so there's nothing to choose between. (Decision 3.)
- **Applying adds and never removes.** Tags go on alongside any the transaction already has
  (tagged in review, or from a schedule). Where a decision gets written:
  - `stagedTransaction` (imports and bank feeds): `tags: decision.tags ?? []`
  - `apply()` (Suggest categories, re-applying a rule): the patch adds `tags` (the existing
    ones plus the new, sorted) only when something new is added
  - receipts: the new transaction takes the decision's tags plus any typed; one read into a
    transaction already here adds them to what it has
- **Every proposed tag is checked** with the M17 normalizer and the ledger's rule
  (`shared/tags.ts`). One that fails is dropped, as an account that isn't open is.
- **Acceptance tracking stays about categories and payees.** The proposal record notes the tags
  proposed (a `tags` column on `proposal`) so review can say where a tag came from, but whether
  the proposal was "accepted" still means its postings. (Decision 8.)

## Matching rules

- **A rule's "then" gets Tags:** `CategoryRule.tags: string[]` (`CategoryRuleIn`,
  `CategoryRulePatch`). App migration: `ALTER TABLE category_rule ADD COLUMN tags TEXT NOT NULL
  DEFAULT '[]'` (JSON), read and written in `db.ts`.
- **`ruleProblem`** checks every tag with the normalizer (normalized on save, as the
  transaction page does).
- **The `rules` categorizer** adds `tags` to its proposal when the rule has any. The most
  specific matching rule wins, as now, and only its tags apply. (Decision 1.)
- **A rule still needs a category.** A tag-only rule ("anything on this card is
  `#reimbursable`") is a bigger change to what a rule is, and is noted in Later. (Decision 2.)
- **Re-applying a changed rule** (`applyRule`, for unconfirmed transactions open to
  categorizing) adds its tags too. Taking a tag off a rule doesn't take it off transactions it
  already tagged. Tags are the user's once they're on.
- **A row matched to a transaction already here** isn't categorized, so a rule's tags don't
  reach it. That transaction is already yours. (Decision 4.)
- **PWA:** `RuleEditor` gets a Tags field (`TagPicker`, suggesting the book's tags) under Payee.
  A rule made from a transaction doesn't copy its tags: those are usually one-off, like a trip.
  (Decision 5.) `Rules` shows each rule's tags as chips after its category.

## Scheduled transactions

The data path is there already; this is the editor, plus a check on save.

- **`ScheduleEditor`** gets a Tags field (`TagPicker`) under Description, saved into
  `template.tags`. "Repeat this" keeps prefilling the transaction's tags, now where you can see
  them. (A recurring bill's `#business` belongs on every occurrence, unlike a rule's one-off
  case.)
- **`Schedules`** shows each schedule's tags as chips.
- **Saving checks the tags** (`schedules.ts`, beside the template's other checks): normalized,
  and a bad one is refused with a 422 that names it, so it isn't found later as `last_error`.
- **Editing a schedule's tags** reaches its unconfirmed occurrences, because saving re-stages
  those already (`updateSchedule` removes and reruns them). Confirmed or matched ones keep the
  tags they have. No new work; a test pins it.

## Receipt processing

- **Capture receipt's "anything you know"** gets Tags (`TagPicker`): `ReceiptHints.tags`
  (`@luminous-money/ai-api`), sent with the others.
- **It starts with the page's tag filter,** the way "paid from" starts with the page you came
  from: capturing from a ledger or Transactions filtered by `#italy-2026` starts with that tag.
  (Decision 6.)
- **`receiptTransaction`** takes the typed tags plus the decision's. One read into a
  transaction already here (the bank's copy, or Read receipt) adds them to what it has, in the
  same patch.
- **The AI doesn't read tags off the receipt** (a receipt says what was bought, not why). Its
  tags come from categorizing, below.

## AI categorization

### What the categorizers are told

- **The book's tags:** `context.tags`, from the ledger's `GET /books/{b}/tags` (name, count,
  first and last dates), in the external API and in `CategorizeIn`. The dates matter: a trip's
  tag spans its trip, so a transaction dated inside an active tag's span is a candidate.
- **History with tags:** `HistoryTransaction.tags`, filled by `buildRequest`
  (`categorize/context.ts`) from what the ledger already returns.

### The built-in AI (services/ai)

- **`PROPOSALS_JSON_SCHEMA`** gets `tags: string[]` per proposal; `checkedProposals` keeps only
  tags in `context.tags` (`.catch([])`, as the schema's other parts do).
- **Only the book's own tags:** the AI never makes up a new tag. A new tag is a decision about
  why, which the AI can't know. (Decision 7.)
- **`categorizeSystem`** says when to propose one: when confirmed history shows it (this payee
  is always `#business`), or when the transaction falls inside a tag's dates and clearly
  belongs (a restaurant in Rome during `#italy-2026`). Otherwise none, and leaving tags off is
  the default.
- **Caching:** the tags list changes as transactions are tagged, so it goes in the user message
  with the transactions, not in the cached system prompt after the chart of accounts.
- **A setting:** Menu → AI gets "Suggest tags", on by default, kept with the book's other AI
  settings (`ai` service, migration for the column). (Decision 9.)
- **`categorize/ai.ts`** passes `tags` from the answer into its `InternalProposal`s, for whole
  transactions (tags aren't per split).

### The built-in history categorizer

- **`history.ts`** proposes a tag that every one of the payee's last confirmed transactions has
  (at least 3 of them), so a recurring `#business` payee carries it without a rule or the AI. A
  trip's tag rarely covers all of a payee's history, so it won't spread. (Decision 10.)

### Where the AI is asked

Nothing changes here. The AI categorizes receipts and Suggest categories, so its tags arrive
there. Imports and bank feeds get tags from rules and history. Whether they should ask the AI
by themselves is still PLAN.md's open question, and this doesn't settle it.

## Seeing where a tag came from

- **Review cards** already show a transaction's tags. One that a rule, history or the AI added
  gets a title saying so ("From rule "Coworking"", "Suggested by the AI"), from the proposal
  record, and the card's reason line names the tags it added. Removing it is the transaction
  page's ×, as for any tag (or Remove tag… for many).

## Pairing transfers

- **`transferOf`** gives the transfer both sides' tags, with duplicates removed, instead of
  `[]`. Its undo already restores each side's.

## Building it

1. **Shared, and the chain:** `InternalProposal.tags`, `Decision.tags` (union in
   `categorize/chain.ts`), the normalizer check on proposals; `stagedTransaction`, `apply()`
   and `transferOf` writing tags; the `proposal.tags` column. Unit tests in
   `categorize.test.ts`, `imports.test.ts`, `transfers.test.ts`.
2. **Rules:** the migration, `db.ts`, `CategoryRule*`, `ruleProblem`, the `rules`
   categorizer, `applyRule`; `RuleEditor` and `Rules`. Tests: a rule's tags on an imported row,
   on a re-applied rule, refused bad tags.
3. **Schedules:** the save-time check; `ScheduleEditor`'s field and `Schedules`' chips. Tests:
   occurrences carry the template's tags, an edit re-tags unconfirmed occurrences, a bad tag is
   a 422.
4. **Receipts:** `ReceiptHints.tags`; `receiptTransaction` and the read-into patch; Capture
   receipt's field, starting from the page's filter. Tests in `receipts.test.ts`: typed tags,
   the decision's tags, a bank copy keeping its own and gaining new ones.
5. **AI:** the categorizer API's `context.tags`, `HistoryTransaction.tags`, `Proposal.tags`
   (and `docs/categorizer-api.md`); `@luminous-money/ai-api`'s `CategorizeIn` and the "Suggest
   tags" setting; `services/ai`'s schema, check, prompt and the fake provider proposing tags
   for tests; `categorize/ai.ts`; `history.ts`'s tag rule. Tests in `services/ai` and
   `categorize.test.ts`.
6. **API and browser tests:** `tests/api` (a rule with tags, a schedule with tags, a receipt
   with typed tags, Suggest categories adding the fake AI's tag) and a browser spec (tag a rule
   and import a matching row; tag a schedule; capture a receipt from a tag-filtered ledger).
7. **Docs:** design.md ("Tags (M17)" gains where tags come from), `docs/categorizer-api.md`,
   PLAN.md (Later's "Tags, more" trimmed to what's left; this plan linked), RESUME.md.

`pnpm test` and `pnpm e2e` (it touches the API and the UI); `pnpm generate` only if the
ledger's API changes, which nothing here needs.

## Decisions to review

Each was picked as the simplest consistent choice; none blocks the plan, and each is easy to
change.

1. **Only the winning rule's tags apply,** not every matching rule's. That's what "the most
   specific rule wins" already means. The alternative, where every matching rule's tags apply
   (like mail filters), lets general rules ("this card is `#business`") stack with specific
   ones, but a rule that loses would still have an effect.
2. **A rule still needs a category;** tag-only rules go to Later. They'd need rules that apply
   after categorizing, and to transactions a rule didn't categorize.
3. **Tags from different categorizers combine** (rule, history and AI), rather than the first
   one winning as payee does.
4. **A rule's tags don't reach a row matched to your own transaction** (nothing categorizes
   it).
5. **A rule made from a transaction doesn't copy its tags; a schedule made from one does.**
6. **Capture receipt starts with the page's tag filter.**
7. **The AI proposes only the book's existing tags,** never new ones.
8. **Tags don't count toward a proposal being accepted.** Removing an AI tag doesn't count
   against the AI. Counting tags separately can come later if the AI over-tags.
9. **"Suggest tags" is on by default** with the book's AI.
10. **History proposes a tag that all of a payee's last 3 or more confirmed transactions
    have.**
