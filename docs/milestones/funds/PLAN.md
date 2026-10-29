Funds: plan
==================================================================================================

> **Status: being designed (2026-10-29), with Kael.** The next milestone, after M17. Nothing is
> built. This is meant to be enough on its own to carry the design forward: the problem, how we
> got here (and why each turn was taken), what's decided, the model as it stands, Claude's
> proposals waiting on Kael, and what hasn't been discussed yet. The verbatim conversation (Kael's
> scenario, Claude's worked example, Kael's answers and Claude's latest reply, which Kael means to
> answer) is in `discussion.private.md` beside this file. It uses real figures, so it's
> git-ignored (`docs/**/*.private.md`): it exists only on Kael's machines, and an agent working
> from GitHub won't have it. Examples here use made-up figures and names.

## The problem

Money is set aside for goals: an emergency fund, a vacation, home repairs, retirement. GnuCash
users do it with sub-accounts, the only way double-entry accounting offers, and M15's divided
accounts built the same thing here: an account's parts are its goals.

**What started it (Kael, 2026-10-27):** a taxable brokerage holding cash and two securities
(emergency money and short- to medium-term investments, treated as near-cash), whose whole value
is divided into four goals. What it must do:

1. **Fluctuations follow the holdings:** each goal's value moves with what it actually holds.
2. **Holdings move between goals:** "move 10 shares from home maintenance to the vacation."
3. **Reinvestments land in a default goal,** to be redistributed by internal moves if wanted.

Divided accounts couldn't: a linked brokerage's sub-accounts are its assets (`:Cash`, `:VTI`,
`:VXUS`: the bank link creates and expects them; `simplefin/sync.ts` puts cash in
`<account>:Cash`), a divided account's parts are its children, and an account tree can only
spell out one dimension.

**Kael's reframing (2026-10-28):** "A goal has nothing to do with *where* the money sits. We
usually think of goals as accounts because we don't have richer systems to work with, but we're
building a rich system now. Theoretically you should be able to allocate money from any account,
and any asset, toward a single goal." So:

- **Accounts say where money is; funds say what it's for.** Two ledgers over the same money.
- **Funds are comprehensive:** every dollar of net worth (every asset and liability, the house
  and retirement included) is in exactly one fund. What isn't earmarked is in **Unallocated**, a
  fund the system keeps. For every asset, the funds add up to net worth, always.
- **"$50 of the vacation money is in checking" isn't a fact.** You have $50 for the vacation,
  and you have $50 in checking. A hotel charged to a credit card draws the vacation fund when
  it's charged; paying the card later moves no fund.

## How we got here

1. **The brokerage, divided into goals (2026-10-27).** Claude laid out four ways:
   - **Goals as the accounts:** divide the brokerage into goal parts, each holding cash and
     securities together (a leaf may hold several commodities). Moving shares between parts is
     a transfer carrying their lots (cost and date). Needs: the link landing cash and trades in
     the main part, Divide… for a brokerage, holdings on each part. **The hard part is tax
     lots:** the books book lots per account, the broker per real account (FIFO for a stock,
     probably average cost for a mutual fund), so a sale booked inside one part can disagree with
     the 1099-B. The fix would be booking sales on the whole and swapping lots between parts.
     Claude recommended this one.
   - **An overlay of quantities** (`custom` entries; the default goal is whatever's left), with
     tax lots and the sync untouched; the cost is a second way to divide something, and goals
     that aren't accounts.
   - **Goal names as lot labels:** cash has no lots, FIFO sales use up whichever label is oldest,
     and average cost merges lots. Rejected.
   - **A goal under each asset** (`:VTI:Vacation`, `:Cash:Vacation`…): many accounts, and a
     goal's total needs adding up across branches. Rejected.

   Kael then stepped back from goals as accounts altogether (the reframing above). Funds never
   touch tax lots, which removes the first option's hard part.
2. **Kael's first sketch (2026-10-28), and what became of each point:**
   1. *"A separate overlay similar to tags; maybe they are tags."* Settled as different things
      (below), though Kael found the difference hazy.
   2. *"Applied at the split level; credits decrease a goal and debits increase it (reversed
      from accounts?)."* Settled: funds move with the asset and liability splits, in those
      splits' own sign, so a debit to an asset raises its fund, as with an asset account. The
      reversed reading only arises from tagging the expense split.
   3. *"Fund a goal in place with a transaction whose two splits are in the same account"*
      (`PNC −50 [Unallocated] / PNC +50 [Vacation]`). Claude first objected (a non-double-entry
      fact dressed as a transaction; with shares it would reduce and re-add tax lots), then
      agreed it fits the split rule for cash. The worked example uses separate fund-only moves
      instead. Which to offer is open (below).
   4. *"Transactions are untagged by default, so spending doesn't drain goals; but spending the
      whole balance would overstate them."* Settled by the spend order: unmarked spending draws
      Unallocated first and then the funds in order, worked out rather than stored.
   5. *"The goals ledger isn't double-entry."* Agreed.
3. **Goals located in accounts** (Claude's next take): a goal holds an amount of a commodity
   *in* a particular account ("free = balance − what's set aside there"), and a goal entry has
   its own amount, so $60 of a $100 purchase can come from the goal. **Dropped** after Kael's
   reply: location isn't a real dimension of a goal. A purchase partly for a goal is split into
   pairs (`PNC −60 / Equipment +60 [Vacation]` and `PNC −40 / Drinks +40`), and a hotel on the
   Visa is `Visa −1,000 [Vacation] / Travel +1,000`, nothing more. Claude conceded.
4. **Kael's implementation sketch (2026-10-28):** a separate ledger; every dollar tracked;
   Unallocated by default; funds with a fill priority and a spend priority; accounts with an
   optional default fund ("any money entering that account also enters the default fund");
   every split with a fund (Unallocated by default); an expense split marked with a fund is an
   egress from it; a transfer marked with a fund is an ingress into it; and "the asset and
   liability balance of every transaction must be equal in both systems." One correction: an
   unmarked transaction isn't zero movement (an unmarked expense lowers net worth, so a fund
   must go down). The last bullet became the defining rule: funds move with asset and liability
   splits.
5. **Kael's scenario and Claude's worked example (2026-10-28):** an imagined book (checking, a
   brokerage, a 401(k), a credit card, a house with a mortgage), four funds (Emergency:
   continuous fill to a target, 10% of income; a goal fund: single fill to a target, 20%;
   Retirement: manual, the 401(k)'s default; Unallocated: the rest), and twenty-odd events.
   What it established is listed below. Kael answered its decisions on 2026-10-29, and Claude
   explained the rest; that reply is waiting on Kael.

## Decided so far

Who decided is noted where it matters: **Kael**; **agreed** (both); **Claude, unchallenged**
(proposed and not objected to).

**What a fund is:**

- **Named "funds"** (Kael). A separate ledger tracks them; nothing in it is double-entry
  (agreed).
- **Every dollar, every asset** (Kael): the house and the 401(k) included.
- **Asset-aware** (Kael): a fund holds amounts of assets (USD, VTI, VXUS…), not just dollars.
  Spending USD draws only on funds' USD; a fund's value is its holdings at today's prices.
- **Funds and tags are different things** (Claude; Kael found it hazy and hasn't come back to
  it). Kael's argument: tag some income and some expenses "date night" and you have a dynamic
  goal, so what you want from both is "income tagged to it versus expenses." Claude's answer: a
  fund is exclusive and conserved (each split is in exactly one fund; together they're net
  worth), while tags overlap (a transaction can be `#italy-2026` and `#reimbursable`) and add up
  to nothing. Conservation is what makes a balance trustworthy, and what Unallocated,
  priorities and defaults depend on. They can share machinery (pickers, chips, filters), and
  tags stay useful across funds (a trip paid partly from Vacation, partly from Unallocated).

**How transactions move funds:**

- **Only asset and liability splits move funds,** by their exact amounts and in their own sign,
  so a transaction's fund changes always equal its change in net worth, per asset (agreed).
  Marking an expense line ("a vacation expense") puts the fund on the split that pays for it; a
  transaction is split into pairs to keep that unambiguous, and a bill paid from two cards needs
  a fund on each card's split.
- **Which fund, in order:** a fund chosen on the split; else the account's rules; else the
  global rules (Kael's spend rules, refined in the worked example):
  - **a default fund** (Kael) takes everything entering the account and is first in line for
    what leaves it: **defaults work both ways** (Kael). So a transfer between accounts with
    different defaults moves money between funds (paying down a mortgage moves money from
    Unallocated into the house's fund; a deposit into a brokerage joins its default);
  - **money out** (spending): the account's default first, else Unallocated, then the funds in
    the user's **spend order**, skipping any without that asset (Kael);
  - **a conversion** (one asset out, another in: a trade): the incoming asset goes to whichever
    funds gave up the outgoing one, in proportion to value (Claude, unchallenged). The spend
    order applies to shares too, so an unmarked sale draws Unallocated's shares first; mark the
    sale to choose. A trade's capital-gains line moves no fund (the price had already counted
    the gain);
  - **new money** (income): the fill rules.
- **A transfer marked "into" a fund** puts the fund on the receiving split; the sending split
  goes through the spend order, so a transfer can also move money between funds (Kael's
  example).
- **Spending on credit** draws funds when you spend; paying the card is fund-neutral (both sides
  USD and unmarked, so they cancel) (Claude, unchallenged).
- **An explicit fund that overdraws** a fund's holding of an asset is allowed and flagged
  (Kael, decision 3): a fund at −$460 in cash while it still holds shares is "short of cash";
  selling some of its shares, marked with it, fixes it.
- **Credit lets you spend an asset no fund holds** (Claude, correcting "it's impossible to spend
  an asset no fund represents"): with no USD left in any fund, an unmarked card purchase must
  still land somewhere, so Unallocated (or a last-resort fund) can go below zero.

**Filling funds (autofill):**

- **A fund can autofill** (Kael): a share of each new income (a percentage), in a fill priority
  order, up to an optional target, either **continuous** (refills whenever its value is below
  target) or **single** (stops once its target has been deposited, however much it has since
  spent). Funds can also be manual (no autofill). Unallocated is the system's: continuous, no
  target, whatever the others don't take.
- **Defaults take precedence over allocation rules** (Kael).
- **Rules are global, with per-account rules over them** (Kael, decision 2): income into an
  account with its own rules follows them (a default fund is the simplest: 100% to one fund);
  other income follows the global rules. Making Unallocated an account's default keeps, say, a
  brokerage's dividends out of autofill (Kael). (Autofill limited to `Income:Salary` was
  rejected as too fragile.)
- **A full fund's unused share goes to Unallocated** (Kael, decision 1).
- **Targets are in USD at today's value** (Kael): price changes never create fund entries, but
  a fund that rises above its target drops out of autofill, and one that falls below
  (continuous fill) comes back in; so new income does make up market losses (decision 4).
- **Refunds aren't income:** a grocery refund goes back to Unallocated, not through autofill
  (Claude, in the worked example; not discussed further).
- **Rounding:** each fund's share is rounded down to the cent and the remainder goes to
  Unallocated (Claude, proposed).

**Moving and storing:**

- **Moves between funds are entries of their own,** dated, of any asset, with no account,
  transaction or tax lot changed (Claude, unchallenged; see open question 7 for self-transfers).
- **Retiring a fund** moves what's left to Unallocated or a chosen fund, as a dated move
  (Claude, proposed).
- **Stored in the ledger's database,** not `app`'s (Kael asked why store anything "in
  Beancount" when the app has a database; the answer follows). Nothing lives in a `.beancount`
  file: SQLite is the system of record, and each row keeps its directive's Beancount text as
  its canonical form plus derived columns. The ledger, not `app`, because a split's fund belongs
  with the split,
  which only has an identity there (posting rows are rewritten on every edit; renames, merges,
  divides, purges, imports and restores rewrite splits). As posting metadata (`fund:`) with a
  derived table joined to postings, the M17 tags pattern, so it changes in the split's own
  versioned write. Kael: storing it on the split "sounds reasonable", so long as it stays
  efficient at scale; a separate table joined to splits is fine.
- **What's chosen is stored; what the rules decide is worked out** (agreed): explicit funds and
  defaults are written on the split; the spend order, conversions and fills come from one pass
  over the book in order, cached until the book changes. Stored rule results would go stale
  whenever an earlier transaction is edited.
- **Settings are dated versions** (like budgets), so changing a rule never rewrites history
  (Claude, unchallenged).
- **Retirement as the last resort** in the spend order (Kael: "you can't prevent drawdown,
  since net worth and funds are one-to-one, so make Retirement last; drawing on it means there's
  no USD anywhere else"). Claude's reply (waiting): reaching it means no USD left in other
  *funds*, not in other *accounts* (checking can hold $4,000 against $4,000 owed on a card), and
  Unallocated could take the shortfall instead. See open question 5.

## What the worked example showed

Each with the rule above it rests on:

- **Paycheck:** a full continuous fund takes nothing (its share to Unallocated); an unfinished
  single fund takes its 20%; the rest to Unallocated.
- **Groceries from an account with no default:** Unallocated pays.
- **A transfer into the 401(k):** its default (Retirement) gets it; the sending side comes from
  Unallocated by the spend order.
- **A dividend in the 401(k):** Retirement (the default, both ways); its trades stay Retirement's.
- **A reinvested dividend in a brokerage without a default:** Unallocated, once dividends don't
  autofill (now: make Unallocated that account's default).
- **An unmarked sale of shares:** the spend order picks whose shares; the proceeds go back to
  them by value (a conversion, not income).
- **A card purchase, then paying the card:** the fund is drawn at the purchase; the payment
  moves nothing.
- **A fund-only move of shares:** no account or lot changes.
- **An explicit purchase bigger than a fund's cash:** the fund goes negative in cash and is
  flagged; selling its shares fixes it.
- **A price drop:** values change, holdings don't; a continuous fund now below target refills
  from the next paycheck.
- **A big unmarked purchase:** the spend order empties Unallocated's cash, then draws Emergency.
- **A mortgage payment:** the principal goes to the house's fund (its default), the cash comes
  by the spend order (open question 1).
- **A house revaluation:** a price change for the house's group: no entries, no autofill.
- **A late bank import dated in the past:** it changes the rule-decided effects after it
  (Emergency drew more in a later event). Explicit and default funds never change this way.
- **A change to a fund's allocation from a date:** nothing before that date changes.
- **The end state:** the funds still added up to net worth in every asset.

## Grouped assets (Claude's proposal; open question 3)

- **The problem:** the books record some things in dollars that aren't spendable cash. A house
  is an account with a USD balance, updated by revaluation entries; its mortgage is a USD
  liability. If funds only see kinds, both are more dollars: Unallocated would appear to hold
  its cash plus the house's equity in USD, groceries could be paid from "house dollars", and the
  spend order would never reach Emergency even with an empty checking account.
- **The idea:** some accounts together are one asset of their own for funds, as separate from
  USD as a fund's shares are. The house and its mortgage (and any home-equity loan) are
  **House**; a car and its loan another. Spending USD can't touch them. Paying principal is
  buying House with cash; selling the house sells it for cash. Only the fund layer sees this;
  the books keep the house in dollars.
- **Unitizing**, as mutual funds do: when a group starts, issue units at $1.00 (equity of
  $100,000 is 100,000 units). The unit price (NAV) is always equity ÷ units; a fund's share is
  units × NAV. A revaluation changes the NAV, not the units, so every fund holding House gains
  its share with no entry, like a price change. Money in buys units at the current NAV (paying
  principal), money out sells them (borrowing against it, or selling the house).
- **Why "a fraction of the house" can't be the unit:** with a mortgage, a rise in the house's
  value is all equity, so the fraction you own moves with the price, and a price change would
  look like a deposit. Units change only when money goes in or out.
- **The 401(k):** it can stay ordinary (Retirement holds its cash and shares; its default plus
  Retirement's last-resort place keeps it in line), or be a group (Retirement holds 401(k) units
  at the account's value: trades and dividends inside only change the NAV, its cash is never
  spendable USD, so groceries can't draw it and the last-resort question goes away; but funds
  see one number for it, and can move units between funds, not specific shares). Claude leans
  to grouping it, and anything else that can't be spent freely (an HSA, a 529).
- **Underwater** (equity at or below zero): units can't be priced; it needs a rule, for example
  carrying the deficit in Unallocated until the equity recovers.

## The model as it stands

1. Two ledgers over the same money: accounts (where) and funds (what for). For every asset, the
   funds add up to net worth.
2. A fund holds assets: commodities, and units of grouped assets (if adopted).
3. Only asset and liability splits move funds, in their own sign; marking an expense line is the
   gesture, applied to the split that pays.
4. A fund is chosen explicitly, else by the account's rules (its default, or its own fill
   rules), else by the global rules: spend order out, conversion for trades, fill rules for new
   money.
5. Moves between funds are their own dated entries.
6. Prices and revaluations change what funds are worth, not what they hold; targets are judged
   at today's value.
7. Unallocated holds what's left over, and may go below zero.
8. Explicit choices are stored on splits; everything the rules decide is worked out in one pass
   in order; settings are dated versions.

## Open questions (waiting on Kael; Claude's reply of 2026-10-29 explains 1–6)

1. **Defaults over conversions.** When money comes into an account with a default fund, the
   default gets it even when another fund paid (a), rather than the payer keeping the value (b).
   Kael's own transfer-into-the-401(k) example already chose (a). Applied to a mortgage payment
   when Unallocated is short: (a) the house's fund gets all the principal's equity while
   Emergency's cash paid part of it; (b) Emergency would own a slice of the house. (a) never
   leaves a fund holding what it wasn't meant to; its cost is that money into a defaulted
   account is always a reallocation. An explicit fund on the receiving split overrides either.
2. **Same-day order.** The books have dates, not times, and a day's transactions stay in the
   order they were written. Rent processed before a same-day paycheck can draw Emergency (then
   partly refilled); the other way round, Unallocated covers it. Process each day's money in
   before its money out (Claude's lean), or the books' order?
3. **Grouped assets** (above): adopt them? Group the 401(k) (Claude's lean)?
4. **What counts as a deposit toward single fill:** autofill, transfers marked into the fund, and
   moves into it count; conversions and price changes don't; spending doesn't reduce it. Count
   moves net, in minus out (Claude's lean), so moving money in and back out doesn't count?
5. **A shortfall:** when no other fund has the asset, does Retirement pay (last resort, Kael) or
   does Unallocated go below zero (Claude)? Grouping the 401(k) makes it moot.
6. **Account rules and transfers:** an account's default takes transfers in (the 401(k)).
   Should an account's split rule (70/30) also split transfers in? Claude's lean: one rule for
   everything entering, marking a transfer when that's not wanted. Claude also proposed that an
   account can have its own spend order, as it has its own fill rule (not yet confirmed).
7. **Reallocating without money moving:** fund-only move entries (used in the worked example), a
   transaction with both splits in one account (Kael's first sketch; for shares it must keep
   the same lot on both sides), or both?
8. **Fill priority:** Kael's sketch has funds filled "in some priority order" as well as by
   percentages; what the order decides (percentages over 100%, or something else) isn't settled.

## Not discussed yet

- **Scope and sharing:** funds belong to a book (books are independent); in a shared book, which
  roles may set up funds and rules, and which may mark splits.
- **Currency:** "targets in USD" means the book's operating currency.
- **Targets with dates** ("$15,000 by June"), progress toward them, and what a fund page shows.
- **Explaining:** each transaction showing what it did to funds and why ("drawn from Unallocated
  by the spend order"), a fund's own ledger, and **pinning** a rule's choice so it becomes
  explicit and stops moving.
- **Reports by fund,** and funds in exports and backups (posting metadata and `custom` entries
  carry them as Beancount).
- **Divided accounts:** funds cover the reason they were built; keep them only for money a bank
  itself keeps apart, migrate their parts to funds, or retire them.
- **Tags and funds together:** a fund could name a tag, so spending tagged `#vacation` offers
  "take it from the Vacation fund?" in review.
- **The API and screens:** marking a split (and an expense line), moves, fund settings, the spend
  order.
- **Phasing** (Claude's lean): first funds, Unallocated, explicit and default funds, the spend
  order, conversions, moves, grouped assets, dated settings and explanations; autofill second.

## Prior art

Envelope budgeting (YNAB, Actual): every dollar assigned to a category, "ready to assign" as the
residual, overspending shown as negative, and the accounts beside the point. Funds are the same
idea over net worth rather than a budget's cash, and they hold assets (shares, house equity),
which envelopes don't.

## Technical fit (Claude's assessment so far)

- **Viable, and a good fit:** additive, on existing patterns: the derived table of M17's tags
  (the split's fund), `open` metadata like `main-part:` (an account's default, its rules, its
  group), dated versions like budgets (fund settings), `custom` entries like statements (moves).
  About the size of M15 or M16.
- **The pass over the book** is linear over the postings stream the ledger already reads in one
  query (`transactions/compact`; it would add each posting's fund and whether its account is
  grouped), plus prices: milliseconds to tens of milliseconds for a decades-long book, to be
  measured on a Pi (Emmer). Cached by the book's change sequence (the ledger already tracks it
  for backups); an edit re-runs it from its date, from monthly checkpoints. In the ledger, next
  to the data and the book's order, so every client agrees.
- **Untouched:** booking and tax lots, reconciliation, bank feeds and imports (synced
  transactions pick up account defaults with no new code), and tags.
- **Risks:** explaining effects that depend on history (a late import changes later ones),
  autofill's many cases (which income, continuous against single, value targets while holdings
  float, unused shares, rounding, same-day order), grouped assets being new, and the size of the
  UI.
