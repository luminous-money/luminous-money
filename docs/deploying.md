Deploying fava-beans
==================================================================================================

For whoever runs a fava-beans server: on a laptop for yourself, on a home server for a
household, or on a public server for a company. It's the same thing everywhere: a directory
holding `compose.yaml` (from a release), `.env` (your settings and keys), the `fava-beans`
command, and `backups/`. Docker does the rest.

There are no admin accounts: everyone, including you, signs up in the app like anyone else. What
only the server's operator can do happens on the server, through the `fava-beans` command and
`auth`'s command line.

- [What you need](#what-you-need)
- [Installing](#installing): [on a laptop or home server](#on-a-laptop-or-a-home-server),
  [on a public server](#on-a-public-server), [behind a proxy you have](#behind-a-proxy-you-have),
  [by hand](#by-hand), [from a clone](#from-a-clone)
- [The `fava-beans` command](#the-fava-beans-command)
- [Upgrading](#upgrading) · [Backups](#backups) · [Logs](#logs) · [Health](#health-and-monitoring)
- [Settings](#settings) · [The operator's commands](#the-operators-commands) ·
  [Several stacks on one machine](#several-stacks-on-one-machine) ·
  [Troubleshooting](#troubleshooting)

## What you need

- **A machine** running Linux, macOS, or Windows (with WSL 2), on amd64 or arm64 (a Raspberry Pi
  4 or 5 with a 64-bit OS works). About 1 GB of memory for fava-beans (2 GB is comfortable), and
  a few GB of disk, plus room for backups.
- **Docker** 25 or later with Compose v2.17 or later: [Docker Engine](https://docs.docker.com/engine/install/)
  on Linux, [Docker Desktop](https://docs.docker.com/desktop/) on macOS or Windows. Check with
  `docker compose version`.
- **curl**, to download a release. (`openssl` is used for the keys if it's there.)

## Installing

### On a laptop or a home server

```sh
curl -fsSL https://github.com/luminous-money/fava-beans/releases/latest/download/fava-beans -o fava-beans
bash fava-beans install
```

It asks where people will reach it (choose "this computer, or my own network") and a port
(8080), then downloads the release, writes `.env` with fresh keys, starts everything and waits
until it's healthy. Open `http://localhost:8080/` and **create your account**.

- **Your phone, on the same network:** `http://<this machine's address>:8080/`. To install the
  app on your phone's home screen and use it offline, browsers want HTTPS; the simplest way at
  home is [Tailscale Serve](#behind-a-proxy-you-have), which needs no public server.
- **Only this machine:** `--bind 127.0.0.1`.
- **Somewhere else than `~/fava-beans`:** `--dir /srv/fava-beans`.

Bank feeds (SimpleFIN) only need to reach out to the internet, so a server for yourself never has
to be reachable from it.

### On a public server

1. **Point a domain at the server:** a DNS `A` (and `AAAA`, for IPv6) record for, say,
   `books.example.com`.
2. **Open ports 80 and 443** to it (a cloud firewall or security group, and `ufw allow 80,443/tcp`
   or the like on the machine).
3. **Install, with the domain:**

   ```sh
   curl -fsSL https://github.com/luminous-money/fava-beans/releases/latest/download/fava-beans -o fava-beans
   bash fava-beans install --domain books.example.com --email you@example.com
   ```

   The gateway gets a certificate from Let's Encrypt (the email is where it writes about it),
   renews it on its own, and sends HTTP to HTTPS. Open `https://books.example.com/`.
4. **Email** (recommended, for password resets and confirming addresses): uncomment `SMTP_URL`
   and `MAIL_FROM` in `.env`, then `./fava-beans up`. Without it, resets go through
   [`reset-link`](#the-operators-commands).
5. **Backups:** [schedule them](#scheduling) and copy them somewhere else.

Anyone who can reach the server can create an account (a few per hour per address:
`AUTH_SIGNUPS_PER_HOUR`). Each account sees only its own books and those shared with it.

### Behind a proxy you have

If something already terminates TLS (Caddy, nginx, Traefik, a Cloudflare Tunnel, Tailscale
Serve), install fava-beans on a local port and point the proxy at it:

```sh
bash fava-beans install --port 8080 --bind 127.0.0.1
```

Then in `.env`, set `FAVA_BEANS_PUBLIC_URL` to the address people use (`https://books.example.com`)
and `./fava-beans up`. The proxy must pass `X-Forwarded-Proto: https`, which they all do; then
session cookies are `Secure`. If the proxy isn't on this machine or a private network, list its
address in `FAVA_BEANS_TRUSTED_PROXIES`.

- **Caddy:** `books.example.com { reverse_proxy 127.0.0.1:8080 }`
- **nginx:** `proxy_pass http://127.0.0.1:8080;` with `proxy_set_header Host $host;` and
  `proxy_set_header X-Forwarded-Proto $scheme;`, and `client_max_body_size 10m;` (receipts and
  imports are uploads).
- **Tailscale Serve** (HTTPS on your tailnet, nothing public): `tailscale serve --bg 8080`; set
  `FAVA_BEANS_PUBLIC_URL` to the `https://<machine>.<tailnet>.ts.net` address it prints.

### By hand

Everything the script does, you can do yourself. From the [release](https://github.com/luminous-money/fava-beans/releases)
you want, download `compose.yaml` and `env.example` into a directory, then:

```sh
cp env.example .env && chmod 600 .env
# Edit .env: set FAVA_BEANS_VERSION to the release, fill in both keys (openssl rand -base64 32
# for each), and choose a port, or a domain.
docker compose up -d --wait
```

`compose.yaml` also works as a swarm stack: `docker stack deploy -c compose.yaml fava-beans`
(with the settings exported). The `fava-beans` command is for Compose.

### From a clone

To run what you've built (`pnpm build`) as a deployment, apart from the development stack:

```sh
scripts/fava-beans install --from . --dir ~/fava-beans-local --port 8090
```

`--from` takes `compose.yaml` from the clone and uses the images built here (version `dev`).

## The `fava-beans` command

`install` copies it into the deployment, so from then on it's `~/fava-beans/fava-beans`. It acts
on the deployment it lives in.

| Command | What it does |
|---|---|
| `status` | Each service's state, health and version; the version pinned, the latest release, and the last backup. |
| `up` / `down` | Start everything and wait until it's healthy / stop it. Your data stays. |
| `upgrade [VERSION]` | Back up, then move to VERSION (default: the latest release). See [Upgrading](#upgrading). |
| `backup [--keep N]` | A whole-system backup into `backups/`, keeping the newest N. See [Backups](#backups). |
| `restore FILE [--version V]` | Stop, replace everything with the backup's, start. |
| `logs [SERVICE…] [--since 2h] [--follow]` | The logs, timestamped. See [Logs](#logs). |
| `report [--since 24h]` | A bundle for a bug report: logs, status, versions, and the settings with every secret hidden. |
| `config` | Check `.env`, and show it with its secrets hidden. |
| `help` | All of this. |

## Upgrading

A deployment runs the release pinned in `.env` (`FAVA_BEANS_VERSION`), and nothing changes until
you change it. `./fava-beans status` says when there's a newer one; its notes are on the
[releases page](https://github.com/luminous-money/fava-beans/releases).

```sh
./fava-beans upgrade            # to the latest release
./fava-beans upgrade 0.3.0      # to a particular one
```

It **backs up first**, downloads the release's `compose.yaml` (and the newer `fava-beans`
command), pins the version, pulls the images, restarts, and waits until everything is healthy.

- **Migrations happen by themselves:** each service brings its own database up to date as it
  starts. They only go forward: a service refuses a database newer than itself.
- **Going back** means restoring the backup the upgrade made, with the old version:
  `./fava-beans restore backups/<the one before the upgrade> --version <old version>`. If an
  upgrade doesn't come up healthy, it prints exactly that.
- **By hand:** set `FAVA_BEANS_VERSION`, replace `compose.yaml` with that release's, then
  `docker compose pull && docker compose up -d --wait`. Back up first.

## Backups

```sh
./fava-beans backup --keep 14
```

A backup is one file in `backups/`, named for when it was made and the version:
`fava-beans-20261019T030000Z-0.2.0.tar.gz`. It holds:

- **Every database** (the books, accounts and sessions, the app's data, the AI settings), each
  copied with SQLite's backup API, so it's consistent even though everything keeps running;
- **the attachments** (receipts);
- **`.env`**, whose keys open the bank-feed and AI credentials stored in the databases.

So it holds everything, and it's as sensitive as your books: keep it as you'd keep them.

### Scheduling

With cron (`crontab -e`), every night at 3:

```
0 3 * * * $HOME/fava-beans/fava-beans backup --keep 14 >> $HOME/fava-beans/backups/backup.log 2>&1
```

Or with a systemd timer: `/etc/systemd/system/fava-beans-backup.service`

```ini
[Unit]
Description=fava-beans backup

[Service]
Type=oneshot
User=you
ExecStart=/home/you/fava-beans/fava-beans backup --keep 14
```

and `/etc/systemd/system/fava-beans-backup.timer`

```ini
[Unit]
Description=fava-beans backup, nightly

[Timer]
OnCalendar=*-*-* 03:00
Persistent=true

[Install]
WantedBy=timers.target
```

then `sudo systemctl enable --now fava-beans-backup.timer`.

**Copy them off the machine**, too (rsync, restic, rclone, a synced folder): a backup on the disk
it's backing up doesn't survive the disk.

### Restoring

```sh
./fava-beans restore backups/fava-beans-20261019T030000Z-0.2.0.tar.gz
```

It asks first, stops everything, replaces the databases and attachments with the backup's, takes
the backup's keys, and starts again. Everything after the backup is gone.

**On a new machine:** install as usual, then restore the backup into the new deployment.
If the backup is from an older release than the one installed, that's fine (it's migrated as it
starts); from a newer one, pass `--version` with the backup's.

### Your own copy of your books

Separately, anyone can keep a copy of their own books: Manage books → Export (Beancount), or
the backup API with an API token (Your account → API tokens), which pulls what changed since last
time:

```sh
curl -fsS -H "authorization: Bearer $FAVA_BEANS_TOKEN" \
  "https://books.example.com/api/ledger/v1/backup?since=$CURSOR"
```

Each answer has the Beancount changes since the cursor (deletions as tombstones) and the next
cursor to use. See design.md, "Backups".

## Logs

Every service logs to standard output; Docker keeps each service's last 50 MB (five files of
10 MB).

```sh
./fava-beans logs --since 1h          # everything from the last hour
./fava-beans logs app --follow        # one service, as it happens
```

The services are `traefik` (the gateway: one line per request), `auth`, `ledger`, `app` and
`ai`. Errors come with their stack traces.

**For a bug report,** `./fava-beans report` writes `fava-beans-report-<time>.tar.gz`: the last
day's logs (`--since` for more or less), what `status` says, the containers and images, the host's
Docker and disk, and `.env` with every secret hidden. Request paths in the logs name book IDs and
accounts (never amounts, passwords or keys): look it over before sharing it.

## Health and monitoring

- **`./fava-beans status`**: every service's state and health, its version and database schema,
  the latest release, the last backup.
- **`docker compose ps`** shows each container's health too: every image checks its own.
- **`GET /api/health`**, public, for an uptime monitor (Uptime Kuma, UptimeRobot, Healthchecks):

  ```json
  {"status": "ok", "services": {"auth": "up", "ledger": "up", "app": "up", "ai": "up"}}
  ```

  `200` with `ok`, or `degraded` when only the optional AI service is down; `503` with `down`
  when the stack can't work. It says nothing more, so it's safe to leave public.

## Settings

All in `.env` (`env.example` in the release lists them). After changing any, `./fava-beans up`.

| Setting | What it does |
|---|---|
| `FAVA_BEANS_VERSION` | The release this runs. `upgrade` changes it. |
| `FAVA_BEANS_REGISTRY` | Where the images come from (`ghcr.io/luminous-money/fava-beans`; `fava-beans` for images built here). |
| `COMPOSE_PROJECT_NAME` | The stack's name in Docker, which keeps its data apart from other stacks on the machine. |
| `FAVA_BEANS_PORT` | The HTTP port (default 8080; 80 on a public server). |
| `FAVA_BEANS_BIND` | Listen only on this address (`127.0.0.1`: this machine). Default: every address. |
| `FAVA_BEANS_DOMAIN`, `FAVA_BEANS_ACME_EMAIL` | HTTPS for this domain, with a Let's Encrypt certificate (ports 80 and 443 must reach the machine), and the email Let's Encrypt writes to. |
| `FAVA_BEANS_HTTPS_PORT` | The HTTPS port, with a domain (443). |
| `FAVA_BEANS_PUBLIC_URL` | The address users reach, e.g. `https://books.example.com`. Links in emails point here, and `auth` accepts writes only from this origin. |
| `FAVA_BEANS_TRUSTED_PROXIES` | Behind a proxy: the addresses whose `X-Forwarded-*` headers are believed. Default: private networks and loopback. |
| `SIMPLEFIN_ENCRYPTION_KEY` | **Required.** Seals stored bank-feed credentials. 32 random bytes, base64. Without it, saved bank connections can't be opened (reconnect them with new setup tokens). |
| `AI_ENCRYPTION_KEY` | **Required.** Seals each book's AI provider key. 32 random bytes, base64. |
| `SMTP_URL`, `MAIL_FROM` | Email, for password resets and confirming addresses, e.g. `smtps://user:pass@smtp.example.com` and `fava-beans <books@example.com>`. Optional. |
| `AUTH_BREACHED_PASSWORDS` | `true` (default) checks new passwords against Have I Been Pwned. Only the first five characters of the password's SHA-1 leave the server. |
| `AUTH_SIGNUPS_PER_HOUR` | Sign-ups allowed per client address per hour (default 20). |
| `SIMPLEFIN_HOSTS` | The SimpleFIN servers setup tokens may point to, comma-separated. Default: the SimpleFIN Bridge's. |
| `CATEGORIZERS` | External categorization providers ([categorizer-api.md](categorizer-api.md)). |
| `AI_CLAUDE_EXTRACT_MODEL`, `AI_CLAUDE_CATEGORIZE_MODEL` | Claude's models for reading receipts and categorizing (defaults `claude-sonnet-5`, `claude-opus-5`). |
| `APP_ENV` | Which settings file each service starts from. Leave it `production`. |
| `AUTH_TEST_USERS` | Test stacks only. **Never** on a real server: it lets anyone log in as any email. |

Each service checks its settings as it starts, and stops with a list of what's wrong
(`./fava-beans logs --since 5m` shows it).

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

## Several stacks on one machine

Each deployment is its own Compose project (`COMPOSE_PROJECT_NAME`, from `--name` or the
directory's name), with its own data, so a development stack, a test run and the real thing never
touch each other. Give each its own port. `docker compose down -v` in one deletes only that one's
data.

## Troubleshooting

- **It won't start, or isn't healthy:** `./fava-beans logs --since 10m` and `./fava-beans config`.
  A service that stops at once usually says which setting is wrong.
- **"this database is at schema N, newer than this service":** the version went back without its
  data. Pin the version you came from, or restore the backup made before the upgrade with
  `--version`.
- **"address already in use":** another program (or stack) has the port: choose another
  (`FAVA_BEANS_PORT`).
- **No certificate:** the domain's DNS must point at this machine, and ports 80 and 443 must
  reach it from the internet. `./fava-beans logs traefik` says what Let's Encrypt answered. (It
  limits how often it'll try: fix the cause before restarting again and again.)
- **"cross-site request refused" when logging in:** `FAVA_BEANS_PUBLIC_URL` has to be exactly the
  address in the browser (scheme, host and port), or unset.
- **Lost `.env`:** restore it from a backup. Without its keys, bank connections must be made again
  (new setup tokens) and AI keys entered again; everything else is unaffected.
