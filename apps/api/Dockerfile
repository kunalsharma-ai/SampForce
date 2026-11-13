# syntax=docker/dockerfile:1.7
# Build from the repository root: docker build -f apps/api/Dockerfile .
FROM node:26-bookworm-slim AS base
# Node 25+ no longer ships Corepack, so install the pnpm version package.json pins.
RUN npm install -g pnpm@10.28.0 && npm cache clean --force \
  && apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /repo

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @dealflow/api... build
RUN pnpm deploy --filter @dealflow/api --prod --legacy /out
# The generated Prisma client lives in the workspace store; copy it into the deployed tree, beside the
# @prisma/client package that loads it. (At the top of node_modules it cannot find @prisma/client/runtime, which
# pnpm keeps inside .pnpm, and the API stops at startup with "Cannot find module '@prisma/client/runtime/library.js'".)
RUN src="$(echo node_modules/.pnpm/@prisma+client*/node_modules/.prisma)" \
  && dest="$(echo /out/node_modules/.pnpm/@prisma+client*/node_modules)" \
  && test -d "$src" && test -d "$dest" && cp -r "$src" "$dest/"

# Database set-up as its own image (Kubernetes runs it as a pre-upgrade Job, Compose before the API): creates the
# collections and indexes the schema declares and seeds the plan catalogue. Idempotent; needs only DATABASE_URL.
FROM base AS migrate
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out .
COPY --from=build /repo/packages/database/prisma ./node_modules/@dealflow/database/prisma
USER node
CMD ["node", "node_modules/@dealflow/database/dist/setup-cli.js"]

FROM base AS runtime
# METRICS_PORT turns on the internal metrics/health listener (never published); the worker's health check needs it.
ENV NODE_ENV=production METRICS_PORT=9464
WORKDIR /app
COPY --from=build /out .
COPY --from=build /repo/packages/database/prisma ./prisma
USER node
EXPOSE 4000 9464
# One image runs both the API (dist/main.js) and the worker (dist/worker.js). The check looks at what the container
# runs: the API answers /api/v1/health/ready on 4000, the worker /healthz on 9464. Before, a worker started from a
# compose file without its own healthcheck was always reported unhealthy, because nothing listens on 4000 there.
HEALTHCHECK --interval=15s --timeout=3s --start-period=30s CMD node -e "const w=require('fs').readFileSync('/proc/1/cmdline','utf8').includes('worker.js');fetch(w?'http://localhost:9464/healthz':'http://localhost:4000/api/v1/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]

