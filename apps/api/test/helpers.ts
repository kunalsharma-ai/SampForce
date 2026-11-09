import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createPrismaClient, Prisma, PrismaClient } from '@dealflow/database';
import type { PlanCode } from '@dealflow/types';
import { createApp } from '../src/bootstrap';

export const ORIGIN = 'http://localhost:3000';

export async function startApp(): Promise<INestApplication> {
  const app = await createApp();
  await app.init();
  return app;
}

/** Owner connection without the workspace guard, for arranging and inspecting test state. */
export function ownerClient(): PrismaClient {
  return new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL! } } });
}

/** The guarded client, exactly what the API uses (workspace rules in packages/database/src/scope.ts). */
export function appClient(): PrismaClient {
  return createPrismaClient(process.env.DATABASE_URL!) as unknown as PrismaClient;
}

export interface TestUser {
  agent: ReturnType<typeof request.agent>;
  email: string;
  password: string;
  tenantId: string;
}

/**
 * Signs up a new workspace. Sign-up starts on Free; most suites test a feature rather than plan packaging, so the
 * workspace is then moved to `plan` (Enterprise Plus by default, which includes every feature, ADR 0057). Suites
 * that test Free's limits pass `{ plan: 'free' }`.
 */
export async function registerUser(app: INestApplication, org = 'Org', opts: { plan?: PlanCode } = {}): Promise<TestUser> {
  const email = `u-${randomUUID().slice(0, 8)}@example.com`;
  const password = 'correcthorse1';
  const agent = request.agent(app.getHttpServer());
  const res = await agent
    .post('/api/v1/auth/register')
    .set('origin', ORIGIN)
    .send({ name: `User ${org}`, email, password, organizationName: org })
    .expect(201);
  const tenantId = res.body.tenantId as string;
  const plan = opts.plan ?? 'enterprise_plus';
  if (plan !== 'free') await setPlan(tenantId, plan);
  return { agent, email, password, tenantId };
}

/** Moves a workspace to a plan (active, 10 seats), as a paid subscription or an operator would. */
export async function setPlan(tenantId: string, planCode: PlanCode, seats = 10): Promise<void> {
  await asTenant(tenantId, (tx) => tx.subscription.update({ where: { tenantId }, data: { planCode, seats, status: 'ACTIVE' } }));
}

/** Thin wrapper that adds the Origin header (CSRF guard) to every unsafe request. */
export function api(user: TestUser) {
  const a = user.agent;
  return {
    get: (url: string) => a.get(`/api/v1${url}`),
    post: (url: string, body?: object) => a.post(`/api/v1${url}`).set('origin', ORIGIN).send(body ?? {}),
    patch: (url: string, body: object) => a.patch(`/api/v1${url}`).set('origin', ORIGIN).send(body),
    put: (url: string, body: object) => a.put(`/api/v1${url}`).set('origin', ORIGIN).send(body),
    del: (url: string) => a.delete(`/api/v1${url}`).set('origin', ORIGIN),
  };
}

/** Invites a new person into the owner's workspace with `roleKey` and signs them in there. */
export async function inviteMember(app: INestApplication, owner: TestUser, roleKey: string): Promise<TestUser & { userId: string }> {
  const email = `m-${randomUUID().slice(0, 8)}@example.com`;
  const password = 'a-long-password-1';
  const inv = (await api(owner).post('/tenants/current/invitations', { email, roleKey }).expect(201)).body as { inviteUrl: string };
  const token = inv.inviteUrl.split('/invite/')[1]!;
  const agent = request.agent(app.getHttpServer());
  await agent.post('/api/v1/auth/invitations/accept').set('origin', ORIGIN).send({ token, name: `Member ${roleKey}`, password }).expect(200);
  const me = (await agent.get('/api/v1/auth/me').expect(200)).body as { user: { id: string } };
  return { agent, email, password, tenantId: owner.tenantId, userId: me.user.id };
}

/** Runs `fn` through the guarded client inside one workspace's context (for arranging test state). */
export async function asTenant<T>(tenantId: string, fn: (tx: import('@dealflow/database').TenantTx) => Promise<T>): Promise<T> {
  const { withDbContext } = await import('@dealflow/database');
  const db = appClient();
  try {
    return await withDbContext(db, { tenantId }, fn);
  } finally {
    await db.$disconnect();
  }
}

/** Counts documents in a collection (by its MongoDB name) through the guarded transaction client. */
export function countCollection(tx: import('@dealflow/database').TenantTx, collection: string, where: Record<string, unknown> = {}): Promise<number> {
  const model = Prisma.dmmf.datamodel.models.find((m) => (m.dbName ?? m.name) === collection);
  if (!model) throw new Error(`No model for collection ${collection}`);
  const delegate = (tx as unknown as Record<string, { count(args: object): Promise<number> }>)[model.name.charAt(0).toLowerCase() + model.name.slice(1)]!;
  return delegate.count({ where });
}
