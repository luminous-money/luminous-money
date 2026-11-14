M20: Design polish: plan
==================================================================================================

> **Status: the first pass and Kael's round of nits are built and released (2026-11-14,
> `v0.1.31`).** What's left is below ("Not done, noted"). Smaller polish between milestones is in
> [M99: Follow-ups](../m99-follow-ups/PLAN.md#polish).

Kael (2026-11-14): "It works very well, but it feels like open source software; I want it to
feel like a slick production application." Monarch and Origin are the references. Reports, home
and the split editor stay as they are. Design for the phone first; nothing may depend on hover;
WCAG where it makes for better use, without chasing full compliance.

## Done, and committed (the functional half)

- [x] **Errors say what they mean** (a red "409" was all some said), loading shows a spinner,
      offline and an unanswering server are said at the top, new versions come in by themselves
      when nobody's working. design.md: "Errors, loading, connection and new versions".

## Built: the first pass

- [x] **A typeface:** Geist (Kael chose it from Inter, Geist and Instrument Sans),
      self-hosted (`@fontsource-variable/geist`, its italics too), figures in columns, and
      precached by the service worker so the installed app keeps it offline. Origin's is Suisse
      Int'l and Monarch's are their own, neither free.
- [x] **Neutrals and depth:** cooler grays, text that meets WCAG AA on paper and cards, cards
      with a faint shadow, a firmer edge on fields; the blue and the dark mode's cyan unchanged.
- [x] **Buttons:** raised white with a firm edge (secondary), filled accent (primary), quiet
      ones (icons, menus, text) with no edge; 40px, 44px on touch screens; focus as a soft ring
      (and an outline forced colors can draw). Links underlined only when pointed at.
- [x] **The main menu, grouped:** Home, Review, Transactions, Reports always; Plan (Budgets,
      Funds, Schedules), Accounts (Accounts, Loans, Commodities, Import) and Automation (Bank
      connections, Rules, Amazon, AI) fold away, the one holding the page you're on open; then
      Sharing, Manage books, Your account, System, Log out. Icons beside each. On a phone, a
      drawer from the right (focus inside it, the page behind inert); on a wide screen, a sidebar
      with the page beside it. `components/Nav.tsx` is both.
- [x] **Sticky:** the masthead stays at the top, frosted; editors' Save and Confirm are a
      frosted bar across the bottom.
- [x] **(i) for the explaining:** `components/Info.tsx`, a note on tap. Used for Bank
      connections' intro, a connection's request budget, how a brokerage is read, dividends'
      default, Funds' Unallocated and starring.
- [x] **Fieldsets:** a group's name is a small heading inside it, not a label cut into its
      border (global: `legend` floated).
- [x] **The transaction page:** a summary first (status, payee, amount, date and account; ⋯ with
      Repeat… and Delete), then its fields, the splits, notes and attachments; funds and "Exclude
      from budget" folded into **More** at the bottom, which says what's set ("Wedding · Not in
      budgets") and opens itself when a fund blocks saving.
- [x] **Review's cards:** the same More for funds and Exclude from budget (a sale that needs a
      fund opens it); dates as "Nov 13".
- [x] **Bank connections, by bank:** a connection's accounts under their institution; "can't
      read its activity yet" said once per institution; Sync now beside the connection's name,
      Disconnect quiet at its foot; Connect folded to "Connect another bank" once there's one.
- [x] **An account's ledger:** Reconcile, Move money, Edit and Sync now in ⋯ ("Account
      actions"), beside Select.
- [x] **Problems in a tinted box with a mark,** not a line of red.
- [x] **Find on page** (`components/FindBar.tsx`), for the installed app, which has no browser
      find (no page can open the browser's own): in the menu, a bar at the top marking matches
      (the CSS Custom Highlight API) and fields whose value matches; up, down, Enter, Escape.
      Offered in the installed app (and on the dev server), where the browser has none.

## Kael's round (2026-11-14, after trying it)

- [x] **Breadcrumbs for Back** (`lib/crumbs.ts`, `components/Crumbs.tsx`): a page's trail is
      where it was opened from (`?back=`, with that page's own trail) or its structure (an
      account under its parents under Accounts; a rule under Rules). From the Accounts page an
      account says Home › Accounts › Expenses › Food, not just "‹ Home". Every "‹ Back" went.
- [x] **The menu follows where you came from:** a transaction opened from review (Split…) is
      still Review in the menu (`?back=` followed to where it started).
- [x] **The phone's menu** covers the whole screen (one logo), and slides back out on closing.
- [x] **The sidebar stays at the top** to the very end of the page (the shell is its grid).
- [x] **Joined choices** (`.segmented`): one control with dividers; three or more stack on a
      phone.
- [x] **Accounts:** a node's page has its **Subaccounts** (the chart's tree, `ChartTree`, in a
      window of its own height) between Name and Budget, with + Add. Adding an account offers
      **an account or a group** (leaf or node, (i) says which is which), stars it only if asked
      (unchecked under an account), and lands on its page. The Migrate card has a × (it marks
      the migration done; Migrate stays in the Accounts page's ⋯) and room below it.
- [x] **Import transactions is quieter:** off the menu; a small link on home between recent
      transactions and the accounts; in a ledger's ⋯.
- [x] **Lists' header** (Transactions, review, an account's ledger: `ListTools`): Search,
      Select and the filter in one row. The filter opens a panel (Accounts, Tags, a date to go
      to, and on ledgers Reconciliation); closed, what's on shows as pills ("tag: trip"), each
      removed by a tap. Select mode's bar takes the row's place, the filter holding (Select all
      is what's shown); actions keep the selection. Ctrl or ⌘ click starts Select mode with that
      one. An account's ledger searches too (the ledger's `q`, as the journal's).
- [x] **Reports:** a leaf in the breakdown opens too: its own transactions below.
- [x] **Review's swipe** tilts the card, and Confirm and Skip drop it off down-right and
      down-left.
- [x] **Fixes:** Select mode's cards went gray a moment after a tap (a touch screen's lingering
      hover: hover effects now only where there's hover); a tag field sat against its tags.

Taken as settled when Kael asked to commit and release: the sidebar on wide screens, the menu's
groups, Sync now in a ledger's ⋯, the cooler neutrals, field edges short of 3:1.

## Not done, noted

- **Connection-wide errors under their bank:** the Bridge's errors are plain strings about the
  connection (SimpleFIN protocol 1); which bank one is about is only in its words, and string
  matching was ruled out (2026-11-12). Protocol 2 has an error's account (M99, "SimpleFIN's
  protocol 2"); with it, an error goes under its bank.
- **Ledger and journal dates** are still ISO ("2026-11-13") in lists (home's recent
  transactions, ledgers, Transactions); home was to stay as it is.
- **An account ledger's filter has no Accounts** (the ledger API filters by tags, reconciled
  and search; the journal's `account` isn't there): its panel has Tags, the date and
  Reconciliation.
- **Other pages' explaining** could take (i) too (Amazon's and Migrate's intros, the loan
  questionnaire's notes); left for Kael's reaction to the first ones.
- **Mobile usability, across the app** (from docs/PLAN.md's Polish): this pass is phone-first,
  but a page-by-page walk on a phone is still to do.
