FROM node:24.22.3-alpine AS build
RUN npm install --global pnpm@11.9.0
WORKDIR /workspace
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/database/package.json ./packages/database/package.json
RUN --mount=type=cache,id=an30-pnpm-store,target=/pnpm/store \
  pnpm config set store-dir /pnpm/store && \
  pnpm --filter @an30/database install --frozen-lockfile --trust-lockfile
COPY tsconfig.base.json ./tsconfig.base.json
COPY packages/database ./packages/database
RUN pnpm --filter @an30/database build
RUN --mount=type=cache,id=an30-pnpm-store,target=/pnpm/store \
  pnpm --filter @an30/database --prod deploy --trust-lockfile /opt/an30/database

FROM node:24.22.3-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S an30 && adduser -S -G an30 an30
COPY --from=build --chown=an30:an30 /opt/an30/database ./
RUN rm -f pnpm-lock.yaml
USER an30
CMD ["node", "dist/migrate.js", "up"]
