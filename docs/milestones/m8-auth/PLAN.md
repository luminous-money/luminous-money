M8: Auth: plan
==================================================================================================

> **Status: built (2026-10-15),** with unit, API and browser tests. The
> [answers](#answers-2026-10-14) replaced the first draft's owner and admin accounts. One change
> while building: `/verify` checks each token's session in the database (one indexed read)
> rather than an in-memory list of ended sessions, so sessions ended by the CLI (a separate
> process) stop at once too. Wrong passwords when confirming a change are 403s, since the PWA
> reads a 401 as a lost session. The [questions](#questions) are still open.

## Answers (2026-10-14)

- **No special accounts.** There's nothing global to administer: everyone is an ordinary user,
  including the person running the server. fava-beans may run as a **public service**, so
  anyone can create an account, with no admin step.
- **Current best practice:** short-lived access tokens with refresh, and room for **OpenID
  Connect providers** later.
- **The stub's data is taken over** by Kael's account (made on the dev stack; credentials never
  go in the repo).

## What M8 is

- **Anyone can sign up** with an email and a password, and log in on any number of devices.
- **Sessions are short-lived access tokens kept fresh by rotating refresh tokens.** You can see
  them and end them.
- **Forgot password** works by email when the server can send mail, and through the operator's
  command line when it can't.
- **API tokens for scripts.**
- **Deleting your account** deletes everything that's yours.
- **Built so OIDC providers can be added** as other ways to log in, without changing anything
  else.

Nothing changes in `ledger` or `app`: they keep trusting the `X-User-Id` Traefik sets after
`auth` checks the request. Book ownership already holds (anyone else gets 404). Other people's
permissions on your books are M13.

## What exists today

- **The stub:** a user created at startup, and a `POST /login` that always logs it in.
  - **Test users:** with `AUTH_TEST_USERS=true` (test stacks), login takes an email and logs in
    a user for it.
- **Sessions:** 30-day HS256 JWTs (`AUTH_JWT_SECRET`), in an HttpOnly, SameSite=Strict cookie or
  a Bearer header.
  - Nothing is stored, so **logging out revokes nothing.**
- **`GET /verify`** is Traefik's forwardAuth check for every other API.
- **The PWA's "Log in" button** logs in the stub.

## Decisions this plan makes

### Accounts

- **A user has a name and an email.** Emails are unique, compared case-insensitively.
- **How you prove who you are is separate from the user.**
  - An `identity` table links a user to a login method and that method's subject: `password`
    (subject: the email) now, OIDC providers (subject: the provider's `sub`) later.
  - Sessions record which method started them.
  - So adding Google, or any OIDC provider, is a new identity type and a login route; nothing
    else moves.
- **No roles, no admins.** Operator tasks go through `auth`'s command line, inside its
  container:
  - `reset-link <email>`
  - `disable <email>` / `enable <email>`
  - `claim-stub <email>`: gives a pre-M8 stack's stub data to an account
  - `rotate-keys`

### Passwords (NIST SP 800-63B rev. 4, OWASP)

- **At least 15 characters,** the minimum for a password that's the only factor, and at most 128.
  - **No composition rules and no forced rotation.**
  - Normalized (Unicode NFKC) before hashing.
- **Breached passwords are refused,** checked against Have I Been Pwned's range API.
  - It's k-anonymous: only the first 5 characters of the password's SHA-1 leave the server.
  - On by default; `AUTH_BREACHED_PASSWORDS=false` turns it off.
  - If HIBP can't be reached, the check passes.
  - Passwords equal to the email, or to "fava-beans", are refused too.
- **Hashing: Argon2id,** from Node's own `crypto` (Node 24 LTS, which the images move to).
  - Parameters: OWASP's 19 MiB, 2 passes, 1 lane, about 25 ms on this machine.
  - Stored as a PHC string, so the parameters can be raised; an old hash is redone at the next
    login.
  - No native module to build.
- **Login failures don't say which part was wrong,** and they slow down:
  - per account and per client IP: after 5 failures, each attempt waits longer, up to 15
    minutes
  - sign-up and "forgot password" are limited per IP too
  - the client IP is from `X-Forwarded-For`, trusted only from Traefik

### Tokens: short-lived access, rotating refresh (OAuth 2.1 / BCP practice)

- **Access tokens are JWTs signed with Ed25519 (EdDSA),** valid for **10 minutes**.
  - Claims: `sub` (the user), `sid` (the session), `iss`, `aud`, `iat`, `exp`, and the key ID.
  - **Keys:** `auth` generates its key pair on first start and keeps it in `auth.sqlite`, so
    `AUTH_JWT_SECRET` goes away.
  - The public keys are published at `/api/auth/v1/.well-known/jwks.json`, so any service could
    verify tokens itself.
  - `rotate-keys` adds a new key and keeps the old one for verifying until its tokens have
    expired.
- **Refresh tokens are opaque** (32 random bytes), stored hashed, and **rotated on every use.**
  - **A refresh token used twice** (a stolen copy) ends its whole session, the standard theft
    signal.
  - **Except within a 10-second grace,** so two tabs refreshing at once don't log you out. The
    PWA also refreshes under a Web Lock, one tab at a time.
- **A session is a refresh-token family.**
  - **Lifetime:** it ends after **60 days unused**, or **a year** after login, whichever comes
    first.
  - **What's kept:** the device (from the user agent), the login method, and when it was created
    and last used.
  - **Ending sessions:** logging out ends yours; you can end any other, or "log out everywhere
    else". Changing your password ends the others; a reset ends all of them.
- **Revocation is immediate.** `/verify` (in `auth`) checks the token's session in the
  database (one indexed read), so logging out stops the token at once.
- **In the browser, tokens never touch JavaScript** (the OAuth browser-apps BCP's
  backend-for-frontend shape, with Traefik and `auth` as the backend):
  - The access token is an HttpOnly, SameSite=Strict cookie, path `/`. Its name has the `__Host-`
    prefix behind HTTPS.
  - The refresh token is a separate HttpOnly cookie scoped to the refresh endpoint's path, so
    it's never sent anywhere else.
  - When an API answers 401, the PWA refreshes once (under the Web Lock) and retries. If the
    refresh fails, you're logged out, and you come back to where you were after logging in.
  - **CSRF:** SameSite=Strict, and `auth` also checks `Origin` on cookie-carrying POSTs.
- **Other clients** (scripts now, native apps later):
  - `POST /login` with `"delivery": "body"` returns the access and refresh tokens as JSON.
  - `POST /token` takes a refresh token in the body.
  - Both are sent as `Authorization: Bearer`.

### API tokens

- **Named personal tokens:** `fb_` plus 32 random bytes.
  - Shown once, stored hashed, optionally expiring, and listed with when each was last used.
  - Revoked from the account page.
- **They act as their user** through the same `/verify`. That check is a database lookup, but
  only for tokens with the `fb_` prefix.
  - **Proposed: full access;** scoped and read-only tokens later.
- **Uses:** `pnpm seed` (`FAVA_BEANS_TOKEN`), scheduled backups pulling `/backup`, your own
  scripts.

### Email, when the server can send it

- **Configured with `SMTP_URL` and `MAIL_FROM`.** It's optional: self-hosters without mail
  still get everything but email.
- **With mail:**
  - **Forgot password:** sends a reset link (single use, 1 hour). The answer is the same
    whether or not the email has an account.
  - **Verification:** signing up or changing your email sends a verification link. Unverified
    accounts work fully (verification will matter for sharing by email, M13); the account page
    shows a "verify your email" note.
- **Without mail:** "Forgot password" says to ask whoever runs the server, who runs `reset-link`.
- **Sending** uses `nodemailer`. The e2e stack runs **Mailpit** as a fake mail server, and tests
  read the links from its API.

### Deleting your account

- **Delete account** (password required) deletes every book you own:
  - through `app`'s book deletion, so backups carry it and `app` forgets what it kept
  - then your sessions, tokens, identities and user
- **Sharing (M13)** will have to decide what happens to books shared with others first.

### The PWA

- **Logged out:**
  - **Log in:** email and password, and "Forgot password?".
  - **Create account:** name, email, password, and "show password"; the 15-character minimum is
    stated up front.
  - Once you're in, you go to Setup (your first book).
- **Reset and verify links** open their own pages: `/ui/reset/:token`, `/ui/verify/:token`.
- **Your account** (`/ui/account`, in the menu):
  - name and email (versioned)
  - change password (needs the current one)
  - **devices:** sessions, with this one marked; end any, or log out everywhere else
  - API tokens
  - Delete account

### Tests, dev and the stub

- **Test users stay for test stacks:** with `AUTH_TEST_USERS=true`, `POST /login {"email"}` logs
  in that user with no password.
  - The e2e suite's shared session becomes a fixed test email.
  - Tests of real sign-up and login use passwords: breached-password checks are off in the e2e
    stack, and Mailpit receives its mail.
- **The stub is no longer created at startup.** A stack that has one keeps its data until
  `claim-stub <email>` hands it to an account.
  - On the dev stack, that's how Kael's account takes over the demo books.
- **`pnpm seed`** reads `FAVA_BEANS_TOKEN`.
- **Unit tests in `auth`:**
  - hashing and normalization
  - the breach check (with a fake HIBP)
  - token issuing and verifying
  - refresh rotation, reuse and grace
  - revocation, the throttle, the CLI

### Running it (`docs/operating.md`)

- **A live stack is its own Compose project,** with its own volume and port, so dev resets and
  test runs never touch it.
- **Setting it up:**
  - HTTPS and a hostname (TLS stays the operator's job; Traefik behind any proxy works)
  - `SMTP_URL` for password resets
  - backups with an API token and cron
  - upgrades
  - the operator CLI

## How it gets built

1. **Node 24 LTS** in the images.
2. **`auth` storage:**
   - migrations: `user` gains `email_verified_at` and `disabled_at`
   - `identity` (with the password hash), `session`, `refresh_token`, `api_token`,
     `signing_key`, `email_token`
3. **Credentials and tokens:**
   - Argon2id, the breach check
   - Ed25519 keys, the JWKS endpoint, access JWTs
   - refresh rotation with reuse detection
   - the revocation list, API tokens, the throttle
4. **Routes:**
   - sign-up, login, refresh, logout
   - `/me` and email changes, password changes
   - sessions, tokens, forgot/reset, verify, delete account
   - `/verify`
5. **Mail and the CLI:**
   - `nodemailer` and Mailpit in the e2e stack
   - `reset-link`, `disable`, `enable`, `claim-stub`, `rotate-keys`
6. **PWA:**
   - logged-out pages
   - the refresh-and-retry fetch layer under a Web Lock
   - the account page
7. **Scripts, suites and docs:**
   - seed with a token, e2e and browser tests
   - design.md's auth section, `docs/operating.md`, README, PLAN.md, RESUME.md
8. **On the dev stack:** create Kael's account and `claim-stub` it.

## Out of scope

- Logging in with OIDC providers (the identity model is ready for them).
- Passkeys and two-factor authentication. They're the next step up, and the identity model has
  room for them too; passkeys want HTTPS on a fixed hostname.
- fava-beans as an OAuth/OIDC provider for third-party apps.
- Scoped API tokens.
- CAPTCHA (rate limits first).
- Terms and privacy pages for a public service.

## Questions

1. **Email verification:** verification is sent but not required to use the app (proposed). On a
   public service you might want sign-up to require it, but then a server without mail couldn't
   take sign-ups at all.
2. **Session lifetime:** 60 days unused or a year at most (proposed)?
3. **Passkeys and two-factor:** a milestone of their own soon after (proposed), or part of M8?
4. **Which OIDC providers first,** when they come: Google, Apple, GitHub, or a generic "any OIDC
   issuer" configuration (good for self-hosters with their own Authentik or Keycloak)?
