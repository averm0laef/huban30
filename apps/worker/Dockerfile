FROM node:24.12.0-alpine AS build
RUN npm install --global pnpm@11.9.0
WORKDIR /workspace
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/worker/package.json ./apps/worker/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
RUN --mount=type=cache,id=an30-pnpm-store,target=/pnpm/store \
  pnpm config set store-dir /pnpm/store && \
  pnpm --filter @an30/worker... install --frozen-lockfile
COPY tsconfig.base.json ./tsconfig.base.json
COPY apps/worker ./apps/worker
COPY packages/contracts ./packages/contracts
RUN pnpm --filter @an30/contracts build && pnpm --filter @an30/worker build
RUN --mount=type=cache,id=an30-pnpm-store,target=/pnpm/store \
  pnpm --filter @an30/worker --prod deploy /opt/an30/worker

FROM node:24.12.0-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S an30 && adduser -S -G an30 an30
COPY --from=build --chown=an30:an30 /opt/an30/worker ./
RUN rm -f pnpm-lock.yaml
USER an30
EXPOSE 4001
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:4001/health/live').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
