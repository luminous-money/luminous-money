HSA tracking: plan
==================================================================================================

> **Status: built (2026-11-19), released as `v1.3.0` (2026-11-20); its documentation (invoices
> attached, "No receipt") built the same day, `v1.4.0`: [below](#documentation-kael-2026-11-20-built-v140).** Noted by Kael 2026-11-07; his answers are
> [below](#kaels-answers-2026-11-19), and Amazon's mark was read from his real orders on Emmer
> the same day ([what Amazon shows](#what-amazon-shows-read-on-emmer-2026-11-19)). Kael asked
> for the plan and the build at once: the calls made without asking are under [Calls to
> review](#calls-to-review); [as built](#as-built-2026-11-19) says what differs from the design.
> design.md has the reasons ("Where tags come from: HSA tracking"); what's left is in
> [M99](../../m99-follow-ups/PLAN.md) ("Tags, beyond Tags, more"). Builds on [split-level tags](../../split-level-tags-and-funds/PLAN.md)
> (built 2026-11-12) and brings [Tags, more](../../tags-more/PLAN.md)'s slice that it needs: the
> chain proposing tags, history and the AI among them, and review saying where a tag came from.

## The brief (Kael, 2026-11-07)

The AI should tag all splits (transactions for now, until split-level tagging is built) that
appear to pay for HSA-eligible items. Amazon says this directly in its receipts.

The point (Claude's reading, confirmed by Kael 2026-11-19): an HSA can pay back an eligible
expense paid out of pocket, even years later, so what matters is knowing which purchases were
eligible, with their receipts.
The tag filter on Transactions already lists a tag's transactions, and Reports totals them.
Paying one back is [the funds scenarios'](../../funds-b/scenarios.md) number 29.

## Kael's answers (2026-11-19)

1. **The point** is as read above: which purchases qualified, with their receipts.
2. **One fixed tag, `#hsa-fsa-eligible`,** for HSA and FSA both (Amazon's mark doesn't tell them
   apart). Not a book setting, and not a tag the book describes: the AI's instructions name it,
   and it's created the first time it's used. So it's the one exception to Tags, more's
   decision 7 (the AI proposes only the book's existing tags): the AI may propose this one in a
   book that doesn't have it yet.
3. **Amazon's mark tags outright,** as the charge is itemized, not proposed for review. Review
   says it came from Amazon, and it's removed like any tag. It applies in every book, since it's
   a fact, not a guess.
4. **Tags, more's slice comes with it, as Tags, more planned it:** proposals carrying tags, the
   AI and history proposing them, and review saying where a tag came from. Rules', schedules'
   and receipts' Tags stay in Tags, more. The decisions of Tags, more's that the slice relies on
   (3 and 7 to 10) were settled with Kael the same day (its [Decisions to
   review](../../tags-more/PLAN.md#decisions-to-review)): every proposal's tags count, whether or
   not its account won; and item history carries an item's tags (decision 11), since the AI is
   never asked about a split item history already settled.
5. **Paid back: not in this milestone.** Only eligibility is tagged. How a payback is recorded
   is decided when the first one comes; a tag added by hand works today, and Funds B's
   restricted money (its scenarios' theme 7, number 29) is the longer road.
6. **Which books:** the AI proposes it wherever "Suggest tags" (Tags, more's setting, on by
   default) is on. No setting of its own.
7. **Pharmacy receipts: not checked** (Kael: he has none to look at). The AI reads a receipt's
   lines as it does any split's, so they get its judgment, not a mark.

## What Amazon shows (read on Emmer, 2026-11-19)

Read with the session `shops` keeps on Emmer (no new sign-in), from four of Kael's orders whose
items looked eligible. Nothing from them is kept here; the tests' pages are made up.

- **On each item,** on the order's page (the one amazon-orders reads for `get_order`) and its
  invoice alike: `<div data-component="healthBenefitAccountInformation">` holding "FSA or HSA
  eligible". Every item has the block; an item that isn't eligible has it empty. amazon-orders'
  `Item.parsed` is the item's element and holds it, so `shops` reads the mark with no request of
  its own.
- **In the order's summary:** a line "FSA or HSA eligible: (inc. tax and shipping)" with the
  eligible amount, so Amazon counts an eligible item's tax and shipping as eligible too.
- **What was marked:** three of the four orders had a marked item; beside one of them, two
  items in the same order weren't, and the fourth order's item wasn't. The summary's amount was
  the marked items with their tax.

## The design

### 1. Amazon's mark

- **`shops` reads it** (`shops.amazon._order_data`): each item gets `hsa_fsa_eligible`, true
  when its `healthBenefitAccountInformation` block says "eligible"; the order's totals get
  `hsa_fsa_eligible`, the summary line's amount, kept for reference (a payback, later).
- **The orders API carries it:** `OrderLine.hsa_fsa_eligible?: boolean` (`shared/orders.ts`), a
  fact about the line any shop's reader can send. `shops.lines` sets it on an item's line, a
  purchase's or a refund's (so a refunded item's line takes the tag off the total too).
- **Tax and shipping follow when the whole charge is eligible:** when every item line of a
  charge is eligible, its tax, shipping and gift wrap lines are too (Amazon's eligible amount is
  then the whole charge). A charge with eligible and other items tags its items only.
- **`app` tags the split** as it itemizes the charge (`chargePostings`): the line's split gets
  `hsa-fsa-eligible` (`HSA_FSA_ELIGIBLE` in `shared/tags.ts`), and the proposal record says it
  came from Amazon (below).

### 2. Orders already read

- **`shops` reads again, once, every order it kept before it read marks** (an item without
  `hsa_fsa_eligible`), at its next sync, along with the ones it reads anyway. For Kael's book
  that's 69 orders, about as many as his first sync read; `ORDER_PAUSE_SECONDS` between them.
- **`app` adds the tag to a charge already read** when its lines come again with an item newly
  marked (`OrdersStore.receive` returns them; `retag` in `server/orders/read.ts`): the split
  with that line's memo and amount, not tagged yet, gets the tag. It only adds, never moves the
  transaction back to review, and leaves everything else as it is; the stored charge takes the
  new lines. One the person has re-split since (no split with that memo and amount) is left.

### 3. The chain proposes tags (Tags, more's slice)

- **Proposals carry tags:** the external API's `Proposal.tags` (for the transaction as a whole,
  optional, so `api_version` stays `"1"`), and inside, `InternalProposal.splits[].tags` for one
  split.
- **The decision gathers every proposal's tags** (decision 3, as settled): `Decision.tags`, a
  list of `{index, tag, by}`, one per split and tag, from every valid proposal whether or not its
  account won, the first categorizer to propose it named. A whole-transaction tag goes on every
  split being placed.
- **Applying adds and never removes:** `placed()` puts the decision's tags on the splits it
  places, beside any they have, so the order reader, Suggest categories, receipts and imports
  all get them. Every proposed tag must already be normal (`toTag(tag) === tag`); one that
  isn't is dropped, as an account that isn't open is.
- **The proposal record keeps them:** a `tags` column on `proposal` (app migration), the
  decision's `{index, tag, by}` and Amazon's (`by: "amazon"`). Whether a proposal was accepted
  stays about its postings (decision 8).
- **Review says where a tag came from:** a card's proposal summary carries the tags, and the
  card says, under its splits, "#hsa-fsa-eligible from Amazon's order", or "suggested by the
  AI", "by history", for each one still on the transaction. Removing one is the transaction
  page's ×, as for any tag.

### 4. History and item history

- **History** (decision 10): a tag that every one of the payee's past transactions it learned
  from has on its other side, when there are 3 or more, goes with its proposal. History's
  context carries each split's tags (`ledger.compact` has them).
- **Item history** (decision 11): an item's proposal carries the tags of its most recent
  confirmed split, at the same payee if it was bought there, else anywhere.

### 5. The AI

- **What it's told:** the book's tags (`CategorizeIn.tags`: name, how many, first and last
  dates, from its context's 14 months of history: `contextTags`), with `hsa-fsa-eligible`
  always among them; and its history's splits' tags. In the user message, not the cached system prompt, since they
  change as the book is tagged.
- **What it answers:** `tags` on each split it places and on the proposal as a whole (the JSON
  schema's, required and possibly empty). The ai service keeps only the tags it offered; `app`
  checks them again.
- **The instructions:** propose a tag only when the history shows it (this payee's transactions
  always have it) or the transaction falls within a tag's dates and clearly belongs; else none.
  And `hsa-fsa-eligible` on each split that pays for what an HSA or FSA can pay for (medical
  care as IRS Publication 502 counts it: medicine, menstrual care, first aid, medical devices
  and supplies, tests, glasses and contacts, dental and doctors' care), not general health
  (vitamins and supplements, toiletries, fitness).
- **"Suggest tags"** (decision 9): a book's AI setting (`suggest_tags`, ai migration 3, on by
  default), on the AI page beside the others. Off, the AI is told nothing of tags and any it
  answers are dropped.

### 6. The past, beyond Amazon

- **Through the MCP server,** not a new button: Claude, connected to the book, can read past
  transactions and tag the eligible splits (`write_edit_transaction`; tags are on splits). An
  in-app "find eligible spending" can come later if that isn't enough.

## As built (2026-11-19)

As designed, in the steps below, with these differences:

- **The book's tags come from the context** (`contextTags`, the 14 months of history every
  categorizer gets), not the ledger's `GET /books/{b}/tags`: no new call, and a tag unused that
  long is unlikely to apply. The external API has them as `context.tags`.
- **The AI is asked only for a selection,** as before: Suggest categories for a selection, a
  receipt, an order's items. Suggest categories for everything asks only the built-ins.
- **Tests:** `shops` 6 (`test_marks.py`: the mark and the summary's amount from made-up pages,
  lines marked, the whole charge's tax, a refund, the once-over); `app` 9 (`orders.test.ts`: a
  marked line tagged and recorded as Amazon's, one read before tagged later and left confirmed,
  one changed since left, the AI offered the tag and its tag recorded, a bad mark refused;
  `categorize.test.ts`: every proposal's tags, history's, item history's, Suggest categories
  recording them); `ai` 3 (offered tags only and none with Suggest tags off, Claude's
  instructions, the answer's tags read); API 2 (`orders.test.ts`, `hsa.test.ts`); browser 2
  (`hsa.spec.ts`: review's "from Amazon's order", the AI page's Suggest tags). `pnpm test`
  passed; `pnpm e2e` passed (API 124 of 124, browser 152 of 152).

## Documentation (Kael, 2026-11-20; built, `v1.4.0`)

Kael, after `v1.3.0`: "HSA and FSA purchases require documentation. For Amazon, let's make sure to
save a hard copy of the invoice or order to the transaction. For other transactions, most will
come from reading a receipt so we're set there, and any that don't, maybe we add a
`needs-receipt` tag that we remove if a receipt is uploaded?"

**His answers:** invoices for eligible charges only (each is one more Amazon page, toward its bot
score); needing a receipt **worked out, not stored** (an `#hsa-fsa-eligible` split and no file),
over the tag, since a tag has to be kept right by every path that tags, attaches or deletes a
file; only eligible spending flagged; released once green.

**Proven on Emmer first** (with the session `shops` keeps, no sign-in; nothing of it kept here):
Amazon's printable invoice (`ORDER_INVOICE_URL`), read with the session and printed in headless
Chromium with only Amazon's image hosts' pictures and styles loaded, is a one-page PDF of about
85 KB: the order's date and number, its items each marked "FSA or HSA eligible", the totals and
Amazon's eligible amount. About 3 seconds to read, 5 to start the browser (once a sync), 4 to
print.

**As built:**

- **`shops`:** `save_invoices` at the end of each sync, for every kept order with an eligible
  item and no invoice yet (`Db.eligible_orders`, `invoiced`), kept as
  `/data/shops/amazon/<book>/invoices/<order>.pdf` (`invoice_path`; forgotten with the
  connection); `GET /books/{book}/amazon/orders/{number}/invoice`; `for_app` says
  `invoice: true` on the charge's order. The sync's status counts "invoices saved".
- **`app`:** `OrderCharge.orders[].invoice`; `ShopsPort.invoice`; `attachInvoices` when a charge
  with an eligible line is read, and `refresh` (tags, then the invoice) for one already read
  whose lines or invoice are new (`OrdersStore.receive`'s `Marked.invoices`). Only into a
  transaction holding no file yet.
- **No receipt:** the ledger's journal `attached` (`pnpm generate`); `JournalFilter.attached`,
  Receipt in Transactions' and review's filter (`?receipt=yes|no`, the pill "no receipt"); a
  review card's "HSA or FSA eligible, without a receipt to claim it with", linking to the
  transaction (to attach one) and to `?tag=hsa-fsa-eligible&receipt=no`; MCP's
  `read_transactions` `attached`, and its base skill saying so.
- **Tests:** `shops` 2 (only pictures and styles from the image hosts; an eligible order's
  invoice kept by its number and said to `app`); `app` 4 (attached once to an eligible charge's
  transaction; not for one with nothing eligible or a file already; attached to one already
  read once kept; the filter keeping by files); ledger 1 (`attached`); API (`hsa.test.ts`: the
  tag with `attached` false and true); browser (`hsa.spec.ts`: the card's note, and All without
  one listing it). The Amazon invoice's own printing is only proven on Emmer: the e2e stack has
  no Amazon.
- **Not built:** an invoice for every Amazon charge (M99). ~~Receipt on an account's
  ledger~~: built 2026-11-21 at Kael's asking (`v1.5.0`): the ledger's account ledger takes
  `attached`, its filter has Receipt, and MCP's `read_account_ledger` too.

## Building it

1. **`shops`:** the mark (`_order_data`), the once-over of orders kept before marks
   (`Db.unmarked_orders`), `lines` carrying `hsa_fsa_eligible`. Tests in
   `tests/test_lines.py` and a new `tests/test_marks.py` (made-up item HTML).
2. **Orders in `app`:** `OrderLine.hsa_fsa_eligible`, the split's tag in `chargePostings`, the
   proposal record's tags, `retag` for charges already read. Tests in `orders.test.ts`.
3. **The chain:** `Proposal.tags`, `splits[].tags`, `Decision.tags`, `placed()`, the check,
   history's and item history's tags, the `proposal.tags` migration and record. Tests in
   `categorize.test.ts`.
4. **The AI:** `@luminous-money/ai-api` (`CategorizeIn.tags`, history's tags, `SplitProposal`'s
   tags, `suggest_tags`), the ai service (migration 3, settings, schema, check, prompt, the fake
   provider tagging what looks eligible), `categorize/ai.ts`. Tests in `services/ai`.
5. **The PWA:** the review card's line, the AI page's "Suggest tags". A browser test.
6. **API tests:** an order with an eligible line tagged, a read charge tagged afterwards,
   Suggest categories adding the fake AI's tag.
7. **Docs:** design.md ("Tags (M17)": where tags come from; "Shops' orders in the book"; "The
   AI"), `docs/categorizer-api.md`, `services/shops/README.md`, this plan as built, Tags, more's
   plan (its slice built), PLAN.md, RESUME.md.

`pnpm test` and `pnpm e2e`; `pnpm generate` only if the ledger's API changes, which nothing here
needs.

## Calls to review

Made without asking, as Kael asked for the plan and the build at once; each is easy to change.

1. **Tax and shipping are tagged only when the whole charge is eligible.** A mixed charge's tax
   stays untagged, so Reports by the tag come in under Amazon's eligible amount by that tax.
   Splitting the tax line by Amazon's amount is the alternative.
2. **Orders kept before marks are read again once, by themselves,** at the next sync (69 for
   Kael's book), rather than by a button.
3. **A charge already read gets the tag added and stays where it is** (confirmed stays
   confirmed), since it's Amazon's word.
4. **A whole-transaction tag goes on every split being placed;** a split's tag on that split.
5. **History's tag needs all of the payee's past transactions it learned from** (3 or more),
   not just the last 3.
6. **The past beyond Amazon is the MCP server's,** not a button in the app.
7. **What the AI is told counts as eligible** (Publication 502's medical care, not general
   health) is the instructions' wording, to be tuned by what it proposes.
