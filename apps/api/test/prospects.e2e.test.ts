import type { INestApplication } from '@nestjs/common';
import { Workbook } from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SequenceRunner } from '../src/sequences/sequence-runner.service';
import { type FinderFixture, startFinderFixture } from './fixtures/finder-fixture';
import { providerEnv, type ProviderFixture, startProviderFixture } from './fixtures/provider-fixture';
import { api, asTenant, inviteMember, registerUser, startApp, type TestUser } from './helpers';

const ORIGIN = 'http://localhost:3000';

function setEnv(vars: Record<string, string | undefined>): () => void {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return () => setEnv(saved);
}

function upload(user: TestUser, listId: string, name: string, data: Buffer, type: string) {
  return user.agent.post(`/api/v1/prospect-lists/${listId}/import?name=${encodeURIComponent(name)}`).set('origin', ORIGIN).set('content-type', type).send(data);
}

describe('prospect lists (Mock Mode, no provider keys)', () => {
  let app: INestApplication;
  let owner: TestUser;
  let http: ReturnType<typeof api>;
  let restore: () => void;
  let listId: string;

  beforeAll(async () => {
    restore = setEnv({ APOLLO_API_KEY: undefined, HUNTER_API_KEY: undefined, PROSPECT_DAILY_LIMIT: '100' });
    app = await startApp();
    owner = await registerUser(app, 'Prospectors');
    await asTenant(owner.tenantId, (tx) => tx.subscription.update({ where: { tenantId: owner.tenantId }, data: { planCode: 'growth', status: 'ACTIVE', seats: 20 } }));
    http = api(owner);
  });

  afterAll(async () => {
    await app.close();
    restore();
  });

  it('creates named lists, adds people by hand without duplicates and links people already in the CRM', async () => {
    const list = (await http.post('/prospect-lists', { name: 'Q4 logistics', description: 'Mid-size carriers' }).expect(201)).body;
    listId = list.id;
    expect(list).toMatchObject({ name: 'Q4 logistics', prospects: 0, owner: { name: expect.any(String) } });
    expect((await http.post('/prospect-lists', { name: 'Q4 logistics' }).expect(409)).body.error.code).toBe('NAME_TAKEN');

    const lead = (await http.post('/leads', { fullName: 'Known Person', email: 'known@carrier.test' }).expect(201)).body.lead;
    const added = (await http.post(`/prospect-lists/${listId}/prospects`, {
      prospects: [
        { fullName: 'Asha Rao', email: 'Asha@Carrier.test', title: 'Head of Operations', companyName: 'Carrier One', industry: 'Logistics', country: 'India', companySize: '201-500' },
        { firstName: 'Ben', lastName: 'Ode', companyName: 'Carrier Two', title: 'VP Sales', industry: 'Logistics', country: 'Kenya' },
        { fullName: 'Known Person', email: 'known@carrier.test', companyName: 'Carrier One' },
        { fullName: 'Asha again', email: 'asha@carrier.test' },
      ],
    }).expect(201)).body;
    expect(added).toEqual({ added: 3, duplicates: 1, inCrm: 1, invalid: [] });
    await http.post(`/prospect-lists/${listId}/prospects`, { prospects: [{ title: 'No name or email' }] }).expect(400);

    const d = (await http.get(`/prospect-lists/${listId}?sort=name`).expect(200)).body;
    expect(d.prospects.map((p: { fullName: string }) => p.fullName)).toEqual(['Asha Rao', 'Ben Ode', 'Known Person']);
    expect(d.prospects[2].crm).toEqual({ type: 'lead', id: lead.id, label: 'Known Person' });
    expect(d.list).toMatchObject({ prospects: 3, inCrm: 1, withEmail: 2 });
    expect(d.facets.industry).toEqual([{ value: 'Logistics', count: 2 }]);
    expect((await http.get(`/prospect-lists/${listId}?country=india`).expect(200)).body.total).toBe(1);
    expect((await http.get(`/prospect-lists/${listId}?stage=new`).expect(200)).body.total).toBe(2);
    expect((await http.get(`/prospect-lists/${listId}?emailStatus=none`).expect(200)).body.prospects[0].fullName).toBe('Ben Ode');
    expect((await http.get(`/prospect-lists/${listId}?search=carrier%20two`).expect(200)).body.total).toBe(1);
  });

  it('imports CSV and Excel files with column mapping, reporting bad rows and duplicates', async () => {
    const csv = 'Name,Work Email,Job Title,Company,Employees,Country\nCara Diaz,cara@shipfast.test,COO,ShipFast,"1,200",Mexico\nBad Row,not-an-email,,,,\nAsha Rao,asha@carrier.test,,Carrier One,,\n';
    const p = (await upload(owner, listId, 'leads.csv', Buffer.from(csv), 'text/csv').expect(201)).body;
    expect(p).toMatchObject({ headers: ['Name', 'Work Email', 'Job Title', 'Company', 'Employees', 'Country'], rows: 3, mapping: { fullName: 0, email: 1, title: 2, companyName: 3, companySize: 4, country: 5 } });
    const r = (await http.post(`/prospect-lists/${listId}/import/${p.importId}`, { mapping: p.mapping }).expect(200)).body;
    expect(r).toEqual({ added: 1, duplicates: 1, inCrm: 0, invalid: [{ row: 3, message: 'Enter a valid email address' }] });
    await http.post(`/prospect-lists/${listId}/import/${p.importId}`, { mapping: p.mapping }).expect(404);

    const wb = new Workbook();
    const ws = wb.addWorksheet('Prospects');
    ws.addRow(['First name', 'Last name', 'Email', 'Industry', 'Website']);
    ws.addRow(['Dana', 'Ito', 'dana@harbor.test', 'Shipping', 'https://www.harbor.test/about']);
    ws.addRow(['Eli', 'Moss', 'eli@harbor.test', 'Shipping', 'harbor.test']);
    const xlsx = Buffer.from(await wb.xlsx.writeBuffer());
    const x = (await upload(owner, listId, 'harbor.xlsx', xlsx, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').expect(201)).body;
    expect(x.mapping).toEqual({ firstName: 0, lastName: 1, email: 2, industry: 3, domain: 4 });
    expect((await http.post(`/prospect-lists/${listId}/import/${x.importId}`, { mapping: x.mapping }).expect(200)).body.added).toBe(2);
    const dana = (await http.get(`/prospect-lists/${listId}?search=dana`).expect(200)).body.prospects[0];
    expect(dana).toMatchObject({ fullName: 'Dana Ito', domain: 'harbor.test', source: 'excel' });
    const cara = (await http.get(`/prospect-lists/${listId}?search=cara`).expect(200)).body.prospects[0];
    expect(cara).toMatchObject({ companySize: '1001-5000', source: 'csv' });

    expect((await upload(owner, listId, 'old.xls', Buffer.from('x'), 'application/vnd.ms-excel').expect(400)).body.error.code).toBe('UNSUPPORTED_FILE');
  });

  it('moves and copies between lists, removes duplicates, and assigns a list to a team member', async () => {
    const other = (await http.post('/prospect-lists', { name: 'Shipping' }).expect(201)).body;
    const harbor = (await http.get(`/prospect-lists/${listId}?industry=shipping`).expect(200)).body.prospects.map((p: { id: string }) => p.id);
    expect((await http.post('/prospects/move', { prospectIds: harbor, toListId: other.id }).expect(200)).body).toEqual({ moved: 2, duplicates: 0 });
    expect((await http.post('/prospects/move', { prospectIds: harbor, toListId: listId, copy: true }).expect(200)).body).toEqual({ moved: 2, duplicates: 0 });
    expect((await http.post('/prospects/move', { prospectIds: harbor, toListId: listId, copy: true }).expect(200)).body).toEqual({ moved: 0, duplicates: 2 });

    // A duplicate that slipped in by an edit: same name and company, no email.
    await asTenant(owner.tenantId, (tx) => tx.prospect.create({ data: { tenantId: owner.tenantId, listId, fullName: 'Ben Ode', companyName: 'Carrier Two', source: 'manual' } }));
    expect((await http.post(`/prospect-lists/${listId}/dedupe`).expect(200)).body).toEqual({ removed: 1 });

    const rep = await inviteMember(app, owner, 'member');
    const updated = (await http.put(`/prospect-lists/${other.id}`, { name: 'Shipping', assigneeId: rep.userId }).expect(200)).body;
    expect(updated.assignee).toEqual({ id: rep.userId, name: 'Member member' });
    const notes = (await api(rep).get('/notifications').expect(200)).body.items;
    expect(notes[0]).toMatchObject({ title: 'Prospect list assigned to you: Shipping', link: `/app/prospects/${other.id}` });
  });

  it('enforces roles: viewers read, members work lists, only managers export', async () => {
    const viewer = await inviteMember(app, owner, 'viewer');
    const member = await inviteMember(app, owner, 'member');
    expect((await api(viewer).get('/prospect-lists').expect(200)).body.length).toBe(2);
    await api(viewer).post('/prospect-lists', { name: 'Nope' }).expect(403);
    await api(viewer).post('/prospects/search', { titles: ['CEO'] }).expect(403);
    await api(member).post('/prospect-lists', { name: 'Member list' }).expect(201);
    await member.agent.get(`/api/v1/prospect-lists/${listId}/export`).expect(403);
    await api(member).put('/prospects/settings', { dailyLimit: 5, userLimits: {} }).expect(403);
  });

  it('runs the provider in Mock Mode with labelled sample people that never reach the CRM or exports', async () => {
    const s = (await http.get('/prospects/settings').expect(200)).body;
    expect(s.providers.apollo.mode).toBe('mock');
    expect(s.providers.hunter.mode).toBe('pending');

    const r = (await http.post('/prospects/search', { domains: ['acme.com'], titles: ['Head of Sales'] }).expect(200)).body;
    expect(r).toMatchObject({ provider: 'apollo', mode: 'mock', page: 1, hasMore: true, usage: { used: 1, limit: 100 } });
    expect(r.notice).toContain('sample people');
    expect(r.people).toHaveLength(12);
    expect(r.people.every((p: { sample: boolean; domain: string; email: null; title: string }) => p.sample && p.domain === 'acme.example' && p.email === null && p.title === 'Head of Sales')).toBe(true);
    // Same search, same sample people.
    expect((await http.post('/prospects/search', { domains: ['acme.com'], titles: ['Head of Sales'] }).expect(200)).body.people[0].providerId).toBe(r.people[0].providerId);

    const sampleList = (await http.post('/prospect-lists', { name: 'Sample run' }).expect(201)).body;
    const addRes = await http.post(`/prospect-lists/${sampleList.id}/provider`, { people: r.people.slice(0, 3), revealEmails: true });
    expect(addRes.status, JSON.stringify(addRes.body)).toBe(200);
    const added = addRes.body;
    expect(added).toMatchObject({ added: 3, revealed: 3 });
    const rows = (await http.get(`/prospect-lists/${sampleList.id}`).expect(200)).body.prospects;
    expect(rows.every((p: { sample: boolean; email: string; emailStatus: string; source: string }) => p.sample && p.email.endsWith('@acme.example') && p.emailStatus === 'unknown' && p.source === 'sample')).toBe(true);
    expect((await http.get('/prospects/usage').expect(200)).body).toEqual({ used: 5, limit: 100 });

    const crm = (await http.post('/prospects/to-crm', { prospectIds: rows.map((p: { id: string }) => p.id) }).expect(200)).body;
    expect(crm.results.every((x: { outcome: string; reason: string }) => x.outcome === 'skipped' && x.reason.includes('Sample data'))).toBe(true);
    const exp = await owner.agent.get(`/api/v1/prospect-lists/${sampleList.id}/export`).expect(200);
    expect(exp.headers['x-row-count']).toBe('0');
    expect(exp.headers['x-excluded-count']).toBe('3');

    expect((await http.post('/prospects/verify', { prospectIds: [rows[0].id] }).expect(409)).body.error.code).toBe('PENDING_CONFIGURATION');
  });

  it('applies per-person daily limits that admins set', async () => {
    const member = await inviteMember(app, owner, 'member');
    await http.put('/prospects/settings', { dailyLimit: 50, userLimits: { [member.userId]: 1 } }).expect(200);
    const s = (await http.get('/prospects/settings').expect(200)).body;
    expect(s.members.find((m: { id: string }) => m.id === member.userId)).toMatchObject({ used: 0, limit: 1 });
    await api(member).post('/prospects/search', { titles: ['CTO'] }).expect(200);
    const over = (await api(member).post('/prospects/search', { titles: ['CTO'] }).expect(429)).body;
    expect(over.error).toMatchObject({ code: 'USAGE_LIMIT' });
    expect((await http.get('/prospects/usage').expect(200)).body.limit).toBe(50);
  });

  it('exports only eligible people and audits it', async () => {
    await http.post('/sequences/suppressions', { emails: ['cara@shipfast.test'] }).expect(201);
    const exp = await owner.agent.get(`/api/v1/prospect-lists/${listId}/export`).expect(200);
    expect(exp.headers['content-type']).toContain('text/csv');
    const lines = exp.text.trim().split('\r\n');
    expect(lines[0]).toContain('Full name,First name,Last name,Email');
    expect(lines.slice(1).map((l) => l.split(',')[3]).sort()).toEqual(['asha@carrier.test', 'dana@harbor.test', 'eli@harbor.test', 'known@carrier.test']);
    const audit = await asTenant(owner.tenantId, (tx) => tx.auditLog.findFirst({ where: { tenantId: owner.tenantId, action: 'prospects.exported', entityId: listId }, orderBy: { createdAt: 'desc' } }));
    expect(audit?.metadata).toMatchObject({ rows: 4, excluded: 2 });
  });
});

describe('prospect discovery with provider keys (Apollo and Hunter stand-ins)', () => {
  let app: INestApplication;
  let finder: FinderFixture;
  let mail: ProviderFixture;
  let owner: TestUser;
  let http: ReturnType<typeof api>;
  let restore: () => void;

  beforeAll(async () => {
    finder = await startFinderFixture();
    mail = await startProviderFixture();
    restore = setEnv({
      ...providerEnv(mail.url),
      APOLLO_API_KEY: 'apollo-test-key', APOLLO_API_BASE_URL: `${finder.url}/apollo`,
      HUNTER_API_KEY: 'hunter-test-key', HUNTER_API_BASE_URL: `${finder.url}/hunter`,
      PROSPECT_DAILY_LIMIT: '100',
    });
    app = await startApp();
    owner = await registerUser(app, 'Live Prospectors');
    await asTenant(owner.tenantId, (tx) => tx.subscription.update({ where: { tenantId: owner.tenantId }, data: { planCode: 'growth', status: 'ACTIVE', seats: 20 } }));
    http = api(owner);
  });

  afterAll(async () => {
    await app.close();
    await finder.close();
    await mail.close();
    restore();
  });

  it('searches Apollo, reveals emails on request, verifies with Hunter, adds to the CRM and reports list outreach', async () => {
    expect((await http.get('/prospects/settings').expect(200)).body.providers.apollo.mode).toBe('pending');
    const r = (await http.post('/prospects/search', { domains: ['bluefin-logistics.com'] }).expect(200)).body;
    expect(r).toMatchObject({ mode: 'live', hasMore: false });
    expect(r.people.map((p: { fullName: string; email: null; sample: boolean }) => [p.fullName, p.email, p.sample])).toEqual([['Ana Lima', null, false], ['Dev Kapoor', null, false], ['Ruth Okon', null, false]]);
    expect(r.people[0]).toMatchObject({ companyName: 'Bluefin Logistics', domain: 'bluefin-logistics.com', companySize: '201-500', title: 'Head of Operations' });
    expect((await http.get('/prospects/settings').expect(200)).body.providers.apollo.mode).toBe('live');

    const list = (await http.post('/prospect-lists', { name: 'Bluefin' }).expect(201)).body;
    const added = (await http.post(`/prospect-lists/${list.id}/provider`, { people: r.people, revealEmails: true }).expect(200)).body;
    // Ruth has no email at Apollo: she is added without one, never with a guess.
    expect(added).toMatchObject({ added: 3, revealed: 2 });
    expect(finder.apolloCalls).toEqual(['/apollo/mixed_people/api_search', '/apollo/people/bulk_match']);
    const rows = (await http.get(`/prospect-lists/${list.id}?sort=name`).expect(200)).body.prospects;
    expect(rows.map((p: { email: string | null; emailStatus: string | null; source: string }) => [p.email, p.emailStatus, p.source])).toEqual([
      ['ana.lima@bluefin-logistics.com', 'valid', 'apollo'],
      ['dev.kapoor@bluefin-logistics.com', 'needs_verification', 'apollo'],
      [null, null, 'apollo'],
    ]);

    const v = (await http.post('/prospects/verify', { prospectIds: rows.map((p: { id: string }) => p.id) }).expect(200)).body;
    expect(v).toMatchObject({ checked: 2, skipped: 1 });
    expect((await http.get(`/prospect-lists/${list.id}?emailStatus=unknown`).expect(200)).body.prospects[0].fullName).toBe('Dev Kapoor');
    expect((await http.get('/prospects/settings').expect(200)).body.providers.hunter.mode).toBe('live');

    // Add to the CRM and enrol in a running sequence from a connected mailbox.
    const { url } = (await http.post('/integrations/google/connect').expect(200)).body;
    await http.get(`/integrations/google/callback?code=good-code&state=${encodeURIComponent(new URL(url).searchParams.get('state')!)}`).expect(302);
    const seq = (await http.post('/sequences', { name: 'Bluefin intro', steps: [{ id: 'intro', type: 'email', delayDays: 0, subject: 'Hello {{first_name|there}}', body: 'Quick note.' }], settings: { sendDays: [0, 1, 2, 3, 4, 5, 6], sendStart: '00:00', sendEnd: '23:59', timezone: 'UTC', dailyLimit: 50, trackOpens: true, trackClicks: true } }).expect(201)).body;
    await http.post(`/sequences/${seq.id}/status`, { status: 'ACTIVE' }).expect(200);
    const crm = (await http.post('/prospects/to-crm', { prospectIds: rows.map((p: { id: string }) => p.id), sequenceId: seq.id }).expect(200)).body;
    expect(crm.results.map((x: { outcome: string }) => x.outcome)).toEqual(['added', 'added', 'added']);
    expect(crm.enrollment.enrolled).toBe(2);
    const ana = await asTenant(owner.tenantId, (tx) => tx.lead.findFirstOrThrow({ where: { email: 'ana.lima@bluefin-logistics.com' } }));
    expect(ana).toMatchObject({ source: 'Prospect list', emailStatus: 'valid', jobTitle: 'Head of Operations', companyName: 'Bluefin Logistics' });
    expect(ana.tags).toEqual(['prospect-list', 'apollo']);
    expect((await http.post('/prospects/to-crm', { prospectIds: [rows[0].id] }).expect(200)).body.results[0].outcome).toBe('existing');

    await asTenant(owner.tenantId, (tx) => tx.sequenceEnrollment.updateMany({ where: { sequenceId: seq.id }, data: { nextRunAt: new Date(Date.now() - 1000) } }));
    await app.get(SequenceRunner).runDue(50);
    const perf = (await http.get(`/prospect-lists/${list.id}/performance`).expect(200)).body;
    expect(perf.sequences).toEqual([expect.objectContaining({ sequence: { id: seq.id, name: 'Bluefin intro' }, enrolled: 2, sent: 2, replied: 0 })]);
    expect(perf.totals).toMatchObject({ enrolled: 2, sent: 2 });
  });

  it('reports a refused Apollo key as a provider error without counting it as live', async () => {
    const r = setEnv({ APOLLO_API_KEY: 'wrong' });
    const bad = await startApp();
    r();
    try {
      const other = await registerUser(bad, 'Bad Key Org');
      const res = await api(other).post('/prospects/search', { titles: ['CEO'] });
      expect(res.status).toBe(502);
      expect(res.body.error).toMatchObject({ code: 'PROVIDER_ERROR', message: 'Apollo refused the API key or its scope. Check APOLLO_API_KEY.' });
      expect((await api(other).get('/prospects/settings').expect(200)).body.providers.apollo.mode).toBe('pending');
    } finally {
      await bad.close();
    }
  });
});
