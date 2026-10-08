# syntax=docker/dockerfile:1
# Built from the shared `workspace` stage (node.Dockerfile), which docker-bake.hcl passes in as a
# named context, so every TypeScript service reuses one cached install of the workspace.

FROM workspace AS build
RUN pnpm --filter "@fava-beans/app..." build \
  && pnpm --filter @fava-beans/app deploy --prod --legacy /out

FROM node:22-slim AS runtime
WORKDIR /srv
COPY --from=build /out ./
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
USER node
CMD ["node", "dist/server/main.js"]
