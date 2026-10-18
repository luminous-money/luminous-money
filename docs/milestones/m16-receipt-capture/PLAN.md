M16: Receipt capture: plan
==================================================================================================

> **Status: built (2026-10-18).** No open questions changed the architecture; the minor ones
> are [at the end](#questions). The brief, from [the plan](../../PLAN.md): take a picture of a
> receipt, and AI makes a transaction from it. Its spec is the notes beside this plan
> ([notes.md](notes.md)).

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
2. **`ai` reads it** (`POST /api/ai/v1/books/:book/receipts/read`): the image (or PDF), the
   hints, the chart of accounts (names, types, display names), today; the book's settings
   decide itemizing (unless the hint says), account creation, eagerness and guidance. The
   provider returns:
   - **the base account** (the hint is a hint: "Visa 9499" on the receipt is your
     `Liabilities:Amazon-Visa-9499`), or none
   - **the total**, signed as it moves the base account (an expense is negative; a refund
     positive), the **date**, the **payee**, a **narration**
   - **a global category** (Jewel → `Expenses:Groceries`): the fallback for any split it can't
     place
   - **splits,** categorized, summing to the total (one, when not itemizing)
   - **new accounts** it would open (only with account creation on), and a short note
3. **`app` checks and stages it,** unconfirmed, with the receipt attached and `source: "receipt"`:
   - an account that doesn't exist is opened if the AI proposed it and creation is on, else
     the split falls back to the global category, else to uncategorized
   - splits that don't sum to the total are replaced by one split of the total to the global
     category
   - **no base account:** `Expenses:Uncategorized` for money out, `Income:Uncategorized` for
     money in (as the notes ask), for you to fix in review
4. **It always makes something:** if the AI is off, down, or can't read it, the transaction is
   made from what you typed (or a zero amount, "Receipt: couldn't read it"), with the receipt
   attached and a note saying why, so nothing is lost.
5. **Then review:** the PWA goes to the transaction in review (`/books/:book/review?only=<id>`),
   and confirming or skipping it brings you back where you started (`back`).

### The Claude provider

- **The official SDK** (`@anthropic-ai/sdk`), the **Messages API**: the receipt as an image
  block (JPEG, PNG, WebP, GIF) or a document block (PDF), base64; the chart of accounts and the
  hints as text; the book's guidance and eagerness in the system prompt.
- **Structured output:** `output_config.format` with a JSON schema of the reading, validated
  again on arrival (zod).
- **Model:** `claude-opus-5` by default (`AI_CLAUDE_MODEL` overrides it), adaptive thinking,
  and the server-side **fallback** on a refusal (`fallbacks: "default"`); a refusal or an error
  is "couldn't read it", not a failure of the capture.
- **Mechanics later:** prompts, evals and tuning aren't this milestone's; its job is the
  structure, inputs and outputs, and a capture that always yields something.

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

## How it gets built

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

1. **No base account:** the notes ask for `Expenses:Uncategorized` (money out) or
   `Income:Uncategorized` (money in) as the base account when the AI can't tell. That makes a
   transaction between two expense accounts until you fix it in review, and the bank's copy can't
   match it then. Built as asked; would you rather it wait in review with the base account left
   to choose (a placeholder like `Assets:Unknown`)?
2. **The model:** `claude-opus-5` by default (the most capable widely available). Receipts may
   not need it; a cheaper model (Sonnet 5) could be a per-book choice. Wanted?
3. **PDFs:** accepted (statements and e-receipts are often PDFs). Fine?
