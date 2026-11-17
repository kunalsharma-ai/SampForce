import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PasswordService } from '../src/auth/password.service';
import { api, appClient, asTenant, inviteMember, ORIGIN, registerUser, startApp, type TestUser } from './helpers';

const OP_SECRET = 'operator-secret-that-is-at-least-32-chars';
const cid = () => randomUUID();

/** Cookies of a fresh sign-in, for raw HTTP clients (the live stream). */
async function cookiesOf(app: INestApplication, path: string, body: object): Promise<string> {
  const res = await request(app.getHttpServer()).post(`/api/v1${path}`).set('origin', ORIGIN).send(body).expect(200);
  return (res.headers['set-cookie'] as unknown as string[]).map((c) => c.split(';')[0]).join('; ');
}

/** Reads Server-Sent Events from a running server until `want` matches one, or times out. */
async function nextEvent(port: number, path: string, cookie: string, act: () => Promise<unknown>, want: (e: Record<string, unknown>) => boolean, ms = 6000): Promise<Record<string, unknown>> {
  const ac = new AbortController();
  const res = await fetch(`http://127.0.0.1:${port}/api/v1${path}`, { headers: { cookie }, signal: ac.signal });
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toMatch(/text\/event-stream/);
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let acted = false;
  const timer = setTimeout(() => ac.abort(), ms);
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) throw new Error('stream ended');
      buf += decoder.decode(value, { stream: true });
      let i: number;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const data = chunk.split('\n').find((l) => l.startsWith('data: '));
        if (!data) continue;
        const e = JSON.parse(data.slice(6)) as Record<string, unknown>;
        if (e.type === 'ready' && !acted) {
          acted = true;
          await act();
          continue;
        }
        if (want(e)) return e;
      }
    }
  } finally {
    clearTimeout(timer);
    ac.abort();
  }
}

/** Team chat (ADR 0061): direct messages, channels, the support line with super admins, files, search and live delivery. */
describe('team chat', () => {
  let app: INestApplication;
  let owner: TestUser;
  let rep: TestUser & { userId: string };
  let analyst: TestUser & { userId: string };
  let outsider: TestUser;
  let ownerId: string;
  let ops: ReturnType<typeof request.agent>;
  let opsId: string;
  const opsEmail = `chat-ops-${randomUUID().slice(0, 8)}@platform.test`;
  const opsPassword = 'operator-password-1';
  let channelId: string;

  beforeAll(async () => {
    process.env.OPERATOR_JWT_SECRET = OP_SECRET;
    app = await startApp();
    owner = await registerUser(app, 'Frequent Research Fieldwork Solutions');
    rep = await inviteMember(app, owner, 'member');
    analyst = await inviteMember(app, owner, 'member');
    outsider = await registerUser(app, 'Elsewhere Ltd');
    ownerId = ((await api(owner).get('/auth/me').expect(200)).body as { user: { id: string } }).user.id;
    const db = appClient();
    const op = await db.platformOperator.create({ data: { email: opsEmail, name: 'Kunal (Super admin)', passwordHash: await new PasswordService().hash(opsPassword), role: 'ADMIN' } });
    opsId = op.id;
    await db.$disconnect();
    ops = request.agent(app.getHttpServer());
    await ops.post('/api/v1/operator/login').set('origin', ORIGIN).send({ email: opsEmail, password: opsPassword }).expect(200);
  });
  afterAll(async () => {
    await app.close();
    delete process.env.OPERATOR_JWT_SECRET;
  });

  const opPost = (url: string, body: object = {}) => ops.post(`/api/v1/operator/chat${url}`).set('origin', ORIGIN).send(body);
  const opGet = (url: string) => ops.get(`/api/v1/operator/chat${url}`);

  it('starts one direct message per pair and refuses people from other workspaces', async () => {
    const a = (await api(rep).post('/chat/conversations', { kind: 'DIRECT', userId: analyst.userId }).expect(201)).body;
    const b = (await api(analyst).post('/chat/conversations', { kind: 'DIRECT', userId: rep.userId }).expect(201)).body;
    expect(b.id).toBe(a.id);
    expect(a).toMatchObject({ kind: 'DIRECT', title: 'Member member', unread: 0, canManage: false });
    expect(a.members.map((m: { person: { id: string } }) => m.person.id).sort()).toEqual([rep.userId, analyst.userId].sort());
    const outsiderId = ((await api(outsider).get('/auth/me').expect(200)).body as { user: { id: string } }).user.id;
    const bad = await api(rep).post('/chat/conversations', { kind: 'DIRECT', userId: outsiderId }).expect(400);
    expect(bad.body.error.details[0].path).toBe('userId');
    await api(rep).post('/chat/conversations', { kind: 'DIRECT', userId: rep.userId }).expect(400);
    // Nobody outside the conversation, even an admin of the workspace, can read it.
    await api(owner).get(`/chat/conversations/${a.id}/messages`).expect(404);
    await api(outsider).get(`/chat/conversations/${a.id}`).expect(404);
  });

  it('sends messages once, even when an outbox sends them again, and counts unread until read', async () => {
    const ch = (await api(owner).post('/chat/conversations', { kind: 'CHANNEL', name: 'Project updates', topic: 'Fieldwork status for every project', memberIds: [rep.userId, analyst.userId] }).expect(201)).body;
    channelId = ch.id;
    expect(ch).toMatchObject({ kind: 'CHANNEL', title: 'Project updates', canManage: true });
    expect(ch.members.find((m: { person: { id: string } }) => m.person.id === ownerId).role).toBe('OWNER');

    const clientId = cid();
    const first = (await api(owner).post(`/chat/conversations/${channelId}/messages`, { clientId, body: 'India B2B fieldwork starts Monday.' }).expect(201)).body;
    const again = (await api(owner).post(`/chat/conversations/${channelId}/messages`, { clientId, body: 'India B2B fieldwork starts Monday.' }).expect(201)).body;
    expect(again.id).toBe(first.id);
    // Two copies racing each other still store one message.
    const raceId = cid();
    const race = await Promise.all([1, 2].map(() => api(rep).post(`/chat/conversations/${channelId}/messages`, { clientId: raceId, body: 'On it.' })));
    expect(race.map((r) => r.status)).toEqual([201, 201]);
    expect(race[0]!.body.id).toBe(race[1]!.body.id);
    // Someone else cannot reuse the id.
    await api(analyst).post(`/chat/conversations/${channelId}/messages`, { clientId, body: 'x' }).expect(400);
    await api(analyst).post(`/chat/conversations/${channelId}/messages`, { clientId: cid(), body: '   ' }).expect(400);

    const list = (await api(analyst).get(`/chat/conversations/${channelId}/messages`).expect(200)).body;
    expect(list.map((m: { body: string }) => m.body)).toEqual(['India B2B fieldwork starts Monday.', 'On it.']);
    expect(list[0].author).toMatchObject({ id: ownerId, operator: false });

    const before = (await api(analyst).get('/chat/unread').expect(200)).body;
    expect(before).toEqual({ total: 2, conversations: 1 });
    const convs = (await api(analyst).get('/chat/conversations').expect(200)).body;
    expect(convs[0]).toMatchObject({ id: channelId, unread: 2, lastMessagePreview: 'On it.' });
    // The sender's own messages are not unread for them.
    expect((await api(owner).get(`/chat/conversations/${channelId}`).expect(200)).body.unread).toBe(1);

    // Reading clears the count, and the others see the read receipt.
    const read = (await api(analyst).post(`/chat/conversations/${channelId}/read`, {}).expect(200)).body;
    expect(read.lastReadAt).toBe(list[1].createdAt);
    expect((await api(analyst).get('/chat/unread').expect(200)).body).toEqual({ total: 0, conversations: 0 });
    const seen = (await api(owner).get(`/chat/conversations/${channelId}`).expect(200)).body;
    expect(seen.members.find((m: { person: { id: string } }) => m.person.id === analyst.userId).lastReadAt).toBe(list[1].createdAt);

    // Paging back and catching up after a reconnect.
    const older = (await api(analyst).get(`/chat/conversations/${channelId}/messages?before=${list[1].id}`).expect(200)).body;
    expect(older.map((m: { id: string }) => m.id)).toEqual([list[0].id]);
    const newer = (await api(analyst).get(`/chat/conversations/${channelId}/messages?after=${encodeURIComponent(list[0].createdAt)}`).expect(200)).body;
    expect(newer.map((m: { id: string }) => m.id)).toEqual([list[1].id]);
  });

  it('keeps when a queued message was written, but not a time in the future or long ago', async () => {
    const writtenAt = new Date(Date.now() - 20 * 60_000).toISOString();
    const queued = (await api(rep).post(`/chat/conversations/${channelId}/messages`, { clientId: cid(), body: 'Written while the office network was down.', writtenAt }).expect(201)).body;
    expect(queued.writtenAt).toBe(writtenAt);
    const future = (await api(rep).post(`/chat/conversations/${channelId}/messages`, { clientId: cid(), body: 'From the future', writtenAt: new Date(Date.now() + 3_600_000).toISOString() }).expect(201)).body;
    expect(future.writtenAt).toBeNull();
    const ancient = (await api(rep).post(`/chat/conversations/${channelId}/messages`, { clientId: cid(), body: 'Ancient', writtenAt: new Date(Date.now() - 30 * 86_400_000).toISOString() }).expect(201)).body;
    expect(ancient.writtenAt).toBeNull();
  });

  it('sends files, which only people in the conversation can open', async () => {
    const up = await rep.agent.post(`/api/v1/chat/conversations/${channelId}/attachments?name=${encodeURIComponent('Quota sheet.csv')}`).set('origin', ORIGIN).set('content-type', 'text/csv').send(Buffer.from('market,n\nIN,400\n'));
    expect(up.status).toBe(201);
    const file = up.body;
    expect(file).toMatchObject({ name: 'Quota sheet.csv', contentType: 'text/csv', sizeBytes: 16 });
    // Before it is sent, only the uploader can open it, and nobody else can send it.
    await api(analyst).get(`/chat/attachments/${file.id}/download`).expect(404);
    await api(analyst).post(`/chat/conversations/${channelId}/messages`, { clientId: cid(), body: 'mine now', attachmentIds: [file.id] }).expect(400);
    const msg = (await api(rep).post(`/chat/conversations/${channelId}/messages`, { clientId: cid(), body: '', attachmentIds: [file.id] }).expect(201)).body;
    expect(msg.attachments).toEqual([file]);
    const dl = await api(analyst).get(`/chat/attachments/${file.id}/download`).expect(200);
    expect(dl.headers['content-disposition']).toContain('Quota sheet.csv');
    expect(dl.text ?? dl.body.toString()).toContain('IN,400');
    await api(outsider).get(`/chat/attachments/${file.id}/download`).expect(404);
    expect((await api(owner).get(`/chat/conversations/${channelId}`).expect(200)).body.lastMessagePreview).toBe('Quota sheet.csv');
    await rep.agent.post(`/api/v1/chat/conversations/${channelId}/attachments?name=empty.txt`).set('origin', ORIGIN).set('content-type', 'text/plain').send(Buffer.alloc(0)).expect(400);

    // Deleting the message deletes its file.
    await api(rep).del(`/chat/messages/${msg.id}`).expect(204);
    await api(analyst).get(`/chat/attachments/${file.id}/download`).expect(404);
    const after = (await api(analyst).get(`/chat/conversations/${channelId}/messages`).expect(200)).body.find((m: { id: string }) => m.id === msg.id);
    expect(after).toMatchObject({ deleted: true, body: '', attachments: [] });
  });

  it('links messages and channels to companies, RFQs and deals people can see', async () => {
    const lead = (await api(owner).post('/company-leads', { company: { name: 'Acme Panels', country: 'IN' }, employees: [{ firstName: 'Priya' }] }).expect(201)).body;
    const companyId = lead.company.id as string;
    const rfq = (await api(owner).post('/rfqs', { companyId, projectName: 'India B2B tracker', currency: 'USD' }).expect(201)).body;
    const pipelines = (await api(owner).get('/pipelines').expect(200)).body;
    const deal = (await api(owner).post('/deals', { name: 'Acme India tracker', pipelineId: pipelines[0].id, stageId: pipelines[0].stages[0].id, amount: 12000, currency: 'USD' }).expect(201)).body;

    const options = (await api(owner).get('/chat/link-options?q=acme').expect(200)).body;
    expect(options.map((o: { type: string }) => o.type).sort()).toEqual(['COMPANY', 'DEAL']);
    expect((await api(owner).get('/chat/link-options?q=tracker').expect(200)).body.map((o: { type: string }) => o.type).sort()).toEqual(['DEAL', 'RFQ']);

    const m1 = (await api(owner).post(`/chat/conversations/${channelId}/messages`, { clientId: cid(), body: 'Priya asked for the feasibility.', link: { type: 'COMPANY', id: companyId } }).expect(201)).body;
    expect(m1.link).toEqual({ type: 'COMPANY', id: companyId, label: `${lead.company.leadNumber} Acme Panels`, href: `/app/companies/${companyId}` });
    const m2 = (await api(owner).post(`/chat/conversations/${channelId}/messages`, { clientId: cid(), body: 'RFQ is in.', link: { type: 'RFQ', id: rfq.id } }).expect(201)).body;
    expect(m2.link).toMatchObject({ type: 'RFQ', label: `${rfq.number} India B2B tracker`, href: `/app/rfqs?open=${rfq.id}` });
    const m3 = (await api(owner).post(`/chat/conversations/${channelId}/messages`, { clientId: cid(), body: '', link: { type: 'DEAL', id: deal.id } }).expect(201)).body;
    expect(m3.link).toMatchObject({ type: 'DEAL', label: 'Acme India tracker' });
    const bad = await api(owner).post(`/chat/conversations/${channelId}/messages`, { clientId: cid(), body: 'x', link: { type: 'COMPANY', id: randomUUID() } }).expect(400);
    expect(bad.body.error.details[0].path).toBe('link');

    const linked = (await api(owner).post('/chat/conversations', { kind: 'CHANNEL', name: 'Acme India', memberIds: [rep.userId], link: { type: 'DEAL', id: deal.id } }).expect(201)).body;
    expect(linked.link).toMatchObject({ type: 'DEAL', id: deal.id, label: 'Acme India tracker' });
  });

  it('searches only the conversations you are in', async () => {
    await api(rep).post(`/chat/conversations/${(await api(rep).post('/chat/conversations', { kind: 'DIRECT', userId: analyst.userId }).expect(201)).body.id}/messages`, { clientId: cid(), body: 'Private note about the feasibility budget' }).expect(201);
    const hits = (await api(owner).get('/chat/search?q=FEASIBILITY').expect(200)).body;
    expect(hits.map((h: { message: { body: string } }) => h.message.body)).toEqual(['Priya asked for the feasibility.']);
    expect(hits[0].conversation).toMatchObject({ id: channelId, title: 'Project updates', kind: 'CHANNEL' });
    const repHits = (await api(rep).get('/chat/search?q=feasibility').expect(200)).body;
    expect(repHits).toHaveLength(2);
    expect((await api(outsider).get('/chat/search?q=feasibility').expect(200)).body).toEqual([]);
    await api(rep).get('/chat/search?q=a').expect(400);
    // A link's name is searchable too.
    expect((await api(owner).get('/chat/search?q=Acme%20India').expect(200)).body.map((h: { message: { link: { type: string } } }) => h.message.link?.type)).toContain('DEAL');
  });

  it('lets authors edit their messages and channel owners manage the channel', async () => {
    const m = (await api(rep).post(`/chat/conversations/${channelId}/messages`, { clientId: cid(), body: 'Fieldwork 40% done' }).expect(201)).body;
    await api(analyst).patch(`/chat/messages/${m.id}`, { body: 'hacked' }).expect(403);
    const edited = (await api(rep).patch(`/chat/messages/${m.id}`, { body: 'Fieldwork 45% done' }).expect(200)).body;
    expect(edited).toMatchObject({ body: 'Fieldwork 45% done' });
    expect(edited.editedAt).not.toBeNull();
    await api(analyst).del(`/chat/messages/${m.id}`).expect(403);

    await api(rep).patch(`/chat/conversations/${channelId}`, { name: 'Renamed' }).expect(403);
    await api(rep).post(`/chat/conversations/${channelId}/members`, { userIds: [analyst.userId] }).expect(403);
    const viewer = await inviteMember(app, owner, 'viewer');
    const added = (await api(owner).post(`/chat/conversations/${channelId}/members`, { userIds: [viewer.userId] }).expect(201)).body;
    expect(added.members.map((x: { person: { id: string } }) => x.person.id)).toContain(viewer.userId);
    // Anyone can leave; then the channel is gone for them.
    await api(viewer).del(`/chat/conversations/${channelId}/members/${viewer.userId}`).expect(204);
    await api(viewer).get(`/chat/conversations/${channelId}`).expect(404);

    const ch = (await api(rep).post('/chat/conversations', { kind: 'CHANNEL', name: 'Short-lived', memberIds: [analyst.userId] }).expect(201)).body;
    await api(rep).patch(`/chat/conversations/${ch.id}`, { archived: true }).expect(200);
    await api(analyst).post(`/chat/conversations/${ch.id}/messages`, { clientId: cid(), body: 'too late' }).expect(403);
    expect((await api(analyst).get('/chat/conversations').expect(200)).body.map((c: { id: string }) => c.id)).not.toContain(ch.id);
    expect((await api(analyst).get('/chat/conversations?archived=true').expect(200)).body.map((c: { id: string }) => c.id)).toContain(ch.id);
  });

  it('gives each workspace a support line between its admins and the super admins', async () => {
    // The owner (an admin) has it; a member does not.
    const mine = (await api(owner).get('/chat/conversations').expect(200)).body;
    const support = mine.find((c: { kind: string }) => c.kind === 'SUPPORT');
    expect(support).toMatchObject({ title: 'SampForce support', canManage: true });
    expect((await api(rep).get('/chat/conversations').expect(200)).body.some((c: { kind: string }) => c.kind === 'SUPPORT')).toBe(false);
    await api(owner).del(`/chat/conversations/${support.id}/members/${ownerId}`).expect(403);

    await api(owner).post(`/chat/conversations/${support.id}/messages`, { clientId: cid(), body: 'Please raise our seat limit to 25.' }).expect(201);
    // The super admin sees it in the console, with the workspace name and an unread count.
    const lines = (await opGet('/conversations').expect(200)).body;
    const line = lines.find((c: { id: string }) => c.id === support.id);
    expect(line).toMatchObject({ kind: 'SUPPORT', workspace: 'Frequent Research Fieldwork Solutions', unread: 1 });
    expect((await opGet('/unread').expect(200)).body.total).toBeGreaterThanOrEqual(1);
    const thread = (await opGet(`/conversations/${support.id}/messages`).expect(200)).body;
    expect(thread.at(-1)).toMatchObject({ body: 'Please raise our seat limit to 25.', author: { id: ownerId, operator: false } });
    const reply = (await opPost(`/conversations/${support.id}/messages`, { clientId: cid(), body: 'Done: you now have 25 seats.' }).expect(201)).body;
    expect(reply.author).toEqual({ id: opsId, name: 'Kunal (Super admin)', operator: true });
    await opPost(`/conversations/${support.id}/read`).expect(200);
    expect((await opGet('/conversations').expect(200)).body.find((c: { id: string }) => c.id === support.id).unread).toBe(0);
    // Super admins cannot link workspace records, and cannot open the workspace's other conversations.
    await opPost(`/conversations/${support.id}/messages`, { clientId: cid(), body: 'x', link: { type: 'DEAL', id: randomUUID() } }).expect(400);
    await opGet(`/conversations/${channelId}/messages`).expect(404);

    // The owner sees the reply as unread, from a super admin.
    const back = (await api(owner).get(`/chat/conversations/${support.id}/messages`).expect(200)).body;
    expect(back.at(-1)).toMatchObject({ body: 'Done: you now have 25 seats.', author: { operator: true } });
    expect((await api(owner).get(`/chat/conversations/${support.id}`).expect(200)).body.unread).toBe(1);
    // An admin can bring someone else onto the support line.
    await api(owner).post(`/chat/conversations/${support.id}/members`, { userIds: [rep.userId] }).expect(201);
    expect((await api(rep).get('/chat/conversations').expect(200)).body.some((c: { id: string }) => c.id === support.id)).toBe(true);

    // A super admin can open the line of a workspace nobody has written from yet.
    const fresh = (await opPost(`/workspaces/${outsider.tenantId}/support`).expect(200)).body;
    expect(fresh).toMatchObject({ kind: 'SUPPORT', workspace: 'Elsewhere Ltd' });
    await opPost(`/conversations/${fresh.id}/messages`, { clientId: cid(), body: 'Welcome to SampForce!' }).expect(201);
    const theirs = (await api(outsider).get('/chat/conversations').expect(200)).body;
    expect(theirs.find((c: { id: string }) => c.id === fresh.id).unread).toBe(1);
    // Without an operator session there is no console chat.
    await request(app.getHttpServer()).get('/api/v1/operator/chat/conversations').expect(401);
  });

  it('is controlled by the team_chat plan feature', async () => {
    await asTenant(outsider.tenantId, (tx) => tx.tenantFeatureOverride.create({ data: { tenantId: outsider.tenantId, feature: 'team_chat', enabled: false, reason: 'test', updatedBy: 'test' } }));
    const off = await api(outsider).get('/chat/conversations').expect(403);
    expect(off.body.error.code).toBe('FEATURE_NOT_IN_PLAN');
    expect((await opGet('/conversations').expect(200)).body.some((c: { workspace: string }) => c.workspace === 'Elsewhere Ltd')).toBe(false);
    await opPost(`/workspaces/${outsider.tenantId}/support`).expect(403);
    await asTenant(outsider.tenantId, (tx) => tx.tenantFeatureOverride.deleteMany({ where: { tenantId: outsider.tenantId } }));
    await api(outsider).get('/chat/conversations').expect(200);
  });

  it('delivers live events on the stream, from this server and from another server', async () => {
    const server = app.getHttpServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    const analystCookie = await cookiesOf(app, '/auth/login', { email: analyst.email, password: analyst.password });

    const e = await nextEvent(port, '/chat/stream', analystCookie, () => api(owner).post(`/chat/conversations/${channelId}/messages`, { clientId: cid(), body: 'Live!' }).expect(201), (x) => x.type === 'message');
    expect(e).toMatchObject({ type: 'message', conversationId: channelId, authorId: ownerId });
    // The stream names what changed; it carries no message text.
    expect(JSON.stringify(e)).not.toContain('Live!');
    const r = await nextEvent(port, '/chat/stream', analystCookie, () => api(rep).post(`/chat/conversations/${channelId}/read`, {}).expect(200), (x) => x.type === 'read');
    expect(r).toMatchObject({ conversationId: channelId, personId: rep.userId });
    // People outside the workspace get nothing about it: an outsider's stream only opens.
    await request(server).get('/api/v1/chat/stream').expect(401);

    // A second API server (as in a cluster) relays what the first one wrote.
    process.env.CHAT_RELAY_MS = '200';
    const other = await startApp();
    const otherServer = other.getHttpServer();
    await new Promise<void>((resolve) => otherServer.listen(0, '127.0.0.1', resolve));
    const otherPort = (otherServer.address() as AddressInfo).port;
    try {
      const relayed = await nextEvent(otherPort, '/chat/stream', analystCookie, () => api(rep).post(`/chat/conversations/${channelId}/messages`, { clientId: cid(), body: 'Via the first server' }).expect(201), (x) => x.type === 'message' && x.authorId === rep.userId);
      expect(relayed).toMatchObject({ conversationId: channelId });
      // Super admins get support line events on their own stream.
      const opCookie = await cookiesOf(app, '/operator/login', { email: opsEmail, password: opsPassword });
      const supportId = (await api(owner).get('/chat/conversations').expect(200)).body.find((c: { kind: string }) => c.kind === 'SUPPORT').id;
      const forOps = await nextEvent(otherPort, '/operator/chat/stream', opCookie, () => api(owner).post(`/chat/conversations/${supportId}/messages`, { clientId: cid(), body: 'Anyone there?' }).expect(201), (x) => x.type === 'message');
      expect(forOps).toMatchObject({ conversationId: supportId });
    } finally {
      await other.close();
      delete process.env.CHAT_RELAY_MS;
    }
  });
});
