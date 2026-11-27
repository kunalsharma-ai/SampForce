import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { WebSocket } from 'ws';
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

type Ev = Record<string, unknown>;

/** A live chat WebSocket opened the way the browser does: ticket over the API, then the socket. */
async function openSocket(port: number, realm: 'user' | 'operator', cookie: string, origin = ORIGIN): Promise<{ ws: WebSocket; events: Ev[]; next: (want: (e: Ev) => boolean, ms?: number) => Promise<Ev>; closed: Promise<number> }> {
  const base = realm === 'user' ? '/chat' : '/operator/chat';
  const t = await fetch(`http://127.0.0.1:${port}/api/v1${base}/socket-ticket`, { method: 'POST', headers: { cookie, origin: ORIGIN } });
  expect(t.status).toBe(200);
  const { ticket, path } = (await t.json()) as { ticket: string; path: string };
  const ws = new WebSocket(`ws://127.0.0.1:${port}${path}?ticket=${encodeURIComponent(ticket)}`, { headers: { origin } });
  const events: Ev[] = [];
  const waiters: { want: (e: Ev) => boolean; resolve: (e: Ev) => void }[] = [];
  ws.on('message', (raw) => {
    const e = JSON.parse(String(raw)) as Ev;
    events.push(e);
    for (const w of [...waiters]) if (w.want(e)) {
      waiters.splice(waiters.indexOf(w), 1);
      w.resolve(e);
    }
  });
  const closed = new Promise<number>((resolve) => ws.on('close', (code) => resolve(code)));
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
  const next = (want: (e: Ev) => boolean, ms = 6000) =>
    new Promise<Ev>((resolve, reject) => {
      const had = events.find(want);
      if (had) return resolve(had);
      const timer = setTimeout(() => reject(new Error(`no matching event; got ${JSON.stringify(events)}`)), ms);
      waiters.push({ want, resolve: (e) => (clearTimeout(timer), resolve(e)) });
    });
  await next((e) => e.type === 'ready');
  return { ws, events, next, closed };
}

/** Status of a WebSocket upgrade that the server refuses. */
function refusedWith(url: string, origin = ORIGIN): Promise<number> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { headers: { origin } });
    ws.on('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
    ws.on('open', () => reject(new Error('socket opened')));
    ws.on('error', () => undefined);
  });
}

/** Team chat (ADR 0064): direct messages, channels, the support line with super admins, files, search and live delivery. */
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

  it('keeps team chat to text and emoji: no files, no record links; the support line still takes files', async () => {
    // Redesign R9: direct messages and channels refuse files and links, with a clear reason.
    const up = await rep.agent.post(`/api/v1/chat/conversations/${channelId}/attachments?name=${encodeURIComponent('Quota sheet.csv')}`).set('origin', ORIGIN).set('content-type', 'text/csv').send(Buffer.from('market,n\nIN,400\n'));
    expect(up.status).toBe(400);
    expect(up.body.error.code).toBe('CHAT_TEXT_ONLY');
    const lead = (await api(owner).post('/company-leads', { company: { name: 'Acme Panels', country: 'IN' }, employees: [{ firstName: 'Priya' }] }).expect(201)).body;
    const linked = await api(owner).post(`/chat/conversations/${channelId}/messages`, { clientId: cid(), body: 'See this', link: { type: 'COMPANY', id: lead.company.id } }).expect(400);
    expect(linked.body.error).toMatchObject({ code: 'CHAT_TEXT_ONLY', details: [{ path: 'link' }] });
    await api(owner).post(`/chat/conversations/${channelId}/messages`, { clientId: cid(), body: 'x', attachmentIds: [randomUUID()] }).expect(400);
    expect((await api(owner).post('/chat/conversations', { kind: 'CHANNEL', name: 'Acme India', memberIds: [rep.userId], link: { type: 'COMPANY', id: lead.company.id } }).expect(400)).body.error.code).toBe('CHAT_TEXT_ONLY');
    await api(owner).post(`/chat/conversations/${channelId}/messages`, { clientId: cid(), body: 'Priya asked for the feasibility.' }).expect(201);

    // A file sent before R9 stays stored: workspace admins still see and open it, others no longer do.
    const old = (await api(rep).post(`/chat/conversations/${channelId}/messages`, { clientId: cid(), body: 'Old sheet' }).expect(201)).body;
    const stored = await asTenant(owner.tenantId, (tx) =>
      tx.chatAttachment.create({ data: { tenantId: owner.tenantId, conversationId: channelId, messageId: old.id, name: 'Old.csv', contentType: 'text/csv', sizeBytes: 3, data: new Uint8Array(Buffer.from('a,b')), sha256: 'x', uploadedByUserId: rep.userId } }),
    );
    const asAnalyst = (await api(analyst).get(`/chat/conversations/${channelId}/messages`).expect(200)).body.find((m: { id: string }) => m.id === old.id);
    expect(asAnalyst.attachments).toEqual([]);
    await api(analyst).get(`/chat/attachments/${stored.id}/download`).expect(404);
    const asOwner = (await api(owner).get(`/chat/conversations/${channelId}/messages`).expect(200)).body.find((m: { id: string }) => m.id === old.id);
    expect(asOwner.attachments.map((f: { name: string }) => f.name)).toEqual(['Old.csv']);
    await api(owner).get(`/chat/attachments/${stored.id}/download`).expect(200);

    // The support line (admins and SampForce support) still takes files.
    const support = (await api(owner).get('/chat/conversations').expect(200)).body.find((c: { kind: string }) => c.kind === 'SUPPORT');
    const file = (await owner.agent.post(`/api/v1/chat/conversations/${support.id}/attachments?name=${encodeURIComponent('Screen.png')}`).set('origin', ORIGIN).set('content-type', 'image/png').send(Buffer.from('png')).expect(201)).body;
    const msg = (await api(owner).post(`/chat/conversations/${support.id}/messages`, { clientId: cid(), body: '', attachmentIds: [file.id] }).expect(201)).body;
    expect(msg.attachments).toEqual([file]);
    await api(rep).get(`/chat/attachments/${file.id}/download`).expect(404);
    await owner.agent.post(`/api/v1/chat/conversations/${support.id}/attachments?name=empty.txt`).set('origin', ORIGIN).set('content-type', 'text/plain').send(Buffer.alloc(0)).expect(400);
    // Deleting the message deletes its file.
    await api(owner).del(`/chat/messages/${msg.id}`).expect(204);
    await api(owner).get(`/chat/attachments/${file.id}/download`).expect(404);
  });

  it('takes emoji reactions: one per emoji per person, shown with who reacted, gone with a deleted message', async () => {
    const m = (await api(rep).post(`/chat/conversations/${channelId}/messages`, { clientId: cid(), body: 'Quota done for IN' }).expect(201)).body;
    expect(m.reactions).toEqual([]);
    await api(analyst).put(`/chat/messages/${m.id}/reactions`, { emoji: '👍', on: true }).expect(200);
    await api(analyst).put(`/chat/messages/${m.id}/reactions`, { emoji: '👍', on: true }).expect(200);
    const both = (await api(owner).put(`/chat/messages/${m.id}/reactions`, { emoji: '👍', on: true }).expect(200)).body;
    expect(both.reactions).toEqual([{ emoji: '👍', count: 2, mine: true, names: expect.arrayContaining([expect.any(String)]) }]);
    await api(owner).put(`/chat/messages/${m.id}/reactions`, { emoji: '🎉', on: true }).expect(200);
    await api(owner).put(`/chat/messages/${m.id}/reactions`, { emoji: '🇮🇳', on: true }).expect(200);
    await api(owner).put(`/chat/messages/${m.id}/reactions`, { emoji: '👍🏽', on: true }).expect(200);
    // Text is not an emoji; outsiders cannot react.
    await api(owner).put(`/chat/messages/${m.id}/reactions`, { emoji: 'ok', on: true }).expect(400);
    await api(owner).put(`/chat/messages/${m.id}/reactions`, { emoji: '👍 ok', on: true }).expect(400);
    await api(outsider).put(`/chat/messages/${m.id}/reactions`, { emoji: '👍', on: true }).expect(404);
    const seen = (await api(rep).get(`/chat/conversations/${channelId}/messages`).expect(200)).body.find((x: { id: string }) => x.id === m.id);
    expect(seen.reactions.map((r: { emoji: string; count: number; mine: boolean }) => [r.emoji, r.count, r.mine])).toEqual([['👍', 2, false], ['🎉', 1, false], ['🇮🇳', 1, false], ['👍🏽', 1, false]]);
    // Taking one back.
    const off = (await api(analyst).put(`/chat/messages/${m.id}/reactions`, { emoji: '👍', on: false }).expect(200)).body;
    expect(off.reactions.find((r: { emoji: string }) => r.emoji === '👍')).toMatchObject({ count: 1, mine: false });
    // Deleting the message clears its reactions and refuses new ones.
    await api(rep).del(`/chat/messages/${m.id}`).expect(204);
    const gone = (await api(rep).get(`/chat/conversations/${channelId}/messages`).expect(200)).body.find((x: { id: string }) => x.id === m.id);
    expect(gone).toMatchObject({ deleted: true, body: '', reactions: [] });
    await api(owner).put(`/chat/messages/${m.id}/reactions`, { emoji: '👍', on: true }).expect(400);
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

  it('delivers live events over the WebSocket, from this server and from another server', async () => {
    const server = app.getHttpServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    const analystCookie = await cookiesOf(app, '/auth/login', { email: analyst.email, password: analyst.password });

    const live = await openSocket(port, 'user', analystCookie);
    await api(owner).post(`/chat/conversations/${channelId}/messages`, { clientId: cid(), body: 'Live!' }).expect(201);
    const e = await live.next((x) => x.type === 'message');
    expect(e).toMatchObject({ type: 'message', conversationId: channelId, authorId: ownerId });
    expect(e.sid).toEqual(expect.any(String));
    // Events name what changed; they carry no message text.
    expect(JSON.stringify(e)).not.toContain('Live!');
    await api(rep).post(`/chat/conversations/${channelId}/read`, {}).expect(200);
    expect(await live.next((x) => x.type === 'read')).toMatchObject({ conversationId: channelId, personId: rep.userId });

    // Typing travels both ways: from a socket to the others, and from the catch-up route for browsers without one.
    const repCookie = await cookiesOf(app, '/auth/login', { email: rep.email, password: rep.password });
    const repLive = await openSocket(port, 'user', repCookie);
    repLive.ws.send(JSON.stringify({ type: 'typing', conversationId: channelId }));
    expect(await live.next((x) => x.type === 'typing')).toMatchObject({ conversationId: channelId, personId: rep.userId, name: expect.any(String) });
    await api(owner).post(`/chat/conversations/${channelId}/typing`, {}).expect(204);
    expect(await live.next((x) => x.type === 'typing' && x.personId === ownerId)).toMatchObject({ conversationId: channelId });
    // Not in the conversation, no typing.
    await api(outsider).post(`/chat/conversations/${channelId}/typing`, {}).expect(404);
    // A malformed frame is ignored; the socket stays open and still answers.
    repLive.ws.send('not json');
    repLive.ws.send(JSON.stringify({ type: 'ping' }));
    await repLive.next((x) => x.type === 'pong');

    // Presence: the analyst is online while a socket is open.
    const presence = (await api(owner).get('/chat/presence').expect(200)).body as { userId: string; online: boolean }[];
    expect(presence.find((p) => p.userId === analyst.userId)?.online).toBe(true);
    expect(presence.find((p) => p.userId === ownerId)?.online).toBe(false);

    // Refused: no ticket, a forged ticket, a ticket for the other realm, and a page from another site.
    expect(await refusedWith(`ws://127.0.0.1:${port}/api/v1/chat/socket`)).toBe(401);
    expect(await refusedWith(`ws://127.0.0.1:${port}/api/v1/chat/socket?ticket=eyJhbGciOiJIUzI1NiJ9.e30.x`)).toBe(401);
    const t = (await api(owner).post('/chat/socket-ticket', {}).expect(200)).body as { ticket: string };
    expect(await refusedWith(`ws://127.0.0.1:${port}/api/v1/operator/chat/socket?ticket=${t.ticket}`)).toBe(401);
    expect(await refusedWith(`ws://127.0.0.1:${port}/api/v1/chat/socket?ticket=${t.ticket}`, 'https://evil.example')).toBe(403);
    // Tickets come only from signed-in sessions.
    await request(server).post('/api/v1/chat/socket-ticket').set('origin', ORIGIN).expect(401);

    repLive.ws.close();
    live.ws.close();

    // A second API server (as in a cluster) relays what the first one wrote.
    const other = await startApp();
    const otherServer = other.getHttpServer();
    await new Promise<void>((resolve) => otherServer.listen(0, '127.0.0.1', resolve));
    const otherPort = (otherServer.address() as AddressInfo).port;
    try {
      const far = await openSocket(otherPort, 'user', analystCookie);
      await api(rep).post(`/chat/conversations/${channelId}/messages`, { clientId: cid(), body: 'Via the first server' }).expect(201);
      expect(await far.next((x) => x.type === 'message' && x.authorId === rep.userId && x.conversationId === channelId)).toMatchObject({ conversationId: channelId });
      far.ws.close();
      // Super admins get support line events on their own socket.
      const opCookie = await cookiesOf(app, '/operator/login', { email: opsEmail, password: opsPassword });
      const supportId = (await api(owner).get('/chat/conversations').expect(200)).body.find((c: { kind: string }) => c.kind === 'SUPPORT').id;
      const opLive = await openSocket(otherPort, 'operator', opCookie);
      await api(owner).post(`/chat/conversations/${supportId}/messages`, { clientId: cid(), body: 'Anyone there?' }).expect(201);
      expect(await opLive.next((x) => x.type === 'message')).toMatchObject({ conversationId: supportId });
      // A workspace ticket does not open the operator socket, nor the other way round.
      const opTicket = (await (await fetch(`http://127.0.0.1:${otherPort}/api/v1/operator/chat/socket-ticket`, { method: 'POST', headers: { cookie: opCookie, origin: ORIGIN } })).json()) as { ticket: string };
      expect(await refusedWith(`ws://127.0.0.1:${otherPort}/api/v1/chat/socket?ticket=${opTicket.ticket}`)).toBe(401);
      opLive.ws.close();
    } finally {
      await other.close();
    }
  });

  it('closes a live socket when its session signs out', async () => {
    const server = app.getHttpServer();
    const port = (server.address() as AddressInfo).port;
    const cookie = await cookiesOf(app, '/auth/login', { email: rep.email, password: rep.password });
    const live = await openSocket(port, 'user', cookie);
    await fetch(`http://127.0.0.1:${port}/api/v1/auth/logout`, { method: 'POST', headers: { cookie, origin: ORIGIN } });
    // CHAT_SOCKET_RECHECK_MS is shortened for the tests.
    expect(await live.closed).toBe(4401);
  });

  it('catches up without a WebSocket: events after a cursor, each once, held until one arrives', async () => {
    const first = (await api(analyst).get('/chat/events').expect(200)).body as { events: Ev[]; cursor: string };
    // The first call says "re-read everything".
    expect(first.events).toEqual([{ type: 'ready' }]);
    // Something already waiting is answered at once.
    await api(owner).post(`/chat/conversations/${channelId}/messages`, { clientId: cid(), body: 'Catch up' }).expect(201);
    const a = (await api(analyst).get(`/chat/events?cursor=${encodeURIComponent(first.cursor)}&wait=0`).expect(200)).body as { events: Ev[]; cursor: string };
    const msg = a.events.find((e) => e.type === 'message' && e.authorId === ownerId);
    expect(msg).toMatchObject({ conversationId: channelId, authorId: ownerId, sid: expect.any(String) });
    // Asked again with the ids it has, it gets nothing twice.
    const seen = a.events.map((e) => e.sid).join(',');
    const b = (await api(analyst).get(`/chat/events?cursor=${encodeURIComponent(a.cursor)}&seen=${seen}&wait=0`).expect(200)).body as { events: Ev[]; cursor: string };
    expect(b.events.filter((e) => e.sid === msg!.sid)).toEqual([]);
    // A held request answers as soon as something happens.
    // A held request answers as soon as something happens (other events, such as someone going offline, may come first).
    const seenIds = new Set([...a.events, ...b.events].map((e) => e.sid as string));
    let cursor = b.cursor;
    const started = Date.now();
    setTimeout(() => void api(rep).post(`/chat/conversations/${channelId}/messages`, { clientId: cid(), body: 'While you wait' }).expect(201).then(() => undefined), 500);
    let got = false;
    for (let i = 0; i < 5 && !got; i++) {
      const c = (await api(analyst).get(`/chat/events?cursor=${encodeURIComponent(cursor)}&seen=${[...seenIds].join(',')}&wait=20`).expect(200)).body as { events: Ev[]; cursor: string };
      for (const e of c.events) seenIds.add(e.sid as string);
      cursor = c.cursor;
      got = c.events.some((e) => e.type === 'message' && e.authorId === rep.userId);
    }
    expect(got).toBe(true);
    expect(Date.now() - started).toBeLessThan(10_000);
    // Outsiders see nothing of this workspace.
    const out = (await api(outsider).get(`/chat/events?cursor=${encodeURIComponent(a.cursor)}&wait=0`).expect(200)).body as { events: Ev[] };
    expect(out.events.filter((e) => e.conversationId === channelId)).toEqual([]);
    // An old cursor (the browser was away for long) means "re-read everything".
    const stale = (await api(analyst).get(`/chat/events?cursor=${encodeURIComponent(new Date(Date.now() - 600_000).toISOString())}&wait=0`).expect(200)).body as { events: Ev[] };
    expect(stale.events).toEqual([{ type: 'ready' }]);
  });

  it('shows sent, delivered and read for each person', async () => {
    const dm = (await api(owner).post('/chat/conversations', { kind: 'DIRECT', userId: analyst.userId }).expect(201)).body as { id: string };
    await api(owner).post(`/chat/conversations/${dm.id}/messages`, { clientId: cid(), body: 'Ticks?' }).expect(201);
    const member = async (who: TestUser, id: string) => ((await api(who).get(`/chat/conversations/${dm.id}`).expect(200)).body as { members: { person: { id: string }; lastReadAt: string | null; lastDeliveredAt: string | null }[] }).members.find((m) => m.person.id === id)!;
    const sentAt = (await member(owner, ownerId)).lastDeliveredAt!;
    // Sent: the analyst's devices have not fetched it yet.
    const before = await member(owner, analyst.userId);
    expect(before.lastDeliveredAt === null || before.lastDeliveredAt < sentAt).toBe(true);
    // Delivered: the analyst's browser says it arrived (on connect, or when the event comes in).
    expect((await api(analyst).post('/chat/delivered', {}).expect(200)).body.updated).toBeGreaterThanOrEqual(1);
    expect((await member(owner, analyst.userId)).lastDeliveredAt).toBe(sentAt);
    expect((await member(owner, analyst.userId)).lastReadAt === null || (await member(owner, analyst.userId)).lastReadAt! < sentAt).toBe(true);
    // Saying it again changes nothing and tells nobody.
    expect((await api(analyst).post('/chat/delivered', { conversationId: dm.id }).expect(200)).body.updated).toBe(0);
    // Read.
    await api(analyst).post(`/chat/conversations/${dm.id}/read`, {}).expect(200);
    expect((await member(owner, analyst.userId)).lastReadAt).toBe(sentAt);
  });

  it("lists the workspace's people with email, role and presence for the people picker", async () => {
    const people = (await api(rep).get('/chat/people').expect(200)).body as { id: string; email: string; role: string; online: boolean }[];
    expect(people.map((p) => p.id)).toEqual(expect.arrayContaining([ownerId, rep.userId, analyst.userId]));
    expect(people.find((p) => p.id === ownerId)).toMatchObject({ email: owner.email, role: expect.any(String), online: expect.any(Boolean) });
    // Never anyone from another workspace.
    expect(people.some((p) => p.email === outsider.email)).toBe(false);
  });
});
