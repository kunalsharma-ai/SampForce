import type { INestApplication } from '@nestjs/common';
import type { InboxThread, InboxThreadRow, SyncLogRow } from '@dealflow/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startProviderFixture, providerEnv, type ProviderFixture } from './fixtures/provider-fixture';
import { api, asTenant, inviteMember, registerUser, startApp, type TestUser } from './helpers';

/** Enhancement feature 8: the inbox groups stored email into conversations that a team can work together. */
describe('inbox', () => {
  let app: INestApplication;
  let fixture: ProviderFixture;
  let owner: TestUser;
  let rep: TestUser & { userId: string };
  let ownerId: string;
  const ids: Record<string, string> = {};
  const saved: Record<string, string | undefined> = {};

  beforeAll(async () => {
    fixture = await startProviderFixture();
    for (const [k, v] of Object.entries(providerEnv(fixture.url))) {
      saved[k] = process.env[k];
      process.env[k] = v;
    }
    app = await startApp();
    owner = await registerUser(app, 'Inbox Co');
    await asTenant(owner.tenantId, (tx) => tx.subscription.updateMany({ where: { tenantId: owner.tenantId }, data: { planCode: 'growth', seats: 10 } }));
    rep = await inviteMember(app, owner, 'member');
    const o = api(owner);
    ownerId = (await o.get('/auth/me').expect(200)).body.user.id;
    const { url } = (await o.post('/integrations/google/connect').expect(200)).body;
    const state = new URL(url).searchParams.get('state')!;
    await o.get(`/integrations/google/callback?code=good-code&state=${encodeURIComponent(state)}`).expect(302);
    ids.company = (await o.post('/companies', { name: 'Initech' }).expect(201)).body.id;
    ids.contact = (await o.post('/contacts', { firstName: 'Ina', lastName: 'Tech', email: 'ina@initech.test', companyId: ids.company }).expect(201)).body.id;
    const stage = (await o.get('/pipelines').expect(200)).body[0].stages[0];
    ids.deal = (await o.post('/deals', { name: 'Initech pilot', amount: 5000, stageId: stage.id, companyId: ids.company }).expect(201)).body.id;
    ids.lead = (await o.post('/leads', { fullName: 'Lou Lead', email: 'lou@prospect.test' }).expect(201)).body.lead.id;
  });
  afterAll(async () => {
    await app.close();
    await fixture.close();
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('groups synced mail into conversations by thread, and logs each sync', async () => {
    const o = api(owner);
    const now = Date.now();
    fixture.state.gmailMessages.push(
      { id: 'in-1', threadId: 'thr-pricing', from: 'ina@initech.test', to: 'rep@seller.test', subject: 'Pricing for the pilot', body: 'What would 20 seats cost?', internalDate: now - 7_200_000 },
      { id: 'in-2', threadId: 'thr-pricing', from: 'ina@initech.test', to: 'rep@seller.test', subject: 'Re: Pricing for the pilot', body: 'Also, is there an annual discount?', internalDate: now - 3_600_000 },
      { id: 'in-3', threadId: 'thr-lead', from: 'lou@prospect.test', to: 'rep@seller.test', subject: 'Invoice question', body: 'Where do I send the purchase order?', internalDate: now - 1_800_000 },
      { id: 'in-4', threadId: 'thr-other', from: 'stranger@nowhere.test', to: 'rep@seller.test', subject: 'Personal', body: 'Not CRM mail', internalDate: now - 900_000 },
    );
    await o.post('/integrations/google/sync').expect(200);
    // Syncing the same messages again does not double-count them.
    await asTenant(owner.tenantId, (tx) => tx.integrationConnection.updateMany({ data: { mailCursor: null } }));
    await o.post('/integrations/google/sync').expect(200);

    const list = (await o.get('/inbox/threads').expect(200)).body as { items: InboxThreadRow[]; nextCursor: string | null };
    expect(list.items.map((t) => t.subject)).toEqual(['Invoice question', 'Pricing for the pilot']);
    const pricing = list.items.find((t) => t.subject === 'Pricing for the pilot')!;
    expect(pricing).toMatchObject({
      status: 'OPEN',
      messageCount: 2,
      lastDirection: 'INBOUND',
      contact: { id: ids.contact, name: 'Ina Tech', companyName: 'Initech' },
      preview: { from: 'ina@initech.test' },
      assignedTo: null,
    });
    ids.pricing = pricing.id;
    ids.invoice = list.items.find((t) => t.subject === 'Invoice question')!.id;
    expect(list.items.find((t) => t.id === ids.invoice)!.lead).toMatchObject({ id: ids.lead, name: 'Lou Lead' });

    const logs = (await o.get('/inbox/sync-logs').expect(200)).body as SyncLogRow[];
    expect(logs.length).toBe(2);
    expect(logs[0]).toMatchObject({ trigger: 'manual', ok: true, mailbox: { accountEmail: 'rep@seller.test' } });
    expect(logs.at(-1)!.emails).toBe(3);
    // A member without integrations:manage sees only their own mailboxes' logs.
    expect((await api(rep).get('/inbox/sync-logs').expect(200)).body).toEqual([]);
  });

  it('replies inside the conversation, which then waits on the customer, and a new message reopens it', async () => {
    const o = api(owner);
    const t = (await o.get(`/inbox/threads/${ids.pricing}`).expect(200)).body as InboxThread;
    expect(t.canReplyInThread).toBe(true);
    expect(t.messages.map((m) => m.bodyText)).toEqual(['What would 20 seats cost?', 'Also, is there an annual discount?']);

    await o.post('/emails/send', { to: 'ina@initech.test', subject: 'Re: Pricing for the pilot', body: '20 seats are 400 a month; annual saves 10%.', conversationId: ids.pricing }).expect(201);
    const sent = JSON.parse(fixture.state.sent.at(-1)!.body) as { threadId?: string };
    expect(sent.threadId).toBe('thr-pricing');
    const after = (await o.get(`/inbox/threads/${ids.pricing}`).expect(200)).body as InboxThread;
    expect(after).toMatchObject({ status: 'WAITING', messageCount: 3, lastDirection: 'OUTBOUND' });
    expect(after.messages.at(-1)).toMatchObject({ direction: 'OUTBOUND', contactId: ids.contact, conversationId: ids.pricing, tracking: null });

    fixture.state.gmailMessages.push({ id: 'in-5', threadId: 'thr-pricing', from: 'ina@initech.test', to: 'rep@seller.test', subject: 'Re: Pricing for the pilot', body: 'Great, send the order form.', internalDate: Date.now() });
    await o.post('/integrations/google/sync').expect(200);
    expect((await o.get(`/inbox/threads/${ids.pricing}`).expect(200)).body).toMatchObject({ status: 'OPEN', messageCount: 4, lastDirection: 'INBOUND' });

    // Someone else's conversation: a reply goes from their own mailbox and does not join it.
    expect(((await api(rep).get(`/inbox/threads/${ids.pricing}`).expect(200)).body as InboxThread).canReplyInThread).toBe(false);
    await o.post('/emails/send', { to: 'x@y.test', subject: 's', body: 'b', conversationId: '00000000-0000-4000-8000-000000000000' }).expect(404);
  });

  it('assigns, categorises, links to a deal and closes, notifying the assignee and recording the audit trail', async () => {
    const o = api(owner);
    await o.patch(`/inbox/threads/${ids.pricing}`, { assignedToId: '00000000-0000-4000-8000-000000000000' }).expect(400);
    await o.patch(`/inbox/threads/${ids.pricing}`, { category: 'spam' }).expect(400);
    const t = (await o.patch(`/inbox/threads/${ids.pricing}`, { assignedToId: rep.userId, category: 'sales', dealId: ids.deal }).expect(200)).body as InboxThread;
    expect(t).toMatchObject({ assignedTo: { id: rep.userId }, category: 'sales', deal: { id: ids.deal, name: 'Initech pilot' } });

    const note = (await api(rep).get('/notifications').expect(200)).body.items.find((n: { type: string }) => n.type === 'inbox.assigned');
    expect(note).toMatchObject({ title: 'A conversation was assigned to you', link: `/app/communication?conversation=${ids.pricing}` });
    const audit = (await o.get('/audit-logs?limit=5').expect(200)).body.items as { action: string; metadata: Record<string, unknown> }[];
    expect(audit.find((a) => a.action === 'inbox.updated')!.metadata).toMatchObject({ assignedToId: rep.userId, category: 'sales', dealId: ids.deal });

    // A member with activities:write can work the conversation too.
    await api(rep).patch(`/inbox/threads/${ids.invoice}`, { category: 'billing', status: 'CLOSED' }).expect(200);
    // The deal record shows its conversations.
    const onDeal = (await o.get(`/inbox/threads?dealId=${ids.deal}`).expect(200)).body.items as InboxThreadRow[];
    expect(onDeal.map((x) => x.id)).toEqual([ids.pricing]);
  });

  it('keeps internal notes and tells the assignee and mailbox owner', async () => {
    const rApi = api(rep);
    await rApi.post(`/inbox/threads/${ids.pricing}/notes`, { body: '' }).expect(400);
    const n = (await rApi.post(`/inbox/threads/${ids.pricing}/notes`, { body: 'Ina asked finance about the annual plan.' }).expect(201)).body;
    expect(n).toMatchObject({ body: 'Ina asked finance about the annual plan.', author: { id: rep.userId } });
    const ownerNotes = (await api(owner).get('/notifications').expect(200)).body.items as { type: string; body: string }[];
    expect(ownerNotes.find((x) => x.type === 'inbox.note')!.body).toContain('annual plan');
    // The author is not notified about their own note.
    expect(((await rApi.get('/notifications').expect(200)).body.items as { type: string }[]).some((x) => x.type === 'inbox.note')).toBe(false);
    const t = (await api(owner).get(`/inbox/threads/${ids.pricing}`).expect(200)).body as InboxThread;
    expect(t.notes.map((x) => x.body)).toEqual(['Ina asked finance about the annual plan.']);
    expect(t.noteCount).toBe(1);
  });

  it('searches and filters conversations, with paging', async () => {
    const o = api(owner);
    const get = async (q: string) => ((await o.get(`/inbox/threads?${q}`).expect(200)).body.items as InboxThreadRow[]).map((t) => t.subject);
    expect(await get('q=purchase%20order')).toEqual(['Invoice question']);
    expect(await get('q=ina%40initech.test')).toEqual(['Pricing for the pilot']);
    expect(await get('status=CLOSED')).toEqual(['Invoice question']);
    expect(await get('category=sales')).toEqual(['Pricing for the pilot']);
    expect(await get('assigned=unassigned')).toEqual(['Invoice question']);
    expect(await get(`assigned=${rep.userId}`)).toEqual(['Pricing for the pilot']);
    expect(await get('linked=deal')).toEqual(['Pricing for the pilot']);
    expect(await get('mine=true')).toHaveLength(2);
    expect(((await api(rep).get('/inbox/threads?mine=true').expect(200)).body.items as unknown[]).length).toBe(0);
    expect(await get(`contactId=${ids.contact}`)).toEqual(['Pricing for the pilot']);
    const first = (await o.get('/inbox/threads?limit=1').expect(200)).body as { items: InboxThreadRow[]; nextCursor: string };
    expect(first.nextCursor).toBeTruthy();
    const second = (await o.get(`/inbox/threads?limit=1&cursor=${encodeURIComponent(first.nextCursor)}`).expect(200)).body as { items: InboxThreadRow[]; nextCursor: string | null };
    expect([first.items[0]!.id, second.items[0]!.id].sort()).toEqual([ids.pricing, ids.invoice].sort());
    expect(second.nextCursor).toBeNull();
    expect(ownerId).toBeTruthy();
  });

  it('keeps conversations, notes and sync logs inside the workspace', async () => {
    const other = await registerUser(app, 'Snoop Co');
    const s = api(other);
    expect((await s.get('/inbox/threads').expect(200)).body.items).toEqual([]);
    await s.get(`/inbox/threads/${ids.pricing}`).expect(404);
    await s.patch(`/inbox/threads/${ids.pricing}`, { status: 'CLOSED' }).expect(404);
    await s.post(`/inbox/threads/${ids.pricing}/notes`, { body: 'hi' }).expect(404);
    expect((await s.get('/inbox/sync-logs').expect(200)).body).toEqual([]);
    // Linking to another workspace's deal is refused.
    await api(owner).patch(`/inbox/threads/${ids.pricing}`, { dealId: (await s.post('/deals', { name: 'x', stageId: (await s.get('/pipelines').expect(200)).body[0].stages[0].id }).expect(201)).body.id }).expect(400);
  });
});
