import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// The six scenario templates exactly as the Automation Studio offers them to people.
import { EMAIL_TEMPLATES } from '../../web/src/app/app/automation/workflow-model';
import { SequenceRunner } from '../src/sequences/sequence-runner.service';
import { WorkerService } from '../src/worker/worker.service';
import { type FinderFixture, startFinderFixture } from './fixtures/finder-fixture';
import { providerEnv, type ProviderFixture, startProviderFixture } from './fixtures/provider-fixture';
import { api, asTenant, registerUser, startApp, type TestUser } from './helpers';

const ALL_DAY = { sendDays: [0, 1, 2, 3, 4, 5, 6], sendStart: '00:00', sendEnd: '23:59', timezone: 'UTC', dailyLimit: 500, trackOpens: true, trackClicks: true };
const EXT_ORIGIN = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';

function setEnv(vars: Record<string, string | undefined>): () => void {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return () => setEnv(saved);
}

/**
 * The spec's email automation scenarios 1 to 6, plus a seventh that crosses Part 2, run together on one workspace
 * with all six shipped templates switched on at once (as a customer would), a connected mailbox (Google stand-in)
 * and the Apollo stand-in. Events arrive the way they do in production: sending, mailbox sync, tracking.
 */
describe('the seven scenarios on one workspace, with the shipped templates', () => {
  let app: INestApplication;
  let mail: ProviderFixture;
  let finder: FinderFixture;
  let runner: SequenceRunner;
  let worker: WorkerService;
  let owner: TestUser;
  let http: ReturnType<typeof api>;
  let restore: () => void;
  let seq: string;
  const wf: Record<string, string> = {};
  let syncAt = Date.now();

  const lead = async (fullName: string, email: string) => (await http.post('/leads', { fullName, email, companyName: `${fullName.split(' ')[1]} Co` }).expect(201)).body.lead.id as string;
  const drain = async () => {
    for (let i = 0; i < 5; i++) await worker.drain(20);
  };
  const sendDue = async () => {
    await asTenant(owner.tenantId, (tx) => tx.sequenceEnrollment.updateMany({ where: { status: 'ACTIVE' }, data: { nextRunAt: new Date(Date.now() - 1000) } }));
    await runner.runDue(500);
    await drain();
  };
  const inbound = async (m: { id: string; from: string; subject: string; body: string }) => {
    syncAt += 1000;
    mail.state.gmailMessages.push({ ...m, to: 'rep@seller.test', internalDate: syncAt + 60_000 });
    await http.post('/integrations/google/sync').expect(200);
    await drain();
  };
  const messages = (leadId: string) => asTenant(owner.tenantId, (tx) => tx.sequenceMessage.findMany({ where: { enrollment: { leadId } }, orderBy: { sentAt: 'asc' } }));
  const tasksFor = async (leadId: string) => {
    const r = (await http.get(`/tasks?leadId=${leadId}&scope=all`).expect(200)).body;
    return (Array.isArray(r) ? r : r.items) as { title: string; priority: string }[];
  };
  const runsOf = (key: string) => asTenant(owner.tenantId, (tx) => tx.workflowExecution.findMany({ where: { workflowId: wf[key] }, orderBy: { startedAt: 'asc' } }));
  const entityOf = (r: { context: unknown }) => (r.context as { event: { entityId: string } }).event.entityId;
  const notificationTitles = async () => {
    const n = (await http.get('/notifications').expect(200)).body;
    return ((Array.isArray(n) ? n : n.items) as { title: string }[]).map((x) => x.title);
  };

  beforeAll(async () => {
    mail = await startProviderFixture();
    finder = await startFinderFixture();
    restore = setEnv({ ...providerEnv(mail.url), APOLLO_API_KEY: 'apollo-test-key', APOLLO_API_BASE_URL: `${finder.url}/apollo`, HUNTER_API_KEY: undefined, PROSPECT_DAILY_LIMIT: '100' });
    app = await startApp();
    runner = app.get(SequenceRunner);
    worker = app.get(WorkerService);
    owner = await registerUser(app, 'Scenario Freight');
    await asTenant(owner.tenantId, (tx) => tx.subscription.update({ where: { tenantId: owner.tenantId }, data: { planCode: 'growth', status: 'ACTIVE', seats: 20 } }));
    http = api(owner);
    const { url } = (await http.post('/integrations/google/connect').expect(200)).body;
    await http.get(`/integrations/google/callback?code=good-code&state=${encodeURIComponent(new URL(url).searchParams.get('state')!)}`).expect(302);

    // All six templates, saved and switched on exactly as shipped.
    expect(EMAIL_TEMPLATES.map((t) => t.key)).toEqual(['email-no-reply', 'email-proposal-click', 'email-replied', 'email-bounced', 'email-unsubscribed', 'email-engaged']);
    for (const t of EMAIL_TEMPLATES) {
      const w = (await http.post('/workflows', { name: t.name, definition: t.definition }).expect(201)).body;
      await http.patch(`/workflows/${w.id}/status`, { status: 'ACTIVE' }).expect(200);
      wf[t.key] = w.id;
    }
    const s = (await http.post('/sequences', {
      name: 'Q4 carriers outreach',
      steps: [
        { id: 'one', type: 'email', delayDays: 0, subject: 'Hello {{first_name|there}}', body: 'Our proposal: https://example.com/proposal/42 and our site https://example.com/' },
        { id: 'two', type: 'email', delayDays: 2, subject: 'Following up', body: 'Case study: https://example.com/case-study' },
        { id: 'three', type: 'email', delayDays: 3, subject: 'Last note', body: 'Should I close the file?' },
      ],
      settings: ALL_DAY,
    }).expect(201)).body;
    await http.post(`/sequences/${s.id}/status`, { status: 'ACTIVE' }).expect(200);
    seq = s.id;
  });

  afterAll(async () => {
    await app.close();
    await mail.close();
    await finder.close();
    restore();
  });

  it('1. no reply within three days: a follow-up is prepared and sent after approval; someone who replied gets none', async () => {
    const quinn = await lead('Quinn Quiet', 'quinn@buyer.test');
    const tess = await lead('Tess Talker', 'tess@buyer.test');
    await http.post('/emails/send', { to: 'quinn@buyer.test', subject: 'Pricing', body: 'Here is our pricing.', leadId: quinn }).expect(201);
    await http.post('/emails/send', { to: 'tess@buyer.test', subject: 'Pricing', body: 'Here is our pricing.', leadId: tess }).expect(201);
    await drain();
    expect((await runsOf('email-no-reply')).map((r) => r.status)).toEqual(['WAITING', 'WAITING']);

    await inbound({ id: 'tess-reply', from: 'tess@buyer.test', subject: 'Re: Pricing', body: 'Thanks, looks good.' });
    // Three days pass.
    await asTenant(owner.tenantId, (tx) => tx.workflowExecution.updateMany({ where: { workflowId: wf['email-no-reply'], status: 'WAITING' }, data: { resumeAt: new Date(Date.now() - 1000) } }));
    await drain();
    const runs = await runsOf('email-no-reply');
    expect(runs.find((r) => entityOf(r) === tess)!.status).toBe('SUCCEEDED');
    expect(runs.find((r) => entityOf(r) === quinn)!.status).toBe('AWAITING_APPROVAL');

    const sentBefore = mail.state.sent.length;
    const pending = (await http.get('/approvals?status=PENDING').expect(200)).body as { id: string }[];
    expect(pending).toHaveLength(1);
    await http.post(`/approvals/${pending[0]!.id}/decision`, { decision: 'approve' }).expect(200);
    await drain();
    expect((await runsOf('email-no-reply')).find((r) => entityOf(r) === quinn)!.status).toBe('SUCCEEDED');
    expect(mail.state.sent.length).toBe(sentBefore + 1);
    expect(Buffer.from(JSON.parse(mail.state.sent.at(-1)!.body).raw, 'base64url').toString()).toMatch(/Subject: Re: Pricing[\s\S]*quinn@buyer\.test|quinn@buyer\.test[\s\S]*Subject: Re: Pricing/);
  });

  it('2. a click on the proposal link creates a high-priority task for the owner; other links do not', async () => {
    const pia = await lead('Pia Proposal', 'pia@buyer.test');
    await http.post(`/sequences/${seq}/enroll`, { leadIds: [pia] }).expect(200);
    await sendDue();
    const [m] = await messages(pia);
    await runner.record(owner.tenantId, m!.id, 'CLICKED', 'https://example.com/');
    await drain();
    expect((await runsOf('email-proposal-click')).filter((r) => entityOf(r) === pia)).toHaveLength(0);
    await asTenant(owner.tenantId, (tx) => tx.sequenceEnrollment.updateMany({ where: { leadId: pia }, data: { nextRunAt: new Date(Date.now() - 1000) } }));
    await runner.runDue(500);
    const [, m2] = await messages(pia);
    await runner.record(owner.tenantId, m2!.id, 'CLICKED', 'https://example.com/proposal/42');
    await drain();
    expect((await runsOf('email-proposal-click')).filter((r) => entityOf(r) === pia).map((r) => r.status)).toEqual(['SUCCEEDED']);
    expect(await tasksFor(pia)).toContainEqual(expect.objectContaining({ title: 'Call Pia Proposal: they opened the proposal link', priority: 'HIGH' }));
  });

  it('3. a reply stops the rest of the sequence and notifies the owner', async () => {
    const rey = await lead('Rey Replier', 'rey@buyer.test');
    await http.post(`/sequences/${seq}/enroll`, { leadIds: [rey] }).expect(200);
    await sendDue();
    expect(await messages(rey)).toHaveLength(1);
    await inbound({ id: 'rey-reply', from: 'rey@buyer.test', subject: 'Re: Hello Rey', body: 'Interested, call me.' });
    expect((await runsOf('email-replied')).filter((r) => entityOf(r) === rey).map((r) => r.status)).toEqual(['SUCCEEDED']);
    const e = await asTenant(owner.tenantId, (tx) => tx.sequenceEnrollment.findFirstOrThrow({ where: { leadId: rey } }));
    // The sequence's own reply handling marks the run REPLIED; the workflow stops anything still live.
    expect(['REPLIED', 'STOPPED']).toContain(e.status);
    expect(e.repliedAt).not.toBeNull();
    await sendDue();
    expect(await messages(rey)).toHaveLength(1);
    expect(await notificationTitles()).toContain('Rey Replier replied');
  });

  it('4. a bounce stops sending to the address and flags the record for verification', async () => {
    const bo = await lead('Bo Bounce', 'bo@gone.test');
    await http.post(`/sequences/${seq}/enroll`, { leadIds: [bo] }).expect(200);
    await sendDue();
    await inbound({ id: 'bo-bounce', from: 'mailer-daemon@googlemail.com', subject: 'Delivery Status Notification (Failure)', body: "Your message wasn't delivered to bo@gone.test because the address couldn't be found." });
    expect((await runsOf('email-bounced')).filter((r) => entityOf(r) === bo).map((r) => r.status)).toEqual(['SUCCEEDED']);
    expect((await http.get(`/leads/${bo}`).expect(200)).body.emailStatus).toBe('needs_verification');
    expect((await tasksFor(bo)).map((t) => t.title)).toContain('Find a working email address for Bo Bounce');
    const e = await asTenant(owner.tenantId, (tx) => tx.sequenceEnrollment.findFirstOrThrow({ where: { leadId: bo } }));
    expect(e.status).not.toBe('ACTIVE');
    await sendDue();
    expect(await messages(bo)).toHaveLength(1);
  });

  it('5. an unsubscribe suppresses the address from all further sequence and marketing email at once', async () => {
    const uma = await lead('Uma Unsub', 'uma@buyer.test');
    await http.post(`/sequences/${seq}/enroll`, { leadIds: [uma] }).expect(200);
    await sendDue();
    const [m] = await messages(uma);
    await runner.record(owner.tenantId, m!.id, 'UNSUBSCRIBED');
    // Before any workflow runs, the address is already suppressed.
    expect((await asTenant(owner.tenantId, (tx) => tx.sequenceEnrollment.findFirstOrThrow({ where: { leadId: uma } }))).status).toBe('UNSUBSCRIBED');
    expect((await http.get(`/leads/${uma}`).expect(200)).body.marketingConsent).toBe('OPTED_OUT');
    await drain();
    expect((await runsOf('email-unsubscribed')).filter((r) => entityOf(r) === uma).map((r) => r.status)).toEqual(['SUCCEEDED']);
    expect(await notificationTitles()).toContain('Uma Unsub unsubscribed');
    expect((await http.post(`/sequences/${seq}/enroll`, { leadIds: [uma] }).expect(200)).body.enrolled).toBe(0);
    await sendDue();
    expect(await messages(uma)).toHaveLength(1);
  });

  it('6. clicks across several emails without a reply raise the engagement score and create one follow-up', async () => {
    const eve = await lead('Eve Engaged', 'eve@buyer.test');
    await http.post(`/sequences/${seq}/enroll`, { leadIds: [eve] }).expect(200);
    await sendDue();
    await asTenant(owner.tenantId, (tx) => tx.sequenceEnrollment.updateMany({ where: { leadId: eve }, data: { nextRunAt: new Date(Date.now() - 1000) } }));
    await runner.runDue(500);
    const [m1, m2] = await messages(eve);
    await runner.record(owner.tenantId, m1!.id, 'OPENED');
    await runner.record(owner.tenantId, m1!.id, 'CLICKED', 'https://example.com/');
    await drain();
    expect((await http.get(`/leads/${eve}`).expect(200)).body.engagementScore).toBe(10);
    expect((await tasksFor(eve)).map((t) => t.title)).not.toContain('Reach out personally to Eve Engaged: engaged but no reply');
    await runner.record(owner.tenantId, m2!.id, 'CLICKED', 'https://example.com/case-study');
    await drain();
    expect((await http.get(`/leads/${eve}`).expect(200)).body.engagementScore).toBe(20);
    expect((await tasksFor(eve)).filter((t) => t.title === 'Reach out personally to Eve Engaged: engaged but no reply')).toEqual([expect.objectContaining({ priority: 'HIGH' })]);
    const next = (await http.get('/next-actions').expect(200)).body as { items: { kind: string; record: { id: string }; reason: string }[] };
    expect(next.items.find((i) => i.kind === 'engaged_no_reply' && i.record.id === eve)?.reason).toMatch(/estimate/);
  });

  it('7. a prospect found from the extension goes to a list, into the CRM and a sequence, and their reply ends the outreach', async () => {
    const login = (await request(app.getHttpServer()).post('/api/v1/extension/login').set('origin', EXT_ORIGIN).send({ email: owner.email, password: owner.password }).expect(200)).body;
    const ext = (path: string, body: object) => request(app.getHttpServer()).post(`/api/v1${path}`).set('authorization', `Bearer ${login.token}`).set('origin', EXT_ORIGIN).send(body);
    const found = (await ext('/extension/prospects/discover', { domain: 'www.bluefin-logistics.com' }).expect(200)).body;
    expect(found).toMatchObject({ mode: 'live' });
    const saved = (await ext('/extension/prospects/import', { people: found.people, destination: { type: 'new_list', name: 'Bluefin' }, sourceUrl: 'https://bluefin-logistics.com/team' }).expect(200)).body;
    expect(saved.results.map((r: { outcome: string }) => r.outcome)).toEqual(['added', 'added', 'added']);

    const listId = saved.destination.id as string;
    const rows = (await http.get(`/prospect-lists/${listId}?sort=name`).expect(200)).body.prospects as { id: string; fullName: string; email: string | null }[];
    expect(rows.map((r) => [r.fullName, r.email])).toEqual([['Ana Lima', 'ana.lima@bluefin-logistics.com'], ['Dev Kapoor', 'dev.kapoor@bluefin-logistics.com'], ['Ruth Okon', null]]);
    const crm = (await http.post('/prospects/to-crm', { prospectIds: rows.map((r) => r.id), sequenceId: seq }).expect(200)).body;
    expect(crm.enrollment.enrolled).toBe(2);
    await sendDue();
    const ana = ((await http.get(`/prospect-lists/${listId}?sort=name`).expect(200)).body.prospects as { fullName: string; crm: { type: string; id: string } }[]).find((p) => p.fullName === 'Ana Lima')!;
    expect(ana.crm).toMatchObject({ type: 'lead' });
    expect(await messages(ana.crm.id)).toHaveLength(1);

    await inbound({ id: 'ana-reply', from: 'ana.lima@bluefin-logistics.com', subject: 'Re: Hello Ana', body: 'Yes, send pricing.' });
    expect((await runsOf('email-replied')).filter((r) => entityOf(r) === ana.crm.id).map((r) => r.status)).toEqual(['SUCCEEDED']);
    expect((await asTenant(owner.tenantId, (tx) => tx.sequenceEnrollment.findFirstOrThrow({ where: { leadId: ana.crm.id } }))).status).toBe('REPLIED');
    await sendDue();
    expect(await messages(ana.crm.id)).toHaveLength(1);
    expect(await notificationTitles()).toContain('Ana Lima replied');
    const perf = (await http.get(`/prospect-lists/${listId}/performance`).expect(200)).body;
    // Ana's run ended at her reply; Dev had no reply, so his second step went out.
    expect(perf.sequences).toEqual([expect.objectContaining({ sequence: { id: seq, name: 'Q4 carriers outreach' }, enrolled: 2, active: 1, sent: 3, replied: 1 })]);
    // Mock Mode is not involved here, and nothing was guessed: Ruth had no address, so she was neither emailed nor enrolled.
    expect(crm.results.map((r: { outcome: string }) => r.outcome)).toEqual(['added', 'added', 'added']);
    const ruth = await asTenant(owner.tenantId, (tx) => tx.lead.findFirstOrThrow({ where: { fullName: 'Ruth Okon' } }));
    expect(ruth.email).toBeNull();
    expect(await messages(ruth.id)).toHaveLength(0);
  });
});
