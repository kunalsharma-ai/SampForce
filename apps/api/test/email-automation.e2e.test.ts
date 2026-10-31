import type { INestApplication } from '@nestjs/common';
import type { NextActionList, WorkflowDefinition } from '@dealflow/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SequenceRunner } from '../src/sequences/sequence-runner.service';
import { WorkerService } from '../src/worker/worker.service';
import { startProviderFixture, providerEnv, type ProviderFixture } from './fixtures/provider-fixture';
import { api, asTenant, registerUser, startApp, type TestUser } from './helpers';

const ALL_DAY = { sendDays: [0, 1, 2, 3, 4, 5, 6], sendStart: '00:00', sendEnd: '23:59', timezone: 'UTC', dailyLimit: 50, trackOpens: true, trackClicks: true };
const DAY = 86_400_000;

/**
 * Enhancement Phase 2: email and sequence events start Automation Studio workflows (one engine), covering the six
 * scenarios in the spec. Events are recorded the way tracking and mailbox sync record them.
 */
describe('email automation on Automation Studio', () => {
  let app: INestApplication;
  let fixture: ProviderFixture;
  let runner: SequenceRunner;
  let worker: WorkerService;
  let owner: TestUser;
  let http: ReturnType<typeof api>;
  let seqA: string;
  let seqB: string;
  const saved: Record<string, string | undefined> = {};
  const lead = async (fullName: string, email: string) => (await http.post('/leads', { fullName, email, companyName: `${fullName} Co` }).expect(201)).body.lead.id as string;

  beforeAll(async () => {
    fixture = await startProviderFixture();
    for (const [k, v] of Object.entries(providerEnv(fixture.url))) {
      saved[k] = process.env[k];
      process.env[k] = v;
    }
    app = await startApp();
    runner = app.get(SequenceRunner);
    worker = app.get(WorkerService);
    owner = await registerUser(app, 'Engagers');
    await asTenant(owner.tenantId, (tx) => tx.subscription.update({ where: { tenantId: owner.tenantId }, data: { planCode: 'growth', status: 'ACTIVE', seats: 20 } }));
    http = api(owner);
    const { url } = (await http.post('/integrations/google/connect').expect(200)).body;
    const state = new URL(url).searchParams.get('state')!;
    await http.get(`/integrations/google/callback?code=good-code&state=${encodeURIComponent(state)}`).expect(302);
    const seq = async (name: string) => {
      const s = (await http.post('/sequences', {
        name,
        steps: [
          { id: 'one', type: 'email', delayDays: 0, subject: 'Hello {{first_name|there}}', body: 'Our proposal: https://example.com/proposal/42 and our site https://example.com/' },
          { id: 'two', type: 'email', delayDays: 0, subject: 'Following up', body: 'Case study: https://example.com/case-study' },
        ],
        rules: [{ on: 'bounced', actions: [{ type: 'stop' }] }],
        settings: ALL_DAY,
      }).expect(201)).body;
      await http.post(`/sequences/${s.id}/status`, { status: 'ACTIVE' }).expect(200);
      return s.id as string;
    };
    seqA = await seq('Outbound A');
    seqB = await seq('Outbound B');
  });

  afterAll(async () => {
    await app.close();
    await fixture.close();
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  const workflow = async (name: string, definition: WorkflowDefinition | object) => {
    const wf = (await http.post('/workflows', { name, definition }).expect(201)).body;
    await http.patch(`/workflows/${wf.id}/status`, { status: 'ACTIVE' }).expect(200);
    return wf.id as string;
  };
  /** Sends every due sequence step now and lets the worker relay the events to workflows. */
  const sendDue = async () => {
    await asTenant(owner.tenantId, (tx) => tx.sequenceEnrollment.updateMany({ where: { status: 'ACTIVE' }, data: { nextRunAt: new Date(Date.now() - 1000) } }));
    await runner.runDue(500);
    await worker.drain(20);
  };
  const messages = (leadId: string) =>
    asTenant(owner.tenantId, (tx) => tx.sequenceMessage.findMany({ where: { enrollment: { leadId } }, orderBy: { sentAt: 'asc' }, include: { enrollment: true } }));
  const tasksFor = async (leadId: string) => {
    const r = (await http.get(`/tasks?leadId=${leadId}&scope=all`).expect(200)).body;
    return (Array.isArray(r) ? r : r.items) as { title: string; priority: string }[];
  };
  const runsOf = (workflowId: string) => asTenant(owner.tenantId, (tx) => tx.workflowExecution.findMany({ where: { workflowId }, orderBy: { startedAt: 'asc' } }));

  it('refuses sequence and email actions on a trigger that has no lead or contact', async () => {
    const res = await http.post('/workflows', {
      name: 'Wrong',
      definition: { trigger: { event: 'deal.created' }, start: 'a', nodes: [{ id: 'a', type: 'action', action: { type: 'stop_sequences', mode: 'stop' }, next: null }] },
    }).expect(400);
    expect(JSON.stringify(res.body)).toMatch(/needs a lead or contact/);
  });

  it('scenario 2: a click on a proposal link creates a high-priority task, other links do not', async () => {
    const wf = await workflow('Proposal clicks', {
      trigger: { event: 'email.clicked', conditions: { match: 'all', rules: [{ field: 'event.url', op: 'contains', value: 'proposal' }] } },
      start: 'task',
      nodes: [{ id: 'task', type: 'action', action: { type: 'create_task', title: 'Call {{record.fullName}} about the proposal', dueInDays: 0, assignTo: 'record_owner', priority: 'HIGH' }, next: null }],
    });
    const pia = await lead('Pia Proposal', 'pia@buyer.test');
    await http.post(`/sequences/${seqA}/enroll`, { leadIds: [pia] }).expect(200);
    await sendDue();
    const [m] = await messages(pia);
    await runner.record(owner.tenantId, m!.id, 'CLICKED', 'https://example.com/');
    await worker.drain(10);
    expect(await runsOf(wf)).toHaveLength(0);

    // The first click on an email already happened, so a second email's proposal click is what counts.
    await sendDue();
    const [, m2] = await messages(pia);
    await runner.record(owner.tenantId, m2!.id, 'CLICKED', 'https://example.com/proposal/42');
    await worker.drain(10);
    expect((await runsOf(wf)).map((r) => r.status)).toEqual(['SUCCEEDED']);
    expect(await tasksFor(pia)).toContainEqual(expect.objectContaining({ title: 'Call Pia Proposal about the proposal', priority: 'HIGH' }));
  });

  it('scenario 3: a reply stops every live sequence to them and notifies the owner', async () => {
    const wf = await workflow('Replies', {
      trigger: { event: 'email.replied' },
      start: 'stop',
      nodes: [
        { id: 'stop', type: 'action', action: { type: 'stop_sequences', mode: 'stop' }, next: 'tell' },
        { id: 'tell', type: 'action', action: { type: 'notify', to: 'record_owner', title: '{{record.fullName}} replied to {{event.sequenceName}}' }, next: null },
      ],
    });
    const removed = await workflow('Removed log', {
      trigger: { event: 'sequence.removed' },
      start: 'note',
      nodes: [{ id: 'note', type: 'action', action: { type: 'log_note', subject: 'Left {{event.sequenceName}} ({{event.reason}})' }, next: null }],
    });
    const rey = await lead('Rey Replier', 'rey@buyer.test');
    await http.post(`/sequences/${seqA}/enroll`, { leadIds: [rey] }).expect(200);
    await http.post(`/sequences/${seqB}/enroll`, { leadIds: [rey] }).expect(200);
    await asTenant(owner.tenantId, (tx) => tx.sequenceEnrollment.updateMany({ where: { leadId: rey, sequenceId: seqB }, data: { nextRunAt: new Date(Date.now() + 5 * DAY) } }));
    await runner.runDue(500);
    const [m] = await messages(rey);
    fixture.state.gmailMessages.push({ id: 'rey-reply', from: 'rey@buyer.test', to: 'rep@seller.test', subject: 'Re: Hello Rey', body: 'Interested, call me.', internalDate: Date.now() + 1000 });
    await http.post('/integrations/google/sync').expect(200);
    await worker.drain(20);

    expect((await runsOf(wf)).map((r) => r.status)).toEqual(['SUCCEEDED']);
    // These sequences have no reply rule of their own, so the workflow is what stops both runs.
    const runs = await asTenant(owner.tenantId, (tx) => tx.sequenceEnrollment.findMany({ where: { leadId: rey }, select: { sequenceId: true, status: true, repliedAt: true } }));
    expect(runs.map((r) => r.status)).toEqual(['STOPPED', 'STOPPED']);
    expect(runs.find((r) => r.sequenceId === seqA)!.repliedAt).not.toBeNull();
    expect((await messages(rey)).find((x) => x.id === m!.id)!.repliedAt).not.toBeNull();
    const notes = (await http.get('/notifications').expect(200)).body;
    const list = (Array.isArray(notes) ? notes : notes.items) as { title: string }[];
    expect(list.map((n) => n.title)).toContain('Rey Replier replied to Outbound A');
    // The workflow stopped sequence B, which published "removed from a sequence" for the second workflow.
    expect((await runsOf(removed)).length).toBeGreaterThanOrEqual(1);
    const acts = (await http.get(`/activities?leadId=${rey}`).expect(200)).body;
    expect(JSON.stringify(acts)).toContain('Left Outbound B (workflow)');
  });

  it('scenario 4: a bounce stops sending, marks the address bounced, and a workflow flags it for checking', async () => {
    const wf = await workflow('Bounces', {
      trigger: { event: 'email.bounced' },
      start: 'flag',
      nodes: [
        { id: 'flag', type: 'action', action: { type: 'flag_email', status: 'needs_verification' }, next: 'task' },
        { id: 'task', type: 'action', action: { type: 'create_task', title: 'Find a working address for {{record.fullName}}', dueInDays: 2, assignTo: 'record_owner' }, next: null },
      ],
    });
    const bo = await lead('Bo Bounce', 'bo@gone.test');
    await http.post(`/sequences/${seqA}/enroll`, { leadIds: [bo] }).expect(200);
    await runner.runDue(500);
    fixture.state.gmailMessages.push({
      id: 'bo-bounce', from: 'mailer-daemon@googlemail.com', to: 'rep@seller.test', subject: 'Delivery Status Notification (Failure)',
      body: "Your message wasn't delivered to bo@gone.test because the address couldn't be found.", internalDate: Date.now() + 2000,
    });
    await http.post('/integrations/google/sync').expect(200);
    const before = (await http.get(`/leads/${bo}`).expect(200)).body;
    expect(before.emailStatus).toBe('bounced');
    await worker.drain(20);
    expect((await runsOf(wf)).map((r) => r.status)).toEqual(['SUCCEEDED']);
    expect((await http.get(`/leads/${bo}`).expect(200)).body.emailStatus).toBe('needs_verification');
    expect((await tasksFor(bo)).map((t) => t.title)).toContain('Find a working address for Bo Bounce');
    // Changing the address clears the flag.
    await http.patch(`/leads/${bo}`, { email: 'bo@new.test' }).expect(200);
    expect((await http.get(`/leads/${bo}`).expect(200)).body.emailStatus).toBeNull();
  });

  it('scenario 5: an unsubscribe suppresses the address at once and the owner is told', async () => {
    const wf = await workflow('Unsubscribes', {
      trigger: { event: 'email.unsubscribed' },
      start: 'tell',
      nodes: [{ id: 'tell', type: 'action', action: { type: 'notify', to: 'record_owner', title: '{{record.fullName}} unsubscribed' }, next: null }],
    });
    const uma = await lead('Uma Unsub', 'uma@buyer.test');
    await http.post(`/sequences/${seqA}/enroll`, { leadIds: [uma] }).expect(200);
    await http.post(`/sequences/${seqB}/enroll`, { leadIds: [uma] }).expect(200);
    await runner.runDue(500);
    const [m] = await messages(uma);
    await runner.record(owner.tenantId, m!.id, 'UNSUBSCRIBED');
    // Suppression happens with the event, before any workflow runs.
    const runs = await asTenant(owner.tenantId, (tx) => tx.sequenceEnrollment.findMany({ where: { leadId: uma }, select: { status: true } }));
    expect(runs.map((r) => r.status)).toEqual(['UNSUBSCRIBED', 'UNSUBSCRIBED']);
    expect((await http.get(`/leads/${uma}`).expect(200)).body.marketingConsent).toBe('OPTED_OUT');
    await worker.drain(20);
    expect((await runsOf(wf)).map((r) => r.status)).toEqual(['SUCCEEDED']);
    // Enrolling again is refused for the suppressed address.
    const again = (await http.post(`/sequences/${seqA}/enroll`, { leadIds: [uma] }).expect(200)).body;
    expect(again.enrolled).toBe(0);
  });

  it('scenario 6: clicks across emails raise the engagement score and create a follow-up once', async () => {
    const wf = await workflow('Engaged', {
      trigger: { event: 'email.clicked' },
      start: 'points',
      nodes: [
        { id: 'points', type: 'action', action: { type: 'add_engagement_points', points: 15 }, next: 'check' },
        {
          id: 'check', type: 'condition',
          condition: { match: 'all', rules: [{ field: 'record.emailActivity.clicks30', op: 'gte', value: 2 }, { field: 'record.emailActivity.replies30', op: 'eq', value: 0 }] },
          onTrue: 'task', onFalse: null,
        },
        { id: 'task', type: 'action', action: { type: 'create_task', title: 'Reach out to {{record.fullName}} personally', dueInDays: 1, assignTo: 'record_owner', priority: 'HIGH' }, next: null },
      ],
    });
    const eve = await lead('Eve Engaged', 'eve@buyer.test');
    await http.post(`/sequences/${seqB}/enroll`, { leadIds: [eve] }).expect(200);
    await sendDue();
    await sendDue();
    const [m1, m2] = await messages(eve);
    await runner.record(owner.tenantId, m1!.id, 'OPENED');
    await runner.record(owner.tenantId, m1!.id, 'CLICKED', 'https://example.com/');
    await worker.drain(10);
    expect((await http.get(`/leads/${eve}`).expect(200)).body.engagementScore).toBe(15);
    expect(await tasksFor(eve)).toEqual([]);
    await runner.record(owner.tenantId, m2!.id, 'CLICKED', 'https://example.com/case-study');
    // A second click on the same email is not a new event.
    await runner.record(owner.tenantId, m2!.id, 'CLICKED', 'https://example.com/case-study');
    await worker.drain(10);
    expect((await runsOf(wf))).toHaveLength(2);
    expect((await http.get(`/leads/${eve}`).expect(200)).body.engagementScore).toBe(30);
    expect(await tasksFor(eve)).toEqual([expect.objectContaining({ title: 'Reach out to Eve Engaged personally', priority: 'HIGH' })]);

    // Next best actions suggests a personal follow-up and marks opens as estimates.
    const list = (await http.get('/next-actions').expect(200)).body as NextActionList;
    const item = list.items.find((i) => i.kind === 'engaged_no_reply' && i.record.id === eve)!;
    expect(item.reason).toMatch(/opened 2 emails \(estimate\) and clicked links in 2/);
  });

  it('scenario 1: no reply three days after a one-off email asks to send a follow-up; a reply ends the run', async () => {
    const wf = await workflow('No reply', {
      trigger: { event: 'email.sent', conditions: { match: 'all', rules: [{ field: 'event.source', op: 'eq', value: 'direct' }] } },
      start: 'wait',
      nodes: [
        { id: 'wait', type: 'delay', amount: 3, unit: 'days', next: 'check' },
        { id: 'check', type: 'condition', condition: { match: 'all', rules: [{ field: 'record.emailActivity.repliedSinceTrigger', op: 'eq', value: false }] }, onTrue: 'send', onFalse: null },
        { id: 'send', type: 'action', action: { type: 'send_email', subject: 'Re: {{event.subject}}', body: 'Just checking this reached you.' }, next: null },
      ],
    });
    const quiet = await lead('Quinn Quiet', 'quinn@buyer.test');
    const talker = await lead('Tess Talker', 'tess@buyer.test');
    await http.post('/emails/send', { to: 'quinn@buyer.test', subject: 'Pricing', body: 'Here is our pricing.', leadId: quiet }).expect(201);
    await http.post('/emails/send', { to: 'tess@buyer.test', subject: 'Pricing', body: 'Here is our pricing.', leadId: talker }).expect(201);
    await worker.drain(10);
    let runs = await runsOf(wf);
    expect(runs.map((r) => r.status)).toEqual(['WAITING', 'WAITING']);

    fixture.state.gmailMessages.push({ id: 'tess-reply', from: 'tess@buyer.test', to: 'rep@seller.test', subject: 'Re: Pricing', body: 'Thanks, looks good.', internalDate: Date.now() + 5000 });
    await http.post('/integrations/google/sync').expect(200);
    await asTenant(owner.tenantId, (tx) => tx.workflowExecution.updateMany({ where: { workflowId: wf, status: 'WAITING' }, data: { resumeAt: new Date(Date.now() - 1000) } }));
    await worker.drain(10);
    runs = await runsOf(wf);
    const byLead = async (id: string) => runs.find((r) => (r.context as { event: { entityId: string } }).event.entityId === id)!;
    // Quinn did not reply: the follow-up waits for a person's approval, because sending is external.
    expect((await byLead(quiet)).status).toBe('AWAITING_APPROVAL');
    expect((await byLead(talker)).status).toBe('SUCCEEDED');
    const approvals = (await http.get('/approvals?status=PENDING').expect(200)).body;
    expect(JSON.stringify(approvals)).toContain('quinn@buyer.test');
  });

  it('offers the sequence events as triggers and simulates one against a lead', async () => {
    const pia = (await http.get('/leads?search=Pia').expect(200)).body.items[0].id as string;
    const sim = (await http.post('/workflows/simulate', {
      definition: { trigger: { event: 'sequence.enrolled' }, start: 'a', nodes: [{ id: 'a', type: 'action', action: { type: 'add_engagement_points', points: 5 }, next: null }] },
      recordId: pia,
    }).expect(200)).body;
    expect(sim.triggerMatched).toBe(true);
    expect(JSON.stringify(sim.path)).toContain('Add 5 engagement points');
  });

  it('does not start a workflow for events that happened before it was switched on', async () => {
    const wf = (await http.post('/workflows', { name: 'Late events', definition: { trigger: { event: 'lead.created' }, start: 'n', nodes: [{ id: 'n', type: 'action', action: { type: 'log_note', subject: 'Seen' }, next: null }] } }).expect(201)).body.id as string;
    // The event is still in the outbox (not relayed yet) when the workflow is switched on.
    await lead('Early Bird', 'early@buyer.test');
    await http.patch(`/workflows/${wf}/status`, { status: 'ACTIVE' }).expect(200);
    const late = await lead('Late Comer', 'late@buyer.test');
    await worker.drain(10);
    const runs = await runsOf(wf);
    expect(runs).toHaveLength(1);
    expect((runs[0]!.context as { event: { entityId: string } }).event.entityId).toBe(late);
  });
});
