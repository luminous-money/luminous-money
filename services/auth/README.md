# auth

Accounts, sessions and tokens, at `/api/auth/v1`. Every other API is behind Traefik's
forwardAuth, which asks this service's `GET /verify` first. The decisions behind it are in
design.md ("Routing and auth"); running it is in docs/deploying.md.

| Route | What it does |
|---|---|
| `POST /signup` | `{name, email, password}`: anyone can. Starts a session. |
| `POST /login` | `{email, password}`. Starts a session: HttpOnly cookies, or `"delivery": "body"` for the tokens as JSON. |
| `POST /token` | Trades a refresh token (cookie, or `refresh_token`) for new tokens. Each refresh token works once. |
| `POST /token/revoke` | Logs out: ends the session. |
| `GET /me`, `PATCH /me`, `DELETE /me` | You; your name and email (`updated_at`; a new email needs `password`); deleting your account and its books. |
| `POST /me/password`, `POST /me/verify-email` | Change your password (ends your other sessions); resend the confirmation email. |
| `GET /sessions`, `DELETE /sessions/:id`, `POST /sessions/end-others` | Your devices. |
| `GET /tokens`, `POST /tokens`, `DELETE /tokens/:id` | Your API tokens (`lm_…`). |
| `POST /password/forgot`, `POST /password/reset`, `POST /email/verify` | Email links. |
| `GET /config`, `GET /.well-known/jwks.json` | What the server supports; the access tokens' public keys. |
| `GET /verify` | For Traefik: 200 with `X-User-Id`, or 401. |

Access tokens are 10-minute Ed25519 JWTs; refresh tokens rotate, and a reused one ends its
session. Passwords are Argon2id (Node 24's built-in), at least 15 characters, checked against
Have I Been Pwned.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `AUTH_DATA_DIR` | `/data` | Holds `auth.sqlite`, including the signing keys. |
| `SMTP_URL`, `MAIL_FROM`, `LUMINOUS_MONEY_PUBLIC_URL` | (none) | Email for reset and confirmation links, and where the links point. |
| `AUTH_BREACHED_PASSWORDS` | `true` | Check new passwords against Have I Been Pwned. |
| `AUTH_SIGNUPS_PER_HOUR` | `20` | Sign-ups allowed per client IP per hour. |
| `LEDGER_URL`, `APP_URL` | `http://ledger:8000`, `http://app:3000` | Where deleting an account deletes its books. |
| `AUTH_TEST_USERS` | `false` | Test stacks only: `POST /login {"email": ...}` logs in a user for that email, no password. |

## The operator's commands

`node dist/cli.js reset-link | disable | enable | claim-stub | rotate-keys` (see `src/cli.ts`).

## Development

```sh
pnpm --filter @luminous-money/auth test        # unit tests (Node 24)
docker buildx bake auth                    # the image
```
