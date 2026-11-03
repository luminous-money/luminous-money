Funds A: Basic Funds: plan
==================================================================================================

> **Status (2026-11-02): built**, released as `v0.1.13`. The ledger, the app server and the PWA
> (every surface below), with unit, API and browser tests; looked at on a phone and a desktop,
> light and dark. The calls made while building the screens are added to
> [Decisions to review](#decisions-to-review) (14 to 23). Planned with Kael (2026-11-02). Funds is split in two. **A** (this):
> the dual ledger with no rules at all. Money reaches or leaves a fund only when you say so on a
> transaction, or move it. **B** ([B/PLAN.md](../B/PLAN.md)): everything else designed so far
> (asset-aware funds first, then spend and fill rules, groups, budget funds). Kael's answers
> are under [Decided with Kael](#decided-with-kael); the calls made without asking are under
> [Decisions to review](#decisions-to-review).

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
- **A fund's balance** is the sum of its lines and moves dated on or before the day asked about
  (today by default), unconfirmed transactions included, as account balances are.
- **Unallocated** = net worth − every fund. Net worth is the top-level Assets and Liabilities
  subtrees' values in the operating currency (the chart's own figure, `chart.tree`). Unpriced
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
  - **Unknown:** a balance-sheet split in another currency with no cost or price, or one booking
    alone can fill. Lines can still be written; they're just not checked against the size.
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
- **Names:** trimmed, inner spaces collapsed, 1–60 characters, no `;`, unique ignoring case, and
  never "Unallocated" (any case). Shown as typed.

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
  no fund twice; not Unallocated; non-zero; the operating currency (A only); and the kind and
  the cap above, when the kind is known. A 422 says which rule broke ("$200.00 more than came
  in"). **Writes without `funds` aren't checked:** recategorizing in review or pairing can never
  fail because of a fund. A transaction whose lines no longer fit says so on its page.
- **The API** (`Fund`, `Funds`, `FundIn`, `FundPatch`, `FundRename`, `FundArchive`, `FundEntry`,
  `FundHistory`, `FundMoveIn`, `FundMove`, `FundMovePatch`, `FundLine`):
  - `GET /books/{b}/funds?on=`: every fund, with `holdings` (amounts per commodity) and
    `value`, its target, description, `archived`, `entries`, `updated_at`; plus `currency`,
    `net_worth`, `unallocated` and `unpriced`. *(read)*
  - `POST /books/{b}/funds`, `PATCH /books/{b}/funds/{name}` (description, target),
    `POST …/{name}/rename`, `POST …/{name}/archive` (`date`, `to`: where what's left goes,
    Unallocated by default, written as a move on that date), `POST …/{name}/unarchive`,
    `DELETE …/{name}?updated_at=` (only with no history). *(manage)*
  - `GET /books/{b}/funds/{name}/entries`: the fund and its history, newest first: each
    transaction line or move with its date, payee and description (a move's other side and
    note), amount and the running balance. *(read)*
  - `POST /books/{b}/fund-moves`, `PATCH` and `DELETE /books/{b}/fund-moves/{id}`, versioned
    as every edit is. *(write)*
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
- **Rules:** `CategoryRule.fund` (`string | null`; app migration adding `category_rule.fund`);
  `ruleProblem` checks the name; the `rules` categorizer puts it on its proposal
  (`InternalProposal.fund`), and the chain carries it in `Decision.fund` when that rule's
  category wins. `stagedTransaction` writes the whole line when the fund is active (the batch
  reads the funds list once), and leaves it off, rather than failing, when it's archived or
  gone. `apply()` (re-applying a rule, Suggest categories) sets it on a transaction that has no
  lines yet.
- **Schedules:** `TransactionTemplate.funds`; `occurrenceTransaction` copies it onto every
  occurrence; saving checks the names and the lines against the template's own splits.
- **Pairing two staged sides into a transfer** keeps both sides' lines (summed per fund, zeros
  dropped). Undoing it already restores each side as it was.
- **Renaming a fund goes through `app`** (`POST /api/app/v1/books/:book/funds/:fund/rename`,
  manage), as accounts do: the ledger's rename, then rules and schedule templates follow.
- Unit tests: a rule's fund on a staged row (and not when the fund is archived), re-applying a
  rule, a schedule's occurrence carrying lines, pairing keeping them, the rename reaching rules
  and schedules.

## The PWA

### The transaction page: Funds

A **Funds** section under the splits (and above Exclude from budget), in the transaction page,
New transaction and the schedule editor. It reads the splits as they're being edited, so it's
always about the transaction as it stands.

- **One sentence first, in plain words:**
  - money in: "**$1,000.00 coming in.** Without a fund, it's Unallocated."
  - money out: "**$500.00 going out.** Without a fund, it comes from Unallocated."
  - transfer: "**$2,000.00 moving between accounts.** No fund changes unless you set it aside."
  - not balanced yet: "Choose funds once the splits balance."
- **Lines:** each is a verb ("To", "From", "For"), a fund picker, an amount and ×.
  - **The first line takes the whole amount,** and keeps following it while the splits change
    until you type an amount of your own. As built, it holds what's *left* on its side: typing
    $300 into a second line leaves $700 in the first.
  - **"+ Another fund"** adds a line holding what's left.
  - **The picker** is a native select (good on phones and with a keyboard): the active funds by
    name, each with its balance ("Emergency · $12,000.00"), and for managers **New fund…**,
    which makes one by name without leaving the page.
- **A summary line, always:** what this transaction does to each fund, Unallocated included
  ("Emergency +$500.00 · Special Home Maintenance +$500.00 · Unallocated +$0.00"). A problem
  replaces it, in red ("$200.00 more than came in"), and Save waits until it's fixed. Drawing a
  fund below zero is a note, not a problem ("Emergency will be at −$300.00").
- **More options** (transfers only): a second list, **Take from**, of `−` lines. It's open on
  its own when the transaction already has one. So "from Emergency for Vacation" is a Take from
  line and a Put toward line, and "from Emergency" alone sends it back to Unallocated.
- **Read-only** members see the lines without the controls. Changing funds never asks about a
  reconciled transaction: funds don't touch amounts.

### Elsewhere

- **Review cards:** a compact **From fund / To fund / For fund** select (the verb by kind),
  shown when the book has funds. Choosing one writes the whole line, and Unallocated clears it.
  A transaction with split lines shows them with **Edit…** (its page) instead.
- **Select mode:** **Fund…** in Actions: pick a fund, or Unallocated to clear. Each selected
  transaction gets that fund for its whole amount (the verb by its own kind). The bar's note
  says what changed and what was skipped, and why ("unbalanced").
- **Rows:** ledger rows, journal rows and review cards show lines as chips beside tags, in words:
  "to Emergency", "from Wedding". Long names are cut short with an ellipsis, and the whole
  line is in the title.
- **Funds** (menu, after Budgets): net worth, in funds, and Unallocated ("everything that isn't
  in a fund, your house and retirement accounts included"); each fund's balance (red below
  zero), description and progress toward its target; **Move money** (write) and **New fund**
  (manage); archived funds folded away below. With no funds, it says what funds are for and
  how to start (managers get the button).
- **A fund's page:** its balance, target and description; **Move money** (from or to it);
  **Settings** (manage: name, description, target), **Archive…** (where what's left goes, and
  when) and **Delete** (only with no history); and its history, newest first, with a running
  balance. A transaction opens its page. A move opens to edit or delete it.
- **Move money:** from, to (Unallocated or a fund, each showing its balance), amount, date
  (today) and a note, with the effect spelled out ("Unallocated −$2,500.00 → Wedding
  +$2,500.00"). It's also how a fund starts out holding money that's already in the bank.
- **Home:** a **Funds** card under the starred accounts when the book has a fund: each active
  fund's balance (with its progress, if it has a target), Unallocated, and All funds ›.
- **Rules:** the rule editor's "then" gets **Fund** (None, or a fund), explained ("Imports this
  rule matches are taken from, or put toward, this fund for their whole amount"). A rule whose
  fund is archived says so. The list shows the chip.
- **Schedules:** the editor gets the Funds section; the list shows chips.

## Toward assets: the next step

Kael's brokerage holds shares for its funds, so asset-aware funds come right after A. A is shaped
so that step adds, rather than reworks:

- **Every amount keeps its commodity:** fund lines (`… +10 VTI`), moves, the derived table's
  `currency` column. A refuses anything but the operating currency in one check, which the next
  step lifts.
- **A fund already reports `holdings` (a list) and `value`.** The PWA shows `value` and will list
  holdings when there's more than one.
- **The kind and size of a transaction are per commodity at heart** (a trade moves USD out and VTI
  in). A keeps only the operating currency's figure. The next step keeps one per commodity.
- **What it will need:** a commodity on amount inputs (picker lines, moves); Unallocated per
  commodity (net worth's holdings less funds'); prices for value and targets. The scenario work
  ([B/scenarios.md](../B/scenarios.md)) has the cases.

## Building it

All done (2026-11-02). Where things are: `services/ledger/src/ledger/{funds,fundlines}.py`;
`services/app/src/shared/funds.ts` (the rules), `server/funds.ts` (a rule's fund on what it
stages); the PWA's `lib/funds.ts` (rows, following, what a transaction does to each fund),
`components/Funds.tsx` (the Funds section, chips, the review card's choice, Move money, New
fund, the home card), `pages/Funds.tsx` and `pages/FundPage.tsx`; tests in
`services/ledger/tests/test_funds.py`, `tests/e2e/src/funds.test.ts` and
`tests/ui/src/funds.spec.ts`.

1. **Ledger:** engine, migration 13, store, `funds.py`, models, routes; `tests/test_funds.py`.
   `pnpm generate`, and rebuild the client.
2. **app server:** `shared/funds.ts`; `LedgerPort` and `FakeLedger`; rules (migration, db,
   categorizer, chain, staging, apply); schedules; pairing; the rename route; unit tests.
3. **PWA:** `lib/funds.ts` (formatting) and queries; `FundsField`, `FundSelect`, `FundChips`,
   `MoveMoney`, `NewFund`; the Funds and fund pages; the editor, review cards, bulk, rows, home,
   menu, rules and schedules.
4. **Tests:** API (`tests/e2e/src/funds.test.ts`) and browser (`tests/ui/src/funds.spec.ts`):
   Kael's four examples first, then review, bulk, More options, archive, a rule on an import, a
   schedule's occurrence, and roles (write can tag and move, can't create).
5. **Looking at it:** screenshots of every surface on a phone and a desktop, light and dark,
   with a short name and Kael's longest ("Special Home Maintenance and Repair"), negative
   balances, errors, and empty states. Fix what reads badly. Then the e2e suite again.
6. **Docs:** design.md ("Funds A"), PLAN.md, RESUME.md, this plan's status.
7. **Release** `v0.1.13`: `pnpm test` and `pnpm e2e` green, commit, push, tag, and watch the
   Release workflow through.

## Not in A

Everything in [B/PLAN.md](../B/PLAN.md): shares and other assets in funds (next), spend and fill
rules, defaults per account, groups, budget funds, loans. Also: funds in receipts and the AI,
reports by fund, a fund filter on ledgers.

## Decisions to review

Made without asking; each is easy to change.

1. **Lines are one `funds:` metadata string on the transaction,** not on splits (see "In the
   books").
2. **Lines are checked only when they're written.** Other edits keep them, and a transaction
   whose lines no longer fit says so on its page, rather than recategorizing failing.
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
