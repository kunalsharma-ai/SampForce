import type { INestApplication } from '@nestjs/common';
import type { EmailAnalysis, EmailDraft } from '@dealflow/types';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type AiFixture, createAiFixture } from './fixtures/ai-fixture';
import { api, asTenant, inviteMember, registerUser, startApp, type TestUser } from './helpers';

/** Enhancement feature 5: the Email Assistant drafts, rewrites and reads email, and never sends. */
describe('Email Assistant', () => {
  let app: INestApplication;
  let fixture: AiFixture;
  let u: TestUser;
  let contactId: string;
  let connectionId: string;
  const h = () => api(u);
  const inbound = (id: string, subject: string, body: string, extra: { threadId?: string; at?: Date } = {}) =>
    asTenant(u.tenantId, (tx) =>
      tx.emailMessage.create({
        data: { tenantId: u.tenantId, connectionId, providerMessageId: id, threadId: extra.threadId ?? null, direction: 'INBOUND', fromAddress: 'ivy@buyer.test', toAddresses: ['me@x.test'], ccAddresses: [], subject, snippet: body.slice(0, 80), bodyText: body, sentAt: extra.at ?? new Date(), contactId },
      }),
    );

  beforeAll(async () => {
    fixture = await createAiFixture();
    process.env.ANTHROPIC_API_KEY = 'test-key-not-real';
    process.env.AI_API_BASE_URL = fixture.url;
    app = await startApp();
    u = await registerUser(app, 'Mail Assist Co');
    await asTenant(u.tenantId, (tx) => tx.subscription.update({ where: { tenantId: u.tenantId }, data: { planCode: 'growth', seats: 10 } }));
    contactId = (await h().post('/contacts', { firstName: 'Ivy', lastName: 'Buyer', email: 'ivy@buyer.test', jobTitle: 'Head of Ops' }).expect(201)).body.id;
    connectionId = await asTenant(u.tenantId, async (tx) => {
      const m = await tx.membership.findFirstOrThrow({ where: { tenantId: u.tenantId } });
      return (await tx.integrationConnection.create({ data: { tenantId: u.tenantId, userId: m.userId, provider: 'GOOGLE', accountEmail: 'me@x.test', scopes: [], credentialsEncrypted: 'v1.x.y.z' } })).id;
    });
  });
  afterAll(async () => {
    await app.close();
    await fixture.close();
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.AI_API_BASE_URL;
  });
  beforeEach(() => {
    fixture.use(null);
  });

  it('drafts a personal email from the record, with placeholders to check and nothing sent', async () => {
    const before = fixture.requests.length;
    const d = (await h().post('/ai/email/draft', { mode: 'compose', objective: 'a short call about onboarding', tone: 'friendly', contactId }).expect(200)).body as EmailDraft & { runId: string };
    expect(d.subject).toBe('About a short call about onboarding');
    expect(d.body).toContain('Hi Ivy,');
    expect(d.checkBeforeSending).toEqual(['Fill in [proposed time]']);
    expect(d.basedOn).toEqual(['Record: Ivy Buyer']);
    const sent = fixture.requests.slice(before);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.body.output_config?.format?.type).toBe('json_schema');
    expect(sent[0]!.body.system).toMatch(/Never invent prices/);
    const run = (await h().get(`/ai/runs/${d.runId}`).expect(200)).body;
    expect(run).toMatchObject({ agent: 'email_assistant', status: 'SUCCEEDED' });
    expect(await asTenant(u.tenantId, (tx) => tx.emailMessage.count({ where: { direction: 'OUTBOUND' } }))).toBe(0);
    const recs = (await h().get(`/ai/recommendations?entityType=contact&entityId=${contactId}`).expect(200)).body as { kind: string }[];
    expect(recs.map((r) => r.kind)).toContain('email_draft');

    await h().post('/ai/email/draft', { mode: 'compose', tone: 'friendly', contactId }).expect(400);
    await h().post('/ai/email/draft', { mode: 'compose', objective: 'hello' }).expect(400);
  });

  it('writes template drafts with merge fields that exist, and refuses invented ones', async () => {
    await h().put('/email-variables', { key: 'booking_link', label: 'Booking link', value: 'https://cal.example.com/me' }).expect(200);
    const t = (await h().post('/ai/email/draft', { mode: 'compose', objective: 'our new reporting add-on', asTemplate: true }).expect(200)).body as EmailDraft;
    expect(t.subject).toBe('A quick idea for {{company}}');
    expect(t.mergeTags.sort()).toEqual(['company', 'first_name', 'sender_first_name', 'var.booking_link'].sort());
    const bad = await h().post('/ai/email/draft', { mode: 'compose', objective: 'BADTAG offer', asTemplate: true }).expect(422);
    expect(bad.body.error.code).toBe('AI_OUTPUT_UNUSABLE');
    expect(bad.body.error.message).toContain('{{custom.nope}}');
  });

  it('rewrites without touching merge fields, and refuses a rewrite that changes them', async () => {
    const r = (await h().post('/ai/email/rewrite', { action: 'improve', subject: 'quick note', body: 'Hi {{first_name|there}}, i dont want to waste your time.' }).expect(200)).body;
    expect(r).toMatchObject({ subject: 'Quick note', body: "Hi {{first_name|there}}, I don't want to waste your time.", changes: ['Fixed spelling and capitals'] });
    const tone = (await h().post('/ai/email/rewrite', { action: 'tone', tone: 'friendly', body: 'Thanks {{first_name}}.' }).expect(200)).body;
    expect(tone.body).toBe('Hey! Thanks {{first_name}}.');
    await h().post('/ai/email/rewrite', { action: 'tone', body: 'x' }).expect(400);
    const dropped = await h().post('/ai/email/rewrite', { action: 'improve', body: 'Hi {{first_name}} DROPTAGS' }).expect(422);
    expect(dropped.body.error.message).toMatch(/changed the merge fields/);
  });

  it('suggests short subject lines', async () => {
    const s = (await h().post('/ai/email/subjects', { body: 'Saving your team hours on reporting every week.' }).expect(200)).body;
    expect(s.subjects.map((x: { text: string }) => x.text)).toEqual(['About: Saving your team hours', 'Quick question', 'Idea for your team']);
  });

  it('reads a received email for intent, objections and a reply, and stores the intent on the email', async () => {
    await inbound('t1', 'Pricing', 'Thanks for the note. What does it cost?', { threadId: 'th-1', at: new Date(Date.now() - 3_600_000) });
    const e = await inbound('t2', 'Re: Pricing', 'Honestly this is too expensive for us. Is there a smaller plan?', { threadId: 'th-1' });
    const a = (await h().post('/ai/email/analyse', { emailId: e.id }).expect(200)).body as EmailAnalysis;
    expect(a).toMatchObject({ intent: 'objection', objections: ['Price is too high'], buyingSignals: ['Asked about a smaller plan'], nextAction: 'reply_now', followUpInDays: 2, messagesRead: 2 });
    expect(a.suggestedReply?.body).toContain('[answer]');
    const req = JSON.stringify(fixture.requests.at(-1)!.body.messages);
    expect(req).toMatch(/untrusted_data source=\\+"email/);
    const row = (await h().get(`/emails/${e.id}`).expect(200)).body;
    expect(row.aiIntent).toBe('objection');
    expect((await h().get(`/ai/email/analysis/${e.id}`).expect(200)).body.analysis.intent).toBe('objection');

    // A reply draft for this email reads it and answers it.
    const reply = (await h().post('/ai/email/draft', { mode: 'reply', emailId: e.id }).expect(200)).body as EmailDraft;
    expect(reply.subject).toBe('Re: Re: Pricing');
  });

  it('never drafts a reply to someone who asked not to be emailed, and does not suppress them by itself', async () => {
    const e = await inbound('t3', 'Stop', 'Please remove me from your list.');
    const a = (await h().post('/ai/email/analyse', { emailId: e.id }).expect(200)).body as EmailAnalysis;
    expect(a).toMatchObject({ intent: 'unsubscribe', nextAction: 'stop_outreach', suggestedReply: null, followUpInDays: null });
    const suppressed = await asTenant(u.tenantId, (tx) => tx.emailSuppression.count({ where: { email: 'ivy@buyer.test' } }));
    expect(suppressed).toBe(0);
  });

  it('refuses sent emails, respects AI switches and permissions', async () => {
    const out = await asTenant(u.tenantId, (tx) =>
      tx.emailMessage.create({ data: { tenantId: u.tenantId, connectionId, providerMessageId: 'o1', direction: 'OUTBOUND', fromAddress: 'me@x.test', toAddresses: ['ivy@buyer.test'], ccAddresses: [], subject: 'Hi', sentAt: new Date(), contactId } }),
    );
    await h().post('/ai/email/analyse', { emailId: out.id }).expect(400);
    await h().post('/ai/email/draft', { mode: 'reply', emailId: out.id }).expect(400);

    const viewer = await inviteMember(app, u, 'viewer');
    await api(viewer).post('/ai/email/subjects', { body: 'Hello there' }).expect(403);

    await h().patch('/ai/settings', { disabledAgents: ['email_assistant'] }).expect(200);
    const off = await h().post('/ai/email/subjects', { body: 'Hello there' });
    expect(off.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(off.body)).toMatch(/AGENT_DISABLED/);
    await h().patch('/ai/settings', { disabledAgents: [] }).expect(200);
  });
});
