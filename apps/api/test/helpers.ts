import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@dealflow/database';
import { createApp } from '../src/bootstrap';

export const ORIGIN = 'http://localhost:3000';

export async function startApp(): Promise<INestApplication> {
  const app = await createApp();
  await app.init();
  return app;
}

/** Schema-owner connection. RLS is FORCEd on tenant tables, so it still needs a tenant context. */
export function ownerClient(): PrismaClient {
  return new PrismaClient({ datasources: { db: { url: process.env.TEST_OWNER_DATABASE_URL! } } });
}

/** Runtime role connection (no BYPASSRLS), exactly what the API uses. */
export function appClient(): PrismaClient {
  return new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL! } } });
}

export interface TestUser {
  agent: ReturnType<typeof request.agent>;
  email: string;
  password: string;
  tenantId: string;
}

export async function registerUser(app: INestApplication, org = 'Org'): Promise<TestUser> {
  const email = `u-${randomUUID().slice(0, 8)}@example.com`;
  const password = 'correcthorse1';
  const agent = request.agent(app.getHttpServer());
  const res = await agent
    .post('/api/v1/auth/register')
    .set('origin', ORIGIN)
    .send({ name: `User ${org}`, email, password, organizationName: org })
    .expect(201);
  return { agent, email, password, tenantId: res.body.tenantId as string };
}
