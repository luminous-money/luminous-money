# app

The review app: the PWA under `/ui` and the app API under `/api/app/v1`.

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
