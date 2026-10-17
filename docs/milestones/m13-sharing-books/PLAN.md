M13: Sharing books: plan
==================================================================================================

> **Status: built (2026-10-17),** with ledger, unit, API and browser tests, on the best guesses
> below; [the questions](#questions) wait for answers, and any of them can change what's built. The
> brief, from [the plan](../../PLAN.md): any user can be added to a book with read, write or
> manage permissions; every book has an owner.

## Answers (2026-10-17)

1. **Invitations by email:** yes, once there's an email system; not now.
2. **Invitations name whose they are:** only the account with the invited email can accept one.
   A link lasts **3 days**, and is used up once accepted. (Built.)
3. **Transferring ownership:** not now.
4. **Read-only members** may star accounts (stars are each user's own) and see reports. (As
   built.)
5. **Bank links go when their person leaves.** (As built.)

## What M13 is

- **Every book has one owner** (who made it) and any number of **members**, each with a role:
  - **read:** sees everything in the book, changes nothing
  - **write:** read, plus everything that changes the book's contents (transactions, review,
    imports, accounts, budgets, schedules, rules, bank links)
  - **manage:** write, plus who has access (inviting, changing roles, removing) and the book's
    name and settings
  - **the owner:** manage, plus deleting the book
- **Invite by link:** a manager picks a role and the person's email (and, optionally, their name),
  and gets a link to send however they like. Opened by that account, logged in, and accepted,
  it makes them a member.
- **Leaving:** any member can leave a book; a manager can remove anyone but the owner.
- **Shared books** sit beside your own in the book switcher and Manage books, marked as shared.

## What exists today

- **The ledger** keeps each book's `owner_id`, and every book route checks the caller owns it
  (`owned_book`: anyone else gets 404).
- **`app`** checks the same through the ledger (`owned`) and keeps per-book data: stars and the
  last book used are per user; profiles, schedules (acting as their creator), rules, bank links
  (through a user's own SimpleFIN connection) and settings are the book's.
- **Auth's check** (`/verify`, Traefik's forwardAuth) passes on `X-User-Id` only.

## Decisions this plan makes

### Membership, in the ledger

- **`book_member`** (book, user, role), a new table: the ledger is where every read and write is
  checked, so membership lives beside ownership. (A restored backup is the books' text, without
  members: they're re-invited.)
- **Every book route checks the caller's role:** reading (GET) needs read; anything else needs
  write; members and the book's name need manage; deleting it, the owner. A non-member still
  gets 404; a member without the role, 403.
- **`Book` says the caller's `role`** (owner, manage, write or read), and the book list has
  every book the caller owns or is a member of.
- **Members' routes:** `GET /books/{b}/members` (any member), `PUT
  /books/{b}/members/{user}` `{role, updated_at?}` (manage; versioned), `DELETE
  /books/{b}/members/{user}` (manage, or yourself: leaving). The owner's role can't change.

### Invitations and names, in `app`

- **`book_invite`:** a random token (only its hash kept), the role, who invited, the email it's
  for, an optional name ("Jess"), and an expiry (3 days); used once, revocable. Only the account
  with that email (as auth says it, any case) can accept it. Until accounts must verify their
  email (M8's question 1), that trusts the email an account was made with.
- **Accepting** (`POST /invites/:token/accept`): `app` adds the caller as a member acting as the
  inviter, so the ledger checks the inviter still manages the book.
- **Names:** auth's check also passes on `X-User-Name` and `X-User-Email` (URI-encoded); `app`
  remembers each user's (`user_profile`) as they come by, for members' lists.
- **No email is sent** ([question 1](#questions)): the link is copied or shared (the phone's share
  sheet).

### When someone leaves or is removed

- Their **schedules** act as the owner from then on (they ran as their creator), and the book's
  price run too, if it was theirs.
- Their **bank links** into the book go (they were through their own SimpleFIN connection).
- Their **stars** stay with them, unseen.

### In the PWA

- **Manage books:** a shared book says whose it is and your role; "Share" (manage) opens its
  sharing page; "Leave" for books you don't own; rename for managers; delete for the owner.
- **Sharing** (`/books/:book/sharing`): its members (name, email, role; change or remove, for
  managers), pending invitations (revoke), and "Invite someone" (role, label) giving a link to
  copy or share.
- **An invitation** (`/invite/:token`): who invited you to which book, as what; Accept opens it.
- **Read only:** a book you can only read says so under the masthead, and its main write
  entry points (importing, adding transactions or accounts, review's actions, budgets' editing)
  are hidden; anything else is refused by the server, and says why.

## How it gets built

1. **Ledger:** `book_member` (migration), roles on every route, `role` in `Book`, shared books in
   the list, members' routes; tests.
2. **Auth:** name and email in `/verify`'s headers; Traefik passes them on.
3. **`app`:** roles on its routes, `user_profile` and `book_invite` (migration), invitations
   and members' routes, cleanup on leaving; tests.
4. **PWA:** Manage books, the Sharing page, the invitation page, read-only.
5. **Tests:** API e2e (invite, accept, roles enforced, leave, remove); browser (share a book by
   link to a second user, who accepts and sees it).
6. **Docs:** design.md ("Sharing books"), PLAN.md, RESUME.md.

## Out of scope

- Transferring ownership ([question 3](#questions)).
- Per-account permissions: a role covers the whole book.
- Activity history (who changed what).

## Questions

1. **Invitations by email,** too, when the server has mail? (Built: a link to copy or share.)
2. **Should invitations name the person,** and only work for their email? (Built: anyone with
   the link, once; the label is just a reminder.)
3. **Transferring ownership** to a manager: wanted?
4. **Read-only members:** may they star accounts and use reports? (Built: stars are personal,
   so yes; reports are reads.)
5. **Bank links when someone leaves:** remove them (built), or keep syncing as the owner can't
   (the connection is theirs)?
