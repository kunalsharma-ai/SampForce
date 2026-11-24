import type { INestApplication } from '@nestjs/common';
import type { ChatConversationRow, ChatMessageRow, SampbidxChatPeopleResponse, SampbidxChatTransferOption, SampbidxTransferRow } from '@dealflow/types';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SampbidxChatService } from '../src/apps/sampbidx-chat.service';
import { SBX, sbxSign, startSampbidxFixture, type SampbidxFixture } from './fixtures/sampbidx-fixture';
import { api, asTenant, inviteMember, ORIGIN, registerUser, startApp, type TestUser, workspacePerson } from './helpers';

/** Chat with the SampBidx team (ADR 0077) against the local SampBidx stand-in. */
describe('SampBidx chat (stand-in)', () => {
  let app: INestApplication;
  let sbx: SampbidxFixture;
  let owner: TestUser & { userId?: string };
  let ownerId: string;
  let rep: TestUser & { userId: string };
  let manager: TestUser & { userId: string; workspaceId: string };
  let companyId: string;
  let transfer: SampbidxTransferRow;
  let secret: string;
  let hookPath: string;
  const pub = () => request(app.getHttpServer());
  const signed = (path: string, body: object | null, sign = () => secret, ts?: string) => {
    const raw = body ? JSON.stringify(body) : '';
    const s = sbxSign(sign(), raw, ts);
    const r = body ? pub().post(path).set('content-type', 'application/json') : pub().get(path);
    return (body ? (r as request.Test).send(raw) : r).set('x-sampbidx-timestamp', s.timestamp).set('x-sampbidx-signature', s.signature);
  };
  const inbound = (body: object, sign?: () => string) => signed(`${hookPath}/messages`, body, sign);
  const chats = async (u: TestUser) => (await api(u).get('/chat/conversations').expect(200)).body as ChatConversationRow[];
  const general = async (u: TestUser) => (await chats(u)).find((c) => c.kind === 'SAMPBIDX' && c.sampbidx?.scope === 'general');
  const messages = async (u: TestUser, id: string) => (await api(u).get(`/chat/conversations/${id}/messages`).expect(200)).body as ChatMessageRow[];
  const say = (u: TestUser, id: string, body: string, attachmentIds: string[] = []) => api(u).post(`/chat/conversations/${id}/messages`, { clientId: crypto.randomUUID(), body, attachmentIds });
  const settle = async (fn: () => Promise<boolean>) => {
    for (let i = 0; i < 50; i++) {
      if (await fn()) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('timed out');
  };
  const setOverride = (enabled: boolean | null) =>
    asTenant(owner.tenantId, async (tx) => {
      await tx.tenantFeatureOverride.deleteMany({ where: { tenantId: owner.tenantId, feature: 'sampbidx_chat' } });
      if (enabled !== null) await tx.tenantFeatureOverride.create({ data: { tenantId: owner.tenantId, feature: 'sampbidx_chat', enabled, reason: 'test', updatedBy: 'test' } });
    });

  beforeAll(async () => {
    sbx = await startSampbidxFixture();
    app = await startApp();
    owner = await registerUser(app, 'Frequent Research Fieldwork Solutions');
    ownerId = ((await api(owner).get('/auth/me').expect(200)).body as { user: { id: string } }).user.id;
    rep = await inviteMember(app, owner, 'member');
    // Made before the Console allows SampBidx chat, so it does not inherit it.
    manager = await workspacePerson(app, owner, 'MANAGER', 'North Sales');
    await owner.agent.post('/api/v1/apps/sampbidx/keys').set('origin', ORIGIN).set('x-forwarded-for', '198.51.100.77').send({ baseUrl: `${sbx.url}/api`, apiKey: SBX.key }).expect(200);
    const cb = (await api(owner).get('/apps/sampbidx/callback-secret').expect(200)).body as { callbackUrl: string; secret: string };
    secret = cb.secret;
    hookPath = new URL(cb.callbackUrl).pathname;
    companyId = (await api(owner).post('/company-leads', { company: { name: 'Acme Panels', country: 'IN', ownerId: rep.userId }, employees: [] }).expect(201)).body.company.id;
    transfer = (await api(rep).post('/apps/sampbidx/transfers/pasted-email', { companyId, text: 'Subject: RFQ UK adults\n\nPlease quote 1,000 UK adults, LOI 12, IR 40%.' }).expect(200)).body;
    expect(transfer.delivery).toBe('SENT');
  });
  afterAll(async () => {
    await app.close();
    await sbx.close();
  });

  it('is off until the Console Admin allows it for the organisation', async () => {
    expect(await general(owner)).toBeUndefined();
    expect((await api(owner).get('/apps/sampbidx/chat/transfers').expect(403)).body.error.code).toBe('FEATURE_NOT_IN_PLAN');
    expect((await inbound({ id: 'm-0', author: { name: 'Meera' }, text: 'Hello' }).expect(403)).body.error.code).toBe('CHAT_OFF');
    expect((await signed(`${hookPath}/people`, null).expect(200)).body).toEqual({ workspace: 'Frequent Research Fieldwork Solutions', people: [] });

    await setOverride(true);
    const line = await general(owner);
    expect(line).toMatchObject({ kind: 'SAMPBIDX', title: 'SampBidx team', canManage: false, sampbidx: { scope: 'general', transfer: null, people: [] } });
    expect((await general(rep))?.id).toBe(line!.id);
    // Only the one SampBidx line is added beside the team's own conversations (here the support line).
    expect((await chats(owner)).map((c) => c.kind).sort()).toEqual(['SAMPBIDX', 'SUPPORT']);
  });

  it('runs down the hierarchy: a Manager Workspace has it only once the Super Workspace hands it down', async () => {
    expect(await general(manager)).toBeUndefined();
    const lineId = (await general(owner))!.id;
    expect((await api(manager).get(`/chat/conversations/${lineId}`).expect(404)).body.error.code).toBe('NOT_FOUND');
    await api(manager).get('/apps/sampbidx/chat/transfers').expect(403);

    const tree = (await api(owner).get('/workspaces').expect(200)).body as { workspaces: Array<{ id: string; features: string[]; restrictedFeatures: string[] }> };
    const row = tree.workspaces.find((w) => w.id === manager.workspaceId)!;
    // The Super Workspace sees it as something it can hand down.
    expect(row.restrictedFeatures).toContain('sampbidx_chat');
    const current = row.features;
    await api(owner).put(`/workspaces/${manager.workspaceId}/permissions`, { features: [...current, 'sampbidx_chat'] }).expect(200);
    expect((await general(manager))?.id).toBe(lineId);

    // Taken away again: the conversation is refused at once, even by id.
    await api(owner).put(`/workspaces/${manager.workspaceId}/permissions`, { features: current }).expect(200);
    expect(await general(manager)).toBeUndefined();
    expect((await api(manager).get(`/chat/conversations/${lineId}/messages`).expect(403)).body.error.code).toBe('FEATURE_NOT_GRANTED');
    expect((await say(manager, lineId, 'still here?').expect(403)).body.error.code).toBe('FEATURE_NOT_GRANTED');
  });

  it('posts messages on the general line to SampBidx, with files, and tries again until SampBidx has them', async () => {
    const lineId = (await general(owner))!.id;
    const file = (await owner.agent.post(`/api/v1/chat/conversations/${lineId}/attachments?name=quota.csv`).set('origin', ORIGIN).set('content-type', 'text/csv').send(Buffer.from('age,n\n18-34,300')).expect(201)).body as { id: string };
    const sent = (await say(owner, lineId, 'Hi team, can you take a UK B2C study this week?', [file.id]).expect(201)).body as ChatMessageRow;
    expect(sent.sampbidxDelivery).toMatchObject({ state: 'SENDING' });
    await settle(async () => (await messages(owner, lineId)).find((m) => m.id === sent.id)?.sampbidxDelivery?.state === 'SENT');
    const got = sbx.messages.at(-1)!;
    expect(got.idempotencyKey).toBe(sent.id);
    expect(got.json).toMatchObject({ id: sent.id, system: 'SampForce', workspace: 'Frequent Research Fieldwork Solutions', conversation: { type: 'general' }, author: { id: ownerId, email: owner.email }, text: 'Hi team, can you take a UK B2C study this week?', attachments: [{ name: 'quota.csv', contentType: 'text/csv' }] });
    expect(got.parts.filter((p) => p.name === 'files').map((p) => [p.filename, p.size])).toEqual([['quota.csv', 15]]);

    // SampBidx is down: the message says so, and the next try (by the worker or the person) gets it there once.
    sbx.failNext(1);
    const later = (await say(owner, lineId, 'Following up').expect(201)).body as ChatMessageRow;
    await settle(async () => (await messages(owner, lineId)).find((m) => m.id === later.id)?.sampbidxDelivery?.state === 'FAILED');
    const failed = (await messages(owner, lineId)).find((m) => m.id === later.id)!;
    expect(failed.sampbidxDelivery).toMatchObject({ state: 'FAILED', attempts: 1 });
    expect(failed.sampbidxDelivery!.error).toContain('(503)');
    await api(rep).post(`/apps/sampbidx/chat/messages/${later.id}/retry`).expect(404);
    expect(((await api(owner).post(`/apps/sampbidx/chat/messages/${later.id}/retry`).expect(200)).body as ChatMessageRow).sampbidxDelivery).toMatchObject({ state: 'SENT', attempts: 2, error: null });
    expect(sbx.messages.filter((m) => m.idempotencyKey === later.id)).toHaveLength(1);

    // The worker's sweep picks up a message whose next try is due.
    sbx.failNext(1);
    const third = (await say(rep, lineId, 'Any update?').expect(201)).body as ChatMessageRow;
    await settle(async () => (await messages(rep, lineId)).find((m) => m.id === third.id)?.sampbidxDelivery?.state === 'FAILED');
    await asTenant(owner.tenantId, (tx) => tx.chatMessage.update({ where: { id: third.id }, data: { remoteRetryAt: new Date(Date.now() - 1000) } }));
    expect(await app.get(SampbidxChatService).sweep()).toBeGreaterThanOrEqual(1);
    expect((await messages(rep, lineId)).find((m) => m.id === third.id)!.sampbidxDelivery!.state).toBe('SENT');

    // What SampBidx already has cannot be changed or taken back.
    expect((await api(owner).patch(`/chat/messages/${sent.id}`, { body: 'changed' }).expect(403)).body.error.message).toContain('SampBidx already has them');
    expect((await api(owner).post(`/chat/conversations/${lineId}/messages`, { clientId: crypto.randomUUID(), body: 'see this', link: { type: 'COMPANY', id: companyId } }).expect(400)).body.error.code).toBe('VALIDATION_FAILED');
  });

  it('takes signed messages from the SampBidx team, once each, with their files', async () => {
    const lineId = (await general(owner))!.id;
    const msg = { id: 'sbx-msg-1', author: { id: 77, name: 'Meera Iyer', email: 'Meera@SampBidx.example', role: 'Bid manager' }, text: 'Yes, we can. Send the RFQ.', attachments: [{ name: 'rate-card.pdf', contentType: 'application/pdf', data: Buffer.from('%PDF-1.4 rates').toString('base64') }] };
    await inbound(msg, () => 'wrong').expect(401);
    await pub().post(`${hookPath}/messages`).set('content-type', 'application/json').send(msg).expect(401);
    await inbound({ id: 'x', author: { name: 'Meera' } }).expect(400);
    const first = (await inbound(msg).expect(200)).body as { ok: boolean; matched: boolean; messageId: string };
    expect(first).toMatchObject({ ok: true, matched: true });
    expect((await inbound(msg).expect(200)).body).toMatchObject({ matched: true, messageId: first.messageId, duplicate: true });

    const stored = (await messages(rep, lineId)).filter((m) => m.external);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ id: first.messageId, author: null, body: 'Yes, we can. Send the RFQ.', external: { id: '77', name: 'Meera Iyer', email: 'meera@sampbidx.example', role: 'Bid manager' }, attachments: [{ name: 'rate-card.pdf', contentType: 'application/pdf', sizeBytes: 14 }] });
    const dl = await rep.agent.get(`/api/v1/chat/attachments/${stored[0]!.attachments[0]!.id}/download`).expect(200);
    expect(Buffer.from(dl.body as Buffer).toString()).toBe('%PDF-1.4 rates');
    const line = (await general(rep))!;
    expect(line.unread).toBeGreaterThanOrEqual(1);
    expect(line.lastMessagePreview).toBe('Meera Iyer: Yes, we can. Send the RFQ.');
    expect(line.sampbidx!.people).toEqual([{ id: '77', name: 'Meera Iyer', email: 'meera@sampbidx.example', role: 'Bid manager' }]);
    // An RFQ SampForce does not know is acknowledged but not stored.
    expect((await inbound({ id: 'sbx-msg-2', sampbidxId: 'SBX-NOPE', author: { name: 'Meera' }, text: 'Hi' }).expect(200)).body).toEqual({ ok: true, matched: false, messageId: null });
  });

  it('keeps one chat per RFQ sent to SampBidx, with its people and its status changes', async () => {
    const options = (await api(owner).get('/apps/sampbidx/chat/transfers').expect(200)).body as SampbidxChatTransferOption[];
    expect(options.find((o) => o.id === transfer.id)).toMatchObject({ remoteId: transfer.remoteId, conversationId: null, company: { id: companyId, name: 'Acme Panels' } });

    // SampBidx writes first: the chat starts with the sender (the company's owner here).
    const got = (await inbound({ id: 'sbx-rfq-1', sampbidxId: transfer.remoteId, author: { name: 'Arjun Rao', email: 'arjun@sampbidx.example', role: 'Bidder' }, text: 'What is the field window?' }).expect(200)).body as { messageId: string };
    let repChat = (await chats(rep)).find((c) => c.sampbidx?.transfer?.id === transfer.id)!;
    expect(repChat).toMatchObject({ kind: 'SAMPBIDX', title: transfer.title, sampbidx: { scope: 'rfq', transfer: { id: transfer.id, remoteId: transfer.remoteId, company: { name: 'Acme Panels' } }, people: [{ name: 'Arjun Rao' }] } });
    expect((await chats(owner)).some((c) => c.id === repChat.id)).toBe(false);
    expect((await messages(rep, repChat.id)).map((m) => m.id)).toEqual([got.messageId]);

    // The admin opens it and joins; the answer goes to SampBidx about that RFQ.
    const opened = (await api(owner).post('/apps/sampbidx/chat/open', { transferId: transfer.id }).expect(200)).body as ChatConversationRow;
    expect(opened.id).toBe(repChat.id);
    expect(opened.members.map((m) => m.person.id).sort()).toEqual([ownerId, rep.userId].sort());
    const reply = (await say(rep, repChat.id, 'Field from Monday, 10 days.').expect(201)).body as ChatMessageRow;
    await settle(async () => sbx.messages.some((m) => m.idempotencyKey === reply.id));
    expect(sbx.messages.find((m) => m.idempotencyKey === reply.id)!.json).toMatchObject({ conversation: { type: 'rfq', transferId: transfer.id, sampbidxId: transfer.remoteId, title: transfer.title, company: { name: 'Acme Panels' } }, author: { id: rep.userId } });

    // A status update from SampBidx shows as a line in the chat.
    await signed(hookPath, { sampbidxId: transfer.remoteId, status: 'quoted', note: 'USD 11.50 CPI' }).expect(200);
    const lines = await messages(owner, repChat.id);
    expect(lines.at(-1)).toMatchObject({ system: true, author: null, body: `SampBidx quoted ${transfer.title}: USD 11.50 CPI` });
    repChat = (await chats(rep)).find((c) => c.id === repChat.id)!;
    expect(repChat.sampbidx!.transfer!.remoteStatus).toBe('QUOTED');

    // Nobody outside the organisation's chat-enabled workspaces can be added.
    expect((await api(rep).post(`/chat/conversations/${repChat.id}/members`, { userIds: [manager.userId] }).expect(400)).body.error.code).toBe('VALIDATION_FAILED');
    await api(owner).post('/apps/sampbidx/chat/open', { transferId: '00000000-0000-4000-8000-000000000000' }).expect(404);
  });

  it('tells SampBidx who may chat: name, email, role and workspace only', async () => {
    await signed(`${hookPath}/people`, null, () => 'wrong').expect(401);
    const res = (await signed(`${hookPath}/people`, null).expect(200)).body as SampbidxChatPeopleResponse;
    expect(res.workspace).toBe('Frequent Research Fieldwork Solutions');
    expect(res.people.map((p) => p.id).sort()).toEqual([ownerId, rep.userId].sort());
    expect(Object.keys(res.people[0]!).sort()).toEqual(['email', 'id', 'level', 'name', 'role', 'workspace']);
    expect(res.people.every((p) => p.level === 'SUPER')).toBe(true);

    // The Console Admin takes it away: everything stops, history stays.
    await setOverride(null);
    expect(await general(owner)).toBeUndefined();
    expect((await signed(`${hookPath}/people`, null).expect(200)).body.people).toEqual([]);
    await inbound({ id: 'sbx-late', author: { name: 'Meera' }, text: 'Hello?' }).expect(403);
  });
});
