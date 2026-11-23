import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PasswordService } from '../src/auth/password.service';
import { appClient, ORIGIN, registerUser, startApp } from './helpers';

const OP_SECRET = 'operator-secret-that-is-at-least-32-chars';
type Agent = ReturnType<typeof request.agent>;
type Row = { id: string; action: string; target: { type: string; id: string | null; label: string | null } | null; before: Record<string, unknown> | null; after: Record<string, unknown> | null; sessionId: string | null; userAgent: string | null; client: { name: string | null } | null; operator: { email: string } | null; metadata: Record<string, unknown> };
type Item = { id: string; kind: string; category: string; at: string; client: { id: string; name: string } | null; operator: { name: string } | null; data: Record<string, unknown>; link: string | null };

/**
 * The structured platform audit log and the activity feed (ADR 0074, C3): what each entry is about, the values
 * before and after, the session and browser it came from, search, CSV export, and a feed filtered by role.
 */
describe('Console audit log and activity feed', () => {
  let app: INestApplication;
  let admin: Agent;
  let support: Agent;
  let tenantId: string;
  const tag = randomUUID().slice(0, 6);
  const adminEmail = `aud-admin-${tag}@platform.test`;
  const supportEmail = `aud-sup-${tag}@platform.test`;
  const password = 'operator-password-1';
  const org = `Halcyon Panels ${tag}`;
  const op = (agent: Agent) => ({
    get: (url: string) => agent.get(`/api/v1/operator${url}`).set('user-agent', 'Audit test browser'),
    post: (url: string, body: object = {}) => agent.post(`/api/v1/operator${url}`).set('origin', ORIGIN).set('user-agent', 'Audit test browser').send(body),
    put: (url: string, body: object) => agent.put(`/api/v1/operator${url}`).set('origin', ORIGIN).set('user-agent', 'Audit test browser').send(body),
  });

  beforeAll(async () => {
    process.env.OPERATOR_JWT_SECRET = OP_SECRET;
    app = await startApp();
    const db = appClient();
    const passwordHash = await new PasswordService().hash(password);
    await db.platformOperator.createMany({
      data: [
        { email: adminEmail, name: 'Ada Audit', passwordHash, role: 'ADMIN' },
        { email: supportEmail, name: 'Sam Audit', passwordHash, role: 'SUPPORT' },
      ],
    });
    await db.$disconnect();
    admin = request.agent(app.getHttpServer());
    support = request.agent(app.getHttpServer());
    await op(admin).post('/login', { email: adminEmail, password }).expect(200);
    await op(support).post('/login', { email: supportEmail, password }).expect(200);
    tenantId = (await registerUser(app, org, { plan: 'growth' })).tenantId;
  });
  afterAll(async () => {
    await app.close();
    delete process.env.OPERATOR_JWT_SECRET;
  });

  it('records what a change was about, the values before and after, and the session it came from', async () => {
    await op(admin).put(`/clients/${tenantId}/subscription`, { seats: 12, reason: 'Sales-led expansion' }).expect(200);
    const rows = (await op(admin).get(`/audit-log?tenantId=${tenantId}&action=client.subscription_changed`).expect(200)).body as Row[];
    expect(rows).toHaveLength(1);
    const entry = rows[0]!;
    expect(entry.target).toEqual({ type: 'client', id: tenantId, label: org });
    expect(entry.client?.name).toBe(org);
    expect(entry.after).toEqual({ seats: 12 });
    expect(entry.before).toMatchObject({ seats: expect.any(Number) });
    expect(entry.userAgent).toBe('Audit test browser');
    const current = ((await op(admin).get('/me/sessions').expect(200)).body as { id: string; current: boolean }[]).find((s) => s.current)!;
    expect(entry.sessionId).toBe(current.id);
    // The entry on its own, for the detail drawer.
    expect((await op(admin).get(`/audit-log/${entry.id}`).expect(200)).body).toMatchObject({ id: entry.id, after: { seats: 12 } });
    await op(admin).get(`/audit-log/${randomUUID()}`).expect(404);
  });

  it('keeps "from" and "to" as before and after, with secrets removed, and targets roles and settings', async () => {
    await op(admin).put('/security/policy', { idleMinutes: 45 }).expect(200);
    const policy = ((await op(admin).get('/audit-log?action=console.security_policy_changed&limit=1').expect(200)).body as Row[])[0]!;
    expect(policy.target).toMatchObject({ type: 'setting' });
    expect(policy.before).toMatchObject({ idleMinutes: 60 });
    expect(policy.after).toMatchObject({ idleMinutes: 45 });
    await op(admin).put('/security/policy', { idleMinutes: 60 }).expect(200);

    const role = (await op(admin).post('/roles', { name: `Auditors ${tag}`, description: 'Reads the log', permissions: ['audit.view'] }).expect(201)).body as { key: string };
    const created = ((await op(admin).get(`/audit-log?targetType=role&targetId=${role.key}`).expect(200)).body as Row[])[0]!;
    expect(created).toMatchObject({ action: 'operator_role.created', target: { type: 'role', id: role.key, label: `Auditors ${tag}` } });

    // An operator's password link never reaches the log: the stored token and its hash are not there.
    const invite = (await op(admin).post('/operators', { email: `aud-new-${tag}@platform.test`, name: 'New Auditor', role: 'read_only' }).expect(201)).body as { link: string };
    const token = /#token=([A-Za-z0-9_-]+)/.exec(invite.link)![1]!;
    const all = JSON.stringify((await op(admin).get('/audit-log?limit=200').expect(200)).body);
    expect(all).not.toContain(token);
  });

  it('searches by client, operator, target and date, and exports CSV that records the export', async () => {
    const byClient = (await op(admin).get(`/audit-log?q=${encodeURIComponent(org)}`).expect(200)).body as Row[];
    expect(byClient.length).toBeGreaterThan(0);
    expect(byClient.every((r) => r.client?.name === org || r.target?.label?.includes(org) || r.action.includes(org))).toBe(true);
    const byOperator = (await op(admin).get(`/audit-log?q=${encodeURIComponent(adminEmail)}`).expect(200)).body as Row[];
    expect(byOperator.every((r) => r.operator?.email === adminEmail)).toBe(true);
    const today = new Date().toISOString().slice(0, 10);
    expect(((await op(admin).get(`/audit-log?from=${today}&to=${today}&tenantId=${tenantId}`).expect(200)).body as Row[]).length).toBeGreaterThan(0);
    expect((await op(admin).get(`/audit-log?to=2000-01-01&tenantId=${tenantId}`).expect(200)).body).toEqual([]);

    const csv = await op(admin).get(`/audit-log/export?tenantId=${tenantId}`).expect(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.headers['content-disposition']).toMatch(/attachment; filename="sampforce-audit-log-\d{4}-\d{2}-\d{2}\.csv"/);
    const lines = csv.text.replace(/^\uFEFF/, '').trim().split('\r\n');
    expect(lines[0]).toContain('"When (UTC)","Operator","Operator email","Action"');
    expect(lines.some((l) => l.includes('client.subscription_changed') && l.includes(org))).toBe(true);
    expect(Number(csv.headers['x-export-rows'])).toBe(lines.length - 1);
    const exported = ((await op(admin).get('/audit-log?action=audit.exported&limit=1').expect(200)).body as Row[])[0]!;
    expect(exported.metadata).toMatchObject({ filters: { tenantId }, rows: lines.length - 1 });

    // Support Admins have no audit.view.
    await op(support).get('/audit-log').expect(403);
    await op(support).get('/audit-log/export').expect(403);
  });

  it('cannot be changed or removed by the application', async () => {
    const db = appClient();
    try {
      const row = await db.platformAuditLog.findFirstOrThrow({ where: { targetTenantId: tenantId } });
      await expect(db.platformAuditLog.update({ where: { id: row.id }, data: { action: 'tampered' } })).rejects.toThrow();
      await expect(db.platformAuditLog.delete({ where: { id: row.id } })).rejects.toThrow();
    } finally {
      await db.$disconnect();
    }
  });

  it('shows activity across clients, newest first, with only the kinds a role may act on', async () => {
    const feed = (await op(admin).get(`/activity?tenantId=${tenantId}&limit=50`).expect(200)).body as { items: Item[]; next: string | null };
    const kinds = feed.items.map((i) => i.kind);
    expect(kinds).toContain('client.joined');
    expect(kinds).toContain('operator.action');
    const joined = feed.items.find((i) => i.kind === 'client.joined')!;
    expect(joined).toMatchObject({ category: 'clients', client: { id: tenantId, name: org }, link: `/operator/clients/${tenantId}` });
    const action = feed.items.find((i) => i.kind === 'operator.action' && i.data.action === 'client.subscription_changed')!;
    expect(action).toMatchObject({ operator: { name: 'Ada Audit' }, data: { reason: 'Sales-led expansion' } });
    // Views and searches are in the audit log only.
    expect(feed.items.some((i) => String(i.data.action ?? '').endsWith('.viewed'))).toBe(false);
    const times = feed.items.map((i) => i.at);
    expect([...times].sort().reverse()).toEqual(times);

    // A category filter, and paging by time.
    const clientsOnly = (await op(admin).get(`/activity?categories=clients&tenantId=${tenantId}`).expect(200)).body as { items: Item[] };
    expect(clientsOnly.items.every((i) => i.category === 'clients')).toBe(true);
    const first = (await op(admin).get('/activity?limit=2').expect(200)).body as { items: Item[]; next: string };
    const second = (await op(admin).get(`/activity?limit=2&before=${encodeURIComponent(first.next)}`).expect(200)).body as { items: Item[] };
    expect(second.items.every((i) => i.at <= first.items.at(-1)!.at)).toBe(true);
    await op(admin).get('/activity?categories=nonsense').expect(400);

    // Support Admins see clients and support, never billing, security or other operators' actions.
    const theirs = (await op(support).get(`/activity?tenantId=${tenantId}&limit=50`).expect(200)).body as { items: Item[] };
    expect(theirs.items.some((i) => i.kind === 'client.joined')).toBe(true);
    expect(theirs.items.every((i) => ['clients', 'workspaces', 'support'].includes(i.category))).toBe(true);
    const asked = (await op(support).get('/activity?categories=billing,console').expect(200)).body as { items: Item[] };
    expect(asked.items).toEqual([]);
  });
});
