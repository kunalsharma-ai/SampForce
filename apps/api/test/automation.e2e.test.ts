import type { INestApplication } from '@nestjs/common';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WorkerService } from '../src/worker/worker.service';
import { api, asTenant, inviteMember, registerUser, startApp, type TestUser } from './helpers';

/** Acceptance test 5: workflows start from CRM events, branch, wait, ask for approval and act. */
describe('automation workflows', () => {
  let app: INestApplication;
  let worker: WorkerService;
  let owner: TestUser;
  let http: ReturnType<typeof api>;
  let ownerId: string;
  let hookServer: Server;
  let hookUrl: string;
  const hookCalls: { headers: Record<string, unknown>; body: string }[] = [];

  beforeAll(async () => {
    app = await startApp();
    worker = app.get(WorkerService);
    owner = await registerUser(app, 'Automators');
    http = api(owner);
    ownerId = (await http.get('/auth/me').expect(200)).body.user.id;
    await asTenant(owner.tenantId, (tx) => tx.subscription.update({ where: { tenantId: owner.tenantId }, data: { planCode: 'growth' } }));
    hookServer = createServer((req, res) => {
      let body = '';
      req.on('data', (c: Buffer) => (body += c.toString()));
      req.on('end', () => {
        hookCalls.push({ headers: req.headers, body });
        res.writeHead(200).end('ok');
      });
    });
    await new Promise<void>((r) => hookServer.listen(0, '127.0.0.1', r));
    hookUrl = `http://127.0.0.1:${(hookServer.address() as AddressInfo).port}/hook`;
  });

  afterAll(async () => {
    await app.close();
    await new Promise((r) => hookServer.close(r));
  });

  const makeDue = (tenantId: string) =>
    asTenant(tenantId, (tx) => tx.workflowExecution.updateMany({ where: { status: 'WAITING' }, data: { resumeAt: new Date(Date.now() - 1000) } }));

  it('runs a branching workflow with a delay when a qualifying lead is created', async () => {
    const wf = (
      await http
        .post('/workflows', {
          name: 'Hot lead follow-up',
          definition: {
            trigger: { event: 'lead.created', conditions: { match: 'all', rules: [{ field: 'record.estimatedValue', op: 'gte', value: 50000 }] } },
            start: 'task',
            nodes: [
              { id: 'task', type: 'action', action: { type: 'create_task', title: 'Call {{record.fullName}} today', dueInDays: 1 }, next: 'tag' },
              { id: 'tag', type: 'action', action: { type: 'add_tag', tag: 'hot' }, next: 'wait' },
              { id: 'wait', type: 'delay', amount: 2, unit: 'days', next: 'check' },
              {
                id: 'check',
                type: 'condition',
                condition: { match: 'all', rules: [{ field: 'record.status', op: 'eq', value: 'NEW' }] },
                onTrue: 'nudge',
                onFalse: null,
              },
              { id: 'nudge', type: 'action', action: { type: 'log_note', subject: 'Still new after two days' }, next: null },
            ],
          },
        })
        .expect(201)
    ).body;
    expect(wf).toMatchObject({ status: 'DRAFT', version: 1, triggerType: 'lead.created' });

    // Draft workflows do not run.
    await http.post('/leads', { fullName: 'Before Activation', estimatedValue: 90000 }).expect(201);
    await worker.drain();
    expect((await http.get('/workflows/executions').expect(200)).body).toHaveLength(0);

    await http.patch(`/workflows/${wf.id}/status`, { status: 'ACTIVE' }).expect(200);
    const big = (await http.post('/leads', { fullName: 'Ada Big', estimatedValue: 90000 }).expect(201)).body.lead;
    const small = (await http.post('/leads', { fullName: 'Sam Small', estimatedValue: 100 }).expect(201)).body.lead;
    await worker.drain();

    const runs = (await http.get(`/workflows/executions?workflowId=${wf.id}`).expect(200)).body;
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ status: 'WAITING', entityId: big.id, version: 1 });
    expect(runs[0].steps.map((s: { nodeId: string }) => s.nodeId)).toEqual(['task', 'tag', 'wait']);
    expect(new Date(runs[0].resumeAt).getTime()).toBeGreaterThan(Date.now() + 47 * 3_600_000);

    const tasks = (await http.get(`/tasks?scope=all&status=OPEN&leadId=${big.id}`).expect(200)).body;
    expect(tasks.map((t: { title: string }) => t.title)).toEqual(['Call Ada Big today']);
    expect(tasks[0].assignee.id).toBe(ownerId);
    expect((await http.get(`/leads/${big.id}`).expect(200)).body.tags).toEqual(['hot']);
    expect((await http.get(`/tasks?scope=all&status=OPEN&leadId=${small.id}`).expect(200)).body).toHaveLength(0);

    // The audit log attributes the change to the automation, not the person.
    const audit = (await http.get('/audit-logs?limit=50').expect(200)).body.items;
    const created = audit.find((a: { action: string; actorType: string }) => a.action === 'task.created');
    expect(created).toMatchObject({ actorType: 'SYSTEM' });
    expect(created.metadata).toMatchObject({ workflowId: wf.id });

    // Edits create a new version; the waiting run finishes on the version it started with.
    const v2 = (await http.put(`/workflows/${wf.id}`, { name: 'Hot lead follow-up v2', definition: { ...wf.definition, start: 'task' } }).expect(200)).body;
    expect(v2.version).toBe(2);
    expect((await http.get(`/workflows/${wf.id}/versions`).expect(200)).body.map((v: { version: number }) => v.version)).toEqual([2, 1]);

    await makeDue(owner.tenantId);
    await worker.drain();
    const done = (await http.get(`/workflows/executions?workflowId=${wf.id}`).expect(200)).body[0];
    expect(done).toMatchObject({ status: 'SUCCEEDED', version: 1 });
    expect(done.steps.map((s: { nodeId: string }) => s.nodeId)).toEqual(['task', 'tag', 'wait', 'check', 'nudge']);
    const notes = (await http.get(`/activities?leadId=${big.id}`).expect(200)).body.items;
    expect(notes.map((n: { subject: string }) => n.subject)).toContain('Still new after two days');
    expect((await http.get('/workflows').expect(200)).body[0]).toMatchObject({ runs30d: 1, failures30d: 0 });
  });

  it('simulates a workflow against a real record without changing anything', async () => {
    const lead = (await http.post('/leads', { fullName: 'Sim Target', estimatedValue: 75000 }).expect(201)).body.lead;
    const definition = {
      trigger: { event: 'lead.created', conditions: { match: 'all', rules: [{ field: 'record.estimatedValue', op: 'gt', value: 50000 }] } },
      start: 'gate',
      nodes: [
        { id: 'gate', type: 'approval', title: 'Manager check', next: 'mail' },
        { id: 'mail', type: 'action', action: { type: 'send_email', subject: 'Hello', body: 'Hi there' }, next: 'wait' },
        { id: 'wait', type: 'delay', amount: 1, unit: 'hours', next: 'note' },
        { id: 'note', type: 'action', action: { type: 'log_note', subject: 'Welcomed' }, next: null },
      ],
    };
    const sim = (await http.post('/workflows/simulate', { definition, recordId: lead.id }).expect(200)).body;
    expect(sim.triggerMatched).toBe(true);
    expect(sim.ended).toBe('completed');
    expect(sim.path.map((p: { nodeId: string; outcome: string }) => [p.nodeId, p.outcome])).toEqual([
      ['gate', 'simulated'],
      ['mail', 'simulated'],
      ['wait', 'simulated'],
      ['note', 'simulated'],
    ]);
    expect(sim.path[1].detail).toContain('Email the record');

    const miss = (await http.post('/workflows/simulate', { definition: { ...definition, trigger: { ...definition.trigger, conditions: { match: 'all', rules: [{ field: 'record.estimatedValue', op: 'lt', value: 10 }] } } }, recordId: lead.id }).expect(200)).body;
    expect(miss).toMatchObject({ triggerMatched: false, ended: 'trigger_not_matched' });
    expect((await http.get(`/tasks?scope=all&status=OPEN&leadId=${lead.id}`).expect(200)).body).toHaveLength(0);
  });

  it('pauses for approval before an external action and only acts once approved', async () => {
    const wf = (
      await http
        .post('/workflows', {
          name: 'Tell finance about wins',
          definition: {
            trigger: { event: 'deal.won' },
            start: 'gate',
            nodes: [
              { id: 'gate', type: 'approval', title: 'Confirm the win is real', next: 'hook', onReject: null },
              { id: 'hook', type: 'action', action: { type: 'send_webhook', url: hookUrl }, next: null },
            ],
          },
        })
        .expect(201)
    ).body;
    await http.patch(`/workflows/${wf.id}/status`, { status: 'ACTIVE' }).expect(200);

    const pipeline = (await http.get('/pipelines').expect(200)).body.find((p: { isDefault: boolean }) => p.isDefault);
    const won = pipeline.stages.find((s: { category: string }) => s.category === 'WON');
    const deal = (await http.post('/deals', { name: 'Big Win', amount: 1000 }).expect(201)).body;
    await http.post(`/deals/${deal.id}/move`, { stageId: won.id }).expect(200);
    await worker.drain();

    let run = (await http.get(`/workflows/executions?workflowId=${wf.id}`).expect(200)).body[0];
    expect(run.status).toBe('AWAITING_APPROVAL');
    let pending = (await http.get('/approvals').expect(200)).body;
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ kind: 'workflow.approval_step', title: 'Confirm the win is real', workflow: { id: wf.id } });
    const inbox = (await http.get('/notifications').expect(200)).body;
    expect(inbox.items.some((n: { type: string }) => n.type === 'approval.requested')).toBe(true);

    await http.post(`/approvals/${pending[0].id}/decision`, { decision: 'approve' }).expect(200);
    await http.post(`/approvals/${pending[0].id}/decision`, { decision: 'approve' }).expect(409);
    await worker.drain();

    // Approving the step does not approve the external call: that needs its own decision.
    run = (await http.get(`/workflows/executions?workflowId=${wf.id}`).expect(200)).body[0];
    expect(run.status).toBe('AWAITING_APPROVAL');
    pending = (await http.get('/approvals').expect(200)).body;
    expect(pending[0]).toMatchObject({ kind: 'workflow.send_webhook' });
    expect(hookCalls).toHaveLength(0);

    await http.post(`/approvals/${pending[0].id}/decision`, { decision: 'approve', note: 'ok' }).expect(200);
    await worker.drain();
    run = (await http.get(`/workflows/executions?workflowId=${wf.id}`).expect(200)).body[0];
    expect(run.status).toBe('SUCCEEDED');
    expect(hookCalls).toHaveLength(1);
    expect(JSON.parse(hookCalls[0]!.body)).toMatchObject({ workflowId: wf.id, entityType: 'deal', entityId: deal.id, record: { name: 'Big Win' } });
    expect((await http.get('/approvals?status=DECIDED').expect(200)).body).toHaveLength(2);
  });

  it('cancels the run when an external action is rejected', async () => {
    const wf = (
      await http
        .post('/workflows', {
          name: 'Ping on new company',
          definition: { trigger: { event: 'company.created' }, start: 'hook', nodes: [{ id: 'hook', type: 'action', action: { type: 'send_webhook', url: hookUrl }, next: null }] },
        })
        .expect(201)
    ).body;
    await http.patch(`/workflows/${wf.id}/status`, { status: 'ACTIVE' }).expect(200);
    await http.post('/companies', { name: 'Rejected Co' }).expect(201);
    await worker.drain();
    const approval = (await http.get('/approvals').expect(200)).body.find((a: { workflow: { id: string } }) => a.workflow.id === wf.id);
    await http.post(`/approvals/${approval.id}/decision`, { decision: 'reject' }).expect(200);
    await worker.drain();
    const run = (await http.get(`/workflows/executions?workflowId=${wf.id}`).expect(200)).body[0];
    expect(run).toMatchObject({ status: 'CANCELED', error: 'The action was rejected.' });
    expect(hookCalls).toHaveLength(1);
    await http.patch(`/workflows/${wf.id}/status`, { status: 'PAUSED' }).expect(200);
  });

  it('stops workflows that keep triggering each other', async () => {
    const t = await registerUser(app, 'Loopers');
    const h = api(t);
    const make = async (name: string, field: string, value: string) => {
      const wf = (
        await h
          .post('/workflows', {
            name,
            definition: { trigger: { event: 'lead.updated' }, start: 'set', nodes: [{ id: 'set', type: 'action', action: { type: 'update_field', field, value }, next: null }] },
          })
          .expect(201)
      ).body;
      await h.patch(`/workflows/${wf.id}/status`, { status: 'ACTIVE' }).expect(200);
    };
    await make('Set source', 'source', 'Automation');
    await make('Set industry', 'industry', 'Software');
    const lead = (await h.post('/leads', { fullName: 'Ping Pong' }).expect(201)).body.lead;
    await h.patch(`/leads/${lead.id}`, { city: 'Pune' }).expect(200);
    await worker.drain(30);

    const runs = (await h.get('/workflows/executions?limit=100').expect(200)).body;
    // Events at depth 0..5 may start runs (two workflows each); deeper events start nothing.
    expect(runs.length).toBeGreaterThan(2);
    expect(runs.length).toBeLessThanOrEqual(12);
    const notes = await asTenant(t.tenantId, (tx) => tx.domainEvent.findMany({ where: { lastError: { contains: 'depth limit' } } }));
    expect(notes.length).toBeGreaterThan(0);
    expect((await h.get(`/leads/${lead.id}`).expect(200)).body).toMatchObject({ source: 'Automation', industry: 'Software' });
  });

  it('fails the run with a clear reason when the owner loses permission', async () => {
    const manager = await inviteMember(app, owner, 'manager');
    const m = api(manager);
    const wf = (
      await m
        .post('/workflows', {
          name: 'Manager flow',
          definition: { trigger: { event: 'contact.created' }, start: 'n', nodes: [{ id: 'n', type: 'action', action: { type: 'notify', to: 'record_owner', title: 'New contact' }, next: null }] },
        })
        .expect(201)
    ).body;
    await m.patch(`/workflows/${wf.id}/status`, { status: 'ACTIVE' }).expect(200);
    const members = (await http.get('/tenants/current/members').expect(200)).body;
    const membership = members.find((x: { userId: string }) => x.userId === manager.userId);
    await http.patch(`/tenants/current/members/${membership.membershipId}/role`, { roleKey: 'member' }).expect(200);

    await http.post('/contacts', { firstName: 'Perm', lastName: 'Check' }).expect(201);
    await worker.drain();
    const run = (await http.get(`/workflows/executions?workflowId=${wf.id}`).expect(200)).body[0];
    expect(run.status).toBe('FAILED');
    expect(run.error).toMatch(/no longer an active member with permission/);
  });

  it('requires automation permission and keeps workflows inside the tenant', async () => {
    const member = await inviteMember(app, owner, 'member');
    await api(member).get('/workflows').expect(403);
    await api(member).get('/approvals').expect(403);

    const other = await registerUser(app, 'Outsiders');
    const o = api(other);
    const mine = (await http.get('/workflows').expect(200)).body[0];
    await o.get(`/workflows/${mine.id}`).expect(404);
    await o.put(`/workflows/${mine.id}`, { name: 'x', definition: mine.definition }).expect(404);
    await o.patch(`/workflows/${mine.id}/status`, { status: 'PAUSED' }).expect(404);
    expect((await o.get('/workflows').expect(200)).body).toEqual([]);
    expect((await o.get('/workflows/executions').expect(200)).body).toEqual([]);
    const decided = (await http.get('/approvals?status=DECIDED').expect(200)).body[0];
    await o.post(`/approvals/${decided.id}/decision`, { decision: 'approve' }).expect(404);

    // A workflow may not reference people outside the workspace.
    const outsiderId = (await o.get('/auth/me').expect(200)).body.user.id;
    await http
      .post('/workflows', {
        name: 'Bad assignee',
        definition: { trigger: { event: 'lead.created' }, start: 'a', nodes: [{ id: 'a', type: 'action', action: { type: 'assign_owner', mode: 'user', userIds: [outsiderId] }, next: null }] },
      })
      .expect(400);
  });
});
