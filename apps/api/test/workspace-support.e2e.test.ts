import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PasswordService } from '../src/auth/password.service';
import { api, appClient, ORIGIN, ownerClient, registerUser, startApp, type TestUser } from './helpers';

/*
 * Chat and support tickets across the workspace hierarchy (ADR 0071, part 5), through the API with real records.
 * Covers Kunal's scenario 13 (a Super Workspace contacts SampForce support), queries passed up from executives and
 * managers, and who may chat with whom.
 */

const OP_SECRET = 'operator-secret-that-is-at-least-32-chars';
type Person = TestUser & { userId: string };

async function acceptInvite(app: INestApplication, inviteUrl: string, name: string): Promise<Person> {
  const token = inviteUrl.split('/invite/')[1]!;
  const agent = request.agent(app.getHttpServer());
  const password = 'a-long-password-1';
  await agent.post('/api/v1/auth/invitations/accept').set('origin', ORIGIN).send({ token, name, password }).expect(200);
  const me = (await agent.get('/api/v1/auth/me').expect(200)).body as { user: { id: string; email: string }; tenant: { id: string } };
  return { agent, email: me.user.email, password, tenantId: me.tenant.id, userId: me.user.id };
}

const dm = (from: TestUser, userId: string) => api(from).post('/chat/conversations', { kind: 'DIRECT', userId });
const say = (from: TestUser, id: string, body: string) => api(from).post(`/chat/conversations/${id}/messages`, { clientId: randomUUID(), body });

describe('chat and support tickets across the hierarchy', () => {
  let app: INestApplication;
  let superAdmin: Person;
  let north: Person;
  let south: Person;
  let priya: Person;
  let arjun: Person;
  let kiran: Person;
  let northId: string;
  let southId: string;
  let priyaId: string;
  let arjunId: string;
  let ops: ReturnType<typeof request.agent>;
  let opsId: string;
  const db = ownerClient();
  const stamp = randomUUID().slice(0, 6);

  beforeAll(async () => {
    process.env.OPERATOR_JWT_SECRET = OP_SECRET;
    app = await startApp();
    const owner = await registerUser(app, 'Frequent Research Support');
    const me = (await owner.agent.get('/api/v1/auth/me').expect(200)).body as { user: { id: string } };
    superAdmin = { ...owner, userId: me.user.id };
    await db.subscription.update({ where: { tenantId: owner.tenantId }, data: { maxManagerWorkspaces: 4, maxExecutiveWorkspaces: 6 } });
    const manager = async (name: string, person: string) => {
      const m = (await api(superAdmin).post('/workspaces', { level: 'MANAGER', name, person: { inviteEmail: `${person.split(' ')[0]!.toLowerCase()}.${stamp}@client.test` } }).expect(201)).body;
      await api(superAdmin).put(`/workspaces/${m.id}/permissions`, { canCreateExecutives: true }).expect(200);
      return { id: m.id as string, person: await acceptInvite(app, m.inviteUrl, person) };
    };
    const executive = async (by: TestUser, name: string) => {
      const e = (await api(by).post('/workspaces', { level: 'EXECUTIVE', name, person: { inviteEmail: `${name.split(' ')[0]!.toLowerCase()}.${stamp}@client.test` } }).expect(201)).body;
      return { id: e.id as string, person: await acceptInvite(app, e.inviteUrl, name) };
    };
    const n = await manager('North India Sales', 'Rahul Sharma');
    const s = await manager('South India Sales', 'Meera Iyer');
    northId = n.id;
    southId = s.id;
    north = n.person;
    south = s.person;
    const p = await executive(north, 'Priya Sharma');
    const a = await executive(north, 'Arjun Mehta');
    const k = await executive(south, 'Kiran Rao');
    priyaId = p.id;
    arjunId = a.id;
    priya = p.person;
    arjun = a.person;
    kiran = k.person;

    const opsEmail = `ws-support-${stamp}@platform.test`;
    const client = appClient();
    opsId = (await client.platformOperator.create({ data: { email: opsEmail, name: 'Anjali (Support)', passwordHash: await new PasswordService().hash('operator-password-1'), role: 'SUPPORT' } })).id;
    await client.$disconnect();
    ops = request.agent(app.getHttpServer());
    await ops.post('/api/v1/operator/login').set('origin', ORIGIN).send({ email: opsEmail, password: 'operator-password-1' }).expect(200);
  });

  afterAll(async () => {
    await db.$disconnect();
    await app.close();
    delete process.env.OPERATOR_JWT_SECRET;
  });

  describe('support tickets', () => {
    it('scenario 13: the Super Workspace contacts SampForce support, which assigns a representative and resolves it', async () => {
      const raised = (
        await api(superAdmin)
          .post('/support/tickets', { subject: 'Invoices show the wrong GST number', body: 'Our November invoice shows last year’s GST number.', category: 'billing', priority: 'HIGH' })
          .expect(201)
      ).body;
      expect(raised).toMatchObject({ handlerLevel: 'CONSOLE', handler: { level: 'CONSOLE', name: 'SampForce support' }, status: 'SUBMITTED', assignedTo: null, resolutionNote: null, canEscalate: false });

      const inbox = (await ops.get('/api/v1/operator/support/tickets').expect(200)).body as { id: string }[];
      expect(inbox.map((t) => t.id)).toContain(raised.id);
      const assigned = (await ops.patch(`/api/v1/operator/support/tickets/${raised.id}`).set('origin', ORIGIN).send({ assignedOperatorId: opsId, status: 'IN_PROGRESS' }).expect(200)).body;
      expect(assigned).toMatchObject({ status: 'IN_PROGRESS', assignedTo: { id: opsId, name: 'Anjali (Support)' } });
      await ops.patch(`/api/v1/operator/support/tickets/${raised.id}`).set('origin', ORIGIN).send({ assignedOperatorId: randomUUID() }).expect(400);
      await ops.post(`/api/v1/operator/support/tickets/${raised.id}/messages`).set('origin', ORIGIN).send({ body: 'Fixed: update the GST number in Billing and we re-issue the invoice.' }).expect(201);
      const closed = (await ops.patch(`/api/v1/operator/support/tickets/${raised.id}`).set('origin', ORIGIN).send({ status: 'CLOSED', resolutionNote: 'Invoice re-issued with the new GST number.' }).expect(200)).body;
      expect(closed).toMatchObject({ status: 'CLOSED', resolutionNote: 'Invoice re-issued with the new GST number.' });

      // The Super Workspace sees its conversation, who looks after it, and how it was resolved.
      const seen = (await api(superAdmin).get(`/support/tickets/${raised.id}`).expect(200)).body;
      expect(seen).toMatchObject({ status: 'CLOSED', assignedTo: { name: 'Anjali (Support)' }, resolutionNote: 'Invoice re-issued with the new GST number.' });
      expect(seen.messages.map((m: { authorKind: string }) => m.authorKind)).toEqual(['USER', 'OPERATOR']);
      const audit = await db.auditLog.findMany({ where: { tenantId: superAdmin.tenantId, entityId: raised.id }, select: { action: true } });
      expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(['support_ticket.raised', 'support_ticket.assigned', 'support_ticket.answered', 'support_ticket.resolution_noted', 'support_ticket.status_changed']));
    });

    it('sends an executive’s query to its own manager, who answers it or passes it up', async () => {
      const t = (await api(priya).post('/support/tickets', { subject: 'Cannot see the panel price list', body: 'The price list is missing from my quotes.' }).expect(201)).body;
      expect(t).toMatchObject({ handlerLevel: 'MANAGER', handler: { name: 'North India Sales' }, handling: false });
      // The manager is told and finds it under the queries waiting on them; the other manager never sees it.
      const notes = (await api(north).get('/notifications').expect(200)).body.items as { type: string; title: string }[];
      expect(notes.find((n) => n.type === 'support.handling')?.title).toMatch(/^New query #\d+$/);
      expect(((await api(north).get('/support/tickets?scope=handling').expect(200)).body as { id: string }[]).map((r) => r.id)).toEqual([t.id]);
      expect((await api(south).get('/support/tickets?scope=handling').expect(200)).body).toEqual([]);
      await api(south).get(`/support/tickets/${t.id}`).expect(404);
      await api(south).post(`/support/tickets/${t.id}/escalate`, {}).expect(404);
      // An executive handles nothing and cannot pass their own query up.
      expect((await api(priya).get('/support/tickets?scope=handling').expect(200)).body).toEqual([]);
      await api(priya).post(`/support/tickets/${t.id}/escalate`, {}).expect(403);
      // Nor can it reach the Console before it is passed up.
      await ops.get(`/api/v1/operator/support/tickets/${t.id}`).expect(404);
      expect(((await ops.get('/api/v1/operator/support/tickets').expect(200)).body as { id: string }[]).map((r) => r.id)).not.toContain(t.id);

      const answered = (await api(north).post(`/support/tickets/${t.id}/messages`, { body: 'The price list is in Quotes → Templates.' }).expect(201)).body;
      expect(answered).toMatchObject({ status: 'AWAITING_USER', handling: true });
      expect(answered.messages.at(-1)).toMatchObject({ authorKind: 'WORKSPACE', author: { name: 'Rahul Sharma' } });
      const mine = (await api(priya).get('/notifications').expect(200)).body.items as { type: string; title: string }[];
      expect(mine.find((n) => n.type === 'support.reply')?.title).toMatch(/^Your query #\d+ has an answer$/);

      // Priya writes back; it opens again, the manager is told, and passes it up with a note.
      expect((await api(priya).post(`/support/tickets/${t.id}/messages`, { body: 'It is not there for me.' }).expect(201)).body.status).toBe('UNDER_REVIEW');
      const up = (await api(north).post(`/support/tickets/${t.id}/escalate`, { note: 'Looks like a permission gap, please check.' }).expect(200)).body;
      expect(up).toMatchObject({ handlerLevel: 'SUPER', handler: { level: 'SUPER', name: 'Super Workspace' }, handling: false, canReply: false, escalatedAt: expect.any(String) });
      await api(north).post(`/support/tickets/${t.id}/messages`, { body: 'One more thing' }).expect(403);

      // The Super Workspace now has it, closes it with a resolution note, and Priya sees both.
      expect(((await api(superAdmin).get('/support/tickets?scope=handling').expect(200)).body as { id: string }[]).map((r) => r.id)).toContain(t.id);
      const done = (await api(superAdmin).patch(`/support/tickets/${t.id}`, { status: 'CLOSED', resolutionNote: 'Quotes templates granted to North India Sales.' }).expect(200)).body;
      expect(done).toMatchObject({ status: 'CLOSED', resolutionNote: 'Quotes templates granted to North India Sales.' });
      const final = (await api(priya).get(`/support/tickets/${t.id}`).expect(200)).body;
      expect(final).toMatchObject({ status: 'CLOSED', resolutionNote: 'Quotes templates granted to North India Sales.' });
      expect(final.messages.map((m: { authorKind: string }) => m.authorKind)).toEqual(['USER', 'WORKSPACE', 'USER', 'WORKSPACE']);
      // The raiser may not write the resolution note.
      await api(priya).patch(`/support/tickets/${t.id}`, { status: 'SUBMITTED', resolutionNote: 'Mine' }).expect(403);
      const escalations = await db.auditLog.findMany({ where: { tenantId: superAdmin.tenantId, action: 'support_ticket.escalated', entityId: t.id } });
      expect(escalations.map((e) => e.metadata)).toEqual([expect.objectContaining({ from: 'MANAGER', to: 'SUPER' })]);
    });

    it('sends a manager’s query to the Super Workspace, which passes it to SampForce', async () => {
      const t = (await api(south).post('/support/tickets', { subject: 'Exports time out', body: 'The deals export never finishes.' }).expect(201)).body;
      expect(t).toMatchObject({ handlerLevel: 'SUPER', canReply: true, handling: false });
      const up = (await api(superAdmin).post(`/support/tickets/${t.id}/escalate`, {}).expect(200)).body;
      expect(up).toMatchObject({ handlerLevel: 'CONSOLE', canEscalate: false });
      await api(superAdmin).post(`/support/tickets/${t.id}/escalate`, {}).expect(403);
      const row = ((await ops.get('/api/v1/operator/support/tickets').expect(200)).body as { id: string; workspace: { level: string; name: string } }[]).find((r) => r.id === t.id);
      expect(row?.workspace).toEqual({ level: 'MANAGER', name: 'South India Sales' });
      // The Console's overview counts it among the queries waiting, and lists the client.
      const overview = (await ops.get('/api/v1/operator/overview').expect(200)).body;
      expect(overview.support.waiting).toBeGreaterThanOrEqual(1);
      expect(overview.needsAttention).toEqual(expect.arrayContaining([expect.objectContaining({ id: superAdmin.tenantId, why: expect.stringMatching(/support quer(y|ies) waiting$/) })]));
    });
  });

  describe('chat', () => {
    it('lets the Super Workspace reach everyone, and a manager only its own team', async () => {
      for (const p of [north, south, priya, kiran]) await dm(superAdmin, p.userId).expect(201);
      await dm(priya, superAdmin.userId).expect(201);
      await dm(north, priya.userId).expect(201);
      // Not another manager's executive, in either direction.
      expect((await dm(north, kiran.userId).expect(403)).body.error.code).toBe('CHAT_NOT_ALLOWED');
      await dm(kiran, north.userId).expect(403);
      // The people list only offers whom you may reach.
      const people = ((await api(north).get('/chat/people').expect(200)).body as { id: string }[]).map((p) => p.id);
      expect(people).toEqual(expect.arrayContaining([superAdmin.userId, priya.userId, arjun.userId]));
      expect(people).not.toContain(kiran.userId);
      expect(people).not.toContain(south.userId);
      // A channel takes only people its maker may reach.
      await api(north).post('/chat/conversations', { kind: 'CHANNEL', name: 'North and South', memberIds: [priya.userId, kiran.userId] }).expect(403);
      const channel = (await api(north).post('/chat/conversations', { kind: 'CHANNEL', name: 'North team', memberIds: [priya.userId, arjun.userId] }).expect(201)).body;
      await api(north).post(`/chat/conversations/${channel.id}/members`, { userIds: [kiran.userId] }).expect(403);
    });

    it('lets managers chat together only when the Super Workspace allows both', async () => {
      await dm(north, south.userId).expect(403);
      await api(superAdmin).put(`/workspaces/${northId}/permissions`, { canChatWithPeers: true }).expect(200);
      await dm(north, south.userId).expect(403);
      await api(superAdmin).put(`/workspaces/${southId}/permissions`, { canChatWithPeers: true }).expect(200);
      const conv = (await dm(north, south.userId).expect(201)).body;
      await say(south, conv.id, 'Shall we share the Kantar account?').expect(201);
      // Switched off again: the history stays, new messages are refused.
      await api(superAdmin).put(`/workspaces/${southId}/permissions`, { canChatWithPeers: false }).expect(200);
      expect((await say(north, conv.id, 'Still there?').expect(403)).body.error.code).toBe('CHAT_NOT_ALLOWED');
      expect(((await api(north).get(`/chat/conversations/${conv.id}/messages`).expect(200)).body as { body: string }[]).map((m) => m.body)).toContain('Shall we share the Kantar account?');
      // Nobody sets it on the Super Workspace, and a manager does not set it for itself.
      const rootId = (await api(superAdmin).get('/workspaces').expect(200)).body.mine.id as string;
      expect((await api(superAdmin).put(`/workspaces/${rootId}/permissions`, { canChatWithPeers: true })).status).toBeGreaterThanOrEqual(400);
      expect((await api(north).put(`/workspaces/${northId}/permissions`, { canChatWithPeers: false })).status).toBeGreaterThanOrEqual(400);
      const audit = await db.auditLog.findFirst({ where: { tenantId: superAdmin.tenantId, action: 'workspace.permissions_changed', entityId: southId }, orderBy: { createdAt: 'desc' } });
      expect(audit?.metadata).toMatchObject({ canChatWithPeers: false });
    });

    it('lets executives of one team chat when their manager allows both, never across teams', async () => {
      await dm(priya, arjun.userId).expect(403);
      await api(north).put(`/workspaces/${priyaId}/permissions`, { canChatWithPeers: true }).expect(200);
      await api(north).put(`/workspaces/${arjunId}/permissions`, { canChatWithPeers: true }).expect(200);
      await dm(priya, arjun.userId).expect(201);
      // Kiran is in another team: no permission opens that.
      await dm(priya, kiran.userId).expect(403);
      // An executive does not change its own setting, nor another team's manager theirs.
      expect((await api(priya).put(`/workspaces/${priyaId}/permissions`, { canChatWithPeers: false })).status).toBeGreaterThanOrEqual(400);
      expect((await api(south).put(`/workspaces/${priyaId}/permissions`, { canChatWithPeers: false })).status).toBeGreaterThanOrEqual(400);
    });

    it('keeps the SampForce support line to the Super Workspace', async () => {
      const mine = (await api(superAdmin).get('/chat/conversations').expect(200)).body as { kind: string }[];
      expect(mine.some((c) => c.kind === 'SUPPORT')).toBe(true);
      for (const p of [north, priya]) {
        const list = (await api(p).get('/chat/conversations').expect(200)).body as { kind: string }[];
        expect(list.some((c) => c.kind === 'SUPPORT')).toBe(false);
      }
    });
  });
});
