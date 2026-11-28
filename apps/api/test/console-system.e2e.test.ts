import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { ConsoleSystemStatus } from '@dealflow/types';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PasswordService } from '../src/auth/password.service';
import { ConsoleSystemService, WORKER_HEARTBEAT_KEY } from '../src/operator/console-system.service';
import { appClient, ORIGIN, startApp } from './helpers';

const OP_SECRET = 'operator-secret-that-is-at-least-32-chars';

/**
 * The Console header's system status (control-center K1): database ping, the worker's heartbeat and the event
 * backlog. Any signed-in operator may read it; nobody else.
 */
describe('Console system status', () => {
  let app: INestApplication;
  let system: ConsoleSystemService;
  let agent: ReturnType<typeof request.agent>;
  const saved: Record<string, string | undefined> = {};
  const tag = randomUUID().slice(0, 6);
  const password = 'operator-password-1';
  const read = async () => {
    system.forget();
    return (await agent.get('/api/v1/operator/system/status').expect(200)).body as ConsoleSystemStatus;
  };

  beforeAll(async () => {
    saved.OPERATOR_JWT_SECRET = process.env.OPERATOR_JWT_SECRET;
    process.env.OPERATOR_JWT_SECRET = OP_SECRET;
    app = await startApp();
    system = app.get(ConsoleSystemService);
    const db = appClient();
    // A Support Admin: the status is for every operator, whatever their permissions.
    await db.platformOperator.create({ data: { email: `status-${tag}@platform.test`, name: 'Sam Status', passwordHash: await new PasswordService().hash(password), role: 'SUPPORT' } });
    await db.$disconnect();
    agent = request.agent(app.getHttpServer());
    await agent.post('/api/v1/operator/login').set('origin', ORIGIN).send({ email: `status-${tag}@platform.test`, password }).expect(200);
  });
  afterAll(async () => {
    await app.close();
    if (saved.OPERATOR_JWT_SECRET === undefined) delete process.env.OPERATOR_JWT_SECRET;
    else process.env.OPERATOR_JWT_SECRET = saved.OPERATOR_JWT_SECRET;
  });

  it('refuses anyone who is not signed in to the Console', async () => {
    await request(app.getHttpServer()).get('/api/v1/operator/system/status').expect(401);
  });

  it('says degraded while the worker has not beaten for five minutes, and normal once it beats', async () => {
    const db = appClient();
    try {
      await db.platformSetting.upsert({ where: { key: WORKER_HEARTBEAT_KEY }, create: { key: WORKER_HEARTBEAT_KEY, value: new Date(Date.now() - 10 * 60_000).toISOString() }, update: { value: new Date(Date.now() - 10 * 60_000).toISOString() } });
      const late = await read();
      expect(late.database.ok).toBe(true);
      expect(late.database.latencyMs).toBeGreaterThanOrEqual(0);
      expect(late.worker.ok).toBe(false);
      expect(late.status).toBe('degraded');

      await system.beat();
      const beat = await db.platformSetting.findUnique({ where: { key: WORKER_HEARTBEAT_KEY } });
      expect(Date.now() - new Date(beat!.value).getTime()).toBeLessThan(10_000);
      const now = await read();
      expect(now.worker.ok).toBe(true);
      // Other suites share the database and may leave events waiting; the status follows the backlog.
      expect(now.status).toBe(now.backlog.events > 0 ? 'degraded' : 'ok');
    } finally {
      await db.$disconnect();
    }
  });

  it('writes the heartbeat at most once every 30 seconds', async () => {
    const db = appClient();
    try {
      system.forget();
      const t0 = new Date('2030-01-01T00:00:00Z');
      await system.beat(t0);
      await system.beat(new Date(t0.getTime() + 10_000));
      expect((await db.platformSetting.findUnique({ where: { key: WORKER_HEARTBEAT_KEY } }))!.value).toBe(t0.toISOString());
      await system.beat(new Date(t0.getTime() + 31_000));
      expect((await db.platformSetting.findUnique({ where: { key: WORKER_HEARTBEAT_KEY } }))!.value).toBe(new Date(t0.getTime() + 31_000).toISOString());
    } finally {
      system.forget();
      await system.beat();
      await db.$disconnect();
    }
  });
});
