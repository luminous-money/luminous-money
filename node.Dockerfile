# syntax=docker/dockerfile:1
# The TypeScript workspace. TypeScript services build FROM the `workspace` stage, passed to them
# as a named context by docker-bake.hcl.

FROM node:24-slim AS workspace
RUN corepack enable
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm fetch
COPY . .
RUN pnpm install --prefer-offline --frozen-lockfile

# Generated code must match what the services publish, and everything must build and typecheck.
FROM workspace AS check
COPY --from=ledger-openapi /openapi.json /tmp/ledger-openapi.json
RUN cmp -s /tmp/ledger-openapi.json packages/ledger-client/openapi.json \
  || { echo "ledger's API has changed: run 'pnpm generate' and commit the result" >&2; exit 1; }
RUN cp -r packages /tmp/committed && pnpm -r generate \
  && diff -r --exclude=node_modules /tmp/committed packages \
  || { echo "generated code is stale: run 'pnpm generate' and commit the result" >&2; exit 1; }
RUN pnpm -r build && pnpm -r typecheck && pnpm test:unit && pnpm prettier

# The end-to-end suites, pointed at the stack's Traefik by compose.e2e.yaml: the API suite on
# plain Node, and the browser suite on Playwright's image, whose version must match
# tests/ui/package.json.
FROM workspace AS e2e
RUN pnpm --filter "@fava-beans/e2e..." build
ENV FAVA_BEANS_URL=http://traefik
CMD ["pnpm", "--filter", "@fava-beans/e2e", "test"]

FROM mcr.microsoft.com/playwright:v1.63.0-noble AS ui
WORKDIR /repo
COPY --from=workspace /repo /repo
RUN corepack enable && pnpm --filter "@fava-beans/ui-tests..." build
ENV FAVA_BEANS_URL=http://traefik
CMD ["pnpm", "--filter", "@fava-beans/ui-tests", "test"]

# A fake SimpleFIN server (tests/simplefin-fake), for the e2e stack.
FROM workspace AS simplefin-fake-build
RUN pnpm --filter "@fava-beans/simplefin-fake..." build \
  && pnpm --filter @fava-beans/simplefin-fake deploy --prod --legacy /out

FROM node:24-slim AS simplefin-fake
WORKDIR /srv
COPY --from=simplefin-fake-build /out ./
USER node
EXPOSE 8080
CMD ["node", "dist/main.js"]
