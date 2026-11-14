Where We Left Off
==================================================================================================

_Updated 2026-11-14._ Keep this current: every finalized change set updates it (see
[CLAUDE.md](CLAUDE.md)).

## Latest (2026-11-14): openings aren't spending, counted-as accounts say so, the breakdown's transactions

Kael asked for three changes (PLAN.md's Polish, "Kael's changes, 2026-11-14"; design.md has the
decisions). **Committed, pushed and released as `v0.1.29`** at his asking.

- **An opening is never spending** (`outflows.py`): under Outflows, "What escrow holds" (escrow's
  balance when a loan came into the books, booked against Opening Balances) counted as that
  month's Rent-and-Mortgage. A transaction marked `opening: TRUE` states a balance, and the lens
  leaves it be. The ledger marks an account's opening balance; New loan marks "Borrowed",
  "What's owed" and "What escrow holds". Ledger migration 15 adds `directive.opening` (from the
  text, as `budgeted` is); `CompactTransaction.opening` says it. Client regenerated. Payments
  before the bank's history, also against Opening Balances, aren't marked and still count.
  What was written before isn't marked: Kael's escrow figure and "Borrowed" were marked through
  the API (their meta), so the migration's backfill reads them on the upgrade.
- **"Counted as spending here"** (`CountedHere` in `components/Outflow.tsx`, on an account's
  page): an expense account that an asset or liability counts as shows which (linked), this
  month's spending there and the 6-month average as outflows read it (the breakdown report of
  that account), and a link to what's paid into them. Its $0 balance read as if the payments
  were missing.
- **The breakdown's transactions** (`BreakdownTransactions` in `pages/Reports.tsx`): under the
  donut, a scrolling window lists every transaction under the root or the account drilled into
  (`JournalList` over the journal filtered by account, paged as it scrolls), with the tag
  filter; under Outflows, what's paid into accounts that count there too. The drill is in the
  address now (`?side=income`, `?of=`), so coming back from a transaction keeps it.
- **Tests:** ledger (an opening isn't spending, a payment from Opening Balances is; an opening
  balance is marked), app (New loan marks its balances), browser (`m12.spec.ts`: the breakdown's
  list follows the drill and keeps its place coming back; a counted account's card and the
  breakdown's list under Outflows and Expenses). `pnpm test` passes (ledger 263, app 343);
  `pnpm e2e` passes (API, browser 139, the command). Not yet looked at on a phone.

**Asked, not answered:** Kael made `Expenses:Groceries:Beverages` (a leaf: New account always
makes one) and couldn't move Alcohol under it ("holds transactions, so it can't have
sub-accounts", from `checkNewAccount`, though it has none). Offered: delete the empty leaf and
move Alcohol (and maybe `…:Non-Prepared:Beverages`'s children) through the API, and/or let an
empty leaf take sub-accounts (in `checkNewAccount` and `chart.rename`) with clearer words.

**Next:** Kael upgrades Emmer (`upgrade 0.1.29`: ledger migration 15, and 0.1.27's if not yet).

## Before that (2026-11-13): "Repeat…" no longer copies where a transaction came from

While setting up Kael's paychecks as schedules on his live book (done through the API, not in
the repo), the schedule he'd made with "Repeat…" from a bank row turned out to carry that row's
`source`, `import-batch` and `import-id` in its template, so every paycheck it staged claimed the
same bank row. The matcher goes by `app`'s import records, not this meta, so nothing mis-matched;
it was wrong provenance. `fromTransaction` (`web/pages/ScheduleEditor.tsx`) now keeps only the
transaction's `budget` choice (design.md's "Scheduled transactions"). m3's "Repeat…" browser test
repeats a bank row with `budget: false` and checks the template's meta is just that.
`pnpm test` and `pnpm e2e` pass (browser 137). **Committed, pushed and released as `v0.1.28`**
at Kael's asking; no migrations in it.

## Before that (2026-11-12, later): the split editor, and three fixes, released as `v0.1.27`

Kael asked for four changes; all are built, on top of the split tags below, then adjusted after
his comments (a faint "Memo" on a split without one; no string matching of SimpleFIN errors).
design.md has each decision; PLAN.md's Polish has the list ("Kael's changes, 2026-11-12").
**Committed with the split tags and the docs reorganization below (one commit), pushed, and
released as `v0.1.27`** at Kael's asking (the tag on that commit). Emmer isn't upgraded (Kael's
to run): on the upgrade, ledger migration 14 drops his book's old tags (his call), and `app`
migration 24 adds the dismissals.

- **The split editor** (`web/components/Splits.tsx`): the transaction page (and a schedule's)
  shows each split as it is, its memo (a faint "Memo" without one) and tags above its account
  (a long name loses its start) and amount. Clicking one opens a dialog with its memo (editable
  now: a posting's `memo:`), account, amount, tags and a schedule's tolerance; Enter or Save
  puts it back, Escape or Cancel doesn't, Delete removes it; the transaction is saved as before.
  "+ Add split" opens a blank one. A long press (`useLongPress` in `lib/selection.ts`) or a click with Shift, Ctrl, ⌘
  or Option starts Select mode, with only Add tag… and Delete. **No fund in it:** funds per
  split are split-level tags and funds' step 2, unplanned, so the transaction's Funds section
  stays (the plan's "The split editor" has this and 5 calls made without asking).
- **Bank feed errors where they're about** (`simplefin/client.ts`' `concerns`): the Bridge sends
  "Connection to Example 529 Plan may need attention. Auth required" as
  a plain string with no account, which showed on every linked account. At Kael's word (no
  string matching), an error is an account's only when it has its `account_id`; anything else
  is the connection's: on its card on Bank connections, and in **the bell**, as a dismissable
  "bank-feed" notification ("SimpleFIN 1a2b3c4d needs attention", the Bridge's words, links to
  the connection's card via `?connection=<id>` and to SimpleFIN Bridge; `bankNotifications` in
  `server/notifications.ts`). Dismissing is per person: `app` migration 24,
  `notification_dismissal`, and `PUT /books/:book/notifications/:id/dismissed`. An error keeps
  `since` (in the connection's stored errors), which is in the notification's ID, so one that
  goes and comes back is new. So the 529's login shows on no account's page, only on the card
  and in the bell.
- **Confirmed stays confirmed** (`importRows`): a bank row matched to a transaction already
  confirmed (a receipt confirmed in review, one typed by hand) is final at once (`match:
  "confirmed"`), out of review, taking the bank's amount within a schedule's tolerance
  (`takeBankAmount`, shared with `confirmRow`). Reverses M2's "no match is final until
  confirmed" for confirmed ones; unconfirmed ones are as before.
- **Where a price came from:** the "entered by hand" commodities are priced by the bank feed
  (a linked brokerage's holdings record a price each sync). A price directive now has
  `source: "bank"` or `"fetched"` (`PriceIn.source`, written by `recordPrices`, the morning's
  fetch and `prices/on`); `CommodityOut.price_from` is the latest one's (bank, fetched, hand),
  and Commodities says it. Kael's existing prices say "entered by hand" until the next sync
  writes the day's again (it replaces the same day's). Client regenerated.
- **Tests:** unit (the confirmed match final, a schedule's tolerance at once, whose error it is,
  the bell's bank notifications and dismissals, a price's origin) and browser
  (`tests/ui/src/splits.spec.ts`: the editor, Escape and Enter, Shift-click and long-press
  Select mode, Add tag… and Delete; m9: a plain-string error on no account's page, on the
  connection and in the bell, dismissed there; one naming an account on its page only). The tests that typed into the old inline splits use `editSplit` (`tests/ui/src/
  support.ts`); the coffee examples (m2, matches) use unconfirmed coffees, since confirmed ones
  now never reach review. `pnpm test` passes (ledger 261, app 344, the rest); `pnpm e2e` passes
  (API 115, browser 137, the command). Once, under the full run's load, brokerage.spec's "Read
  again" was still reading at its 5-second wait; it passed alone and in the next full run.
  Screens looked at on a phone and a desktop, light and dark (a long account name wrapped past a
  phone's screen in the editor, fixed).
**Next:** Kael upgrades Emmer (`upgrade 0.1.27`) and tries the split editor and says whether the fund belongs in it now (that's step
2's questions 3 and 4 first). The rest as below.

## Before that (2026-11-12): tags are splits' now

Kael asked for "a detailed plan for moving tags from transaction level to split level", built if
nothing in it was controversial. While it was being planned he settled the one question that
was: tags move, the transaction keeps none, and the tags already used can go ("no one else is
using this... we don't need to bend over backwards to preserve any old behavior or accommodate
old tags"). The plan is [split-level tags and funds](docs/milestones/split-level-tags-and-funds/PLAN.md)'s
"Step 1: tags per split", with eight **calls to review** and "As built"; design.md's "Tags
(M17; a split's since 2026-11-12)" has the decisions.

- **In the books:** a posting's `tags: "#gift #hsa-eligible"`; in the ledger's API
  `Posting.tags` (`TransactionIn.tags` and `TransactionPatch.tags` are gone, and a PATCH with
  them is a 422). Ledger migration 14: `posting_tag` in place of `transaction_tag`. A
  transaction's own `#tag`s aren't read. Client regenerated.
- **Filters** keep a transaction with a split that has every tag; rows' `tags` are their
  splits' together, and the compact stream's and journal's postings have their own.
  **Reports count only the tagged splits** (a receipt's `#gift`, not the groceries beside it).
- **Setting them:** each split on the transaction page (and a schedule's) has its own Tags, its
  memo shown above. A card's Tags and Select mode's Add tag… put a tag on what the money was for
  (not the bank's side; both sides of a transfer); removing one takes it off every split.
  An itemized card shows each split's tags.
- **Kept:** every edit spreads the split it had; a receipt's, an order's or a multi-split
  category's items take the tags of the split they replace; pairing a transfer keeps each
  side's.
- **Tests:** `pnpm test` passes (ledger 260, app 338, the rest); `pnpm e2e` passes (API 114,
  browser 135, the command).
- **Committed and released with the change set above** (`v0.1.27`); on the upgrade, Kael's book
  loses its tags (his call).

**Next:** Kael looks over the eight calls in the plan. Then, as before: the rest of Funds B,
Tags, more (to be read through split tags first; its plan says what changed), or HSA tracking
(which can tag the eligible item's split from the start).

## Before that (2026-11-07): the docs reorganized

Kael asked for a cleanup: the README brought up to date, then docs/ reorganized. No code changed
but three comments' paths to the migration's plan.

- **Done milestones are archived** in `docs/milestones/.archived/`: M1 to M17 (M7 was dropped),
  M19, production readiness, the chart of accounts import, migrating from another system, Funds
  A (`funds-a`), Loans, Amazon orders and brokerage activity. Every link in the repo follows
  them. A milestone moves there when it's done (docs/PLAN.md, "How the docs are laid out").
- **Funds B is `docs/milestones/funds-b/`** (it was `funds/B`; `funds/PLAN.md`, the split's
  index, is folded into its head). Its [The rest of B](docs/milestones/funds-b/PLAN.md#the-rest-of-b)
  now lists what's left, A's known gaps and the calls still to review included. The git-ignored
  `discussion.private.md` moved with it (on this machine only).
- **New milestones:** [M99: Follow-ups](docs/milestones/m99-follow-ups/PLAN.md) (open questions,
  calls made without asking still to review, a bug, polish, and every archived plan's leftovers,
  by area; docs/PLAN.md's notes, Deferred, Open questions, Later and Polish moved there), [HSA
  tracking](docs/milestones/hsa-tracking/PLAN.md) (Kael's brief, what's here, six questions),
  and [split-level tags and funds](docs/milestones/split-level-tags-and-funds/PLAN.md) (from
  PLAN.md's "Funds and tags per split"). M18 and M20 have their briefs.
- **docs/PLAN.md** is the milestones ahead, then those done (with the polish built), and how
  the docs are laid out. CLAUDE.md now sends open questions to their milestone or M99.
- **README** says what it does today (`v0.1.26`), with the `shops` service and its route.
- **Found on the way:** Amazon's "FSA or HSA eligible" mark isn't read today (`shops` keeps an
  item's title, quantity, price, ASIN and link); HSA tracking's step 1 reads it.

**Next:** Kael looks over HSA tracking's and split-level tags' questions, and picks what's next
(the rest of Funds B, Tags more, or HSA tracking, which builds on Tags more). What came before
(confirming the brokerage's rows in review, below) still stands.

## Before that (2026-11-07, night): brokerage activity, released as `v0.1.26`

Kael answered [the brokerage activity plan](docs/milestones/.archived/brokerage-activity/PLAN.md)'s
questions and asked for all of it, the cleanup included, released, on Emmer and run on his
book. Before deciding, the proposal was checked against his Fidelity ledgers and Emmer's
snapshot (read only): sweeps are no-ops one by one but don't pair neatly; transfers of assets
are three kinds of row; linking had hidden the double count in a negative opening cash
balance; and three more bugs (below). The plan has "Checked against the live book", "Decided
with Kael", and "As built" with five calls made without asking.

- **A brokerage's rows are read** (Fidelity's, `simplefin/activity.ts`): sweeps left out (an
  import row `left-out`), dividends confirmed to the link's dividend account (default
  `Income:Dividends`, or `Income:Retirement:Dividends` for an IRA and the like, changeable on
  Bank connections), trades booked with their shares (lots and gains in the books, Kael's
  choice), transfers of assets as shares at the bank's average cost, cash from another broker
  to `Equity:Opening-Balances`. Another brokerage is as before, and Bank connections says so,
  with a link to open an issue or send a pull request.
- **The snapshot settles shares** (`settle`): estimates trued up, a difference nothing explains
  staged after three days. A read brokerage's cash is compared with the bank's (not written).
- **A history opens positions as they were** (linking, and **Read again**, which is the
  cleanup: Bank connections → beside a brokerage link, previewed; no SimpleFIN requests).
  Prices on past days come from the ledger's new `POST /prices/on` (beanprice; Yahoo by
  default, `LUMINOUS_MONEY_PRICE_SOURCE`).
- **Bugs fixed on the way:** every Fidelity lot opened at $0.00 (its cost basis is always
  `0.00`; `purchase_price` is the average cost, now used); a zero-share core position opened as
  a zero-share lot (the ROTH's holdings page 500'd); a position without a symbol (the ROTH's
  unit trust) was counted as cash; and a balances-only fetch wiped the saved holdings.
- **Tests:** `pnpm test` and `pnpm e2e` pass (unit, ledger, API against the real ledger,
  browser).

**Emmer is on `v0.1.26`** (2026-11-08 00:46 UTC, from 0.1.25; its backup is
`/srv/luminous-money/backups/luminous-money-20261108T004608Z-0.1.25.tar.gz`), every service
healthy, and **Read again has run on Kael's three Fidelity links** (Joint WROS, ROTH IRA,
Traditional IRA; previewed first, nothing made by hand deleted). Checked after: each account's
cash matches the bank's ("Matches the bank"; all three were off before), every position's
shares match the snapshot (a single-letter ticker is held under its description's name), no
lot is at $0.00, and nothing waits to be settled. What's in review from them is as planned: the
brokerage's trades (with their gains), the transfers of assets and cash from the old broker
(against `Equity:Opening-Balances`), and the rows read as anything else, kept as they were.

**Next:** Kael confirms those in review (most are the Traditional IRA's transfers of assets).
One Fidelity account on the connection (an individual account) isn't linked to the book;
linking it now reads its history the new way.

## Before that (2026-11-07, late): Kael's nits, released as `v0.1.25`

Kael sent a list of nits (review, bank connections, home) and one bigger question. All the nits
are built, tested and **released as `v0.1.25`** (at Kael's asking), for him to upgrade Emmer.
What changed (design.md has each with its reason; PLAN.md's Polish has the list):

- **Review:** Back or Confirm on a transaction opened from a card comes back to the same place
  (`lib/place.ts`; before, the list kept the transaction page's scroll: the top, or the bottom
  with skipped cards), and a transaction's page opens at its top. **Every account picker** opens
  on its account's name, selected, so it can be edited into a new account (`…:Tools` →
  `…:Organizers`, then "Create account"); Tab fills in the highlighted one. The **fund choice**
  is on the card's color and as wide as the card. **Tags** on each card. A **search** (payee,
  description, split memos) and the funnel's **Accounts** (any of them, under them too) and
  Tags, all in the URL, so Back keeps them (`lib/filters.ts`, filtering the queue in memory).
- **Transactions:** the same search and an Accounts filter, at the ledger: `/journal` takes `q`
  and `account` (`store.searched`, `store.touching`; client regenerated).
- **Bank connections:** each is "SimpleFIN <the id's first 8>", with a rule between accounts.
- **Home:** **starred funds** (`fund_star` in `app`, migration 22; `GET/PUT/DELETE
  /books/:book/fund-stars[/:fund]`; ★ on a fund's page; New fund stars it for its maker;
  renames follow). Home's Funds card lists only those, its heading inside, and isn't there
  without any. **Kael's funds start unstarred** after the upgrade, so his home card disappears
  until he stars some. "+ Add an account" is a short centered rule (shown only above the funds).
- **The spending chart is real** (checked against the live book, read only): its line matched
  November's journal day by day. It hugs the dotted line because a large payment on the 1st
  (the mortgage, through the outflows lens) sets both lines' start, and the rest of the week is
  a sliver on an axis scaled to the dotted line's month-end.
- **Per-split funds and tags** aren't built: noted in PLAN.md ("Funds and tags per split"; a
  milestone of its own since, [split-level tags and
  funds](docs/milestones/split-level-tags-and-funds/PLAN.md)).
- **Fidelity's cash rows** (Kael's bigger question): [a proposal](docs/milestones/.archived/brokerage-activity/PLAN.md)
  from what the live book shows (sweeps into the core money market beside every event, trades
  without their shares, transfers of shares as cash), with five questions for Kael. PLAN.md
  has it as "Brokerage activity", to settle before we're done.

**Emmer is on `v0.1.25`** (upgraded at Kael's asking, 2026-11-07 10:26 UTC, from 0.1.24; its
backup is `/srv/luminous-money/backups/luminous-money-20261107T102611Z-0.1.24.tar.gz`), every
service healthy. **Next:** Kael stars the funds he wants on home (none are, after the upgrade).
Then the brokerage questions (he'll come back to them).

## Before that (2026-11-07): `v0.1.24`, after Kael's first sync

Kael synced on `v0.1.23` with his cards chosen: 39 charges to the book (73 on other cards left
out), 24 read into their bank transactions, 9 made as their own, 6 waiting (paid without a
card). **The 9 made aren't duplicates** (looked at, with Kael's leave): all are on
`Liabilities:Credit-Cards:Capital-One-Baby-Card` (cards 6062 and 2113), which isn't linked to
the bank feed (none of SimpleFIN's accounts is that card; its only feed row is a payment's other
side), so no bank row ever comes to match them: they're the only record of those purchases, to
confirm in review. Kael's to decide whether that card should be on the feed. Then, at his asking, `v0.1.24`: **a sync reads back only
15 days before the last** after its first full read (`shops.amazon.read_window`; changing the
date, cards or account owes a full read again), and **a refund names its items** when the
order says (`shops.lines._refund`: the only item; the item in the shipment marked returned; the
items whose share it is). A charge already in the book isn't read again, so his one refund
stays a single line there (one transaction to fix by hand).

## Hand-off (2026-11-07): Amazon orders built, `v0.1.23`, for Kael to try on Emmer

**Read this first.** Kael asked for the Amazon login and order reading to be proven on Emmer
before the rest was built. **It was** (`v0.1.22`, below), and then the rest was built (`v0.1.23`,
[the plan](docs/milestones/.archived/amazon-orders/PLAN.md#steps-2-and-3-as-built-2026-11-07); design.md,
"Shops' orders in the book"):

- **Each Amazon charge is itemized into the book as a receipt** (Kael: "look at these Amazon
  charges as simple receipts"): paid from the account holding its card; always itemized (each
  item a split with its memo, then tax, shipping, and a gift card or points from their
  accounts), even into a transaction already categorized; read into the bank's copy if it's
  here, else made as its own, which the bank's copy is matched to when it comes in; back in
  review. One on a card no account holds waits, shown on the Amazon page with why.
- **`shops` hands its charges to `app` after every sync** (`POST /books/:book/orders`, the one
  door for any shop), with lines from `shops.lines` (discounts spread by price, split shipments
  matched by their sums). `app` keeps them (`server/orders/`, `shop_charge`).
- **The morning sync** (09:00 in the book's zone, after the bank feeds) and **"Amazon wants you
  to log in again"** in Notifications (`server/shops.ts`, `server/orders/sync.ts`).
- **Tests:** `server/orders/orders.test.ts`, `services/shops/tests/test_lines.py` (pytest, now
  in `pnpm test`), `tests/e2e/src/orders.test.ts`.

**What Kael's first Sync now on `v0.1.23` will do to his book:** hand over the 112 charges read
since 2026-07-25; those on cards his accounts hold are itemized, and the bank's copies found are
sent back to review, even ones he categorized (his call); a charge whose bank copy isn't found
(a different amount, more than 5 days apart) is made as its own transaction, which could
duplicate a bank row that's there. The categorize chain asks the book's AI once per charge.
Worth choosing the book's cards (Include) on the Amazon page first. **Next:** Kael tries it;
then the plan's calls made without asking and its "Still open" (an Assign button, the book's
own cards as the default).

## Before that (2026-11-07): Amazon's spike proven on Emmer, `v0.1.22`

Kael asked for the Amazon login and order reading to be proven on Emmer
before anything else is built. **It is:** the server signed in to his Amazon and a sync read 112
charges and the 92 orders behind them, none failing ([the
plan](docs/milestones/.archived/amazon-orders/PLAN.md#proven-on-emmer-2026-11-07-v0122) has how, and what
the data holds). `v0.1.21` (released, and on Emmer) still met Amazon's bot check, now in the
sign-in itself, so **the sign-in moved into a full headless Chromium** that answers each page as
a person would (`shops.amazon.browser_sign_in`), sending a form Amazon's own script holds back as
a plain form, and ticking Amazon's "I am human" checkpoint, there and whenever reading meets it.
That was tried on Emmer by running the new code in its `shops` container (`docker exec` with
`PYTHONPATH`), three sign-ins in all; the session it signed in is kept there, so the next sync
needn't sign in. Released as `v0.1.22` and on Emmer. Don't sign in to Amazon from Emmer more
than needed: every try counts toward its bot score.

- **To see a sync on Emmer:** `ssh kael@emmer.local`, then `docker logs -t
  luminous-money-shops-1` (each step of the sign-in, and the page it stopped on is kept as
  `/data/shops/amazon/<book>/output/signin-failed.png` and `.html`, in the container).

## Before that (2026-11-07): `v0.1.21` after Kael's first try

Kael set his Amazon account up on Emmer (`v0.1.20`) and the first sync
timed out on Amazon's bot check, on its very first page. Probed from Emmer without his account
(see [the plan](docs/milestones/.archived/amazon-orders/PLAN.md#after-the-first-try-on-emmer-2026-11-07-v0121)):
Amazon challenges its home page but not its sign-in page, and amazon-orders' browser can't clear
a challenge it's handed the challenged session's cookies for. So `v0.1.21` passes over a
challenged home page (`shops.amazon.Session`), and adds Kael's other ask: **which charges are
the book's, by card** (include, exclude; no card at all is always kept).

The rest of this section is from the night before.

## The Amazon spike, released as `v0.1.20` (2026-11-06, night)

**Read this first.** Kael asked for Amazon's charges, and the items behind them, in his books
([the plan](docs/milestones/.archived/amazon-orders/PLAN.md): his brief, ten answers, and step 1 "as
built"). He chose the server logging in to Amazon as him, and asked for a spike: build it as if
it works, check it reaches Amazon from here, release it, upgrade Emmer, and he sets it up
there. **That's where it stands: `v0.1.20` is released and on Emmer, waiting for Kael to set
up his Amazon account** (Menu → Amazon). If it reads his orders, step 2 (orders in `app`,
matched and itemized) and tests for both come next; if Amazon won't let Emmer in, the plan's
other ways in (a browser extension, the data export) are the fallback.

- **`services/shops`** (new, Python): the book's Amazon connection (sealed with
  `SHOPS_ENCRYPTION_KEY`, else `AI_ENCRYPTION_KEY`), syncing in the background, the charges
  and orders read. Its README has the routes; design.md has "Shops: reading Amazon". It uses
  `amazon-orders[browser]`, so its image carries a headless Chromium (about 1.6 GB; the arm64
  build was tried here before release).
- **The PWA's Amazon page**: the account, Sync now with its step, the charges read. Writes
  nothing to the books.
- **Checked from here** with a made-up email: Amazon's real sign-in answer reaches the page.
  No tests (Kael's call, for the spike); `pnpm test` and `pnpm e2e` still pass.
- **To see what happened on Emmer:** `ssh kael@emmer.local`, then `docker logs -t
  luminous-money-shops-1` (it logs each step, never a secret).

`v0.1.20` also carries the change set below (it was committed first, on its own).

## Before that (2026-11-06, evening): backfilled escrow, Delete, the footer

Kael set his mortgage up with New loan (from the start) and found that the
backfilled payments, the ones before the paying account's books, carried no escrow, though
escrow's bills were backfilled. Changes followed (and a fix for System), released in
`v0.1.20`.

- **Backfilled payments carry escrow** (the loans plan's decision 7, changed by Kael): one due
  before the paying account's books begin is the whole payment, still from Opening Balances
  (`server/loan-payments.ts`: `beforeBooks` is gone). And New loan now stages escrow's bills
  *before* setting escrow to the lender's figure, so a bill already paid counts (it left escrow
  short by those bills, since the figure defaults to today). Tests: `server/loans.test.ts` (the
  early payment's escrow, the figure after a backfill, and a new one for a past bill) and
  `tests/e2e/src/loans.test.ts`.
- **Delete on a transaction's page** (Kael): for writers, asking first (the browser's confirm,
  saying so when a schedule wrote it or it's reconciled), against the version last read or
  saved (`useDeleteTransaction`). What `app` kept about its import stays, so a bank feed doesn't
  bring it back. Browser test in `tests/ui/src/m1.spec.ts`. design.md, under "The review app".
- **The footer is the brand** (Kael): the Lu logo and "Luminous Money", replacing "Early build ·
  nothing here touches real money yet".
- **Kael's own book was put right through the API** (at his request): the backfilled payments
  given their escrow and the escrow deposits he'd added by hand deleted, in one atomic change
  (no balance moved), and the bank's duplicate copies of the payments since checking took over
  deleted (each the same amount as its payment).
- **System crashed once a backup existed** (Kael, on Emmer): the ledger writes the backup's
  time as `…+00:00`, and `formatWhen` cut any stamp over 24 characters to 23 and added `Z` (for
  Python's microseconds), making `…+00:0Z`, which `Intl` refused with a `RangeError`. It now
  trims only the fraction, reads `Z` or an offset, takes a stamp without a zone as UTC, and
  shows one it can't read as it is (`web/lib/format.test.ts`).
- **Found on the way:** a book holding a lot of no shares with a cost (`0.00 X {0 # 0 USD}`)
  makes the ledger's `/problems` and `/query` 500 for the whole book (now in
  [M99](docs/milestones/m99-follow-ups/PLAN.md#bugs), Bugs).
  The PWA uses neither, so nothing in the UI shows it. Not fixed.

**Also next:** the zero-share lot (refuse it, and turn a
book that fails to load into a problem rather than a 500).

## Before that (2026-11-06): New loan is a questionnaire (Loans step 3)

Kael tried New loan and found it hard to follow, so it's been rebuilt as a
step-by-step questionnaire that makes nothing until Confirm ([the loans plan's step
3](docs/milestones/.archived/loans/PLAN.md#step-3-setting-a-loan-up-a-questionnaire): his brief, nine
answers, eleven calls made without asking, and "as built"). It's built, tested (`pnpm test`,
`pnpm e2e`, screens looked at) and **released as `v0.1.19`** (the tag on its commit), for Kael
to try on Emmer, where he does all his testing. Nothing is half done.

### What was done (2026-11-06)

- **Planned with Kael:** his brief (what was confusing, and the questionnaire he wanted), then
  nine questions answered: a home, a car or something else is asked with "what is this loan
  for?"; history is two choices (record each payment, or start from what's owed now) and a loan
  account that already owes is noticed; a new asset asks what it cost; counting as spending is
  opt-in, on the last page; escrow asks what it holds now; the escrow bills can be set up here,
  optionally; paid from defaults to a bank-linked account; the loan's page is only aligned; one
  step a screen.
- **New loan (Menu → Loans → New loan)** is now: what it's for → terms (and the table, to check)
  → extras (escrow, what it holds, its tax and insurance bills; PMI; anything else) → payments
  so far (only when some are due) → payment → check it over (where each part of the payment
  goes, every account changeable and marked new or in the books, what Confirm writes, what
  happens as payments come in, what to do later). Accounts are named from what it's for
  (`Liabilities:Loans:Mortgages:123-Main-St`, `Expenses:Financing:Interest:123-Main-St`,
  `Assets:Property:123-Main-St`, …). The answers are kept for the browser's session.
- **Confirm is one request:** `POST loans` takes a `setup` (accounts to open, the asset at its
  cost, escrow's balance, the bills, spending), all checked before anything is written.
- **The "month early" bug** was display only: due dates were formatted at UTC midnight in the
  browser's zone, so the 1st showed as the month before in Chicago. The payments were always
  right. Tables now show full dates.
- **The CSV and PDF imports and "already in the books" are off the UI,** their code kept.
- **The loan's page:** fixed dates, a "What to do when…" card, "Create account" for what it
  bought, and As spending suggesting `Expenses:Financing:Principal:<…>` with pickers.

### Done before (2026-11-05): Loans is out (both steps)

Loans is built and released: step 1 as **`v0.1.16`**, step 2 (outflows) as **`v0.1.17`**, and
**`v0.1.18`** (the tag on its commit) after Kael reviewed its 21 decisions: all kept but one, a
matched payment's difference now going to escrow rather than principal. 0.1.18 also makes
upgrades safe to stop (below). Emmer still runs 0.1.15 until Kael upgrades it.

- **Loans planned with Kael** ([the plan](docs/milestones/.archived/loans/PLAN.md): his brief, the model,
  "Decided with Kael"). Four answers: the books win and the table is where they start; the
  opening is against Opening Balances with the asset offered; step 1's dated changes are others'
  amounts, extra principal, the lender's statement and a new table; outflows are built now, as
  step 2.
- **Step 1, loans, built:** Menu → **Loans** → New loan: the accounts (what's owed, paid from,
  interest, optionally what it bought), the table (worked out from terms, a lender's CSV with its
  columns guessed, or a PDF or image read by the book's AI), what's paid with it (escrow, PMI,
  other), and its history (from the start, backfilled; from today; already in the books). A
  loan's page: what's owed and the next payment's parts, Pay extra, the lender's statement,
  dated changes, Escrow (its balance and the schedules paid from it, "+ A payment from escrow"),
  the payments ahead, Settings. The payment is an M3 schedule the loan keeps.
- **Step 2, outflows, built:** an asset or liability can **count as spending** (its editor's
  card, a loan's "As spending", or New loan's checkbox, on by default): what's paid into it is
  spending, as an expense account, and what it pays for (escrow's tax bill) isn't counted again.
  Budgets, home's "Spent this month" and Reports count outflows (the ledger's lens, one
  implementation); Reports has an **Outflows | Expenses** switch for the books as booked.
- **The 21 calls made without asking** (the plan's "Decisions to review") were put to Kael and
  all kept but number 6: with a match tolerance, the bank's different amount now goes to escrow
  (principal for a loan without escrow).

- **Emmer's upgrade to 0.1.17 hung** (Kael, 2026-11-05 20:19 to 20:39 Chicago time), and
  looked done after: `docker compose pull` sat for 17 minutes (dockerd: app, ai and auth, one
  Node base, all unpacking the same layer at once under Docker 29's containerd image store),
  Kael stopped it, and `upgrade` again said "Already on 0.1.17", since `.env` had been pinned
  before the pull while 0.1.15 still ran. Pulled one at a time, the same images took under a
  minute. Fixed in `scripts/luminous-money` (design.md, "Operating it"): images are pulled one
  at a time, before anything changes, and `upgrade` to the pinned version finishes one stopped
  after pinning (`behind`: running images against compose.yaml's). `cli-test.sh` covers the
  second. On Emmer, `.env`'s version was put back to 0.1.15 (what runs) and 0.1.18's images
  pulled one at a time, so its own 0.1.17 command (which still pulls all at once) finds them
  there. Its auto-upgrade (03:30) would otherwise have taken 0.1.18 that night.

### Done before (2026-11-03): Funds B step 1 (shares in funds), `v0.1.15`

- **Funds B is planned in steps, and step 1 is built** (Kael): [B's
  plan](docs/milestones/funds-b/PLAN.md) holds only step 1, now with "As built"; the rest of B is
  "to be continued after we've shipped non-USD assets in funds". B's old plan is now [the design
  record](docs/milestones/funds-b/design-record.md). design.md has "Funds B, step 1".
- **Shares in funds:** funds read a transaction **per commodity** (A's kind and cap for each
  commodity's balance-sheet units), so a trade is one fund's two lines (`Emergency -3000.00 USD;
  Emergency +10 VTI`), the same as A for every USD-only transaction. Move money takes several
  amounts, each in shares or dollars (turned into shares at the move's date's price). The Funds
  page and a fund's page list holdings with prices and values; Unallocated is worked out per
  commodity.
- **Default funds** (Kael's earlier idea, checked against its ten goals): a dated `custom
  "fund-default"` says what changes in an account with no line saying otherwise is a fund's; a
  line takes over its side. Kael's Roth and traditional IRAs are to be Retirement's this way. Set
  in an account's editor or beside a linked bank account, with a preview.
- **No fund goes below zero in a share by hand** (Kael): the ledger refuses it; what `app` writes
  by itself (`?staging=true`) is kept and, if it takes shares no fund has, listed as **short**:
  marked and first in Review (the only fund that holds enough suggested, Confirm waiting for a
  fund) and in the new **Notifications** page behind a bell beside the camera. A notification
  that waits on a condition is read from it, so a fix anywhere clears it.
- **The questions:** 30 answers from Kael are in the plan ("Decided with Kael"); 13 technical
  calls, and 7 places the build departed from the plan, are there for Kael to look over.

### Done before that (2026-11-02)

- **Funds A** ([its plan](docs/milestones/.archived/funds-a/PLAN.md), which now describes what was built;
  design.md, "Funds A"): a second ledger of funds beside the accounts, with no rules. A fund fills
  or drains only when a transaction says so (`funds:` lines: `+` into a fund, `-` out), or by a
  move between funds. Unallocated is net worth less every fund, never written. Funds hold
  dollars, kept with their commodity so shares can follow. Built over two sessions: the ledger
  and app server first, then the PWA, its tests, and a look at every screen on a phone and a
  desktop, light and dark.
- **A receipt that 504'd on Emmer** (Kael, 2026-11-03 00:53 UTC): reading it took about 76
  seconds (two Sonnet calls to read it, then an Opus call to categorize it) in one request, and
  Emmer's nginx gives up at 60, so the PWA showed a bare "504 Gateway Time-out". Now reading runs
  as a job (`Prefer: respond-async`, `server/jobs.ts`) the PWA asks after, showing its step; and
  failed responses are put in words (design.md, "Receipts and AI (M16)"). That receipt's
  transaction was most likely made anyway, after nginx gave up: it should be in Review.
- **Account lists are A–Z** in every selector (Kael), within their groups (design.md, under
  "Pickers offer only leaves…").

### What to do next

1. **Kael upgrades Emmer to 0.1.19** (`upgrade 0.1.19`), tries New loan, and looks over step
   3's "Calls made without asking" in the loans plan. Then he declares his mortgage through it: "record each payment" for the interest history (payments
   before checking's books began come from Opening Balances), or "start from what I owe now";
   what's in escrow from his latest statement; the tax and insurance bills there or later.
   Counting principal and escrow as spending is now off unless chosen on the last page.
2. **Kael sets his Fidelity accounts up in funds on Emmer** (0.1.15 is installed there): both
   IRAs' default fund Retirement, from their opening (the account editor, or beside each link on
   Bank connections); the brokerage divided among Wedding, Emergency, Special Home Maintenance
   and Repair, and Special Home Improvement with Move money from Unallocated; then whatever the
   bell has. Watch the first bank sync after: a sale or transfer out of shares that every fund
   holds should land in the bell, not fail.
3. **Kael looks over Funds B step 1's calls** ([B's plan](docs/milestones/funds-b/PLAN.md),
   "Decisions to review" and "Where the build departed from the plan"), and Funds A's (A's plan,
   "Decisions to review"), whenever suits.
4. Then the rest of Funds B (the [design record](docs/milestones/funds-b/design-record.md), and
   the 71 [scenarios](docs/milestones/funds-b/scenarios.md) with Kael; splits and corporate
   actions are waiting there, with how the bank feed books a split), or M18 (suggested
   recurring transactions and matching rules); see "Next steps" below.

### Working on it

- **New loan's code:** `services/app/src/web/lib/loan-setup.ts` holds the questionnaire but its
  screens (the draft, default names, each step's checks, what Confirm sends); the screens are
  `pages/LoanSetup.tsx`, `components/LoanSetupSteps.tsx` and `components/LoanConfirm.tsx`;
  the server's half is `setup` in `createLoan` (`server/loans.ts`).
- **Loans' code:** the engine is `services/app/src/shared/loans.ts` (shared with the PWA, so the
  form previews what the server stages); staging a loan's payments is
  `server/loan-payments.ts`, which `server/schedules.ts` hands a loan's occurrences to; the rest
  is `server/loans.ts` and `server/loan-read.ts`. The loans plan's "as built" sections map the
  screens and the API. A terms table sent without rows gets them worked out, which keeps API
  tests short. **Outflows** live in the ledger (`outflows.py`, `compact(lens="outflows")`, read
  by `budgets.status`); `app`'s reports pass the lens; the PWA's pieces are
  `web/components/Outflow.tsx` and Reports' switch.
- **Funds' code:** the rules live twice, `services/ledger/src/ledger/fundlines.py` and
  `services/app/src/shared/funds.ts` (same wording: per commodity, with default funds), so the
  PWA says what the ledger would; the PWA's rows and the line that follows the transaction are
  `web/lib/funds.ts`; the screens are `web/components/Funds.tsx`, `DefaultFund.tsx`,
  `NotificationsBell.tsx`, `web/pages/Funds.tsx`, `FundPage.tsx` and `Notifications.tsx`. A's
  plan and B's, "As built", map the rest.
- **Screenshots' results:** the `ui` container's `--rm` takes Playwright's `test-results` with
  it; mount a host folder at `/repo/tests/ui/test-results` to keep a failure's page snapshot.
- **Ledger tests without uv:** `cd services/ledger && docker run --rm -v "$PWD/src:/srv/src" -v
  "$PWD/tests:/srv/tests" -w /srv luminous-money/ledger:test pytest -q -p no:cacheprovider`.
  App units: `cd services/app && npx vitest run`; typechecks: `npx tsc -p tsconfig.web.json
  --noEmit` and `tsconfig.server.json`.
- **One end-to-end file at a time,** against the e2e stack (after `docker buildx bake default
  e2e ui-tests simplefin-fake`, and `docker compose -p luminous-money-e2e -f compose.yaml -f
  compose.e2e.yaml up -d --wait traefik auth ledger app ai mailpit simplefin-fake`), with the
  test sources mounted so edits need no rebuild: API, `… run --rm -v
  "$PWD/tests/e2e/src:/repo/tests/e2e/src" -w /repo/tests/e2e e2e node --test
  --experimental-strip-types --no-warnings=ExperimentalWarning src/funds.test.ts`; browser,
  `… run --rm -v "$PWD/tests/ui/src:/repo/tests/ui/src" -w /repo/tests/ui ui npx playwright
  test src/funds.spec.ts --reporter=line`. A change to the app itself needs `docker buildx
  bake app` and `… up -d --wait app`. Take the stack down (`… down --volumes`) before `pnpm
  e2e`, which wants it fresh.
- **Looking at screens:** a throwaway Playwright spec kept outside the repo and mounted into the
  same `ui` container (say at `/repo/tests/ui/src/shots`), which seeds a book through the API,
  then for each surface sets the viewport (390×844, 1280×900) and `page.emulateMedia({
  colorScheme })` and takes a full-page screenshot. In that image's fonts **bold renders as
  regular**, so screenshots don't show weights; a dialog's page shows below it in full-page
  shots.
- **Emmer** (the live server): `ssh kael@emmer.local` from the home network (no `emmer` alias
  here). The services are `luminous-money-<service>-1` (`docker logs -t …`); Traefik's access
  log is in the `traefik` container's output, and nginx sits in front of it (60-second read
  timeout). Reading logs is fine when Kael asks; the books there are his real data: don't read
  them.

### Also

- **M17 (tagging) is built and released as `v0.1.12`** (2026-10-29; see "Releases" below for
  its Release run): its [plan](docs/milestones/.archived/m17-transaction-tagging/PLAN.md) has the calls
  made without asking, design.md has "Tags (M17)". It needed ledger-graphs **0.1.2**
  (breakdown's `total` window), published from its own repository first.
- **The live server is at `https://luminous.money`** (Emmer, on 0.1.14; moved 2026-10-27).
  `luminous.money` is an ANAME for `emmer.kaelshipman.me` (an apex can't be a CNAME; name.com
  answers with Emmer's address, so it follows Emmer's dynamic DNS); `www`, `app` (the original
  system's) and `luminous.kaelshipman.me` redirect to it, and an app installed from the old
  address gets a service worker that removes itself, so it follows. The original system's
  other names were removed. ~/Setup has it all (`docs/emmer.md`, section 6). Upgrading it:
  `/srv/luminous-money/luminous-money upgrade` (it backs up first; a version is given without
  its `v`, `upgrade 0.1.14`, or left out for the latest). Kael's to run unless he asks: he asked
  for 0.1.14's, run 2026-11-03 02:57 UTC from 0.1.12 (its backups are in
  `/srv/luminous-money/backups`), all healthy after.
- **Fixed (2026-11-07, `v0.1.26`):** a linked brokerage opened with its lots at a $0.00 cost
  basis (Fidelity's `cost_basis` is always `0.00`); its `purchase_price` (the average cost) is
  used now, and Read again reopens a brokerage's lots with it.
- **Tags in rules, schedules, receipts and the AI are planned, not started:**
  [docs/milestones/tags-more/PLAN.md](docs/milestones/tags-more/PLAN.md) (2026-10-29). M17
  left them out on purpose. Schedules already carry a template's tags but have no field for
  them, and pairing a transfer drops its sides' tags. The plan's decisions await Kael.
- **Still open, not started:** a by-payee grouping in review, and whether imports and bank
  feeds ask the AI by themselves ([M99](docs/milestones/m99-follow-ups/PLAN.md)'s open
  questions).
- **Committing:** `git add -A -- . ':!docs/milestones/.archived/m16-receipt-capture/notes.md'` (never
  commit changes to that file; the private files are ignored), ending the message with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

### Standing rules for this repo (from Kael)

- The repo is public: no real financial data, personal emails, names or card digits.
- The dev stack holds Kael's real data: don't read it. Don't read `secrets.*.local.sh`. List the
  root `.env`'s key names only, never its values.
- Don't delete or move pushed tags.
- Releases: a `v*.*.*` tag runs the Release workflow; the CLI's `upgrade` installs it.

## State

**This is Luminous Money** (renamed from fava-beans on 2026-10-23, when it became the Luminous
Money product). The original Luminous Money attempt (`luminous-money/system` and its service
repositories) is archived on GitHub and kept locally in `../.archive/system`. Everything says
`luminous-money` now: packages (`@luminous-money/*`), images, the `luminous-money` command,
`LUMINOUS_MONEY_*` settings, the `lm_` token and cookie prefix, and the tombstone type
(`custom "luminous-money" "deleted"`). The dev databases were wiped for the rename. License:
GPL-2.0-or-later (Beancount is GPL-2.0-only). It wears the original app's look: its palette
(light gray and blue; deep blue and cyan in dark mode) and its Lu logo (design.md, "Its look").

**M1 through M17, Funds A, Funds B's step 1, Loans, Amazon orders and brokerage activity are
built** (M7, cross-book transactions, was dropped: books are independent).
M2 (credit cards, really "any account, and matching"), M3 (scheduled transactions), M4
(categorization), M5 (investments), M6 (multiple books), M8 (auth), M9 (SimpleFIN), M10 (chart of
accounts), M11 (budgets), M12 (reports), M13 (sharing books), M14 (reconciliation), M15 (divided
accounts), M16 (receipt capture) and M17 (tagging) are described in their plans, and so are the **chart of
accounts import** and **migrating from another system**, slipped in before M17 (2026-10-26).
**M19 (AI categorization) was built within M16** and is live; its PLAN.md entry was found
unchecked and corrected on 2026-10-26 (what's left is a question: whether imports and bank feeds
ask the AI by themselves). Their plans are in `docs/milestones/.archived/`. The milestones ahead
(the rest of Funds B, Tags more, split-level tags and funds, HSA tracking, M18, M20, and M99's
follow-ups) are in [docs/PLAN.md](docs/PLAN.md).

What an operator can do now (production readiness, phase 1; [docs/deploying.md](docs/deploying.md)):
`luminous-money install` sets a deployment up (a laptop, or a public server with built-in HTTPS),
then `status`, `upgrade` (backing up first), `backup` / `restore` (every database, the
attachments and the keys, online), `logs`, `report` (for bug reports, secrets hidden) and
`config`, and `auto-upgrade on|off` (a crontab line). Every service has `/health` and an image
healthcheck; `/api/health` is public for uptime monitors (with a domain, the certificate too).
A **private instance** (`LUMINOUS_MONEY_SERVICE_MODE=private`) lets only the emails in
`LUMINOUS_MONEY_ALLOWED_EMAILS` sign up; once they all have accounts, the login page says it's a
private instance instead of offering sign-up. Admins (`LUMINOUS_MONEY_ADMINS`, once their email is confirmed) see **System** in the menu:
versions, health, data, the last backup, and whether a newer release is out. **Published**
(2026-10-24) at [luminous-money/luminous-money](https://github.com/luminous-money/luminous-money):
a `v*.*.*` tag runs the Release workflow (the tests, then both architectures' images on
ghcr.io/luminous-money/luminous-money/<service>, then the release with its bundle). The first
release is **`v0.1.1`** (the `v0.1.0` tag was pushed before CI could build on GitHub: its runner's
builder didn't load images for e2e, and it has no release); **`v0.1.2`** finds the latest release
from github.com's redirect, not the API, whose 60-an-hour limit for an address had run out;
**`v0.1.3`** adds private instances (`LUMINOUS_MONEY_SERVICE_MODE`, `LUMINOUS_MONEY_ALLOWED_EMAILS`), and **`v0.1.4`**
`LUMINOUS_MONEY_SIMPLEFIN_MODE`; **`v0.1.5`** names them all `LUMINOUS_MONEY_*` (they were `LM_*`);
**`v0.1.10`** (2026-10-27) brings the chart of accounts import and migrating from another
system, **`v0.1.11`** what the AI costs, **`v0.1.12`** (2026-10-29) tags (M17) and the
migration's clearer word on what's kept, **`v0.1.13`** (2026-11-02) Funds A, and **`v0.1.14`**
(2026-11-02) receipts read in the background, plainer errors, and account lists A–Z, and
**`v0.1.15`** (2026-11-03) Funds B's step 1: shares in funds, default funds and Notifications, and
**`v0.1.16`** (2026-11-05) Loans' step 1, **`v0.1.17`** (2026-11-05) Loans' step 2,
outflows, and **`v0.1.18`** (2026-11-05) escrow taking up a matched payment's difference, and
upgrades that are safe to stop. The history was rewritten once before
the first push (an email taken out of RESUME), so commit IDs from before then are gone.

What a user can do now:
- **Loans (step 1):** Menu → **Loans** → **New loan**: name and lender; what's owed, what pays
  it, where interest goes, what it bought; the amortization table (**Work it out** from what was
  borrowed, the rate, the number of payments and the first payment's date; **Import a CSV**, its
  columns guessed and changeable; **Read a PDF or image** with the book's AI), previewed with
  any row that doesn't add up named; **Paid with it** (+ Escrow, + PMI, + Other: an amount to an
  account); and **Its history** when payments were due already: from the start (borrowed, then
  every payment, confirmed or not), from today (what's owed now), or already in the books. Its
  payments are staged as they come due (a schedule the loan keeps: review, matching the bank,
  auto-confirm), each the table's row while the books agree with it, else worked out from what
  the books say is owed. A loan's page: owed today, the next payment and its parts, when it's
  paid off and the interest still to pay; **Pay extra…** (toward principal); **Lender's
  statement** (what was owed on a day: the difference written so the books agree); **Changes**
  (an amount paid with it from a date, extra principal with each payment, a new table);
  **Escrow** (its balance, the schedules paid from it, + A payment from escrow); the payments
  ahead; **As spending**; **Settings** (accounts, tolerance, auto-confirm, pause, delete).
- **Outflows (Loans step 2):** an asset or liability's editor has **Counts as spending** (as an
  expense account): what's paid into it is spending, and the expenses paid out of it aren't
  counted again. A loan's page has **As spending** ("Count the payments as spending"), and New
  loan does it by default (principal as `<interest's parent>:<Loan>-Principal`, escrow as
  `-Escrow`). Budgets, home's "Spent this month" and Reports count outflows; Reports has an
  **Outflows | Expenses** switch (Expenses: the expense accounts as booked).
- **Shares in funds (Funds B step 1):** a fund holds cash and shares: Move money takes several
  amounts, each in shares or dollars; the Funds page and a fund's page list holdings with prices
  and values; a trade's Funds section (its page, review, the Trade page) has From fund and To
  fund. An asset or liability account can have a **default fund** from a day (its editor, or
  beside a linked bank account): what changes there with no fund chosen is that fund's. Nothing
  done by hand leaves a fund short of a share; a sale that came in by itself and takes shares no
  fund has waits, marked, first in Review and in **Notifications** (the bell beside the camera).
- **Funds (Funds A):** Menu → **Funds**: net worth, what's in funds, and Unallocated
  (everything that isn't in a fund, the house and retirement included); each fund's balance (red
  below zero), description and progress toward its target; **Move money** between funds
  (either can be Unallocated) and, for managers, **New fund**; archived funds folded below. A
  fund's page has its history (newest first, with a running balance; a move opens to change or
  delete it), Move money, and for managers Settings (name, description, target), Archive… (what's
  left goes to Unallocated or another fund, on a day) or Unarchive, and Delete (with no
  history). A transaction's page (and New transaction, and a schedule) has a **Funds** section:
  what it is ("$1,000.00 coming in"), a line per fund (To on money in, From on spending, For on
  a transfer, whose **More options** takes from funds too), "+ Another fund", and what it does
  to each fund, Unallocated included; more than the transaction is refused, and a fund taken
  below zero is noted. Review cards have a fund select (the whole amount), Select mode has
  **Fund…**, a rule's **Fund** puts what it imports toward (or takes it from) a fund, rows show
  chips ("to Emergency"), and home has a Funds card of the funds you starred (★ on a fund's
  page). Writers choose funds and move money;
  managers set funds up.
- **Tags (M17):** a transaction's page has **Tags** (type to add: suggestions from the book's
  tags, or a new one, made lowercase and dashed: "Trip to Italy" is `#trip-to-italy`; × removes
  one). Select mode (review, ledgers, Transactions) adds a tag to the selection (**Add tag…**) or
  removes one it has (**Remove tag…**). Rows and review cards show tags. The funnel on ledgers
  and Transactions filters by tags (every one chosen; `?tag=` in the URL); Reports has a tag
  filter at the top: cash flow, the breakdown (starting on **All time**) and the largest count
  only what's tagged, net worth is set aside, and "See them" opens Transactions filtered the
  same.
- **Receipts (M16):** Menu → AI turns a book's AI on (Claude, with an API key kept encrypted;
  itemize by default; whether the AI may open accounts, how eagerly, with what guidance). Once
  it's ready, the masthead's **camera** opens Capture receipt: the live camera (or Upload
  instead), the account it was paid from (the page you came from), Itemize?, and anything you
  know (total, date, payee, note). **Create transaction** reads it (what it says, then where its
  splits belong: rules, history, items bought before, then the AI; in the background, the button
  saying which step it's on, since it can take a minute or two) and lands on it in review;
  itemized, each line is a split with its own account to pick. Confirming or skipping goes back
  to where you were. The account that paid is the one holding the receipt's **card** (an asset
  or liability's editor lists its **Payment cards**: brand and last four), else the page you
  came from, else `Assets:Unknown`, which review asks to replace ("Paid from"). If it can't be
  read (AI off, down, or it failed), the transaction is made from what you typed, saying why
  (the review card and the transaction's page show its **Receipt:** note). **A receipt for a
  purchase already here** (the bank's copy: the paying account, exactly its amount, within 5
  days) is read into that instead of making a second, which goes back to review even if it was
  confirmed. **Read receipt** on a transaction's page reads a photo or PDF it holds into it
  (its amount kept as the total). **Attachments:** any transaction's page has them (Open
  camera, or Upload), new transactions too. The server keeps every image as browsers show it:
  an iPhone's HEIC becomes a JPEG (at most 2,000 px a side), as does any image over 5 MB.
- **Split flags (M16):** what's proposed and not yet confirmed is marked on the split (`!` on
  the posting): imports stage their categorized side that way, choosing an account yourself or
  confirming clears it, and Suggest categories and rules act on what's still flagged.
- **Divided accounts (M15):** an asset or liability account's editor has **Divide…**: name the
  main part (where new money lands, and what's left) and the others with what they start with;
  the account keeps its name, bank link, statements and history (now its main part's). Its page
  shows the **Parts** (balances, shares, any below zero, **Move money**), its ledger says which
  part each transaction touched ("General → Padding" for a move), and its home card shows the
  parts as a stacked line. Bank feeds and files land in the main part (a rule's **Lands in** can
  send what it matches to another), matching looks across all the parts, and the whole still
  reconciles with the bank. "Paid from: General ▾" in review and on a transaction's page moves
  it to another part.
- **Reconciliation (M14):** an asset or liability account's page has **Reconcile**: the
  statement's date and ending balance (prefilled from the bank, or the last imported file's
  balance column), its unreconciled transactions to tick (imported ones and the opening balance
  start ticked), and the difference pinned below. **Finish** once it's zero (ticked unconfirmed
  ones are confirmed; nothing's date changes, and what isn't ticked stays outstanding); **Save for later** keeps it for
  any device; past statements with **Undo** on the latest. Ledgers mark reconciled transactions
  ✓ and say "Reconciled through …" or "Off by … since …"; every ledger (and Transactions) has a
  **filter** (Reconciliation: all, reconciled, not), and Select mode's **Select all** takes
  what's shown. Editing a reconciled transaction asks first. A **divided account** (the editor:
  an asset or liability node that's one real account its sub-accounts divide) reconciles as one.
  Bank-fed accounts say "Matches the bank ✓" or "Off from the bank by … since …", and reconcile
  themselves after a sync once everything's confirmed and agrees. An imported file with a
  balance column says whether the books agree with it.
- **Sharing (M13):** Manage books → Share: invite someone by link (can view, edit or manage;
  copy or share it), see who has the book, change roles, remove people, withdraw invitations.
  Whoever opens the link and accepts gets the book (a shared one says "Shared with you · Can
  edit"); anyone can Leave. A book you can only view says so, and its editing is hidden.
- **Reports (M12):** home's "Spent this month" (the month's spending by day against the budget,
  and what 85% of months stay under), then recent transactions (every account's), whose title
  opens **Transactions** (the whole journal, paged, "Go to date", searched, and filtered by
  accounts, tags and reconciliation). **Reports** (menu): cash flow,
  a breakdown to drill into, this month's largest, net worth. An expense or income account's
  page shows what its weeks, months and years typically come to.
- **Budgets (M11):** Menu → Budgets: one card by type, each budgeted account (and those above
  it) with a filled line, "$88 left · 12 days left", and what's unconfirmed; a budgeted node
  with budgets under it shows its Other. Tap a row to set or change its budget (amount, period:
  weekly to yearly or every N of a unit, applies from); "+ Add" for any account; "Per month"
  restates them all. The account's ledger shows its budget line; its editor has a Budget card;
  home shows this month against the top-level expense budgets. "Exclude from budget" on a
  transaction (review, or its page) keeps it out of budgets only. Manage books sets the day
  weeks start.
- **Transfers in review:** money out of one account and the same into another within 7 days,
  both imported, are paired into one transfer (after every import or sync), shown with what it
  was made of; "Reject" brings the two back and they're not paired again.
- **What the AI costs** (2026-10-26): each operation says what its AI calls cost after it
  runs (Select mode's Suggest categories note, review after a receipt is read, a migration's
  suggestions), the AI page shows **This month** (about $… so far, by operation), and the `ai`
  service logs every call's tokens and estimated cost (`luminous-money logs ai`). Estimates at
  list prices (`services/ai/src/pricing.ts`); the Claude Console has the bill.
- **Migrating from another system** (2026-10-26): setup's second step and Accounts offer
  **Migrate** (to managers, until it's done once; existing books too). From GnuCash's two
  exports: the **accounts** (the import below, with an old bank or card account "Same as" one
  here, or left out), the **history** (kept for categorizing, never added: GnuCash's
  transactions, accounts mapped), **bank feeds** (the Bank connections panel; it waits if
  SimpleFIN needs another day), the **AI** (its panel), the **reference** (the history by payee
  for the AI: shown, then Use it), **rules** (payees 90% one account, tick and Add), and
  **suggestions** for everything uncategorized (in the background, with progress), then Review.
  Progress is kept: leave and come back from Accounts. The history categorizer learns from the
  imported history (after the book's own), and the AI gets the reference from then on.
- **Importing a chart of accounts** (2026-10-26): Accounts → **Import**: a CSV with an Account
  column (full names) and any of Display name, Description, Opening balance with As of, Currency,
  Opened, Booking and Revalue every. The preview shows each name as it will be (title-cased,
  spaces as dashes: `expenses:dining out` is `Expenses:Dining-Out`), which rows hold others
  (nodes), what's already here (left alone) and which rows can't be added and why; **Add N
  accounts** opens them in one write. Accounts have a **Description** now (the editor's Name
  card, shown under the name). Every name the app makes from words is title-cased the same way,
  typing in the name field included (`Coffee-Shops`, `Gifts-and-Giving`). GnuCash's account tree
  export works as it comes (types, placeholders, hidden accounts, its own accounts left out).
- **Accounts (M10):** Menu → Accounts: one card, the tree by type, tap a node to open or close
  it, balances rolled up (one figure each), Find, "Show archived". A node's › opens its editor
  (with "Add an account under it"); a leaf opens its ledger, whose Edit opens the same editor:
  names (display and full: rename or move), an asset's settings (lots, revaluing), archive (with an optional closing
  transfer), delete or merge into another account, or delete it with all its transactions (a red
  notice first lists every other account that changes). System accounts are protected.
- **Bank feeds (M9):** Menu → Bank connections: paste a SimpleFIN Bridge setup token, then link
  each bank account (new, or an existing one reconciled with the bank as the source of truth;
  also "start over" and "from a date"). The history comes in the background; confirm from the
  preview. New transactions arrive each morning (or "Sync now") into review. Synced accounts
  show "Reported today 6:00am: $…"; yours the bank doesn't have are "Not at the bank" in
  review. Brokerages (Fidelity) bring holdings, prices and position changes.
- **Accounts (M8):** anyone creates one (name, email, a 15+ character password not known from
  breaches) and logs in on any number of devices; "Forgot password?" emails a reset link when
  the server has mail. **Your account:** name and email (confirmed by emailed link), password,
  devices (log any out, or everywhere else), API tokens for scripts, and deleting it all.
- **Set up:** name a book, then add an account by its full name (autofill, Tab to complete),
  optionally with its balance on a date from a statement.
- **Home** shows the user's **starred** accounts as cards: balance (a card's shown as what's
  owed) and when each was last updated by an import, plus "Import transactions" and "Add an
  account" (added accounts are starred).
- **Books (M6):** the selected book is the context for everything, and it's in the URL
  (`/books/:book/…`); `/` opens the last book used on this device.
  - The masthead's **book switcher** lists your books and Manage books.
  - **Manage books:** create a book (empty, or from a Beancount file such as an export), open,
    rename, export, set the time zone, and delete (type the name; Export offered). Names are
    unique per user.
- **Menu:** the book's Home, Review, Transactions, Accounts, Budgets, Funds, Reports, Schedules,
  Rules, Commodities, Bank connections and AI; Manage books; Your account; Log out. Every list of
  accounts to choose from is A–Z (within its groups).
- **Schedules:** a transaction plus a rule (every N days/weeks/months/years, days of the month,
  weekends moved or kept, an optional end), made new or with "Repeat…" on any transaction.
  - Due occurrences are staged (at startup, after saves, and daily after midnight in the book's
    time zone) as unconfirmed transactions, or confirmed if the schedule confirms automatically;
    marked ↻ in ledgers, and matched by imports like any transaction.
  - Each split can have a match tolerance: the bank's amount within it matches, and wins on
    confirm.
  - "Not this time" in review drops an occurrence for good; editing a schedule restages its
    unconfirmed occurrences from today.
  - The Schedules page lists them and what's coming in 16 days; ledgers show what's coming as
    grayed rows with a projected balance.
- **Manage books** also sets each book's time zone (new books take the browser's).
- **An account's ledger:**
  - newest first, 200 a page, with infinite scroll; "Go to date" for a partial view from that
    date back, with "Load more" above for newer pages; running balances, and the other account or
    `<multiple>`; liabilities and income shown inverted, colored by their effect on net worth
  - a star toggle (home page), "Import transactions", and the add line above the transactions
  - tapping a transaction opens the editor, whose Back and Save stay pinned on screen
- **Import a CSV** into any open leaf account (starred listed first):
  - the first file is profiled (columns mapped, guessed and confirmed), and later files just
    import; a file that fits none of the saved formats asks first, then replaces them or adds one
  - duplicates, rows up to the opening balance's date, and unreadable rows are skipped
  - **rows that are the same event as a transaction already in the account match it** (same
    amount, ±5 days, not already held by this account's imports): nothing is added. So a
    payment categorized to the card on checking's import is recognized by the card's import, and
    hand-entered transactions are reconciled
  - the rest are staged for review, uncategorized
- **Review:** unconfirmed transactions (skip, categorize, confirm, swipe, create accounts, tag)
  and proposed matches: confirm, "Match with this instead", "Swap" (with the row holding a
  candidate), or "Not a match" (stages the row on its own). A search (payees, descriptions,
  items) and a filter by accounts and tags narrow it; Back from a transaction comes back to
  the same place.
- **Categorization (M4):** imported rows are staged with a proposed category and clean payee:
  from the user's **rules** (Rules page; can confirm automatically), from **history** (what the
  same payee was confirmed as), or from **external providers** (`CATEGORIZERS`, speaking
  [our API](docs/categorizer-api.md)). Review shows where each came from; "Also categorize N
  similar", "Remember as a rule…" and Select mode (Suggest categories) speed it up. Acceptance
  per categorizer shows on the Rules page.
- **Select mode** (review, account ledgers and Transactions): a sticky bar with **Actions ▾**
  (Confirm, Categorize as…, Add tag…, Remove tag…, Fund…, Suggest categories: rules, history and
  the book's AI), Select all
  and Done; tap anywhere on a card or row to select. Suggest categories is only a bulk action
  now (the old button, rules and history alone, seemed to do nothing).
- **Investments (M5):** starred brokerages and holdings show **value, unrealized gain** and how
  fresh their prices are; account pages list **holdings** (lots, Update price) and **Trade**
  (buy, sell with a lot preview and short/long-term gains, dividends); houses and cars are
  **revalued** (Update value, every 350 days); **Commodities** shows prices and their sources.
  Prices are fetched each morning (beanprice). Accounts can open with holdings.

How it's put together:
- **`services/auth`** (TypeScript): users and identities (passwords now, OIDC later), Argon2id,
  10-minute Ed25519 access tokens with rotating refresh tokens (HttpOnly cookies in the browser),
  API tokens, email links, the operator's CLI (`dist/cli.js`), and `/verify` for Traefik's
  forwardAuth, which guards every other API and sets `X-User-Id`.
- **`services/ledger`** (Python): the system of record.
  - Books are owned by users and named by their `option "title"`.
  - Accounts with optional opening balances and holdings; summaries (balances, `as_of`,
    value, gain) and account ledgers computed with SQL; subtrees for brokerages.
  - Investments (`investments.py`): prices, valuation, account-scoped booking for cost basis,
    holdings, trades, revaluation, beanprice fetching.
  - Funds (`funds.py`, `fundlines.py`, Funds A): the funds list with net worth and
    Unallocated, setup, renames, archiving, history, moves, and the checks on a transaction's
    lines (only when they change).
  - Versioned PATCH edits, batch writes, atomic create-and-delete (`/transactions/changes`),
    migrations, backups and export.
- **`services/app`** (TypeScript): the PWA, plus stars, CSV profiles, imports, the pipeline
  (`src/server/pipeline`: matcher, then assignment), match review (`src/server/matches.ts`) and
  schedules (`src/shared/schedule.ts` for rules, `src/server/schedules.ts` for the generator), and
  categorization (`src/server/categorize`: the chain, context, `rules`, `history`, external
  providers; the external API's types in `src/shared/categorizer-api.ts`), funds (the rules in
  `src/shared/funds.ts`, a rule's fund on what it stages in `src/server/funds.ts`), and loans
  (the engine in `src/shared/loans.ts`, `src/server/loans.ts` and `loan-payments.ts`), in
  `app.sqlite`.
- **`services/ai`** (TypeScript, M16): each book's AI settings and sealed credential
  (`ai.sqlite`), the providers (`src/providers`: `claude`, and `fake` for test stacks, chosen
  by `AI_PROVIDERS`), and three operations: `receipts/extract` (a receipt's facts; Claude Sonnet
  5), `categorize` (where splits belong; Claude Opus 5) and `loans/extract` (a lender's
  amortization schedule's rows; the extract model, Loans). It answers; `app` composes and stages
  (`src/server/receipts.ts`, the chain in `src/server/categorize`, its AI step `ai.ts`; reading
  runs as a background job when asked, `src/server/jobs.ts`), and the ledger keeps the files
  (attachments, migration 10). Their shared types are `packages/ai-api`.
- **Migrating** (`services/app/src/server/migrate`): `store.ts` (progress, imported history),
  `gnucash.ts` (the transactions export), `reference.ts` (the derived reference, its entries for
  a batch, rule suggestions), `suggest.ts` (the background suggestions), `routes.ts`; the chart
  planner is `src/shared/chart.ts`, names `src/shared/names.ts`; the page is
  `src/web/pages/Migrate.tsx`.
- **Deploying:** `deploy/gateway` (the gateway image: Traefik pinned, the routes, its static
  config written at start by `entrypoint.sh`), `deploy/env.example`, `scripts/luminous-money` (the
  operator's command; its test is `scripts/cli-test.sh`), `ledger.snapshot` (whole-system
  backup and restore), and `.github/workflows` (CI; a release on a `v*` tag).
- **`packages/db`** (TypeScript migrations and timestamps, the sealer, `health`, with a lint check) and
  **`packages/csv-import`** (parsing, guessing profiles, reading rows; shared by the browser and
  the server).
- **Tests, all passing:**
  - `pnpm test`:
    - ledger: 258 tests, including the table lint
    - auth: 24; app: 329; ai: 15; db: 10; csv-import: 22
    - plus the client drift check, typechecks and Prettier
  - `pnpm e2e`: 114 API tests and 135 browser tests (with Mailpit, a fake SimpleFIN server and
    the fake AI provider), then the `luminous-money` command's test (`pnpm test:cli` alone)
- **The local dev stack** (`docker compose up -d`) runs on `http://localhost:8080`, without
  mail. Its `.env` (not committed: its keys) sets `LUMINOUS_MONEY_SIMPLEFIN_MODE=on-demand`, so it never
  syncs bank feeds by itself: Kael's live server holds the same SimpleFIN connection, and its
  requests are limited. Kael's account claimed the old stub user, so it owns the "Demo"
  book (checking, card and ETrade brokerage starred) and "Demo Household" (joint checking).

## Next steps

1. **The first live deployment, on Emmer,** is up at `https://luminous.money` (since
   2026-10-27; see "Also" above), on 0.1.14, with Kael's real bank feed. Kael's ~/Setup has it (`scripts/emmer/65_luminous-money.sh`, with
   `LM_SOURCE=release`: the installer on 127.0.0.1:8080 behind Emmer's nginx, which has the
   certificate; then `70_dns.sh` and `80_web.sh`). The release's five images must be public on
   ghcr.io (a package's settings, once each) for an install to pull them.
2. **Kael migrates the live book on Emmer** (once released): Accounts → Migrate, with GnuCash's
   two exports. Real Claude calls run there now (receipts, 2026-11-03: reading one and
   categorizing it took about 76 seconds, hence background jobs), but none with a reference
   yet; watch the first suggestions' quality and `docker compose logs ai`. Not built from the
   proposal: a by-payee view in review (categorize a payee's group at once).
3. **Loans is out** (`v0.1.16` to `v0.1.18`, [its plan](docs/milestones/.archived/loans/PLAN.md)); Kael
   declares his mortgage on Emmer. **Funds B's step 1 is out** (`v0.1.15`); Kael sets his
   Fidelity accounts up in funds. Then the rest of B (where a loan is grouped with its asset) or
   M18 (suggested recurring transactions and matching rules).
4. Later, not pressing: [M99: Follow-ups](docs/milestones/m99-follow-ups/PLAN.md) (email,
   ownership transfer, the rest of M8's auth questions, and the rest of what's left over).

## The ledger-graphs libraries

- **The app depends on them from npm** (`@luminous-money/ledger-graphs-api` and `-ui`, `^0.1.2`).
  Their home is [luminous-money/ledger-graphs](https://github.com/luminous-money/ledger-graphs)
  (public, ISC; `libs/api`, `libs/ui`; CI on every push). Local clone:
  `~/Repos/luminous-money/ledger-graphs`.
- **Changing them:** change and test them there, then `pnpm release <version>` there. The `v*`
  tag runs its Publish workflow, which publishes by npm's trusted publishing (OIDC: no token,
  with provenance). Then bump the version here.
- **`minimumReleaseAgeExclude: '@luminous-money/*'`** (pnpm-workspace.yaml) lets a fresh
  release install here at once.

## Gotchas

- **After `pnpm generate`, rebuild the client before a local typecheck** (`pnpm --filter
  @luminous-money/ledger-client build`): the services read its built `dist` types, so they see
  the old API until then. (`pnpm test` builds it in Docker.)
- **Tags live in the transaction's text; `transaction_tag` is derived** (written by
  `store.put`, like `posting`). Change tags through the transaction, never the table. Fund
  lines are the same: `funds:` in the text, `fund_line` derived.
- **A fund's lines are checked only when they change** (`fundlines.checked` compares with the
  stored ones), so recategorizing, pairing or matching can't fail on a fund; the transaction
  page says when saved lines no longer fit, and saves the rest. Fund names match ignoring case,
  are kept as their fund is named, can't hold `; " \ /`, and are never Unallocated.
- **Links are accent-colored by one rule** (`main a:not(.button):not(.card)…` in `styles.css`):
  a link styled as a row (budget rows, the largest, home's fund rows) has to be added to its
  `:not()` list, or it comes out blue whatever its own rule says.

- **Behind a TLS proxy, session cookies are `__Host-lm_access` / `__Secure-lm_refresh`;** on
  plain HTTP, `lm_access` / `lm_refresh`. auth reads either (prefixed first), because a request
  may not say it came over HTTPS: until 0.1.9, Traefik's forwardAuth asked `/verify` with
  `X-Forwarded-Proto: http`, so every session-checked call was 401 behind nginx (log in, then
  the login form again). forwardAuth now has `trustForwardHeader` too, and the API suite logs
  in behind a stand-in proxy (`X-Forwarded-Proto: https`) with cookies.

- **Release images get one `node_modules`, installed on the amd64 runner,** for both
  architectures (the shared `workspace` stage isn't built per platform). So native packages
  need every platform's binaries: `supportedArchitectures` in pnpm-workspace.yaml (linux x64 and
  arm64, glibc). Without it, 0.1.7's arm64 `app` had only x64's sharp and crash-looped on a Pi.
  The release checks `require('sharp')` on both before it tags `latest`.

- **A dialog is a portal, and React carries a portal's events up the React tree:** a form in one
  (Create account) submitted the form its picker sat in (a transaction's editor) as well, until
  2026-10-26. A form in a portal stops its submit's propagation.
- **Anything that can take more than ~30 seconds runs as a job** (`Prefer: respond-async`,
  `server/jobs.ts`; the PWA's `awaited` in `web/lib/appApi.ts` asks after it): a proxy in front
  of the app may cut a request off (Emmer's nginx at 60 seconds). Receipts do; jobs are in
  memory, so a restart loses them, and the PWA says the work may have finished.
- **AI prices are a table** (`services/ai/src/pricing.ts`, from platform.claude.com's pricing
  page, 2026-10-26): a new model, or a price change, needs a line there. Without one, its calls
  show as "an unknown amount" (and the month's total too) rather than a wrong figure.
- **The reference isn't stored:** `migrate/reference.ts` works it out from the imported history
  and the book's own each time (Suggest categories, receipts, the migration's pages). Don't add
  a table for it; it would go stale.

- **Reconciliation's marks belong to reconciling:** the ledger keeps a posting's `reconciled:`
  through JSON edits and strips it from new transactions (`service._marked`). Write marks only
  through `reconcile.py`.
- **Statements hold by marks, not dates:** a statement is a `custom "statement"` directive, not
  a `balance` assertion, so Beancount doesn't check it; `reconcile._history` does (what's
  reconciled with it and before). Don't turn statements back into `balance` directives: a
  transfer two banks date apart can't satisfy both sides by date.
- **Loans and withheld taxes:** how to record them is in [docs/loans-and-taxes.md](docs/loans-and-taxes.md).
- **The command's test failed once at sign-up** (2026-10-29: a 422 from `/signup` in
  `scripts/cli-test.sh`) and passed on the rerun with nothing changed: rerun it before digging.
- **The first browser tests of a cold e2e stack** can time out waiting for review to load (seen
  once, 2026-10-17: three of accounts.spec, passing on a rerun). m1.spec's "a file in another
  layout" failed now and then (no import results) until 2026-10-23: a file chosen before the
  account's CSV layouts had loaded was profiled as if it had none. Import now offers the file
  picker only once they have. m3.spec's time zone raced
  the PWA giving a new book the browser's zone in the background; the test now waits for it.

- **Fetching prices needs the network** (beanprice's sources: Yahoo and friends, which change
  now and then). A commodity's source is its `commodity` directive's `price:` metadata;
  `ledger.price_sources.fixed` is a no-network source for tests and demos.
- **The morning price run only covers books with a time zone,** since that records who it acts
  as. Every book gets one: on creation, by `pnpm seed`, or (older books) the browser's the first
  time the PWA loads them.

- **`pnpm up` is pnpm's own `update` command,** not the `up` script: it bumps dependencies. Use
  `pnpm run up` (foreground), or `docker buildx bake && docker compose up -d`.
- **Account names are what `app` keys its data by.** Rename, archive and delete accounts through
  `app` (`/api/app/v1/books/:book/accounts/:account/...`), not the ledger directly, or stars,
  profiles, rules, schedules and bank links are left pointing at the old name.
- **SimpleFIN's budget:** about 24 requests a day per connection at the Bridge; the app stops at
  20 (UTC days). Linking a long history takes several; "Sync now" takes one or two.
- **The dev stack needs `SIMPLEFIN_ENCRYPTION_KEY` and `AI_ENCRYPTION_KEY`** (app and ai won't
  start without them): they're in the repo root's `.env` (gitignored), which Compose reads. Keep
  them: stored SimpleFIN connections and AI keys can't be opened without them.
- **A form waits for the data its pickers need** (Import's file picker for the account's CSV
  layouts, the transaction editor for the chart): offered too early, a file is profiled as if the
  account had none, and a typed account name finds nothing, so Enter offers to create it. Both
  were the e2e suite's occasional failures under load. So was a third (m1's "The blank amount
  will be $4.50", until 2026-10-26): New transaction made its draft on every render, and the
  splits editor starts over when its postings change, so any refetch (the chart's, after making
  an account on the way, or on returning to the app) wiped what had been typed. Give an editor
  a draft that's made once.
- **`pnpm e2e` keeps the browser failures' traces and page snapshots** in `tests/ui/test-results`
  (`pnpm exec playwright show-trace <trace.zip>` there).
- **Colors are variables** (`--accent`, `--accent-soft`, `--on-accent`, `--paper`, `--card`,
  `--ink`, `--muted`, `--line`, `--good`, `--bad` in `styles.css`, light and dark): use them, not
  hex values, and put text on the accent in `--on-accent` (it's dark on the dark mode's cyan).
- **The PNG icons come from `services/app/public/icon.svg`:** after changing it, `pnpm icons`.
- **The gateway's routes are inside its image** (`deploy/gateway/routes.yml`): after changing
  them, `docker buildx bake gateway` (or `pnpm build`) and `docker compose up -d`. Its static
  config is written at start from the environment, so edit `entrypoint.sh`, not a YAML file.
- **The HTTPS port is random without a domain** (`LUMINOUS_MONEY_HTTPS_PORT` unset): nothing
  listens on it then, and two stacks on one machine don't collide.
- **A confirmed transaction has no split flags:** the ledger drops them on any `*` write
  (`engine.confirmed`), and `FakeLedger` does the same, so tests see what production does.
  Don't confirm by editing text if the flags matter: text keeps what it says.
- **The AI never breaks a flow; it says why it didn't help.** A failed call (no credit, a bad
  key, an unknown model) becomes the reason in a receipt's note (shown on its review card and its transaction page,
  `ReceiptNote`) or Suggest categories' note, and
  a line in `docker compose logs ai`. Real Claude calls haven't been exercised in tests (no key
  in the repo): the first real ones are Kael's.
- **Claude's models are set per operation:** `AI_CLAUDE_EXTRACT_MODEL` (default
  `claude-sonnet-5`) and `AI_CLAUDE_CATEGORIZE_MODEL` (default `claude-opus-5`); the old
  `AI_CLAUDE_MODEL` is gone. The server-side refusal fallback is only sent for Opus 5 and Fable
  5 models.
- **Receipts need the `ai` service:** without it (or a book that isn't ready) the camera isn't
  offered, and `app`'s receipt route still makes the transaction from the hints. Test stacks
  offer the `fake` provider (`AI_PROVIDERS=claude,fake`); production only `claude`.
- **`auth` and `app` read settings through `@wymp/config-simple`** (`src/config.ts`, plus
  `.env/<APP_ENV>` files in each service). Its `configValue` reads a third argument that's an
  array as validators, not a default: give list defaults as a string and split them.
- **Auth keeps its signing keys in `auth.sqlite`;** `AUTH_JWT_SECRET` is gone (auth warns if
  it's still set). Wiping the volume logs everyone out, as well as deleting them.
- **`LUMINOUS_MONEY_PUBLIC_URL` must be the address users reach,** when set: `auth` refuses writes
  from any other origin (so a LAN IP and a hostname can't both be used).
- **The host's Node may be older than the images' (24).** `auth`'s unit tests need Node 24
  (built-in Argon2id); `pnpm test` runs them in Docker, or run
  `docker run --rm -v "$PWD":"$PWD" -w "$PWD/services/auth" node:24-slim npx vitest run`.
- **The dev stack has no test logins:** compose doesn't pass `AUTH_TEST_USERS` through, and
  only `APP_ENV=test` turns it on. To poke at the UI (or take screenshots) without touching the
  dev stack's data, start the e2e stack under its own project, `docker compose -p
  luminous-money-e2e -f compose.yaml -f compose.e2e.yaml up -d traefik auth ledger app ai mailpit
  simplefin-fake`, and run Playwright (the `mcr.microsoft.com/playwright:v1.63.0-noble` image)
  on its network, `luminous-money-e2e_default`, at `http://traefik`. `pnpm e2e` tears it down.
- **A mutation's per-call `onSuccess` doesn't run if its component unmounted first,** and a
  hook-level `onSuccess` that returns an invalidation is awaited before it: a form keyed on
  what that refetch changes is gone by then. Await `mutateAsync` instead (Reconcile's Finish,
  the account editor's names).
- **The PWA's URLs keep account names' colons** (`/accounts/Assets:Bank:Checking`): browser
  tests compare decoded paths, not `encodeURIComponent`'s.
- **An effect must return a function or nothing:** `useEffect(() => cond && set(x))` returns
  `false`, which React later calls as a cleanup ("l is not a function" in production). So does
  `useLayoutEffect(() => window.scrollTo(0, 0))` in current Chromium, whose `scrollTo` returns a
  promise: the whole app went blank on leaving the page (2026-11-07). Give effects a block body.
- **`pnpm seed` skips a book that already exists,** because the demo gets new IDs on every run
  and importing twice would duplicate everything. Pass another book ID for a fresh one.
- **Databases from before a service's migrations are refused** with a message to recreate them
  (`docker compose down -v`). No real data exists yet, so there's no backfill.
- **All services share the data volume as UID 1000.** A volume created by an older, root-owned
  image needs `docker compose down -v` once.
- **Playwright is pinned to 1.63.0** in `tests/ui/package.json` and in `node.Dockerfile`'s `ui`
  stage. They must match, because the image's preinstalled browsers belong to that version.
- **Beancount 3.2's `extra_validations` leaks:** each load appends them to a global list. Run
  extra checks after loading instead (see `engine.load`).
- **`openapi-typescript` treats fields with defaults as required,** so the generated request
  types ask for `flag` and `narration` even though the API defaults them.
- **TypeScript is pinned to 5.x.** `openapi-typescript` needs the TypeScript 5 compiler API.
- **`node:sqlite` is still experimental in Node 24;** its warning is silenced in the service images.
- **pnpm 11 checks the lockfile against a supply-chain policy, which needs registry access.**
  That's why `node.Dockerfile` installs with `--prefer-offline`, not `--offline`.
- **Swarm hasn't been exercised for real.** `docker stack config -c compose.yaml` accepts the
  file.
- **Text endpoints need `beancount()` with openapi-fetch.** The app should prefer the JSON
  endpoints.

## Verify

```sh
pnpm test                 # unit tests, contract drift, typechecks, formatting, lint
pnpm e2e                  # whole stack, end to end (API, browser, the luminous-money command)
docker compose up -d      # then open http://localhost:8080/ and log in
```
