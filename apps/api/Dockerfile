FROM node:24.22.3-alpine AS build
RUN npm install --global pnpm@11.9.0
WORKDIR /workspace
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
COPY packages/messaging/package.json ./packages/messaging/package.json
RUN --mount=type=cache,id=an30-pnpm-store,target=/pnpm/store \
  pnpm config set store-dir /pnpm/store && \
  pnpm --filter @an30/api... install --frozen-lockfile --trust-lockfile
COPY tsconfig.base.json ./tsconfig.base.json
COPY apps/api ./apps/api
COPY packages/contracts ./packages/contracts
COPY packages/messaging ./packages/messaging
RUN pnpm --filter @an30/contracts build && pnpm --filter @an30/messaging build && pnpm --filter @an30/api build
RUN --mount=type=cache,id=an30-pnpm-store,target=/pnpm/store \
  pnpm --filter @an30/api --prod deploy --trust-lockfile /opt/an30/api

FROM node:24.22.3-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN apk add --no-cache ffmpeg && \
  addgroup -S -g 10001 an30 && \
  adduser -S -D -H -u 10001 -G an30 an30 && \
  install -d -o an30 -g an30 -m 0700 /data/uploads
COPY --from=build --chown=an30:an30 /opt/an30/api ./
RUN rm -f pnpm-lock.yaml && \
  find node_modules -type d -path '*/fastify/docs' -prune -exec rm -rf '{}' +
USER an30
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:4000/api/v1/health/live').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
