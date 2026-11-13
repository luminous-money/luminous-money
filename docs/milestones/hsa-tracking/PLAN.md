HSA tracking: plan
==================================================================================================

> **Status: noted, not planned** (Kael, 2026-11-07). Elaborated with Kael when it starts.
> Builds on [Tags, more](../tags-more/PLAN.md) (the chain proposing tags) and, for tagging the
> item rather than the whole transaction, on [split-level tags and
> funds](../split-level-tags-and-funds/PLAN.md), whose step 1 (tags per split) is built
> (2026-11-12): an item's split can carry `#hsa-eligible` now, so the steps below tag splits
> from the start and step 4 is done.

## The brief (Kael, 2026-11-07)

The AI should tag all splits (transactions for now, until split-level tagging is built) that
appear to pay for HSA-eligible items. Amazon says this directly in its receipts.

The point, as Claude reads it (to confirm): an HSA can pay back an eligible expense paid out of
pocket, later, so what matters is knowing which purchases were eligible, with their receipts.
The tag filter on Transactions already lists a tag's transactions, and Reports totals them.
Paying one back is [the funds scenarios'](../funds-b/scenarios.md) number 29.

## What's there now

- **Tags** (M17) are the transaction's, with filters on ledgers, Transactions and Reports.
  Nothing proposes a tag yet: [Tags, more](../tags-more/PLAN.md) (planned, not started) has the
  chain (rules, history, the AI) proposing them, the AI only the book's existing tags (its
  decision 7), "Suggest tags" on by default.
- **Amazon orders** ([the plan](../.archived/amazon-orders/PLAN.md)): each charge is itemized,
  each item a split with its title as the memo. `services/shops` keeps each item's title,
  quantity, price, ASIN and link (`shops.amazon._order_data`), not Amazon's "FSA or HSA
  eligible" mark. amazon-orders (5.2.1) doesn't parse that mark, but its `Item` keeps the HTML
  it was read from (`item.parsed`), so `shops` can look for it there. Where Amazon shows it
  (the order's page, its invoice) is to check against a real order.
- **Receipts** (M16): `extract` reads a receipt's lines; whether pharmacy receipts mark eligible
  items well enough to read is to check.
- **Item history** places a split by its memo against confirmed splits, so an item bought
  before goes where it went. The same could carry its tag.

## The idea

- **One tag for eligible spending,** `#hsa-eligible` say.
- **Where it comes from, strongest first:**
  1. **The shop says so:** Amazon's mark on an item, read by `shops`, carried on the item's
     line through `POST /books/:book/orders` (`shared/orders.ts`), and tagged by `app` as it
     reads the charge. A fact, not a guess, and no AI call.
  2. **Item history:** an item tagged before is tagged again.
  3. **The AI:** per split, from the item's memo and the payee (a pharmacy, a clinic),
     proposing the tag with its reason, for review.
- **The eligible split is tagged,** not the transaction (splits have tags since 2026-11-12),
  so Reports by `#hsa-eligible` count the eligible items and not the rest of the order.
- **Review shows where the tag came from** (Tags, more's "Seeing where a tag came from").
- **What's already in the book:** after its first sync, `shops` reads back only 15 days, so
  Amazon charges already itemized need their orders read again for the mark; the AI goes over
  the rest on request.

## Steps (proposed)

1. **Amazon's mark:** `shops` reads it, the orders API carries it, `app` tags the item's split.
   No AI.
2. **The chain proposes it:** item history and the AI, on Tags, more's proposals.
3. **The past:** Amazon's orders read again for the mark, and the AI over past transactions on
   request.
4. ~~**Per split,** once split-level tags exist~~ (they do: 2026-11-12).

## Questions for when it starts

1. **The tag's name,** and how the AI knows it: it proposes only tags the book has (Tags, more's
   decision 7), so is HSA tracking a book setting that names its tag?
2. **Does Amazon's mark tag it outright** (it's Amazon's word), or propose it for review as the
   AI's guess is?
3. **FSA too?** Amazon's mark says "FSA or HSA eligible": one tag for both, or the one the
   household has?
4. **Tags, more first,** or a narrow path for this one tag?
5. **Paid back or not:** once the HSA reimburses one, a second tag, or Funds B's job
   (restricted money, the scenarios' theme 7)?
6. **Which books:** every book with the AI on, or only one with an HSA account?
