Deploying Luminous Money
==================================================================================================

For whoever runs a Luminous Money server: on a laptop for yourself, on a home server for a
household, or on a public server for a company. It's the same thing everywhere: a directory
holding `compose.yaml` (from a release), `.env` (your settings and keys), the `luminous-money`
command, and `backups/`. Docker does the rest.

There are no admin accounts: everyone, including you, signs up in the app like anyone else. What
only the server's operator can do happens on the server, through the `luminous-money` command and
`auth`'s command line. The people you name as [admins](#admins-and-the-system-page) also get a
System page in the app, and no one else sees anything about the server.

- [What you need](#what-you-need)
- [Installing](#installing): [on a laptop or home server](#on-a-laptop-or-a-home-server),
  [on a public server](#on-a-public-server), [behind a proxy you have](#behind-a-proxy-you-have),
  [by hand](#by-hand), [from a clone](#from-a-clone)
- [The `luminous-money` command](#the-luminous-money-command)
- [Upgrading](#upgrading) · [Backups](#backups) · [Logs](#logs) · [Health](#health-and-monitoring) ·
  [Admins and the system page](#admins-and-the-system-page)
- [Settings](#settings) · [The operator's commands](#the-operators-commands) ·
  [Several stacks on one machine](#several-stacks-on-one-machine) ·
  [Troubleshooting](#troubleshooting)

## What you need

- **A machine** running Linux, macOS, or Windows (with WSL 2), on amd64 or arm64 (a Raspberry Pi
  4 or 5 with a 64-bit OS works). About 1 GB of memory for Luminous Money (2 GB is comfortable), and
  a few GB of disk, plus room for backups.
- **Docker** 25 or later with Compose v2.17 or later: [Docker Engine](https://docs.docker.com/engine/install/)
  on Linux, [Docker Desktop](https://docs.docker.com/desktop/) on macOS or Windows. Check with
  `docker compose version`.
- **curl**, to download a release. (`openssl` is used for the keys if it's there.)

## Installing

### On a laptop or a home server

```sh
curl -fsSL https://github.com/luminous-money/luminous-money/releases/latest/download/luminous-money -o luminous-money
bash luminous-money install
```

It asks where people will reach it (choose "this computer, or my own network") and a port
(8080), then downloads the release, writes `.env` with fresh keys, starts everything and waits
until it's healthy. Open `http://localhost:8080/` and **create your account**.

- **Your phone, on the same network:** `http://<this machine's address>:8080/`. To install the
  app on your phone's home screen and use it offline, browsers want HTTPS; the simplest way at
  home is [Tailscale Serve](#behind-a-proxy-you-have), which needs no public server.
- **Only this machine:** `--bind 127.0.0.1`.
- **Somewhere else than `~/luminous-money`:** `--dir /srv/luminous-money`.

Bank feeds (SimpleFIN) only need to reach out to the internet, so a server for yourself never has
to be reachable from it.

### On a public server

1. **Point a domain at the server:** a DNS `A` (and `AAAA`, for IPv6) record for, say,
   `books.example.com`.
2. **Open ports 80 and 443** to it (a cloud firewall or security group, and `ufw allow 80,443/tcp`
   or the like on the machine).
3. **Install, with the domain:**

   ```sh
   curl -fsSL https://github.com/luminous-money/luminous-money/releases/latest/download/luminous-money -o luminous-money
   bash luminous-money install --domain books.example.com --email you@example.com
   ```

   The gateway gets a certificate from Let's Encrypt (the email is where it writes about it),
   renews it on its own, and sends HTTP to HTTPS. Open `https://books.example.com/`.
4. **Email** (recommended, for password resets and confirming addresses): uncomment `SMTP_URL`
   and `MAIL_FROM` in `.env`, then `./luminous-money up`. Without it, resets go through
   [`reset-link`](#the-operators-commands).
5. **Backups:** [schedule them](#scheduling) and copy them somewhere else.

Anyone who can reach the server can create an account (a few per hour per address:
`AUTH_SIGNUPS_PER_HOUR`). Each account sees only its own books and those shared with it.

### Behind a proxy you have

If something already terminates TLS (Caddy, nginx, Traefik, a Cloudflare Tunnel, Tailscale
Serve), install Luminous Money on a local port and point the proxy at it:

```sh
bash luminous-money install --port 8080 --bind 127.0.0.1
```

Then in `.env`, set `LUMINOUS_MONEY_PUBLIC_URL` to the address people use (`https://books.example.com`)
and `./luminous-money up`. The proxy must pass `X-Forwarded-Proto: https`, which they all do; then
session cookies are `Secure`. If the proxy isn't on this machine or a private network, list its
address in `LUMINOUS_MONEY_TRUSTED_PROXIES`.

- **Caddy:** `books.example.com { reverse_proxy 127.0.0.1:8080 }`
- **nginx:** `proxy_pass http://127.0.0.1:8080;` with `proxy_set_header Host $host;` and
  `proxy_set_header X-Forwarded-Proto $scheme;`, and `client_max_body_size 25m;` (receipts and
  imports are uploads).
- **Tailscale Serve** (HTTPS on your tailnet, nothing public): `tailscale serve --bg 8080`; set
  `LUMINOUS_MONEY_PUBLIC_URL` to the `https://<machine>.<tailnet>.ts.net` address it prints.

### By hand

Everything the script does, you can do yourself. From the [release](https://github.com/luminous-money/luminous-money/releases)
you want, download `compose.yaml` and `env.example` into a directory, then:

```sh
cp env.example .env && chmod 600 .env
# Edit .env: set LUMINOUS_MONEY_VERSION to the release, fill in both keys (openssl rand -base64 32
# for each), and choose a port, or a domain.
docker compose up -d --wait
```

`compose.yaml` also works as a swarm stack: `docker stack deploy -c compose.yaml luminous-money`
(with the settings exported). The `luminous-money` command is for Compose.

### From a clone

To run what you've built (`pnpm build`) as a deployment, apart from the development stack:

```sh
scripts/luminous-money install --from . --dir ~/luminous-money-local --port 8090
```

`--from` takes `compose.yaml` from the clone and uses the images built here (version `dev`).

## The `luminous-money` command

`install` copies it into the deployment, so from then on it's `~/luminous-money/luminous-money`. It acts
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
| `auto-upgrade on [--at HH:MM]` / `off` / `status` | Upgrade to each new release by itself, daily at a time (default 03:30), backing up first. See [Upgrading](#upgrading). |
| `help` | All of this. |

## Upgrading

A deployment runs the release pinned in `.env` (`LUMINOUS_MONEY_VERSION`), and nothing changes until
you change it. `./luminous-money status` says when there's a newer one; its notes are on the
[releases page](https://github.com/luminous-money/luminous-money/releases).

```sh
./luminous-money upgrade            # to the latest release
./luminous-money upgrade 0.3.0      # to a particular one
```

It **backs up first**, downloads the release's `compose.yaml` (and the newer `luminous-money`
command), pins the version, pulls the images, restarts, and waits until everything is healthy.

- **Migrations happen by themselves:** each service brings its own database up to date as it
  starts. They only go forward: a service refuses a database newer than itself.
- **Going back** means restoring the backup the upgrade made, with the old version:
  `./luminous-money restore backups/<the one before the upgrade> --version <old version>`. If an
  upgrade doesn't come up healthy, it prints exactly that.
- **By hand:** set `LUMINOUS_MONEY_VERSION`, replace `compose.yaml` with that release's, then
  `docker compose pull && docker compose up -d --wait`. Back up first.

### Knowing there's a new release, and upgrading by itself

`LUMINOUS_MONEY_UPDATES` decides (the app asks GitHub for the latest release once a day, sending
nothing but the version it runs):

- **`notify`** (the default): the [system page](#admins-and-the-system-page) and `status` say when
  one is out. Nobody else sees a thing: end users are never told about upgrades.
- **`off`:** never asks.
- **`auto`:** it upgrades itself. `./luminous-money auto-upgrade on --at 03:30` sets this up: a
  line in your crontab runs `luminous-money upgrade --auto` every day at that time (the server's
  clock), which backs up and upgrades only when there's a newer release, logging to
  `backups/upgrade.log`. `auto-upgrade off` stops it; `auto-upgrade status` says which. Without
  cron, run `luminous-money upgrade --auto` from a systemd timer like the backup's.

Upgrades always happen on the server, never from the app: replacing the containers takes control
of Docker, which the app shouldn't have.

## Backups

```sh
./luminous-money backup --keep 14
```

A backup is one file in `backups/`, named for when it was made and the version:
`luminous-money-20261019T030000Z-0.2.0.tar.gz`. It holds:

- **Every database** (the books, accounts and sessions, the app's data, the AI settings), each
  copied with SQLite's backup API, so it's consistent even though everything keeps running;
- **the attachments** (receipts);
- **`.env`**, whose keys open the bank-feed and AI credentials stored in the databases.

So it holds everything, and it's as sensitive as your books: keep it as you'd keep them.

### Scheduling

With cron (`crontab -e`), every night at 3:

```
0 3 * * * $HOME/luminous-money/luminous-money backup --keep 14 >> $HOME/luminous-money/backups/backup.log 2>&1
```

Or with a systemd timer: `/etc/systemd/system/luminous-money-backup.service`

```ini
[Unit]
Description=luminous-money backup

[Service]
Type=oneshot
User=you
ExecStart=/home/you/luminous-money/luminous-money backup --keep 14
```

and `/etc/systemd/system/luminous-money-backup.timer`

```ini
[Unit]
Description=luminous-money backup, nightly

[Timer]
OnCalendar=*-*-* 03:00
Persistent=true

[Install]
WantedBy=timers.target
```

then `sudo systemctl enable --now luminous-money-backup.timer`.

**Copy them off the machine**, too (rsync, restic, rclone, a synced folder): a backup on the disk
it's backing up doesn't survive the disk.

### Restoring

```sh
./luminous-money restore backups/luminous-money-20261019T030000Z-0.2.0.tar.gz
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
curl -fsS -H "authorization: Bearer $LUMINOUS_MONEY_TOKEN" \
  "https://books.example.com/api/ledger/v1/backup?since=$CURSOR"
```

Each answer has the Beancount changes since the cursor (deletions as tombstones) and the next
cursor to use. See design.md, "Backups".

## Logs

Every service logs to standard output; Docker keeps each service's last 50 MB (five files of
10 MB).

```sh
./luminous-money logs --since 1h          # everything from the last hour
./luminous-money logs app --follow        # one service, as it happens
```

The services are `traefik` (the gateway: one line per request), `auth`, `ledger`, `app` and
`ai`. Errors come with their stack traces.

**For a bug report,** `./luminous-money report` writes `luminous-money-report-<time>.tar.gz`: the last
day's logs (`--since` for more or less), what `status` says, the containers and images, the host's
Docker and disk, and `.env` with every secret hidden. Request paths in the logs name book IDs and
accounts (never amounts, passwords or keys): look it over before sharing it.

## Health and monitoring

- **`./luminous-money status`**: every service's state and health, its version and database schema,
  the latest release, the last backup.
- **`docker compose ps`** shows each container's health too: every image checks its own.
- **`GET /api/health`**, public, for an uptime monitor (Uptime Kuma, UptimeRobot, Healthchecks):

  ```json
  {"status": "ok", "services": {"auth": "up", "ledger": "up", "app": "up", "ai": "up"}}
  ```

  `200` with `ok`, or `degraded` when something needs attention but works (the optional AI
  service is down, or the certificate is expiring); `503` with `down` when the stack can't work.
  It says nothing more, so it's safe to leave public.
- **The certificate,** when the gateway serves HTTPS for a domain: `/api/health` adds it, and
  `status` shows it with anything Let's Encrypt complained about in the last day:

  ```json
  "certificate": {"domain": "books.example.com", "status": "ok", "expires": "2027-01-15T00:00:00.000Z", "days_left": 84}
  ```

  Traefik renews it 30 days before it expires, so `expiring` (under 14 days left) means renewals
  have been failing for two weeks: the health says `degraded` while there's still time to fix it.
  `expired`, or `missing` (none issued), is `down`. With a proxy of your own in front, its
  certificate is the proxy's to watch.

## Admins and the system page

Name the server's admins by email in `.env`:

```sh
LUMINOUS_MONEY_ADMINS=you@example.com,colleague@example.com
```

then `./luminous-money up`. An admin is anyone signed in with one of those emails, **once it's
confirmed** (so nobody can sign up with an admin's address before they do): with email set up,
from the link they're sent; without it, `docker compose exec auth node dist/cli.js confirm-email
you@example.com`. Admins are ordinary accounts otherwise.

Admins find **System** in the menu: each service's state, version and database schema, the
certificate, how much data there is, the last backup, and whether a newer release is out (with
**Check now**). It changes nothing: it says what to run on the server. Anyone else gets "not
found".

## Settings

All in `.env` (`env.example` in the release lists them). After changing any, `./luminous-money up`.

| Setting | What it does |
|---|---|
| `LUMINOUS_MONEY_VERSION` | The release this runs. `upgrade` changes it. |
| `LUMINOUS_MONEY_REGISTRY` | Where the images come from (`ghcr.io/luminous-money/luminous-money`; `luminous-money` for images built here). |
| `COMPOSE_PROJECT_NAME` | The stack's name in Docker, which keeps its data apart from other stacks on the machine. |
| `LUMINOUS_MONEY_PORT` | The HTTP port (default 8080; 80 on a public server). |
| `LUMINOUS_MONEY_BIND` | Listen only on this address (`127.0.0.1`: this machine). Default: every address. |
| `LUMINOUS_MONEY_DOMAIN`, `LUMINOUS_MONEY_ACME_EMAIL` | HTTPS for this domain, with a Let's Encrypt certificate (ports 80 and 443 must reach the machine), and the email Let's Encrypt writes to. |
| `LUMINOUS_MONEY_HTTPS_PORT` | The HTTPS port, with a domain (443). |
| `LUMINOUS_MONEY_PUBLIC_URL` | The address users reach, e.g. `https://books.example.com`. Links in emails point here, and `auth` accepts writes only from this origin. |
| `LUMINOUS_MONEY_TRUSTED_PROXIES` | Behind a proxy: the addresses whose `X-Forwarded-*` headers are believed. Default: private networks and loopback. |
| `SIMPLEFIN_ENCRYPTION_KEY` | **Required.** Seals stored bank-feed credentials. 32 random bytes, base64. Without it, saved bank connections can't be opened (reconnect them with new setup tokens). |
| `AI_ENCRYPTION_KEY` | **Required.** Seals each book's AI provider key. 32 random bytes, base64. |
| `SMTP_URL`, `MAIL_FROM` | Email, for password resets and confirming addresses, e.g. `smtps://user:pass@smtp.example.com` and `Luminous Money <books@example.com>`. Optional. |
| `AUTH_BREACHED_PASSWORDS` | `true` (default) checks new passwords against Have I Been Pwned. Only the first five characters of the password's SHA-1 leave the server. |
| `AUTH_SIGNUPS_PER_HOUR` | Sign-ups allowed per client address per hour (default 20). |
| `SIMPLEFIN_HOSTS` | The SimpleFIN servers setup tokens may point to, comma-separated. Default: the SimpleFIN Bridge's. |
| `CATEGORIZERS` | External categorization providers ([categorizer-api.md](categorizer-api.md)). |
| `AI_CLAUDE_EXTRACT_MODEL`, `AI_CLAUDE_CATEGORIZE_MODEL` | Claude's models for reading receipts and categorizing (defaults `claude-sonnet-5`, `claude-opus-5`). |
| `LUMINOUS_MONEY_ADMINS` | The [admins](#admins-and-the-system-page), by email, comma-separated: they see the system page once their email is confirmed. |
| `LUMINOUS_MONEY_UPDATES` | `notify` (default), `off` or `auto`: whether to look for new releases, and whether the server upgrades itself ([Upgrading](#knowing-theres-a-new-release-and-upgrading-by-itself)). `auto-upgrade` sets it. |
| `LUMINOUS_MONEY_UPGRADE_AT` | With `auto`, when it upgrades (`HH:MM`): `auto-upgrade on --at` sets it, for the system page to show. |
| `APP_ENV` | Which settings file each service starts from. Leave it `production`. |
| `AUTH_TEST_USERS` | Test stacks only. **Never** on a real server: it lets anyone log in as any email. |

Each service checks its settings as it starts, and stops with a list of what's wrong
(`./luminous-money logs --since 5m` shows it).

## The operator's commands

```sh
docker compose exec auth node dist/cli.js <command>
```

| Command | What it does |
|---|---|
| `reset-link <email>` | Prints a password-reset link (works once, for a day). For servers without email, or when it doesn't arrive. |
| `disable <email>` / `enable <email>` | Stops an account logging in and ends its sessions, or lets it back in. |
| `rotate-keys` | Starts signing with a new key; tokens signed with the old one keep working until they expire (10 minutes). |
| `confirm-email <email>` | Marks an account's email confirmed, for a server without email: an [admin](#admins-and-the-system-page) counts once theirs is. |
| `claim-stub <email> <name>` | For a stack from before accounts existed: gives the old stub user's books to a new account, whose password is read from standard input. |

## Several stacks on one machine

Each deployment is its own Compose project (`COMPOSE_PROJECT_NAME`, from `--name` or the
directory's name), with its own data, so a development stack, a test run and the real thing never
touch each other. Give each its own port. `docker compose down -v` in one deletes only that one's
data.

## Troubleshooting

- **It won't start, or isn't healthy:** `./luminous-money logs --since 10m` and `./luminous-money config`.
  A service that stops at once usually says which setting is wrong.
- **"this database is at schema N, newer than this service":** the version went back without its
  data. Pin the version you came from, or restore the backup made before the upgrade with
  `--version`.
- **"address already in use":** another program (or stack) has the port: choose another
  (`LUMINOUS_MONEY_PORT`).
- **No certificate, or it's expiring:** the domain's DNS must point at this machine, and ports 80
  and 443 must reach it from the internet. `./luminous-money status` shows the certificate and
  the last day's Let's Encrypt errors; `./luminous-money logs traefik` has all it said. (It limits
  how often it'll try: fix the cause before restarting again and again.)
- **"cross-site request refused" when logging in:** `LUMINOUS_MONEY_PUBLIC_URL` has to be exactly the
  address in the browser (scheme, host and port), or unset.
- **Lost `.env`:** restore it from a backup. Without its keys, bank connections must be made again
  (new setup tokens) and AI keys entered again; everything else is unaffected.
