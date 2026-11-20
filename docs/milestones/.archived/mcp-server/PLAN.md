MCP Server: plan
==================================================================================================

> **Status: built and released (2026-11-18, `v1.2.0`).** What turns up with real clients
> (claude.ai, the phone, Claude Code) is fixed after, as Kael asked. Kael answered the brief's questions
> (2026-11-17), asked for skills, and settled the rest on 2026-11-18: `load_skill`, tools named
> by what they do (`read_`, `write_`, `delete_`), gating by refusing, the domains below, uploads
> later. No further spike: the first release is the speculative build, and what turns up with
> real clients gets fixed after (Kael: he's the only user so far). **Tried with a real client**
> (Kael, 2026-11-19, Claude on the phone: "worked great"); nothing turned up to fix.

## The brief (Kael, 2026-11-14)

An MCP server: the next milestone, ahead of HSA tracking. An AI assistant (Claude, or any MCP
client) can read and work with a book through the ledger's API, as Kael does in the app.

## Kael's decisions

2026-11-17:

1. **Reading and writing, at once:** one milestone with the whole surface.
2. **A service in the stack,** reached over HTTP at the instance (luminous.money), installed and
   released with everything else.
3. **OAuth from the start,** so claude.ai and the Claude apps can connect.
4. **No rule for the AI's writes:** it does what the user asks, or uses its judgement. It can
   stage (`!`) or confirm (`*`) as the app can; the API's versioning and roles hold for it.
5. **Skills:** MCP has no way for a server to give a client a skill, so the server brings its
   own, one per part of the app, to be read before working in it.

2026-11-18:

6. **One tool, `load_skill(domain)`,** for every skill. Each tool says its domain at the start
   of its description and refuses until its domain's skill is loaded in the session.
7. **Gating by refusing, not by changing the tool list** (the spike, below: a list that changes
   re-reads the whole conversation in Claude Code unless its tool search is forced on).
8. **Names say what a tool does:** `read_…`, `write_…`, `delete_…`, with MCP's annotations to
   match, so a client can grant reads (`mcp__lm__read_*` in Claude Code; claude.ai groups by the
   annotations) and ask before deletes.
9. **The domains below,** and Claude's calls on them (rules under review; reports their own).
10. **Uploads later:** no way to send a file (a receipt's image, a bank's CSV) through MCP for
    now. Reading a receipt already attached to a transaction is in; capturing one isn't.
11. **No spike for claude.ai and the phone:** release, then fix what comes up.

## What's there now

Checked in the code on 2026-11-18.

- **`auth`** (design.md, "Routing and auth"): a session is a refresh-token family (rotating,
  reuse ends it, 60 days idle, a year at most); access tokens are 10-minute Ed25519 JWTs
  (`iss` and `aud` both `luminous-money`, `sub`, `sid`); `/verify` (Traefik's forwardAuth) takes
  a Bearer token, the access cookie or an API token (`lm_…`) and answers `X-User-Id`, `-Name`,
  `-Email` and `-Email-Verified`. The Account page lists Devices (sessions) and API tokens. No
  authorization endpoint, consent or client registration.
- **The ledger's API** (`packages/ledger-client/openapi.json`, 82 operations): books, accounts,
  transactions (staged `!` or confirmed `*`, PATCH against `updated_at`), the journal (search),
  budgets, funds, trades, prices, reconciliations, BQL (`/query`). Its schemas are described
  field by field.
- **`app`'s API** (Hono, no OpenAPI): review's proposals, matches and transfers, rules,
  suggesting, stars, notifications, reports, renaming/archiving/dividing/deleting accounts and
  renaming funds (so `app`'s own records follow), reconciling, schedules, loans, imports,
  orders, bank feeds, attachments' receipt reading (as a job). Bodies are checked by hand
  against types in `services/app/src/shared`.
- **Confirming in review** is the PWA patching the transaction's flag to `*`, then
  `POST proposals/:id/settle` (recording whether the proposal was kept).
- **Services trust `X-User-Id`** on the internal network; roles are checked by the ledger and
  `app` for anyone calling as the user.

## The service: `services/mcp`

TypeScript, Hono and the MCP TypeScript SDK's low-level `Server` (the tools are a registry of
JSON Schemas, not zod), at **`/api/mcp/v1`** over Streamable HTTP, behind Traefik's `session`
middleware like every API. It has no database: every tool is a call to the ledger or `app` as
the user, with the headers `/verify` set.

- **Sessions** (`Mcp-Session-Id`) are in memory, each bound to the user who started it (another
  user's request with its ID is answered as an unknown session, 404). They hold which skills are
  loaded. A session unused for 12 hours ends; a restart ends them all. A client that gets 404
  starts a new session (MCP says it must), and the model loads the skills again when a tool
  refuses.
- **`instructions`** (the initialize result's) say to load the base skill first.
- **Errors come back as tool errors** (`isError`), with the API's status and `detail`. A 409 on
  an edit says to read it again and retry with the new `updated_at`.
- **Results are compact JSON** (no indentation); lists that can be long take `limit` and a
  cursor where the API has one.
- **Config** (`@wymp/config-simple`, like the others): `PORT`, `LEDGER_URL`, `APP_URL`.
- **In the stack:** its image (`docker-bake.hcl`: `mcp`, `mcp-release`), `compose.yaml`, the
  gateway's route, the release workflow's `:latest`, the `luminous-money` command's health list,
  and the e2e stack. Not `app`'s `/api/health` summary: it's optional, as `ai` and `shops` are.

## Skills and gating

`load_skill(domain)` returns that domain's skill (Markdown, in `services/mcp/src/skills/`) and
marks it loaded in the session; loading another domain before the base returns the base skill
first, in the same answer. Every other tool's description starts with `[domain]`. A tool whose
domain isn't loaded answers (as an error) "Load the `<domain>` skill first:
load_skill("<domain>")", without calling anything. Base tools need the base skill; a domain's
tools need the base and their own.

The base skill teaches what every part assumes: books and roles; the chart (`Assets`,
`Liabilities`, `Equity`, `Income`, `Expenses`; leaves and nodes; divided accounts); a
transaction's splits (postings), amounts as decimal strings with signs, balancing; staged and
confirmed; tags on splits; fund lines; `updated_at` and 409; finding things (the journal's
search, BQL); and the domain list. Each domain's skill teaches its own part, as the PWA and
design.md describe it.

## The tools

Names: `<read|write|delete>_<what>`. Annotations: `read_` is `readOnlyHint`; `write_` is
`destructiveHint: false` where it only adds, else unset; `delete_` is `destructiveHint`. Every
tool but `load_skill` and `read_books` takes `book` (an ID from `read_books`). Input schemas for
ledger calls are the OpenAPI document's (resolved inline); `app`'s are written from its types.

| Domain | Tools | Calls |
| --- | --- | --- |
| (none) | `load_skill` | |
| **base** | `read_books`, `read_accounts`, `read_balances`, `read_transactions` (search), `read_transaction`, `read_account_ledger`, `read_tags`, `read_query` (BQL); `write_add_transaction`, `write_edit_transaction` (settles a proposal when it confirms), `write_star` (an account, budget or fund, for home); `delete_transaction` | app `books`, `stars`; ledger `accounts/tree`, `accounts/summary`, `journal`, `transactions`, `accounts/{a}/ledger`, `tags`, `query`, `directives/{id}` |
| **review** | `read_review_queue` (staged transactions with their proposals), `read_matches`, `read_transfers`, `read_rules`, `read_notifications`; `write_confirm_transactions`, `write_suggest_categories`, `write_assign_match`, `write_confirm_match`, `write_reject_transfer`, `write_add_rule`, `write_edit_rule`, `write_apply_rule`, `write_dismiss_notification`; `delete_rule` | ledger `transactions?flag=!`; app `proposals`, `matches`, `transfers`, `rules`, `suggest`, `notifications` |
| **accounts** | `read_commodities`, `read_purge_preview`; `write_add_account`, `write_edit_account`, `write_rename_account`, `write_archive_account` (or unarchive), `write_divide_account`, `write_set_divided`, `write_set_commodity`; `delete_account`, `delete_account_and_transactions` | ledger `accounts`, `commodities`; app `accounts/{a}/…` |
| **budgets** | `read_budgets`, `read_budget_status`, `read_budget_stars`; `write_set_budget` | ledger `budgets`; app `budget-stars` |
| **reports** | `read_report` (`spending`, `cash_flow`, `breakdown`, `largest`, `net_worth`, `typical`), `read_daily_balances` | app `reports/*`; ledger `accounts/{a}/balances` |
| **funds** | `read_funds`, `read_fund_entries`, `read_short_transactions`, `read_fund_default_preview`; `write_add_fund`, `write_edit_fund`, `write_rename_fund`, `write_archive_fund`, `write_move_funds`, `write_edit_fund_move`, `write_add_fund_default`, `write_edit_fund_default`; `delete_fund`, `delete_fund_move`, `delete_fund_default` | ledger `funds`, `fund-moves`, `fund-defaults`; app `funds/{f}/rename` |
| **investments** | `read_holdings`, `read_prices`, `read_trade_preview`; `write_trade`, `write_add_price`, `write_fetch_prices`, `write_revalue` | ledger `holdings`, `prices`, `trades`, `revalue`; app `prices/fetch` |
| **loans** | `read_loans`, `read_loan`; `write_add_loan`, `write_edit_loan`, `write_rebase_loan`, `write_extra_loan_payment`; `delete_loan` | app `loans` |
| **schedules** | `read_schedules`, `read_upcoming`; `write_add_schedule`, `write_edit_schedule`, `write_run_schedules`; `delete_schedule` | app `schedules` |
| **reconciling** | `read_reconcile` (the screen's view), `read_reconciliations`; `write_reconcile`, `write_reconcile_draft` (save, or discard with null); `delete_reconciliation` (undo one) | app `reconcile`; ledger `reconciliations` |
| **receipts** | `read_attachments`, `read_orders`, `read_job`; `write_read_receipt` (an attached one, as a job), `write_assign_order` | ledger `transactions/{id}/attachments`; app `transactions/{id}/receipt`, `jobs`, `orders` |
| **imports** | `read_imports`, `read_import`, `read_bank_feeds`; `write_sync_bank_feed` | app `imports`, `simplefin/connections`, `simplefin/status` |

**Left out:** creating or deleting books, sharing and invitations, setting up bank and Amazon
connections, AI and book settings, migration, the system page, the user's account; and, until
uploads (decision 10), capturing a receipt, importing a file, reading a lender's schedule.

## Signing in: OAuth 2.1 in `auth`

What Claude's connectors expect (claude.com/docs/connectors/building/authentication) and MCP's
authorization spec:

- **Discovery.** An unauthenticated request to `/api/mcp/v1` gets 401 with `WWW-Authenticate:
  Bearer resource_metadata="<base>/.well-known/oauth-protected-resource/api/mcp/v1"`: `/verify`
  adds it when Traefik's `X-Forwarded-Uri` is under `/api/mcp/`. The protected resource
  metadata (at that path, and at `/.well-known/oauth-protected-resource`) says `resource:
  <base>/api/mcp/v1` (what the user types into Claude) and `authorization_servers: [<base>]`.
  `/.well-known/oauth-authorization-server` is the server's metadata. Both are `auth`'s, routed
  by the gateway without the session check. `<base>` is `LUMINOUS_MONEY_PUBLIC_URL`, or the
  request's forwarded scheme and host.
- **Registration:** dynamic (RFC 7591), `POST /api/auth/v1/oauth/register`: public clients only
  (`token_endpoint_auth_method: none`), `https` redirect URIs or loopback (`http://localhost`,
  `127.0.0.1`, any port, matched without the port, as RFC 8252 says). Stored in `oauth_client`.
  Client ID metadata documents aren't advertised, so Claude registers this way.
- **Authorization:** the authorization endpoint is the PWA's `/ui/authorize`: logged out, the
  usual login first (it stays on the page); then "**<client>** wants to use Luminous Money as
  you", the redirect's host, Allow or Deny. Allow posts the request to
  `POST /api/auth/v1/oauth/authorize` (the login session's cookie; `auth` refuses other
  origins), which checks the client, the exact redirect URI, `response_type=code`, S256 PKCE and
  the resource, and answers the redirect with a code (single use, 5 minutes, hashed in
  `oauth_code`) and `state` and `iss`. Deny redirects with `error=access_denied`.
- **Tokens:** `POST /api/auth/v1/oauth/token`, form-encoded (JSON too), RFC 6749 errors.
  `authorization_code` (with `code_verifier`, `redirect_uri`, `client_id`) starts a session
  (method `oauth`, device: the client's name, `client_id` on it) and answers an access token
  and a refresh token; `refresh_token` rotates as the browser's do, with the reuse check.
  `POST /api/auth/v1/oauth/revoke` ends the token's session (RFC 7009).
- **Access tokens for MCP** carry `aud: <base>/api/mcp/v1` and `client_id`; `/verify` lets
  them reach `/api/mcp/` only. The `mcp` service calls the ledger and `app` inside the stack
  with `X-User-Id`, so the token itself goes no further.
- **Connected apps:** the Account page lists OAuth sessions under their own heading ("Claude,
  connected 18 Nov, last used today"), with Disconnect, which ends the session: its access
  token stops at once (`/verify` checks the session).
- **API tokens still work:** `/verify` takes `lm_…` for `/api/mcp/` as for any API, so Claude
  Code can use `--header "Authorization: Bearer lm_…"` without OAuth.

## What was built (2026-11-18)

All five steps below, as planned, with these differences:

- **93 tools** (and `load_skill`), about 21k tokens of definitions. To keep that down,
  `write_add_loan` leaves out New loan's setup questionnaire (open the accounts and add escrow's
  bills with their own tools), and the edit tools for schedules, loans and rules name their add
  tool's fields rather than repeating the schema.
- **Tests:** `auth` (6 for OAuth: metadata and the 401's pointer, redirects, the code flow and
  refresh, a wrong verifier, a foreign redirect and a reused code, Connected apps, revoking);
  `services/mcp` (9: names and skills, listing and annotations, gating, calls as the user, a
  409's explanation, settling on confirm, the review queue, sessions bound to their user); e2e
  `mcp.test.ts` (the 401's discovery, an API token's session, the OAuth flow end to end); browser
  `mcp.spec.ts` (consent with a login on the way, Connected apps and Disconnect; Deny, and a
  foreign redirect refused).

## Steps

1. **`auth`:** migration 3 (`oauth_client`, `oauth_code`; `session.client_id`), `oauth.ts`
   (clients, codes, PKCE, redirect matching), the routes above, the metadata on the root,
   `keys.sign` with an audience, `/verify`'s audience check and `WWW-Authenticate`, `/sessions`
   saying the client. Unit tests.
2. **`services/mcp`:** the registry, sessions, gating, `load_skill`, the skills, the tools by
   domain, the upstream client. Unit tests against a fake ledger and `app`.
3. **The PWA:** `/ui/authorize`, Connected apps on the Account page. Browser tests.
4. **The stack:** gateway routes, compose, bake, release workflow, the CLI's health list, `app`'s
   health summary, e2e stack. An API e2e test: an MCP client through Traefik with an API token
   (load the base skill, refuse before it, add a transaction, find it, a stale edit's 409), and
   the OAuth flow end to end (register, authorize, token, call, refresh, disconnect).
5. **Docs:** design.md, `docs/deploying.md` (connecting Claude), README, RESUME, PLAN. Released
   as `v1.2.0`; this plan moves to `.archived`.

## What the spike found (2026-11-17)

A throwaway server with three modes (each skill bringing its tools, the base bringing all, all
listed from the start), and Claude Code (2.1.283, Sonnet) run headless against it, each API
call's cache figures read from its output:

| Mode | Tool search | New tools picked up | Cache misses |
| --- | --- | --- | --- |
| each skill brings its tools | `auto` | yes, through ToolSearch | 3 of 3 changes, whole |
| each skill brings its tools | `true` | yes | none |
| each skill brings its tools | `false` | yes, one request late | 3, all but Claude Code's own ~39k |
| the base brings all | `auto` | one request late (a "No such tool" first) | 1 |
| all listed from the start | `auto` | | none |

So a list that changes re-reads the conversation on most setups (on an 800k one, about $3 on
Sonnet each time), hence decision 7. The spike's code was dropped once the decision was made.

## Not in this milestone

- Uploads (decision 10): a short-lived upload link a client sends a file to, for receipts and
  imports.
- MCP resources and prompts.
- Client ID metadata documents (Claude falls back to registration).
