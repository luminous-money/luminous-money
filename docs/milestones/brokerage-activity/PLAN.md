Brokerage activity: a brokerage's rows read as what they are
==================================================================================================

_Raised by Kael, 2026-11-07. Decided with Kael the same day (below), and built._
Where it stands is in [RESUME.md](../../../RESUME.md); the roadmap is [docs/PLAN.md](../../PLAN.md).

## The brief

Kael, after a few months of his Fidelity accounts on SimpleFIN: "I don't know how to handle all
the little transactions between cash and commodities in my Fidelity account." A money-market
dividend shows up as a deposit to the brokerage's cash and a withdrawal from it; an IRA does the
same with small credits; and a sale of a fund's shares came in as plain income to cash, with no
shares leaving at all. "It seems like things like this will happen a lot across many, many small
transactions and many, many assets. How can we deal with this and make the system useful
without requiring a bunch of manual corrective work?"

## What SimpleFIN brings from Fidelity

Looked at in the live book (read only, 2026-11-07). Nothing below is his data: the shapes only.

- **Every activity is a cash row,** in the brokerage's `:Cash` account, never the shares. The
  description says what it was and names the security in parentheses: `YOU BOUGHT <name>
  (<SYM>)`, `YOU SOLD …`, `DIVIDEND RECEIVED …`, `REINVESTMENT <core fund> (<CORE>)`, `PURCHASE
  INTO CORE ACCOUNT …`, `REDEMPTION FROM CORE ACCOUNT …`, `TRANSFER OF ASSETS ACAT RECEIVE …
  (<SYM>)`, `TRANSFER OF ASSETS ACAT RES.CREDIT`, `DIRECT DEPOSIT …`, `Electronic Funds Transfer
  …`. Each is staged like a bank's row: `Income:Uncategorized` in, `Expenses:Uncategorized` out.
- **Sweeps double everything.** The core money-market position (SPAXX), which `holdings.ts`
  already counts as cash, takes in every inflow ("purchase into core", or "reinvestment" after
  its own dividend) and pays out every outflow ("redemption from core"). So each real event comes
  with a sweep of the same amount the other way, and both wait in review as if they were income
  and spending. A dividend and its reinvestment, read as they come, are income and an expense
  that cancel; the truth is income, and nothing else.
- **A trade has only its cash side.** "YOU SOLD … (<SYM>)" brings the proceeds in; the shares
  going out come only from the daily holdings snapshot, as a **position change**
  (`simplefin/holdings.ts`), which pairs with the cash row when it finds it (unconfirmed,
  uncategorized, within 5 days, within 1%). That works for trades made while syncing daily. It
  can't for **history read when an account is linked**: positions open at *today's* shares,
  dated at the link's start, so a sale in the history has no shares to take, and the proceeds
  stay income.
- **Transfers of assets in** (ACAT, from another custodian) come as cash rows valued at the
  market, though what arrived was shares, not cash. The shares are already in the opening
  positions (today's), so read as cash income the rows count them a second time.

## What the books need from a brokerage

For a household's books: what it's worth (the snapshot says, every morning), the money that
crosses its edge (transfers to and from the bank, already matched from the bank's side), what it
earns (dividends, interest, distributions), and, for taxes, what was realized. The movements
inside it (sweeps, a trade's cash leg) matter only in keeping cash and shares right, and nobody
should have to look at them one by one.

## A proposal

Four layers, each useful without the next.

1. **Read each row of a brokerage before staging it** (a link whose account is a brokerage,
   `simplefin/sync.ts`): a small table of description patterns per institution (Fidelity's
   first, with generic ones: dividend, interest, bought, sold, reinvest, core, sweep), and the
   symbol in parentheses. What each kind becomes:
   - **Sweep** (into or out of a cash-like holding): nothing in the books, since the core
     position is cash. Kept as an import row, so it's never brought again, and countable
     ("14 sweeps left out").
   - **Income** (dividend, interest, a distribution): to `Income:Dividends` (or per symbol, or
     `Income:Interest`), by a built-in rule that can confirm by itself.
   - **Trade** (bought or sold a symbol): a trade (M5's booking), its shares from the snapshot's
     position change when that's there (today's pairing), else from that day's price (units =
     amount ÷ price, from beanprice's history), marked estimated; lots by the account's method,
     gains split by term.
   - **Transfer of assets** (ACAT): shares in, not cash; against Opening Balances (or an
     account chosen once), at that day's price; the cost basis asked for, or the market value
     marked as an estimate.
   - **Transfer** (EFT, deposit): the usual pipeline, which matches the other bank's side.
   - **Unknown:** staged as today.
2. **The snapshot is the truth.** After the rows are read, any difference left between the
   books and the bank's snapshot (per position, and in cash) becomes one adjustment each,
   flagged "unexplained", so the account always agrees with the bank and only what couldn't be
   explained asks for attention. Position changes already do this for shares; cash would join.
3. **Review keeps brokerage activity out of the way:** confirmed-by-rule income and left-out
   sweeps are counted, not listed ("12 sweeps left out, 3 dividends confirmed"); estimates and
   unknowns are what's left to look at.
4. **Linking with history opens positions as they were on the start date** (today's shares less
   the trades read in the history, by the reading above), or reads history as cash only from
   the link's date on, so history and today's positions don't count the same shares twice.

A one-time cleanup of what's already in the live book would come with it (the sweeps dropped,
the rest read again), shown to Kael before anything's written.

## Checked against the live book (2026-11-07, read only)

Before deciding, the proposal's claims were checked against Kael's three Fidelity cash ledgers
and the SimpleFIN snapshot on Emmer (shapes only here). What held, and what didn't:

- **Sweeps are no-ops one by one, not in pairs.** The books count the core money market as
  cash, so each "purchase into core" or "redemption from core" moves cash to cash, whether or
  not the event beside it is there. They don't pair neatly: one redemption covered two buys
  together (to the cent). So each row is read for what it is; nothing is paired.
- **Dividends are right as they come:** the bank's own amount and date. Only the category is
  missing.
- **Transfers of assets are three kinds of row,** not one: shares received (`ACAT RECEIVE <name>
  (<SYM>)`, or a CUSIP for a security without a ticker), cash received from the old broker
  (`ACAT RECEIVE (Cash)`, no symbol; it can be negative), and cash that followed later
  (`ACAT RES.CREDIT`). Only the first is shares; the other two are cash from outside the books.
- **Linking hid the double count in the opening balance.** Shares received, read as cash
  income, were offset by a large *negative* opening cash balance, so the total agreed with the
  bank. Reading them again means working out the opening balances again.
- **The snapshot's cost basis is always `0.00`** for Fidelity, but its `purchase_price` is the
  average cost per share. Every lot opened at a $0.00 cost (the bug noted in RESUME) for that
  reason.
- **A position can come without a symbol** (a unit investment trust, named only in its
  description; its transfer row gives its CUSIP), and so was counted as cash; **and with no
  shares** (an empty core position), which opened as a zero-share lot, the one that makes the
  ledger's holdings fail for the account.
- **Pairing a trade's shares with its cash during the daily sync was never proven:** every trade
  in the book predates its link. If the holdings move on the trade date and the cash row comes
  a day later, the old pairing (which looked only once) missed it.
- **One of the three accounts has no sweeps at all,** so nothing may depend on them being there.

## Decided with Kael (2026-11-07)

1. **Lots and realized gains are in the books** (the recommendation): a sale books its gain by
   the account's method, split by term. Lots opened from the snapshot are estimates, and the
   1099-B is the authority.
2. **Dividends go to one income account per link, chosen on Bank connections.** The default is
   the one useful for taxes: `Income:Dividends` for a taxable account, and
   `Income:Retirement:Dividends` for a retirement account (an IRA, a 401(k), a Roth, an HSA, by
   the bank's or the book's name for it), so the year's `Income:Dividends` is the 1099-DIV's
   ordinary dividends.
3. **Sweeps and dividends skip review,** checked first: a sweep is left out only when the
   symbol it names is a cash-like holding (priced at 1, or the snapshot's core) of that
   account; a dividend is confirmed by itself only for the exact `DIVIDEND RECEIVED … (<SYM>)`.
   Anything else that looks like income (capital gain distributions, return of capital, foreign
   tax) stays in review until it's been seen. Both are counted where the link is shown.
4. **Fidelity only, for now.** Linking a brokerage says whether its activity can be read; one
   that can't comes in as cash rows as before, with a link to open an issue or send a pull
   request.
5. **The cleanup reads every brokerage link again** from what's already fetched (no SimpleFIN
   requests), and runs on Kael's book after the release. Kael: "The current accounts aren't
   accurate anyway, so I'm not concerned about losing their data."

## Building it

- **Reading rows** (`simplefin/activity.ts`): a reader per institution (Fidelity's), each row
  to one of: sweep, dividend, buy, sell, shares in, cash in from another broker, or anything
  else (the usual pipeline: transfers, deposits, the unknown).
- **What each becomes:** a sweep, nothing (an import row marked left out, so it never comes
  back); a dividend, confirmed to the link's dividend account; cash from another broker,
  `Equity:Opening-Balances`, for review; a trade, M5's trade booking, for review, its shares
  from the day's change in the snapshot when there is one, else from that day's price (fetched
  through beanprice, and recorded), marked estimated; shares in, a lot at the snapshot's
  average cost, against `Equity:Opening-Balances`.
- **The snapshot settles shares:** an estimated trade is trued up when the snapshot shows the
  shares; a difference nothing explains, for three days, is staged as before (a position
  change, for review). Cash is compared with the bank (M14's "Matches the bank" or "Off by"),
  not written: a pending row the snapshot already counts would otherwise be counted twice.
- **History, at linking and when read again:** each position opens at today's shares less what
  the history's trades and transfers moved (each estimated from its day's price, the total
  fitted to today's shares), at a cost worked out from the average cost and the history's buys.
- **Read again** (Bank connections, beside a brokerage link; previewed): deletes what the bank
  brought into the brokerage (rows, positions, opening balances), keeps what touches other
  accounts (a transfer from checking) and what you categorized yourself among rows read as
  "anything else", and reads the mirror again. This is the cleanup.
- **The fixes found on the way:** cost from `purchase_price`; no position without shares;
  positions named by their description when they have no symbol.

## As built (2026-11-07, `v0.1.26`)

As "Building it" above, with these details:

- **Code:** `simplefin/activity.ts` (readers: Fidelity's; what's cash-like; what's a retirement
  account), `simplefin/brokerage.ts` (reading rows in, `fitHistory`, `settle`, opening
  positions, what a link's reading made of its rows), `simplefin/reread.ts` (Read again, and
  `readHistory`, which linking uses too), `simplefin/holdings.ts` (the snapshot's fixes, and
  the position change both kinds of brokerage stage). Sync (`importLink`) and linking
  (`link.ts`) send a read brokerage through them; another is as before.
- **The ledger:** `POST /books/{book}/prices/on` gives a commodity's price on some days: the
  book's, else fetched with beanprice from its own source or the default for its ticker
  (`LUMINOUS_MONEY_PRICE_SOURCE`, Yahoo unless set; the e2e stack uses the fixed source), and
  recorded. A day nothing answers for falls back to the book's nearest price, then the
  snapshot's.
- **The app API:** a brokerage link in `GET …/simplefin/status` has `reader`, `dividends`
  (and whether it was chosen), `activity` (sweeps, dividends, trades, transfers in, other) and
  its cash `comparison`; `PATCH /books/:book/simplefin/links/:id` sets `dividends` against the
  link's `updated_at` (409 when stale); `POST …/links/:id/reread/preview` and `…/reread`
  (with `Prefer: respond-async`, a job). A connection's accounts say their `reader`; a link
  preview says it too.
- **Storage:** app migration 23: `simplefin_link.dividends`, and `simplefin_position_wait` (a
  difference in shares, since when). Import rows have a new outcome, `left-out`.
- **The PWA:** Bank connections says, for each brokerage, whether its activity is read (or how
  to get it read: an issue or a pull request); beside a linked one, what the reading made of its
  rows, "Dividends go to …" (an income account, or the default), and "Read again…" with its
  preview. A trade's review card and page say what was estimated (`brokerage-note`). A read
  brokerage's account page says whether its cash matches the bank's.
- **Calls made without asking:**
  1. Cash from another broker (the cash side of a transfer of assets, and residual credits)
     goes to `Equity:Opening-Balances`, for review, not income.
  2. Shares received are a lot at the bank's average cost, dated the day they came; the real
     acquisition dates aren't sent, so for a taxable account their term is a guess (labeled in
     the note).
  3. An estimated trade is trued up only within a week and within a quarter of its estimate;
     anything else waits three days before it's staged as unexplained.
  4. Read again keeps rows read as "anything else" with your categorization, and deletes your
     own transactions in the brokerage that no bank row brought (the preview counts them).
  5. Trades stay in review (unconfirmed), even when their shares are exact: only sweeps and
     dividends skip it, as decided.
- **Tests:** `simplefin/brokerage.test.ts` (reading, the snapshot's fixes, fitting, linking a
  history, the daily sync's true-up and wait, Read again), the ledger's
  `test_prices_on_days_…`, `tests/e2e/src/brokerage.test.ts` (against the real ledger: lots and
  gains, a transfer of assets into an IRA, Read again) and `tests/ui/src/brokerage.spec.ts`.
