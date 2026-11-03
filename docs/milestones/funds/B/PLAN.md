Funds B: Complex Fund Functionality: plan
==================================================================================================

> **Status (2026-11-03): step 1 built and released as `v0.1.15`.** The ledger, the app server and
> the PWA, with unit, API and browser tests, and looked at on a phone and a desktop, light and
> dark. Where the build departed from the plan, [As built](#as-built-where-things-are) says so.
> B is built in steps (Kael, 2026-11-03). **Step 1 is shares in funds:** a fund holds amounts of any commodity, not just
> dollars, so that Kael can represent every one of his Fidelity accounts in funds. With it come
> account default funds (the IRAs are Retirement's), a flag on a sale that says no fund, and a
> Notifications queue. Houses, cars and loans wait. Kael's answers are under [Decided with
> Kael](#decided-with-kael), and the calls made without asking under [Decisions to
> review](#decisions-to-review). The rest of B comes after step 1 ships. Everything designed
> before this (the old plan, rules included) is in [the design record](design-record.md), with
> [the example book](example-book.md) and [71 scenarios](scenarios.md).

## Step 1: shares in funds

### The goal (Kael, 2026-11-03)

"My use is limited by not being able to assign assets to funds." Step 1 is done when Kael can
represent all of his Fidelity accounts in funds:

- **The taxable brokerage,** linked over SimpleFIN (so the books hold `<account>:Cash` and an
  account per holding), divided among Wedding, Emergency, Special Home Maintenance and Repair,
  Special Home Improvement and Unallocated. Kael's three needs from the start (the design record,
  "The problem"):
  1. **Fluctuations follow the holdings:** each fund's value moves with what it holds.
  2. **Holdings move between funds:** "move 10 shares from home maintenance to the wedding."
  3. **Reinvestments land in a default,** to be moved by hand if wanted. In step 1 the default is
     Unallocated (Kael).
- **A Roth IRA and a traditional IRA,** both wholly Retirement's (Kael): Retirement is each one's
  [default fund](#an-accounts-default-fund), so it holds everything in them without anything
  being marked.
- **The Fidelity Visa** needs nothing new: it's a card, so spending on it is money out, as in A.

Two things come with it (Kael, 2026-11-03): a sale that takes shares no fund has to give is
[flagged](#a-sale-that-says-no-fund), and flagged transactions that came in by themselves wait
in [Notifications](#notifications), a bell beside the camera.

Not in step 1: houses, cars and loans (groups), spend and fill rules, budget funds, dividends
following the shares that earned them, and gains per fund.

### What it looks like

A made-up book holding only `Assets:Brokerage:Fidelity`: $6,000 in cash, 200 FXAIX at $200 and 50
VTI at $300, worth $61,000.

1. **Setting up.** Funds → **Move money**, from Unallocated to Emergency: $4,000 and 100 FXAIX, in
   one move ("+ Another amount"). Then Wedding gets 50 FXAIX and 30 VTI, Special Home Maintenance
   and Repair 20 VTI, and Special Home Improvement $8,000 of FXAIX, typed in dollars (40 FXAIX at
   $200). The Funds page shows each fund's value and what it holds (Emergency: "$24,000.00",
   then "$4,000.00 · 100 FXAIX"), and Unallocated's $2,000 and 10 FXAIX: what the accounts hold
   that no fund does.
2. **Prices move.** FXAIX rises to $210: Emergency is worth $25,000 and Wedding $19,500. Nothing
   is written.
3. **Moving shares.** "Move 10 VTI from Special Home Maintenance and Repair to Wedding" is a move
   of 10 VTI. No account, lot or transaction changes.
4. **A dividend, reinvested.** $60 of FXAIX dividends come in, and the reinvestment buys 0.3
   FXAIX with them. Unmarked, both land in Unallocated, which ends up with 0.3 FXAIX more (its $60
   came and went). Kael can mark them in review instead ("To Emergency", then the reinvestment's
   "From fund: Emergency", which To follows), or move the shares later.
5. **Buying with a fund's cash.** Kael buys 10 VTI for $3,000 with Emergency's cash. The bank
   feed stages the position change; on its review card, Emergency writes `Emergency -3000.00 USD;
   Emergency +10 VTI`. Emergency is worth the same, and now holds $1,000, 100 FXAIX and 10 VTI.
6. **Selling a fund's shares.** A sale of 20 VTI for $6,100 comes in from the bank, unmarked.
   Every VTI is in a fund, so the sale takes 20 VTI that Unallocated doesn't have. It's flagged
   ("Needs a fund"), and the bell beside the camera shows 1. Notifications opens it, first in
   Review, with From fund already set to Wedding (the only fund with 20 VTI). Confirming writes
   `Wedding -20 VTI; Wedding +6100.00 USD`, and the notification is gone. Typed in by hand, the
   same sale couldn't be saved until it said whose shares they were.
7. **The IRAs.** Each IRA's default fund is Retirement. Retirement is worth both IRAs at once,
   and keeps up through every dividend, reinvestment and trade inside them, with nothing marked.
   A $500 contribution from checking takes $500 from Unallocated (or from a fund, if a line says
   so) and gives it to Retirement.

### The model: what changes from A

1. **Lines and moves in any commodity the book has** (A: the operating currency only), such as
   `Wedding +10 VTI` and `custom "fund-move" "Unallocated" "Wedding" 50 FXAIX`. A fund holds the
   sum of its lines and moves per commodity (`funds.listing` already keeps them that way), and
   is worth each holding at today's price, as the chart values accounts.
2. **Funds read a transaction one commodity at a time.** For each commodity, its balance-sheet
   splits' units are summed: that commodity's change. Each commodity then has A's kind and size,
   by A's rules. If there's more of it, it's *in*, with `+` lines ("to" a fund). If there's less,
   it's *out*, with `−` lines ("from"). If none changed hands overall but some moved, it's a
   *transfer*: `+` lines ("for"), and with More options `−` too. This replaces A's single kind
   weighed in the operating currency (design.md, "Funds A"). It gives the same answer whenever
   only one commodity is on the balance sheet, which is every transaction A could read except
   trades.
   - **A buy** (`Cash −3,000.00 USD · VTI +10 {300 USD}`): USD out 3,000, VTI in 10.
   - **A sale** (`VTI −10 {…} · Cash +3,100.00 USD · Capital-Gains −100`): VTI out 10, USD in
     3,100. The gain needs no line of its own: a fund that sold gets the proceeds.
   - **A dividend reinvested in one transaction** (`VTI +0.17 {…} · Dividends −52`): VTI in 0.17.
   - **Shares moved between brokerages:** a VTI transfer.
   - Units need no booking, so a sale's empty cost (`{}`) no longer leaves a transaction
     unreadable. A foreign currency is one more commodity. Fidelity doesn't need that, but it
     comes free.
3. **The cap is per commodity:** a commodity's lines add up to no more than its size, each way.
   A line in a commodity the transaction doesn't move is refused ("it moves no VXUS").
4. **A fund appears once per commodity** (A: once per transaction). A trade's fund gives one
   commodity and gets the other: `Emergency -3000.00 USD; Emergency +10 VTI`. Marking only one
   side is allowed and means just that: `Wedding +10 VTI` alone is shares bought for Wedding with
   Unallocated's cash.
5. **Unallocated per commodity:** for each commodity, what the balance-sheet accounts hold (the
   chart's top-level asset and liability totals) less what funds hold. Its value is still net
   worth less every fund's value. If it holds fewer than zero of a share, funds claim shares the
   accounts don't have: the transaction that did it is [flagged](#a-sale-that-says-no-fund).
6. **No fund goes below zero in a share** (Kael): not through a default, a line or a move. What
   came in by itself and would is [flagged](#a-sale-that-says-no-fund); anything done by hand
   that would is refused. Dollars stay as in A (allowed, shown in red).
7. **Values follow prices; nothing else does.** A price change writes nothing (the design
   record, decided). Targets stay in the operating currency and are judged by value. Funds
   don't use cost basis, so the live brokerage's $0.00 lots (RESUME, "A bug found on the live
   server") don't affect them.
8. **Splits and other corporate actions don't follow the shares' holders yet** (scenario 41;
   Kael: later, with the books). A 2-for-1 split reads as VTI coming in, so the new shares land
   in Unallocated, and each fund holding VTI needs a move. The bank feed books a split as a buy
   today, which is wrong in the accounts too, so both are fixed together in the rest of B.
9. **An account can have a default fund:** what changes in it with no line saying otherwise is
   that fund's (the IRAs' is Retirement): [below](#an-accounts-default-fund).

**A's saved lines:** a USD-only transaction reads exactly as before. A trade with a `+` USD line
(A took a trade as a transfer in dollars) now reads as money out. It isn't refused, since lines
are checked only when they change, and its page says its lines don't fit. Expect few or none.

### In the books

Lines and moves already carry a commodity, and `fund_line` already has `currency`, so shares
need no migration. A default fund is a dated directive (Kael): from that day, the account's
unmarked changes are the fund's, until a later one for the account says otherwise (another
fund, Unallocated, or none).

```beancount
2019-04-01 custom "fund-default" Assets:Retirement:Roth-IRA "Retirement"

2026-11-04 custom "fund-move" "Unallocated" "Wedding" 50 FXAIX
  note: "Setting up"

2026-11-06 * "Fidelity" "Bought 10 VTI"
  funds: "Emergency -3000.00 USD; Emergency +10 VTI"
  Assets:Brokerage:Fidelity:Cash  -3000.00 USD
  Assets:Brokerage:Fidelity:VTI         10 VTI {300.00 USD}
```

A move with several amounts is one `fund-move` per commodity. They're written together, in one
write, with the same date and note.

### The ledger (Python)

- **`engine`:** `balance_sheet_units(text, roots)` gives each balance-sheet posting's units
  (`_amounts` already fills in a lone blank amount). It's None when a blank can't be filled
  without booking.
- **`fundlines`:**
  - `shape` becomes `shapes(text, header) -> dict[str, Shape] | None`, a `Shape` per commodity
    (its kind and size, as now), with the operating currency first.
  - `lines_problem(shapes, lines)` runs A's checks per commodity, worded with the commodity:
    "its funds get 12 VTI, more than the 10 VTI that came in". It also refuses a line in a
    commodity the transaction doesn't move: "it moves no VXUS (Wedding)". `_money` writes shares
    as they're given ("12 VTI", not "12.00 VTI").
  - `checked` drops "funds hold USD for now". "No fund twice" becomes per commodity ("Wedding is
    in it twice in VTI"). A line's commodity must be one the book has: declared, or held in an
    account.
- **`funds`:**
  - `listing`: each holding with its value and price (`FundHolding`: `amount`; `value`, null
    when there's no price; `price` and `price_date`, as `Holding` has them). It also gives a
    fund's `unpriced`, and `Funds.unallocated_holdings`: net worth's holdings per commodity
    (`chart.tree`'s top-level totals, which `listing` already reads) less the funds', valued the
    same way.
  - `_checked` (moves): any commodity the book has, more than 0.
  - `create_moves`: several moves in one write, `POST /books/{b}/fund-moves/batch` (write, like
    `/accounts/batch` and `/transactions/batch`).
  - `archive` and `history` already work per commodity.
- **Models:** `FundHolding`; `Fund.holdings: list[FundHolding]` (it was `list[Amount]`, unused
  by the PWA so far); `Fund.unpriced`; `Funds.unallocated_holdings`; `FundMovesIn`. Then `pnpm
  generate`.

### app (TypeScript, server)

- **`shared/funds.ts`:** `shapeOf` becomes `shapesOf(postings, currency)`, giving A's `FundShape`
  per commodity (its type already carries a currency). `wholeLines(shapes, fund)` gives the
  whole of every commodity. `linesProblem(shapes, lines)` is worded as the ledger words it.
  Unit tests mirror the ledger's. (`BALANCE_SHEET` still assumes the roots are named `Assets`
  and `Liabilities`, as in A.)
- **`server/funds.ts`:** `decidedLines` (a rule's fund on what it stages) writes whole lines per
  commodity.
- **Pairing** (`mergedLines`) already sums per fund and commodity.
- **Schedules:** nothing new beyond the shared rules.

### The PWA

- **The Funds section** (a transaction's page, New transaction, a schedule's template):
  - **One commodity on the balance sheet** (every USD transaction): as in A, unchanged.
  - **A trade** (one commodity out, another in): "**Bought 10 VTI for $3,000.00.** Without a
    fund, it's Unallocated's: its cash paid, and it holds the shares." Then two selects (Kael):
    **From fund**, the side that gives (the cash on a buy, the shares on a sale), and **To
    fund**, the side that gets. Each writes the whole of its side. To follows From until it's
    changed, so one choice covers a whole trade; changing To says, for instance, "Emergency's
    cash buys shares for Wedding". **Split it** (as More options) opens the groups below for
    parts of a side, and is open on its own when the lines aren't whole sides.
  - **Otherwise:** a group per commodity, each with A's rows and its own sentence ("$3,000.00
    going out", "10 VTI coming in"), verb, following first line and "+ Another fund".
  - **The summary** gives each fund's change across commodities, Unallocated last: "Emergency
    −$3,000.00 and +10 VTI · Unallocated no change".
  - **Below zero in a share is a problem,** and Save waits: "Emergency holds 8 VTI, not 10."
    Below zero in dollars stays a note, as in A.
  - **Share amounts are kept as typed;** money keeps its cents (A's decision 18).
  - In `web/lib/funds.ts`, rows gain a commodity. `amountsOf`, `linesOf`, `rowsProblem`,
    `effects`, `belowZero` and `wholeFund` take the per-commodity shapes, and `rowsFrom` groups
    saved lines by commodity. `useFundRows` keeps its shape for its callers.
- **Review cards** (`FundChoice`): A's one select (To fund, From fund or For fund) for one
  commodity; on a trade, **From fund** and **To fund**, To following From, as on the page. Lines
  that aren't whole sides show as chips with Edit…, as now. **Flagged sales come first** in
  Review (Kael), marked "Needs a fund".
- **Select mode's Fund…:** whole lines per commodity. "Skipped 1 not all in USD" goes. **Confirm
  skips a flagged sale** (Kael) and confirms the rest: "Confirmed 9; skipped 1 that needs a
  fund". The skipped one stays selected.
- **Chips:** a fund on both sides of a trade is one neutral chip ("Emergency", Kael), whose
  title has both lines. Different funds on each side get "from Emergency" and "to Wedding".
- **An account's Trade dialog** (buy, sell, dividend; M5) gets the same Funds choices (Kael): a
  trade's From fund and To fund (To following From, and the only-fund suggestion on a sale), a
  dividend's To fund. A sale whose shares are all in funds is recorded in one go. The ledger's
  `TradeIn` and `TradePreview` carry `funds`, checked as any transaction's are.
- **Move money:**
  - From and To as now. The amount becomes a row: Amount, and its commodity (a select: the
    operating currency, then what From holds, A–Z). "+ Another amount" adds a row, each
    commodity once.
  - **Shares or dollars** (Kael): a share's row has a Shares / Dollars switch (Shares to start
    with). In shares, it shows the value: "about $2,250.00 at $225.00 (Nov 3)". In dollars, it
    shows what that comes to: "$5,000.00 is 23.810 FXAIX at $210.00 (Nov 3)", at the latest price
    on or before the move's date (Kael). The move is saved
    in shares, rounded to the places the book already writes that commodity's quantities in
    (three, for most mutual funds). Dollars aren't offered for a commodity with no price.
  - The effect: "Unallocated −$4,000.00 and −100 FXAIX → Emergency +$4,000.00 and +100 FXAIX".
  - More dollars than From holds is a note, not a problem, as in A. More of a share than From
    holds is a problem, and Move waits: "Unallocated holds 10 FXAIX."
  - Several amounts are saved through `/fund-moves/batch`. Changing a move changes its one
    amount, as now.
- **The Funds page:** each fund's card gives its value, then its holdings in a muted line
  ("$4,000.00 · 100 FXAIX"). Unallocated, in the summary card, does the same. When Unallocated
  is below zero in a share: "Your funds hold 20 VTI more than your accounts do," linking to
  Notifications, where the sale that did it waits.
- **A fund's page:**
  - A **Holdings** card under its balance: each commodity with its quantity, price and price
    date (stale ones flagged, as on account pages), and value. The operating currency's row reads
    "Cash".
  - **History:** a transaction with two lines is one row with both amounts, each with its
    commodity's running balance.
  - **Archive…:** "What's left ($1,000.00, 100 FXAIX and 10 VTI, worth $25,000.00) goes to".
- **Home's Funds card:** unchanged (values).

### An account's default fund

Kael's Roth IRA and traditional IRA are wholly Retirement's. Marking every contribution,
dividend, reinvestment and trade in them would be a chore that never ends. Kael's earlier
**default fund** (the design record, "Decided so far": "any money entering that account also
enters the default fund", 2026-10-28 to 10-30) is the answer, put so it fits A's lines on the
transaction.

- **Each balance-sheet split counts for its account's default fund,** per commodity, or
  Unallocated where there's none. A node's default covers the accounts under it (a brokerage's
  `:Cash` and holdings), unless one of them has its own.
- **A line takes over from the side it's on:** a `+` line from the splits that went up, a `−`
  line from the splits that went down, as much as it says; the rest of each side stays with its
  accounts' defaults. A's kinds and caps (per commodity) still say what lines may be. With no
  defaults anywhere, everything falls to Unallocated: exactly A.
- **The IRAs, with Retirement as their default:**
  - a dividend, a reinvestment or a trade inside: Retirement's, with nothing marked. Retirement
    holds what the IRAs hold, unless money is moved out of it.
  - a $500 contribution from checking (`Checking −500 · Roth-IRA:Cash +500`): Unallocated −$500
    (checking's side) and Retirement +$500 (the IRA's). "From Emergency" on it takes over
    checking's side: Emergency −$500 instead.
  - a withdrawal to checking: Retirement down, Unallocated up.
- **Setting one:** an asset or liability account's editor (managers), "Default fund: None,
  Unallocated, or a fund", and **From** a date (Kael): the account's opening is offered first,
  then today. **Linking a bank account** (Bank connections) asks too (Kael), so a newly linked
  IRA or HSA starts out right: a new account's default starts at its opening, an existing
  account's from the date chosen. From the opening, it gives the fund the account's whole
  balance at once (everything its history brought in unmarked), so the IRAs need no setup moves.
  Changing it later starts the new default from its own date, and what came before stays where
  it was. The editor lists the account's defaults over time. **Before saving, it says what the
  default will do** (Kael): "From the opening, Retirement gets $1,204.50 and 120.4 FXAIX:
  everything in the Roth IRA now." (`POST /books/{b}/fund-defaults/preview`.)
- **The default fund idea's goals, and how this meets them:**
  1. *Money entering an account goes to its default with nothing marked:* income, dividends and
     transfers in alike ("an account's rule covers everything entering it", Kael, 2026-10-30).
     Met, per split.
  2. *Defaults work both ways:* what leaves the account comes from its default (Kael). Met.
  3. *A choice on the transaction overrides the default* ("an explicit fund on the receiving
     split overrides it"). Met: a line takes over its side.
  4. *Defaults win over conversions:* money entering an account with a default goes to it, even
     when another fund paid (Kael, 2026-10-30). Met: a line on the paying side never touches the
     receiving side.
  5. *Defaults route money; they don't pin balances* (the example book: Savings holds $18,000,
     Emergency's cash is $12,000). Met: money can be moved out of a default fund, and later
     money still lands in it. This is why the IRAs get a default, not the "belongs to" this plan
     first had: that pinned the fund to the account, with no way to override or redistribute.
  6. *Reinvestments land in a default, to be redistributed by moves* (Kael's first message).
     Met. The brokerage's default stays Unallocated for now (Kael).
  7. *Unallocated as an account's explicit default,* to keep its income out of autofill (Kael).
     The setting offers Unallocated apart from None; they act alike until fill rules exist.
  8. *Defaults take precedence over fill rules* (Kael). Nothing fills yet; fill rules would only
     see what defaults leave.
  9. *Changing a setting never rewrites history* (Claude, unchallenged). Met: defaults are
     dated (Kael).
  10. *Richer account rules later* (70/30 into an account). They'd plug in where a split's fund
      is decided.

  Left for the rest of B: the spend order (what's drawn once a default or Unallocated runs
  out). Conversions by value aren't needed: units and lines do that job.
- **Lines already saved** keep meaning what they did: a `+ Retirement` line on an old
  contribution takes over the IRA's side, which is Retirement's anyway, so nothing counts twice.
- **Limits:** a fund that's an account's default today can't be archived until the account has
  another default or none; renaming the fund rewrites its defaults (`funds.rename`). A change
  that would take a fund below zero in a share (a default from an earlier date, say) is refused,
  as any write by hand is.
- **A fund's page** lists the accounts it's the default of (each linking to its ledger), and its
  history lists every transaction their defaults gave it (Kael), so the history adds up to its
  balance. It gets long for the IRAs; it's one list, not paged, as in A.
- **Where it's built:**
  - the ledger: `custom "fund-default"` directives (`engine`: `FundDefault`,
    `default_directive`, `default_of`), with their own small API, versioned as moves are:
    `POST /books/{b}/fund-defaults` (account, fund or none, from), `PATCH` and `DELETE
    /books/{b}/fund-defaults/{id}` (manage). `Account.default_fund` gives today's;
  - `fundlines.effects(...)`: a transaction's change to each fund, per commodity, from its
    splits, their accounts' defaults and its lines. It's used by the checks, `funds.listing` (for
    transactions that touch an account with a default, beside `fund_line` for the rest) and
    `funds.history`;
  - `Funds.defaults` (each account's defaults, each with its fund and from when), so
    `shared/funds.ts` works out the same effects for the PWA's Funds section and its summary
    ("Retirement +$500.00 · Unallocated −$500.00").

### A sale that says no fund

Kael: such a sale is flagged on the transaction. Typed in by hand, it can't be saved; if it
came in by itself, it waits in Notifications until it's fixed.

- **What it is:** a transaction that takes more of a share (any commodity but the operating
  currency) from a fund than the fund holds: through a default, with no line saying so
  (Unallocated where the account has no default), or through a line. Only when it's short
  (Kael): selling 5 VTI while Unallocated holds 10 goes through quietly. "Holds" counts
  everything else in the book, whatever its date, as balances do. Step 6 of the walkthrough is
  one.
- **Typed in by hand, it can't be saved:** a write that changes a transaction's balance-sheet
  splits or its lines, or confirms it, and leaves it short, is refused (422: "It sells 20 VTI,
  and Unallocated has none: say whose shares they are"). The Funds section says so first, and
  Save waits, as it does for the cap. A write that does none of those (recategorizing, a note)
  isn't checked, as A's lines aren't.
- **Nor can anything else by hand make one:** a move, a default, or deleting a move or a
  transaction that would leave a fund below zero in a share is refused, saying which.
- **Come in by itself, it's saved and flagged:** imports, the bank feed's transactions and
  position changes, receipts and schedule occurrences are written by `app`, which says it's
  staging them, so the ledger keeps a short one, unconfirmed: a rule that would confirm it
  automatically leaves it in review instead. It's marked on its review card, its row and its
  page ("Needs a fund: it sells 20 VTI that Unallocated doesn't have"), and it waits in
  [Notifications](#notifications).
- **Fixed** by saving it with a line that makes it fit (the review card's From fund, or its page),
  or by deleting it. Then it leaves Notifications by itself: Kael's "dismissed on a successful
  save". **Confirm waits for a fund** (Kael): confirming is a save by hand, and the review
  card's From fund is right beside it. Flagged sales come first in Review.
- **The only fund that could have sold is suggested** (Kael): when exactly one fund holds enough
  of the share, the review card and the transaction's page come with From fund set to it
  ("Wedding, the only fund with 20 VTI"), and To following. It's written only when you confirm
  or save, so nothing is decided for you. With no such fund, From fund starts empty.
  (`web/lib/funds.ts`: `suggestedFund`, from the funds listing's holdings.)
- **In the ledger:** `fundlines.short(...)` (what a transaction is short of, by fund and
  commodity), `Transaction.short` on reads, the refusal on writes that don't say they're
  staging, and `GET /books/{b}/funds/short`: the book's short transactions, each with when it
  was added (its directive's `created_at`).
- **The Funds page** still warns when Unallocated is below zero in a share, and links to
  Notifications.

### Notifications

Kael: a "needs attention" queue, behind a bell at the top beside the camera.

- **The bell,** in the masthead beside the camera, for anyone who can write to the book. It's
  always there (Kael), with a count only when something's waiting; with nothing, Notifications
  says "Nothing needs you right now."
- **The Notifications page** (`/books/:book/notifications`, from the bell): the queue in the
  order things were added, oldest first. Each says what happened, when, and what to do, and
  opens what needs fixing (a transaction's page, coming back here).
- **Two kinds** (Kael): ones you can dismiss (×), and ones that go only when what's wrong is
  fixed (no ×: "Goes once it's fixed"). "A sale needs a fund" is the second kind, and step 1's
  only one (Kael): the queue is built for more, which come later.
- **Per book** (Kael): the bell counts and lists only the book you're in, as the camera works
  in it. Other books show theirs when you switch to them.
- **Only in the app** (Kael): no email in step 1.
- **A fixed problem can't linger:** a notification that waits on a condition isn't stored. It's
  the condition, asked for when the queue is read (here, the ledger's short transactions), so a
  fix made anywhere clears it. Dismissable ones will be stored in `app` (a `notification` table
  through `createTable`: book, kind, subject, words, `dismissed_at`).
  `GET /api/app/v1/books/:book/notifications` merges both, oldest first; `POST
  …/notifications/:id/dismiss` dismisses one. The PWA refreshes the count after a save and when
  the app comes back into view.

### Tests

- **Ledger** (`tests/test_funds.py`, A's 30 unchanged):
  - per-commodity shapes: a buy, a sale with `{}`, a reinvestment, shares moved between
    accounts, and a USD-only transaction reading as A
  - the cap and its wording per commodity; a fund once per commodity; a commodity the book
    doesn't have
  - moves of shares, and the batch
  - the listing's values, prices and unpriced holdings; Unallocated's holdings
  - archiving a fund that holds shares
  - default funds: a dividend, a trade and a contribution into an account with one; a line
    taking over its side; an old line counting once; no defaults reading exactly as A; a fund's
    history adding up to its balance; archiving refused while it's a default
  - short sales: refused by hand, kept when staging, cleared by a line, listed by
    `/funds/short`
- **app units:** `shared/funds.test.ts` mirroring the ledger (effects with defaults included);
  `web/lib/funds.test.ts` (per-commodity rows, following per group, To following From); bulk
  Fund… on a trade; `decidedLines`; staging a short sale from an import and a position change;
  the notifications list.
- **API suite** (`tests/e2e/src/funds.test.ts`): the walkthrough above, on a brokerage opened
  with holdings and prices, and an IRA with Retirement as its default.
- **Browser suite** (`tests/ui/src/funds.spec.ts`, and `notifications.spec.ts`):
  - Move money with two amounts, one typed in dollars
  - the Funds page's holdings and its warning
  - a fund's Holdings card, and the accounts it's the default of
  - a trade's From fund and To fund, on its page, on a review card and in the Trade dialog
  - a default fund chosen while linking a bank account
  - Select mode's Fund… on a trade, and Confirm skipping a flagged sale
  - an account editor's default fund, and the Funds section's summary with it
  - a short sale typed by hand that Save won't take; a staged one in the bell and on the
    Notifications page, gone once it's given a fund
- **Looked at:** every changed surface on a phone and a desktop, light and dark (RESUME,
  "Looking at screens"), with long fund names, fractional shares, negative holdings, an unpriced
  commodity, and the bell with nothing, one and many waiting.

### Shipping

`v0.1.15`. Then Kael upgrades Emmer, gives both IRAs Retirement as their default fund, divides
the brokerage among its funds (Move money from Unallocated, per the walkthrough), and works
through whatever the bell has.

### As built: where things are

- **Ledger** (`services/ledger/src/ledger`):
  - `engine.py`: `balance_sheet_units`, and the `fund-default` directive (`FundDefault`,
    `default_directive`, `default_of`; renaming an account carries it, deleting one drops it);
  - `fundlines.py`: per-commodity `shapes`, `lines_problem`, `checked`; `Defaults` (dated, the
    nearest account up); `effects` (lines, then each side by its accounts' defaults);
    `default_parts`, `fund_totals`, `share_holdings`; `guard` (no fund short of a share by hand)
    and `short`;
  - `funds.py`: `listing` (holdings with values and prices, `unpriced`, `accounts`,
    `unallocated_holdings`, `defaults`), `history` (with what defaults gave), `short`, moves of any
    commodity (`create_moves`, never leaving a fund short), defaults (`create_default`,
    `patch_default`, `delete_default`, `preview_default`), archive refused while a fund is a
    default, rename rewriting defaults;
  - `service.py`: `_guard` on every transaction write and deletion, skipped with `staging`;
    `investments.trade` takes `funds`; `store.py`: `balance_sheet_totals`,
    `transactions_touching`; the routes in `api.py` (`?staging=true` on transaction writes and
    directive deletes, `/fund-moves/batch`, `/fund-defaults` and `/preview`, `/funds/short`).
- **app server** (`services/app/src`): `shared/funds.ts` (`shapesOf`, `wholeLines`, `isTrade`,
  `linesProblem`, `fundFor`, `effectsOf`), `server/ledger.ts` (`Staging`, `STAGING`,
  `shortTransactions`), the pipelines writing as staging (imports, the bank feed's holdings and
  links, receipts, schedules, pairing and rejecting transfers, a match's "Not a match"),
  `server/notifications.ts` and `shared/notifications.ts`, and the route in `server/api.ts`.
- **PWA** (`services/app/src/web`): `lib/funds.ts` (rows per commodity, `effects`, `belowZero`,
  `wholeSide`, `suggestedFund`), `components/Funds.tsx` (`useFundRows`, `FundsFieldset` with
  `CommodityLines`, From and To for a trade, `FundChips`, `FundChoice`, `MoveMoneyDialog` with
  `MoveAmount`, `HoldingsLine`), `components/DefaultFund.tsx`, `components/NotificationsBell.tsx`,
  `pages/Notifications.tsx`, and the wiring in `Funds`, `FundPage`, `TransactionPage`,
  `ScheduleEditor`, `TradePage`, `Review`, `lib/bulk.ts`, `AccountEditor`, `BankConnections`,
  `App` (the bell and the route), `lib/queries.ts` and `lib/ledger.ts`; styles at the end of
  `styles.css` ("Funds B").
- **Tests:** the ledger's `tests/test_funds_b.py` (18, the walkthrough first; A's tests changed
  only where trades and other currencies now read per commodity); app units (`shared/funds.test.ts`,
  `web/lib/funds.test.ts`, `server/notifications.test.ts`, staging in the SimpleFIN test); the
  API suite's `funds-b.test.ts` (2) and the browser suite's `funds-b.spec.ts` (4).

**Where the build departed from the plan** (each easy to change):

1. **Default funds have their own small API** (`/fund-defaults`, versioned like moves) rather
   than the account's PATCH, and the editor reads them from the funds list (`Funds.defaults`);
   there's no `Account.default_fund`.
2. **On Bank connections, the default fund is set beside a linked account** ("Default fund:
   none", folded away), once the link is made, rather than in the link form: links made in the
   background are confirmed later, from their preview. It starts from the account's opening.
3. **A rule that would confirm a short import isn't special-cased:** imports and bank feeds land
   in cash (one commodity), and the bank feed's position changes are always staged unconfirmed,
   so nothing short arrives confirmed except a schedule's auto-confirmed occurrence, which stays
   confirmed and is listed.
4. **No table for dismissable notifications yet:** step 1 has none.
5. **Select mode's Confirm keeps the whole selection** when it skips a flagged sale (not just
   the flagged one), and says how many it skipped.
6. **The Trade page's Funds section comes with its preview;** a sale refused as short opens the
   preview, so a fund can be chosen.
7. **Share amounts are shown as plainly as they're held** (`10.000` is `10`).

### Decisions to review

Made without asking; each is easy to change.

1. **Funds read a transaction per commodity,** replacing A's single kind by value. It's the same
   for every USD-only transaction.
2. **By units, not cost:** booking is never needed, and a sale's gain needs no line.
3. **A fund once per commodity,** so a trade is one fund's two lines; marking one side alone is
   allowed.
4. **A line takes over from the side it's on;** the rest of each side stays with its accounts'
   defaults. Where one side's splits have different defaults, each gives way in proportion.
5. **Only commodities the book has** can be in a line or a move, so a typo can't make a new one.
6. **A move is one commodity;** several amounts are several moves, written together
   (`/fund-moves/batch`).
7. **Share amounts are kept as typed;** money keeps its cents.
8. **A fund's dollars are "Cash"** in its Holdings.
9. **B's old plan is now [the design record](design-record.md),** so this file can be the plan.
10. **Dollars become shares rounded** to the places the book already writes that commodity in,
    and the move keeps shares, not dollars: its value floats with the price from then on.
11. **"Short" counts the whole book, whatever the dates,** as balances do, so a backdated sale
    is judged against what funds hold now.
12. **"Came in by itself" means written by `app`'s pipelines** (imports, the bank feed, position
    changes, receipts, schedule occurrences). Everything saved from the PWA counts as by hand,
    and a transaction's write is checked only when it changes balance-sheet splits or lines, or
    confirms it.
13. **Notifications that wait on a condition aren't stored;** they're read from the condition,
    so they can't outlive it.

### Decided with Kael

Asked and answered on 2026-11-03:

1. **His other Fidelity accounts:** a Roth IRA and a traditional IRA, both wholly Retirement's.
   The Fidelity Visa is a card, not an asset, and needs nothing new.
2. **The brokerage's unmarked events** (dividends, reinvestments, and trades the bank feed
   stages) land in **Unallocated** in step 1, to be marked in review or moved later: the
   brokerage gets no default fund for now.
3. **Moving shares: either shares or dollars.** Move money takes a share amount in shares or in
   dollars, and dollars are turned into shares at the price on the move's date.
4. **A sale that says no fund is flagged on the transaction.** Typed in by hand, it can't be
   saved. Come in by itself, it goes into a "needs attention" queue: a **bell** at the top beside
   the camera, opening a **Notifications** page that lists the queue in the order it was added.
   Some notifications can be dismissed; others go only when what's wrong is fixed. This one is
   the second kind, gone on a successful save of the flagged transaction.
5. **The IRAs' "belongs to" was the default fund idea in another form,** and has to meet that
   idea's goals. It's now [an account's default fund](#an-accounts-default-fund), which does,
   goal by goal.
6. **A sale needs a fund only when it's short:** when the fund it draws on doesn't hold enough
   of the share, not whenever funds hold some.
7. **Confirm waits for a fund** on a flagged sale in review, like any save by hand; a rule that
   would confirm one automatically leaves it in review.
8. **No fund goes below zero in a share by hand:** lines and moves that would are refused, as
   the flag is. Dollars stay as in A.
9. **Default funds are dated,** from the account's opening or a day you choose, so changing one
   never rewrites history.
10. **The bell carries only the flagged sale in step 1;** it's built for more kinds later.
11. **The only fund that could have sold is suggested** on a flagged sale (when exactly one fund
    holds enough of the share), and written only when you confirm or save. No "in proportion"
    choice.
12. **Splits and corporate actions wait** for the rest of B, to be fixed with how the books
    record them.
13. **A fund's page shows value only:** quantity, price and value per holding, no gains. Funds
    hold shares, not lots.
14. **Setting up is Move money** (several amounts, in shares or dollars): no table of its own.
15. **They stay "Funds",** though they now hold mutual funds: holdings are always named by their
    ticker (FXAIX), never "mutual fund", so the two rarely meet in a sentence.
16. **The bell is always there,** with a count only when something's waiting.
17. **The bell is per book:** the one you're in.
18. **A fund's history lists every transaction its defaults gave it,** so it adds up to its
    balance; it's one list, as in A.
19. **Select mode's Confirm skips a flagged sale** and confirms the rest, saying so.
20. **A trade has "From fund" and "To fund"** (Kael's words): From is the side that gives, To the
    side that gets, and To follows From until it's changed.
21. **Dollars become shares at the move's date's price** (the latest on or before it).
22. **Flagged sales come first in Review,** marked, with From fund ready.
23. **The Trade dialog gets From fund and To fund** (a dividend's To fund), with the only-fund
    suggestion on a sale.
24. **A default fund is set in the account's editor and when linking a bank account.**
25. **The bell only, no email,** in step 1.
26. **A trade one fund made is one chip,** "Emergency", with both lines in its title.
27. **Divided accounts are left alone** in step 1; the rest of B decides whether to keep,
    convert or retire them.
28. **A default fund's editor says what it will do** before it's saved.
29. **The bell is for writers only;** viewers still see a transaction's "Needs a fund" mark.
30. **Step 1 ships as `v0.1.15`.**

## The rest of B

To be continued after we've shipped non-USD assets in funds.
