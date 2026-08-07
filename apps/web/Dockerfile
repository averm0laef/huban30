FROM node:24.12.0-alpine AS build
RUN npm install --global pnpm@11.9.0
WORKDIR /workspace
ARG APP_BASE_URL=http://localhost
ENV APP_BASE_URL=$APP_BASE_URL
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json ./apps/web/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
RUN --mount=type=cache,id=an30-pnpm-store,target=/pnpm/store \
  pnpm config set store-dir /pnpm/store && \
  pnpm --filter @an30/web... install --frozen-lockfile --trust-lockfile
COPY tsconfig.base.json ./tsconfig.base.json
COPY apps/web ./apps/web
COPY packages/contracts ./packages/contracts
RUN pnpm --filter @an30/contracts build && pnpm --filter @an30/web build

FROM node:24.12.0-alpine AS runtime
ENV HOSTNAME=0.0.0.0
ENV NODE_ENV=production
ENV PORT=3000
WORKDIR /app
RUN addgroup -S an30 && adduser -S -G an30 an30
COPY --from=build --chown=an30:an30 /workspace/apps/web/.next/standalone ./
COPY --from=build --chown=an30:an30 /workspace/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=an30:an30 /workspace/apps/web/public ./apps/web/public
USER an30
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health/live').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]
