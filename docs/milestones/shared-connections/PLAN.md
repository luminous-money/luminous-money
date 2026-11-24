Shared connections: plan
==================================================================================================

> **Status: built (2026-11-24), released as `v1.9.0`.** Kael asked for the plan, the build, the
> release and Emmer's upgrade at once ("BE CAREFUL. I've put a lot of work into my books"), so
> the calls made without asking are under [Calls to review](#calls-to-review). The copy change
> that came with it is [below](#the-copy-kael-2026-11-24).

## The brief (Kael, 2026-11-24)

Kael is starting a second book, "Personal", fed by the same SimpleFIN connection as the
household's. Sharing a connection between books is trivial when one deployment serves one
household, but it should work when it doesn't:

> I think to do this we need to make SimpleFIN connections _user-specific,_ not just book
> specific, and then each connection needs to be shared with each book a user participates in.
> Sharing a connection should ask which accounts in the connection to share with each book, and
> there should be an explicit "all accounts" option [that] includes any future accounts that
> show up.

Then: "the same should be true of the AI API key: it should be user-specific and shared (or
not) with books that user participates in", and Amazon too: "I would filter by different payment
methods in my personal books, and the rare purchases using rewards points or something can just
go into both books and be deleted from the one where it's not relevant." Writers may sync
(Kael agreed with Claude's recommendation).

## Where it started

- **SimpleFIN connections were already the user's** (M9: "Connections are the user's; links go
  into books"): `simplefin_connection.user_id`, and every book the user could write listed all
  of them. Only the owner saw a connection; a book's other members saw only its links' status.
  A bank account links into one book (`UNIQUE (connection_id, account_id)`).
- **The leak:** a connection's problems went to the bell of every book holding a link from it,
  for all its writers. The Bridge's plain strings name the bank ("Connection to Example 529
  Plan may need attention"), so with personal accounts on the household's connection, a
  problem at a personal bank would show in the other person's bell.
- **The AI key was the book's** (`ai_setting.credential`, keyed by book, in `ai`), set by a
  manager. Nothing records who.
- **The Amazon sign-in was the book's** (`amazon_connection`, keyed by book, in `shops`): the
  email, password and setup key beside the book's own choices (cards, dates, accounts), and
  Amazon's session under `/data/shops/amazon/<book>/`. Nothing records who.

## The model

One shape in all three services, each keeping its own secrets (as design.md has it: `ai` owns
AI credentials, `shops` Amazon's, `app` SimpleFIN's):

- **A connection, key or sign-in is a person's** (its owner's), and only its owner changes or
  deletes it.
- **Sharing puts it in a book** the owner is a member of. What's the book's (links, the AI's
  settings, Amazon's cards and accounts, what was read) stays the book's.
- **When the owner leaves a book, what they shared with it goes** (and the links on it). When
  their account is deleted, everything of theirs goes.

### Bank feeds (SimpleFIN)

- **A share is a connection in a book** (`simplefin_share`, one per connection and book,
  versioned): **All accounts, including new ones** (`all_accounts`), or the accounts chosen
  (`accounts`, the bank's account IDs).
- **The owner shares,** on the book's Bank connections (they must be able to write it). It's
  asked right after connecting: "Which of its accounts should this book see?", All accounts
  chosen to start with. A connection of theirs that isn't shared with the book shows as "Not
  shared with this book · Share…".
- **A book sees a connection shared with it, and only its shared accounts.** Its writers link
  and unlink them, Sync now (which spends the owner's requests, and syncs the connection
  everywhere), choose a brokerage's dividends, and Read again. Only the owner shares,
  unshares or disconnects. A connection someone else shared is named as theirs ("Jess's
  connection").
- **Only shared accounts can be linked,** by anyone, the owner included: sharing is what puts an
  account in a book.
- **A bank account still links into one book.** Shared with two, it's linked in one, and the
  other shows "Linked in Personal" (or "in another book", to someone who isn't in it).
  Importing one account into two books would bring everything twice.
- **Unsharing a linked account is refused** ("unlink it first"), and so is unsharing a
  connection with links in the book: nothing stops syncing as a side effect.
- **Problems go where they're about:**
  - one naming an account (`account_id`): to the books it's shared with;
  - one about the connection as a whole (the Bridge's plain strings): to the books it's shared
    with All accounts, and to its owner in every book it's shared with.

  The connection's card shows the same: its owner sees everything; anyone else, what the bell
  would show them.
- **A new account under All accounts** shows on the page, and the bell says "New at SimpleFIN:
  …, to link" (dismissable) in each book shared All accounts where it isn't linked anywhere. Not
  linked by itself: a link needs an account in the book and a way to start.
- **Existing connections are shared with the books they're linked in, only the linked
  accounts** (and those with a link being set up). The tight choice: it's what those books
  showed anyone but the owner. Accounts not linked anywhere aren't shared; the owner shares them
  where they belong.
- **Leaving a book** (or being removed): the leaver's shares into it go, with every link and
  link attempt in it on their connections (whoever made them). Links they made on someone
  else's connection stay, acting as the connection's owner from then on.
- **The daily sync and the Bridge's budget don't change:** one fetch per connection, imported
  into every link, as before.

### The AI key

- **A key is its owner's** (`ai_credential`: provider, the sealed key, its last four). A book
  uses one (`ai_setting.credential_id`); its settings (on, receipts, accounts, guidance, tags)
  stay the book's.
- **A manager chooses the book's key** from their own, or pastes a new one (kept as theirs). A
  book using someone else's key says whose ("Kael's key, …abcd"), and never shows it.
- **The key's owner can withdraw it** from any book they're in (managers can too, as before).
  Deleting a key removes it from every book.
- **The owner pays:** usage stays per book (`ai_usage`), and the AI page lists the caller's own
  keys with the books using each.
- **A key whose owner has left the book isn't used** (checked whenever the book's AI is read or
  used: the book isn't ready, so nothing AI is offered, as when the service is down).

### Amazon

- **A sign-in is its owner's** (`amazon_login`: the email, password and setup key, sealed), and
  so is Amazon's session (`/data/shops/amazon/logins/<id>/`). Only its owner sees its email or
  changes it.
- **A book uses one** (`amazon_connection.login_id`), chosen by a manager from their own (or
  entered there, kept as theirs). The book keeps everything else: which charges are its by card
  (Kael's personal cards included in Personal, excluded from the household's), how far back to
  read, where other payments and rewards come from, what was read, and invoices.
- **Each book syncs on its own** (by hand or in the morning), one sync at a time per sign-in, so
  two books never sign in at once with one session. A charge paid with no card (points, a gift
  card) goes to every book using the sign-in, as Kael asked: deleted by hand where it doesn't
  belong.
- **New credentials** (a sign-in's email, password or key changed) start every book using it
  over: "Not synced yet", and the next sync reads back to its start if the email changed.
- **A sign-in whose owner has left the book isn't used,** as with keys.

### Existing keys and sign-ins

Neither `ai` nor `shops` recorded who set a book's key or sign-in, and only the ledger knows a
book's owner (as each caller's role). So **each becomes the book owner's the first time the
owner's request reaches the service** (Kael's PWA asks both whenever it loads a book), Amazon's
session moving with it. Until then it works as it did. The old columns go once Emmer's have been
taken (M99).

### Deleting an account

`app`'s `DELETE /me` (auth calls it) also tells `ai` and `shops` to forget the person's keys and
sign-ins (`DELETE /api/ai/v1/me`, `/api/shops/v1/me`).

## The API

`app` (`/api/app/v1`):

| Route | Who | What |
|---|---|---|
| `GET /books/:book/simplefin/connections` | member | The connections the book sees: the caller's own, and those shared with it. Each says `mine`, its `owner` (name), its `share` (`{all, accounts, updated_at}` or null), and its accounts: all of the owner's (each `shared` or not), else only the shared ones. |
| `PUT /books/:book/simplefin/connections/:id/share` | owner, write | `{all, accounts, updated_at}` (null `updated_at`: not shared yet). 409 when stale; 422 for an unknown account, or one linked here being left out. |
| `DELETE /books/:book/simplefin/connections/:id/share?updated_at=` | owner | Unshare; 409 while anything's linked here. |
| `POST /books/:book/simplefin/connections/:id/sync` | write | Sync now, for a connection shared with the book (or the caller's). |
| `GET /simplefin/connections` | | The caller's own, with `shares` (book, name, all, accounts). |
| link, attempt, dividends, Read again routes | write | Any writer, for links in the book on connections it sees. |

`ai` (`/api/ai/v1`): `GET`/`POST /credentials`, `DELETE /credentials/:id`, `DELETE /me`;
`PUT /books/:book/credential` takes `{api_key}` (a new key of the caller's) or
`{credential_id}` (one of theirs); `DELETE` is a manager's or the key's owner's. Settings'
`credential` says `{set, hint, mine, owner_id}`.

`shops` (`/api/shops/v1`): `GET`/`POST /amazon/logins`, `PATCH`/`DELETE
/amazon/logins/{id}` (versioned), `DELETE /me`; a book's `PATCH /books/{book}/amazon` takes
`login_id` (one of the caller's, or null: a manager, or the sign-in's owner) and no longer the
email, password or key. The connection says `login: {id, mine, email (the owner's only),
has_password, has_otp_secret, owner_id}` or null, and `has_password` as before (for `app`'s
morning sync).

The MCP's `read_bank_feeds` reads the book's connections; `write_sync_bank_feed` takes the book.

## Steps

1. [x] The copy (below), the site published.
2. [x] Bank feeds: migration and backfill, the store, routes, notifications, members leaving,
       the page, the MCP; unit, API and browser tests.
3. [x] The AI key: `ai`'s migration and adoption, its routes, `app`'s `DELETE /me`, the AI
       page; tests.
4. [x] Amazon: `shops`' migration and adoption (the session moved), its routes, the sync's
       lock, the Amazon page; tests.
5. [x] design.md, RESUME, PLAN; `pnpm test`, `pnpm e2e`; release; Emmer upgraded (its backup
       first), then checked: the shares made from its links (8 of 12 accounts, the linked
       ones), the key and sign-in taken by Kael (Amazon's session with it). No sync by hand:
       it would write to the books, so the next morning's are the first.

## The copy (Kael, 2026-11-24)

Every headline says what the site says, with its subtext changed a little:

- **Title:** Household accounting for modern life.
- **Subtext:** Double-entry accounting to manage your assets, expenses, goals, budgets and loans
  on mobile or desktop. Open source and self-hostable. (Kael wrote "Double-entry account to
  manage"; read as "accounting".)

Where: the login page's hero, the app's description (`index.html` and the manifest) and its link
previews (`og:` tags, new), the site's hero, `og:description` and `<title>`, the repository's
description on GitHub, and design.md's pitch. The site's `meta description` (its longer list of
features, for search) and the published video's intro card (only its title, which is unchanged)
stay.

## Calls to review

1. **Connecting asks which accounts to share,** All accounts chosen to start with; leaving
   without saving leaves it unshared (still the owner's, on the page as "Not shared").
2. **Only shared accounts can be linked,** the owner's included.
3. **Existing shares are only the linked accounts:** the household book shows Jess only what's
   linked there. Accounts not linked anywhere wait for Kael to share them.
4. **Unsharing what's linked is refused** rather than unlinking it.
5. **Links a leaver made on someone else's connection stay,** acting as that connection's owner.
6. **The bell's "New at SimpleFIN"** for a new account under All accounts.
7. **A book uses one AI key and one Amazon sign-in,** chosen by a manager from their own: a
   key's owner can't put it in a book they don't manage, but can always take it out.
8. **An Amazon sign-in's email is shown only to its owner.**
9. **Existing keys and sign-ins become the book owner's,** lazily, on the owner's first request.
