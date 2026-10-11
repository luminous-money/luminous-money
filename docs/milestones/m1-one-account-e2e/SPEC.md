M1: One bank account, end to end: spec
==================================================================================================

_Status: in progress; the spec is still being written ("to be continued")._

The milestone's goal: one real bank account working end to end. M1 uses a single account,
added by hand during setup, for the whole flow.

## Users and sessions

- **Build with a user stub,** so that auth (M6) just makes it live later rather than needing
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

## Navigation

- After setup, the user sees a **hamburger menu** with **Home** and **Manage books**, and lands
  on the home page.

## Home page

- Shows the user's **active accounts as cards**, each with:
  - the account name
  - the balance
  - a "last updated at: (datetime)" line
- Has a quick link to **"import transactions"**.

## Account ledger

- Clicking an account opens **its ledger**.
- It shows all transactions **newest to oldest, top to bottom**, paged at **200 per page** with
  **infinite scroll**.
- **Simple two-split transactions** show the account of the other split on the transaction line.
- **Multi-split transactions** show `<multiple>` in the account cell.
- Either kind opens the **transaction details editor** on click.

## Importing transactions (CSV)

- "Import transactions" opens the **CSV import console**:
  - a **drop-down of active accounts**
  - an **upload file button / drop zone**
- **CSV profiles:** a profile maps an account's CSV fields to our fields. If the selected account
  doesn't have a CSV profile yet, one is created based on the uploaded file.
- The imported batch is sent through the **processing pipeline**, which for now has only
  **matching**.
- **Matching** is by amount and date, and returns a **ranked array of candidates**.

_To be continued._
