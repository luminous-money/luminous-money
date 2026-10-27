Migrate from another system: plan
==================================================================================================

> **Status: built (2026-10-26).** The brief, from Kael (2026-10-26), after the chart of accounts
> import: bootstrapping a book is the hard part (hundreds of uncategorized transactions since
> July, and many accounts to make). One workflow, offered from the setup flow and the Accounts
> page until it's been done once (existing books too: Kael's live book hasn't run it), that takes
> a book from another system's export to:
>
> 1. its full previous chart of accounts,
> 2. concrete categorization rules from its history,
> 3. an optimized historical reference that makes the AI categorizer better from then on (and
>    keeps up as history grows, recent history counting more),
> 4. its uncategorized transactions with good suggestions, to confirm in bulk.
>
> The steps, as Kael gave them: upload the chart and the history; the chart is imported and
> normalized (no AI); the history is normalized the same way (no AI; import profiles per system,
> GnuCash first); optionally SimpleFIN (which may mean coming back another day: its requests
> are few); optionally the AI (its key and settings); then, with the AI, optionally the reference,
> rules suggested from history, and suggestions for every uncategorized transaction (the usual
> chain: rules, history, the AI). Old accounts map to new ones by the chart import's own
> normalization, as a pre-pass on the history.

## Decisions (mine, within the brief)

- **Rules and suggestions don't need the AI, so they're offered without it too.** Rules come
  from counting (below), and the chain's rules and history run without the AI. Declining the AI
  skips only the reference step. With the AI, all three are offered, as the brief has it.
- **The reference is derived, not stored:** it's worked out from the imported history and the
  book's own confirmed transactions each time it's used, so it's never stale and needs no job
  to regenerate it ("as history advances" happens by itself), with recent transactions weighing
  more (a half-life of 180 days). The reference step shows it and turns it on for the AI.
- **No AI builds the reference or the rules.** Both are counting, which is free, instant, the
  same every time and easy to check. The AI is where it earns its cost: using the reference to
  categorize.
- **Accounts the book already has can stand in for old ones.** Kael's live book already has
  bank accounts linked to SimpleFIN under its own names; an old asset or liability account can
  be mapped to one of them ("Same as …") or left out, instead of making a duplicate. Everything
  else maps by normalization alone.

## The steps

The page is `/books/:book/migrate`: the steps listed, each done, skipped or to come, and the
current one below. Progress is kept on the server (`book_migration` in `app.sqlite`), so it can
be left and picked up (from either entry point) at the step it was on; files aren't kept, so a
step that needs one asks again.

1. **Files.** The system (GnuCash for now) and its two exports, with how to make them:
   - **Accounts:** File → Export → Export Account Tree to CSV.
   - **History:** File → Export → Export Transactions to CSV, all accounts, the period wanted
     (a year or two), *Simple layout* unchecked.
2. **Accounts.** The chart import's preview and write (`shared/chart.ts`), which now reads
   GnuCash's tree export as it comes: `Full Account Name`, `Description` (else `Notes`),
   `Placeholder` (a node), `Hidden` (left out unless asked for), and `Type` (an account whose
   path doesn't start with a top-level account goes under its type's: `BANK` under Assets, and
   so on). GnuCash's `Imbalance-*` and `Orphan-*` and its trading accounts are left out. Asset
   and liability rows to add can be **Same as** an account the book has, or **Left out**.
   Adding records the mapping from every old name to its new one.
3. **History.** The transactions export, read as GnuCash writes it (one line per split, each
   with its transaction's ID, date and description; *Value Num.* in the transaction's currency),
   its account names mapped (the chart's mapping, else normalization; `Imbalance-*` and
   `Orphan-*` as uncategorized), voided transactions left out. It's kept as the book's
   **imported history** (`reference_transaction`), never written to the ledger, following
   renames, merges and divisions like everything `app` keeps by account name. Reading another
   file replaces it.
4. **Bank feeds** (optional). The Bank connections page's own panel. Linking brings a history
   that may need more than a day's requests: the step says so, and the migration waits here
   for as long as it takes.
5. **AI** (optional). The AI page's own panel: provider, key, accounts it may open (and how
   eagerly), guidance. Continuing needs it ready.
6. **Reference** (with the AI, and imported history). Its summary (payees, transactions, the
   period, the most frequent payees and where they went), and **Use it**.
7. **Rules.** Suggested from the reference: a payee (by its key) seen at least 3 times, at least
   90% to one open account, that no rule already covers. Each says how often and how
   consistently, and how many transactions waiting now it would categorize; tick and **Add**.
8. **Suggestions.** Every unconfirmed transaction still uncategorized, through the chain (rules,
   history with the imported history, the AI with the reference when they're on), in the
   background with its progress shown (the AI answers 20 at a time); then **Review them**.

Then **Finish**: the migration is done, and its entry points go.

## The reference

From each transaction with a balance-sheet side (where an import comes from): its payee key
(`shared/payees.ts`) and each other posting's account and amount, weighted
`0.5 ^ (age in days / 180)`. Per payee key: how often it was seen, when last, and per account
its share (by weight), how often, and its amounts (typical, lowest, highest).

- **The history categorizer** learns from the imported history after the book's own (its own
  tiers first, then the imported history's, at 0.8 of the confidence), only toward open leaves.
- **The AI categorizer** gets, with each batch, the reference's entries for payees like the
  batch's (by key overlap, the closest few each, at most 40), as a block of its prompt: payee,
  how often, when last, where it went and for how much. Its system prompt says to use it like
  history, matching payees even when the bank's text differs from the old books'.

## Tests

- **app (unit):** GnuCash's tree read by the chart planner (types, placeholders, hidden,
  imbalance), "same as" and "left out"; GnuCash transactions read and mapped (IDs, splits,
  values, voids, dates, the simple layout refused); the reference (weights, shares, amounts);
  rule suggestions; the history categorizer with imported history; the AI categorizer's
  reference block; the migration's routes and its background suggestions (FakeLedger, fake AI).
- **ai:** the fake provider follows the reference; the prompt has it.
- **browser:** the whole workflow on a fresh book with synthetic GnuCash exports and the fake
  AI: accounts, history, bank feeds skipped, AI on, the reference used, rules added,
  suggestions made, finished, and the entry point gone.
