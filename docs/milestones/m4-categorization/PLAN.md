M4: Categorization: plan
==================================================================================================

> **Status: built (2026-10-13),** with the [answers](#answers-2026-10-13) to its questions.
> Every slice is done, with unit, API and browser tests. The external API is documented in
> [docs/categorizer-api.md](../../categorizer-api.md). There's no separate spec: the milestone's line
> in [the plan](../../PLAN.md) ("the categorization engine"), its notes there (bulk
> categorization, the 14-month context, the resolver chain), and the design's
> [resolver pipeline](../../design.md#the-resolver-pipeline-matching-and-categorization) are the
> brief. Calls marked **Proposed** are open; the [questions](#questions) list the ones that
> matter most.

## Answers (2026-10-13)

These override anything below that disagrees.

- **Every proposal fills in a concrete category, at any confidence.** After all the
  categorizers have proposed, the best proposal is applied: the review queue is where weak ones
  get corrected. (No "Maybe…" chips.)
- **The cascade stops at 0.9:** a row with a proposal at or above it isn't sent to later
  categorizers.
- **Auto-confirm is strict:** only an explicit rule with "confirm automatically" ticked.
- **Clean payees:** yes, from rules and from history (the payee last given to the same payee
  key).
- **Rules and history,** both.
- **"Similar" stays within the active account** (the account imported into).
- **A changed rule offers** to re-apply to pending transactions it covers that the user hasn't
  touched.
- **External categorizers:** build the interface now. We're the system of record, so we define
  the API (inspired by Cati, not tied to it), documented in
  [docs/categorizer-api.md](../../categorizer-api.md). Several providers can be configured.
- **Acceptance tracking:** yes, per categorizer.

### The external API, in short

- **A provider is an HTTP service** we call; it proposes and never writes. Configured per
  installation (`CATEGORIZERS`, a JSON list of `{name, url, token?, timeout_ms?, feedback?}`),
  run in order after the built-ins.
- **`POST <url>/v1/categorize`:** the rows to categorize, plus the context (the book's chart of
  accounts and its last 14 months of transactions). Answered with proposals: per row, the
  postings for the other side (one account, or several with amounts: splits are allowed), an
  optional payee, a confidence, and a reason.
- **`POST <url>/v1/feedback`** (if the provider asks for it): what became of each of its
  proposals once the transaction was confirmed, so it can learn.
- **Confidence** is meant as the chance the user accepts the proposal unchanged. We don't trust
  it blindly: acceptance is measured per provider and shown, so an uncalibrated provider is
  visible as one.
- **Failures and timeouts** skip the provider for that batch; the import goes on.

## What M4 is

Today every imported row that doesn't match lands as `Expenses:Uncategorized` or
`Income:Uncategorized`, and each is categorized by hand in review. M4 makes the system propose
the category, and makes doing it by hand faster when it can't:

1. **The context builder:** the book's last 14 months, built once per batch, shared by every
   resolver.
2. **Two built-in categorizers,** after the matcher in the chain:
   - **`rules`:** explicit rules the user made ("CORNER CAFE → Food:Coffee").
   - **`history`:** what the same payee was categorized as before, learned from confirmed
     transactions, no setup needed.
3. **Proposals in review:** a proposed category is filled in, says where it came from, and is
   confirmed with one tap (or swipe), like today.
4. **Faster by hand:** after categorizing one, "also these N similar"; "Remember" to make a
   rule from a card; and bulk selection in the queue.
5. **The external slot:** the HTTP contract for an outside categorizer (an LLM such as Cati,
   later), configured per installation. **Proposed:** the contract and a test stub only.

The pipeline stays source-agnostic, so SimpleFIN (M12) and anything else that stages
transactions goes through the same chain.

## Decisions this plan makes

### Recognizing "the same payee"

Bank descriptions are noisy: `POS DEBIT 0412 CORNER CAFE #42 CHICAGO IL`. Categorizing by
history needs a stable key, so every description gets a **normalized key** (**Proposed**):

- lowercase; punctuation to spaces
- drop common bank prefixes (`pos debit`, `debit card purchase`, `checkcard`, `ach`,
  `purchase authorized on <date>`, …: a list in code, extended as real files show more)
- drop tokens with three or more digits (card, store and reference numbers, dates), and a
  trailing US state code
- what's left, e.g. `corner cafe chicago`

Keys compare **exactly first**, then by **token overlap** (Jaccard similarity ≥ 0.6) for
near-misses like a changed store number. One module (`src/server/categorize/payees.ts`), with
tests over synthetic descriptions (no real data in fixtures).

### The context builder

- **What the design calls for:** every transaction from the 14 months before the batch's
  earliest row, plus anything after, from all of the book's accounts, never sampled; and the
  chart of accounts.
- **How it's read:** the ledger's transaction list by date range. **Proposed:** a compact read
  endpoint (`GET /transactions/compact?from=`) returning only what resolvers use (id, date,
  flag, payee, narration, postings' accounts and amounts), without the 500-row limit, so a
  decades-scale book stays fast on the Pi. Benchmarked with `bench.py`.
- **Built once per batch** and handed to every resolver; the matcher keeps using its narrower
  view of the imported account.

### The resolver contract (settling the plan's open question)

- **A proposal** says, for one incoming row: the counterpart account (one account in M4; splits
  later), optionally a clean payee, a **confidence** from 0 to 1, the resolver's name, and a
  short human **reason** ("8 of 9 past CORNER CAFE → Food:Coffee").
- **Confidence is comparable across resolvers** (**Proposed**): it's an estimate of the
  probability the user accepts the proposal unchanged. The rules resolver says 1.0 for a
  user's rule; history computes it from agreement and volume (below); an external resolver
  must calibrate to the same meaning.
- **The chain:** matcher, then assignment (as in M2: matched rows add nothing and skip the
  rest), then `rules`, `history`, and `external` if configured. Each sees the rows the earlier
  ones haven't **settled**; a proposal at or above the **settle threshold** (**Proposed:**
  0.9) settles a row. Below it, the row goes on, and the best proposal so far is kept.
- **Partial answers:** a resolver can propose a payee without a category, or a category
  without a payee; they're merged (the higher confidence wins per field).

### The categorizers

- **`rules`:** explicit, per book, in `app`.
  - **Conditions,** all optional but at least one: the account imported into; the description
    (normalized key equals, or contains text); the amount (exact, or a range, with its sign).
  - **Actions:** the counterpart account; optionally a payee; optionally **confirm
    automatically**.
  - **Order:** the most specific rule wins (more conditions); ties go to the newest.
- **`history`:** for a row, the confirmed transactions in the context whose normalized key
  matches (exactly, else by overlap), in the same imported account if there are any, else any
  account.
  - The proposal is the counterpart they used most (weighted to the recent), and the payee most
    recently given.
  - **Confidence** (**Proposed**): the winning share, discounted when there's little history:
    `share × n / (n + 1)`, so 1 of 1 is 0.5, 3 of 3 is 0.75, 8 of 9 is about 0.8, 20 of 20 is
    about 0.95; and lower for an overlap match than an exact one.
- **`external`:** `POST <url>` with `{ batch, context }`, answered with proposals in the
  contract above; a timeout or error is logged and the chain carries on. Configured with
  `CATEGORIZER_URL` (unset: skipped).

### What a proposal does

- **At or above the fill threshold** (**Proposed:** 0.5), the staged transaction gets the
  proposed counterpart (and payee) instead of Uncategorized, stays pending (`!`), and its card
  shows where it came from. Confirming is one tap, as with a hand-picked category.
- **Below it,** the transaction stays Uncategorized, and the card shows the guess as a chip
  ("Maybe Food:Coffee?") that fills it in with a tap.
- **A rule that confirms automatically** stages the transaction confirmed (`*`), like an
  auto-confirming schedule. **Proposed:** only explicit rules can auto-confirm; history never
  does.
- **Where proposals are kept:** `app`'s `proposal` table (book, transaction, account, payee,
  confidence, resolver, reason), not the books. Review reads it (`GET /proposals`). When the
  transaction is confirmed, the proposal records whether it was **accepted unchanged**, which
  gives an acceptance rate per resolver, shown on the Rules page, to tune thresholds with real
  use.
- **Already-pending transactions** (staged before M4, or by the demo) can be categorized too:
  "Suggest categories" on the review page runs the chain over pending Uncategorized ones.

### Faster by hand

- **"Also these N":** after picking a category on a card, if other pending transactions share
  its normalized key and are Uncategorized (or proposed with lower confidence), the card offers
  "Also categorize N similar as Food:Coffee", applied in one go (each its own versioned PATCH).
- **"Remember":** from a card, make a rule from it (prefilled: this account, this key, this
  category, this payee), editable before saving.
- **Bulk selection:** a "Select" mode in the queue: checkboxes, then "Categorize N as…" and
  "Confirm N". Selection works with filters (account, same payee as …).
- **Changing a rule** offers to re-run it over pending transactions it now covers, leaving any
  the user has already edited.

### The PWA

- **Review cards:** the proposal's source line ("Rule: Coffee shops" or "8 of 9 past"), the
  low-confidence chip, "Also these N", "Remember", and the Select mode.
- **A Rules page** (in the menu): rules with their conditions, action and how often they've
  applied; create, edit, delete; each resolver's acceptance rate.
- **Import results** show each row's proposal and its source.

## How it gets built

1. **Payee keys:** the normalizer and similarity, with tests.
2. **The context builder:** the compact ledger read, the builder, a benchmark on the
   decades-scale book.
3. **The contract and chain:** proposals in the pipeline types; settle and fill thresholds;
   merging partial answers; the `proposal` table (app migration); staging with proposals.
4. **`history`, then `rules`:** the resolvers; rules' storage and API.
5. **Review:** source lines, chips, "Also these N", "Remember", "Suggest categories", accepted
   tracking.
6. **Bulk selection** in the queue.
7. **The Rules page.**
8. **`external`:** the HTTP slot, tested against a stub server in the e2e stack.
9. **Tests and docs:** unit tests per module; API tests (a batch categorized by history and by
   rules, auto-confirm, re-suggest, the external stub); browser tests (a proposal confirmed by
   swipe, a chip, "Also these N", "Remember", bulk categorize); design.md, `docs/PLAN.md`,
   RESUME.md.

## Out of scope for M4

- **An actual LLM categorizer:** the slot only (Cati stays deferred).
- **Proposing splits** (Costco as 60% groceries, 40% household), and artifacts such as
  receipts: later.
- **Categorizing transactions that weren't staged** (re-categorizing history): the chart of
  accounts' job.
- **Suggesting recurring transactions:** M14 (it can reuse the payee keys and context).

## Questions

1. **Thresholds:** fill the category at confidence 0.5 or more, settle (skip later resolvers)
   at 0.9, and show a chip below 0.5. Right shape, and numbers?
2. **Auto-confirm:** only explicit rules with the box ticked, never history. Or should very
   confident history (say 20 of 20) be able to auto-confirm too, opt-in per book?
3. **Payees:** categorization also proposes a clean payee (from the rule, or the most recent
   one given to the same key), so "POS DEBIT 0412 CORNER CAFE…" gets the payee "Corner Cafe"
   while the bank's text stays the description. Want that?
4. **Rules:** explicit rules plus learned history (proposed), or only history (no Rules page),
   or only rules?
5. **"Similar":** the same normalized key in the same imported account only, or in any account
   (proposed: same account first, then any)?
6. **Re-running a changed rule** over pending transactions: offer it (proposed), do it
   automatically, or never?
7. **The external slot:** build the HTTP contract and stub now (proposed), or leave it until
   there's a categorizer to plug in?
8. **Acceptance tracking:** worth keeping per resolver (proposed), to tune thresholds from real
   use?
