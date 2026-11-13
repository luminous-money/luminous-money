Amazon orders: plan
==================================================================================================

> **Status (2026-11-07): built.** Step 1 (the spike) was proven on Emmer in `v0.1.22`: the
> server signed in to Kael's Amazon and read 112 charges and all 92 orders behind them ([as
> built](#step-1-the-spike-as-built-2026-11-06), [after the first
> try](#after-the-first-try-on-emmer-2026-11-07-v0121), [proven](#proven-on-emmer-2026-11-07-v0122)).
> Steps 2 and 3 followed ([as built](#steps-2-and-3-as-built-2026-11-07)): each charge is
> itemized into the book as a receipt (Kael), and the morning sync and the login notification
> are in. For Kael to try on Emmer. Before them: Kael's brief, what's already here, the ways
> Amazon's data could come in, then [Decided with Kael](#decided-with-kael-2026-11-06).
> [Still open](#still-open) has what's left to ask.

## The brief (Kael, 2026-11-06)

- **Amazon charges are opaque.** Every one could be any number of things: the bank's row says
  "AMAZON MKTPL" and an amount, nothing about what was bought.
- **Pull Amazon's invoices in automatically,** match them against the bank's and the cards'
  transactions by date and amount, then **run the AI itemizer on them,** so each charge
  becomes its items, each in its category.

## What's already here

Almost everything after the data arrives (design.md, "Receipts and AI (M16)" and "Split flags
and categorizing splits (M16)"):

- **A receipt for a purchase already in the books is read into it:** the matcher looks in the
  paying account (named by the card's last four) for exactly the receipt's amount within 5 days
  either side; the bank's copy keeps its date, payee and paying side, and its other side becomes
  the receipt's lines as splits, each with its memo. It goes back to review.
- **The categorize chain places each split:** rules and payee history for the whole, **item
  history** for a split's memo against confirmed splits (so "Paper towels, 12 rolls" goes where
  it went last time, without asking anyone), then the book's AI per split.
- **The AI's `extract`** reads a receipt's image or PDF into lines and a total. With Amazon's
  data already itemized, it isn't needed, which saves the call and its guessing; it's there
  for an invoice that only comes as a document.

So the new part is a **source**: something that gets Amazon's charges, and the items behind
each, into the book.

## Amazon's data, and how it could come in

**Amazon has no API for a shopper's own orders** (its Selling Partner API is for sellers). Every
product that does this reads Amazon's own pages: [Copilot](https://help.copilot.money/en/articles/5569639-amazon-integration)
logs in through an in-app browser (re-verified every few weeks; matches an order whose amount is
the transaction's within 2 days); [Monarch](https://robberger.com/monarch-money-amazon-sync/)
uses a browser extension; the open-source [amazon-orders](https://github.com/alexdlaird/amazon-orders)
library logs in from a server ("may break at any time", since it parses the website).

**The key page is Amazon's Transactions page** (Your Account → Payments → Transactions): each
charge to a card, with its date, amount, the card's last four and the order numbers it paid
for. That's what the bank's row matches. Amazon charges **per shipment**, not per order: one
order of three things can be three charges on three days, and a charge's amount is what that
shipment cost (its items, their tax and shipping, less promotions and any gift card balance or
points). The order's page and invoice give the items and prices.

The four ways in:

1. **A browser extension (recommended).** In your own browser, already logged in to Amazon, it
   reads the Transactions page and each order behind a new charge, and sends them to Luminous
   Money with an API token. Amazon's password and two-factor never leave Amazon; its bot checks
   see a person's browser, because it is one. It runs when you open Amazon (or on a timer while
   the browser's open), so it's automatic for anyone who shops there. Costs: an extension to
   build and keep up when Amazon's pages change, and installing it (unpacked for us; a store
   listing later). Monarch's way.
2. **The server logs in as you** (Copilot's way, or `amazon-orders` nightly). The most
   automatic, but Amazon's password and a two-factor secret live on the server (sealed, as the
   bank feed's are), Amazon's bot checks can stop it any night, it has to log in again every
   few weeks, and Amazon's conditions of use forbid it. Possible as an opt-in later, through the
   same door as 1.
3. **Email.** Amazon's order and shipment emails, forwarded to the book (needing mail received
   at luminous.money) or read from Gmail. Once a filter is set it's automatic, and it would
   serve every shop (it's "receipts by email" from PLAN.md's Later). But Amazon's emails often
   leave out item prices and say nothing of the per-shipment charge, so matching is weak. Worth
   doing as receipts by email, not as the Amazon answer.
4. **Amazon's data export** ("Request your data" → Your Orders: a zip with
   `Retail.OrderHistory.1.csv`, a row per item with the order ID, dates, unit price, its tax,
   shipping and what was owed). Exact and structured, years at once, so it's the best way to
   **fill in the past**. But it's by hand, Amazon takes days, and charges have to be pieced
   together from items (by order and ship date): to check against a real export.

Recommended at first: 1 for what's new, 4 for the past. **Kael chose 2** (below): the same
login reaches past years too, so it fills in the past as well, and 4 isn't needed.

## Decided with Kael (2026-11-06)

1. **The server logs in to Amazon as Kael** and syncs by itself (Copilot's way), knowing the
   costs: his password and two-factor secret kept on the server (sealed), Amazon's bot checks
   and periodic logins again, and Amazon's conditions of use. No extension, no export.
2. **Tax and shipping are splits of their own,** as on a grocery receipt.
3. **Discounts:** one on an item comes off that item's price; one on the whole order is spread
   evenly over all its items.
4. **A gift card paying part of a charge** comes from `Income:Uncategorized` (Kael categorizes
   it as `Income:Gifts`), so the bank's row, smaller than the items, still balances.
5. **Kael's Amazon only,** for now (the model keeps room for more than one login).

## The model

- **An Amazon connection,** like a bank connection: set up once in the PWA (email, password,
  and the two-factor secret, or a code typed when it asks), its credentials sealed as the bank
  feed's are and never sent back. It syncs each morning after the bank feed (so the bank's
  rows are there to match) and on demand. When Amazon wants a person (a new code, a captcha it
  can't pass, a changed password), the sync stops and says so in **Notifications**, with a way
  to log in again.
- **What it reads:** Amazon's Transactions page for the charges since the last sync (a year or
  more back the first time), and each order behind a charge for its items. The reading is a
  small service of its own, so `app` never parses Amazon's pages: likely Python around
  [amazon-orders](https://github.com/alexdlaird/amazon-orders), which already handles Amazon's
  login, its two-factor and its bot checks, with narrow operations (log in, charges since,
  an order) that `app` composes, as it composes the AI service's.
- **One door for any shop:** what the reader hands `app` is **charges**, each with its date,
  amount, the card's brand and last four, the order numbers, and its **lines**: each item
  (title, quantity, its price less its own discounts, the order and a link to it), then tax and
  shipping as lines of their own, with an order-wide discount spread evenly over the items and
  a gift card as a line from `Income:Uncategorized`, all summing to the charge. Refunds are
  charges the other way, naming the items returned. The same charge again changes nothing
  (keyed by Amazon's ID). `POST /books/:book/orders` takes the same, so another shop, email, or
  a script can plug in later without changing the rest.
- **`app` keeps them** (a table, through `createTable`) and **reads each into the bank's copy**
  as a receipt is: the card's last four names the paying account; exactly the charge's amount
  within the window; a clear match only. Its splits become the lines, each with its memo (the
  item's title) and a `amazon-order:` link back. Then the categorize chain places them and it
  goes to review.
- **No bank row yet:** the charge waits and is tried again whenever that account's
  transactions come in (as the bank feed's do each morning). One that never finds its row
  (a card not in the book, a gift card order) is listed on an **Amazon** page: matched,
  waiting, and **Assign to a transaction** by hand.
- **Never the AI's extract, rarely its categorize:** items come itemized, and item history
  places what's been bought before. The AI is asked only for what nothing else places.

## Steps (proposed)

1. **A spike: can the server get in?** Built as the real connection (Kael: "build the module
   as part of the codebase assuming that it works"): the `shops` service and the PWA's Amazon
   page, reading charges and orders and showing them, writing nothing to the books. Released
   for Kael to set up on Emmer (its network is what Amazon judges). It answers whether Amazon
   lets a server in, how the two-step codes go, and what the data really holds (gift cards,
   split shipments, refunds).
2. **Orders in `app`:** the table and `POST orders`, matching and reading each charge into the
   bank's copy, the categorize chain over its items, and an **Amazon** page (matched, waiting,
   assign by hand, a link to each order). Tested with made-up charges, no Amazon needed.
3. **The connection:** the reader service, setting it up in the PWA, the morning sync and Sync
   now, logging in again from Notifications, and the first sync filling in the past.
4. **Later, if wanted:** receipts by email, other shops, Jess's Amazon.

6. **Two-factor is an authenticator app** (Kael, 2026-11-06): the connection keeps its setup
   key and makes its own codes.
7. **An order-wide discount is spread in proportion to each item's price** within the order
   (Kael: "proportional"), the cents left over to the largest.
8. **Payment methods other than the card are configurable** in the Amazon settings (where the
   login is): by default every one not recognized comes from `Income:Uncategorized`; that
   default can be changed, and **rewards points** have an account of their own (Kael's would be
   `Income:Rewards:Amazon Visa`).
9. **The first sync's "from" date is the user's to set** (Kael will choose the earliest
   transaction in his asset and liability accounts).
10. **Spike first, tests after** (Kael): build the module as if it works, check it reaches
    Amazon from here, build the login and reading, try it here, release it and upgrade Emmer;
    Kael configures it there. Tests come once it's proven.

11. **A charge is a receipt** (Kael, 2026-11-07: "look at these Amazon charges as simple
    receipts"): match the paying account by the payment method, **always itemize** (the point
    of the integration: so a transaction already categorized is itemized too, which settles
    the first open question), and look for the bank's transaction in that account, linking them
    if it's there (else it's made, and the bank's copy matched to it later, as a receipt's is).

## Step 1: the spike, as built (2026-11-06)

Built as Kael asked: as if it works, checked against Amazon from here, then released for him to
set up on Emmer. No tests yet (his call), until reading is proven.

- **`services/shops`** (Python, FastAPI, `amazon-orders[browser]` 5.2.1), in compose, the
  gateway (`/api/shops/v1`), the bake file, the release and `luminous-money status`. Its
  README has the routes and how a sync goes; design.md has "Shops: reading Amazon".
- **The PWA's Amazon page** (Menu → Amazon): the account (email, password, authenticator setup
  key, never shown again), "Read charges from", where gift cards and other payments come from
  (`Income:Uncategorized` by default) and rewards points (blank: the same); Sync now, with its
  step as it goes; and the charges read, each opening to its order's items and totals. It
  writes nothing to the books.
- **Checked from here:** the image reaches Amazon, and with a made-up email, the whole path
  (the page, the gateway, `shops`, Amazon's sign-in, back to the page) ends in Amazon's own
  answer ("Looks like you're new to Amazon"), stored as the `login` status. Plain requests
  met a JavaScript challenge once, which is why the browser extra is in. The charges list was
  looked at with made-up charges. Kael's own login is the real test.
- **What the spike found about Amazon's data** (from the library, to confirm with real
  orders): a charge has a date, amount, card and order number, but no ID (one is made from
  those); an order has its items (title, quantity, price, ASIN), shipments, and totals
  (subtotal, shipping, promotions, coupons, Subscribe & Save, tax, gift card, rewards points);
  but not what each shipment cost, so a split order's charges will have to be matched to its
  shipments by their sums.

### After the first try on Emmer (2026-11-07, `v0.1.21`)

- **Kael's first sync timed out on Amazon's bot check:** "Timed out after 60 seconds waiting
  for the JavaScript challenge to resolve in the browser", on the very first page, before any
  sign-in. Probed from Emmer without his account: Amazon answered the home page with its "not a
  robot" check, but never the sign-in page (six of six); a clean browser cleared the check in
  about 8 seconds once and not at all three times; and a browser started from the challenged
  session's cookies (what amazon-orders does) never cleared it. The home page only gives the
  first cookies, so **a challenged home page is now passed over** and the sign-in goes ahead
  (`shops.amazon.Session`); the browser forms still meet any challenge in the sign-in itself.
  And a challenge on a page read after logging in is now an error that says so, rather than a
  page read as having no charges.
- **Which charges are the book's** (Kael): not every Amazon order is this book's. Chosen by the
  card each was paid with: only the cards marked Include (every card, if none is), never one
  marked Exclude, and a charge paid with no card (all by gift card or points) is always kept,
  since it's likely wanted and nothing else could tell. Cards seen by a sync are listed to
  choose from, with how many charges and the latest; one can be added by its last four before
  the first sync. A sync reads every charge on the Transactions page (cheap), keeps only the
  book's, reads orders only for those, and forgets ones no longer the book's.

### Proven on Emmer (2026-11-07, `v0.1.22`)

`v0.1.21` met Amazon's bot check again, now in the sign-in itself, and amazon-orders' browser
still never cleared it. Probed from Emmer without an account: Playwright's headless shell (what
amazon-orders launches, saying "HeadlessChrome") never got a page, while a full Chromium in its
new headless mode, with an ordinary user agent and no automation flag, got Amazon's sign-in at
once. So **the sign-in moved into that browser** (`shops.amazon.browser_sign_in`), and three
tries with Kael's account on Emmer (run in its `shops` container with the new code) found the
rest:

1. The email went through; **the password page's own script never sent the form** in the
   headless browser (Enter, then its button; its passkey code fails there), and the first try
   pressed again, so an answer is now never sent twice.
2. **A form nothing was sent for in 20 seconds is sent as a plain form** (what amazon-orders
   posts anyway): the password went, then the code from the setup key, and Amazon signed in.
3. **Amazon then put "Check the box to continue: I am human" in front of every page** (a token
   and a checkbox). It's ticked in the browser and, whenever it shows up later, by the reading
   session.

Then a sync read **112 charges and the 92 orders behind them, none failing.** What they hold
(counted on Emmer, nothing else read):

- **Items are reliable:** 147, every one with a title and price, and each order's items times
  their quantities make its subtotal (92 of 92). No parse failures.
- **Charges make an order's grand total in 70 of 92;** the others have refunds (18 charges are
  refunds, 17 orders have a refund total), gift cards (6 orders), or charges outside the window.
- **Split shipments are common:** 21 orders shipped in parts, 16 of them charged more than once.
- **Seven cards** paid for them, so which charges are the book's matters; six charges were paid
  with no card (gift card or points), and two have no order number.
- Totals seen: subtotal, tax, shipping and free shipping, promotions, a coupon, gift cards and
  refunds; no Subscribe & Save, rewards points or Whole Foods orders in this window.

## Steps 2 and 3, as built (2026-11-07)

design.md has the model ("Shops' orders in the book"); what was decided along the way:

- **One door for any shop:** `POST /books/:book/orders` in `app` takes charges, each with its
  lines summing to what the card paid (`shared/orders.ts`); `shops` makes Amazon's lines
  (`shops.lines`) and hands them over after every sync, as whoever synced. `app` keeps them
  (`shop_charge`, migration 21) and reads each (`server/orders/read.ts`) as a receipt: the
  card's account, the bank's copy or one made, always itemized, back in review.
- **Calls made without asking** (to review):
  1. A charge on a card **no account in the book holds waits** rather than going to
     `Assets:Unknown` as a receipt would: with seven cards on Kael's Amazon, most are likely
     not this book's. Shown on the Amazon page with why, tried again after each bank feed sync,
     and readable into a transaction by hand (`…/orders/{shop}/{id}/assign`; no button yet).
  2. **A charge paid with no card** (all gift card or points) waits too: there's no account it
     came from.
  3. ~~A refund is one line~~: matched to its items (Kael asked, 2026-11-07): the order's only
     item, else the only item in a shipment Amazon marks returned, else the one set of items
     whose share is the refund; else one line. Kael's one refund in the book's cards matched by
     its "Return complete" shipment.
  4. **A split order's charge** is matched to its shipments by their sums (the best fit within
     5%, clearly better than the next), else one line naming the order's items: on Kael's
     data, 6 charges of 3 orders, two of them charged twice for one shipment.
  5. **The morning sync is at 09:00** in the book's zone, `app`'s daily job (after the bank
     feeds' 06:00 to 08:00), for books that have handed charges over before, as whoever did
     last; never while Amazon wants a person.
  6. **"Amazon wants you to log in again"** is a Notification read from the connection's status
     each time (not dismissable; it goes once a sync gets in), linking to the Amazon page.
  7. **The Amazon page shows what the book made of each charge** ("Itemized in the book", a
     link to it; or "Waiting:" and why), not a separate list.
- **After Kael's first sync** (`v0.1.23`, his cards chosen): 39 charges handed over (73 on
  other cards left out): 24 read into their bank transactions, 9 made as their own (all on a
  card whose account isn't on the bank feed, so nothing will match them: not duplicates), 6
  waiting (paid without a card). **Then (`v0.1.24`, Kael):** a sync reads back only 15 days before the last
  after the first, and refunds name their items.
- **Tests:** `server/orders/orders.test.ts` (reading, waiting, sending again, by hand, the
  morning sync, the notification), `services/shops/tests/test_lines.py` (lines from made-up
  orders: discounts, gift cards and points, refunds, split shipments), and
  `tests/e2e/src/orders.test.ts` (through the stack). **No browser test:** the Amazon page's
  charges come from `shops`, which a test stack can't fill without Amazon, and the login
  notification needs a sync Amazon refused; a fake Amazon (or seeding `shops`) would be needed.

## Still open

1. ~~Amazon charges already categorized by hand~~: itemized too (Kael, decision 11).
2. **The book's own cards as the default?** The book already knows its accounts' payment
   cards (M16): charges on those could be the book's by default, without listing them on the
   Amazon page. (A charge on a card no account holds already waits, so this is about what
   `shops` keeps and reads, not what reaches the books.)
3. ~~A split order's charges~~: by the shipments' sums when they're clear (calls made, 4).
4. **Assign by hand** has its route but no button on the Amazon page yet.
