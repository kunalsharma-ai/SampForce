# syntax=docker/dockerfile:1.7
# Build from the repository root: docker build -f apps/api/Dockerfile .
FROM node:22-bookworm-slim AS base
RUN corepack enable && apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /repo

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @dealflow/api... build
RUN pnpm deploy --filter @dealflow/api --prod --legacy /out
# The generated Prisma client lives in the workspace store; copy it into the deployed tree.
RUN cp -r node_modules/.pnpm/@prisma+client*/node_modules/.prisma /out/node_modules/.prisma

# Schema migrations as their own small image (Kubernetes runs it as a pre-upgrade Job). It connects as the
# schema owner: pass the owner connection string as DATABASE_URL.
FROM node:22-bookworm-slim AS migrate
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/* \
  && npm install -g prisma@6.19.3 && npm cache clean --force
WORKDIR /migrate
COPY packages/database/prisma ./prisma
USER node
CMD ["prisma", "migrate", "deploy", "--schema", "prisma/schema.prisma"]

FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out .
COPY --from=build /repo/packages/database/prisma ./prisma
USER node
EXPOSE 4000 9464
HEALTHCHECK --interval=15s --timeout=3s CMD node -e "fetch('http://localhost:4000/api/v1/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
