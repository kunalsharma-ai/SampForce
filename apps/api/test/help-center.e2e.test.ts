import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FEATURE_KEYS } from '@dealflow/types';
import { PasswordService } from '../src/auth/password.service';
import { api, appClient, inviteMember, ORIGIN, ownerClient, registerUser, startApp, type TestUser } from './helpers';

const OP_SECRET = 'operator-secret-that-is-at-least-32-chars';

async function acceptInvite(app: INestApplication, inviteUrl: string, name: string): Promise<TestUser & { userId: string }> {
  const token = inviteUrl.split('/invite/')[1]!;
  const agent = request.agent(app.getHttpServer());
  const password = 'a-long-password-1';
  await agent.post('/api/v1/auth/invitations/accept').set('origin', ORIGIN).send({ token, name, password }).expect(200);
  const me = (await agent.get('/api/v1/auth/me').expect(200)).body as { user: { id: string; email: string }; tenant: { id: string } };
  return { agent, email: me.user.email, password, tenantId: me.tenant.id, userId: me.user.id };
}

type Help = {
  level: string;
  categories: { id: string; title: string }[];
  faqs: { id: string; question: string; answer: string }[];
  guides: { id: string; title: string; what: string }[];
  results: { kind: string; id: string }[] | null;
};

/*
 * The Help Center (ADR 0073): GET /help answers only for what the reader can use, in their language, and queries
 * raised from Help become support tickets the Console answers.
 */
describe('help center and support tickets', () => {
  let app: INestApplication;
  let owner: TestUser;
  let member: TestUser & { userId: string };
  let manager: TestUser & { userId: string };
  let executive: TestUser & { userId: string };
  let managerId: string;
  let outsider: TestUser;
  let ops: ReturnType<typeof request.agent>;
  const db = ownerClient();
  const opsEmail = `help-ops-${randomUUID().slice(0, 8)}@platform.test`;
  const opsPassword = 'operator-password-1';

  beforeAll(async () => {
    process.env.OPERATOR_JWT_SECRET = OP_SECRET;
    app = await startApp();
    owner = await registerUser(app, 'Help Client');
    member = await inviteMember(app, owner, 'member');
    outsider = await registerUser(app, 'Another Client');
    await db.subscription.update({ where: { tenantId: owner.tenantId }, data: { maxManagerWorkspaces: 2, maxExecutiveWorkspaces: 2 } });
    const m = (await api(owner).post('/workspaces', { level: 'MANAGER', name: 'North Team', person: { inviteEmail: `north-${randomUUID().slice(0, 6)}@client.test` } }).expect(201)).body;
    managerId = m.id;
    manager = await acceptInvite(app, m.inviteUrl, 'Rahul Manager');
    await api(owner).put(`/workspaces/${managerId}/permissions`, { canCreateExecutives: true }).expect(200);
    const e = (await api(manager).post('/workspaces', { level: 'EXECUTIVE', name: 'Amit Desk', person: { inviteEmail: `amit-${randomUUID().slice(0, 6)}@client.test` } }).expect(201)).body;
    executive = await acceptInvite(app, e.inviteUrl, 'Amit Executive');
    const client = appClient();
    await client.platformOperator.create({ data: { email: opsEmail, name: 'Priya (Support)', passwordHash: await new PasswordService().hash(opsPassword), role: 'SUPPORT' } });
    await client.$disconnect();
    ops = request.agent(app.getHttpServer());
    await ops.post('/api/v1/operator/login').set('origin', ORIGIN).send({ email: opsEmail, password: opsPassword }).expect(200);
  });

  afterAll(async () => {
    await db.$disconnect();
    await app.close();
    delete process.env.OPERATOR_JWT_SECRET;
  });

  const opGet = (url: string) => ops.get(`/api/v1/operator/support/tickets${url}`);
  const opPost = (url: string, body: object) => ops.post(`/api/v1/operator/support/tickets${url}`).set('origin', ORIGIN).send(body);
  const opPatch = (url: string, body: object) => ops.patch(`/api/v1/operator/support/tickets${url}`).set('origin', ORIGIN).send(body);

  describe('GET /help', () => {
    it('answers a Super Workspace owner with every area its plan includes', async () => {
      const help = (await api(owner).get('/help').expect(200)).body as Help;
      expect(help.level).toBe('SUPER');
      expect(help.categories.map((c) => c.id)).toEqual(expect.arrayContaining(['start', 'workspaces', 'deals', 'outreach', 'billing', 'support']));
      expect(help.faqs.map((q) => q.id)).toEqual(expect.arrayContaining(['outreach.sequence', 'workspaces.permissionCenter', 'billing.plan', 'support.raise']));
      expect(help.guides.map((g) => g.id)).toEqual(expect.arrayContaining(['page.sequences', 'page.workspaces', 'page.billing']));
      // Nothing from the Console reaches a workspace.
      expect(help.guides.some((g) => g.id.startsWith('page.operator'))).toBe(false);
    });

    it('leaves out what a workspace was not given, and what a level or role cannot use', async () => {
      await api(owner).put(`/workspaces/${managerId}/permissions`, { features: FEATURE_KEYS.filter((k) => k !== 'sequences' && k !== 'rfqs') }).expect(200);
      const forExec = (await api(executive).get('/help').expect(200)).body as Help;
      expect(forExec.level).toBe('EXECUTIVE');
      expect(forExec.guides.map((g) => g.id)).not.toContain('page.sequences');
      expect(forExec.faqs.map((q) => q.id)).not.toContain('outreach.sequence');
      expect(forExec.faqs.map((q) => q.id)).not.toContain('deals.rfq');
      // Executives do not run a Permission Center; managers do.
      expect(forExec.faqs.map((q) => q.id)).not.toContain('workspaces.permissionCenter');
      expect(((await api(manager).get('/help').expect(200)).body as Help).faqs.map((q) => q.id)).toContain('workspaces.permissionCenter');
      // A member's role has no billing permission.
      const forMember = (await api(member).get('/help').expect(200)).body as Help;
      expect(forMember.faqs.map((q) => q.id)).not.toContain('billing.plan');
      expect(forMember.guides.map((g) => g.id)).not.toContain('page.billing');
      // The owner still sees it all.
      expect(((await api(owner).get('/help').expect(200)).body as Help).faqs.map((q) => q.id)).toContain('outreach.sequence');
      await api(owner).put(`/workspaces/${managerId}/permissions`, { features: [...FEATURE_KEYS] }).expect(200);
    });

    it('speaks the reader’s language and searches', async () => {
      const es = (await owner.agent.get('/api/v1/help?q=contraseña').set('accept-language', 'es').expect(200)).body as Help;
      expect(es.faqs.find((q) => q.id === 'account.password')?.question).toBe('Olvidé mi contraseña. ¿Qué hago?');
      expect(es.categories.find((c) => c.id === 'start')?.title).toBe('Primeros pasos');
      expect(es.results?.[0]).toEqual({ kind: 'faq', id: 'account.password' });
      const none = (await api(owner).get('/help?q=zzqqxx').expect(200)).body as Help;
      expect(none.results).toEqual([]);
    });

    it('needs a signed-in person', async () => {
      await request(app.getHttpServer()).get('/api/v1/help').expect(401);
    });
  });

  describe('raising a query', () => {
    let ticketId: string;

    it('numbers each organisation’s tickets and records who raised it, from where', async () => {
      const t = (
        await api(executive)
          .post('/support/tickets', { subject: 'How do I export RFQs?', body: 'I need last month’s RFQs in Excel for a client.', category: 'data', featureKey: 'rfqs', priority: 'HIGH', pagePath: '/app/rfqs' })
          .expect(201)
      ).body;
      expect(t).toMatchObject({ number: 1, status: 'OPEN', handlerLevel: 'CONSOLE', priority: 'HIGH', category: 'data', featureKey: 'rfqs', pagePath: '/app/rfqs', source: 'web', mine: true, canReply: true, messageCount: 1 });
      expect(t.raisedBy.name).toBe('Amit Executive');
      expect(t.messages).toEqual([expect.objectContaining({ authorKind: 'USER', mine: true, body: 'I need last month’s RFQs in Excel for a client.' })]);
      ticketId = t.id;
      const second = (await api(member).post('/support/tickets', { subject: 'Seat question', body: 'Can we add two seats?' }).expect(201)).body;
      expect(second).toMatchObject({ number: 2, category: 'other', priority: 'NORMAL' });
      // Another organisation starts at 1.
      expect((await api(outsider).post('/support/tickets', { subject: 'Hello there', body: 'First question here.' }).expect(201)).body.number).toBe(1);
      const stored = await db.supportTicket.findFirst({ where: { id: ticketId } });
      expect(stored).toMatchObject({ workspaceNodeId: expect.any(String), raisedByUserId: executive.userId, handlerNodeId: null });
      const audit = await db.auditLog.findFirst({ where: { tenantId: owner.tenantId, action: 'support_ticket.raised', entityId: ticketId } });
      expect(audit?.metadata).toMatchObject({ number: 1, category: 'data', priority: 'HIGH' });
    });

    it('checks what is sent', async () => {
      const bad = await api(member).post('/support/tickets', { subject: 'x', body: '' }).expect(400);
      expect(bad.body.error.code).toBe('VALIDATION_FAILED');
      await api(member).post('/support/tickets', { subject: 'Valid subject', body: 'Valid body text', featureKey: 'not_a_feature' }).expect(400);
      await api(member).post('/support/tickets', { subject: 'Valid subject', body: 'Valid body text', pagePath: 'https://evil.test' }).expect(400);
    });

    it('shows people their own tickets, managers their branch and Super admins everyone', async () => {
      const mine = (await api(executive).get('/support/tickets').expect(200)).body as { number: number }[];
      expect(mine.map((t) => t.number)).toEqual([1]);
      expect(((await api(member).get('/support/tickets').expect(200)).body as { number: number }[]).map((t) => t.number)).toEqual([2]);
      // The manager sees their executive's ticket with scope=team, read-only.
      const team = (await api(manager).get('/support/tickets?scope=team').expect(200)).body as { number: number; mine: boolean }[];
      expect(team.map((t) => t.number)).toEqual([1]);
      const asManager = (await api(manager).get(`/support/tickets/${ticketId}`).expect(200)).body;
      expect(asManager).toMatchObject({ mine: false, canReply: false });
      await api(manager).post(`/support/tickets/${ticketId}/messages`, { body: 'Let me try' }).expect(403);
      // The owner manages members in the Super Workspace, so sees the whole organisation.
      expect(((await api(owner).get('/support/tickets?scope=team').expect(200)).body as { number: number }[]).map((t) => t.number).sort()).toEqual([1, 2]);
      // A plain member does not see a colleague's ticket, and nobody sees another organisation's.
      await api(member).get(`/support/tickets/${ticketId}`).expect(404);
      await api(outsider).get(`/support/tickets/${ticketId}`).expect(404);
      expect(((await api(outsider).get('/support/tickets?scope=team').expect(200)).body as unknown[]).length).toBe(1);
    });

    it('lets the Console answer, notifies the raiser and reopens when they write again', async () => {
      const counts = (await opGet('/counts').expect(200)).body;
      expect(counts.open).toBeGreaterThanOrEqual(3);
      const list = (await opGet(`?tenantId=${owner.tenantId}`).expect(200)).body as { id: string; tenant: { name: string }; workspace: { level: string; name: string } }[];
      const row = list.find((t) => t.id === ticketId)!;
      expect(row.tenant.name).toBe('Help Client');
      expect(row.workspace).toEqual({ level: 'EXECUTIVE', name: 'Amit Desk' });
      expect(((await opGet('?q=%231').expect(200)).body as { number: number }[]).every((t) => t.number === 1)).toBe(true);
      expect(((await opGet('?q=export').expect(200)).body as { id: string }[]).map((t) => t.id)).toContain(ticketId);

      const answered = (await opPost(`/${ticketId}/messages`, { body: 'Open RFQs, filter by last month and choose Export.' }).expect(201)).body;
      expect(answered.status).toBe('ANSWERED');
      expect(answered.messages.at(-1)).toMatchObject({ authorKind: 'OPERATOR', mine: true, author: { name: 'Priya (Support)' } });

      // The person sees one support desk, not the operator's name, and gets a notification in their language.
      const seen = (await api(executive).get(`/support/tickets/${ticketId}`).expect(200)).body;
      expect(seen.status).toBe('ANSWERED');
      expect(seen.messages.at(-1)).toMatchObject({ authorKind: 'OPERATOR', mine: false, author: { id: 'support', name: 'SampForce support' } });
      expect(seen.lastAuthorKind).toBe('OPERATOR');
      const notes = (await executive.agent.get('/api/v1/notifications').set('accept-language', 'de').expect(200)).body.items as { type: string; title: string; link: string }[];
      expect(notes.find((n) => n.type === 'support.reply')).toMatchObject({ title: 'Der SampForce-Support hat auf Anfrage #1 geantwortet', link: `/app/help/queries?ticket=${ticketId}` });

      const back = (await api(executive).post(`/support/tickets/${ticketId}/messages`, { body: 'Thanks, one more thing: can it include IR?' }).expect(201)).body;
      expect(back).toMatchObject({ status: 'OPEN', messageCount: 3 });
      const log = await db.platformAuditLog.findFirst({ where: { action: 'support_ticket.answered', targetTenantId: owner.tenantId } });
      expect(log?.metadata).toMatchObject({ ticketId });
      expect(await db.auditLog.count({ where: { tenantId: owner.tenantId, action: 'support_ticket.answered', entityId: ticketId } })).toBe(1);
    });

    it('lets the raiser close or reopen, and only the Console set other statuses', async () => {
      await api(executive).patch(`/support/tickets/${ticketId}`, { status: 'ANSWERED' }).expect(403);
      expect((await api(executive).patch(`/support/tickets/${ticketId}`, { status: 'CLOSED' }).expect(200)).body.status).toBe('CLOSED');
      expect((await api(executive).patch(`/support/tickets/${ticketId}`, { status: 'OPEN' }).expect(200)).body.status).toBe('OPEN');
      expect((await opPatch(`/${ticketId}`, { status: 'IN_PROGRESS' }).expect(200)).body.status).toBe('IN_PROGRESS');
      expect((await opPatch(`/${ticketId}`, { status: 'CLOSED' }).expect(200)).body.status).toBe('CLOSED');
      const notes = (await api(executive).get('/notifications').expect(200)).body.items as { type: string }[];
      expect(notes.some((n) => n.type === 'support.closed')).toBe(true);
      expect(await db.auditLog.count({ where: { tenantId: owner.tenantId, action: 'support_ticket.status_changed', entityId: ticketId } })).toBe(4);
    });

    it('keeps the Console inbox behind an operator session', async () => {
      await request(app.getHttpServer()).get('/api/v1/operator/support/tickets').expect(401);
      await owner.agent.get('/api/v1/operator/support/tickets').expect(401);
      await opGet(`/${randomUUID()}`).expect(404);
    });
  });
});
