# syntax=docker/dockerfile:1
# Built from the shared `workspace` stage (node.Dockerfile), which docker-bake.hcl passes in as a
# named context.

FROM workspace AS build
RUN pnpm --filter "@fava-beans/ai..." build \
  && pnpm --filter @fava-beans/ai deploy --prod --legacy /out

FROM node:24-slim AS runtime
WORKDIR /srv
COPY --from=build /out ./
ENV NODE_ENV=production APP_ENV=production
EXPOSE 3000
RUN mkdir /data && chown node:node /data
USER node
# Its health (its /health): what `docker compose ps`, `up --wait` and swarm go by.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --start-interval=2s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
# The release it is (docker-bake.hcl passes VERSION), for /health and the system page.
ARG VERSION=dev
ENV FAVA_BEANS_VERSION=${VERSION}
CMD ["node", "--disable-warning=ExperimentalWarning", "dist/main.js"]
