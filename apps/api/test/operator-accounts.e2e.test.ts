import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import type { PrismaClient } from '@dealflow/database';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PasswordService } from '../src/auth/password.service';
import { listOperators, setOperatorRole, setOperatorStatus } from '../src/operator/operator-accounts';
import { appClient, ORIGIN, startApp } from './helpers';

const run = promisify(execFile);
const OP_SECRET = 'operator-secret-that-is-at-least-32-chars';

/** Super admin (operator) accounts managed from the command line, as the self-host scripts do. */
describe('operator accounts', () => {
  let app: INestApplication;
  let db: PrismaClient;
  const tag = randomUUID().slice(0, 8);
  const first = `first-${tag}@platform.test`;
  const second = `second-${tag}@platform.test`;
  const password = 'operator-password-1';
  const login = (agent: ReturnType<typeof request.agent>, email: string) =>
    agent.post('/api/v1/operator/login').set('origin', ORIGIN).send({ email, password });

  beforeAll(async () => {
    process.env.OPERATOR_JWT_SECRET = OP_SECRET;
    app = await startApp();
    db = appClient();
    // Only this file's operators count towards "the last active ADMIN".
    await db.platformOperator.updateMany({ where: { role: 'ADMIN' }, data: { status: 'DISABLED' } });
  });
  afterAll(async () => {
    await db.$disconnect();
    await app.close();
    delete process.env.OPERATOR_JWT_SECRET;
  });

  it('the create-operator CLI makes a super admin who can sign in, and resetting keeps one ADMIN', async () => {
    const env = { ...process.env, OPERATOR_EMAIL: first, OPERATOR_NAME: 'First Admin', OPERATOR_PASSWORD: password, OPERATOR_ROLE: 'ADMIN' };
    const cli = ['-r', '@swc-node/register', 'scripts/create-operator.ts'];
    const { stderr } = await run(process.execPath, cli, { env });
    expect(stderr).toContain(`Operator ${first} (ADMIN) is ready.`);
    const agent = request.agent(app.getHttpServer());
    await login(agent, first).expect(200);
    expect((await agent.get('/api/v1/operator/me').expect(200)).body).toMatchObject({ email: first, role: 'ADMIN' });

    // Re-running without OPERATOR_ROLE=ADMIN would demote the only ADMIN: refused.
    await expect(run(process.execPath, cli, { env: { ...env, OPERATOR_ROLE: '' } })).rejects.toMatchObject({ stderr: expect.stringContaining('last active ADMIN') });
    expect((await db.platformOperator.findUnique({ where: { email: first } }))?.role).toBe('ADMIN');
  });

  it('never disables or demotes the last active ADMIN', async () => {
    await expect(setOperatorStatus(db, first, false)).rejects.toThrow(/last active ADMIN/);
    await expect(setOperatorRole(db, first, 'SUPPORT')).rejects.toThrow(/last active ADMIN/);
    await expect(setOperatorStatus(db, 'nobody@platform.test', false)).rejects.toThrow(/No operator account/);
  });

  it('a disabled operator is signed out at once and cannot sign in; enabling restores access', async () => {
    const passwordHash = await new PasswordService().hash(password);
    await db.platformOperator.create({ data: { email: second, name: 'Second Admin', passwordHash, role: 'ADMIN' } });
    const agent = request.agent(app.getHttpServer());
    await login(agent, second).expect(200);
    await agent.get('/api/v1/operator/me').expect(200);

    expect((await setOperatorStatus(db, second, false)).status).toBe('DISABLED');
    await agent.get('/api/v1/operator/me').expect(401);
    await login(agent, second).expect(401);

    await setOperatorStatus(db, second, true);
    await login(agent, second).expect(200);
    await agent.get('/api/v1/operator/me').expect(200);
  });

  it('a role change applies to the current session, and every change is audited', async () => {
    const agent = request.agent(app.getHttpServer());
    await login(agent, second).expect(200);
    await setOperatorRole(db, second, 'SUPPORT');
    expect((await agent.get('/api/v1/operator/me').expect(200)).body.role).toBe('SUPPORT');
    // SUPPORT is read-only: an ADMIN-only route is refused.
    await agent.put('/api/v1/operator/plans/free').set('origin', ORIGIN).send({}).expect(403);
    // A SUPPORT operator can always be disabled; only the last ADMIN is protected.
    await setOperatorStatus(db, second, false);

    const op = await db.platformOperator.findUniqueOrThrow({ where: { email: second } });
    const actions = (await db.platformAuditLog.findMany({ where: { operatorId: op.id }, orderBy: { createdAt: 'asc' } })).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['operator.disabled', 'operator.enabled', 'operator.role_changed']));

    const rows = await listOperators(db);
    expect(rows.find((r) => r.email === second)).toMatchObject({ role: 'SUPPORT', status: 'DISABLED' });
    expect(rows.find((r) => r.email === first)).toMatchObject({ role: 'ADMIN', status: 'ACTIVE' });
  });

  it('the operators CLI lists accounts and reports refusals with a non-zero exit', async () => {
    const cli = (...args: string[]) => run(process.execPath, ['-r', '@swc-node/register', 'scripts/operators.ts', ...args], { env: process.env });
    const { stderr } = await cli('list');
    expect(stderr).toMatch(new RegExp(`${first}\\s+ADMIN\\s+ACTIVE`));
    await expect(cli('disable', first)).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('last active ADMIN') });
    await expect(cli('role', first, 'OWNER')).rejects.toMatchObject({ stderr: expect.stringContaining('usage:') });
  });
});
