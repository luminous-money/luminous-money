Split-level tags and funds: plan
==================================================================================================

> **Status: step 1 (tags per split) built** (2026-11-12, at Kael's asking: "moving tags from
> transaction level to split level"; [as built](#as-built)), and [the split
> editor](#the-split-editor-2026-11-12) after it, both released in `v0.1.27`; step 2 (funds per split) noted, not planned. [HSA tracking](../hsa-tracking/PLAN.md) waited on step 1;
> [Funds B](../funds-b/PLAN.md) and [Tags, more](../tags-more/PLAN.md) sit beside it. Step 1's
> calls made without asking are under [Calls to review](#calls-to-review).

## The brief

Often only part of a transaction is a fund's (one item of a receipt paid from Emergency), and
the same is true of tags (one item `#gift`, one item HSA-eligible). Since receipts (M16) and
Amazon orders, a transaction is often many splits, each an item with its own memo and account,
so "the whole transaction" is too coarse for both.

## What's there now

Checked in the code on 2026-11-12.

- **Tags are Beancount's own,** so they're the transaction's (design.md, "Tags (M17)"):
  `TransactionIn.tags` in the ledger's API, `#tag`s in the text, and the `transaction_tag`
  table (ledger migration 12) derived from the text by `store.put`. The journal, an account's
  ledger and the compact stream filter by `tag` (every one given), `GET /books/{b}/tags` counts
  transactions, and every row has `tags`. Reports (`app`'s `reports.ts`) ask the compact stream
  for the tagged transactions and count every split of them.
- **Where tags are set:** the transaction page's Tags field, a review card's Tags (2026-11-07),
  Select mode's Add tag… and Remove tag… (`lib/bulk.ts`, a PATCH of `tags` per transaction),
  and a schedule's template (`template.tags`, copied onto each occurrence, with no field to see
  it). Everything `app` stages writes `tags: []`.
- **Fund lines are the transaction's:** one `funds:` metadata string (`Emergency +500.00 USD;
  Wedding -20.00 USD`), amounts not tied to a split (design.md, "Funds A"). The transaction's
  page can already split a transaction across funds by amount. A put them on the transaction on
  purpose: putting them on the bank's split would mean cutting it in two, which breaks review
  cards, matching and reconciliation.
- **Splits already carry their own facts:** a flag (`!` while unconfirmed) and a `memo:`, both
  derived columns of `posting` (ledger migration 11), and the categorize chain works per split
  (M16's second pass). The transaction page's splits editor (`Splits.tsx`) shows an account and
  an amount per split; anything else (the memo, the flag) rides along unseen.
- **Until step 2 is built,** a review card's fund choice is quiet (the card's own color, as the
  category's picker), since the card can't say "part of it".

## The idea, as noted

Each split can say its tags and its fund (posting metadata, say), and the tag filters and the
fund lines follow from them. The bank's split stays whole: a fund or tag goes on the split it
describes (the item, the expense), which is what the funds design record calls "a mark on an
expense line meaning this fund pays this much" ([its scenarios'](../funds-b/scenarios.md)
theme 2).

## Decided with Kael (2026-11-12)

- **Tags move to splits; the transaction keeps none.** No transaction-level tag beside them as
  a shorthand. Kael: "no one else is using this, and I'm happy to just lose any tags I've
  already used, so we don't need to bend over backwards to preserve any old behavior or
  accommodate old tags." So the tags already in his book are dropped, not moved onto splits,
  and nothing reads a transaction's `#tag` any more. (This answers question 1's second half.)

## Step 1: tags per split

### In the books

- **A split's tags are posting metadata:** `tags: "#gift #hsa-eligible"`, one string (Beancount
  metadata has no lists, as `cards:` and `funds:` show), sorted, with the `#` so the text reads
  as tags and a search for `#gift` finds them. Read leniently (whitespace apart, a missing `#`
  is fine), each one checked against Beancount's tag rule; anything else is refused (422), as a
  bad `funds:` is.
- **The ledger's API has them as a list on the split:** `Posting.tags: list[Tag]` (validated as
  `TransactionIn.tags` was), rendered into the `tags:` metadata and read back out of it, so a
  split's `meta` never holds `tags` itself (as a transaction's never holds `funds`).
  `TransactionIn.tags` and `TransactionPatch.tags` go: a transaction's tags are its splits'.
- **A transaction's own `#tag`s aren't read** (Kael's call): not into the API's model, not into
  the derived tables. Ones already in the text (Kael's, or an imported book's) stay there
  unseen until the transaction is next saved, which writes it without them.
- **Derived per split:** ledger migration 14 creates `posting_tag` (directive, split index,
  book, tag; through `create_table`), fills it from the text, and drops `transaction_tag`.
  `store.put` and `store.delete` keep it with the postings. Migration 12's backfill reads
  Beancount's own tags directly instead of through the engine (its schema is unchanged; the
  table it fills is dropped two migrations later).

### What a tag filter keeps, and what Reports count

- **A transaction is kept when one of its splits has every tag asked for** (the journal, an
  account's ledger, the compact stream, and review's in-memory filter). With one tag that's
  "any split has it". With two, both on the same split, so a list shows exactly what Reports
  count. Lists still show whole transactions, the account's change as before.
- **Rows say every tag their splits have:** `tags` on `JournalRow`, `LedgerRow` and
  `CompactTransaction` is the union, sorted, for the chips on rows and for Select mode's Remove
  tag… offering. `CompactPosting.tags` is each split's own (the compact stream and the
  journal's postings).
- **Reports count only the tagged splits** (`reports.ts`' `stream`): cash flow, the breakdown and
  the largest keep the postings with every tag, so a receipt's `#gift` item counts, not the
  groceries beside it. The outflows lens runs first, on the whole transaction (it masks and adds
  splits across it), and a split it adds (`outflow_of`) carries the tags of the split it comes
  from.
- **`GET /books/{b}/tags`** counts transactions with a split that has the tag, with their first
  and last dates, as before.

### Setting them

- **The transaction page:** the Tags field at the top goes; each split in the splits editor has
  its own Tags (`TagInput`, quiet until it's used, as on a review card), and shows its memo
  when it has one, so a receipt's items can be told apart. The schedule editor uses the same
  splits editor, so a template's splits show and edit their tags too, and each occurrence
  carries them (`TransactionTemplate.tags` goes).
- **A whole transaction's tags** (a review card's Tags, Select mode's Add tag… and Remove tag…)
  read as the union of its splits'. **Adding one tags what the money was for:** the splits off
  the balance sheet (the expense, the income), or every split when all are on it (a transfer, a
  trade). **Removing one takes it off every split.** One shared rule (`shared/tags.ts`), and a
  PATCH of the transaction's postings, versioned, as other bulk edits are. Changing tags still
  doesn't ask about a reconciled transaction: the amounts and accounts don't change.
- **An itemized review card** (more than two splits) shows each split's tags beside it;
  changing one item's tags is the transaction page's (Open).

### Kept through the paths that rewrite splits

- **Everything that edits a split keeps its tags** by spreading the posting it had (picking a
  category, Categorize as…, Suggest categories, the parts choice), as memos are kept now. To
  check, not assume, path by path.
- **Itemizing passes tags on:** reading a receipt or a shop's order into a transaction already
  here replaces its other splits with the items; the items take the tags those splits had (a
  charge tagged `#italy-2026` in review, then read from its receipt, stays the trip's).
- **Pairing two sides into a transfer** keeps each side's tags on its split (it wrote `[]`;
  Tags, more had this on its list).
- **Everything `app` stages** (imports, bank feeds, receipts, orders, loans, brokerage rows)
  stops writing `tags: []`, the generated client's types finding each.

### Building it

1. **Ledger:** `engine` (the `tags:` key, reading and writing it per posting, a transaction's
   tags no longer read), `models` (`Posting.tags`, `CompactPosting.tags`, the descriptions),
   migration 14, `store` (`posting_tag` written and read: the union per transaction, per split
   in the compact stream and the journal's postings, the filter per split, the book's tags),
   `service` (an account's ledger filtered by split), `outflows` (added splits' tags), `api`
   (the `tag` parameter's description). Tests: `test_tags.py` rewritten for splits (text,
   API, filters, the compact stream, a bad tag, the migration), and every test that wrote
   `tags` on a transaction.
2. **Client:** `pnpm generate`, committed with it.
3. **app, server:** `reports.ts` keeping the tagged splits, `shared/tags.ts` (a transaction's
   tags, the whole-transaction rule, passing tags on), receipts and orders passing tags on,
   `transferOf`, schedules, the fake ledger in `testing.ts`, and `tags: []` gone everywhere.
   Unit tests: reports counting only the tagged split, the shared rule, itemizing, pairing.
4. **PWA:** the splits editor's Tags and memo, the transaction page without its Tags field,
   the review card (its Tags by the rule, an itemized card's per-split chips), Select mode,
   review's filter, the Reports caption ("Only splits tagged #kitchen").
5. **API and browser tests:** `tests/e2e` (`m17.test.ts` per split; the rest's `tags: []`) and
   `tests/ui` (`m17.spec.ts`: a split tagged on the page, the ledger and Reports counting only
   it; `review.spec.ts`: a card's tag lands on its category's split).
6. **Docs:** design.md ("Tags (M17)" rewritten for splits; the review card's note), this plan
   ("As built"), [Tags, more](../tags-more/PLAN.md) and [HSA tracking](../hsa-tracking/PLAN.md)
   read through it, PLAN.md, the README's list, RESUME.md.

`pnpm test` and `pnpm e2e` (it changes the ledger's API, the UI and the stack's data).

### Calls to review

Each is the simplest consistent choice found; none blocks the step, and each is easy to change.

1. **`tags: "#a #b"` on the posting,** with the `#`, rather than `tags: "a b"`.
2. **Several tags filter per split,** not per transaction: `#italy-2026` and `#gift` find the
   gift bought in Italy, not a receipt with an Italian dinner on it and a gift beside it.
3. **A whole transaction's tag goes on what the money was for** (the splits off the balance
   sheet, or every split of a transfer), not on every split: the bank's side of a purchase is
   the same money, and Reports never count it.
4. **Removing a whole transaction's tag takes it off every split,** so what Remove tag…
   offers (the union) is what it can remove.
5. **An itemized card shows each item's tags but doesn't edit them;** the page does.
6. **The splits editor shows each split's memo** (read-only), so tagging the right item is
   possible; editing memos stays out of it. *Changed by Kael, 2026-11-12: the split editor
   edits it.*
7. **Schedules get per-split Tags now,** since they share the splits editor (a piece of Tags,
   more, done on the way). A template's old `tags` is dropped with the rest.
8. **Old `#tag`s are left in the text until it's next saved,** rather than rewritten by the
   migration (which would mean writing every tagged transaction, and its change for backups,
   for tags nothing reads).

### As built (2026-11-12)

As planned, with these besides:

- **Two more itemizing paths pass tags on:** a category with several splits placed on a bank
  row's one split (`placed` in `categorize/chain.ts`) gives them its tags, as receipts and
  orders do.
- **A card's tag edit is made from the latest copy:** `useEditTransaction` takes changes or a
  function of the latest copy, since tags are now a PATCH of the postings and one computed
  from the card's render could undo a category picked a moment before (design.md, the review
  queue's "Edits to a card apply in order").
- **`memoOf`** moved to `lib/split.ts`, shared by the review card and the splits editor.
- **Tests:** the ledger's `test_tags.py` rewritten (posting metadata, the API, filters per
  split, the compact stream's per-split tags, a bad `tags:`, migration 14), the transaction
  tests' rich case and the features fixture tagging a split; `app`: `shared/tags.test.ts` (the
  union, the filter, the whole-transaction rule, passing on), reports counting only a tagged
  item, a receipt and an order passing the bank split's tags to the items, pairing keeping each
  side's; `tests/e2e/m17` per split (a receipt's gift counted alone, a transaction's own `tags`
  refused); `tests/ui/m17` (a split tagged on the page, Reports counting a tagged part) and
  `review.spec` (a card's tag on the split being categorized). `pnpm test` and `pnpm e2e`
  pass.

Left over:

- **A loan payment matched to its schedule** rebuilds its principal, interest and escrow splits
  (`loan-payments.ts`), so tags on those splits go. Rare (a loan's splits are seldom tagged);
  passing them on would mean pairing old splits with new by account.
- **Kael's book loses its tags on the upgrade** (his call): the tag list and filters are empty
  until splits are tagged; the old `#tag`s leave the text as each transaction is next saved.
- **A schedule saved before keeps a `tags` key** in its template JSON, read by nothing.

## The split editor (2026-11-12)

Kael, after step 1: "there's way too much information on a split to display and manipulate
easily". So the transaction page shows each split as it is (its memo, a faint "Memo" without
one, and tags, then its account, losing its start when long, and its amount), and clicking one opens a split editor
with everything: memo, account, amount, tags (and a schedule's tolerance). Enter or Save puts
it back in the transaction, which is saved as before; "+ Add split" opens a blank one. A long
press, or Shift, Ctrl, ⌘ or Option with a click, starts Select mode, whose only actions are
Add tag… and Delete. design.md has it under the review app's detail view.

- **Call 6 is changed:** a split's memo is edited in its editor (a posting's `memo:`; blank
  removes it), no longer only shown.
- **Calls made without asking:** the editor needs an account to save (a blank split balances
  nothing); a new split opens searching for its account; after an account is picked, the
  amount has the focus, so Enter still saves; Delete in Select mode refuses every split (a
  transaction keeps one); Select mode isn't offered to a reader.
- **Kael listed a fund among the editor's fields.** Funds per split are step 2, below, not
  built: the editor has no fund, and the transaction's Funds section stays where it was. Step
  2's questions (3 and 4) come first.

## Step 2: funds per split (noted, not planned)

A split's fund, the fund lines worked out from the splits (or kept beside them for what no
split says), the ledger's checks per commodity as today, review cards and receipts choosing a
fund per item, and a fund in the split editor (Kael, 2026-11-12).

## Questions

1. ~~Where a split's tags live~~ (step 1: posting metadata, and the transaction keeps none, at
   Kael's call).
2. ~~What a tag filter counts~~ (step 1: Reports count the tagged splits, lists show the whole
   transaction).
3. **Funds per split against the transaction's lines:** do split funds replace the `funds:`
   string, or do both stay (lines for what isn't tied to a split, such as a transfer)?
4. **Funds per split alongside Funds B's rules,** which change what a mark means, or after?
5. **Tags, more** has the chain proposing tags per transaction; with splits tagged, the chain
   (item history, the AI) proposes them per split, as it already places accounts per split, and
   a rule's tags go where the whole-transaction rule puts them. Its plan is to be read through
   this before it starts.
