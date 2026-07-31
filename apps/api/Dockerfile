FROM node:24.12.0-alpine AS build
RUN npm install --global pnpm@11.9.0
WORKDIR /workspace
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
RUN --mount=type=cache,id=an30-pnpm-store,target=/pnpm/store \
  pnpm config set store-dir /pnpm/store && \
  pnpm --filter @an30/api... install --frozen-lockfile
COPY tsconfig.base.json ./tsconfig.base.json
COPY apps/api ./apps/api
COPY packages/contracts ./packages/contracts
RUN pnpm --filter @an30/contracts build && pnpm --filter @an30/api build
RUN --mount=type=cache,id=an30-pnpm-store,target=/pnpm/store \
  pnpm --filter @an30/api --prod deploy /opt/an30/api

FROM node:24.12.0-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S an30 && adduser -S -G an30 an30
COPY --from=build --chown=an30:an30 /opt/an30/api ./
RUN rm -f pnpm-lock.yaml && \
  find node_modules -type d -path '*/fastify/docs' -prune -exec rm -rf '{}' +
USER an30
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:4000/api/v1/health/live').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
