M8: Auth: plan
==================================================================================================

> **Status: plan, waiting on [the questions](#questions).** Calls marked **Proposed** are open.
> The brief is the milestone's line in [the plan](../../PLAN.md) ("account creation, log in, log
> out, book ownership and permissions") and the next goal: **create your own user, log in, then
> sync one or two real bank accounts** (M9, SimpleFIN). So M8 is what it takes for a stack to
> hold real data safely.

## What M8 is

- **Real users with passwords.** The first one is created at first run; anyone else joins by
  invite link.
- **Sessions you can see and end:** log in on each device, stay logged in, log out (one device or
  everywhere).
- **A way back in without email:** reset links.
- **API tokens for scripts:** seeding, scheduled backups.
- **A short guide to running a live stack,** kept apart from the dev stack.

**Book ownership is already enforced:** every book has an owner, and anyone else gets 404.
Permissions for other people on your books are sharing, M12. M8 changes nothing in `ledger` or
`app`: they keep trusting the `X-User-Id` Traefik sets.

## What exists today

- **`auth` (TypeScript, Hono, `auth.sqlite`):**
  - A `user` table (id, name, email).
  - A **stub user** created at startup. `POST /login` always logs it in.
  - With `AUTH_TEST_USERS=true` (test stacks), `POST /login {"email"}` logs in a separate user per
    email.
  - `GET /verify` is Traefik's forwardAuth check for every other API, answering with
    `X-User-Id`.
- **Sessions are HS256 JWTs** (30 days, `AUTH_JWT_SECRET`) in an HttpOnly, SameSite=Strict
  cookie, or a Bearer header.
  - They're stateless, so **logging out doesn't revoke anything:** a copied token works until it
    expires.
- **The PWA:**
  - A "Log in" button logs in the stub.
  - "Create account" is disabled.
- **Scripts:** `pnpm seed`, and the e2e suite's shared session, log in as the stub.

## Decisions this plan makes

### First run: the owner account

- **While no user has a password, `/ui/` shows "Set up fava-beans":** name, email and password.
  That user becomes the **owner**, an admin.
- **Proposed: setup needs a one-time setup code,** which `auth` prints to its log at startup
  while setup is pending (`docker compose logs auth`).
  - Otherwise, whoever reaches a fresh stack first owns it. That matters as soon as a stack is
    reachable from anywhere but your own machine ([question 1](#questions)).
- **Proposed: the owner claims the stub user.** It's the same user ID, so the books it already
  has (Demo, Demo Household, and anything imported into them) become the owner's. Delete them in
  Manage books if you'd rather start clean ([question 2](#questions)).
- **After setup, the stub is gone:** nobody logs in without a password.

### Passwords

- **Log in with email and password.** Emails are unique and case-insensitive. Nothing is ever
  emailed (there's no mail server to configure); the email is the login, and later the
  address to share books with (M12).
- **Hashing: scrypt, from Node's own `crypto`.**
  - Parameters: N = 2^15, r = 8, p = 1 (32 MiB, a fraction of a second on a Pi 3).
  - No native module to build for ARM.
  - Stored as `scrypt$N$r$p$salt$hash`, so the parameters can be raised later; a stored hash with
    older parameters is redone at the next login.
- **Rules:**
  - at least 12 characters
  - not the email
  - no composition rules (NIST's current advice)
- **Login failures look the same** whether the email is unknown or the password is wrong.
  - Repeated failures slow down, per account and per client IP: after 5, each attempt waits
    longer, up to 15 minutes.
  - The client IP is from `X-Forwarded-For`, trusted only from Traefik.
- **Passkeys come later.** They need HTTPS on a fixed hostname, and they're worth doing once the
  live stack has one ([question 6](#questions)).

### Sessions: stored, so they can end

- **Opaque random tokens replace JWTs.**
  - `auth` stores only each token's SHA-256, in a new `session` table: the user, a device label
    (from the browser's user agent), and when it was created, last used, and expires.
  - `/verify` is one indexed lookup.
  - `AUTH_JWT_SECRET` goes away: one less thing to configure.
- **Proposed: a session lasts until it's unused for 60 days** ([question 3](#questions)). Using
  it pushes the expiry out, so the PWA on your phone stays logged in.
  - Last-used is written at most once an hour.
- **Ending sessions:**
  - **Logging out** ends this session.
  - **"Log out everywhere else"** ends every other one.
  - **Changing your password** or using a reset link ends every other session (all of them, for
    a reset).
  - **Disabling a user** ends theirs.
- **The cookie stays as it is:** HttpOnly, SameSite=Strict, and Secure when Traefik is behind
  HTTPS. With SameSite=Strict, other sites can't make the browser send it, which covers CSRF.

### API tokens, for scripts

- **Named personal tokens:** `fb_` plus 32 random bytes.
  - Shown once, stored hashed, optionally expiring, and listed with when each was last used.
  - Revoked from the account page.
- **They're sent as `Authorization: Bearer`** and act as their user on every API, through the
  same `/verify`.
  - Proposed: **full access**; scoped and read-only tokens later.
- **Uses:**
  - `pnpm seed` against a stack, with `FAVA_BEANS_TOKEN`
  - a cron job pulling `/api/ledger/v1/backup`, the backups design's "pulled over the API"
  - the e2e suite, when it isn't using test users

### More users: invite links

- **Proposed: no open sign-up.** An admin creates an **invite link** (single use, 7 days) and
  sends it however they like. The invite page takes name, email and password. Admins can list
  and revoke invites ([question 4](#questions)).
- **Admins can also:**
  - list users
  - disable and enable them (a disabled user can't log in, and their sessions end)
  - make a **reset link** for one
- **Users can't be deleted yet:** that would have to decide what happens to their books
  (deferred).

### Getting back in, without email

- **A reset link** (single use, 24 hours) sets a new password and ends every session.
  - **Admins** make them for other users.
  - **For your own account,** when you're the admin locked out:
    `docker compose exec auth node dist/cli.js reset-link you@example.com` prints one.

### The PWA

- **Logged out:**
  - **"Log in":** email and password.
  - **First run:** "Set up fava-beans" instead.
  - **Invite and reset links** open their own pages (`/ui/invite/:token`, `/ui/reset/:token`).
- **Your account** (`/ui/account`, in the menu):
  - name and email (versioned edits)
  - change password (asks for the current one)
  - **devices:** your sessions, this one marked, each with "Log out"; plus "Log out everywhere
    else"
  - **API tokens:** create (name, optional expiry; shown once), list, revoke
- **Users** (`/ui/users`, in the menu for admins): users (disable, reset link) and invites
  (create, copy, revoke).
- **When a session ends** (expired, or ended from another device), the next request gets 401 and
  the app shows Log in. After logging in you're back where you were.

### The `auth` API

All of it is under `/api/auth/v1`, the only API without the session check, so every route
checks for itself.

| Route | What it does |
|---|---|
| `GET /status` | `{ setup_needed }`, for the logged-out screens |
| `POST /setup` | `{ code, name, email, password }`: the owner (claims the stub) |
| `POST /login` | `{ email, password }` (test stacks: `{ email }` alone) |
| `POST /logout` | Ends this session |
| `GET /me`, `PATCH /me` | You; edit name and email with `updated_at` |
| `POST /me/password` | `{ current, password }` |
| `GET /sessions`, `DELETE /sessions/:id`, `POST /sessions/end-others` | Your devices |
| `GET /tokens`, `POST /tokens`, `DELETE /tokens/:id` | Your API tokens |
| `GET /invites/:token`, `POST /signup` | Check an invite; sign up with it |
| `GET /resets/:token`, `POST /reset` | Check a reset link; set the password |
| `GET /users`, `PATCH /users/:id`, `POST /users/:id/reset-link` | Admins: users |
| `GET /invites`, `POST /invites`, `DELETE /invites/:id` | Admins: invites |
| `GET /verify` | Traefik's check, unchanged in shape |

The secrets in invite and reset links are stored hashed, like session tokens.

### Tests and the dev stack

- **Test users stay:** with `AUTH_TEST_USERS=true`, `POST /login {"email"}` logs in that user,
  created if new, with no password. The e2e suite's shared session becomes a fixed test email.
  The dev stack keeps it off.
- **`pnpm seed`** reads `FAVA_BEANS_TOKEN` (make one on the account page). Without it, it asks for
  an email and password.
- **Unit tests in `auth`** cover the flows against an in-memory database.
  - **e2e:** setup with the code, invite, sign up, log in and out, ending sessions, tokens, reset,
    disabled users, and the throttle.
  - **Browser tests:** the setup, login, invite, account and users pages.

### Running a live stack

Real data shouldn't share a stack with development: `docker compose down -v` and test runs would
wipe or pollute it. M8 adds `docs/operating.md`:

- **A separate Compose project** for live data, with its own volume and port:
  `COMPOSE_PROJECT_NAME=fava-beans-live FAVA_BEANS_PORT=8090 docker compose up -d`.
  - The dev stack stays as it is.
- **First run:** get the setup code from the log, then create the owner.
- **Reaching it from your phone:**
  - TLS stays the operator's job (design.md).
  - SimpleFIN only needs outbound access, so the stack never has to be public. Your LAN or
    Tailscale is enough.
  - Behind HTTPS, the cookie goes Secure by itself.
- **Backups:** an API token plus a cron job pulling `/backup`.
- **Upgrades:** pull and `up -d`. Migrations run on start.

This is also where the plan's **hydration** starts. Its cutover questions (dates, opening
balances) belong to M9, where the real accounts arrive.

## How it gets built

1. **`auth` storage:**
   - migrations: password hash and admin/disabled flags on `user`; `session`, `api_token`,
     `invite` and `reset` tables
   - scrypt hashing
   - the throttle
   - unit tests
2. **`auth` API:**
   - setup with the code, and claiming the stub
   - login, logout, `/verify` on sessions and tokens
   - `/me`, sessions, tokens
   - invites, resets, the admin routes
   - the reset-link CLI
   - test users kept
3. **PWA:**
   - status-driven logged-out screens: login, setup, invite, reset
   - the account page and the Users page
   - 401 handling that returns you to where you were
4. **Scripts and suites:**
   - `pnpm seed` with a token
   - the e2e shared session
   - new e2e and browser tests
   - Compose: `AUTH_JWT_SECRET` removed
5. **Docs:**
   - design.md's auth section rewritten (sessions, tokens, invites)
   - `docs/operating.md`
   - README, PLAN.md, RESUME.md

## Out of scope

- Passkeys and two-factor (later; see [question 6](#questions)).
- Email of any kind (verification, reset by email).
- Deleting users.
- Scoped or read-only API tokens.
- Sharing books and their permissions (M12).
- Login through an outside identity provider (OIDC).

## Questions

1. **Setup code:** require the one-time code from the log to create the owner (proposed), or let
   whoever reaches a fresh stack first create it? The code costs one `docker compose logs`, and
   it matters as soon as the stack is reachable beyond your machine.
2. **The stub's books:** should the owner claim the stub user and keep its books (Demo, Demo
   Household, the PNC data you imported; proposed, and you can delete them), or start as a fresh
   user with no books?
3. **Staying logged in:** sessions end after 60 days unused (proposed), or a different window?
   Or a fixed lifetime regardless of use?
4. **Sign-ups:** invite links only, made by admins (proposed)? Or should every user be able to
   invite?
5. **Where will the live stack run, and how will you reach it?** For example:
   - this machine, on your LAN
   - the Pi
   - over Tailscale
   - public behind HTTPS

   This decides what `docs/operating.md` walks through first, and whether the cookie needs
   Secure from day one. Keeping it separate from the dev stack is proposed either way.
6. **Passkeys:** later, once there's HTTPS on a fixed hostname (proposed), or in M8? They're the
   nicest way to log in on a phone, but they need that hostname first.
