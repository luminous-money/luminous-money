# syntax=docker/dockerfile:1
# Built from the shared `workspace` stage (node.Dockerfile), which docker-bake.hcl passes in as a
# named context.

FROM workspace AS build
RUN pnpm --filter "@fava-beans/auth..." build \
  && pnpm --filter @fava-beans/auth deploy --prod --legacy /out

FROM node:24-slim AS runtime
WORKDIR /srv
COPY --from=build /out ./
ENV NODE_ENV=production APP_ENV=production
EXPOSE 3000
RUN mkdir /data && chown node:node /data
USER node
CMD ["node", "--disable-warning=ExperimentalWarning", "dist/main.js"]
