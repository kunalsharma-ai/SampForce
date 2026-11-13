# syntax=docker/dockerfile:1.7
# Build from the repository root: docker build -f apps/web/Dockerfile --build-arg API_INTERNAL_URL=http://api:4000 .
FROM node:26-bookworm-slim AS base
# Node 25+ no longer ships Corepack, so install the pnpm version package.json pins.
RUN npm install -g pnpm@10.28.0 && npm cache clean --force
WORKDIR /repo

FROM base AS build
ARG API_INTERNAL_URL=http://api:4000
ENV API_INTERNAL_URL=$API_INTERNAL_URL NEXT_TELEMETRY_DISABLED=1
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @dealflow/web... build

FROM node:26-bookworm-slim AS runtime
# Node 25+ defines a global localStorage on the server; turn it off so server rendering sees no browser storage,
# as on Node 22 (otherwise code that checks for localStorage finds a stub and every process logs a warning).
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 NODE_OPTIONS=--no-webstorage
WORKDIR /app
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
# The standalone output leaves out public/, so copy it: the SampForce logos (public/brand) and the country borders
# the globe views fetch (public/geo) were missing from the image and answered 404.
COPY --from=build /repo/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s CMD node -e "fetch('http://localhost:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]
