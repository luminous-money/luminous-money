Funds B: Complex Fund Functionality: plan
==================================================================================================

> **Now Funds B (Kael, 2026-11-02):** Funds was split in two. [A: Basic Funds](../A/PLAN.md)
> ships first: the dual ledger with no rules, funds holding dollars. B is everything below, and
> **asset-aware funds are its first step**, right after A (Kael's guiding case is a brokerage
> whose four funds hold shares). Decisions here were made for the whole design; A's plan says
> which it kept.
>
> **Status before the split: back to the drawing board (Kael, 2026-10-31), restarting from
> scenarios.** The next milestone, after M17. Nothing is built. In an interview (2026-10-30) Kael answered most of the
> open questions, added two new threads (funds as budgets for *why* money is spent, and big loans
> as a special case), then found the design "getting really blurry" and decided to start it over.
> **The restart:** [example-book.md](example-book.md) (a made-up household's accounts and funds)
> and [scenarios.md](scenarios.md) (71 events, simplest first, each with what we'd expect funds
> to do). Kael gut-checks the expectations; then we work backward to the rules and decide what to
> cut. This file records everything up to the restart, so it can take what it wants from it: the problem, how we got here (and why each turn was taken), what was decided, the
> model as it stood, and what's still open. Nothing here binds the fresh start. The whole
> conversation, verbatim, is in `discussion.private.md` beside this file. It uses real figures,
> so it's git-ignored (`docs/**/*.private.md`): it exists only on Kael's machines, and an agent
> working from GitHub won't have it. Examples here use made-up figures and names.

## Picking up B

- **Start with asset-aware funds** (Kael's guiding case: a brokerage whose four funds hold shares).
  A was shaped for it ([A's plan](../A/PLAN.md), "Toward assets"): every fund amount keeps its
  commodity, a fund reports `holdings` and `value`, and one check (`fundlines.checked`: "funds hold
  USD for now", and the same in `funds._checked` for moves) is what refuses other commodities. Lift
  it, then work out a transaction's kind and size per commodity, Unallocated per commodity, and a
  commodity on the PWA's amount inputs.
- **Then walk [the scenarios](scenarios.md) with Kael,** against [the example book](example-book.md):
  each "Expect" line is a draft for him to confirm or correct, and their closing section groups
  where the old rules and the expectations part ways. Work backward from them to the rules, and
  decide what to cut. Scenarios A already settles (choosing a fund on a transaction, moves,
  archiving) need no rules.
- **What A settled that B inherits:** two ledgers over the same money; Unallocated as net worth
  less every fund, never written; lines on the transaction (one `funds:` string), not on splits;
  a transaction's kind from its change in net worth (a refund is money in, a trade a transfer);
  lines no more than the transaction, checked only when they change; funds may go below zero;
  moves as `custom "fund-move"`; setting funds up is a manager's.
- **Still open from before A** are under "Open questions" below: budget funds, fill priority, funds
  against tags, big loans, a group's fund.

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

**Funds as the *why* of spending (Kael, 2026-10-30):** "I want to be able to use funds as
budgets so my chart of accounts can continue to track 'what' while my funds can indicate 'why'."
The same restaurant three times in a month: once out with a friend (a Social fund), once grabbing
food while running errands (Chores), once as a family (Family). Continuous funds, seen the way
budgets are. This widens funds from saving toward goals to spending by purpose; how is open
question 1.

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
   1. *"A separate overlay similar to tags; maybe they are tags."* Recorded as different things
      (below), though Kael found the difference hazy (open question 3).
   2. *"Applied at the split level; credits decrease a goal and debits increase it (reversed
      from accounts?)."* Settled: funds move with the asset and liability splits, in those
      splits' own sign, so a debit to an asset raises its fund, as with an asset account. The
      reversed reading only arises from tagging the expense split.
   3. *"Fund a goal in place with a transaction whose two splits are in the same account"*
      (`PNC −50 [Unallocated] / PNC +50 [Vacation]`). Claude first objected (a non-double-entry
      fact dressed as a transaction; with shares it would reduce and re-add tax lots), then
      agreed it fits the split rule for cash. Kael chose fund-only moves instead (2026-10-30).
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
   explained the rest (defaults over conversions, same-day order, deposits toward single fill,
   grouped assets in depth).
6. **The interview (2026-10-30).** A new session put the open questions to Kael a few at a time,
   with options. Answered: defaults win over conversions; each day's money in before its money
   out; single fill counts moves net; grouped assets adopted, but **one fund per group** (no
   units); shortfalls make Unallocated negative; an account's rule covers transfers in; no
   per-account spend orders yet; reallocation by fund-only moves. Along the way:
   - **Long-term debts** came up: a mortgage or student loan as plain USD would put Unallocated
     tens of thousands below zero, so every unmarked purchase would draw on the real funds. Kael:
     revalued accounts are grouped automatically, loans attached to their asset (or alone) when
     funds are set up, other grouping (a 401(k)) an advanced setting, and each unsecured loan a
     group of its own.
   - **Big loans** (Kael): "a special case", to come back to both within funds and on their own
     (open question 4; docs/PLAN.md's **Loans**).
   - **Funds as budgets** (Kael's new idea, above). The questions it raised (how such a fund
     fills each period, from where, how it's shown, what counts as spent) were put and dismissed
     unanswered.
7. **Back to the drawing board (Kael, 2026-10-31):** "This is all getting really blurry now. I
   think we need to go back to the drawing board on this whole Funds thing."
8. **Scenarios first (Kael, 2026-10-31):** rather than unwinding decisions one by one, list a wide
   range of distinct events, from "buy a hot dog with cash" to "quarterly dividends reinvested
   across a Roth IRA's mutual funds", run them against a written-down example book, and gut-check
   what should happen in each; then work backward to the rules and see what to cut. Claude drafted
   [example-book.md](example-book.md) and [scenarios.md](scenarios.md); the scenarios' "Expect"
   lines are a first draft for Kael to confirm or correct, and their closing section groups where
   the old rules and the expectations part ways.

## Decided so far

Decided under the model as it stood; starting over may revisit any of it. Who decided is noted
where it matters: **Kael**; **agreed** (both); **Claude, unchallenged** (proposed and not
objected to). Dates mark what the 2026-10-30 interview settled.

**What a fund is:**

- **Named "funds"** (Kael). A separate ledger tracks them; nothing in it is double-entry
  (agreed).
- **Every dollar, every asset** (Kael): the house and the 401(k) included.
- **Asset-aware** (Kael): a fund holds amounts of assets (USD, VTI, VXUS…), not just dollars,
  and groups (below). Spending USD draws only on funds' USD; a fund's value is its holdings at
  today's prices.
- **Funds and tags are different things** (Claude; Kael found it hazy and hasn't confirmed it:
  open question 3). Kael's argument: tag some income and some expenses "date night" and you have
  a dynamic goal, so what you want from both is "income tagged to it versus expenses." Claude's
  answer: a fund is exclusive and conserved (each split is in exactly one fund; together they're
  net worth), while tags overlap (a transaction can be `#italy-2026` and `#reimbursable`) and add
  up to nothing. Conservation is what makes a balance trustworthy, and what Unallocated,
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
  - **defaults win over conversions** (Kael, 2026-10-30): money entering an account with a
    default goes to the default even when another fund paid for it. Paying principal when
    Unallocated is short of cash, the house's fund gets all of it and Emergency is simply down
    cash (its continuous fill repairs that); Emergency never ends up owning part of the house.
    So money into a defaulted account is always a reallocation. An explicit fund on the
    receiving split overrides it;
  - **money out** (spending): the account's default first, else Unallocated, then the funds in
    the user's **spend order**, skipping any without that asset (Kael). **A fund can opt out of
    the spend order** (Kael, 2026-10-30): only explicit marks and moves draw on it (the "never
    draw down" for Retirement holding an ungrouped 401(k)). **No per-account spend orders for
    now** (Kael, 2026-10-30): an account's default is its only say in what pays;
  - **a conversion** (one asset out, another in: a trade), where no default applies: the
    incoming asset goes to whichever funds gave up the outgoing one, in proportion to value
    (Claude, unchallenged). The spend order applies to shares too, so an unmarked sale draws
    Unallocated's shares first; mark the sale to choose. A trade's capital-gains line moves no
    fund (the price had already counted the gain);
  - **new money** (income): the fill rules.
- **A transfer marked "into" a fund** puts the fund on the receiving split; the sending split
  goes through the spend order, so a transfer can also move money between funds (Kael's
  example).
- **Spending on credit** draws funds when you spend; paying the card is fund-neutral (both sides
  USD and unmarked, so they cancel) (Claude, unchallenged).
- **An explicit fund that overdraws** a fund's holding of an asset is allowed and flagged
  (Kael): a fund at −$460 in cash while it still holds shares is "short of cash"; selling some of
  its shares, marked with it, fixes it.
- **Shortfalls go to Unallocated** (Kael, 2026-10-30): when spending needs more of an asset than
  the funds in the spend order hold (credit lets you spend USD no fund has), Unallocated goes
  below zero ("you spent money you didn't have"), as overspending shows in envelope budgeting.
  Kael's earlier idea, Retirement as the last resort, was dropped: reaching it means no USD in
  other *funds*, not in other *accounts* (checking can hold $4,000 against $4,000 owed on a
  card), so a grocery run would have read as retirement money spent.
- **Same-day order** (Kael, 2026-10-30): the books have dates, not times, so the pass takes each
  day's income first, then everything else in the books' order. A paycheck and rent on the same
  day come out the same whichever the sync wrote first, and rent doesn't dip into Emergency when
  the paycheck arrived that day.

**Filling funds (autofill):**

- **A fund can autofill** (Kael): a share of each new income (a percentage), in a fill priority
  order (what it decides is open question 2), up to an optional target, either **continuous**
  (refills whenever its value is below target) or **single** (stops once its target has been
  deposited, however much it has since spent). Funds can also be manual (no autofill).
  Unallocated is the system's: continuous, no target, whatever the others don't take.
- **Defaults take precedence over allocation rules** (Kael).
- **Rules are global, with per-account rules over them** (Kael): income into an account with its
  own rules follows them (a default fund is the simplest: 100% to one fund); other income
  follows the global rules. Making Unallocated an account's default keeps, say, a brokerage's
  dividends out of autofill (Kael). (Autofill limited to `Income:Salary` was rejected as too
  fragile.)
- **An account's rule covers everything entering it** (Kael, 2026-10-30): transfers as well as
  income, as a default already does (the transfer into the 401(k)). A 70/30 rule on an account
  splits transfers into it too; mark the transfer with a fund when that's not wanted.
- **A full fund's unused share goes to Unallocated** (Kael).
- **Targets are in USD at today's value** (Kael): price changes never create fund entries, but
  a fund that rises above its target drops out of autofill, and one that falls below
  (continuous fill) comes back in; so new income does make up market losses.
- **Single fill counts deposits net** (Kael, 2026-10-30): autofill, transfers marked into the
  fund and moves into it count; moves out subtract, so moving money in and straight back out
  counts nothing; conversions and price changes don't count (the same money changing form);
  spending never reduces it, since spending is what the fund is for.
- **Refunds aren't income:** a grocery refund goes back to Unallocated, not through autofill
  (Claude, in the worked example; not discussed further).
- **Rounding:** each fund's share is rounded down to the cent and the remainder goes to
  Unallocated (Claude, proposed).

**Moving and storing:**

- **Moves between funds are entries of their own** (Kael, 2026-10-30): dated, of any asset,
  with no account, transaction or tax lot changed. They're the only way to reallocate without
  money moving: a transaction with both splits in one account (Kael's first sketch) isn't used.
- **Retiring a fund** moves what's left to Unallocated or a chosen fund, as a dated move
  (Claude, proposed).
- **Stored in the ledger's database,** not `app`'s (Kael asked why store anything "in
  Beancount" when the app has a database; the answer follows). Nothing lives in a `.beancount`
  file: SQLite is the system of record, and each row keeps its directive's Beancount text as
  its canonical form plus derived columns. The ledger, not `app`, because a split's fund belongs
  with the split, which only has an identity there (posting rows are rewritten on every edit;
  renames, merges, divides, purges, imports and restores rewrite splits). As posting metadata
  (`fund:`) with a derived table joined to postings, the M17 tags pattern, so it changes in the
  split's own versioned write. Kael: storing it on the split "sounds reasonable", so long as it
  stays efficient at scale; a separate table joined to splits is fine.
- **What's chosen is stored; what the rules decide is worked out** (agreed): explicit funds and
  defaults are written on the split; the spend order, conversions and fills come from one pass
  over the book in order, cached until the book changes. Stored rule results would go stale
  whenever an earlier transaction is edited.
- **Settings are dated versions** (like budgets), so changing a rule never rewrites history
  (Claude, unchallenged).

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
- **A mortgage payment:** the cash comes by the spend order, and the principal goes to the
  house's group, held by its fund (defaults win, whoever paid).
- **A house revaluation:** changes the value of the house's group: no entries, no autofill.
- **A late bank import dated in the past:** it changes the rule-decided effects after it
  (Emergency drew more in a later event). Explicit and default funds never change this way.
- **A change to a fund's allocation from a date:** nothing before that date changes.
- **The end state:** the funds still added up to net worth in every asset.

## Grouped assets (adopted, Kael 2026-10-30)

- **The problem:** the books record some things in dollars that aren't spendable cash. A house
  is an account with a USD balance, updated by revaluation entries; its mortgage is a USD
  liability. If funds only see kinds, both are more dollars: Unallocated would appear to hold
  its cash plus the house's equity in USD, groceries could be paid from "house dollars", and the
  spend order would never reach Emergency even with an empty checking account. A big loan alone
  has the opposite effect: as plain USD it would sink Unallocated far below zero, so every
  unmarked purchase would draw on the other funds.
- **A group is an asset of its own for funds:** some accounts together (a house, its mortgage
  and any home-equity loan; a car and its loan) are one asset, as separate from USD as shares
  are. Spending USD can't touch it. Paying principal is buying it with cash; selling the house
  sells it for cash. Only the fund layer sees this; the books keep the house in dollars.
- **One fund per group** (Kael): a group is held whole by one fund, its default, so it needs no
  units: the fund's holding is the group's equity, and a revaluation changes it with no entry,
  like a price change. A group can't be split across funds or partly moved. (Claude had
  proposed unitizing, as mutual funds do: units issued at $1.00, a unit price of equity ÷ units,
  so several funds could hold one house. Kael chose the simpler form.)
- **Underwater** (equity at or below zero) needs no rule of its own now: the group's fund just
  shows a negative holding. (Units couldn't be priced at zero; one fund per group has none.)
  Claude's note, not discussed.
- **What's grouped** (Kael):
  - **revalued accounts** (their `open` carries `revalue-every`) are grouped automatically;
  - **a loan** is attached, when funds are set up, to the asset it's secured on (the mortgage to
    the house), or made a group of its own;
  - **unsecured long-term debts** (a student loan, a personal loan) are each a group of their
    own, with a negative value, held by one fund; payments buy it toward zero with cash.
    Credit cards stay plain USD: spending on credit draws funds when you spend;
  - **anything else** (a 401(k), an HSA, a 529) is the user's choice per account, an **advanced
    setting** kept out of the way. Kael: only if it isn't complicated to build; Claude: it isn't,
    since a 401(k) is a group of one, by the same mechanism as the house. Grouped, Retirement
    holds "the 401(k)" as one asset at the account's value: trades and dividends inside never
    touch funds, and its cash can't pay for groceries, but funds can't earmark specific shares
    in it. Ungrouped, Retirement holds its cash and shares, and opting Retirement out of the
    spend order keeps unmarked spending off it.
- **Big loans** are parked as a special case (open question 4).

## The model as it stood

1. Two ledgers over the same money: accounts (where) and funds (what for). For every asset, the
   funds add up to net worth.
2. A fund holds assets: commodities, and groups (each held whole by one fund).
3. Only asset and liability splits move funds, in their own sign; marking an expense line is the
   gesture, applied to the split that pays.
4. A fund is chosen explicitly, else by the account's rules (its default, which wins over
   conversions, or its own fill rule, which covers everything entering), else by the global
   rules: the spend order out (skipping funds that opted out), conversion for trades, fill rules
   for new money.
5. Moves between funds are their own dated entries, and the only way to reallocate without money
   moving.
6. Prices and revaluations change what funds are worth, not what they hold; targets are judged
   at today's value.
7. Unallocated holds what's left over, and takes shortfalls below zero.
8. Explicit choices are stored on splits; everything the rules decide is worked out in one pass
   in order (each day's income first); settings are dated versions.

## Open questions (as of 2026-10-31)

What the old design left open. [scenarios.md](scenarios.md) adds more, grouped by theme in its
closing section (defaults on transfers, what a mark means, which income autofills, refunds, what
shares earn, the spend order past Unallocated, restricted money, groups over time, history
moving).

1. **Funds as budgets** (Kael, 2026-10-30; above, under "The problem"). Funds were designed for
   saving toward goals; this makes them spending categories by purpose too. Put to Kael and
   dismissed unanswered:
   - **How such a fund fills each period.** Today's autofill is a percentage of income up to a
     target, with no period at all. Options: **top up to an amount** (unspent money stays but
     never builds past it; the next top-up covers an overspend: Claude's lean), **add an
     amount** (rollover, YNAB-style, perhaps capped), or **reset to the amount** (leftovers and
     overspending go to Unallocated; closest to an account budget).
   - **Where its money comes from:** a dated move from Unallocated at each period's start (there
     from day one; Unallocated may go negative, flagged: Claude's lean), or fixed claims on each
     period's income ahead of the percentages (which would give the fill priority, question 2,
     a real job).
   - **How it's shown:** a "By fund" section on the Budgets page beside the account budgets, with
     the same bars and period math (Claude's lean), or the Funds pages only.
   - **What counts as spent this period:** spending drawn from it, explicit or by the spend
     order, with marked refunds taking it back and moves and conversions shown apart (Claude's
     lean), or every outflow.
   - **Not yet asked:** marking. Every such purchase needs its fund chosen, so suggesting funds
     in review (rules, history, the AI) matters far more than for savings goals; such funds would
     likely opt out of the spend order. And how they sit beside M11's budgets, which limit
     accounts (the *what*): side by side, or one replacing the other for spending.
2. **Fill priority.** Kael's sketch fills funds "in some priority order" as well as by
   percentages; what the order decides isn't settled. With percentages alone it could only break
   ties past 100% (Claude's lean: require percentages to total 100% or less and drop the order).
   Fixed-amount fills, such as budget funds claiming income, would give it a real job.
3. **Funds and tags.** Recorded as different things (above), but Kael found the difference hazy
   and hasn't confirmed it. Funds as *why* sharpen the question: M19's AI guidance already has
   accounts say what and *tags* say why, and now funds would too.
4. **Big loans** (Kael, 2026-10-30: "a special case"), to come back to both within funds and on
   their own. Within funds, all that's decided is that a loan is grouped (with its asset, or
   alone). On their own, Kael wants an amortization schedule loaded easily (read from a PDF or
   image by the AI, a CSV, or typed in) to guide a scheduled payment, from any point in the loan
   (say which payment is next); and the payments seen as monthly expenses, though the books
   already recorded what they paid for. That's docs/PLAN.md's **Loans**.
5. **Changing a group's fund.** With one fund per group, a group moves whole: presumably a dated
   move of the entire holding, or a dated change to the group's default (Claude's assumption,
   not discussed).

## Not discussed yet

- **Scope and sharing:** funds belong to a book (books are independent); in a shared book, which
  roles (read, write, manage: M13) may set up funds and rules, and which may mark splits.
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
  order, grouping (and its advanced setting).
- **Phasing** (Claude's lean): first funds, Unallocated, explicit and default funds, the spend
  order, conversions, moves, grouped assets, dated settings and explanations; autofill second.

## Prior art

Envelope budgeting (YNAB, Actual): every dollar assigned to a category, "ready to assign" as the
residual, overspending shown as negative, and the accounts beside the point. Funds are the same
idea over net worth rather than a budget's cash, and they hold assets (shares, house equity),
which envelopes don't. Funds as budgets (open question 1) would bring them closer still.

## Technical fit (Claude's assessment so far)

- **Viable, and a good fit:** additive, on existing patterns: the derived table of M17's tags
  (the split's fund), `open` metadata like `main-part:` (an account's default, its rules, its
  group), dated versions like budgets (fund settings), `custom` entries like statements (moves).
  About the size of M15 or M16.
- **The pass over the book** is linear over the postings stream the ledger already reads in one
  query (`transactions/compact`; it would add each posting's fund and its account's group), plus
  prices: milliseconds to tens of milliseconds for a decades-long book, to be measured on a Pi
  (Emmer). Cached by the book's change sequence (the ledger already tracks it for backups); an
  edit re-runs it from its date, from monthly checkpoints. In the ledger, next to the data and
  the book's order, so every client agrees.
- **Untouched:** booking and tax lots, reconciliation, bank feeds and imports (synced
  transactions pick up account defaults with no new code), and tags.
- **Risks:** explaining effects that depend on history (a late import changes later ones),
  autofill's many cases (which income, continuous against single, value targets while holdings
  float, unused shares, rounding), grouped assets being new, and the size of the UI.
