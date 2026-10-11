# app

The PWA under `/ui`, and the app API under `/api/app/v1`: CSV profiles and imports, run through
the processing pipeline (`src/server/pipeline`), with import history in `app.sqlite`.

| Route (under `/api/app/v1/books/{book}`) | What it does |
|---|---|
| `GET`/`PUT /profiles/{account}` | An account's CSV profile. |
| `POST /imports` | Import a file (multipart: `account`, `file`). 409 with a `code` if the account needs a profile, or the file doesn't fit it. |
| `GET /imports`, `GET /imports/{batch}` | Import history, and one batch's rows with their outcomes and candidates. |
| `GET /imports/latest` | Each account's last import time. |

Every route needs `X-User-Id` (Traefik sets it), and acts as that user toward the ledger, so a
book they don't own answers 404.

- **The PWA** (`src/web`) is React + Vite, made installable by `vite-plugin-pwa` (web app
  manifest and service worker). It talks to the other services through the same origin, using
  typed clients such as `@fava-beans/ledger-client`.
- **The server** (`src/server`) is Hono on Node. It serves the built PWA, with long-lived caching
  for content-hashed assets, `no-cache` for everything else, and the app shell for client-side
  routes. It also serves `/api/app/v1`.

## Development

```sh
pnpm --filter @fava-beans/app dev      # Vite dev server; proxies /api to FAVA_BEANS_URL
                                       # (default http://localhost:8080, the compose stack)
pnpm --filter "@fava-beans/app..." build
pnpm --filter @fava-beans/app start    # serve the build on :3000
```

The image is built from the repo root by `docker buildx bake app`.

The icons in `public/` are rendered from `public/icon.svg`. The maskable icon uses the same bean
scaled into the safe zone on a full-bleed background.
