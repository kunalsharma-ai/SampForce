# ADR 0002: NestJS for the API

**Status:** accepted (2026-10-30)

**Decision.** NestJS 11 on Express, REST under `/api/v1`, global guards for throttling, origin checks,
authentication and permissions, one exception filter, pino structured logging.

**Why.** Module boundaries map to CRM domains; guards and decorators make authorization declarative and
reviewable (`@RequirePermissions('tenant:manage')`). Large hiring pool.

**Alternatives.** Fastify/Hono with hand-rolled DI (less structure for a large team); tRPC (couples clients to
TypeScript, but DealFlow needs a public REST API anyway). GraphQL may be added for flexible reporting
queries if a concrete need appears.

**Consequences.** Decorator metadata needs SWC in tests and dev (`@swc-node/register`, `unplugin-swc`).
