M1: One bank account, end to end: spec
==================================================================================================

_Status: in progress; the spec is still being written ("to be continued")._

The milestone's goal: one real bank account working end to end. M1 uses a single account,
added by hand during setup, for the whole flow.

## Users and sessions

- **Build with a user stub,** so that auth (M10) just makes it live later rather than needing
  structural changes.
- **JWT-based sessions.**
- **A login endpoint** that, for now, simply returns the stub user's token.

## Arriving logged out

- The first thing a logged-out user sees is **log in** or **create account**.
- For now, **create account is disabled**, and **log in** just calls the login endpoint and gets
  the stub user's token.

## Setup (a newly created user)

- The first thing a newly created user sees is a **setup page**:
  - **Name your books,** e.g. "Kael Personal" or "Kael and Jess".
  - **Add some accounts.** For this milestone, just one, added by hand, and used for the whole
    flow.
- **Adding an account asks for its current balance and an as-of date,** recorded as an opening
  balance, so the account starts out correct.

## Navigation

- After setup, the user sees a **hamburger menu** with **Home**, **Manage books** and **Review**
  (imported transactions land in the review queue), and lands on the home page.

## Home page

- Shows the user's **active accounts as cards**, each with:
  - the account name
  - the balance
  - a "last updated at: (datetime)" line: the time of the account's **last import** (later, its
    last sync with SimpleFIN)
- Has a quick link to **"import transactions"**.

## Account ledger

- Clicking an account opens **its ledger**.
- It shows all transactions **newest to oldest, top to bottom**, paged at **200 per page** with
  **infinite scroll**.
- **Simple two-split transactions** show the account of the other split on the transaction line.
- **Multi-split transactions** show `<multiple>` in the account cell.
- Either kind opens the **transaction details editor** on click.
- **Adding a transaction:** a persistent line at the top of the account ledger (moved from the
  bottom after trying it). Clicking it brings up an empty transaction editor.
- **Importing from the ledger:** an account's ledger links to importing into that account.

## Importing transactions (CSV)

- "Import transactions" opens the **CSV import console**:
  - a **drop-down of active accounts**
  - an **upload file button / drop zone**
- **CSV profiles:** a profile maps an account's CSV fields to our fields. If the selected account
  doesn't have a CSV profile yet, one is created based on the uploaded file.
- The imported batch is sent through the **processing pipeline**, which for now has only
  **matching**.
- **Matching** is by amount and date, and returns a **ranked array of candidates**.
- **For M1, build only the mechanics of identifying and ranking matches.** What happens to
  matches has many more details to work out, to be revisited. Notes so far:
  - The strongest candidate wins; ties are broken arbitrarily.
  - Ranked matches should be attached to a transaction somehow, so the review queue can show the
    options. Matches are cleared on confirm.
  - If there's only one clear winner, it's chosen without presenting the other options.
  - A matched transaction should just fall out of the import.

_To be continued._
