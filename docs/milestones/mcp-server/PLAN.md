MCP Server: plan
==================================================================================================

> **Status: noted, not planned** (Kael, 2026-11-14). Next in line; elaborated with Kael when it
> starts.

## The brief (Kael, 2026-11-14)

An MCP server: the next milestone, ahead of HSA tracking.

The point, as Claude reads it (to confirm): an AI assistant (Claude, or any MCP client) can read
and work with a book through the ledger's API, as Kael does in the app.

## What's there now

- **API tokens** (`lm_…`, M8; design.md, "Auth") already serve scripts and backups with
  `Authorization: Bearer`, so a client outside the browser has a way in.
- **The ledger's API has an OpenAPI description** (`packages/ledger-client/openapi.json`, from
  `pnpm generate`), which an MCP server's tools could be built from.

## Questions for when it starts

- What it's for first: reading (balances, budgets, reports, finding transactions) or writing too
  (entering, categorizing, tagging, confirming review)?
- Where it runs: a service in the stack, reached over HTTP at the instance (luminous.money), or a
  local process that talks to an instance with a token?
- How a client signs in: an API token pasted into the client, or OAuth (MCP's own auth shape)?
- What a write is held to: the same `updated_at` versioning as the app (a stale edit is 409), and
  whether an AI's writes are marked or go through review.
