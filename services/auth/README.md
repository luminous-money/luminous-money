# auth

Users and sessions, at `/api/auth/v1`. Every other API is behind Traefik's forwardAuth, which asks
this service's `GET /verify` first.

| Route | What it does |
|---|---|
| `POST /login` | Starts a session: sets an HttpOnly, SameSite=Strict cookie and returns `{user, token}`. For now it always logs in the stub user. |
| `POST /logout` | Clears the session cookie. |
| `GET /me` | The logged-in user, or 401. |
| `GET /verify` | For Traefik: 200 with `X-User-Id`, or 401. |

Tokens are HS256 JWTs valid for 30 days, signed with `AUTH_JWT_SECRET` (32+ characters). The
session cookie is `Secure` when Traefik sees HTTPS (`X-Forwarded-Proto`). `Authorization: Bearer`
works too.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `AUTH_JWT_SECRET` | (required) | Signs session tokens. Compose ships a development default; set your own. |
| `AUTH_DATA_DIR` | `/data` | Holds `auth.sqlite`. |
| `AUTH_TEST_USERS` | `false` | Test stacks only: `POST /login {"email": ...}` logs in a separate user for each email. |

## Development

```sh
pnpm --filter @fava-beans/auth test        # unit tests
docker buildx bake auth                    # the image
```
