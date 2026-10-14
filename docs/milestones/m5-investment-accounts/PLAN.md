M5: Investment accounts: plan
==================================================================================================

> **Status: built (2026-10-14).** Every slice is done, with unit, API and browser tests. The
> [answers](#answers-2026-10-13) override anything below that disagrees. There's no separate spec: the milestone's line
> in [the plan](../../PLAN.md) ("lean on what Beancount already provides; the main deliverable:
> storing non-currency holdings, with a currency representation of their value"), its notes
> (prices by `bean-price` on a schedule, manual prices for illiquid assets), and the design's
> price and performance notes are the brief. Calls marked **Proposed** are open; the
> [questions](#questions) list the ones that matter most.

## Answers (2026-10-13)

- **Prices are fetched with `beanprice`,** once a day **in the morning** (**Proposed:** 07:00
  in the book's time zone, which gets the previous trading day's close), through the M3
  scheduler.
- **Booking follows tax reporting.** In the US, a sale's cost basis is FIFO unless specific lots
  are identified, and mutual funds may use average cost; what matters is matching the method
  the broker reports on the 1099-B. So the booking method is **per account**, FIFO by default,
  set to match the broker:
  - **FIFO, LIFO, HIFO,** or **specific lots** (Beancount's STRICT: the Sell form asks which
    lots) are Beancount's own.
  - **Average cost** isn't: Beancount 3 refuses `AVERAGE` ("not supported", checked). For such
    accounts, fava-beans books sales itself: the account uses Beancount's `NONE` booking, and
    the Sell form reduces at the account's current average cost per unit, which keeps units and
    total cost basis right. (Its own small piece of code, with tests against hand-worked
    examples.)
- **Trades are entered with the forms;** no brokerage CSV trades for now.
- **Illiquid assets are plain currency balances,** revalued with explicit transactions, so
  appreciation and depreciation fall in their accounting period. That's also one of the two
  ways Beancount users do it (the other being a commodity with prices, which Beancount values
  but never books, so the change never shows in a period); Beancount 3 dropped the plugin that
  synthesized unrealized-gain entries from prices. "Update value" writes a transaction for the
  difference, against **`Income:Unrealized-Gains`**. Shares and funds stay commodities with
  prices: their gains are shown, not booked, until a sale.
- **Home cards show unrealized gain or loss** as well as value.
- **Staleness is a property of the asset:**
  - a **commodity** (shares, funds) carries `stale-after` (days) in its `commodity` directive's
    metadata, default **7**
  - a **revalued asset** (a house, a car) is an account whose `open` directive carries
    `revalue-every` (days), default **350**, so it asks to be updated yearly; "stale" is
    measured from its last revaluation
  - both are editable (the Commodities page, and the account's settings), and the add-account
    form offers "revalued periodically (a house, a car)"
- **Capital gains are split** into `Income:Capital-Gains:Short-Term` and `…:Long-Term`. The Sell
  form previews which lots booking will reduce (the account-scoped booking, below), and writes
  the gain per lot by holding period (more than a year is long-term), as explicit postings.

So these sections change: "Illiquid assets" (plain balances, not a commodity), "Recording
trades" (per-account booking, average cost, the split gains), and "Getting prices" (the
morning run). The rest stands.

## What M5 is

One of the reasons for leaving GnuCash was **stale asset values**. M5 makes holdings that aren't
cash (shares, funds, crypto, a house, a car) first-class, and keeps their value current:

1. **Holdings:** an account's (or a whole brokerage's) units per commodity, with cost basis,
   lots and unrealized gain, from Beancount's own booking.
2. **Prices:** stored as Beancount `price` directives (the system of record stays the books),
   readable fast with SQL, entered by hand or **fetched automatically on a schedule**.
3. **Value everywhere:** home cards, account headers and holdings show market value in the
   book's operating currency, with how old the price is.
4. **Recording trades:** Buy, Sell and Dividend forms that write correct Beancount (lots at cost,
   sales booked against lots, gains to an income account), checked by booking before they're
   saved.
5. **Illiquid assets:** a house or car is a holding of one unit, revalued with a manual price.

Beancount already does booking (lots, FIFO and friends, capital gains), multiple commodities,
prices and conversions. M5 builds the screens and the plumbing around them, not a new engine.

## What exists today

- Transactions with lots and prices are stored, round-tripped and preserved by the editor (it
  shows "has a cost basis; kept as is", but can't edit them).
- Balances from SQL work per currency, so an account shows "20 GLD", not its value. Anything
  that needs booking (cost basis) falls back to a full Beancount load: seconds on a laptop for
  the decades-scale book, far too slow on a Pi for a screen.
- `price` and `commodity` directives are stored like any directive, but nothing reads them.
- The demo book (`bean-example`) has brokerage accounts in the common Beancount shape: a node
  per brokerage (`Assets:US:ETrade`) with a leaf per holding (`…:GLD` holding GLD) and one for
  cash, commodities with `price:` source metadata, and weekly prices.

## Decisions this plan makes

### Accounts: no investment "kind"

Consistent with M2 (no account kinds), there's no special investment account. Any account can
hold any commodity. What changes is that **a node can be starred**, and a node's card, ledger
and holdings cover **its whole subtree**, so a brokerage modeled as a node with a leaf per
holding (as `bean-example` does) or as a single leaf holding everything both work.

### Prices: in the books, read with SQL

- **Stored as `price` directives,** like everything else (exports and backups carry them).
- **Read fast:** a ledger migration adds a derived **`price` table** (date, commodity, number,
  currency), written alongside each price directive and backfilled, so "the latest price of
  GLD on or before a date" is one indexed query.
- **The valuation currency** is the book's `operating_currency` (USD by default). A commodity
  priced in another currency converts through that currency's price.
- **Staleness:** every value says the date of the price behind it. **Proposed:** a price older
  than 7 days (liquid holdings) or 400 days (illiquid ones, see below) is flagged "stale".

### Getting prices

- **By hand:** "Update value" on a holding writes a price for a date (today by default).
- **Automatically** (**Proposed**): with [`beanprice`](https://github.com/beancount/beanprice),
  Beancount's own price fetcher, run in `ledger`.
  - A commodity says where its price comes from in its `commodity` directive's `price:`
    metadata, beanprice's convention (`price: "USD:yahoo/VTI"`); `bean-example` already does.
  - **The M3 scheduler runs it daily** per book (after midnight in the book's time zone),
    through a ledger endpoint, for commodities still held. A price is recorded only when it's
    new (no duplicate for a date), and a failure is kept per commodity and shown, like a
    schedule's.
  - **Proposed frequency:** one price per commodity per day. The design noted that prices
    dominate the synthetic book's size (about 45%); daily for a dozen holdings is ~4,000 a
    year, fine for SQLite and the SQL reads, and only the account-scoped booking (below)
    reads them through Beancount.

### Holdings and cost basis, without a full load

- **Units and value come from SQL:** units per commodity from the derived posting amounts
  (already there), times the latest price.
- **Cost basis, lots and gains need booking.** **Proposed: account-scoped booking.** Booking is
  per account, so instead of loading the whole book, the ledger renders only what one account
  (or subtree) needs (the opens and commodities, and the transactions that touch it) and runs
  Beancount over that. It's cached until one of those changes. Benchmarked on the decades-scale
  book, on x86 and estimated for the Pi.
- **`GET /accounts/{account}/holdings`** (subtree included): per commodity, units, the latest
  price and its date, market value, cost basis, unrealized gain, and the lots (date, units,
  cost per unit); and the totals.
- **The account summary** (home cards, headers) gains **`value`**: market value in the
  operating currency, and **`value_as_of`**: the oldest price date behind it. Subtree-aware for
  nodes.

### Recording trades

- **Forms on an account's page ("Trade"):**
  - **Buy:** date, commodity, units, price per unit (or total), fees, paid from (a cash account,
    the subtree's cash leaf by default). Writes the lot at cost:
    `Assets:…:GLD 20 GLD {59.36 USD}` / cash / fees.
  - **Sell:** date, commodity, units, price per unit, fees, proceeds to. Writes
    `-5 GLD {} @ 61.20 USD`, letting **booking pick the lots**, with the gain or loss to an
    income account (**Proposed:** `Income:Capital-Gains`, created on first use, elided so
    Beancount computes it).
  - **Dividend:** amount, to (cash), from `Income:Dividends:<commodity>`; **reinvested** is a
    dividend plus a buy in one transaction.
- **Booking method** (**Proposed**): FIFO. New books get `option "booking_method" "FIFO"`; for
  existing books (like the demo, Beancount's default STRICT), the Sell form picks lots FIFO
  explicitly.
- **Checked before saving:** trades go through the account-scoped booking on write, and are
  refused with Beancount's message if they don't book (selling more than is held, say), rather
  than surfacing later as a problem.
- **A new commodity** gets a `commodity` directive on first use: its name and, optionally, a
  price source.
- **Editing a trade** opens the transaction editor, which (for now) still keeps lots and prices
  as they are: changing a trade is delete and re-enter. Editing lots there is Polish.

### Opening holdings

Adding an account (M2's form) gains **opening holdings**: per commodity, units and total cost
(or "unknown": the current price is used as cost, flagged in the lot), as of the opening date,
against `Equity:Opening-Balances`. So an existing brokerage starts with its real lots.

### Illiquid assets (house, car)

**Proposed:** a holding of **one unit of its own commodity** (`HOUSE`, `CAR-2019`), opened at
its purchase price as cost, and **revalued with manual prices** ("Update value"). The ledger
stays clean (no revaluation transactions), the value history is the price history, and selling
it books a real gain. The staleness window is long (400 days).

### The PWA

- **Home:** cards show **value** in the operating currency (with "as of" when the price isn't
  today's), units underneath for a single holding, and a stale marker.
- **An account's page:** for holdings, a **Holdings** section above the ledger (commodity,
  units, price and date, value, cost, gain, stale marker; tap for lots and "Update value"), and
  **Trade**. A node's ledger covers its subtree.
- **Commodities** (from Manage books, **Proposed**): each one's name, price source, last price
  and any fetch error; edit the source; "Fetch prices now".

### Demo data

The seed also stars the demo's ETrade node, so its holdings and values show on the home page.

## How it gets built

1. **Prices in SQL:** the ledger migration (derived `price` table, backfilled), latest-price and
   price-history queries, `POST /prices` (manual), conversion to the operating currency.
2. **Subtrees:** balances, summaries and ledgers for nodes; starring nodes.
3. **Value:** `value` and `value_as_of` in summaries; staleness.
4. **Account-scoped booking:** rendering a subtree's slice, the cache, the holdings endpoint;
   the benchmark.
5. **Commodities:** listing (declared, and seen in postings), `commodity` directives with
   name and price source, versioned edits.
6. **Trades:** the forms; booking checks on write; FIFO for new books; `Income:Capital-Gains`
   and dividends.
7. **Opening holdings** in the add-account form.
8. **Fetching prices:** `beanprice` in the ledger image, `POST /prices/fetch`, the daily run
   from the M3 scheduler, errors per commodity.
9. **The PWA:** home values, the Holdings section, Update value, Trade, the Commodities page.
10. **Tests and docs:** unit tests (prices, valuation, subtree sums, scoped booking against a
    full load, trade postings); API tests (manual and fetched prices with a stubbed source,
    holdings, a refused oversell, opening holdings); browser tests (a buy and a sell, Update
    value on a house, home values); `bench.py`; design.md, `docs/PLAN.md`, RESUME.md.

## Out of scope for M5

- **Importing trades from brokerage CSVs:** cash rows (dividends, transfers) import as today;
  trade rows are a question below.
- **Tax lots beyond the booking method** (specific identification, wash sales), and tax
  reporting.
- **Loans and amortization** (a mortgage's principal and interest split): its payments can be a
  schedule (M3); amortization is later.
- **Net worth and performance reports** (time-weighted returns, allocation): M10, which can
  build on prices and holdings.
- **Editing lots in the transaction editor:** Polish.

## Questions (answered above)

1. **Fetching prices automatically:** use `beanprice` (Yahoo and other free sources, no API
   keys, but they break now and then), daily, in the ledger? Or manual prices only for now?
   Any source you already rely on (a broker's API, a paid feed)?
2. **Price frequency:** daily (proposed), or weekly to keep the book smaller?
3. **Booking method:** FIFO by default (proposed), or another (average cost, as many US mutual
   funds report; or STRICT, always choosing lots)?
4. **Brokerage CSV trades:** keep trades to the forms for M5 (proposed), or teach the importer
   brokerage exports (symbol, quantity, price columns) now?
5. **Illiquid assets:** one unit of their own commodity, revalued with prices (proposed), or a
   plain USD balance adjusted with revaluation transactions against an unrealized-gains
   account (simpler balances, noisier ledger)?
6. **Home cards:** show market value (proposed), with unrealized gain too, or units?
7. **Staleness:** 7 days for priced holdings and 400 for illiquid ones?
8. **Capital gains account:** one `Income:Capital-Gains`, or split short and long term (which
   needs holding periods per lot)?
