Scale readiness: plan
==================================================================================================

> **Status: assessed (2026-11-18); S1, S2 and S4 fixed, S3 deferred indefinitely, the rest not
> planned or started.**
> Kael asked what it would take to run Luminous Money as a scalable public service: performance
> bottlenecks, security gaps and deployment infrastructure. This is that assessment, read from
> the code at `v1.2.0`, turned into a checklist. Nothing else here is decided: the open
> questions at the end come first when it starts, and what's decided then goes to design.md
> with its reasons.

Luminous Money is built for what it set out to be: one self-hosted stack for a household or a
small company (design.md, "Easy for anyone to stand up, not tied to any one host"). Auth is sound
(Argon2id, 10-minute JWTs, rotating refresh tokens with reuse detection, S256 PKCE,
`SameSite=Strict` cookies, the Origin check, Have I Been Pwned), and edits are versioned. A public
service is a different product, and three kinds of work stand between here and there:

1. **Security that a stack open to strangers needs,** even on one machine. Four are real
   vulnerabilities today (S1 to S4), and S1 matters to a single household's server too.
2. **Scaling:** every service is one process holding state in memory, on SQLite on one local
   volume, so nothing runs as a second copy or on a second host.
3. **Operating a public financial service:** what self-hosting never needed.

## Security

### Vulnerabilities today

- [x] **S1: stored XSS through attachments** (fixed 2026-11-18, `v1.2.1`: design.md,
      "Attachments (M16)"). An attachment keeps the `Content-Type` its
      uploader sent and is served back `inline` from the app's own origin
      (`services/ledger/src/ledger/api.py`, `attach` and `attachment_file`). Upload `text/html`
      with a script, and any member of the shared book who opens it runs that script as
      themselves: the cookies are HttpOnly, but same-origin calls to the APIs still work. Allow
      images and PDF only, send anything else as `Content-Disposition: attachment`, and add
      `X-Content-Type-Options: nosniff` and `Content-Security-Policy: sandbox` to file
      responses; better, serve files from another origin or object storage with signed URLs.
- [x] **S2: no security headers anywhere** (fixed 2026-11-18, `v1.2.1`: design.md, "Routing
      and auth"): no CSP, HSTS, `nosniff` or `frame-ancestors`. The
      OAuth consent page (`/ui/authorize`) can be framed by another site, so a clickjacking page
      could have someone approve an MCP connection to their books. A Traefik `headers`
      middleware on every router (`deploy/gateway/routes.yml`): HSTS, a strict CSP,
      `frame-ancestors 'none'`, `nosniff`, `Referrer-Policy`.
- [ ] **S3: any container can act as any user** (deferred indefinitely: Kael, 2026-11-19).
      Services trust `X-User-Id` because only
      Traefik reaches them (design.md, "Routing and auth"), but all seven containers share one
      flat network (`compose.yaml` has no `networks:`). A compromised `shops` (a headless
      Chromium loading Amazon's pages) or `ai` could call the ledger as anyone. Split the
      networks so only Traefik, `app` and `mcp` reach the ledger; better, have `auth` issue a
      short-lived signed internal token that services check against the JWKS it already
      publishes.
- [x] **S4: no limit on request sizes** (fixed 2026-11-18, `v1.2.1`: design.md, "Routing and
      auth"). The attachment's 5 MB check read `Content-Length` only, so a chunked upload was
      read whole into memory before it was measured; Beancount imports and CSVs had no limit,
      and the gateway set none. Each service now limits its own bodies, said or chunked. Not
      Traefik's buffering middleware, as first suggested here: it buffers responses too, which
      would hold up the MCP server's streamed ones.

### What a public service needs

- [ ] **Rate limits that hold up behind a load balancer.** They're in memory, keyed on the
      last `X-Forwarded-For` hop (`services/auth/src/app.ts`, `clientIp`; `limits.ts`):
  - behind a cloud load balancer or CDN everyone shares one address, so an attacker failing
    logins slows login for everyone;
  - with two `auth` replicas, each keeps its own count;
  - the per-account backoff lets anyone keep a given person from logging in for up to 15
    minutes;
  - outside `auth` there are no per-user quotas: one user's BQL queries or imports can
    saturate the ledger (P2).

  Limits in a shared store (Redis), the client's address from the trusted edge, per-user quotas,
  and a CAPTCHA or proof of work on sign-up.
- [ ] **MFA:** TOTP or WebAuthn. There's none, and for financial data it's expected.
- [ ] **Keys:**
  - in `.env`, and every backup holds `.env` beside the data its keys open;
  - `shops` falls back to `AI_ENCRYPTION_KEY`, so one key can seal two kinds of secret;
  - AES-GCM without associated data, so a sealed value could be copied from one row to another;
  - rotation is still [an M99 item](../m99-follow-ups/PLAN.md).

  A KMS with envelope encryption, keys kept out of backups, the row and user bound as associated
  data, and encrypted backups.
- [ ] **Encryption at rest:** the SQLite files and attachments are plain files on the volume.
      Encrypted disks at the least.
- [ ] **`shops` off for the public service** (an open question below). Keeping strangers' Amazon
      passwords and authenticator setup keys, and logging in as them from datacenter addresses,
      is a large liability: a breach is Amazon account takeover, it's against Amazon's terms, and
      Amazon will block those logins.
- [ ] **Supply chain:** dependency and image scanning, an SBOM, signed images, and Actions pinned
      to commit SHAs (they're pinned to tags).
- [ ] **An audit log** of logins, API tokens made, OAuth grants, sharing changes and account
      deletions, to investigate with or show a user.
- [ ] **Email required** in public mode, through a transactional provider with SPF, DKIM and
      DMARC: resets through the CLI don't work for strangers.

Checked and fine: `app`'s shared guard lets reads through (`services/app/src/server/api.ts`, the
`/books/:book/*` middleware), but every read route checked defers to the ledger's membership, so
no access-control hole was found.

## Performance and scaling

**The constraint:** one process per service, with state in memory, and SQLite on one local
volume. No second replica, no second host, no rolling deploy. The state held in one process:

| State | Where | Breaks when |
|---|---|---|
| Booked books | `services/ledger/src/ledger/service.py`, `Ledger._loaded` | Replicas: each loads books again and holds its own copy |
| Rate limits | `services/auth/src/limits.ts` | Replicas (above) |
| Async jobs (receipt reads) | `services/app/src/server/jobs.ts` | Replicas: polling reaches the wrong copy. Restarts: jobs are lost |
| The daily scheduler | `services/app/src/server/daily.ts` | Replicas: each runs the bank-feed sync, so imports duplicate |
| MCP sessions (skills loaded) | `services/mcp/src/app.ts`, `sessions` | Replicas need sticky sessions |

The bottlenecks, worst first:

- [ ] **P1: the ledger caches whole books with no eviction.** Each booked book is 66 to 200 MB
      at decades of data (design.md, "Performance over decades of data"), kept until the book
      is deleted (`Ledger._loaded`). A few hundred active books run it out of memory. An LRU
      bounded by memory.
- [ ] **P2: one lock for every book's load.** `Ledger.load` holds one `_load_lock` for everyone,
      so one 4-second load (a big book, or a write followed by a BQL query) makes every other
      book's load wait; and it's one uvicorn process, under Python's GIL. Locks per book,
      several worker processes routed by book, and full validation run asynchronously
      (design.md calls that "the next step for `ledger`"; it hasn't been done).
- [ ] **P3: every page of an account's ledger rebuilds all of it.** `Ledger.account_ledger`
      computes running balances over the account's whole history in Python, then slices the
      page, so each scroll costs the whole history. Store running balances, or cache the rows
      per book, account and change.
- [ ] **P4: background work can't keep up at scale.** Daily jobs run one after another across
      every bank connection (`daily.ts`, `startDaily`; `simplefin/sync.ts`): with thousands,
      a day's run doesn't finish in a day. Amazon syncs start a Chromium each. A durable queue
      with a pool of workers, limits on concurrency, and per-provider rate limits (SimpleFIN
      limits requests).
- [ ] **P5: auth is on every request's path.** Each API call goes Traefik → `auth`'s `/verify`
      (the JWT and a SQLite read) → the service; `app`'s writes add a ledger call for the role.
      Fine now, but it's one Node process on synchronous SQLite. Check JWTs at the edge or in
      each service, and push revocations out rather than reading the database every time.
- [ ] **P6: attachments on local disk.** To object storage, which also takes care of S1's
      origin.

## Deployment infrastructure

**Two ways to scale** (the first open question below):

- **A. Cells (the recommendation).** Many copies of today's stack, each for a bounded group of
  users, behind a thin control plane: sign-up, which cell a user is in, upgrades across cells,
  billing. SQLite, the book cache and one process per service all stay valid inside a cell, and
  a household's books (sharing included) stay in one. The least rewriting for real scale.
- **B. Stateless replicas.** Postgres for `auth`, `app` and the ledger (design.md keeps database
  access behind an interface); Redis for limits, MCP sessions and jobs; the scheduler and syncs
  on a queue with workers. The ledger still shards by book with sticky routing, since the
  Beancount engine holds a book in memory.

The book is the shard key either way, which is part of why A is cheaper.

Needed either way:

- [ ] **The edge:** a managed load balancer or CDN, with a web application firewall and DDoS
      protection; the PWA's assets from the CDN.
- [ ] **Backups:** today a nightly tarball on the same disk, so up to a day lost. Litestream
      (SQLite replicated as it's written) to object storage in another region, or managed
      Postgres with point-in-time recovery; restores tested on a schedule.
- [ ] **Deploys without downtime:** today an upgrade restarts the stack and each service
      migrates its database as it starts. With replicas, migrations both versions can run
      against, applied as their own step before the deploy; rolling or blue/green, through a
      staging environment.
- [ ] **Observability:** today Docker's logs and `/api/health`. Central logs, Prometheus metrics
      from every service (only Traefik has them), tracing across the services' hops, error
      tracking (Sentry, say), and alerts with someone on call.
- [ ] **Hardened containers:** memory and CPU limits per service (none today: one ledger out of
      memory takes the host with it), read-only root filesystems, `cap_drop: ALL`,
      `no-new-privileges`.
- [ ] **Secrets** in a secrets manager or KMS, not `.env`.
- [ ] **Abuse and quotas:** caps per user on books, directives, attachment storage and API
      rate, and a way to clear out spam accounts.

**Running it as a business** (not code, but it blocks a launch):

- [ ] A privacy policy and terms of service; GDPR and CCPA (export and account deletion exist).
- [ ] SimpleFIN's terms for commercial use; saying how users' receipts reach AI providers.
- [ ] An incident-response plan and breach notification; SOC 2 eventually.
- [ ] The license: GPL-2.0 doesn't make a hosted service publish its changes (AGPL would).
      Decide it on purpose.

## The order suggested

1. **Before anyone can sign up:** S1 to S4, shared and per-user rate limits, P1 and P2,
   containers' memory limits, backups replicated off the machine, email required, `shops` off.
2. **A public beta on one large server:** MFA, the audit log, headers checked with a scanner,
   observability with alerts, attachments in a bucket, the ledger's validation asynchronous.
3. **Scaling out:** cells' control plane (or Postgres, Redis and a queue), durable jobs and
   schedules, upgrades without downtime, KMS, compliance.

S1, S2 and S4 came ahead of the rest, on their own (Kael, 2026-11-18; `v1.2.1`). S3 is deferred
indefinitely (Kael, 2026-11-19).

## Open questions

1. **Cells or stateless replicas?** (Recommended: cells.)
2. **Is there a public service at all, and for whom?** Free, paid, invited? It sets how much of
   the business section is needed, and when.
3. **`shops` (Amazon) on the public service:** off, or kept with what it would take?
4. **MFA:** TOTP, WebAuthn (passkeys), or both? Required, or offered?
5. **Hosting:** which provider, and managed pieces (Postgres, object storage, a KMS) or our own?
6. ~~**S1 and S2 now,** apart from this milestone, for the current deployments?~~ Answered
   (Kael, 2026-11-18): S1, S2 and S4, released in `v1.2.1`.
