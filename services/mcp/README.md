# mcp

The MCP server, at `/api/mcp/v1` (Streamable HTTP): an AI assistant (Claude, or any MCP client)
works with a book as the user. It has no database: every tool calls the ledger's or `app`'s API
with the user Traefik vouched for (`X-User-Id`), so roles and versioning hold as for the PWA.
The decisions behind it are in design.md ("The MCP server"); connecting Claude is in
docs/deploying.md; the plan, with every tool, is docs/milestones/.archived/mcp-server.

- **Tools** (`src/tools/<domain>.ts`): named `read_…`, `write_…` or `delete_…`, each in a
  domain. The ledger's take its OpenAPI schemas (`src/schemas.ts`); `app`'s are written there.
- **Skills** (`skills/<domain>.md`): `load_skill(domain)` returns one; every tool refuses until
  its domain's skill (and the base) is loaded in the session. All tools are listed from the
  start, so a client's prompt cache never has to start over.
- **Sessions** (`src/app.ts`) are in memory, each bound to its user; a restart ends them.
- **Signing in** is `auth`'s (OAuth, or an API token): this service only sees the user.

To add a tool: put it in its domain's file, say in that domain's skill what the model needs to
know to use it, and test it in `test/mcp.test.ts`.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `LEDGER_URL` | `http://ledger:8000` | The ledger. |
| `APP_URL` | `http://app:3000` | `app`. |
| `MCP_SESSION_IDLE_HOURS` | `12` | How long an unused session is kept. |
| `PORT` | `3000` | |
