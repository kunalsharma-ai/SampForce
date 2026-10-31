import type { INestApplication } from '@nestjs/common';
import type { EmailAnalytics, EmailTemplateRow } from '@dealflow/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SequenceRunner } from '../src/sequences/sequence-runner.service';
import { startProviderFixture, providerEnv, type ProviderFixture } from './fixtures/provider-fixture';
import { api, asTenant, inviteMember, registerUser, startApp, type TestUser } from './helpers';

function decodeSent(body: string): { headers: string; text: string } {
  const mime = Buffer.from((JSON.parse(body) as { raw: string }).raw, 'base64url').toString();
  const [headers = '', ...rest] = mime.split('\r\n\r\n');
  const parts = rest.join('\r\n\r\n');
  const plain = parts.match(/Content-Type: text\/plain; charset="UTF-8"\r\nContent-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+)/)?.[1];
  return { headers, text: Buffer.from((plain ?? parts).replace(/\r\n/g, ''), 'base64').toString() };
}

const ALL_DAY = { sendDays: [0, 1, 2, 3, 4, 5, 6], sendStart: '00:00', sendEnd: '23:59', timezone: 'UTC', dailyLimit: 50, trackOpens: true, trackClicks: true };

/** Enhancement Phase 2b: template categories and campaigns, duplication, custom-field and workspace merge tags, and campaign analytics. */
describe('email templates, variables and analytics', () => {
  let app: INestApplication;
  let fixture: ProviderFixture;
  let runner: SequenceRunner;
  let owner: TestUser;
  let http: ReturnType<typeof api>;
  let campaignId: string;
  const saved: Record<string, string | undefined> = {};

  beforeAll(async () => {
    fixture = await startProviderFixture();
    for (const [k, v] of Object.entries(providerEnv(fixture.url))) {
      saved[k] = process.env[k];
      process.env[k] = v;
    }
    app = await startApp();
    runner = app.get(SequenceRunner);
    owner = await registerUser(app, 'Templaters');
    await asTenant(owner.tenantId, (tx) => tx.subscription.update({ where: { tenantId: owner.tenantId }, data: { planCode: 'growth', status: 'ACTIVE', seats: 20 } }));
    http = api(owner);
    const { url } = (await http.post('/integrations/google/connect').expect(200)).body;
    const state = new URL(url).searchParams.get('state')!;
    await http.get(`/integrations/google/callback?code=good-code&state=${encodeURIComponent(state)}`).expect(302);
    campaignId = (await http.post('/campaigns', { name: 'Autumn push', channel: 'email', status: 'ACTIVE' }).expect(201)).body.id;
  });

  afterAll(async () => {
    await app.close();
    await fixture.close();
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('refuses custom fields and variables that do not exist, and accepts them once they do', async () => {
    const tpl = { name: 'Regional', subject: 'News for {{custom.region}}', body: 'Book here: {{var.booking_link}}', category: 'Cold outreach', campaignId };
    const noField = await http.post('/email-templates', tpl).expect(400);
    expect(noField.body.error.code).toBe('UNKNOWN_MERGE_FIELD');
    expect(noField.body.error.message).toContain('{{custom.region}}');
    const badSyntax = await http.post('/email-templates', { ...tpl, subject: 'Hi {{contact.region}}' }).expect(400);
    expect(JSON.stringify(badSyntax.body)).toMatch(/Unknown merge field/);

    await http.post('/custom-fields', { entity: 'LEAD', key: 'region', label: 'Region', type: 'TEXT' }).expect(201);
    expect((await http.post('/email-templates', tpl).expect(400)).body.error.message).toContain('{{var.booking_link}}');
    await http.put('/email-variables', { key: 'booking_link', label: 'Booking link', value: 'https://cal.example.com/rep' }).expect(200);
    const row = (await http.post('/email-templates', tpl).expect(201)).body as EmailTemplateRow;
    expect(row).toMatchObject({ category: 'Cold outreach', campaign: { id: campaignId, name: 'Autumn push' } });

    // A campaign from another workspace is refused.
    const other = await registerUser(app, 'Elsewhere');
    const theirs = (await api(other).post('/campaigns', { name: 'Theirs', channel: 'email' }).expect(201)).body.id;
    await http.post('/email-templates', { ...tpl, name: 'Leak', campaignId: theirs }).expect(404);
  });

  it('previews custom fields and variables for a real lead, and lists the empty ones by tag', async () => {
    const lead = (await http.post('/leads', { fullName: 'Rhea North', email: 'rhea@buyer.test', customFields: { region: 'Nordics' } }).expect(201)).body.lead;
    const p = (await http.post('/email-templates/preview', { subject: 'News for {{custom.region}}', body: 'Book: {{var.booking_link}}', leadId: lead.id }).expect(200)).body;
    expect(p).toMatchObject({ subject: 'News for Nordics', body: 'Book: https://cal.example.com/rep', missing: [] });
    const empty = (await http.post('/leads', { fullName: 'No Region', email: 'none@buyer.test' }).expect(201)).body.lead;
    const q = (await http.post('/email-templates/preview', { subject: 'News for {{custom.region}}', body: 'x {{custom.region|your area}}', leadId: empty.id }).expect(200)).body;
    expect(q.missing).toEqual(['custom.region']);
    expect(q.body).toBe('x your area');
  });

  it('filters by category and campaign, lists categories, and duplicates as a private copy', async () => {
    await http.post('/email-templates', { name: 'Nudge', subject: 'Still there?', body: 'Just checking in.', category: 'Follow-up', shared: true }).expect(201);
    expect((await http.get('/email-templates/categories').expect(200)).body).toEqual(['Cold outreach', 'Follow-up']);
    const follow = (await http.get('/email-templates?category=Follow-up').expect(200)).body as EmailTemplateRow[];
    expect(follow.map((t) => t.name)).toEqual(['Nudge']);
    const inCampaign = (await http.get(`/email-templates?campaignId=${campaignId}`).expect(200)).body as EmailTemplateRow[];
    expect(inCampaign.map((t) => t.name)).toEqual(['Regional']);

    const copy = (await http.post(`/email-templates/${follow[0]!.id}/duplicate`).expect(201)).body as EmailTemplateRow;
    expect(copy).toMatchObject({ name: 'Nudge (copy)', shared: false, category: 'Follow-up', subject: 'Still there?' });
    expect(copy.id).not.toBe(follow[0]!.id);

    // A member can read shared templates but cannot duplicate one into a workspace they can only read.
    const viewer = await inviteMember(app, owner, 'viewer');
    await api(viewer).post(`/email-templates/${follow[0]!.id}/duplicate`).expect(403);
  });

  it('sends a sequence step with custom fields and variables filled in, and refuses to delete a variable in use', async () => {
    const seq = (await http.post('/sequences', {
      name: 'Regional outreach',
      steps: [{ id: 'one', type: 'email', delayDays: 0, subject: '{{first_name}}, news for {{custom.region}}', body: 'Pick a time: {{var.booking_link}}' }],
      rules: [],
      settings: ALL_DAY,
    }).expect(201)).body;
    await http.post(`/sequences/${seq.id}/status`, { status: 'ACTIVE' }).expect(200);
    const lead = (await http.post('/leads', { fullName: 'Sven Sky', email: 'sven@buyer.test', customFields: { region: 'Baltics' } }).expect(201)).body.lead;
    await http.post(`/sequences/${seq.id}/enroll`, { leadIds: [lead.id] }).expect(200);
    await asTenant(owner.tenantId, (tx) => tx.sequenceEnrollment.updateMany({ where: { status: 'ACTIVE' }, data: { nextRunAt: new Date(Date.now() - 1000) } }));
    await runner.runDue(100);
    const msgs = await asTenant(owner.tenantId, (tx) => tx.sequenceMessage.findMany({ where: { enrollment: { leadId: lead.id } } }));
    expect(msgs.map((m) => m.subject)).toEqual(['Sven, news for Baltics']);
    const mail = fixture.state.sent.map((x) => decodeSent(x.body)).find((m) => m.headers.includes('To: sven@buyer.test'))!;
    expect(mail.text).toContain('Pick a time: https://cal.example.com/rep');

    // A sequence cannot use a variable that does not exist.
    const bad = await http.post('/sequences', { name: 'Bad', steps: [{ id: 'one', type: 'email', delayDays: 0, subject: 'Hi', body: '{{var.nope}}' }], rules: [], settings: ALL_DAY }).expect(400);
    expect(bad.body.error.message).toContain('{{var.nope}}');

    const inUse = await http.del('/email-variables/booking_link').expect(409);
    expect(inUse.body.error.code).toBe('VARIABLE_IN_USE');
    await http.put('/email-variables', { key: 'office', label: 'Office', value: 'Riga' }).expect(200);
    await http.del('/email-variables/office').expect(204);
    expect(((await http.get('/email-variables').expect(200)).body as { key: string }[]).map((v) => v.key)).toEqual(['booking_link']);
  });

  it('reports results by sequence, mailbox, template and follow-up, with team results only for marketing managers', async () => {
    const tpl = (await http.post('/email-templates', { name: 'Opener', subject: 'Hello {{first_name|there}}', body: 'Short note.' }).expect(201)).body as EmailTemplateRow;
    const seq = (await http.post('/sequences', {
      name: 'Measured',
      steps: [
        { id: 'one', type: 'email', delayDays: 0, templateId: tpl.id },
        { id: 'two', type: 'email', delayDays: 0, subject: 'Following up', body: 'Any thoughts?' },
      ],
      rules: [],
      settings: ALL_DAY,
    }).expect(201)).body;
    await http.post(`/sequences/${seq.id}/status`, { status: 'ACTIVE' }).expect(200);
    const ids: string[] = [];
    for (const n of ['Ann', 'Bo', 'Cy']) ids.push((await http.post('/leads', { fullName: `${n} Metric`, email: `${n.toLowerCase()}@metric.test` }).expect(201)).body.lead.id);
    await http.post(`/sequences/${seq.id}/enroll`, { leadIds: ids }).expect(200);
    const due = () => asTenant(owner.tenantId, (tx) => tx.sequenceEnrollment.updateMany({ where: { status: 'ACTIVE', sequenceId: seq.id }, data: { nextRunAt: new Date(Date.now() - 1000) } }));
    await due();
    await runner.runDue(100);
    const first = await asTenant(owner.tenantId, (tx) => tx.sequenceMessage.findMany({ where: { enrollment: { sequenceId: seq.id } }, orderBy: { sentAt: 'asc' } }));
    expect(first).toHaveLength(3);
    await runner.record(owner.tenantId, first[0]!.id, 'OPENED');
    await runner.record(owner.tenantId, first[1]!.id, 'BOUNCED');
    await due();
    await runner.runDue(100);

    const a = (await http.get('/sequences/analytics?days=30').expect(200)).body as EmailAnalytics;
    const s = a.bySequence.find((x) => x.id === seq.id)!;
    expect(s).toMatchObject({ name: 'Measured', sent: 5, opened: 1, bounced: 1, enrolled: 3, abTested: false });
    expect(s.bounceRate).toBeCloseTo(1 / 5);
    expect(a.byMailbox).toEqual([expect.objectContaining({ mailbox: expect.stringContaining('@') })]);
    expect(a.byTemplate.find((t) => t.id === tpl.id)).toMatchObject({ name: 'Opener', sent: 3, opened: 1, bounced: 1 });
    const pos = a.byStepPosition.map((p) => [p.position, p.sent]);
    expect(pos[0]).toEqual([1, expect.any(Number)]);
    expect(a.byStepPosition.find((p) => p.position === 2)?.sent).toBeGreaterThanOrEqual(2);
    expect(a.totals.sent).toBeGreaterThanOrEqual(5);

    await http.get('/sequences/analytics?days=0').expect(400);
    const rep = await inviteMember(app, owner, 'member');
    const mine = (await api(rep).get('/sequences/analytics').expect(200)).body as EmailAnalytics;
    expect(mine.totals.sent).toBe(0);
    expect(mine.bySequence.find((x) => x.id === seq.id)).toBeUndefined();
    await api(rep).get('/sequences/analytics?scope=team').expect(403);
    const team = (await http.get('/sequences/analytics?scope=team').expect(200)).body as EmailAnalytics;
    expect(team.totals.sent).toBe(a.totals.sent);
  });
});
