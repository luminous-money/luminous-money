M16: Receipt capture: plan
==================================================================================================

> **Status: first pass built (2026-10-18); the [second pass](#the-second-pass-extract-then-categorize)
> (reading in two steps, payment cards, categorizing splits) planned 2026-10-18 and being
> built.** The brief, from [the plan](../../PLAN.md): take a picture of a receipt, and AI makes
> a transaction from it. Its spec is the notes beside this plan ([notes.md](notes.md)).

## What M16 is

Snap a receipt (or upload one), and an unconfirmed transaction matching it lands in review, the
receipt attached, itemized or not as you like. When the bank's copy comes in later, the matcher
recognizes the transaction you already have, and reconciling covers it like any other.

Two foundations come first, since the feature stands on them:

- **Attachments:** any transaction can hold files (5 MB each): a camera button on a
  transaction's page (and the new-transaction page) offers **Open camera** (grayed out without
  one) or **Upload**.
- **AI, per book:** on or off, a provider (Claude, for now) and its credential, and the AI's own
  settings: whether it may create accounts (how eagerly, with what guidance) and whether receipts
  are itemized by default.

## What exists today

- **Transactions** are the ledger's; `app` stages them from imports (unconfirmed, with
  `source:` metadata) and owns review.
- **Uploads:** `app` takes CSV files as multipart forms; nothing stores files.
- **Secrets:** `app` seals SimpleFIN access URLs with AES-256-GCM (`simplefin/crypto.ts`, a
  key from the environment).
- **The matcher** (M2) matches an imported row to a transaction already in the account (same
  amount, ±5 days), so a receipt's transaction is found when the bank's arrives.
- **Services** sit behind Traefik, each under its own `/api/<service>/v1` prefix, with
  forwardAuth setting `X-User-Id`; the ledger answers who may do what in a book.

## Decisions

### Architecture: an `ai` service

- **`services/ai`** (TypeScript, Hono, like `auth` and `app`), at **`/api/ai/v1`** behind the
  same session check. It owns everything AI: each book's AI settings and credential, the
  providers, and reading receipts. Nothing else talks to a model.
- **Its health is how the rest knows AI is there:** `GET /api/ai/v1/health` says it's up and
  which providers it has. The PWA checks it (and the book's settings) before offering anything
  AI; if the service is down, the features simply aren't offered, and the rest of the app is as
  it was.
- **It reads; it doesn't write books.** Reading a receipt is a pure function of the image and
  the context `app` sends (the chart of accounts, the hints, the book's settings): it returns a
  proposed transaction, and `app`, which stages everything else, stages this too. So the ledger
  keeps one writer for staged transactions, and the AI service never needs write access.
- **Roles:** reading a book's AI settings needs a member's read; changing them, or its
  credential, a manager's; reading a receipt, write. The service asks the ledger (as the
  caller), as `app` does.
- **M19 (AI categorization)** builds on this service: a provider, a book's credential and
  guidance, already there.

### Attachments: the ledger's

- **Files belong with the transactions they're about,** so the ledger keeps them: an
  `attachment` row (book, transaction, filename, content type, size, SHA-256; ledger migration
  10) and the bytes on the data volume (`attachments/<book>/<id>`). Deleting a transaction, or
  its book, deletes its attachments.
- **5 MB each,** any type; refused (413) above that. The PWA shrinks camera shots before
  uploading (JPEG, at most 2,000 px a side), so a receipt photo is well under.
- **API:** `GET /books/{b}/transactions/{t}/attachments`, `POST …/attachments?filename=` (the
  body is the file, its `Content-Type` the type: no multipart needed),
  `GET /books/{b}/attachments/{a}` (the file), `DELETE /books/{b}/attachments/{a}`. A
  transaction says how many it has (`attachments`), so lists can show 📎.
- **Exports and backups don't carry them yet** (they're Beancount text): noted for later.

### AI settings, per book

Kept by the `ai` service (`ai.sqlite`, `ai_setting`), versioned like every edit:

- **Enabled** (default off), **provider** (`claude`; `fake` in test stacks only), and its
  **credential**: an API key (Claude has no OAuth for third-party apps), sealed at rest with
  `AI_ENCRYPTION_KEY` (the sealer `app` uses for SimpleFIN, moved to `@fava-beans/db`), never
  sent back: the settings say only that one is set, and its last four characters.
- **Itemize receipts by default** (yes / no).
- **Account creation:** off by default; when on, **eagerness** (`reluctant`, `average`,
  `aggressive`) and **guidance** (free text: "I like detailed, deep hierarchies…").
- **Ready** = enabled, a provider, and a credential. The PWA offers receipts only when the book
  is ready and the service is healthy.

### Reading a receipt

`app`'s `POST /books/:book/receipts` (multipart: the file, plus the form's fields) does it all,
so the PWA makes one request:

1. **The hints:** the base account (the account page you came from, if it's an asset or
   liability; else none), itemize (yes / no), and anything else you typed: total, date, payee,
   a note.
2. **`ai` reads it, and `app` stages it:** in the first pass, one call returned a whole
   proposed transaction. The [second pass](#the-second-pass-extract-then-categorize) splits
   that into extracting the receipt's facts and categorizing its splits, with `app` putting the
   transaction together between them.
3. **No base account:** `Assets:Unknown`, a system account opened when it's first needed;
   review asks "Paid from" (or "Into") before it can be confirmed, as it asks for a category.
4. **It always makes something:** if the AI is off, down, or can't read it, the transaction is
   made from what you typed (or a zero amount, "Receipt: couldn't read it"), with the receipt
   attached and a note saying why, so nothing is lost.
5. **Then review:** the PWA goes to the transaction in review (`/books/:book/review?only=<id>`),
   and confirming or skipping it brings you back where you started (`back`).

### The Claude provider

- **The official SDK** (`@anthropic-ai/sdk`), the **Messages API**, structured output
  (`output_config.format`, a JSON schema, validated again on arrival with zod), adaptive
  thinking. A refusal or an error is "couldn't read it", not a failure of the capture. Its two
  operations and their models are the second pass's.
- **Mechanics later:** evals and tuning aren't this milestone's; its job is the structure, the
  inputs and outputs, and a capture that always yields something. The one place it invests in
  the prompt now is the total (below).

### In the PWA

- **The camera button** in the masthead (a book that's ready, the service healthy, and you can
  write) opens **Capture receipt** (`/books/:book/receipt`), with the account you were on as
  the base account and where you were as `back`.
- **Capture receipt:** the top half is the live camera (or, once taken, the photo, with ↺ to
  take another); the bottom is a drawer (a handle opens and closes it) with **Upload instead**
  at its top, the base account, **Itemize receipt?**, the optional total, date, payee and note,
  and **Create transaction**.
- **A transaction's page** lists its attachments (a thumbnail for an image, else its name),
  each to open or remove, and the camera button to add one (**Open camera** or **Upload**). The
  new-transaction page holds them until it's saved.
- **AI settings** (`/books/:book/ai`, from the menu): enabled, provider, the key (set or
  replace; never shown), itemize by default, account creation with its eagerness and guidance.
  Managers change them; members see them.

## The second pass: extract, then categorize

Decided with Kael, 2026-10-18. Reading a receipt is two narrow operations composed, and
categorizing works on a transaction's unconfirmed **splits**, so a receipt is staged the way
an import is.

### Payment cards on accounts

- **An asset or liability account can list its cards:** each a brand (optional: Visa,
  Mastercard, Amex, Discover, other) and the last four digits. One account may have several
  (a card held by two people has two numbers). A divided account holds them on the whole, like
  its bank link; its parts can't.
- **Kept on the account's `open`** (`cards: "visa 9499, visa 0417"`: Beancount metadata has no
  lists), so exports carry them; set through the account's settings (`cards` on its PATCH),
  edited in the account editor. A card (brand and last four) is one account's in a book: the
  ledger refuses a second.
- **Which account paid:** the receipt's card, matched by its last four (and its brand, when two
  accounts share the digits), else the page you came from (the hint), else `Assets:Unknown`.
  Nothing guesses it from account names. A divided account takes it in its main part.

### Split flags: what's unconfirmed is a split

- **A transaction's flag keeps its meaning:** `!` in review, `*` confirmed. Review's queue,
  budgets' unconfirmed amounts, ledgers, reconciling, schedules, transfer pairing and the bank
  mirror are unchanged.
- **A proposed split carries its own flag:** what's staged for categorizing is `! Expenses:…`
  (Beancount's posting flag); the side that's known (the bank's, a matched card's, or one you
  chose) has none. So a split proposed as Groceries is still unconfirmed, and can be asked
  about again.
- **Confirming a transaction confirms its splits:** the ledger clears posting flags whenever a
  transaction is written as `*`, through any route (JSON writes, the flag alone, reconciling).
  Text imports and restores keep what the text says.
- **Choosing an account yourself confirms that split** (review's pickers, Select mode's
  "Categorize as…", the transaction's page), though the transaction still waits for Confirm.
- **Confirmable:** a flagged split on a real account can be confirmed (that accepts the
  proposal); one on Uncategorized or `Assets:Unknown` can't.
- **For SQL:** the posting's flag and its `memo:` become derived columns (ledger migration 11),
  and the compact history carries them, for item history.
- **What's already in review** (unflagged): its Uncategorized splits are still undecided; a
  proposed one counts as decided. No backfill.

### Categorizing splits

- **The unit of work** is a transaction's unconfirmed splits (index, amount, memo), with the
  transaction around them as context: date, payee, description, the known splits. A bank row is
  a transaction with one; an itemized receipt has several (tax and tip are splits like the
  rest).
- **A proposal** names accounts for specific splits, and/or a **fallback** for the rest. Each
  split takes the best proposal for it, else the best fallback, else Uncategorized.
- **Who says what:** rules and payee history match the transaction, so their answer is a
  fallback (Jewel → Groceries). **Item history** (new) matches a split: an item confirmed
  before at the same payee ("Eggs Hppy 18" at Jewel) gets that account again. The AI answers
  per split, with a fallback, and may propose accounts to open (with account creation on).
- **Settling:** a proposal for a split at 0.9 or more settles it. A fallback settles a
  transaction only when it has one split: so bank rows settle as they do today, and a
  "Jewel → Groceries" rule doesn't stop a Jewel receipt being itemized; it catches what's
  missed.
- **External categorizers (API v1)** keep their contract: they're asked about one-split
  transactions as now; for several, their one-posting answer counts as the fallback.
- **"Suggest categories" and re-applying a rule** act on flagged splits (and Uncategorized
  ones), instead of guessing what the user hasn't decided from the stored proposal.
- **The AI categorizer runs for receipts only** (it's reading the receipt anyway); whether
  imports call it is M19's to decide.
- **Receipts never confirm automatically,** whatever a rule says: you land on them in review.

### The ai service's two operations

- **`POST /books/:book/receipts/extract`** (Claude: `claude-sonnet-5`,
  `AI_CLAUDE_EXTRACT_MODEL`): the receipt in; out, what it says and nothing about the book:
  the payee, date, currency, the **total** with the text it was read from, whether it's a
  refund, how it was paid (a card's brand and last four, or cash), the splits (each as printed
  and spelled out, with its amount; subtotal lines left out, tax, tip, fees and discounts in),
  and a note.
- **Getting the total right:** the system prompt defines it as what was charged to the payment
  and works through the traps (a signed slip's handwritten tip, "you saved" and coupon lines,
  cash tendered and change, split tender, gift card balances, returns, foreign currency); the
  answer quotes where it read the total (the payment line's amount should agree); and the
  service checks that the splits sum to the total, and if they don't, answers once in the same
  conversation ("your items sum to 21.98, the total is 23.50: read it again") before giving
  up and saying by how much. A total you typed wins over the receipt's, and the note says so.
- **`POST /books/:book/categorize`** (Claude: `claude-opus-5`, `AI_CLAUDE_CATEGORIZE_MODEL`,
  with the server-side fallback on a refusal): transactions with their unconfirmed splits, the
  chart, the history that bears on them, and the book's guidance and creation settings in; out,
  an account per split, a fallback per transaction, the accounts it would open, and a reason.
  Text only. M19 calls the same thing.
- **The fake provider** does both deterministically, for test stacks.

### A receipt, end to end

1. **Extract** (if the book's AI is ready; else the hints alone).
2. **Build the transaction:** the paying account (card, hint, `Assets:Unknown`); itemized, the
   splits as flagged splits on Uncategorized (with their `memo:`), plus one for any difference
   from the total; not itemized, one flagged split of the total.
3. **Categorize** through the chain: rules, history, item history, then the AI.
4. **Stage** unconfirmed, the receipt attached, opening any accounts the AI proposed (with
   creation on); then review, as before.

### In review

- **A transaction with several unconfirmed splits** shows each on its card: what it is, its
  amount, and its account to pick ("fallback" when that's where it came from), rather than
  only "Open".

### How the second pass gets built

1. **Ledger:** cards (on `open`, validated, unique, kept with a divided account's whole);
   posting flags cleared on confirm; migration 11 (posting flag and memo), in the compact
   history; tests; `pnpm generate`.
2. **`ai`:** the two operations and their types (`packages/ai-api`); Claude's extract (with
   the correction turn) and categorize; the fake's; the old read route goes; tests.
3. **`app`:** the chain over splits (fallbacks, settling, item history, the external adapter,
   the AI categorizer); staging with split flags; Suggest and rules over flagged splits; card
   matching; receipts rebuilt on extract, build, categorize, stage; tests.
4. **PWA:** cards in the account editor; choosing an account clears its split's flag; review's
   split rows.
5. **Tests and docs:** API e2e (cards; a receipt paid by a known card; an itemized receipt's
   flagged splits; staged imports' flags; confirming clears them), browser (cards; picking a
   receipt's splits in review), design.md, the categorizer API doc, PLAN.md, RESUME.md.

## How it gets built (the first pass)

1. **`@fava-beans/db`:** the sealer, moved from `app` (which uses it from there).
2. **Ledger:** attachments (migration 10, the files, the routes, cleanup with transactions and
   books, the count on transactions); tests.
3. **`ai`:** the service (config, `ai.sqlite`, health, settings and credential with roles, the
   receipt reading route, providers: Claude and fake); Dockerfile, bake target, compose, the
   Traefik route; tests.
4. **`app`:** the receipt route (reading through `ai`, checking, opening accounts, staging,
   attaching, the fallback); tests.
5. **PWA:** AI settings, the masthead's camera button, Capture receipt, attachments on a
   transaction's page, review's single item with `back`.
6. **Tests:** API e2e (settings and the key's secrecy; a receipt read by the fake provider
   becomes an unconfirmed transaction with its attachment; AI off still makes one); browser
   (set AI up, upload a receipt, land on it in review, confirm, come back).
7. **Docs:** design.md ("Receipts and AI", "Attachments"), PLAN.md, RESUME.md.

## Out of scope

- Prompt tuning, evals, and other providers.
- Attachments in exports and backups.
- Several receipts at once, and receipts by email.
- OAuth for Claude (none for third-party apps today).

## Questions

1. **No base account:** the notes asked for `Expenses:Uncategorized` / `Income:Uncategorized`,
   which made a transaction between two expense accounts. **Answered (2026-10-18):** a system
   account, `Assets:Unknown`, chosen in review ("Paid from") before it can be confirmed.
2. **The model:** **Answered (2026-10-18):** two passes that share no context, extracting
   (Sonnet 5) then categorizing (Opus 5): [the second pass](#the-second-pass-extract-then-categorize).
3. **PDFs:** accepted (statements and e-receipts are often PDFs). **Answered:** yes.
