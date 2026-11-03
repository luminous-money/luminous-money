Funds: scenarios
==================================================================================================

> **For Funds B (2026-11-02):** Funds A (built, `v0.1.13`) has no rules at all: a fund changes
> only when a transaction names it, or by a move. These scenarios are B's: start from [the design
> record](design-record.md), "Picking up B". In A, a fund is chosen on the transaction (its
> lines), not on a split: read "marked" below that way. [B's plan](PLAN.md) takes shares in funds
> first (2026-11-03), which settles what level 5 needs to pick funds by hand; the rest waits.
>
> **Why this exists (2026-10-31):** the design got muddy, so we're restarting from cases. Below are
> 71 events, simplest first, each saying what we'd expect funds to do. We work backward from them
> to the rules, and see what to cut. All of them run against [the example book](example-book.md),
> each on its own from the baseline (the morning of 2026-11-10) unless it says otherwise.

Each scenario has:

- **Books:** the transaction as the books record it, with account names shortened.
- **Expect:** what we'd want funds to do. This is Claude's first draft of the gut feel, for Kael to
  confirm or correct.
- **Old rules:** what the model in [the design record](design-record.md) (as of 2026-10-30)
  does, summarized below.
- **Question,** where the expectation isn't obvious.

**⚠** marks a scenario where the old rules and the expectation part ways, or where the old rules
have no answer. [What the scenarios turn up](#what-the-scenarios-turn-up) groups them.

## The old rules, in brief

The design record has the reasons. These are what the "Old rules" lines apply:

1. **Only asset and liability splits move funds,** by their amounts, so a transaction's fund
   changes equal its change in net worth, per asset.
2. **Each split's fund:** the one chosen on it (marking an expense line puts the fund on the split
   that pays); else its account's **default**, which takes everything entering the account, is
   first in line for what leaves it, and wins over conversions; else:
   - **money out:** the **spend order** (Unallocated, Emergency, Home Repairs, Italy Trip), each
     only if it holds that asset, skipping funds that opted out; a shortfall takes Unallocated
     below zero;
   - **one asset out and another in** (a trade): the incoming asset goes to whoever gave up the
     outgoing one;
   - **income:** autofill; **anything else new** (a refund): Unallocated.
3. **Autofill:** income landing in an account with no rules of its own is shared out by percentage
   (Emergency 10%, Home Repairs 5%, Italy Trip 15%), each share rounded down to the cent, skipping
   funds at their targets (continuous by value, single by deposits); the rest goes to
   Unallocated.
4. **A group** (a house and its loans, a car and its loan, a loan alone, the 401(k)) is one asset
   to funds, held whole by one fund.
5. **Prices and revaluations** change values, never holdings.
6. **Each day's income** is processed before its other transactions.
7. **Moves between funds** are entries of their own.

**Budget funds** (Social, Chores, Family) are assumed to be topped up to their monthly amount from
Unallocated on the 1st. That's Claude's lean; it isn't decided.

## Level 1: one account, nothing chosen

### 1. Buy a hot dog with cash

$4 from the wallet.

- **Books:** `Wallet −4 · Restaurants +4`
- **Expect:** Unallocated −4 (its cash, $8,240, becomes $8,236).
- **Old rules:** the same. Nothing is chosen and the wallet has no default, so the spend order
  starts with Unallocated.

### 2. Coffee on a credit card

$6 on the Visa.

- **Books:** `Visa −6 · Restaurants +6`
- **Expect:** Unallocated −6, when it's bought, not when the card is paid.
- **Old rules:** the same: a liability split moves funds like an asset split.

### 3. Pay the credit card

The Visa's $1,200 statement, from Joint.

- **Books:** `Joint −1,200 · Visa +1,200`
- **Expect:** nothing. The spending was counted when it happened.
- **Old rules:** the same: both sides are USD and unmarked, so they cancel.

### 4. Cash from an ATM, with a fee

$100 from Joint, with a $3 fee.

- **Books:** `Joint −103 · Wallet +100 · Bank-Fees +3`
- **Expect:** Unallocated −3. Only the fee changed net worth.
- **Old rules:** the same.

### 5. Interest on savings

$45 into Savings.

- **Books:** `Savings +45 · Interest −45`
- **Expect:** Emergency +45: interest earned by the emergency money is emergency money.
- **Old rules:** the same: Savings' default (Emergency) takes what enters it, ahead of autofill.

### 6. ⚠ Interest on checking: autofill on pennies

$3.17 into Joint.

- **Books:** `Joint +3.17 · Interest −3.17`
- **Expect:** Unallocated +3.17.
- **Old rules:** it's income into an account with no rules, so it's autofilled: Emergency $0.31,
  Home Repairs $0.15, Italy Trip $0.47, Unallocated $2.24.
- **Question:** which income should autofill? In the books, interest, cash back (7) and gifts (17)
  are all income.

### 7. ⚠ Cash back on a credit card

A $25 statement credit on the Visa.

- **Books:** `Visa +25 · Rewards −25`
- **Expect:** Unallocated +25.
- **Old rules:** autofilled, as in 6: $2.50, $1.25, $3.75, and Unallocated $17.50.

## Level 2: choosing a fund, and moving money between accounts

### 8. The same restaurant three times in a month (Kael's example)

All on the Visa, all `Restaurants`: $18 out with a friend (marked Social), $24 grabbing food while
running errands (Chores), $38 as a family (Family).

- **Expect:** Social −18 (to $92), Chores −24 (to $116), Family −38 (to $142). Seen as budgets:
  Social has spent $58 of November's $150, Chores $84 of $200, Family $158 of $300. The account
  says *what* (restaurants), the fund says *why*.
- **Old rules:** the same fund changes. How budget funds are shown isn't designed (the design
  record, open question 1).

### 9. ⚠ Over budget

A $140 dinner on the Visa, marked Social, which has $110.

- **Expect:** Social −140, to −$30, flagged "over by $30".
- **Old rules:** a chosen fund may overdraw, and it's flagged. What happens at the month's end
  isn't decided: under "top up", December's top-up costs $180; under "reset", Unallocated absorbs
  the $30.
- **Question:** which?

### 10. Forgot to mark it

A $30 lunch, unmarked, then marked Social a week later.

- **Expect:** Unallocated −30; once it's marked, Social −30 instead, and Unallocated gets its $30
  back.
- **Old rules:** the same. Re-marking also shifts what the rules decided after it (67).

### 11. Move money to savings

$1,000 from Joint to Savings.

- **Books:** `Joint −1,000 · Savings +1,000`
- **Expect:** Emergency +1,000, Unallocated −1,000: putting money in savings is saving it for
  emergencies.
- **Old rules:** the same. Savings' default takes what enters it, and the sending side comes from
  Unallocated by the spend order. Emergency goes up even if it's already at its target (defaults
  beat targets).

### 12. ⚠ Take money out of savings

$2,000 from Savings to Joint, to keep checking topped up.

- **Books:** `Savings −2,000 · Joint +2,000`
- **Expect:** depends on why. To cover an emergency: Emergency −2,000. Just moving cash where it's
  handy: nothing.
- **Old rules:** always Emergency −2,000 and Unallocated +2,000. Savings' default is first in line
  for what leaves it, and Joint has no default, so the money arrives as Unallocated's.
- **Question:** should moving money between your own accounts ever move funds, unless you say so?

### 13. ⚠ Pay the credit card from savings

$1,200 from Savings to the Visa.

- **Books:** `Savings −1,200 · Visa +1,200`
- **Expect:** nothing, as in 3: the spending was counted when it happened.
- **Old rules:** Emergency −1,200, Unallocated +1,200. "Paying the card moves no fund" only holds
  when the paying account has no default.

### 14. Personal spending money

Alex buys a $60 game from Alex-Checking, then $80 of groceries for the household from the same
account.

- **Expect:** Alex's Money −60. The groceries: Unallocated −80 if Alex marks them that way (or a
  rule does), Alex's Money −80 if not.
- **Old rules:** the same: Alex-Checking's default pays first. Marking a split "Unallocated" has
  to be possible.

### 15. ⚠ Dinner for three; the friends pay you back

$120 on the Visa. The friends owe $80, booked as a receivable; Alex's share is marked Social. A
week later they pay $80 into Joint.

- **Books:**
  ```
  Visa                   -120
  Restaurants              40   ; marked Social
  Receivables:Friends      80
  ```
  then `Receivables −80 · Joint +80`.
- **Expect:** Social −40. The repayment: nothing.
- **Old rules:** the mark goes on "the split that pays", the Visa's −120: Social −120, and the
  receivable's +80 arrives as Unallocated's. Getting Social −40 means cutting the Visa split in two
  (−40 for the dinner, −80 for the loan). The repayment: nothing.
- **Question:** should a mark on an expense line simply mean "this fund pays this amount"? With
  one asset in the transaction (USD here), that's never ambiguous.

### 16. ⚠ The Walmart trip (Kael's example)

$60 of groceries and a $40 table lamp: $50 from the Walmart gift card, $50 on the Visa. The lamp
is marked Home Repairs.

- **Books:** `Walmart-Card −50 · Visa −50 · Groceries +60 · Furnishings +40 (marked Home Repairs)`
- **Expect:** Home Repairs −40, Unallocated −60. Which payment "paid for" the lamp doesn't matter.
- **Old rules:** a mark lands on a paying split, so the transaction has to be cut into pairs first
  (the lamp paid by which?). It's the question in 15.
- **Also:** the gift card's $50 was Unallocated's cash, though it's only good at Walmart.
  Restricted money counted as spendable comes up again with the HSA (27) and escrow (47).

### 17. ⚠ A gift card as a present

A $100 Amazon gift card from a relative.

- **Books:** `Amazon-Card +100 · Gifts −100`
- **Expect:** Unallocated +100, or a fund you choose.
- **Old rules:** it's income into an account with no rules, so it's autofilled: Emergency gets $10
  of Amazon credit, and so on.

## Level 3: income

### 18. ⚠ A paycheck (Kael's example)

Alex's biweekly pay: $4,200 gross, with taxes and a health premium withheld, contributions to the
401(k) and the HSA, and the net pay split across three accounts. The employer adds a $125 401(k)
match.

- **Books:**
  ```
  Income:Salary:Acme       -4200.00
  Expenses:Taxes:Federal     500.00
  Expenses:Taxes:State       180.00
  Expenses:Taxes:FICA        320.00
  Expenses:Insurance:Health  150.00
  Assets:HSA                 100.00
  Assets:Retirement:401k     250.00
  Assets:Bank:Joint-Checking 2000.00
  Assets:Bank:Savings        500.00
  Assets:Bank:Alex-Checking  200.00

  Income:Employer-Match      -125.00
  Assets:Retirement:401k      125.00
  ```
- **Expect:** Health +100, Retirement +375, Alex's Money +200, and Emergency +500 (the savings
  deposit is the emergency saving). And the $2,000 in Joint: autofilled? If so, 10% of what?
- **Old rules:** each account's rule first, then autofill on the rest. Health +100, Retirement
  +375 (the 401(k) group), Alex's Money +200, Emergency +500 (Savings' default) and another +200
  (10% of Joint's $2,000), Home Repairs +100, Italy Trip +300 ($6,500 deposited), Unallocated
  +1,400. That's +3,175 in all, the paycheck's change in net worth.
- **Questions:** Emergency gets the savings deposit *and* its 10%: is that double? And 10% of
  what: the gross ($4,200), the net ($2,700), or what landed in accounts without rules ($2,000)?

### 19. ⚠ Freelance income, and its taxes

Sam is paid $1,800 into Joint, with nothing withheld; about a quarter of it will be owed in tax. In
January, $1,350 of estimated tax goes out of Joint.

- **Books:** `Joint +1,800 · Freelance −1,800`, later `Joint −1,350 · Taxes:Federal +1,350`
- **Expect:** $450 set aside for taxes from this income, and the tax payment drawn from it later.
- **Old rules:** autofill doesn't know where income came from: Emergency +180, Home Repairs +90,
  Italy Trip +270, Unallocated +1,260. The tax payment: Unallocated −1,350. Per-account rules
  can't help, because the money lands in Joint with the salary.
- **Question:** rules by income account ("25% of `Income:Freelance` to Taxes")? Autofilling only
  from `Income:Salary` was rejected as fragile; this is a different use.

### 20. ⚠ A tax refund

$1,200 into Joint.

- **Books:** `Joint +1,200 · Taxes:Federal −1,200`
- **Expect:** unclear. It's your own pay coming back late, so autofill it like pay? Or put it in
  Unallocated?
- **Old rules:** Unallocated +1,200 (refunds aren't income).

### 21. A bonus fills a goal

A $15,000 net bonus into Joint.

- **Books:** `Joint +15,000 · Salary:Acme −15,000`
- **Expect:** Emergency +1,500 (worth $19,500, still under target), Home Repairs +750, Italy Trip
  +1,800 (all it needed to reach $8,000 deposited), Unallocated +10,950 (its 70% plus Italy's
  unused $450).
- **Old rules:** the same. A fund that reaches its target partway through income takes only what
  it needs, and the rest goes to Unallocated.

### 22. Birthday money for the trip

A relative gives $200 cash "for your trip"; it's marked Italy Trip.

- **Books:** `Wallet +200 · Gifts −200 (marked Italy Trip)`
- **Expect:** Italy Trip +200, counted toward its target ($6,400 deposited). No autofill.
- **Old rules:** the same: a chosen fund beats the fill rules.

## Level 4: goals, big bills and refunds

### 23. Spend $5,000 on vacation (Kael's example)

Flights $1,400 on the Visa, the hotel $2,600 on the Amex, tours $1,000 from Joint, all marked
Italy Trip. Italy Trip holds $1,500 of cash and 20 VTI ($6,000).

- **Expect:** Italy Trip −5,000, worth $2,500. Its cash is −$3,500 while it holds $6,000 of VTI:
  "short of cash", fixed by selling its shares (35). Spending doesn't reopen single fill.
- **Old rules:** the same.
- **Question:** is "short of cash" useful, or noise? The fund still has the value.

### 24. ⚠ Gas on a road trip for fun (Kael's example)

$50 on the Visa, `Auto:Fuel`, on a weekend road trip. No fund is for it.

- **Expect:** unclear. Seeing what the trip cost (gas, food, a motel) is what a tag does
  (`#road-trip`). Having it come out of a "Fun" budget is what a fund does. Probably both.
- **Old rules:** Unallocated −50.
- **Question:** where does a tag end and a fund begin? (The design record, open question 3.)

### 25. ⚠ A hotel bigger than what's left for it

A $3,000 hotel when Italy Trip has $1,000 left. You want Italy Trip to pay what it has, and the
rest to come from wherever unmarked money comes from.

- **Expect:** Italy Trip −1,000; the other $2,000 by the spend order (Unallocated).
- **Old rules:** a chosen fund pays the whole split (Italy Trip −3,000, short $2,000), unless you
  cut the expense line in two: $1,000 marked and $2,000 not.
- **Question:** should "this fund first, then the usual" be a kind of mark?

### 26. ⚠ An unmarked car repair when Unallocated is short

$1,800 on the Visa, when Unallocated has $1,000 of cash.

- **Expect:** Unallocated −1,000, Emergency −800. That's what emergency money is for.
- **Old rules:** the same. But an $1,800 TV would draw on Emergency the same way: the spend order
  can't tell a repair from a TV.
- **Question:** should unmarked spending ever draw beyond Unallocated? The alternative is that
  Unallocated goes negative and says so, and you decide which fund covers it. That would remove
  the spend order altogether.

### 27. ⚠ A huge bill drains every fund

A $25,000 hospital bill on the Visa, unmarked.

- **Expect:** unclear. It's medical, so Health (the HSA's $3,200) seems the first to pay, then
  Emergency.
- **Old rules:** Unallocated −8,240, then Emergency −12,000, Home Repairs −3,000 and Italy Trip
  −1,500, and the last $260 takes Unallocated below zero. Health is skipped (it's opted out).
  Emergency and Italy Trip keep their VTI, since spending USD never sells shares: Unallocated is
  at −$260 while Emergency holds $6,000 of VTI.

### 28. A pharmacy charge on the HSA card

$35.

- **Books:** `HSA −35 · Medical +35`
- **Expect:** Health −35.
- **Old rules:** the same: the HSA's default (Health) pays first.

### 29. Reimburse yourself from the HSA

A $500 bill was paid on the Visa in the spring (Unallocated paid it). Now $500 goes from the HSA to
Joint.

- **Books:** `HSA −500 · Joint +500`
- **Expect:** Health −500, Unallocated +500: Health pays Unallocated back.
- **Old rules:** the same. Here, defaults working both ways give what you'd expect (compare 12).

### 30. ⚠ Return something a fund paid for

The lamp from 16 (Home Repairs paid $40) goes back, refunded to the Visa.

- **Books:** `Visa +40 · Furnishings −40`
- **Expect:** Home Repairs +40, back to the fund that paid.
- **Old rules:** Unallocated +40 (refunds go to Unallocated), unless the refund is marked Home
  Repairs.
- **Question:** should a refund find its purchase's fund (history and the AI can often pair them),
  or be marked by hand?

### 31. ⚠ Insurance pays for a repair

After 26 (Emergency paid $800), the insurer sends $1,500 to Joint.

- **Books:** `Joint +1,500 · Auto:Repairs −1,500`
- **Expect:** Emergency +800 first, refilling what it paid, then Unallocated the rest? Or leave it
  to Emergency's continuous fill to catch up over time?
- **Old rules:** Unallocated +1,500.

### 32. A work trip, reimbursed

A $400 hotel on the Visa, booked to a receivable; the employer repays it into Joint two weeks
later.

- **Books:** `Visa −400 · Receivables:Employer +400`, later `Receivables −400 · Joint +400`
- **Expect:** nothing, either time.
- **Old rules:** the same. Booked as an expense and then refunded, it's Unallocated −400 and
  later +400.

## Level 5: investments

### 33. Buy shares

10 VTI with $3,000 of the brokerage's cash, unmarked.

- **Books:** `Brokerage:Cash −3,000 · Brokerage:VTI +10 {300}`
- **Expect:** Unallocated −$3,000 and +10 VTI.
- **Old rules:** the same: the brokerage's default (Unallocated) pays and takes the shares. To
  invest Home Repairs' cash instead, mark it Home Repairs.

### 34. ⚠ Sell shares, unmarked

10 VTI for $3,100.

- **Books:** `Brokerage:VTI −10 {300} · Brokerage:Cash +3,100 · Capital-Gains −100`
- **Expect:** unclear: somebody's shares are sold. Probably in proportion to who holds them
  (Emergency 5, Italy Trip 5), with the cash going back to them.
- **Old rules:** Unallocated holds no VTI, so the spend order takes Emergency's 10. The $3,100 goes
  to the brokerage's default, Unallocated, since defaults win over conversions. So Emergency −10
  VTI and Unallocated +$3,100: an unmarked sale moves $3,000 of value out of Emergency.

### 35. ⚠ Sell a fund's shares to cover its cash

After 23, sell 12 of Italy Trip's VTI for $3,600, marked Italy Trip.

- **Expect:** Italy Trip −12 VTI and +$3,600; its cash is back to +$100.
- **Old rules:** the same, if the mark covers both sides of the trade. If only the shares are
  marked, the cash goes to the brokerage's default (Unallocated), as in 34.
- **Question:** is a mark per split, or per transaction?

### 36. Move shares between funds (Kael's original example)

"Move 10 VTI from Italy Trip to Home Repairs."

- **Expect:** Italy Trip −10 VTI, Home Repairs +10 VTI. No account, transaction or tax lot
  changes.
- **Old rules:** the same: a move between funds.

### 37. A price drop

VTI falls from $300 to $255.

- **Expect:** no entries. Emergency is worth $17,100 (from $18,000) and Italy Trip $6,600.
  Emergency keeps autofilling.
- **Old rules:** the same.

### 38. A price rise past a target

VTI rises to $420.

- **Expect:** Emergency is worth $20,400, over its $20,000 target, so it drops out of autofill;
  its 10% goes to Unallocated until it falls back below.
- **Old rules:** the same.

### 39. ⚠ A dividend in the taxable brokerage

$52 of VTI dividends, in cash. Emergency and Italy Trip own all the VTI.

- **Books:** `Brokerage:Cash +52 · Dividends −52`
- **Expect:** unclear. The income came from Emergency's and Italy Trip's shares, so $26 each (the
  original requirement 1: "each goal's value moves with what it actually holds")? Or one default
  fund (the original requirement 3: "reinvestments land in a default goal")?
- **Old rules:** Unallocated +52, the brokerage's default (set to Unallocated to keep dividends out
  of autofill).

### 40. ⚠ The same dividend, reinvested

Reinvested as 0.17 VTI.

- **Expect:** as in 39.
- **Old rules:** Unallocated +0.17 VTI. Over the years, Unallocated piles up shares that
  Emergency's and Italy Trip's earned, to be moved back by hand.

### 41. ⚠ A stock split

VTI splits 2-for-1: 40 shares become 80.

- **Books:** `Brokerage:VTI −40 {300} · Brokerage:VTI +80 {150}`
- **Expect:** each fund's shares double: Emergency 40, Italy Trip 40.
- **Old rules:** no rule fits. The 40 leaving come from Emergency and Italy Trip (by the spend
  order), and the 80 arriving go to the brokerage's default, Unallocated. Netted first instead,
  Unallocated gets the 40 new shares. Either way it's wrong.
- **Question:** do corporate actions (splits, mergers, spin-offs) follow the holders?

### 42. Rebalance inside the Roth IRA

Sell 200 FXNAX ($2,000), buy 10 FXAIX.

- **Expect:** Retirement −200 FXNAX and +10 FXAIX.
- **Old rules:** the same: the Roth's default (Retirement) works both ways.

### 43. Quarterly dividends reinvested across the Roth IRA's mutual funds (Kael's example)

FXAIX pays $66 (reinvested as 0.33 FXAIX), FTIHX $120 (7.5 FTIHX), FXNAX $28 (2.8 FXNAX), and the
cash earns $4 of interest.

- **Books:** four of these, one per payment: `Roth:FXAIX +0.33 {200} · Dividends −66`
- **Expect:** all of it Retirement's.
- **Old rules:** the same: the Roth's default. It's easy because one fund holds the whole account;
  44 is the hard version.
- **Note:** "funds" also means mutual funds (FXAIX is one), as in Kael's own wording of this
  example. The name may collide.

### 44. ⚠ The same, where several funds own the shares

The taxable brokerage's VTI (Emergency and Italy Trip) and VXUS (Home Repairs and Unallocated)
both pay dividends, reinvested.

- **Expect:** as in 39: each fund's dividends follow its shares, or one default takes them all.
- **Old rules:** all Unallocated's.

### 45. ⚠ Invest the emergency savings

$5,000 from Savings to the brokerage, then 16 VTI bought with it.

- **Books:** `Savings −5,000 · Brokerage:Cash +5,000`, then
  `Brokerage:Cash −4,800 · Brokerage:VTI +16 {300}`
- **Expect:** still Emergency's, in another form: Emergency −$4,800 of cash and +16 VTI.
- **Old rules:** Savings' default (Emergency) pays and the brokerage's default (Unallocated)
  receives, so the $5,000 becomes Unallocated's, and so do the shares. Keeping it Emergency's
  means marking both the transfer and the purchase.
- **This is the original problem:** the brokerage holds several funds' money, but its default
  (chosen to keep dividends out of autofill) treats everything entering it as Unallocated's.

## Level 6: houses, cars and loans

### 46. Update the value of your home (Kael's example)

Revalued from $420,000 to $435,000.

- **Books:** `Home +15,000 · Unrealized-Gains −15,000`
- **Expect:** the Home fund is worth $125,000 (from $110,000). No entries, no autofill.
- **Old rules:** the same: the Home group's value changes, like a price.

### 47. A mortgage payment

$2,100 from Joint: $700 of principal, $1,150 of interest, and $250 of escrowed tax and insurance
(booked straight to expenses).

- **Books:** `Joint −2,100 · Mortgage +700 · Mortgage-Interest +1,150 · Property-Tax +200 ·
  Home-Insurance +50`
- **Expect:** Unallocated −2,100 of cash; the Home fund +700 of equity.
- **Old rules:** the same: the cash comes by the spend order, and the principal buys into the Home
  group, which goes to the group's fund. (Kael also wants to see the whole payment as a monthly
  expense: the Loans thread.)
- **Variant:** escrow booked to `Assets:Escrow` is USD you can't spend. It probably belongs in the
  Home group, like the gift card question in 16.

### 48. Take out a HELOC (Kael's example)

$30,000 drawn into Joint for a kitchen remodel. The HELOC was attached to the Home group when it
was opened.

- **Books:** `Joint +30,000 · HELOC −30,000`
- **Expect:** the Home fund trades $30,000 of equity for $30,000 of cash. It's the house's money.
- **Old rules:** the same: borrowing against the house sells Home for cash, and the cash goes to
  the fund that gave Home up. The Home fund is opted out of the spend order, so its cash is spent
  only by marking it.

### 49. ⚠ The remodel

After 48, $30,000 is paid from Joint for the remodel.

- **Expect:** marked Home. If it's capitalized (`Home +30,000`, raising the house's value), the
  Home fund's cash turns back into equity and its value doesn't change. If it's expensed, the Home
  fund is $30,000 poorer.
- **Old rules:** the same when it's marked. Unmarked, the spend order drains Unallocated, then
  Emergency, Home Repairs and Italy Trip, while the HELOC's cash sits in the Home fund.

### 50. The house goes underwater

Revalued to $280,000, against the $310,000 mortgage.

- **Expect:** the Home fund is worth −$30,000.
- **Old rules:** the same. With one fund per group, a negative group just shows as negative.

### 51. A car payment, and the car losing value

$350 from Joint ($320 of principal, $30 of interest). Later the car is revalued $2,000 lower.

- **Expect:** Unallocated −350 of cash and +320 of car equity; then −2,000 of car value.
- **Old rules:** the same: the Car group's fund is Unallocated.
- **Note:** Unallocated holds the car ($8,500) and the student loan (−$22,000), so it's worth
  −$2,010 while holding $8,240 of cash. Is Unallocated a confusing place to keep them?

### 52. A student loan payment

$280 from Joint ($200 of principal, $80 of interest).

- **Books:** `Joint −280 · Student +200 · Student-Loan-Interest +80`
- **Expect:** Unallocated −280 of cash and +200 toward the loan (it holds the loan's group).
- **Old rules:** the same.

### 53. ⚠ Buy a car with a loan

A $26,000 car: $6,000 down from Joint and a $20,000 loan.

- **Books:** `New-Car +26,000 · Joint −6,000 · Auto-Loan-2 −20,000`
- **Expect:** Unallocated −6,000 of cash, and a new car group worth $6,000, held by whichever fund
  you choose.
- **Old rules:** the car (a revalued account) is grouped automatically, and the loan joins it when
  you answer the prompt. Until then the loan is plain USD: Unallocated's cash reads $20,000 lower,
  and unmarked spending starts drawing on Emergency.
- **Question:** when does a new account join a group? Imports and bank links create accounts
  without asking.

### 54. Sell the old car

Sold for $15,000 (it was valued at $18,000). The $9,500 loan is paid off from the sale and $5,500
lands in Joint.

- **Books:** `Joint +5,500 · Auto +9,500 · Car −18,000 · Loss-On-Sale +3,000`
- **Expect:** Unallocated gives up its $8,500 of car equity and gets $5,500 of cash, worth $3,000
  less.
- **Old rules:** the same: a conversion back to the group's fund.

### 55. ⚠ Refinance the mortgage

A new $313,000 mortgage pays off the $310,000 one, with $3,000 of closing costs.

- **Books:** `Mortgage +310,000 · Mortgage-2 −313,000 · Closing-Costs +3,000`
- **Expect:** the Home fund −3,000.
- **Old rules:** the same, if the new mortgage joins the Home group. If it hasn't yet, the Home
  fund gains $310,000 (its loan paid off) and Unallocated's cash reads $313,000 lower.
- **Question:** is group membership dated, like settings?

### 56. Sell the house

Sold for $450,000 (valued at $420,000), with $27,000 of costs. The $310,000 mortgage is paid off,
and $113,000 lands in Joint.

- **Books:** `Joint +113,000 · Mortgage +310,000 · Selling-Costs +27,000 · Home −420,000 ·
  Capital-Gains −30,000`
- **Expect:** the Home fund turns $110,000 of equity into $113,000 of cash. It stays "the house
  money" until it's moved, or until the next house is bought (71).
- **Old rules:** the same.

## Level 7: retirement and tax-advantaged accounts

### 57. Contribute to the Roth IRA

$500 from Joint.

- **Books:** `Joint −500 · Roth:Cash +500`
- **Expect:** Retirement +500, Unallocated −500.
- **Old rules:** the same.

### 58. Trades inside the 401(k)

Sell 400 VFFVX and buy a bond fund with it.

- **Expect:** nothing: Retirement still holds one 401(k) worth $60,000.
- **Old rules:** the same: the 401(k) is grouped.

### 59. ⚠ Liquidate some 401(k) holdings and take an early withdrawal with a penalty (Kael's example)

Sell 200 VFFVX ($5,000) inside the 401(k), then withdraw the cash: 20% federal withholding
($1,000), the 10% penalty ($500, withheld here for simplicity), and $3,500 into Joint.

- **Books:** the sale (inside the group), then
  `401k −5,000 · Taxes:Federal +1,000 · Taxes:Early-Withdrawal-Penalty +500 · Joint +3,500`
- **Expect:** Retirement −5,000; the $3,500 lands where it was meant to go (it was taken out for an
  emergency, so Emergency or Unallocated); the $1,500 of tax and penalty is gone.
- **Old rules:** Retirement gives up $5,000 of 401(k) and gets the $3,500 of cash (a conversion,
  since Joint has no default). Retirement is opted out of the spend order, so the cash sits there
  until it's marked or moved.

### 60. ⚠ Borrow from the 401(k)

A $10,000 loan from the 401(k) into Joint, repaid by payroll deduction.

- **Books:** `401k −10,000 · Joint +10,000` (shares sold, cash to you), and
  `401k:Loan +10,000 · Loans:401k −10,000` (the plan holds your note; you owe it)
- **Expect:** Retirement's value holds (you're lending to yourself and will repay it), and the
  cash goes to whatever it was borrowed for (say Unallocated, with the debt).
- **Old rules:** it depends on where the loan is grouped. Attached to the 401(k) (it's secured on
  it), the group shrinks by $10,000 and Retirement holds the $10,000 of cash. As a loan grouped on
  its own and held by Unallocated, Unallocated gets the cash and the debt, and Retirement doesn't
  change. The second matches the expectation.

### 61. Roll the 401(k) over to an IRA

After leaving Acme, the whole 401(k) ($60,000) moves to a new rollover IRA (default Retirement,
not grouped), which then buys mutual funds.

- **Expect:** Retirement's one 401(k) holding becomes $60,000 of cash, then shares. Its value
  doesn't change.
- **Old rules:** the same: leaving a group is a conversion back to its fund, and the IRA's default
  takes what enters it.

## Level 8: time, setup and settings

### 62. Put money toward a goal by hand

Move $500 from Unallocated to Italy Trip.

- **Expect:** Italy Trip +500, counted toward its target ($6,700 deposited).
- **Old rules:** the same: moves in count, moves out subtract.

### 63. Finish a goal

After the trip, Italy Trip is retired; what's left (cash and shares) moves to Unallocated.

- **Expect:** a dated move of everything it holds; Italy Trip disappears from autofill and the
  spend order from that date.
- **Old rules:** the same.

### 64. Change a fund's settings from a date

From January 1, Emergency's target rises from $20,000 to $25,000 and Italy Trip's share from 15%
to 20%.

- **Expect:** nothing before January 1 changes.
- **Old rules:** the same: settings are dated versions.

### 65. ⚠ A new month for the budget funds

On December 1, Social has $50 left, Chores is at −$30 and Family at $0.

- **Expect** (if they're topped up from Unallocated on the 1st): Social +100, Chores +230, Family
  +300: $630 from Unallocated. If Unallocated has less cash than that on the 1st (payday is the
  5th), it goes negative for four days.
- **Old rules:** none: budget funds aren't designed (the design record, open question 1).

### 66. A paycheck and a bill on the same day

Unallocated has $200 of cash. On the same day, the paycheck (18) and a $1,500 insurance bill
arrive.

- **Expect:** the bill comes out of the paycheck: Unallocated (now $1,600) pays all of it, and
  Emergency is untouched.
- **Old rules:** the same: each day's income is processed first, whatever order the bank sync
  wrote them in.

### 67. ⚠ A late import changes history

On November 20, a $300 pharmacy charge dated November 3 arrives. On November 12, an unmarked
$1,800 repair took $1,000 from Unallocated and $800 from Emergency.

- **Expect:** unclear. Recomputing says the repair now took $1,100 from Emergency, so Emergency's
  past changes after the fact.
- **Old rules:** recompute: what the rules decide depends on everything before it. Chosen and
  default funds never move this way. It's hard to explain; "pinning" a rule's choice was the
  proposed answer.

### 68. Imports waiting in review

An $80 charge imported into Joint, not yet categorized. A $1,000 transfer from Joint to Savings,
imported as two halves a day apart and paired in review later.

- **Expect:** the charge: Unallocated −80 right away (the money's gone either way). The transfer:
  Joint's half reads as spending (Unallocated −1,000) and Savings' as money in (Emergency +1,000,
  by its default), which is what pairing them gives anyway (11).
- **Old rules:** the same: unconfirmed transactions count.

### 69. ⚠ Turn funds on for a book with years of history

Funds are switched on in a book with five years of transactions (as the live book will be after
its migration).

- **Expect:** you say what each fund holds as of a date ("Emergency: $12,000 and 20 VTI"), and
  funds work from there. Before that date, there are no funds.
- **Old rules:** not discussed. The pass replays the whole book: with no funds before the start,
  everything is Unallocated's, and an opening set of moves follows. Defaults and groups need start
  dates too (a house bought three years before funds began).
- **Question:** do funds start at a date, or replay all of history?

## Level 9: several things at once

### 70. Italy, end to end, in euros

$600 changed into €500 at the airport (a poor rate: $1.20 a euro), marked Italy Trip. €120 spent
on dinner in cash, unmarked. €380 brought home.

- **Books:** `Joint −600 (marked Italy Trip) · Wallet-EUR +500 EUR @ 1.20 USD`, then
  `Wallet-EUR −120 EUR · Restaurants +120 EUR`
- **Expect:** Italy Trip −$600 and +€500. The dinner: Italy Trip −€120 even though it's unmarked,
  since it's the only fund holding euros. The €380 stays Italy Trip's until the trip is retired
  (63).
- **Old rules:** the same: spending by asset does the right thing on its own.

### 71. ⚠ Move house

After selling the house (56; the Home fund holds $113,000 of cash): buy a new one for $500,000,
with $100,000 down from Joint, a $400,000 mortgage and $8,000 of closing costs.

- **Books:** `New-Home +500,000 · Joint −108,000 · Mortgage-New −400,000 · Closing-Costs +8,000`
- **Expect:** the Home fund pays the down payment and the costs. The new house and mortgage form a
  group held by the Home fund ($100,000), with $5,000 of cash left over: worth $105,000.
- **Old rules:** unmarked, the $108,000 from Joint comes by the spend order (Unallocated, then
  Emergency and the rest, then Unallocated below zero), not from the Home fund, which is opted
  out. The new group's fund is whatever the prompt is answered with. So it only works if the
  purchase is marked Home.

## What the scenarios turn up

Where the old rules and the expectation part ways (the ⚠ scenarios), by theme:

1. **Account defaults on transfers** (12, 13, 34, 35, 45). With defaults working both ways and
   winning over conversions, moving money between your own accounts reallocates it. That suits
   accounts that belong to one fund (the HSA, the Roth IRA, the 401(k): 29, 42, 57), and works
   against accounts several funds share (the brokerage, Savings).
2. **What a mark means** (15, 16, 25, 35). Marks on paying splits force transactions into pairs.
   What's wanted seems to be a mark on an expense line meaning "this fund pays this much", netted
   per asset; perhaps "this fund first, then the usual"; and a mark covering a whole trade.
3. **Which income autofills, and of what** (6, 7, 17, 18, 19, 20). The account-based rule
   autofills pennies and gift cards, fills Emergency twice on payday, and can't see where income
   came from.
4. **Money coming back** (30, 31). Refunds and insurance go to Unallocated, not to the fund that
   paid.
5. **What shares earn** (39, 40, 41, 44). Dividends and splits follow the account's default, not
   the shares' holders.
6. **The spend order past Unallocated** (26, 27). It quietly draws on savings for any unmarked
   purchase, and can't tell medical bills from a TV. Letting Unallocated go negative instead
   would remove a whole mechanism.
7. **Restricted money** (16, 27, 47). Gift cards, the HSA and escrow: counted as spendable, or
   not.
8. **Groups over time** (53, 55, 60, 69). New accounts, refinances and loans join groups after the
   fact, and in the meantime plain USD distorts everything.
9. **Unallocated as a catch-all** (51). It holds the car and the student loan, so its value and its
   cash say different things.
10. **History moving** (67, 69). What the rules decided changes when the past changes, and where
    funds start isn't decided.
11. **Budget funds** (8, 9, 65). Their period, top-up and display aren't designed.
12. **Naming** (43). "Funds" collides with mutual funds.

**What worked cleanly:** spending by asset (70), credit (2, 3), groups held by one fund (46–48,
50, 54, 56, 58, 61), defaults on single-purpose accounts (5, 28, 29, 42, 43, 57), moves (36, 62),
prices (37, 38), same-day order (66), and chosen funds generally (8, 10, 14, 22, 23).
