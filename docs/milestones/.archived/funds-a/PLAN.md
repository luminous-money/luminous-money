Funds A: Basic Funds: plan
==================================================================================================

> **Status (2026-11-02): built and released as `v0.1.13`.** The ledger, the app server and the
> PWA, with unit, API and browser tests, and looked at on a phone and a desktop, light and dark.
> This plan now describes what was built (where the build departed from the plan, it says so).
> Planned with Kael (2026-11-02). Funds is split in two. **A** (this): the dual ledger with no
> rules at all. Money reaches or leaves a fund only when you say so on a transaction, or move it.
> **B** ([B/PLAN.md](../../funds-b/PLAN.md)): everything else designed so far (asset-aware funds first,
> then spend and fill rules, groups, budget funds). Kael's answers are under
> [Decided with Kael](#decided-with-kael); the calls made without asking (1 to 13 while
> planning, 14 to 23 while building the screens) are under
> [Decisions to review](#decisions-to-review), **for Kael to look over**.

## The brief (Kael, 2026-11-02)

"I've held an easy version of this milestone hostage to a hard version." So A is:

- **The same dual ledger:** accounts say where money is, funds say what it's for. B builds on it.
- **No spend or fill rules.** All income, expenses and transfers happen against Unallocated,
  unless a transaction is explicitly tagged with a fund, which fills or drains it.
- **Fund tagging happens on a transaction.** For example:
  - transfer $2,000 from PNC to the brokerage, "for Emergency": Emergency +$2,000;
  - spend $500 from PNC on home maintenance, "from Emergency": Emergency −$500;
  - $1,000 of income, "$500 for Emergency, $500 for Special Home Maintenance": each +$500;
  - and in the Funds menu, move money between funds by hand.
- **Income** offers only funds it goes *to*, and defaults to Unallocated. **Expenses** offer
  only funds they come *from*, and default to Unallocated.
- **Transfers** between assets and liabilities are assumed to *put money toward* a fund. Taking
  from a fund too is an advanced option.
- **Spend extra effort verifying the UI.** This can get tricky, and solid UX is worth the
  investment.

**The guiding use case (Kael):** a Fidelity brokerage holding four funds: Wedding, Emergency,
Special Home Maintenance and Repair, and Special Home Improvement. Much of it is in shares, which
A can't represent (A's funds hold dollars), so A won't fully serve it. **Asset-aware funds are
the very next step after A,** and A is built so that step is mostly lifting a restriction (see
[Toward assets](#toward-assets-the-next-step)).

## Decided with Kael

1. **A fund holds dollars** (the book's operating currency) in A, so long as that doesn't make
   assets harder next. Every stored fund amount keeps its commodity, so it doesn't.
2. **Unallocated is all of net worth less every fund,** the house and retirement included. The
   Funds page says so.
3. **A transaction's fund amounts can't add up to more than the transaction:** what came in,
   went out, or moved. To shift more than that, move money between funds.
4. **Drawing a fund below zero is allowed,** shown in red.
5. **Where funds are set:** the transaction page (and New transaction), **review cards**,
   **Select mode's bulk actions**, **schedules** and **rules**.
6. **A fund has** a name, a **description**, an optional **target** shown as progress (display
   only: nothing fills automatically), and can be **archived**. Funds also get a **home card**.
7. **Roles:** **manage** sets funds up (create, rename, describe, target, archive, delete);
   **write** tags transactions and moves money.
8. **Taking from a fund on a transfer** is reached on the transaction itself: a "More options"
   link in its Funds section, open on its own when the transaction already uses it.

## The model

- **Fund lines:** a transaction carries zero or more lines, each a fund and a signed amount:
  `+` puts money into the fund, `−` takes it out. No line names Unallocated: Unallocated is what
  isn't in a fund, so it's never written, only worked out.
- **A fund's balance** is the sum of all its lines and moves, whatever their dates, unconfirmed
  transactions included, as the chart's account balances are. `GET …/funds?on=` only chooses the
  prices a fund's holdings are valued at (today's by default), as `chart.tree`'s `on` does for
  net worth, so the two always agree. (`store.fund_lines` takes an `on` date, unused so far: an
  "as of" view would pass it, and the chart's balances would need the same.)
- **Unallocated** = net worth − every fund. Net worth is the top-level asset and liability
  accounts' values in the operating currency (the chart's own figure, `chart.tree`). Unpriced
  commodities are left out and named, as they are on the chart.
- **What kind of transaction it is** comes from its **change in net worth** (Δ): the sum of its
  balance-sheet splits (`Assets:…`, `Liabilities:…`), weighed in the operating currency (units,
  or units × cost or price; a blank amount as booking fills it).
  - **Money in** (Δ > 0: income, a refund, an opening balance): lines are `+`, "to" a fund.
  - **Money out** (Δ < 0: spending): lines are `−`, "from" a fund.
  - **A transfer** (Δ = 0: between your accounts, paying a card, a trade): lines are `+`,
    "for" a fund. With More options, `−` lines too ("from" a fund).
  - **Its size** is |Δ|, or for a transfer what moved (the sum of its balance-sheet splits that
    went up).
  - **Unknown:** a balance-sheet split weighed in another currency (no cost or price to weigh it
    in the operating currency), or one only booking can fill (a sale's empty cost, `{}`). Lines
    can still be written; they're just not checked against the size. (The ledger reads the
    book's own root names for assets and liabilities; `shared/funds.ts` assumes `Assets:` and
    `Liabilities:`.)
- **The cap:** a money-in or money-out transaction's lines add up to no more than its size. A
  transfer's `+` lines add up to no more than its size, and so do its `−` lines.
- **A fund's change from a transaction** is its line. Unallocated's change is what's left of the
  net-worth change: the paycheck example moves Unallocated by $0, and the PNC → brokerage
  transfer moves it by −$2,000.

## In the books

Everything lives in the Beancount text, so exports, backups and restores carry funds with no new
work.

```beancount
2026-11-02 custom "fund" "Emergency"
  description: "Three months of expenses"
  target: 20000.00 USD

2026-11-01 * "Acme" "Paycheck"
  funds: "Emergency +500.00 USD; Special Home Maintenance +500.00 USD"
  Assets:Bank:PNC          1000.00 USD
  Income:Salary           -1000.00 USD

2026-11-02 custom "fund-move" "Unallocated" "Wedding" 2500.00 USD
  note: "Setting up"
```

- **A fund is a `custom "fund"` directive:** its name, and metadata for `description`, `target`
  (an amount) and `archived` (the date it was archived). Its date is when it was made, which
  doesn't restrict which transactions can use it.
- **A transaction's lines are one `funds:` metadata string:** `<name> <signed number>
  <commodity>`, separated by `; `, read from the right (so names can hold spaces and digits).
  Beancount allows each metadata key once per entry, and lines are about the whole transaction.
  Putting them on splits would mean cutting the bank's split in two, which breaks review cards,
  matching and reconciliation. The JSON API exposes them as `funds`, and `meta` never shows
  the key.
- **A move is a `custom "fund-move"` directive:** from, to (either can be `"Unallocated"`), an
  amount, and an optional `note`.
- **Names:** trimmed, inner spaces collapsed, 1–60 characters, none of `; " \ /`, unique
  ignoring case, and never "Unallocated" (any case). Shown as typed; a line naming a fund in
  another case is stored as the fund is named.

## The ledger (Python)

- **`engine`:** `Directive.funds` (`(fund, number, commodity)` triples), parsed from a
  transaction's `funds:` or a `fund-move`'s values (two triples, leaving out Unallocated's side);
  rendering `funds:` from `TransactionIn.funds`; keeping the key out of `meta` both ways.
- **Migration 13:** a derived `fund_line` table (`directive_id`, `idx`, `book_id`, `fund`,
  `amount`, `currency`; key `(directive_id, idx)`, indexed by `(book_id, fund)`), written by
  `store.put` and cleared by `store.delete`, like `posting` and `transaction_tag`, and
  backfilled from the stored text. The text stays the source of truth. Sums are Decimals in
  Python, as balances are.
- **`funds.py`:** the funds list (with balances, net worth and Unallocated), create, settings,
  rename (rewriting the declaration, every transaction's `funds:` and every move, in one atomic
  write, as account renames do), archive and unarchive, delete, a fund's history, moves, and
  the checks on lines.
- **Checks when a write includes `funds`** (create, replace, PATCH with `funds`, batch changes):
  each fund declared; a *new* line can't name an archived fund (lines already there can stay);
  no fund twice; not Unallocated; non-zero; the operating currency (A only: "funds hold USD for
  now"); and the kind and the cap above, when the kind is known. A 422 says which rule broke
  ("its funds get 1,200.00 USD, more than the 1,000.00 USD that came in"; "money going out comes
  from funds, not to them (Emergency)"). **Lines that haven't changed aren't checked**
  (`fundlines.checked` compares them with the stored ones), so writes without `funds`, or with
  the same ones, never fail because of a fund: recategorizing in review, pairing, matching. A
  transaction whose lines no longer fit says so on its page.
- **The API** (`Fund`, `Funds`, `FundIn`, `FundPatch`, `FundRename`, `FundArchive`, `FundEntry`,
  `FundHistory`, `FundMoveIn`, `FundMove`, `FundMovePatch`, `FundLine`):
  - `GET /books/{b}/funds?on=`: every fund, with `holdings` (amounts per commodity) and
    `value`, its target, description, `archived`, `entries`, `updated_at`; plus `currency`,
    `net_worth`, `unallocated` and `unpriced`. *(read)*
  - `POST /books/{b}/funds`, `PATCH /books/{b}/funds/{name}` (description, target),
    `POST …/{name}/rename`, `POST …/{name}/archive` (`date`, today by default and no earlier
    than its last entry; `to`: where what's left goes, written as a move per commodity on that
    date, or from there if it's below zero; the generated types require `to`, so the PWA always
    sends it), `POST …/{name}/unarchive`, `DELETE …/{name}?updated_at=` (only with no history:
    "archive it instead"). *(manage)* A fund only *used* (an imported book's lines with no
    `custom "fund"`) is listed, but has nothing to change: its `updated_at` is null.
  - `GET /books/{b}/funds/{name}/entries`: the fund and its history, newest first: each
    transaction line or move with its date, payee and description (a move's other side and
    note), amount and the running balance. *(read)*
  - `POST /books/{b}/fund-moves`, `PATCH` and `DELETE /books/{b}/fund-moves/{id}`, versioned
    as every edit is (a PATCH changes only the fields given). A move names two different funds
    (either may be Unallocated), an amount above 0 in the operating currency, and not a newly
    archived fund. *(write)*
  - **Transactions** gain `funds: FundLine[]` (`TransactionIn`, `TransactionPatch`, and so
    `Transaction`); optional, so callers that don't know about funds don't change. **Rows**
    (`LedgerRow`, `JournalRow`, `CompactTransaction`) gain `funds` for chips.
- Then `pnpm generate`.

## app (TypeScript, server)

- **`shared/funds.ts`:** `FundLine`, `UNALLOCATED`, the name normalizer, `shapeOf(postings,
  currency)` (kind and size, as the ledger works them out), `wholeLine(shape, fund)` (the
  fund for all of it, `+` or `−` by kind), and `linesProblem(shape, lines)` (the cap and kind
  checks, worded as the ledger's are). The PWA and the server both use it. Unit tests.
- **`LedgerPort`:** `funds(book)`, `renameFund(…)`, and `funds` passed through on
  transactions; `FakeLedger` the same.
- **Rules:** `CategoryRule.fund` (`string | null`; app migration 19 adds `category_rule.fund`).
  Saving a rule names the fund as the fund is named, and `ruleProblem` refuses one that isn't
  active ("Emergency isn't an active fund"), except that a PATCH that doesn't change `fund`
  keeps an archived one. The `rules` categorizer puts it on its proposal
  (`InternalProposal.fund`), which the chain carries as the decision's category
  (`decision.category.fund`). Staging an import writes the whole line (`server/funds.ts`:
  `fundChoices` reads the funds list once per batch, `decidedLines` makes the line) when the
  fund is active and the shape can be read, and leaves it off, rather than failing, when it's
  archived or gone. `apply()` (re-applying a rule, Suggest categories) sets it on a transaction
  with no lines yet, and a rule with a fund also covers a transaction it categorized before
  that has none.
- **Schedules:** `TransactionTemplate.funds`; `occurrenceTransaction` copies it onto every
  occurrence; saving checks the names and the lines against the template's own splits.
- **Pairing two staged sides into a transfer** keeps both sides' lines (summed per fund, zeros
  dropped). Undoing it already restores each side as it was.
- **Renaming a fund goes through `app`** (`POST /api/app/v1/books/:book/funds/:fund/rename`,
  manage, refused for a writer by the ledger's own check), as accounts do: the ledger's rename,
  then `db.renameFund` (rules and schedule templates) in one app transaction.
- Unit tests: a rule's fund on a staged row (and not when the fund is archived), re-applying a
  rule, a schedule's occurrence carrying lines, pairing keeping them, the rename reaching rules
  and schedules.

## The PWA

What follows is as built. Roles come from the book list: `useCanWrite` (write or more; unknown
counts as yes) and `useCanManage` (owner or manage; unknown counts as no).

### The transaction page: Funds

A **Funds** section under the splits (and above Exclude from budget), on the transaction page,
New transaction and the schedule editor (the template's splits). It shows once the funds list
has loaded, **when the book has an active fund or the transaction already has lines** (decision
14). It reads the splits as they're being edited (`useFundRows` in `components/Funds.tsx`, the
rows' logic in `lib/funds.ts`), so it's always about the transaction as it stands.

- **One sentence first, in plain words:**
  - money in: "**$1,000.00 coming in.** Without a fund, it's Unallocated."
  - money out: "**$500.00 going out.** Without a fund, it comes from Unallocated."
  - transfer: "**$2,000.00 moving between accounts.** No fund changes unless you set it aside."
  - the splits don't balance yet (or an amount isn't a number): "Choose funds once the splits
    balance."
  - its kind can't be worked out (amounts not all in the operating currency): "Funds can't
    follow this one: its amounts aren't all in USD." Its lines show as text and are kept.
  - nothing moves: "Nothing comes in or goes out, so no fund changes."
- **Lines:** each is a verb ("To" on money in, "From" on money out, "For" on a transfer), a
  native select (good on phones and with a keyboard), an amount and ×. On a phone (30rem and
  narrower) a line is two rows, as a split is: the fund, then its amount and ×.
  - **With no lines,** one row whose select shows **Unallocated** (a transfer's: **No fund**),
    with no amount or × until a fund is chosen.
  - **The select:** the active funds, each with its balance ("Emergency · $2,400.00"), a fund
    already on another line disabled (no fund twice), a line's own archived fund kept as
    "(archived)", and for managers **New fund…**, which opens the New fund dialog and puts the
    new fund on the line.
  - **The first line follows** (decision 15): until an amount is typed in it, it holds what the
    transaction has left on its side (its size less the other lines there, never below 0). So
    choosing a fund puts all of it there, it keeps up while the splits change, and typing $300
    into a second line leaves $700 in the first. A saved line that was all of the transaction,
    alone on its side, follows again when the page opens.
  - **"+ Another fund"** (when every line on that side has a fund and a fund is left to choose)
    adds a line holding what's left, which is nothing while the first line is following.
  - **×** removes a line; the main list always keeps one row to choose in.
  - **Amounts** may be typed with `$` and commas, and are written with their cents ("500" is
    `500.00`, decision 18).
- **More options** (transfers only, while nothing is taken from a fund): a **Take from** group,
  "Take from a fund too: what it gives goes to the funds above, or back to Unallocated.", whose
  lines read "From" with "Choose a fund", its own first line following and its own "+ Another
  fund". It's open on its own when the transaction already takes from a fund, and folds away when
  its last line is removed. So "from Emergency for Vacation" is a Take from line and a For line,
  and "from Emergency" alone sends it back to Unallocated.
- **A summary line, always** (once the kind is known): what this transaction does to each fund,
  Unallocated last ("Emergency +$500.00 · Special Home Maintenance and Repair +$500.00 ·
  Unallocated +$0.00"; Unallocated's is the change in net worth less the lines).
- **A problem replaces it, in red:** the rows' own first ("Amounts are numbers, like 500.00",
  "Give Emergency an amount, or remove it"), then the kind and cap, worded as the ledger words
  them with dollar signs ("Its funds get $1,200.00, more than the $1,000.00 that came in").
  **Save (and Confirm) wait** while the lines you've changed have one, with the problem as the
  button's title. Saved lines that no longer fit don't stop Save (decision 16): the line reads
  "As saved, its funds don't fit: … Change them, or save the rest as it is."
- **Below zero is a note, not a problem:** "Car will be at −$480.00." (each fund the lines take
  from: its balance, less this transaction's saved line, plus the new one).
- **Saving** sends `funds` only when the lines changed. **Read-only** members see the lines as
  text ("From Emergency −$500.00") and the summary. Changing funds never asks about a reconciled
  transaction: funds don't touch amounts.

### Elsewhere

- **Review cards** (`FundChoice`, after the category and "Paid from", before Exclude from
  budget): when the book has an active fund and the card's kind is known, "**To fund** / **From
  fund** / **For fund**" and a compact select of names only (decision 20), beside its label.
  Choosing one writes the whole line (`wholeLine`); Unallocated (a transfer's "No fund") clears
  it. Lines that are split, partial, or taken from on a transfer show as chips with **Edit…**
  (its page, coming back to review); so do lines on a card when the book has no active fund.
- **Select mode** (review, ledgers, Transactions): **Fund…** in Actions, when the book has an
  active fund (decision 19). The bar shows a select: "Choose a fund…", "Unallocated (no fund)",
  and each fund with its balance. Each selected transaction gets that fund for its whole amount
  (the verb by its own kind), or its lines cleared. The bar's note: "Set the fund of 2
  transactions to Emergency; 1 had it already; skipped 1 not all in USD." or "Cleared the funds
  of 2 transactions; 1 had none."
- **Chips** (`FundChips`, decision 11): ledger rows and journal rows (Transactions, home's recent
  transactions) beside the tags, review cards with split lines, and the Schedules list (under
  each schedule's rule): "to Emergency" (green) or "from Wedding" (amber), long names cut short
  with an ellipsis at 11rem, the whole line in the title ("Emergency +$500.00"). The Rules list
  shows a rule's fund by name beside its category.
- **Funds** (Menu, after Budgets; `pages/Funds.tsx`): **Move money** (write, once there's an
  active fund) and **New fund** (manage) in the header; a card with **Net worth**, **In funds**
  and **Unallocated** (red below zero), "Unallocated is everything that isn't in a fund, your
  house and retirement accounts included.", and any unpriced commodities named; then a card per
  active fund: its balance (red below zero), description, and progress toward its target (a
  goal bar, "$7,500.00 to go · target $10,000.00", or "Reached"); then **Archived (n)** folded
  away, each with its archive date. With no funds: "Say what your money is for", what funds
  are, and "Start with New fund…" (managers) or "Someone who manages this book can set funds
  up."
- **A fund's page** (`/books/:book/funds/:fund`, `pages/FundPage.tsx`): ‹ Funds, its name and
  description; its balance (or "Archived" and the date) and target progress; **Move money**
  (write, while active: from Unallocated, to this fund, either changeable), and for managers, on
  a declared fund, **Settings**, **Archive…** or **Unarchive**, and **Delete** (only with no
  history). Its **History**, newest first, with a running balance: a transaction (payee or
  description, then its description and "unconfirmed" below) opens its page; a move ("Moved from
  Unallocated", its note below) opens to change or delete it (writers). With none: what to do. A
  name that isn't a fund: "There's no fund called …".
- **Move money** (a dialog): From and To (Unallocated or an active fund, each with its balance;
  an archived one kept when changing a move), Amount, Date (today), Note (optional), and the
  effect spelled out ("Unallocated −$2,500.00 → Wedding +$2,500.00"; before an amount, "No
  account changes: only what the money is for."). "Choose two different funds" and "An amount is
  a number more than 0, like 2500.00" as you go. Changing a move: "Change the move", Save, and
  Delete. It's also how a fund starts out holding money that's already in the bank.
- **New fund** (a dialog, from the Funds page or a line's picker): Name, Description and Target
  (both optional), checked as typed against the ledger's name rules and the book's funds
  ("There's a fund called Emergency already").
- **Settings** (a dialog): Name (renamed through `app`, so every transaction, move, rule and
  schedule follows; the page moves to the new name), Description, Target (blank clears it).
- **Archive…** (a dialog): "What's left ($2,500.00) goes to" (or "What it's short (…) comes
  from") Unallocated or another active fund, and "On" (today, or its last entry's date if that's
  later; not before its last entry). "It leaves the pickers, and its history stays: you can
  unarchive it later."
- **Home:** a **Funds** card after the starred accounts and their "+ Add an account" (decision
  21), when the book has an active fund: "Funds ›", each active fund's balance (red below zero;
  its progress bar, with a target), Unallocated, and "All funds ›".
- **Rules:** the rule editor's **Fund** select under Payee (when the book has an active fund, or
  the rule names one): None or an active fund, "What it matches is taken from this fund
  (spending), or put toward it (money in, a transfer): all of it." A rule whose fund is
  archived keeps it, with a warning that imports leave it in Unallocated (decision 23).
  "Remember as a rule…" carries a fund when the transaction's lines are one whole line
  (decision 22).
- **Schedules:** the editor's Funds section (lines saved on the template, carried by every
  occurrence; "Repeat…" carries the transaction's), and chips on the list.

## Toward assets: the next step

Kael's brokerage holds shares for its funds, so asset-aware funds come right after A. A is shaped
so that step adds, rather than reworks:

- **Every amount keeps its commodity:** fund lines (`… +10 VTI`), moves, the derived table's
  `currency` column. A refuses anything but the operating currency in one check, which the next
  step lifts.
- **A fund already reports `holdings` (a list) and `value`.** The PWA shows only `value`;
  listing holdings is B's.
- **The kind and size of a transaction are per commodity at heart** (a trade moves USD out and VTI
  in). A keeps only the operating currency's figure. The next step keeps one per commodity.
- **What it will need:** a commodity on amount inputs (picker lines, moves); Unallocated per
  commodity (net worth's holdings less funds'); prices for value and targets. The scenario work
  ([B/scenarios.md](../../funds-b/scenarios.md)) has the cases, and [B's design
  record](../../funds-b/design-record.md), "Picking up B", lists every place A assumes the operating
  currency. [B's plan](../../funds-b/PLAN.md) takes shares in funds as its first step.

## As built: where things are

- **Ledger** (`services/ledger/src/ledger`): `engine.py` (the `funds:` line, `funds_text` /
  `parse_funds`, `FundDeclaration` / `fund_directive`, `FundMove` / `move_directive` /
  `move_of`, `with_funds`, `balance_sheet_weights`), `fundlines.py` (names, `Shape` and
  `shape`, `lines_problem`, `declared`, `checked`), `funds.py` (the list, setup, rename,
  archive, history, moves), migration 13 (`fund_line`), `store.py` (`fund_lines`,
  `fund_entries`, `fund_users`), `models.py`, the routes in `api.py`, and `service.py`'s hooks
  on every transaction write.
- **Client:** `packages/ledger-client` (generated; `index.ts` exports the fund types).
- **app server** (`services/app/src`): `shared/funds.ts` (the rules: `shapeOf`, `wholeLine`,
  `linesProblem`, `mergedLines`, `fundName`), `server/funds.ts` (`fundChoices`, `decidedLines`),
  `server/ledger.ts` (`LedgerPort.funds`, `renameFund`), `server/testing.ts` (`FakeLedger`),
  `server/categorize/` (rules, the chain, `apply`), `server/schedules.ts`,
  `server/transfers.ts`, `server/db.ts` (migration 19, `renameFund`), `server/api.ts` (the
  rename route).
- **PWA** (`services/app/src/web`): `lib/ledger.ts`, `lib/appApi.ts` and `lib/queries.ts` (the
  calls, `useFunds`, `useFundHistory`, the mutations, `useCanManage`); `lib/funds.ts` (rows,
  following, lines, effects, below zero, `wholeFund`, `signedMoney`); `components/Funds.tsx`
  (`useFundRows`, `FundsFieldset`, `fundsShown`, `FundChips`, `FundChoice`, `Dialog` /
  `DialogForm`, `MoveMoneyDialog`, `NewFundDialog`, `TargetProgress`, `FundsCard`);
  `pages/Funds.tsx`; `pages/FundPage.tsx` (with `FundSettings` and `ArchiveFund`); and the
  wiring in `TransactionPage`, `Review`, `lib/bulk.ts` / `SelectBar`, `JournalList`,
  `AccountLedger`, `Home`, `Menu`, `App` (routes), `RuleEditor`, `Rules`, `ScheduleEditor` and
  `Schedules`; styles at the end of `styles.css` ("Funds (Funds A)").
- **Tests:** the ledger's `tests/test_funds.py` (30, Kael's four examples first); app units
  (`shared/funds.test.ts`, `server/funds.test.ts`, and fund cases in the categorizer, schedules
  and transfers tests; `web/lib/funds.test.ts`, 13); the API suite's `tests/e2e/src/funds.test.ts`
  (6: the four examples, the cap's 422s, PATCH, moves and archiving, a rule's fund on an import
  and a rename reaching it, roles); the browser suite's `tests/ui/src/funds.spec.ts` (13: the four
  examples, review cards (whole and split lines), Select mode's Fund…, More options, archiving, a
  rule's fund on an import, a schedule's occurrence, a writer, New fund… from a line).
- **Looked at:** every surface on a phone (390×844) and a desktop (1280×900), light and dark,
  with Kael's longest name, negative balances, errors and empty states. What it turned up was
  fixed: two-row lines on phones, the review card's select beside its label, the bulk select's
  width, home's fund rows in ink (the plain-link rule's `:not()` list), selects in forms in ink
  with the accent focus ring, and `.warning` readable in dark mode.

## Not in A

Everything in [B/PLAN.md](../../funds-b/PLAN.md): shares and other assets in funds (next), spend and fill
rules, defaults per account, groups, budget funds, loans. Also not built: funds in receipts and
the AI (neither proposes a fund), reports by fund, a fund filter on ledgers and Transactions, a
fund's holdings listed, paging a fund's history, balances as of a past date, and targets with
dates.

## Decisions to review

Made without asking; each is easy to change.

1. **Lines are one `funds:` metadata string on the transaction,** not on splits (see "In the
   books").
2. **Lines are checked only when they change.** Other edits keep them, and a transaction whose
   lines no longer fit says so on its page, rather than recategorizing failing.
3. **The kind comes from the change in net worth,** so a refund is money in: it can go back to
   the fund that paid. An opening balance can start a fund. Trades are transfers.
4. **A fund's date doesn't limit it:** a fund made today can be on last month's transactions.
5. **Names are free text** (spaces, any case), unique ignoring case.
6. **A rule's fund covers the whole amount,** in the direction the transaction goes. An archived
   or missing fund is left off a staged import rather than failing it.
7. **Pairing a transfer keeps both sides' lines** (unlike tags today).
8. **Archiving moves what's left** on the archive date, to Unallocated unless you choose a fund.
9. **Only managers see New fund…** in the editor's picker.
10. **Review cards show the fund picker only when the book has funds.**
11. **Chips are words** ("to Emergency", "from Wedding").
12. **A fund's history is one list,** not paged, in A.
13. **The release is `v0.1.13`.**

Made while building the screens (2026-11-02):

14. **The Funds section shows when the book has a fund to choose, or the transaction has
    lines.** A book that doesn't use funds doesn't see it; a manager makes the first fund on the
    Funds page (later ones from the picker's New fund… too).
15. **The first line holds what's left on its side** until an amount is typed (see "Lines"), so
    splitting a paycheck is: choose a fund, + Another fund, type one amount.
16. **Saved lines that no longer fit don't stop Save** ("As saved, its funds don't fit: …"):
    saving the rest keeps them, as the ledger does. Save waits only on lines you've changed.
17. **A transfer's empty choice reads "No fund"**, income's and spending's "Unallocated"; a Take
    from line's reads "Choose a fund".
18. **Amounts are written with their cents** ("500" is `500.00`), on lines and moves.
19. **Select mode's Fund… is offered only when the book has a fund,** and skips a transaction
    whose amounts aren't all in the book's currency (a saved one always balances, so that's the
    only one it can't read), saying how many.
20. **Review cards list fund names only;** the transaction page's picker shows each balance.
21. **Home's Funds card comes after the starred accounts** (and their "+ Add an account").
22. **"Remember as a rule…" carries a fund** when the transaction's lines are one whole line.
23. **Editing a rule whose fund was archived keeps it:** the edit leaves `fund` out unless it
    changed, and the editor warns that imports leave it off.
