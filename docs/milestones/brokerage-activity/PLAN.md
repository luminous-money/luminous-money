Brokerage activity: a brokerage's rows read as what they are
==================================================================================================

_Raised by Kael, 2026-11-07. Not started: a proposal to decide on before the product is done._
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

## Questions for Kael

1. Lots and realized gains in the books, or value and income only (gains from the 1099-B)?
2. Dividends: one income account, one per brokerage account, or one per symbol?
3. May sweeps and dividends skip review entirely (counted, not listed)?
4. Other brokerages on SimpleFIN (their own description styles): which, if any, after Fidelity?
5. The cleanup: drop the existing sweep rows and read the rest again?
