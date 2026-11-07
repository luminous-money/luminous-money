Amazon orders: plan
==================================================================================================

> **Status (2026-11-06): planned with Kael, not started.** Kael's brief, what's already here,
> the ways Amazon's data could come in, then [Decided with Kael](#decided-with-kael-2026-11-06):
> **the server logs in to Amazon as him** (Copilot's way). The model and steps below follow
> that; [Still open](#still-open) has what's left to ask. Step 1 is a spike: proving the
> server can log in and read his orders from Emmer, before anything else is built.

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

1. **A spike: can the server get in?** From Emmer (its network and address, which is what
   Amazon judges), log in to Kael's Amazon with `amazon-orders` and read a few months of
   charges and their orders, by hand, with nothing written anywhere. Kael types his password
   and code himself; nothing is kept. It answers whether Amazon lets a server in at all, how
   it asks for two-factor, and what the Transactions page really gives (gift cards, split
   shipments, refunds). Its findings go here, and decide the rest.
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

## Still open

1. **Amazon charges already categorized by hand:** left alone (recommended) or itemized too?
