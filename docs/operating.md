Running fava-beans
==================================================================================================

For whoever runs a fava-beans server. It's one Compose file (`compose.yaml`), its images, one
data volume, and a few environment variables. There are no admin accounts: everyone, including
you, signs up in the app like anyone else. What only the operator can do goes through `auth`'s
command line.

## A live stack, apart from development

Real data gets its own Compose project, with its own volume and port, so `docker compose down -v`
and test runs on a development stack never touch it:

```sh
COMPOSE_PROJECT_NAME=fava-beans-live FAVA_BEANS_PORT=8090 docker compose up -d
```

Put the settings below in an `.env` file next to `compose.yaml` (or export them), and use the
same project name for every command after this.

## Settings

| Variable | What it does |
|---|---|
| `FAVA_BEANS_PORT` | The one HTTP port the stack exposes (Traefik). Default 8080. |
| `FAVA_BEANS_PUBLIC_URL` | The address users reach, e.g. `https://books.example.com`. Links in emails point here, and `auth` accepts writes only from this origin. |
| `SMTP_URL`, `MAIL_FROM` | Email, for password resets and confirming addresses, e.g. `smtps://user:pass@smtp.example.com` and `fava-beans <books@example.com>`. Optional; without them, resets go through `reset-link` below. |
| `AUTH_BREACHED_PASSWORDS` | `true` (default) checks new passwords against Have I Been Pwned. Only the first five characters of the password's SHA-1 leave the server. |
| `AUTH_TEST_USERS` | Test stacks only. Never set it on a live stack: it lets anyone log in as any email. |

`AUTH_JWT_SECRET` is gone: `auth` makes and keeps its own signing keys.

## HTTPS

TLS is yours to provide: the stack serves plain HTTP on one port. Put it behind something that
terminates TLS (Caddy, nginx, a tunnel, Tailscale Serve) and passes `X-Forwarded-Proto: https`.
When that header arrives, session cookies become `Secure`, with the `__Host-` and `__Secure-`
prefixes. On a plain-HTTP local network they can't be, or browsers would drop them.

Bank feeds (SimpleFIN) only need outbound access, so a server for yourself never has to be
public: your LAN or Tailscale is enough.

## The operator's commands

```sh
docker compose exec auth node dist/cli.js <command>
```

| Command | What it does |
|---|---|
| `reset-link <email>` | Prints a password-reset link (works once, for a day). For servers without email, or when it doesn't arrive. |
| `disable <email>` / `enable <email>` | Stops an account logging in and ends its sessions, or lets it back in. |
| `rotate-keys` | Starts signing with a new key; tokens signed with the old one keep working until they expire (10 minutes). |
| `claim-stub <email> <name>` | For a stack from before accounts existed: gives the old stub user's books to a new account, whose password is read from standard input. |

## Backups

Make an API token on "Your account" (it acts as you, on your books), then pull increments on a
schedule:

```sh
curl -fsS -H "authorization: Bearer $FAVA_BEANS_TOKEN" \
  "https://books.example.com/api/ledger/v1/backup?since=$CURSOR"
```

Each answer has the Beancount changes since the cursor (deletions as tombstones, deleted books
listed) and the next cursor to use. See design.md, "Backups". Backing up the data volume (all
three SQLite databases) works too.

## Upgrading

Pull or build the new images, then `docker compose up -d`. Each service migrates its own
database on start, and refuses one newer than itself.
