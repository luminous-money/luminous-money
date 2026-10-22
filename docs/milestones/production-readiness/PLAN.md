Production readiness: plan
==================================================================================================

> **Status: planned (2026-10-19); phase 1 built (2026-10-21); phase 2 waits on the
> [questions](#questions).** The brief, from Kael: confirm we're ready
> for production, and document deploying it, with setup scripts, so going from finding it on
> GitHub to running it, on a laptop or on a public server, is as simple as it can be. Answer:
> how one upgrades (and migrates), backs up, reads and exports logs, and knows it's healthy.
> Ideally: releases on GitHub, upgrades from them on the admin's terms, and nothing about the
> system shown to end users; admins named by email in config, with a system page.

## Where it stands (the audit, 2026-10-19)

Not ready yet. What's there:

- **One Compose file** (`compose.yaml`, also a swarm stack), one data volume, Traefik in front;
  `docs/operating.md` covers the settings, bringing your own HTTPS, the operator's commands.
- **Migrations run themselves:** each service migrates its own database on start and refuses one
  newer than itself.
- **Restarts:** every service restarts always (Compose honors `deploy.restart_policy`).
- **Secrets:** `auth` makes its own signing keys; `SIMPLEFIN_ENCRYPTION_KEY` and
  `AI_ENCRYPTION_KEY` are required, and nothing makes them for you.
- **A per-user backup API** (Beancount increments of your own books).

What's missing:

1. **Nothing is published.** There's no GitHub repository, no CI, no release, no images in a
   registry: running it means cloning and building (Node, pnpm, buildx). No LICENSE either.
2. **The stack isn't self-contained:** Traefik's configuration is two files beside
   `compose.yaml`, and its routes belong to a version (M16 added one) but are fixed when its
   container is made. Traefik floats on `traefik:v3`.
3. **Nothing knows its version:** images are tagged, but no service can say what it is.
4. **Health:** only `app` and `ai` have a health route, and `app`'s is behind the session check, so
   nothing outside can ask; there are no Compose healthchecks, so `docker compose ps` says "Up"
   for a service that's failing, and nothing can wait for "healthy".
5. **No whole-system backup:** the backup API covers one user's books, not the four databases,
   the attachments, or the keys. Copying a live SQLite file isn't a consistent backup.
6. **Logs:** everything goes to standard output (good), but Docker's default log driver keeps it
   forever, and there's no way to collect it for a bug report.
7. **HTTPS is yours to provide,** which is right on a laptop or behind a proxy, and a hurdle for
   a small company standing up a public server.
8. **Upgrading** is "pull or build, then `up -d`", with no backup first, no check it came up, and
   no way back.

## Decisions

### Releases: GitHub, and images on its registry

- **A release is a version tag** (`v0.1.0`, semver: 0.x while it's young). A GitHub Actions
  workflow builds every image for amd64 and arm64 and pushes them to GitHub's registry,
  `ghcr.io/luminous-money/fava-beans-<service>:<version>` (and `:latest`), then makes a GitHub
  release with the **bundle**: `compose.yaml`, `.env.example` and the `fava-beans` command. The
  tests run first (`pnpm test`, `pnpm e2e`); a red build publishes nothing.
- **A deployment pins its version** (`FAVA_BEANS_VERSION` in its `.env`), so nothing changes
  until its admin says so.

### A self-contained stack

- **The gateway is an image of ours** (`fava-beans-gateway`): Traefik at a pinned version with
  our routes baked in. A new version brings its own routes, and `compose.yaml` and `.env` are all
  a deployment has.
- **HTTPS, optionally, by the gateway itself:** with `FAVA_BEANS_DOMAIN` (and
  `FAVA_BEANS_ACME_EMAIL`) set, it listens on 80 and 443 and gets its certificate from Let's
  Encrypt (kept on its own volume), redirecting HTTP to HTTPS. Without it, plain HTTP on one port,
  as now: a laptop, a LAN, Tailscale, or behind a proxy you already have.
- **Log rotation in `compose.yaml`:** every service's log is capped (10 MB × 5 files).

### The `fava-beans` command

One bash script, for the host, needing only Docker (Compose v2) and `openssl`:

| Command | What it does |
|---|---|
| `install` | Asks (or takes flags): where (default `~/fava-beans`), laptop or public server, the domain or port, email settings. Downloads the release's `compose.yaml`, writes `.env` (secrets generated), pulls, starts, waits for healthy, prints the address. |
| `status` | Each service's state, health and version, the version pinned, and the latest release. |
| `upgrade [version]` | Backs up, pins the new version (default: the latest release), pulls, restarts, waits for healthy; says how to go back if it doesn't come up. |
| `backup` | A whole-system backup to `backups/` (below); `--keep N` prunes. |
| `restore <file>` | Stops the stack, replaces its data with the backup's, starts it. |
| `logs [service…]` | Every service's log, timestamped (`--since`, `--follow`). |
| `report` | A bundle for a bug report: the logs since a time, status, versions, and the configuration with every secret removed. |
| `up`, `down`, `config` | Start, stop, and check `.env`. |

From a clone it's `scripts/fava-beans`; the release has it as a file of its own, and `install`
copies it into the deployment's directory.

### Upgrades and migrations

- **Migrations stay automatic and forward-only:** each service migrates on start. A database
  newer than its service is refused, so going back a version means restoring the backup
  `upgrade` made first.
- **Every service knows its version** (baked into its image at build) and says it in `/health`.

### Backups

- **Online and consistent:** `backup` runs a one-off container on the data volume (the ledger's
  image, which has Python's SQLite) that copies each database with SQLite's backup API (safe while
  the services run), copies the attachments (written once, never changed), and writes them, with
  the deployment's `.env`, into one `.tar.gz` named for the time and the version. It's as
  sensitive as the books themselves: keep it as you'd keep them.
- **Scheduled by the host:** `backup` is meant for cron or a systemd timer; the deploying guide
  has both. Each backup leaves a marker on the volume (when, and which version), for the system
  page to show.
- **The per-user backup API stays,** for people's own copies of their books.

### Logs

- **Standard output, capped, collected by `logs` and `report`.** Errors carry their stack traces
  (Hono's and Uvicorn's defaults); Traefik's access log has every request. The report says what
  it contains: request paths include book IDs and account names, never amounts or credentials.

### Health and observability

- **`GET /health` on every service:** its status, version and database schema version, without
  a session (it's not routed outside).
- **`GET /api/health`, public, through the gateway:** `app` asks every service and answers 200
  when all are up, 503 otherwise, with each service's up or down only. For uptime monitors.
- **Compose healthchecks** for every service, so `docker compose ps` shows health and `up --wait`
  (which `install` and `upgrade` use) waits for it.

### Admins and the system page (phase 2)

- **Admins are named in config:** `FAVA_BEANS_ADMINS` (emails). An admin is a logged-in user
  whose email is listed **and confirmed** (so nobody can sign up as an admin's address before
  they do); without email, the operator confirms one with `auth`'s command line. There are no
  admin accounts: the same users, with one more page.
- **The system page** (Menu → System, for admins only; anyone else gets 404 from its API): each
  service's version and health, schema versions, the data volume's size, the last backup, the
  update policy, and the latest release with its notes. Nothing about the system shows anywhere
  else, to anyone.
- **Update checks:** `FAVA_BEANS_UPDATES` is `off`, `notify` (default: `app` asks GitHub for
  the latest release once a day, and only the system page shows it) or `auto`.
- **Applying an upgrade happens on the host,** since it replaces the containers: `auto` means a
  host timer runs `fava-beans upgrade` in a window (`FAVA_BEANS_UPGRADE_WINDOW`), installed by
  `fava-beans auto-upgrade on`. An "Upgrade now" button on the system page needs a container that
  can drive Docker, which is root on the host in all but name: [question 1](#questions).

## How it gets built

**Phase 1 (now):**

1. **Versions:** a `VERSION` build arg baked into every image (`FAVA_BEANS_VERSION`).
2. **Health:** `/health` on `auth` and `ledger` (and `app`, `ai` saying their versions and
   schemas); `app`'s public `/api/health`; the gateway's route for it; Compose healthchecks.
3. **The gateway image:** pinned Traefik, our routes, optional HTTPS; `compose.yaml` uses it,
   with log caps.
4. **Backups:** `ledger.snapshot` (every database and the attachments, consistently, plus the
   marker).
5. **`scripts/fava-beans`:** the commands above.
6. **Releases:** the workflow, `.env.example`, the bundle.
7. **Docs:** `docs/deploying.md` (from GitHub to a laptop, a server, or behind a proxy;
   upgrading, backups, logs, health, troubleshooting), `docs/operating.md` folded into it, the
   README split into "run it" and "work on it"; design.md, PLAN.md, RESUME.md.
8. **Tests:** the health routes; a snapshot that restores; the script's commands against a
   throwaway project (`install` from a local bundle, `backup`, `restore`, `status`, `report`).

**Phase 2 (after the questions):** admins and the system page, update checks, `auto-upgrade`,
and who may sign up.

**What phase 1 changed from this plan:** without a domain, the HTTPS port is published on any
free port, not 8443, so two stacks on one machine (development and a live one) don't collide over
a port neither uses.

## Questions

1. **"Upgrade now" in the app:** applying an upgrade means replacing containers, which only
   something with the Docker socket can do (root on the host, in effect). Proposed: upgrades run
   on the host only (`fava-beans upgrade`, by hand or by its timer), and the system page shows
   what's available and the command to run. An opt-in `updater` container with the socket, for
   a button, could come later. Agreed?
2. **Where it's published:** a public `luminous-money/fava-beans` repository on GitHub, images
   on `ghcr.io/luminous-money/`. Right? (The registry is one setting, `FAVA_BEANS_REGISTRY`, so
   it can change.)
3. **A license:** publishing needs one. Beancount is **GPL-2.0-only** (checked: its package
   metadata), and the ledger imports it, so the ledger must be licensed compatibly: GPL-2.0
   (`-only`, or `-or-later`, which combined with Beancount is still GPL-2.0). AGPL-3.0 can't
   cover the ledger, since GPLv2-only code can't be combined with v3. The TypeScript services are
   separate programs talking HTTP, so they're free to differ (GPL-2.0-or-later like the rest, or
   AGPL-3.0 to cover modified hosted copies, or a permissive license). Suggested:
   GPL-2.0-or-later for the whole repository, one license and simple. Your call.
4. **Built-in HTTPS:** the gateway getting its own certificate when given a domain. Built as an
   option (off unless there's a domain). Keep it?
5. **Who may sign up, on a public server:** today anyone who reaches it can create an account
   (rate-limited per address). A company would want to say who: proposed `AUTH_SIGNUPS` as
   `open` (today's), `closed` (accounts made with `auth`'s command line, or by invitation
   links from an admin) or a list of email domains (`example.com`). Wanted for phase 2?
